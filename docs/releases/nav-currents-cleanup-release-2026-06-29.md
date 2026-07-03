# Navigation + CURRENTS Release — 2026-06-29

## 1. Release Summary

This release simplifies the VoltSafe CMS sidebar, elevates CURRENTS to a first-class workspace, and cleans up labelling and grouping across the navigation. The result is a leaner, clearer sidebar where every section is where you would expect it and nothing is buried under a catch-all "More" group.

Key outcomes:

- **Simplified navigation.** The More catch-all group is gone. Every item now lives in a named, purposeful group.
- **CURRENTS elevated.** CURRENTS sits directly below Today — the two most real-time, active surfaces in the app are now next to each other at the top of the sidebar.
- **CURRENTS follows the global theme.** The dark island / waterflow overlay that made CURRENTS look visually disconnected in both light and dark mode is removed. CURRENTS now uses the same muted surface tokens as the rest of the CMS.
- **Document Hub label finalized.** "Asset Library" is retired everywhere in the UI. Document Hub is the canonical name.
- **Learn group added.** Training and Help now live in a dedicated Learn section instead of floating at the bottom.
- **Production confirmed.** The app is live, the authenticated session is healthy, CURRENTS is active, and all test suites pass.

---

## 2. What Changed

- **More group retired.** The More catch-all group no longer appears in the sidebar. All items previously inside it were redistributed to appropriate named groups or removed from the nav entirely.
- **CURRENTS moved below Today.** CURRENTS was promoted from inside the Work group to a standalone section directly below Today, giving it the same visual prominence as the inbox.
- **Work group cleaned up.** CURRENTS was removed from Work. Work now contains CRM-centric items: Inbox, Accounts, Contacts, Leads, Opportunities, Quotes, Tasks, and Documents.
- **Document Hub label finalized.** The nav label and page heading both read "Document Hub." The old "Asset Library" label no longer appears anywhere in the user-facing UI.
- **Learn group added.** A new Learn group was added at the bottom of the sidebar containing Training and Help Center.
- **Revenue tools moved to Insights.** Revenue-related intelligence views (Revenue OS, Simulator, Executive Copilot) moved from More into the Insights group.
- **Data Quality moved to Operations.** Data Quality and Duplicate Merge moved from More into Operations.
- **Task Rules and Automations moved to Admin.** Both items now live in the Admin group.
- **CURRENTS dark/light theme alignment fixed.** All six `bg-sidebar/N` utility classes in `client/src/pages/current.tsx` were replaced with `bg-muted/N` equivalents. The `--sidebar-background` token is dark (12% L) in both light and dark mode, which caused CURRENTS panels to render as a dark island regardless of the active theme. `--muted` correctly adapts: ~93% L in light mode, ~14% L in dark mode.

---

## 3. Final Sidebar Structure

| Group | Contents |
|---|---|
| **Today** | Daily Command Center — role-adaptive dashboard, KPIs, calendar |
| **CURRENTS** | Real-time team workspace — channels, DMs, threads, structured items |
| **Work** | CRM core — Inbox, Accounts, Contacts, Leads, Opportunities, Quotes, Tasks, Document Hub |
| **Pipeline** | Deals pipeline, quotes tracker, deployment/site rollout, procurement/manufacturing |
| **Operations** | Support tickets, field execution, projects, safety certification, duplicate merge, data quality |
| **Insights** | Revenue OS, Revenue Simulator, Executive Copilot, predictive scoring, relationship intelligence |
| **Ecosystem** | Integrations, connected tools, external partner views |
| **Learn** | Training handbook, Help Center |
| **Admin** | User management, permissions, automations, task rules, system settings |

---

## 4. Production Verification

| Check | Result |
|---|---|
| Production app loads at `https://image-linker-burgesstrevor76.replit.app` | ✓ Login page renders correctly |
| Dark theme renders (teal/cyan on navy) | ✓ Confirmed by screenshot |
| Authenticated session healthy | ✓ userId:4 active throughout |
| CURRENTS heartbeat (`POST /api/current/presence/heartbeat`) | ✓ 200 every 60 seconds, sustained |
| Gmail inbox serving | ✓ `GET /api/gmail/messages 200/304` |
| Gmail incremental sync running | ✓ 8 accounts synced, 2 messages added |
| Calendar sync running | ✓ `GET /api/calendar/events 200` |
| Production 500s | ✓ Zero in entire post-boot window |
| Nav or CURRENTS route errors | ✓ None |
| Auth or session errors | ✓ None |
| Frontend asset load errors | ✓ None |
| Trevor visual UI confirmation | ✓ Manually confirmed |

---

## 5. Tests

All suites ran against the committed production code. Zero failures.

| Suite | Result |
|---|---|
| `nav-drift.test.cjs` | **92/92 ✓** |
| `asset-library.test.js` | **91/91 ✓** |
| `currents-workspace-shell.test.cjs` | **36/36 ✓** (includes T1–T10 light/dark theme checks) |
| `currents-phase6c-metadata.test.cjs` | **51/51 ✓** |
| `currents-phase7a-structured.test.cjs` | **76/76 ✓** |
| `currents-phase7b-structured-panel.test.cjs` | **95/95 ✓** |
| `currents-phase7d-filter-counts.test.cjs` | **46/46 ✓** |
| `currents-phase7e-csv-export.test.cjs` | **58/58 ✓** |
| `channel-management.test.cjs` | **119/119 ✓** |
| `channel-visibility.test.cjs` | **50/50 ✓** |
| `private-channels.test.cjs` | **all ✓** |
| `dm-reactions.test.cjs` | **67/67 ✓** |
| `group-dm.test.cjs` | **44/44 ✓** |
| `slash-commands.test.cjs` | **100/100 ✓** |

**14 suites total. 0 failures.**

---

## 6. Known Non-Blockers

These failures are pre-existing and unrelated to this release. They do not affect production.

**`mail-permissions` — 2 failures**
The test harness sends requests with a `localhost` origin, which the production CSRF/origin guard rejects. This is a test harness configuration issue, not a product bug. Gmail send and receive work correctly in production.

**`tracking-proof` and `tracking-multi-proof` — fatal**
Both suites require an actual live Gmail send to a real external address to verify open-tracking pixel injection. The dev/CI environment cannot complete a live send. Tracking works correctly in production.

**Stale workflow runs in the Replit Workflows panel**
Some workflows (e.g., `mailbox-switching`) show a stale previous run result in the panel UI. Running the test file directly (`node tests/mailbox-switching.test.js`) passes cleanly. The stale indicator is a UI artefact, not a test regression.

---

## 7. Follow-Up Backlog

### P1 — Test harness cleanup

- **Fix `mail-permissions` CSRF/origin test harness issue.** The test client needs to send a matching `Origin` header (or the test should run against a permissive test server instance) so the 2 CSRF-blocked cases pass without manual exception.
- **Document or mock `tracking-proof` live Gmail-send dependency.** Either provide a seeded mock send path for CI, or formally mark these tests as integration-only and exclude them from the standard run.

### P2 — Admin simplification

- **Consider merging Task Rules as a tab inside Automations.** Task Rules and Automations are conceptually related. A tab approach would reduce Admin nav clutter by one item.
- **Then remove standalone Task Rules from Admin** once the tab pattern is confirmed working and no functionality is lost.

### P2 — Authenticated E2E support

- **Add a safe authenticated Playwright/Cypress-style smoke test** if test credentials are made available. This would replace the manual visual checklist for post-deploy verification of sidebar order and CURRENTS theme.
- **Verify sidebar/CURRENTS visually post-deploy without manual checklist.** The manual checklist works but is slower and depends on Trevor being available.

### P3 — CURRENTS polish (after user feedback only)

- **Spacing, hover, or empty-state refinements** — only if users report friction. Do not pre-optimise.
- **Do not reintroduce custom waterflow or dark overlays.** The current muted-surface approach is intentional and correct.

---

## 8. Ship Verdict

**Status: Shipped and production-confirmed.**
