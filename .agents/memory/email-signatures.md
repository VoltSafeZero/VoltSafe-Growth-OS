---
name: Email Signature Management
description: Dynamic email signatures system — DB table, CRUD API, settings page, compose dialog integration
---

## Architecture

- `shared/schema.ts`: `emailSignatures` table (id, userId, name, htmlContent, plainTextContent, isDefault, createdAt, updatedAt)
- `server/services/signature-sanitizer.ts`: `sanitizeSignatureHtml()` — XSS sanitizer, strips script/iframe/object/embed/form tags, event handlers, javascript:/vbscript:/data: protocols. Imported by routes.ts.
- `server/seed-production.ts`: `migrateEmailSignaturesSchema()` — idempotent CREATE TABLE IF NOT EXISTS + index. Awaited in index.ts before `registerRoutes()`.
- `server/routes.ts`: CRUD at `/api/signatures` (GET list, POST create, GET /:id, PUT /:id, DELETE /:id, PATCH /:id/set-default). All use `(req.session as any).userId as number`.
- `client/src/pages/signature-settings.tsx`: WYSIWYG builder with Builder / Preview / HTML tabs.
- `client/src/pages/gmail-inbox.tsx` `ComposeDialog`: fetches `/api/signatures`, `selectedSigId` state (undefined=auto, null=none, number=specific), `activeSignatureHtml` used in all 3 send paths (send/draft/schedule); falls back to in-code `EMAIL_SIGNATURE_HTML` if no DB signatures.
- Route: `/settings/signatures`, nav entry in `nav-config.ts`.

## Critical Rules

**Use `(req.session as any).userId as number` — NEVER `(req as any).user!.id`.**
`requireAuth` only checks `req.session.userId`; it never populates `req.user`. Using `req.user` causes a 500 on every authenticated route.

**Signature is appended OUTSIDE the body wrapper div.**
`buildEmailHtml(body, appendHtml)` = `<div style="...Arial...">{body}</div>{appendHtml}`.
`stripEmailWrapper()` returns `first.innerHTML` (only the body, not the appended sig).
Therefore: draft re-open → sig is stripped → editor shows body only → sig re-appended on send. No duplication.

**Migration is awaited before routes register — no race condition.**
`migrateEmailSignaturesSchema()` runs in the `async ()` IIFE in `index.ts`, before `registerRoutes()`.

## Tests
`tests/email-signatures.test.js` — 75 checks (A–K). Source-grep tests B6–B10 check `server/services/signature-sanitizer.ts`, not routes.ts.
