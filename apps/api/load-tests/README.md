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

## Full traffic-mix load campaign (ROADMAP.md 3.4h)

Verifies SPECS.md §14.3's full "cargas típicas y capacidad" table — all four
rows (timeline reads, individual post reads, post creation, likes) exercised
*concurrently* against one real API process, real Postgres, real Redis, not
one endpoint in isolation like the timeline-only test above. Each scenario's
target arrival rate is that row's peak QPS divided by 100
(50000:30000:5000:15000 → 500:300:50:150) — the ratio SPECS.md actually
specifies, scaled down to a range this sandbox can meaningfully attempt.

```bash
# 1. Local infra (matches docker-compose.yml)
docker compose up -d postgres redis
pnpm --filter @x/db db:migrate

# 2. Seed 300 readers + 50 writers + 10 target posts + signed tokens.
#    Writes .load-campaign-fixture.json (gitignored) with its own JWT
#    keypair — the API process in step 3 must use the exact same one.
pnpm --filter @x/api exec tsx load-tests/seed-load-campaign.ts

# 3. Start the API with that keypair, and a raised new-account posting cap:
#    the campaign's 50 writer accounts post far faster than the real 24h
#    window trust-score.ts's NEW_ACCOUNT_MAX_POSTS_PER_DAY (10) assumes —
#    same "compressing a day's cadence into a short run" fix
#    posts.integration.test.ts already uses for its own shared test author.
JWT_ACCESS_PRIVATE_KEY=$(jq -r .privateKeyPem apps/api/load-tests/.load-campaign-fixture.json) \
JWT_ACCESS_PUBLIC_KEY=$(jq -r .publicKeyPem apps/api/load-tests/.load-campaign-fixture.json) \
NEW_ACCOUNT_MAX_POSTS_PER_DAY=100000 \
  pnpm --filter @x/api exec tsx src/server.ts &

# 4. Run k6 — two separate tiers, on purpose (see below).
k6 run -e CAMPAIGN_TIER=sustained  apps/api/load-tests/load-campaign.k6.js
k6 run -e CAMPAIGN_TIER=saturating apps/api/load-tests/load-campaign.k6.js
```

Two tiers, run as two separate invocations rather than staged within one
run, for a clean, unconfounded summary per tier: **sustained** targets a
combined attempted rate (81 req/s) well under this directory's own
timeline-only precedent's ~400 req/s single-endpoint ceiling above;
**saturating** targets the full SPECS-proportional rate (1000 req/s
combined).

### Real runs, this sandbox (same 4 vCPUs, shared with Postgres/Redis/Kafka/k6 itself)

**Sustained tier — comfortably inside budget**

| Scenario | Target rate | p95 | avg | Threshold |
| --- | --- | --- | --- | --- |
| timeline_reads | 40/s | 18.2 ms | 12.4 ms | ✓ (< 200 ms) |
| post_reads | 25/s | 12.4 ms | 7.6 ms | ✓ (< 200 ms) |
| post_creates | 4/s | 29.7 ms | 20.2 ms | ✓ (< 500 ms) |
| likes | 12/s | 14.4 ms | 7.1 ms | ✓ (< 200 ms) |

100% checks passed (2554/2554), 0% request failures, ~72.9 req/s combined
throughput, every scenario tracked its target rate exactly with no dropped
iterations. The mixed traffic shape — reads and writes contending for the
same Postgres/Redis, not one endpoint in isolation — has ample headroom at
this rate on this single 4-vCPU container.

**Saturating tier — the full SPECS.md §14.3 ratio**

| Scenario | Target rate | p95 | avg | Threshold |
| --- | --- | --- | --- | --- |
| timeline_reads | 500/s | 9.01 s | 7.34 s | ✗ (< 200 ms) |
| post_reads | 300/s | 5.58 s | 4.50 s | ✗ (< 200 ms) |
| post_creates | 50/s | 7.37 s | 6.16 s | ✗ (< 500 ms) |
| likes | 150/s | 5.42 s | 2.89 s | ✗ (< 200 ms) |

100% checks passed (11330/11330), **0% request failures**, ~297 req/s
combined throughput — *up* from ~72.9 req/s at the sustained tier, so this
isn't a wall the server refuses past, it's the same predictable
CPU-contention degradation this directory's timeline-only precedent already
found for one endpoint (throughput barely grows while latency balloons),
now confirmed for the full read+write mix. Even at 2100 max VUs allocated —
sized generously via Little's law (rate × latency) specifically so k6's own
concurrency ceiling would never be the bottleneck actually being measured —
k6 still had to drop ~17.5k iterations (~458/s) it couldn't schedule fast
enough to offer, because sustaining a fixed high arrival rate against an
already-saturated single node requires *unboundedly growing* concurrency as
latency grows: exactly why real infrastructure doesn't try to do this on one
node, it scales horizontally instead (SPECS.md §14 assumes multiple API
instances, PgBouncer, Redis/Postgres replicas). What's verified here is that
under genuine multi-second queueing this system degrades by getting slower,
not by corrupting data or crashing outright.

**A real bug found and fixed by this campaign, not just documented as a
known gap.** The first run at this tier surfaced 34 real HTTP 500s (0.15%
of requests, all `PostgresError: duplicate key value violates unique
constraint "likes_user_id_post_id_pk"`). `interactions.service.ts`'s
`like()`/`bookmark()` each did a plain `findX()`-then-`insertX()` check —
correct sequentially, but genuinely racy under real concurrency: two
requests for the same (userId, postId) can both pass the find before either
commits its insert. Postgres always caught the second one correctly via its
own unique constraint; nothing translated that into the `ConflictError`
(409) the routes' own response schema already promised, so it fell through
to a raw 500 instead — a real production bug (a user double-tapping "like"
on a slow connection hits this exact race), not a load-test artifact. Fixed
with `@x/db`'s new `isUniqueConstraintViolation` helper
(`packages/db/src/errors.ts`) plus a matching integration test
(`interactions.integration.test.ts`'s two new "N concurrent likes/bookmarks
for the same user+post" tests — 10 concurrent requests at a fresh (user,
post) pair, asserting exactly one 204 and nine 409s, reproducing the race
directly rather than trusting the fix by inspection). Re-run after the fix,
same tier, same target rate: **0 request failures, 100% checks
(11330/11330)** — the table above is from that post-fix run.

### What this campaign does not attempt

- **The literal 50k/30k/5k/15k QPS figures.** Like this directory's own 1.3
  precedent already found for one endpoint, that number describes SPECS.md
  §14's horizontally-scaled topology (multiple API instances behind a load
  balancer, PgBouncer, read replicas) — not something a single 4-vCPU
  container can stand in for. What's verified here is that the code paths
  are correct and degrade predictably, at both a sustainable rate and a
  saturating one, for the *full mixed* traffic shape.
- **A read replica in the loop.** `DATABASE_REPLICA_URLS` is unset for this
  campaign (docker-compose.yml's own local-dev default), so every read here
  contends with every write on one Postgres instance. In the topology
  ROADMAP.md 3.4d actually built, the three read-heavy scenarios here (85%
  of this campaign's combined target rate) would run against separate
  replica hardware — so if anything, this campaign's saturation point is a
  pessimistic lower bound relative to the real topology, not an optimistic
  one.
- **Fan-out's 1M ops/s.** SPECS.md §14.3 names this as a *consequence* of
  the 5000 posts/s row (5000 × avg 200 followers), not something k6 drives
  as HTTP traffic — it happens inside apps/workers' fan-out worker,
  triggered by post_creates above, not measured directly by this script.
