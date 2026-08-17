// ROADMAP.md 3.4h / SPECS.md §14.3's full "cargas típicas" table, all four
// rows exercised concurrently (not one endpoint in isolation, unlike 1.3's
// timeline-home.k6.js) so contention between reads and writes on the same
// Postgres/Redis is part of what gets measured. Each scenario's target
// arrival rate is that row's peak QPS divided by 100 (50000:30000:5000:15000
// -> 500:300:50:150) — the ratio SPECS.md actually specifies is preserved,
// scaled down to a range this sandbox can meaningfully attempt. Run
// seed-load-campaign.ts first — see this directory's README.md.
import { check } from 'k6'
import { SharedArray } from 'k6/data'
import http from 'k6/http'

const FIXTURE_FILE = './.load-campaign-fixture.json'
const readerTokens = new SharedArray(
  'readerTokens',
  () => JSON.parse(open(FIXTURE_FILE)).readerTokens,
)
const writerTokens = new SharedArray(
  'writerTokens',
  () => JSON.parse(open(FIXTURE_FILE)).writerTokens,
)
const postIds = new SharedArray('postIds', () => JSON.parse(open(FIXTURE_FILE)).postIds)

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3001'

function randomFrom(array) {
  return array[Math.floor(Math.random() * array.length)]
}

// Good enough for a unique Idempotency-Key header in a load test — doesn't
// need to be cryptographically random, just distinct per request and valid
// per contracts' `z.string().uuid()`.
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Two tiers, run as two separate `k6 run -e CAMPAIGN_TIER=...` invocations
// (this directory's README documents both commands) rather than staged
// within one run: a clean, isolated summary per tier — matching how 1.3's
// own timeline-home.k6.js precedent reports its 50-VU and 1000-VU tiers as
// two distinct measurements — beats one combined run whose end-of-run
// aggregate metrics would blend a healthy tier's numbers into a saturated
// one's. "sustained" targets a combined attempted rate this sandbox's own
// 1.3 precedent (apps/api/load-tests/README.md) predicts it can mostly
// absorb (well under the ~400 req/s single-endpoint ceiling that precedent
// measured); "saturating" targets the full SPECS.md §14.3 ratio, which the
// same precedent predicts will saturate this single 4-vCPU container.
// preAllocatedVUs/maxVUs differ sharply between tiers because they must
// cover *concurrent in-flight requests*, not requests/s: an early
// combined-tier draft of this script measured ~1.9s avg latency per request
// once saturated, so sustaining the "saturating" tier's 500 iter/s on
// timeline_reads alone needs on the order of 500 * 1.9 ~= 950 concurrent VUs
// (Little's law) — undersizing this makes k6 itself silently drop iterations
// it can't schedule (a k6-side ceiling), which would understate the server's
// own real saturation point instead of measuring it.
const TIER = __ENV.CAMPAIGN_TIER === 'saturating' ? 'saturating' : 'sustained'

function stagesFor(target) {
  return [
    { target, duration: '10s' },
    { target, duration: '20s' },
    { target: 0, duration: '5s' },
  ]
}

const RATES = {
  sustained: { timeline_reads: 40, post_reads: 25, post_creates: 4, likes: 12 },
  saturating: { timeline_reads: 500, post_reads: 300, post_creates: 50, likes: 150 },
}
// preAllocatedVUs/maxVUs headroom per scenario per tier — generous in the
// saturating tier specifically so the measured ceiling reflects genuine
// server-side saturation, never k6 running out of VUs to schedule with (see
// the comment above).
const VU_BUDGET = {
  sustained: { timeline_reads: 60, post_reads: 40, post_creates: 15, likes: 30 },
  saturating: { timeline_reads: 1200, post_reads: 500, post_creates: 150, likes: 250 },
}

function scenarioFor(name, exec) {
  const target = RATES[TIER][name]
  const maxVUs = VU_BUDGET[TIER][name]
  return {
    executor: 'ramping-arrival-rate',
    exec,
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: Math.max(2, Math.ceil(maxVUs / 4)),
    maxVUs,
    stages: stagesFor(target),
  }
}

export const options = {
  scenarios: {
    timeline_reads: scenarioFor('timeline_reads', 'timelineReads'),
    post_reads: scenarioFor('post_reads', 'postReads'),
    post_creates: scenarioFor('post_creates', 'postCreates'),
    likes: scenarioFor('likes', 'likes'),
  },
  thresholds: {
    // k6 tags every metric with the scenario that produced it automatically
    // — no manual `tags:` needed on the requests below.
    'http_req_duration{scenario:timeline_reads}': ['p(95)<200'],
    'http_req_duration{scenario:post_reads}': ['p(95)<200'],
    // Does real work a read doesn't: entity parsing, a Postgres insert, an
    // idempotency round-trip through Redis, a Kafka publish for fan-out —
    // SPECS.md never states a per-endpoint write budget, 500ms is this
    // script's own, generous relative to the 200ms read budget it reuses
    // from 1.3/SPECS.md §14.1's general shape.
    'http_req_duration{scenario:post_creates}': ['p(95)<500'],
    'http_req_duration{scenario:likes}': ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
}

export function timelineReads() {
  const token = randomFrom(readerTokens)
  const res = http.get(`${BASE_URL}/v1/timeline/home?limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  check(res, { 'timeline read: status is 200': (r) => r.status === 200 })
}

export function postReads() {
  // Deliberately anonymous — no Authorization header. SPECS.md §14.3 itself
  // names this row's strategy as "Caché de objeto, CDN para anónimos": an
  // individual post read is the one row in the table whose real traffic is
  // dominated by logged-out visitors, and posts.routes.ts's GET /posts/:id
  // is `optionalAuth` precisely so that traffic never needs a token.
  const postId = randomFrom(postIds)
  const res = http.get(`${BASE_URL}/v1/posts/${postId}`)
  check(res, { 'post read: status is 200': (r) => r.status === 200 })
}

export function postCreates() {
  const token = randomFrom(writerTokens)
  const res = http.post(
    `${BASE_URL}/v1/posts`,
    JSON.stringify({
      text: `k6 load campaign vu${__VU} iter${__ITER} ${Math.random().toString(36).slice(2, 10)}`,
    }),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // A fresh key every call — this scenario measures write throughput,
        // not the idempotency-replay path (already covered by
        // posts.integration.test.ts).
        'Idempotency-Key': uuidv4(),
      },
    },
  )
  check(res, { 'post create: status is 201': (r) => r.status === 201 })
}

export function likes() {
  const token = randomFrom(readerTokens)
  const postId = randomFrom(postIds)
  const headers = { Authorization: `Bearer ${token}` }

  // 409 = this exact (reader, post) pair already liked it. A real, expected
  // outcome of interactions.routes.ts's own documented response set
  // (`createResponses` includes 409), not a bug: with more VUs than
  // readerTokens, several VUs share the same reader identity and can
  // legitimately race to like the same post — expectedStatuses keeps that
  // out of http_req_failed instead of masking it from the check() below.
  const likeRes = http.post(`${BASE_URL}/v1/posts/${postId}/like`, null, {
    headers,
    responseCallback: http.expectedStatuses(204, 409),
  })
  check(likeRes, { 'like: status is 204 or 409': (r) => r.status === 204 || r.status === 409 })

  // Unconditional cleanup, not conditioned on likeRes' status: DELETE is
  // documented as an idempotent no-op on a missing interaction (never
  // 404s), so this is safe whether the like above landed or lost the race —
  // and it's what keeps this (reader, post) pair reusable for the next
  // iteration instead of the 409 rate climbing over the life of the run.
  const unlikeRes = http.del(`${BASE_URL}/v1/posts/${postId}/like`, null, { headers })
  check(unlikeRes, { 'unlike: status is 204': (r) => r.status === 204 })
}
