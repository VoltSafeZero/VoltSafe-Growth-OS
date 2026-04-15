# Partnership → Account Migration: Step D Cutover Checklist

This document covers the repeatable frontend/API cutover process after Steps A–C
have completed successfully for a batch.

---

## Prerequisites

Before starting Step D, confirm:

- [ ] All rows for the batch have `migration_status = 'children_migrated'` in `migration_log`
- [ ] No rows for the batch are still in `migrated` or `verified` state
- [ ] `relink-children.js` reported 0 failures and 0 orphans

```sql
SELECT migration_status, COUNT(*)
FROM migration_log
WHERE batch_id = '<your-batch-id>'
GROUP BY migration_status;
```

Expected output: only `children_migrated`.

---

## Step D Checklist

### 1. Identify Affected Read Surfaces

Check every place the migrated partnerships category appeared:

- [ ] `GET /api/partnerships` — the main partnerships list API
- [ ] `GET /api/command-center` — stats block (activePartnerships, grantsGovt, investorConversations)
- [ ] Any saved views with `pageKey='partnerships'` or filters on the migrated category
- [ ] Any voice assistant or AI query that aggregates partnership data by category

**How to find them:**

```bash
grep -rn "partnerships\|/api/partnerships" server/routes.ts server/storage.ts \
  client/src/ --include="*.ts" --include="*.tsx" | grep -v "migration\|converted_from"
```

---

### 2. Exclude Migrated Rows from Legacy Partnership Reads

The core cutover in `server/storage.ts` — `getPartnerships()` must filter out
rows that have been migrated:

```typescript
// Already implemented as of Phase 2 Step D:
const conditions: SQL[] = [eq(partnerships.migrationStatus, "legacy")];
```

If new category cutovers happen, no additional code change is needed here —
`migration_status = 'legacy'` is the permanent filter.

**Verify:**

```bash
curl -s http://localhost:5000/api/partnerships | node -e \
  "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('rows:',d.length);"
```

Expected: count decreases by the number of migrated rows.

---

### 3. Update Summary / Stat Queries

Any raw SQL COUNT query that touches `partnerships` needs `AND migration_status = 'legacy'`.

Already implemented in `server/routes.ts` `GET /api/command-center`:

```sql
SELECT COUNT(*)::int AS n FROM partnerships WHERE migration_status = 'legacy'
SELECT COUNT(*)::int AS n FROM partnerships WHERE migration_status = 'legacy' AND category IN (...)
```

**Check for any other raw SQL on the partnerships table:**

```bash
grep -n "FROM partnerships" server/routes.ts | grep -v "migration_status"
```

Any line without `migration_status` is a candidate for review.

---

### 4. Confirm Migrated Entities Appear in Accounts

The two core surfaces to verify:

- [ ] `GET /api/accounts` returns the new accounts with correct `org_type` and `partner_class`
- [ ] The accounts list page shows correct org_type badge (color/label)
- [ ] The accounts detail panel renders `AttachmentsSection objectType="account"`

**Verification query:**

```sql
SELECT id, name, org_type, partner_class, converted_from_partnership_id
FROM accounts
WHERE converted_from_partnership_id IS NOT NULL
ORDER BY id;
```

---

### 5. Confirm Child Objects Render Under Accounts

For each migrated account, confirm:

- [ ] Notes previously linked to the partnership now appear under the account
- [ ] Attachments previously linked to the partnership now appear under the account
- [ ] No duplicate display (i.e., the partnerships page no longer shows the row)

**Spot-check query:**

```sql
-- Notes linked to migrated accounts (not partnerships)
SELECT n.id, n.linked_object_type, n.linked_object_id, n.content
FROM notes n
JOIN accounts a ON a.id = n.linked_object_id
WHERE n.linked_object_type = 'account'
  AND a.converted_from_partnership_id IS NOT NULL;

-- Any notes still incorrectly on partnerships with migrated status
SELECT n.id, n.linked_object_id
FROM notes n
JOIN partnerships p ON p.id = n.linked_object_id
WHERE n.linked_object_type = 'partnership'
  AND p.migration_status != 'legacy';
```

Expected: second query returns 0 rows.

---

### 6. Confirm No Duplicate Display

- [ ] Open the partnerships page — migrated entities must NOT appear
- [ ] Open the accounts/organizations page — migrated entities MUST appear with correct org_type
- [ ] Check command-center stat counts match expected post-migration values

---

### 7. Mark Batch Complete

After all checks pass, update the migration lifecycle to `complete`:

```sql
UPDATE migration_log
SET migration_status = 'complete'
WHERE batch_id = '<your-batch-id>'
  AND migration_status = 'children_migrated';

UPDATE partnerships
SET migration_status = 'complete'
WHERE migration_batch_id = '<your-batch-id>'
  AND migration_status = 'children_migrated';
```

---

### 8. Write Surfaces (New Creates)

After cutover, new records of the migrated org_type go to accounts, not partnerships:

- [ ] Confirm `POST /api/accounts` form includes the new org_type in `ORG_TYPE_OPTIONS`
- [ ] Confirm the partnerships create form does NOT offer the migrated category as an option
  (or, if it does, users understand it will route to the legacy table)

Currently: the accounts page (`client/src/pages/accounts.tsx`) already includes
`partner`, `association`, and all org_types in its create/edit form.

---

## Rollback (if cutover needs reverting)

### Rollback `getPartnerships` filter

Remove the `migration_status = 'legacy'` condition from `getPartnerships()` in
`server/storage.ts` temporarily.

### Rollback data state

```sql
-- Reset migration_log to children_migrated
UPDATE migration_log
SET migration_status = 'children_migrated'
WHERE batch_id = '<your-batch-id>' AND migration_status = 'complete';

-- Reset partnerships to children_migrated
UPDATE partnerships
SET migration_status = 'children_migrated'
WHERE migration_batch_id = '<your-batch-id>' AND migration_status = 'complete';
```

Child objects (notes, attachments) do NOT need rollback — they're already pointing
to accounts, which is the correct state for `children_migrated`.

---

## Completed Batches (Reference)

| Batch ID | Category Migrated | Target org_type | Target partner_class | Status |
|---|---|---|---|---|
| phase2-batch1-20260415 | government | partner | funding | complete |
| phase2-batch2-20260415 | strategic_industry | association | (none) | complete |

---

## Recommended Next Categories (when source data exists)

| priority | partnerships.category | Target org_type | Target partner_class | Notes |
|---|---|---|---|---|
| 1 | research_academic | research | (none) | 0 rows currently — await data |
| 2 | innovation_research | partner | innovation | Check for investor overlap |
| 3 | investor | partner | investor | Requires investor-specific fields |
| 4 | government_public | regulatory | (none) | Distinct from government/funding |
| 5 | media_tradeshows | association | media | Low complexity |
| 6 | distribution / channel | distributor | (none) | Check channel-commercial rows |
