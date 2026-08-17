import type { ClickHouseClient } from '@clickhouse/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { RUM_INGEST_QUEUE_NAME, type RumIngestJobData } from '@x/utils'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClickHouseClient } from '../trends/clickhouse-client.js'
import { WEB_VITALS_TABLE, ensureWebVitalsTable } from './clickhouse-table.js'
import { createRumIngestRepository } from './rum-ingest.repository.js'
import { createRumIngestWorker } from './rum-ingest.worker.js'

const CLICKHOUSE_HTTP_PORT = 8123
const CLICKHOUSE_USER = 'x'
const CLICKHOUSE_PASSWORD = 'x'
const CLICKHOUSE_DATABASE = 'x_analytics'

// Same reasoning as trend-ingest.integration.test.ts's own
// createClickHouseContainer for why this is a hand-rolled GenericContainer,
// not @testcontainers/clickhouse's ClickHouseContainer (its hardcoded
// withUlimits rejects outright in this sandbox's container runtime).
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

type WebVitalRow = {
  metric: string
  value: number
  rating: string
  path: string
  navigation_type: string
  created_at: string
}

async function readMetrics(client: ClickHouseClient, metric: string): Promise<WebVitalRow[]> {
  const rs = await client.query({
    query: `SELECT metric, value, rating, path, navigation_type, created_at FROM ${WEB_VITALS_TABLE} WHERE metric = {metric:String} ORDER BY created_at`,
    query_params: { metric },
    format: 'JSONEachRow',
  })
  return rs.json<WebVitalRow>()
}

// Same DateTime64(3) rendering caveat as trend-ingest.integration.test.ts's
// own toClickHouseDateTime64 — and the same reason a fixed calendar date
// isn't used here either (this table's own 30-day TTL, clickhouse-table.ts).
function toClickHouseDateTime64(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '')
}

// Same pinned tag as docker-compose.yml / trend-ingest.integration.test.ts.
const CLICKHOUSE_IMAGE = 'clickhouse/clickhouse-server:24.8-alpine'

describe('RUM ingestion (roadmap 3.4g)', () => {
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
    await ensureWebVitalsTable(client)
  }, 120_000)

  afterEach(async () => {
    await client.command({ query: `TRUNCATE TABLE ${WEB_VITALS_TABLE}` })
  })

  afterAll(async () => {
    await client.close()
    await Promise.all([clickhouseContainer.stop(), redisContainer.stop()])
  })

  it('writes a real LCP report, via the repository directly', async () => {
    const repository = createRumIngestRepository(client)
    const timestampMs = Date.now()
    const job: RumIngestJobData = {
      metric: 'LCP',
      value: 1842.5,
      rating: 'good',
      path: '/[username]',
      navigationType: 'navigate',
      timestampMs,
    }

    await repository.insertMetric(job)

    const rows = await readMetrics(client, 'LCP')
    expect(rows).toEqual([
      {
        metric: 'LCP',
        value: 1842.5,
        rating: 'good',
        path: '/[username]',
        navigation_type: 'navigate',
        created_at: toClickHouseDateTime64(timestampMs),
      },
    ])
  })

  it('writes a poor CLS report distinctly from a good one', async () => {
    const repository = createRumIngestRepository(client)

    await repository.insertMetric({
      metric: 'CLS',
      value: 0.35,
      rating: 'poor',
      path: '/home',
      navigationType: 'navigate',
      timestampMs: Date.now(),
    })

    const rows = await readMetrics(client, 'CLS')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.rating).toBe('poor')
  })

  it('processes a queued job end-to-end through a real BullMQ worker', async () => {
    const repository = createRumIngestRepository(client)
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
    const handle = createRumIngestWorker({ repository, redisUrl, concurrency: 1 })
    const queue = new Queue<RumIngestJobData>(RUM_INGEST_QUEUE_NAME, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', (job) => {
        if (job.data.path === '/queued-test') resolve()
      })
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('rum-ingest', {
      metric: 'INP',
      value: 150,
      rating: 'good',
      path: '/queued-test',
      navigationType: 'navigate',
      timestampMs: Date.now(),
    })
    await completed

    const rows = await readMetrics(client, 'INP')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.path).toBe('/queued-test')

    await queue.close()
    await handle.close()
  }, 30_000)
})
