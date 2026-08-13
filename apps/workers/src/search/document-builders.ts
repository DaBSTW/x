import { parseEntities } from '@x/utils'

// Mirrors SPECS.md §10.1's `posts` mapping (opensearch-client.ts's
// POSTS_INDEX_BODY) field for field. Every id is a string, never the bigint
// it's sourced from — the OpenSearch client JSON-serializes this object to
// build the request body, and `JSON.stringify` throws on a raw bigint.
export type PostDocument = {
  id: string
  author_id: string
  author_handle: string
  text: string
  hashtags: string[]
  mentions: string[]
  has_links: boolean
  lang: string | null
  has_media: boolean
  is_sensitive: boolean
  engagement: number
  created_at: string
}

export type PostDocumentInput = {
  id: bigint
  authorId: bigint
  /** '' when the author row wasn't found in the same re-fetch (shouldn't happen — author_id is NOT NULL — but never let a lookup gap crash indexing). Case doesn't matter here — buildPostDocument lowercases it. */
  authorHandle: string
  text: string | null
  lang: string | null
  isSensitive: boolean
  hasMedia: boolean
  createdAt: Date
  counters: PostEngagementCounters | null
}

export type PostEngagementCounters = {
  likesCount: number
  repostsCount: number
  repliesCount: number
  quotesCount: number
}

/**
 * Builds the posts index document from an already-joined row. Hashtags and
 * mentions come from re-parsing `text` with the same `parseEntities` posts
 * creation itself uses (posts.service.ts) to populate `post_entities` —
 * posts here are never edited after creation, so recomputing from `text` is
 * exactly equivalent to reading `post_entities`, without the CDC connector
 * needing to watch a sixth table just for this.
 */
export function buildPostDocument(input: PostDocumentInput): PostDocument {
  const entities = parseEntities(input.text ?? '')
  const hashtags = entities
    .filter((entity) => entity.kind === 'hashtag')
    .map((entity) => entity.value)
  // Lowercased against usernameLower's own convention (packages/db/src/schema/users.ts)
  // — mentions are case-insensitive everywhere else in this app, and an
  // exact-match `keyword` field needs one canonical case to be queryable at all.
  const mentions = entities
    .filter((entity) => entity.kind === 'mention')
    .map((entity) => entity.value.toLowerCase())
  const hasLinks = entities.some((entity) => entity.kind === 'url')

  return {
    id: input.id.toString(),
    author_id: input.authorId.toString(),
    // Same reasoning as mentions above — author_handle is a `keyword`
    // field, `from:`/`to:` filter against it case-insensitively
    // (query-operators.ts lowercases whatever the searcher typed), so both
    // sides need to agree on one case. The *displayed* username always
    // comes from Postgres hydration afterward (search.service.ts), never
    // from this index, so lowercasing it here loses nothing.
    author_handle: input.authorHandle.toLowerCase(),
    text: input.text ?? '',
    hashtags,
    mentions,
    has_links: hasLinks,
    lang: input.lang,
    has_media: input.hasMedia,
    is_sensitive: input.isSensitive,
    engagement: computeEngagement(input.counters),
    created_at: input.createdAt.toISOString(),
  }
}

// SPECS.md §10.1 names `engagement` as a function_score ranking input
// without defining its formula — the same "names it, doesn't define the
// internals" gap as the `multilang` analyzer (opensearch-client.ts). A
// straightforward sum of the interaction counts that reflect someone
// actively engaging with the post is the simplest defensible reading.
// Bookmarks are deliberately excluded — a private signal, never a public
// one (SPECS.md §4.2 never exposes a bookmark count on a post) — and so is
// viewsCount, whose own column comment already says "synced from ClickHouse
// in phase 3": always 0 today, not a real signal yet.
export function computeEngagement(counters: PostEngagementCounters | null): number {
  if (!counters) return 0
  return counters.likesCount + counters.repostsCount + counters.repliesCount + counters.quotesCount
}

// Mirrors SPECS.md §10.1's `users` mapping (opensearch-client.ts's USERS_INDEX_BODY).
export type UserDocument = {
  id: string
  username: string
  display_name: string
  followers_count: number
  is_verified: boolean
}

export type UserDocumentInput = {
  id: bigint
  username: string
  displayName: string
  isVerified: boolean
  /** null when user_counters has no row yet (shouldn't happen post-registration, but treated as 0 rather than crashing). */
  followersCount: number | null
}

export function buildUserDocument(input: UserDocumentInput): UserDocument {
  return {
    id: input.id.toString(),
    username: input.username,
    display_name: input.displayName,
    followers_count: input.followersCount ?? 0,
    is_verified: input.isVerified,
  }
}
