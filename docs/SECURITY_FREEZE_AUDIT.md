# Security Freeze Audit — Production-Readiness Check

**Date**: 2026-05-03
**Auditor**: Replit Agent (read-only sweep)
**Scope**: `server/routes.ts` (24,654 lines), `server/routes-tasks.ts` (890 lines), `server/auth.ts` (156 lines), `server/voice-assistant-create-guards.ts` (430 lines)
**Method**: Read-only static analysis. No code, schema, dependency, or workflow mutations.
**Constraints honored**: No `db:push`, no installs, the 5 known-failed test workflows (`mail-permissions`, `mailbox-switching`, `permissions`, `tracking-multi-proof`, `tracking-proof`) were **not** restarted.

---

## Launch Verdict — **🟢 GREEN**

**Feature work may resume.**

Every P0 (anonymous-access) finding from the original `docs/ROUTE_SECURITY_SWEEP.md` and every P1 (mutation-gate / IDOR) finding promoted into `docs/ROUTE_SECURITY_SWEEP_REFRESH.md` is **closed** by commits #1–#5. The 359/359-passing security regression suite gives end-to-end coverage of the critical surfaces. The remaining items in this report are **P2 hardening** (defense-in-depth on workspace-shared writes that already require authentication) and **P3 nits** (consistency/docstring polish). None of them are exploitable without a valid session, and none expose cross-tenant or cross-mailbox data.

**Conditions on the green light**

1. Continue treating the 7 P2 findings in §10 as "must-close before next P0/P1 audit cycle" — they are tracked but **not** launch blockers.
2. Do not introduce new `app.METHOD` handlers without one of the documented gate patterns (§3). Any new route lacking an inline gate or a covering `app.use` mount should be treated as a regression.
3. The 5 pre-existing failing test workflows remain in the "do not touch" zone per project standing rules. They are unrelated to the route-security surface and were skipped in this audit.

---

## 1. Surface inventory

| File | `app.METHOD` handlers | `app.use` mounts | Notes |
| ---- | --------------------: | ---------------: | ----- |
| `server/routes.ts` | **712** | 32 | Main route table. |
| `server/routes-tasks.ts` | **27** | 0 | Each handler uses inline `canView` / `canEdit` per route. |
| **Total** | **739** | 32 | |

Of the 32 `app.use` mounts in `routes.ts`, 22 attach `requireAuth` (often combined with `requirePermission("section", "view")`) to entire `/api/...` prefixes — see §3. The other 10 are body parsers, CORS, session, etc.

---

## 2. Auth-middleware coverage

**`server/auth.ts` (the canonical middleware module) exposes:**

| Helper | Behavior | Used by |
| ------ | -------- | ------- |
| `requireAuth` | 401 if `!req.session?.userId`; 403 if `mustChangePassword` is true (except on `/auth/change-password`, `/auth/me`, `/auth/logout`). | Every `/api/*` route either inline or via `app.use`. |
| `requireAdmin` | 401 if not authenticated; 403 if `globalRole` is not `master_admin` or `admin`. | 48 occurrences in `routes.ts` (admin pages, board-pack, workspace-cleanup). |
| `requirePermission(section, "view"\|"edit")` | Master/admin bypass; advisor-block for `crm` / `partnerships` / `quoting`; otherwise reads the user's `permissions` JSON and compares against `none < view < edit`. | All section gates (CRM, communications, support, quoting, knowledge, team_workload, projects, partnerships). |
| `requireNotAdvisor` | 403 for `globalRole === "advisor"`. | All revenue / pipeline-insight prefixes. |
| `requireAccountEditAccess` (in `routes.ts`) | Owner OR admin OR `mail_team[acctId].edit`. | Email-message reassign/confirm + per-mailbox writes. |
| `requireThreadAssocEditAccess` / `checkThreadAssocEditForBulk` (commit #5) | Same axis as above but keyed off the association's anchor `email_message`. | The 7 thread-association mutations. |
| `noteOwnerOrAdmin` | Inline owner-or-admin check on note rows. | PUT/DELETE/PATCH `/api/notes/:id`. |
| `attachmentSectionFor(objectType)` (commit #5) | Maps an attachment's `objectType` → section (`crm`, `quoting`, `projects`, `support`, `knowledge`, `partnerships`). | POST/GET attachments. |

Mailbox ACL helpers are referenced **22** times across `routes.ts`. `requireAdmin`/`requireOwnerOrAdmin` together appear **48** times.

### Unauthenticated surface

A grep for `app.METHOD` handlers without any inline gate token returns **17 routes**, **all 17 of which are intentionally public**:

| Route | Why |
| ----- | --- |
| `GET /track/open/:trackingId.gif` | Email open pixel. |
| `GET /track/open/:trackingId` | Bare alias. |
| `GET /track/click/:trackingId` | Tracked-link redirect (validates http/https destination). |
| `POST /api/auth/login` | Login (rate-limited via `loginRateLimiter`). |
| `POST /api/auth/logout` | Destroys session. |
| `GET  /api/auth/me` | Inline `if (!session.userId) return 401`. |
| `POST /api/auth/change-password` | Inline 401 check. |
| `POST /api/auth/change-password-forced` | Inline 401 check. |
| `POST /api/auth/forgot-password` | Anonymous by design (rate-limited). |
| `POST /api/auth/reset-password-by-token` | Anonymous by design (token-gated, rate-limited). |
| `POST /api/webauthn/auth-options` | Public passkey challenge (returns only public credential descriptors). |
| `POST /api/contacts/extract-from-image` | `requirePermission("crm", "edit")` is on the next physical line — verified at L2900. |
| `POST /api/contacts/extract-from-url` | Same — verified at L2952. |
| `GET  /api/auth/google/callback` | OAuth target (state validated). |
| `POST /api/webhooks/gmail` | Pub/Sub webhook (constant-time `?token=` compare). |
| `GET  /api/zoom/oauth/callback` | OAuth target (state validated). |
| `GET /api/booking-links/public/:token` + `POST .../confirm` | Public booking page (token-gated). |

✅ **0 unintended anonymous mutation routes remain.**

---

## 3. Prefix-mounted gates (`app.use`)

| Prefix | Gate stack |
| ------ | ---------- |
| `/api/leads` | `requireAuth` + `requirePermission("crm", "view")` |
| `/api/accounts` | `requireAuth` + `requirePermission("crm", "view")` |
| `/api/contacts` | `requireAuth` + `requirePermission("crm", "view")` |
| `/api/opportunities` | `requireAuth` + `requirePermission("crm", "view")` |
| `/api/tickets` | `requireAuth` + `requirePermission("support", "view")` |
| `/api/quotes` | `requireAuth` + `requirePermission("quoting", "view")` |
| `/api/comm-lists`, `/api/campaigns` | `requireAuth` + `requirePermission("communications", "view")` |
| `/api/team-workload` | `requireAuth` + `requirePermission("team_workload", "view")` |
| `/api/projects` | `requireAuth` + `requirePermission("projects", "view")` |
| `/api/assets`, `/api/asset-folders` | `requireAuth` + `requirePermission("knowledge", "view")` |
| `/api/install-workflows` | `requireAuth` + `requirePermission("crm", "view")` *(per-route writes also `quoting.edit`)* |
| `/api/procurement` | `requireAuth` + `requirePermission("crm", "view")` |
| `/api/partnerships`, `/api/ecosystem` | `requireAuth` + `requirePermission("partnerships", "view")` |
| `/api/revenue`, `/api/revenue-sim` | `requireAuth` + `requireNotAdvisor` |
| `/api/pipeline/insights`, `/api/pipeline/forecast`, `/api/pipeline/rep-performance` | `requireAuth` + `requireNotAdvisor` |
| `/api/metrics`, `/api/sales`, `/api/chart-data`, `/api/marinas`, `/api/dashboard`, `/api/activities`, `/api/tasks`, `/api/comments`, `/api/attachments`, `/api/users`, `/api/geocode` | `requireAuth` only |

Net effect: every CRM / quoting / support / partnerships / knowledge surface gets a free **section view** gate even before the per-route handler runs. Section **edit** must still be added per-route — and is, for all writes that have been in scope through commit #5.

---

## 4. IDOR / BOLA hotspot survey

### CRM / accounts / leads / contacts (✅ green)

All read endpoints are `crm.view` via `app.use` mount. All writes (POST/PATCH/DELETE) inside the prefix carry an additional `requirePermission("crm", "edit")` (verified spot-checks at L14793 `/notes`, L15001 `/tags`, L15033 `/record-tags`, L15042 DELETE `/record-tags`). There is no row-level owner ACL on `accounts` / `leads` / `contacts` themselves — but the design is workspace-shared (single-tenant CRM), so this is correct, not a finding.

### Quoting / price-lists / install-workflows (✅ green)

| Route | Gate |
| ----- | ---- |
| `POST/PATCH/DELETE /api/price-lists*` | `quoting.edit` ✅ (commit #3) |
| `POST/PATCH/DELETE /api/price-lists/:id/items` | `quoting.edit` ✅ |
| `PATCH/DELETE /api/price-list-items/:id` | `quoting.edit` ✅ |
| `POST /api/install-workflows`, `POST .../from-quote/:quoteId` | `quoting.edit` ✅ |
| `PATCH /api/install-workflows/:id` and `/milestones*` writes | `quoting.edit` ✅ |
| `DELETE /api/install-workflows/:id` and `/milestones/:mid` | `quoting.edit` ✅ |
| `DELETE /api/quote-line-items/:id`, `DELETE /api/services-estimates/:id` | `quoting.edit` ✅ |

### Mailbox / team-mailbox ACL (✅ green)

| Route | Gate |
| ----- | ---- |
| `POST /api/email-messages/:id/{reassign,confirm}` | `requireAccountEditAccess(sourceAccountId)` ✅ (commits #2/#3) |
| `POST /api/gmail/thread-associations/{confirm,reject,manual,replace,:threadId/refresh}` | `requireThreadAssocEditAccess(emailMessageId)` ✅ (commit #5) |
| `POST /api/gmail/thread-associations/bulk-{confirm,reject}` | `checkThreadAssocEditForBulk` per-item (skipped with reason) ✅ (commit #5) |
| `PATCH /api/inbox/threads/:threadId/{assign,trash,ai-summary}`, `/api/gmail/thread-record/:threadId`, `/api/gmail/messages/:id/{mark-read,toggle-star}` | inline `requireAccountEditAccess` ✅ (audit-confirmed commit #4) |
| `POST /api/mail-folders/:id/domains`, `DELETE /api/mail-folders/:id/{domains/:domainId,emails/:emailId}` | inline parent-folder ownership ACL ✅ (commit #4) |
| `POST /api/email-filters`, `DELETE /api/email-filters/:id` | `communications.edit` ✅ (commit #4) |
| `POST /api/inbox/{create-task-from-thread,quote-request,create-note-from-thread}` | `crm.edit` ✅ |
| `PATCH /api/inbox/bulk-mark-done` | `crm.edit` ✅ (commit #4) |

The mail-folder per-row ACL (`PUT/DELETE /api/mail-folders/:id`, `POST /api/mail-folders/:id/backfill`) currently lives inline inside each handler. That is functionally correct but worth promoting to the central `requireOwnerOrAdmin` helper for consistency — see §10 P2 #5.

### File / attachment access (✅ green)

`/api/attachments` is mounted under `app.use("/api/attachments", requireAuth)`. The POST handler (commit #5) calls `attachmentSectionFor(objectType)` and demands `edit` on the resolved section; the just-uploaded multer temp file is `unlink`-ed before responding 403. The GET handler enforces the matching `view` level via `requireSectionView`. Gmail attachment downloads (`/api/gmail/attachments/:id/{download,calendar-invite}`) are scoped per-user mailbox at the storage layer.

### Confluence / knowledge (✅ green)

| Route | Gate |
| ----- | ---- |
| `GET /api/confluence/spaces` | `requirePermission("knowledge", "view")` ✅ |
| `GET /api/confluence/pages` and `:id` | `knowledge.view` ✅ |
| `POST /api/confluence/pages` | `knowledge.edit` ✅ |
| `PUT /api/confluence/pages/:id` | `knowledge.edit` ✅ |

### Jira (✅ green)

| Route | Gate |
| ----- | ---- |
| `GET /api/jira/{projects,issues,issues/:key,issues/:key/transitions}` | `requireAuth` (read-only ticket data; intentional). |
| `POST /api/jira/issues`, `POST /api/jira/issues/:key/transitions` | `support.edit` ✅ (commit #4) |

### Per-user routes (✅ green — all session-scoped)

`/api/my/mailbox/*`, `/api/calendar/*` writes, `/api/booking-links` writes, `/api/meeting-notes/*`, `/api/zoom/*`, `/api/gmail/disconnect`, `/api/webauthn/credentials/*` are all keyed off `req.session.userId` at the storage layer. A per-row defensive precheck (load row → assert ownership before delegating) is recommended for defense-in-depth — see §10 P2 #5.

### Tasks (✅ green)

`server/routes-tasks.ts` (27 handlers) wraps every route in `canView` or `canEdit` (31 gate occurrences total — every route is gated). The duplicate inline `POST /api/tasks/:id/complete` was deleted in commit #2.

---

## 5. Public / OAuth / webhook routes

| Route | Risk posture |
| ----- | ------------ |
| `POST /api/webhooks/gmail` | Validated by constant-time `?token=` compare against `GMAIL_WEBHOOK_TOKEN`. ✅ |
| `GET /api/auth/google/callback` | OAuth state validated against signed cookie. ✅ |
| `GET /api/zoom/oauth/callback` | OAuth state validated against `req.session.zoomOAuthState`. ✅ |
| `GET /track/{open,click}/:trackingId` | No auth; `track/click` validates destination URL is `http(s)` only before redirect. ✅ |
| `GET /api/booking-links/public/:token` + `POST .../confirm` | Per-recipient token gates access to a time-bounded scheduling window. ✅ |
| `POST /api/webauthn/auth-options` + `POST /api/webauthn/auth-verify` | Anonymous passkey flow; verify is `loginRateLimiter`-gated. ✅ |
| `POST /api/auth/login` | `loginRateLimiter`. ✅ |
| `POST /api/auth/forgot-password`, `POST /api/auth/reset-password-by-token` | `passwordResetRateLimiter` / `resetTokenRateLimiter`. ✅ |

No webhook lacks origin validation. No OAuth callback lacks state validation.

---

## 6. Duplicate / shadowed route conflicts

```
$ rg -n 'app\.METHOD\("/api/...")' | sort | uniq -d
(empty)
```

**0 method+path duplicates** in `server/routes.ts` and `server/routes-tasks.ts`. The bare-segment cluster (`/:id/snooze`, `/:id/dismiss`, `/:id/reassign`, `/:id/milestones`, …) decomposes into distinct full paths under different parent prefixes — no shadowed handler risk.

---

## 7. Regression test inventory

Eight security suites totaling **359 assertions** are green at the time of audit:

| Suite | Assertions | What it covers |
| ----- | ---------: | -------------- |
| `tests/p0-anonymous-routes.test.js` | 84 | All 26 commit-#1 routes return 401 when anon. |
| `tests/p0-anonymous-routes-2.test.js` | 72 | All 18 commit-#2 routes + duplicate-route deletion. |
| `tests/p1-undergated-mutations.test.js` | 45 | 14 commit-#3 mutation gates (`/email-messages/:id/confirm`, price-lists, install-workflows). |
| `tests/p1-undergated-mutations-2.test.js` | 33 | 9 commit-#4 mutation gates + 3 mail-folder ownership ACLs. |
| `tests/p1-undergated-mutations-3.test.js` | 47 | 12 commit-#5 mutation gates + attachment module gate. |
| `tests/security-triage-permissions.test.js` | 48 | Triage / inbox permission matrix. |
| `tests/idor-followup-permissions.test.js` | 23 | Follow-up IDOR coverage. |
| `tests/asset-permissions.test.js` | 7 | Asset/folder permission boundaries. |
| **Total** | **359** | |

The five pre-existing failing test workflows (`mail-permissions`, `mailbox-switching`, `permissions`, `tracking-multi-proof`, `tracking-proof`) **were not restarted** in this audit per project standing rules. They are tracked separately and pre-date the security sweep.

---

## 8. New / changed surface since commit #4

The only authoritative diff since the prior refresh doc is **commit #5** (already documented in `docs/ROUTE_SECURITY_SWEEP_REFRESH.md` §3). Summary:

- 2 new helpers in `server/routes.ts`: `requireThreadAssocEditAccess`, `checkThreadAssocEditForBulk`.
- 7 thread-association routes gated.
- 4 CRM mutations gated on `crm.edit` (notes/tags/record-tags POST + DELETE).
- 1 admin gate (`POST /api/data-quality/ignore`).
- 1 module-section gate on `POST /api/attachments` with temp-file unlink on denial.

No other code paths changed. No schema changes. No new dependencies.

---

## 9. Behavioral changes worth flagging to product

1. **`POST /api/gmail/thread-associations/manual`** previously silently no-op'd if no email message could be resolved for the thread (still returned 200). It now returns **404 "no message found for thread"**. This is a deliberate hardening change — the previous behavior masked an ACL gap. Front-end callers should treat 404 here as "thread not yet synced".
2. **`POST /api/gmail/thread-associations/bulk-{confirm,reject}`** previously rejected the whole batch with 403 if the caller lacked the broad `crm`/`partnerships` view (the wrong axis). They now return **200 with per-item `skipped[]`** entries when the caller lacks `mail_team[acctId].edit` on a specific item. UI should surface skipped counts.
3. **`POST /api/data-quality/ignore`** previously accepted any authenticated user. It now requires `requireAdmin`. Non-admin operators who used to suppress data-quality warnings will now see 403. (Companion `DELETE /api/data-quality/ignore/:id` and `PATCH /api/data-quality/fix` still accept any authenticated user — see §10 P2 #4.)

---

## 10. Remaining P2 hardening — *not launch blockers*

These all currently require **authentication** and (for items 1–4) some level of section view. They are workspace-shared writes that would benefit from a per-section `edit` gate for defense-in-depth. None expose cross-tenant data; none are exploitable by an unauthenticated attacker.

| # | Routes | Current gate | Suggested gate |
| - | ------ | ------------ | -------------- |
| 1 | `POST/PATCH /api/procurement/{suppliers,parts,purchase-orders,production-batches,inventory}` and child `/lines` writes (L17681–L18046) | `requireAuth` + `crm.view` (mount) | Add per-route `crm.edit` (or new `procurement.edit`). |
| 2 | `POST/PATCH /api/deployments` + `/hardware`, `/checkpoints`, `/blockers`, `/billing-lines` writes (L18495–L18900) | `requireAuth` only | `projects.edit`. |
| 3 | `POST/PUT /api/winter/{products,cases,kb,templates}` writes + `PATCH .../cases/:id/sla` + `POST .../scan-emails` (L22722–L23361) | `requireAuth` only | `support.edit`. |
| 4 | `POST /api/executive/brief/refresh`, `PATCH /api/executive/alerts/:id` (L22597, L22614); `POST /api/revenue-ops/{plan-commits, .../set-active, ...gap/.../snapshot, ...gap/.../actions, ...actions/:id/create-task, ...plan-commits/:id PATCH}` (L22437–L22537); `DELETE /api/data-quality/ignore/:id`, `PATCH /api/data-quality/fix` (L17533, L17544) | `requireAuth` only | Module-level `team_workload.edit` / `requireAdmin`. |
| 5 | Per-user routes (`POST /api/booking-links`, `PATCH /api/booking-links/:id`, `POST .../recipients`, `POST .../recipients/:id/revoke`, `POST/PATCH /api/meeting-notes`, `PATCH/DELETE /api/my/mailbox/:id*`, all `PUT/DELETE /api/mail-folders/:id`) | `requireAuth` + service-layer `userId` scoping | Add a defensive load → `row.ownerUserId === userId` precheck so a single missed `WHERE owner_user_id =` clause cannot become an IDOR. |
| 6 | `POST /api/calendar/events` (L6303) and `POST /api/cs` writes (L19430) | `requireAuth` only | `calendar.edit` / `support.edit` for consistency. |
| 7 | `GET /api/scores/*`, `POST /api/scores/{snapshot,outcome,acknowledge,evaluate-all}`, `PUT /api/scores/model-configs/:modelName`, `POST /api/automations*` writes | `requireAuth` only | Add `requireAdmin` for model-config writes; `requireNotAdvisor` for score reads (sales-financial signal). |

**P3 nits (defer)**

- Standardize `requireAdmin` import — there are two definitions (canonical `server/auth.ts` plus a legacy local in `routes.ts`). Both check the same `session.globalRole`; consolidate in a future cleanup.
- Add a one-line docstring to each `inline-ACL` handler (e.g. `/inbox/threads/:threadId/{assign,trash,ai-summary}`) so future contributors don't strip the inline gate during refactors.
- The `canView`/`canEdit` helpers in `routes-tasks.ts` are local; consider exporting from `server/auth.ts` for consistency.

---

## 11. Comparison vs. prior docs

| Item | `docs/ROUTE_SECURITY_SWEEP.md` | `docs/ROUTE_SECURITY_SWEEP_REFRESH.md` | This audit |
| ---- | ------------------------------ | -------------------------------------- | ---------- |
| Anonymous mutation routes | 44 found | 0 remain | **0 confirmed** |
| Under-gated P1 mutations | 35 listed | 0 remain (12 closed in commit #5) | **0 confirmed** |
| Workspace-shared writes still on `requireAuth` only | listed in P2 | listed in §4 P2.A | **§10 P2 #1–#4** |
| Per-user defensive ownership prechecks | listed in P2.B | listed in §4 P2.B | **§10 P2 #5** |
| Duplicate `method+path` collisions | 1 (deleted commit #2) | 0 | **0 confirmed** |
| Test coverage | n/a | 312/312 | **359/359** |

---

## 12. Bottom line

- **All P0 anonymous-access findings: closed.**
- **All P1 mutation-gate / IDOR findings flagged in the prior sweeps: closed.**
- **All P1 thread-association mailbox ACLs: closed (commit #5).**
- **Attachment module gate: closed (commit #5).**
- **Auth-middleware coverage: comprehensive across 712 routes + 27 task-routes.**
- **0 unintended public routes; 0 method+path duplicates.**
- **8 regression suites, 359 assertions, all green.**

🟢 **Resume feature work.** Schedule a follow-up sweep to absorb the §10 P2 items into a future commit set, but they are not launch blockers.

---

**End of report.** No code, schema, dependency, workflow, or test-state changes were made during this audit.
