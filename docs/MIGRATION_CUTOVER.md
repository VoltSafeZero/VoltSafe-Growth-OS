# VoltSafe Cortex — Partnership → Account Migration Runbook

> **Scope:** This document covers the full A→E pipeline for migrating partnership
> rows into the accounts table, the category-to-org_type mapping, recommended
> execution order, manual-review triggers, and rollback procedures for every
> failure mode.

---

## Contents

1. [Category → org_type Mapping](#1-category--org_type-mapping)
2. [Recommended Migration Order](#2-recommended-migration-order)
3. [Manual Review Requirements](#3-manual-review-requirements)
4. [Copy-Paste Runbook (Steps A–E)](#4-copy-paste-runbook-steps-ae)
5. [Step D Cutover Checklist](#5-step-d-cutover-checklist)
6. [Rollback Procedures](#6-rollback-procedures)
7. [Completed Batches Reference](#7-completed-batches-reference)
8. [Pre-existing Data Quality Issues](#8-pre-existing-data-quality-issues)

---

## 1. Category → org_type Mapping

The table below is the authoritative source for every `--category` and `--orgType`
combination. Pass these values verbatim to `migrate-partnerships.js`.

| partnerships.category | accounts.org_type | accounts.partner_class | accounts.segment | Notes |
|---|---|---|---|---|
| `government` | `partner` | `funding` | `partner` | ✅ Migrated — phase2-batch1 |
| `strategic_industry` | `association` | *(none)* | `association` | ✅ Migrated — phase2-batch2 |
| `research_academic` | `research` | *(none)* | `partner` | 0 rows currently |
| `innovation_research` | `partner` | `innovation` | `partner` | Check for govt-funding overlap |
| `investor` | `partner` | `investor` | `partner` | ⚠ Manual review required (see §3) |
| `government_public` | `regulatory` | *(none)* | `partner` | Distinct from `government` / funding |
| `media_tradeshows` | `association` | `media` | `association` | Low complexity |
| `distribution` | `distributor` | *(none)* | `partner` | Verify no overlap with `channel` rows |
| `channel` | `distributor` | `channel` | `partner` | Run after `distribution` |
| `pilot_site` | `pilot_site` | *(none)* | `marina` | Marina-type accounts |

**SEGMENT_MAP is pre-configured** in `scripts/migrate-partnerships.js`. If you add
a new `org_type` not in that map, the script will default to `marina` — update the
map first.

---

## 2. Recommended Migration Order

Run batches in this order to minimise duplicate-detection false positives and
to keep related entities grouped.

| Priority | Category | Reason for ordering |
|---|---|---|
| ✅ Done | `government` | Completed phase2-batch1 |
| ✅ Done | `strategic_industry` | Completed phase2-batch2 |
| 1 | `research_academic` | 0 rows now; run first when data arrives — zero collision risk |
| 2 | `government_public` | Sibling of `government`; run before investor to keep regulatory separate |
| 3 | `media_tradeshows` | Low row count; low duplicate risk; no financial fields |
| 4 | `innovation_research` | Run after govt_public to avoid cross-category duplicate confusion |
| 5 | `distribution` | Run before `channel` — `channel` depends on distributor accounts existing |
| 6 | `channel` | After `distribution` so parent distributors are in accounts first |
| 7 | `pilot_site` | Marina-type; run after CRM accounts are clean |
| 8 | `investor` | Last — highest manual review burden; see §3 |

---

## 3. Manual Review Requirements

### Always required (for every batch)

The migration runner flags any source row where a name or website domain
already exists in accounts. **These rows are never auto-merged.** After a
dry-run, review the `duplicate_review` list before proceeding live.

Respond to each flagged row with one of:

- **Use existing account** — pass `--skipDuplicates` (coming) or manually
  set `migration_status='complete'` on the partnership after confirming the
  existing account is correct.
- **Create anyway** — only valid if the name collision is a different legal
  entity (e.g. two companies with the same name in different regions).
  Rename one before migrating.

### Categories that require additional human sign-off before live run

| Category | Why manual review is needed | Who must approve |
|---|---|---|
| `investor` | May need investor-tier permissions, deal-room access, and valuation fields that are not automatically populated | CRO or CFO |
| `innovation_research` | Rows often overlap with `government` grants — confirm no account was already created under `government_public` | Migration owner |
| `channel` | Distributor parent must already exist in accounts before channel rows migrate | Migration owner |

### Dry-run review checklist (every category)

After running Step A with `--dryRun`:

- [ ] Count of `would_migrate` matches your expected source row count
- [ ] Count of `duplicate_review` is 0, or each flagged row has been triaged
- [ ] `Segment` shown in the header matches the SEGMENT_MAP table in §1
- [ ] `Org Type` and `Partner Class` match the mapping in §1
- [ ] `Batch ID` is unique — not reused from a prior run

---

## 4. Copy-Paste Runbook (Steps A–E)

Replace `<CATEGORY>`, `<ORG_TYPE>`, `<BATCH_ID>`, and optionally `<PARTNER_CLASS>`
with values from the mapping table in §1.

```
CATEGORY    = research_academic        (example)
ORG_TYPE    = research
PARTNER_CLASS =                        (omit flag if none)
BATCH_ID    = phase2-batch3-YYYYMMDD   (date suffix = today)
```

---

### Step A — Dry run first, then migrate

```bash
# ── A1. Dry run (no writes) ──────────────────────────────────────────────────
node scripts/migrate-partnerships.js \
  --category   <CATEGORY> \
  --orgType    <ORG_TYPE> \
  --partnerClass <PARTNER_CLASS> \
  --batchId    <BATCH_ID> \
  --dryRun

# Review output:
#   Source rows       : N
#   Migrated          : N   ← should equal source rows if no duplicates
#   Duplicate/Review  : 0   ← must be 0 before going live
#   Failed            : 0

# ── A2. Resolve any duplicate_review rows (see §3) ──────────────────────────
# (no action needed if count is 0)

# ── A3. Live run ─────────────────────────────────────────────────────────────
node scripts/migrate-partnerships.js \
  --category   <CATEGORY> \
  --orgType    <ORG_TYPE> \
  --partnerClass <PARTNER_CLASS> \
  --batchId    <BATCH_ID>

# Confirm: "Migrated : N" matches dry-run count.
```

---

### Step B — Verify

```bash
node scripts/verify-migration.js --batchId <BATCH_ID>

# Confirm: "Verified: N  Failed: 0"
# Each row should show 8 ✓ checks.
# Any ✗ must be resolved before Step C.
```

---

### Step C — Relink child records

```bash
# ── C1. Dry run ──────────────────────────────────────────────────────────────
node scripts/relink-children.js --batchId <BATCH_ID> --dryRun

# Review output:
#   For each row, "Would relink" lists every child table and count.
#   ROLLBACK SQL is printed — copy it to a safe location before going live.

# ── C2. Live run ─────────────────────────────────────────────────────────────
node scripts/relink-children.js --batchId <BATCH_ID>

# Confirm:
#   Succeeded : N   Failed : 0
#   Global orphan check: ✓ No orphans found across all child tables
```

---

### Step D — Frontend / API cutover

Follow the full checklist in §5.

Key SQL to verify cutover:

```sql
-- Confirm migrated rows no longer appear in partnerships list
SELECT COUNT(*) FROM partnerships WHERE migration_status = 'legacy';

-- Confirm migrated accounts exist and are correct
SELECT id, name, org_type, partner_class, segment, converted_from_partnership_id
FROM accounts
WHERE converted_from_partnership_id IS NOT NULL
ORDER BY id;
```

Mark batch complete after all §5 checks pass:

```sql
UPDATE migration_log
SET migration_status = 'complete'
WHERE batch_id = '<BATCH_ID>' AND migration_status = 'children_migrated';

UPDATE partnerships
SET migration_status = 'complete'
WHERE migration_batch_id = '<BATCH_ID>' AND migration_status = 'children_migrated';
```

---

### Step E — Post-cutover audit

```bash
node scripts/post-cutover-audit.js --batchId <BATCH_ID>

# Confirm exit code 0 and all four groups PASS:
#   Group 1  Account Linkage          : PASS
#   Group 2  Lifecycle Completeness   : PASS
#   Group 3  No Residual Children     : PASS
#   Group 4  No Orphan Children       : PASS
#
#   ✓  AUDIT PASSED — batch is fully cutover-ready
```

Exit code 1 with any FAIL means investigation is required before the batch
can be considered closed. See §6 for remediation steps.

---

## 5. Step D Cutover Checklist

**Prerequisites before starting Step D:**

```sql
-- All rows must be children_migrated (not still in verified or migrated)
SELECT migration_status, COUNT(*)
FROM migration_log
WHERE batch_id = '<BATCH_ID>'
GROUP BY migration_status;
-- Expected: only "children_migrated"
```

- [ ] All `migration_log` rows for batch are `children_migrated`
- [ ] Step C reported 0 failures and 0 global orphans

### D1. Identify affected read surfaces

- [ ] `GET /api/partnerships` — main partnerships list API
- [ ] `GET /api/command-center` — activePartnerships, grantsGovt, investorConversations counts
- [ ] Any saved views with `pageKey='partnerships'`
- [ ] Any AI/voice query that aggregates partnerships by category

Find raw SQL touching partnerships that may be missing the legacy filter:

```bash
grep -n "FROM partnerships" server/routes.ts | grep -v "migration_status"
```

Any result without `migration_status` is a candidate for the `= 'legacy'` filter.

### D2. Partnership list filter (already applied)

`getPartnerships()` in `server/storage.ts` already prepends:

```typescript
eq(partnerships.migrationStatus, "legacy")
```

This is permanent and batch-agnostic — no code change needed for future batches.

### D3. Confirm migrated accounts appear correctly

- [ ] `GET /api/accounts` returns new accounts with correct `org_type` and `partner_class`
- [ ] Accounts list page shows correct org_type badge
- [ ] Account detail page renders notes, attachments, and activities correctly
- [ ] `converted_from_partnership_id` is set on the new account

```sql
SELECT id, name, org_type, partner_class, segment, converted_from_partnership_id
FROM accounts
WHERE converted_from_partnership_id IS NOT NULL
ORDER BY id;
```

### D4. Confirm child records render under accounts

- [ ] Notes previously on partnership now appear under account
- [ ] Attachments previously on partnership now appear under account
- [ ] No records appear on both the partnership and account (double-display)

```sql
-- Notes on migrated accounts
SELECT n.id, n.linked_object_type, n.linked_object_id, a.name
FROM notes n
JOIN accounts a ON a.id = n.linked_object_id
WHERE n.linked_object_type = 'account'
  AND a.converted_from_partnership_id IS NOT NULL;

-- Any notes incorrectly still on non-legacy partnerships (expect 0)
SELECT n.id, n.linked_object_id
FROM notes n
JOIN partnerships p ON p.id = n.linked_object_id
WHERE n.linked_object_type = 'partnership'
  AND p.migration_status != 'legacy';
```

### D5. Confirm no duplicate display

- [ ] Partnerships page: migrated entities do NOT appear
- [ ] Accounts page: migrated entities DO appear with correct org_type
- [ ] Command-center stats reflect post-migration values

### D6. New creates go to accounts

- [ ] `POST /api/accounts` form includes new org_type in `ORG_TYPE_OPTIONS`
- [ ] Partnerships create form does not offer the migrated category

---

## 6. Rollback Procedures

### Scenario A — Step A partially ran (some rows migrated, some failed)

Use the rollback SQL printed at the end of the Step A live run output, or run
manually for each `source_id` that was migrated:

```sql
-- 1. Delete the accounts that were created in this batch
DELETE FROM accounts
WHERE converted_from_partnership_id IN (
  SELECT source_id FROM migration_log WHERE batch_id = '<BATCH_ID>'
);

-- 2. Reset partnerships back to legacy
UPDATE partnerships
SET migration_status    = 'legacy',
    migrated_account_id = NULL,
    migration_batch_id  = NULL,
    migrated_at         = NULL
WHERE migration_batch_id = '<BATCH_ID>';

-- 3. Delete the migration_log entries
DELETE FROM migration_log WHERE batch_id = '<BATCH_ID>';
```

**Safe to run at any time before Step C.** No child records have moved yet.

---

### Scenario B — Step B (verify) failed for some rows

Step B is read-only except for updating `migration_status` in `migration_log`.
No child data has moved. Fix the data issue reported in the ✗ check, then re-run
Step B:

```bash
node scripts/verify-migration.js --batchId <BATCH_ID>
```

If you need to reset a row back to `migrated` so it reruns through Step B:

```sql
UPDATE migration_log
SET migration_status = 'migrated', error_message = NULL, verified_at = NULL
WHERE batch_id = '<BATCH_ID>' AND source_id = <PARTNERSHIP_ID>;
```

---

### Scenario C — Step C partially ran (some children moved, some failed)

Use the full rollback SQL block printed at the end of the Step C live run. It
is also reproduced here structurally — replace `<PARTNERSHIP_ID>` and
`<ACCOUNT_ID>` for each mapping in the batch:

```sql
-- 1. Restore polymorphic children (repeat for each table)
UPDATE notes
  SET linked_object_type='partnership', linked_object_id=<PARTNERSHIP_ID>
  WHERE linked_object_type='account' AND linked_object_id=<ACCOUNT_ID>;

UPDATE attachments
  SET object_type='partnership', object_id=<PARTNERSHIP_ID>
  WHERE object_type='account' AND object_id=<ACCOUNT_ID>;

UPDATE activities
  SET linked_object_type='partnership', linked_object_id=<PARTNERSHIP_ID>
  WHERE linked_object_type='account' AND linked_object_id=<ACCOUNT_ID>;

UPDATE comments
  SET object_type='partnership', object_id=<PARTNERSHIP_ID>
  WHERE object_type='account' AND object_id=<ACCOUNT_ID>;

UPDATE tasks
  SET linked_object_type='partnership', linked_object_id=<PARTNERSHIP_ID>
  WHERE linked_object_type='account' AND linked_object_id=<ACCOUNT_ID>;

UPDATE email_associations
  SET object_type='partnership', object_id=<PARTNERSHIP_ID>
  WHERE object_type='account' AND object_id=<ACCOUNT_ID>;

UPDATE calendar_events
  SET linked_object_type='partnership', linked_object_id=<PARTNERSHIP_ID>
  WHERE linked_object_type='account' AND linked_object_id=<ACCOUNT_ID>;

UPDATE record_tags
  SET record_type='partnership', record_id=<PARTNERSHIP_ID>
  WHERE record_type='account' AND record_id=<ACCOUNT_ID>;

-- 2. Restore email_threads dedicated column pair
UPDATE email_threads
  SET primary_partner_id=<PARTNERSHIP_ID>, primary_account_id=NULL
  WHERE primary_account_id=<ACCOUNT_ID> AND primary_partner_id IS NULL;

-- 3. Reset migration_log back to 'verified' so Step C can re-run
UPDATE migration_log
  SET migration_status='verified', children_migrated_at=NULL, error_message=NULL
  WHERE batch_id='<BATCH_ID>' AND migration_status='children_migrated';

-- 4. Reset partnerships back to 'migrated'
UPDATE partnerships
  SET migration_status='migrated'
  WHERE migration_batch_id='<BATCH_ID>' AND migration_status='children_migrated';
```

After restoring, re-run Step C:

```bash
node scripts/relink-children.js --batchId <BATCH_ID> --dryRun
node scripts/relink-children.js --batchId <BATCH_ID>
```

---

### Scenario D — Step D complete, post-cutover audit (Step E) fails

**Group 1 or 2 fails:** Data linkage or lifecycle timestamps are wrong.
Investigate the specific check that failed, correct the data, and re-run the
audit. Do NOT roll back — the accounts and child records are correctly placed.

**Group 3 fails (residual children on partnership side):** Some child rows were
not relinked. Reset those migration_log rows to `verified` and re-run Step C:

```sql
-- Find which partnership still has children
-- (replace table/column with the failing table from the audit output)
SELECT object_id, COUNT(*) FROM attachments
WHERE object_type='partnership'
  AND object_id IN (
    SELECT source_id FROM migration_log WHERE batch_id='<BATCH_ID>'
  )
GROUP BY object_id;

-- Reset that row to verified so Step C retries it
UPDATE migration_log
  SET migration_status='verified', children_migrated_at=NULL, error_message=NULL
  WHERE batch_id='<BATCH_ID>' AND source_id=<PARTNERSHIP_ID>;

UPDATE partnerships
  SET migration_status='verified'
  WHERE id=<PARTNERSHIP_ID>;
```

Then re-run Step C for the batch.

**Group 4 fails (global orphan check):** If the orphan was introduced by this
migration, identify the child row, correct its `linked_object_id` or delete it.
If the orphan is pre-existing (predates this batch), document it as a known
data quality issue — see §8.

---

### Scenario E — Full rollback after Step D cutover

Only needed if migrated accounts are causing active UI problems and must be
completely removed.

```sql
-- Step 1: Move children back to partnerships (Scenario C rollback SQL above)

-- Step 2: Delete migrated accounts
DELETE FROM accounts
WHERE converted_from_partnership_id IN (
  SELECT source_id FROM migration_log WHERE batch_id='<BATCH_ID>'
);

-- Step 3: Reset partnership rows
UPDATE partnerships
SET migration_status    = 'legacy',
    migrated_account_id = NULL,
    migration_batch_id  = NULL,
    migrated_at         = NULL
WHERE migration_batch_id = '<BATCH_ID>';

-- Step 4: Delete migration_log
DELETE FROM migration_log WHERE batch_id='<BATCH_ID>';
```

Note: `getPartnerships()` already filters on `migration_status='legacy'`, so
the partnerships will reappear automatically once status is reset to `legacy`.
No code change needed.

---

## 7. Completed Batches Reference

| Batch ID | Category | org_type | partner_class | Source partnership IDs | Account IDs | Status |
|---|---|---|---|---|---|---|
| phase2-batch1-20260415 | government | partner | funding | 3 | 62 | complete |
| phase2-batch2-20260415 | strategic_industry | association | *(none)* | 4 | 63 | complete |

---

## 8. Pre-existing Data Quality Issues

These issues exist in the database independently of migration work. They will
cause the post-cutover audit (Step E) Group 4 check to report FAIL until
resolved. They are **not introduced by migration** and do not affect the
correctness of any completed batch.

| ID | Table | Issue | Recommended fix |
|---|---|---|---|
| F3 | `tasks` | `task.id=10` has `linked_object_type='account'` but `linked_object_id=NULL` — demo task with no account linked | `UPDATE tasks SET linked_object_type=NULL WHERE id=10;` or `DELETE FROM tasks WHERE id=10;` |
| F5 | `quotes` | 40 of 41 quotes have `account_id=1` which no longer exists | Investigate whether account 1 was a test account; re-link or null the field |
| F6 | `email_messages` | 205 `source_account_id` values point to `leads.id=1`, not an account — semantic column mismatch | Assess whether this column should reference leads table; no migration impact |
| F4 | `contacts` | contacts id=25/26/27 have `account_id` pointing to accounts 27/28 (deleted) | `UPDATE contacts SET account_id=NULL WHERE id IN (25,26,27);` or re-link |

Resolving F3 first is recommended — it is the only one that will cause the
post-cutover audit to fail for every future batch until cleared.
