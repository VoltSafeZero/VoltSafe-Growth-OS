---
name: Asset Library Upgrade
description: Document Hub → Asset Library rename; new metadata columns; redesigned picker in email compose; visibility hardening with fixture tests.
---

## What was done

- **Migration** `migrations/0008_asset_library.sql` — `ALTER TABLE attachments / assets ADD COLUMN IF NOT EXISTS` for: `use_case`, `visibility`, `asset_type`, `recommended_for`, `is_favorite`, `usage_count`, `last_attached_at`. Auto-classification heuristics backfill existing rows.
- **Schema** `shared/schema.ts` — both `attachments` and `assets` Drizzle tables have the 7 new columns.
- **Storage** `server/storage.ts` — `getAllDocuments` accepts `useCase`/`visibility` filters; maps all 7 new columns in the return object.
- **Routes** `server/routes.ts` — `/api/documents` passes `useCase`/`visibility`; `/api/assets` hardened with `CUSTOMER_FACING_TABS` + `SAFE_VIS` sets; `PATCH /api/assets/:id/track-attachment` increments `usage_count` + `last_attached_at`.
- **Asset Library page** `client/src/pages/documents.tsx` — full redesign: use-case chip filters, VISIBILITY_OPTIONS dropdown, VisibilityBadge per row, customer-safe badge, isFavorite star.
- **Nav** `client/src/lib/nav-config.ts` — label "Asset Library".
- **Email picker** `client/src/pages/gmail-inbox.tsx` — `assetTab`/`assetSearch`/`restrictedWarning` state; 9 tabs; customer-safe badge; safety warning dialog for restricted assets; PATCH track-attachment on attach.
- **Tests** `tests/asset-library.test.js` — 91 source-grep + HTTP checks (A–L groups); group L uses psql fixtures to prove leakage is impossible.

## Visibility rules (enforced server-side)

| Tab | What's shown |
|-----|-------------|
| Recommended | `public` + `customer_safe` only (sorted by usage) |
| Sales / Product / Proof / Quotes / Brand | `public` + `customer_safe` matching useCase only |
| Internal | `internal_only` + `investor_only` for all auth users; `admin_only` added for admins |
| Favorites / Recent | All visibility the session can see (admin_only stripped for non-admins at base layer) |
| Default (no tab) | All assets except `admin_only` for non-admins |

## Key decisions

**Why CUSTOMER_FACING_TABS applies SAFE_VIS even for admins:** Customer-facing tabs represent "what a sales rep would attach to an outbound email." Even admins should not see restricted assets there — the Internal tab is the intentional escape hatch.

**Why Recommended tab filters to customer_safe/public only:** The most common compose flow is sending to leads/prospects. Defaulting to safe assets prevents accidental exposure of restricted files.

**Why usage_count tracked client-side (fire-and-forget):** Adding real-time tracking to a synchronous compose flow would add latency. Fire-and-forget PATCH is the right tradeoff.

## Gotchas

- `/api/assets` checks `req.session.globalRole` (NOT `req.session.isAdmin`) for admin detection — consistent with auth.ts which sets `globalRole: "master_admin"` on session. The original code used `req.session.isAdmin` which is never set; this caused admin_only assets to be invisible even to admins.
- `tests/asset-library.test.js` is plain ESM (`.js`) — no TypeScript type annotations. `spawnSync("psql", [...])` is used for fixture insertion/cleanup; `DATABASE_URL` env var must be set.
- Server restart required after editing `routes.ts` — `tsx` watcher is unreliable for large files.
- The `/api/assets` route does NOT support a `limit` param — use `tab`/`search` to filter.
