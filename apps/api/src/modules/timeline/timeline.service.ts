import type { Post } from '@x/contracts'
import type { PostsService } from '../posts/posts.service.js'
import type { TimelineRepository } from './timeline.repository.js'

/** Timeline only ever needs to turn ids into posts, not the full PostsService surface. */
export type PostHydrator = Pick<PostsService, 'getManyByIds'>

export type TimelineService = ReturnType<typeof createTimelineService>

export function createTimelineService(
  timelineRepository: TimelineRepository,
  postHydrator: PostHydrator,
) {
  async function getHome(
    userId: bigint,
    limit: number,
    cursor: bigint | null,
  ): Promise<{ items: Post[]; hasMore: boolean }> {
    // Over-fetch by one from each source so a full merged page reliably
    // means "there's more", the same convention posts.service.ts uses.
    const overfetch = limit + 1
    const [precomputedIds, celebrityIds] = await Promise.all([
      resolvePrecomputedIds(timelineRepository, userId, overfetch, cursor),
      timelineRepository.listRecentFromCelebrityFollowees(userId, overfetch, cursor),
    ])

    const merged = mergeDescendingUnique(precomputedIds, celebrityIds)
    const hasMore = merged.length > limit
    const items = await postHydrator.getManyByIds(merged.slice(0, limit))

    return { items, hasMore }
  }

  return { getHome }
}

async function resolvePrecomputedIds(
  repository: TimelineRepository,
  userId: bigint,
  limit: number,
  cursor: bigint | null,
): Promise<bigint[]> {
  const ids = await repository.readPrecomputed(userId, limit, cursor)
  if (ids.length > 0 || (await repository.timelineExists(userId))) return ids

  // Empty AND missing entirely: a cold timeline (SPECS.md §6.1), not a user
  // with nothing to show. Rebuild it from Postgres before giving up.
  const rebuilt = await repository.reconstructFromPostgres(userId)
  const page = cursor === null ? rebuilt : rebuilt.filter((id) => id < cursor)
  return page.slice(0, limit)
}

/** SPECS.md §6.1's `merge_by_id`: two id lists, each already newest-first, combined and deduplicated the same way. */
function mergeDescendingUnique(a: bigint[], b: bigint[]): bigint[] {
  const seen = new Set<bigint>()
  const result: bigint[] = []
  for (const id of [...a, ...b].sort((x, y) => (x > y ? -1 : x < y ? 1 : 0))) {
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}
