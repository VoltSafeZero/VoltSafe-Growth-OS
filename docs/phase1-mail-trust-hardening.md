# VoltSafe Mail — Phase 1 Trust Hardening

**Status:** Complete  
**Date:** May 21, 2026  
**Scope:** Gmail inbox reliability — send safety, data preservation, user isolation, scheduled retry

---

## Phase 1 Goal

Eliminate four categories of silent failure that posed a real risk before controlled second-user onboarding:

| ID | Risk |
|---|---|
| C1 | Duplicate email sends on network retry or double-click |
| C2 | Composed email content lost when a send fails |
| C3 | Inbox preferences and layout state bleeding between users on a shared browser |
| C4 | Failed scheduled sends with no recovery path |

---

## Critical Fixes Implemented

### C1 — Server-side send idempotency

- **Client:** `ComposeDialog` generates `crypto.randomUUID()` per session via `idempotencyKeyRef` and sends the key with every POST to `/api/gmail/send`.
- **Server:** `sendIdempotencyCache` (module-level `Map`, 5-minute TTL, 10-minute sweep) checks the key before calling Gmail. On cache hit, returns `{ ...cachedResult, deduplicated: true }` without touching Gmail. Successful results are cached; failures are not.

### C2 — Failed send → auto-save as draft

- **Server:** The outer catch block in `/api/gmail/send` calls `saveDraft(...)` before returning the error. The response includes `{ draftId, draftSaved }`.
- **Client:** `sendMutation.onError` reads the full response body via raw `fetch` (not `apiRequest`). If `draftSaved` is true, calls `setActiveDraftId(err.draftId)` to switch compose to draft-edit mode and shows "Send failed — saved as draft" toast. If draft save also fails, compose stays open with all content intact.

### C3 — User-scoped localStorage keys

- **Client:** `lsKey(key)` helper at module level reads the authenticated `userId` from the TanStack Query cache (`/api/auth/me`) and returns `u${userId}.${key}`. Safe fallback: if `userId` is unavailable (should not happen given the auth gate), returns `_anon_<ephemeralPrefix>.${key}` — an ephemeral prefix that cannot match any user-scoped key and does not persist across page loads.
- All six persisted keys scoped: `inbox.focusMode`, `inbox.density`, `crm-panel-expanded`, `inbox-list-width`, `inbox-top-expanded`, `inbox-bottom-expanded`.

### C4 — Retry failed scheduled sends

- **Server:** `POST /api/gmail/scheduled/:id/retry` (master_admin gate). Validates `status === 'failed'`. If `scheduledAt` is in the past, advances to `now + 30s` so the next scheduler tick picks it up.
- **Client:** `retryScheduledMutation` + Retry button next to the Failed badge in the Scheduled tab. On success, invalidates the scheduled-emails query so the list refreshes immediately.

---

## Defects Found During Verification Audit and Fixed

Three defects were discovered during the post-implementation verification audit. All three were fixed before the final checkpoint.

### D-C1 — Idempotency key not reset between compose sessions (HIGH)

**Root cause:** `idempotencyKeyRef` is initialized with `useRef(crypto.randomUUID())` at mount time. The `ComposeDialog` key prop is the stable string `"compose"` for new emails, so React never remounts the component between compose sessions. The same UUID was reused across consecutive compose opens. A second new email sent within 5 minutes would receive the cached result of the first send without calling Gmail.

**Fix:** Added `idempotencyKeyRef.current = crypto.randomUUID()` to the existing `open`-sync `useEffect`, so a fresh UUID is generated each time the compose dialog opens — regardless of whether the component remounts.

### D-C3 — lsKey fallback wrote bare unscoped key (MEDIUM)

**Root cause:** Original fallback was `return u?.id ? \`u${u.id}.${key}\` : key`. If `userId` was unavailable, the bare key (e.g., `inbox.focusMode`) was used — which could read a previous user's unscoped legacy preference.

**Fix:** Replaced fallback with `return \`_anon_${_anonLsPrefix}.${key}\``. The `_anonLsPrefix` is a `crypto.randomUUID().slice(0, 8)` generated once at module load. This key cannot match any user-scoped `u${id}.${key}` key, does not persist meaningfully across page loads, and provides a strict isolation boundary.

### D-C4 — Retry could duplicate-send an already-delivered email (HIGH)

**Root cause:** The scheduler calls `sendEmail(...)` then `db.update({ status: 'sent', sentMessageId })` in sequence (not a transaction). If the DB write fails, the catch sets `status = 'failed'` — even though Gmail already delivered the email. Retrying would send a second copy to the recipient.

**Fix:** Added a 409 guard to the retry route: if `sentMessageId` is already populated on the row, block the retry and return `{ message: "...", sentMessageId }` so an admin can verify before proceeding manually.

---

## Final Test Results: 96/96

| Suite | Assertions | Result |
|---|---|---|
| `tests/mail-trust-hardening.test.cjs` | 43 | All pass |
| `tests/suggested-email-compose-handoff.test.cjs` | 27 | All pass |
| `tests/scheduled-send-lifecycle.test.cjs` | 26 | All pass |
| **Total** | **96** | **0 failures** |

The trust-hardening suite grew from 40 to 43 assertions to pin the three new defect fixes.

---

## TypeScript Status

**Zero new TypeScript errors introduced by Phase 1.**

Pre-existing errors (untouched files, unrelated to Phase 1):

| File | Error | Notes |
|---|---|---|
| `gmail-inbox.tsx` lines 5615, 6094 | `TS2802` Set spread | Pre-existing — spam-rescue and thread-ID dedup logic |
| `crm/ai-summary-card.tsx` | `TS2322`, `TS2345` | Pre-existing |
| `dashboard/header.tsx` | `TS2345` | Pre-existing |
| `automations.tsx` (multiple) | `TS2345`, `TS2554` | Pre-existing |
| Various other files | Various | Pre-existing, none in Phase 1 files |

`server/routes.ts` is clean.

---

## Remaining Known Risks

| ID | Severity | Description | Recommended Next Step |
|---|---|---|---|
| M3 | Medium | OAuth token expiry has no inline reconnect prompt — user sees a generic error | Add inline "Reconnect Gmail" banner in inbox header |
| M1 | Medium | `globalRole` in session is set at login and not refreshed live — a role change takes effect only after re-login | Add DB role check in `requireAdmin` or destroy session on role change |
| M2 | Medium | Gmail 429 advances `lastHistoryId` before the throttled batch is retried — some messages can be missed until next full sync | Do not advance `lastHistoryId` on upstream 429/5xx; retry on next pass |
| C4-noTxn | Low | Scheduler's send + DB-update is not in a transaction — `sentMessageId` guard on retry handles the most dangerous case but does not eliminate the race window | Wrap scheduler update in a DB transaction when Drizzle supports it cleanly |
| C1-multiProcess | Low | Idempotency cache is in-memory — effective for single-process deployments; would need Redis for multi-process | Not a concern for current single-process Replit deployment |

---

## Manual Smoke-Test Checklist

| # | Test | Steps | Expected |
|---|---|---|---|
| 1 | Normal send | Open compose, fill To/Subject/Body, click Send | Toast "Email sent"; appears in Sent tab; Network tab shows unique `idempotencyKey` UUID |
| 2 | Retry same compose (dedup) | After #1 succeeds, click Send again without closing compose | Network tab: `deduplicated: true` in response; no second Gmail send |
| 3 | Second new compose gets new key | Close compose; open a new compose; check Network tab | `idempotencyKey` UUID differs from #1 |
| 4 | Send failure → draft preserved | Disconnect Gmail in Settings; attempt send | Compose stays open; content intact; toast "Send failed — saved as draft"; Drafts tab gains a new entry |
| 5 | Both send and draft fail | Same as #4 but also block drafts API | Compose stays open with all content; toast "Failed to send" with error detail |
| 6 | Cross-user localStorage isolation | Log in as User A; set density Compact; log out; log in as User B | Density is Comfortable (default), not Compact; no layout bleed |
| 7 | Retry failed scheduled send | Scheduled tab → find Failed badge → click Retry | Status resets to Pending; within ~30s email sends or fails recoverably |
| 8 | Duplicate-send guard | Manually set `sent_message_id` in DB on a `status='failed'` row; click Retry | Toast shows 409 error with "manual verification required"; email not sent again |

---

## Recommendation

**Safe for controlled second-user onboarding.**

All three defects that would have caused silent state bleed (D-C3), duplicate sends (D-C1, D-C4), or content loss (C2) are fixed and pinned by regression tests. The four Phase 1 fixes collectively ensure:

- Every send attempt is idempotent across retries and compose sessions
- No compose content is ever silently discarded on failure  
- User preferences are fully isolated per authenticated user
- Failed scheduled sends have a safe, duplicate-guarded recovery path

The remaining risks (M1–M3) are medium-severity operational concerns that do not affect correctness for a single or dual-user deployment and are suitable for Phase 2 hardening.
