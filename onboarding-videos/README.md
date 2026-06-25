# VoltSafe CMS — Onboarding Video Recording System

Playwright-powered browser automation that records clean, repeatable walkthrough
videos of VoltSafe CMS for onboarding and training. Each script also doubles as a
**QA smoke test** — if a recording fails, a key user journey is likely broken.

---

## What videos are produced

| Script | npm command | What it covers |
|--------|-------------|----------------|
| `01-dashboard-overview.cjs` | `npm run video:dashboard` | Full ecosystem tour: Dashboard, CRM, Mail, AI, Pipeline |
| `02-leads-accounts-contacts.cjs` | `npm run video:crm` | Leads list → lead profile → Accounts → Contacts |
| `03-marina-lead-pipeline.cjs` | `npm run video:pipeline` | Pipeline kanban, stage columns, opportunity cards |
| `04-voltsafe-mail-overview.cjs` | `npm run video:mail` | Inbox, categories, message view, reply UI (no real send) |
| `05-ai-email-generator.cjs` | `npm run video:ai-email` | AI-suggested email from account context (no real send) |
| `06-account-intelligence-view.cjs` | `npm run video:account` | Account profile deep-dive: timeline, people, notes |

---

## Quick start

### 1. Make sure the app is running

```bash
npm run dev
```

The app must be live at `http://localhost:5000` (or set `APP_URL`).

### 2. Run one video

```bash
npm run video:dashboard
```

The `.webm` file is saved to `onboarding-videos/outputs/`.

### 3. Run all six videos

```bash
npm run video:all
```

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `APP_URL` | `http://localhost:5000` | Base URL of the running app |
| `DEMO_USER_EMAIL` | `trevor@voltsafe.com` | Login email for recording session |
| `DEMO_USER_PASSWORD` | `alberni1444` | Login password |

Set them in your shell or a local `.env` file (not committed):

```bash
export APP_URL=https://your-replit-preview-url.replit.dev
export DEMO_USER_EMAIL=demo@voltsafe.com
export DEMO_USER_PASSWORD=yourpassword
npm run video:all
```

---

## Where output files are saved

All recordings are saved to:

```
onboarding-videos/outputs/
  01-dashboard-overview.webm
  02-leads-accounts-contacts.webm
  03-marina-lead-pipeline.webm
  04-voltsafe-mail-overview.webm
  05-ai-email-generator.webm
  06-account-intelligence-view.webm
```

The folder has a `.gitkeep` so it exists in the repo. The `.webm` files are
gitignored (they are large binary files — store them in Google Drive, Vimeo, etc.).

---

## How demo mode protects sensitive data

When any recording script runs, it calls `enableDemoMode()` which sets
`localStorage.voltSafeDemoMode = "1"` in the browser.

This activates three protections:

1. **Visible banner** — A cyan stripe appears at the top of every screen:
   `◉ DEMO MODE — No real emails will be sent · No data will be modified`
   This makes recordings clearly identifiable as demos.

2. **Email send blocked** — Clicking the Send button in VoltSafe Mail shows a
   toast notification instead of sending a real email. No outbound traffic.

3. **No destructive actions** — Scripts never call delete/archive/mutate APIs.
   All navigation is read-only browsing.

The demo mode flag is stored in `localStorage` and persists across page navigations
within the same browser session. It is cleared automatically when the browser context
closes (end of each recording).

---

## How these scripts double as QA smoke tests

Each script uses `safeClick()` and explicit `waitForSelector()` calls. If a
navigation step fails — for example because a route changed, a page crashed, or
a key element was removed — the script exits with **code 1** and prints a clear
message explaining which step failed:

```
[02] Script failed: safeClick failed: could not find or click
"[data-testid^='row-lead-']" within 10000ms.
This may indicate a navigation step is broken.
```

You can run all scripts in CI and treat any non-zero exit as a broken user journey.

---

## Editing a script

Each script in `onboarding-videos/scripts/` is a standalone Node.js file.
The shared helpers are in `onboarding-videos/scripts/helpers.cjs`.

Key helpers:

| Helper | What it does |
|--------|--------------|
| `login(page, base, email, pw)` | Navigates to `/login`, fills form, waits for auth |
| `enableDemoMode(page)` | Sets localStorage flag, reloads, confirms banner |
| `waitForAppReady(page)` | Waits for DOM + 800ms settling time |
| `safeClick(page, selector)` | Click with clear failure message if element missing |
| `pauseForViewer(ms)` | Intentional pause so viewers can read the screen |
| `saveVideoWithReadableName(page, name)` | Renames Playwright UUID video file to readable name |

---

## Post-production workflow

Playwright produces the **raw browser recording**. For polished onboarding videos:

| Layer | Recommended tool |
|-------|-----------------|
| Voiceover | ElevenLabs, Descript, Loom |
| Captions | Descript, CapCut |
| Final polish | Screen Studio, Descript, Premiere |
| Hosting | Vimeo (unlisted), YouTube (unlisted), Help Center |

Regenerate the raw recording any time the UI changes — no reshoot needed.
