# Replit Agent Configuration

## Overview

**VoltSafe Growth OS** is VoltSafe's internal sales intelligence and CRM platform for marina-focused sales, support, and relationship management. It features a comprehensive sales pipeline (Leads to Quotes), support ticketing, a marina directory, communication tools, and an analytics dashboard. **Cortex** is the embedded AI assistant within the platform.

### Dual-Brand Architecture
- **Platform name:** VoltSafe Growth OS — shown in sidebar, login, browser tab, emails, all UI surfaces
- **AI assistant name:** Cortex — the in-app chatbot/AI layer (formerly "Cortex AI")
- **Tagline:** "Your marina sales intelligence platform"
- **Centralized branding constants:** `client/src/lib/branding.ts` exports `PLATFORM_NAME`, `ASSISTANT_NAME`, `TAGLINE`, and the `BRANDING` object with derived strings (askAssistant, assistantSuggestions, assistantSearch, assistantBriefing, assistantSubtitle)

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

### Daily Command Center (`/`)
The primary landing page after login — a cockpit-style CRM intelligence hub that shows what needs attention today.

- **Route:** `/` (DailyCommandCenter component replaces old CommandCenter; old CommandCenter moved to `/command-center`)
- **API Endpoint:** `GET /api/daily-command-center?view=mine|team` — `requireAuth` + `requirePermission("crm","view")`
  - Returns 7 sections, each with `count` + `items` arrays
  - Admin users can switch to `view=team` to see all records across the team
  - Viewers and non-admins always get `viewMode="mine"`
- **7 Dashboard Sections:**
  1. **Overdue Tasks** — Tasks past due date; items include `days_overdue`, `linked_object_name`, `severity`, `deepLink`
  2. **Suggested Actions** — Live pull from `task_suggestions` table (pending, not snoozed/cooldown); shows `reason`, `suggested_action_label`
  3. **Inbox Follow-Ups Needed** — Inbound emails ≤14 days old with no outbound reply since; severity always high
  4. **Relationships At Risk** — Accounts with `last_interaction_at > 21 days ago` or NULL, sorted by open deal value DESC
  5. **Stale Deals** — Open opportunities with no activity in 21+ days; sorted by amount DESC
  6. **New / Unlinked Emails** — Inbound emails with no `source_account_id`, last 30 days
  7. **This Week's Priorities** — Tasks due next 7 days + calendar meetings next 7 days
- **UI Features:**
  - Greeting header + urgency banner (shows total overdue + follow-ups count when > 0)
  - Stat strip: 6 count pills for quick snapshot
  - 2-column layout (xl breakpoint): 5 primary sections left + 2 sidebar sections + Quick Links right
  - Severity color coding: red (high), amber (medium), blue (low); dot indicator per row
  - Hover-reveal action labels with ArrowRight icon per row
  - Click-through deep links to record profiles for every item
  - Empty states with witty contextual messages per section
  - Skeleton loading states while fetching
  - Auto-refresh every 5 minutes
  - `generatedAt` footer timestamp
- **Ranking Logic within sections:**
  - `overdueTasks`: sorted by `due_date ASC` (oldest first); severity = high if >7d, medium if >3d, else low
  - `suggestedActions`: sorted by severity DESC then created_at ASC
  - `accountsAtRisk`: sorted by `open_deal_value DESC`, then `last_interaction_at ASC NULLS LAST`
  - `staleOpportunities`: sorted by `amount DESC NULLS LAST`, then `days_stale DESC`; severity = high if >$10k, medium if >$2k
  - `inboxFollowUps`: sorted by `sent_at DESC`

### Signal-Driven Task Suggestions
A deterministic, explainable task suggestion engine that surfaces the next best action for each CRM record based on relationship signals.

- **Signal Engine:** `server/services/signal-engine.ts` — pure function `computeSignals(input: SignalInput): Signal[]`
  - Evaluates 11 signals in priority order: `overdue_task`, `recent_inbound_no_followup`, `high_value_stale_opp`, `stale_open_opp`, `no_inbound_45d`, `health_stale`, `no_outbound_21d`, `no_inbound_30d`, `health_at_risk`, `no_inbound_14d`, `health_cooling`
  - Each signal outputs: `signalType`, `severity` (low/medium/high), `title`, `reason`, `suggestedActionType`, `suggestedActionLabel`, `priority`, `suggestedDueDays`
- **DB Table:** `task_suggestions` (id, object_type, object_id, signal_type, severity, title, reason, suggested_action_type, suggested_action_label, priority, suggested_due_date, status, snoozed_until, created_task_id, dismissed_at, accepted_at, source_signals)
- **API Endpoints:**
  - `GET /api/suggestions/:objectType/:objectId` — `requirePermission("crm","view")` — Returns top 3 active suggestions; creates DB rows on first visit; respects cooldown windows (dismissed: 7d, accepted: 3d, snoozed: until date)
  - `POST /api/suggestions/:id/accept` — `requirePermission("crm","edit")` — Marks accepted + optionally creates a real task (`createTask=true`)
  - `POST /api/suggestions/:id/dismiss` — `requirePermission("crm","view")` — Suppresses for 7 days
  - `POST /api/suggestions/:id/snooze` — `requirePermission("crm","view")` — Suppresses until `NOW() + days` (1–90 days)
- **UI Component:** `client/src/components/suggested-actions-card.tsx` (`SuggestedActionsCard`)
  - Props: `objectType`, `objectId`, `compact?`, `onOpenNoteComposer?`, `onScrollToSection?`
  - Renders as a Card with severity badges, reason tooltip, and Accept/Dismiss/Snooze actions per row
  - Hidden when suggestions array is empty (returns null — no empty state shown)
  - Smart actions: `add_note` scrolls to notes section; `review_opportunity`/`complete_task` scrolls to relevant section
- **Integration:** Added below the RecordSummaryBar on `account-profile.tsx`, `contact-profile.tsx`, `opportunity-profile.tsx`
- **Deduplication / Cooldown:** Dismissed suggestions re-surface after 7 days; accepted ones after 3 days; snoozed ones after the chosen duration

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
- **Unified Record Timeline:** `TimelineTab` component (`client/src/components/timeline-tab.tsx`) renders a chronological feed on Contact, Opportunity, and Account profile pages. Backend: `GET /api/timeline?objectType=X&objectId=Y` UNION-queries notes, activities, attachments, emails, **tasks**, **quotes** (account/opp only), and **stage_changes** (opportunity only via `deal_stage_history`). Per-record shortcut endpoints: `GET /api/timeline/account/:id`, `/lead/:id`, `/contact/:id`, `/opportunity/:id`. Type filters: all 7 types supported. Composer shortcuts for Note/Task/Activity at the top of the feed. Pagination: 50 items shown initially with "Load more" button. Audit logging: `PUT /api/leads/:id` logs status-change and owner-change activities. `PUT /api/opportunities/:id` already creates `deal_stage_history` + activity rows. Stage-change activities are deduplicated — they surface as `stage_change` type (not `activity`) on the opportunity timeline. Test suite: `tests/timeline.test.js` (55 assertions).
- **Lead Conversion + Dedupe:** Full multi-step lead-to-Account+Contact+Opportunity conversion flow with duplicate detection. Schema: `leads` table has `converted_account_id`, `converted_contact_id`, `converted_opportunity_id`, `converted_at` columns (SQL-migrated). Backend: `GET /api/leads/:id/convert-check` returns both `matches` (account dupes by domain/name) and `contactMatches` (by exact email or name similarity). `POST /api/leads/:id/convert` accepts `existingAccountId`, `existingContactId`, `skipContact`, `createOpportunity`, `opportunityTitle/Amount/Stage`, `fieldOverrides` — creates/links Account+Contact+Opportunity, stores converted IDs on lead, creates `lead_converted` activity on both lead and account timelines, creates handoff note on account (if lead had notes), migrates email associations. `GET /api/leads/:id/linked-org` returns `{account, contact, opportunity}` using `convertedAccountId`/`convertedContactId`/`convertedOpportunityId`. Frontend: 4-step `ConvertToOrgDialog` — Step 1 (Dedupe: shows account + contact matches with "Use" buttons), Step 2 (Configure: account new/link, contact new/link/skip, opportunity toggle), Step 3 (Field Review: name, orgType, contact fields, opp fields — auto-skipped if nothing to edit), Step 4 (Confirm: summary card + convert button). Test suite: `tests/lead-conversion.test.js` (18 assertions).
- **Cortex AI Voice Assistant:** Slide-out sidebar powered by OpenAI, supporting voice/text input, markdown, conversation history, and CRM write capabilities via tool calling.

### Daily Command Center (Growth OS Command Center)
- **Command Center (`/`):** Default landing screen — greeting header, 7 stat cards (open opps, hot deals, overdue, meetings today, partnerships, investor convos, govt/grants), Today section (meetings + tasks), Needs Attention (overdue tasks, stalled deals, no next step), Pipeline Momentum, Partnership Activity, Relationship Activity, Intelligence panel, and Suggested Actions. Supports Mine/Team view toggle for admins. Powered by `GET /api/command-center?view=mine|team`.
- **Today Dashboard (`/today`):** Personal daily briefing page — shows today's meetings, tasks due today, overdue tasks, hot opportunities, new leads this week, recent activity, and AI-suggested actions. Powered by `GET /api/dashboard/today`.
- **Pipeline Health (`/pipeline`):** Multi-tab pipeline management view — Stalled Deals, No Next Step, High Value, Revenue Forecast, and By Owner tabs with inline stage advance. Powered by `GET /api/pipeline/insights`.
- **Quick Capture:** Global floating "+" button (bottom-right) + Cmd/Ctrl+K shortcut opens a 5-tab capture dialog (Note, Task, Contact, Opportunity, Meeting Note). Wired globally in App.tsx. Opens programmatically via `window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "task" } }))`.
- **Persistent Notifications System:** Bell icon in header opens a popover with a numeric badge (count >0). Notifications are persisted to the `notifications` DB table (per-user, with `type`, `severity`, `isRead`, `dedupeKey`, `expiresAt`). 7 signal types: `overdue_task`, `reminder`, `stale_opportunity`, `account_at_risk`, `inbox_followup_needed`, `meeting`, `lead`. Deduplicated with daily/weekly cooldowns. Refreshes every 60s. Full endpoints: `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`, `GET /api/notifications/digest`. NotificationPanel shows unread count, "Mark all read" button, severity color-coding, read/unread dim state, and timestamp. Test suite: `tests/notifications.test.js` (45 assertions).
- **Task Reminders:** `reminder_at` column on `tasks`. `POST /api/tasks/:id/reminder` accepts `preset` (`later_today`=+3h, `tomorrow_morning`=next-day 9am, `next_week`=+7d 9am) or ISO `reminderAt`. `DELETE /api/tasks/:id/reminder` clears it.
- **Tasks Hub (`/execution/tasks`):** First-class execution queue page. Tab views: My Tasks, Team Tasks, Due Today, Overdue, Upcoming, Completed — each with live count badges. Grouping by: Due Date, Priority, Linked Record, Assignee (dropdown). Task rows show priority dot, overdue age, account link, owner. Fast inline actions on hover: complete (circle toggle), snooze (preset picker: later today / tomorrow / next week), reassign (user picker), change due date (date picker). Keyboard shortcut `/` to focus search. Empty states per view. Overdue rows highlighted red. Integrates `source` (manual/suggestion/email/automation) and `snoozed_until` fields. Test suite: `tests/tasks-hub.test.js` (81 assertions). Route: `/execution/tasks`. Legacy `/tasks` redirects here.
- **Tasks model extended:** Added `source` (text, default `manual`) and `snoozed_until` (timestamp) columns. Quick-action API: `POST /api/tasks/:id/complete`, `POST /api/tasks/:id/snooze` (preset or ISO), `POST /api/tasks/:id/reassign`. Hub API: `GET /api/tasks/hub?view=<view>&groupBy=<groupBy>` returns tasks with user/account joins, grouped results, and 5 count badges.
- **PUT /api/tasks/:id** now converts date strings (dueDate, reminderAt, snoozedUntil) to Date objects before passing to storage.
- **Task Suggestions Layer:** `server/services/global-suggestions.ts` runs 6 deterministic rules across all CRM records to generate task suggestions (unanswered email, stale lead, missing next step, quote follow-up, account needs attention, overdue task reminder). Results are upserted into `task_suggestions` with cooldowns: 7-day dismiss, 3-day accept. API: `GET /api/tasks/suggestions` (returns `{suggestions, total}`), `POST /api/tasks/suggestions/:id/accept` (creates real task from suggestion), `POST /api/tasks/suggestions/:id/dismiss`, `POST /api/tasks/suggestions/:id/snooze`. Accept preserves source/sourceLabel/confidence on created task. Test suite: `tests/task-suggestions.test.js` (151 assertions).
- **Task Rule Configs:** `task_rule_configs` table stores 6 configurable rules with thresholdValue, thresholdUnit, isEnabled, assigneeStrategy, defaultAssigneeUserId. API: `GET /api/task-rules`, `PUT /api/task-rules/:ruleId`. Only `crm:edit` users can PUT.
- **Task Rules Settings page (`/automation/tasks`):** Admin page to configure automation rule thresholds, enable/disable rules, and set assignee strategy per rule. Linked from Operations sidebar under "Task Rules" and from the Tasks Hub "Suggestions" tab.
- **Suggestions tab in Tasks Hub:** Seventh tab "Suggestions" (Sparkles icon) added to Tasks Hub. Shows global suggestion cards with: title, reason, severity badge, source badge, confidence score, linked record, suggested due date. Action buttons: Accept (creates task), Snooze (1/7 days), Dismiss. Links to `/automation/tasks` to configure rules. Badge count shown in tab. Query: `GET /api/tasks/suggestions` (lazy loaded only when tab active).
- **tasks table extended:** Added `source_label` (text), `source_meta` (jsonb), `dismissed_at` (timestamp), `dismissed_by` (integer) columns.
- **task_suggestions table extended:** Added `suggested_assignee_id` (integer), `confidence` (integer, default 50), `source_label` (text), `dismissed_by` (integer) columns.
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
- **Mobile + Field Usability Polish (T10):** Makes Cortex fast and practical on phones at marinas, in meetings, and between calls. (1) **Field Quick Actions on profile pages** — prominent 2×2 or 3-button grid below the identity card on Contact (Call/Email/Note/Task), Account (Website/Note/Task/Deal), and Opportunity (Note/Task/Log Call) profiles; all buttons are 44px+ touch targets with `active:scale-95` animation; Quick Actions sidebar in contact profile upgraded to 44px tap rows. (2) **Daily Command Center mobile fix** — responsive padding (`p-4 sm:p-6`), stat strip changed to `grid grid-cols-3 sm:flex sm:flex-wrap` to fill space evenly on mobile. (3) **Accounts page collapsible filter bar** — Settings2 toggle button on mobile (sm:hidden) reveals/hides filter selects; active filter count badge shown on toggle button. (4) **Gmail inbox mobile improvements** — mobile-only tab switcher (`md:hidden`) shown at top of thread list, replacing hidden sidebar navigation on phones (tabs: Inbox/Sent/Drafts/Review/Other with unread badges); category pills and CRM filter pills both wrapped in `overflow-x-auto` + `min-w-max` for horizontal scroll; thread row touch targets increased from `py-[9px]` to `py-3` across all row types (inbox, review queue, folder); bulk action toolbar updated with `min-h-[32px]` buttons and icon-only mode on narrow screens.
- **Inbox Power Workflow (T9):** Makes the inbox the fastest place to triage, link, and act. Features: (1) **Bulk selection** — checkboxes appear on hover (or when any thread is selected), `x` keyboard shortcut toggles selection on focused thread, Escape clears selection; (2) **Bulk action toolbar** — sticky bar appears above thread list with count, Mark Read, Mark Unread, and Archive buttons; (3) **CRM fast filters** — second row of filter pills on inbox tab: All / Unread / Starred / Needs Reply / Follow Up, applied client-side; (4) **Quick-create Task from email** — `Task` button in CRM panel opens inline title input, Enter saves, Escape cancels, auto-populates with sender and subject context, pre-links to top confirmed CRM record; (5) **Quick-create Note from email** — `Note` button (disabled until thread is linked to CRM record) adds a structured note with sender/subject context, linked to the top confirmed CRM record. New backend endpoints: `POST /api/gmail/bulk-mark-read` (max 100 messages, validates markAs=read|unread), `POST /api/gmail/bulk-archive` (max 50 threads, removes INBOX label), `POST /api/inbox/create-task-from-thread` (gated crm:edit, auto-sets due date to tomorrow, priority medium, status pending), `POST /api/inbox/create-note-from-thread` (gated crm:edit, requires linkedObjectType+linkedObjectId due to DB NOT NULL constraint). 27 T9 tests added → 140/140 total passing.

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
