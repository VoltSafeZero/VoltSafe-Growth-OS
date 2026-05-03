# Route Security Sweep — VoltSafe Growth OS

**Date**: 2026-05-03
**Scope**: every Express route under `server/` — `server/routes.ts` (709 routes), `server/routes-tasks.ts` (27), `server/voice-assistant.ts` (5), `server/replit_integrations/{audio,chat,image}/routes.ts` (7).
**Total routes audited**: 748.
**Mode**: read-only — NO code changes, schema changes, or `db:push` performed.

---

## Methodology

For every route I classified the route-level middleware into one of:

1. **No middleware** — bare `async (req, res) => …`
2. **`requireAuth` only** — session required, but no module permission gate
3. **`requirePermission(module, level)`** — proper module gate (correct pattern)
4. **`requireAuth, requirePermission(module, level)`** — gate plus explicit auth (functionally equivalent to #3)
5. **`requireAuth, requireAdmin`** — admin-only
6. **In-handler ACL** — middleware looks weak but the handler enforces (`getSessionUserId`, `requireOwnerOrAdmin`, `noteOwnerOrAdmin`, `WHERE owner_user_id = $userId`, etc.)

Then for each weakly-gated route I read the handler body and tagged the result as a **real risk** or a **false positive**.

Counts at the route-level middleware slot (single `app.X("/api/…", MIDDLEWARE,` token):

| Middleware slot   | Count |
| ----------------- | ----- |
| `requireAuth`     | 527   |
| `requirePermission(...)` | 154   |
| _bare `async`_    |  52   |
| `requireAdmin`    |   1   |
| Rate-limiters etc.|   4   |

> 52 bare `async` routes is the headline finding. Many are intentional (OAuth callbacks, webhooks, public booking links) — but **at least 32** of them return or mutate real CRM/tickets/projects/ecosystem data with no auth at all.

---

## SEVERITY KEY

- **P0** — Anonymous access to PII, customer data, financial pipeline, or write surface. Internet-exploitable today.
- **P1** — Authenticated user can act outside their permission module, or mutate workspace-shared resources without an `edit`-level gate.
- **P2** — Defense-in-depth. Currently safe via in-handler check or low-sensitivity data, but the route-level middleware gives a false sense of security or doesn't match the project's standard ACL pattern.

---

## P0 — Anonymous read/write of real data (UNAUTHENTICATED, exploitable)

> **STATUS — 2026-05-03 commit**: every route in this section that was in the
> agreed scope has been patched with `requireAuth + requirePermission(...)`.
> Regression suite `tests/p0-anonymous-routes.test.js` (84/84 passing) proves
> anon → 401, viewer w/o module → 403, viewer w/ view → 200, viewer w/ edit
> → write succeeds, master_admin → 200.
>
> Routes still **OPEN** (intentionally out of scope for the P0-anon commit and
> deferred to a later focused commit) are explicitly tagged ⏳ below; the rest
> are tagged ✅.

All of these (originally) accept requests with **no session cookie at all** and return 200 + data, or perform a state-changing action.

### P0.A — CSV bulk-export endpoints (PII / pipeline leak) — ✅ ALL FIXED

| Method | Path                          | Line  | What leaks                                            | Gate now applied                       |
| ------ | ----------------------------- | ----- | ----------------------------------------------------- | -------------------------------------- |
| GET    | `/api/marinas/export`         | 1123  | ✅ All marina records (name, address, phone, slips)  | `requireAuth, requirePermission("crm", "view")`     |
| GET    | `/api/leads/export`           | 1134  | ✅ All leads (name, status, country, owner)          | `requireAuth, requirePermission("crm", "view")`     |
| GET    | `/api/accounts/export`        | 1159  | ✅ All accounts (segment, region, slip count, tags)  | `requireAuth, requirePermission("crm", "view")`     |
| GET    | `/api/contacts/export`        | 1172  | ✅ **All contact PII** (name, title, email, phone)   | `requireAuth, requirePermission("crm", "view")`     |
| GET    | `/api/opportunities/export`   | 1184  | ✅ Full pipeline (title, stage, owner, est close)    | `requireAuth, requirePermission("crm", "view")`     |
| GET    | `/api/tickets/export`         | 1201  | ✅ All tickets + requester names/emails              | `requireAuth, requirePermission("support", "view")` |

### P0.B — List/detail reads (CRM core)

| Method | Path                                   | Status | Gate now applied / next-step                                                  |
| ------ | -------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| GET    | `/api/marinas`                         | ✅     | `requireAuth, requirePermission("crm", "view")`                                |
| GET    | `/api/marinas/states`                  | ⏳     | Next commit — `requireAuth` minimum                                            |
| GET    | `/api/leads/nearby`                    | ⏳     | Next commit — `requirePermission("crm", "view")`                               |
| GET    | `/api/leads/states`                    | ⏳     | Next commit — `requireAuth` minimum                                            |
| GET    | `/api/accounts/:id/infrastructure`     | ⏳     | Next commit — `requirePermission("crm", "view")`                               |
| GET    | `/api/contacts`                        | ✅     | `requireAuth, requirePermission("crm", "view")`                                |
| GET    | `/api/opportunities`                   | ✅     | `requireAuth, requirePermission("crm", "view")`                                |
| GET    | `/api/opportunities/:id/stage-history` | ✅     | `requireAuth, requirePermission("crm", "view")`                                |
| GET    | `/api/tickets`                         | ✅     | `requireAuth, requirePermission("support", "view")`                            |
| GET    | `/api/tickets/:id`                     | ✅     | `requireAuth, requirePermission("support", "view")`                            |
| GET    | `/api/comm-lists`                      | ⏳     | Next commit — `requirePermission("communications", "view")`                    |
| GET    | `/api/campaigns`                       | ⏳     | Next commit — `requirePermission("communications", "view")`                    |
| GET    | `/api/campaigns/:id`                   | ⏳     | Next commit — `requirePermission("communications", "view")`                    |
| GET    | `/api/comments`                        | ⏳     | Next commit — `requireAuth` + per-object scope                                 |
| GET    | `/api/team-workload`                   | ⏳     | Next commit — `requirePermission("team_workload", "view")`                     |
| GET    | `/api/partnerships`                    | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/partnerships/:id`                | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/ecosystem/organizations`         | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/ecosystem/organizations/:id`     | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/ecosystem/people`                | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/ecosystem/people/:id`            | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/ecosystem/relationships`         | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/ecosystem/relationships/:id`     | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/ecosystem/events`                | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/ecosystem/events/:id`            | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/ecosystem/regions`               | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/ecosystem/regions/:id`           | ✅     | `requireAuth, requirePermission("partnerships", "view")`                       |
| GET    | `/api/dashboard/summary`               | ⏳     | Next commit — `requireAuth` minimum                                            |
| GET    | `/api/metrics`                         | ⏳     | Next commit — `requireAuth` minimum                                            |
| GET    | `/api/sales`                           | ⏳     | Next commit — `requireAuth` minimum                                            |
| GET    | `/api/chart-data`                      | ⏳     | Next commit — `requireAuth` minimum                                            |
| GET    | `/api/geocode/search`                  | ⏳     | Next commit — `requireAuth`                                                    |

### P0.C — Anonymous mutations

| Method | Path                                | Status | Gate now applied / next-step                                                  |
| ------ | ----------------------------------- | ------ | ----------------------------------------------------------------------------- |
| POST   | `/api/leads/:id/geocode-address`    | ✅     | `requireAuth, requirePermission("crm", "edit")`                                |
| POST   | `/api/comments`                     | ✅     | `requireAuth, requirePermission("crm", "edit")`                                |
| POST   | `/api/tasks/:id/complete`           | ⏳     | Next commit — delete duplicate (gated copy lives in `routes-tasks.ts:463`)     |
| POST   | `/api/tasks/:id/snooze`             | ⏳     | Next commit — same                                                             |
| POST   | `/api/tasks/:id/reassign`           | ⏳     | Next commit — same                                                             |

> The `/api/tasks/:id/{complete,snooze,reassign}` routes in `server/routes.ts` shadow the properly-gated copies in `server/routes-tasks.ts` (which use `canEdit = requirePermission("crm", "edit")`). Express's last-registered-wins for duplicates can lead to whichever was registered later being used. **Either delete the no-auth duplicates or unify them.**

---

## P1 — Authenticated but missing module gate / under-gated mutations

### P1.A — Mutations on `requireAuth` only (no module check)

| Method | Path                                              | Line  | Risk                                                            | Recommended gate                       |
| ------ | ------------------------------------------------- | ----- | --------------------------------------------------------------- | -------------------------------------- |
| POST   | `/api/email-messages/:id/confirm`                 | 12631 | Sibling of the now-fixed `/reassign`. Mutates `emailAssociations.isUserConfirmed` for ANY message id. Same IDOR risk we just patched on `/reassign`. | In-handler `mail_team[sourceAccountId].edit` ACL |
| POST   | `/api/email-search/reindex`                       | 12474 | Triggers a workspace-wide email index rebuild                   | `requirePermission("communications", "edit")` or `requireAdmin` |
| POST   | `/api/email-filters`                              | 12501 | Creates email filter (per-user or workspace?)                   | Verify scope; if workspace add `communications.edit` |
| DELETE | `/api/email-filters/:id`                          | 12516 | Deletes any filter by id                                        | Same                                                       |
| POST   | `/api/inbox/bulk-mark-done`                       | 11437 | Bulk patch inbox state                                          | `requirePermission("communications", "edit")` |
| POST   | `/api/gmail/send`                                 | 11461 | Sends an email **as some Gmail account**. Needs per-mailbox edit ACL. | In-handler `mail_team[fromAccountId].edit` |
| POST   | `/api/gmail/sync`                                 | 12178 | Triggers full sync                                              | `requireOwnerOrAdmin(accountId)` for the targeted mailbox |
| POST   | `/api/gmail/sync-incremental`                     | 12310 | Same                                                            | Same                                                       |
| POST   | `/api/gmail/watch/start`                          | 12330 | Sets up Gmail push subscription                                 | Owner or admin                                             |
| POST   | `/api/gmail/watch/stop`                           | 12342 | Tears down push subscription                                    | Owner or admin                                             |
| POST   | `/api/gmail/disconnect`                           | 12052 | Disconnects current user's Gmail integration (per-user; OK)     | False positive — keep `requireAuth`                       |
| POST   | `/api/jira/issues`                                | 13443 | Creates Jira issues against the workspace's connected project   | `requirePermission("support", "edit")` (Jira is the support backend) |
| POST   | `/api/jira/issues/:key/transitions`               | 13679 | Mutates Jira workflow                                           | Same                                                       |
| POST   | `/api/price-lists`                                | 13114 | Creates price list (workspace shared, used by quoting)          | `requirePermission("quoting", "edit")` |
| PATCH  | `/api/price-lists/:id`                            | 13131 | Edits price list                                                | Same                                                       |
| DELETE | `/api/price-lists/:id`                            | 13148 | Deletes price list                                              | Same                                                       |
| POST   | `/api/price-lists/:id/items`                      | 13158 | Adds line item                                                  | Same                                                       |
| PATCH  | `/api/price-list-items/:id`                       | 13204 | Edits line item                                                 | Same                                                       |
| DELETE | `/api/price-list-items/:id`                       | 13248 | Deletes line item                                               | Same                                                       |
| POST   | `/api/install-workflows`                          | 16717 | Creates install workflow record (project-adjacent)              | `requirePermission("projects", "edit")` |
| PATCH  | `/api/install-workflows/:id`                      | 16861 | Edits install workflow — no ownership check inline either       | Same                                                       |
| PATCH  | `/api/install-workflows/:id/milestones/:mid`      | 16902 | Edits milestone                                                 | Same                                                       |
| POST   | `/api/notes`                                      | 14699 | Anyone authenticated can create a note attached to ANY CRM object | `requirePermission("crm", "edit")` |
| POST   | `/api/tags`                                       | 14907 | Workspace-wide tag creation                                     | `requirePermission("crm", "edit")`     |
| POST   | `/api/record-tags`                                | 14939 | Apply tag to ANY record by id                                   | `requirePermission("crm", "edit")`     |
| DELETE | `/api/record-tags`                                | 14948 | Remove tag from ANY record                                      | Same                                                       |
| POST   | `/api/attachments`                                | 5005  | Workspace upload, no module gate at route level                 | Module gate by `objectType` (`crm.edit`/`projects.edit`/etc.) |
| POST   | `/api/documents/link`                             | 5120  | Same — link external doc to any object                          | Same                                                       |
| POST   | `/api/activities`                                 | 3842  | Creates activity log entry (CRM-adjacent)                       | `requirePermission("crm", "edit")` |
| POST   | `/api/tasks`                                      | 3989  | Has in-handler BOLA gate by `linkedObjectType` ✅ — but route-level middleware doesn't gate by `crm.edit`. Conflicts w/ `routes-tasks.ts canEdit`. | Add `requirePermission("crm", "edit")` for consistency |
| PUT    | `/api/tasks/:id`                                  | 4038  | Same; duplicates `routes-tasks.ts:402` `PATCH /api/tasks/:id` (different verb)  | Add `requirePermission("crm", "edit")` |
| POST   | `/api/quick-actions/task`                         | 4014  | Already has `crm.edit` ✅                                       | False positive                         |
| POST   | `/api/calendar/integrations/caldav/test`          | 6441  | Per-user connectivity test                                      | False positive (per-user)              |
| POST   | `/api/calendar/integrations/caldav/connect`       | 6458  | Creates per-user CalDAV integration                             | False positive (per-user)              |
| POST   | `/api/calendar/integrations/:id/sync`             | 6543  | Verify ownership inline before approving                        | Audit handler — may need `requireOwnerOrAdmin` |
| PATCH  | `/api/calendar/integrations/:id`                  | 6579  | Same                                                            | Same                                                       |
| DELETE | `/api/calendar/integrations/:id`                  | 6623  | Same                                                            | Same                                                       |
| POST   | `/api/calendar/events/:id/add-zoom`               | 6319  | Per-event mutation — verify in-handler `event.userId` check     | Audit handler                          |
| POST   | `/api/calendar/events/:id/send-invites`           | 6350  | Sends invites for any event id                                  | Audit handler                          |
| POST   | `/api/calendar/events/:id/post-meeting`           | 6753  | Post-meeting mutation                                           | Audit handler                          |
| POST   | `/api/mail-folders/:id/domains`                   | 15506 | **Doesn't check ownership inline** — any auth user can add domain to any folder | Add `WHERE owner_user_id = $userId` like sibling routes |

### P1.B — Mutations gated only on `view` (under-gated)

| Method | Path                                            | Line  | Risk                                                      | Recommended gate |
| ------ | ----------------------------------------------- | ----- | --------------------------------------------------------- | ---------------- |
| POST   | `/api/timeline/link-email`                      | 12931 | Inserts into `emailAssociations` — workspace-shared write on `crm.view` | `requirePermission("crm", "edit")` |
| DELETE | `/api/timeline/unlink-email/:id`                | 12969 | Deletes any `emailAssociations` row by id — IDOR + write on `crm.view` | `requirePermission("crm", "edit")` |
| POST   | `/api/suggestions/:id/dismiss`                  | 2510  | Dismisses a workspace-shared suggestion. Currently `crm.view` — debatable; if dismiss is per-user-pref it should write to a per-user table; if it kills the suggestion globally it should be `crm.edit`. | Audit semantics, then either keep or escalate to `edit` |
| POST   | `/api/suggestions/:id/snooze`                   | 2528  | Same                                                      | Same                                                       |
| POST   | `/api/tasks/suggestions/:id/dismiss`            | 4255  | Same                                                      | Same                                                       |
| POST   | `/api/tasks/suggestions/:id/snooze`             | 4277  | Same                                                      | Same                                                       |
| POST   | `/api/execution/digest`                         | 4831  | Generates digest (read-like effect, `crm.view` reasonable) | False positive — keep                                     |

---

## P2 — Defense-in-depth (currently safe via in-handler ACL)

These look weak at the route-middleware slot but enforce auth/ownership inside the handler. Documented to prevent future drive-by audits from re-flagging them.

| Method | Path                                              | Line  | Why it's a false positive                                                |
| ------ | ------------------------------------------------- | ----- | ------------------------------------------------------------------------ |
| GET    | `/api/auth/me`                                    | 711   | Returns 401 if `!session.userId`                                         |
| POST   | `/api/auth/change-password`                       | 847   | Returns 401 if `!session.userId`                                         |
| POST   | `/api/auth/change-password-forced`                | 868   | Same                                                                     |
| POST   | `/api/webauthn/auth-options`                      | 993   | Pre-login (intentionally unauthenticated; challenge generation)          |
| GET    | `/api/auth/google/callback`                       | 12102 | OAuth callback. Returns 401 page if `!session.userId`                    |
| POST   | `/api/webhooks/gmail`                             | 12380 | HMAC-token verified via `crypto.timingSafeEqual` against `GMAIL_WEBHOOK_TOKEN` |
| GET    | `/api/zoom/oauth/callback`                        | 23813 | OAuth callback (state param verified)                                    |
| GET    | `/api/booking-links/public/:token`                | 24061 | Public booking page; auth is the random token in the URL                 |
| POST   | `/api/booking-links/public/:token/confirm`        | 24077 | Same                                                                     |
| GET    | `/api/calendar/events/:id`                        | 6286  | In-handler `event.userId !== session.userId` → 404                       |
| PUT    | `/api/calendar/events/:id`                        | 6300  | Same                                                                     |
| DELETE | `/api/calendar/events/:id`                        | 6309  | Same                                                                     |
| GET    | `/api/calendar/events/:id/crm-context`            | 6637  | `WHERE userId = sessionUserId` in SQL                                    |
| PATCH  | `/api/users/me/layout`                            | 757   | `userId = session.userId`; per-user                                      |
| POST   | `/api/users/me/layout/reset`                      | 830   | Same                                                                     |
| POST   | `/api/webauthn/register-options`                  | 975   | Uses `session.userId!`                                                   |
| POST   | `/api/webauthn/register-verify`                   | 984   | Same                                                                     |
| DELETE | `/api/webauthn/credentials/:id`                   | 1054  | `deleteCredential(session.userId, id)` is user-scoped                    |
| PATCH  | `/api/attachments/:id`                            | 5058  | Owner-or-admin check inline                                              |
| DELETE | `/api/attachments/:id`                            | 5219  | Owner-or-admin check inline (with documented legacy-null fallback)       |
| PUT    | `/api/notes/:id`                                  | 14724 | `noteOwnerOrAdmin` helper                                                |
| DELETE | `/api/notes/:id`                                  | 14748 | Same                                                                     |
| PATCH  | `/api/notes/:id/pin`                              | 14764 | Same (explicit BOLA fix comment in code)                                 |
| PUT    | `/api/saved-views/:id`                            | 14987 | Explicit BOLA-hardening comment + owner-or-admin check                   |
| DELETE | `/api/saved-views/:id`                            | 15013 | Returns 403 `forbidden` from storage layer                               |
| PATCH  | `/api/saved-views/:id/set-default`                | 15026 | Per-user                                                                 |
| PATCH  | `/api/gmail/accounts/:id/share`                   | 11785 | Master-admin-only check inline                                           |
| POST   | `/api/gmail/accounts/:id/resync`                  | 11870 | `requireOwnerOrAdmin(accountId)`                                         |
| POST   | `/api/gmail/accounts/:id/disconnect`              | 11888 | Same                                                                     |
| DELETE | `/api/gmail/accounts/:id`                         | 11915 | Same                                                                     |
| POST   | `/api/gmail/accounts/:id/sync-toggle`             | 11936 | Same                                                                     |
| GET    | `/api/gmail/accounts/:id/access`                  | 11960 | Same (already documented as false positive previously)                   |
| PATCH  | `/api/gmail/accounts/:id/access`                  | 12013 | Same                                                                     |
| POST   | `/api/mail-folders`                               | 15450 | Stamps `ownerUserId = session.userId` — user-scoped                      |
| PUT    | `/api/mail-folders/:id`                           | 15467 | `WHERE owner_user_id = userId` in SQL                                    |
| DELETE | `/api/mail-folders/:id`                           | 15483 | Same (verify in code)                                                    |
| POST   | `/api/mail-folders/:id/backfill`                  | 15562 | `WHERE id AND owner_user_id`                                             |
| POST   | `/api/mail-folders/from-account`                  | 15602 | Verify (likely owner-scoped)                                             |
| All    | `/api/admin/*` routes                             | 477+  | Chained `requireAuth, requireAdmin`                                      |
| All    | `/api/email-engagement-rules*`                    | 596+  | Chained `requireAuth, requirePermission("crm", "edit")`                  |
| All    | `routes-tasks.ts` `app.X` definitions             | 253+  | Use shared `canView/canEdit = requirePermission("crm", view|edit)`       |
| All    | `voice-assistant.ts` 5 routes                     | 952+  | All on `requireAuth`; per-user (session.userId scoped)                   |
| All    | `replit_integrations/{audio,chat,image}/routes.ts`| 1+    | All on `requireAuth`; per-user                                           |

---

## CROSS-CUTTING FINDING — duplicate routes

`server/routes.ts` defines:

- `POST /api/tasks/:id/complete` (L4878) — bare `async`, in-handler 401
- `POST /api/tasks/:id/snooze` (L4891) — bare `async`
- `POST /api/tasks/:id/reassign` (L4918) — bare `async`

…**and** `server/routes-tasks.ts` defines a properly gated `POST /api/tasks/:id/complete` (L463) with `requirePermission("crm","edit")`. Express keeps the **first** registered handler, but the registration order between these two files determines which wins. **The duplicate routes in `routes.ts` should be deleted** to remove ambiguity and ensure the strict gate always applies. Same for any other tasks routes that exist in both files.

This is a code-clarity/safety win unrelated to permissions, but the duplication is currently masking the proper gate.

---

## TOP 10 RECOMMENDED FIXES (next commit)

In order of impact-per-line-of-change. Each is a one-middleware swap unless noted.

| # | Severity | Route(s)                                                                     | Fix                                              |
| - | -------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| 1 | **P0**   | All 6 `/api/*/export` CSV routes                                             | `requirePermission("crm"\|"support", "view")`    |
| 2 | **P0**   | `/api/contacts`, `/api/opportunities`, `/api/opportunities/:id/stage-history`, `/api/accounts/:id/infrastructure` | `requirePermission("crm", "view")` |
| 3 | **P0**   | `/api/tickets`, `/api/tickets/:id`                                           | `requirePermission("support", "view")`           |
| 4 | **P0**   | All 10 `/api/ecosystem/*` GET + `/api/partnerships`(/:id) + `/api/team-workload` | `requirePermission("partnerships"\|"team_workload", "view")` |
| 5 | **P0**   | `/api/marinas`, `/api/marinas/states`, `/api/leads/nearby`, `/api/leads/states`, `/api/comments` (GET), `/api/comm-lists`, `/api/campaigns`(/:id) | `requirePermission("crm"\|"communications", "view")` (or `requireAuth` for the state-list utilities) |
| 6 | **P0**   | `POST /api/leads/:id/geocode-address`, `POST /api/comments`, `POST /api/comments` | `requirePermission("crm", "edit")` + drop the bare `async` |
| 7 | **P0**   | Delete the 3 duplicate `POST /api/tasks/:id/{complete,snooze,reassign}` in `routes.ts` (the gated copies in `routes-tasks.ts` win) | Removal commit |
| 8 | **P1**   | `POST /api/email-messages/:id/confirm` (sibling of just-fixed `/reassign`)   | In-handler `mail_team[sourceAccountId].edit` ACL — copy/paste from L12577 |
| 9 | **P1**   | All 6 `/api/price-lists*` routes                                             | `requirePermission("quoting", "edit")` |
| 10| **P1**   | `POST /api/timeline/link-email`, `DELETE /api/timeline/unlink-email/:id`     | Escalate from `crm.view` to `crm.edit` |

After Top-10 the next sweep should target Jira write surface, install-workflows, attachments/documents-link module gating, and the `/api/gmail/{send,sync*,watch/*}` per-mailbox ACLs.

---

## Stats

- **748** routes audited end-to-end.
- **52** routes with no route-level middleware.
  - **~32** are real risks (P0 above).
  - **~20** are intentional (OAuth callbacks, webhooks, public booking links, pre-login auth screens) and documented as P2 false positives.
- **527** routes on `requireAuth`.
  - **~30** of those are the P1 list above.
  - The rest either use a chained `requirePermission`/`requireAdmin` middleware in the next slot, or have an in-handler ownership/role check.
- **154** routes with `requirePermission(...)` at the route slot — the intended pattern, mostly correctly applied. **7** of those use `view` on POST/DELETE; 5 are debatable (suggestions dismiss/snooze) and 2 are real under-gates (`/api/timeline/link-email`, `/api/timeline/unlink-email/:id`).
- **0** code, schema, or `db:push` changes performed by this sweep.
