---
name: Mail Search Completeness Fix
description: Four root causes that made local email search return far fewer results than Gmail itself; fix patterns and audit infrastructure.
---

# Mail Search Completeness Fix

## Root Causes (do not re-introduce)

| # | Cause | Fix location |
|---|-------|--------------|
| RC-1 | `cc_emails` absent from LIKE fallback in `listLocalMessages`, `listLocalThreads`, `searchEmails` | All three files updated |
| RC-2 | `listLocalThreads` had an `if (freeText.includes('@'))` guard — LIKE fallback only applied to email-address searches, not all free-text | Guard removed; LIKE always applied |
| RC-3 | `cc_emails` absent from FTS tsvector expression and GIN index DDL in `email-search.ts` | Added to both `idx_email_fts_v3` and new `idx_email_cc_emails_trgm` |
| RC-4 | `all_participants` is NULL for historically-imported rows (pre-column-add) | `backfillAllParticipants()` repairs at startup (60s delay) and via admin on-demand endpoint |

## Required LIKE clause pattern (all three search files must have this)

```sql
lower(coalesce(from_email,''))     LIKE '%${lc}%'
OR lower(coalesce(all_participants,'')) LIKE '%${lc}%'
OR lower(coalesce(cc_emails,''))   LIKE '%${lc}%'
OR lower(coalesce(to_emails,''))   LIKE '%${lc}%'
OR lower(coalesce(subject,''))     LIKE '%${lc}%'
```

No `@` guard is acceptable on these clauses.

## Required FTS tsvector (cc_emails must be included)

```sql
to_tsvector('english',
  coalesce(subject,'') || ' ' ||
  coalesce(from_email,'') || ' ' ||
  coalesce(all_participants,'') || ' ' ||
  coalesce(cc_emails,'') || ' ' ||
  coalesce(body_text,'')
)
```

## Backfill infrastructure

- `server/services/mailbox-integrity.ts` — `backfillAllParticipants(opts?)`, `getMailboxAudit()`, `repairParticipantsForAccount(accountId)`
- `opts.force = true` bypasses the module-level `backfillDone` flag (needed for admin on-demand endpoint)
- Startup hook in `server/index.ts` — 60-second delay, fire-and-forget
- Admin routes: `GET /api/admin/mailbox/integrity-audit`, `POST /api/admin/mailbox/:id/repair-participants`, `POST /api/admin/mailbox/repair-all-participants`

## Regression test

`tests/mail-search-completeness.test.cjs` — 33 source-grep checks across 10 groups. Exits 1 on any failure.

**Why:** A search for "scott@voltsafe.com" returned ~3 results locally but 20+ in Spark Mail. The root cause was a combination of missing `cc_emails` coverage and an `all_participants = NULL` data gap for imported rows.

**How to apply:** Whenever touching `listLocalMessages`, `listLocalThreads`, or `searchEmails`, verify that `cc_emails` is present in both the LIKE clause and the tsvector. Run the regression test before shipping.
