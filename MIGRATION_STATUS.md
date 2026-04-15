# VoltSafe Cortex — Migration Status

Last updated: 2026-04-15

---

## Completed Batches

| Batch ID | Category Migrated | org_type | partner_class | Source Rows | Accounts Created | Child Rows Relinked | Audit Result | Date Completed |
|---|---|---|---|---|---|---|---|---|
| phase2-batch1-20260415 | government | partner | funding | 1 | 1 (id=62, Innovate BC) | 0 | ✓ PASS 32/32 | 2026-04-15 |
| phase2-batch2-20260415 | strategic_industry | association | — | 1 | 1 (id=63, Boating Ontario) | 1 (attachment) | ✓ PASS 32/32 | 2026-04-15 |

---

## Batch Detail

### phase2-batch1-20260415

| Field | Value |
|---|---|
| Batch ID | phase2-batch1-20260415 |
| Category | government |
| org_type | partner |
| partner_class | funding |
| Source partnerships.id | 3 |
| Target accounts.id | 62 |
| Partnership name | Innovate BC |
| Account name | Innovate BC |
| Migrated at | 2026-04-15 |
| Verified at | 2026-04-15 |
| Children migrated at | 2026-04-15 |
| Final status | complete |
| Child rows relinked | 0 (no pre-existing children) |
| Post-cutover audit | ✓ PASS — 32/32 checks |
| Error message | — |

### phase2-batch2-20260415

| Field | Value |
|---|---|
| Batch ID | phase2-batch2-20260415 |
| Category | strategic_industry |
| org_type | association |
| partner_class | — |
| Source partnerships.id | 4 |
| Target accounts.id | 63 |
| Partnership name | Boating Ontario |
| Account name | Boating Ontario |
| Migrated at | 2026-04-15 |
| Verified at | 2026-04-15 |
| Children migrated at | 2026-04-15 |
| Final status | complete |
| Child rows relinked | 1 (attachments: IMG_7984.jpeg) |
| Post-cutover audit | ✓ PASS — 32/32 checks |
| Error message | — |

---

## Pipeline Summary

| Step | Script | Last Successful Run |
|---|---|---|
| A — Migrate | scripts/migrate-partnerships.js | 2026-04-15 (batch1 + batch2) |
| B — Verify | scripts/verify-migration.js | 2026-04-15 (batch1 + batch2) |
| C — Relink children | scripts/relink-children.js | 2026-04-15 (batch1 + batch2) |
| D — Frontend cutover | Manual checklist | 2026-04-15 |
| E — Post-cutover audit | scripts/post-cutover-audit.js | 2026-04-15 (both PASS 32/32) |

---

## Pending Batches

| Priority | Category | Rows Available | Target org_type | Notes |
|---|---|---|---|---|
| 1 | research_academic | 0 | research | Awaiting data |
| 2 | government_public | 0 | regulatory | Awaiting data |
| 3 | media_tradeshows | 0 | association | Awaiting data |
| 4 | innovation_research | 0 | partner | Check govt overlap before running |
| 5 | distribution | 0 | distributor | Awaiting data |
| 6 | channel | 0 | distributor | Run after distribution |
| 7 | pilot_site | 0 | pilot_site | Awaiting data |
| 8 | investor | 0 | partner | Requires CRO/CFO sign-off — see MIGRATION_CUTOVER.md §3 |
