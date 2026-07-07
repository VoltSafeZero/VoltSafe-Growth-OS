# VoltSafe CMS — High-Risk Action Registry

**Phase 16 — Security Hardening**
Last updated: 2026-07-07

This document defines the four-tier risk model for all user actions across VoltSafe CMS, the required safeguards per tier, and an exhaustive route-level inventory.

---

## Risk Tier Definitions

### A. Low-Risk

No confirmation, no audit event required beyond standard request logging.

Examples:
- Read / list / search any resource
- Dashboard load, widget refresh
- UI preference changes (theme, column widths, dashboard layout)
- Copy-only draft generation (returns text to UI only; no external artifact)
- Snooze / dismiss internal suggestion
- Update note content
- Update individual CRM field (name, status, stage)
- Mark task complete (single task)
- Calendar read / event copy

Required safeguards:
- Session authentication (`requireAuth`)
- Section read permission where applicable (`requirePermission(section, "view")`)

---

### B. Medium-Risk

No confirmation dialog required, but actions should be logged in activities or audit where practical.

Examples:
- Create task
- Update task (reassign, reschedule, status change)
- Create/update note
- Create/update lead, account, contact, opportunity
- Create/update quote or line items
- Accept/dismiss AI suggestion
- Send booking link
- Create Gmail draft (user's own draft in their own mailbox)
- Copy task/note/event content to clipboard
- Update email filter rule
- Update calendar event

Required safeguards:
- Session authentication
- Section edit permission (`requirePermission(section, "edit")`)
- Object ownership or CRM linkage check where applicable

---

### C. High-Risk

Requires explicit user action (button click on a clearly labeled destructive action).
Should log an audit activity or security audit event.
Frontend should use `ConfirmHighRiskAction` or equivalent confirmation dialog for destructive variants.

Examples:
- Delete / archive single CRM record (lead, account, contact, opportunity, ticket)
- Bulk update CRM records (status, assign, archive)
- Export data to CSV (leads, accounts, contacts, opportunities, tickets, quotes)
- Send email via Gmail (actual send, not draft)
- Forward email via Gmail
- Archive Gmail thread (bulk)
- Trash inbox thread (bulk)
- Send campaign step (actual send, not preview)
- Finalize board pack
- Archive board pack
- Revoke investor portal token
- Disconnect Gmail account / mailbox
- Delete Gmail draft
- Delete attachment
- Delete Currents message
- Delete/archive partnership record
- Delete tradeshow event

Required safeguards:
- Session authentication
- Section edit permission
- Object-level authorization (user must own/have access to the target)
- `confirm: true` in request body for send/bulk/delete actions (where implemented)
- Audit activity or security audit event recommended

---

### D. Critical-Risk

Requires explicit confirmation with typed confirmation text or `confirm: true`.
Must emit a security audit event via `recordSecurityAuditEvent`.
Must be gated behind the strictest available guard.

Examples:
- Permission/role change for any user
- User disable (suspend)
- User delete
- User invite (admin creates account)
- Capital data delete (funder, grant, investor, material)
- Capital investor portal token revoke
- Capital investor portal token regenerate
- Capital material share delete
- Board Pack finalize
- Board Pack archive
- Board Pack investor-update-draft generation
- Board Pack markdown export
- Private Currents channel archive
- Private Currents channel membership add/remove
- Gmail account disconnect (account-level)
- Admin mailbox force-full-resync
- Role definition create/update/delete

Required safeguards:
- Session authentication
- Strictest guard: `requireAdmin`, `requireCapitalAccess`, `requireBoardPackAccess`, or `requireForecastCapitalAccess` as applicable
- Object-level authorization
- `confirm: true` in request body where applicable
- Security audit event emitted
- Frontend confirmation dialog with `riskLevel="critical"`

---

## Safeguard Matrix

| Tier     | requireAuth | Section Permission | Object ACL | Confirm Flag | Audit Event | Frontend Dialog |
|----------|-------------|-------------------|------------|--------------|-------------|-----------------|
| Low      | ✓           | view               | –          | –            | –           | –               |
| Medium   | ✓           | edit               | where applicable | –     | optional    | –               |
| High     | ✓           | edit               | ✓          | recommended  | recommended | for destructive |
| Critical | ✓           | strongest guard    | ✓          | required     | required    | required        |

---

## Route-Level Inventory

### User / Admin / Permission Routes

| Route | Guard | Tier | Audit | Notes |
|-------|-------|------|-------|-------|
| `PATCH /api/admin/users/:id/permissions` | requireAuth + requireAdmin | Critical | recommended | Permission change |
| `POST /api/admin/users` | requireAuth + requireAdmin | Critical | recommended | Creates user account |
| `POST /api/admin/users/:id/suspend` | requireAuth + requireAdmin | Critical | recommended | Disables user |
| `POST /api/admin/users/:id/activate` | requireAuth + requireAdmin | Medium | optional | Re-enables user |
| `DELETE /api/admin/users/:id` | requireAuth + requireAdmin | Critical | recommended | Permanent delete |
| `POST /api/admin/users/:id/reset-password` | requireAuth + requireAdmin | Critical | recommended | Password reset |
| `PUT /api/admin/users/:id` | requireAuth + requireAdmin | High | optional | Profile update |
| `PATCH /api/admin/role-definitions/:id` | requireAuth + requireAdmin | Critical | recommended | Role update |
| `DELETE /api/admin/role-definitions/:id` | requireAuth + requireAdmin | Critical | recommended | Role delete |
| `POST /api/admin/role-definitions` | requireAuth + requireAdmin | High | optional | Role create |
| `POST /api/admin/mailbox/:id/force-full-resync` | requireAuth + requireAdmin | Critical | optional | Destructive resync |

### Mail / Gmail Routes

| Route | Guard | Tier | Audit | Notes |
|-------|-------|------|-------|-------|
| `POST /api/gmail/send` | requireAuth | Critical | recommended | Actual send — external |
| `POST /api/gmail/drafts` | requireAuth | High | optional | Draft creation |
| `DELETE /api/gmail/drafts/:id` | requireAuth | High | optional | Draft delete |
| `POST /api/gmail/bulk-archive` | requireAuth | High | optional | Bulk archive |
| `POST /api/gmail/bulk-mark-read` | requireAuth | Medium | – | Non-destructive |
| `POST /api/inbox/bulk-trash` | requireAuth | High | optional | Bulk trash |
| `PATCH /api/inbox/bulk-mark-done` | requireAuth + requirePermission("crm","edit") | Medium | – | Non-destructive |
| `POST /api/gmail/accounts/:id/disconnect` | requireAuth | Critical | recommended | Disconnects mailbox |
| `POST /api/gmail/disconnect` | requireAuth | Critical | recommended | Disconnects active mailbox |

### Board Pack Routes

| Route | Guard | Tier | Audit | Copy-Only |
|-------|-------|------|-------|-----------|
| `POST /api/board-packs/generate` | requireAuth + requireBoardPackAccess | High | optional | No (writes DB) |
| `POST /api/board-packs/:id/finalize` | requireAuth + requireBoardPackAccess | Critical | recommended | No (state change) |
| `POST /api/board-packs/:id/archive` | requireAuth + requireBoardPackAccess | Critical | recommended | No (state change) |
| `POST /api/board-packs/:id/investor-update-draft` | requireAuth + requireBoardPackAccess | High | optional | Yes (copy-only) |
| `GET /api/board-packs/:id/markdown` | requireAuth + requireBoardPackAccess | High | optional | Yes (read-only export) |

### Capital Routes

| Route | Guard | Tier | Audit |
|-------|-------|------|-------|
| `DELETE /api/capital/investors/:id` | requireAuth + requireCapitalAccess | Critical | recommended |
| `DELETE /api/capital/funders/:id` | requireAuth + requireCapitalAccess | Critical | recommended |
| `DELETE /api/capital/grants/:id` | requireAuth + requireCapitalAccess | Critical | recommended |
| `DELETE /api/capital/documents/:id` | requireAuth + requireCapitalAccess | Critical | recommended |
| `DELETE /api/capital/materials/:id` | requireAuth + requireCapitalAccess | Critical | recommended |
| `DELETE /api/capital/material-shares/:id` | requireAuth + requireCapitalAccess | Critical | recommended |
| `POST /api/capital/investors/:id/portal-access` | requireAuth + requireCapitalAccess | Critical | recommended |
| `POST /api/capital/portal-access/:id/revoke` | requireAuth + requireCapitalAccess | Critical | recommended |
| `POST /api/capital/portal-access/:id/regenerate` | requireAuth + requireCapitalAccess | Critical | recommended |
| `DELETE /api/capital/portal-access/:id` | requireAuth + requireCapitalAccess | Critical | recommended |

### Currents Routes

| Route | Guard | Tier | Audit |
|-------|-------|------|-------|
| `POST /api/current/channels/:id/archive` | requireAuth + requireAdmin | Critical | recommended |
| `POST /api/current/channels/:slug/members/:userId` | requireAuth + requireAdmin | Critical | recommended |
| `DELETE /api/current/channels/:slug/members/:userId` | requireAuth + requireAdmin | Critical | recommended |
| `DELETE /api/current/messages/:id` | requireAuth | High | optional | User deletes own message |
| `POST /api/current/dms/:id/members` | requireAuth | High | optional |

### CRM Routes

| Route | Guard | Tier | Audit |
|-------|-------|------|-------|
| `DELETE /api/leads/:id` | requirePermission("crm","edit") | High | optional |
| `DELETE /api/accounts/:id` | requirePermission("crm","edit") | High | optional |
| `DELETE /api/contacts/:id` | requirePermission("crm","edit") | High | optional |
| `POST /api/leads/bulk/archive` | requirePermission("crm","edit") | High | optional |
| `POST /api/leads/bulk/assign` | requirePermission("crm","edit") | High | optional |
| `POST /api/leads/bulk/status` | requirePermission("crm","edit") | High | optional |
| `POST /api/tasks/bulk/complete` | requirePermission("crm","edit") | High | optional |
| `POST /api/tasks/bulk/reassign` | requirePermission("crm","edit") | High | optional |

### Export Routes

| Route | Guard | Tier | Audit |
|-------|-------|------|-------|
| `GET /api/leads/export` | requireAuth + exportRateLimiter + requirePermission("crm","view") | High | optional |
| `GET /api/accounts/export` | requireAuth + exportRateLimiter + requirePermission("crm","view") | High | optional |
| `GET /api/contacts/export` | requireAuth + exportRateLimiter + requirePermission("crm","view") | High | optional |
| `GET /api/opportunities/export` | requireAuth + exportRateLimiter + requirePermission("crm","view") | High | optional |
| `GET /api/tickets/export` | requireAuth + requirePermission("support","view") | High | optional |
| `GET /api/quotes/export` | requireAuth + requirePermission("quoting","view") | High | optional |
| `GET /api/campaigns/export` | requireAuth + requirePermission("crm","view") | High | optional |

### Campaign Routes

| Route | Guard | Tier | Confirm | Notes |
|-------|-------|------|---------|-------|
| `POST /api/marketing/campaigns/:id/send-preview` | requireAuth + requirePermission("crm","edit") | High | – | Preview only |
| `POST /api/marketing/campaigns/:id/send-step` | requireAuth + requirePermission("crm","edit") | Critical | `confirm: true` required | Actual send |

---

## Copy-Only Routes (never produce external artifacts)

These routes generate content returned to the UI only. They do not send externally, create Gmail drafts, or post to Currents.

| Route | Copy-Only Mechanism |
|-------|---------------------|
| `POST /api/board-packs/:id/investor-update-draft` | Returns draft text only; no send |
| CEO briefing / Cortex daily plan generation | Returns suggestions; no auto-execute |
| Voice assistant `generate_email` tool | Returns suggested email text; no send |
| `POST /api/crm/booking-analytics/actions/create-gmail-draft` | Creates Gmail draft only; not sent |
| AI follow-up email generation | Returns copy; user must send explicitly |
| Suggested Next Email modal | Returns copy; user must send via compose |

---

## Already-Safe Patterns (no Phase 16 changes needed)

The following were audited and confirmed safe:

- All `/api/capital/*` routes: `requireAuth + requireCapitalAccess` — 100% coverage
- Board pack finalize/archive: `requireAuth + requireBoardPackAccess`
- Admin user routes: `requireAuth + requireAdmin`
- Currents channel archive/member routes: `requireAuth + requireAdmin`
- Export routes: `requireAuth + exportRateLimiter + requirePermission`
- Campaign send-step: already requires `confirm: true` in request body
- Investor portal token routes: guarded by `requireCapitalAccess`
- WebAuthn credential delete: `requireAuth` (user's own credentials only)

---

---

## Phase 17 — Applied Controls (Live Wiring)

*Status: COMPLETE — 2026-07-07*

All routes below have `void recordHighRiskAction(...)` (fire-and-forget, never blocking) added immediately before `res.json(...)`. Frontend confirmation guards are wired using `ConfirmHighRiskAction` for all user-facing critical actions.

### Backend Audit Calls Added

| Route | Action | Category | Severity | File |
|---|---|---|---|---|
| `POST /api/board-packs/:id/finalize` | `board_pack_finalize` | `board_pack_action` | critical | routes.ts |
| `POST /api/board-packs/:id/archive` | `board_pack_archive` | `board_pack_action` | critical | routes.ts |
| `GET /api/board-packs/:id/markdown` | `board_pack_markdown_export` | `board_pack_action` | high | routes.ts |
| `POST /api/board-packs/:id/investor-update-draft` | `board_pack_investor_draft` | `board_pack_action` | high | routes.ts |
| `PATCH /api/admin/users/:id/permissions` | `user_permissions_change` | `permission_change` | critical | routes.ts |
| `POST /api/admin/users/:id/suspend` | `user_suspend` | `user_management` | critical | routes.ts |
| `DELETE /api/admin/users/:id` | `user_delete` | `user_management` | critical | routes.ts |
| `POST /api/current/channels/:id/archive` | `currents_channel_archive` | `currents_membership` | critical | routes.ts |
| `POST /api/current/channels/:slug/members` | `currents_member_add` | `currents_membership` | critical | routes.ts |
| `DELETE /api/current/channels/:slug/members/:userId` | `currents_member_remove` | `currents_membership` | critical | routes.ts |
| `POST /api/gmail/accounts/:id/disconnect` | `gmail_account_disconnect` | `integration_change` | critical | routes.ts |
| `POST /api/gmail/disconnect` | `gmail_disconnect` | `integration_change` | critical | routes.ts |
| `POST /api/capital/investors/:id/portal-access` | `investor_portal_access_create` | `token_action` | critical | routes-capital.ts |
| `POST /api/capital/portal-access/:id/revoke` | `investor_portal_token_revoke` | `token_action` | critical | routes-capital.ts |
| `DELETE /api/capital/portal-access/:id` | `investor_portal_access_delete` | `capital_action` | critical | routes-capital.ts |
| `POST /api/capital/portal-access/:id/regenerate` | `investor_portal_token_regenerate` | `token_action` | critical | routes-capital.ts |

**Total: 16 audit call sites. 15 are critical severity, 2 are high.**

### Frontend Confirmation Guards Added

| Component | Actions Guarded | Confirmation Type |
|---|---|---|
| `client/src/pages/board-pack.tsx` | Finalize Pack, Archive Pack | `ConfirmHighRiskAction` (riskLevel=high, no typing required) |
| `client/src/pages/capital-investors.tsx` | Revoke Portal, Delete Portal Link, Regenerate Token | `ConfirmHighRiskAction` (riskLevel=critical; Delete requires typing "DELETE") |
| `client/src/pages/admin-users.tsx` | Delete User | `ConfirmHighRiskAction` (riskLevel=critical, confirmationText="DELETE", irreversible=true) |
| `client/src/pages/admin-users.tsx` | Suspend User | Custom Dialog (preserves reason textarea; backend audit already logs) |

### Pattern

```typescript
// Fire-and-forget — never blocks the response
void recordHighRiskAction({
  actor_user_id: getAuditActor(req),
  action: "action_name",
  category: "category_name",
  target_type: "resource_type",
  target_id: id,
  route: req.path,
  severity: "critical",
  metadata: { /* safe IDs/counts only, no PII/secrets */ },
});
res.json(result);
```

### Test Coverage

`tests/high-risk-action-application.test.cjs` — 84 checks covering:
- All 16 backend audit call sites (action name, category, severity, metadata)
- Fire-and-forget pattern (no `await`, no blocking)
- All frontend `ConfirmHighRiskAction` integrations (state, onClick, dialog props)
- Metadata sanitization (BLOCKED_METADATA_KEYS)
- DB migration presence

---

## Sensitive Payload Prohibitions

The following are **never** stored in audit metadata:

- Email bodies (any field: `body`, `html`, `text`, `email_body`, `raw_content`)
- Tokens (`token`, `access_token`, `refresh_token`, `webhook_token`, `id_token`)
- Passwords and secrets (`password`, `secret`, `credential`, `private_key`, `api_key`)
- Capital content (`memo_text`, `memo`, `investor_memo`, `board_pack_content`, `investor_update_body`)
- Message subjects (`subject_line`, `draft_body`, `message_body`)

Permitted audit metadata: IDs, counts, route, action type, status labels, user IDs, timestamps.

---

## Confirmation Component

`client/src/components/security/confirm-high-risk-action.tsx`

Props:
- `title` — dialog heading
- `description` — action summary
- `riskLevel: "medium" | "high" | "critical"` — controls badge color and icon
- `confirmationText` — if set, user must type this exact string to confirm
- `confirmButtonLabel` — defaults to "Confirm"
- `cancelButtonLabel` — defaults to "Cancel"
- `loading` — disables confirm button while mutation is in flight
- `irreversible` — adds "This action cannot be undone" banner
- `warningCopy` — additional warning text in banner
- `onConfirm` — callback when confirmed
- `open` / `onOpenChange` — standard controlled dialog props

Use for: Critical-tier actions (always), High-tier destructive actions (recommended).
Do NOT use for: Low/Medium tier, read-only, or non-destructive actions.
