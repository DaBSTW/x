import { fileURLToPath } from 'node:url'
import type { Client } from '@opensearch-project/opensearch'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import {
  type Database,
  createDatabase,
  media,
  migrationsFolderUrl,
  postCounters,
  posts,
  userCounters,
  users,
} from '@x/db'
import { POSTS_SEARCH_INDEX, USERS_SEARCH_INDEX, cdcTopicName } from '@x/utils'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Kafka, type Producer, logLevel } from 'kafkajs'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOpenSearchClient, ensureSearchIndices } from './opensearch-client.js'
import { type SearchIndexer, createSearchIndexer } from './search-indexer.worker.js'

const OPENSEARCH_HTTP_PORT = 9200
// A fixed (not dynamically-assigned) host port, same reasoning as
// docker-compose.yml's redpanda service: the broker has to advertise its
// own externally-reachable address *in its startup command*, before
// Testcontainers could tell us what a dynamic mapping landed on.
const REDPANDA_EXTERNAL_PORT = 29192

const WATCHED_TABLES = ['posts', 'users', 'post_counters', 'user_counters', 'media'] as const

// Same GenericContainer workaround as opensearch-client.integration.test.ts
// — no @testcontainers/opensearch compatible with this repo's pinned
// testcontainers@10.16.0 exists.
function createOpenSearchContainer(): GenericContainer {
  return new GenericContainer('opensearchproject/opensearch:2')
    .withEnvironment({
      'discovery.type': 'single-node',
      DISABLE_SECURITY_PLUGIN: 'true',
      DISABLE_INSTALL_DEMO_CONFIG: 'true',
      OPENSEARCH_JAVA_OPTS: '-Xms512m -Xmx512m',
    })
    .withExposedPorts(OPENSEARCH_HTTP_PORT)
    .withWaitStrategy(Wait.forHttp('/_cluster/health', OPENSEARCH_HTTP_PORT).forStatusCode(200))
    .withStartupTimeout(120_000)
}

// Redpanda, not @testcontainers/kafka's Confluent image — this is what
// docker-compose.yml and production actually run (see its own comment for
// why), and unlike a fresh image pull, it's already local from that
// checkpoint's work. A single listener is enough here (nothing but this
// test process itself ever talks to it — contrast
// register-cdc-connector.integration.test.ts, which also needs a
// container-network-reachable address for a peer Debezium container).
function createRedpandaContainer(): GenericContainer {
  return (
    new GenericContainer('redpandadata/redpanda:latest')
      .withExposedPorts({ container: REDPANDA_EXTERNAL_PORT, host: REDPANDA_EXTERNAL_PORT })
      .withCommand([
        'redpanda',
        'start',
        '--smp',
        '1',
        '--memory',
        '512M',
        '--overprovisioned',
        '--node-id',
        '0',
        '--check=false',
        '--kafka-addr',
        `PLAINTEXT://0.0.0.0:${REDPANDA_EXTERNAL_PORT}`,
        '--advertise-kafka-addr',
        `PLAINTEXT://localhost:${REDPANDA_EXTERNAL_PORT}`,
      ])
      // Same real healthcheck as docker-compose.yml's redpanda service —
      // rpk's own cluster-health view, not just "the port accepts a TCP
      // connection" (Wait.forListeningPorts would be true well before the
      // broker can actually serve produce/consume traffic).
      .withWaitStrategy(Wait.forSuccessfulCommand('rpk cluster health | grep -q "Healthy:.*true"'))
      .withStartupTimeout(120_000)
  )
}

/**
 * Polls `check` until it returns something other than `false`. The pipeline
 * under test here is asynchronous end to end (produce → consume → batch →
 * bulk write) — a single assertion immediately after producing would be
 * racy by construction, not just occasionally flaky, so every landing
 * assertion below goes through this instead of a bare `await client.get`.
 */
async function waitFor<T>(check: () => Promise<T | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await check()
    if (result !== false) return result
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`waitFor: condition never became true within ${timeoutMs}ms`)
}

describe('search indexer (roadmap 2.3 / SPECS.md §10.2)', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let kafkaContainer: StartedTestContainer
  let openSearchContainer: StartedTestContainer
  let db: Database
  let openSearchClient: Client
  let producer: Producer
  let indexer: SearchIndexer
  let nextId = 1000n

  function nextSnowflakeId(): bigint {
    nextId += 1n
    return nextId
  }

  async function seedUser(
    overrides: Partial<{
      id: bigint
      username: string
      displayName: string
      isVerified: boolean
      followersCount: number
    }> = {},
  ): Promise<bigint> {
    const id = overrides.id ?? nextSnowflakeId()
    const username = overrides.username ?? `user${id}`
    await db.insert(users).values({
      id,
      username,
      usernameLower: username.toLowerCase(),
      email: `${username}@example.com`,
      displayName: overrides.displayName ?? username,
      isVerified: overrides.isVerified ?? false,
    })
    await db
      .insert(userCounters)
      .values({ userId: id, followersCount: overrides.followersCount ?? 0 })
    return id
  }

  async function seedPost(
    authorId: bigint,
    overrides: Partial<{ id: bigint; text: string }> = {},
  ): Promise<bigint> {
    const id = overrides.id ?? nextSnowflakeId()
    await db.insert(posts).values({
      id,
      authorId,
      text: overrides.text ?? 'hola',
      lang: 'es',
      createdAt: new Date(),
    })
    await db.insert(postCounters).values({ postId: id })
    return id
  }

  /**
   * Sends a synthetic Debezium-flattened CDC message — built as a raw JSON
   * string, not via JSON.stringify, specifically so bigint/number fields
   * come out as *unquoted* numeric literals, matching exactly what
   * Debezium's own JSON converter produces for a Postgres bigint column
   * (and exactly what makes cdc.ts's json-bigint parsing necessary in the
   * first place — a plain JSON.parse elsewhere in this test would silently
   * round a large one).
   */
  async function produceCdc(
    table: (typeof WATCHED_TABLES)[number],
    fields: Record<string, string | number | bigint | boolean | null>,
  ): Promise<void> {
    const json = `{${Object.entries(fields)
      .map(([key, value]) => {
        if (value === null) return `"${key}":null`
        if (typeof value === 'string') return `"${key}":${JSON.stringify(value)}`
        return `"${key}":${value}` // number | bigint | boolean — unquoted, like Debezium's own output
      })
      .join(',')}}`
    await producer.send({ topic: cdcTopicName(table), messages: [{ value: json }] })
  }

  beforeAll(async () => {
    ;[postgresContainer, kafkaContainer, openSearchContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      createRedpandaContainer().start(),
      createOpenSearchContainer().start(),
    ])

    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    openSearchClient = createOpenSearchClient({
      url: `http://${openSearchContainer.getHost()}:${openSearchContainer.getMappedPort(OPENSEARCH_HTTP_PORT)}`,
    })
    await ensureSearchIndices(openSearchClient)

    const brokers = [
      `${kafkaContainer.getHost()}:${kafkaContainer.getMappedPort(REDPANDA_EXTERNAL_PORT)}`,
    ]
    const kafka = new Kafka({ clientId: 'search-indexer-test', brokers, logLevel: logLevel.ERROR })

    const admin = kafka.admin()
    await admin.connect()
    await admin.createTopics({
      topics: WATCHED_TABLES.map((table) => ({ topic: cdcTopicName(table), numPartitions: 1 })),
    })
    await admin.disconnect()

    producer = kafka.producer()
    await producer.connect()

    // Small thresholds so the "500 or 1 s, whichever first" batching
    // (SPECS.md §10.2) is exercised deterministically within a normal test
    // timeout, instead of a real test waiting on the full production defaults.
    indexer = createSearchIndexer({
      brokers,
      groupId: 'test-search-indexer',
      db,
      openSearchClient,
      maxBatchSize: 3,
      maxWaitMs: 300,
    })
    // Started before any message is produced, matching how this consumer
    // actually runs in production (always-on) — a fresh consumer group with
    // fromBeginning:false only sees messages produced *after* it's
    // subscribed, so producing first would just make every test below hang.
    await indexer.start()
  }, 180_000)

  afterAll(async () => {
    await producer.disconnect()
    await indexer.stop()
    await Promise.all([postgresContainer.stop(), kafkaContainer.stop(), openSearchContainer.stop()])
  })

  it('indexes a post from a real posts-table CDC event — snowflake-scale id, hashtag extraction, and engagement all end to end', async () => {
    const authorId = await seedUser({ username: 'ana' })
    // Beyond Number.MAX_SAFE_INTEGER — proves the *whole pipeline*
    // (Kafka → cdc.ts → the repository's bigint id → OpenSearch's own
    // JSON body) preserves it, not just cdc.ts's parser in isolation.
    const postId = 9223372036854775001n
    await db
      .insert(posts)
      .values({ id: postId, authorId, text: 'Vamos #Mundial', lang: 'es', createdAt: new Date() })
    await db
      .insert(postCounters)
      .values({ postId, likesCount: 5, repostsCount: 1, repliesCount: 0, quotesCount: 0 })

    await produceCdc('posts', { id: postId, author_id: authorId })

    const source = await waitFor(async () => {
      const { body: found } = await openSearchClient.exists({
        index: POSTS_SEARCH_INDEX,
        id: postId.toString(),
      })
      if (!found) return false
      const { body } = await openSearchClient.get({
        index: POSTS_SEARCH_INDEX,
        id: postId.toString(),
      })
      return body._source
    })
    expect(source).toMatchObject({
      id: postId.toString(),
      author_id: authorId.toString(),
      author_handle: 'ana',
      hashtags: ['mundial'],
      has_media: false,
      engagement: 6,
    })
  })

  it('refreshes engagement from a post_counters-only CDC event — a table that never touches posts itself', async () => {
    const authorId = await seedUser()
    const postId = await seedPost(authorId, { text: 'sin hashtags' })
    await produceCdc('posts', { id: postId, author_id: authorId })
    await waitFor(async () => {
      const { body } = await openSearchClient.exists({
        index: POSTS_SEARCH_INDEX,
        id: postId.toString(),
      })
      return body || false
    })

    await db.update(postCounters).set({ likesCount: 7 }).where(eq(postCounters.postId, postId))
    await produceCdc('post_counters', { post_id: postId, likes_count: 7 })

    const engagement = await waitFor(async () => {
      const { body } = await openSearchClient.get({
        index: POSTS_SEARCH_INDEX,
        id: postId.toString(),
      })
      const value = body._source?.engagement
      return value === 7 ? value : false
    })
    expect(engagement).toBe(7)
  })

  it('flips has_media from a media-only CDC event once an upload is linked to the post', async () => {
    const authorId = await seedUser()
    const postId = await seedPost(authorId)
    await produceCdc('posts', { id: postId, author_id: authorId })
    await waitFor(async () => {
      const { body: found } = await openSearchClient.exists({
        index: POSTS_SEARCH_INDEX,
        id: postId.toString(),
      })
      return found || false
    })

    const mediaId = nextSnowflakeId()
    await db.insert(media).values({
      id: mediaId,
      ownerId: authorId,
      postId,
      kind: 'image',
      storageKey: 'k',
      mimeType: 'image/webp',
      sizeBytes: 1n,
    })
    await produceCdc('media', { id: mediaId, post_id: postId, owner_id: authorId })

    const hasMedia = await waitFor(async () => {
      const { body } = await openSearchClient.get({
        index: POSTS_SEARCH_INDEX,
        id: postId.toString(),
      })
      return body._source?.has_media === true
    })
    expect(hasMedia).toBe(true)
  })

  it('indexes a user and refreshes followers_count from a user_counters-only CDC event', async () => {
    const userId = await seedUser({ username: 'capital', displayName: 'Capital', isVerified: true })
    await produceCdc('users', { id: userId })

    await waitFor(async () => {
      const { body: found } = await openSearchClient.exists({
        index: USERS_SEARCH_INDEX,
        id: userId.toString(),
      })
      return found || false
    })

    await db
      .update(userCounters)
      .set({ followersCount: 250 })
      .where(eq(userCounters.userId, userId))
    await produceCdc('user_counters', { user_id: userId, followers_count: 250 })

    const source = await waitFor(async () => {
      const { body } = await openSearchClient.get({
        index: USERS_SEARCH_INDEX,
        id: userId.toString(),
      })
      return body._source?.followers_count === 250 ? body._source : false
    })
    expect(source).toMatchObject({
      id: userId.toString(),
      username: 'capital',
      display_name: 'Capital',
      is_verified: true,
      followers_count: 250,
    })
  })

  it('deletes a post from the index once it is soft-deleted in Postgres', async () => {
    const authorId = await seedUser()
    const postId = await seedPost(authorId)
    await produceCdc('posts', { id: postId, author_id: authorId })
    await waitFor(async () => {
      const { body } = await openSearchClient.exists({
        index: POSTS_SEARCH_INDEX,
        id: postId.toString(),
      })
      return body || false
    })

    await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId))
    await produceCdc('posts', { id: postId, author_id: authorId })

    const stillGone = await waitFor(async () => {
      const { body: found } = await openSearchClient.exists({
        index: POSTS_SEARCH_INDEX,
        id: postId.toString(),
      })
      return !found
    })
    expect(stillGone).toBe(true)
  })

  it('batches multiple distinct posts from one flush, not just a single lone id at a time', async () => {
    const authorId = await seedUser()
    const postIds = [await seedPost(authorId), await seedPost(authorId), await seedPost(authorId)]
    for (const id of postIds) {
      await produceCdc('posts', { id, author_id: authorId })
    }

    const allIndexed = await waitFor(async () => {
      const results = await Promise.all(
        postIds.map((id) =>
          openSearchClient.exists({ index: POSTS_SEARCH_INDEX, id: id.toString() }),
        ),
      )
      return results.every((result) => result.body)
    })
    expect(allIndexed).toBe(true)
  })
})
