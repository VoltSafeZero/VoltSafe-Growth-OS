# Replit Agent Configuration

## Overview

VoltSafe Cortex — a dark-themed internal Central Management System for VoltSafe, built with React (frontend) and Express (backend). The app features a sales pipeline (Leads → Accounts → Opportunities → Quotes), support ticketing, marina directory (~10,800 US & Canadian marinas), communications management, and an analytics dashboard. PostgreSQL database with Drizzle ORM. Teal/cyan brand color (HSL 174 100% 40%) on dark navy backgrounds.

## User Preferences

Preferred communication style: Simple, everyday language.
Brand colors: Teal/cyan primary on dark navy backgrounds — all colors flow through CSS theme variables.
Dark mode by default.

## System Architecture

### Monorepo Structure
- **`client/`** — React SPA (Vite-powered)
- **`server/`** — Express 5 API server
- **`shared/`** — Shared schema definitions and route contracts

### Frontend (`client/`)
- **Framework:** React with TypeScript
- **Bundler:** Vite
- **Routing:** Wouter
- **State/Data Fetching:** TanStack React Query
- **UI Components:** shadcn/ui (new-york style) on Radix UI
- **Styling:** Tailwind CSS with CSS variables, dark mode default
- **Charts:** Recharts
- **Icons:** Lucide React
- **Typography:** Inter (body) + Plus Jakarta Sans (headings)

### Backend (`server/`)
- **Framework:** Express 5 (ESM)
- **Runtime:** Node.js with `tsx`
- **API Pattern:** RESTful JSON API under `/api/*`

### Core CMS Modules

#### Authentication
- **Session-based auth** — bcryptjs password hashing, express-session with PostgreSQL store (connect-pg-simple)
- **WebAuthn biometric login** — Face ID / Touch ID / Windows Hello support via @simplewebauthn/server + @simplewebauthn/browser; session-based challenge storage; register on Settings page, use on Login page
- **5 named users** — terri, scott, sanad, trevor, alex @voltsafe.com; initial password "alberni1444", force-change on first login
- **Protected routes** — all `/api/*` endpoints require authentication via `requireAuth` middleware

#### Sales Module
- **Leads** — Marina directory import (~10,800 US & Canadian marinas), HubSpot-style pipeline stages (New → Contacted → Meeting Scheduled → Qualified → Proposal Sent → Negotiation → Closed Won / Closed Lost), list + kanban pipeline view, search by name/city/state, filter by stage and state, convert to Account
- **Accounts** — Marina/Corp accounts with enriched fields (legal name, website, marina type, ownership, location, slip mix, power demand, seasonality, expansion plans, pilot candidate score, beta tester flag, red flags, next action), lead status + priority filters, infrastructure profiles, contacts, linked opportunities, tickets
- **Contacts** — Linked to accounts, role types (economic_buyer, champion, technical, finance, ops), personas, relationship strength, preferred contact method, LinkedIn URL, primary contact flag
- **Infrastructure Profiles** — 1:1 per account, pedestal/power data (brands, age, per-slip power, 30A/50A mix, voltage), metering/billing, leakage detection, breaker trip pain, failure modes, incidents, compliance info, IT systems (management software, accounting, payment, WiFi)
- **Opportunities** — Pipeline kanban (Prospecting → Closed Won/Lost), value breakdown (hardware/software/services)
- **Quotes** — Two templates: Marina Shore Power Solution & Professional Services Agreement, versioned, line items

#### Support Module
- **Tickets** — Board (kanban by status) + list view, severity levels, internal notes, resolution summary

#### Communications Module
- **Communication Lists** — Manage broadcast lists (manual, Klaviyo, HubSpot sources)
- **Campaign Drafts** — Draft, schedule, log campaigns with external campaign ID tracking

#### Comments & Collaboration
- **Comments Feed** — Threaded comments on leads and accounts, showing user name and timestamp. Any authenticated user can comment. Reusable `CommentsFeed` component (`client/src/components/comments-feed.tsx`)
- **User Assignment** — Leads have `ownerUserId`, accounts have `assignedToUserId`. Inline assignment dropdown via `AssignUserSelect` component (`client/src/components/assign-user-select.tsx`)
- **Action Items** — Create tasks linked to leads/accounts with assignee, priority, and due date via `CreateActionItem` component (`client/src/components/create-action-item.tsx`)

#### Activity & Tasks
- **Activities** — Universal timeline linked to any object (leads, opportunities, tickets, quotes)
- **Tasks** — Linked to objects, due dates, priority, owner user, created-by user, AI-suggested flag

### API Endpoints

**Dashboard:** `GET /api/dashboard/summary`

**Auth:** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`

**WebAuthn:** `POST /api/webauthn/register-options`, `POST /api/webauthn/register-verify`, `POST /api/webauthn/auth-options`, `POST /api/webauthn/auth-verify`, `GET /api/webauthn/credentials`, `DELETE /api/webauthn/credentials/:id`

**Leads:** `GET/POST /api/leads`, `GET/PUT/DELETE /api/leads/:id`, `POST /api/leads/:id/convert`, `POST /api/leads/import-marinas`, `GET /api/leads/states`

**Accounts:** `GET/POST /api/accounts`, `GET/PUT /api/accounts/:id`
- Infrastructure Profiles: `GET/PUT /api/accounts/:id/infrastructure`

**Contacts:** `GET/POST /api/contacts`, `GET/PUT/DELETE /api/contacts/:id`

**Opportunities:** `GET/POST /api/opportunities`, `GET/PUT /api/opportunities/:id`

**Tickets:** `GET/POST /api/tickets`, `GET/PUT /api/tickets/:id`

**Quotes:** `GET/POST /api/quotes`, `GET/PUT /api/quotes/:id`, `GET /api/quotes/next-number`
- Quote Line Items: `GET/POST /api/quotes/:quoteId/line-items`, `DELETE /api/quote-line-items/:id`
- Services Estimates: `GET/POST /api/quotes/:quoteId/services-estimates`, `DELETE /api/services-estimates/:id`

**Activities:** `GET /api/activities?objectType=X&objectId=Y`, `POST /api/activities`

**Tasks:** `GET/POST /api/tasks`, `PUT /api/tasks/:id`

**Comments:** `GET /api/comments?objectType=X&objectId=Y`, `POST /api/comments`

**Users:** `GET /api/users`

**Team Workload:** `GET /api/team-workload`

**Communications:** `GET/POST /api/comm-lists`, `PUT /api/comm-lists/:id`

**Campaigns:** `GET/POST /api/campaigns`, `GET/PUT /api/campaigns/:id`

**Marinas:** `GET /api/marinas`, `GET /api/marinas/states`

**Legacy Dashboard:** `GET /api/metrics`, `GET /api/sales`, `GET /api/chart-data`

### Database Schema (PostgreSQL + Drizzle ORM)

**Existing tables:** metrics, sales, chart_data, marinas

**CMS tables:**
- `users` — id, name, email, role, avatar_url, created_at, last_login
- `leads` — company, contact info, source, status, owner, notes, tags, next_step, due_date
- `accounts` — name, legal_name, website, marina_type, ownership_type, parent_company, street_address, city, state_province, postal_zip, country, region, timezone, lat/lng, slip_count, segment, slip_mix, avg_boat_size_range, power_demand_intensity, seasonality, expansion_plans/notes, lead_source, lead_status, priority, assigned_to, beta_tester, pilot_candidate_score, red_flags, last_interaction_at, next_action/at, notes_summary, tags, notes
- `contacts` — account_id, name, first_name, last_name, title, email, phone, persona, role_type, preferred_contact_method, linkedin_url, relationship_strength, is_primary, notes
- `infrastructure_profiles` — account_id (unique), pedestal brands/age, power_per_slip, 30A/50A mix, voltage_types, metering/billing, leakage_detection, breaker_trip_pain, failure_modes, incidents, compliance (jurisdiction/pressure/deadline/inspection), IT systems (marina software/accounting/payment/wifi/it_contact)
- `opportunities` — account_id, title, stage, owner, est_close_date, value breakdown, competitors
- `tickets` — account_id, contact_id, category, severity, status, requester info, assigned_to, description, internal_notes, resolution_summary
- `quotes` — quote_number (unique), version, status, quote_type, account/opportunity/contact links, currency, totals, assumptions/exclusions
- `quote_line_items` — quote_id, category, name, description, qty, unit_price, unit_type, line_total
- `services_estimates` — quote_id, role, hours_estimate, hourly_rate, subtotal
- `activities` — linked_object_type/id, type, summary, raw_content, gmail thread/message IDs
- `tasks` — linked_object_type/id, owner, title, description, due_date, status, ai_suggested
- `comments` — object_type, object_id, user_id, user_name, content, created_at
- `communication_lists` — name, source, external_id, description, member_count
- `campaign_drafts` — subject, body, list_ids, status, external campaign ID/link, sent_at

### UI Pages
1. **Dashboard** — CMS summary (leads, deals, tickets, quotes counts + overdue tasks alert + activity feed)
2. **Marinas** — Searchable directory of ~10,800 US & Canadian marinas
3. **Leads** — List with search, status filter, create/convert/delete, inline edit, user assignment, comments feed, action items
4. **Accounts** — Card grid with detail dialog (details with edit, contacts, deals, tickets, infrastructure profile tabs), status/priority/segment filters, user assignment, comments feed, action items
5. **Opportunities** — Kanban pipeline + list view toggle
6. **Quotes** — List + detail + quote builder wizard (Marina Solution / Professional Services)
7. **Tickets** — Board (kanban) + list view toggle, detail with internal notes + resolution
8. **Communications** — Lists tab + Campaigns tab
9. **Settings** — Placeholder
10. **Integrations** — Placeholder (Gmail, HubSpot, Klaviyo planned)

### Sidebar Navigation Groups
- **Overview:** Dashboard, Marinas
- **Sales:** Leads, Accounts, Opportunities, Quotes
- **Support:** Tickets
- **Communications:** Communications
- **Configuration:** Settings, Integrations

### Build Process
- **Development:** `npm run dev`
- **Production:** `npm run build` then `npm start`
- **Database push:** `npm run db:push`

### Planned Features (Not Yet Implemented)
- Google OAuth authentication with domain restriction
- Gmail integration (send/receive/log emails)
- HubSpot one-way lead import
- Klaviyo campaign API integration
- PDF quote generation
- AI smart summaries and action item suggestions
- Global search
- Admin user/role management
