---
name: CURRENTS DM NULL body bug
description: current_messages.body is TEXT NOT NULL — DM POST route must always insert '' not NULL for attachment-only messages.
---

## The Rule
The DM POST route (`POST /api/current/dms/:id/messages`) must always insert an empty string `''` for body when no text is provided (attachment-only messages). Never insert SQL `NULL`.

**Why:** `current_messages.body TEXT NOT NULL` — inserting NULL causes a Postgres constraint violation → 500 error → "Message not sent" toast.

**How to apply:** If you ever add a new message-sending route that accepts attachment-only payloads, use `const escaped = rawBody.replace(/'/g, "''")` and insert `'${escaped}'`. Channel, thread reply, and CRM record routes already follow this pattern.

## Other routes (confirmed correct)
- Channel POST: uses `'${escaped}'` ✅
- Thread reply POST: uses `'${escaped}'` ✅
- CRM record POST: uses `'${escaped}'` ✅

## Regression test
`tests/currents-attachments.test.cjs` section 17 (4 checks) pins this invariant.
