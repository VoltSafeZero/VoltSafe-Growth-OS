---
name: Email Tools (Snippets & Templates) Architecture
description: DB-backed snippets library at /marketing/email-tools — the composer localStorage snippets and the org library are two separate systems
---

## Rule
Snippets exist in TWO systems:
1. **Org Library** (`email_snippets` table, `/marketing/email-tools`) — DB-backed, team-visible, API at `/api/email-snippets`
2. **Composer snippets** (`voltsafe_mail_snippets_v1` localStorage key, `use-snippets.ts`) — browser-local, per-device

Do NOT try to merge these into one system without considering that the composer hook is synchronous and localStorage is intentional for speed.

**Why:** The migration was intentionally additive — localStorage for composer speed, DB for org-wide discoverability. A full migration would require making `useSnippets` async throughout.

**How to apply:** When adding org-wide snippet features, work with the DB system. When adding composer features, work with the localStorage hook.

## Seed endpoint
`POST /api/email-snippets/seed-defaults` (admin only) — seeds 15 starter marina sales templates. Idempotent via `is_starter = TRUE` dedup check per title.

## Permissions
- Admin/master_admin/CEO → full CRUD on all snippets
- Others → can see org-scoped + own private; can only edit/delete own
