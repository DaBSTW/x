import type { Database } from '@x/db'
import { postCounters } from '@x/db'
import type { CounterValues } from '@x/utils'
import { eq, sql } from 'drizzle-orm'

export type CountersRepository = ReturnType<typeof createCountersRepository>

export function createCountersRepository(db: Database) {
  return {
    /** Redis is authoritative for the count itself — this is an absolute SET, not an increment (SPECS.md §4.4). */
    async flushCounters(postId: bigint, counters: CounterValues): Promise<void> {
      await db
        .update(postCounters)
        .set({
          likesCount: counters.likes,
          repostsCount: counters.reposts,
          repliesCount: counters.replies,
          quotesCount: counters.quotes,
          bookmarkCount: counters.bookmarks,
        })
        .where(eq(postCounters.postId, postId))
    },

    /**
     * Nightly reconciliation (SPECS.md §4.4): recomputes counters straight
     * from the source tables for posts with activity in the last 24h —
     * corrects any drift the 5s flush missed (a worker restart between
     * HINCRBY and flush, for example).
     */
    async reconcileRecentPosts(): Promise<void> {
      await db.execute(sql`
        with recent_posts as (
          select post_id from likes where created_at > now() - interval '24 hours'
          union
          select post_id from bookmarks where created_at > now() - interval '24 hours'
          union
          select repost_of_id as post_id from posts
            where kind = 'repost' and repost_of_id is not null and created_at > now() - interval '24 hours'
          union
          select in_reply_to_id as post_id from posts
            where kind = 'reply' and in_reply_to_id is not null and created_at > now() - interval '24 hours'
        )
        update post_counters pc set
          likes_count = (select count(*)::int from likes where post_id = pc.post_id),
          bookmark_count = (select count(*)::int from bookmarks where post_id = pc.post_id),
          reposts_count = (
            select count(*)::int from posts
            where repost_of_id = pc.post_id and kind = 'repost' and deleted_at is null
          ),
          replies_count = (
            select count(*)::int from posts
            where in_reply_to_id = pc.post_id and kind = 'reply' and deleted_at is null
          )
        from recent_posts
        where pc.post_id = recent_posts.post_id
      `)
    },
  }
}
