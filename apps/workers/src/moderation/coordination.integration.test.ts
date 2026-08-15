import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import {
  type Database,
  createDatabase,
  migrationsFolderUrl,
  posts,
  refreshTokens,
  reports,
  userCounters,
  users,
} from '@x/db'
import { generateId } from '@x/utils'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCoordinationSweepWorker } from './coordination-sweep.worker.js'
import { createCoordinationRepository } from './coordination.repository.js'

describe('coordination detection (ROADMAP.md 3.3f)', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let db: Database
  let redis: Redis

  async function insertUser(prefix: string): Promise<bigint> {
    const id = generateId()
    const username = `${prefix}${id.toString().slice(-10)}`
    await db.insert(users).values({
      id,
      username,
      usernameLower: username.toLowerCase(),
      email: `${username}@example.com`,
      displayName: username,
    })
    await db.insert(userCounters).values({ userId: id })
    return id
  }

  async function insertPost(
    authorId: bigint,
    text: string,
    createdAt: Date,
    overrides: Partial<typeof posts.$inferInsert> = {},
  ): Promise<bigint> {
    const id = generateId()
    await db
      .insert(posts)
      .values({ id, authorId, conversationId: id, text, createdAt, ...overrides })
    return id
  }

  async function insertSession(userId: bigint, ipAddress: string): Promise<void> {
    await db.insert(refreshTokens).values({
      id: generateId(),
      userId,
      sessionId: generateId(),
      tokenHash: `hash-${generateId()}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ipAddress,
    })
  }

  async function findCoordinationReports() {
    return db.select().from(reports).where(eq(reports.category, 'coordinated_activity'))
  }

  beforeAll(async () => {
    ;[postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ])
    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })
    redis = new Redis(redisContainer.getConnectionUrl())
  }, 120_000)

  afterAll(async () => {
    redis.disconnect()
    await Promise.all([postgresContainer.stop(), redisContainer.stop()])
  })

  it('flags a real near-duplicate cluster from 3 distinct authors as a pending, system-generated report', async () => {
    const alice = await insertUser('coa')
    const bob = await insertUser('cob')
    const carol = await insertUser('coc')
    const now = new Date()
    const postA = await insertPost(alice, 'gana seguidores reales gratis, entra ya', now)
    const postB = await insertPost(bob, 'gana seguidores reales gratis, entra ya!', now)
    const postC = await insertPost(carol, 'gana seguidores reales gratis, entra ya 🔥', now)

    const repository = createCoordinationRepository(db)
    const worker = createCoordinationSweepWorker(repository, redis)
    const result = await worker.runSweepOnce()

    expect(result.postsFlagged).toBe(3)
    const flaggedReports = await findCoordinationReports()
    expect(flaggedReports).toHaveLength(3)
    const flaggedPostIds = flaggedReports.map((report) => report.targetId.toString()).sort()
    expect(flaggedPostIds).toEqual([postA, postB, postC].map(String).sort())
    for (const report of flaggedReports) {
      expect(report.reporterId).toBeNull()
      expect(report.status).toBe('pending')
      expect(report.targetType).toBe('post')
      expect(report.priority).toBeGreaterThan(0)
    }
  })

  it('does not flag unrelated posts from different authors, real DB round trip', async () => {
    const dave = await insertUser('cod')
    const erin = await insertUser('coe')
    const now = new Date()
    await insertPost(dave, 'mi gato durmió todo el día en la ventana de la cocina', now)
    await insertPost(erin, 'las elecciones municipales de este año estarán muy reñidas', now)

    const repository = createCoordinationRepository(db)
    const worker = createCoordinationSweepWorker(repository, redis)
    const result = await worker.runSweepOnce()

    // Only asserts *these two* authors produced nothing — the suite-wide
    // findCoordinationReports() count already grew in the test above, so
    // this checks the delta is zero via postsFlagged, not a fresh table.
    expect(result.postsFlagged).toBe(0)
  })

  it('flags a cluster spread outside the timing window when two authors share a session IP ("huella de red")', async () => {
    const frank = await insertUser('cof')
    const grace = await insertUser('cog')
    const heidi = await insertUser('coh')
    const sharedIp = '203.0.113.77'
    await insertSession(frank, sharedIp)
    await insertSession(heidi, sharedIp)
    await insertSession(grace, '198.51.100.20')

    const postF = await insertPost(
      frank,
      'compra ya tu entrada, quedan pocas disponibles hoy',
      new Date(Date.now() - 45 * 60 * 1000),
    )
    const postG = await insertPost(
      grace,
      'compra ya tu entrada, quedan pocas disponibles ahora',
      new Date(Date.now() - 20 * 60 * 1000),
    )
    const postH = await insertPost(
      heidi,
      'compra ya tu entrada, quedan pocas disponibles hoy!',
      new Date(),
    )

    const repository = createCoordinationRepository(db)
    const worker = createCoordinationSweepWorker(repository, redis)
    const result = await worker.runSweepOnce()

    expect(result.postsFlagged).toBe(3)
    const flaggedReports = await findCoordinationReports()
    const thisClusterReports = flaggedReports.filter((report) =>
      [postF, postG, postH].map(String).includes(report.targetId.toString()),
    )
    expect(thisClusterReports).toHaveLength(3)
    // coordination.repository.ts's own flagPostForReview writes the
    // corroborating signal into the free-text reason column — this is the
    // one real signal a moderator reading the queue can act on without
    // re-deriving it themselves.
    expect(thisClusterReports.every((report) => report.reason?.includes('network'))).toBe(true)
  })

  it('never re-flags a post already flagged by an earlier sweep tick', async () => {
    const ivan = await insertUser('coi')
    const judy = await insertUser('coj')
    const mallory = await insertUser('com')
    const now = new Date()
    await insertPost(ivan, 'suscríbete gratis al canal, link en la bio', now)
    await insertPost(judy, 'suscríbete gratis al canal, link en la bio!', now)
    await insertPost(mallory, 'suscríbete gratis al canal, link en la bio 🔥', now)

    const repository = createCoordinationRepository(db)
    const worker = createCoordinationSweepWorker(repository, redis)
    const first = await worker.runSweepOnce()
    const second = await worker.runSweepOnce()

    expect(first.postsFlagged).toBe(3)
    expect(second.postsFlagged).toBe(0) // same 3 posts, still inside the window, already claimed
  })
})
