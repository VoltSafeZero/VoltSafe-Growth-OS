---
name: Per-mailbox email signatures
description: How signature ownership/scoping was made mailbox-aware instead of user-aware; use when adding features that must respect Private Email Inbox boundaries.
---

Email signatures were previously scoped only by `userId`, so every mailbox owned by the same user (including Private Email Inboxes) shared one signature pool. Fixed by adding a nullable `emailAccountId` on the signatures table (additive migration, not a Drizzle schema rewrite) and a single `assertSignatureAccountAccess(userId, accountId, isAdmin)` helper used by every signature route (GET/POST/PUT/DELETE/set-default).

**Rule:** `accountId == null` means the legacy, account-agnostic pool (always owned by the requesting user). `accountId` present means owner-or-admin only — checked against `email_accounts.userId`, not session identity alone.

**Why:** Private inboxes are a distinct trust boundary per `threat_model.md` (Elevation of Privilege) — any per-row resource keyed to a mailbox must be gated by an explicit ownership/admin check, not inherited implicitly from the parent user account.

**How to apply:** Any new per-mailbox resource (signatures, filters, rules, etc.) should follow the same pattern: nullable `emailAccountId` column + a single shared `assert*AccountAccess` helper reused across every route touching that resource, plus a legacy-NULL fallback so existing rows keep working. On the client, scope the relevant query's `queryKey` by the active mailbox id (e.g. `asAccountId`) — a bare `["/api/resource"]` key silently caches/leaks the first-loaded mailbox's data across mailbox switches.
