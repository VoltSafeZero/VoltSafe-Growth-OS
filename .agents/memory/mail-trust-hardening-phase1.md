---
name: Mail Trust Hardening Phase 1
description: C1/C2/C3/C4 reliability fixes for VoltSafe Mail — send idempotency, draft fallback, localStorage scoping, scheduled retry.
---

## C1 — Send idempotency

- `sendIdempotencyCache: Map<string, {result, expiresAt}>` declared inside `registerRoutes` (module-lifetime, 5-min TTL, 10-min cleanup interval).
- Client sends `idempotencyKey: crypto.randomUUID()` (useRef, stable per compose session) in POST /api/gmail/send body.
- Server checks cache before calling sendEmail; stores result after success; returns `{...result, deduplicated: true}` on cache hit.
- Failed sends are NOT cached — retry attempts go through normally.

**Why:** A network drop between Gmail success and HTTP response causes duplicate sends. The idempotency key makes retries safe.

## C2 — Draft fallback on failed send

- Outer catch block in POST /api/gmail/send calls `saveDraft(resolved.userId, req.body.to, req.body.subject, req.body.body, req.body.threadId, undefined, resolved.accountId)`.
- Returns `{message, error, draftId, draftSaved}` with status 503.
- Client uses raw `fetch` (not `apiRequest`) to read full error body; on `err.draftSaved`, calls `setActiveDraftId(err.draftId)` to switch compose to draft-edit mode and shows "Send failed — saved as draft" toast.

**Why:** apiRequest throws on non-ok responses — raw fetch is needed to inspect the response body before throwing.

## C3 — User-scoped localStorage

- Module-level `function lsKey(key: string): string` in gmail-inbox.tsx reads userId from `queryClient.getQueryData(["/api/auth/me"])` at call time.
- Safe because auth gate in App.tsx ensures /api/auth/me is cached before GmailInboxPage mounts.
- All 6 keys updated: inbox.focusMode, inbox.density, crm-panel-expanded, inbox-list-width, inbox-top-expanded, inbox-bottom-expanded.
- Scoped format: `u${userId}.${key}` (e.g. `u1.inbox.focusMode`).

**Why:** Static localStorage keys cause layout/mailbox preference bleed between users sharing a browser profile.

## C4 — Retry failed scheduled sends

- `POST /api/gmail/scheduled/:id/retry` — master_admin only (same gate as cancel/create).
- Validates `email.status === 'failed'`; resets to `{status: 'pending', error: null}`.
- If `scheduledAt < now`, advances to `now + 30s` so next scheduler tick picks it up.
- Client: `retryScheduledMutation` + Retry button next to Failed badge with `data-testid="button-retry-scheduled-${email.id}"`.

## Test file

`tests/mail-trust-hardening.test.cjs` — 40 source-grep assertions, live API tests skipped gracefully when login unavailable.
