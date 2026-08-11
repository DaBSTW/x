import type { Post } from '@x/contracts'
import type { PostsService } from '../posts/posts.service.js'
import type { TimelineRepository } from './timeline.repository.js'

/** Timeline only ever needs to turn ids into posts, not the full PostsService surface. */
export type PostHydrator = Pick<PostsService, 'getManyByIds'>

/**
 * Batch viewer-state lookups (SPECS.md §5.4's `viewer` field). Optional:
 * without it the timeline still works, just without per-post like/repost/
 * bookmark state — see ROADMAP.md 1.4's note on why this isn't wired into
 * every post-producing endpoint, only here where the caller is already
 * guaranteed authenticated.
 */
export type ViewerStateLookup = {
  findLikedPostIds: (userId: bigint, postIds: bigint[]) => Promise<Set<bigint>>
  findBookmarkedPostIds: (userId: bigint, postIds: bigint[]) => Promise<Set<bigint>>
  findRepostedPostIds: (userId: bigint, postIds: bigint[]) => Promise<Set<bigint>>
}

/**
 * Backs mute filtering (ROADMAP.md 2.6) — deliberately only consulted here,
 * not threaded into PostHydrator like the block check above. Muting hides a
 * post from this passive, ambient feed only; visiting the muted account's
 * profile or a thread they posted in still shows their posts, same as real
 * X's own mute semantics.
 */
export type MuteLookup = {
  findMutedAuthorIds(viewerId: bigint, authorIds: bigint[]): Promise<Set<bigint>>
}

export type TimelineService = ReturnType<typeof createTimelineService>

export function createTimelineService(
  timelineRepository: TimelineRepository,
  postHydrator: PostHydrator,
  viewerState?: ViewerStateLookup,
  muteLookup?: MuteLookup,
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
    const pageIds = merged.slice(0, limit)
    // A block can outlive the fan-out entries it should have invalidated
    // (an old post fanned out before the block existed) — getManyByIds
    // drops those the same way it drops a deleted post (ROADMAP.md 2.6).
    const hydrated = await postHydrator.getManyByIds(pageIds, userId)
    const items = muteLookup ? await dropMuted(muteLookup, userId, hydrated) : hydrated

    if (!viewerState) return { items, hasMore }

    const ids = items.map((post) => BigInt(post.id))
    const [liked, bookmarked, reposted] = await Promise.all([
      viewerState.findLikedPostIds(userId, ids),
      viewerState.findBookmarkedPostIds(userId, ids),
      viewerState.findRepostedPostIds(userId, ids),
    ])
    const withViewer = items.map((post) => ({
      ...post,
      viewer: {
        liked: liked.has(BigInt(post.id)),
        bookmarked: bookmarked.has(BigInt(post.id)),
        reposted: reposted.has(BigInt(post.id)),
      },
    }))

    return { items: withViewer, hasMore }
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

async function dropMuted(muteLookup: MuteLookup, viewerId: bigint, items: Post[]): Promise<Post[]> {
  const authorIds = [...new Set(items.map((post) => BigInt(post.author.id)))]
  const muted = await muteLookup.findMutedAuthorIds(viewerId, authorIds)
  if (muted.size === 0) return items
  return items.filter((post) => !muted.has(BigInt(post.author.id)))
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
