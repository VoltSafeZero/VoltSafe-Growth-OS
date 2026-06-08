---
name: Apple Mail CID Attachment Bug
description: Apple Mail shows CID inline images as attachments when Content-Disposition: inline is present; fix is to omit it entirely. Also: never use RegExp with data: URI keys.
---

## Rule

Never include `Content-Disposition: inline` on CID image MIME parts in `buildMimeRaw`. `Content-ID` alone is sufficient per RFC 2392 §2. Also add `type="text/html"` to `multipart/related` per RFC 2387 §3.1. Use a 10-second timeout (not 4s) for external HTTPS fetches in `extractCtaInlineImages`.

**Why:** Apple Mail 16+ (macOS Ventura/Sonoma, iOS 17+) interprets `Content-Disposition: inline` on a CID image part as "show this both inline AND as a downloadable attachment." The result is every signature image appears twice — once rendered correctly in the email body, and once as a named attachment (e.g. "Watch Demo.png 12 KB"). The root cause was confirmed in production: removing `Content-Disposition` entirely and keeping only `Content-ID` resolves the duplicate attachment without breaking rendering in any other client (Gmail, Outlook, Thunderbird).

The 4-second fetch timeout for external HTTPS URLs was too short for some external image hosts. The previous `inlineImagesAsBase64` implementation used 10s and was successfully fetching the same URLs.

**How to apply:**
- `server/gmail.ts` `inlineParts()`: return `Content-Type`, `Content-Transfer-Encoding`, `Content-ID` — no `Content-Disposition` at all.
- `buildMimeRaw` Case B and C: `Content-Type: multipart/related; boundary="..."; type="text/html"`.
- `extractCtaInlineImages` slow-path fetch: `setTimeout(..., 10000)`.
- Tests: check that `inlineParts` function body (sliced between `const inlineParts` and `const attachmentParts`) contains no `Content-Disposition` string — iCal legitimately uses `Content-Disposition: inline` in `attachmentParts`, so file-level checks will false-positive.

## data: URI keys must NOT be used in `new RegExp()`

In `extractCtaInlineImages`, the `seen` Map may have `data:image/png;base64,...` strings as keys when `resolveCtaImagesInHtml` pre-resolves CTA assets before extraction. Building a `RegExp` from a 73 KB base64 string throws `Invalid regular expression` in V8 (base64 contains `+`, `/` and long sequences that form invalid regex constructs even after escaping).

**Fix (in the src-rewrite loop):** test `src.startsWith("data:")` and use `rewritten.split(\`src="${src}"\`).join(\`src="cid:${cid}"\`)` (literal string replace) instead of `new RegExp(escapedSrc)`.

**Why:** `String.split(literal).join(replacement)` is a well-known idiomatic pattern for literal global string replacement in JS — zero regex overhead, correct for any string content including binary-encoded data.
