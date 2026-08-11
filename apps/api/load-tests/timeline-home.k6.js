// ROADMAP.md 1.3: "1000 timelines concurrentes, verificar p95 < 200 ms".
// Run seed-timeline-load.ts first — see this directory's README.md.
import { check } from 'k6'
import { SharedArray } from 'k6/data'
import http from 'k6/http'

const fixture = new SharedArray(
  'tokens',
  () => JSON.parse(open('./.timeline-load-fixture.json')).tokens,
)
const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3001'

export const options = {
  scenarios: {
    timeline_reads: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 1000 },
        { duration: '20s', target: 1000 },
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
}

export default function () {
  const token = fixture[Math.floor(Math.random() * fixture.length)]
  const res = http.get(`${BASE_URL}/v1/timeline/home?limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  check(res, { 'status is 200': (r) => r.status === 200 })
}
