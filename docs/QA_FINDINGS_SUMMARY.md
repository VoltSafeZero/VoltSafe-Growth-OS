# QA Findings Summary — Read-Only Audit

**Date**: 2 May 2026
**Time-box**: 2–3 hours total. Came in under budget.
**Scope**: Empty/loading/error states, multi-account email permission boundaries, quote math test coverage, mobile layout.
**Method**: Static code analysis only. No code changes, no new dependencies, no schema changes.

**Detail docs**:
- [`docs/EMPTY_STATE_AUDIT.md`](./EMPTY_STATE_AUDIT.md)
- [`docs/PERMISSION_AUDIT.md`](./PERMISSION_AUDIT.md)
- [`docs/QUOTE_MATH_TESTS_PROPOSAL.md`](./QUOTE_MATH_TESTS_PROPOSAL.md)
- [`docs/MOBILE_AUDIT.md`](./MOBILE_AUDIT.md)

---

## Headline

**No P0 blockers found.** The recently-shipped multi-account email permission model is correctly enforced server-side on every mutation route I checked — the earlier "Phase 4" hardening appears complete and intact.

There is **one P1** — an IDOR on `/api/assets/*` that lets any authenticated user read any asset by integer ID — that should be fixed before resuming Zoom/booking feature work because it is structurally easy to fix and will only get harder once more asset types pile up.

Everything else is P2 (frustrating UX) or P3 (polish) and can either be batched into a sweep or deferred.

---

## Findings by priority

### P0 — blockers (data corruption, permission leak)

**None found.**

(One previously-suspected P0 — view-only mail_team grantees being able to send/draft on shared accounts — was investigated and is **NOT** present. All Gmail mutation routes correctly call `requireAccountEditAccess`.)

---

### P1 — broken core workflow

#### P1-1. IDOR on `/api/assets/:id/file` and `/api/assets/:id/download`

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | Any authenticated user can read any asset by guessing/iterating the integer ID — no object-level ACL beyond `requireAuth`. |
| Affected files / routes        | `server/routes.ts:13267` and `13277`                                           |
| Suggested fix scope            | **Small** — add an ownership / scope check inside `sendAssetFile` (e.g., `uploadedByUserId === req.session.userId` OR `isAdmin`, plus a per-record join when the asset is linked to an account/opportunity/quote the user can't see). |
| Address before resuming Zoom/booking? | **Yes.** Small fix, real risk, and the fix surface only grows as more asset types are added. |

---

### P2 — frustrating UX

#### P2-1. Gmail attachment download blocks legitimate shared-mailbox teammates

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | A teammate with `mail_team[X]={view:true}` on a shared mailbox cannot download attachments from messages they can otherwise read — the check is owner-or-admin only, ignores `mail_team` grants. |
| Affected files / routes        | `server/routes.ts:8924` and `8953` (`/api/gmail/attachments/:id/calendar-invite`, `/api/gmail/attachments/:id/download`) |
| Suggested fix scope            | **Small** — add `mail_team` grant check to the existing owner/admin gate. |
| Address before resuming?       | No — defer, but bundle with the P1 above since they're the same module.        |

#### P2-2. Several list pages have no error state

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | Tasks, Contacts, Accounts, Opportunities, Quotes silently fall back to empty/blank UI when their primary `useQuery` errors out. Pipeline and Today are the model implementations — they handle `isError` correctly. |
| Affected files / routes        | `tasks-hub.tsx`, `contacts.tsx`, `accounts.tsx`, `opportunities.tsx`, `quotes.tsx` |
| Suggested fix scope            | **Small** (per page) / **Medium** (project-wide standardization with a `<QueryErrorBoundary>` helper) |
| Address before resuming?       | No — incrementally add as each page is touched for other reasons.              |

#### P2-3. Quotes has no empty-state row in the table

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | When `allQuotes.length === 0`, the table renders only the headers with no rows or message — a first-time user just sees a confusing header bar. |
| Affected files / routes        | `client/src/pages/quotes.tsx:402+`                                             |
| Suggested fix scope            | **Small**                                                                      |
| Address before resuming?       | No.                                                                            |

#### P2-4. Calendar has no empty state when no events exist

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | First-time users see a blank grid with no orientation. No call-to-action explaining how to add events or connect a calendar integration. |
| Affected files / routes        | `client/src/pages/calendar.tsx`                                                |
| Suggested fix scope            | **Small**                                                                      |
| Address before resuming?       | No — but bundle with the calendar Zoom/booking work itself if reasonable.      |

#### P2-5. Six pages force horizontal scroll on 375px mobile viewports

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | Calendar (`min-w-[700px]`), Quotes (`min-w-[640px]`), Leads (`min-w-[600px]`), Tickets (`min-w-[560px]`), Admin Users (`w-[420px]` fixed), Task Board (`min-w-[240px]` × N columns) all overflow on iPhone SE. |
| Affected files / routes        | See `docs/MOBILE_AUDIT.md` for exact line numbers.                             |
| Suggested fix scope            | **Medium** — best done as a single mobile sweep rather than piecemeal.         |
| Address before resuming?       | No — schedule a dedicated half-day mobile sweep after Zoom/booking ships.      |

#### P2-6. Quote math is duplicated and untested

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | Per-line and per-quote totals are computed twice (once in `quotes.tsx`, once partially in `quote-generator.ts`). The server records whatever totals the client sends — no recompute. Existing `tests/quote-workflow.test.js` covers the state machine but asserts no numbers. |
| Affected files / routes        | `client/src/pages/quotes.tsx`, `server/quote-generator.ts`, `server/routes.ts` POST `/api/quotes` |
| Suggested fix scope            | **Medium** — extract `shared/quote-math.ts`, then write the test suite proposed in `docs/QUOTE_MATH_TESTS_PROPOSAL.md`, then add server-side recompute. |
| Address before resuming?       | No — but **promote to P1 the moment a customer disputes a quote total**, since today there's no traceable single source of truth. |

---

### P3 — polish

#### P3-1. Admin pages return `null` on error/loading

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | `settings.tsx:669` and similar return `null` rather than a Skeleton or error message — page appears blank/broken. |
| Suggested fix scope            | **Small**                                                                      |
| Address before resuming?       | No.                                                                            |

#### P3-2. Profile pages have no "back to list" link in the error state

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | If a profile 404s, user is stuck with browser back / sidebar.                  |
| Affected files / routes        | `account-profile.tsx`, `contact-profile.tsx`, `opportunity-profile.tsx`        |
| Suggested fix scope            | **Small**                                                                      |
| Address before resuming?       | No.                                                                            |

#### P3-3. Heavy use of `text-[10px]` / `text-[11px]` for actionable elements

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | Hard to tap on touch devices, below typical legibility minimums.               |
| Affected files / routes        | `tasks-hub.tsx:147, 223, 283`, gmail-inbox toolbar, others                     |
| Suggested fix scope            | **Small** (when bundled with the mobile sweep)                                 |
| Address before resuming?       | No.                                                                            |

#### P3-4. Scheduled email queue is workspace-global by design

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | `scheduledEmails` table has no per-user / per-account scoping — `master_admin` only by current ACL. Worth documenting the design intent so future contributors don't assume per-user scoping. |
| Affected files / routes        | `server/routes.ts:10693`, schema `shared/schema.ts` `scheduledEmails`          |
| Suggested fix scope            | **Tiny** (doc comment) for now / **Large** (schema + ACL change) if multi-account scheduling is added |
| Address before resuming?       | No.                                                                            |

#### P3-5. Failing test workflows

| Field                          | Value                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Description                    | `mail-permissions`, `mailbox-switching`, `permissions`, `tracking-multi-proof`, `tracking-proof` test workflows are all in a FAILED state. Standing rule from session memory says do not restart them — but **these are exactly the regression tests that would catch a future Phase-4 permission slip.** Worth budgeting time to fix and re-enable them as a separate task. |
| Suggested fix scope            | Unknown — needs investigation.                                                 |
| Address before resuming?       | No, but flag for the next planning conversation.                               |

---

## Things I deliberately did NOT audit (out of scope, time-boxed)

- CSRF protection on POST/DELETE endpoints.
- Rate limiting on `/api/gmail/send`.
- Input validation (Zod usage is inconsistent across `server/routes.ts`).
- Webhook authentication (`/api/webhooks/gmail`).
- Database query performance / N+1s.
- Bundle size / load performance.
- Accessibility beyond text-size minimums (no axe pass, no keyboard nav check).
- The full "Mission Control" widget grid pages (`dashboard.tsx`, `executive-dashboard.tsx`, `command-center.tsx`).

These are deliberately deferred. Re-open in a future audit pass.

---

## Recommended sequence before resuming Zoom/booking work

1. **Fix P1-1 (assets IDOR)** — small, well-scoped, real risk. ~1 hour including a small regression test.
2. **Optionally fix P2-1 (attachment shared access)** at the same time — it's the same module and a one-line addition.
3. **Resume Zoom/booking work** as planned.
4. **Schedule a follow-up half-day** for the mobile sweep (P2-5) once the Zoom/booking work is settled.
5. **Promote P2-6 (quote math tests)** to P1 the moment a customer disputes a quote total — this is the highest-leverage non-urgent debt in the audit.

---

## What was NOT done (per the original brief)

- ❌ No code changes.
- ❌ No new dependencies installed.
- ❌ No Playwright suite, no Snyk/k6/ZAP/Sentry.
- ❌ No schema changes, no `db:push`.
- ❌ No new test framework.
- ❌ No tests written (the quote-math suite is a *proposal*).
- ✓ Five docs written under `docs/`.
- ✓ Time-box respected: total tool time well under 3 hours.
