---
name: Asset Library Upgrade
description: Document Hub → Asset Library rename; new metadata columns; redesigned picker in email compose.
---

## What was done

- **Migration** `migrations/0008_asset_library.sql` — `ALTER TABLE attachments / assets ADD COLUMN IF NOT EXISTS` for: `use_case`, `visibility`, `asset_type`, `recommended_for`, `is_favorite`, `usage_count`, `last_attached_at`. Auto-classification heuristics backfill existing rows.
- **Schema** `shared/schema.ts` — both `attachments` and `assets` Drizzle tables have the 7 new columns.
- **Storage** `server/storage.ts` — `getAllDocuments` accepts `useCase`/`visibility` filters; maps all 7 new columns in the return object.
- **Routes** `server/routes.ts` — `/api/documents` passes `useCase`/`visibility`; `/api/assets` handles `tab`/`useCase`/`visibility`/`search` with visibility safety (admin_only hidden from non-admins); `PATCH /api/assets/:id/track-attachment` increments `usage_count` + `last_attached_at`.
- **Asset Library page** `client/src/pages/documents.tsx` — full redesign: use-case chip filters, VISIBILITY_OPTIONS dropdown, VisibilityBadge per row, customer-safe badge, isFavorite star, upload/link/edit modals with new fields.
- **Nav** `client/src/lib/nav-config.ts` — label "Asset Library".
- **Email picker** `client/src/pages/gmail-inbox.tsx` — `assetTab`/`assetSearch`/`restrictedWarning` state; 9 tabs (recommended/sales/product/proof/quotes/brand/internal/recent/favorites); search input; customer-safe badge; safety warning dialog for internal_only/investor_only/admin_only; PATCH track-attachment on attach.
- **Tests** `tests/asset-library.test.js` — 61 source-grep + HTTP checks covering all above.

## Key decisions

**Why visibility safety in picker:** Internal/investor/admin assets should not accidentally leave the company. A two-step confirmation ("Attach Anyway" amber button) creates intentional friction without blocking the action entirely.

**Why Recommended tab filters to customer_safe/public only:** The most common compose flow is sending to leads/prospects. Defaulting to safe assets prevents accidental exposure of restricted files for the majority use-case.

**Why usage_count tracked client-side (fire-and-forget):** Adding real-time tracking to a synchronous compose flow would add latency and error surface. Fire-and-forget PATCH is the right tradeoff.

## Gotchas

- `tests/asset-library.test.js` is plain ESM (`.js`), no TypeScript type annotations — `sed -i 's/(a: any)/a/g'` pattern needed if TS syntax leaks in.
- Server restart required after editing `storage.ts` — `tsx` watcher may not pick up changes without it. The E-group HTTP tests for `/api/documents` field mapping failed before restart and passed after.
- The `/api/assets` route does NOT support a `limit` param — pass no limit to get all assets; filter client-side or use `tab`/`search`.
