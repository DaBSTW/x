// Registers (or updates — see registerConnector's docstring) the Debezium
// Postgres connector that feeds search-indexer.worker.ts. An ops-triggered
// setup step, not something apps/workers runs itself on every boot — same
// posture as reconcile-counters.ts/compute-trends.ts: this configures
// shared infrastructure (Debezium's own Kafka Connect instance), not
// anything scoped to a single worker process's lifecycle.
import { parseEnv } from '../src/env.js'
import { buildConnectorConfig, registerConnector } from './lib/cdc-connector-config.js'

const env = parseEnv(process.env)

const config = buildConnectorConfig({
  postgresHost: env.DEBEZIUM_POSTGRES_HOST,
  databaseUrl: env.DATABASE_URL,
})

await registerConnector(env.DEBEZIUM_CONNECT_URL, config)

console.info(`registered CDC connector '${config.name}' against ${env.DEBEZIUM_CONNECT_URL}`)
process.exit(0)
