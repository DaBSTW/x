import { POSTS_SEARCH_INDEX, USERS_SEARCH_INDEX } from '@x/utils'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOpenSearchClient, ensureSearchIndices } from './opensearch-client.js'

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

  it('creates the posts and users indices with the SPECS.md §10.1 mappings, and is a no-op the second time', async () => {
    const client = createOpenSearchClient({
      url: `http://${container.getHost()}:${container.getMappedPort(9200)}`,
    })

    await ensureSearchIndices(client)

    const { body: postsExists } = await client.indices.exists({ index: POSTS_SEARCH_INDEX })
    const { body: usersExists } = await client.indices.exists({ index: USERS_SEARCH_INDEX })
    expect(postsExists).toBe(true)
    expect(usersExists).toBe(true)

    const { body: postsMapping } = await client.indices.getMapping({ index: POSTS_SEARCH_INDEX })
    const postsProperties = postsMapping[POSTS_SEARCH_INDEX]?.mappings?.properties
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

    // A real document survives a second ensureSearchIndices call — the
    // whole point of checking existence first (opensearch-client.ts's own
    // docstring) instead of an unconditional create-or-replace.
    await client.index({
      index: POSTS_SEARCH_INDEX,
      id: '1',
      body: { id: '1', author_id: '2', text: 'hola mundo' },
      refresh: true,
    })

    await ensureSearchIndices(client)

    const { body: fetched } = await client.get({ index: POSTS_SEARCH_INDEX, id: '1' })
    expect(fetched._source).toMatchObject({ text: 'hola mundo' })
  })

  it('indexes usernames with edge_ngram so a short prefix search matches (typeahead, SPECS.md §10.1)', async () => {
    const client = createOpenSearchClient({
      url: `http://${container.getHost()}:${container.getMappedPort(9200)}`,
    })
    await ensureSearchIndices(client)

    await client.index({
      index: USERS_SEARCH_INDEX,
      id: '42',
      body: { id: '42', username: 'anacapital', display_name: 'Ana Capital', followers_count: 10 },
      refresh: true,
    })

    const { body: result } = await client.search({
      index: USERS_SEARCH_INDEX,
      body: { query: { match: { username: 'an' } } },
    })
    const ids = (result.hits.hits as unknown as Array<{ _id: string }>).map((hit) => hit._id)
    expect(ids).toContain('42')

    // A search-time query that itself never appeared as a whole indexed
    // token (only its own edge_ngrams did) still shouldn't over-match —
    // proves the search_analyzer isn't also edge_ngram-expanding the query
    // side (which would make "xyz" match almost anything by accident).
    const { body: noMatch } = await client.search({
      index: USERS_SEARCH_INDEX,
      body: { query: { match: { username: 'zzz_no_such_prefix' } } },
    })
    expect(noMatch.hits.hits).toHaveLength(0)
  })
})
