# ISOLATED DATABASE CLONE — PRE-FLIGHT GATE REPORT
# Five-Day Rollback Validation

**Date:** 2026-08-01  
**Branch:** `recovery/pre-mail-stable-staging`  
**Instruction:** Make no changes — stop after this report.

---

## Summary Table

| Gate | Result | Evidence | Blocker |
|------|--------|----------|---------|
| 1 — Production DB connection | ❌ HARD FAIL | `PROD_DATABASE_URL` scheme is `https://`, not `postgresql://` | No valid PostgreSQL production connection string is accessible |
| 2 — Dev cluster capacity | ⚠️ WARN / UNCERTAIN | PostgreSQL data volume is an unresolvable mount; pmem5 (suspected data volume) shows 0 bytes free; /tmp has 32 GB free | Cannot guarantee safe capacity for a 2 GB clone on the dev cluster |
| 3 — Client / version compatibility | ⚠️ PARTIAL | Client tools 16.10, dev server 16.10; production server version unknown (cannot connect) | Gate 1 must pass before Gate 3 can be completed |
| 4 — Isolation proof | ✅ PASS | Clone DB does not exist; no env var or process references it | None |
| 5 — Safe command plan | 📋 WRITTEN | Commands documented; blocked from execution by Gate 1 | Requires `PRODUCTION_DATABASE_URL` before commands can be issued |

---

## HARD FAIL — DO NOT CREATE CLONE

**Primary blocker: Gate 1.** The workspace has no valid PostgreSQL connection string for the production database. All subsequent gates that require connecting to production (Gates 2 partial, 3, 5 execution) are blocked by this single root cause.

---

## Gate 1 — Production Database Connection ❌ HARD FAIL

### Finding

The secret `PROD_DATABASE_URL` exists in the Replit workspace and is available as an environment variable. However:

| Property | Value |
|----------|-------|
| Secret name | `PROD_DATABASE_URL` |
| Scheme | `https` |
| Is valid PostgreSQL URL | **NO** |
| Conclusion | This is the production **web application URL**, not a database connection string |

A PostgreSQL connection string must begin with `postgresql://` or `postgres://`. An `https://` URL is a web endpoint — `pg_dump`, `psql`, and `pg_restore` cannot use it. Attempting `pg_dump "$PROD_DATABASE_URL"` would immediately fail.

### What Trevor must do

The real production database connection string must be obtained and added to the workspace as a **new secret** named `PRODUCTION_DATABASE_URL`.

**Where to find it in the Replit UI:**

1. In the Replit workspace, click **Database** in the left sidebar (cylinder icon)
2. At the top of the Database pane, look for a **Production** tab or toggle (next to "Development")
3. Click **Production**
4. Click the **Settings** tab (within the Database pane)
5. Look for **Connection string** — it will start with `postgresql://` or `postgres://`
6. Copy it

If the Production tab is not visible in the Database pane:
- Click **Deploy** (rocket icon) → your deployed app → **Databases** or **Environment**
- Or: in the published app's dashboard, look for **Environment Variables** — the production `DATABASE_URL` (not the public app URL) is what you need

**Once you have the connection string:**

1. Click the **lock icon** (Secrets) in the Replit left sidebar
2. Click **New secret**
3. Key: `PRODUCTION_DATABASE_URL`
4. Value: paste the `postgresql://...` connection string
5. Click **Save**

**Do NOT use `PROD_DATABASE_URL`** — that is the web URL and will be rejected by all PostgreSQL tools.

**How to verify it is correct (without printing it):**

After adding the secret, run this in the Replit Shell:

```bash
# Should print postgresql or postgres — not https
echo "${PRODUCTION_DATABASE_URL%%://*}"
```

It must print `postgresql` or `postgres`. If it prints `https` or anything else, the wrong value was pasted.

---

## Gate 2 — Dev Cluster Capacity ⚠️ WARN / UNCERTAIN

### Dev database identity

| Property | Value |
|----------|-------|
| Database name | `heliumdb` |
| PostgreSQL version | 16.10 |
| Current size | 2,047 MB (~2 GB) |
| Total cluster size (all DBs) | 2,061 MB |
| Tablespace | `pg_default` (default data directory) |
| Data directory | `/var/lib/postgresql/data` |

### Filesystem analysis

| Filesystem | Size | Used | Available | Mount | Relevance |
|-----------|------|------|-----------|-------|-----------|
| `/dev/vdb` | 32 G | 138 M | 32 G | `/home/runner`, `/tmp`, `/mnt/scratch` | **Adequate for dump file** |
| `/dev/vdd` | 256 G | 4.3 G | 250 G | `/home/runner/workspace`, `/var/lib/docker` | Workspace storage |
| `/dev/vdc` | 1.8 T | 1.7 T | 129 G | `/mnt/snix` | Nix store |
| `/dev/pmem5` | 4.3 G | 4.3 G | **0 bytes** | `/mnt/6ff0c7f0-…` | **Suspected PostgreSQL data** |
| `/dev/pmem6` | 248 M | 248 M | **0 bytes** | `/mnt/a5c239d7-…` | Unknown |
| `/dev/pmem7` | 268 M | 268 M | **0 bytes** | `/mnt/pid2` | Unknown |

### The uncertainty

`df -h /var/lib/postgresql/data` does not show a distinct mount for the data directory — meaning it is accessed via an overlay or bind mount that the standard `df` tree cannot directly resolve. The path resolves into the root overlay in `df`, which is only 4 MB total (clearly not where 2 GB of database data lives).

The most probable host for PostgreSQL data is `/dev/pmem5` (persistent memory, 4.3 GB, exactly right for a 2 GB database with overhead) — **and it shows 0 bytes free.**

If `/dev/pmem5` is the PostgreSQL data volume (which the size and full status strongly suggest), then:

| Requirement | Available | Adequate |
|-------------|-----------|----------|
| Space for 2× restored clone size on data volume (~4 GB) | 0 bytes | ❌ NO |
| Space for compressed dump in /tmp (~300–600 MB) | 32 GB | ✅ YES |
| Space for dump in /home/runner/workspace (~300–600 MB) | 250 GB | ✅ YES |

### Gate 2 verdict

**Cannot confirm safe capacity.** The dev cluster data volume is likely full. Attempting `CREATE DATABASE` and `pg_restore` risks filling the PostgreSQL data volume, which would crash the running development application.

**Recommendation: Use the external Neon project path.** The dump/restore would write to `/tmp` (32 GB free) for the dump file and to a fresh Neon project for the restore — bypassing the dev cluster's storage entirely. See Gate 5 for the Neon-path command plan.

---

## Gate 3 — Client and Version Compatibility ⚠️ PARTIAL

### What can be confirmed

| Component | Version | Status |
|-----------|---------|--------|
| `pg_dump` client | 16.10 | ✅ Confirmed |
| `pg_restore` client | 16.10 | ✅ Confirmed |
| `psql` client | 16.10 | ✅ Confirmed |
| Dev PostgreSQL server | 16.10 | ✅ Confirmed |
| Production PostgreSQL server | **Unknown** | ❌ Cannot connect (Gate 1 failure) |

### Version compatibility rule

PostgreSQL client tools can dump from a server of the same or older major version. `pg_dump` 16 can dump from PostgreSQL 16 or earlier; it cannot dump from PostgreSQL 17+. The production server version must be ≤ 16 for `pg_dump 16.10` to work correctly.

**This cannot be verified until Gate 1 passes.**

### Extensions

**Dev cluster installed extensions:**

| Extension | Version |
|-----------|---------|
| `pg_trgm` | 1.6 |
| `plpgsql` | 1.0 |

**Production extensions:** Cannot query — Gate 1 failure.

If production uses extensions not installed on the dev cluster (e.g., `uuid-ossp`, `pgcrypto`, `postgis`, `pg_stat_statements`, `vector`), restoring the dump into the dev cluster would fail for any objects depending on those extensions. This is a known risk that must be resolved before proceeding.

**Note:** The external Neon project path is immune to extension availability issues on the dev cluster, since the dump would restore into a fresh Neon instance that can have extensions installed before the restore.

### Gate 3 verdict

**Partial — cannot complete until Gate 1 passes.** Client tools are present and version-compatible with the dev server. Production server version and extension set are unknown.

---

## Gate 4 — Isolation Proof ✅ PASS

All isolation checks that can be performed without creating the clone pass:

| Check | Result | Evidence |
|-------|--------|----------|
| `rollback_validation_2026_07_31` exists in dev cluster | ❌ DOES NOT EXIST | `pg_database` query returned 0 rows |
| Any env var references the clone name | NOT FOUND | Full env scan returned nothing |
| `ROLLBACK_CLONE_DB_URL` is set | NOT SET | Confirmed absent |
| Running app database connections | `heliumdb` only | `pg_stat_activity` shows 1 connection to `heliumdb`, 0 to any other DB |
| Scheduled jobs / cron | None relevant | No crontab; system crons are `apt-compat` and `dpkg` only |
| `PROD_DATABASE_URL` accessible to running app | YES (but it is a web URL) | App process env contains `PROD_DATABASE_URL` and `DATABASE_URL` |

The proposed clone database name does not conflict with any existing database, environment variable, or running process. Once created, no existing code path will accidentally connect to it — the running application reads `DATABASE_URL` (which resolves to `heliumdb`) and no code in the recovery branch references `rollback_validation_2026_07_31`.

---

## Gate 5 — Safe Dump/Restore Command Plan 📋 WRITTEN

These are the exact commands that would be executed. **They are not executed here.** They require `PRODUCTION_DATABASE_URL` (the valid `postgresql://...` connection string) and are presented in two variants depending on which path Gate 2 authorizes.

---

### VARIANT A — Dev cluster path (USE ONLY if Gate 2 is resolved)

**Precondition:** Gate 2 capacity confirmed adequate AND Gate 3 extensions verified compatible.

```bash
# ── PRE-FLIGHT IDENTITY CHECKS (read-only) ────────────────────────────────

# A1. Verify production is not the dev cluster
PROD_HOST=$(psql "$PRODUCTION_DATABASE_URL" -t -c \
  "SELECT host(inet_server_addr());" 2>/dev/null | tr -d ' ')
DEV_HOST=$(psql "$DATABASE_URL" -t -c \
  "SELECT host(inet_server_addr());" 2>/dev/null | tr -d ' ')
[ "$PROD_HOST" = "$DEV_HOST" ] \
  && echo "FATAL: production and dev are on the same host — ABORT" && exit 1 \
  || echo "PASS: hosts differ"

# A2. Confirm production database name
psql "$PRODUCTION_DATABASE_URL" -t -c "SELECT current_database();"

# A3. Confirm production pg version ≤ 16
PROD_MAJOR=$(psql "$PRODUCTION_DATABASE_URL" -t -c \
  "SELECT split_part(version(),' ',2);" 2>/dev/null | tr -d ' ' | cut -d. -f1)
[ "$PROD_MAJOR" -gt 16 ] \
  && echo "FATAL: production is PostgreSQL $PROD_MAJOR — pg_dump 16 cannot dump it" && exit 1 \
  || echo "PASS: production major version $PROD_MAJOR is ≤ 16"

# ── CREATE ISOLATED CLONE DATABASE ───────────────────────────────────────

# A4. Create clone (requires Gate 2 capacity confirmation first)
psql "$DATABASE_URL" -c \
  "CREATE DATABASE rollback_validation_2026_07_31;" || \
  { echo "FATAL: CREATE DATABASE failed"; exit 1; }

# A5. Verify clone identity before restore
CLONE_DB="${DATABASE_URL%/*}/rollback_validation_2026_07_31"
CLONE_NAME=$(psql "$CLONE_DB" -t -c "SELECT current_database();" | tr -d ' ')
[ "$CLONE_NAME" != "rollback_validation_2026_07_31" ] \
  && echo "FATAL: current_database() = '$CLONE_NAME' — not the clone — ABORT" && exit 1 \
  || echo "PASS: connected to correct clone database"

# ── DUMP (read-only against production) ──────────────────────────────────

# A6. Dump production to /tmp (read-only; does not modify production)
echo "Dump started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pg_dump "$PRODUCTION_DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file=/tmp/production-dump.pgdump \
  --verbose 2>&1 | tee /tmp/pgdump.log | tail -5
DUMP_EXIT=$?
echo "Dump exit code: $DUMP_EXIT"
[ $DUMP_EXIT -ne 0 ] \
  && echo "FATAL: pg_dump failed (exit $DUMP_EXIT) — see /tmp/pgdump.log — ABORT" && exit 1 \
  || echo "PASS: dump completed"
ls -lh /tmp/production-dump.pgdump

# ── RESTORE INTO CLONE ONLY ──────────────────────────────────────────────

# A7. Restore (targets clone only — heliumdb is never referenced)
echo "Restore started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pg_restore \
  --dbname="$CLONE_DB" \
  --no-owner \
  --no-acl \
  --verbose \
  --jobs=2 \
  /tmp/production-dump.pgdump 2>&1 | tee /tmp/pgrestore.log | tail -10
RESTORE_EXIT=$?
echo "Restore exit code: $RESTORE_EXIT"
# pg_restore exit 1 with only ownership warnings is acceptable; exit 2+ is fatal
[ $RESTORE_EXIT -ge 2 ] \
  && echo "FATAL: pg_restore failed (exit $RESTORE_EXIT) — see /tmp/pgrestore.log — ABORT" && exit 1 \
  || echo "PASS: restore completed (exit $RESTORE_EXIT)"

# ── POST-RESTORE VALIDATION ──────────────────────────────────────────────

# A8. Identity and size
psql "$CLONE_DB" -c "
  SELECT current_database() AS database,
         pg_size_pretty(pg_database_size(current_database())) AS size;"

# A9. Row counts (compare against Phase 1 production snapshot)
psql "$CLONE_DB" -t -c "
  SELECT t, to_char(n,'FM999,999,999')
  FROM (
    SELECT 'leads'           AS t, COUNT(*) AS n FROM leads
    UNION ALL SELECT 'accounts',            COUNT(*) FROM accounts
    UNION ALL SELECT 'contacts',            COUNT(*) FROM contacts
    UNION ALL SELECT 'email_messages',      COUNT(*) FROM email_messages
    UNION ALL SELECT 'current_channels',    COUNT(*) FROM current_channels
    UNION ALL SELECT 'current_messages',    COUNT(*) FROM current_messages
  ) x ORDER BY t;"

# A10. Confirm currents_* tables absent
CURRENTS_COUNT=$(psql "$CLONE_DB" -t -c "
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name LIKE 'currents_%';" | tr -d ' ')
[ "$CURRENTS_COUNT" -gt 0 ] \
  && echo "WARNING: $CURRENTS_COUNT currents_* tables found in clone" \
  || echo "PASS: no currents_* tables in clone"

# ── CLEANUP ──────────────────────────────────────────────────────────────

# A11. Remove dump file
rm /tmp/production-dump.pgdump && echo "Dump file removed."

# ── SET SECRET ───────────────────────────────────────────────────────────
# A12. Print clone URL for manual entry into Replit Secrets as ROLLBACK_CLONE_DB_URL
#      (Trevor copies this and adds it in the Secrets UI — never pasted into chat)
echo "Clone URL for Secrets UI:"
echo "${DATABASE_URL%/*}/rollback_validation_2026_07_31"
```

---

### VARIANT B — External Neon project path (RECOMMENDED given Gate 2 uncertainty)

**Use this path if Gate 2 capacity cannot be confirmed for the dev cluster.**  
A fresh Neon project is created by Trevor in the Neon console (NOT branching the existing Neon project). Its connection string is passed as `NEON_CLONE_DB_URL`.

```bash
# ── PRE-FLIGHT IDENTITY CHECKS (same as Variant A steps A1–A3) ───────────
# (same commands as above — omitted for brevity)

# ── VERIFY TARGET IS NEON, NOT DEV OR PROD ───────────────────────────────

# B1. Confirm NEON_CLONE_DB_URL is set and is a distinct PostgreSQL URL
[ -z "${NEON_CLONE_DB_URL:-}" ] \
  && echo "FATAL: NEON_CLONE_DB_URL not set" && exit 1

NEON_SCHEME="${NEON_CLONE_DB_URL%%://*}"
[ "$NEON_SCHEME" != "postgresql" ] && [ "$NEON_SCHEME" != "postgres" ] \
  && echo "FATAL: NEON_CLONE_DB_URL is not a postgresql:// URL" && exit 1

NEON_HOST=$(psql "$NEON_CLONE_DB_URL" -t -c \
  "SELECT host(inet_server_addr());" | tr -d ' ')
DEV_HOST=$(psql "$DATABASE_URL" -t -c \
  "SELECT host(inet_server_addr());" | tr -d ' ')
PROD_HOST=$(psql "$PRODUCTION_DATABASE_URL" -t -c \
  "SELECT host(inet_server_addr());" | tr -d ' ')
[ "$NEON_HOST" = "$DEV_HOST" ] \
  && echo "FATAL: Neon clone is on the same host as dev — ABORT" && exit 1
[ "$NEON_HOST" = "$PROD_HOST" ] \
  && echo "FATAL: Neon clone is on the same host as production — ABORT" && exit 1
echo "PASS: Neon clone host is distinct from both dev and production"

# B2. Verify clone is empty (new project)
NEON_TABLE_COUNT=$(psql "$NEON_CLONE_DB_URL" -t -c "
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='public';" | tr -d ' ')
[ "$NEON_TABLE_COUNT" -gt 0 ] \
  && echo "FATAL: Neon clone already has $NEON_TABLE_COUNT tables — use a fresh database" && exit 1 \
  || echo "PASS: Neon clone is empty ($NEON_TABLE_COUNT tables)"

# B3. Verify target database name
NEON_DBNAME=$(psql "$NEON_CLONE_DB_URL" -t -c "SELECT current_database();" | tr -d ' ')
echo "Neon clone database name: $NEON_DBNAME"

# ── STREAMING DUMP/RESTORE (no temporary file needed) ────────────────────

# B4. Stream from production directly into Neon clone (avoids storing two copies)
echo "Streaming dump/restore started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pg_dump "$PRODUCTION_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --verbose \
  | pg_restore \
      --dbname="$NEON_CLONE_DB_URL" \
      --no-owner \
      --no-acl \
      --verbose \
      --jobs=1 2>&1 | tee /tmp/pgrestore.log | tail -10
PIPE_EXIT=${PIPESTATUS[1]}
echo "Restore exit code: $PIPE_EXIT"
[ $PIPE_EXIT -ge 2 ] \
  && echo "FATAL: dump/restore pipeline failed (exit $PIPE_EXIT) — ABORT" && exit 1 \
  || echo "PASS: dump/restore pipeline completed"

# ── POST-RESTORE VALIDATION (same as Variant A steps A8–A10) ─────────────
# Use NEON_CLONE_DB_URL instead of CLONE_DB

# B5. Identity
psql "$NEON_CLONE_DB_URL" -c "
  SELECT current_database() AS database,
         pg_size_pretty(pg_database_size(current_database())) AS size;"

# B6. Row counts
psql "$NEON_CLONE_DB_URL" -t -c "
  SELECT t, to_char(n,'FM999,999,999')
  FROM (
    SELECT 'leads'           AS t, COUNT(*) AS n FROM leads
    UNION ALL SELECT 'accounts',            COUNT(*) FROM accounts
    UNION ALL SELECT 'contacts',            COUNT(*) FROM contacts
    UNION ALL SELECT 'email_messages',      COUNT(*) FROM email_messages
    UNION ALL SELECT 'current_channels',    COUNT(*) FROM current_channels
    UNION ALL SELECT 'current_messages',    COUNT(*) FROM current_messages
  ) x ORDER BY t;"

# B7. Confirm currents_* absent
psql "$NEON_CLONE_DB_URL" -t -c "
  SELECT COUNT(*) || ' currents_* tables (must be 0)'
  FROM information_schema.tables
  WHERE table_schema='public' AND table_name LIKE 'currents_%';"

# ── SET SECRET ───────────────────────────────────────────────────────────
# B8. Add NEON_CLONE_DB_URL as ROLLBACK_CLONE_DB_URL via Replit Secrets UI
#     (Trevor already has this value — it is NEON_CLONE_DB_URL)
echo "Set ROLLBACK_CLONE_DB_URL = NEON_CLONE_DB_URL in Replit Secrets."
```

---

## Pre-Flight Verdict

```
HARD FAIL — DO NOT CREATE CLONE
```

### Blockers (in order of severity)

**BLOCKER 1 — Gate 1 (mandatory before anything else):**

`PROD_DATABASE_URL` is an `https://` web URL, not a PostgreSQL connection string. No production database dump can be taken until Trevor adds the real production PostgreSQL connection string as a new secret named `PRODUCTION_DATABASE_URL`.

**Where to find it:** Replit workspace → Database pane (left sidebar) → Production tab → Settings → Connection string. It starts with `postgresql://`.

---

**BLOCKER 2 — Gate 2 (resolve after Gate 1):**

The dev cluster's PostgreSQL data volume appears to have 0 bytes free (pmem5: 4.3 GB, 100% full). `CREATE DATABASE` on the dev cluster risks crashing the running app by exhausting storage. This blocker is resolved by choosing **Variant B (external Neon project)** — which does not write to the dev cluster at all.

---

**Gates 3–5:** Will proceed once Gates 1–2 are resolved. Client tools are ready. Commands are staged. Isolation is confirmed.

---

## Trevor's Next Two Actions

1. **Find and add the real production PostgreSQL connection string:**
   - Replit sidebar → Database → Production → Settings → copy the `postgresql://...` connection string
   - Replit sidebar → Secrets → New secret → Key: `PRODUCTION_DATABASE_URL` → paste → Save

2. **Decide on the restore target:**
   - If the Neon console is accessible: create a **new Neon project** (NOT a branch of the existing one) named `voltsafe-rollback-validation` and add its connection string as `NEON_CLONE_DB_URL`
   - If Neon is not accessible: confirm Gate 2 capacity manually by checking the Replit Database pane for available storage before proceeding with the dev cluster path

Once both secrets are in place, report back and the agent will immediately run the pre-flight identity checks and proceed with the dump/restore.
