# CEO Cockpit Release Checklist
**Phases 4–12 | VoltSafe Growth OS**

This document is the pre-production and post-deploy checklist for CEO Cockpit.
Run through every section before pushing to production.

---

## A. Pre-Release Checks

### Migrations
- [ ] All CEO migration blocks use `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- [ ] All migration catch blocks log errors (no silent `/* already exists */` swallowing)
- [ ] No destructive SQL (`DROP TABLE`, `TRUNCATE`, `DELETE FROM`) in startup migrations
- [ ] No `COPY FROM` or dev-data seeding in production startup path
- [ ] Migration success log lines confirmed: `CEO Action Queue tables ready`, `meeting_notes.one_on_one_sections column ready`, `ceo_execution_reviews table ready`, `board_packs table ready`, `ceo_forecast_notes table ready`

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
```
All suites must pass 0 failures before proceeding.

### Build
```bash
npm run build
```
Build must complete with 0 TypeScript errors.

### Permissions
- [ ] `requireAdmin` confirmed on all `/api/today/ceo-*` routes
- [ ] `requireBoardPackAccess` confirmed on all `/api/board-packs/*` routes
- [ ] `requireForecastCapitalAccess` confirmed on `/api/today/ceo-forecast/runway` and `/api/today/ceo-forecast/funding`
- [ ] CEO Cockpit tab in Today page gated by `isAdmin` check on frontend

### Production Environment
- [ ] `SESSION_SECRET` is set and ≥ 32 characters
- [ ] `DATABASE_URL` points to production database
- [ ] `NODE_ENV=production` set
- [ ] No dev seed scripts running at startup

### Backup
- [ ] Production database snapshot taken before deploy
- [ ] Note timestamp of snapshot in deploy log

---

## B. Smoke Test Checklist (Manual Login QA)

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

## C. Privacy Checks

### Private Currents channels
- [ ] Confirm private Currents channels are NOT surfaced in CEO Cockpit Team Pulse or Communication Hotspots
- [ ] DM message bodies are not included in bulk CRM/CEO exports

### Capital data gating
- [ ] Capital section in CEO Cockpit overview is absent for non-capital users
- [ ] Capital section IS present for Trevor and Scott
- [ ] Board Pack capital analysis section gated correctly

### Copy-only draft checks
- [ ] Action update-draft API response includes `copy_only: true`
- [ ] Board Pack markdown API response includes `copy_only: true`
- [ ] Investor update draft API response includes `copy_only: true`
- [ ] Weekly briefing draft response marked copy-only
- [ ] Leadership agenda draft response marked copy-only
- [ ] No draft route triggers any Gmail send or Currents message

### localStorage audit
- [ ] No CEO Cockpit data stored in localStorage
- [ ] No capital/runway/funding data stored in localStorage
- [ ] No sensitive contact or deal data in sessionStorage

---

## D. UX Checks

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

## E. Production Deploy Checks

### Build
```bash
npm run build
# Expect: 0 TypeScript errors, vite build succeeds
```

### Migration log verification (check server logs after first boot)
```
[migration] CEO Action Queue tables ready.
[migration] meeting_notes.one_on_one_sections column ready.
[migration] ceo_execution_reviews table ready.
[migration] board_packs table ready.
[migration] ceo_forecast_notes table ready.
```
Any `[migration] skipped (already applied):` entries are normal for re-deploy.
Any unexpected errors in migration log lines require investigation before proceeding.

### App boot health check
```
GET /health → 200 OK
```

### Route smoke (curl or browser)
```
# Unauthenticated — should return 401
curl https://<your-domain>/api/today/ceo-cockpit

# As non-admin — should return 403
# As CEO — should return 200 with sections data
```

### Browser console (Chrome DevTools)
- [ ] No uncaught JS errors on Today page
- [ ] No failed network requests in CEO Cockpit tabs (only 401/403 expected for non-admin users)
- [ ] No `[vs:perf]` bundle size regressions (JS bundle loaded time < 15s)

### Server logs (first 5 minutes after deploy)
- [ ] No `[ceo-actions]` error lines from unexpected throws
- [ ] No `[ceo-briefing]` or `[ceo-execution]` error lines
- [ ] Board Pack generation logs appear only when explicitly triggered
- [ ] No automatic sends or webhook triggers

---

## F. Rollback Notes

### What to watch for
- `board_packs` table not created → Board Pack tab returns 500 for CEO/CFO
- `ceo_action_queue` table not created → Actions tab returns 500 for all admins
- `ceo_execution_reviews` not created → Execution Radar mark-reviewed fails
- `ceo_forecast_notes` not created → Forecasting notes save fails
- `meeting_notes.one_on_one_sections` missing → 1:1 notes save silently omits sections

### Error priority
| Error | Severity | Action |
|---|---|---|
| `relation "ceo_action_queue" does not exist` | Critical | Check migration logs; re-run or migrate manually |
| `403 Board Pack access requires CEO or CFO role` for Trevor/Scott | Critical | Check `BOARD_PACK_USER_IDS` / email match in `isBoardPackUser` |
| `relation "board_packs" does not exist` | Critical | Same as above — migration failed |
| Any `sendEmail` call triggered from CEO Cockpit | Critical | Roll back immediately; this should not happen |
| Blank Overview tab (no spinner, no content) | High | Check `/api/today/ceo-cockpit` response; likely auth or DB issue |
| Action draft sheet empty | Medium | Check `buildUpdateRequestDraft` — action may not have `suggested_message` |
| Missing migration success log line | Low-Medium | Migration may have silently failed; check DB manually |

### If a migration fails on production
1. **Do not re-run the full migration stack** — each block is idempotent but investigate first
2. Check exact error in server logs: `[migration] skipped (already applied): <error message>`
3. Connect to production DB and verify the table/column exists manually
4. If table is missing: run the specific CREATE statement manually in a DB console
5. Restart the app after manual fix

### Never copy dev DB to production
Development databases contain test data, fake accounts, and seed users that must never reach production. If you need to apply a schema change, run the DDL directly — do not copy or restore the dev database.

---

*Generated: CEO Cockpit Phase 13 — Real Data QA & Launch Readiness*
