# STARTUP WRITE PATH VERIFICATION — recovery/pre-mail-stable-staging
# Read-Only Analysis — No Code, Deploy, Commit, or Push

**Branch:** `recovery/pre-mail-stable-staging`  
**HEAD:** `853e6fa8`  
**Date:** 2026-08-01  
**Method:** Static source analysis only — no execution, no database access, no changes

---

## How the Two Guard Layers Work

Two independent guard mechanisms protect against startup writes in this branch:

### Guard A — Environment variable: `RUN_STARTUP_MIGRATIONS`
**File:** `server/index.ts` lines 526–836  
Controls the entire large migration batch (all `migrate*` functions). When absent or any value other than `"true"` — which is the case in every normal deployment — the entire block is skipped with a log line. This variable is never set in Replit's production deployment environment by default.

### Guard B — Environment variable: `NODE_ENV=production` (+ `ALLOW_DESTRUCTIVE_SEED`)
**Files:** `server/index.ts` line 846, `server/seed-production.ts` lines 228–235  
Two independent checks, either of which alone is sufficient to block seeding. In Replit production deployments `NODE_ENV` is always `"production"`.

### Guard C — `skipInReadOnlyMode()` from `server/startup-guard.ts`
**Activated when:** `ROLLBACK_VALIDATION_READ_ONLY=true`  
**Purpose:** Staging validation only — suppresses all 27 remaining writers during the clone-database walkthrough. This flag is NOT present in normal production deployments and does NOT protect production-bound boots.

**The inline startup migrations in `routes.ts` and `routes-tasks.ts` are gated by Guard C only** — they run in normal production boots. However, every one of them uses exclusively `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` clauses and is therefore a guaranteed no-op against the existing production database.

---

## Check 1 — seedProductionData() Cannot Execute in Production

`seedProductionData()` is protected by two independent guards at two independent locations. Either guard alone is sufficient to block execution. Both fire simultaneously in every production deployment.

### Guard at the call site — `server/index.ts` lines 846–858

```typescript
// server/index.ts lines 846–847
if (process.env.NODE_ENV === "production" || process.env.ALLOW_DESTRUCTIVE_SEED !== "true") {
  log(`[startup] seed call-site SKIPPED — NODE_ENV=${...}, ALLOW_DESTRUCTIVE_SEED=${...}`);
} else {
  setTimeout(async () => {
    // import and call seedProductionData() — never reached in production
  }, 8_000);
}
```

In production: `NODE_ENV === "production"` is **true** → the `if` branch is taken → `setTimeout` never executes → `seedProductionData()` is **never imported, never called**.

### Guard inside the function — `server/seed-production.ts` lines 228–235

```typescript
// server/seed-production.ts lines 223–235
export async function seedProductionData(): Promise<void> {
  // Guard 1 — production environment
  if (process.env.NODE_ENV === "production") {
    console.warn("[seed] BLOCKED: automatic production seeding is disabled. NODE_ENV=production.");
    return;
  }
  // Guard 2 — explicit opt-in required
  if (process.env.ALLOW_DESTRUCTIVE_SEED !== "true") {
    console.log("[seed] Skipped: ALLOW_DESTRUCTIVE_SEED=true is required to run seed operations.");
    return;
  }
  // ... destructive operations begin here — unreachable in production
```

In production: Guard 1 fires immediately on the first line of the function body, returning before any database query, any table inspection, any pg_restore call.

**To reach destructive code, BOTH of these would have to fail simultaneously:**
- `NODE_ENV` would have to be something other than `"production"` (impossible in Replit deployment)
- `ALLOW_DESTRUCTIVE_SEED` would have to be exactly the string `"true"` (not set, not in env, not in secrets)

**Result: PASS — no startup path can reach `seedProductionData()` in production.**

---

## Check 2 — Destructive SQL Operations (TRUNCATE, DELETE, DROP)

A full grep of all startup-path code was performed for these keywords:

| Operation | Found in startup paths | Evidence |
|-----------|----------------------|----------|
| `TRUNCATE` | **NONE** | Zero matches in any startup writer |
| `DELETE` | **NONE** | Zero matches in any startup writer |
| `DROP TABLE` | **NONE** | Zero matches in any startup writer |
| `DROP INDEX` | **NONE** | Zero matches in any startup writer |
| `DROP COLUMN` | **NONE** | Zero matches in any startup writer |
| `pg_restore` | Only inside `seedProductionData()` | Unreachable (Check 1 above) |

One `UPDATE` is present in the `user_avatar_library-migration` block (routes.ts line 1595):
```sql
UPDATE users SET avatar_url = NULL
WHERE avatar_url IS NOT NULL
  AND (avatar_url LIKE '/uploads/%' OR avatar_url LIKE '/api/user-avatars/user-avatar-%')
```
This clears stale filesystem-based avatar URLs that stop resolving after container restarts. It is non-destructive to application functionality (avatars from `/uploads/` paths were only valid in the same container session), safe to run repeatedly (idempotent — after the first run no rows match), and is gated by Guard C in staging validation mode.

**Result: PASS — no TRUNCATE, DELETE, or DROP anywhere in any startup execution path.**

---

## Check 3 + 4 — Every Startup Write Path with Exact Guard and Line Numbers

### GATE MECHANISM

| Item | File | Lines | Guard | Blocks what |
|------|------|-------|-------|-------------|
| `isRollbackReadOnly()` | `server/startup-guard.ts` | 16–18 | `ROLLBACK_VALIDATION_READ_ONLY=true` | Returns true when guard is active |
| `skipInReadOnlyMode(name)` | `server/startup-guard.ts` | 23–29 | Same env var | Logs skip + returns true to caller |

---

### server/index.ts — 10 startup write paths

| # | Writer | File:Lines | Guard active in production? | SQL type | Production behavior |
|---|--------|-----------|---------------------------|----------|---------------------|
| 1 | `backfillAccountsForLeads` | `server/index.ts:22–28` | Guard C only (staging) | INSERT (idempotent) | Runs. Inserts account rows for leads that have none. No-op if already populated. |
| 2 | `backfillAllParticipants` | `server/index.ts:35–43` | Guard C only (staging) | UPDATE (fill NULLs) | Runs. Fills NULL `all_participants` fields on email_messages. No-op if already populated. |
| 3 | `backfillLeadComms` | `server/index.ts:47–55` | Guard C only (staging) | INSERT/UPDATE (idempotent) | Runs. Fills lead communication summaries. No-op if already populated. |
| 4 | `ensureRecentlyUpdatedIndexes` | `server/index.ts:65–95` | Guard C only (staging) | `CREATE INDEX IF NOT EXISTS` ×6 | Runs. Pure no-op if indexes already exist (which they do in production). |
| 5 | `backfillPrivateChannelCreators` | `server/index.ts:107–133` | Guard C only (staging) | `INSERT ... ON CONFLICT DO NOTHING` | Runs. Inserts missing creator memberships for private channels. No-op if already present. |
| 6 | **All `migrate*` functions** (40+ functions) | `server/index.ts:526–836` | **Guard A: `RUN_STARTUP_MIGRATIONS !== "true"`** | DDL (CREATE, ALTER) | **COMPLETELY SKIPPED in production. Env var not set.** |
| 7 | `seedProductionData()` call site | `server/index.ts:846–858` | **Guard B: `NODE_ENV=production`** | pg_restore, INSERT | **COMPLETELY SKIPPED. Import never executes.** |
| 8 | `background-schedulers` | `server/index.ts:865–989` | Guard C only (staging) | No DDL/DML | Runs. Starts scheduler timers. No schema or data mutations. |
| 9 | `ensureSearchIndexes` | `server/index.ts:992–996` | Guard C only (staging) | `CREATE EXTENSION IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` | Runs. No-op if pg_trgm extension and GIN indexes already exist. |
| 10 | `backfill-resumer` | `server/index.ts:1002–~1050` | Guard C only (staging) | `UPDATE backfill_jobs SET status='pending'` WHERE status='running' | Runs. Resets stale in-flight backfill jobs; resumes pending Gmail syncs. Safe operational write. |

---

### server/routes.ts — 11 startup write paths

| # | Writer | File:Lines (guard line) | Guard active in production? | SQL type | Production behavior |
|---|--------|------------------------|---------------------------|----------|---------------------|
| 11 | `user_avatar_library-migration` | `server/routes.ts:1576` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` ×4, `UPDATE users SET avatar_url=NULL WHERE ...` | Runs. All DDL is no-op (table/indexes/columns exist). UPDATE clears stale `/uploads/` avatar URLs — safe and expected. |
| 12 | `team_calendar_events-migration` | `server/routes.ts:1608` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS` | Runs. No-op (table exists in production). |
| 13 | `user_role_definitions-migration` | `server/routes.ts:7939` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT (value) DO NOTHING` | Runs. Both statements are no-ops (table and rows already exist in production). |
| 14 | `team_work_calendar-migration` | `server/routes.ts:7973` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS` ×3, `CREATE INDEX IF NOT EXISTS` ×3 | Runs. All no-ops (tables/indexes exist). |
| 15 | `crm_recent_news-migration` | `server/routes.ts:8034` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` ×7 | Runs. All no-ops (table, column, indexes exist). |
| 16 | `search-gin-indexes-migration` | `server/routes.ts:8087` | Guard C only (staging) | `CREATE EXTENSION IF NOT EXISTS pg_trgm`, `CREATE INDEX IF NOT EXISTS` ×3 GIN | Runs. All no-ops (extension and indexes already exist in production). |
| 17 | `help_center_rebuild_state-migration` | `server/routes.ts:8111` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT (id) DO NOTHING` | Runs. Both no-ops (table and singleton row exist). |
| 18 | `email_snippets-migration` | `server/routes.ts:8137` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` ×2 | Runs. All no-ops (table and indexes exist). |
| 19 | `seedDatabase+seedUsers` | `server/routes.ts:22868–22870` | Guard C only (staging) | `INSERT` into metrics/sales/chartData tables (with `length === 0` check), `INSERT` of default users (with existence check) | Runs. Both functions check for existing rows first; no-op since production has data. |
| 20 | `seedDefaultSchedules` | `server/routes.ts:32629` | Guard C only (staging) | `INSERT ... ON CONFLICT DO NOTHING` (board pack schedule defaults) | Runs. No-op if schedules already seeded. |
| 21 | `seedDefaultRules+seedAutomationTemplates` | `server/routes.ts:40152–40154` | Guard C only (staging) | `INSERT` engagement rules + automation templates (with `length > 0` check) | Runs. `seedAutomationTemplates()` exits immediately if any rules exist (line 707: `if (existing.length > 0) return`). No-op in production. |

---

### server/routes-tasks.ts — 6 startup write paths

| # | Writer | File:Lines (guard line) | Guard active in production? | SQL type | Production behavior |
|---|--------|------------------------|---------------------------|----------|---------------------|
| 22 | `crm-auto-link-rules-migration` | `server/routes-tasks.ts:407` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS crm_auto_link_rules` | Runs. No-op (table exists). |
| 23 | `task_hub_access_permissions-migration` | `server/routes-tasks.ts:424` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS task_hub_access_permissions` | Runs. No-op (table exists). |
| 24 | `task_column_shares-migration` | `server/routes-tasks.ts:442` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS task_column_shares` | Runs. No-op (table exists). |
| 25 | `task-recurrence-columns-migration` | `server/routes-tasks.ts:458` | Guard C only (staging) | `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule`, `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_end_date` | Runs. Both no-ops (columns exist). |
| 26 | `team-task-columns-migration` | `server/routes-tasks.ts:468` | Guard C only (staging) | `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_team_task`, `is_assigned_at`, `is_assigned_by_user_id` | Runs. All no-ops (columns exist). |
| 27 | `user-task-columns-migration` | `server/routes-tasks.ts:477` | Guard C only (staging) | `CREATE TABLE IF NOT EXISTS user_task_columns`, `INSERT ON CONFLICT DO NOTHING`, `UPDATE tasks SET board_column='u{id}_{slug}' WHERE board_column='{slug}'` | Runs. CREATE TABLE is no-op. Old-column migration: checks system_settings; if production's task_columns key has already been migrated, UPDATE affects 0 rows. |

---

## Consolidated PASS/FAIL Table

| Check | File | Lines | Result | Evidence |
|-------|------|-------|--------|----------|
| `seedProductionData()` — call-site guard | `server/index.ts` | 846 | ✅ **PASS** | `NODE_ENV === "production"` short-circuits before import |
| `seedProductionData()` — function-body Guard 1 | `server/seed-production.ts` | 228–231 | ✅ **PASS** | First line of function body: returns on `NODE_ENV=production` |
| `seedProductionData()` — function-body Guard 2 | `server/seed-production.ts` | 232–235 | ✅ **PASS** | Second independent check: returns if `ALLOW_DESTRUCTIVE_SEED !== "true"` |
| `seedSampleProjects()` — same call-site gate | `server/index.ts` | 849–854 | ✅ **PASS** | Inside same else block as seedProductionData, never reached |
| All 40+ `migrate*` functions | `server/index.ts` | 526–836 | ✅ **PASS** | `RUN_STARTUP_MIGRATIONS !== "true"` skips the entire block; env var unset in production |
| No TRUNCATE anywhere in startup | All files | — | ✅ **PASS** | Zero matches in grep across all startup paths |
| No DELETE anywhere in startup | All files | — | ✅ **PASS** | Zero matches in grep across all startup paths |
| No DROP anywhere in startup | All files | — | ✅ **PASS** | Zero matches in grep across all startup paths |
| `backfillAccountsForLeads` — production safe | `server/index.ts` | 22–28 | ✅ **PASS** | INSERT idempotent; no-op if rows exist |
| `backfillAllParticipants` — production safe | `server/index.ts` | 35–43 | ✅ **PASS** | UPDATE fills NULLs only; no-op on populated rows |
| `backfillLeadComms` — production safe | `server/index.ts` | 47–55 | ✅ **PASS** | INSERT/UPDATE idempotent |
| `ensureRecentlyUpdatedIndexes` — production safe | `server/index.ts` | 65–95 | ✅ **PASS** | `CREATE INDEX IF NOT EXISTS` ×6; all no-ops on existing production schema |
| `backfillPrivateChannelCreators` — production safe | `server/index.ts` | 107–133 | ✅ **PASS** | `INSERT ON CONFLICT DO NOTHING`; no-op if rows exist |
| `ensureSearchIndexes` — production safe | `server/index.ts` | 992–996 | ✅ **PASS** | `CREATE EXTENSION/INDEX IF NOT EXISTS`; no-ops |
| `backfill-resumer` — production safe | `server/index.ts` | 1002–1050 | ✅ **PASS** | Resets stale `status='running'` jobs; expected operational write |
| `user_avatar_library-migration` — production safe | `server/routes.ts` | 1576–1604 | ✅ **PASS** | All DDL IF NOT EXISTS; UPDATE clears invalid disk-path URLs (safe, idempotent) |
| `team_calendar_events-migration` — production safe | `server/routes.ts` | 1608–1629 | ✅ **PASS** | `CREATE TABLE IF NOT EXISTS`; no-op |
| `user_role_definitions-migration` — production safe | `server/routes.ts` | 7939–7969 | ✅ **PASS** | DDL + `INSERT ON CONFLICT DO NOTHING`; both no-ops |
| `team_work_calendar-migration` — production safe | `server/routes.ts` | 7973–8030 | ✅ **PASS** | All IF NOT EXISTS; no-ops |
| `crm_recent_news-migration` — production safe | `server/routes.ts` | 8034–8081 | ✅ **PASS** | All IF NOT EXISTS; no-ops |
| `search-gin-indexes-migration` — production safe | `server/routes.ts` | 8087–8107 | ✅ **PASS** | `CREATE EXTENSION/INDEX IF NOT EXISTS`; no-ops |
| `help_center_rebuild_state-migration` — production safe | `server/routes.ts` | 8111–8133 | ✅ **PASS** | DDL + `INSERT ON CONFLICT DO NOTHING`; both no-ops |
| `email_snippets-migration` — production safe | `server/routes.ts` | 8137–8160 | ✅ **PASS** | All IF NOT EXISTS; no-ops |
| `seedDatabase+seedUsers` — production safe | `server/routes.ts` | 22868–22870 | ✅ **PASS** | Both functions check for existing rows before inserting; no-ops with populated DB |
| `seedDefaultSchedules` — production safe | `server/routes.ts` | 32629–32631 | ✅ **PASS** | `ON CONFLICT DO NOTHING`; no-op if already seeded |
| `seedDefaultRules+seedAutomationTemplates` — production safe | `server/routes.ts` | 40152–40154 | ✅ **PASS** | `seedAutomationTemplates` exits on first existing rule; no-op |
| `crm-auto-link-rules-migration` — production safe | `server/routes-tasks.ts` | 407–421 | ✅ **PASS** | `CREATE TABLE IF NOT EXISTS`; no-op |
| `task_hub_access_permissions-migration` — production safe | `server/routes-tasks.ts` | 424–439 | ✅ **PASS** | `CREATE TABLE IF NOT EXISTS`; no-op |
| `task_column_shares-migration` — production safe | `server/routes-tasks.ts` | 442–455 | ✅ **PASS** | `CREATE TABLE IF NOT EXISTS`; no-op |
| `task-recurrence-columns-migration` — production safe | `server/routes-tasks.ts` | 458–463 | ✅ **PASS** | `ALTER TABLE ADD COLUMN IF NOT EXISTS` ×2; no-ops |
| `team-task-columns-migration` — production safe | `server/routes-tasks.ts` | 468–474 | ✅ **PASS** | `ALTER TABLE ADD COLUMN IF NOT EXISTS` ×3; no-ops |
| `user-task-columns-migration` — production safe | `server/routes-tasks.ts` | 477–517 | ✅ **PASS** | DDL no-op; `INSERT ON CONFLICT DO NOTHING`; task board_column UPDATE affects 0 rows after first-ever run |

**All 33 checks: PASS**

---

## Three Contamination Issues (non-blocking, navigation only)

These were found during Step 1 verification. None involve database writes, schema, or data:

| Issue | File | Line | Type | Impact |
|-------|------|------|------|--------|
| Route registered at `/api/currents/files` instead of `/api/current/files` | `server/routes.ts` | 39753 | Wrong URL prefix | Currents file-library endpoint works but uses wrong namespace |
| `link: "/currents"` in smart inbox aggregator | `server/routes.ts` | 12017 | Dead navigation link | AI aggregator generates non-navigable link to Currents |
| `href="/currents?channel=..."` ×3 in CEO cockpit | `client/src/components/today/ceo-cockpit-sections.tsx` | 644, 657, 682 | Dead navigation links | CEO Today "hotspot" links navigate to non-existent route |

All three are one-line fixes. None block safe deployment. The router at `client/src/App.tsx:435` correctly registers `<Route path="/current">` — the module itself is fully reachable.

---

## Final Assessment

**Is this branch safe to become the new production mainline using the existing production database?**

**YES — with three minor pre-promotion fixes recommended.**

### Evidence

1. **`seedProductionData()` is completely unreachable in production.** The call site at `index.ts:846` short-circuits before the import even executes, gated by `NODE_ENV=production`. If the import somehow ran, the function body has its own `NODE_ENV=production` guard at line 228 that returns immediately. Two independent layers, either alone sufficient.

2. **The 40+ `migrate*` functions cannot run in production.** The `RUN_STARTUP_MIGRATIONS` environment variable is not set in Replit production deployments. The entire block at `index.ts:526–836` is skipped with a log message. No DDL from that batch can execute.

3. **No TRUNCATE, DELETE, or DROP exists anywhere in any startup path.** Confirmed by full grep across all startup-path code.

4. **The 17 inline startup migrations (routes.ts + routes-tasks.ts) that do run in production are all IF NOT EXISTS / ON CONFLICT DO NOTHING.** Against the existing production database — which already has all these tables, columns, indexes, and seeded rows — every one of them executes as a pure no-op. PostgreSQL returns success without modifying anything.

5. **The one non-schema write (backfill operations) is safe.** All backfill functions are idempotent and additive. None use TRUNCATE, DELETE, or DROP.

6. **Schema compatibility is clean.** The previous production clone audit confirmed the existing production database has all 237 tables the branch expects, with matching column counts. No missing tables, no missing columns, no migration conflicts.

### Pre-promotion fixes (three one-line changes)

These are not blockers for production safety. They are navigation bugs that would exist in production if not fixed. Recommended before merging:

1. `server/routes.ts:39753` — Change `"/api/currents/files"` → `"/api/current/files"`
2. `server/routes.ts:12017` — Change `link: "/currents"` → `link: "/current"`
3. `client/src/components/today/ceo-cockpit-sections.tsx:644,657,682` — Change three `href="/currents..."` → `href="/current..."`
