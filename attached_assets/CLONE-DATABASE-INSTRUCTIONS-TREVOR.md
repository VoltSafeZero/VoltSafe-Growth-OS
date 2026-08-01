# DATABASE CLONE INSTRUCTIONS FOR TREVOR
# Five-Day Rollback Validation — Create rollback-validation-2026-07-31

**Date:** 2026-08-01  
**Purpose:** Create an isolated copy of the production database for rollback validation.  
**Hard constraints:** Do NOT restore or modify the production database. Do NOT use PITR on production.

---

## Replit-Native Capability Assessment

### What Replit supports natively

| Feature | Available | Notes |
|---------|-----------|-------|
| Two fixed databases per project (dev + prod) | ✅ | Always provisioned by Replit |
| Point-in-Time Restore on production | ✅ | Restores production **in-place** — FORBIDDEN for this task |
| Point-in-Time Restore on dev | ✅ | Restores dev to a prior checkpoint state — not what we need |
| "Clone production database" button | ❌ | Does not exist in Replit UI |
| Create a third isolated database via UI | ❌ | Replit UI provisions exactly one dev + one prod |
| pg_dump / pg_restore in the Shell | ✅ | PostgreSQL 16.10 client tools confirmed available |
| CREATE DATABASE on the dev cluster | ✅ | Dev user is `postgres` (superuser, CREATEDB privilege) |

### Why the dev cluster approach works

The Replit dev PostgreSQL cluster currently hosts exactly one database (`heliumdb`). Because the cluster user is a superuser with CREATEDB, we can create a second database on the **same cluster** named `rollback_validation_2026_07_31`. Its connection string will be identical to `DATABASE_URL` except for the database name segment — making it a genuinely distinct database that:

- Does not touch production ✅
- Does not modify `heliumdb` (the dev database) ✅
- Has a different `current_database()` result ✅
- Has a different connection string than `DATABASE_URL` ✅
- Has a completely different host than `PROD_DATABASE_URL` ✅
- Passes all Step 2 hard-fail identity checks ✅

---

## EXACT STEPS — Preferred Path (Replit Shell, ~30–60 minutes)

All commands run in the **Replit Shell** (bottom panel or keyboard shortcut).  
`$DATABASE_URL` = dev connection string (automatically available in the shell).  
`$PROD_DATABASE_URL` = production connection string (available as a Replit secret in the shell).  
**Never print either variable's value.** Use them only as shell references.

---

### Phase 1 — Identity Verification (read-only, no changes)

**1A — Confirm the two databases are on different hosts:**

```bash
echo "=== DEV DATABASE ===" && \
psql "$DATABASE_URL" -t -c \
  "SELECT 'database: ' || current_database() || '  host: ' || host(inet_server_addr());"

echo "=== PRODUCTION DATABASE ===" && \
psql "$PROD_DATABASE_URL" -t -c \
  "SELECT 'database: ' || current_database() || '  host: ' || host(inet_server_addr());"
```

**Expected:** Two completely different hosts. If the same host appears, STOP and report.  
No credentials are printed. This is a read-only query.

**1B — Confirm production data looks right before dumping:**

```bash
psql "$PROD_DATABASE_URL" -t -c "
  SELECT table_name || ': ' || to_char(cnt, 'FM999,999,999')
  FROM (
    SELECT 'leads'          AS table_name, COUNT(*) AS cnt FROM leads
    UNION ALL SELECT 'accounts',          COUNT(*) FROM accounts
    UNION ALL SELECT 'email_messages',    COUNT(*) FROM email_messages
    UNION ALL SELECT 'current_channels',  COUNT(*) FROM current_channels
    UNION ALL SELECT 'current_messages',  COUNT(*) FROM current_messages
  ) t ORDER BY table_name;
"
```

**Expected (approximate from prior audit):**
```
accounts:       11,026
current_channels:   15
current_messages:   43
email_messages: 60,012
leads:          10,989
```

**1C — Confirm `currents_*` tables do NOT exist in production:**

```bash
psql "$PROD_DATABASE_URL" -t -c "
  SELECT COUNT(*) || ' currents_* tables (must be 0)'
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name LIKE 'currents_%';
"
```

**Expected:** `0 currents_* tables (must be 0)`. If any are found, STOP and report.

---

### Phase 2 — Create the Isolated Clone Database (one DDL command)

**2A — Create the new database on the dev cluster:**

```bash
psql "$DATABASE_URL" -c \
  "CREATE DATABASE rollback_validation_2026_07_31;"
```

**Expected output:** `CREATE DATABASE`  
This creates a new, empty database on the dev cluster. It does not modify `heliumdb` or production.

**2B — Verify the new database exists and is empty:**

```bash
psql "$DATABASE_URL" -t -c "
  SELECT datname, pg_size_pretty(pg_database_size(datname))
  FROM pg_database
  WHERE datname NOT IN ('template0', 'template1', 'postgres')
  ORDER BY datname;
"
```

**Expected:** Two rows — `heliumdb` and `rollback_validation_2026_07_31`.  
The new database should show a tiny size (a few MB — just system catalog overhead).

**2C — Confirm the new database identity:**

```bash
# Build the clone URL from DATABASE_URL (replace database name segment)
CLONE_DB="${DATABASE_URL%/*}/rollback_validation_2026_07_31"

psql "$CLONE_DB" -t -c \
  "SELECT 'database: ' || current_database() || '  size: ' || pg_size_pretty(pg_database_size(current_database()));"
```

**Expected:** `database: rollback_validation_2026_07_31  size: 7757 kB` (or similar small number)  
If `current_database()` shows anything other than `rollback_validation_2026_07_31`, STOP.

---

### Phase 3 — Dump Production (read-only, does not modify production)

**3A — Export production to a compressed dump file:**

```bash
echo "Starting dump at: $(date)" && \
pg_dump "$PROD_DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file=/tmp/production-dump.pgdump \
  --verbose 2>&1 | tail -20 && \
echo "Finished dump at: $(date)"
```

This is a **read-only** operation on production. It does not modify the production database in any way. It reads all tables, sequences, indexes, and constraints and writes them to a local file.

**Expected:** Verbose output showing tables being dumped, then `pg_dump: done`. The operation may take 10–30 minutes depending on network throughput.

**3B — Verify the dump file:**

```bash
ls -lh /tmp/production-dump.pgdump && \
echo "---" && \
pg_restore --list /tmp/production-dump.pgdump | wc -l && \
echo "total archive entries" && \
echo "---" && \
echo "TABLE DATA entries:" && \
pg_restore --list /tmp/production-dump.pgdump | grep "TABLE DATA" | wc -l && \
echo "---" && \
echo "Sample entries:" && \
pg_restore --list /tmp/production-dump.pgdump | grep "TABLE DATA" | head -20
```

**Expected:**
- File size: roughly 200 MB – 1 GB (custom format is compressed; smaller than the 1.5 GB raw size)
- Hundreds of archive entries
- TABLE DATA entries matching the production table count (~237 tables)
- `leads` and `current_channels` visible; `currents_channels` should NOT appear

**3C — Confirm `currents_*` tables are absent from the dump:**

```bash
pg_restore --list /tmp/production-dump.pgdump | grep "currents_" | head -10 \
  && echo "WARNING: currents_ tables found — check before restoring" \
  || echo "CLEAN: no currents_ tables in dump"
```

**Expected:** `CLEAN: no currents_ tables in dump`

---

### Phase 4 — Restore into the Isolated Clone

**4A — Restore the dump into `rollback_validation_2026_07_31`:**

```bash
CLONE_DB="${DATABASE_URL%/*}/rollback_validation_2026_07_31" && \
echo "Restore started at: $(date)" && \
pg_restore \
  --dbname="$CLONE_DB" \
  --no-owner \
  --no-acl \
  --verbose \
  --jobs=2 \
  /tmp/production-dump.pgdump 2>&1 | tail -30 && \
echo "Restore finished at: $(date)" && \
echo "Exit: $?"
```

**Notes:**
- `--jobs=2` parallelizes index creation without overwhelming the cluster
- `--no-owner` and `--no-acl` prevent ownership conflicts (the dev `postgres` user will own everything)
- This writes ONLY into `rollback_validation_2026_07_31` — `heliumdb` and production are untouched
- Ignore any `pg_restore: error: could not execute query: ERROR: role "..." does not exist` warnings about ownership — those are harmless when using `--no-owner`

**Expected:** Verbose output of table restores, index builds, then exit code 0 (or exit code 1 with only the harmless ownership warnings above).

---

### Phase 5 — Verify Clone Integrity

**5A — Confirm database identity:**

```bash
CLONE_DB="${DATABASE_URL%/*}/rollback_validation_2026_07_31" && \
psql "$CLONE_DB" -c "
  SELECT
    current_database()                                         AS database,
    host(inet_server_addr())                                   AS host,
    pg_size_pretty(pg_database_size(current_database()))       AS size;
"
```

**Expected:**
- `database`: `rollback_validation_2026_07_31`
- `host`: the dev cluster host (NOT the production Neon host)
- `size`: approximately the same as production (within 10%)

**5B — Row count comparison against production:**

Run this on the CLONE:

```bash
CLONE_DB="${DATABASE_URL%/*}/rollback_validation_2026_07_31" && \
psql "$CLONE_DB" -t -c "
  SELECT table_name || ': ' || to_char(cnt, 'FM999,999,999')
  FROM (
    SELECT 'leads'          AS table_name, COUNT(*) AS cnt FROM leads
    UNION ALL SELECT 'accounts',          COUNT(*) FROM accounts
    UNION ALL SELECT 'contacts',          COUNT(*) FROM contacts
    UNION ALL SELECT 'email_messages',    COUNT(*) FROM email_messages
    UNION ALL SELECT 'current_channels',  COUNT(*) FROM current_channels
    UNION ALL SELECT 'current_messages',  COUNT(*) FROM current_messages
  ) t ORDER BY table_name;
"
```

**Expected:** Numbers matching the Phase 1B output exactly.

**5C — Confirm `currents_*` tables are absent from the clone:**

```bash
CLONE_DB="${DATABASE_URL%/*}/rollback_validation_2026_07_31" && \
psql "$CLONE_DB" -t -c "
  SELECT COUNT(*) || ' currents_* tables (must be 0)'
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name LIKE 'currents_%';
"
```

**Expected:** `0 currents_* tables (must be 0)`

**5D — Spot-check original Currents data:**

```bash
CLONE_DB="${DATABASE_URL%/*}/rollback_validation_2026_07_31" && \
psql "$CLONE_DB" -c "
  SELECT id, name, slug, is_private, archived_at IS NOT NULL AS archived
  FROM current_channels
  ORDER BY id
  LIMIT 10;
"
```

**Expected:** The same channel rows that exist in production (15 rows total).

---

### Phase 6 — Add Secret to Replit Workspace

**6A — Construct the clone URL (do not print it):**

In the Replit Shell, run this and copy the printed URL to your clipboard:

```bash
echo "${DATABASE_URL%/*}/rollback_validation_2026_07_31"
```

This prints the full connection string for the clone database. It shares the dev cluster host, port, user, and password, but targets the isolated `rollback_validation_2026_07_31` database.

**6B — Add it as a Replit secret:**

1. In the Replit workspace, click the **lock icon** (Secrets) in the left sidebar
2. Click **New secret**
3. **Key:** `ROLLBACK_CLONE_DB_URL`
4. **Value:** paste the URL copied from Step 6A
5. Click **Save**
6. Close the clipboard entry (clear the clipboard)

**6C — Verify the secret is distinct from the production URL:**

The clone URL ends in `/rollback_validation_2026_07_31`.  
The production URL connects to a Neon host (`.neon.tech`).  
They must be different. If they look identical in any way, STOP and report.

---

### Phase 7 — Cleanup Dump File

```bash
rm /tmp/production-dump.pgdump && echo "Dump file removed."
```

The dump file is no longer needed once the restore is complete and verified.

---

### Phase 8 — Report Back

After completing Phases 1–7, report to the agent with:

1. Phase 1B production row counts (what you saw)
2. Phase 5B clone row counts (what you saw after restore)
3. Clone database size from Phase 5A
4. Whether any `currents_*` tables were found (Phases 1C, 3C, 5C)
5. Exit code from the pg_restore command (Phase 4A)
6. Confirmation that `ROLLBACK_CLONE_DB_URL` has been added to Replit Secrets
7. Confirmation that the production database was not modified at any point

**Do not share:** the connection string, passwords, or any credential values.

---

## If Phase 2A Fails (CREATEDB privilege denied)

If `CREATE DATABASE` fails with a permission error, fall back to the external Neon path:

1. Go to `https://console.neon.tech` → **New Project** (do NOT use "New Branch" on the existing project)
2. Name the new project: `voltsafe-rollback-validation`
3. Note the new project's connection string from the dashboard
4. Run the pg_dump (Phase 3A above) and pg_restore into the NEW Neon project's connection string instead of `$CLONE_DB`
5. Add the new Neon project's connection string as `ROLLBACK_CLONE_DB_URL`

This keeps the clone completely independent of both the Replit dev cluster and the existing Neon production project.

---

## If the Dump File is Too Large for /tmp

If `pg_dump` fails with a disk-space error:

```bash
# Check available space first
df -h /tmp /home/runner

# If /tmp is too small, write to the workspace directory instead:
pg_dump "$PROD_DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file=/home/runner/workspace/production-dump.pgdump \
  --verbose 2>&1 | tail -20
```

The workspace directory has more space than `/tmp`. Delete the dump file immediately after restore.

---

## Safety Checklist (confirm each before starting)

- [ ] I will not click "Point-in-Time Restore" on the production database
- [ ] I will not run `pg_restore` targeting `$PROD_DATABASE_URL`
- [ ] I will not run any DDL (`CREATE`, `ALTER`, `DROP`) against `$PROD_DATABASE_URL`
- [ ] I will verify `current_database()` on the clone before the restore
- [ ] I will not print `$DATABASE_URL`, `$PROD_DATABASE_URL`, or `$CLONE_DB` values in chat
- [ ] I will add `ROLLBACK_CLONE_DB_URL` via Replit Secrets UI, not as a code change

---

*Once `ROLLBACK_CLONE_DB_URL` is set and Trevor reports back, the agent will immediately proceed with Step 2 identity verification through Step 7 final report of the five-day rollback validation.*
