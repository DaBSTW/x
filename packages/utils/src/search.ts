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

export function cdcTopicName(table: 'posts' | 'users'): string {
  return `${CDC_TOPIC_PREFIX}.${CDC_SCHEMA}.${table}`
}
