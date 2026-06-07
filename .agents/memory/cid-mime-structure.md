---
name: CID MIME Structure (Gmail canonicalization)
description: The exact MIME layout for CID inline images that survives Gmail API canonicalization; diagnostic tools.
---

## The Rule

`buildMimeRaw` in `server/gmail.ts` — Cases B and C — must produce `text/html` as the **direct first child** of `multipart/related`. There must be **no** `multipart/alternative` wrapper inside `multipart/related`.

**Case B (CID images, no real attachments) — ROOT is multipart/related:**
```
multipart/related; type="text/html"   ← ROOT
  text/html; charset=UTF-8            ← DIRECT first child (NO alternative wrapper)
  image/png; name="logo.png"
    Content-ID: <vsigNNNabc>
    Content-Disposition: inline; filename="logo.png"
  image/jpeg; name="watch-demo.jpg"
    Content-ID: <vsigNNN2abc>
    Content-Disposition: inline; filename="watch-demo.jpg"
```

**Case C (CID images + real attachments):**
```
multipart/mixed
  multipart/related; type="text/html"   ← first child (NO alternative inside)
    text/html; charset=UTF-8            ← DIRECT
    image/* CID parts …
  application/pdf; name="doc.pdf"       ← real attachments under mixed
    Content-Disposition: attachment
```

**Cases A and D (no CID images) are unchanged:**
```
multipart/alternative  (or multipart/mixed → multipart/alternative)
  text/plain
  text/html
```

## Why Gmail Canonicalization Breaks the Old Structure

Gmail's `users.messages.send` API canonicalizes `related→[alternative→[plain,html],CID]` into a **flat** `multipart/mixed` where CID parts become siblings of `text/html` instead of being inside `multipart/related`. This causes:
- `X-Attachment-Content-Disposition` header added by Gmail
- CID renamed from `vsig...` to Gmail's internal `ii_...` format
- Images appear as attachment cards instead of rendering inline in Apple Mail / Outlook

The only structure that survives is `related→[text/html DIRECT, CID parts]`.

**Note:** Gmail renaming `vsig...` CIDs to `ii_...` in delivered/stored messages is **always** expected — it's Gmail's internal format. The structural break (related→mixed) is the actual problem and only occurs when `multipart/alternative` is the first child.

## Runtime Assert

`sendEmail` (in `server/gmail.ts`) has a runtime assertion that fires when:
- `inlineImages.length > 0` AND
- Root MIME is not `multipart/related` (or `multipart/mixed` with `multipart/related` as first child within 600 chars)

Dev: throws `Error`. Prod: `console.error`. Catches future `buildMimeRaw` regressions before the Gmail API call.

## CID Format

CID values must be **purely alphanumeric** — no `@`, no file extensions, no slashes, no spaces.  
Current format: `vsig${cidIndex}${Date.now().toString(36)}` (e.g., `vsig0lbtykq94j`)

## CID HTML Rewrite — Sig Marker Coupling

`extractCtaInlineImages` has two scan paths; the RIGHT path depends on `<!--vs-sig-start-->` markers being present in the HTML it receives:

- **Sig path** (markers present): scans `src="FULLURL"` inside the sig section → stores full URL as map key → rewrite regex matches
- **Legacy path** (no markers): scans for `/assets/cta/` path pattern → stores full `src` value as map key (fixed; old code stored bare filename which broke absolute URLs)

**Critical gotcha:** `wrapSignatureCtaLinks` (in `signature-cta-tracker.ts`) used to STRIP the sig markers when reassembling the HTML. This caused the legacy path to always run, and when signature image `src` values were absolute URLs (e.g. `https://image-linker-xxx.replit.app/assets/cta/logo.png`), the old bare-filename key never matched → CID part created but HTML not rewritten → orphaned attachment card.

**Fix:** `wrapSignatureCtaLinks` now re-injects markers: `const sigPart = split ? SIG_START + wrappedSig + SIG_END : "";`

**Integrity check:** `extractCtaInlineImages` logs `[sig-cid] INTEGRITY FAIL` if any CID in `inlineImages` has no `cid:` reference in the returned HTML — catches future regressions immediately.

## Diagnostics

- `buildMimeRawDebug(from, to, subject, body, ...)` — exported from `server/gmail.ts`; returns raw decoded MIME string (not base64url).
- `tests/mime-output.test.cjs` (45 assertions) — calls `buildMimeRawDebug` via tsx subprocess and asserts on actual MIME structure for Cases A-D. This is the **authoritative** regression test; source-grep tests alone are insufficient.
- `scripts/test-mime-generate.ts` — tsx helper used by the above test to produce MIME output JSON.
- `POST /api/dev/mime-tree` (admin, dev-only) — accepts `{ body, subject }` and returns `{ mimeTree, rawMime, inlineImageCount }` without sending.
- `sendEmail` logs `[mime-tree]` with the Content-Type/boundary structure for every outgoing email (dev only).
- `[sig-cid]` console.error fired when a signature image fails to load from disk or fetch.
