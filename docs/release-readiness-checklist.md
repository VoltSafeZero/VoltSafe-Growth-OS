# VoltSafe CMS — Release Readiness Checklist

Use this checklist before and after every VoltSafe CMS deploy.
It standardizes how we verify changes and keeps releases fast, clear, and trustworthy.

---

## 1. Purpose

This checklist is the single shared reference for confirming that a VoltSafe CMS change is safe to ship and has landed cleanly in production.

Run it before pushing to production and again within 10 minutes of deploy.
The goal is not box-ticking — it is catching real problems early, before users hit them.

---

## 2. Pre-deploy checks

Run before triggering a production deploy.

- [ ] **Identify the changed feature area.** Name it explicitly (e.g. "sidebar nav", "CURRENTS theme", "Admin simplification").
- [ ] **Confirm scope.** Verify that only the intended files were touched. Run `git --no-optional-locks diff --name-only` and review.
- [ ] **Run relevant unit / source-grep tests.**
  - All changes: `npm run test:grep` (runs every `tests/*.test.cjs`).
  - Targeted: `node tests/<relevant>.test.js`.
- [ ] **Run `nav-drift.test.cjs` if any nav or sidebar file was changed.**
  ```bash
  node tests/nav-drift.test.cjs
  ```
  Expected: `92 passed, 0 failed`.
- [ ] **Run `currents-workspace-shell.test.cjs` if CURRENTS was touched.**
  ```bash
  node tests/currents-workspace-shell.test.cjs
  ```
  Expected: `36 passed, 0 failed`.
- [ ] **Run `mail-permissions.test.js` and `automations-tab-merge.test.cjs` if Admin or mail routes changed.**
  ```bash
  node tests/mail-permissions.test.js
  node tests/automations-tab-merge.test.cjs
  ```
- [ ] **Confirm live-only tests skip cleanly** — `tracking-proof` and `tracking-multi-proof` must exit 0 with a skip message when run without credentials (see §6).
- [ ] **Inspect workflow / server logs.** Open the running dev server log and confirm no new errors since the change.
- [ ] **Inspect browser console.** Load the changed route and confirm no new JS errors or failed network requests.
- [ ] **Confirm no unrelated code was touched.** If a file outside the stated scope changed, investigate before shipping.

---

## 3. Deploy checks

Run immediately after the deploy pipeline completes.

- [ ] **App boots without startup errors.**
  Check deployment logs — the server should reach `serving on port …` with no unhandled exceptions.
- [ ] **Cold-start noise settles within ~30 seconds.**
  Some healthcheck noise is expected before the server binds (see §6). Confirm logs stabilize.
- [ ] **No repeated 5xx errors.**
  Scan deployment logs for `500`, `502`, `503`. Isolated one-offs during cold-start are acceptable; repeated errors are not.
- [ ] **Key API routes return expected status.**
  A quick `curl` or browser dev-tools check of 2–3 routes relevant to the changed area (e.g. `GET /api/nav` or `GET /api/current/channels`) should return `200`.

---

## 4. Post-deploy smoke checks

Run within 10 minutes of a successful deploy, from a clean browser session.

- [ ] **Production URL loads** — the app homepage is reachable and renders.
- [ ] **Login works** — sign in with a real account and confirm the session lands on the dashboard.
- [ ] **Sidebar renders** — all expected sections are visible; no blank sidebar.
- [ ] **Changed feature loads** — navigate to the route or feature that was changed and confirm it works end-to-end.
- [ ] **No blank screens** — every route in the changed area renders content.
- [ ] **No browser console errors** — open DevTools and reload; confirm zero red errors.
- [ ] **No server errors** — check deployment logs during the smoke session; no new 500s.
- [ ] **Relevant route opens** — if a route was added or modified, confirm the URL resolves correctly.
- [ ] **Basic create/read action (if safe)** — perform a read-only or low-risk action in the changed area (e.g. open a record, expand a panel) to confirm real data loads.

---

## 5. Authenticated E2E smoke

`tests/e2e-smoke.test.js` is a Playwright-based authenticated smoke test.
It verifies sidebar structure, CURRENTS UI, and the Automations deep-link after login.

**Skip behavior:** if any required env var is missing, the test exits `0` with a skip message and does not break CI.

### Run locally (dev server must be running)

```bash
E2E_BASE_URL=http://localhost:5000 \
E2E_EMAIL=your@email.com \
E2E_PASSWORD=yourpassword \
node tests/e2e-smoke.test.js
```

### Run against production

```bash
E2E_BASE_URL=https://yourapp.replit.app \
E2E_EMAIL=your@email.com \
E2E_PASSWORD=yourpassword \
E2E_TIMEOUT_MS=30000 \
node tests/e2e-smoke.test.js
```

### Watch the browser (useful for debugging)

```bash
E2E_BASE_URL=http://localhost:5000 \
E2E_EMAIL=your@email.com \
E2E_PASSWORD=yourpassword \
E2E_HEADLESS=false \
E2E_SLOW_MO=400 \
node tests/e2e-smoke.test.js
```

**Full guide:** `docs/e2e-smoke-guide.md`

---

## 6. Known non-blockers

These items look like failures but are expected and safe to ignore.

| Situation | What it looks like | Safe to ignore? |
|---|---|---|
| `tracking-proof.test.js` exits with skip | `⏭  skipped: requires RUN_LIVE_GMAIL_PROOF=true` | ✓ Yes — requires live Gmail credentials |
| `tracking-multi-proof.test.js` exits with skip | Same skip message | ✓ Yes — same guard |
| Cold-start healthcheck noise | Deployment log shows transient errors before `serving on port …` | ✓ Yes — normal during container spin-up |
| Stale workflow panel | Panel shows a previous failure even though a direct `node tests/…` run passes | ✓ Yes — workflow panel caches old state; trust the direct run |
| `automations.test.js` "Login failed" | Live HTTP test requires the server to be running | ✓ Yes — pre-existing behavior; run after starting the dev server |

---

## 7. Release sign-off template

Copy this block into the release notes, PR description, or chat summary after every ship.

```
## Release Sign-Off

**Feature / area changed:**
<what was changed, e.g. "Sidebar nav cleanup — More group retired">

**Files changed:**
<list key files, e.g. client/src/lib/nav-config.ts, client/src/App.tsx>

**Tests run:**
- nav-drift.test.cjs         — XX/XX ✓
- currents-workspace-shell   — XX/XX ✓
- automations-tab-merge      — XX/XX ✓
- mail-permissions           — XX/XX ✓
- tracking-proof             — ⏭ skip (guarded) ✓
- tracking-multi-proof       — ⏭ skip (guarded) ✓
- e2e-smoke.test.js          — ⏭ skip (no creds) ✓  OR  XX passed ✓

**Known non-blockers:**
<any items from §6 that applied>

**Production URL checked:**
<yes / no — URL>

**Post-deploy result:**
<passed / issues found — describe>

**Ship verdict:**
✅ SHIPPED  /  ⚠️ HOLD — <reason>
```

---

## 8. Golden rule

> **Speed, clarity, and trust are release features.**
> If a change makes the app feel slower, more confusing, or harder to verify, it is not done.

A release is only finished when the change works correctly in production, the tests confirm it, and the next person on the team can understand exactly what shipped and why.
