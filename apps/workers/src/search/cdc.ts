import { cdcTopicName } from '@x/utils'
import JSONbig from 'json-bigint'

// Which column each watched table's flattened CDC payload carries the
// re-index target's id under, and which document type that id belongs to.
// posts/users are their own identity; post_counters/media/user_counters
// change independently of their parent row (post_counters.likes_count on
// every like, media.post_id once upload finishes) but SPECS.md §10.1 still
// wants their data (engagement, has_media, followers_count) reflected in
// the index, so all five have to be able to trigger a re-fetch.
const CDC_TABLES = {
  posts: { topic: cdcTopicName('posts'), idField: 'id', entity: 'post' },
  post_counters: { topic: cdcTopicName('post_counters'), idField: 'post_id', entity: 'post' },
  media: { topic: cdcTopicName('media'), idField: 'post_id', entity: 'post' },
  users: { topic: cdcTopicName('users'), idField: 'id', entity: 'user' },
  user_counters: { topic: cdcTopicName('user_counters'), idField: 'user_id', entity: 'user' },
} as const

/** Every topic the search indexer consumer needs to subscribe to (search-indexer.worker.ts). */
export const CDC_TOPICS: string[] = Object.values(CDC_TABLES).map((table) => table.topic)

const TOPIC_TO_TABLE = new Map(Object.values(CDC_TABLES).map((table) => [table.topic, table]))

export type CdcEntity = 'post' | 'user'

export type ParsedCdcMessage = {
  entity: CdcEntity
  id: bigint
}

// useNativeBigInt so every integer literal in the payload parses as a real
// bigint instead of a Number — Debezium's JSON converter serializes
// Postgres bigint columns as plain JSON numbers, and a snowflake id
// routinely exceeds Number's exact-integer range (2^53). The same class of
// precision loss already had to be solved for ClickHouse ingestion (see
// trends/clickhouse-client.ts) — verified there, and just as true here,
// that a JS Number silently rounds a snowflake id before it's usable.
const JSONbigNative = JSONbig({ useNativeBigInt: true, strict: false })

/**
 * Parses one Debezium CDC message down to just enough to know what to
 * re-index: which entity, which id. Deliberately does NOT surface
 * `__deleted` (the flag Debezium's `ExtractNewRecordState` SMT adds in
 * `delete.handling.mode: rewrite`) — search-indexer.worker.ts always
 * re-fetches the current row from Postgres for every touched id rather than
 * trusting the CDC payload as the document, so a delete needs no special
 * case: a soft-deleted or hard-deleted row simply isn't in the re-fetch
 * result, and "requested but missing" is already how the worker knows to
 * remove a document. That single rule covers every table here uniformly,
 * instead of reasoning about `__deleted` per table and risking a stale
 * signal from an out-of-order event across two of them landing in the same
 * batch.
 *
 * Returns null for anything this indexer doesn't need to act on: a topic it
 * doesn't recognize, the native tombstone Kafka Connect still emits after a
 * rewritten delete (a second, literally null-valued message — expected, not
 * an error), or a `media`/`post_counters` row not yet linked to a post
 * (`post_id` still null, e.g. an upload in progress).
 */
export function parseCdcMessage(topic: string, value: Buffer | null): ParsedCdcMessage | null {
  if (!value) return null
  const table = TOPIC_TO_TABLE.get(topic)
  if (!table) return null

  const parsed = JSONbigNative.parse(value.toString('utf8')) as Record<string, unknown>
  const rawId = parsed[table.idField]
  if (rawId === null || rawId === undefined) return null

  const id = typeof rawId === 'bigint' ? rawId : BigInt(String(rawId))
  return { entity: table.entity, id }
}
