---
name: CID inline image viewer fixes
description: Root causes and fixes for broken inline CID images in VoltSafe Mail viewer (read path)
---

## Root cause 1 — `isInline` wrongly set to `false` for named CID parts

`extractAttachments` in `email-parser.ts` used `isInline = isInlineDisp || (!hasFilename && !!contentId)`.
Our send pipeline sets `Content-Type: image/png; name="sig-image-1.png"` (for client compat) but omits
`Content-Disposition` on CID parts (Apple Mail fix). So `hasFilename=true`, `isInlineDisp=false` → `isInline=false`.
The part was stored to `email_attachments` with `is_inline=false` and shown as a downloadable attachment card.

**Fix:** `const isInline = isInlineDisp || !!contentId` — RFC 2392: any part with Content-ID is inline.

## Root cause 2 — `gmailMessageId` was undefined in MessageBody

`getLocalThread` serialised messages as `{ id: r.gmail_message_id, ... }` (no `gmailMessageId` field).
`ThreadMessage` type didn't include `gmailMessageId`. The `MessageBody` call at the render site used
`gmailMessageId={msg.gmailMessageId}` which was always `undefined`.
Result: the CID rewrite guard `if (gmailMessageId && ...)` never fired → `cid:xxx` URIs were left in HTML
→ DOMPurify stripped them → broken image icons.

**Fix:**
- `getLocalThread` now includes `gmailMessageId: r.gmail_message_id` on each message.
- `ThreadMessage` type has `gmailMessageId?: string`.
- MessageBody render site: `gmailMessageId={msg.gmailMessageId || msg.id}` (double safety).

## Root cause 3 — Attachment strip filter missed old DB rows

Existing `email_attachments` rows inserted before the parser fix had `is_inline=false` but `content_id` set.
The filter `!a.isInline` didn't exclude them.

**Fix:** filter changed to `!a.isInline && !a.contentId` (belt-and-suspenders for stale DB rows).

## Additional hardening

- CID rewrite regex also handles single-quoted `src='cid:...'` attrs (some rich-text editors emit these).

## Tests

`tests/cid-viewer.test.cjs` — 15 checks covering all three root causes + URL encoding + quote styles.
All 15 pass as of June 2026.

**Why:** The send pipeline intentionally omits Content-Disposition on CID parts (Apple Mail ghost attachment
fix). This means the parser can never rely on Content-Disposition to detect inline parts; Content-ID
alone is the authoritative signal per RFC 2392.
