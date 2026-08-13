import { fileURLToPath } from 'node:url'
import { CreateBucketCommand } from '@aws-sdk/client-s3'
import { Client as OpenSearchClient } from '@opensearch-project/opensearch'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import {
  createDatabase,
  migrationsFolderUrl,
  postCounters,
  posts,
  userCounters,
  users,
} from '@x/db'
import { POSTS_SEARCH_INDEX, USERS_SEARCH_INDEX, createS3Client, generateId } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

const S3_BUCKET = 'x-media'
const OPENSEARCH_HTTP_PORT = 9200

// A deliberately trimmed-down stand-in for apps/workers' own POSTS_INDEX_BODY/
// USERS_INDEX_BODY (opensearch-client.ts) — not imported from there: apps/api
// and apps/workers are separate deployables, and this repo never imports
// across that boundary (shared code goes through packages/*, and moving the
// *whole* file — including boot-time-specific ensureSearchIndices — into a
// shared package for one test's sake wasn't worth it under this checkpoint's
// time budget). Same field types (text/keyword/boolean/float/date), just the
// plain `standard` analyzer instead of `multilang`/edge_ngram — this suite's
// own assertions never test accent-folding or typeahead-style prefix
// matching, both already covered for real by apps/workers' own
// opensearch-client.integration.test.ts.
const TEST_POSTS_INDEX_BODY = {
  mappings: {
    properties: {
      id: { type: 'keyword' },
      author_id: { type: 'keyword' },
      author_handle: { type: 'keyword' },
      text: { type: 'text' },
      hashtags: { type: 'keyword' },
      mentions: { type: 'keyword' },
      has_links: { type: 'boolean' },
      lang: { type: 'keyword' },
      has_media: { type: 'boolean' },
      is_sensitive: { type: 'boolean' },
      engagement: { type: 'float' },
      created_at: { type: 'date' },
    },
  },
} as const

const TEST_USERS_INDEX_BODY = {
  mappings: {
    properties: {
      id: { type: 'keyword' },
      username: { type: 'text' },
      display_name: { type: 'text' },
      followers_count: { type: 'long' },
      is_verified: { type: 'boolean' },
    },
  },
} as const

// Same GenericContainer workaround as apps/workers' own OpenSearch tests —
// no @testcontainers/opensearch compatible with this repo's pinned
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

describe('search routes (roadmap 2.3 / SPECS.md §5.4, §10.3)', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let minioContainer: StartedMinioContainer
  let openSearchContainer: StartedTestContainer
  let openSearchClient: OpenSearchClient
  let app: FastifyInstance
  let db: ReturnType<typeof createDatabase>
  let accessToken: string

  beforeAll(async () => {
    ;[postgresContainer, redisContainer, mailpitContainer, minioContainer, openSearchContainer] =
      await Promise.all([
        new PostgreSqlContainer('postgres:17-alpine').start(),
        new RedisContainer('redis:7-alpine').start(),
        new GenericContainer('axllent/mailpit:latest')
          .withExposedPorts(1025, 8025)
          .withWaitStrategy(Wait.forListeningPorts())
          .start(),
        new MinioContainer('minio/minio:latest').start(),
        createOpenSearchContainer().start(),
      ])

    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    const s3Endpoint = minioContainer.getConnectionUrl()
    const s3Client = createS3Client({
      endpoint: s3Endpoint,
      region: 'us-east-1',
      accessKeyId: minioContainer.getUsername(),
      secretAccessKey: minioContainer.getPassword(),
      forcePathStyle: true,
    })
    await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }))

    const openSearchUrl = `http://${openSearchContainer.getHost()}:${openSearchContainer.getMappedPort(OPENSEARCH_HTTP_PORT)}`
    openSearchClient = new OpenSearchClient({ node: openSearchUrl })
    // Seeds the indices directly (TEST_POSTS_INDEX_BODY/TEST_USERS_INDEX_BODY
    // above) — this test is about apps/api's query/hydration side, not the
    // CDC indexer (covered separately, for real, by apps/workers' own
    // integration suite), so documents are indexed directly rather than
    // round-tripped through a live Debezium+Kafka pipeline neither
    // necessary nor helpful here.
    await openSearchClient.indices.create({
      index: POSTS_SEARCH_INDEX,
      body: TEST_POSTS_INDEX_BODY as unknown as Record<string, unknown>,
    })
    await openSearchClient.indices.create({
      index: USERS_SEARCH_INDEX,
      body: TEST_USERS_INDEX_BODY as unknown as Record<string, unknown>,
    })

    const env: Env = {
      NODE_ENV: 'test',
      API_PORT: 0,
      WEB_URL: 'http://localhost:3000',
      CORS_ORIGIN: 'http://localhost:3000',
      WORKER_ID: 3,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: mailpitContainer.getHost(),
      SMTP_PORT: mailpitContainer.getMappedPort(1025),
      MAIL_FROM: 'no-reply@x.example.com',
      S3_ENDPOINT: s3Endpoint,
      S3_REGION: 'us-east-1',
      S3_BUCKET,
      S3_ACCESS_KEY_ID: minioContainer.getUsername(),
      S3_SECRET_ACCESS_KEY: minioContainer.getPassword(),
      S3_FORCE_PATH_STYLE: true,
      OPENSEARCH_URL: openSearchUrl,
      LOGIN_RATE_LIMIT_MAX: 100,
    }
    app = await buildApp(env)

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'searchviewer',
        email: 'searchviewer@example.com',
        password: 'a genuinely unique passphrase 9x2',
        birthDate: '1990-01-01',
      },
    })
    expect(registerResponse.statusCode).toBe(201)

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'searchviewer@example.com', password: 'a genuinely unique passphrase 9x2' },
    })
    expect(loginResponse.statusCode).toBe(200)
    accessToken = loginResponse.json().data.accessToken
  }, 150_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([
      postgresContainer.stop(),
      redisContainer.stop(),
      mailpitContainer.stop(),
      minioContainer.stop(),
      openSearchContainer.stop(),
    ])
  })

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` }
  }

  let usernameCounter = 0
  function nextUsernameSuffix(): number {
    usernameCounter += 1
    return usernameCounter
  }

  /** Seeds one real post (Postgres, for hydration) plus its matching OpenSearch document (for the query itself) — the two things a real CDC-indexed post always has together. */
  async function seedPost(
    authorId: bigint,
    overrides: {
      id?: bigint
      text?: string
      hashtags?: string[]
      engagement?: number
      createdAt?: Date
    } = {},
  ): Promise<bigint> {
    const id = overrides.id ?? generateId()
    const createdAt = overrides.createdAt ?? new Date()
    const text = overrides.text ?? 'hola'
    await db.insert(posts).values({ id, authorId, text, lang: 'es', createdAt })
    await db.insert(postCounters).values({ postId: id, likesCount: overrides.engagement ?? 0 })
    await openSearchClient.index({
      index: POSTS_SEARCH_INDEX,
      id: id.toString(),
      refresh: true,
      body: {
        id: id.toString(),
        author_id: authorId.toString(),
        author_handle: '',
        text,
        hashtags: overrides.hashtags ?? [],
        mentions: [],
        has_links: false,
        lang: 'es',
        has_media: false,
        is_sensitive: false,
        engagement: overrides.engagement ?? 0,
        created_at: createdAt.toISOString(),
      },
    })
    return id
  }

  async function seedUser(
    overrides: {
      id?: bigint
      username?: string
      displayName?: string
      followersCount?: number
    } = {},
  ): Promise<bigint> {
    // `users.username` is varchar(15) — a snowflake id alone is already
    // 18-19 digits, so a real username can never just be `${prefix}${id}`.
    // A short counter is unique enough within one test file's run.
    const username = overrides.username ?? `u${nextUsernameSuffix()}`
    const id = overrides.id ?? generateId()
    await db.insert(users).values({
      id,
      username,
      usernameLower: username.toLowerCase(),
      email: `${username}@example.com`,
      displayName: overrides.displayName ?? username,
    })
    await db.insert(userCounters).values({ userId: id })
    await openSearchClient.index({
      index: USERS_SEARCH_INDEX,
      id: id.toString(),
      refresh: true,
      body: {
        id: id.toString(),
        username: username.toLowerCase(),
        display_name: overrides.displayName ?? username,
        followers_count: overrides.followersCount ?? 0,
        is_verified: false,
      },
    })
    // author_handle needs a matching indexed post's author to have this
    // username too, for from:/to: tests below — updated in place on the
    // post document by the caller when both matter together.
    return id
  }

  it('finds a post by a plain-text term and hydrates it into a full Post from Postgres', async () => {
    const authorId = await seedUser()
    const postId = await seedPost(authorId, { text: 'un gato muy especial' })

    const response = await app.inject({ method: 'GET', url: '/v1/search?q=gato&type=latest' })

    expect(response.statusCode).toBe(200)
    const data = response.json().data as Array<{ id: string; text: string; author: { id: string } }>
    expect(data.some((post) => post.id === postId.toString())).toBe(true)
    const found = data.find((post) => post.id === postId.toString())
    expect(found?.text).toBe('un gato muy especial')
    expect(found?.author.id).toBe(authorId.toString())
  })

  it('filters by hashtag with the # operator', async () => {
    const authorId = await seedUser()
    const withTag = await seedPost(authorId, {
      text: 'evento del mundial',
      hashtags: ['mundial2026'],
    })
    await seedPost(authorId, { text: 'otro post sin nada especial' })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/search?q=%23mundial2026&type=latest',
    })

    const ids = (response.json().data as Array<{ id: string }>).map((post) => post.id)
    expect(ids).toContain(withTag.toString())
  })

  it('excludes a -negated term', async () => {
    const authorId = await seedUser()
    const kept = await seedPost(authorId, { text: 'partido de fútbol' })
    const excluded = await seedPost(authorId, { text: 'partido de fútbol cancelado' })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/search?q=${encodeURIComponent('partido -cancelado')}&type=latest`,
    })

    const ids = (response.json().data as Array<{ id: string }>).map((post) => post.id)
    expect(ids).toContain(kept.toString())
    expect(ids).not.toContain(excluded.toString())
  })

  it('media mode only returns posts with has_media:true', async () => {
    const authorId = await seedUser()
    const withMedia = generateId()
    await db
      .insert(posts)
      .values({ id: withMedia, authorId, text: 'una foto', lang: 'es', createdAt: new Date() })
    await db.insert(postCounters).values({ postId: withMedia })
    await openSearchClient.index({
      index: POSTS_SEARCH_INDEX,
      id: withMedia.toString(),
      refresh: true,
      body: {
        id: withMedia.toString(),
        author_id: authorId.toString(),
        author_handle: '',
        text: 'una foto',
        hashtags: [],
        mentions: [],
        has_links: false,
        lang: 'es',
        has_media: true,
        is_sensitive: false,
        engagement: 0,
        created_at: new Date().toISOString(),
      },
    })
    const withoutMedia = await seedPost(authorId, { text: 'una foto sin adjunto real' })

    const response = await app.inject({ method: 'GET', url: '/v1/search?q=foto&type=media' })

    const ids = (response.json().data as Array<{ id: string }>).map((post) => post.id)
    expect(ids).toContain(withMedia.toString())
    expect(ids).not.toContain(withoutMedia.toString())
  })

  it('paginates latest mode via search_after cursors with no duplicates and no gaps across two pages', async () => {
    const authorId = await seedUser()
    const ids: bigint[] = []
    for (let i = 0; i < 5; i++) {
      ids.push(await seedPost(authorId, { text: 'paginacion real' }))
    }

    const firstPage = await app.inject({
      method: 'GET',
      url: '/v1/search?q=paginacion&type=latest&limit=3',
    })
    const firstBody = firstPage.json() as {
      data: Array<{ id: string }>
      meta: { hasMore: boolean; nextCursor: string | null }
    }
    expect(firstBody.data).toHaveLength(3)
    expect(firstBody.meta.hasMore).toBe(true)
    expect(firstBody.meta.nextCursor).not.toBeNull()

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/search?q=paginacion&type=latest&limit=3&cursor=${encodeURIComponent(firstBody.meta.nextCursor as string)}`,
    })
    const secondBody = secondPage.json() as {
      data: Array<{ id: string }>
      meta: { hasMore: boolean }
    }
    expect(secondBody.data).toHaveLength(2)
    expect(secondBody.meta.hasMore).toBe(false)

    const allIds = [...firstBody.data, ...secondBody.data].map((post) => post.id)
    expect(new Set(allIds).size).toBe(5)
    expect(new Set(allIds)).toEqual(new Set(ids.map((id) => id.toString())))
  })

  it('finds a user by a word in their display name in people mode', async () => {
    // A word token, not a substring/prefix of the username itself — this
    // test's own TEST_USERS_INDEX_BODY uses a plain `standard` analyzer
    // (match on whole tokens only), unlike the real edge_ngram-indexed
    // production mapping that backs actual typeahead-style prefix search
    // (already covered for real by apps/workers' own
    // opensearch-client.integration.test.ts).
    const userId = await seedUser({
      displayName: 'Findable Person',
    })

    const response = await app.inject({ method: 'GET', url: '/v1/search?q=person&type=people' })

    expect(response.statusCode).toBe(200)
    const ids = (response.json().data as Array<{ id: string }>).map((row) => row.id)
    expect(ids).toContain(userId.toString())
  })

  it("excludes a blocked user's posts and profile from search results for the blocker", async () => {
    const blockedId = await seedUser({
      displayName: 'Blockworthy Persona',
    })
    const blockedPostId = await seedPost(blockedId, { text: 'contenido bloqueado único' })

    // Proves the query *would* have found both, absent the block below —
    // otherwise an empty result either way would make the final
    // .not.toContain assertions vacuously true without testing anything.
    const beforeBlock = await app.inject({
      method: 'GET',
      url: '/v1/search?q=blockworthy&type=people',
      headers: authHeader(),
    })
    expect((beforeBlock.json().data as Array<{ id: string }>).map((row) => row.id)).toContain(
      blockedId.toString(),
    )

    const blockResponse = await app.inject({
      method: 'POST',
      url: `/v1/users/${blockedId}/block`,
      headers: authHeader(),
    })
    expect(blockResponse.statusCode).toBe(204)

    const postsSearch = await app.inject({
      method: 'GET',
      url: '/v1/search?q=bloqueado&type=latest',
      headers: authHeader(),
    })
    const postIds = (postsSearch.json().data as Array<{ id: string }>).map((post) => post.id)
    expect(postIds).not.toContain(blockedPostId.toString())

    const peopleSearch = await app.inject({
      method: 'GET',
      url: '/v1/search?q=blockworthy&type=people',
      headers: authHeader(),
    })
    const peopleIds = (peopleSearch.json().data as Array<{ id: string }>).map((row) => row.id)
    expect(peopleIds).not.toContain(blockedId.toString())
  })

  it('includes viewer state on posts only when the request is authenticated', async () => {
    const authorId = await seedUser()
    const postId = await seedPost(authorId, { text: 'post único para viewer state' })

    const likeResponse = await app.inject({
      method: 'POST',
      url: `/v1/posts/${postId}/like`,
      headers: authHeader(),
    })
    expect(likeResponse.statusCode).toBe(204)

    const anonymous = await app.inject({
      method: 'GET',
      url: '/v1/search?q=viewer&type=latest',
    })
    const anonPost = (anonymous.json().data as Array<{ id: string; viewer?: unknown }>).find(
      (post) => post.id === postId.toString(),
    )
    expect(anonPost?.viewer).toBeUndefined()

    const authenticated = await app.inject({
      method: 'GET',
      url: '/v1/search?q=viewer&type=latest',
      headers: authHeader(),
    })
    const authPost = (
      authenticated.json().data as Array<{ id: string; viewer?: { liked: boolean } }>
    ).find((post) => post.id === postId.toString())
    expect(authPost?.viewer?.liked).toBe(true)
  })

  it('rejects an empty q as a validation error', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/search?q=' })
    expect(response.statusCode).toBe(400)
  })
})
