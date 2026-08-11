import { faker } from '@faker-js/faker'
import { createSnowflakeGenerator, hashPassword } from '@x/utils'
import type { NewPost, NewPostCounters } from '../schema/posts.js'
import type { NewFollow } from '../schema/social-graph.js'
import type { NewUser, NewUserCounters } from '../schema/users.js'

export type SeedData = {
  users: NewUser[]
  userCounters: NewUserCounters[]
  follows: NewFollow[]
  posts: NewPost[]
  postCounters: NewPostCounters[]
}

const SEED_ACCOUNT_EMAIL = 'ana@example.com'
const SEED_ACCOUNT_PASSWORD = 'password123'

/**
 * Generates a deterministic, in-memory dev dataset: `userCount` users with a
 * realistic (non-uniform) follow graph, and `postCount` posts distributed
 * across them. Pure function — no I/O — so it's testable without a database.
 */
export async function generateSeedData(userCount = 50, postCount = 500): Promise<SeedData> {
  faker.seed(42)
  const ids = createSnowflakeGenerator(0)
  // Hashing is the expensive part of Argon2id by design; one shared hash for
  // every seed account keeps `pnpm db:seed` fast without weakening real auth.
  const sharedPasswordHash = await hashPassword(SEED_ACCOUNT_PASSWORD)

  const users: NewUser[] = []
  const userIds: bigint[] = []

  for (let i = 0; i < userCount; i++) {
    const id = ids.nextId()
    userIds.push(id)
    const isSeedAccount = i === 0
    const username = isSeedAccount
      ? 'ana'
      : `${faker.internet.username().replace(/[^A-Za-z0-9_]/g, '')}${i}`.slice(0, 15)

    users.push({
      id,
      username,
      usernameLower: username.toLowerCase(),
      email: isSeedAccount
        ? SEED_ACCOUNT_EMAIL
        : faker.internet.email({ provider: 'example.com' }).toLowerCase(),
      emailVerified: true,
      passwordHash: sharedPasswordHash,
      displayName: isSeedAccount ? 'Ana' : faker.person.fullName(),
      bio: faker.lorem.sentence({ min: 3, max: 12 }).slice(0, 160),
      location: faker.helpers.maybe(() => faker.location.city(), { probability: 0.6 }) ?? null,
      websiteUrl: faker.helpers.maybe(() => faker.internet.url(), { probability: 0.3 }) ?? null,
      isVerified: isSeedAccount || faker.datatype.boolean({ probability: 0.1 }),
      lang: faker.helpers.arrayElement(['es', 'en']),
    })
  }

  const follows = generateFollowGraph(userIds)
  const { posts, postCounters } = generatePosts(userIds, postCount, ids)
  const userCounters = computeUserCounters(userIds, follows, posts)

  return { users, userCounters, follows, posts, postCounters }
}

// Weighted so a handful of accounts end up with disproportionately more
// followers than the rest — a flat uniform graph doesn't exercise the
// celebrity fan-out threshold or timeline merge logic at all (SPECS.md §6.1).
function generateFollowGraph(userIds: bigint[]): NewFollow[] {
  const influencerCount = Math.max(1, Math.round(userIds.length * 0.1))
  const influencers = new Set(userIds.slice(0, influencerCount))
  const weightedPool = userIds.flatMap(
    (id) => Array(influencers.has(id) ? 8 : 1).fill(id) as bigint[],
  )

  const follows: NewFollow[] = []

  for (const followerId of userIds) {
    const targetCount = faker.number.int({ min: 5, max: Math.min(20, userIds.length - 1) })
    const followeeIds = new Set<bigint>()

    while (followeeIds.size < targetCount) {
      const candidate = faker.helpers.arrayElement(weightedPool)
      if (candidate !== followerId) followeeIds.add(candidate)
    }

    for (const followeeId of followeeIds) {
      follows.push({ followerId, followeeId, createdAt: recentTimestamp() })
    }
  }

  return follows
}

function generatePosts(
  userIds: bigint[],
  postCount: number,
  ids: ReturnType<typeof createSnowflakeGenerator>,
): { posts: NewPost[]; postCounters: NewPostCounters[] } {
  const posts: NewPost[] = []
  const postCounters: NewPostCounters[] = []

  for (let i = 0; i < postCount; i++) {
    const id = ids.nextId()
    const authorId = faker.helpers.arrayElement(userIds)
    // Defensive: truncate by code point, never by UTF-16 unit — CODESTYLE.md §3.
    const text = Array.from(faker.lorem.sentence({ min: 3, max: 30 }))
      .slice(0, 280)
      .join('')

    posts.push({
      id,
      authorId,
      kind: 'original',
      text,
      lang: faker.helpers.arrayElement(['es', 'en']),
      conversationId: id,
      createdAt: recentTimestamp(),
    })
    postCounters.push({ postId: id })
  }

  return { posts, postCounters }
}

// Posts land within the current partition regardless of when the seed runs —
// see docs/adr/0002-migraciones.md, only the current month is guaranteed to exist.
function recentTimestamp(): Date {
  const now = new Date()
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const maxOffsetMs = Math.min(now.getTime() - startOfMonth.getTime(), 72 * 60 * 60 * 1000)
  const offsetMs = faker.number.int({ min: 0, max: Math.max(0, maxOffsetMs) })
  return new Date(now.getTime() - offsetMs)
}

function computeUserCounters(
  userIds: bigint[],
  follows: NewFollow[],
  posts: NewPost[],
): NewUserCounters[] {
  const followersCount = new Map<bigint, number>()
  const followingCount = new Map<bigint, number>()
  const postsCount = new Map<bigint, number>()

  for (const follow of follows) {
    followingCount.set(follow.followerId, (followingCount.get(follow.followerId) ?? 0) + 1)
    followersCount.set(follow.followeeId, (followersCount.get(follow.followeeId) ?? 0) + 1)
  }
  for (const post of posts) {
    postsCount.set(post.authorId, (postsCount.get(post.authorId) ?? 0) + 1)
  }

  return userIds.map((userId) => ({
    userId,
    followersCount: followersCount.get(userId) ?? 0,
    followingCount: followingCount.get(userId) ?? 0,
    postsCount: postsCount.get(userId) ?? 0,
  }))
}
