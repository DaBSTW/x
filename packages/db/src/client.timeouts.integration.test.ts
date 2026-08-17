import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { DATABASE_TIMEOUT_MS } from '@x/utils'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase } from './client.js'
import { migrationsFolderUrl } from './migrations-path.js'

/**
 * ROADMAP.md 3.5a / SPECS.md §14.4's "BD 2 s" — proves migrations/0018_*.sql's
 * role-level `ALTER ROLE CURRENT_USER SET statement_timeout` is real,
 * Postgres-server-enforced behavior that applies automatically to every
 * connection using this role, direct or through a real PgBouncer
 * transaction-mode pool — client.ts's own comment has the full story of why
 * this ended up as a role default instead of a per-connection option
 * (postgres.js's own `connection.statement_timeout` sends it as a Postgres
 * startup parameter, and this repo's own PgBouncer rejects that outright as
 * a FATAL "unsupported startup parameter" — measured here first, an earlier
 * version of this file, before this file's own comment on client.ts caught
 * it).
 */
describe('statement_timeout role default (migrations/0018_*.sql)', () => {
  let network: StartedNetwork
  let postgresContainer: StartedPostgreSqlContainer
  let pgbouncerContainer: StartedTestContainer

  beforeAll(async () => {
    network = await new Network().start()
    postgresContainer = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('x')
      .withUsername('x')
      .withPassword('x')
      .withNetwork(network)
      .withNetworkAliases('postgres')
      .start()

    // Runs 0018_*.sql for real, the same way any other deployment picks it
    // up — not a hand-written `ALTER ROLE` in this test file standing in
    // for it.
    const migrationDb = createDatabase(postgresContainer.getConnectionUri())
    await migrationDb.execute(sql`set statement_timeout = 0`) // migrate.ts's own opt-out, exercised for real too
    await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    // Same image/config docker-compose.yml's own pgbouncer service uses —
    // see client.pgbouncer.integration.test.ts's own top comment for why
    // each setting is what it is.
    pgbouncerContainer = await new GenericContainer('edoburu/pgbouncer:latest')
      .withNetwork(network)
      .withEnvironment({
        DATABASE_URL: 'postgres://x:x@postgres:5432/x',
        POOL_MODE: 'transaction',
        MAX_CLIENT_CONN: '100',
        DEFAULT_POOL_SIZE: '20',
        AUTH_TYPE: 'scram-sha-256',
      })
      .withExposedPorts(5432)
      .start()
  }, 120_000)

  afterAll(async () => {
    await pgbouncerContainer.stop()
    await postgresContainer.stop()
    await network.stop()
  })

  function pgbouncerUrl(): string {
    const host = pgbouncerContainer.getHost()
    const port = pgbouncerContainer.getMappedPort(5432)
    return `postgres://x:x@${host}:${port}/x`
  }

  it('aborts a query that runs past the role default, server-side, on a brand new direct connection', async () => {
    // A fresh createDatabase call, deliberately — the role default only
    // applies at *authentication* time, matching Postgres' own documented
    // behavior for ALTER ROLE ... SET (verified by hand while building
    // this: the very session that ran the ALTER still saw the *old* value
    // until reconnecting).
    const db = createDatabase(postgresContainer.getConnectionUri())
    const startedAt = Date.now()

    // pg_sleep(2) — genuinely running for 2s if this didn't work, not a
    // client-side abandon-and-move-on: the assertion below is on the error
    // Postgres itself returns, not just "it rejected".
    await expect(db.execute(sql`select pg_sleep(2)`)).rejects.toMatchObject({
      code: '57014', // query_canceled — Postgres' own code for a statement_timeout abort
    })
    // Real proof this was the *server* aborting near the DATABASE_TIMEOUT_MS
    // budget, not some unrelated slow rejection near the full 2s pg_sleep.
    expect(Date.now() - startedAt).toBeLessThan(DATABASE_TIMEOUT_MS + 1000)
  })

  it('aborts a query that runs past the role default through a real PgBouncer transaction-mode pool too — the whole point of this being a role default, not a per-connection option', async () => {
    const db = createDatabase(pgbouncerUrl())
    const startedAt = Date.now()

    await expect(db.execute(sql`select pg_sleep(2)`)).rejects.toMatchObject({ code: '57014' })
    expect(Date.now() - startedAt).toBeLessThan(DATABASE_TIMEOUT_MS + 1000)
  })

  it('never touches a query that finishes well inside the budget (no false positives)', async () => {
    const db = createDatabase(postgresContainer.getConnectionUri())
    const [row] = await db.execute(sql`select 1 as one`)
    expect(row?.one).toBe(1)
  })

  it("migrate.ts's/seed/run.ts's own opt-out (SET statement_timeout = 0) restores unlimited behavior for that session", async () => {
    const db = createDatabase(postgresContainer.getConnectionUri())
    await db.execute(sql`set statement_timeout = 0`)
    // Genuinely slower than the role default's own 2s budget — proves the
    // opt-out really means "unbounded for this session", not just a longer
    // fixed value this test happens not to hit.
    const [row] = await db.execute(sql`select pg_sleep(3), 1 as one`)
    expect(row?.one).toBe(1)
  }, 15_000)

  it('rejects quickly against an unreachable host instead of hanging (connect_timeout)', async () => {
    // 203.0.113.1 — TEST-NET-3 (RFC 5737), guaranteed non-routable, not a
    // real host that could coincidentally answer and flake this.
    const unreachable = postgres('postgres://x:x@203.0.113.1:5432/x', { connect_timeout: 2 })
    const startedAt = Date.now()
    await expect(unreachable`select 1`).rejects.toBeTruthy()
    expect(Date.now() - startedAt).toBeLessThan(4000)
    await unreachable.end({ timeout: 1 })
  })
})
