import { Client } from '@opensearch-project/opensearch'
import { POSTS_SEARCH_INDEX, USERS_SEARCH_INDEX } from '@x/utils'

export type OpenSearchConfig = {
  url: string
}

export function createOpenSearchClient(config: OpenSearchConfig): Client {
  return new Client({ node: config.url })
}

// SPECS.md §10.1's own mapping is verbatim below for `posts` — `analyzer:
// "multilang"` names a custom analyzer the spec never defines the internals
// of, so it's built here from OpenSearch's own bundled analysis components
// only (standard tokenizer + lowercase + asciifolding for accent-
// insensitive matching across es/en/pt — "cafe" finds "café") — no ICU
// plugin, which the base opensearchproject/opensearch image doesn't bundle
// (confirmed via `bin/opensearch-plugin list` against a real container, not
// assumed) and installing one is out of proportion to what a launch-scale
// index needs.
const MULTILANG_ANALYZER = {
  type: 'custom',
  tokenizer: 'standard',
  filter: ['lowercase', 'asciifolding'],
} as const

// SPECS.md §10.1: "username y display_name con edge_ngram (2–15) para
// typeahead". An edge_ngram *index*-time analyzer paired with a plain
// `standard`+lowercase *search*-time one is the standard pattern for this —
// indexing "ana" also indexes "an"/"ana", but searching "an" only tokenizes
// the query itself as "an", not every edge_ngram of it (which would also
// match nothing-in-common substrings by accident).
const EDGE_NGRAM_INDEX_ANALYZER = {
  type: 'custom',
  tokenizer: 'edge_ngram_tokenizer',
  filter: ['lowercase', 'asciifolding'],
} as const

const SEARCH_TIME_ANALYZER = {
  type: 'custom',
  tokenizer: 'standard',
  filter: ['lowercase', 'asciifolding'],
} as const

/** id/index bodies as separate consts, not inlined in ensureSearchIndices, so a future reindex script (blue-green alias swap, SPECS.md §10.2) can import the exact same mapping instead of a second copy that could drift. */
export const POSTS_INDEX_BODY = {
  settings: {
    number_of_shards: 6,
    number_of_replicas: 1,
    analysis: { analyzer: { multilang: MULTILANG_ANALYZER } },
  },
  mappings: {
    properties: {
      id: { type: 'keyword' },
      author_id: { type: 'keyword' },
      author_handle: { type: 'keyword' },
      text: {
        type: 'text',
        analyzer: 'multilang',
        fields: { exact: { type: 'keyword', ignore_above: 300 } },
      },
      hashtags: { type: 'keyword' },
      mentions: { type: 'keyword' },
      lang: { type: 'keyword' },
      has_media: { type: 'boolean' },
      is_sensitive: { type: 'boolean' },
      engagement: { type: 'float' },
      created_at: { type: 'date' },
    },
  },
} as const

export const USERS_INDEX_BODY = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 1,
    analysis: {
      analyzer: {
        edge_ngram_analyzer: EDGE_NGRAM_INDEX_ANALYZER,
        search_time_analyzer: SEARCH_TIME_ANALYZER,
      },
      tokenizer: {
        edge_ngram_tokenizer: {
          type: 'edge_ngram',
          min_gram: 2,
          max_gram: 15,
          token_chars: ['letter', 'digit'],
        },
      },
    },
  },
  mappings: {
    properties: {
      id: { type: 'keyword' },
      username: {
        type: 'text',
        analyzer: 'edge_ngram_analyzer',
        search_analyzer: 'search_time_analyzer',
        fields: { exact: { type: 'keyword' } },
      },
      display_name: {
        type: 'text',
        analyzer: 'edge_ngram_analyzer',
        search_analyzer: 'search_time_analyzer',
      },
      // Ranking signal (SPECS.md §10.1), not shown in a typeahead result —
      // the UI still hydrates the real profile from Postgres for that, same
      // "index carries ranking, Postgres carries truth" split
      // apps/api/src/modules/timeline already established for the ZSET.
      followers_count: { type: 'long' },
      is_verified: { type: 'boolean' },
    },
  },
} as const

/**
 * Idempotent — safe to call on every worker boot (apps/workers/src/server.ts),
 * same posture as ensurePublicBucket/ensureHashtagMentionsTable: creates
 * `posts`/`users` only if they don't already exist. Never recreates an
 * existing index — unlike a bucket policy or a DDL statement, `indices.create`
 * on an index that's already there would 400, and dropping-then-recreating
 * would destroy every document already indexed, so this checks existence
 * first rather than reaching for a "create or replace" shortcut.
 */
export async function ensureSearchIndices(client: Client): Promise<void> {
  await ensureIndex(client, POSTS_SEARCH_INDEX, POSTS_INDEX_BODY)
  await ensureIndex(client, USERS_SEARCH_INDEX, USERS_INDEX_BODY)
}

async function ensureIndex(
  client: Client,
  index: string,
  body: Record<string, unknown>,
): Promise<void> {
  const { body: exists } = await client.indices.exists({ index })
  if (exists) return
  await client.indices.create({ index, body })
}
