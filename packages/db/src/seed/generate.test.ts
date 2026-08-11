import { describe, expect, it } from 'vitest'
import { generateSeedData } from './generate.js'

describe('generateSeedData', () => {
  it('generates the requested number of users and posts with no self-follows', async () => {
    const data = await generateSeedData(20, 100)

    expect(data.users).toHaveLength(20)
    expect(data.posts).toHaveLength(100)
    expect(data.userCounters).toHaveLength(20)
    expect(data.postCounters).toHaveLength(100)
    for (const follow of data.follows) {
      expect(follow.followerId).not.toBe(follow.followeeId)
    }
  })

  it('includes the fixed dev login account', async () => {
    const data = await generateSeedData(10, 10)

    const ana = data.users.find((user) => user.username === 'ana')
    expect(ana?.email).toBe('ana@example.com')
    expect(ana?.emailVerified).toBe(true)
  })

  it('assigns every user a unique, valid username', async () => {
    const data = await generateSeedData(50, 10)

    const usernames = data.users.map((user) => user.username)
    expect(new Set(usernames).size).toBe(usernames.length)
    for (const username of usernames) {
      expect(username).toMatch(/^[A-Za-z0-9_]{1,15}$/)
    }
  })

  it('keeps user_counters consistent with the generated follows and posts', async () => {
    const data = await generateSeedData(15, 60)

    const expectedFollowing = new Map<bigint, number>()
    const expectedFollowers = new Map<bigint, number>()
    for (const follow of data.follows) {
      expectedFollowing.set(follow.followerId, (expectedFollowing.get(follow.followerId) ?? 0) + 1)
      expectedFollowers.set(follow.followeeId, (expectedFollowers.get(follow.followeeId) ?? 0) + 1)
    }

    for (const counters of data.userCounters) {
      expect(counters.followingCount).toBe(expectedFollowing.get(counters.userId) ?? 0)
      expect(counters.followersCount).toBe(expectedFollowers.get(counters.userId) ?? 0)
    }
  })

  it('truncates post text to 280 code points', async () => {
    const data = await generateSeedData(10, 50)

    for (const post of data.posts) {
      if (post.text) {
        expect(Array.from(post.text).length).toBeLessThanOrEqual(280)
      }
    }
  })
})
