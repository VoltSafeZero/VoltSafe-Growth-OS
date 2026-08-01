---
name: Next Action Foundation (Run 1)
description: Schema, trigger, status derivation, smart priority, estimated value, and org settings for the Next Action system. Run 2 builds UI and API on top.
---

## What was built (Run 1)

### DB Schema
- `next_actions` table: `lead_id` XOR `account_id` (enforced by `CHECK (num_nonnulls(lead_id, account_id) = 1)`), `waiting_on` IN ('voltsafe','customer'), `status` IN ('open','completed','cancelled')
- `org_settings` singleton table: id=1 always, inserted via `ON CONFLICT DO NOTHING`; read exclusively through `server/services/org-settings.ts`
- New lead columns: `priority TEXT NOT NULL DEFAULT 'medium'`, `fit TEXT NULL`, `shore_power_coverage_pct NUMERIC NULL`, `deal_value_override NUMERIC NULL`
- New account columns: `fit TEXT NULL`, `shore_power_coverage_pct NUMERIC NULL`, `deal_value_override NUMERIC NULL`

### Partial unique indexes (enforce one open action per entity)
```sql
CREATE UNIQUE INDEX uq_next_actions_open_lead    ON next_actions(lead_id)    WHERE status='open' AND lead_id IS NOT NULL;
CREATE UNIQUE INDEX uq_next_actions_open_account ON next_actions(account_id) WHERE status='open' AND account_id IS NOT NULL;
```
Historical (completed/cancelled) rows don't count — this is intentional.

### DB Trigger: trg_next_actions_auto_ts
- INSERT: fills `waiting_since_at` and `updated_at` with NOW()
- UPDATE: always bumps `updated_at`; if `waiting_on` changes → reset `waiting_since_at`, if changed to 'voltsafe' → clear `due_at`; if status→completed → set `completed_at`; if status→cancelled → set `cancelled_at`
- Pattern: `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` (idempotent)

### Service files
- `server/services/org-settings.ts`: `getOrgSettings()` async with 60s in-process cache; `invalidateOrgSettingsCache()` call after updates; always falls back to typed defaults if table missing
- `server/services/next-action-status.ts`: pure 10-state `deriveNextActionStatus()`; `calendarDaysBetween()` using `Intl.DateTimeFormat('en-CA')` for DST-safe calendar day math; `STATUS_BUCKET` ordinal map; `computeSmartPriority()`, `compareSmartPriority()`
- `server/services/next-action-value.ts`: `parseSlipCount()`, `buildSlipParseReport()`, `calculateEstimatedValue()`

### 10 states (eval order, locked for Run 2 visual contract)
SNOOZED → BLOCKED → CUSTOMER_NUDGE_DUE / WAITING_CUSTOMER → SCHEDULED / DUE / CRITICAL → NEVER_CONTACTED → UNKNOWN → NO_ACTION

### Smart Priority bucket order (1=most urgent, 10=least)
CRITICAL(1) > DUE(2) > CUSTOMER_NUDGE_DUE(3) > NEVER_CONTACTED(4) > SCHEDULED(5) > WAITING_CUSTOMER(6) > BLOCKED(7) > SNOOZED(8) > UNKNOWN(9) > NO_ACTION(10)

### NULL due_at sort rule
**Why:** `due_at=NULL` means "immediately due" (most urgent DUE). relevantTimestamp for DUE/CRITICAL = `effectiveDueAt = dueAt ?? createdAt`. Never raw null — otherwise null sorts last (Infinity).

### DST-safe calendar day calculation
**Why:** Raw `(b - a) / 86400000` gives wrong calendar day counts across DST boundaries.
**How to apply:** Use `Intl.DateTimeFormat('en-CA', { timeZone: tz })` → extract year/month/day → convert to UTC-noon dates → difference. This is the production pattern in `calendarDaysBetween()`.

### Slip parsing dry run results (dev DB)
- 55,129 total leads; 7,541 non-empty slips
- 6,674 exact integers (high confidence); 865 dash-only (reject); 2 prose (reject)
- Clean parse rate = 88.5% → backfill recommended (threshold 70%)
- All slips are either pure integers or dash-only — no ranges, plus-suffix, or negatives

### Next action dry run results
- Only 1 lead in dev DB has ever been contacted (lead 10097: "Marina Quay West")
- 0 account next-action proposals (per spec)
- 55,128 leads would show NEVER_CONTACTED; 1 would show DUE (voltSafe_owes_reply, due_at=NULL)

### Migration wiring
Both functions exported from `server/seed-production.ts` and registered in `server/index.ts` Batch 2 (parallel). Runs when `RUN_STARTUP_MIGRATIONS=true` is set.

## Run 2 prerequisites
- API routes: CRUD for `next_actions`, PATCH for `org_settings`
- Query layer: join `next_actions` (open only) + `lead_comms_summary` to derive status
- UI: status badge, inline action editor, org settings page, Smart Priority sort column
