import type { ClickHouseClient } from '@clickhouse/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { TREND_INGEST_QUEUE_NAME, type TrendIngestJobData } from '@x/utils'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  HASHTAG_MENTIONS_TABLE,
  createClickHouseClient,
  ensureHashtagMentionsTable,
} from './clickhouse-client.js'
import { createTrendIngestRepository } from './trend-ingest.repository.js'
import { createTrendIngestWorker } from './trend-ingest.worker.js'

const CLICKHOUSE_HTTP_PORT = 8123
const CLICKHOUSE_USER = 'x'
const CLICKHOUSE_PASSWORD = 'x'
const CLICKHOUSE_DATABASE = 'x_analytics'

// Plain GenericContainer, not @testcontainers/clickhouse's ClickHouseContainer:
// that module's constructor hardcodes `withUlimits({nofile: {hard: 262144, ...}})`
// to guard against "too many open files" under heavy production-scale load,
// which this sandbox's container runtime rejects outright ("error setting
// rlimit type 7: operation not permitted") — confirmed by testing, not
// assumed. None of this suite's load needs that headroom, so a hand-rolled
// container without it is both sufficient and the only thing that actually
// starts here.
function createClickHouseContainer(image: string): GenericContainer {
  return new GenericContainer(image)
    .withEnvironment({
      CLICKHOUSE_USER,
      CLICKHOUSE_PASSWORD,
      CLICKHOUSE_DB: CLICKHOUSE_DATABASE,
    })
    .withExposedPorts(CLICKHOUSE_HTTP_PORT)
    .withWaitStrategy(
      Wait.forHttp('/ping', CLICKHOUSE_HTTP_PORT).forResponsePredicate(
        (response) => response === 'Ok.\n',
      ),
    )
}

type MentionRow = {
  hashtag: string
  post_id: string
  author_id: string
  lang: string
  created_at: string
}

async function readMentions(client: ClickHouseClient, hashtag: string): Promise<MentionRow[]> {
  const rs = await client.query({
    query: `SELECT hashtag, post_id, author_id, lang, created_at FROM ${HASHTAG_MENTIONS_TABLE} WHERE hashtag = {hashtag:String} ORDER BY post_id`,
    query_params: { hashtag },
    format: 'JSONEachRow',
  })
  return rs.json<MentionRow>()
}

// ClickHouse's JSONEachRow rendering of DateTime64(3): space instead of
// 'T', no trailing 'Z', millisecond precision — otherwise identical to
// Date#toISOString(). A fixed calendar date (e.g. an arbitrary day in
// January) is deliberately NOT used as a fixture here: the table's own TTL
// (clickhouse-client.ts, 30 days) prunes anything older at *query* time,
// confirmed by testing directly against a real container — a hardcoded
// past date would start silently returning zero rows the moment it aged
// past 30 days from whenever this suite happens to run.
function toClickHouseDateTime64(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '')
}

// Same image tag as docker-compose.yml — the pinned Postgres/Redis
// containers elsewhere in this suite follow the same "test against exactly
// what production runs" reasoning.
const CLICKHOUSE_IMAGE = 'clickhouse/clickhouse-server:24.8-alpine'

describe('trend ingestion (roadmap 2.4)', () => {
  let clickhouseContainer: StartedTestContainer
  let redisContainer: StartedRedisContainer
  let client: ClickHouseClient

  beforeAll(async () => {
    ;[clickhouseContainer, redisContainer] = await Promise.all([
      createClickHouseContainer(CLICKHOUSE_IMAGE).start(),
      new RedisContainer('redis:7-alpine').start(),
    ])
    client = createClickHouseClient({
      url: `http://${clickhouseContainer.getHost()}:${clickhouseContainer.getMappedPort(CLICKHOUSE_HTTP_PORT)}`,
      username: CLICKHOUSE_USER,
      password: CLICKHOUSE_PASSWORD,
      database: CLICKHOUSE_DATABASE,
    })
    await ensureHashtagMentionsTable(client)
  }, 120_000)

  afterEach(async () => {
    // Every test gets a clean table instead of unique hashtags per test —
    // simpler assertions (no need to invent a fresh hashtag name each time)
    // and this table has no foreign keys or other state to cascade through.
    await client.command({ query: `TRUNCATE TABLE ${HASHTAG_MENTIONS_TABLE}` })
  })

  afterAll(async () => {
    await client.close()
    await Promise.all([clickhouseContainer.stop(), redisContainer.stop()])
  })

  it('writes one row per hashtag on the post, via the repository directly', async () => {
    const repository = createTrendIngestRepository(client)
    const createdAtMs = Date.now()
    const job: TrendIngestJobData = {
      postId: '100',
      authorId: '1',
      hashtags: ['mundial', 'futbol'],
      createdAtMs,
      lang: 'es',
    }

    await repository.insertMentions(job)

    const mundial = await readMentions(client, 'mundial')
    expect(mundial).toEqual([
      {
        hashtag: 'mundial',
        post_id: '100',
        author_id: '1',
        lang: 'es',
        created_at: toClickHouseDateTime64(createdAtMs),
      },
    ])
    const futbol = await readMentions(client, 'futbol')
    expect(futbol).toHaveLength(1)
  })

  it('stores an empty string, not a literal null, for an undetected language', async () => {
    const repository = createTrendIngestRepository(client)

    await repository.insertMentions({
      postId: '101',
      authorId: '1',
      hashtags: ['ok'],
      createdAtMs: Date.now(),
      lang: null,
    })

    const rows = await readMentions(client, 'ok')
    expect(rows[0]?.lang).toBe('')
  })

  it('is a no-op for a job with no hashtags — no row, no error', async () => {
    const repository = createTrendIngestRepository(client)

    await expect(
      repository.insertMentions({
        postId: '102',
        authorId: '1',
        hashtags: [],
        createdAtMs: Date.now(),
        lang: 'en',
      }),
    ).resolves.toBeUndefined()

    const rs = await client.query({
      query: `SELECT count() as cnt FROM ${HASHTAG_MENTIONS_TABLE} WHERE post_id = {postId:UInt64}`,
      query_params: { postId: '102' },
      format: 'JSONEachRow',
    })
    const [row] = await rs.json<{ cnt: string }>()
    expect(row?.cnt).toBe('0')
  })

  it('processes a queued job end-to-end through a real BullMQ worker', async () => {
    const repository = createTrendIngestRepository(client)
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
    const handle = createTrendIngestWorker({ repository, redisUrl, concurrency: 1 })
    const queue = new Queue<TrendIngestJobData>(TREND_INGEST_QUEUE_NAME, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', (job) => {
        if (job.data.postId === '200') resolve()
      })
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('trend-ingest', {
      postId: '200',
      authorId: '9',
      hashtags: ['viral'],
      createdAtMs: Date.now(),
      lang: 'en',
    })
    await completed

    const rows = await readMentions(client, 'viral')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.post_id).toBe('200')

    await queue.close()
    await handle.close()
  }, 30_000)
})
