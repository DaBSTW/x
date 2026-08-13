import type { Client } from '@opensearch-project/opensearch'
import { POSTS_SEARCH_INDEX, USERS_SEARCH_INDEX } from '@x/utils'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  POSTS_INDEX_BODY,
  createOpenSearchClient,
  ensureSearchIndices,
  reindexSearchIndex,
} from './opensearch-client.js'

// No @testcontainers/opensearch module compatible with this repo's pinned
// testcontainers@10.16.0 exists (only 11.x+) — a plain GenericContainer,
// same workaround already proven for ClickHouse elsewhere in this repo,
// avoids a version mismatch against every other @testcontainers/* package here.
describe('opensearch-client', () => {
  let container: StartedTestContainer

  beforeAll(async () => {
    container = await new GenericContainer('opensearchproject/opensearch:2')
      .withEnvironment({
        'discovery.type': 'single-node',
        DISABLE_SECURITY_PLUGIN: 'true',
        DISABLE_INSTALL_DEMO_CONFIG: 'true',
        OPENSEARCH_JAVA_OPTS: '-Xms512m -Xmx512m',
      })
      .withExposedPorts(9200)
      .withWaitStrategy(Wait.forHttp('/_cluster/health', 9200).forStatusCode(200))
      .withStartupTimeout(120_000)
      .start()
  }, 150_000)

  afterAll(async () => {
    await container.stop()
  })

  function client() {
    return createOpenSearchClient({
      url: `http://${container.getHost()}:${container.getMappedPort(9200)}`,
    })
  }

  /**
   * Every test below starts from a known-empty slate for whichever alias it
   * touches, regardless of what an earlier test in this file left behind
   * (CODESTYLE.md §14 — no implicit ordering, no shared state between
   * tests). The container itself *is* shared across the file for
   * startup-cost reasons, so this is what keeps that sharing from leaking
   * into test outcomes. Handles all three states a name can be in: a real
   * alias (delete every versioned index behind it, there can be more than
   * one after a reindexSearchIndex test), a plain non-aliased index (the
   * legacy pre-blue-green shape a couple of tests below deliberately
   * recreate), or nothing at all.
   */
  async function resetIndex(openSearchClient: Client, alias: string): Promise<void> {
    const { body: aliasExists } = await openSearchClient.indices.existsAlias({ name: alias })
    if (aliasExists) {
      const { body: aliasInfo } = await openSearchClient.indices.getAlias({ name: alias })
      for (const indexName of Object.keys(aliasInfo)) {
        await openSearchClient.indices.delete({ index: indexName })
      }
      return
    }
    await openSearchClient.indices.delete({ index: alias }).catch(() => {})
  }

  it('creates the posts and users indices behind a fresh v1 alias, with the SPECS.md §10.1 mappings, and is a no-op the second time', async () => {
    const openSearchClient = client()
    await resetIndex(openSearchClient, POSTS_SEARCH_INDEX)
    await resetIndex(openSearchClient, USERS_SEARCH_INDEX)

    await ensureSearchIndices(openSearchClient)

    const { body: postsAliasExists } = await openSearchClient.indices.existsAlias({
      name: POSTS_SEARCH_INDEX,
    })
    const { body: usersAliasExists } = await openSearchClient.indices.existsAlias({
      name: USERS_SEARCH_INDEX,
    })
    expect(postsAliasExists).toBe(true)
    expect(usersAliasExists).toBe(true)

    // Greenfield always lands on v1 — `posts`/`users` themselves are never
    // the literal index documents live in.
    const { body: postsAlias } = await openSearchClient.indices.getAlias({
      name: POSTS_SEARCH_INDEX,
    })
    expect(Object.keys(postsAlias)).toEqual(['posts-v1'])

    const { body: postsMapping } = await openSearchClient.indices.getMapping({
      index: POSTS_SEARCH_INDEX,
    })
    // Metadata APIs key their response by the *concrete* index name behind
    // an alias, never by the alias itself — Object.values sidesteps having
    // to know that name (posts-v1 here, but not the point of this
    // assertion) instead of indexing by POSTS_SEARCH_INDEX directly.
    const postsProperties = Object.values(postsMapping)[0]?.mappings?.properties
    if (!postsProperties) throw new Error('expected the posts index to have a mapping')
    expect(postsProperties).toMatchObject({
      id: { type: 'keyword' },
      author_id: { type: 'keyword' },
      text: { type: 'text', analyzer: 'multilang' },
      hashtags: { type: 'keyword' },
      created_at: { type: 'date' },
    })
    expect(postsProperties.text?.fields?.exact).toMatchObject({
      type: 'keyword',
      ignore_above: 300,
    })

    // A real document, written and read through the alias exactly like
    // every real caller elsewhere in this codebase, survives a second
    // ensureSearchIndices call — the whole point of checking existence
    // first (opensearch-client.ts's own docstring) instead of an
    // unconditional create-or-replace.
    await openSearchClient.index({
      index: POSTS_SEARCH_INDEX,
      id: '1',
      body: { id: '1', author_id: '2', text: 'hola mundo' },
      refresh: true,
    })

    await ensureSearchIndices(openSearchClient)

    const { body: fetched } = await openSearchClient.get({ index: POSTS_SEARCH_INDEX, id: '1' })
    expect(fetched._source).toMatchObject({ text: 'hola mundo' })

    // Steady state — the second call took the putMapping branch (case 1),
    // not a second migration: still exactly one index behind the alias,
    // still v1.
    const { body: postsAliasAfter } = await openSearchClient.indices.getAlias({
      name: POSTS_SEARCH_INDEX,
    })
    expect(Object.keys(postsAliasAfter)).toEqual(['posts-v1'])
  })

  it('adds a new field to an index already behind an alias via putMapping (steady state), without creating a new version', async () => {
    const openSearchClient = client()
    await resetIndex(openSearchClient, POSTS_SEARCH_INDEX)

    // A stale mapping already sitting behind a real alias — the routine "a
    // new field like has_links was added to POSTS_INDEX_BODY after this
    // index was created" case (ensureIndex's case 1), distinct from the
    // migration test below (case 2 — no alias at all yet). Has to stay a
    // true *subset* of the real mapping, not a freestanding trimmed-down
    // one: OpenSearch rejects putMapping calls that would redefine an
    // *existing* field's analyzer, so only `has_links` itself can differ.
    const { has_links: _omitted, ...staleProperties } = POSTS_INDEX_BODY.mappings.properties
    await openSearchClient.indices.create({
      index: 'posts-v1',
      body: {
        settings: POSTS_INDEX_BODY.settings,
        mappings: { properties: staleProperties },
        aliases: { [POSTS_SEARCH_INDEX]: {} },
      } as Record<string, unknown>,
    })

    const { body: before } = await openSearchClient.indices.getMapping({
      index: POSTS_SEARCH_INDEX,
    })
    expect(Object.values(before)[0]?.mappings?.properties?.has_links).toBeUndefined()

    await ensureSearchIndices(openSearchClient)

    // Same version — an additive mapping change applied in place, not a
    // migration to a new one.
    const { body: aliasInfo } = await openSearchClient.indices.getAlias({
      name: POSTS_SEARCH_INDEX,
    })
    expect(Object.keys(aliasInfo)).toEqual(['posts-v1'])

    const { body: after } = await openSearchClient.indices.getMapping({
      index: POSTS_SEARCH_INDEX,
    })
    expect(Object.values(after)[0]?.mappings?.properties?.has_links).toMatchObject({
      type: 'boolean',
    })

    // Not just present in the mapping — actually queryable, on a document
    // indexed after the field was added.
    await openSearchClient.index({
      index: POSTS_SEARCH_INDEX,
      id: 'steady-1',
      body: { id: 'steady-1', text: 'sin enlaces', has_links: true },
      refresh: true,
    })
    const { body: result } = await openSearchClient.search({
      index: POSTS_SEARCH_INDEX,
      body: { query: { term: { has_links: true } } },
    })
    const ids = (result.hits.hits as unknown as Array<{ _id: string }>).map((hit) => hit._id)
    expect(ids).toContain('steady-1')
  })

  it('migrates a pre-existing plain index into a versioned alias, preserving its documents (legacy pre-blue-green deployments)', async () => {
    const openSearchClient = client()
    await resetIndex(openSearchClient, POSTS_SEARCH_INDEX)

    // Simulates an index created by a pre-blue-green boot: a *plain* index
    // sitting directly at the alias name, not an alias at all — this
    // checkpoint's own dev/staging environments included, per
    // opensearch-client.ts's ensureIndex docstring (case 2).
    const { has_links: _omitted, ...staleProperties } = POSTS_INDEX_BODY.mappings.properties
    await openSearchClient.indices.create({
      index: POSTS_SEARCH_INDEX,
      body: {
        settings: POSTS_INDEX_BODY.settings,
        mappings: { properties: staleProperties },
      } as Record<string, unknown>,
    })

    // A document indexed before migration — the whole point of this test
    // is that it's still there and still queryable afterward, through the
    // alias.
    await openSearchClient.index({
      index: POSTS_SEARCH_INDEX,
      id: 'pre-migration-1',
      body: { id: 'pre-migration-1', text: 'pre-migracion' },
      refresh: true,
    })

    await ensureSearchIndices(openSearchClient)

    // The plain index is gone; POSTS_SEARCH_INDEX now resolves as a real
    // alias onto a fresh v1 index.
    const { body: aliasExists } = await openSearchClient.indices.existsAlias({
      name: POSTS_SEARCH_INDEX,
    })
    expect(aliasExists).toBe(true)
    const { body: aliasInfo } = await openSearchClient.indices.getAlias({
      name: POSTS_SEARCH_INDEX,
    })
    expect(Object.keys(aliasInfo)).toEqual(['posts-v1'])

    // has_links is now in the mapping...
    const { body: mapping } = await openSearchClient.indices.getMapping({
      index: POSTS_SEARCH_INDEX,
    })
    expect(Object.values(mapping)[0]?.mappings?.properties?.has_links).toMatchObject({
      type: 'boolean',
    })

    // ...and the pre-migration document survived the reindex, still
    // reachable through the alias.
    const { body: survived } = await openSearchClient.get({
      index: POSTS_SEARCH_INDEX,
      id: 'pre-migration-1',
    })
    expect(survived._source).toMatchObject({ text: 'pre-migracion' })
  })

  it('indexes usernames with edge_ngram so a short prefix search matches (typeahead, SPECS.md §10.1)', async () => {
    const openSearchClient = client()
    await ensureSearchIndices(openSearchClient)

    await openSearchClient.index({
      index: USERS_SEARCH_INDEX,
      id: '42',
      body: { id: '42', username: 'anacapital', display_name: 'Ana Capital', followers_count: 10 },
      refresh: true,
    })

    const { body: result } = await openSearchClient.search({
      index: USERS_SEARCH_INDEX,
      body: { query: { match: { username: 'an' } } },
    })
    const ids = (result.hits.hits as unknown as Array<{ _id: string }>).map((hit) => hit._id)
    expect(ids).toContain('42')

    // A search-time query that itself never appeared as a whole indexed
    // token (only its own edge_ngrams did) still shouldn't over-match —
    // proves the search_analyzer isn't also edge_ngram-expanding the query
    // side (which would make "xyz" match almost anything by accident).
    const { body: noMatch } = await openSearchClient.search({
      index: USERS_SEARCH_INDEX,
      body: { query: { match: { username: 'zzz_no_such_prefix' } } },
    })
    expect(noMatch.hits.hits).toHaveLength(0)
  })

  it('reindexSearchIndex builds a new version, copies documents, swaps the alias atomically, and leaves the old index intact for rollback', async () => {
    const openSearchClient = client()
    await resetIndex(openSearchClient, POSTS_SEARCH_INDEX)
    await ensureSearchIndices(openSearchClient)

    await openSearchClient.index({
      index: POSTS_SEARCH_INDEX,
      id: 'before-reindex-1',
      body: { id: 'before-reindex-1', text: 'antes del reindex' },
      refresh: true,
    })

    const { from, to } = await reindexSearchIndex(
      openSearchClient,
      POSTS_SEARCH_INDEX,
      POSTS_INDEX_BODY,
    )
    expect(from).toBe('posts-v1')
    expect(to).toBe('posts-v2')

    // The alias now points only at the new version...
    const { body: aliasInfo } = await openSearchClient.indices.getAlias({
      name: POSTS_SEARCH_INDEX,
    })
    expect(Object.keys(aliasInfo)).toEqual(['posts-v2'])

    // ...but the old version is still there, untouched, for rollback —
    // reindexSearchIndex only ever adds indices, per its own docstring, and
    // never deletes the one search itself still depended on a moment ago.
    const { body: oldStillExists } = await openSearchClient.indices.exists({ index: 'posts-v1' })
    expect(oldStillExists).toBe(true)
    const { body: oldDoc } = await openSearchClient.get({
      index: 'posts-v1',
      id: 'before-reindex-1',
    })
    expect(oldDoc._source).toMatchObject({ text: 'antes del reindex' })

    // The pre-existing document survived the copy and is reachable through
    // the alias, which now resolves to posts-v2.
    const { body: viaAlias } = await openSearchClient.get({
      index: POSTS_SEARCH_INDEX,
      id: 'before-reindex-1',
    })
    expect(viaAlias._source).toMatchObject({ text: 'antes del reindex' })

    // A document written after the swap lands in the new version, not the
    // old one — proves every real writer in this codebase (which only ever
    // addresses the alias, never a version number) transparently moves to
    // v2 the instant the swap completes.
    await openSearchClient.index({
      index: POSTS_SEARCH_INDEX,
      id: 'after-reindex-1',
      body: { id: 'after-reindex-1', text: 'despues del reindex' },
      refresh: true,
    })
    const { body: newDocInV2 } = await openSearchClient.get({
      index: 'posts-v2',
      id: 'after-reindex-1',
    })
    expect(newDocInV2._source).toMatchObject({ text: 'despues del reindex' })
    const { body: newDocNotInV1 } = await openSearchClient.exists({
      index: 'posts-v1',
      id: 'after-reindex-1',
    })
    expect(newDocNotInV1).toBe(false)
  })
})
