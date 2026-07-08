# VoltSafe CMS — Role, Widget & API Exposure Audit

**Date:** 2026-07-08  
**Status:** Draft — read-only audit, no broad fixes applied  
**Auditor:** Automated codebase sweep (6 parallel subagents + targeted greps)  
**Files analysed:** `server/routes.ts` (~40k LOC), `server/routes-capital.ts`, `server/auth.ts`, `client/src/App.tsx`, `client/src/lib/nav-config.ts`, `client/src/lib/dashboard-config.ts`, `shared/schema.ts`, `server/storage.ts`

---

## 1 — Executive Summary

| Category | Count |
|---|---|
| Total roles discovered | 9 (`master_admin`, `admin`, `advisor`, `sales`, `manager`, `analyst`, `executive`/`exec`, `ceo`, `cfo`) |
| Total frontend routes audited | 68 |
| Total widget types audited | 46 |
| Total API endpoint groups audited | ~140 |
| **Critical exposures** | **3** |
| **High-risk exposures** | **6** |
| **Medium-risk exposures** | **5** |
| Emergency patch required | **No** (no unauthenticated data leak; worst cases are auth-gated with no role check) |

**Top finding in one sentence:** Dozens of sensitive analytics and executive-intelligence API endpoints (KPIs, revenue, engagement, command centre, team wins, user list) are protected by `requireAuth` only — any logged-in user can read them regardless of their role or permission level.

---

## 2 — Role Inventory

| Role | Defined In | Active | Frontend Enforced | Route Enforced | Backend / API | Widget Enforced | Query Scoped | Notes |
|---|---|---|---|---|---|---|---|---|
| `master_admin` | `shared/schema.ts` globalRole; `server/auth.ts` | ✅ | ✅ (isAdmin()) | ✅ (requireAdmin) | ✅ bypasses all requirePermission | ✅ (canUserSeeWidget admin bypass) | N/A | Full bypass — no section restrictions |
| `admin` | `shared/schema.ts` globalRole; `server/auth.ts` | ✅ | ✅ (isAdmin()) | ✅ (requireAdmin) | ✅ bypasses all requirePermission | ✅ (canUserSeeWidget admin bypass) | N/A | Same bypass as master_admin in all current guards |
| `advisor` | `server/auth.ts` ADVISOR_BLOCKED_SECTIONS | ✅ | ✅ (advisorBlock()) | ✅ (requirePermission blocks crm/partnerships/quoting) | ✅ Hard-blocked on 3 sections | ⚠️ Frontend only | ⚠️ Partial | Explicitly blocked from crm, partnerships, quoting |
| `sales` | `shared/schema.ts` default globalRole | ✅ | ⚠️ (permKey-based only) | ⚠️ (requirePermission) | ⚠️ (requirePermission) | ⚠️ Frontend only | ⚠️ Partial | Default role; maps to "sales" command centre |
| `manager` | `server/routes.ts` TEAM_CALENDAR_EDIT_ROLES | ⚠️ UI-only | ❌ No sidebar rule | ❌ Not in requirePermission | ❌ Not in any backend guard | ⚠️ Frontend only (managerOnly) | ❌ None | Used in dashboard-config managerOnly; no backend equivalent |
| `analyst` | `client/src/lib/dashboard-config.ts` detectCenterType | ⚠️ UI-only | ❌ None | ❌ None | ❌ None | ❌ None | ❌ None | Recognised only in center-type detection; no actual gate |
| `executive` / `exec` | `server/routes.ts` TEAM_CALENDAR_EDIT_ROLES | ⚠️ UI-only | ❌ None | ❌ None | ❌ None | ❌ None | ❌ None | Team calendar edit only; no security meaning |
| `ceo` / `cfo` | `server/routes.ts` TEAM_CALENDAR_EDIT_ROLES | ⚠️ UI-only | ❌ None (only via job-title heuristic) | ❌ None | ❌ None | ❌ Soft heuristic only | ❌ None | Not enforced as a real access control role anywhere |
| `read-only` | `shared/schema.ts` `role` column default | ⚠️ Legacy | ❌ None | ❌ None | ❌ None | ❌ None | ❌ None | Legacy field; `globalRole` is the operative field |

**Capital access — special identity allowlist (not role-based):**

| User | Mechanism | Routes Unlocked |
|---|---|---|
| Trevor Burgess (userId=4) | `CAPITAL_ALLOWED_USER_IDS` | All `/api/capital/*`, `/api/board-packs/*`, `/api/today/ceo-forecast/*` |
| scott.carlson@voltsafe.com | `CAPITAL_ALLOWED_EMAILS` | All `/api/capital/*`, `/api/board-packs/*` |
| Any user with `permissions.capital ≠ "none"` | `requireForecastCapitalAccess` only | `/api/today/ceo-forecast/runway`, `/api/today/ceo-forecast/funding` only |

---

## 3 — Page / Module Access Matrix

Legend: **FE** = frontend only guard · **BE** = backend guard · **Both** = enforced on both sides · **None** = no guard at either layer

| Area / Module | Route | Sidebar | Direct URL | Auth Required | Permission / Role | Sensitive Data | Risk | Recommended Rule |
|---|---|---|---|---|---|---|---|---|
| Mission Control / Root | `/` | All | All | ✅ | None (wrap) | Command centre KPIs | Medium | `crm:view` or role gate |
| Today | `/today` | All | All | ✅ | None (wrap) | Executive summary, revenue, capital (filtered) | Medium | Scope to role |
| Inbox & Mail | `/gmail` | All | All | ✅ | None in App.tsx | User's own email | Low | Accept — API scoped by account |
| Tasks | `/execution/tasks` | All | All | ✅ | None (wrap) | Task data | Low | Accept |
| Calendar | `/execution/calendar` | All | All | ✅ | `calendar:view` FE + BE | Calendar events | Low | Accept |
| Daily Execution | `/execution/daily` | All | All | ✅ | None (wrap) | Team schedule | Low | Add `crm:view` |
| Pipeline Snapshot | `/pipeline` | crm:view | Any auth | ✅ | `crm:view` FE + BE | Pipeline metrics | Low | Accept |
| Leads & Accounts | `/opportunities` | crm:view | Any auth | ✅ | `crm:view` FE + BE | CRM records | Low | Accept |
| Accounts | `/accounts` | crm:view | Any auth | ✅ | `crm:view` FE + BE | CRM records | Low | Accept |
| Contacts | `/contacts` | crm:view | Any auth | ✅ | `crm:view` FE + BE | Contact PII | Low | Accept |
| Quotes | `/quotes` | quoting | Any auth | ✅ | `quoting:view` FE + BE | Deal values | Low | Accept |
| Outreach | `/booking-outreach` | crm | Any auth | ✅ | `crm:view` FE + BE | Booking data | Low | Accept |
| Revenue Tools | `/price-lists` | quoting | Any auth | ✅ | `quoting:view` FE + BE | Pricing | Low | Accept |
| Install & Deployments | `/install-workflows` | crm | Any auth | ✅ | `crm:view` FE only, `crm` BE | Deployment data | Low | Accept |
| Projects | `/execution/projects` | projects | Any auth | ✅ | `projects:view` FE + BE | Project data | Low | Accept |
| Procurement | `/procurement` | crm | Any auth | ✅ | `requireAuth` only on `/api/procurement/*` | Supplier/inventory | **Medium** | Add `crm:view` to procurement API |
| Support | `/support/tickets` | support | Any auth | ✅ | `support:view` FE + BE | Ticket PII | Low | Accept |
| Document Hub | `/documents` | All | All | ✅ | None (wrap) | Company docs | Low | Accept — internal docs |
| Data Quality | `/data-quality` | crm | Any auth | ✅ | `crm:view` FE + BE | CRM metrics | Low | Accept |
| Executive Dashboard | `/executive-dashboard` | crm | Any auth | ✅ | `crm:view` FE + BE | Executive KPIs | Low | Consider manager gate |
| Revenue Intelligence | `/revenue-intelligence` | crm | Any auth | ✅ | `crm:view` FE, `requireAuth` only on API | Champion scores, buying committee | **High** | Add `crm:view` to `/api/revenue-intelligence/*` |
| Attribution | `/analytics/source-attribution` | crm | Any auth | ✅ | `crm:view` FE + BE | Lead attribution | Low | Accept |
| Rel. Intelligence | `/intelligence/rel-intelligence` | All | All | ✅ | None (wrap) | Contact warmness | Low | Add `crm:view` |
| Cortex (Executive Copilot) | `/executive-copilot` | All | All | ✅ | None (wrap) | AI-generated insights | Low | Accept |
| Cortex Intel Library | `/cortex/intel` | All | All | ✅ | None (wrap) | AI training data | Low | Accept |
| Revenue Hub | `/revenue` | All (no advisor) | Any auth | ✅ | `advisorBlock` only | Revenue data | **Medium** | Add `crm:view` |
| Revenue Ops | `/revenue-ops` | All (no advisor) | Any auth | ✅ | `advisorBlock` only | Revenue analysis | **Medium** | Add `crm:view` |
| Revenue Sim | `/revenue-sim` | All (no advisor) | Any auth | ✅ | `advisorBlock` only | Revenue projections | **Medium** | Add `crm:view` |
| Currents | `/current` | All | All | ✅ | None (wrap); private channels enforce membership on backend | Channel messages | Low | Accept — BE enforces membership |
| Ecosystem / Partnerships | `/strategy/partnerships/*` | partnerships | Any auth | ✅ | `partnerships:view` FE + BE | Partner data | Low | Accept |
| Marketing | `/marketing/*` | crm | Any auth | ✅ | `crm:view` FE + BE | Campaign/lead data | Low | Accept |
| Capital | `/capital/*` | capitalOnly | Any auth | ✅ | `capitalGuard` FE + `requireCapitalAccess` BE | Investor PII, deal sizes, commitments | Low | Accept — well protected |
| Board Pack | `/board-pack` | No sidebar | Any auth | ✅ | `wrap()` FE only; `requireBoardPackAccess` BE | Executive board data | **Medium** | Add `capitalGuard()` in App.tsx |
| Learn / Training | `/training`, `/help` | All | All | ✅ | None (wrap) | Docs | Low | Accept |
| Email Signatures | `/settings/signatures` | All | All | ✅ | None (wrap) | User's own sig | Low | Accept |
| AI Voice Profiles | `/settings/voice-profiles` | All | All | ✅ | None (wrap) | User's voice data | Low | Accept |
| Settings | `/settings` | Admin sidebar | **Any auth** | ✅ | `wrap()` only | System config | **Medium** | Add `requireAdmin` frontend guard |
| Admin → Users & Roles | `/admin/users` | Admin only | **Any auth** | ✅ | `wrap()` FE; `requireAdmin` on all API | User list, roles | **Medium** | Add `isAdmin` check in frontend route |
| Admin → Role Manager | `/admin/roles` | Admin only | **Any auth** | ✅ | `wrap()` FE; `requireAdmin` on all API | Role definitions | **Medium** | Add `isAdmin` check in frontend route |
| Admin → Integrations | `/admin/integrations` | Admin only | **Any auth** | ✅ | `wrap()` FE | Integration config | **Medium** | Add `isAdmin` check in frontend route |
| Admin → Task Hub Access | `/admin/task-hub-access` | Admin only | **Any auth** | ✅ | `wrap()` FE; `requireAdmin` on all API | User access config | **Medium** | Add `isAdmin` check in frontend route |
| Admin → Mailboxes | `/settings/mailbox` | Admin only | **Any auth** | ✅ | `wrap()` FE; `requireAdmin` on most API | Email account list | **Medium** | Add `isAdmin` check in frontend route |
| Admin → User Signatures | `/admin/signatures` | Admin only | **Any auth** | ✅ | `wrap()` FE; `requireAdmin` on all API | User signatures | **Medium** | Add `isAdmin` check in frontend route |
| Admin → Automations | `/automations` | Admin only | **Any auth** | ✅ | `wrap()` FE only | Automation rules | **Medium** | Add `requireAdmin` frontend guard |
| Investor Portal | `/investor-portal/*` | None | Public | ❌ | Token-based hash (SHA-256, revocable) | Limited investor materials | Low | Accept — intentionally public |
| Field Mode | `/field` | Mobile only | Any auth | ✅ | None (wrap) | Geo + nearby | Low | Accept |

---

## 4 — Widget Access Matrix

Command centre types: `ceo`, `cfo`, `cto`, `cmo`, `sales`, `cs`, `default`

| Widget | Key | Center(s) | Component Path | API / Data Source | Frontend Gated | Backend Gated | Current Visible Roles | Direct API Roles | Sensitive Data | Risk | Recommended Rule |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Executive Summary | `mrr_overview` | ceo | `ceo-center.tsx` | `/api/executive/kpis` | managerOnly + crm | **No** — `requireAuth` only | Admin, manager | **All auth users** | MRR, ARR, pipeline value | **High** | Add `requirePermission("crm","view")` + `managerOnly` to BE |
| Pipeline Health | `pipeline_health` | ceo, default | `ceo-center.tsx` | `/api/executive/kpis` | crm:view | **No** — `requireAuth` only | crm:view users | **All auth users** | Deal counts, win rates | **High** | Add `crm:view` to BE |
| Revenue at Risk | `revenue_risk` | ceo, cfo | `cfo-center.tsx` | `/api/executive/kpis` | crm:view + manager | **No** — `requireAuth` only | Admin, manager | **All auth users** | Revenue exposure amounts | **High** | Add `crm:view` + managerOnly to BE |
| Close-Likelihood Deals | `close_opps_score` | sales | `command-centers/` | `/api/daily-command-center` | crm:view | ✅ `requirePermission("crm","view")` | crm:view | crm:view | Deal scores | Low | Accept |
| Churn Risk Signals | `churn_risk_score` | cs | `cs-center.tsx` | `/api/executive/kpis` | crm:view | **No** — `requireAuth` only | crm:view | **All auth users** | Account churn risk | **High** | Add `crm:view` to BE |
| Certification Blockers | `cert_blockers` | cto | `cto-center.tsx` | `/api/executive/kpis` | projects:view | **No** — `requireAuth` only | projects:view | **All auth users** | Cert project status | Medium | Add `projects:view` to BE |
| Deployment Blockers | `deployment_blockers` | cto | `cto-center.tsx` | `/api/executive/kpis` | projects:view | **No** — `requireAuth` only | projects:view | **All auth users** | Deployment issues | Medium | Add `crm:view` or `projects:view` to BE |
| Key Accounts Needing Action | `accounts_at_risk` | sales, cs, ceo | `command-centers/` | `/api/daily-command-center` | crm:view | ✅ `requirePermission("crm","view")` | crm:view | crm:view | Account risk | Low | Accept |
| Cash Pulse | `cash_pulse` | ceo, cfo | `ceo-center.tsx` | `/api/executive/kpis` | managerOnly + dept filter | **No** — `requireAuth` only | Admin + finance dept | **All auth users** | MRR/ARR/hardware revenue | **Critical** | Add `requirePermission("crm","view")` + managerOnly to BE |
| Board Pack Readiness | `board_pack_readiness` | ceo | `action-widgets.tsx` | `/api/command-center/widget-data` | managerOnly + jobTitle | **No** — `requireAuth` only | Admin + title match | **All auth users** | Board readiness score | **High** | Add `requireBoardPackAccess` or managerOnly to BE |
| Team Load Balancer | `team_load_balancer` | ceo | `action-widgets.tsx` | `/api/command-center/widget-data` | managerOnly + team_workload:view | **No** — `requireAuth` only | Admin, manager | **All auth users** | Per-member task loads | Medium | Add managerOnly BE check |
| Deal Velocity Tracker | `deal_velocity` | cmo, sales | `action-widgets.tsx` | `/api/command-center/widget-data` | crm:view + managerOnly | **No** — `requireAuth` only | Admin, manager | **All auth users** | Pipeline throughput, close time | Medium | Add `crm:view` to BE |
| Revenue Forecast Gap | `forecast_gap` | ceo, cfo | `action-widgets.tsx` | `/api/command-center/widget-data` | crm:view + managerOnly + dept | **No** — `requireAuth` only | Admin, manager, finance | **All auth users** | Revenue vs target gap | **High** | Add `crm:view` + managerOnly to BE |
| Today's Critical Actions | `today_critical_actions` | all | `action-widgets.tsx` | `/api/dashboard/today` | crm:view | ✅ `requireAuth` (user-scoped) | All crm:view | All auth users | User's own tasks | Low | Accept |
| My Inbox | `my_inbox` | all | `action-widgets.tsx` | `/api/gmail/messages` | None | ✅ Account-scoped | All | All auth users | User's own email | Low | Accept |
| Team Inboxes | `team_inboxes` | all | `action-widgets.tsx` | `/api/gmail/accounts/health` | None | ✅ Access-scoped | All | Accessible accounts only | Shared inbox counts | Low | Accept |
| AI Suggested Moves | `ai_suggested_moves` | all | `action-widgets.tsx` | `/api/suggestions/*` | crm:view | ✅ `requirePermission("crm","view")` | crm:view | crm:view | AI suggestions | Low | Accept |
| Open Quotes Aging | `open_quotes_aging` | various | `action-widgets.tsx` | `/api/quotes/*` | quoting:view | ✅ `requirePermission("quoting","view")` | quoting:view | quoting:view | Quote values | Low | Accept |
| CEO Cockpit (all sub-widgets) | `ceo_cockpit` | ceo page | `today.tsx` | `/api/today/ceo-cockpit/*` | Admin only (page guard) | ✅ `requireAdmin` | Admin only | Admin only | 1-on-1 notes, strategic agenda | Low | Accept — well guarded |
| CEO Briefing | `ceo_briefing` | ceo page | `today.tsx` | `/api/today/ceo-briefing/*` | Admin only | ✅ `requireAdmin` | Admin only | Admin only | Executive briefing | Low | Accept |
| CEO Actions | `ceo_actions` | ceo page | `today.tsx` | `/api/today/ceo-actions/*` | Admin only | ✅ `requireAdmin` | Admin only | Admin only | CEO action items | Low | Accept |

---

## 5 — API Protection Matrix (Sampled — Highest Risk First)

| Endpoint | Method | Current Protection | Data Returned | Sensitive | Roles Today | Should Be Allowed | Risk | Fix |
|---|---|---|---|---|---|---|---|---|
| `GET /api/executive/kpis` | GET | `requireAuth` only | MRR, ARR, churn risk, pipeline health, revenue exposure | **Yes** | All authenticated | Admin + manager + crm:view | **Critical** | Add `requirePermission("crm","view")` + admin/manager gate |
| `GET /api/executive/risk-alerts` | GET | `requireAuth` only | Risk alerts across pipeline, accounts, certs | **Yes** | All authenticated | Admin + manager + crm:view | **Critical** | Add `requirePermission("crm","view")` |
| `GET /api/users` | GET | `requireAuth` only | All users: id, name, email | **Yes** | All authenticated | All (minimal data) or Admin only | **Critical** | Return only `id, name` unless admin; or restrict to `requireAdmin` |
| `GET /api/today/summary` | GET | `requireAuth` only | Executive summary: pipeline, revenue, tasks, team, capital-gated section | **Yes** | All authenticated | Scoped to role | **High** | Add role-based section filtering |
| `GET /api/today/team-wins` | GET | `requireAuth` only | Team deal wins with revenue amounts | **Yes** | All authenticated | Admin + manager + crm:view | **High** | Add `requirePermission("crm","view")` |
| `GET /api/command-center` | GET | `requireAuth` only | All command-centre data across all widget types | **Yes** | All authenticated | Role-gated per widget | **High** | Add `requirePermission("crm","view")` at minimum |
| `GET /api/command-center/widget-data` | GET | `requireAuth` only | Aggregate widget data (cash pulse, board readiness, team load) | **Yes** | All authenticated | Role-gated per widget | **High** | Split by widget type with permission checks |
| `GET /api/revenue-intelligence/command-center` | GET | `requireAuth` only | Champion scores, buying committee, account momentum | **Yes** | All authenticated | `crm:view` only | **High** | Add `requirePermission("crm","view")` |
| `GET /api/revenue-intelligence/champions` | GET | `requireAuth` only | Champion contact scores per account | Yes | All authenticated | `crm:view` only | **High** | Add `requirePermission("crm","view")` |
| `GET /api/revenue-intelligence/heatmap` | GET | `requireAuth` only | Account revenue heatmap | Yes | All authenticated | `crm:view` only | **High** | Add `requirePermission("crm","view")` |
| `GET /api/engagement/contact/:id` | GET | `requireAuth` only | Email open/click tracking per contact | Yes | All authenticated | `crm:view` only | **High** | Add `requirePermission("crm","view")` |
| `GET /api/engagement/account/:id` | GET | `requireAuth` only | Email tracking per account | Yes | All authenticated | `crm:view` only | **High** | Add `requirePermission("crm","view")` |
| `GET /api/engagement/thread/:id` | GET | `requireAuth` only | Thread-level engagement (open/reply tracking) | Yes | All authenticated | Mail account access | Medium | Add account access check |
| `GET /api/executive/brief/today` | GET | `requireAuth` only | Today's executive brief (AI-generated) | Yes | All authenticated | Admin or crm:view | **High** | Add `requireAdmin` or `crm:view` |
| `GET /api/executive/alerts` | GET | `requireAuth` only | System-wide alerts | Yes | All authenticated | Admin or crm:view | **High** | Add `requirePermission("crm","view")` |
| `GET /api/executive/priorities` | GET | `requireAuth` only | Executive priority list | Yes | All authenticated | Admin or crm:view | **High** | Add `requirePermission("crm","view")` |
| `GET /api/dashboard/today` | GET | `requireAuth` only | Today's dashboard data | Medium | All authenticated | All (mostly user-scoped) | Low | Accept — mostly user-scoped |
| `GET /api/dashboard/needs-reply-high-engagement` | GET | `requireAuth` only | High-engagement threads needing reply | Yes | All authenticated | `crm:view` | Medium | Add `requirePermission("crm","view")` |
| `GET /api/email-engagement/:trackingId` | GET | `requireAuth` only | Email tracking pixel status | Yes | All authenticated | Mail account owner or admin | Medium | Add account ownership check |
| `GET /api/email-engagement/by-message/:id` | GET | `requireAuth` only | Engagement for a specific message | Yes | All authenticated | Mail account owner or admin | Medium | Add account ownership check |
| `GET /api/procurement/*` | GET | `requireAuth` only | Inventory, batches, orders | Yes | All authenticated | `crm:view` or operations role | Medium | Add `requirePermission("crm","view")` |
| `GET /api/deployments` | GET | `requireAuth` only | Site deployment data | Yes | All authenticated | `crm:view` or projects | Medium | Add permission check |
| `GET /api/admin/users` | GET | `requireAuth` + `requireAdmin` | All users with full profile, role, permissions | **Yes** | Admin only | Admin only | Low | Accept |
| `GET /api/capital/*` | GET | `requireAuth` + `requireCapitalAccess` | Investor PII, deal sizes, commitments | **Yes** | CEO + CFO only | CEO + CFO only | Low | Accept |
| `GET /api/today/ceo-cockpit/*` | GET | `requireAuth` + `requireAdmin` | 1-on-1 notes, strategic agenda | **Yes** | Admin only | Admin only | Low | Accept |
| `GET /api/today/ceo-forecast/*` | GET | `requireAuth` + `requireAdmin` + `requireForecastCapitalAccess` | Runway, burn rate, funding scenarios | **Yes** | CEO/CFO only | CEO/CFO only | Low | Accept |
| `GET /api/board-packs/*` | GET | `requireAuth` + `requireBoardPackAccess` | Board packs with full financials | **Yes** | CEO + CFO only | CEO + CFO only | Low | Accept |
| `POST /api/leads/import-marinas` | POST | `requirePermission("crm","edit")` | N/A — bulk import | Yes | crm:edit | crm:edit | Low | Accept |
| **Public endpoints (intentional)** | | | | | | | | |
| `GET /track/open/:id.gif` | GET | None (public) | Tracking pixel 1px GIF | No | Public | Public (email clients) | Low | Accept — intentional |
| `GET /track/click/:id` | GET | None (public) | Redirect | No | Public | Public | Low | Accept — intentional |
| `GET /api/marketing/unsubscribe/:token` | GET/POST | None (public) | Token-based unsubscribe | No | Public | Public | Low | Accept — intentional |
| `GET /api/investor-portal/:token` | GET | Token-based (SHA-256) | Curated investor materials | Curated | Token holder | Token holder | Low | Accept — intentional, revocable |
| `POST /api/webhooks/gmail` | POST | Token-based (timingSafeEqual) | N/A — inbound webhook | No | Google only | Google only | Low | Accept |

**Well-protected groups (all routes in these groups use `requireAuth` + `requireAdmin` or stronger):**
- `/api/admin/*` — requireAdmin on every mutation and read ✅
- `/api/today/ceo-cockpit/*` — requireAdmin ✅
- `/api/today/ceo-forecast/*` — requireAdmin + requireForecastCapitalAccess ✅
- `/api/capital/*` — requireCapitalAccess (identity allowlist) ✅
- `/api/board-packs/*` — requireBoardPackAccess ✅
- CRM: `/api/leads/*`, `/api/accounts/*`, `/api/contacts/*` — requirePermission("crm") ✅
- Quotes: `/api/quotes/*` — requirePermission("quoting") ✅

---

## 6 — Database Scoping Findings

| Query / Service / File | Data Area | Current Scope | Missing Scope | Sensitive | Risk | Recommended Scope |
|---|---|---|---|---|---|---|
| `storage.getUsers()` → `/api/users` | User list (all users) | None — returns all users | Role gate or field restriction | Yes — email enumeration | **High** | Return `{id, name}` to all auth; `{id, name, email, role}` to admin only |
| `/api/today/summary` handler | Executive summary | User's own tasks scoped; revenue/pipeline not scoped | Role or permission filter on revenue section | Yes — revenue, pipeline | **High** | Filter revenue/pipeline sections by `crm:view`; capital section is already internally gated |
| `/api/today/team-wins` handler | Team deal wins | None — returns all team wins | Role filter | Yes — deal names, amounts | **High** | Require `crm:view` |
| `/api/executive/kpis` handler | Executive KPIs | None | Role filter | Yes — MRR, ARR, churn, pipeline | **Critical** | Require `crm:view` + managerOnly |
| `/api/revenue-intelligence/*` handlers | Revenue intelligence | `requireAuth` only | Permission check | Yes — champion scores, buying committee | **High** | Require `crm:view` |
| `/api/engagement/contact/:id`, `/api/engagement/account/:id` | Email tracking per entity | `requireAuth` only | Permission check | Yes — email open/click data | **High** | Require `crm:view` |
| `/api/command-center` and `/api/command-center/widget-data` | All widget data | `requireAuth` only | Widget-level permission checks | Yes — financial, pipeline, team | **High** | Add per-section permission gating |
| Gmail routes (`/api/gmail/*`) | Email messages | `resolveAccount()` enforces account ownership | None missing | Yes — email content | Low | Accept — well scoped |
| Capital queries (`routes-capital.ts`) | Investor/funding data | `requireCapitalAccess` identity gate | None missing | Yes — investor PII, amounts | Low | Accept |
| CEO Cockpit queries | 1-on-1 notes, agenda | `requireAdmin` gate | None missing | Yes — strategic private notes | Low | Accept |
| Currents private channels | Channel messages | JOIN on `current_channel_members` | None missing | Yes — private messages | Low | Accept |
| DMs | Direct messages | `current_conversation_members` check | None missing | Yes — private messages | Low | Accept |
| `/api/procurement/*` handlers | Inventory, orders | `requireAuth` only | Permission filter | Yes — supplier/cost data | Medium | Require `crm:view` or operations permission |
| `/api/deployments` handlers | Deployment records | `requireAuth` only | Permission filter | Yes — site data | Medium | Require `crm:view` or `projects:view` |

---

## 7 — Top 10 Highest-Risk Exposure Issues

### #1 — CRITICAL: `/api/executive/kpis` returns MRR/ARR/churn to all authenticated users

**Why it matters:** MRR, ARR, churn risk, pipeline value, and revenue exposure are company confidential financials. Any intern, external advisor, or compromised low-privilege account can read them in a single API call.

**Who can access today:** Every authenticated user (`requireAuth` only)

**Who should access:** Admin, master_admin, and users with `crm:view` + manager/executive designation

**Files:** `server/routes.ts` ~line 24714, `server/services/` revenue service

**Recommended fix:** `app.get("/api/executive/kpis", requireAuth, requirePermission("crm", "view"), ...)` with additional `managerOnly` check inside the handler

---

### #2 — CRITICAL: `/api/executive/risk-alerts` and `/api/executive/priorities` — no role gate

**Why it matters:** Risk alerts span account health, certification failures, deployment blockers, and revenue risk signals — not appropriate for all staff.

**Who can access today:** Every authenticated user

**Who should access:** Admin + `crm:view`

**Files:** `server/routes.ts` ~lines 25015, 31319, 31341

**Recommended fix:** Add `requirePermission("crm", "view")`

---

### #3 — CRITICAL: `GET /api/users` — email enumeration for all authenticated users

**Why it matters:** `storage.getUsers()` returns `{id, name, email}` for every user in the system. Any authenticated user can enumerate all employee emails, which enables targeted phishing against VoltSafe staff.

**Who can access today:** Every authenticated user

**Who should access:** All auth users (for @-mentions, assignees) should get `{id, name}` only; full email should be admin-only

**Files:** `server/routes.ts` line 7312-7313, `server/storage.ts` line 1205

**Recommended fix:** Split into two responses — non-admin gets `{id, name}`; admin gets `{id, name, email, globalRole, permissions}`

---

### #4 — HIGH: `/api/today/summary` exposes revenue + pipeline section to all authenticated users

**Why it matters:** The summary endpoint powers the Today page and includes pipeline counts, revenue signals, and team activity. Capital data is conditionally gated inside the handler, but the rest is fully open.

**Who can access today:** Every authenticated user

**Who should access:** Revenue/pipeline section → `crm:view`; capital section → already correctly gated internally

**Files:** `server/routes.ts` ~line 10984

**Recommended fix:** Apply `requirePermission("crm","view")` or split the endpoint into permissioned sections

---

### #5 — HIGH: `/api/today/team-wins` — deal wins and revenue amounts exposed

**Why it matters:** Team wins include deal names, marina names, and revenue amounts. This is confidential sales data.

**Who can access today:** Every authenticated user

**Who should access:** `crm:view` minimum

**Files:** `server/routes.ts` ~line 10767

**Recommended fix:** Add `requirePermission("crm", "view")`

---

### #6 — HIGH: `/api/revenue-intelligence/*` — champion scores, buying committee data — no permission gate

**Why it matters:** Revenue intelligence surfaces who the buying champions are, their engagement scores, and account momentum — raw competitive intelligence useful to disgruntled employees or compromised accounts.

**Who can access today:** Every authenticated user

**Who should access:** `crm:view`

**Files:** `server/routes.ts` ~lines 1226–1311

**Recommended fix:** Add `requirePermission("crm", "view")` to all `/api/revenue-intelligence/*` routes

---

### #7 — HIGH: Widget APIs are all `requireAuth` only — frontend role gates don't protect them

**Why it matters:** Dashboard widgets like `cash_pulse` (MRR/ARR), `board_pack_readiness`, `team_load_balancer`, and `forecast_gap` are marked `managerOnly` in `dashboard-config.ts`. This is a frontend-only filter. A non-manager can still call `/api/command-center/widget-data` directly and receive all widget data.

**Who can access today:** Every authenticated user (direct API call)

**Who should access:** Per-widget permission level

**Files:** `client/src/lib/dashboard-config.ts` (frontend gate only), `server/routes.ts` ~lines 12117, 12286

**Recommended fix:** The `/api/command-center/widget-data` handler should check the widget's permission requirements against the requesting user before including each widget's data in the response

---

### #8 — HIGH: `/api/engagement/contact/:id` and `/api/engagement/account/:id` — email tracking data without permission

**Why it matters:** Exposes email open rates, click-through data, and engagement scores for contacts/accounts to any authenticated user regardless of whether they have CRM access.

**Who can access today:** Every authenticated user

**Who should access:** `crm:view`

**Files:** `server/routes.ts` ~lines 1166, 1174

**Recommended fix:** Add `requirePermission("crm", "view")`

---

### #9 — MEDIUM: Admin frontend pages load for any authenticated user via direct URL

**Why it matters:** Pages like `/admin/users`, `/admin/roles`, `/admin/integrations`, `/automations`, and `/settings` are wrapped only in `wrap()` in `App.tsx`. A non-admin user who navigates directly to these URLs sees the page shell — it may briefly expose structural information before the API calls fail with 403. More importantly, if any widget or section on these pages loads data that doesn't require admin on the backend (e.g., user's own settings), it will render.

**Who can access today:** Every authenticated user via direct URL

**Who should access:** Admin only

**Files:** `client/src/App.tsx` routes for `/admin/*`, `/settings`, `/automations`

**Recommended fix:** Wrap admin routes in `App.tsx` with an admin guard: `{() => isUserAdmin ? wrap(<AdminPage />) : <AccessDenied />}`

---

### #10 — MEDIUM: `/board-pack` frontend route uses `wrap()` — page loads for any authenticated user

**Why it matters:** The board pack page loads for any authenticated user. The backend APIs (`/api/board-packs/*`) are properly gated by `requireBoardPackAccess`, so no actual data leaks. But the page itself renders and shows the board pack UI shell, which could confuse users or expose UI structure information.

**Who can access today:** Any authenticated user can reach the page (no data shown due to 403 on APIs)

**Who should access:** CEO + CFO only

**Files:** `client/src/App.tsx` line for `/board-pack` route

**Recommended fix:** `{() => capitalGuard(<BoardPackPage />)}` in App.tsx

---

## 8 — Recommended Locked-Down Permission Model

### Proposed Roles

| Role | globalRole value | Inherits From | Notes |
|---|---|---|---|
| Master Admin | `master_admin` | All | Full bypass; can set any user's role |
| Admin | `admin` | All except capital | Full bypass except capital identity gate |
| Executive (CEO) | `executive` | Admin | Maps to CEO command centre; capital access via identity gate |
| Manager | `manager` | Sales + crm:edit + team_workload:edit | New: backend-enforced manager role |
| Sales | `sales` | crm, quoting, calendar | Default role |
| Marketing | `marketing` | crm:view, communications | New dedicated role |
| Operations | `operations` | crm:view, projects, support | New dedicated role |
| Finance / Capital | `finance` | crm:view only; capital via identity gate | No write access to CRM |
| CS (Customer Success) | `cs` | crm:view, support:edit | New dedicated role |
| Analyst | `analyst` | crm:view (read-only) | Reports, dashboards, no mutations |
| Advisor | `advisor` | No crm/partnerships/quoting | Existing; enforced at BE |
| Viewer | `viewer` | No section access | New: can only see Today + Currents + Learn |

### Recommended Permission Grants Per Role

```
master_admin:  ALL permissions = "edit" + capital identity gate
admin:         ALL permissions = "edit" (no capital unless identity gate)
executive:     crm="view", quoting="view", capital identity gate
manager:       crm="edit", quoting="edit", projects="edit", team_workload="edit", support="view"
sales:         crm="edit", quoting="edit", calendar="edit"
marketing:     crm="view", communications="edit"
operations:    crm="view", projects="edit", support="edit"
cs:            crm="view", support="edit"
finance:       crm="view"
analyst:       crm="view"
advisor:       (blocked from crm, partnerships, quoting regardless)
viewer:        all = "none"
```

### Recommended Permission Group → API Mapping

| Group | Backend Enforcement | Routes |
|---|---|---|
| `crm:view` | `requirePermission("crm","view")` | `/api/leads/*`, `/api/accounts/*`, `/api/contacts/*`, `/api/executive/kpis`, `/api/revenue-intelligence/*`, `/api/today/team-wins`, `/api/engagement/*` |
| `crm:edit` | `requirePermission("crm","edit")` | POST/PUT/DELETE on CRM entities |
| `quoting:view` | `requirePermission("quoting","view")` | `/api/quotes/*`, `/api/price-lists/*` |
| `projects:view` | `requirePermission("projects","view")` | `/api/deployments/*`, `/api/install-workflows/*` |
| `support:view` | `requirePermission("support","view")` | `/api/support/*`, `/api/tickets/*` |
| `managerOnly` | New backend check | `/api/today/team-wins`, revenue/MRR sections of `/api/today/summary`, `/api/command-center/widget-data` (cash_pulse, forecast_gap, board_pack_readiness) |
| `capital` | `requireCapitalAccess` (identity) | `/api/capital/*`, `/api/board-packs/*` |
| `admin` | `requireAdmin` | `/api/admin/*`, `/api/today/ceo-cockpit/*` |

---

## 9 — Appendix: Currently Unprotected but Intentionally Public Endpoints

These endpoints are deliberately public and do not represent security gaps:

| Endpoint | Reason |
|---|---|
| `GET /track/open/:id.gif`, `GET /track/click/:id` | Email tracking pixels — must load without auth in external email clients |
| `GET /api/marketing/track/open/:token.gif`, `GET /api/marketing/track/click/:token` | Campaign tracking pixels |
| `GET/POST /api/marketing/unsubscribe/:token` | Unsubscribe must work without login |
| `GET /api/investor-portal/:token` | External investor access via signed token |
| `POST /api/investor-portal/:token/events` | Portal view logging |
| `GET /api/booking-links/public/:token` | Public booking form |
| `POST /api/webhooks/gmail` | Google Pub/Sub push — authenticated by `GMAIL_WEBHOOK_TOKEN` (timingSafeEqual) |
| `POST /api/auth/login`, `/api/auth/forgot-password` | Auth infrastructure, rate-limited |
| `GET /health` | Health check for deployments |
| `GET /assets/cta/:filename` | Signature CTA images embedded in external emails |

---

## 10 — Currents Channel Security (Summary)

Private channels and DMs are **well-implemented** at the backend:

- `GET /api/current/channels` — SQL filters: `is_private = FALSE OR EXISTS (SELECT 1 FROM current_channel_members …)` ✅
- `GET /api/current/channels/:slug/messages` — `resolveChannelAccess()` returns 403 for non-members ✅
- Reactions, pins, uploads to private channels — membership checked ✅
- DM conversations — `current_conversation_members` checked on every endpoint ✅
- File attachments in private channels — membership re-checked at `/api/attachments/file/:fileName` ✅

No action required for Currents.

---

## 11 — Gmail / Email Security (Summary)

Gmail routes use `resolveAccount(userId, asAccountId, isAdmin, mailTeamPerms)` which:
- Verifies the requesting user owns or has shared access to the requested email account
- Respects `private_personal` mailbox classification (blocks access even for admins per `mailbox-visibility-privacy.md`)
- Falls back to the user's own accounts on unrecognised `asAccountId`

No systemic data leak found in Gmail routes. The `private_personal` classification fix (deployed 2026-07-08) is working correctly.

---

*End of audit. See `tests/security/role-widget-api-exposure-audit.test.cjs` for automated verification of current behaviour.*
