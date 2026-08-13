import { CDC_TOPIC_PREFIX } from '@x/utils'

export const CONNECTOR_NAME = 'x-postgres-connector'

const WATCHED_TABLES = ['posts', 'users', 'post_counters', 'user_counters', 'media']

export type ConnectorConfigInput = {
  /** Postgres's hostname from *Debezium's own* network vantage point (see env.ts's DEBEZIUM_POSTGRES_HOST doc comment) — never DATABASE_URL's own host. */
  postgresHost: string
  /** apps/workers' own connection string — only its user/password/port/dbname are reused; the host comes from `postgresHost` instead. */
  databaseUrl: string
}

export type ConnectorConfig = {
  name: string
  config: Record<string, string>
}

/** Pulls user/password/port/dbname out of a `postgres://user:pass@host:port/db` URL, decoding any percent-escaped credential characters. */
export function parsePostgresConnection(databaseUrl: string): {
  user: string
  password: string
  port: string
  database: string
} {
  const url = new URL(databaseUrl)
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port: url.port || '5432',
    database: url.pathname.replace(/^\//, ''),
  }
}

/**
 * Builds the Debezium PostgresConnector config registered against Kafka
 * Connect's REST API. `plugin.name: pgoutput` is Postgres's own built-in
 * logical decoding plugin (native since Postgres 10, confirmed here to need
 * no extra extension — see docker-compose.yml's opensearch-client.ts-era
 * checkpoint note) — nothing extra to install inside the postgres image
 * beyond the `wal_level=logical` docker-compose.yml already sets.
 * `publication.autocreate.mode: filtered` scopes the auto-created
 * publication to exactly WATCHED_TABLES, not the whole schema (session
 * tokens, blocks, DMs — nothing here should flow through logical
 * replication just because Debezium is watching *something*).
 *
 * The `unwrap` SMT (`ExtractNewRecordState`) flattens each message's value
 * to the row's own columns instead of Debezium's full `{before, after,
 * op, ...}` envelope — cdc.ts's parseCdcMessage expects exactly that flat
 * shape. `delete.handling.mode: rewrite` (rather than the default `drop`)
 * keeps a real, non-null message for a delete (with `__deleted: true`
 * added) instead of only a null-value tombstone — cdc.ts documents why the
 * indexer doesn't actually need to read that flag, but a real message
 * still matters for triggering a re-fetch at all.
 */
export function buildConnectorConfig(input: ConnectorConfigInput): ConnectorConfig {
  const { user, password, port, database } = parsePostgresConnection(input.databaseUrl)
  return {
    name: CONNECTOR_NAME,
    config: {
      'connector.class': 'io.debezium.connector.postgresql.PostgresConnector',
      'database.hostname': input.postgresHost,
      'database.port': port,
      'database.user': user,
      'database.password': password,
      'database.dbname': database,
      'topic.prefix': CDC_TOPIC_PREFIX,
      'table.include.list': WATCHED_TABLES.map((table) => `public.${table}`).join(','),
      'plugin.name': 'pgoutput',
      'slot.name': 'x_search_indexer',
      'publication.name': 'x_search_publication',
      'publication.autocreate.mode': 'filtered',
      transforms: 'unwrap',
      'transforms.unwrap.type': 'io.debezium.transforms.ExtractNewRecordState',
      'transforms.unwrap.drop.tombstones': 'false',
      'transforms.unwrap.delete.handling.mode': 'rewrite',
      'key.converter': 'org.apache.kafka.connect.json.JsonConverter',
      'key.converter.schemas.enable': 'false',
      'value.converter': 'org.apache.kafka.connect.json.JsonConverter',
      'value.converter.schemas.enable': 'false',
    },
  }
}

/**
 * `PUT /connectors/{name}/config` — Kafka Connect's own idempotent
 * registration route: creates the connector if it doesn't exist yet (201)
 * or updates it in place if it does (200), unlike `POST /connectors` (409s
 * on a name that already exists). Safe to run this script repeatedly —
 * exactly the "ensure" posture opensearch-client.ts's ensureSearchIndices
 * and clickhouse-client.ts's ensureHashtagMentionsTable already use for
 * their own infrastructure, just via Kafka Connect's REST API instead of a
 * client library.
 */
export async function registerConnector(
  connectUrl: string,
  connector: ConnectorConfig,
): Promise<void> {
  const response = await fetch(`${connectUrl}/connectors/${connector.name}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(connector.config),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `failed to register CDC connector '${connector.name}': ${response.status} ${response.statusText} — ${body}`,
    )
  }
}
