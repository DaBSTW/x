import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, media, migrationsFolderUrl } from '@x/db'
import { MEDIA_STATUS, generateId } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

describe('profiles routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance
  let aliceToken: string
  let aliceId: bigint

  beforeAll(async () => {
    ;[postgresContainer, redisContainer, mailpitContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      new GenericContainer('axllent/mailpit:latest')
        .withExposedPorts(1025, 8025)
        .withWaitStrategy(Wait.forListeningPorts())
        .start(),
    ])

    const migrationDb = createDatabase(postgresContainer.getConnectionUri())
    await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    const env: Env = {
      NODE_ENV: 'test',
      API_PORT: 0,
      WEB_URL: 'http://localhost:3000',
      CORS_ORIGIN: 'http://localhost:3000',
      WORKER_ID: 6,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: mailpitContainer.getHost(),
      SMTP_PORT: mailpitContainer.getMappedPort(1025),
      MAIL_FROM: 'no-reply@x.example.com',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'x-media',
      S3_ACCESS_KEY_ID: 'x-minio',
      S3_SECRET_ACCESS_KEY: 'x-minio-secret',
      S3_FORCE_PATH_STYLE: true,
      // Query-time only search route — none of this file's tests exercise /search,
      // so a real reachable OpenSearch isn't needed for the app to boot.
      OPENSEARCH_URL: 'http://localhost:9200',
    }
    app = await buildApp(env)

    const register = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'alice',
        email: 'alice@example.com',
        password: 'a unique passphrase for alice 7q',
        birthDate: '1990-01-01',
      },
    })
    aliceId = BigInt(register.json().data.id)
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'alice@example.com', password: 'a unique passphrase for alice 7q' },
    })
    aliceToken = login.json().data.accessToken
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  it('returns a public profile with zeroed counters for a fresh user', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/alice' })

    expect(response.statusCode).toBe(200)
    const profile = response.json().data
    expect(profile.username).toBe('alice')
    expect(profile.counters).toEqual({ followers: 0, following: 0, posts: 0 })
  })

  it('GET /users/me returns the authenticated user, not a user literally named "me"', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.username).toBe('alice')
  })

  it('GET /users/me requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/me' })
    expect(response.statusCode).toBe(401)
  })

  it('is case-insensitive on username', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/ALICE' })
    expect(response.statusCode).toBe(200)
  })

  it('returns 404 for an unknown username', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/ghost-user' })
    expect(response.statusCode).toBe(404)
  })

  it('reflects a post in the counters, and its deletion', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { text: 'hola' },
    })
    const postId = created.json().data.id

    const afterCreate = await app.inject({ method: 'GET', url: '/v1/users/alice' })
    expect(afterCreate.json().data.counters.posts).toBe(1)

    await app.inject({
      method: 'DELETE',
      url: `/v1/posts/${postId}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    })

    const afterDelete = await app.inject({ method: 'GET', url: '/v1/users/alice' })
    expect(afterDelete.json().data.counters.posts).toBe(0)
  })

  it('updates the authenticated user’s own profile', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { bio: 'hola, soy alice', location: 'Madrid' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({ bio: 'hola, soy alice', location: 'Madrid' })

    const fetched = await app.inject({ method: 'GET', url: '/v1/users/alice' })
    expect(fetched.json().data.bio).toBe('hola, soy alice')
  })

  it('requires authentication to update a profile', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      payload: { bio: 'x' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('resolves avatarMediaId to a real URL and persists it', async () => {
    const mediaId = generateId()
    await app.db.insert(media).values({
      id: mediaId,
      ownerId: aliceId,
      storageKey: `media/${mediaId}/original.webp`,
      mimeType: 'image/webp',
      sizeBytes: 100n,
      variants: [{ width: 400, height: 400, format: 'webp', key: `media/${mediaId}/400.webp` }],
      status: MEDIA_STATUS.READY,
    })

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { avatarMediaId: mediaId.toString() },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.avatarUrl).toContain('400.webp')

    const fetched = await app.inject({ method: 'GET', url: '/v1/users/alice' })
    expect(fetched.json().data.avatarUrl).toContain('400.webp')
  })

  it('rejects a bannerMediaId that belongs to someone else', async () => {
    const otherRegister = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'notalice',
        email: 'notalice@example.com',
        password: 'a unique passphrase, not alice 3z',
        birthDate: '1990-01-01',
      },
    })
    const otherId = BigInt(otherRegister.json().data.id)

    const mediaId = generateId()
    await app.db.insert(media).values({
      id: mediaId,
      ownerId: otherId,
      storageKey: `media/${mediaId}/original.webp`,
      mimeType: 'image/webp',
      sizeBytes: 100n,
      status: MEDIA_STATUS.READY,
    })

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { bannerMediaId: mediaId.toString() },
    })

    expect(response.statusCode).toBe(400)
  })

  // ROADMAP.md 1.6/1.4: viewer.following, deferred from 1.4's GET
  // /posts/:id note for the same "needs optional auth" reason — GET
  // /users/:username now carries optionalAuth too.
  it('exposes viewer.following only for an authenticated, non-self caller', async () => {
    const bobRegister = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'bobprofile',
        email: 'bobprofile@example.com',
        password: 'a unique passphrase for bob 9x',
        birthDate: '1990-01-01',
      },
    })
    expect(bobRegister.statusCode).toBe(201)
    const bobLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'bobprofile@example.com', password: 'a unique passphrase for bob 9x' },
    })
    const bobToken = bobLogin.json().data.accessToken

    // Anonymous: no viewer field at all, not viewer: {following: false, ...}.
    const anonymous = await app.inject({ method: 'GET', url: '/v1/users/alice' })
    expect(anonymous.json().data.viewer).toBeUndefined()

    // Signed in, not yet following: both false, not simply absent.
    const beforeFollow = await app.inject({
      method: 'GET',
      url: '/v1/users/alice',
      headers: { authorization: `Bearer ${bobToken}` },
    })
    expect(beforeFollow.json().data.viewer).toEqual({ following: false, requested: false })

    const follow = await app.inject({
      method: 'POST',
      url: `/v1/users/${aliceId}/follow`,
      headers: { authorization: `Bearer ${bobToken}` },
    })
    expect(follow.json().data.status).toBe('following')

    const afterFollow = await app.inject({
      method: 'GET',
      url: '/v1/users/alice',
      headers: { authorization: `Bearer ${bobToken}` },
    })
    expect(afterFollow.json().data.viewer).toEqual({ following: true, requested: false })

    // Alice viewing her own profile: never "following myself".
    const self = await app.inject({
      method: 'GET',
      url: '/v1/users/alice',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(self.json().data.viewer).toBeUndefined()
  })

  it('reports viewer.requested for a pending request against a protected account, without viewer.following', async () => {
    const protect = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { isProtected: true },
    })
    expect(protect.statusCode).toBe(200)

    const carolRegister = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'carolprofile',
        email: 'carolprofile@example.com',
        password: 'a unique passphrase for carol 4y',
        birthDate: '1990-01-01',
      },
    })
    expect(carolRegister.statusCode).toBe(201)
    const carolLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'carolprofile@example.com', password: 'a unique passphrase for carol 4y' },
    })
    const carolToken = carolLogin.json().data.accessToken

    const followRequest = await app.inject({
      method: 'POST',
      url: `/v1/users/${aliceId}/follow`,
      headers: { authorization: `Bearer ${carolToken}` },
    })
    expect(followRequest.json().data.status).toBe('requested')

    const profile = await app.inject({
      method: 'GET',
      url: '/v1/users/alice',
      headers: { authorization: `Bearer ${carolToken}` },
    })
    expect(profile.json().data.viewer).toEqual({ following: false, requested: true })
  })
})
