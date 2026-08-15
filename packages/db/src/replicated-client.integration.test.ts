import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { generateId } from '@x/utils'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase } from './client.js'
import { migrationsFolderUrl } from './migrations-path.js'
import { enterReadWriteContext } from './read-write-context.js'
import { createReplicatedDatabase } from './replicated-client.js'
import { userCounters, users } from './schema/users.js'

/**
 * ROADMAP.md 3.4d / SPECS.md §14.2's "réplicas de lectura... salvo
 * read-your-writes" — a real primary + a real streaming (physical) replica,
 * the exact same topology docker-compose.yml's own postgres/postgres-replica
 * pair uses (including the real, committed docker/postgres/init-replication.sh,
 * referenced by path below rather than re-typed, so a change that breaks
 * that script fails here too) — proved by hand before writing this file the
 * same way docker-compose.yml's own comment describes.
 *
 * Routing is proven with pg_wal_replay_pause()/resume() on the replica, not
 * timing: a paused replica deterministically does *not* have a row that
 * only just landed on the primary, so "the wrapped select() didn't find it"
 * is real proof the read went to the (paused) replica — a sleep-then-check
 * would only prove the read went to *some* backend eventually, racing
 * real replication lag either way.
 */
describe('createReplicatedDatabase against real streaming replication', () => {
  let network: StartedNetwork
  let primaryContainer: StartedPostgreSqlContainer
  let replicaContainer: StartedTestContainer

  beforeAll(async () => {
    network = await new Network().start()

    primaryContainer = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('x')
      .withUsername('x')
      .withPassword('x')
      .withNetwork(network)
      .withNetworkAliases('postgres')
      .withCopyFilesToContainer([
        {
          source: fileURLToPath(
            new URL('../../../docker/postgres/init-replication.sh', import.meta.url),
          ),
          target: '/docker-entrypoint-initdb.d/init-replication.sh',
          mode: 0o755,
        },
      ])
      // Same flag docker-compose.yml's own primary runs with — a documented
      // superset of the plain `replica` level streaming replication needs;
      // matching it here is what actually proves that file's own claim,
      // not just this test's independent assumption.
      .withCommand(['postgres', '-c', 'wal_level=logical'])
      .start()

    const migrationDb = createDatabase(primaryContainer.getConnectionUri())
    await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    // Same image, same pg_basebackup -R + exec docker-entrypoint.sh dance as
    // docker-compose.yml's own postgres-replica service — see its comment
    // for the full reasoning (matching major.minor versions, -R writing
    // standby.signal/primary_conninfo itself, etc.).
    replicaContainer = await new GenericContainer('postgres:17-alpine')
      .withNetwork(network)
      .withEnvironment({ PGPASSWORD: 'x' })
      .withEntrypoint(['sh', '-c'])
      .withCommand([
        [
          'set -e',
          'if [ ! -s /var/lib/postgresql/data/PG_VERSION ]; then',
          '  pg_basebackup -h postgres -p 5432 -D /var/lib/postgresql/data -U replicator -Fp -Xs -R -v -P',
          '  chmod 0700 /var/lib/postgresql/data',
          'fi',
          'exec docker-entrypoint.sh postgres',
        ].join('\n'),
      ])
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/started streaming WAL from primary/))
      .withStartupTimeout(60_000)
      .start()
  }, 120_000)

  afterAll(async () => {
    await replicaContainer.stop()
    await primaryContainer.stop()
    await network.stop()
  })

  function replicaUrl(): string {
    const host = replicaContainer.getHost()
    const port = replicaContainer.getMappedPort(5432)
    return `postgres://x:x@${host}:${port}/x`
  }

  async function insertUser(db: ReturnType<typeof createDatabase>): Promise<bigint> {
    const id = generateId()
    const username = `rwc${id.toString().slice(-10)}`
    await db.insert(users).values({
      id,
      username,
      usernameLower: username.toLowerCase(),
      email: `${username}@example.com`,
      displayName: username,
    })
    await db.insert(userCounters).values({ userId: id })
    return id
  }

  it('routes select() to the replica by default: a row only just written to the primary is invisible while replay is paused', async () => {
    const replicaRaw = createDatabase(replicaUrl())
    const db = createReplicatedDatabase(primaryContainer.getConnectionUri(), [replicaUrl()])

    await replicaRaw.execute(sql`select pg_wal_replay_pause()`)
    try {
      const id = await insertUser(db) // always goes to the primary

      // No read-write context active at all (this call isn't wrapped in
      // enterReadWriteContext) — the same posture apps/workers/scripts have
      // — so this select() has no reason to prefer the primary, and with
      // replay paused the replica deterministically does not have this row.
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
      expect(rows).toEqual([])
    } finally {
      await replicaRaw.execute(sql`select pg_wal_replay_resume()`)
    }

    // Resumed — the row does eventually show up (this part is genuinely
    // timing-dependent, so it polls rather than asserting on the first try).
    const id = await insertUser(db)
    let found = false
    for (let i = 0; i < 50 && !found; i++) {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
      found = rows.length === 1
      if (!found) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(found).toBe(true)
  })

  it('read-your-writes: a request that just wrote reads its own write from the primary even while the replica is paused', async () => {
    const replicaRaw = createDatabase(replicaUrl())
    const db = createReplicatedDatabase(primaryContainer.getConnectionUri(), [replicaUrl()])

    await replicaRaw.execute(sql`select pg_wal_replay_pause()`)
    try {
      enterReadWriteContext(false) // a fresh request, no incoming cookie
      const id = await insertUser(db) // the write itself flips this request's own routing

      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(id)
    } finally {
      await replicaRaw.execute(sql`select pg_wal_replay_resume()`)
    }
  })

  it('read-your-writes: an incoming cookie alone (no write yet this request) also forces primary reads', async () => {
    const replicaRaw = createDatabase(replicaUrl())
    const primaryRaw = createDatabase(primaryContainer.getConnectionUri())
    const db = createReplicatedDatabase(primaryContainer.getConnectionUri(), [replicaUrl()])

    await replicaRaw.execute(sql`select pg_wal_replay_pause()`)
    try {
      // Written directly on the primary, bypassing the wrapper entirely —
      // this request's own context should still find it via the cookie
      // alone, with no write of its own.
      const id = await insertUser(primaryRaw)

      enterReadWriteContext(true) // simulates a still-valid cookie from an earlier write
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(id)
    } finally {
      await replicaRaw.execute(sql`select pg_wal_replay_resume()`)
    }
  })
})
