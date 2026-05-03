# Route Security Sweep — Refresh (post commits #1–#4)

**Date**: 2026-05-03
**Scope**: read-only audit of `server/routes.ts` (24,569 lines) and `server/routes-tasks.ts` (890 lines)
**No code, schema, or dependency changes were made.**

This refresh re-evaluates the surface after:

- Commit #1 — 26 P0 anonymous-access fixes (`tests/p0-anonymous-routes.test.js`)
- Commit #2 — 18 P0 fixes + duplicate-route deletion (`tests/p0-anonymous-routes-2.test.js`)
- Commit #3 — 14 P1 mutation-gate fixes (`tests/p1-undergated-mutations.test.js`)
- Commit #4 — 9 P1 mutation-gate fixes + 3 mail-folder ownership ACLs (`tests/p1-undergated-mutations-2.test.js`)

---

## 1. Total routes audited

| File | `app.METHOD` count | `app.use` middleware mounts |
| ---- | ------------------ | --------------------------- |
| `server/routes.ts` | **712** | 32 |
| `server/routes-tasks.ts` | **27** | 0 (uses `canView` / `canEdit` per route) |
| **Total** | **739** | 32 |

The 32 `app.use` mounts apply blanket gates to entire URL prefixes — for example `app.use("/api/leads", requireAuth, requirePermission("crm", "view"))` covers every `/api/leads/*` handler. This refresh accounts for those prefix gates when classifying inline-only `requireAuth` handlers.

---

## 2. Remaining P0 (anonymous / unauthenticated) routes

**0 unintended P0 routes remain.** Every route that does not appear inside an `app.use(prefix, requireAuth, ...)` mount and does not declare `requireAuth` on the handler line is **intentionally public** and falls into one of the documented buckets below.

### Intentionally public surface (false positives — keep as-is)

| Path | Reason |
| ---- | ------ |
| `GET  /track/open/:trackingId.gif` | Tracking pixel — must be retrievable by recipient mail clients with no session. |
| `GET  /track/open/:trackingId` | Bare alias for the pixel. Same reason. |
| `GET  /track/click/:trackingId` | Tracked-link redirect. Validates destination URL (http/https only) before redirecting; logs click async. |
| `POST /api/auth/login` | Login (rate-limited via `loginRateLimiter`). |
| `POST /api/auth/logout` | Destroys session — safe public. |
| `GET  /api/auth/me` | Returns 401 inline if `req.session.userId` missing — anonymous response is just the 401. |
| `POST /api/auth/change-password` | Inline `if (!req.session?.userId) return 401`. |
| `POST /api/auth/change-password-forced` | Same inline 401 check. |
| `POST /api/auth/forgot-password` | Anonymous by design (rate-limited). |
| `POST /api/auth/reset-password-by-token` | Anonymous by design (token-gated, rate-limited). |
| `POST /api/webauthn/auth-options` | Anonymous passkey challenge — only returns public credential descriptors. |
| `POST /api/webauthn/auth-verify` | Anonymous passkey verification (rate-limited). |
| `GET  /api/auth/google/callback` | OAuth redirect target — token validated against signed `state`. |
| `GET  /api/zoom/oauth/callback` | OAuth redirect target — same. |
| `POST /api/webhooks/gmail` | Gmail Pub/Sub webhook — `?token=` constant-time compared to `GMAIL_WEBHOOK_TOKEN`. |
| `GET  /api/booking-links/public/:token` | Public scheduling page — recipient token gates access. |
| `POST /api/booking-links/public/:token/confirm` | Same. |

> **Note** — `POST /api/contacts/extract-from-{image,url}` initially appears as "no requireAuth" because the middleware is wrapped onto the next physical line. They are gated by `requirePermission("crm", "edit")` (verified at lines 2900 and 2952) and require `crm.edit` to use the OpenAI-backed extractor. **Not public.**

---

## 3. Remaining P1 (mutation-gate / IDOR) routes

**12 routes remain P1.** All are `requireAuth`-only handlers that perform workspace-shared writes or operate on rows owned by other users without an inline ownership check.

### P1 — Gmail thread-association mutations (highest priority)

The `email-messages/:id/{reassign,confirm}` routes were patched in commits #2 / #3 to enforce `mail_team[sourceAccountId].edit`. These siblings mutate the same `emailAssociations` table by association id and do **not** carry that gate yet.

| Method | Path | Line | Risk |
| ------ | ---- | ---- | ---- |
| POST | `/api/gmail/thread-associations/confirm` | 9557 | Marks any association `isUserConfirmed=true` by id. Same IDOR shape as the patched `/email-messages/:id/confirm`. |
| POST | `/api/gmail/thread-associations/reject` | 9612 | Deletes any association by id. |
| POST | `/api/gmail/thread-associations/bulk-confirm` | 9686 | Bulk version. |
| POST | `/api/gmail/thread-associations/bulk-reject` | 9788 | Bulk version. |
| POST | `/api/gmail/thread-associations/manual` | 9886 | Inserts a manual association on any thread. |
| POST | `/api/gmail/thread-associations/replace` | 9963 | Replaces association by id. |
| POST | `/api/gmail/thread-associations/:threadId/refresh` | 10077 | Recomputes associations for any thread. |

**Recommended gate**: load the `email_messages` row referenced by the association/thread, then call the same `requireAccountEditAccess(req, res, sourceAccountId)` helper used by `/email-messages/:id/{reassign,confirm}`.

### P1 — Workspace-shared writes still on `requireAuth` only

| Method | Path | Line | Risk | Recommended gate |
| ------ | ---- | ---- | ---- | ---------------- |
| POST | `/api/notes` | 14709 | Anyone authenticated can create a note attached to ANY CRM object id. (PUT/DELETE/PATCH already gate via `noteOwnerOrAdmin`.) | `requirePermission("crm", "edit")` |
| POST | `/api/tags` | 14917 | Workspace-wide tag creation. | `requirePermission("crm", "edit")` |
| POST | `/api/record-tags` | 14949 | Apply tag to ANY record by `recordType`+`recordId`. | `requirePermission("crm", "edit")` |
| DELETE | `/api/record-tags` | 14958 | Remove tag from ANY record (query-string id). | `requirePermission("crm", "edit")` |
| POST | `/api/data-quality/ignore` | 17424 | Suppresses workspace data-quality warnings. | `requirePermission("crm", "edit")` |

> The `/api/data-quality/{ignore DELETE, fix PATCH}` routes are also `requireAuth`-only but operate on data-quality state that is workspace-shared; same `crm.edit` gate is appropriate. They are listed in §4 (P2 hardening) because they are admin-style cleanup actions rather than direct customer-data mutations.

---

## 4. Remaining P2 hardening items

P2 = consequential mutations that are technically authenticated and partially owner-scoped, but where defense-in-depth (a module-level `requirePermission` gate or an inline owner check) would close residual risk.

### P2.A — Procurement / deployments / winter / executive / data-quality writes

These prefixes were intentionally excluded from the commit #1–#4 sweep. They mostly mutate workspace-shared state and currently rely solely on `requireAuth` (procurement and projects siblings have a `view` gate via `app.use`, but writes are not `edit`-gated).

| Prefix / Path | Lines | Suggested gate |
| ------------- | ----- | -------------- |
| `POST/PATCH /api/procurement/{suppliers,parts,purchase-orders,production-batches,inventory}` and child `/lines` writes | 17596–18046 | The `app.use("/api/procurement", requireAuth, requirePermission("crm", "view"))` mount gives view-only protection. Add a per-route `requirePermission("crm", "edit")` (or introduce `procurement.edit`) for writes. |
| `POST/PATCH /api/deployments` + `/hardware`, `/checkpoints`, `/blockers`, `/billing-lines` writes | 18410–18900 | `requirePermission("projects", "edit")` (deployments are project-attached install workflows). |
| `POST/PUT /api/winter/{products,cases,kb,templates}` + `/cases/:id/sla` PATCH + `/scan-emails` POST | 22637–23290 | `requirePermission("support", "edit")` (winter case manager is the support backend). |
| `POST /api/executive/brief/refresh`, `PATCH /api/executive/alerts/:id` | 22512, 22529 | Add a module gate — `team_workload.edit` or a dedicated `executive.edit`. |
| `POST /api/data-quality/ignore`, `DELETE /api/data-quality/ignore/:id`, `PATCH /api/data-quality/fix` | 17424–17459 | `requirePermission("crm", "edit")`. |
| `POST /api/revenue-ops/plan-commits` and downstream | 22352–22452 | Mounted under `app.use("/api/revenue-ops")` — verify a `requireNotAdvisor` or `revenue.edit` gate is present like its `/api/revenue` siblings. |

### P2.B — Per-user routes worth a defensive ownership re-check

These already key off `req.session.userId` for the write target, so cross-user IDOR is not currently possible — but the pattern is brittle (one missed `WHERE owner_user_id = $1` clause becomes an IDOR).

| Path | Why P2 only |
| ---- | ----------- |
| `POST /api/booking-links`, `PATCH /api/booking-links/:id`, `POST /api/booking-links/:id/recipients`, `POST /api/booking-links/recipients/:id/revoke` | Service layer scopes to `userId` already (`createBookingLink(userId, ...)`, `addRecipient(id, userId, ...)`, `revokeRecipient(recipientId, userId)`). Defense-in-depth: load row, assert `row.ownerUserId === userId` before delegating. |
| `POST/PATCH /api/meeting-notes`, `POST /api/meeting-notes/:id/{start,stop,audio-chunk}` | Per-user notes; same defensive-load pattern recommended. |
| `POST /api/zoom/meetings`, `POST /api/zoom/disconnect` | Already per-user; document the assumption. |
| `PATCH /api/my/mailbox/:id/{privacy,sync}`, `DELETE /api/my/mailbox/:id`, `POST /api/my/mailbox/:id/backfill[/cancel|/resume]`, `POST /api/my/mailbox/warmness/compute` | All scoped to `req.session.userId` inline. Worth promoting to use the central `requireOwnerOrAdmin` helper for consistency. |

### P2.C — Inbox AI / draft / star toggles already audited in commit #4

`/api/gmail/messages/:id/{mark-read,toggle-star}`, `/api/inbox/threads/:threadId/{assign,trash,ai-summary}`, `/api/gmail/thread-record/:threadId` already enforce `requireAccountEditAccess` inline (verified). **No change needed**, but worth a short docstring on each so future contributors don't strip it.

---

## 5. False positives / intentionally public routes

See §2 for the full intentional-public list (17 routes). In addition, the following internal-but-`requireAuth`-only patterns are **false positives** for any future sweep:

| Pattern | Why it's a false positive |
| ------- | ------------------------- |
| `app.use("/api/*", requireAuth, requirePermission("...", "view"))` mounts followed by per-route handlers without an inline middleware string | The prefix `app.use` gates them. Verified mounts: `/api/leads`, `/api/accounts`, `/api/contacts`, `/api/opportunities`, `/api/tickets`, `/api/quotes`, `/api/comm-lists`, `/api/campaigns`, `/api/team-workload`, `/api/projects`, `/api/assets`, `/api/asset-folders`, `/api/install-workflows`, `/api/procurement`, `/api/partnerships`, `/api/ecosystem`, `/api/revenue*`, `/api/pipeline/*`, `/api/geocode`. |
| `requireAccountEditAccess(req, res, accountId)` inside the handler instead of in the middleware list | Equivalent protection; documented helper in `server/auth.ts`. |
| Inline `if (!req.session?.userId) return 401` (legacy pattern in `/api/auth/*`) | Equivalent to `requireAuth`. |
| `POST /api/gmail/disconnect` (no accountId — disconnects own integration) | Per-user, owner-scoped by definition. |

---

## 6. Duplicate route conflicts

**0 true `method+path` collisions remain** in `server/routes.ts` and `server/routes-tasks.ts`.

Earlier sweeps surfaced one collision (`POST /api/tasks/:id/complete` defined both inline and in `routes-tasks.ts`); commit #2 deleted the bare duplicate. The path-segment cluster from a naïve grep (e.g. `id/snooze`, `id/dismiss`, `id/reassign`) is **not** a collision — those are distinct full paths registered under different parents:

| Bare segment | Distinct full paths |
| ------------ | ------------------- |
| `id/snooze` | `/api/suggestions/:id/snooze`, `/api/tasks/suggestions/:id/snooze`, `/api/tasks/:id/snooze` |
| `id/dismiss` | `/api/suggestions/:id/dismiss`, `/api/tasks/suggestions/:id/dismiss` |
| `id/reassign` | `/api/tasks/:id/reassign`, `/api/email-messages/:id/reassign` |
| `id/milestones`, `id/items`, `id/lines`, `id/contacts`, `id/checkpoints`, `id/blockers`, etc. | All distinct parent prefixes (`/api/install-workflows`, `/api/price-lists`, `/api/procurement/purchase-orders`, `/api/accounts`, `/api/deployments`, …). |

**Conclusion**: no shadowed-handler risk currently.

---

## 7. Top 10 recommended next fixes (priority order)

1. **`/api/gmail/thread-associations/{confirm,reject,bulk-confirm,bulk-reject,manual,replace,:threadId/refresh}` (7 routes)** — add `requireAccountEditAccess(sourceAccountId)` derived from the association's anchor message. Direct continuation of commits #2/#3.
2. **`POST /api/notes`** — `requirePermission("crm", "edit")`. Closes the last unprotected note-creation IDOR (PUT/DELETE/PATCH already do owner-or-admin).
3. **`POST /api/tags` + `POST/DELETE /api/record-tags`** — `requirePermission("crm", "edit")`. Workspace-tag IDOR.
4. **`POST /api/data-quality/ignore`, `DELETE /api/data-quality/ignore/:id`, `PATCH /api/data-quality/fix`** — `requirePermission("crm", "edit")`. Workspace data-quality state.
5. **`POST/PATCH /api/procurement/*` writes** — escalate the existing `app.use(... "view")` mount to also require `crm.edit` (or new `procurement.edit`) for writes.
6. **`POST/PATCH /api/deployments` and child writes** — `requirePermission("projects", "edit")`.
7. **`POST/PUT /api/winter/{products,cases,kb,templates}` writes** — `requirePermission("support", "edit")`.
8. **`POST /api/executive/brief/refresh`, `PATCH /api/executive/alerts/:id`** — module gate (executive view exists, no edit gate yet).
9. **`POST /api/booking-links`, `PATCH /api/booking-links/:id`, `POST /api/booking-links/:id/recipients`, `POST /api/booking-links/recipients/:id/revoke`** — defensive ownership precheck on the link before delegating.
10. **`POST /api/calendar/events`** — sets `userId` from session, but does not load the row first; calendar event creation is per-user so add the `requirePermission("calendar", "edit")` gate to keep the gate pattern consistent across the suite.

---

## 8. Comparison vs `docs/ROUTE_SECURITY_SWEEP.md`

### Closed in this sweep cycle

| Original section | Item | Status |
| ---------------- | ---- | ------ |
| P0 — Anonymous routes | 26 routes (commit #1) | **Closed** — `tests/p0-anonymous-routes.test.js` 84/84. |
| P0 — Anonymous routes | 18 routes (commit #2) including duplicate `/api/tasks/:id/complete` | **Closed** — `tests/p0-anonymous-routes-2.test.js` 72/72; duplicate deleted. |
| P1.A | `POST /api/email-messages/:id/confirm` | **Closed** — in-handler `mail_team[sourceAccountId].edit` ACL (commit #3). |
| P1.A | `POST/PATCH/DELETE /api/price-lists*` and `/api/price-list-items/:id` | **Closed** — `quoting.edit` (commit #3). |
| P1.A | `POST/PATCH/DELETE /api/install-workflows*` (incl. `/milestones`) | **Closed** — `quoting.edit` (commit #3). |
| P1.A | `POST /api/jira/issues`, `POST /api/jira/issues/:key/transitions` | **Closed** — `support.edit` (commit #4). |
| P1.A | `POST /api/email-filters`, `DELETE /api/email-filters/:id` | **Closed** — `communications.edit` (commit #4). |
| P1.A | `PATCH /api/inbox/bulk-mark-done` | **Closed** — `crm.edit` (commit #4). |
| P1.B | `POST /api/timeline/link-email`, `DELETE /api/timeline/unlink-email/:id` | **Closed** — escalated `crm.view` → `crm.edit` (commit #3). |
| P1.B | `POST /api/{,tasks/}suggestions/:id/{dismiss,snooze}` (4 routes) | **Closed** — escalated `crm.view` → `crm.edit` (commit #4). |
| P1.C (new in commit #4) | `POST /api/mail-folders/:id/domains`, `DELETE /api/mail-folders/:id/domains/:domainId`, `DELETE /api/mail-folders/:id/emails/:emailId` | **Closed** — in-handler ownership ACL on parent folder (commit #4). |
| P1.A — flagged but not actually under-gated | `gmail/send`, `gmail/sync`, `gmail/sync-incremental`, `gmail/watch/{start,stop}`, `email-search/reindex`, `calendar/events*` writes, all `calendar/integrations/*` writes, `PUT /api/tasks/:id`, `PUT/DELETE /api/mail-folders/:id`, `POST /api/mail-folders` | **Closed (audit only)** — gates already present (mostly inline). Documented as ✅ (audit) in `ROUTE_SECURITY_SWEEP.md`. |

### Still open (carried into Top 10 above)

| Original section | Item | Refresh status |
| ---------------- | ---- | -------------- |
| P1.A | `POST /api/notes` | **Open** — listed in §3 / Top 10 #2. |
| P1.A | `POST /api/tags`, `POST/DELETE /api/record-tags` | **Open** — Top 10 #3. |
| P1.A | `POST /api/attachments` (module gate by objectType) | **Open** — listed at line 5005 in `ROUTE_SECURITY_SWEEP.md`; not yet patched. Verified `/api/attachments` is mounted under `app.use("/api/attachments", requireAuth)`, so it is auth-gated but not module-gated. Recommend a per-`objectType` switch (`crm.edit` for crm objects, `projects.edit` for projects, etc.). Carry into next sweep. |

### New items first surfaced in this refresh

The seven `gmail/thread-associations/*` mutations (Top 10 #1) were not individually called out in the original `ROUTE_SECURITY_SWEEP.md`. They appear to predate the email-messages reassign/confirm hardening and inherit the same IDOR pattern. **Promote to next P1 commit.**

The procurement / deployments / winter / executive / data-quality write families (Top 10 #5–#8) were also out of scope for the original sweep. They are workspace-shared writes currently at `requireAuth` (with view-only `app.use` mounts where applicable). **Promote to a P2 commit.**

---

## 9. Test coverage at end of refresh

Read-only sweep — no new tests run. Reference green suites at the time of writing:

| Suite | Status |
| ----- | ------ |
| `tests/p0-anonymous-routes.test.js` | 84/84 |
| `tests/p0-anonymous-routes-2.test.js` | 72/72 |
| `tests/p1-undergated-mutations.test.js` | 45/45 |
| `tests/p1-undergated-mutations-2.test.js` | 33/33 |
| `tests/security-triage-permissions.test.js` | 48/48 |
| `tests/idor-followup-permissions.test.js` | 23/23 |
| `tests/asset-permissions.test.js` | 7/7 |
| **Total** | **312/312** |

The five pre-existing failing test workflows (`mail-permissions`, `mailbox-switching`, `permissions`, `tracking-multi-proof`, `tracking-proof`) were untouched per standing rules.
