# Replit Agent Configuration

## Overview

VoltSafe Cortex is an internal Central Management System designed for VoltSafe, focusing on sales, support, and relationship management. It features a comprehensive sales pipeline (Leads to Quotes), support ticketing, a marina directory, communication tools, and an analytics dashboard. The system aims to streamline VoltSafe's internal operations, enhance customer relationship management, and provide valuable insights into sales and support activities.

## User Preferences

Preferred communication style: Simple, everyday language.
Brand colors: Teal/cyan primary on dark navy backgrounds — all colors flow through CSS theme variables.
Dark mode by default.

## System Architecture

### Monorepo Structure
The project is organized as a monorepo containing `client/` (React SPA), `server/` (Express API), and `shared/` (common definitions).

### Frontend (`client/`)
- **Framework:** React with TypeScript, bundled by Vite.
- **UI/UX:** Dark-themed interface using `shadcn/ui` (New York style) built on Radix UI, styled with Tailwind CSS and CSS variables. Typography uses Inter for body and Plus Jakarta Sans for headings.
- **State Management:** TanStack React Query for data fetching.
- **Routing:** Wouter.
- **Data Visualization:** Recharts for analytics.
- **Icons:** Lucide React.

### Backend (`server/`)
- **Framework:** Express 5 (ESM) running on Node.js with `tsx`.
- **API:** RESTful JSON API.

### Permission System
- **Granular per-user permissions**: `permissions` JSONB column on `users` table, allowing section-level `AccessLevel` ("none" | "view" | "edit") for various modules.
- **Team Inbox Permissions**: `mail_team` map controls access to shared Gmail inboxes.
- **Calendar Overlays**: `calendar_team` array for overlaying team members' calendars.
- **Enforcement**: Both backend middleware (`requirePermission`) and frontend guards (`guard`) enforce permissions. An Admin UI provides comprehensive management of user permissions.

### Navigation: Growth OS
The sidebar is organized under a **Growth OS** umbrella — the central module for all revenue, partnership, and pipeline activities. Structure:
1. **Command Center** — Dashboard, Activity Feed, Reports, Forecasting
2. **Relationships** — Contacts, Organizations, Notes, Tasks
3. **Revenue Engine** — Opportunities, Pipeline, Deals, Renewals, Quotes
4. **Growth Channels** — Industry Partnerships, Dealers/Resellers, Strategic Alliances, Investors, Govt & Grants, Referrals, Media & Tradeshows
5. **Intelligence** — Inbox, Calendar, Meeting Briefs, Signals & Alerts, Rel. Intelligence
6. **Operations** — Segments, Tags, Automations, Imports/Exports, Projects, Communications, Assets, Price Lists

The sidebar also includes a **search box** that filters all nav items in real time. Stub pages (`/renewals`, `/segments`, `/tags`, `/automations`, `/imports`) show a "Coming Soon" placeholder. All existing URLs are preserved.

### Relationship Intelligence Profile Pages
Clickable detail pages for every CRM entity:
- **`/contacts/:id`** — ContactProfilePage: header card, suggested action banner, NoteComposer, related emails/meetings/tasks. Powered by `GET /api/contacts/:id/profile`.
- **`/accounts/:id`** — AccountProfilePage: same layout + contacts list. Powered by `GET /api/accounts/:id/profile`.
- **`/opportunities/:id`** — OpportunityProfilePage: same + deal stage bar, stakeholders list. Powered by `GET /api/opportunities/:id/profile`.
- Contacts list rows are clickable (→ `/contacts/:id`). Pipeline cards titles link to `/opportunities/:id`. AccountDetailDialog has "Intelligence Profile" button.

### Record Summary Bar + Relationship Health
A compact activity/health strip added to every CRM profile surface.
- **Component:** `client/src/components/record-summary-bar.tsx` (`RecordSummaryBar`)
  - Props: `objectType` ("account" | "contact" | "opportunity" | "lead" | "partner"), `objectId`, `compact?` (boolean, default false)
  - Shows: health badge (score 0–100, label), last inbound email, last outbound email, last note, last activity, open tasks (with overdue highlighted red), open deals + pipeline value, contacts count, attachments count
  - Warning strip for: no outbound 21d, no touch 30d, inbound stale 45d, overdue tasks, stale opportunity
  - Tooltips on hover for every metric pill; health badge tooltip shows score breakdown
- **API Endpoint:** `GET /api/record-summary/:objectType/:objectId`
  - Permission: `requirePermission("crm", "view")`
  - Returns standardized shape for all 5 object types
  - Health scoring: base 100, touch recency deductions, inbound warmth bonus/deduction, overdue task penalty, stale opportunity penalty; clamped 0–100
- **Integration points:**
  - `account-profile.tsx` — full bar between identity card and main grid
  - `contact-profile.tsx` — full bar between identity card and main grid
  - `opportunity-profile.tsx` — full bar between identity card and main grid
  - `leads.tsx` — compact bar inside LeadDetailDialog (below header)
  - `partnerships.tsx` — compact bar inside PartnerDetailDialog (below header)

### Activity Feed (`/activity`)
Real aggregated activity timeline replacing the "Coming Soon" stub. Pulls from `notes`, `email_messages`, `calendar_events`, `tasks`, and `activities` tables via `GET /api/activity-feed`. Features per-type filter tabs (Note/Email/Meeting/Task/Activity) and live text search. Auto-refreshes every 2 minutes.

### Notes Page (`/notes`)
Full CRUD notes module replacing the "Coming Soon" stub. Powered by `GET /api/notes/all` (new endpoint; supports type + search filters). Supports create (Add Note dialog), inline edit, and delete with entity cross-linking (contact / account / opportunity with clickable links to their profile pages).

"CRM" label renamed to "Growth OS" across: sidebar, mobile nav, admin user permissions UI, calendar event dialog tabs (now "Relationships"), voice assistant description, and login page.

### Core CMS Modules
- **Authentication:** Session-based authentication with `bcryptjs` and WebAuthn for biometric login. All API endpoints are protected.
- **Sales (Growth OS):** Manages leads, accounts, contacts, and quotes with Kanban, list, and map views. Includes lead conversion workflows and bidirectional navigation between leads and organizations. Opportunities are integrated into leads.
- **Address Autocomplete & Maps:** Reusable `AddressAutocomplete` component with Nominatim integration. Interactive Leaflet maps with CARTO Voyager basemaps for nearby marinas and dashboards.
- **Calendar:** Internal calendar system with day/week/month views and user-specific event management. Includes calendar sync with external providers (Google Calendar OAuth, Apple iCloud / generic CalDAV). Provider cards in Settings → Calendar Integrations. Sync runs on-demand via "Sync" button on calendar page or per-provider in settings. Two-way sync supported for Google Calendar (pull + push). CalDAV/Apple is pull-only. Microsoft 365 is planned (Coming Soon). New table: `calendar_connections`. New columns on `calendar_events`: `external_id`, `external_provider`, `external_calendar_id`.
- **Support:** Ticketing system with Kanban board and list views.
- **Communications:** Manages broadcast lists and campaign drafts.
- **Comments & Collaboration:** Threaded comments, user assignment, and action item creation.
- **Partnerships:** Tracks 7 categories of partnerships.
- **Ecosystem:** Manages Organizations, People, Relationships, Events, and Regions.
- **Activity & Tasks:** Universal timeline for activities and task management.
- **Cortex AI Voice Assistant:** Slide-out sidebar powered by OpenAI, supporting voice/text input, markdown, conversation history, and CRM write capabilities via tool calling.

### Daily Command Center (Growth OS Command Center)
- **Command Center (`/`):** Default landing screen — greeting header, 7 stat cards (open opps, hot deals, overdue, meetings today, partnerships, investor convos, govt/grants), Today section (meetings + tasks), Needs Attention (overdue tasks, stalled deals, no next step), Pipeline Momentum, Partnership Activity, Relationship Activity, Intelligence panel, and Suggested Actions. Supports Mine/Team view toggle for admins. Powered by `GET /api/command-center?view=mine|team`.
- **Today Dashboard (`/today`):** Personal daily briefing page — shows today's meetings, tasks due today, overdue tasks, hot opportunities, new leads this week, recent activity, and AI-suggested actions. Powered by `GET /api/dashboard/today`.
- **Pipeline Health (`/pipeline`):** Multi-tab pipeline management view — Stalled Deals, No Next Step, High Value, Revenue Forecast, and By Owner tabs with inline stage advance. Powered by `GET /api/pipeline/insights`.
- **Quick Capture:** Global floating "+" button (bottom-right) + Cmd/Ctrl+K shortcut opens a 5-tab capture dialog (Note, Task, Contact, Opportunity, Meeting Note). Wired globally in App.tsx. Opens programmatically via `window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "task" } }))`.
- **Smart Notifications:** Bell icon in header opens a popover driven by `GET /api/notifications`. Returns `{ notifications: [...], unreadCount: N }` with overdue tasks, stalled deals, new leads, inbound emails. Badge is dynamic (only shows when unreadCount > 0). Refreshes every 60 seconds.
- **AI Meeting Briefing:** "Briefing" tab (✨ icon) in the EventDetailDialog on the Calendar page. Calls `POST /api/calendar/events/:id/briefing` which uses GPT-4o-mini to generate pre-meeting prep with talking points, CRM context, and recommended questions.

### Critical DB/ORM Notes
- **Drizzle 0.39 + PostgreSQL bug**: Using `and()` with multiple `ne()` or `not(eq())` conditions generates invalid SQL ("syntax error at or near '='"). All new complex queries in the Command Center routes use `db.execute(sql.raw(...))` with plain PostgreSQL strings instead of Drizzle query builders.
- **opportunities table**: Uses `owner_user_id` (Drizzle: `ownerUserId`) — there is NO `assignedToUserId` on opportunities.
- **email_messages table**: Uses `owner_user_id` (NOT `user_id`) for user filtering.
- **calendar_events table**: Uses `user_id` (not `owner_user_id`).

### Quoting System (Pro Forma Invoice Generator)
- **Features:** Multi-tab QuoteBuilder for customer, products, pricing, and terms. Supports 6 countries with auto-set currency and tax rates. Includes a product catalog with discounting.
- **Automation:** Automatically generates XLSX and HTML invoices, stored as base64 assets. Provides print/download endpoints.
- **Integration:** Quote files appear in the asset picker for Gmail integration.

### Database
- **Type:** PostgreSQL with Drizzle ORM.
- **Schema:** Comprehensive schema for all CMS modules.
- **File Attachments:** Polymorphic `attachments` table for file uploads (images/videos) stored on disk, served via API.
- **Sales & Marketing Assets CMS:** Full asset library with CRUD API and asset picker.
- **Gmail CRM Integration:** OAuth 2.0 via Google APIs. Features hourly and on-demand sync of emails. Supports multi-user Gmail accounts with per-user connect/disconnect and shared inbox functionality.
- **Custom Inbox Folders:** Per-user custom folders with domain-based rules for email organization.
- **Email Module Redesign:** 3-pane Gmail-like client with workflow states, linked CRM records, and a CRM Context Panel for association review and management.
- **Shared Team Inboxes:** Supports shared `email_accounts` with access control, allowing users to manage emails from shared inboxes.
- **Association Engine v3:** Full deterministic scoring pipeline for linking emails to CRM entities (contacts, accounts, leads, opportunities, partnerships). Signals: (1) exact contact email match (+50), (1a) account via contact (+35), (1b) open opportunity via contact — all active stages except closed_won/closed_lost (+20 base, +30 if title in subject), (2) sender domain → account (+20), (2b) open opportunity via matched account (+15 base, +25 if title in subject), (3) exact lead email match (+50), (4) lead domain match (+30), (5) partner domain match (+35), (6) lead company name in subject (+25). Penalties for bulk/auto-generated email. Thread bonus +25 if thread already CRM-associated. Disambiguation: if two candidates of same type score within 20 pts and both ≥ 30, both marked ambiguous (suggestions only). Feedback table prevents rejected associations from being recreated. User-confirmed associations are never overwritten. Idempotent: re-running on same message creates no duplicates. Stores `confidenceScore`, `associationReasonJson` (human-readable reasons), `isAuto`, `isUserConfirmed` on each `email_associations` row.
- **Email Relationship Intelligence Dashboard:** New page at `/relationships` (nav: Execution → Rel. Intelligence). Shows 5 stat cards (External Contacts emailed, Active Relationships 2+ emails, Dormant 60d+, New in period, Unlinked Senders), activity trend line chart, top-orgs horizontal bar chart, Most Active Contacts table, Neglected Relationships table, Top Organizations by Volume table, and Unlinked Real Senders table with "Open in inbox" link for CRM seeding. All tables are sortable by any column. Period filter (7d/30d/90d/All) drives all data. Single endpoint `GET /api/relationships/intelligence?days=N` executes all queries in one round-trip. No schema changes. Permission gate: `requireAuth` (accessible to all logged-in users).
- **Inbox Quick-Create (Lead, Account, Contact from Sender):** In the Gmail CRM Context Panel, when a thread has no CRM associations and the sender is an eligible external business contact (not @voltsafe.com, not personal domains, not bulk/newsletter), three quick-create buttons appear: Contact (sky blue), Lead (amber), Organization (violet). Each expands an inline form pre-populated from sender data. Endpoints: `POST /api/gmail/sender/create-contact`, `POST /api/gmail/sender/create-lead`, `POST /api/gmail/sender/create-account`. All use 409 dedup codes and re-trigger the association engine on success. Gated by `crm: "edit"` permission.

## External Dependencies

- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interaction.
- **`bcryptjs`:** Password hashing.
- **`express-session` & `connect-pg-simple`:** Session management.
- **`@simplewebauthn/server` & `@simplewebauthn/browser`:** WebAuthn for biometric login.
- **`TanStack React Query`:** Frontend data fetching and state management.
- **`shadcn/ui` & `Radix UI`:** UI component libraries.
- **`Tailwind CSS`:** Frontend styling.
- **`Recharts`:** Data visualization.
- **`Lucide React`:** Icons.
- **`Wouter`:** Frontend routing.
- **`Leaflet`:** Interactive maps.
- **OpenAI:** Powering Cortex AI Voice Assistant (via Replit AI Integrations).
- **Google APIs:** For Gmail CRM Integration.
- **Nominatim:** For address geocoding and autocomplete.
- **CARTO Voyager:** Basemap tiles for Leaflet maps.- **Universal Global Search:** Fully wired search bar in the header (`GET /api/search?q=`). UNION query across accounts, contacts, opportunities, and notes. Results grouped by entity type with color-coded icons. Cmd+K focuses the input; click-away closes the dropdown; click result navigates to the entity's profile page. Note results navigate to the linked record's profile.
- **Pinned Notes / Key Facts:** Notes can be pinned via a pin toggle on each note card in NotesPanel (`PATCH /api/notes/:id/pin` flips `is_pinned`). Pinned notes appear at the top of NotesPanel with a teal highlight. Account and Opportunity profile pages show a **Key Facts** section that renders all pinned notes for that record. Schema: `is_pinned boolean DEFAULT false` column added to `notes` table. Both profile SQL queries now include `is_pinned` and sort by `is_pinned DESC, created_at DESC`.
- **Saved Filters / Custom Views (Accounts):** Accounts page has a "Save view" button (Bookmark icon) below the filter bar. Clicking it expands an inline name input; pressing Enter or clicking Save persists the current filter state (segment, status, priority, orgType, sort) to the existing `saved_views` table via `POST /api/saved-views`. Saved views appear as chips; clicking a chip restores all filters; hovering a chip shows an X to delete it. Backend routes (`/api/saved-views` CRUD) and schema already existed.
