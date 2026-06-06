---
name: CID Image Display Fix
description: How VoltSafe Mail resolves cid: image refs in received messages; why DOMPurify blocks them and the backend proxy pattern.
---

## The Rule

DOMPurify's default URI allowlist does **NOT** include `cid:`. Any `src="cid:xxx"` in a received email's HTML body is silently stripped to `src=""` before the iframe renders. Browsers also cannot resolve `cid:` URIs natively.

**Fix**: In `MessageBody` (`client/src/pages/gmail-inbox.tsx`), the `sanitized` useMemo transforms `src="cid:xxx"` → `src="/api/gmail/messages/{gmailMessageId}/cid-image/xxx"` **before** calling `sanitizeEmailHtml`. Relative URLs pass DOMPurify unchanged.

**Why:** No DOMPurify config change needed — relative URLs are safe in the email iframe context.

**How to apply:** Any new component that renders received email HTML must do the same cid: → proxy rewrite if it passes through DOMPurify or any sanitizer that blocks `cid:`.

## Backend Proxy Route

`GET /api/gmail/messages/:msgId/cid-image/:contentId`

- Validates msgId (alphanumeric strip), looks up `source_account_id` from `email_messages`
- Checks user owns the account OR isAdmin OR has `mail_team` grant (view or edit)
- Fetches full Gmail message, walks MIME tree recursively looking for part with `Content-ID: <contentId>`
- If `body.data` present (small image inline): decodes directly
- If `body.attachmentId` present (large image): calls `gmail.users.messages.attachments.get`
- Returns image bytes with correct `Content-Type` and `Cache-Control: public, max-age=86400, immutable`
- Returns 404 (not 500) for missing CID parts — so broken images fail gracefully

## Static Route Filename Regex Bug

The `/assets/cta/:filename` route originally had regex `/^[0-9a-f-]+\.(png|jpg|jpeg|webp|gif)$/i` designed for UUID filenames. Any file with uppercase letters or underscores (e.g. `WatchDemo_Thumbnail_200.png`) returned 404 even when the file existed on disk.

**Fix**: Widened to `/^[A-Za-z0-9_][A-Za-z0-9_ .\-]*\.(png|jpg|jpeg|webp|gif)$/i`. `path.basename()` already prevents path traversal; the regex just guards the extension.

**Rule**: When adding new CTA asset files, name them with alphanumeric/underscore/hyphen characters only. UUID format is ideal but not required.

## Debug Endpoint

`GET /api/dev/last-sent-raw-email` (admin-only, dev mode only)

Captures the decoded raw MIME from the last `sendEmail()` call via `_lastSentDebugState` module-level variable in `server/gmail.ts`. Returns `mimeTree`, `hasCidRefsInHtml`, `cidRefsFound[]`, `mimePartHeaders[]`, `rawMime`.

Call this after sending a test email to verify:
1. `hasCidRefsInHtml: true` → CID replacement ran
2. `cidRefsFound` matches CIDs in `mimePartHeaders` → parts are attached
3. `mimeTree` shows `multipart/related` containing `text/html` + `image/png` parts
