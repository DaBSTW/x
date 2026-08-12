import type { RealtimeServerEvent } from '@x/contracts'
import type { FanoutJobData } from '@x/utils'
import {
  CELEBRITY_FOLLOWER_THRESHOLD,
  FANOUT_BATCH_SIZE,
  TIMELINE_RETENTION_SIZE,
  TIMELINE_TTL_SECONDS,
  generateId,
  timelineChannel,
  timelineKey,
} from '@x/utils'
import type { Redis } from 'ioredis'
import type { FanoutRepository } from './fanout.repository.js'

export type FanoutProcessorDeps = {
  repository: FanoutRepository
  redis: Redis
}

export type FanoutProcessor = (data: FanoutJobData) => Promise<void>

const PROCESSED_TTL_SECONDS = 24 * 60 * 60

/** Fan-out on write for non-celebrity authors — SPECS.md §6.1. */
export function createFanoutProcessor({ repository, redis }: FanoutProcessorDeps): FanoutProcessor {
  return async function processFanoutJob(data: FanoutJobData): Promise<void> {
    const postId = BigInt(data.postId)
    const authorId = BigInt(data.authorId)

    // A job can be retried after already completing (worker crash between
    // finishing the last batch and BullMQ recording success). SET NX makes
    // that retry a no-op instead of double-pushing every follower timeline.
    const claimed = await redis.set(
      `fanout:processed:${data.postId}`,
      '1',
      'EX',
      PROCESSED_TTL_SECONDS,
      'NX',
    )
    if (claimed === null) return

    const followersCount = await repository.getFollowersCount(authorId)
    if (followersCount >= CELEBRITY_FOLLOWER_THRESHOLD) {
      // Celebrity accounts skip write fan-out; readers merge their recent
      // posts in at read time instead (fan-out on read).
      return
    }

    let afterId: bigint | null = null
    for (;;) {
      const followerIds = await repository.listFollowerIdsBatch(
        authorId,
        afterId,
        FANOUT_BATCH_SIZE,
      )
      if (followerIds.length === 0) break

      const pipeline = redis.pipeline()
      for (const followerId of followerIds) {
        const key = timelineKey(followerId)
        pipeline.zadd(key, postId.toString(), data.postId)
        pipeline.zremrangebyrank(key, 0, -(TIMELINE_RETENTION_SIZE + 1))
        pipeline.expire(key, TIMELINE_TTL_SECONDS)

        // "Badge de N posts nuevos" (ROADMAP.md 2.2, SPECS.md §8.2) — best
        // effort: PUBLISH to a channel with nobody subscribed (ws-gateway
        // down, or the follower simply not connected right now) is a
        // Redis no-op, never an error, and the timeline itself is already
        // correct via the ZADD above regardless of whether this arrives.
        const event: RealtimeServerEvent = {
          op: 'event',
          channel: timelineChannel(followerId),
          event: 'post.available',
          data: { postId: data.postId },
          eventId: generateId().toString(),
        }
        pipeline.publish(timelineChannel(followerId), JSON.stringify(event))
      }
      await pipeline.exec()

      if (followerIds.length < FANOUT_BATCH_SIZE) break
      afterId = followerIds.at(-1) ?? null
    }
  }
}
