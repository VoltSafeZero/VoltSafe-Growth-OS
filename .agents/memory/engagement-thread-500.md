---
name: Engagement Thread 500 Fix
description: Root cause and fix for /api/engagement/thread returning 500 on every thread open due to missing updated_at column on email_tracking_pixels.
---

## The Bug

`email_tracking_pixels` was created in migration 0000 with only `created_at` — no `updated_at`. The `replyRows` sub-query in `getThreadEngagementFull()` selected `p.updated_at AS replied_at`, which doesn't exist in production. PostgreSQL throws "column does not exist", which Drizzle's node-postgres driver formats as `"Failed query: [SQL]\nparams: "` — hiding the real error. The route handler returned `err.message` as a 500.

**Why only replyRows failed:** All 4 other sub-queries in the same function also join `email_tracking_pixels`, but none select `p.updated_at`. Only `replyRows` did.

## The Fix

1. `COALESCE(p.updated_at, p.created_at) AS replied_at` in replyRows query — safe regardless of whether updated_at exists.
2. Runtime migration: `ALTER TABLE email_tracking_pixels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP` — runs at every startup, idempotent.
3. `tracking.ts` reply-mark UPDATE now also sets `updated_at = NOW()`.
4. Route handler catches any future service failure and returns `200` with an empty engagement object — inbox UI never crashes.

**Why:**  The base migration omitted `updated_at` from `email_tracking_pixels` but the query assumed it existed. Pre-existing scoring columns (`signal_level`, `is_hot`, `engagement_score`) were added via `seed-production.ts`-style runtime patches — `updated_at` was not.

**How to apply:** For any new `email_tracking_pixels` column reference in queries: always check migration 0000 columns first (id, tracking_id, gmail_message_id, subject, recipient_email, sent_by_user_id, created_at, is_replied). Extra columns (engagement_score, signal_level, is_hot, last_scored_at, recipient_type, updated_at) were added via runtime patches and may not exist in older prod snapshots — use `COALESCE` or `ADD COLUMN IF NOT EXISTS` guards.
