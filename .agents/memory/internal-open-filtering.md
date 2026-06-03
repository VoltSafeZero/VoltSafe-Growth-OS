---
name: Internal Open Filtering
description: Recipient-level engagement tracking — internal domain filtering, email_recipients table, is_internal flag, backfill script.
---

## What was built
HubSpot-style recipient-level engagement tracking with internal domain suppression. Internal opens/clicks are **stored** (for audit) but **excluded** from all engagement counts, scores, badges, and widgets.

## Key decisions

**is_internal stored, not deleted**
Internal events get `is_internal = TRUE` + `internal_reason = 'internal_domain:<domain>'`. They are never deleted. All queries add `AND is_internal IS NOT TRUE` filter. This lets you audit internal usage without it distorting customer engagement metrics.

**Why:** Deleting rows loses audit trail. Filtering at query time is always consistent without any backfill timing risk.

**Internal domains: configurable**
Default: `voltsafe.com,voltsafemarine.com`. Override via `INTERNAL_EMAIL_DOMAINS` env var (comma-separated). Defined in `INTERNAL_DOMAINS` Set exported from `server/tracking.ts`.

**email_recipients table**
Populated at send time for every outbound message — one row per TO/CC/BCC address. Columns: `gmail_message_id, gmail_thread_id, recipient_email, recipient_name, recipient_type, is_primary, is_internal, tracking_token, created_at`. Unique index on `(gmail_message_id, recipient_email)` — safe to re-run with ON CONFLICT DO NOTHING. Historical threads before this feature have no rows; the engagement-intelligence query falls back to pixel-based breakdown.

**How to apply:**
- Any new engagement count query MUST include `AND is_internal IS NOT TRUE` in FILTER or WHERE.
- Any new engagement INSERT (recordOpen/recordClick pattern) must detect `isInternalEmail(pixel?.recipient_email)` and skip scoring/dedup when internal.
- New send paths must write to `email_recipients` after sending.

## Files changed
- `server/tracking.ts` — `INTERNAL_DOMAINS`, `isInternalEmail()`, `recordOpen`, `recordClick`, `updateScore`, `getEngagementStats`
- `server/services/engagement-intelligence.ts` — `RecipientBreakdown` type, `ThreadEngagementFull.recipientBreakdown`, openRows/linkRows FILTER, recipientBreakdown query (with pixel fallback)
- `server/routes.ts` — tracking import, send pipeline `email_recipients` INSERT, needs-reply query, thread-signals query
- `server/seed-production.ts` — `migrateEmailRecipientsSchema()`, `migrateInternalEngagementSchema()`
- `server/index.ts` — migration calls added
- `client/src/components/engagement/EngagementWidget.tsx` — `RecipientBreakdown` interface, recipient breakdown section in expanded panel

## Scripts / tests
- `scripts/internal-open-backfill.ts` — idempotent, supports `--dry-run`, resets pixel scores for internal recipients
- `tests/internal-open-filter.test.js` — 30 source-grep checks
- `tests/recipient-tracking.test.js` — 27 source-grep checks
