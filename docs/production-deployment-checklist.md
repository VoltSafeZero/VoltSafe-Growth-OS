# Production Deployment Checklist — Scalability Hardening

**Applies to:** Phase 1 + Phase 2 scalability changes  
**Last updated:** June 2026

---

## 1. Required Environment Variables

Set these in Replit Deployments → Secrets before deploying.

### Always required (no change from before)

| Variable | Value | Notes |
|---|---|---|
| `SESSION_SECRET` | 32+ character random string | Enforced fail-closed in production — app will not start without it |
| `DATABASE_URL` | Postgres connection string | Used by Drizzle ORM and `connect-pg-simple` session store |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | From Replit AI Integrations | Required for Cortex AI features |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | From Replit AI Integrations | Required for Cortex AI features |
| `GMAIL_PUBSUB_TOPIC` | Google Pub/Sub topic name | Required for Gmail push notifications |
| `GMAIL_WEBHOOK_TOKEN` | Random secret ≥ 32 chars | Validates incoming Gmail Pub/Sub pushes |

### New — scalability hardening

| Variable | Recommended value | What it does |
|---|---|---|
| `ENABLE_BACKGROUND_JOBS` | `true` | Enables Gmail sync, calendar sync, board-pack scheduler. Set to `false` on any replica that should not run background jobs. **Leave as `true` for a single-instance deploy.** |
| `NUM_WORKERS` | `0` (see §2) | Controls cluster mode. `0` = single process (default). Set to `2` only when moving to cluster mode. |
| `CSRF_ALLOWED_HOSTS` | *(empty unless needed)* | Comma-separated additional hostnames allowed in CSRF Origin/Referer check. Add staging domain if you test from a different subdomain. |

### What NOT to set

- Do **not** set `NODE_ENV=development` in production — it disables secure session cookies and HSTS.
- Do **not** set `ENABLE_BACKGROUND_JOBS=false` on your only instance — Gmail sync will stop.

---

## 2. Cluster Mode: Use Now or Later?

**Recommendation: do not enable cluster mode yet. Save it for the 200+ concurrent phase.**

**Why single-process is correct for now:**

The Phase 2 cache + coalescing brings the system to 100 concurrent with:
- p95 = 970 ms at full burst, 753 ms at steady state
- 0% error rate, 0 DB pool connections waiting
- The single process is not CPU-saturated at 100 concurrent (event loop lag = 0 ms)

Adding cluster mode now introduces complexity with no measured benefit at the current load level:
- The `/api/admin/performance` endpoint shows per-worker metrics only (each worker has its own ring buffer), so you lose a unified view
- Rate limiters (`aiGenerationRateLimiter`, `heavyAnalyticsRateLimiter`) are per-process — each worker gets its own independent counter, effectively doubling the rate limit per user
- The in-memory TTL cache is per-process — each worker maintains its own cache; during the first 30 seconds after a deploy, workers may independently cold-miss and re-warm in parallel

**When to enable cluster mode (200+ concurrent users):**

Change the production run command from:
```
NODE_ENV=production node dist/index.cjs
```
to:
```
NODE_ENV=production NUM_WORKERS=2 node dist/cluster-start.cjs
```

And set `ENABLE_BACKGROUND_JOBS=true` — the cluster entry point automatically sets it to `false` for all workers except worker 0.

At that point, also evaluate adding Redis for shared rate limiting and session storage.

---

## 3. Confirming TTL Cache is Working in Production

### Quick check: HTTP response headers

```bash
curl -sv -H "Cookie: connect.sid=<your-session>" \
  https://your-app.replit.app/api/metrics \
  -o /dev/null 2>&1 | grep -i "x-cache"
```

Expected output — first request:
```
< X-Cache: MISS
< X-Cache-TTL: 30
```

Second request (within 30 seconds):
```
< X-Cache: HIT
< X-Cache-TTL: 30
```

A `COALESCED` response means a peer request was computing at the same moment — this is correct behaviour under concurrent load.

### Via `/api/admin/performance`

Log in as an admin, then:
```bash
curl -b cookies.txt https://your-app.replit.app/api/admin/performance | jq .latency
```

Compare `latency.last5m.p95` before and after a period of usage. On a busy dashboard the cached endpoints should pull the overall p95 down significantly vs an un-cached system.

### What a broken cache looks like

- Every request returns `X-Cache: MISS` — the cache module failed to load (check startup logs for import errors)
- `X-Cache` header is absent entirely — the middleware was not applied to that route (check routes.ts)
- p95 returns to 800–1,300 ms for analytics endpoints — cache is hitting errors or TTL is too short

---

## 4. Running Smoke/Load Tests Against Production Safely

### Rules of engagement

1. **Off-hours only** — run load tests between 11 PM and 6 AM local time, or on a weekend, when real user activity is minimal.
2. **Use a dedicated test account** — create a test user (not a real sales rep account) so test traffic appears in logs but doesn't pollute CRM activity feeds.
3. **Never run spike.js against production without a maintenance window** — the 0→100 user ramp in 60 seconds is specifically designed to stress the system.
4. **Start with smoke.js** — always run the 5-user smoke test first to confirm the deployed build is healthy before escalating.

### Recommended test sequence

```bash
# Step 1: Smoke test — 5 users, 2 min — safe any time
k6 run -e BASE_URL=https://your-app.replit.app load-tests/smoke.js

# Step 2: Check performance endpoint after smoke
curl -b cookies.txt https://your-app.replit.app/api/admin/performance | jq .health

# Step 3: Normal load — 25 users, 10 min — run off-hours only
k6 run -e BASE_URL=https://your-app.replit.app load-tests/normal-load.js

# Step 4: Scale target — 100 users, ~12 min — run off-hours, announce beforehand
k6 run -e BASE_URL=https://your-app.replit.app load-tests/scale-target.js

# Step 5: Spike — only after scale-target passes, with a maintenance window
k6 run -e BASE_URL=https://your-app.replit.app load-tests/spike.js
```

### Abort criteria

Stop the test immediately and investigate if any of these appear during a run:
- `http_req_failed` rate rises above 1%
- DB pool `waitingCount` > 2 for more than 30 seconds (check `/api/admin/performance` in a separate terminal during the test)
- `eventLoopLagMs` exceeds 100 ms sustained
- Any 500-series errors visible in server logs

### Impact on real users during a test

The rate limiters (Phase 1) protect real users from test-generated AI generation and heavy analytics bursts. The cache (Phase 2) means test traffic to analytics endpoints actually *reduces* load on the DB for concurrent real users. Normal CRM list endpoints (leads, accounts) are the only surface where test traffic competes directly with real users — keep the test user's queries paginated to `limit=20`.

---

## 5. Weekly `/api/admin/performance` Checks

Log in as `master_admin`, open a terminal, and run:

```bash
curl -b cookies.txt https://your-app.replit.app/api/admin/performance | python3 -c "
import json,sys
d=json.load(sys.stdin)
h=d.get('health',{})
l=d.get('latency',{}).get('last5m',{})
pool=d.get('dbPool',{})
mem=d.get('memory',{})
print('=== Weekly Health Check ===')
print(f'Uptime:          {h.get(\"uptimeSeconds\",0)//3600}h {(h.get(\"uptimeSeconds\",0)%3600)//60}m')
print(f'Event loop lag:  {h.get(\"eventLoopLagMs\")} ms   (alert if > 50ms sustained)')
print(f'Error rate 5m:   {h.get(\"errorRate5mPct\")} %    (alert if > 1%)')
print(f'p50 / p95 / p99: {l.get(\"p50\")} / {l.get(\"p95\")} / {l.get(\"p99\")} ms')
print(f'DB pool waiting: {pool.get(\"waiting\")}   idle: {pool.get(\"idle\")} / {pool.get(\"total\")}   util: {pool.get(\"utilizationPct\")}%')
print(f'Heap:            {mem.get(\"heapUsedKb\",0)//1024} MB used / {mem.get(\"heapTotalKb\",0)//1024} MB total')
print(f'RSS:             {mem.get(\"rssKb\",0)//1024} MB')
"
```

### What to check and thresholds

| Metric | Healthy | Investigate | Alert |
|---|---|---|---|
| `eventLoopLagMs` | 0–10 ms | 10–50 ms | **> 50 ms sustained** |
| `errorRate5mPct` | 0% | < 0.5% | **> 1%** |
| `latency.last5m.p95` | < 400 ms | 400–800 ms | **> 800 ms sustained** |
| `latency.last5m.p99` | < 800 ms | 800–1,500 ms | **> 1,500 ms** |
| `dbPool.waiting` | 0 | 1–2 | **> 2 for 30+ seconds** |
| `dbPool.utilizationPct` | < 30% | 30–60% | **> 70%** |
| Heap used | < 300 MB | 300–450 MB | **> 500 MB** (possible leak) |
| RSS | < 500 MB | 500–700 MB | **> 800 MB** |
| Slow requests count | 0–5 | 5–20 | **> 20** (review `slowRequests` array) |

### What to do with slow requests

The `/api/admin/performance` response includes a `slowRequests` array (last 100 requests over 800 ms). If the count is elevated, review the paths:

- **Repeated same path** → that endpoint needs caching or query optimization
- **`/api/gmail/*` paths** → Gmail API latency; not actionable without Pub/Sub tuning
- **`/api/ai-*` or `/api/crm/ai-summary/*`** → OpenAI latency; check for burst patterns
- **`/api/leads` or `/api/accounts`** → DB query taking too long; check for missing WHERE clause filters or large result sets without pagination

---

## 6. Rollback Plan

Each Phase 2 change is independently reversible without a code deploy.

### If the TTL cache causes stale data complaints

The cache serves data for at most 30–60 seconds before expiring. Complaints are most likely from admins who just updated a record and expect instant dashboard refresh.

**Immediate mitigation (no deploy needed):** restart the app — this clears the in-memory store entirely.  
**Permanent fix:** reduce TTL constants in `server/cache.ts` (e.g., 30 s → 10 s), deploy.

The cache **never caches** user-specific endpoints (leads, accounts, inbox, activities). If stale data appears in those views, the cause is elsewhere.

### If HTTP compression causes client-side rendering issues

Compression is applied by the `compression` middleware in `server/index.ts`. It is automatic and respects `Accept-Encoding` headers — clients that don't support gzip receive uncompressed responses.

**To disable without a code deploy:** remove the `compression` middleware call from `server/index.ts` and redeploy. No env-var toggle exists (low risk, rarely needed).

### If `ENABLE_BACKGROUND_JOBS` was accidentally set to `false`

Gmail sync, calendar sync, and board-pack emails stop. No data is lost — the local mirror simply falls behind the live Gmail state.

**Fix:** set `ENABLE_BACKGROUND_JOBS=true` in Replit Secrets and redeploy (or restart the workflow). Gmail incremental sync will catch up automatically within 5 minutes.

**How to detect:** check the app logs for absence of `[gmail-sync]`, `[calendar]`, and `[board-pack-scheduler]` startup messages.

### If the performance endpoint (`/api/admin/performance`) returns errors

The instrumentation in `server/performance.ts` is read-only and does not affect request handling. An error here has zero impact on users.

**Fix:** the module is imported in `server/index.ts` — a syntax error in `performance.ts` would prevent app startup entirely (you'd see it in deployment logs). For a runtime error in the endpoint handler itself, it is wrapped in a try/catch and returns a 500, which does not affect any other route.

### Full rollback to pre-hardening state

If all else fails and you need to revert to the pre-Phase 1 state:

1. In Replit, use **Checkpoints** to restore the project to the snapshot taken before the hardening pass began.
2. Set `ENABLE_BACKGROUND_JOBS=true` (the old code does not have this gate but setting it won't hurt).
3. Redeploy.

No database migrations were added in either phase — schema is unchanged. The rollback is safe.

---

## 7. Final Recommended Production Settings for VoltSafe Growth OS

**For current scale (~100 concurrent users):**

```bash
# Required — always
SESSION_SECRET=<32+ char random secret>
DATABASE_URL=<postgres connection string>
AI_INTEGRATIONS_OPENAI_API_KEY=<from Replit AI Integrations>
AI_INTEGRATIONS_OPENAI_BASE_URL=<from Replit AI Integrations>
GMAIL_PUBSUB_TOPIC=<your topic>
GMAIL_WEBHOOK_TOKEN=<32+ char random secret>
NODE_ENV=production

# Scalability hardening — Phase 1 + Phase 2
ENABLE_BACKGROUND_JOBS=true   # single instance: always true
NUM_WORKERS=0                 # single process; upgrade to 2 at 200+ concurrent
```

**Production run command (unchanged):**
```
NODE_ENV=production node dist/index.cjs
```

**What you get with these settings:**
- TTL response cache active on all 7 heavy aggregation endpoints (automatic, no config needed)
- DB pool at 20 connections with headroom for background sync
- Rate limiters protecting AI generation (10/user/min) and heavy analytics (30/user/min)
- Background schedulers running for Gmail/calendar sync
- Gzip compression on all JSON responses
- Performance telemetry available at `GET /api/admin/performance`

**When to revisit these settings:**
- Sustained > 80 concurrent active users → evaluate `NUM_WORKERS=2` + cluster mode
- DB pool `waiting > 0` consistently → raise pool max to 30
- Heap memory growing without bound → check slow requests for uncached heavy endpoints
- Gmail sync falling behind (> 15-min delay) → investigate Pub/Sub push delivery health
```
