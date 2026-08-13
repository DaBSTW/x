// ROADMAP.md 2.3 — SPECS.md §10. Centralized the same way realtime.ts's
// channel/key builders are: apps/api (connector registration), apps/workers
// (the indexer consuming these same topics) and any future reindex script
// all need to agree on these exact strings without importing each other
// (CODESTYLE.md §7).

export const POSTS_SEARCH_INDEX = 'posts'
export const USERS_SEARCH_INDEX = 'users'

// Debezium's own topic.prefix (docker-compose.yml's debezium service) —
// every captured table's change-data topic is `${prefix}.${schema}.${table}`,
// Debezium's own fixed naming convention, not something this app chooses.
export const CDC_TOPIC_PREFIX = 'x'
const CDC_SCHEMA = 'public'

// The five tables the CDC connector watches (register-cdc-connector.ts):
// posts/users carry the document's own identity, post_counters/user_counters/
// media carry fields (engagement, has_media, followers_count) that change
// independently of their parent row — SPECS.md §10.1 lists all of them as
// real mapping fields, so all five need to be able to trigger a re-index.
export function cdcTopicName(
  table: 'posts' | 'users' | 'post_counters' | 'user_counters' | 'media',
): string {
  return `${CDC_TOPIC_PREFIX}.${CDC_SCHEMA}.${table}`
}

// kafkajs consumer group id for the search indexer (apps/workers/src/search/
// search-indexer.worker.ts) — a fixed, well-known string rather than an env
// var: every instance of apps/workers must share the SAME group so Kafka
// partitions the CDC topics across them instead of each instance replaying
// every message from scratch.
export const SEARCH_INDEXER_CONSUMER_GROUP = 'x-search-indexer'
