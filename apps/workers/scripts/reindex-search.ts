// Blue-green reindex (ROADMAP.md 2.3 / SPECS.md §10.2) — an ops-triggered
// step, not something apps/workers runs on every boot (same posture as
// register-cdc-connector.ts): reindexing is for when the *mapping itself*
// changes (a new analyzer, a different edge_ngram range), a deliberate
// action an operator takes, never routine boot-time behavior. The routine,
// additive case (a new field like has_links) already self-heals for free
// via ensureSearchIndices' own putMapping path — this script is for
// everything that path can't handle.
import { POSTS_SEARCH_INDEX, USERS_SEARCH_INDEX } from '@x/utils'
import { parseEnv } from '../src/env.js'
import {
  POSTS_INDEX_BODY,
  USERS_INDEX_BODY,
  createOpenSearchClient,
  reindexSearchIndex,
} from '../src/search/opensearch-client.js'

const env = parseEnv(process.env)
const client = createOpenSearchClient({ url: env.OPENSEARCH_URL })

for (const [alias, mappingBody] of [
  [POSTS_SEARCH_INDEX, POSTS_INDEX_BODY],
  [USERS_SEARCH_INDEX, USERS_INDEX_BODY],
] as const) {
  const { from, to } = await reindexSearchIndex(client, alias, mappingBody)
  console.info(`reindexed '${alias}': ${from} -> ${to}`)
}

await client.close()
process.exit(0)
