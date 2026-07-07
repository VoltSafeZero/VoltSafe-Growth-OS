# CEO Cockpit Release Checklist
**Phases 4–13 | VoltSafe Growth OS**

This document is the pre-production and post-deploy checklist for CEO Cockpit.
Run through every section before and after pushing to production.

---

## A. Pre-Release Checks

### Migrations
- [x] All CEO migration blocks use `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- [x] All migration catch blocks log errors — no silent `/* already exists */` swallowing (fixed Phase 13)
- [x] All CEO migration indexes use `CREATE INDEX IF NOT EXISTS`
- [x] No destructive SQL (`DROP TABLE`, `TRUNCATE`, `DELETE FROM`) in startup migrations
- [x] No `COPY FROM` or dev-data seeding in production startup path
- [x] Migration success log lines confirmed: `CEO Action Queue tables ready`, `meeting_notes.one_on_one_sections column ready`, `ceo_execution_reviews table ready`, `board_packs table ready`, `ceo_forecast_notes table ready`

### Tests (run before deploy)
```bash
node tests/ceo-cockpit-smoke.test.cjs
node tests/ceo-cockpit-ux-polish.test.cjs
node tests/ceo-cockpit-hardening.test.cjs
node tests/ceo-cockpit.test.cjs
node tests/ceo-action-loop.test.cjs
node tests/ceo-briefing.test.cjs
node tests/ceo-execution-intelligence.test.cjs
node tests/ceo-forecasting.test.cjs
node tests/board-pack.test.cjs
node tests/ceo-one-on-ones.test.cjs
node tests/today-cockpit.test.cjs
node tests/today-personalization.test.cjs
node tests/capital-hardening.test.cjs
node tests/nav-consolidation.test.cjs
node tests/cms-theme-structural.test.cjs
node tests/startup-invariants.test.cjs
node tests/nav-drift.test.cjs
# Supplemental drilldown + Currents regression:
node tests/insights-drilldown.test.cjs
node tests/marketing-drilldown.test.cjs
node tests/marketing-drilldown-polish.test.cjs
node tests/operations-drilldown.test.cjs
node tests/pipeline-drilldown.test.cjs
node tests/work-drilldown.test.cjs
node tests/currents-workspace-shell.test.cjs
node tests/currents-search.test.cjs
node tests/currents-phase7b-structured-panel.test.cjs
node tests/marketing-simplification.test.cjs
```
All suites must pass 0 failures before proceeding.

### Build
```bash
npm run build
# Expected: 0 TypeScript errors, Vite client build succeeds
# Known non-blocking: 5x import.meta.dirname warnings in server bundle (CJS format — harmless, pre-existing)
```

### Permissions
- [x] `requireAdmin` confirmed on all `/api/today/ceo-*` routes
- [x] `requireBoardPackAccess` confirmed on all `/api/board-packs/*` routes
- [x] `requireForecastCapitalAccess` confirmed on `/api/today/ceo-forecast/runway` and `/api/today/ceo-forecast/funding`
- [x] CEO Cockpit tab in Today page gated by `isAdmin` check on frontend

### Production Environment
- [ ] `SESSION_SECRET` is set and ≥ 32 characters
- [ ] `DATABASE_URL` points to production database
- [ ] `NODE_ENV=production` set
- [ ] No dev seed scripts running at startup

### Backup
- [ ] Production database snapshot taken before deploy
- [ ] Note timestamp of snapshot in deploy log

---

## B. Production Deploy Steps

These steps assume Replit Deployments. Do not deploy from a branch with failing tests.

### Step 1 — Final local validation
```bash
npm run build            # must pass 0 errors
node tests/ceo-cockpit-smoke.test.cjs   # must pass 113/113
```

### Step 2 — Take production DB snapshot
Before pushing any deploy, create a snapshot via your database provider console.
Note the snapshot timestamp. Keep it for at least 48 hours post-deploy.

### Step 3 — Deploy via Replit
Use the Replit Deploy button or deployment workflow. Production will build the `dist/` folder and start `node dist/index.cjs`.

### Step 4 — Watch startup logs (first 2 minutes)
Confirm these lines appear exactly once:
```
[migration] CEO Action Queue tables ready.
[migration] meeting_notes.one_on_one_sections column ready.
[migration] ceo_execution_reviews table ready.
[migration] board_packs table ready.
[migration] ceo_forecast_notes table ready.
```
`[migration] skipped (already applied): ...` lines are normal for re-deploys — they mean the table/column already exists, which is the correct outcome.

### Step 5 — Health check
```
GET https://<prod-domain>/health  →  200 OK
```

### Step 6 — Route smoke check (see Section G below)

### Step 7 — Browser QA (see Section B manual smoke)

---

## C. Smoke Test Checklist (Manual Login QA)

### Login as CEO (Trevor — admin, capital access)
- [ ] Today page loads without console errors
- [ ] CEO Cockpit toggle appears and is clickable
- [ ] CEO Cockpit view renders with header ("CEO Cockpit" title + subtitle)
- [ ] All 7 tabs visible and icons displayed: Overview, Actions, Briefing, Execution, Forecasting, 1:1s, Board Pack
- [ ] Overview tab loads: Team Pulse, Blockers, CEO Attention, Silence Watch, Commitments, Communication Hotspots
- [ ] Priority summary bar appears if any blockers/attention items/overdue commitments exist
- [ ] Actions tab: Generate Suggested works, suggested actions appear
- [ ] Actions tab: Copy Draft opens sheet with draft text (does NOT send anything)
- [ ] Actions tab: Create Action/Task wires to task creation
- [ ] Briefing tab: Daily and Weekly sections render
- [ ] Execution tab: Radar, Drift, Commitments, Scorecard sub-tabs render
- [ ] Forecasting tab: Revenue, Scenarios, Interventions render; Runway and Funding **also** appear (capital access)
- [ ] 1:1s tab: Direct reports listed, notes drawer opens
- [ ] Board Pack tab: Feature cards visible, "Open" button routes to /board-pack
- [ ] /board-pack page: Generate Pack, list, finalize/archive all work
- [ ] Investor update draft generates copy-only draft (no send button)
- [ ] Refresh button spins while fetching and re-loads data
- [ ] Last-refreshed timestamp updates after refresh

### Login as CFO (Scott Carlson — admin, capital access)
- [ ] CEO Cockpit accessible
- [ ] Board Pack accessible at /board-pack
- [ ] Runway and Funding forecast tabs visible
- [ ] No access errors on any CEO Cockpit tab

### Login as Normal Admin (not Trevor or Scott)
- [ ] CEO Cockpit tab appears (admin = true)
- [ ] Overview, Actions, Briefing, Execution, Forecasting, 1:1s, Board Pack tabs all render
- [ ] Forecasting tab: Revenue, Scenarios, Interventions visible
- [ ] Forecasting tab: **Runway and Funding do NOT appear** (no capital access) — or show 403 gracefully
- [ ] /board-pack page returns 403 or redirects (not CEO or CFO)

### Login as Non-Admin User
- [ ] Today page loads (My Day mode only)
- [ ] CEO Cockpit toggle is NOT visible
- [ ] Direct navigation to `/api/today/ceo-cockpit` returns 403
- [ ] Direct navigation to `/api/board-packs` returns 403
- [ ] Direct navigation to `/api/today/ceo-forecast/runway` returns 403

---

## D. Privacy Checks

### Private Currents channels
- [x] CEO Cockpit Team Pulse queries `cc.is_private = false` — private channels excluded at DB layer
- [x] CEO Briefing `buildDailyCeoBriefing` queries `cc.is_private = false` — same guard
- [ ] Confirm in production: private Currents channels do not appear in Team Pulse or Communication Hotspots
- [x] DM body lookup in `buildUpdateRequestDraft` fetches conversation ID only — no message body exposure

### Capital data gating
- [x] Capital section in CEO Cockpit overview is absent for non-capital users (`hasCapital` flag from `permissions.capital`)
- [x] Capital section IS present for Trevor (user 4) and Scott (scott.carlson@voltsafe.com)
- [x] Board Pack capital analysis section gated via `isBoardPackUser` helper
- [ ] Confirm in production: non-capital admin cannot see Runway / Funding tabs

### Copy-only draft checks (all confirmed in Phase 13)
- [x] Action update-draft API response includes `copy_only: true`
- [x] Board Pack markdown API response includes `copy_only: true`
- [x] Investor update draft API response includes `copy_only: true`
- [ ] Confirm in production: no draft route triggers a Gmail send or Currents message

### localStorage audit
- [x] No CEO Cockpit data stored in localStorage (confirmed by source grep)
- [x] No capital/runway/funding data stored in localStorage
- [x] No sensitive contact or deal data in sessionStorage

---

## E. UX Checks

### Desktop (≥1280px)
- [ ] CEO Cockpit header shows title, subtitle, refresh button, admin badge, and last-refreshed timestamp
- [ ] All 7 tabs display with icons and labels in a single row
- [ ] Overview priority summary bar displays in orange/amber/red when items exist
- [ ] Board Pack tab shows 3 feature cards in a 3-column grid
- [ ] Execution Radar SectionBlock cards use theme colors (no hardcoded `bg-[#0d1117]`)
- [ ] SectionBlock expand/collapse uses ChevronDown animation (no Unicode ▲▼)

### Tablet (768–1024px)
- [ ] CEO Cockpit header text and buttons remain on one line or wrap cleanly
- [ ] Tab bar scrolls horizontally without wrapping to 2 rows
- [ ] Overview grid (Blockers + CEO Attention side-by-side) holds at md:grid-cols-2
- [ ] Board Pack feature cards collapse to 1 column cleanly

### Mobile (< 768px)
- [ ] Tab bar scrolls horizontally (overflow-x-auto, no wrapping)
- [ ] Admin badge hidden on small screens (hidden sm:flex) — no layout break
- [ ] Last-refreshed hidden on small screens (hidden md:block) — no layout break
- [ ] Action Queue filter chips scroll horizontally (no wrapping)
- [ ] No horizontal page overflow

### Loading States
- [ ] Overview: spinner + skeleton while cockpit data loads
- [ ] Actions tab: skeleton while actions load
- [ ] Briefing tab: Loader2 spinner while briefing loads
- [ ] Execution Radar: skeleton cards while radar/scorecard load
- [ ] Forecasting: appropriate loading indicator

### Empty States
- [ ] Briefing EmptyState shows CheckCircle2 icon + message (not just italic text)
- [ ] Execution sections with no items show `empty_state` message from service
- [ ] Action Queue with no actions shows a clear empty message

### Error States
- [ ] Overview: AlertTriangle + "Failed to load CEO Cockpit data" if query errors
- [ ] 1:1s tab: AlertTriangle error fallback if cockpit query errors
- [ ] Tab content panels handle network errors gracefully (no raw JSON visible)

---

## F. Build Checks

```bash
npm run build
```
- [ ] 0 TypeScript errors
- [ ] Vite client build completes successfully
- [ ] Server bundle (`dist/index.cjs`) created
- [ ] Known non-blocking warnings: 5× `import.meta.dirname` in server bundle (pre-existing CJS format artifact)
- [ ] Large chunk warnings (gmail-inbox, index, role-command-center) are pre-existing and non-blocking

---

## G. Post-Deploy Route Smoke Checks

Run these with a production session cookie or via browser after logging in.

### Routes that must return 200 for CEO (Trevor):
```
GET /api/today/ceo-cockpit
GET /api/today/ceo-actions
GET /api/today/ceo-briefing/daily
GET /api/today/ceo-execution/radar
GET /api/today/ceo-forecast
GET /api/today/ceo-forecast/runway    ← CEO/CFO only
GET /api/today/ceo-forecast/funding   ← CEO/CFO only
GET /api/board-packs                  ← CEO/CFO only
```

### Routes that must return 403 for non-admin:
```
GET /api/today/ceo-cockpit            → 401 unauthenticated, 403 non-admin
GET /api/board-packs                  → 403 non-CEO/CFO
GET /api/today/ceo-forecast/runway    → 403 non-capital
GET /api/today/ceo-forecast/funding   → 403 non-capital
```

### Routes that must return 200 for CFO (Scott Carlson):
```
GET /api/board-packs
GET /api/today/ceo-forecast/runway
GET /api/today/ceo-forecast/funding
```

### Routes that must return 403 for normal admin (not CEO/CFO):
```
GET /api/board-packs                  → 403
GET /api/today/ceo-forecast/runway    → 403
GET /api/today/ceo-forecast/funding   → 403
```

---

## H. 24-Hour Production Monitoring Checklist

Check these in the first 24 hours after deploy.

### Server logs — watch for:
- [ ] No `[migration] skipped (already applied): <unexpected error>` for the 5 CEO tables
- [ ] No `relation "ceo_action_queue" does not exist` errors
- [ ] No `relation "board_packs" does not exist` errors
- [ ] No `column "one_on_one_sections" does not exist` errors
- [ ] No `[ceo-actions]` or `[ceo-briefing]` 500-error lines
- [ ] No `sendEmail` triggered from CEO Cockpit routes (should never happen)
- [ ] No 401/403 spike for Trevor or Scott on Board Pack routes
- [ ] CEO route response times < 2s (all queries are DB-only, no external calls)

### Database — verify rows created only by explicit actions:
- [ ] `ceo_action_queue`: rows appear only after Trevor clicks "Generate Suggested" or creates manually
- [ ] `ceo_action_events`: rows appear only after action status changes
- [ ] `ceo_execution_reviews`: rows appear only after radar item review/dismiss
- [ ] `board_packs`: rows appear only after explicit "Generate Pack" or create
- [ ] `ceo_forecast_notes`: rows appear only after Trevor saves a scenario note

### Browser console — after login:
- [ ] No uncaught JS errors on Today page load
- [ ] No failed network requests in CEO Cockpit tabs
- [ ] No CORS or CSP errors
- [ ] No duplicate API requests on tab switch (inactive tabs should not prefetch)

### Auth / permissions sanity:
- [ ] Trevor login: CEO Cockpit visible, Board Pack accessible, Runway/Funding visible
- [ ] Scott login: CEO Cockpit visible, Board Pack accessible, Runway/Funding visible
- [ ] Non-admin login: Today page loads, CEO Cockpit toggle absent
- [ ] Normal admin login: CEO Cockpit visible, Board Pack returns 403

---

## I. Rollback Triggers

### Roll back immediately if:
| Trigger | Reason |
|---|---|
| Today page is blank or crashes for non-admin users | CEO Cockpit change broke shared Today page |
| Login or session fails for any user | Auth regression |
| Production startup fails (app won't boot) | Migration or startup error |
| CEO Cockpit APIs cause widespread 500s (>10% of requests) | Service crash or missing table |
| Board Pack exposes capital data to non-CEO/CFO | Permission regression — highest priority |
| Any `sendEmail` call observed from CEO Cockpit routes | Auto-send safety violation |
| Production DB corruption or data loss | Immediate rollback + restore from snapshot |

### Do NOT roll back for:
| Situation | Reason |
|---|---|
| Missing empty-state polish on one tab | Non-critical UX |
| One non-critical tab errors while Today still loads | Isolated component failure |
| Copy button issue with no data exposure | Minor UX, not a safety issue |
| Expected 403s for unauthorized users | Working as intended |
| `[migration] skipped (already applied):` log lines | Normal on re-deploy |
| Large JS bundle chunk warnings | Pre-existing, non-blocking |

### Rollback procedure:
1. Revert the deployment to the previous checkpoint in Replit Deployments
2. If DB schema was changed: restore from the pre-deploy snapshot taken in Step 2
3. Do not drop tables or delete data — restore only
4. Investigate the root cause before re-deploying

---

## J. Known Limitations (Phases 4–13)

These are documented constraints, not bugs. Do not attempt to fix them during a deploy.

| Limitation | Notes |
|---|---|
| CEO/CFO hardcoded by user ID and email | `BOARD_PACK_USER_IDS = {4}`, `BOARD_PACK_USER_EMAILS = {"scott.carlson@voltsafe.com"}`. Adding new capital users requires a code change. |
| 1:1 commit extraction requires OpenAI key | `extractCommitmentsFromNote` returns empty array gracefully if `AI_INTEGRATIONS_OPENAI_API_KEY` is absent. |
| Runway/funding are forecast models, not live data | Numbers are computed from DB data; they depend on actual deal/pipeline data being current. |
| Board Pack compare-to-previous skipped if no prior pack | `no_previous_pack: true` in `WhatChangedSummary` — this is expected on first use. |
| Action suggestions generate at most 20 items | Bounded by `safeBound` in `generateCeoActions`. Working as intended. |
| Board Pack scheduler routes use `requireAdmin` not `requireBoardPackAccess` | Schedule management is an admin-level operation by design, not CEO/CFO only. |
| CEO Cockpit Today page bundle (~162KB gzip) | Pre-existing chunk size; no lazy-load optimization planned for this deploy. |

---

## K. Phase 14 Deploy Sign-Off

**Deploy date:** _______________

**Deployed by:** _______________

**Pre-deploy checklist completed:** [ ] Yes

**All test suites passed (0 failures):** [ ] Yes — 25 suites / 2,628+ checks

**Build passed:** [ ] Yes

**DB snapshot taken at:** _______________

**Migration logs confirmed:** [ ] Yes

**Post-deploy route smoke completed:** [ ] Yes

**24-hour monitoring assigned to:** _______________

**Rollback plan reviewed:** [ ] Yes

---

*Updated: CEO Cockpit Phase 14 — Production Deploy & Post-Launch Monitoring*
