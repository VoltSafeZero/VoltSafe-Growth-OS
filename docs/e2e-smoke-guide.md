# Authenticated E2E Smoke Test Guide

## Overview

`tests/e2e-smoke.test.js` is a Playwright-based authenticated smoke test
that verifies the logged-in sidebar structure and CURRENTS UI after the
navigation + P2 admin simplification release.

It is **source-read safe** — it skips cleanly when credentials are absent,
so normal `npm run test:grep` and CI readiness reports are not broken.

---

## Why credentials are required

The VoltSafe Growth OS has no public pages beyond `/login`. Every route
that needs verification (sidebar, CURRENTS workspace) is behind session
auth. There is no bypass, and none should be added.

The test accepts credentials via environment variables only. No credentials
are hardcoded. No auth is weakened.

---

## Running locally (dev server must be running)

```bash
# Start the app first (separate terminal):
npm run dev

# Then run the smoke test:
E2E_BASE_URL=http://localhost:5000 \
E2E_EMAIL=admin@example.com \
E2E_PASSWORD=yourpassword \
node tests/e2e-smoke.test.js
```

### Optional env vars

| Variable | Default | Description |
|---|---|---|
| `E2E_BASE_URL` | (required) | App URL, e.g. `http://localhost:5000` |
| `E2E_EMAIL` | (required) | Login email |
| `E2E_PASSWORD` | (required) | Login password |
| `E2E_HEADLESS` | `true` | Set to `false` to watch the browser |
| `E2E_SLOW_MO` | `0` | Milliseconds between Playwright actions (useful for watching) |
| `E2E_TIMEOUT_MS` | `15000` | Per-element wait timeout |

### Watching the browser (useful for debugging):

```bash
E2E_BASE_URL=http://localhost:5000 \
E2E_EMAIL=admin@example.com \
E2E_PASSWORD=yourpassword \
E2E_HEADLESS=false \
E2E_SLOW_MO=400 \
node tests/e2e-smoke.test.js
```

---

## Running against production

```bash
E2E_BASE_URL=https://yourapp.replit.app \
E2E_EMAIL=admin@example.com \
E2E_PASSWORD=yourpassword \
node tests/e2e-smoke.test.js
```

Production smoke runs read-only — no messages sent, no data mutated.

---

## Skip behavior

When any of `E2E_BASE_URL`, `E2E_EMAIL`, or `E2E_PASSWORD` is missing:

```
⏭  skipped: requires E2E_BASE_URL, E2E_EMAIL, and E2E_PASSWORD
```

Exit code is `0` — does not break CI or readiness reports.

---

## What it verifies (10 sections)

| Section | Checks |
|---|---|
| 1. Login | Email + password inputs, Sign In button, sidebar appears after login |
| 2. Top-level sections | Today, CURRENTS, Work, Learn all present |
| 3. Retired entries absent | More NOT present; "Asset Library" NOT in sidebar; Task Rules NOT standalone |
| 4. Ordering | Today → CURRENTS → Work (top to bottom by DOM Y position) |
| 5. Learn items | Training and Help items visible after expanding Learn |
| 6. Work items | Document Hub visible after expanding Work |
| 7. Admin items | Automations present (admin accounts only); Task Rules NOT standalone |
| 8. CURRENTS route | `/current` loads, `currents-workspace-shell` testid visible, no error boundary |
| 9. Theme smoke | Page body has rendered content (not blank) |
| 10. Deep-link | `/automations?tab=task-rules` loads without redirect to login or blank screen |

---

## What it does NOT do

- Does not send messages in CURRENTS
- Does not mutate CRM data
- Does not test Gmail / mail-permissions / tracking
- Does not verify pixel-perfect visual layout (use manual review for that)
- Does not automate theme switching (leave as manual if theme toggle selector changes)

---

## Testid reference (key selectors used)

| Element | `data-testid` |
|---|---|
| Login email input | `input-login-email` |
| Login password input | `input-login-password` |
| Login submit button | `button-login` |
| Sidebar home link | `link-sidebar-home` |
| Today section | `nav-section-today` |
| CURRENTS section | `nav-section-currents` |
| Work section | `nav-section-work` |
| Learn section | `nav-section-learn` |
| Admin section | `nav-section-admin` |
| Training item | `nav-training` |
| Help item | `nav-help` |
| Document Hub item | `nav-document-hub` |
| Automations item | `nav-automations` |
| CURRENTS shell | `currents-workspace-shell` |

---

## Known limitations

- **Section items only appear after expanding the section.** The test clicks
  each section to expand it before asserting sub-items. If the app ever
  changes to always-expanded sections, the click is harmless.

- **Theme visual verification is manual.** The test only checks the page is
  not blank after navigation. Pixel-accurate light/dark/demon theme checking
  requires manual sign-off or a dedicated screenshot-diff tool.

- **Admin checks are conditional.** If non-admin credentials are used, the
  Admin section is not visible and those checks are skipped with a note.
  Use an admin or master_admin account to cover all assertions.

- **Production latency.** Against production, increase `E2E_TIMEOUT_MS` if
  cold-start or network latency causes intermittent selector timeouts:
  ```bash
  E2E_TIMEOUT_MS=30000 ...
  ```
