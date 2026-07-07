# VoltSafe Growth OS — Security Access-Control Matrix
**Phase 15 | Full-App Security & Permissions Audit**
*Generated July 2026 — update whenever a new module or role is added.*

---

## 1. Role Model

| Role | Description | Admin panel | Capital | Board Pack | CEO Cockpit |
|---|---|---|---|---|---|
| `master_admin` | Full super-admin | ✓ | ✓ (if in allowlist) | ✗ (must also be in BP list) | ✓ |
| `admin` | Operational admin | ✓ | ✗ | ✗ | ✓ |
| `advisor` | Read-only advisor | ✗ | ✗ | ✗ | ✗ |
| (standard user) | Sales/CS/ops staff | ✗ | ✗ | ✗ | ✗ |
| Capital user | User ID or email in `CAPITAL_ALLOWED_*` lists | depends | ✓ | depends | depends |
| CEO/CFO | Trevor (user 4) + Scott Carlson | ✓ (admin) | ✓ | ✓ | ✓ |

**Advisor blocked sections:** `crm`, `partnerships`, `quoting` (enforced in `requirePermission`).

---

## 2. Permission Sections & Levels

Stored as `users.permissions` JSON: `{ crm: "edit"|"view"|"none", support: ..., quoting: ..., communications: ..., partnerships: ..., knowledge: ..., projects: ..., capital: ... }`

| Section | Covers |
|---|---|
| `crm` | Leads, Accounts, Contacts, Opportunities, Tickets (partial), Tasks |
| `support` | Tickets, support module |
| `quoting` | Quotes, line items, service estimates |
| `communications` | Campaigns, comm-lists, marketing emails |
| `partnerships` | Ecosystem, partnerships, regions |
| `knowledge` | Assets, document hub |
| `projects` | Projects, certifications |
| `capital` | Capital permission flag (set at login for capital-allowlisted users) |

`admin` and `master_admin` bypass all section checks (fast-path in `requirePermission`).

---

## 3. Guard Reference

| Guard | Source | What it enforces |
|---|---|---|
| `requireAuth` | `server/auth.ts:90` | Session `userId` present; `mustChangePassword` gate |
| `requireAdmin` | `server/auth.ts:106` | `globalRole` = `admin` or `master_admin` |
| `requirePermission(section, level)` | `server/auth.ts:122` | Section permission ≥ `view` or `edit`; admin bypass; advisor block |
| `requireNotAdvisor` | `server/auth.ts:162` | Blocks `advisor` role entirely |
| `requireCapitalAccess` | `server/routes-capital.ts:31` | User ID or email in capital allowlist |
| `requireForecastCapitalAccess` | `server/routes.ts:11548` | CEO/CFO capital check (inline) |
| `requireBoardPackAccess` | `server/routes.ts:11721` | Trevor (user 4) + Scott Carlson only |
| `canView` / `canEdit` (tasks) | `server/routes-tasks.ts:401-402` | `requirePermission("crm", "view"/"edit")` aliases |
| `csrfOriginGuard` | `server/csrf.ts:91` | Origin/Referer exact-host allowlist; fail-closed |
| `loginRateLimiter` | `server/routes.ts:199` | 10 failed logins/IP/15 min |
| `passwordResetRateLimiter` | `server/routes.ts:210` | Password-reset rate limit |
| `aiGenerationRateLimiter` | `server/routes.ts:230` | AI generation rate limit |
| `exportRateLimiter` | `server/routes.ts:249` | Export rate limit |

---

## 4. Access-Control Matrix by Module

### 4.1 Today / My Day

| Action | Unauthenticated | Standard User | Admin | CEO/CFO |
|---|---|---|---|---|
| View Today dashboard | ✗ 401 | ✓ (own data) | ✓ | ✓ |
| View CEO cockpit panels | ✗ | ✗ (`requireAdmin`) | ✓ | ✓ |
| View forecast/runway | ✗ | ✗ (`requireForecastCapitalAccess`) | ✗ | ✓ |
| View funding forecast | ✗ | ✗ (`requireForecastCapitalAccess`) | ✗ | ✓ |

**Route guards:** `requireAuth`, `requireAdmin`, `requireForecastCapitalAccess`
**Notes:** CEO Cockpit panels gated behind `requireAdmin` + optional capital/board-pack checks.

---

### 4.2 CEO Cockpit (Phases 4–13)

| Action | Unauthenticated | Standard User | Admin | CEO/CFO |
|---|---|---|---|---|
| View cockpit overview | ✗ | ✗ | ✓ | ✓ |
| Board pack routes | ✗ | ✗ | ✗ | ✓ (`requireBoardPackAccess`) |
| Runway intelligence | ✗ | ✗ | ✗ | ✓ (`requireForecastCapitalAccess`) |
| Investor update drafts | ✗ | ✗ | ✗ | ✓ (`requireBoardPackAccess`) |
| 1:1 notes / commitments | ✗ | ✗ | ✓ | ✓ |
| Action queue | ✗ | ✗ | ✓ | ✓ |

**Route guards:** `requireAuth + requireAdmin + requireBoardPackAccess/requireForecastCapitalAccess`
**Frontend:** CEO Cockpit nav item hidden from non-admins via `isAdmin` check in sidebar.
**Test suite:** `tests/ceo-cockpit-smoke.test.cjs` (113 checks), `tests/board-pack.test.cjs`, `tests/ceo-forecasting.test.cjs`

---

### 4.3 Tasks

| Action | Unauthenticated | Standard User (CRM view) | Standard User (CRM edit) | Admin |
|---|---|---|---|---|
| View tasks board | ✗ | ✓ | ✓ | ✓ |
| View task detail | ✗ | ✓ | ✓ | ✓ |
| Create/edit task | ✗ | ✗ | ✓ | ✓ |
| Delete task | ✗ | ✗ | ✓ | ✓ |
| Manage columns | ✗ | ✗ | ✓ | ✓ |
| Add/remove labels | ✗ | ✗ | ✓ | ✓ |
| Manage task hub access | ✗ | ✗ | ✗ | ✓ (`requireAdmin`) |
| View another user's tasks hub | ✗ | ✗ | ✗ | ✓ (task hub access grant) |

**Route guards:** `canView` / `canEdit` = `requirePermission("crm", "view"/"edit")`
**Object-level:** Task column ownership scoped by `user_id`; hub access grants via `task_hub_access_permissions`.
**Source:** `server/routes-tasks.ts`

---

### 4.4 Calendar

| Action | Unauthenticated | Standard User | Admin |
|---|---|---|---|
| View own calendar | ✗ | ✓ | ✓ |
| Create/edit events | ✗ | ✓ | ✓ |
| View team work calendar | ✗ | ✓ | ✓ |
| Disconnect Google Calendar | ✗ | ✓ (own) | ✓ |

**Route guards:** `requireAuth`
**Source:** `server/routes-team-calendar.ts`, calendar routes in `server/routes.ts`

---

### 4.5 Currents

| Action | Unauthenticated | Standard User | Admin |
|---|---|---|---|
| List public channels | ✗ | ✓ | ✓ |
| Post to public channel | ✗ | ✓ | ✓ |
| View private channel | ✗ | ✓ (members only, checked per-query) | ✓ |
| Post to private channel | ✗ | ✓ (members only) | ✓ |
| Read DM thread | ✗ | ✓ (participants only) | ✓ |
| Send DM | ✗ | ✓ | ✓ |
| Upload file to channel | ✗ | ✓ (must be member if private) | ✓ |
| Download message attachment | ✗ | ✓ (membership + DM participant check) | ✓ |
| Archive/unarchive channel | ✗ | ✗ | ✓ |
| Change private channel membership | ✗ | ✗ | ✓ |
| Workspace search (messages) | ✗ | ✓ (excludes private unless member) | ✓ |

**Route guards:** `requireAuth`; private-channel / DM participant guard via SQL `OR EXISTS (SELECT 1 FROM current_channel_members …)` pattern.
**Private channel enforcement points:**
- `resolveChannelAccess()` (line 34925) — by slug
- `checkPrivateChannelAccess()` (line 34945) — by channel ID
- File upload (line 6979) — membership check before upload
- File serve (line 7200) — DM + private channel check before stream
- Channel list query (line 34965) — `AND (c.is_private = FALSE OR EXISTS (…))` filter
- CEO Cockpit / Briefing — `is_private = FALSE` filter added to all Currents queries

**Test coverage:** `tests/currents-security.test.cjs` (Phase 15)

---

### 4.6 Mail / Gmail

| Action | Unauthenticated | Standard User | Admin |
|---|---|---|---|
| Read own mailbox | ✗ | ✓ (own account only) | ✓ |
| Read another user's mailbox | ✗ | ✗ | ✓ (admin) |
| Send email | ✗ | ✓ (explicit user action only) | ✓ |
| Create draft | ✗ | ✓ (explicit user action) | ✓ |
| Forward/reply | ✗ | ✓ (explicit user action) | ✓ |
| Archive/delete | ✗ | ✓ (explicit user action) | ✓ |
| Block sender | ✗ | ✓ | ✓ |
| View tracking data (opens/clicks) | ✗ | ✓ (`requireAuth`) | ✓ |
| Tracking pixel (email recipient) | ✓ (unauthenticated by design) | ✓ | ✓ |
| Marketing unsubscribe | ✓ (token-based) | ✓ | ✓ |
| AI draft generation | ✗ | ✓ (`requireAuth`) | ✓ |
| Connect Gmail account | ✗ | ✓ (own) | ✓ |

**Route guards:** `requireAuth`; connected-account scoping enforced by `asAccountId` parameter matched to session user's Gmail connections.
**No auto-send:** All send/draft/forward routes require explicit `POST` from authenticated session.
**Internal tracking:** `is_internal = TRUE` flag on `@voltsafe.com` recipients; all engagement counts use `AND is_internal IS NOT TRUE`.
**Source:** Gmail routes in `server/routes.ts`

---

### 4.7 CRM — Leads

| Action | Unauthenticated | CRM view | CRM edit | Admin |
|---|---|---|---|---|
| List leads | ✗ | ✓ | ✓ | ✓ |
| View lead detail | ✗ | ✓ | ✓ | ✓ |
| Create lead | ✗ | ✗ | ✓ | ✓ |
| Edit lead | ✗ | ✗ | ✓ | ✓ |
| Delete lead | ✗ | ✗ | ✓ | ✓ |
| Convert lead | ✗ | ✗ | ✓ | ✓ |
| Import marinas | ✗ | ✗ | ✓ | ✓ |
| Export leads (CSV) | ✗ | ✓ (`exportRateLimiter`) | ✓ | ✓ |
| Pilot-status change | ✗ | ✗ | ✓ | ✓ |

**Route guards:** `requirePermission("crm", "view"/"edit")`
**Advisor:** Blocked from CRM section by `ADVISOR_BLOCKED_SECTIONS`.

---

### 4.8 CRM — Accounts

| Action | Unauthenticated | CRM view | CRM edit | Admin |
|---|---|---|---|---|
| List accounts | ✗ | ✓ | ✓ | ✓ |
| View account | ✗ | ✓ | ✓ | ✓ |
| Create account | ✗ | ✗ | ✓ | ✓ |
| Edit account | ✗ | ✗ | ✓ | ✓ |
| Delete account | ✗ | ✗ | ✓ | ✓ |
| Edit infrastructure | ✗ | ✗ | ✓ | ✓ |
| Convert account → lead | ✗ | ✗ | ✓ | ✓ |

**Route guards:** `requirePermission("crm", "view"/"edit")`

---

### 4.9 CRM — Contacts

| Action | Unauthenticated | CRM view | CRM edit | Admin |
|---|---|---|---|---|
| List/view contacts | ✗ | ✓ | ✓ | ✓ |
| Create/edit contact | ✗ | ✗ | ✓ | ✓ |
| Delete contact | ✗ | ✗ | ✓ | ✓ |
| Extract contact from image/URL/email | ✗ | ✗ | ✓ | ✓ |

**Route guards:** `requirePermission("crm", "view"/"edit")`

---

### 4.10 Marketing / Campaigns

| Action | Unauthenticated | Communications view | Communications edit | Admin |
|---|---|---|---|---|
| View comm lists | ✗ | ✓ | ✓ | ✓ |
| Edit comm lists | ✗ | ✗ | ✓ | ✓ |
| View campaigns | ✗ | ✓ | ✓ | ✓ |
| Create/edit campaign | ✗ | ✗ | ✓ | ✓ |
| Send campaign | ✗ | ✗ | ✓ | ✓ |
| Import contacts (CSV) | ✗ | ✗ | ✓ (CRM edit) | ✓ |
| Marketing tracking pixel | ✓ (by design) | ✓ | ✓ | ✓ |
| Unsubscribe (token) | ✓ (by design) | ✓ | ✓ | ✓ |
| Compliance preferences (token) | ✓ (by design) | ✓ | ✓ | ✓ |

**Route guards:** `requirePermission("communications", "view"/"edit")` for campaign routes; token-based for public tracking/unsubscribe.

---

### 4.11 Pipeline / Revenue / Insights

| Action | Unauthenticated | CRM view | CRM edit | Admin |
|---|---|---|---|---|
| View pipeline / opportunities | ✗ | ✓ | ✓ | ✓ |
| Edit opportunities | ✗ | ✗ | ✓ | ✓ |
| View insights drilldown | ✗ | ✓ | ✓ | ✓ |
| View pipeline drilldown | ✗ | ✓ | ✓ | ✓ |
| View revenue intelligence | ✗ | ✓ | ✓ | ✓ |
| Export pipeline CSV | ✗ | ✓ | ✓ | ✓ |

**Route guards:** `requireAuth + requirePermission("crm", "view"/"edit")` on main routes; drilldown routes use `requireAuth + requirePermission("crm", "view")`.

---

### 4.12 Operations

| Action | Unauthenticated | CRM view | CRM edit | Admin |
|---|---|---|---|---|
| View operations drilldown | ✗ | ✓ | ✓ | ✓ |
| Data-quality metrics in drilldown | ✗ | ✗ | ✗ | ✓ (admin-only sub-check inside handler) |
| Operations settings | ✗ | ✗ | ✓ | ✓ |

**Route guards:** `requireAuth + requirePermission("crm", "view")`; DQ metrics have an internal admin check in the handler.

---

### 4.13 Work

| Action | Unauthenticated | Any Authenticated User | Admin |
|---|---|---|---|
| View work drilldown | ✗ | ✓ (own data) | ✓ (can pass `?owner_id=N`) |
| View another user's work | ✗ | ✗ | ✓ (admin + `?owner_id=N`) |

**Route guards:** `requireAuth` only (no section permission gate).
**Note:** Work drilldown is scoped to `currentUserId` by default; admin must explicitly pass `?owner_id` to see another user's data. Acceptable because work metrics contain no CRM/financial data — only the current user's task/calendar/inbox stats.

---

### 4.14 Capital

| Action | Unauthenticated | Standard User | Admin | Capital User (allowlist) |
|---|---|---|---|---|
| View capital dashboard | ✗ | ✗ | ✗ | ✓ |
| Manage funders/grants/investors | ✗ | ✗ | ✗ | ✓ |
| View investor contacts | ✗ | ✗ | ✗ | ✓ |
| View capital pipeline | ✗ | ✗ | ✗ | ✓ |
| Upload capital documents | ✗ | ✗ | ✗ | ✓ |
| Create investor portal link | ✗ | ✗ | ✗ | ✓ |
| View investor portal (external) | ✓ (64-char hex token, limited data) | ✓ | ✓ | ✓ |
| Export capital data | ✗ | ✗ | ✗ | ✓ |

**Route guards:** All `/api/capital/*` routes: `requireAuth + requireCapitalAccess` (every single route).
**`requireCapitalAccess`:** Checks `CAPITAL_ALLOWED_USER_IDS` (fast path) then `CAPITAL_ALLOWED_EMAILS` (DB lookup). Defined in `server/routes-capital.ts:31`.
**Investor portal:** Public token-based endpoint (`/api/investor-portal/:token`). Token = 64-char lowercase hex, hashed for storage. Response deliberately excludes internal scores, probability, notes, and financial data. Read-only event tracking only.
**No capital data in localStorage** — verified.

---

### 4.15 Investor / Funding / Board Pack

| Action | Unauthenticated | Standard User | Admin | CEO/CFO |
|---|---|---|---|---|
| View board packs | ✗ | ✗ | ✗ | ✓ |
| Create/finalize board pack | ✗ | ✗ | ✗ | ✓ |
| Archive board pack | ✗ | ✗ | ✗ | ✓ |
| Generate investor update draft | ✗ | ✗ | ✗ | ✓ (copy-only, no auto-send) |
| Compare packs | ✗ | ✗ | ✗ | ✓ |

**Route guards:** `requireAuth + requireBoardPackAccess`
**`requireBoardPackAccess`:** Trevor (user 4) + Scott Carlson email (`isBoardPackUser` from `server/services/board-pack`).
**No auto-send:** Investor update drafts use `copy_only: true` flag — draft created, not sent.

---

### 4.16 Forecasting / Runway Intelligence

| Action | Unauthenticated | Standard User | Admin | CEO/CFO |
|---|---|---|---|---|
| View runway forecast | ✗ | ✗ | ✗ | ✓ |
| View funding forecast | ✗ | ✗ | ✗ | ✓ |
| Edit scenario notes | ✗ | ✗ | ✗ | ✓ |

**Route guards:** `requireAuth + requireAdmin + requireForecastCapitalAccess`
**`requireForecastCapitalAccess`:** Inline check at `server/routes.ts:11548` — capital permission flag or `isBoardPackUser`.

---

### 4.17 Admin / User Management

| Action | Unauthenticated | Standard User | Admin | Master Admin |
|---|---|---|---|---|
| List users | ✗ | ✗ | ✓ | ✓ |
| Create user | ✗ | ✗ | ✓ | ✓ |
| Edit user permissions | ✗ | ✗ | ✓ | ✓ |
| Suspend/activate user | ✗ | ✗ | ✓ | ✓ |
| Delete user | ✗ | ✗ | ✓ | ✓ |
| View user profile | ✗ | ✓ (own only) | ✓ | ✓ |
| Change own password | ✗ | ✓ | ✓ | ✓ |

**Route guards:** `requireAuth + requireAdmin` on all `/api/admin/*` and `/api/users/:id` mutation routes.
**`getUsers()`:** Returns `id, name, email` only — no password hashes, no permissions JSON.
**Seed users:** `seedUsers()` skips execution in `NODE_ENV=production`.

---

### 4.18 Partnerships / Ecosystem

| Action | Unauthenticated | Partnerships view | Partnerships edit | Admin |
|---|---|---|---|---|
| View partnerships/ecosystem | ✗ | ✓ | ✓ | ✓ |
| Edit/delete partnerships | ✗ | ✗ | ✓ | ✓ |
| Edit/delete ecosystem orgs/people | ✗ | ✗ | ✓ | ✓ |

**Route guards:** `requirePermission("partnerships", "view"/"edit")`
**Advisor:** Blocked from partnerships section.

---

### 4.19 Projects / Certifications

| Action | Unauthenticated | Projects view | Projects edit | Admin |
|---|---|---|---|---|
| View projects | ✗ | ✓ | ✓ | ✓ |
| Create/edit projects | ✗ | ✗ | ✓ | ✓ |
| Download project attachments | ✗ | ✓ | ✓ | ✓ |

**Route guards:** `requirePermission("projects", "view"/"edit")`

---

### 4.20 Document / Asset Library

| Action | Unauthenticated | Knowledge view | Knowledge edit | Admin |
|---|---|---|---|---|
| Browse/search documents | ✗ | ✓ | ✓ | ✓ |
| Upload document | ✗ | ✗ | ✓ | ✓ |
| Download document | ✗ | ✓ | ✓ | ✓ |
| Delete document | ✗ | ✗ | ✓ | ✓ |

**Route guards:** `requirePermission("knowledge", "view"/"edit")`
**File ACL:** `/api/attachments/file/:fileName` performs per-attachment ACL check (admin / uploader / section-permission) — returns uniform 404 for "no file" and "no access" to prevent enumeration.

---

### 4.21 Settings / Integrations

| Action | Unauthenticated | Standard User | Admin |
|---|---|---|---|
| View own profile settings | ✗ | ✓ | ✓ |
| Connect Gmail account (own) | ✗ | ✓ | ✓ |
| Disconnect Gmail account (own) | ✗ | ✓ | ✓ |
| Connect shared Gmail / workspace | ✗ | ✗ | ✓ |
| View Jira/Confluence integration | ✗ | ✓ | ✓ |
| Configure WebAuthn | ✗ | ✓ (own) | ✓ |

**Route guards:** `requireAuth`; shared Gmail connection change routes use `requireAuth + requireAdmin`.

---

## 5. Public / Token-Gated Routes (Legitimate Unauthenticated)

| Route | Purpose | Auth Mechanism |
|---|---|---|
| `GET /track/open/:id.gif` | Email tracking pixel | None (public by design) |
| `GET /track/open/:id` | Email tracking pixel | None (public by design) |
| `GET /track/click/:id` | Email click redirect | None (public by design) |
| `GET /track/signature-click/:token` | Signature CTA tracking | None (public by design) |
| `GET /api/marketing/track/open/:token.gif` | Marketing tracking | None (public by design) |
| `GET /api/marketing/track/click/:token` | Marketing click | None (public by design) |
| `GET /api/marketing/unsubscribe/:token` | Email unsubscribe | HMAC token |
| `POST /api/marketing/unsubscribe/:token` | Confirm unsubscribe | HMAC token |
| `GET /api/compliance/preferences` | Email preferences | Signed JWT token |
| `POST /api/compliance/preferences` | Update preferences | Signed JWT token |
| `GET /api/preferences` | Alias for compliance prefs | Signed JWT token |
| `POST /api/preferences` | Alias for compliance prefs | Signed JWT token |
| `GET /assets/cta/:filename` | CTA images in emails | UUID filename (no auth) |
| `GET /api/investor-portal/:token` | Investor portal view | 64-char hex token |
| `POST /api/investor-portal/:token/events` | Portal event tracking | 64-char hex token |
| `POST /api/auth/login` | Login | Rate-limited |
| `POST /api/auth/logout` | Logout | None |
| `GET /api/auth/me` | Session check | None (returns null if unauthed) |
| `GET /api/session/bootstrap` | Session bootstrap | None (returns limited info) |
| `GET /health` | Health probe | None |
| `POST /api/webauthn/auth-options` | WebAuthn auth init | None |
| `POST /api/webauthn/auth-verify` | WebAuthn auth verify | Rate-limited |
| `GET /api/auth/google/callback` | OAuth callback | State nonce |
| `GET /api/calendar/auth/callback` | Calendar OAuth callback | State nonce |
| `POST /api/webhooks/gmail` | Gmail Pub/Sub push | HMAC token (`GMAIL_WEBHOOK_TOKEN`) |

---

## 6. Frontend Permission Enforcement

Frontend permission checks are **advisory only** — all security is enforced server-side.

| Feature | Frontend check | Server-side guard |
|---|---|---|
| CEO Cockpit nav | `isAdmin` check in sidebar | `requireAdmin` on all CEO routes |
| Capital nav | `capital permission` from session | `requireCapitalAccess` on all `/api/capital/*` |
| Board Pack nav | `isBoardPackUser` check | `requireBoardPackAccess` on all board pack routes |
| Runway/Funding nav | capital permission check | `requireForecastCapitalAccess` |
| Admin panel nav | `isAdmin` check | `requireAdmin` on all `/api/admin/*` |
| Private Currents channels | not listed if not member | SQL membership filter on every query |
| DM conversations | not listed if not participant | SQL participant filter on every query |
| CRM create/edit buttons | permission check | `requirePermission("crm", "edit")` |
| Delete buttons (CRM) | permission check | `requirePermission("crm", "edit")` |
| Send email | explicit user action | `requireAuth` on all Gmail send routes |

---

## 7. Object-Level Authorization

| Resource | Check | Location |
|---|---|---|
| Task ownership/visibility | Hub access grants table + user ownership | `server/routes-tasks.ts` |
| Private Currents channel | `checkPrivateChannelAccess()` / SQL EXISTS | `server/routes.ts:34945` |
| DM thread content | SQL participant check | `server/routes.ts` DM queries |
| Capital records | `requireCapitalAccess` per-route | `server/routes-capital.ts` |
| Board pack records | `requireBoardPackAccess` per-route | `server/routes.ts` |
| Gmail mailbox | `asAccountId` scoped to session user's connections | Gmail routes |
| File attachments | ACL check (admin/uploader/section-perm) | `server/routes.ts:7200` |
| Investor portal | 64-char token hash match, status/expiry check | `server/routes-capital.ts:3295` |

---

## 8. Audit Logging

| Event | Logged | Location |
|---|---|---|
| CRM create/update/delete | ✓ `activities` table | Various CRM routes |
| Login | ✓ session create | `server/routes.ts:624` (session regeneration) |
| Gmail send | ✓ activity row | Gmail send route |
| Permission changes | ✓ admin routes log | `server/routes.ts` admin routes |
| Board pack finalize/archive | ✓ pack status update | `server/services/board-pack.ts` |
| Voice assistant denial | ✓ `assistant_denial` rows + file fallback | `server/voice-assistant-create-guards.ts` |
| Capital activity | ✓ `capital_activities` table | `server/routes-capital.ts` |
| Investor portal open | ✓ `capital_portal_events` table | `server/routes-capital.ts:3295` |

---

## 9. Security Infrastructure

| Control | Status | Notes |
|---|---|---|
| `helmet` security headers | ✓ Applied | CSP disabled pending nonce rollout |
| CSRF origin/referer guard | ✓ Fail-closed | `server/csrf.ts` — exact host match |
| Session cookie httpOnly | ✓ | `server/index.ts:119` |
| Session cookie sameSite=lax | ✓ | `server/index.ts:121` |
| Session cookie secure (prod) | ✓ | `server/index.ts:118` |
| SESSION_SECRET enforcement | ✓ Fail-closed | ≥32 chars; process.exit in prod if missing |
| Login rate limiting | ✓ | 10 attempts/IP/15 min |
| Password reset rate limiting | ✓ | `passwordResetRateLimiter` |
| AI generation rate limiting | ✓ | `aiGenerationRateLimiter` |
| Export rate limiting | ✓ | `exportRateLimiter` |
| Request body size limit | ✓ 10 MB | Express body-parser config |
| File upload limit | ✓ 50 MB / 100 MB assets | multer config |
| Stack traces in responses | ✗ None | Error handlers return `{ message }` only |
| Sensitive routes log suppression | ✓ | `SENSITIVE_LOG_PREFIXES` in `server/index.ts` |
| `getUsers()` response scope | ✓ id/name/email only | No password hashes |
| Seed users in production | ✓ Blocked | `seedUsers()` skips if `NODE_ENV=production` |
| WebAuthn second factor | ✓ Available | `server/routes.ts` |
| Gmail Pub/Sub webhook auth | ✓ `timingSafeEqual` | `GMAIL_WEBHOOK_TOKEN` |
| OAuth state nonce | ✓ Per-session | `oauthState` in session |
| Session fixation defense | ✓ | Session ID regenerated on login (`server/routes.ts:624`) |
