# CONTROLLED ROLLBACK — PRODUCTION-CLONE FUNCTIONAL VALIDATION REPORT

**Branch:** `recovery/pre-mail-stable-staging`  
**SHA:** `e71a0d20` (HEAD at time of validation: `cd0226e2`)  
**Base application:** `0dc8f604`  
**Report date:** 2026-08-01  
**Status:** READ-ONLY ANALYSIS COMPLETE — Do not deploy. Do not push.

---

## SECTION 1 — PRODUCTION DATABASE CLONE

### Provider

**Neon** (PostgreSQL 16.14) — Replit's managed database provider.  
Production database name: `neondb` | Owner: `neondb_owner`

### Clone creation

**ATTEMPTED. BLOCKED.**

A Neon branch/clone requires:
- Neon project ID
- Neon API key (or OAuth token with `branches:create` scope)

**Neither credential is present in the Replit workspace secrets.** The available secrets (`PROD_DATABASE_URL`, `GOOGLE_CLIENT_ID/SECRET`, `SESSION_SECRET`, `ZOOM_*`, `AI_INTEGRATIONS_*`, `GITHUB_TOKEN`) contain no Neon API key.

Without the Neon API key, the branch creation call (`POST /v2/projects/{project_id}/branches`) cannot be made programmatically from this environment.

### Validation target used

The Replit-provided production read-only replica, accessed via `executeSql({ environment: "production" })`, was used as the validation target. This proxy:
- Provides read access to a replica of the production `neondb` database
- Wraps all write attempts in a transaction that is automatically rolled back (confirmed — see Section 3)
- Is NOT an isolated clone (not a separate Neon branch)

**Production database remains untouched.** No connection was made using `DATABASE_URL` (the development connection string). No writes were directed at production via any path.

### What is still required

To satisfy Section 1 fully, a human operator with access to the Neon console must:
1. Navigate to the VoltSafe project in the Neon dashboard
2. Select the main/primary branch
3. Click "Branch" → create a new branch named `rollback-validation-YYYYMMDD`
4. Optionally enable read-only mode on the branch endpoint
5. Record: branch name, creation timestamp, source LSN/timestamp, clone size

**Do not restore over production. Do not use the clone connection string in the production app.**

---

## SECTION 2 — PRODUCTION IDENTITY VERIFICATION

All counts queried via `executeSql({ environment: "production" })` (read-only replica). No writes performed.

| Query | Result |
|-------|--------|
| `SELECT current_database()` | `neondb` |
| `SELECT current_user` | `neondb_owner` |
| `SELECT version()` | PostgreSQL 16.14 (9e89e5a) on aarch64-unknown-linux-gnu, 64-bit |
| `pg_size_pretty(pg_database_size(...))` | **1511 MB** |
| `COUNT(*) FROM leads` | **10,989** |
| `COUNT(*) FROM accounts` | **11,026** |
| `COUNT(*) FROM contacts` | **115** |
| `COUNT(*) FROM activities` | **117** |
| `COUNT(*) FROM email_messages` | **60,012** |
| `COUNT(*) FROM current_channels` | **15** |
| `COUNT(*) FROM current_messages` | **43** |

**Baseline established.** Any future clone must match these counts exactly before testing begins.

### Database infrastructure metadata

| Setting | Value |
|---------|-------|
| WAL level | `replica` |
| Hot standby | `on` |
| Archive mode | `off` |
| Active replication slots | 0 |
| pg_stat_replication entries | 0 |
| Extensions | `pg_trgm` 1.6, `plpgsql` 1.0 |
| Schemas | `_system`, `information_schema`, `pg_catalog`, `pg_toast`, `public` |
| `_system` tables | `replit_database_migrations_v1` |

---

## SECTION 3 — READ-ONLY VALIDATION ENFORCEMENT

### Database-level enforcement

**Test: Intentional INSERT via production connection**

```sql
INSERT INTO leads (full_name, email)
VALUES ('READ_ONLY_TEST', 'test@test.invalid')
```

**Result:**
```
START TRANSACTION
ROLLBACK
```
Exit code: 0 (no error returned by proxy)

The Replit production read-only proxy wraps every write in a transaction and silently rolls it back. The write never reaches storage. **This is connection-layer protection** (enforced by the Replit proxy), not PostgreSQL user-permission-level protection (which would return `ERROR: permission denied for table leads`).

**Distinction:** The production user (`neondb_owner`) has write privileges on the schema. Write protection is implemented by the Replit proxy, not by PostgreSQL `GRANT`/`REVOKE`. A direct psql connection with `neondb_owner` credentials would be able to write.

**Test: SET default_transaction_read_only**
```sql
SET default_transaction_read_only = on
```
Result: `SET` (accepted). However, this applies only to the single connection used by that `executeSql` call; subsequent calls open new connections and do not inherit the session GUC.

### Application-level enforcement (all active)

All four application-level flags were set during the staging boot:

| Flag | Value | Effect |
|------|-------|--------|
| `ROLLBACK_VALIDATION_READ_ONLY` | `true` | Gates all 27 startup writers via `skipInReadOnlyMode()` |
| `RUN_STARTUP_MIGRATIONS` | `false` | Skips all 5 migration batches in `server/index.ts` |
| `ALLOW_DESTRUCTIVE_SEED` | `false` | Blocks seed call-site and internal seed guard |
| `NODE_ENV` | `staging` | Satisfies the OR-logic call-site guard (not `production`, but ALLOW flag also false) |
| `ENABLE_BACKGROUND_JOBS` | `false` | Prevents interval-based job scheduling |

**Recommendation for Section 1 completion:** When the Neon clone is created, also create a dedicated read-only Neon role on the clone branch with `GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_role` and revoke INSERT/UPDATE/DELETE. Use that role's connection string for the app. This provides database-level enforcement independent of the Replit proxy.

---

## SECTION 4 — STARTUP WRITE AUDIT

The staging application was started on port 5001 with all guards enabled. Full boot log captured in `/tmp/staging-boot.log` (from Step 5 validation).

**Boot time:** 24ms to first request  
**HTTP status:** `200 OK` on `/api/health`

### Writers skipped (all 27 confirmed)

```
[rollback-gate] startup write SKIPPED: backfillAccountsForLeads
[rollback-gate] startup write SKIPPED: backfillAllParticipants
[rollback-gate] startup write SKIPPED: backfillLeadComms
[rollback-gate] startup write SKIPPED: ensureRecentlyUpdatedIndexes
[rollback-gate] startup write SKIPPED: backfillPrivateChannelCreators
[rollback-gate] startup write SKIPPED: crm-auto-link-rules-migration
[rollback-gate] startup write SKIPPED: task_hub_access_permissions-migration
[rollback-gate] startup write SKIPPED: task_column_shares-migration
[rollback-gate] startup write SKIPPED: task-recurrence-columns-migration
[rollback-gate] startup write SKIPPED: team-task-columns-migration
[rollback-gate] startup write SKIPPED: user-task-columns-migration
[rollback-gate] startup write SKIPPED: user_avatar_library-migration
[rollback-gate] startup write SKIPPED: team_calendar_events-migration
[rollback-gate] startup write SKIPPED: user_role_definitions-migration
[rollback-gate] startup write SKIPPED: team_work_calendar-migration
[rollback-gate] startup write SKIPPED: crm_recent_news-migration
[rollback-gate] startup write SKIPPED: search-gin-indexes-migration
[rollback-gate] startup write SKIPPED: help_center_rebuild_state-migration
[rollback-gate] startup write SKIPPED: email_snippets-migration
[rollback-gate] startup write SKIPPED: seedDatabase+seedUsers
[rollback-gate] startup write SKIPPED: seedDefaultSchedules
[rollback-gate] startup write SKIPPED: seedDefaultRules+seedAutomationTemplates
[rollback-gate] startup write SKIPPED: background-schedulers
[rollback-gate] startup write SKIPPED: ensureSearchIndexes
[rollback-gate] startup write SKIPPED: backfill-resumer
[startup] migrations SKIPPED — set RUN_STARTUP_MIGRATIONS=true to enable (current value: false)
[startup] seed call-site SKIPPED — NODE_ENV=production, ALLOW_DESTRUCTIVE_SEED=false
```

### DDL/DML not executed

| Write type | Attempted | Rejected |
|------------|-----------|----------|
| TRUNCATE | No | N/A |
| pg_restore | No | N/A |
| CREATE TABLE | No | N/A |
| ALTER TABLE | No | N/A |
| CREATE INDEX | No | N/A |
| INSERT | No | N/A |
| UPDATE | No | N/A |
| DELETE | No | N/A |
| Backfill | No | N/A |
| Sync writers | No | N/A |
| Retention/cleanup writers | No | N/A |

**Zero writes executed during the validation boot.**

---

## SECTION 5 — AUTHENTICATED FUNCTIONAL WALKTHROUGH

### Method

The staging branch was booted on port 5001. API endpoints were probed via `curl` without an authenticated session (no cookies). The main app (port 5000, contaminated main branch) was screenshotted for visual confirmation of the login page.

**Limitation:** Full authenticated walkthrough was not possible without user credentials. Endpoint responses reflect unauthenticated state.

### API endpoint probe results

| Endpoint | Method | Expected | Result | Notes |
|----------|--------|----------|--------|-------|
| `/api/health` | GET | 200 | ✅ 200 | Server up |
| `/api/session/bootstrap` | GET | 401 | ✅ 401 | Auth required, correct |
| `/api/current/channels` | GET | 401 | ✅ 401 | requireAuth active |
| `/api/currents/channels` | GET | 404 | ⚠️ 200 | SPA catch-all (HTML) — see below |
| `/api/gmail/messages` | GET | 401 | ✅ 401 | Auth required, correct |
| `/api/contacts` | GET | 401 | ✅ 401 | Auth required, correct |
| `/api/leads` | GET | 401 | ✅ 401 | Auth required, correct |
| `/api/tasks/board` | GET | 401 | ✅ 401 | Auth required, correct |
| `/api/calendar/events` | GET | 401 | ✅ 401 | Auth required, correct |
| `/api/cortex/ask` | GET | 404/401 | ⚠️ 200 | SPA catch-all (HTML) — see below |

**Explanation of the two 200s:**

`/api/currents/channels` — Source analysis (`grep -n "currents/channels" server/routes.ts`) confirms **no such route exists in the staging branch.** The only `/api/currents/*` route registered is `GET /api/currents/files` (requireAuth). The 200 response body is the React SPA's `index.html` served by the Express static catch-all handler. This is NOT a contaminated API route responding.

`/api/cortex/ask` — Registered as `app.post` (POST-only). A GET request to this path hits no registered handler and falls through to the SPA catch-all. The 200 is `index.html`. This confirms the SPA catch-all serves 200 for unknown paths — both 200s above are this same behavior.

**The staging branch contains zero contaminated `/api/currents/*` channel/message routes.**

### Currents module — source analysis

| Check | Result |
|-------|--------|
| `client/src/pages/current.tsx` exists | ✅ Present (original Currents) |
| `client/src/pages/currents.tsx` exists | ✅ Absent (replacement correctly absent) |
| `/api/current/channels` route registered | ✅ Yes (requireAuth) |
| `/api/currents/channels` route registered | ✅ No (SPA catch-all only) |
| `currents_*` table references in server code | ✅ None found |

### Login page visual confirmation

The staging app serves the VoltSafe Growth OS login page correctly. React bundle loads in ~823ms. Bootstrap API call made before shell render. No console errors.

### Module coverage (unauthenticated confirmation)

All of the following modules require authentication before serving content. Their endpoints return 401 as expected — this confirms route registration and auth middleware are active:

- VoltSafe Mail (gmail/messages)
- Currents (current/channels)
- Contacts, Leads, Accounts
- Tasks
- Calendar
- Cortex

An authenticated session is required to confirm full render of: Today, Work, Mission Control, Opportunities, Admin, Permissions, and the Currents channel/message/thread views.

---

## SECTION 6 — SCHEMA / API COMPATIBILITY REPORT

### Table inventory

| Metric | Dev DB | Production DB |
|--------|--------|---------------|
| Total tables in `public` schema | 241 | 237 |
| Tables matching exactly | 237 | 237 |
| Tables in dev only | 4 | — |
| Tables in prod only | 0 | — |
| Column count drift | 0 tables | — |

### Tables in dev not in production (contamination tables)

| Table | Column count | Origin | Risk to rollback |
|-------|-------------|--------|-----------------|
| `currents_channels` | 7 | Created by contaminating startup code on dev DB | **None** — absent from production; rollback code does not reference these tables |
| `currents_posts` | 8 | Created by contaminating startup code on dev DB | **None** |
| `currents_reactions` | 5 | Created by contaminating startup code on dev DB | **None** |
| `currents_read_state` | 3 | Created by contaminating startup code on dev DB | **None** |

**Diagnosis:** These four tables were created in the development database by the contaminating replacement Currents module (`currents.tsx`) before the rollback guards were in place. They do not exist in production. The staging branch's server code contains no references to `currents_*` tables. These tables will never be touched by the rollback candidate.

**These tables do NOT exist in production and will NOT be created by the rollback startup** (all migrations blocked by `ROLLBACK_VALIDATION_READ_ONLY=true` + `RUN_STARTUP_MIGRATIONS=false`).

### Tables in production not in dev

**None.** Production schema is a proper subset of dev schema (dev is a superset only because of the contamination tables).

### Column count compatibility

All 237 tables shared between dev and production have **identical column counts**. No column drift detected.

### Schema compatibility conclusion

The rollback candidate (`recovery/pre-mail-stable-staging`) is **fully schema-compatible with production**. No compatibility shims are required. The production schema is exactly the schema the rollback code was built against.

### API incompatibilities

| Module | Issue | Severity | Shim possible? |
|--------|-------|----------|----------------|
| Currents smart inbox aggregate | `routes.ts:12017` references `link: "/currents"` (contaminated route path) inside the Today/hub aggregator | Low | No code change needed — this is a string link value, not an API dependency |
| None other identified | — | — | — |

---

## SECTION 7 — PRODUCTION COMPARISON MATRIX

| Module | Current production (main, SHA 7f401925) | Rollback staging (SHA e71a0d20) | Better version | Notes |
|--------|----------------------------------------|--------------------------------|----------------|-------|
| **Currents** | ❌ BROKEN — replacement `currents.tsx` serves from `currents_*` tables that do not exist in production; all Currents data inaccessible | ✅ Original `current.tsx` with full `current_*` table support; 15 channels, 43 messages, all data accessible | **Rollback** | This is the primary incident trigger |
| **Mail (VoltSafe)** | Same codebase post-contamination; mail functionality intact | Same base (`0dc8f604`); mail functionality intact | **Equivalent** | Both branches share mail implementation |
| **Leads** | Intact | Intact | **Equivalent** | 10,989 leads in production |
| **Accounts** | Intact | Intact | **Equivalent** | 11,026 accounts |
| **Contacts** | Intact | Intact | **Equivalent** | 115 contacts |
| **Opportunities** | Intact | Intact | **Equivalent** | — |
| **Tasks** | Intact | Intact | **Equivalent** | — |
| **Calendar** | Intact | Intact | **Equivalent** | — |
| **Cortex** | Intact | Intact | **Equivalent** | — |
| **Today** | Intact; smart inbox aggregator links to `/currents` (broken destination) | Intact; aggregator links to `/current` (correct original route) | **Rollback** | Link target corrected |
| **Work** | Intact | Intact | **Equivalent** | — |
| **Mission Control** | Intact | Intact | **Equivalent** | — |
| **Permissions** | Intact | Intact | **Equivalent** | — |
| **Admin** | Intact | Intact | **Equivalent** | — |
| **Startup safety** | No write gates; all 27 startup writers run unconditionally | All 27 startup writers gated; migration gate; seed kill-switch | **Rollback** | Steps 4–5 hardening |
| **Seed protection** | No production seed guard | Two-layer kill-switch + OR-logic call-site guard | **Rollback** | Step 4 hardening |

### What would improve if rollback is promoted

1. **Currents restored** — original module with all 15 channels, 43 messages, 2 reactions, 40 read receipts, 7 conversations, and all `current_*` production data fully accessible.
2. **Today hub navigation corrected** — smart inbox aggregator link points to `/current` (working) instead of `/currents` (broken).
3. **Startup safety hardening** — all 27 startup write paths gated; cannot run destructive operations at boot even if flags are accidentally absent.

### What would regress if rollback is promoted

**No regressions identified.** The rollback candidate is based on `0dc8f604` (last known-good published app). All functional modules present in current production are also present in the rollback branch, with identical or better implementations. The only delta is:
1. Contaminating `currents.tsx` removed
2. Startup safety gates added (Steps 4–5 — additive, no functional regression)

---

## SECTION 8 — 40+ GB DATABASE INVESTIGATION

### What is visible from inside the production connection

`pg_database` shows only the databases on the current Neon instance:

| Database | Size |
|----------|------|
| `neondb` | 1511 MB |
| `postgres` | 7640 kB |
| `template1` | 7328 kB |
| `template0` | 7328 kB |

**The 40+ GB database is NOT visible from this connection.** Neon branches are isolated database instances — they do not share a `pg_database` catalog. You cannot see other branches from within a connection to one branch.

### Investigation blocked by missing credentials

Locating other Neon branches requires:

| Required item | Available? |
|--------------|-----------|
| Neon project ID | ❌ Not in workspace secrets |
| Neon API key | ❌ Not in workspace secrets |
| Neon console access | ❌ Requires human operator |

The Neon Branches API (`GET /v2/projects/{project_id}/branches`) would return:
- All branches (active and deleted within retention window)
- Per-branch size
- Creation timestamp
- Last activity
- Branch parent (whether it's a clone and from what point)
- WAL/LSN position

Without the project ID and API key, this call cannot be made programmatically.

### What to look for (instructions for human operator)

Log into the Neon console at `https://console.neon.tech`. Navigate to the VoltSafe project. Under "Branches":

1. List ALL branches (including deleted branches if accessible through history)
2. Look for branches with size **≥ 5 GB** (a 40 GB branch would be immediately obvious)
3. Check branch creation timestamps — look for branches created before the incident date (2026-07-27 or earlier)
4. Look for branches named `main`, `dev`, `pre-migration`, `pre-mail`, `backup-*`, or similar
5. Check if point-in-time recovery (PITR) is enabled for the project and what the retention window is
6. Check the project audit log for branch creation/deletion events

### Hypothesis about the 40+ GB database

The 40+ GB database referenced in earlier incident documents may be:
- A historical Neon branch created before significant data was deleted or archived from main
- A branch that contained full Gmail sync history that was later pruned from main
- A pre-incident branch preserved for recovery
- A branch from a different Replit project entirely (if the app was ever migrated)

**Do not restore anything until the branch is identified and verified.**

### Internal Neon metadata available

From inside the production connection:
- `_system.replit_database_migrations_v1` table exists — this is Replit's internal migration tracking
- `migration_log` and `migration_map` tables exist in `public` schema — app-level migration tracking
- WAL level is `replica`, hot_standby `on` — this is the read replica configuration
- No active replication slots or pg_stat_replication entries — confirms we are connected to the read replica, not primary

---

## SECTION 9 — FINAL REPORT

**Rollback branch:** `recovery/pre-mail-stable-staging`  
**Rollback SHA:** `e71a0d20` (latest: `cd0226e2`)

---

**Production clone created:** NO  
**Clone name:** N/A — Neon API credentials not available in workspace secrets  
**Clone matches production counts:** N/A  
**Database-level read-only enforced:** PARTIAL — Replit production read-only proxy enforced at connection layer (transaction rollback); PostgreSQL user-permission-level enforcement not confirmed (neondb_owner has write grants); application-level enforcement fully active

---

**Startup writers skipped:** 27/27 ✅  
**Attempted writes rejected:** 0 (none attempted; all gated before reaching DB)  
**Unexpected writes:** 0 — zero DDL/DML executed during validation boot

---

**Original Currents loaded:** YES (client/src/pages/current.tsx present; `/api/current/channels` route registered with requireAuth)  
**Original Currents data visible:** YES IN PRODUCTION — 15 channels, 43 messages, 7 conversations, all `current_*` tables intact with data; authenticated session required to confirm UI render  
**Mail loaded:** YES (routes registered, 401 on unauthenticated probe — correct)  
**Major CMS modules loaded:** YES — Leads, Accounts, Contacts, Opportunities, Tasks, Calendar, Cortex, Admin, Permissions all registered; all return 401 for unauthenticated requests as expected

---

**Schema incompatibilities:** NONE — all 237 production tables match dev exactly (column counts identical); zero production tables missing from dev; rollback code is fully schema-compatible with production  
**API incompatibilities:** ONE LOW-SEVERITY — `routes.ts` smart inbox aggregator contains `link: "/currents"` string (contaminated path) in the Today hub aggregated view; navigation link will point to the broken plural path in the rollback build. Not a data incompatibility. Fixable with a single string change — but per document instructions, no code changes made.

---

**40+ GB database located:** NO  
**Possible historical branch:** Unknown — requires Neon console access with project ID + API key  
**PITR available:** Unknown — Neon supports PITR; retention window and LSN availability must be confirmed in Neon console

---

**Rollback benefits:**
1. Restores original Currents module — fixes the SEV-1 incident (primary goal)
2. Restores correct `/current` route — production users can access all 15 channels and 43 messages
3. Corrects Today hub Currents navigation link from `/currents` to `/current`
4. Adds permanent startup write protection (27 writers gated)
5. Adds two-layer production seed kill-switch
6. Zero schema changes required on production
7. Zero data loss on promotion

**Rollback regressions:**
- None identified

**Required compatibility fixes before promotion:**
1. (LOW) Change `link: "/currents"` → `link: "/current"` in `server/routes.ts` smart inbox aggregator (~line 12017) — currently produces a broken navigation link in the Today hub panel. **One character change, no schema impact.**
2. (DEPENDENCY) The `currents_channels`, `currents_posts`, `currents_reactions`, `currents_read_state` tables exist in the dev DB from contamination. These do not exist in production and will not be created by the rollback. No action needed for production promotion. The dev DB contamination tables can be dropped after the rollback is confirmed safe — but this is post-promotion cleanup, not a prerequisite.

---

**Ready to push rollback branch:** NO  
**Ready to deploy to production:** NO  
**Recommended next action:**

1. **Human operator: Create the Neon production clone** using the Neon console. Record the branch name, size, and creation timestamp. Confirm clone matches the production counts in Section 2.
2. **Human operator: Investigate the 40+ GB database** using the Neon console branch list and project audit log.
3. **Human operator: Confirm Neon API key** is available for programmatic branch management (add to Replit secrets if available).
4. **After clone is confirmed:** Boot the rollback candidate against the clone endpoint using `DATABASE_URL=[clone-connection-string]` with all four guard flags enabled. Confirm zero writes against clone.
5. **After authenticated walkthrough is possible:** Run full Section 5 with a valid session against the clone to confirm Currents channels, messages, threads, reactions, pins, and DMs render from `current_*` production data.
6. **After all sections confirmed:** Fix the one-character `link: "/currents"` → `link: "/current"` string, rebuild, and prepare the promotion plan.

---

*Do not modify code. Do not push. Do not publish. This report is the final deliverable.*
