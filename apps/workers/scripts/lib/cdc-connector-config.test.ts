import { describe, expect, it } from 'vitest'
import { buildConnectorConfig, parsePostgresConnection } from './cdc-connector-config.js'

describe('parsePostgresConnection', () => {
  it('splits a postgres:// URL into its connection pieces', () => {
    expect(parsePostgresConnection('postgres://x:x@localhost:5432/x')).toEqual({
      user: 'x',
      password: 'x',
      port: '5432',
      database: 'x',
    })
  })

  it('decodes percent-escaped credential characters', () => {
    expect(parsePostgresConnection('postgres://ana:p%40ss@localhost:5432/x').password).toBe('p@ss')
  })

  it('defaults the port to 5432 when the URL omits it', () => {
    expect(parsePostgresConnection('postgres://x:x@localhost/x').port).toBe('5432')
  })
})

describe('buildConnectorConfig', () => {
  const config = buildConnectorConfig({
    postgresHost: 'postgres',
    databaseUrl: 'postgres://x:x@localhost:5432/x',
  })

  it("points at Debezium's own Postgres vantage point, not DATABASE_URL's host", () => {
    expect(config.config['database.hostname']).toBe('postgres')
    expect(config.config['database.port']).toBe('5432')
    expect(config.config['database.user']).toBe('x')
    expect(config.config['database.password']).toBe('x')
    expect(config.config['database.dbname']).toBe('x')
  })

  it('watches exactly the five tables the search indexer subscribes to, schema-qualified', () => {
    expect(config.config['table.include.list']).toBe(
      'public.posts,public.users,public.post_counters,public.user_counters,public.media',
    )
  })

  it('uses pgoutput — no extra Postgres extension required — and a filtered auto-created publication', () => {
    expect(config.config['plugin.name']).toBe('pgoutput')
    expect(config.config['publication.autocreate.mode']).toBe('filtered')
  })

  it('flattens each message with ExtractNewRecordState and rewrites deletes instead of dropping to a tombstone-only signal', () => {
    expect(config.config['transforms.unwrap.type']).toBe(
      'io.debezium.transforms.ExtractNewRecordState',
    )
    expect(config.config['transforms.unwrap.delete.handling.mode']).toBe('rewrite')
    expect(config.config['transforms.unwrap.drop.tombstones']).toBe('false')
  })

  it('is stable — the same input always names the same connector, safe for a repeatable idempotent PUT', () => {
    const again = buildConnectorConfig({
      postgresHost: 'postgres',
      databaseUrl: 'postgres://x:x@localhost:5432/x',
    })
    expect(again).toEqual(config)
  })
})
