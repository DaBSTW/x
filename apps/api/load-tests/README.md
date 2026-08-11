# Timeline read load test

Verifies ROADMAP.md 1.3's "1000 timelines concurrentes, p95 < 200 ms" against
a real API process, real Postgres, and real Redis — no mocks.

```bash
# 1. Local infra (matches docker-compose.yml)
docker compose up -d postgres redis
pnpm --filter @x/db db:migrate

# 2. Seed 100 readers with a warmed timeline + signed tokens.
#    Writes .timeline-load-fixture.json (gitignored) with a JWT keypair —
#    the API process in step 3 must use the exact same one.
pnpm --filter @x/api exec tsx load-tests/seed-timeline-load.ts 100

# 3. Start the API with that keypair (jq pulls the PEMs out of the fixture).
JWT_ACCESS_PRIVATE_KEY=$(jq -r .privateKeyPem apps/api/load-tests/.timeline-load-fixture.json) \
JWT_ACCESS_PUBLIC_KEY=$(jq -r .publicKeyPem apps/api/load-tests/.timeline-load-fixture.json) \
  pnpm --filter @x/api exec tsx src/server.ts &

# 4. Run k6.
k6 run apps/api/load-tests/timeline-home.k6.js
```

## Real runs, this sandbox (4 vCPUs total, shared with Postgres/Redis/k6 itself)

| VUs  | p95      | avg      | throughput | http_req_duration threshold |
| ---- | -------- | -------- | ---------- | ---------------------------- |
| 50   | 134.4 ms | 101.2 ms | ~407 req/s | ✓ passes                     |
| 1000 | 2.57 s   | 2.09 s   | ~385 req/s | ✗ fails (budget: 200 ms)     |

0% request failures at both concurrency levels — every response was a
correct, fully-hydrated 200. At 50 VUs the single `ZREVRANGEBYSCORE` +
batched `WHERE id = ANY($1)` read is well under budget. At 1000 VUs,
throughput barely moved (~385 vs. ~407 req/s) while latency grew ~19x —
the signature of queueing for CPU, not a slow query: one unclustered Fastify
process and Postgres/Redis are all fighting over the same 4 cores this
container has. SPECS.md §14 assumes horizontal scaling (multiple API
instances behind a load balancer, PgBouncer, Redis replicas) for exactly
this reason — "1000 concurrent, p95 < 200 ms" is a claim about that
provisioned topology, and this single-container sandbox can't stand in for
it. Re-run against a real multi-core / multi-instance deployment to certify
the number; what's verified here is that the code path itself is fast and
correct, and that it degrades predictably (not incorrectly) under
contention.

The 50k-QPS scenario SPECS.md §14 also asks for (`Timeline a 50k QPS`) needs
the same provisioned infrastructure to be meaningful — not attempted here.
