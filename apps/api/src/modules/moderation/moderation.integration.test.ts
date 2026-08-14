import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { type Database, createDatabase, migrationsFolderUrl, users } from '@x/db'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

/** ROADMAP.md 3.3d's automatic layer runs detached from the request that published the content (posts.service.ts's own create() comment on why) — its own effects need a poll, not a bare assertion right after the response comes back. Same reasoning as every other genuinely-async waitFor in this codebase. */
async function waitFor<T>(check: () => Promise<T | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await check()
    if (result !== false) return result
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`waitFor: condition never became true within ${timeoutMs}ms`)
}

describe('moderation routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance
  let db: Database
  let mailpitApiUrl: string

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
    return {
      accessToken: loginResponse.json().data.accessToken as string,
      userId,
      email,
      password,
    }
  }

  /** isModerator (packages/db/src/schema/users.ts's own comment) has no API to set it — SQL only, the same first-admin problem any app with no public sign-up-as-admin path has. */
  async function makeModerator(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ isModerator: true })
      .where(eq(users.id, BigInt(userId)))
  }

  async function createPost(accessToken: string, text: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { text },
    })
    expect(response.statusCode).toBe(201)
    return response.json().data.id as string
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
    mailpitApiUrl = `http://${mailpitContainer.getHost()}:${mailpitContainer.getMappedPort(8025)}`

    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    const env: Env = {
      NODE_ENV: 'test',
      API_PORT: 0,
      WEB_URL: 'https://x.example.com',
      CORS_ORIGIN: 'http://localhost:3000',
      WORKER_ID: 9,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      // Placeholder — none of this file's tests exercise a Kafka-producing
      // route in a way that asserts on the message, so an unreachable
      // broker is fine (posts.service.ts already treats a produce failure
      // as non-fatal — ROADMAP.md 3.1).
      KAFKA_BROKERS: 'localhost:9092',
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
      // Query-time only search route — none of this file's tests exercise
      // /search, so a real reachable OpenSearch isn't needed to boot.
      OPENSEARCH_URL: 'http://localhost:9200',
      LOGIN_RATE_LIMIT_MAX: 100,
    }
    app = await buildApp(env)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  it('requires moderator access on every moderator-only route, 403 not 404', async () => {
    const alice = await registerAndLogin('alice_authz')
    const auth = { authorization: `Bearer ${alice.accessToken}` }

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/v1/moderation/reports', headers: auth }),
      app.inject({
        method: 'POST',
        url: '/v1/moderation/actions',
        headers: auth,
        payload: {
          targetType: 'user',
          targetId: alice.userId,
          action: 'suspend',
          reason: 'x',
          policy: 'x',
        },
      }),
      app.inject({ method: 'GET', url: '/v1/moderation/actions', headers: auth }),
      app.inject({ method: 'GET', url: '/v1/moderation/appeals', headers: auth }),
      app.inject({
        method: 'GET',
        url: `/v1/moderation/users/${alice.userId}/trust-score`,
        headers: auth,
      }),
    ])
    for (const response of responses) {
      expect(response.statusCode).toBe(403)
    }
  })

  it('reports a post, a moderator hides it, the author is emailed the fragment and an appeal link, and the report closes (SPECS.md §12)', async () => {
    const author = await registerAndLogin('mod_author')
    const reporter = await registerAndLogin('mod_reporter')
    const moderator = await registerAndLogin('mod_reviewer')
    await makeModerator(moderator.userId)
    const modAuth = { authorization: `Bearer ${moderator.accessToken}` }

    const postId = await createPost(author.accessToken, 'contenido reportable de verdad')

    const reportResponse = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { authorization: `Bearer ${reporter.accessToken}` },
      payload: { targetType: 'post', targetId: postId, category: 'harassment', reason: 'acoso' },
    })
    expect(reportResponse.statusCode).toBe(201)
    const reportId = reportResponse.json().data.id as string

    const queueResponse = await app.inject({
      method: 'GET',
      url: '/v1/moderation/reports',
      headers: modAuth,
    })
    expect(queueResponse.json().data.map((r: { id: string }) => r.id)).toContain(reportId)

    const actionResponse = await app.inject({
      method: 'POST',
      url: '/v1/moderation/actions',
      headers: modAuth,
      payload: {
        targetType: 'post',
        targetId: postId,
        action: 'hide',
        reason: 'acoso confirmado',
        policy: 'harassment',
        reportId,
      },
    })
    expect(actionResponse.statusCode).toBe(201)
    const actionId = actionResponse.json().data.id as string

    // The report is no longer in the pending queue.
    const queueAfter = await app.inject({
      method: 'GET',
      url: '/v1/moderation/reports',
      headers: modAuth,
    })
    expect(queueAfter.json().data.map((r: { id: string }) => r.id)).not.toContain(reportId)

    // Hidden from a third party...
    const strangerGet = await app.inject({ method: 'GET', url: `/v1/posts/${postId}` })
    expect(strangerGet.statusCode).toBe(404)
    // ...but still visible to its own author.
    const authorGet = await app.inject({
      method: 'GET',
      url: `/v1/posts/${postId}`,
      headers: { authorization: `Bearer ${author.accessToken}` },
    })
    expect(authorGet.statusCode).toBe(200)

    // SPECS.md §12.2: "notificación con el fragmento infractor y un enlace
    // para apelar" — the email, not the terse in-app event, is where both
    // live. Matched by subject (mailer.tsx's MODERATION_ACTION_COPY.hide),
    // not the in-body heading of the same name — Mailpit's own listing only
    // exposes the Subject header, not the body, for the first search.
    expect(await waitForEmail(mailpitApiUrl, 'Uno de tus posts fue ocultado', author.email)).toBe(
      true,
    )
    const body = await fetchEmailBody(mailpitApiUrl, 'Uno de tus posts fue ocultado', author.email)
    expect(body).toContain('contenido reportable de verdad')
    expect(body).toContain(`/moderation/actions/${actionId}/appeal`)

    // The author appeals, a (different) moderator resolves it.
    const appealResponse = await app.inject({
      method: 'POST',
      url: `/v1/moderation/actions/${actionId}/appeal`,
      headers: { authorization: `Bearer ${author.accessToken}` },
      payload: { userStatement: 'no fue acoso' },
    })
    expect(appealResponse.statusCode).toBe(201)
    const appealId = appealResponse.json().data.id as string

    // A second appeal on the same action is rejected.
    const secondAppeal = await app.inject({
      method: 'POST',
      url: `/v1/moderation/actions/${actionId}/appeal`,
      headers: { authorization: `Bearer ${author.accessToken}` },
      payload: {},
    })
    expect(secondAppeal.statusCode).toBe(409)

    const resolveResponse = await app.inject({
      method: 'PUT',
      url: `/v1/moderation/appeals/${appealId}`,
      headers: modAuth,
      payload: { status: 'overturned' },
    })
    expect(resolveResponse.statusCode).toBe(200)
    expect(resolveResponse.json().data.status).toBe('overturned')
  })

  it('suspending an account blocks its next login, and banning blocks it the same way (SPECS.md §12.2 "cuenta inaccesible")', async () => {
    const suspended = await registerAndLogin('mod_suspend')
    const banned = await registerAndLogin('mod_ban')
    const moderator = await registerAndLogin('mod_reviewer2')
    await makeModerator(moderator.userId)
    const modAuth = { authorization: `Bearer ${moderator.accessToken}` }

    await app.inject({
      method: 'POST',
      url: '/v1/moderation/actions',
      headers: modAuth,
      payload: {
        targetType: 'user',
        targetId: suspended.userId,
        action: 'suspend',
        reason: 'campaña de acoso',
        policy: 'harassment',
      },
    })
    await app.inject({
      method: 'POST',
      url: '/v1/moderation/actions',
      headers: modAuth,
      payload: {
        targetType: 'user',
        targetId: banned.userId,
        action: 'ban',
        reason: 'violación grave',
        policy: 'violence',
      },
    })

    const suspendedLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: suspended.email, password: suspended.password },
    })
    expect(suspendedLogin.statusCode).toBe(401)

    const bannedLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: banned.email, password: banned.password },
    })
    expect(bannedLogin.statusCode).toBe(401)
  })

  it('read_only blocks posting without touching login, and rejects an out-of-range duration (SPECS.md §12.2)', async () => {
    const restricted = await registerAndLogin('mod_readonly')
    const moderator = await registerAndLogin('mod_reviewer3')
    await makeModerator(moderator.userId)
    const modAuth = { authorization: `Bearer ${moderator.accessToken}` }

    const tooShort = await app.inject({
      method: 'POST',
      url: '/v1/moderation/actions',
      headers: modAuth,
      payload: {
        targetType: 'user',
        targetId: restricted.userId,
        action: 'read_only',
        reason: 'spam repetido',
        policy: 'spam',
        durationHours: 1,
      },
    })
    expect(tooShort.statusCode).toBe(400)

    const applied = await app.inject({
      method: 'POST',
      url: '/v1/moderation/actions',
      headers: modAuth,
      payload: {
        targetType: 'user',
        targetId: restricted.userId,
        action: 'read_only',
        reason: 'spam repetido',
        policy: 'spam',
        durationHours: 24,
      },
    })
    expect(applied.statusCode).toBe(201)

    // Still able to log in — SPECS.md's own wording is "no puede publicar", not "inaccesible".
    const stillLoginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: restricted.email, password: restricted.password },
    })
    expect(stillLoginResponse.statusCode).toBe(200)
    const restrictedToken = stillLoginResponse.json().data.accessToken as string

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${restrictedToken}` },
      payload: { text: 'intento publicar en modo lectura' },
    })
    expect(createResponse.statusCode).toBe(403)
  })

  it('auto-hides a post the toxicity classifier scores above 0.95, logged as a system-actioned moderation_actions row (ROADMAP.md 3.3d)', async () => {
    const author = await registerAndLogin('mod_auto_hide')
    const moderator = await registerAndLogin('mod_reviewer4')
    await makeModerator(moderator.userId)
    const modAuth = { authorization: `Bearer ${moderator.accessToken}` }

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${author.accessToken}` },
      payload: { text: 'ODIO MUERTE A TE VOY A MATAR!!!! ASCO DE PERSONAAAAA!!!!' },
    })
    expect(createResponse.statusCode).toBe(201)
    const postId = createResponse.json().data.id as string

    // The post is visible right after the response — the classifier runs
    // detached, so hiding it is a real (if usually fast) race, not instant.
    await waitFor(async () => {
      const response = await app.inject({ method: 'GET', url: `/v1/posts/${postId}` })
      return response.statusCode === 404
    })

    const actionsResponse = await app.inject({
      method: 'GET',
      url: `/v1/moderation/targets/post/${postId}/actions`,
      headers: modAuth,
    })
    expect(actionsResponse.statusCode).toBe(200)
    expect(actionsResponse.json().data).toContainEqual(
      expect.objectContaining({ action: 'hide', actorType: 'system', actorId: null }),
    )
  })

  it('queues a post the toxicity classifier scores between 0.70 and 0.95 for human review, without hiding it (ROADMAP.md 3.3d)', async () => {
    const author = await registerAndLogin('mod_auto_queue')
    const moderator = await registerAndLogin('mod_reviewer5')
    await makeModerator(moderator.userId)
    const modAuth = { authorization: `Bearer ${moderator.accessToken}` }

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${author.accessToken}` },
      payload: { text: 'ODIO ESTO tanto de verdad!!' },
    })
    expect(createResponse.statusCode).toBe(201)
    const postId = createResponse.json().data.id as string

    const queuedReport = await waitFor(async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/moderation/reports',
        headers: modAuth,
      })
      const match = (
        response.json().data as Array<{ targetId: string; reporterId: string | null }>
      ).find((report) => report.targetId === postId)
      return match ?? false
    })
    expect(queuedReport.reporterId).toBeNull()

    // Still fully visible — the 0.70–0.95 band queues for review, it
    // doesn't act on its own (SPECS.md §12.1).
    const stillThere = await app.inject({ method: 'GET', url: `/v1/posts/${postId}` })
    expect(stillThere.statusCode).toBe(200)
  })

  // This file (unlike posts.integration.test.ts) never raises
  // NEW_ACCOUNT_MAX_POSTS_PER_DAY in its env above, and every test here
  // registers its own fresh author — so, unlike that file's one long-lived
  // shared `poster`, these two tests exercise the real, unraised limit
  // (trust-score.ts's own default of 10) end to end rather than just
  // proving it doesn't get in the way.
  it("rejects a link in a brand-new account's first 24 hours, but allows the same account to post without one (ROADMAP.md 3.3e / SPECS.md §12.3)", async () => {
    const newcomer = await registerAndLogin('mod_new_link')

    const withLink = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${newcomer.accessToken}` },
      // A benign, non-malicious URL — posts.service.test.ts's own
      // checkMaliciousUrlsAgainstTestDomains fixture already establishes
      // example.com passes that check — so this isolates the new-account
      // link restriction from the unrelated malicious-URL check that
      // runs ahead of it in create().
      payload: { text: 'mira esto https://example.com/algo' },
    })
    expect(withLink.statusCode).toBe(403)

    const withoutLink = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${newcomer.accessToken}` },
      payload: { text: 'sin enlaces, esto sí debería publicarse' },
    })
    expect(withoutLink.statusCode).toBe(201)
  })

  it('caps a brand-new account at 10 posts/day, rejecting the 11th (ROADMAP.md 3.3e / SPECS.md §12.3)', async () => {
    const newcomer = await registerAndLogin('mod_new_cap')

    for (let i = 0; i < 10; i++) {
      await createPost(newcomer.accessToken, `post número ${i} de la cuenta nueva`)
    }

    const eleventh = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${newcomer.accessToken}` },
      payload: { text: 'este debería exceder el límite diario' },
    })
    expect(eleventh.statusCode).toBe(403)
  })

  it("a moderator can read a real account's trust score (ROADMAP.md 3.3e)", async () => {
    const target = await registerAndLogin('mod_trustee')
    const moderator = await registerAndLogin('mod_reviewer6')
    await makeModerator(moderator.userId)

    // trust-score.ts's own formula is already exercised value-by-value
    // against a fake repository in moderation.service.test.ts — this only
    // needs to prove the route wires a *real* users/userCounters/reports/
    // moderationActions join through computeTrustScore end to end.
    const response = await app.inject({
      method: 'GET',
      url: `/v1/moderation/users/${target.userId}/trust-score`,
      headers: { authorization: `Bearer ${moderator.accessToken}` },
    })
    expect(response.statusCode).toBe(200)
    const { score } = response.json().data as { score: number }
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })
})

type MailpitMessagesResponse = {
  messages: Array<{ ID: string; To: Array<{ Address: string }>; Subject: string }>
}
type MailpitMessageResponse = { HTML: string; Text: string }

/** Same helper as auth.integration.test.ts's own — duplicated rather than shared, CODESTYLE.md §7. */
async function waitForEmail(
  mailpitApiUrl: string,
  subjectContains: string,
  toAddress: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const listResponse = await fetch(`${mailpitApiUrl}/api/v1/messages`)
    const list = (await listResponse.json()) as MailpitMessagesResponse
    const found = list.messages.some(
      (candidate) =>
        candidate.Subject.includes(subjectContains) &&
        candidate.To.some((recipient) => recipient.Address === toAddress),
    )
    if (found) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

/** Same polling reasoning as waitForEmail — the fragment/appeal-link assertions need the actual body, not just "an email arrived". */
async function fetchEmailBody(
  mailpitApiUrl: string,
  subjectContains: string,
  toAddress: string,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const listResponse = await fetch(`${mailpitApiUrl}/api/v1/messages`)
    const list = (await listResponse.json()) as MailpitMessagesResponse
    const message = list.messages.find(
      (candidate) =>
        candidate.Subject.includes(subjectContains) &&
        candidate.To.some((recipient) => recipient.Address === toAddress),
    )
    if (message) {
      const detailResponse = await fetch(`${mailpitApiUrl}/api/v1/message/${message.ID}`)
      const detail = (await detailResponse.json()) as MailpitMessageResponse
      return detail.HTML || detail.Text
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`timed out waiting for an email with subject containing "${subjectContains}"`)
}
