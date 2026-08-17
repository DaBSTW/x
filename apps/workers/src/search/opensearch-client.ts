import { Client } from '@opensearch-project/opensearch'
import { POSTS_SEARCH_INDEX, USERS_SEARCH_INDEX } from '@x/utils'

export type OpenSearchConfig = {
  url: string
  /**
   * SPECS.md §14.4 / CODESTYLE.md §10 — "servicio interno 1 s". Optional
   * and unset by default: apps/workers' own use of this factory (indexing
   * writes off the CDC stream, and this file's own ensureSearchIndices —
   * whose rare one-time legacy-index migration branch runs a real
   * `_reindex`, and scripts/reindex-search.ts's blue-green one always does)
   * is background work with no live request's latency budget riding on it,
   * the same reasoning packages/db/src/client.ts's own statementTimeoutMs
   * documents for migrate.ts/seed/run.ts. Only apps/api's app.ts opts in —
   * the one case where a search query sits directly on a live HTTP
   * response's critical path.
   */
  requestTimeoutMs?: number
}

export function createOpenSearchClient(config: OpenSearchConfig): Client {
  return new Client({
    node: config.url,
    ...(config.requestTimeoutMs !== undefined ? { requestTimeout: config.requestTimeoutMs } : {}),
  })
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
      // Not in SPECS.md §10.1's own mapping, added for `filter:links`
      // (§10.3) — there's no other field a filter clause could match a URL
      // against without a full-text scan of `text` on every query. Derived
      // for free in apps/workers' document-builders.ts, which already runs
      // `text` through parseEntities for hashtags/mentions.
      has_links: { type: 'boolean' },
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

/** `posts-v1`, `posts-v2`, … — the *real* index a version lives in, distinct from the stable alias name (`POSTS_SEARCH_INDEX`) every reader/writer elsewhere in this codebase actually uses. */
function versionedIndexName(alias: string, version: number): string {
  return `${alias}-v${version}`
}

function parseIndexVersion(indexName: string): number {
  const match = indexName.match(/-v(\d+)$/)
  return match?.[1] ? Number(match[1]) : 0
}

// Cast through `unknown`, same precedent throughout this file: `body`'s real
// shape (POSTS_INDEX_BODY/USERS_INDEX_BODY, the only place either is
// authored) is a correct OpenSearch mapping, but this client's generated
// request types are stricter than a plain object literal can satisfy
// directly (readonly arrays from `as const`, a `Property` union `properties`
// values have to structurally match, etc.).
function loosely<T>(value: unknown): T {
  return value as T
}

/**
 * Idempotent — safe to call on every worker boot (apps/workers/src/server.ts),
 * same posture as ensurePublicBucket/ensureHashtagMentionsTable. `posts`/
 * `users` (POSTS_SEARCH_INDEX/USERS_SEARCH_INDEX) are never the literal
 * index documents live in — they're aliases, so a full reindex
 * (reindexSearchIndex below, SPECS.md §10.2's "reindexado blue-green") can
 * build a new physical index and atomically swap the alias over, with zero
 * window where search has nothing to read from. Three cases, in order:
 *
 * 1. The alias already exists → this is steady-state. Apply the current
 *    mapping's `properties` via putMapping, additive-only (a genuinely new
 *    field key like `has_links` is picked up immediately; redefining an
 *    existing field's type 400s instead of silently corrupting it) —
 *    `settings` (analyzers, shard count) can never change this way, only a
 *    real reindex changes those.
 * 2. A *plain* index already sits at this name, not an alias — an
 *    already-running deployment from before this checkpoint introduced
 *    aliases at all (this file's own dev environment included). Adopts it:
 *    reindex its documents into a new `-v1` index, delete the old plain
 *    index, alias the name onto the new one. A one-time migration, not
 *    something a steady-state alias ever needs again.
 * 3. Neither exists — greenfield. Create `-v1` directly with the alias
 *    attached, in the same call.
 */
export async function ensureSearchIndices(client: Client): Promise<void> {
  await ensureIndex(client, POSTS_SEARCH_INDEX, POSTS_INDEX_BODY)
  await ensureIndex(client, USERS_SEARCH_INDEX, USERS_INDEX_BODY)
}

async function ensureIndex(
  client: Client,
  alias: string,
  body: Record<string, unknown>,
): Promise<void> {
  const { body: aliasExists } = await client.indices.existsAlias({ name: alias })
  if (aliasExists) {
    const { properties } = (body as { mappings: { properties: unknown } }).mappings
    await client.indices.putMapping({ index: alias, body: loosely({ properties }) })
    return
  }

  const { body: plainIndexExists } = await client.indices.exists({ index: alias })
  if (plainIndexExists) {
    const migratedIndex = versionedIndexName(alias, 1)
    await client.indices.create({ index: migratedIndex, body: loosely(body) })
    await client.reindex({
      body: loosely({ source: { index: alias }, dest: { index: migratedIndex } }),
      wait_for_completion: true,
      refresh: true,
    })
    await client.indices.delete({ index: alias })
    await client.indices.putAlias({ index: migratedIndex, name: alias })
    return
  }

  await client.indices.create({
    index: versionedIndexName(alias, 1),
    body: loosely({ ...body, aliases: { [alias]: {} } }),
  })
}

/**
 * SPECS.md §10.2's "reindexado blue-green mediante alias" — builds a new
 * versioned index with `mappingBody`'s current mapping, copies every
 * document across via OpenSearch's own `_reindex`, then atomically swaps
 * `alias` from the old index to the new one in a single `updateAliases`
 * call (`remove`+`add` together — never a window where the alias resolves
 * to nothing, or to both). The old index is deliberately left in place
 * rather than deleted — a rollback (`updateAliases` back to it) stays
 * possible until an operator is confident enough to clean it up by hand;
 * this function only ever adds indices, never removes one search itself
 * still depends on.
 *
 * For when the *mapping itself* needs to change — a new analyzer, a
 * different edge_ngram range — not the routine additive-field case
 * ensureSearchIndices' own putMapping path already handles for free.
 */
export async function reindexSearchIndex(
  client: Client,
  alias: string,
  mappingBody: Record<string, unknown>,
): Promise<{ from: string; to: string }> {
  const { body: aliasInfo } = await client.indices.getAlias({ name: alias })
  const currentIndices = Object.keys(aliasInfo)
  if (currentIndices.length !== 1) {
    throw new Error(
      `reindexSearchIndex: expected exactly one index behind alias '${alias}', found ${currentIndices.length} (${currentIndices.join(', ') || 'none'}) — run ensureSearchIndices first`,
    )
  }
  const fromIndex = currentIndices[0] as string
  const toIndex = versionedIndexName(alias, parseIndexVersion(fromIndex) + 1)

  await client.indices.create({ index: toIndex, body: loosely(mappingBody) })
  await client.reindex({
    body: loosely({ source: { index: fromIndex }, dest: { index: toIndex } }),
    wait_for_completion: true,
    refresh: true,
  })
  await client.indices.updateAliases({
    body: {
      actions: [{ remove: { index: fromIndex, alias } }, { add: { index: toIndex, alias } }],
    },
  })

  return { from: fromIndex, to: toIndex }
}
