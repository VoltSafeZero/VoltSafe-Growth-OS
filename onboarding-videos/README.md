# VoltSafe CMS — Onboarding Video Recording System

Playwright-powered browser automation that records clean, repeatable walkthrough
videos of VoltSafe CMS for onboarding and training. Each script also doubles as a
**QA smoke test** — if a recording fails, a key user journey is likely broken.

---

## What videos are produced

| Script | npm command | Storyboard | What it covers |
|--------|-------------|-----------|----------------|
| `01-dashboard-overview.cjs` | `npm run video:dashboard` | `storyboards/01-dashboard-overview.md` | Full ecosystem tour: Dashboard, CRM, Mail, AI, Pipeline |
| `02-leads-accounts-contacts.cjs` | `npm run video:crm` | `storyboards/02-leads-accounts-contacts.md` | Leads list → lead profile → Accounts → Contacts |
| `03-marina-lead-pipeline.cjs` | `npm run video:pipeline` | `storyboards/03-marina-lead-pipeline.md` | Pipeline kanban, stage columns, opportunity cards |
| `04-voltsafe-mail-overview.cjs` | `npm run video:mail` | `storyboards/04-voltsafe-mail-overview.md` | Inbox, categories, message view, reply UI (no real send) |
| `05-ai-email-generator.cjs` | `npm run video:ai-email` | `storyboards/05-ai-email-generator.md` | AI-suggested email from account context (no real send) |
| `06-account-intelligence-view.cjs` | `npm run video:account` | `storyboards/06-account-intelligence-view.md` | Account profile deep-dive: timeline, people, notes |

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

The `.webm` file is saved to `onboarding-videos/outputs/raw/`.

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

```
onboarding-videos/outputs/
  raw/        ← Playwright saves .webm files here automatically
  final/      ← Place your polished .mp4 exports here after editing
  archive/    ← Move old recordings here before re-shooting
```

The `.webm` / `.mp4` files are gitignored (large binary files — host on Vimeo or
Google Drive). The folder structure is committed via `.gitkeep` files.

---

## Storyboards & voiceover scripts

Each video has a matching storyboard in `onboarding-videos/storyboards/`:

```
storyboards/
  01-dashboard-overview.md
  02-leads-accounts-contacts.md
  03-marina-lead-pipeline.md
  04-voltsafe-mail-overview.md
  05-ai-email-generator.md
  06-account-intelligence-view.md
```

Each storyboard contains:
- **Target audience** and **user outcome**
- **Step-by-step walkthrough** matching the Playwright script exactly
- **Suggested voiceover script** — read this while recording narration
- **On-screen callout text** — what the overlay labels display during recording
- **Key pause moments** — where to slow down so viewers can absorb the screen

Open the storyboard for a video before editing that video's script so the two stay in sync.

---

## How to turn raw `.webm` files into finished onboarding videos

The Playwright scripts produce **clean raw recordings** with visible training
callouts and section titles. Follow these steps to turn them into polished
onboarding videos ready for your Help Center or new-hire portal:

### Step 1 — Record the raw footage

```bash
npm run video:all
```

Raw `.webm` files appear in `onboarding-videos/outputs/raw/`.

### Step 2 — Import into your editor

Open each `.webm` in one of these tools:

| Tool | Best for | Notes |
|------|---------|-------|
| **Descript** | AI transcription + voiceover | Paste the storyboard script; Descript auto-syncs |
| **Screen Studio** | Beautiful screen recordings | Great for animated zoom/pan |
| **Loom** | Quick async sharing | Webcam overlay + auto-captions |
| **CapCut** | Budget-friendly full editor | Good subtitle generation |
| **Adobe Premiere / DaVinci Resolve** | Full editorial control | Use for executive-quality output |

### Step 3 — Add voiceover

Copy the **Suggested voiceover script** from the matching storyboard file.
Record narration using:
- Your own voice (most authentic)
- Descript's AI overdub / ElevenLabs for a consistent voice
- A professional VO artist for high-production final versions

### Step 4 — Add captions

Auto-captions are available in Descript, CapCut, and Loom.
For Premiere/Resolve, export the transcript and use the auto-caption plugin.

### Step 5 — Export as MP4

Export at **1440×900** (matches the recording viewport) or scale down to **1280×720**
for web hosting. Use H.264 for maximum compatibility.

Place the finished file in `onboarding-videos/outputs/final/`.

### Step 6 — Host and share

| Platform | Use case |
|----------|---------|
| **Vimeo (unlisted)** | Embedded in Help Center or sent to prospects |
| **YouTube (unlisted)** | Free hosting, great captions |
| **HubSpot** | Embedded in onboarding email sequences |
| **VoltSafe Help Center** | In-app training via `/help` |
| **Notion / Confluence** | Internal team wiki |

### Step 7 — Re-record when the UI changes

```bash
npm run video:all
```

The storyboard scripts stay in sync with the app. Any time a major flow changes,
re-run the scripts and re-narrate just the changed sections.

---

## Visual training callouts (demo mode overlay)

When demo mode is active, the app renders a lightweight callout overlay.
Scripts use these helpers to show training labels during recording:

| Helper | What it does |
|--------|--------------|
| `showCallout(page, text)` | Shows a teal bubble at the bottom of the screen |
| `hideCallout(page)` | Fades the bubble out |
| `stepTitle(page, title)` | Flashes a full-screen section title for ~2.5 s |
| `pauseForNarration(page, ms)` | Pauses for narrator to speak (default 3.5 s) |

These overlays only appear when `localStorage.voltSafeDemoMode === "1"`.
They have **no effect in production**.

---

## How demo mode protects sensitive data

When any recording script runs, it calls `enableDemoMode()` which sets
`localStorage.voltSafeDemoMode = "1"` in the browser.

This activates three protections:

1. **Visible banner** — A cyan stripe appears at the top of every screen:
   `◉ DEMO MODE — No real emails will be sent · No data will be modified`

2. **Email send blocked** — The Send button shows a toast notification instead
   of sending a real email. No outbound traffic.

3. **No destructive actions** — Scripts never call delete/archive/mutate APIs.
   All navigation is read-only browsing.

The demo mode flag is stored in `localStorage` and clears automatically when
the browser context closes (end of each recording).

---

## How these scripts double as QA smoke tests

Each script uses `safeClick()` and explicit `waitForSelector()` calls. If a
navigation step fails — for example because a route changed, a page crashed, or
a key element was removed — the script exits with **code 1** and prints a clear
message:

```
[02] FAILED: safeClick failed: could not find or click
"[data-testid^='row-lead-']" within 10000ms.
This may indicate a navigation step is broken.
```

Run all scripts in CI and treat any non-zero exit as a broken user journey.

---

## Editing a script

Each script in `onboarding-videos/scripts/` is a standalone Node.js file.
Shared helpers live in `onboarding-videos/scripts/helpers.cjs`.

| Helper | What it does |
|--------|--------------|
| `login(page, base, email, pw)` | Navigates to `/login`, fills form, waits for auth |
| `enableDemoMode(page)` | Sets localStorage flag, reloads, confirms banner |
| `waitForAppReady(page)` | Waits for DOM + 800 ms settling time |
| `safeClick(page, selector)` | Click with clear failure message if element missing |
| `pauseForViewer(ms)` | Short pause so viewers can read the screen |
| `pauseForNarration(page, ms)` | Longer pause sized for a narrator (default 3.5 s) |
| `showCallout(page, text)` | Show a teal training label at the bottom |
| `hideCallout(page)` | Hide the training label |
| `stepTitle(page, title)` | Flash a section title overlay for ~2.5 s |
| `saveVideoWithReadableName(page, name)` | Rename UUID video file → `outputs/raw/name.webm` |
