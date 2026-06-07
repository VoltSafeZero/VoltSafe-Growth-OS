---
name: Signature CID image rules
description: Rules for CID-inlined signature images — MIME disposition, local storage, dedup guard
---

## Rules

**Content-Disposition: inline (no filename=)**
CID MIME parts for signature images MUST have `Content-Disposition: inline` with NO `filename=`
parameter. Apple Mail 16+ (Ventura/Sonoma) treats CID parts without any disposition as both
inline (renders at `<img>`) AND a named attachment card / full-size mobile append.
Verified in `server/gmail.ts` `inlineParts()`.

**Local /assets/cta/ storage for all sig images**
All images in signatures (Watch Demo CTA, VoltSafe logo) MUST be stored as local files in
`uploads/cta-assets/` and referenced in sig HTML as `/assets/cta/<filename>`. This lets
`extractCtaInlineImages` use the fast path (disk read) rather than the slow HTTP fetch path,
which can time out for external URLs (e.g. voltsafe.com WordPress). The fast path regex
`/\/assets\/cta\/([^"'?#\s]+)/` matches both relative and absolute URLs that contain `/assets/cta/`.

**Stale sig section strip (send + scheduled paths)**
Before appending the server-assembled sig section to the body, strip any existing
`<!--vs-sig-start-->...<!--vs-sig-end-->` block from the body (handles saved-draft case
where the frontend body already contains an old sig section).
Pattern: `cleanBody.replace(/<!--vs-sig-start-->[\s\S]*?<!--vs-sig-end-->/gi, "")`

**Filename-based dedup guard**
After assembling `bodyWithSig`, collect all image filenames from inside the sig section
and strip any `<img>` tags outside the sig section whose filename matches. Prevents a
Watch Demo or logo img from appearing twice when the body had a reference outside the sig markers.

**max-width:100%;height:auto on all CTA images**
`wrapHtmlWithCtaAsset`, the legacy `_ctaHtmlBlock` map, and the scheduled `_sh` map
all use `max-width:100%;height:auto` (NOT `max-width:${w}px`). The `width="N"` HTML
attribute still controls pixel width for clients that ignore CSS.

**Why:**
Remote URLs in sig images break on desktop Apple Mail (blocks remote images). Fixed px
max-width breaks responsive display on mobile. CID without Content-Disposition creates
both an inline render AND a downloadable attachment in Apple Mail.

## Gmail API MIME Canonicalization Bug

Gmail's API (`users.messages.send` with raw MIME) canonicalizes the layout:
  multipart/alternative > multipart/related > [text/html, CID images]
into:
  multipart/mixed > [multipart/alternative > [text/plain, text/html], CID images (Content-Disposition: attachment)]

The Gmail API adds `X-Attachment-Content-Disposition: inline` to preserve original intent,
but email clients (Apple Mail, Outlook) use the standard `Content-Disposition` header which
now says `attachment`, causing the images to render as download cards.

**Fix:** Set `multipart/related; type="text/html"` as the ROOT (not nested inside alternative).
Gmail preserves this layout and does not re-canonicalize it.
