# VoltSafe Growth OS

VoltSafe Growth OS is an internal sales intelligence and CRM platform for marina-focused sales, support, and relationship management, featuring an embedded AI assistant called Cortex.

## Run & Operate

```bash
# Run the development server
npm run dev

# Build the project
npm run build

# Run type-checking
npx tsc --noEmit

# Generate Drizzle migrations
npx drizzle-kit generate

# Push DB schema changes (use with caution)
npm run db:push

# Required Environment Variables
# AI_INTEGRATIONS_OPENAI_API_KEY
# AI_INTEGRATIONS_OPENAI_BASE_URL (for Replit AI Integrations)
# GMAIL_PUBSUB_TOPIC
# GMAIL_WEBHOOK_TOKEN
```

## Stack

- **Frontend:** React, TypeScript, Vite, shadcn/ui, Radix UI, Tailwind CSS, Wouter, TanStack React Query, Recharts, Lucide React
- **Backend:** Node.js (with `tsx`), Express 5
- **Database:** PostgreSQL, Drizzle ORM
- **AI:** OpenAI GPT-4o-mini
- **Geocoding:** Nominatim
- **Maps:** Leaflet, CARTO Voyager
- **Weather:** Open-Meteo

## Where things live

- `/client`: React SPA frontend.
- `/server`: Node.js/Express API backend.
- `/shared`: Shared TypeScript types and Drizzle schema.
- `/migrations`: Database migration files (e.g., `migrations/0001_zoom_and_booking_links.sql`).
- `/scripts`: One-off utility scripts (e.g., `scripts/export-marinas-csv.ts`, `scripts/pubsub-diagnostic.ts`).
- `/docs`: Documentation and AI training data (e.g., `docs/operations-manual.md`, `docs/ai-knowledge-base.json`).
- `shared/schema.ts`: Database schema source of truth.
- `client/src/lib/nav-config.ts`: Sidebar and mobile navigation configuration.
- `client/src/lib/dashboard-config.ts`: Dashboard widget configuration and role-based defaults.
- `server/routes.ts`: Main API route definitions.
- `server/services`: Core backend logic and business services.
- `tests`: Regression and unit tests (e.g., `tests/permissions.test.js`, `tests/email-engagement.test.js`).

## Architecture decisions

- **No Drizzle Schema Changes for Feature Adds:** New features often reuse existing tables or introduce additive-only columns/tables via raw SQL migrations to minimize schema churn.
- **Local Mirror First for Gmail:** The system defaults to reading from a local mirror of Gmail data, transparently backfilling from Gmail API only when local data is exhausted, prioritizing speed and consistency.
- **Deterministic Scoring & AI:** Predictive scores and AI suggestions are rule-based and explainable, not black-box, with clear reasons for every output.
- **UI Component-Driven Development:** Extensive use of `shadcn/ui` components and atomic design principles for consistent UI/UX.
- **Source-Grep Testing for UI:** For complex UI components that fire workers or have network dependencies, source-grep tests are used to pin component structure and invariants, avoiding expensive E2E tests for every minor UI change.

## Product

- **Unified Inbox:** Gmail-like email client with local mirroring, auto-backfill, bulk actions, and rich HTML body rendering. Includes "Smart Inbox" view with Spark-style grouping (Priority, Unread, Notifications, Newsletters, Pinned, Seen).
- **Role-Based Daily Command Center:** Adaptive dashboard showing personalized KPIs and actions based on user's role.
- **Predictive Scoring Layer:** Scores for Lead Quality, Opportunity Close, Quote Follow-up, Deployment Delay Risk, Churn Risk, and Expansion Likelihood.
- **Smart Document Hub:** Centralized management, search, and categorization of documents with CRM linkage.
- **Relationship Intelligence:** Visualizes contact warmness, identifies dormant leads, and provides multi-threaded views.
- **Advanced Automation Builder:** Rule-based automation engine for CRM, tasks, and other modules.
- **Executive AI Copilot:** Top-level intelligence layer for daily decisions, surfacing critical alerts and suggested moves.
- **Revenue Operating System:** Plan commits, gap-to-plan analysis, AI-recommended actions, and historical snapshots.
- **Smart Revenue Simulator:** CRM-integrated scenario planning, forecast vs. actuals, and recommended actions.
- **Field Execution Mobile Mode:** Mobile-first operating mode for on-site users with swipe actions, quick logging, and geo-context.
- **Procurement / Manufacturing Workflow:** End-to-end hardware delivery, inventory management, and auto-task creation for blocked processes.
- **Deployment / Site Rollout Manager:** Field execution layer for site deployments with commissioning checklists and blocker tracking.
- **True Duplicate Merge Engine:** Safe, audited, field-resolution-driven merge for accounts, contacts, and leads.
- **Projects — Safety Certification Extension:** Manages certification projects with milestones, attachments, and smart alerting.
- **Customer Success + Renewals Layer:** Tracks customer health, renewals, and expansion opportunities with automated reminders.
- **Trello-style Tasks System:** Kanban board and list views for task management with dependencies, labels, checklists, and saved views.
- **Help Center & AI Training System:** In-app documentation, training handbooks, and an AI-powered knowledge base.
- **Weather Forecast Widget:** User-customizable dashboard widget displaying weather for saved locations.

## User preferences

Preferred communication style: Simple, everyday language.
Brand colors: Teal/cyan primary on dark navy backgrounds — all colors flow through CSS theme variables.
Dark mode by default.

## Gotchas

- **Gmail Pub/Sub in Dev:** Push notifications are unreliable in the dev environment (Replit container sleep). The foreground polling fallback is the primary safety net.
- **`syncIncremental` Concurrency:** Multiple concurrent `syncIncremental` calls (e.g., foreground poll + hourly cron) are handled by atomic SQL updates on `lastHistoryId` and `incrementalEventCount` to prevent race conditions and data regressions.
- **`react-grid-layout` v2:** The component `react-grid-layout` requires v2-specific props (`dragConfig`, `resizeConfig`) and careful handling of the `static` flag to enable drag-and-drop functionality.
- **Drizzle `and()` with `ne()`/`not(eq())`:** This combination can generate invalid SQL. Use `db.execute(sql.raw(...))` for complex queries involving multiple `NOT EQUAL` conditions.
- **`tsx` and CJS `node-ical` imports:** Namespace imports (`import * as ical from "node-ical"`) might result in `undefined` properties at runtime for CJS dependencies under `tsx` with `esModuleInterop`. Prefer default imports (`import ical from "node-ical"`).
- **`routes.ts` edits:** Large edits to `server/routes.ts` might not trigger reliable `tsx` watcher restarts; manual `restart_workflow "Start application"` may be required.
- **SES Runtime Errors:** `(unknown runtime error)` overlays often stem from browser extension injections into sandboxed iframes. A Vite plugin filter is in place to suppress these non-actionable errors.

## Pointers

- **Replit AI Integrations:** For `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` setup.
- **Drizzle ORM Documentation:** For database schema and query building.
- **Tailwind CSS Documentation:** For styling utilities.
- **TanStack Query Documentation:** For data fetching and caching patterns.
- **`shadcn/ui` Documentation:** For UI components.
- **PostgreSQL Documentation:** For advanced SQL queries and indexing strategies.
- **OpenAI API Documentation:** For understanding AI model capabilities and prompts.
- **Google APIs Documentation:** For Gmail integration details.
- **`node-ical` npm package:** For parsing iCalendar files.