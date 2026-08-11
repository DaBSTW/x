/**
 * ROADMAP.md 1.3: "fan-out de cuenta con 100k seguidores completa en < 5s".
 *
 * Not a k6 script — the acceptance criterion is about the fan-out worker's
 * own throughput against real Postgres + Redis, not HTTP, so it drives
 * createFanoutProcessor directly. Spins up disposable Testcontainers, seeds
 * one author with FOLLOWER_COUNT followers, times a single post's fan-out,
 * and tears everything down. Not part of `test:integration` — 100k rows is
 * too slow to pay on every CI run — invoke manually:
 *
 *   pnpm --filter @x/workers exec tsx load-tests/fanout-scale.ts [followerCount]
 */
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import {
  type Database,
  createDatabase,
  follows,
  migrationsFolderUrl,
  userCounters,
  users,
} from '@x/db'
import { generateId, timelineKey } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Redis } from 'ioredis'
import { createFanoutProcessor } from '../src/fanout/fanout.processor.js'
import { createFanoutRepository } from '../src/fanout/fanout.repository.js'

const FOLLOWER_COUNT = Number(process.argv[2] ?? 100_000)
const BUDGET_MS = 5_000
const INSERT_BATCH_SIZE = 5_000

async function seedFollowers(db: Database, authorId: bigint, count: number): Promise<bigint> {
  let firstFollowerId: bigint | null = null

  for (let batchStart = 0; batchStart < count; batchStart += INSERT_BATCH_SIZE) {
    const batchSize = Math.min(INSERT_BATCH_SIZE, count - batchStart)
    const followerIds = Array.from({ length: batchSize }, () => generateId())
    firstFollowerId ??= followerIds[0] ?? null

    await db.insert(users).values(
      followerIds.map((id, i) => ({
        id,
        username: `lt${(batchStart + i).toString(36)}`,
        usernameLower: `lt${(batchStart + i).toString(36)}`,
        email: `lt${batchStart + i}@example.com`,
        displayName: `Load Test Follower ${batchStart + i}`,
      })),
    )
    await db.insert(userCounters).values(followerIds.map((userId) => ({ userId })))
    await db
      .insert(follows)
      .values(followerIds.map((followerId) => ({ followerId, followeeId: authorId })))
  }

  if (firstFollowerId === null) throw new Error('followerCount must be > 0')
  return firstFollowerId
}

async function main(): Promise<void> {
  console.info(`seeding 1 author + ${FOLLOWER_COUNT} followers...`)

  const [postgresContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ])
  const db = createDatabase(postgresContainer.getConnectionUri())
  await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })
  const redis = new Redis(redisContainer.getConnectionUrl())

  const authorId = generateId()
  await db.insert(users).values({
    id: authorId,
    username: 'loadtest_author',
    usernameLower: 'loadtest_author',
    email: 'loadtest_author@example.com',
    displayName: 'Load Test Author',
  })
  // Deliberately NOT set to FOLLOWER_COUNT: by SPECS.md §6.1's own celebrity
  // threshold, a real 100k-follower account would already be flagged and
  // would skip write fan-out entirely (a separate, already-covered
  // correctness test — fanout.integration.test.ts). This benchmark isolates
  // the write path's raw throughput from that business rule on purpose.
  await db.insert(userCounters).values({ userId: authorId, followersCount: 0 })

  const seedStart = Date.now()
  const sampleFollowerId = await seedFollowers(db, authorId, FOLLOWER_COUNT)
  console.info(`seed complete in ${Date.now() - seedStart}ms`)

  const repository = createFanoutRepository(db)
  const processFanoutJob = createFanoutProcessor({ repository, redis })
  const postId = generateId()

  const fanoutStart = Date.now()
  await processFanoutJob({ postId: postId.toString(), authorId: authorId.toString() })
  const elapsedMs = Date.now() - fanoutStart

  const pushed = await redis.zscore(timelineKey(sampleFollowerId), postId.toString())
  console.info(
    `fan-out to ${FOLLOWER_COUNT} followers took ${elapsedMs}ms (budget: ${BUDGET_MS}ms)`,
  )
  console.info(`sample follower timeline received the post: ${pushed !== null}`)

  redis.disconnect()
  await Promise.all([postgresContainer.stop(), redisContainer.stop()])

  if (elapsedMs > BUDGET_MS) {
    console.error(`FAIL: fan-out took ${elapsedMs}ms, over the ${BUDGET_MS}ms budget`)
    process.exitCode = 1
  } else if (pushed === null) {
    console.error('FAIL: sample follower timeline was not updated')
    process.exitCode = 1
  } else {
    console.info('PASS')
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
