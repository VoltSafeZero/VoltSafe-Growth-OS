# VoltSafe Growth OS — Navigation & Permissions Audit

**Date:** 2026-06-27  
**Scope:** Read-only discovery. No code was changed, renamed, moved, or modified.  
**Auditor:** Replit Agent (read-only mode)  
**Key source files inspected:**  
- `client/src/lib/nav-config.ts` — single source of truth for sidebar items  
- `client/src/App.tsx` — frontend route definitions and access guards  
- `client/src/lib/dashboard-config.ts` — dashboard widget/center engine  
- `server/auth.ts` — `requireAuth`, `requireAdmin`, `requirePermission` middleware  
- `server/routes.ts` — all API routes (36k+ lines, 770 `requireAuth` usages, 68 `requireAdmin`, 272 `requirePermission`)  
- `shared/schema.ts` — database schema for the `users` table  
- `client/src/components/dashboard/app-sidebar.tsx` — sidebar filter logic  
- All page-level components in `client/src/pages/`  

---

## 1. Executive Summary

VoltSafe Growth OS has **66 unique nav entries** across 8 groups in `NAV_CONFIG`. Of these:

- **~50 are real, fully-implemented feature pages** with live data and API calls.
- **3 nav items silently render a different page** than their label implies (Meeting Briefs → Today; Signals & Alerts → Activity Feed; Forecasting → Pipeline Snapshot). These are the most confusing navigational facts in the system.
- **2 nav items share the same underlying component** under two different labels and routes: `Reports` and `Rel. Intelligence` both render `RelationshipIntelligencePage`.
- **Asset Library** (`/documents`) and **Assets** (`/knowledge/assets`) are two completely different feature pages that coexist under Operations, with overlapping names.
- **The "Channels" group name** collides semantically with the **CURRENTS messaging feature** (also described as channels internally), creating cognitive confusion for all users.
- **Dashboard surfaces** are partially consolidated: `Today` and `Mission Control` are the two live entry points; three older dashboard pages (`/command-center`, `/dashboard`, `/daily-command-center`) exist in the codebase but have **no nav links**.
- **The permission system has three layers** (nav visibility → frontend route guard → backend API gate) but they are **not consistently applied** across all modules. The backend is the authoritative security layer; the frontend guards provide UX but not security.
- **Role-based nav filtering is currently limited to two roles**: `advisor` (hard-blocked from CRM/partnerships/quoting) and `admin/master_admin` (sees the Admin section). All other roles see the same nav.
- The `More` group has **16 items** — it is a catch-all drawer that has become the largest section by count, containing genuinely different kinds of items: analytics tools, settings, automations, help, and CRM utilities.

---

## 2. Full Nav Inventory Table

> Legend — Disposition:  
> **Keep** | **Rename** | **Move** | **Merge into X** | **Gate by role** | **Remove** | **Needs decision**

### Group: TODAY

| # | Parent Group | Label | Route | Component File | Status | Purpose | Shares component? | Duplicate candidate? | Evidence | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Today | *(Today — desktop direct link)* | `/today` | `today.tsx` | ✅ Real | Customizable personal widget grid: tasks, pipeline, inbox signals, ops widgets. Independent of Mission Control. | No | No | `nav-config.ts:85-91`; `today.tsx` imports `DashboardGrid`, real API calls | **Keep** |
| 2 | Today (mobile only) | Today | `/today` | `today.tsx` | ✅ Real | Same page, mobile sub-item | Same as #1 | — | `nav-config.ts:87`, `showOn:["mobile"]` | **Keep** |
| 3 | Today (mobile only) | Field Mode | `/field` | `field.tsx` | ✅ Real | GPS-based field execution, ranked nearby stops, route builder, travel optimizer | No | No | `nav-config.ts:88`; `field.tsx` has full RankedStop/TripStop logic | **Keep** |
| 4 | Today (mobile only) | Nearby | `/field/nearby` | `field-nearby.tsx` | ✅ Real | Hyper-local nearby leads/accounts from GPS | No | No | `nav-config.ts:89`; separate page from Field | **Keep** |

---

### Group: WORK

| # | Parent Group | Label | Route | Component File | Status | Purpose | Shares component? | Duplicate candidate? | Evidence | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | Work | Mission Control | `/` | `role-command-center.tsx` | ✅ Real | Role-detecting dashboard engine. Renders CEO/CFO/CTO/CMO/Sales/CS sub-centers based on `detectCenterType()`. Personalized widget grid. | No | Yes — see §4 (dashboard audit) | `nav-config.ts:97`; `role-command-center.tsx` imports `CEOCommandCenter`, `CFOCommandCenter`, `buildDashboardConfig` | **Keep — rename TBD** |
| 6 | Work | My Travel | `/my-travel` | `my-travel.tsx` | ✅ Real | Day planner: task-linked marina stops, route builder, calendar integration | No | No | `nav-config.ts:98`; `my-travel.tsx` has full MarinasDayPlannerDialog | **Keep** |
| 7 | Work | Work Calendar | `/work/team-calendar` | `team-work-calendar.tsx` | ✅ Real | Team calendar view (shared/group events) | No | Partial — vs Calendar (#20) | `nav-config.ts:99`; separate component from CalendarPage | **Needs decision** |
| 8 | Work | Inbox | `/gmail` | `gmail-inbox.tsx` + `InboxFullScreenShell` | ✅ Real | Full-screen Gmail-mirrored email client | No | No | `nav-config.ts:100`; rendered outside AppShell | **Keep** |
| 9 | Work | CURRENTS | `/current` | `current.tsx` | ✅ Real | Team messaging: channels, DMs, reactions, threads | No | No (despite name collision with Channels group) | `nav-config.ts:101`; `current.tsx` | **Keep — label confusion with Channels group** |
| 10 | Work | Tasks | `/execution/tasks` | `tasks-hub.tsx` | ✅ Real | Kanban/list task management, CRM linking, labels, dependencies | No | No — vs Task Rules (#52) which is automation config | `nav-config.ts:102`; redirect exists: `/tasks → /execution/tasks` | **Keep** |
| 11 | Work | Calendar | `/execution/calendar` | `calendar.tsx` | ✅ Real | Personal/team calendar, CalDAV integration, permKey:"calendar" | No | Partial — vs Work Calendar (#7) | `nav-config.ts:103`; `guard("calendar", ...)` in App.tsx:333 | **Needs decision** |
| 12 | Work | Meeting Notes | `/meeting-notes` | `meeting-notes-index.tsx` + `meeting-notes-detail.tsx` | ✅ Real | AI-assisted meeting notes, per-meeting detail page | No | No | `nav-config.ts:104`; detail route `/meeting-notes/:id` | **Keep** |
| 13 | Work | Activity Feed | `/activity` | `activity-feed.tsx` | ✅ Real | Chronological feed: notes, emails, meetings, tasks, activities with CRM links | No | Yes — Signals & Alerts (#29) renders the SAME component | `nav-config.ts:105`; `/intelligence/signals → ActivityFeedPage` in App.tsx:287 | **Keep — Signals needs fix** |

---

### Group: PIPELINE *(permKey: "crm", advisorHidden)*

| # | Parent Group | Label | Route | Component File | Status | Purpose | Shares component? | Duplicate candidate? | Evidence | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| 14 | Pipeline | Snapshot | `/pipeline` | `pipeline.tsx` | ✅ Real | Deal pipeline kanban/table view, stage tracking | Yes — Forecasting (#27) renders same component | Yes vs Forecasting | `nav-config.ts:115`; `guard("crm", <PipelinePage canEdit=...>)` | **Keep — Forecasting needs fix** |
| 15 | Pipeline | Leads | `/opportunities` | `leads.tsx` | ✅ Real | Lead management, filtering, CRM CRUD | No | No | `nav-config.ts:116`; redirect: `/leads → /opportunities` | **Keep** |
| 16 | Pipeline | Accounts | `/accounts` | `accounts.tsx` | ✅ Real | Account/marina management | No | No | `nav-config.ts:117` | **Keep** |
| 17 | Pipeline | Contacts | `/contacts` | `contacts.tsx` | ✅ Real | Contact management | No | No | `nav-config.ts:118` | **Keep** |
| 18 | Pipeline | Quotes | `/quotes` | `quotes.tsx` | ✅ Real | Quote creation, status tracking; permKey:"quoting" | No | No | `nav-config.ts:119`; `guard("quoting", ...)` | **Keep** |
| 19 | Pipeline | Renewals | `/renewals` | `renewals.tsx` | ✅ Real | Customer renewal tracking | No | No | `nav-config.ts:120`; `guard("crm", <RenewalsPage>)` App.tsx:278 | **Keep** |
| 20 | Pipeline | Accounts Won | `/revenue/deals` | `leads.tsx` | ✅ Real | LeadsPage filtered to `lockedStatus="converted"`, title "Accounts Won" | Yes — same component as Leads (#15) with different prop | No — intentional filtered view | `nav-config.ts:121`; App.tsx:284 `pageTitle="Accounts Won"` | **Keep — filtered view is valid** |
| 21 | Pipeline | Booking Outreach | `/booking-outreach` | `booking-outreach.tsx` | ✅ Real | Outreach scheduling, marina booking workflows | No | No | `nav-config.ts:122` | **Keep** |
| 22 | Pipeline | Booking Analytics | `/booking-analytics` | `booking-analytics.tsx` | ✅ Real | Booking performance analytics | No | No | `nav-config.ts:123` | **Keep** |
| 23 | Pipeline | Notes | `/notes` | `notes-page.tsx` | ✅ Real | Freeform note management (global) | No | No | `nav-config.ts:124`; no permKey — visible to all | **Keep — consider moving to Work** |

---

### Group: OPERATIONS

| # | Parent Group | Label | Route | Component File | Status | Purpose | Shares component? | Duplicate candidate? | Evidence | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| 24 | Operations | Install Workflows | `/install-workflows` | `install-workflows.tsx` | ✅ Real | Hardware install workflow management, stage tracking; permKey:"crm" | No | No | `nav-config.ts:132` | **Keep** |
| 25 | Operations | Procurement | `/procurement` | `procurement.tsx` | ✅ Real | Purchase orders, inventory management; permKey:"crm" | No | No | `nav-config.ts:133` | **Keep** |
| 26 | Operations | Deployments | `/deployments` | `deployments.tsx` | ✅ Real | Site rollout manager, commissioning checklists; permKey:"crm" | No | No | `nav-config.ts:134`; mobileIcon:Truck | **Keep** |
| 27 | Operations | Projects | `/execution/projects` | `projects.tsx` | ✅ Real | Safety certification projects, milestones, attachments; permKey:"projects" | No | No | `nav-config.ts:135` | **Keep** |
| 28 | Operations | Events | `/operations/events` | `tradeshow-events.tsx` | ✅ Real | Tradeshow and events management | No | No | `nav-config.ts:136` | **Keep** |
| 29 | Operations | Communications | `/execution/communications` | `communications.tsx` | ✅ Real | Broadcast communications, email campaigns; permKey:"communications" | No | No | `nav-config.ts:137` | **Keep** |
| 30 | Operations | Asset Library | `/documents` | `documents.tsx` | ✅ Real | Smart Document Hub — document management, search, categorization | No | Yes — vs Assets (#31) | `nav-config.ts:138`; no permKey — all users | **Rename to "Documents" or "Document Hub"** |
| 31 | Operations | Assets | `/knowledge/assets` | `assets.tsx` | ✅ Real | Knowledge base assets (separate system); permKey:"knowledge" | No | Yes — vs Asset Library (#30) | `nav-config.ts:139`; `guard("knowledge", ...)` | **Rename to clarify** |

---

### Group: INSIGHTS

| # | Parent Group | Label | Route | Component File | Status | Purpose | Shares component? | Duplicate candidate? | Evidence | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| 32 | Insights | Executive Dashboard | `/executive-dashboard` | `executive-dashboard.tsx` | ✅ Real | KPI analytics: pipeline, quotes, installs, leads, risks; date range comparison; 982 lines | No | Partial — vs Mission Control | `nav-config.ts:147`; permKey:"crm", advisorHidden | **Keep** |
| 33 | Insights | Reports | `/relationships` | `relationship-intelligence.tsx` | ⚠️ **Naming drift** | Renders Relationship Intelligence page — not a reports page. Route is `/relationships`, label is "Reports". | Yes — SAME as Rel. Intelligence (#47) | **YES — identical to #47** | `nav-config.ts:148`; App.tsx:332 `/relationships → RelationshipIntelligencePage` | **Must rename or merge with #47** |
| 34 | Insights | Forecasting | `/execution/forecast` | `pipeline.tsx` | ⚠️ **Naming drift** | Renders `PipelinePage` — the same component as Snapshot (#14). No separate forecasting view. | Yes — SAME as Snapshot (#14) | **YES — same component** | `nav-config.ts:149`; App.tsx:283 `<PipelinePage canEdit=...>` | **Must resolve: build real forecast view or merge with Snapshot** |
| 35 | Insights | Source Attribution | `/analytics/source-attribution` | `source-attribution.tsx` | ✅ Real | Lead source tracking, attribution analysis; permKey:"crm" | No | No | `nav-config.ts:150` | **Keep** |
| 36 | Insights | Executive Copilot | `/executive-copilot` | `executive-copilot.tsx` | ✅ Real | AI copilot for daily decisions, critical alerts, suggested moves | No | No | `nav-config.ts:151` | **Keep** |
| 37 | Insights | Meeting Briefs | `/intelligence/briefs` | `today.tsx` | ⚠️ **Naming drift** | Renders TodayPage — the same component as Today (#1). No separate briefs view. | Yes — SAME as Today | **YES — same component** | `nav-config.ts:152`; App.tsx:285 `/intelligence/briefs → TodayPage` | **Must resolve: build briefs view or remove** |
| 38 | Insights | Signals & Alerts | `/intelligence/signals` | `activity-feed.tsx` | ⚠️ **Naming drift** | Renders ActivityFeedPage — same component as Activity Feed (#13). No signals-specific view. | Yes — SAME as Activity Feed | **YES — same component** | `nav-config.ts:153`; App.tsx:286 `/intelligence/signals → ActivityFeedPage` | **Must resolve: build signals view or remove** |
| 39 | Insights | Revenue Intelligence | `/revenue-intelligence` | `revenue-intelligence.tsx` | ✅ Real | Champion scoring, buying committee, heatmap, momentum signals; permKey:"crm" | No | No — different from Rel. Intelligence | `nav-config.ts:154` | **Keep — rename for clarity** |
| 40 | Insights | Territory & Geo | `/geography` | `geography.tsx` | ✅ Real | Region/territory management, geo mapping; permKey:"crm" | No | Partial vs Territory Routing (#49) | `nav-config.ts:155` | **Keep** |

---

### Group: CHANNELS *(permKey: "partnerships", advisorHidden)*

All 7 items render the **same component** (`partnerships.tsx` / `PartnershipsPage`) filtered by `typeSlug`. This is intentional.

| # | Parent Group | Label | Route | Component File | Status | Purpose | Shares component? | Duplicate candidate? | Evidence | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| 41 | Channels | Industry Partnerships | `/strategy/partnerships/industry-associations` | `partnerships.tsx` | ✅ Real | Industry association partners | Yes — all 7 Channels items share `PartnershipsPage` | No — intentional typeSlug filter | `nav-config.ts:165` | **Keep** |
| 42 | Channels | Dealers / Resellers | `/strategy/partnerships/channel-commercial` | `partnerships.tsx` | ✅ Real | Channel/dealer partner management | Yes | No | `nav-config.ts:166` | **Keep** |
| 43 | Channels | Strategic Alliances | `/strategy/partnerships/manufacturing` | `partnerships.tsx` | ✅ Real | Manufacturing/OEM alliances | Yes | No | `nav-config.ts:167` | **Keep** |
| 44 | Channels | Investors | `/strategy/partnerships/innovation-research` | `partnerships.tsx` | ✅ Real | Investor relations | Yes | No | `nav-config.ts:168` | **Keep** |
| 45 | Channels | Govt & Grants | `/strategy/partnerships/government-public` | `partnerships.tsx` | ✅ Real | Government and grant partners | Yes | No | `nav-config.ts:169` | **Keep** |
| 46 | Channels | Referrals | `/strategy/partnerships/other` | `partnerships.tsx` | ✅ Real | Referral partner management | Yes | No | `nav-config.ts:170` | **Keep** |
| 47 | Channels | Media & Tradeshows | `/strategy/partnerships/media-tradeshows` | `partnerships.tsx` | ✅ Real | Media and tradeshow partners | Yes | No | `nav-config.ts:171` | **Keep** |

---

### Group: MORE *(catch-all drawer — 16 items)*

| # | Parent Group | Label | Route | Component File | Status | Purpose | Shares component? | Duplicate candidate? | Evidence | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| 48 | More | Daily Execution | `/execution/daily` | `daily-execution.tsx` | ✅ Real | Task-focused execution view: must-do, overdue, newly assigned, awaiting reply | No | No | `nav-config.ts:179` | **Move to Work group** |
| 49 | More | Revenue Hub | `/revenue` | `revenue.tsx` | ✅ Real | MRR dashboard, hardware contracts, slip rollout phases; permKey:"crm" | No | Partial — vs Revenue Ops, Revenue Sim | `nav-config.ts:180`; advisorHidden | **Keep — Move to Pipeline or Insights** |
| 50 | More | Revenue Ops | `/revenue-ops` | `revenue-ops.tsx` | ✅ Real | Plan commits, gap-to-plan analysis, AI actions, monthly history | No | Partial — vs Revenue Hub, Revenue Sim | `nav-config.ts:181`; advisorHidden | **Keep — Move to Insights** |
| 51 | More | Revenue Simulator | `/revenue-sim` | `revenue-sim.tsx` | ✅ Real | Scenario planning, deal simulation, saved scenarios | No | Partial — vs Revenue Hub, Revenue Ops | `nav-config.ts:182`; advisorHidden | **Keep — Move to Insights** |
| 52 | More | Rel. Intelligence | `/intelligence/rel-intelligence` | `relationship-intelligence.tsx` | ⚠️ **Duplicate** | Renders RelationshipIntelligencePage — SAME component as "Reports" (#33) | Yes — SAME as Reports (#33) | **YES — identical to #33** | `nav-config.ts:183`; App.tsx:287 | **Merge: pick one label/route, remove the other** |
| 53 | More | Score Feedback | `/scores/feedback` | `score-feedback.tsx` | ✅ Real | Predictive score submission for model feedback; 6 score models, outcome tracking | No | No | `nav-config.ts:184`; advisorHidden | **Keep — Gate by role (ops/admin)** |
| 54 | More | Digest & Alerts | `/alerts-digest` | `alerts-digest.tsx` | ✅ Real | Digest configuration: cadence, channels, section toggles, quiet hours, alert rules | No | Partial vs "Signals & Alerts" (#38) by name only | `nav-config.ts:185` | **Keep — Rename "Digest Settings" to distinguish from Signals** |
| 55 | More | Territory Routing | `/routing` | `territory-routing.tsx` | ✅ Real | Route planning and trip optimization (different from Territory & Geo) | No | Partial vs Territory & Geo (#40) | `nav-config.ts:186`; advisorHidden | **Keep — Move to Operations or Pipeline** |
| 56 | More | Data Quality | `/data-quality` | `data-quality.tsx` | ✅ Real | CRM data hygiene tooling; permKey:"crm" | No | No | `nav-config.ts:187` | **Keep — Move to Operations or Admin** |
| 57 | More | Price Lists | `/price-lists` | `price-lists.tsx` | ✅ Real | Pricing tables; permKey:"quoting" | No | No | `nav-config.ts:188` | **Keep — Move to Pipeline** |
| 58 | More | Task Rules | `/automation/tasks` | `task-rules-settings.tsx` | ✅ Real | Automation rules specifically for tasks (trigger-based, conditions, actions) | No | No — vs Tasks (#10), vs Automations (#59) | `nav-config.ts:189` | **Keep — Move into Automations as a tab** |
| 59 | More | Automations | `/automations` | `automations.tsx` | ✅ Real | Full automation rule builder: triggers, conditions, multi-action, templates, run logs | No | Partial vs Task Rules (#58) | `nav-config.ts:190` | **Keep** |
| 60 | More | Training | `/training` | `training-hub.tsx` | ✅ Real | Video training playlists, progress tracking (some videos pending hosting) | No | No | `nav-config.ts:191` | **Keep** |
| 61 | More | Help | `/help` | `help-center.tsx` | ✅ Real | In-app help center and documentation | No | No | `nav-config.ts:192` | **Keep** |
| 62 | More | Support Tickets | `/support/tickets` | `tickets.tsx` | ✅ Real | Customer support ticket management; permKey:"support" | No | No | `nav-config.ts:193` | **Move to Operations** |
| 63 | More | Winter Support | `/winter` | `winter-hub.tsx` | ✅ Real | Seasonal product support hub: cases, KB, response templates, product registry | No | No | `nav-config.ts:194`; permKey:"support" | **Move to Operations or Support** |

---

### Group: ADMIN *(adminOnly)*

| # | Parent Group | Label | Route | Component File | Status | Purpose | Shares component? | Duplicate candidate? | Evidence | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 | Admin | Users | `/admin/users` | `admin-users.tsx` | ✅ Real | User management, suspend/activate, permissions, role assignment | No | No | `nav-config.ts:205` | **Keep** |
| 65 | Admin | Task Hub Access | `/admin/task-hub-access` | `admin-task-access.tsx` | ✅ Real | Cross-user task access grants | No | No | `nav-config.ts:206` | **Keep** |
| 66 | Admin | Integrations | `/admin/integrations` | `admin-integrations.tsx` | ✅ Real | Google, Jira, Confluence integration management | No | No | `nav-config.ts:207` | **Keep** |
| 67 | Admin | User Signatures | `/admin/signatures` | `admin-signatures.tsx` | ✅ Real | Manage email signatures for all users | No | Partial vs "Email Signatures" (#68) | `nav-config.ts:208` | **Rename: "Manage User Signatures" to distinguish** |
| 68 | Admin | Role Manager | `/admin/roles` | `admin-roles.tsx` | ✅ Real | Role definition management | No | No | `nav-config.ts:209` | **Keep** |
| 69 | Admin | My Mailboxes | `/settings/mailbox` | `mailbox-settings.tsx` | ✅ Real | OAuth mailbox connect/disconnect; adminOnly:true | No | No | `nav-config.ts:210` | **Keep** |
| 70 | Admin | Email Signatures | `/settings/signatures` | `signature-settings.tsx` | ✅ Real | Personal email signature editor; **adminOnly: false** flag but sits in admin section | No | Partial vs User Signatures (#67) | `nav-config.ts:211`; `adminOnly: false` ← note | **Move to Work or Settings — not truly admin-only** |
| 71 | Admin | AI Voice Profiles | `/settings/voice-profiles` | `ai-voice-profiles.tsx` | ✅ Real | Personal AI voice profile training; **adminOnly: false** | No | No | `nav-config.ts:212`; `adminOnly: false` ← note | **Move to Work or Settings — not truly admin-only** |
| 72 | Admin | Global Search | `/search` | inline component in App.tsx | ✅ Real | Full-text search launcher page (Cmd+K shortcut preferred) | No | No | `nav-config.ts:213`; adminOnly:true | **Ambiguous — why admin-only?** |
| 73 | Admin | Settings | `/settings` | `settings.tsx` | ✅ Real | General settings | No | No | `nav-config.ts:214`; adminOnly:true, exactMatch:true | **Keep** |

---

### Routes in codebase with NO nav entry

| Route | Component | Status | Notes |
|---|---|---|---|
| `/command-center` | `command-center.tsx` | 🟡 Legacy/orphan | Functional dashboard, no nav link |
| `/dashboard` | `dashboard.tsx` | 🟡 Legacy/orphan | Older dashboard with calendar/map, no nav link |
| `/board-pack` | `board-pack.tsx` | ✅ Real | Full board-pack report builder — no nav link! |
| `/settings/mailbox-health` | `mailbox-health.tsx` | ✅ Real | Mailbox health diagnostics — no nav link |
| `/jira` | `jira.tsx` | ✅ Real | Jira integration page — no nav link |
| `/confluence` | `confluence.tsx` | ✅ Real | Confluence integration page — no nav link |
| `/field` | `field.tsx` | ✅ Real | Mobile-only, accessible via Today sub-items |
| `/field/nearby` | `field-nearby.tsx` | ✅ Real | Mobile-only |

---

## 3. Duplicate / Overlap Investigation

### 3.1 — Calendar vs Work Calendar

| Item | Route | Component |
|---|---|---|
| Calendar | `/execution/calendar` | `calendar.tsx` |
| Work Calendar | `/work/team-calendar` | `team-work-calendar.tsx` |

**Verdict: DIFFERENT real features — keep separate.**

`CalendarPage` handles personal/CRM-linked calendar events, CalDAV integration, and is gated by `permKey:"calendar"`. `TeamWorkCalendarPage` is a shared team availability/scheduling view with no permission gate. The names are close but the purposes are genuinely different. **Recommended resolution:** Rename to distinguish clearly (e.g., "My Calendar" vs "Team Calendar").

---

### 3.2 — Tasks vs Task Rules

| Item | Route | Component |
|---|---|---|
| Tasks | `/execution/tasks` | `tasks-hub.tsx` |
| Task Rules | `/automation/tasks` | `task-rules-settings.tsx` |

**Verdict: DIFFERENT real features — keep separate.**

Tasks is the work-item kanban/list for daily execution. Task Rules is an automation engine that fires tasks based on CRM triggers. They are distinct product surfaces. **Recommended resolution:** Move Task Rules inside Automations as a tab (currently they are two separate sidebar items). This would collapse two More items into one.

---

### 3.3 — Signals & Alerts vs Digest & Alerts

| Item | Route | Component |
|---|---|---|
| Signals & Alerts | `/intelligence/signals` | `activity-feed.tsx` ← wrong |
| Digest & Alerts | `/alerts-digest` | `alerts-digest.tsx` |

**Verdict: SAME component for Signals (naming drift) + DIFFERENT real feature for Digest.**

`/intelligence/signals` currently renders `ActivityFeedPage` — the exact same component as Activity Feed in the Work group. This is **not** a signals/alerts product; it is the activity feed rendered under a different label. The "Signals & Alerts" label implies a filtered, prioritized signal feed that does not currently exist. Meanwhile Digest & Alerts is a genuinely distinct product: scheduled digest config, alert rule management, quiet hours.

**Recommended resolution:**
- Either build a true Signals view (filtered/prioritized activity + alerts) or remove the Signals & Alerts nav item.
- Rename "Digest & Alerts" to "Digest Settings" or "Alert Preferences" to distinguish it from real-time signals.

---

### 3.4 — Revenue Intelligence vs Rel. Intelligence vs Revenue Hub vs Revenue Ops vs Revenue Simulator

| Item | Route | Component |
|---|---|---|
| Revenue Intelligence (Insights) | `/revenue-intelligence` | `revenue-intelligence.tsx` |
| Rel. Intelligence (More) | `/intelligence/rel-intelligence` | `relationship-intelligence.tsx` |
| Reports (Insights) | `/relationships` | `relationship-intelligence.tsx` ← same as Rel. Intel |
| Revenue Hub (More) | `/revenue` | `revenue.tsx` |
| Revenue Ops (More) | `/revenue-ops` | `revenue-ops.tsx` |
| Revenue Simulator (More) | `/revenue-sim` | `revenue-sim.tsx` |

**Verdicts:**

- **Revenue Intelligence** ≠ **Rel. Intelligence**: Different products. Revenue Intel = champion scoring, buying committee, momentum. Rel. Intelligence = contact warmth, dormant leads, multi-threaded views.
- **Reports = Rel. Intelligence**: SAME underlying component. `/relationships` and `/intelligence/rel-intelligence` both render `RelationshipIntelligencePage`. This is a straightforward naming drift and duplicate nav entry.
- **Revenue Hub, Revenue Ops, Revenue Simulator**: Three genuinely different tools (MRR snapshot vs plan-commit gap-to-plan vs scenario modeling). Could be consolidated into one "Revenue" section with tabs, but are currently real, separate pages.

**Recommended resolutions:**
1. Remove "Reports" nav item; merge with "Rel. Intelligence" under one canonical label and route.
2. Consider grouping Revenue Hub + Revenue Ops + Revenue Simulator under a "Revenue Suite" sub-section.
3. Move all three revenue tools out of "More" and into "Insights" or "Pipeline."

---

### 3.5 — Territory & Geo vs Territory Routing

| Item | Route | Component |
|---|---|---|
| Territory & Geo | `/geography` | `geography.tsx` |
| Territory Routing | `/routing` | `territory-routing.tsx` |

**Verdict: DIFFERENT real features — keep separate.**

Territory & Geo = region/territory management, Leaflet map, CRM account density. Territory Routing = route planning, ranked stops, trip optimizer, live GPS navigation. These are complementary but distinct tools. **Recommended resolution:** Group them together (both under an "Operations" or "Field" section) rather than splitting across Insights and More.

---

### 3.6 — Today vs Mission Control vs Company Overview vs Growth Dashboard vs Executive Dashboard vs My Dashboard

| Name | Route | Component | In Nav? |
|---|---|---|---|
| Today | `/today` | `today.tsx` | ✅ Yes |
| Mission Control | `/` | `role-command-center.tsx` | ✅ Yes |
| Command Center | `/command-center` | `command-center.tsx` | ❌ No nav link |
| Dashboard | `/dashboard` | `dashboard.tsx` | ❌ No nav link |
| Daily Command Center | *(no route found)* | `daily-command-center.tsx` | ❌ Not routed |
| Executive Dashboard | `/executive-dashboard` | `executive-dashboard.tsx` | ✅ Yes (Insights) |
| Company Overview | *(does not exist)* | — | — |
| Growth Dashboard | *(does not exist)* | — | — |
| My Dashboard | *(does not exist)* | — | — |

**Verdict: PARTIAL overlap — see §4 for full dashboard architecture analysis.**

"Company Overview," "Growth Dashboard," and "My Dashboard" do not exist as routes or components. They may be product planning names that were never built or were folded into Mission Control.

---

### 3.7 — Asset Library vs Assets

| Item | Route | Component | Permission |
|---|---|---|---|
| Asset Library | `/documents` | `documents.tsx` | None (all users) |
| Assets | `/knowledge/assets` | `assets.tsx` | permKey:"knowledge" |

**Verdict: DIFFERENT real features — but naming is deeply confusing.**

Asset Library (`/documents`) is the Smart Document Hub for CRM-linked documents, attachments, and categorized files. Assets (`/knowledge/assets`) is the knowledge base asset library — a separate system for knowledge management resources. These are two different products that happen to share the word "asset." Both are real and functional.

**Recommended resolution:** Rename to eliminate the overlap. Suggestions: "Document Hub" + "Knowledge Assets," or "File Library" + "Knowledge Base."

---

### 3.8 — Projects under Work vs Operations

**Verdict: NOT a duplicate — only one Projects exists.**

There is exactly one "Projects" nav entry, under Operations → `/execution/projects` → `projects.tsx`. There is no "Projects under Work" in the current nav config. No action needed.

---

### 3.9 — Channels (ecosystem) vs CURRENTS (messaging)

| Item | Group | Route | Component |
|---|---|---|---|
| Channels group | Channels | `/strategy/partnerships/*` | `partnerships.tsx` |
| CURRENTS | Work | `/current` | `current.tsx` |

**Verdict: DIFFERENT features — naming collision only.**

The "Channels" sidebar group refers to business ecosystem channels (industry partners, dealers, etc.). "CURRENTS" is the team messaging product. Internally, CURRENTS discusses "channels" in the messaging sense (like Slack channels). These are completely different product surfaces that share terminology.

**Recommended resolution:** The collision is cosmetic but creates mental model confusion. Consider renaming the Channels sidebar group to "Partnerships" (which better describes its content) to eliminate the ambiguity.

---

### 3.10 — Reports vs Executive Dashboard vs Company/Growth dashboard surfaces

| Item | Route | Component |
|---|---|---|
| Reports | `/relationships` | `relationship-intelligence.tsx` |
| Executive Dashboard | `/executive-dashboard` | `executive-dashboard.tsx` |

**Verdict: "Reports" is a naming drift that renders the wrong thing. Executive Dashboard is a real, distinct product.**

"Reports" renders Relationship Intelligence — it is not a reporting surface. Executive Dashboard is a separate KPI analytics page with pipeline comparison, quote stats, install metrics, and risk alerts. These are not duplicates of each other, but the "Reports" label is entirely misleading.

**Recommended resolution:** Remove "Reports" from nav. Expose Relationship Intelligence directly under that name, either in Insights or More.

---

## 4. Dashboard Architecture Audit

### 4.1 — Are these separate routes?

| Surface | Route | Separate Route? |
|---|---|---|
| Mission Control | `/` | ✅ Yes |
| Today | `/today` | ✅ Yes |
| Executive Dashboard | `/executive-dashboard` | ✅ Yes |
| Command Center | `/command-center` | ✅ Yes — but not in nav |
| Dashboard | `/dashboard` | ✅ Yes — but not in nav |
| Daily Command Center | *(no route registered in App.tsx)* | ❌ Page file exists but is not routed |
| Meeting Briefs | `/intelligence/briefs` | Routes to Today — not a real separate surface |

### 4.2 — Are they separate components?

| Surface | Component | Unique? |
|---|---|---|
| Mission Control (`/`) | `role-command-center.tsx` | ✅ Unique — role-detecting engine |
| Today | `today.tsx` | ✅ Unique |
| Executive Dashboard | `executive-dashboard.tsx` | ✅ Unique |
| Command Center | `command-center.tsx` | ✅ Unique — but orphaned |
| Dashboard | `dashboard.tsx` | ✅ Unique — but orphaned |
| Daily Command Center | `daily-command-center.tsx` | ✅ Unique — but not routed |

### 4.3 — Do they share data/query logic?

- **Mission Control** and **Today** both use `dashboard-config.ts` (`canUserSeeWidget`, `buildDashboardConfig`, `WidgetDef`). They share the widget visibility rule framework, the `DashboardGrid` component, and the `widgetVisibility` user preference store. They save layouts under different keys (`dashboardLayouts.today` vs `dashboardLayouts[centerType]`).
- **Executive Dashboard** is entirely independent. It fetches from `/api/executive-dashboard/*` endpoints with its own data model.
- **Command Center** and **Dashboard** (orphaned) each have their own independent data fetching.

### 4.4 — Are any just filtered versions of the same dashboard?

No — the live surfaces (Mission Control, Today, Executive Dashboard) are genuinely different in purpose and data:
- **Mission Control**: Role-personalized, action-oriented, shows tasks/pipeline/emails/risks relevant to the logged-in user's role (CEO center vs Sales center etc.)
- **Today**: Fully user-customizable personal widget grid with independent layout storage
- **Executive Dashboard**: Company-wide KPI comparison page — aggregate, not personalized

### 4.5 — Are any placeholders?

- `command-center.tsx` — functional but has no nav link. Likely a previous iteration now superseded by `RoleCommandCenter`. **Candidate for removal.**
- `dashboard.tsx` — older dashboard, functional, no nav link. **Candidate for removal.**
- `daily-command-center.tsx` — file exists, no route in App.tsx, not reachable. **Dead code — candidate for removal.**

### 4.6 — Recommended future dashboard architecture

**Recommendation: Hybrid — two live entry points (Mission Control + Today), with the orphaned pages removed.**

```
/ → Mission Control (RoleCommandCenter)
    - Stays as the primary "home" dashboard
    - Already role-detecting (CEO/CFO/CTO/CMO/Sales/CS centers)
    - Widget customization exists

/today → Today
    - Stays as the personal action-list dashboard
    - Different use case: daily execution vs role intelligence

/executive-dashboard → Executive Dashboard
    - Stays as the aggregate analytics page
    - Keep in Insights — distinct audience (leadership)
```

**Remove or archive:** `/command-center`, `/dashboard`, and the unreachable `daily-command-center.tsx`.

### 4.7 — Evidence for recommendation

- `today.tsx` comment at top of file: *"fully customisable widget grid, completely independent of the Command Center."* — This documents the intentional separation.
- `dashboard-config.ts` comment: *"Widgets can declare gating rules across five axes"* — the widget system is already multi-surface aware.
- `dashboard-config.ts:1`: `CenterType = "ceo" | "cfo" | "cto" | "cmo" | "sales" | "cs" | "default"` — role detection is already built; it just needs the orphaned alternatives removed to reduce confusion.

---

## 5. Permission System Findings

### 5A — Nav Visibility

**Q: Is the sidebar generated from a central config?**  
✅ **Yes.** `client/src/lib/nav-config.ts` is the single source of truth for all sidebar items (desktop and mobile). It exports `NAV_CONFIG` which both `app-sidebar.tsx` and `mobile-nav.tsx` consume via `getDesktopSections()` and `getMobileNavGroups()`.

**Q: Can individual nav items be hidden by role?**  
✅ **Yes, but only for two role axes:**

Filtering logic (from `app-sidebar.tsx:47-86`):
```
isAdmin = ["master_admin", "admin"].includes(userGlobalRole)
isAdvisor = globalRole === "advisor"

Section/item is visible if:
  - adminOnly:true → only visible when isAdmin
  - advisorHidden:true → hidden when isAdvisor
  - permKey set → hidden when permission[permKey] === "none"
  - All other items → visible to everyone
```

**Q: Are hidden items only hidden visually, or also protected at route/API level?**  
⚠️ **Mixed — depends on the item.** See Section 5B.

**Q: Are there existing role/permission fields used by the sidebar?**  
Yes — three flag types on `NavItem`/`NavSection`:
- `adminOnly: boolean` — gates admin-only sections
- `advisorHidden: boolean` — hides from advisors
- `permKey: PermKey` — gates by module permission level ("none" hides it)

There is also `showOn?: Platform[]` for mobile vs desktop platform filtering (not security-related).

---

### 5B — Route / Page Access

**Q: Are frontend routes protected by role?**  
✅ **Partially.** `App.tsx` uses a `guard(section, children)` function that renders `<AccessDenied />` if the user lacks the required permission. Key protected routes:

| Section | Guarded routes |
|---|---|
| `crm` | `/pipeline`, `/data-quality`, `/install-workflows`, `/analytics/source-attribution`, `/executive-dashboard`, `/procurement`, `/deployments`, `/renewals`, `/geography`, `/accounts/*`, `/contacts/*`, `/opportunities/*`, `/revenue/deals`, `/booking-outreach`, `/booking-analytics`, `/revenue-intelligence`, `/execution/forecast` |
| `quoting` | `/quotes`, `/price-lists` |
| `partnerships` | `/strategy/partnerships/*` |
| `calendar` | `/execution/calendar` |
| `projects` | `/execution/projects` |
| `communications` | `/execution/communications` |
| `knowledge` | `/knowledge/assets` |
| `support` | `/support/tickets` |
| `advisor block` | `/routing`, `/revenue`, `/revenue-sim`, `/revenue-ops` |

**Routes NOT guarded at frontend:**  
`/`, `/today`, `/gmail`, `/current`, `/execution/tasks`, `/activity`, `/notes`, `/meeting-notes`, `/documents`, `/execution/daily`, `/alerts-digest`, `/automations`, `/automation/tasks`, `/training`, `/help`, `/winter`, `/executive-copilot`, `/intelligence/*` routes, `/operations/events`, `/board-pack`, `/my-travel`, all Admin pages (they use `wrap()`, not `guard()`).

**Q: Are admin pages protected at frontend?**  
⚠️ **Only partially.** Admin pages in App.tsx use `wrap()` (no access check), then each admin page component re-checks `currentUserGlobalRole` prop internally. This means the access check is inside the component rather than at the routing layer — a security-UX gap (the page briefly loads before checking).

**Q: Is unauthorized access blocked server-side?**  
✅ **Yes — for API endpoints.** The backend enforces:
- `requireAuth` on 770 routes — any unauthenticated request is rejected with HTTP 401
- `requireAdmin` on 68 routes — all `/api/admin/*` routes checked server-side
- `requirePermission(section, level)` on 272 routes — section-level enforcement

**Q: Which modules have strong route-level protections?**  
Strong (both frontend guard + backend API gate): CRM, Quoting, Partnerships, Projects, Communications, Calendar, Knowledge, Support.

**Q: Which modules appear weak/unclear?**  
- **Admin pages** (frontend): `/admin/users`, `/admin/roles`, `/admin/integrations`, etc. use `wrap()` not `guard()` — protection is inside the component
- **Work group**: Tasks, CURRENTS, Meeting Notes, Activity Feed — no frontend route guard, but backend APIs require auth
- **More group**: Most items have no frontend guard; backend enforcement varies by module
- **Insights items**: Meeting Briefs, Signals & Alerts (both render wrong pages anyway) — no frontend guard
- **Revenue Hub/Ops/Sim**: `advisorBlock()` only — not gated for any other unauthorized role

---

### 5C — Action Permissions

**Q: Is there a central user role field?**  
✅ **Yes.** `users.globalRole` in `shared/schema.ts:48`:
```
globalRole: text("global_role").notNull().default("sales")
```
Known values: `master_admin`, `admin`, `advisor`, `sales` (default).

**Q: Is there a permissions table/column?**  
✅ **Yes.** `users.permissions` (JSONB column, `shared/schema.ts:60`):
```json
{
  "crm":            "none" | "view" | "edit",
  "partnerships":   "none" | "view" | "edit",
  "projects":       "none" | "view" | "edit",
  "communications": "none" | "view" | "edit",
  "team_workload":  "none" | "view" | "edit",
  "knowledge":      "none" | "view" | "edit",
  "support":        "none" | "view" | "edit",
  "quoting":        "none" | "view" | "edit",
  "calendar":       "none" | "view" | "edit",
  "mail_team":      { [mailboxId]: { view: boolean, edit: boolean } },
  "calendar_team":  number[]
}
```

Default is full `"edit"` for all sections. Admin/master_admin bypass all permission checks.

**Q: Are view/edit/delete/export actions gated consistently?**  
✅ **Mostly consistent for CRM/quoting/support.** Export endpoints use `requirePermission("crm","view")` consistently. Write mutations use `requirePermission(section, "edit")`. However:

- `team_workload` and `knowledge` sections have permission columns defined but fewer server-side enforcement uses than `crm`.
- **There is no `admin` or `dashboard` key in the permissions JSON**, but the `UserPermissions` TypeScript type in `App.tsx` only includes the 9 keys above.
- `mail_team` permissions are per-mailbox, checked separately in Gmail routes.

**Q: Are admin-only actions protected server-side?**  
✅ **Yes.** All `/api/admin/*` routes confirmed to use `requireAuth, requireAdmin`. The `requireAdmin` middleware in `auth.ts:106-121` checks `req.session.globalRole` directly — no DB lookup, fast check.

**Special case — advisor role:**  
`ADVISOR_BLOCKED_SECTIONS = new Set(["crm", "partnerships", "quoting"])` in `auth.ts:120` — hardcoded server-side block for advisors. `requireNotAdvisor` middleware also exists.

---

## 6. Role-Based Nav Feasibility

### What the current system can support today

The nav config supports exactly **two** role-based filtering axes:
1. `adminOnly` → admin/master_admin only
2. `advisorHidden` → hidden from advisors

It **cannot** currently differentiate between: general employee, sales, operations, engineering, or executive roles beyond the advisor flag.

### Role mapping analysis

| Role | Suggested visible groups/items | Hidden items | Current support | Backend security exists? | Gaps |
|---|---|---|---|---|---|
| **Admin / Master Admin** | Everything | Nothing hidden | ✅ `adminOnly` works | ✅ `requireAdmin` on all admin APIs | No gaps |
| **Advisor** | Work, limited Insights, limited More | Pipeline (full group), Channels, CRM-gated items | ✅ `advisorHidden` works | ✅ `ADVISOR_BLOCKED_SECTIONS` in auth.ts | Gaps: some pages not advisor-blocked at frontend |
| **Sales / BD** | Today, Work, Pipeline (all), Insights, some More | Channels (ecosystem), Admin, engineering ops | ❌ No current filtering | ✅ Backend CRM gates cover this | Need new role flag in nav config |
| **Operations** | Today, Work, Operations (all), Projects, Deployments, some Pipeline | Channels, Revenue financials, Admin | ❌ No current filtering | ✅ Backend project/crm gates exist | Need new role flag |
| **Engineering / Field** | Today, Work, Field Mode, Deployments, Install Workflows, Projects | Pipeline financials, Revenue, Channels | ❌ No current filtering | ✅ Partial | Need new role flag + field-mode surfacing |
| **Executive** | Today, Mission Control, Insights (all), Revenue suite, Executive Dashboard, Executive Copilot | Operational detail pages | ❌ No current filtering | ✅ Partial | Need new role flag |
| **General Employee** | Today, Work (all), Help, Training | Pipeline, Revenue, Channels, Admin | ❌ No current filtering | ⚠️ Tasks/CURRENTS/Help not gated | Need new role flag |

### Gaps that must be fixed before relying on role-based nav

1. **`NavItem`/`NavSection` has no `allowedRoles` field.** Adding one would let the sidebar filter by any globalRole value beyond the binary advisor/non-advisor split.
2. **`app-sidebar.tsx` only checks `isAdmin` and `isAdvisor`.** The filter function would need to accept the full `globalRole` string and match against `allowedRoles`.
3. **Several route guards in App.tsx are missing** for non-CRM pages (Tasks, CURRENTS, Activity Feed, Notes, Today, etc.). Role-based nav hiding alone cannot protect these — backend enforcement per-role would need to be added for any routes that should be truly restricted.
4. **Admin pages rely on internal component checks** rather than routing-level guards. These should be promoted to `guard()` at the route level.
5. **Meeting Briefs and Signals & Alerts render the wrong components.** They must be built correctly before being assigned to a role.

---

## 7. Recommended Future Nav Structure

> **Hard constraint: do not implement this. This is a proposal only.**

### Proposed top-level groups

```
Today          (direct link, personal action dashboard)
Work           (daily operations)
Pipeline       (CRM + sales — gate by crm permission or sales role)
Operations     (delivery + field — gate by ops/crm permissions)
Intelligence   (analytics + AI — gate by role or crm permission)
Revenue        (financial tools — gate by role: executive/sales)
Partnerships   (ecosystem — gate by partnerships permission)
Automation     (rules engine — gate by admin or power-user role)
Admin          (admin only)
```

### Proposed sub-items (consolidated)

**Today** (direct link to `/today`)

**Work**
- Mission Control (/)
- Inbox (/gmail)
- CURRENTS (/current)
- Tasks (/execution/tasks)
- Daily Execution (/execution/daily) ← move from More
- Calendar (/execution/calendar)
- Work Calendar (/work/team-calendar)
- Meeting Notes (/meeting-notes)
- Activity Feed (/activity) ← deduplicated (remove Signals duplicate)
- My Travel (/my-travel)
- Email Signatures (/settings/signatures) ← move from Admin
- AI Voice Profiles (/settings/voice-profiles) ← move from Admin

**Pipeline** *(gate: crm permission or sales role)*
- Snapshot (/pipeline)
- Leads (/opportunities)
- Accounts (/accounts)
- Contacts (/contacts)
- Quotes (/quotes)
- Renewals (/renewals)
- Accounts Won (/revenue/deals)
- Booking Outreach (/booking-outreach)
- Booking Analytics (/booking-analytics)
- Price Lists (/price-lists) ← move from More
- Notes (/notes)

**Operations** *(gate: crm/projects permission)*
- Install Workflows (/install-workflows)
- Deployments (/deployments)
- Procurement (/procurement)
- Projects (/execution/projects)
- Events (/operations/events)
- Support Tickets (/support/tickets) ← move from More
- Winter Support (/winter) ← move from More
- Territory Routing (/routing) ← move from More
- Communications (/execution/communications)
- Data Quality (/data-quality) ← move from More

**Intelligence** *(gate: crm permission or executive role)*
- Executive Dashboard (/executive-dashboard)
- Relationship Intelligence (/intelligence/rel-intelligence) ← deduplicated; remove Reports
- Revenue Intelligence (/revenue-intelligence) ← clarify name vs Rel. Intelligence
- Source Attribution (/analytics/source-attribution)
- Executive Copilot (/executive-copilot)
- Territory & Geo (/geography)
- Score Feedback (/scores/feedback)
- Digest Settings (/alerts-digest) ← rename from "Digest & Alerts"
- Meeting Briefs (/intelligence/briefs) ← **only if built as a real feature**
- Signals & Alerts (/intelligence/signals) ← **only if built as a real feature**

**Revenue** *(gate: executive or sales role; hide from advisor)*
- Revenue Hub (/revenue)
- Revenue Ops (/revenue-ops)
- Revenue Simulator (/revenue-sim)

**Partnerships** *(gate: partnerships permission)*
- Industry Partnerships
- Dealers / Resellers
- Strategic Alliances
- Investors
- Govt & Grants
- Referrals
- Media & Tradeshows

**Automation** *(gate: power-user or admin role)*
- Automations (/automations)
- Task Rules (/automation/tasks) ← move inside Automations (ideally as a tab)

**Help & Learning** *(visible to all)*
- Training (/training)
- Help (/help)

**Admin** *(adminOnly)*
- Users (/admin/users)
- Role Manager (/admin/roles)
- Task Hub Access (/admin/task-hub-access)
- Integrations (/admin/integrations)
- Manage User Signatures (/admin/signatures)
- My Mailboxes (/settings/mailbox)
- Settings (/settings)

### Items to rename

| Current label | Proposed label | Reason |
|---|---|---|
| Mission Control | Mission Control or "Home" | Low priority — name works |
| Reports | Remove (duplicate of Rel. Intelligence) | See §3.4 |
| Forecasting | Remove or build a real Forecasting view | Currently renders Pipeline |
| Meeting Briefs | Remove or build a real Briefs view | Currently renders Today |
| Signals & Alerts | Remove or build a real Signals view | Currently renders Activity Feed |
| Asset Library | Document Hub | Disambiguate from Assets |
| Assets | Knowledge Assets | Disambiguate from Asset Library |
| Channels (group) | Partnerships | Eliminate collision with CURRENTS "channels" |
| Digest & Alerts | Digest Settings | It's a config page, not a live alerts feed |
| Rel. Intelligence | Relationship Intelligence | Use full name, matches Revenue Intelligence pattern |
| User Signatures (Admin) | Manage User Signatures | Distinguish from "Email Signatures" |
| Admin → Email Signatures | Move to Work/Settings section | Not truly admin-only |
| Admin → AI Voice Profiles | Move to Work/Settings section | Not truly admin-only |

### Items to move into page tabs instead of sidebar

- Task Rules → tab inside Automations
- Price Lists → tab inside Quotes or move to Pipeline
- Score Feedback → tab inside Executive Dashboard or Intelligence section
- Board Pack → add nav link under Intelligence or Revenue

### Items to gate by role (beyond current advisor/admin flags)

- Revenue group → executive + sales roles only
- Intelligence group → executive + sales + ops roles
- Automations → power-user or admin role
- Territory Routing → ops/field roles only
- Score Feedback → ops/admin roles only

### Items to remove or hide as placeholders

None of the nav items are pure "coming soon" stubs today — all render real pages. The placeholders are orphaned pages **not in the nav**: `/command-center`, `/dashboard`, `daily-command-center.tsx` (no route). These should be archived or removed from the codebase rather than exposed.

### Should Command Center remain separate or fold into Intelligence?

**Recommendation: Command Center (Mission Control) should stay as the landing page at `/` — not merged into Intelligence.**

Mission Control is the home/action dashboard for daily operations. Intelligence is a group of analytical, backward-looking, or signal-driven views. Combining them would create a too-large landing page that serves both action-takers and analysts simultaneously. The current separation (`/` for action, `/executive-dashboard` for analytics) is sound architecture.

---

## 8. Risks / Unknowns

1. **Meeting Briefs, Signals & Alerts, Forecasting** are in the sidebar but render different components than their labels imply. Any user who navigates to them gets a different page than expected. This is an active user experience defect.

2. **Reports and Rel. Intelligence** are two nav items pointing to the same component at two different routes. This wastes a nav slot and creates confusion about which is "canonical."

3. **`daily-command-center.tsx`** is imported in App.tsx (`const DailyCommandCenter = lazy(...)`) but has no registered route. This creates a dead import that increases bundle analysis complexity.

4. **Email Signatures and AI Voice Profiles** have `adminOnly: false` but are nested in the `Admin` section which has `adminOnly: true`. They are currently hidden from non-admins due to section-level filtering, but the mismatch between item flag and section flag is a latent bug — if these items were ever moved to a non-admin section, they would become universally visible without the author realizing it.

5. **Board Pack** (`/board-pack`) is a fully-implemented feature page with no nav entry. It is reachable only by direct URL. This appears unintentional.

6. **`admin-signatures.tsx` vs `signature-settings.tsx`**: Two different signature pages exist under Admin — one for admins to manage all users' signatures (`/admin/signatures`) and one for personal signature editing (`/settings/signatures`). Both are currently in the Admin section nav, but the personal one should be available to all users.

7. **`globalRole` values are not formally enumerated** in `shared/schema.ts` — the column is a free-text field with a default of `"sales"`. The application logic treats `"master_admin"`, `"admin"`, and `"advisor"` as special; all other values fall through as regular users. If a new role value is needed (e.g., `"executive"`, `"field"`), there is no schema enforcement today.

8. **No frontend guard on Admin routes.** All `/admin/*` routes use `wrap()` — a non-admin user who navigates directly to `/admin/users` will load the page (React Suspense will fire), and the internal component will then check role and redirect. The API calls will be rejected 403. This is not a security hole (backend is protected), but it is an UX gap and creates unnecessary API 403 errors in the console.

---

## 9. Product Decisions Needed Before Implementation

| # | Decision | Context | Options |
|---|---|---|---|
| D-1 | What should Signals & Alerts actually show? | Currently renders Activity Feed — duplicate nav entry | A) Build a dedicated signals/alerts view with priority filtering B) Remove nav item and expose Activity Feed only |
| D-2 | What should Meeting Briefs actually show? | Currently renders Today page — duplicate nav entry | A) Build an AI-generated meeting brief list page B) Remove nav item |
| D-3 | Should Forecasting be a real pipeline forecast view? | Currently renders Pipeline Snapshot — duplicate | A) Build a real forecast/projection view B) Remove from nav |
| D-4 | Which is canonical for Relationship Intelligence: "Reports" or "Rel. Intelligence"? | Two nav items, same page, different routes | Pick one label and one route; redirect the other |
| D-5 | Should the Channels group be renamed to Partnerships? | Name collision with CURRENTS messaging "channels" | A) Rename group to "Partnerships" B) Keep as-is and document the distinction |
| D-6 | Should Asset Library and Assets be disambiguated? | Same word "asset," different products | A) Rename both B) Merge into one document/asset system C) Keep separate with better names |
| D-7 | Where should Revenue Hub, Revenue Ops, Revenue Simulator live? | Currently buried in More | A) Create a new "Revenue" top-level section B) Put all under Insights/Pipeline |
| D-8 | Should Daily Execution be promoted out of More? | Operational execution tool buried in catch-all drawer | A) Move to Work group B) Merge into Tasks |
| D-9 | Should Email Signatures and AI Voice Profiles be available to all users? | `adminOnly: false` on these items but in Admin section | A) Move to Work or Settings (makes them user-visible) B) Set `adminOnly: true` to match section intent |
| D-10 | Should Global Search be admin-only? | `/search` page is gated to admin in nav, but Cmd+K works for everyone | A) Remove admin gate B) Keep gated |
| D-11 | What roles should be introduced beyond admin/advisor? | No role-based nav beyond those two | Define the target role set (executive, sales, ops, field, etc.) before adding nav filtering |
| D-12 | Should Board Pack get a nav link? | Real feature, currently URL-only | A) Add to Intelligence or Revenue B) Keep as direct-URL feature |
| D-13 | Should Calendar and Work Calendar be merged? | Two calendar surfaces with similar names | A) Rename to "My Calendar" + "Team Calendar" B) Merge into one view with tabs |
| D-14 | Should the `More` group be eliminated? | 16 items, heterogeneous mix | Distribute items across new/existing groups; remove the catch-all |

---

## 10. Suggested Implementation Phases (After Approval)

> **These are sequenced for minimum disruption. No phase assumes the previous one is merged.**

### Phase 1 — Fix the naming drift (zero feature risk)
- Redirect `/intelligence/signals` to `/activity` (or build real signals view per D-1)
- Redirect `/intelligence/briefs` to `/today` (or build real briefs per D-2)
- Remove "Reports" nav item (it duplicates Rel. Intelligence); canonicalize `/relationships` or `/intelligence/rel-intelligence`
- No backend changes. No permission changes. No component changes.

### Phase 2 — Rename for clarity (zero route changes)
- Rename "Asset Library" → "Document Hub" (label only)
- Rename "Assets" → "Knowledge Assets" (label only)
- Rename "Channels" group → "Partnerships" (label only)
- Rename "Digest & Alerts" → "Digest Settings" (label only)
- Rename "Rel. Intelligence" → "Relationship Intelligence" (label only)
- All changes are single-string edits in `nav-config.ts`.

### Phase 3 — Restructure More group
- Move Daily Execution → Work group
- Move Support Tickets → Operations group
- Move Winter Support → Operations group
- Move Territory Routing → Operations group
- Move Data Quality → Operations group
- Move Price Lists → Pipeline group
- Move Revenue Hub + Ops + Sim → new "Revenue" group or Insights sub-section
- Collapse Task Rules into Automations (as a tab or sub-item)
- After moves, the More group should contain only: Score Feedback, Digest Settings, Training, Help, Automations

### Phase 4 — Promote non-admin items out of Admin section
- Move Email Signatures to Work (or a new "My Settings" section)
- Move AI Voice Profiles to Work (same location)
- Review Global Search admin gate — likely should be open to all

### Phase 5 — Add role-based nav filtering
- Add `allowedRoles?: string[]` field to `NavItem` and `NavSection` in `nav-config.ts`
- Update `app-sidebar.tsx` filter function to check `globalRole` against `allowedRoles`
- Gate Revenue group items by executive/sales roles
- Gate Automations by power-user or admin
- Requires agreement on D-11 (role taxonomy) before implementation

### Phase 6 — Harden frontend route guards
- Promote Admin page routes from `wrap()` to proper `guard()` or admin-only wrapper
- Add frontend guards to remaining ungated routes per role decisions from Phase 5
- **Note:** Backend API security already exists and does not need to change — this is UX hardening only.

### Phase 7 — Archive orphaned dashboard pages
- Remove or archive `/command-center`, `/dashboard` routes
- Remove `daily-command-center.tsx` if confirmed unused
- Requires confirming no external links or internal references point to these routes

---

*End of audit. This document is read-only discovery. No changes were made to any code, routes, components, permissions, or database during this audit.*
