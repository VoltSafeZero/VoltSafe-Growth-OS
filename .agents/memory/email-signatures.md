---
name: Email Signature Management
description: Dynamic email signatures system — DB table, CRUD API, settings page, compose dialog integration
---

## Rule
`email_signatures` table is created via inline fire-and-forget migration in `server/routes.ts` (no `await` — must use `.catch()` only, same pattern as other migrations).

**Why:** The routes file (`server/routes.ts`) has a scoping quirk where `esbuild`/`tsx` rejects `await` at the top level of `registerRoutes` around line 27495+, even though the function is async. Using `db.execute(...).catch(...)` (no `await`) avoids this.

**How to apply:** Any new top-level `await` calls added near the Email Signatures section (~line 27495) must be changed to fire-and-forget with `.catch()`.

## Architecture
- `shared/schema.ts`: `emailSignatures` table (id, userId, name, htmlContent, plainTextContent, isDefault, createdAt, updatedAt)
- `server/routes.ts`: CRUD at `/api/signatures` + `sanitizeSignatureHtml()` helper (strips XSS vectors)
- `client/src/pages/signature-settings.tsx`: Full WYSIWYG builder with tabs (Builder / Preview / HTML)
- `client/src/pages/gmail-inbox.tsx` `ComposeDialog`: fetches `/api/signatures`, `selectedSigId` state (undefined=auto, null=none, number=specific), `activeSignatureHtml` replaces `EMAIL_SIGNATURE_HTML` in all 3 send paths (send/draft/schedule); falls back to in-code `EMAIL_SIGNATURE_HTML` constant if no DB signatures exist.
- Route: `/settings/signatures`, nav entry in `nav-config.ts`, card in `settings.tsx`
