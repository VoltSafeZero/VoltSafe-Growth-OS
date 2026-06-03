---
name: Draft reopen signature fix
description: getDraftContent was returning plain-text body (extractBody) instead of HTML; caused sig to bleed into editor on draft reopen, doubling the sig on resend.
---

## Rule
`getDraftContent` in `server/gmail.ts` MUST use `extractHtmlBody(payload)` as the primary extractor, falling back to `extractBody(payload)` only when no HTML part exists.

**Why:** Gmail stores both `text/plain` and `text/html` MIME parts. `extractBody` prefers `text/plain`, which strips all HTML. When the UI reopened a draft, `stripEmailWrapper` received plain text (no wrapper div), returned it as-is (sig text baked in), and the editor showed "body text + sig text" combined. On send, `buildEmailHtml` appended the HTML sig again → duplication.

**How to apply:** Any new function that retrieves a message body for display in the compose editor should always prefer the HTML MIME part. Use `extractHtmlBody` → `extractBody` fallback pattern (as in `getThread`).

## Fix applied
```ts
// Before (bug):
const textBody = extractBody(msg.payload);
return { ..., body: textBody };

// After (fixed):
const htmlBody = extractHtmlBody(msg.payload);
const textBody = extractBody(msg.payload);
return { ..., body: htmlBody || textBody };
```

## Related test
`tests/email-signatures.test.js` J1 updated: relaxed from checking specifically `jb.isDefault` to `anyPromoted` — promotion correctly picks oldest remaining sig, which may not be `jb` when other user sigs exist in the DB.
