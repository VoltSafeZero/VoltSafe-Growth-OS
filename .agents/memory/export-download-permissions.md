---
name: Export/Download Permission System
description: Strict export and download restriction layer — flags, middleware, audit log, all 18 hardened routes.
---

## The rule
All CSV/XLSX export and file download routes MUST be gated by `requireExportPermission(module)` or `requireDownloadPermission(module)` in addition to the existing `requirePermission(section,"view")`.

**Why:** View-only users (analyst, advisor, read_only) could previously export entire CRM datasets with only section-view access. The new flags gate them at a separate layer so admins can control data exfiltration independently of read access.

## Implementation anchors
- `server/auth.ts` — `authorizeResourceAction()`, `requireExportPermission()`, `requireDownloadPermission()`, `logExportAudit()`
- `migrations/0037_export_permissions.sql` — `export_audit_log` table + backfill for all users
- Flags in `users.permissions` JSONB: `can_export`, `can_download_attachment`, `can_generate_report`
- Frontend hook: `client/src/hooks/use-export-permissions.ts` (reads from bootstrap)
- Frontend component: `ExportButton` (`client/src/components/ui/export-button.tsx`) — accepts `canExport` prop, handles 403 with toast
- Admin UI: `client/src/pages/admin-users.tsx` → AccessTab → "Export & Download" section (3 toggles)
- Tests: `tests/export-permissions.test.cjs` (75 checks, source-grep)

## Key design decisions
- **Admin bypass is unconditional** — master_admin and admin always get `ok:true` from `authorizeResourceAction()`
- **Missing flag = allow** — `flagValue === false` check (not `!flagValue`) so legacy users pre-migration still get access
- **ADDITIVE** — new checks come AFTER existing section-level permission checks; they don't replace them
- **Fire-and-forget audit** — `logExportAudit` uses `void` and catches internally; failures never abort the request
- **403 code field** — `EXPORT_FORBIDDEN` / `DOWNLOAD_FORBIDDEN` machine-readable codes on all denials

## How to add a new export/download route
1. Add `requireExportPermission("module")` (or `requireDownloadPermission`) as middleware after `requireAuth` and `requirePermission`
2. For in-body checks (where section is dynamic): call `authorizeResourceAction({ userId, action: "export" })` and `logExportAudit()`
3. Add a source-grep test in `tests/export-permissions.test.cjs`
