# BOLA / IDOR Sweep — Round 2 (with Round-3 follow-ups)

App-wide Broken Object-Level Authorization sweep on top of the F-09 attachment fixes. Final sign-off received from architect — no remaining HIGH/CRITICAL on the reviewed surfaces.

## Scope & Standing Rules

- No schema changes. No package upgrades. No new tables. No `db:push`.
- Additive / surgical code only.
- Reuse the existing `requireAuth` / `requirePermission(section, level)` model and the helpers shipped in Round 1 (`attachmentSectionFor`, `requireSectionView`).

## Final Tally

- **48 / 48** new BOLA sweep assertions passing (`scripts/security-bola-sweep.test.ts`).
- **15 / 15** prior F-09 attachment IDOR assertions still passing (`scripts/security-attachment-idor.test.ts`).
- **63 / 63** combined.

## Findings Ledger

Severity scale: **HIGH** = unauth/cross-user write or sensitive read; **MEDIUM** = lateral exposure of business data; **LOW** = metadata.

| ID | Title | Sev | Status |
|---|---|---|---|
| F-16 | `/api/install-workflows/*` was `requireAuth`-only — anyone could read or modify any workflow, its milestones, and its CRM links | HIGH | FIXED |
| F-17 | `/api/procurement/*` (suppliers, parts, POs, PO lines) was `requireAuth`-only — anyone could read supplier contacts, edit POs, change line costs | HIGH | FIXED |
| F-18 | `/api/saved-views/:id` PUT had no ownership check — any user could overwrite any other user's saved view | HIGH | FIXED |
| F-19 | `/api/tasks/:id` PUT had no ownership/section check — any user could edit any task in the org, including reassigning ownership | HIGH | FIXED |
| F-20 | `/api/notes/:id/pin` had no ownership check (PUT/DELETE were already gated) | MED | FIXED |
| F-21 | `/api/activities/export` would dump all activities for any (objectType, objectId) to any logged-in user | HIGH | FIXED |
| F-22 | `/api/tasks/export` would dump all tasks for any linkedObjectType / org-wide to any logged-in user | HIGH | FIXED |
| F-23 | `/api/tasks/export` self-scope was broken — `storage.getTasks({owner})` silently dropped the filter (key mismatch); non-admin unfiltered export still leaked | HIGH | FIXED |
| F-24 | `/api/tasks/export` partial-filter bypass — `linkedObjectType` without `linkedObjectId` passed the section gate but storage dropped the object filter; org-wide rows leaked | HIGH | FIXED |
| F-25 | Cross-section export bypass — `attachmentSectionFor` mapped `project/quote/partnership/...` to `crm`, mismatching the actual route prefix gates; `crm:view`-only users could export project/quote/partnership data | HIGH | FIXED |
| F-26 | `GET /api/activities` (JSON read) was un-gated; equivalent leak to F-21 via the JSON endpoint | HIGH | FIXED |
| F-27 | `GET /api/tasks` (JSON read) was un-gated; equivalent leak to F-22 via the JSON endpoint | HIGH | FIXED |
| F-28 | `GET /api/tasks/hub?view=team` returned org-wide tasks to any authenticated user, regardless of section permissions | HIGH | FIXED |
| F-29 | `POST /api/tasks` was un-gated and accepted client-supplied `ownerUserId`; any logged-in user could create tasks owned by other users or in sections they couldn't view | HIGH | FIXED |
| F-30 | `POST /api/activities` was un-gated and accepted cross-section writes via the persisted-schema field name (`linkedObjectType`), bypassing the legacy `objectType` alias path | HIGH | FIXED |

## Centralized Helpers

`server/voice-assistant-create-guards.ts`:

- `LINKABLE_SECTION` — re-aligned to match the actual route prefix gates registered in `server/routes.ts`:
  - `project → projects`, `quote → quoting`, `partnership/ecosystem → partnerships`,
  - `ticket → support`, `asset → knowledge`, `campaign/comm_list → communications`,
  - CRM-side types stay on `crm` (`lead/account/contact/opportunity/install_workflow/deployment/purchase_order/customer_success/general`).
  - This change tightens both attachment ACLs and task/activity exports — strictly stronger than before; no surface gets weaker.
- `attachmentSectionFor(objectType)` — defaults unknown types to `crm` (preserves Round 1 behavior for legacy attachment rows).
- `exportSectionFor(objectType)` — **new strict variant** used by export routes and create routes; returns `null` for unknown types so callers can fail closed with `400` instead of silently defaulting to `crm`.
- `requireSectionView(userId, section)` — unchanged, still admin/master_admin bypass + view-level check.

## Files Changed

- `server/voice-assistant-create-guards.ts` — re-aligned `LINKABLE_SECTION`, added `exportSectionFor`.
- `server/routes.ts` — additive only, ~180 LOC across:
  - L1044-1048 — `/api/install-workflows` and `/api/procurement` prefix gates.
  - L1175-1192 — `/api/activities/export` strict-section gate.
  - L1196-1230 — `/api/tasks/export` partial-filter rejection + non-admin self-scope force + numeric `ownerUserId`.
  - L3478-3491 — `GET /api/activities` mirror of the export gate.
  - L3493-3522 — `POST /api/activities` alias normalization + section gate + non-admin authorship strip.
  - L3518-3551 — `GET /api/tasks` mirror of the export gate (partial-filter rejection + non-admin self-scope).
  - L3553-3574 — `POST /api/tasks` section gate + forced `createdByUserId`/`ownerUserId` for non-admins.
  - L3631-3656 — `/api/tasks/hub` `requireAuth` + non-admin self-scope on `team` view (and team_count badge).
  - L3489-3516 — `/api/tasks/:id` PUT owner/creator-or-admin gate + ownership-field stripping.
  - L12621-12637 — `/api/notes/:id/pin` `noteOwnerOrAdmin` gate.
  - L12844-12868 — `/api/saved-views/:id` PUT owner/shared/admin gate + `userId/id` stripping.
- `scripts/security-bola-sweep.test.ts` — new, end-to-end smoke (48 assertions, all passing).
- `SECURITY_BOLA_SWEEP.md` — this report.

Net diff: **~180 LOC of additive code** in `server/routes.ts` + **~80 LOC of helper changes** + **~360 LOC of test**. Zero schema. Zero deps.

## Test Coverage Breakdown

| Coverage area | # |
|---|---|
| install-workflows section gate (admin allow, low-perm deny on list + `:id`, unauth 401) | 5 |
| procurement section gate (POs, suppliers, low-perm deny, unauth 401) | 4 |
| saved-views/:id PUT owner gate + nonexistent-id 404 | 2 |
| tasks/:id PUT owner gate + nonexistent-id 404 + unauth 401 | 3 |
| activities/export section gate (admin allow, low-perm CRM deny) | 2 |
| tasks/export filtered low-perm deny + unfiltered self-scope | 2 |
| tasks/export data-isolation: admin task hidden from low-perm CSV | 1 |
| tasks/export caller-supplied `?owner` ignored for non-admin | 1 |
| tasks/export partial filter (`linkedObjectType` w/o `linkedObjectId`) → 400 | 2 |
| tasks/export partial-filter + `?owner` override no-leak assertion | 1 |
| activities/export cross-section deny (`project/quote/partnership`) + unknown→400 | 4 |
| tasks/export cross-section deny + unknown→400 | 2 |
| activities/export admin positive control | 1 |
| `/api/activities` JSON cross-section deny + unknown→400 + unauth + admin allow | 4 |
| `/api/tasks` JSON cross-section deny + unknown→400 + partial→400 + unauth | 4 |
| `/api/tasks` JSON low-perm self-scope + override-ignored data isolation | 2 |
| `/api/tasks/hub?view=team` low-perm self-scope + unauth | 2 |
| `POST /api/tasks` ownerUserId override forced to self for non-admin | 1 |
| `POST /api/tasks` low-perm cross-section blocked | 1 |
| `POST /api/activities` low-perm cross-section blocked (`linkedObjectType` + `objectType` alias) | 2 |
| `POST /api/activities` unknown linkedObjectType → 400 | 1 |
| `POST /api/activities` unauth → 401 | 1 |
| **Total** | **48** |

## Residual Medium / Low Risks (deferred)

1. **Mail folders `:id` write routes** (`server/routes.ts:13162+`) — not yet section-gated. Low risk because folders only contain Gmail labels and don't leak content beyond what the user already has Gmail-side, but should be scoped to owner.
2. **`/api/jira/issues/:key` and `/api/confluence/pages/:id` reads** — proxy to the user's own integration credentials, so an unauthorized user can only see what their *own* token can see. Worth gating to a `productivity:view`-style section if one is added.
3. **Bulk `sql.raw` interpolation in install-workflows + procurement PATCH/POST handlers** — sets are built from `String(v).replace(/'/g,"''")`. Manual-escape is a fragile pattern; a future pass should migrate these to parameterized SQL.
4. **`/api/tasks/hub` admin-team view** — admins still see org-wide via the same SQL. Acceptable today (admins have full visibility) but should move to a parameterized `team_workload:view` permission rather than the role role check.
5. **Drizzle CVE F-01** — still deferred per Round 1 (no exploitable path found, but a package upgrade is the proper fix).

## Next Recommended Hardening Step

**Replace the hand-rolled `sql.raw` UPDATE/INSERT statements in `/api/install-workflows/*`, `/api/procurement/*`, and `/api/tasks/hub` with parameterized Drizzle calls.** This eliminates the `String(v).replace(/'/g, "''")` SQL-injection risk class entirely — strictly stronger than auditing each branch. It is non-trivial enough to deserve its own pass and is the highest-leverage next step now that the BOLA layer is closed.
