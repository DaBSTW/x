/**
 * Seeds data for load-campaign.k6.js: one poster with real posts (read/like
 * targets), N reader users with a warmed Redis timeline (double as likers),
 * and W writer users (kept separate from readers so post-creation volume
 * never touches a reader's own trust-score history) — each with a signed
 * access token. Writes a JSON file k6 loads via SharedArray — not committed,
 * this is throwaway load-test fixture data, same pattern as
 * seed-timeline-load.ts (ROADMAP.md 1.3), deliberately not sharing that
 * script's own fixture file so 1.3's already-recorded results never depend
 * on anything this file does.
 *
 * Points at whatever DATABASE_URL/REDIS_URL are already set (defaults match
 * docker-compose.yml), so bring that stack up and migrate it first. Usage:
 *
 *   pnpm --filter @x/api exec tsx load-tests/seed-load-campaign.ts \
 *     [readerCount] [writerCount] [outFile]
 */
import { writeFile } from 'node:fs/promises'
import { createDatabase, userCounters, users } from '@x/db'
import { generateId, timelineKey } from '@x/utils'
import { Redis } from 'ioredis'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import { createPostsRepository } from '../src/modules/posts/posts.repository.js'
import { createPostsService } from '../src/modules/posts/posts.service.js'
import { createTokenService } from '../src/plugins/tokens.js'

const READER_COUNT = Number(process.argv[2] ?? 300)
const WRITER_COUNT = Number(process.argv[3] ?? 50)
const OUT_FILE = process.argv[4] ?? 'load-tests/.load-campaign-fixture.json'
// trust-score.ts's NEW_ACCOUNT_MAX_POSTS_PER_DAY (10, the real SPECS.md
// §12.3 ceiling, not overridden here) caps how many posts one fresh account
// can create — this script creates them all from a single poster, so 10 is
// this pool's ceiling too, not merely this script's own preference the way
// seed-timeline-load.ts's 20 was (written before that limit existed).
const POST_COUNT = 10

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

  console.info(`seeding 1 poster + ${POST_COUNT} posts (read/like targets)...`)
  const posterId = generateId()
  await db.insert(users).values({
    id: posterId,
    username: 'lcposter',
    usernameLower: 'lcposter',
    email: 'lcposter@example.com',
    displayName: 'Load Campaign Poster',
  })
  await db.insert(userCounters).values({ userId: posterId })
  const postsService = createPostsService(createPostsRepository(db))
  const postIds: string[] = []
  for (let i = 0; i < POST_COUNT; i++) {
    // post.id here is already the API-shaped Post DTO's string id (see
    // posts.service.ts's own mapping, `id: post.id.toString()`), not a raw
    // bigint — safe to JSON.stringify directly below, no .toString() needed.
    const post = await postsService.create(posterId, {
      text: `load campaign post #${i} #timeline`,
      replyPolicy: 'everyone',
      isSensitive: false,
    })
    postIds.push(post.id)
  }

  console.info(`seeding ${READER_COUNT} readers with a warm timeline...`)
  const readerTokens: string[] = []
  for (let i = 0; i < READER_COUNT; i++) {
    const readerId = generateId()
    await db.insert(users).values({
      id: readerId,
      username: `lcr${i.toString(36)}`,
      usernameLower: `lcr${i.toString(36)}`,
      email: `lcr${i}@example.com`,
      displayName: `Load Campaign Reader ${i}`,
    })
    await db.insert(userCounters).values({ userId: readerId })

    // Simulates a fan-out worker that already ran — no follow rows needed,
    // the read path only cares about the Redis ZSET.
    const key = timelineKey(readerId)
    const pipeline = redis.pipeline()
    for (const postId of postIds) pipeline.zadd(key, postId, postId)
    pipeline.expire(key, 7 * 24 * 60 * 60)
    await pipeline.exec()

    readerTokens.push(
      await tokenService.signAccessToken({
        sub: readerId.toString(),
        sid: generateId().toString(),
      }),
    )
  }

  // Kept separate from readers (rather than reusing reader tokens for posts
  // too) so the post_creates scenario's volume lands on its own dedicated
  // pool of accounts — trust-score.ts's NEW_ACCOUNT_MAX_POSTS_PER_DAY (10 by
  // default) is a real per-account anti-spam limit, not a test artifact, and
  // this directory's README documents raising it via env var for the
  // duration of a campaign run, same as 3.3e's own integration tests already
  // do — a fixed pool this campaign controls the size of makes that override
  // predictable instead of accidentally starving a scenario that happens to
  // share an identity with another one.
  console.info(`seeding ${WRITER_COUNT} writers...`)
  const writerTokens: string[] = []
  for (let i = 0; i < WRITER_COUNT; i++) {
    const writerId = generateId()
    await db.insert(users).values({
      id: writerId,
      username: `lcw${i.toString(36)}`,
      usernameLower: `lcw${i.toString(36)}`,
      email: `lcw${i}@example.com`,
      displayName: `Load Campaign Writer ${i}`,
    })
    await db.insert(userCounters).values({ userId: writerId })

    writerTokens.push(
      await tokenService.signAccessToken({
        sub: writerId.toString(),
        sid: generateId().toString(),
      }),
    )
  }

  await writeFile(
    OUT_FILE,
    JSON.stringify({ privateKeyPem, publicKeyPem, readerTokens, writerTokens, postIds }, null, 2),
  )
  console.info(
    `wrote ${readerTokens.length} reader + ${writerTokens.length} writer tokens, ` +
      `${postIds.length} post ids, and the matching JWT keypair to ${OUT_FILE}`,
  )

  redis.disconnect()
  // postgres-js keeps its connection pool open otherwise — same exit
  // strategy migrate.ts uses, this being a script rather than a service.
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
