import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl } from '@x/db'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

describe('lists routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance

  async function registerAndLogin(username: string) {
    const email = `${username}@example.com`
    const password = `a unique passphrase for ${username} 7q`
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username, email, password, birthDate: '1990-01-01' },
    })
    const userId = registerResponse.json().data.id as string

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    })
    const accessToken = loginResponse.json().data.accessToken as string
    return { accessToken, userId }
  }

  async function createPost(accessToken: string, text: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { text },
    })
    expect(response.statusCode).toBe(201)
    return response.json().data as { id: string }
  }

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
      WORKER_ID: 5,
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
    }
    app = await buildApp(env)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  it('creates, fetches, updates, and deletes a list', async () => {
    const owner = await registerAndLogin('listowner1')

    const created = await app.inject({
      method: 'POST',
      url: '/v1/lists',
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { name: 'Noticias', description: 'Cuentas de noticias', isPrivate: false },
    })
    expect(created.statusCode).toBe(201)
    const list = created.json().data
    expect(list).toMatchObject({ name: 'Noticias', isPrivate: false, memberCount: 0 })

    const fetched = await app.inject({ method: 'GET', url: `/v1/lists/${list.id}` })
    expect(fetched.statusCode).toBe(200)
    expect(fetched.json().data.name).toBe('Noticias')

    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/lists/${list.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { name: 'Deportes' },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().data.name).toBe('Deportes')

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/lists/${list.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })
    expect(deleted.statusCode).toBe(204)

    const afterDelete = await app.inject({ method: 'GET', url: `/v1/lists/${list.id}` })
    expect(afterDelete.statusCode).toBe(404)
  })

  it("rejects a non-owner renaming or deleting someone else's list", async () => {
    const owner = await registerAndLogin('listowner2')
    const stranger = await registerAndLogin('liststranger2')

    const created = await app.inject({
      method: 'POST',
      url: '/v1/lists',
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { name: 'Mía', isPrivate: false },
    })
    const listId = created.json().data.id

    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/lists/${listId}`,
      headers: { authorization: `Bearer ${stranger.accessToken}` },
      payload: { name: 'Robada' },
    })
    expect(patch.statusCode).toBe(403)

    const remove = await app.inject({
      method: 'DELETE',
      url: `/v1/lists/${listId}`,
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(remove.statusCode).toBe(403)
  })

  it('adds and removes a member, rejecting a duplicate add', async () => {
    const owner = await registerAndLogin('listowner3')
    const member = await registerAndLogin('listmember3')

    const created = await app.inject({
      method: 'POST',
      url: '/v1/lists',
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { name: 'Con miembros', isPrivate: false },
    })
    const listId = created.json().data.id

    const added = await app.inject({
      method: 'POST',
      url: `/v1/lists/${listId}/members/${member.userId}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })
    expect(added.statusCode).toBe(204)

    const duplicate = await app.inject({
      method: 'POST',
      url: `/v1/lists/${listId}/members/${member.userId}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })
    expect(duplicate.statusCode).toBe(409)

    const afterAdd = await app.inject({ method: 'GET', url: `/v1/lists/${listId}` })
    expect(afterAdd.json().data.memberCount).toBe(1)

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/lists/${listId}/members/${member.userId}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })
    expect(removed.statusCode).toBe(204)

    const afterRemove = await app.inject({ method: 'GET', url: `/v1/lists/${listId}` })
    expect(afterRemove.json().data.memberCount).toBe(0)
  })

  it('hides a private list from everyone but its owner, in both GET /lists/:id and GET /users/:username/lists, and GET /timeline/list/:id reflects membership', async () => {
    const owner = await registerAndLogin('listowner4')
    const member = await registerAndLogin('listmember4')
    const stranger = await registerAndLogin('liststranger4')
    const post = await createPost(member.accessToken, 'un post del miembro de la lista')

    const created = await app.inject({
      method: 'POST',
      url: '/v1/lists',
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { name: 'Privada', isPrivate: true },
    })
    const listId = created.json().data.id
    await app.inject({
      method: 'POST',
      url: `/v1/lists/${listId}/members/${member.userId}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })

    const asStranger = await app.inject({
      method: 'GET',
      url: `/v1/lists/${listId}`,
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(asStranger.statusCode).toBe(404)

    const asOwner = await app.inject({
      method: 'GET',
      url: `/v1/lists/${listId}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })
    expect(asOwner.statusCode).toBe(200)

    const ownerLists = await app.inject({
      method: 'GET',
      url: '/v1/users/listowner4/lists',
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(ownerLists.json().data).toEqual([])

    const ownerListsAsOwner = await app.inject({
      method: 'GET',
      url: '/v1/users/listowner4/lists',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })
    expect(ownerListsAsOwner.json().data.map((l: { id: string }) => l.id)).toEqual([listId])

    const timelineAsStranger = await app.inject({
      method: 'GET',
      url: `/v1/timeline/list/${listId}`,
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(timelineAsStranger.statusCode).toBe(404)

    const timelineAsOwner = await app.inject({
      method: 'GET',
      url: `/v1/timeline/list/${listId}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })
    expect(timelineAsOwner.statusCode).toBe(200)
    expect(timelineAsOwner.json().data.map((p: { id: string }) => p.id)).toEqual([post.id])

    // Same fixture — muting a list member (ROADMAP.md 2.6/2.8) hides their
    // post from the list's timeline too, unlike bookmarks.
    const mute = await app.inject({
      method: 'POST',
      url: `/v1/users/${member.userId}/mute`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })
    expect(mute.statusCode).toBe(204)

    const timelineAfterMute = await app.inject({
      method: 'GET',
      url: `/v1/timeline/list/${listId}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })
    expect(timelineAfterMute.json().data).toEqual([])
  })
})
