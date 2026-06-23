---
name: Badge vs List Blocked-Sender Mismatch
description: Server-side badge counts (category-counts + health API) must exclude blocked_senders rows, or the badge shows stale counts for messages the client hides.
---

## The Rule

Any server-side SQL that computes unread badge counts (category-counts, health API `unread_count` subquery) **must** add:

```sql
AND NOT EXISTS (SELECT 1 FROM blocked_senders bs WHERE bs.email = email_messages.from_email)
```

The client's `inboxMainRaw` already filters these messages via `blockedEmails.has(m.fromEmail)`, but without the server-side exclusion the badge overcounts.

**Why:** Production had badge=1 / People list=0. The server correctly returned the one unread people message (`messageCount:1, labelIdsHaveUNREAD:1` in INBOX-RESPONSE logs), but the client stripped it because its `fromEmail` was in `blocked_senders`. The badge SQL had no such exclusion, so it counted the hidden message.

**How to apply:** Whenever adding a new count-query endpoint (inbox stats, health, category-counts variants), include the `NOT EXISTS (blocked_senders)` clause. The list endpoint itself is fine with the client-side filter as a safety net, but the *count* endpoints must match what the client renders.

## Affected locations (as of fix)

- `server/routes.ts` — health API `unread_count` subquery (per-account inline SELECT inside the main accounts query)
- `server/routes.ts` — `/api/gmail/category-counts` outer `WHERE` clause
