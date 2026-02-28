# Replit Agent Configuration

## Overview

VoltSafe CMS — a dark-themed internal Central Management System for VoltSafe Marine, built with React (frontend) and Express (backend). The app features a sales pipeline (Leads → Accounts → Opportunities → Quotes), support ticketing, marina directory (~10,800 US & Canadian marinas), communications management, and an analytics dashboard. PostgreSQL database with Drizzle ORM. Teal/cyan brand color (HSL 174 100% 40%) on dark navy backgrounds.

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
- **Accounts** — Marina/Corp accounts with contacts, linked opportunities, tickets
- **Contacts** — Linked to accounts, persona-based (owner, GM, harbourmaster, etc.)
- **Opportunities** — Pipeline kanban (Prospecting → Closed Won/Lost), value breakdown (hardware/software/services)
- **Quotes** — Two templates: Marina Shore Power Solution & Professional Services Agreement, versioned, line items

#### Support Module
- **Tickets** — Board (kanban by status) + list view, severity levels, internal notes, resolution summary

#### Communications Module
- **Communication Lists** — Manage broadcast lists (manual, Klaviyo, HubSpot sources)
- **Campaign Drafts** — Draft, schedule, log campaigns with external campaign ID tracking

#### Activity & Tasks
- **Activities** — Universal timeline linked to any object (leads, opportunities, tickets, quotes)
- **Tasks** — Linked to objects, due dates, AI-suggested flag

### API Endpoints

**Dashboard:** `GET /api/dashboard/summary`

**Auth:** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`

**WebAuthn:** `POST /api/webauthn/register-options`, `POST /api/webauthn/register-verify`, `POST /api/webauthn/auth-options`, `POST /api/webauthn/auth-verify`, `GET /api/webauthn/credentials`, `DELETE /api/webauthn/credentials/:id`

**Leads:** `GET/POST /api/leads`, `GET/PUT/DELETE /api/leads/:id`, `POST /api/leads/:id/convert`, `POST /api/leads/import-marinas`, `GET /api/leads/states`

**Accounts:** `GET/POST /api/accounts`, `GET/PUT /api/accounts/:id`

**Contacts:** `GET/POST /api/contacts`, `GET/PUT/DELETE /api/contacts/:id`

**Opportunities:** `GET/POST /api/opportunities`, `GET/PUT /api/opportunities/:id`

**Tickets:** `GET/POST /api/tickets`, `GET/PUT /api/tickets/:id`

**Quotes:** `GET/POST /api/quotes`, `GET/PUT /api/quotes/:id`, `GET /api/quotes/next-number`
- Quote Line Items: `GET/POST /api/quotes/:quoteId/line-items`, `DELETE /api/quote-line-items/:id`
- Services Estimates: `GET/POST /api/quotes/:quoteId/services-estimates`, `DELETE /api/services-estimates/:id`

**Activities:** `GET /api/activities?objectType=X&objectId=Y`, `POST /api/activities`

**Tasks:** `GET/POST /api/tasks`, `PUT /api/tasks/:id`

**Communications:** `GET/POST /api/comm-lists`, `PUT /api/comm-lists/:id`

**Campaigns:** `GET/POST /api/campaigns`, `GET/PUT /api/campaigns/:id`

**Marinas:** `GET /api/marinas`, `GET /api/marinas/states`

**Legacy Dashboard:** `GET /api/metrics`, `GET /api/sales`, `GET /api/chart-data`

### Database Schema (PostgreSQL + Drizzle ORM)

**Existing tables:** metrics, sales, chart_data, marinas

**CMS tables:**
- `users` — id, name, email, role, avatar_url, created_at, last_login
- `leads` — company, contact info, source, status, owner, notes, tags, next_step, due_date
- `accounts` — name, address, region, timezone, slip_count, segment, tags, notes
- `contacts` — account_id, name, title, email, phone, persona
- `opportunities` — account_id, title, stage, owner, est_close_date, value breakdown, competitors
- `tickets` — account_id, contact_id, category, severity, status, requester info, assigned_to, description, internal_notes, resolution_summary
- `quotes` — quote_number (unique), version, status, quote_type, account/opportunity/contact links, currency, totals, assumptions/exclusions
- `quote_line_items` — quote_id, category, name, description, qty, unit_price, unit_type, line_total
- `services_estimates` — quote_id, role, hours_estimate, hourly_rate, subtotal
- `activities` — linked_object_type/id, type, summary, raw_content, gmail thread/message IDs
- `tasks` — linked_object_type/id, owner, title, description, due_date, status, ai_suggested
- `communication_lists` — name, source, external_id, description, member_count
- `campaign_drafts` — subject, body, list_ids, status, external campaign ID/link, sent_at

### UI Pages
1. **Dashboard** — CMS summary (leads, deals, tickets, quotes counts + overdue tasks alert + activity feed)
2. **Marinas** — Searchable directory of ~10,800 US & Canadian marinas
3. **Leads** — List with search, status filter, create/convert/delete
4. **Accounts** — Card grid with detail dialog (contacts, opportunities, tickets tabs)
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
