---
name: CTA CID Quote Compatibility
description: All src= regex patterns in the CTA CID inlining pipeline must handle single- and double-quoted attributes.
---

## The rule
Every `src=` scanner and rewriter in the CID inlining pipeline must handle both `src="..."` and `src='...'`.

**Why:** Rich-text editors and HTML email templates occasionally emit single-quoted attribute values. A double-quote-only regex `\bsrc="([^"]+)"` silently skips them, leaving absolute CTA URLs unconverted — the FINAL-CID-GATE then fires and the send fails.

## Pattern to use
```
/\bsrc=["']([^"']+)["']/gi          ← scanner (capture group)
/\bsrc=["']${escaped}["']/gi        ← rewrite regex (no capture groups needed)
src="${src}"  AND  src='${src}'     ← literal split/join for data: URIs
```

## Where applied
- `extractCtaInlineImages` in `server/gmail.ts`: inner `extractImgSrcs`, sig-marker `srcRe`, legacy `srcRe`, rewrite loop (data: and URL), href strip, FINAL-CID-GATE `_extractImgSrcs`
- `resolveCtaImagesInHtml` in `server/routes.ts`: scanner `imgRe`, rewrite split/join
- MIME-PRECHECK in `server/routes.ts`: pre/post img src extraction, `_cidRefs`, `_hasCidInHtml`, `_hasCtaUrl`

## Also: external host detection
`_leftoverHostUrls` was hardcoded to `/image-linker/i` — should be `/^https?:\/\//i` to catch any external host serving `/assets/cta/` files.

## Also: resolveCtaAsset public_url fallback
DB step 1 query now includes `OR public_url LIKE '%/<filename>'` so UUID-named uploads (multer generates UUID filenames) that are stored in the DB under a human-readable `filename` column value are still found via their `public_url` basename.

**How to apply:** Any time you add a new src= scanner or rewrite point in the email send pipeline, verify it uses `["']` character classes, not bare `"`.
