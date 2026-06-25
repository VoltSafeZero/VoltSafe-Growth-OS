# VoltSafe CMS Onboarding Videos — Hosting Guide

This guide explains how to take a recorded onboarding video from raw `.webm` capture
all the way to a hosted URL that lights up the "Watch Video" button inside the app.

---

## Hosting options

| Platform | Best for | Cost | Privacy control |
|----------|---------|------|-----------------|
| **Vimeo (unlisted)** | ⭐ **Recommended** — clean embeds, custom thumbnails, no ads | Free tier available | Unlisted link |
| **YouTube (unlisted)** | Free, auto captions, universal playback | Free | Unlisted link |
| **HubSpot** | Embedding in onboarding email sequences | Paid | Portal-gated |
| **Loom** | Quick async sharing, built-in viewer, comment threads | Free tier available | Link-based |
| **Self-hosted / local** | Dev/internal use only | Free | File-system |

### Recommended choice for VoltSafe

**Vimeo unlisted** is the preferred platform because:
- No VoltSafe branding replaced by YouTube/Loom chrome
- Clean embeds without ads or "related video" rabbit holes
- Unlisted links are safe to paste into the CRM or email
- Vimeo preserves colour fidelity for screen recordings

---

## Step-by-step: raw recording → hosted URL

### 1. Export a final MP4

Take the raw `.webm` from `onboarding-videos/outputs/raw/` into your video editor.

Recommended tools:
- **Descript** — transcription-driven editing; just cut the bad takes, add captions
- **Screen Studio** — polished zoom effects and cursor animations
- **DaVinci Resolve** — free, professional colour grading

Export settings:
- Format: **H.264 MP4**
- Resolution: **1920 × 1080** (or match your recording resolution)
- Frame rate: match source (usually 30 fps)
- Audio: **AAC 44.1 kHz**, -14 LUFS loudness

Save the final file as:

```
onboarding-videos/outputs/final/[slug].mp4
```

Following the slug convention:

```
01-dashboard-overview.mp4
02-leads-accounts-contacts.mp4
03-marina-lead-pipeline.mp4
04-voltsafe-mail-overview.mp4
05-ai-email-generator.mp4
06-account-intelligence-view.mp4
```

---

### 2. Upload to Vimeo (recommended)

1. Log in to **vimeo.com**
2. Click **New video → Upload**
3. Select your `.mp4` file
4. Set privacy to **"Only people with the private link"** (unlisted)
5. Title the video using this convention:

   ```
   VoltSafe CMS — 01 Dashboard Overview
   VoltSafe CMS — 02 Leads, Accounts & Contacts
   VoltSafe CMS — 03 Marina Lead Pipeline
   VoltSafe CMS — 04 VoltSafe Mail Overview
   VoltSafe CMS — 05 AI Email Generator
   VoltSafe CMS — 06 Account Intelligence View
   ```

6. Add to a private **"VoltSafe CMS Onboarding"** showcase for organisation
7. Copy the video URL (e.g. `https://vimeo.com/123456789/abc123`)

---

### 3. Upload to YouTube (alternative)

1. Log in to **studio.youtube.com**
2. Click **Create → Upload videos**
3. Select your `.mp4` file
4. Set visibility to **"Unlisted"**
5. Title using the same convention as Vimeo above
6. Copy the video URL (e.g. `https://youtu.be/abc123`)

---

### 4. Upload to Loom (alternative)

1. Log in to **loom.com**
2. Click **New video → Upload a video**
3. Select your `.mp4` file
4. Set privacy to **"Anyone with the link"** or your workspace setting
5. Copy the Loom share URL

---

### 5. Paste the URL into the app

Open `client/src/data/training-hub.ts` and update the matching video entry:

```ts
{
  id: "01",
  number: "01",
  title: "Dashboard Overview",
  // ...
  status: "hosted",                               // ← change this
  videoUrl: "https://vimeo.com/123456789/abc123", // ← add this
  hostedProvider: "vimeo",                        // ← add this
  rawVideoPath: "onboarding-videos/outputs/raw/01-dashboard-overview.webm",
  finalVideoPath: "onboarding-videos/outputs/final/01-dashboard-overview.mp4",
  storyboardPath: "onboarding-videos/storyboards/01-dashboard-overview.md",
},
```

The "Watch Video" button in the Training Hub (`/training`) will enable automatically.

---

## Status values — what each means

| Status | When to use | Button shown |
|--------|-------------|-------------|
| `not_recorded` | Script exists, no recording yet | "Not Recorded Yet" (disabled) |
| `raw_recorded` | `.webm` raw capture done, editing needed | "Raw Recording Ready" (disabled) |
| `edited` | Final `.mp4` exported, not yet uploaded | "Final MP4 Ready" (disabled) |
| `hosted` | Live URL available in `videoUrl` | **"Watch Video" (enabled)** |
| `needs_update` | UI changed significantly since recording | "Needs Update" (disabled) |

---

## When to mark a video as `needs_update`

Mark `status: "needs_update"` when:

- A screen or workflow shown in the video has been redesigned
- A feature covered in the video no longer works the way described
- New critical features were added that the video doesn't mention
- The navigation shown is out of date

To re-record, run the matching npm script:

```bash
npm run video:dashboard   # video 01
npm run video:leads       # video 02
npm run video:pipeline    # video 03
npm run video:mail        # video 04
npm run video:ai-email    # video 05
npm run video:account     # video 06
```

Then re-export, re-upload, and update `videoUrl` + `status` as described above.

---

## Video naming convention

Use this exact title format on every hosting platform:

```
VoltSafe CMS — [NN] [Title]
```

Examples:

```
VoltSafe CMS — 01 Dashboard Overview
VoltSafe CMS — 02 Leads, Accounts & Contacts
VoltSafe CMS — 03 Marina Lead Pipeline
VoltSafe CMS — 04 VoltSafe Mail Overview
VoltSafe CMS — 05 AI Email Generator
VoltSafe CMS — 06 Account Intelligence View
```

This makes it easy to find videos in your hosting dashboard and match them to storyboards.

---

## Storyboard reference

Each video has a matching storyboard in `onboarding-videos/storyboards/`:

| Video | Storyboard |
|-------|-----------|
| 01 Dashboard Overview | `onboarding-videos/storyboards/01-dashboard-overview.md` |
| 02 Leads, Accounts & Contacts | `onboarding-videos/storyboards/02-leads-accounts-contacts.md` |
| 03 Marina Lead Pipeline | `onboarding-videos/storyboards/03-marina-lead-pipeline.md` |
| 04 VoltSafe Mail Overview | `onboarding-videos/storyboards/04-voltsafe-mail-overview.md` |
| 05 AI Email Generator | `onboarding-videos/storyboards/05-ai-email-generator.md` |
| 06 Account Intelligence View | `onboarding-videos/storyboards/06-account-intelligence-view.md` |

---

## Quick checklist

- [ ] Edit recorded in Descript / Screen Studio / Resolve
- [ ] Final `.mp4` saved to `onboarding-videos/outputs/final/[slug].mp4`
- [ ] Uploaded to Vimeo (unlisted) with correct title convention
- [ ] `videoUrl` pasted into `client/src/data/training-hub.ts`
- [ ] `hostedProvider` set to `"vimeo"` (or correct platform)
- [ ] `status` set to `"hosted"`
- [ ] App reloaded — "Watch Video" button confirmed enabled at `/training`
