# Replit Agent Configuration

## Overview

This is a full-stack dashboard application built with React (frontend) and Express (backend), featuring a business analytics dashboard and a marina directory. The app displays metrics, revenue charts, recent sales, and a searchable/filterable marina database imported from an Excel spreadsheet. It uses a PostgreSQL database with Drizzle ORM for data persistence and follows a monorepo structure with shared types and route definitions between client and server.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project is organized into three main directories:
- **`client/`** — React single-page application (Vite-powered)
- **`server/`** — Express 5 API server
- **`shared/`** — Shared schema definitions and route contracts used by both client and server

### Frontend (`client/`)
- **Framework:** React with TypeScript
- **Bundler:** Vite (config in `vite.config.ts`)
- **Routing:** Wouter (lightweight client-side router)
- **State/Data Fetching:** TanStack React Query for server state management
- **UI Components:** shadcn/ui (new-york style) built on Radix UI primitives
- **Styling:** Tailwind CSS with CSS variables for theming, dark mode enabled by default
- **Charts:** Recharts for bar chart visualizations
- **Icons:** Lucide React
- **Typography:** Inter (body) and Plus Jakarta Sans (headings) via Google Fonts
- **Path aliases:** `@/` maps to `client/src/`, `@shared/` maps to `shared/`

### Backend (`server/`)
- **Framework:** Express 5 (ESM)
- **Runtime:** Node.js with `tsx` for TypeScript execution in development
- **API Pattern:** RESTful JSON API under `/api/*` prefix
- **Key endpoints:**
  - `GET /api/metrics` — Dashboard metric cards
  - `GET /api/sales` — Recent sales list
  - `GET /api/chart-data` — Monthly revenue chart data
  - `GET /api/marinas` — Paginated, searchable marina directory (supports `search`, `state`, `page`, `limit` query params)
  - `GET /api/marinas/states` — Distinct marina states for filtering
- **Dev server:** Vite middleware serves the frontend in development; in production, static files are served from `dist/public`
- **Database seeding:** The server seeds initial dashboard data (metrics, sales, chart data) on startup

### Shared Layer (`shared/`)
- **`schema.ts`** — Drizzle ORM table definitions and Zod insert schemas for `metrics`, `sales`, `chartData`, and `marinas` tables
- **`routes.ts`** — API route contracts with paths, methods, and Zod response schemas, used by both client and server for type safety

### Database
- **Database:** PostgreSQL (required, via `DATABASE_URL` environment variable)
- **ORM:** Drizzle ORM with `drizzle-zod` for schema-to-Zod integration
- **Migrations:** Managed via `drizzle-kit push` (schema push approach, not migration files)
- **Connection:** `node-postgres` (pg) Pool
- **Schema tables:**
  - `metrics` — Dashboard KPI cards (title, value, change, description, icon)
  - `sales` — Recent sales entries (name, email, amount, avatarUrl)
  - `chart_data` — Monthly revenue data (month, revenue)
  - `marinas` — Marina directory (name, state, city, slips, segment, lat/lng, phone, street, zip)

### Build Process
- **Development:** `npm run dev` runs the Express server with Vite middleware via `tsx`
- **Production build:** `npm run build` runs a custom build script (`script/build.ts`) that:
  1. Builds the client with Vite (output to `dist/public`)
  2. Bundles the server with esbuild (output to `dist/index.cjs`), externalizing most dependencies except an allowlist
- **Production start:** `npm start` runs `node dist/index.cjs`
- **Database push:** `npm run db:push` syncs the Drizzle schema to the database

### Storage Layer
- **Pattern:** Repository/storage interface (`IStorage`) with a `DatabaseStorage` implementation
- **Location:** `server/storage.ts`
- **Features:** Supports paginated queries with search and filtering for the marinas table

## External Dependencies

### Required Services
- **PostgreSQL Database** — Required. Connection string must be provided via `DATABASE_URL` environment variable. Used for all data persistence.

### Key NPM Packages
- **drizzle-orm / drizzle-kit** — ORM and schema management for PostgreSQL
- **express** — HTTP server framework (v5)
- **@tanstack/react-query** — Client-side data fetching and caching
- **recharts** — Chart visualization library
- **zod / drizzle-zod** — Runtime validation and schema generation
- **wouter** — Client-side routing
- **shadcn/ui ecosystem** — Radix UI primitives, class-variance-authority, clsx, tailwind-merge
- **xlsx** — Excel file parsing (used for marina data import script)
- **connect-pg-simple** — PostgreSQL session store (available but not actively used for auth yet)

### Data Import
- **Marina data** — Imported from an Excel file (`attached_assets/MARINA_LIST_Full_USA_2024_1771878269076.xlsx`) via `script/import-marinas.ts`. This is a one-time batch import script run separately.

### Replit-specific Plugins
- `@replit/vite-plugin-runtime-error-modal` — Runtime error overlay in development
- `@replit/vite-plugin-cartographer` — Development tooling (dev only)
- `@replit/vite-plugin-dev-banner` — Development banner (dev only)