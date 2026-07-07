---
name: Disconnected Gmail Sync Fix
description: 4-layer guard pattern for expired/revoked Gmail accounts — prevents noisy logs and wasted API calls without touching the OAuth flow.
---

## The Rule

Expired/revoked Gmail accounts must be blocked at **4 independent layers**:

1. **`syncIncremental(accountId)` service** (line 226) — checks `authStatus === "revoked" || "error" || "expired"`, returns `{ ...EMPTY, reason: "auth_status=..." }` (never throws).
2. **`runIncrementalForAll()` DB query** — adds `eq(emailAccounts.authStatus, "active")` to the `where()` clause alongside `isActive=true` and `syncEnabled=true`. Expired accounts are filtered at the SQL level, never even loaded.
3. **Backfill scripts** (`scripts/attachment-backfill-all.ts`, `scripts/html-backfill-all.ts`) — after the null-check for the account, add `if (acct.authStatus !== "active") { log("[skip]..."); process.exit(0); }` **before** the `getGmailClient` call.
4. **Inbox `canOverflow` gate** (`server/routes.ts`) — condition includes `acct?.authStatus === "active"`. Without this, on-demand Gmail backfill fires for expired/deleted accounts (e.g. stale test fixtures like account 639).

**Why:** `syncIncremental` already returns cleanly for expired accounts, but the scheduler was still logging a noisy `account=N skipped` line every 5 min because `runIncrementalForAll` included them. Backfill scripts failed with `[fatal]` instead of `[skip]`. Inbox overflow called backfill for accounts with no valid token.

**How to apply:** Any new sync/backfill entry point that iterates accounts must include `authStatus = 'active'` in the DB filter — do not rely solely on the `syncIncremental` skip guard.

## Test coverage

`tests/disconnected-gmail-sync.test.cjs` — 27 source-grep checks covering all 4 layers (G1–G4) plus route structure (B). Run with `node tests/disconnected-gmail-sync.test.cjs`.

## Observed outcome after fix

- Scheduled sync log: `accounts=2` (not 3) — expired account absent from DB query result
- `[gmail-incr] account=1 skipped` no longer appears in server logs
- Attachment/HTML backfill scripts log `[skip] account=1 auth_status=expired — reconnect required, nothing to do` and exit(0)
