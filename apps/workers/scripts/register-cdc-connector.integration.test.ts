import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import {
  type Database,
  createDatabase,
  migrationsFolderUrl,
  postCounters,
  posts,
  users,
} from '@x/db'
import { cdcTopicName } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { type Consumer, Kafka, logLevel } from 'kafkajs'
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildConnectorConfig, registerConnector } from './lib/cdc-connector-config.js'

const DEBEZIUM_REST_PORT = 8083
// Redpanda's internal (network-alias-reachable) broker port — arbitrary but
// fixed, matching docker-compose.yml's own PLAINTEXT/OUTSIDE split.
const REDPANDA_INTERNAL_PORT = 29092
// The host-reachable listener's fixed port. Different from
// search-indexer.worker.integration.test.ts's own REDPANDA_EXTERNAL_PORT so
// the two can't collide if both files' containers happen to run at once.
const REDPANDA_EXTERNAL_PORT = 29292

// Same GenericContainer + dual-listener approach as docker-compose.yml's
// redpanda service (this repo's actual runtime topology, not a stand-in) —
// one listener a network-alias peer (Debezium, below) reaches internally,
// one this test process reaches through a fixed host port. Fixed rather
// than a normal dynamic Testcontainers mapping because the *advertised*
// address has to be baked into the startup command, before Testcontainers
// could tell us what a dynamic mapping landed on.
function createRedpandaContainer(network: StartedNetwork): GenericContainer {
  return new GenericContainer('redpandadata/redpanda:latest')
    .withNetwork(network)
    .withNetworkAliases('redpanda')
    .withExposedPorts({ container: REDPANDA_EXTERNAL_PORT, host: REDPANDA_EXTERNAL_PORT })
    .withCommand([
      'redpanda',
      'start',
      '--smp',
      '1',
      '--memory',
      '512M',
      '--overprovisioned',
      '--node-id',
      '0',
      '--check=false',
      '--kafka-addr',
      `PLAINTEXT://0.0.0.0:${REDPANDA_INTERNAL_PORT},OUTSIDE://0.0.0.0:${REDPANDA_EXTERNAL_PORT}`,
      '--advertise-kafka-addr',
      `PLAINTEXT://redpanda:${REDPANDA_INTERNAL_PORT},OUTSIDE://localhost:${REDPANDA_EXTERNAL_PORT}`,
    ])
    .withWaitStrategy(Wait.forSuccessfulCommand('rpk cluster health | grep -q "Healthy:.*true"'))
    .withStartupTimeout(120_000)
}

/**
 * This is the one test in the search checkpoint that stands up a *real*
 * Debezium, proving the connector config itself (register-cdc-connector.ts)
 * is accepted and actually produces messages — as opposed to
 * search-indexer.worker.integration.test.ts, which proves the indexer's own
 * consumption logic against synthetic CDC-shaped messages and doesn't need
 * a live Debezium for that. Both matter; this one is the heavier of the two
 * (an extra container, extra Kafka Connect worker startup), which is why
 * it stays scoped to a single table/single row rather than re-covering
 * every table search-indexer.worker's suite already exercises.
 */
describe('register-cdc-connector (roadmap 2.3 / SPECS.md §10.2)', () => {
  let network: StartedNetwork
  let postgresContainer: StartedPostgreSqlContainer
  let kafkaContainer: StartedTestContainer
  let debeziumContainer: StartedTestContainer
  let db: Database
  let consumer: Consumer

  beforeAll(async () => {
    network = await new Network().start()
    ;[postgresContainer, kafkaContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine')
        .withDatabase('x')
        .withUsername('x')
        .withPassword('x')
        .withCommand(['postgres', '-c', 'wal_level=logical'])
        .withNetwork(network)
        .withNetworkAliases('postgres')
        .start(),
      createRedpandaContainer(network).start(),
    ])

    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    debeziumContainer = await new GenericContainer('debezium/connect:2.7.3.Final')
      .withNetwork(network)
      .withEnvironment({
        BOOTSTRAP_SERVERS: `redpanda:${REDPANDA_INTERNAL_PORT}`,
        GROUP_ID: 'x-cdc-test',
        CONFIG_STORAGE_TOPIC: '_x_connect_configs_test',
        OFFSET_STORAGE_TOPIC: '_x_connect_offsets_test',
        STATUS_STORAGE_TOPIC: '_x_connect_status_test',
      })
      .withExposedPorts(DEBEZIUM_REST_PORT)
      .withWaitStrategy(Wait.forHttp('/connectors', DEBEZIUM_REST_PORT).forStatusCode(200))
      .withStartupTimeout(150_000)
      .start()

    const kafka = new Kafka({
      clientId: 'register-cdc-connector-test',
      brokers: [
        `${kafkaContainer.getHost()}:${kafkaContainer.getMappedPort(REDPANDA_EXTERNAL_PORT)}`,
      ],
      logLevel: logLevel.ERROR,
    })
    consumer = kafka.consumer({ groupId: 'register-cdc-connector-test-consumer' })
    await consumer.connect()
  }, 210_000)

  afterAll(async () => {
    await consumer.disconnect()
    await Promise.all([debeziumContainer.stop(), kafkaContainer.stop(), postgresContainer.stop()])
    await network.stop()
  })

  it('registers against a real Kafka Connect, and a real Postgres insert produces a real flattened CDC message', async () => {
    const debeziumUrl = `http://${debeziumContainer.getHost()}:${debeziumContainer.getMappedPort(DEBEZIUM_REST_PORT)}`

    // Debezium's *own* view of Postgres — the network alias + Postgres's
    // fixed internal port (5432), never postgresContainer.getConnectionUri()'s
    // dynamically-mapped external port, which only this test process (not a
    // peer container on the same network) can reach.
    const connectorConfig = buildConnectorConfig({
      postgresHost: 'postgres',
      databaseUrl: 'postgres://x:x@postgres:5432/x',
    })
    await registerConnector(debeziumUrl, connectorConfig)

    // Registering is idempotent — same config, re-PUT, must not 4xx/5xx.
    await expect(registerConnector(debeziumUrl, connectorConfig)).resolves.toBeUndefined()

    await consumer.subscribe({ topic: cdcTopicName('posts'), fromBeginning: true })

    const received: Array<Record<string, unknown>> = []
    const consumed = new Promise<void>((resolve) => {
      void consumer.run({
        eachMessage: async ({ message }) => {
          if (!message.value) return
          received.push(JSON.parse(message.value.toString('utf8')))
          resolve()
        },
      })
    })

    // Inserted *after* the connector is already registered and the
    // consumer already subscribed — Debezium would also emit an initial
    // snapshot record for any pre-existing row the moment the connector
    // first starts, but seeding afterwards instead proves the streaming
    // path (real logical replication off the WAL) works, not just a
    // one-time snapshot. authorId needs a real users row first (posts.author_id's FK).
    const authorId = 555001n
    await db.insert(users).values({
      id: authorId,
      username: 'cdctest',
      usernameLower: 'cdctest',
      email: 'cdctest@example.com',
      displayName: 'CDC Test',
    })
    const postId = 555002n
    await db.insert(posts).values({
      id: postId,
      authorId,
      text: 'streamed via debezium',
      lang: 'es',
      createdAt: new Date(),
    })
    await db.insert(postCounters).values({ postId })

    await Promise.race([
      consumed,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('timed out waiting for a CDC message')), 90_000),
      ),
    ])

    expect(received.length).toBeGreaterThan(0)
    const message = received.find((row) => String(row.id) === postId.toString())
    expect(message).toBeDefined()
    expect(String(message?.author_id)).toBe(authorId.toString())
    expect(message?.text).toBe('streamed via debezium')
  }, 150_000)
})
