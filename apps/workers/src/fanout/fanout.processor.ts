import type { RealtimeServerEvent } from '@x/contracts'
import type { FanoutJobData } from '@x/utils'
import {
  CELEBRITY_FOLLOWER_THRESHOLD,
  FANOUT_BATCH_SIZE,
  POST_AVAILABLE_EVENT,
  REALTIME_STREAM_FIELD_DATA,
  REALTIME_STREAM_FIELD_EVENT,
  REALTIME_STREAM_RETENTION_MS,
  TIMELINE_RETENTION_SIZE,
  TIMELINE_TTL_SECONDS,
  realtimeStreamKey,
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

    // A job can be retried after already *successfully* completing (worker
    // crash, or an upstream redelivery, between finishing the last batch
    // and the caller recording success) — checked up front so that retry
    // is a no-op instead of double-pushing every follower timeline.
    //
    // Marked done only at the very end (below), deliberately: this used to
    // claim the key up front with SET NX, before any of the real work
    // below ran. That turned a genuine failure (getFollowersCount, or
    // anything in the loop, rejecting) into a false "already done" on the
    // very next retry — kafka-consumer.ts's in-process retry loop calls
    // this function again for the same message, found the early claim
    // already in place, and returned success without ever redoing the
    // work, so the DLQ path this guard was never meant to interfere with
    // could never be reached. A plain existence check has no such failure
    // mode: it only ever reflects a run that actually finished.
    const processedKey = `fanout:processed:${data.postId}`
    if (await redis.exists(processedKey)) return

    const followersCount = await repository.getFollowersCount(authorId)
    if (followersCount >= CELEBRITY_FOLLOWER_THRESHOLD) {
      // Celebrity accounts skip write fan-out; readers merge their recent
      // posts in at read time instead (fan-out on read).
      await redis.set(processedKey, '1', 'EX', PROCESSED_TTL_SECONDS)
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

      const timelinePipeline = redis.pipeline()
      // A separate pipeline, not interleaved into the one above: each
      // XADD's Redis-assigned id becomes the event's eventId (below), and
      // that id isn't known until this pipeline's own exec() resolves —
      // one pipeline per followerIds[index] keeps that lookup a plain
      // index instead of arithmetic over a shared, interleaved result array.
      const streamPipeline = redis.pipeline()
      // MINID trim (SPECS.md §8.3: "retención 5 min") piggybacks on every
      // XADD instead of a separate sweep job — Redis prunes anything older
      // than this cutoff as part of the same write.
      const streamCutoffId = `${Date.now() - REALTIME_STREAM_RETENTION_MS}-0`

      for (const followerId of followerIds) {
        const key = timelineKey(followerId)
        timelinePipeline.zadd(key, postId.toString(), data.postId)
        timelinePipeline.zremrangebyrank(key, 0, -(TIMELINE_RETENTION_SIZE + 1))
        timelinePipeline.expire(key, TIMELINE_TTL_SECONDS)

        // "Badge de N posts nuevos" + lost-event recovery (ROADMAP.md 2.2,
        // SPECS.md §8.2/§8.3). The event's own type and data are stored
        // now; its `eventId` (the entry id Redis assigns) is filled in
        // below once this pipeline resolves, then PUBLISHed — so a client
        // replaying via XRANGE and one receiving it live always agree on
        // both the event's shape and its id.
        streamPipeline.xadd(
          realtimeStreamKey(timelineChannel(followerId)),
          'MINID',
          '~',
          streamCutoffId,
          '*',
          REALTIME_STREAM_FIELD_EVENT,
          POST_AVAILABLE_EVENT,
          REALTIME_STREAM_FIELD_DATA,
          JSON.stringify({ postId: data.postId }),
        )
      }

      const [, streamResults] = await Promise.all([timelinePipeline.exec(), streamPipeline.exec()])

      const publishPipeline = redis.pipeline()
      followerIds.forEach((followerId, index) => {
        const result = streamResults?.[index]
        // A per-follower XADD failure doesn't fail the whole batch — the
        // timeline itself is already correct via the ZADD above regardless
        // of whether the badge event ever gets published for this one.
        if (!result || result[0] !== null) return
        const eventId = result[1] as string

        const event: RealtimeServerEvent = {
          op: 'event',
          channel: timelineChannel(followerId),
          event: POST_AVAILABLE_EVENT,
          data: { postId: data.postId },
          eventId,
        }
        // PUBLISH to a channel with nobody subscribed (ws-gateway down, or
        // the follower simply not connected right now) is a Redis no-op,
        // never an error — live delivery is best-effort on top of the
        // durable XADD above, which is what reconnect recovery replays from.
        publishPipeline.publish(timelineChannel(followerId), JSON.stringify(event))
      })
      await publishPipeline.exec()

      if (followerIds.length < FANOUT_BATCH_SIZE) break
      afterId = followerIds.at(-1) ?? null
    }

    await redis.set(processedKey, '1', 'EX', PROCESSED_TTL_SECONDS)
  }
}
