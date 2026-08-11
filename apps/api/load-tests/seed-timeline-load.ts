/**
 * Seeds data for timeline-home.k6.js: one poster with real posts, N reader
 * users with a warmed Redis timeline, and a signed access token per reader.
 * Writes a JSON file k6 loads via SharedArray — not committed, this is
 * throwaway load-test fixture data.
 *
 * Points at whatever DATABASE_URL/REDIS_URL are already set (defaults match
 * docker-compose.yml), so bring that stack up and migrate it first. Usage:
 *
 *   pnpm --filter @x/api exec tsx load-tests/seed-timeline-load.ts \
 *     [readerCount] [outFile]
 */
import { writeFile } from 'node:fs/promises'
import { createDatabase, userCounters, users } from '@x/db'
import { generateId, timelineKey } from '@x/utils'
import { Redis } from 'ioredis'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import { createPostsRepository } from '../src/modules/posts/posts.repository.js'
import { createPostsService } from '../src/modules/posts/posts.service.js'
import { createTokenService } from '../src/plugins/tokens.js'

const READER_COUNT = Number(process.argv[2] ?? 100)
const OUT_FILE = process.argv[3] ?? 'load-tests/.timeline-load-fixture.json'
const POST_COUNT = 20

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://x:x@localhost:5432/x'
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const db = createDatabase(databaseUrl)
  const redis = new Redis(redisUrl)

  // A fixed keypair shared with the API process this fixture is meant to
  // run against — see the "start the API" step in this directory's README.
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const [privateKeyPem, publicKeyPem] = await Promise.all([
    exportPKCS8(privateKey),
    exportSPKI(publicKey),
  ])
  const tokenService = await createTokenService({
    privateKeyPem,
    publicKeyPem,
    accessTtlMinutes: 60,
  })

  console.info(`seeding 1 poster + ${POST_COUNT} posts...`)
  const posterId = generateId()
  await db.insert(users).values({
    id: posterId,
    username: 'ltposter',
    usernameLower: 'ltposter',
    email: 'ltposter@example.com',
    displayName: 'Load Test Poster',
  })
  await db.insert(userCounters).values({ userId: posterId })
  const postsService = createPostsService(createPostsRepository(db))
  const postIds: string[] = []
  for (let i = 0; i < POST_COUNT; i++) {
    const post = await postsService.create(posterId, {
      text: `load test post #${i} #timeline`,
      replyPolicy: 'everyone',
      isSensitive: false,
    })
    postIds.push(post.id)
  }

  console.info(`seeding ${READER_COUNT} readers with a warm timeline...`)
  const tokens: string[] = []
  for (let i = 0; i < READER_COUNT; i++) {
    const readerId = generateId()
    await db.insert(users).values({
      id: readerId,
      username: `ltr${i.toString(36)}`,
      usernameLower: `ltr${i.toString(36)}`,
      email: `ltr${i}@example.com`,
      displayName: `Load Test Reader ${i}`,
    })
    await db.insert(userCounters).values({ userId: readerId })

    // Simulates a fan-out worker that already ran — no follow rows needed,
    // the read path only cares about the Redis ZSET.
    const key = timelineKey(readerId)
    const pipeline = redis.pipeline()
    for (const postId of postIds) pipeline.zadd(key, postId, postId)
    pipeline.expire(key, 7 * 24 * 60 * 60)
    await pipeline.exec()

    tokens.push(
      await tokenService.signAccessToken({
        sub: readerId.toString(),
        sid: generateId().toString(),
      }),
    )
  }

  await writeFile(OUT_FILE, JSON.stringify({ privateKeyPem, publicKeyPem, tokens }, null, 2))
  console.info(`wrote ${tokens.length} tokens + the matching JWT keypair to ${OUT_FILE}`)

  redis.disconnect()
  // postgres-js keeps its connection pool open otherwise — same exit
  // strategy migrate.ts uses, this being a script rather than a service.
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
