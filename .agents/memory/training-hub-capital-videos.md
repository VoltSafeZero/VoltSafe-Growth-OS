---
name: Training Hub video numbering and hosting pipeline
description: How playlist video numbers, hosted status, and access restriction work in the CMS Training Hub, and gotchas when adding a new playlist.
---

The Training Hub (`client/src/data/training-hub.ts` + `client/src/pages/training-hub.tsx`) drives video ordering purely from each video's `number` field (not array index and not per-playlist restart) — new playlists appended after existing ones must continue the global sequence (e.g. 07-11), not restart at 01.

A video is auto-promoted to "hosted" status client-side once its `finalVideoPath` filename is found on disk via `GET /api/training/video-status` — no manual status flip is needed once `npm run training:convert` (ffmpeg, `scripts/convert-training-videos.ts`) produces the mp4 from a Playwright-recorded `.webm` in `onboarding-videos/outputs/raw/`.

**Why:** avoids a second manual publishing step and keeps "hosted" as a derived, always-accurate fact instead of stored state that can drift from the real files on disk.

**How to apply:** when adding a new training playlist/video, (1) create a recording script under `onboarding-videos/scripts/` using `helpers.cjs` (`launchBrowser()` uses the system Nix Chromium — the bundled Playwright Chromium is broken in this environment, missing `libglib-2.0.so.0`), (2) run it, (3) run the ffmpeg conversion, (4) just set `rawVideoPath`/`finalVideoPath`/`status: "raw_recorded"` and correct continuing `number` in the manifest — do not hand-roll a "hosted" flag.

**Gotcha:** the app route for this page is `/training`, not `/training-hub`.

**Gotcha:** restricting a playlist/video via `restrictedToEmails` in the manifest only gates the *frontend* Learn tab; if the feature it documents (e.g. Capital module) also has a server-side allowlist (`CAPITAL_ALLOWED_EMAILS` in `server/routes-capital.ts`), keep both lists in sync, and verify the target user's account actually exists in the dev DB with that exact email — some named roles (e.g. "Scott") may be referenced in seed/allowlist code without ever having been seeded as an actual login-able user if the users table was already non-empty when that seed entry was added.
