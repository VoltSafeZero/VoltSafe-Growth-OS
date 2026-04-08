# Replit Agent Configuration

## Overview

VoltSafe Cortex is an internal Central Management System designed for VoltSafe, focusing on sales, support, and relationship management. Login: `trevor@voltsafe.com` / `alberni1444` (Master Admin). It features a comprehensive sales pipeline (Leads to Quotes), support ticketing, a marina directory, communication tools, and an analytics dashboard. The system aims to streamline VoltSafe's internal operations, enhance customer relationship management, and provide valuable insights into sales and support activities.

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

### Core CMS Modules
- **Authentication:** Session-based authentication with `bcryptjs` for password hashing and `express-session`. Supports WebAuthn for biometric login. All API endpoints are protected.
- **Sales:** Manages leads (including a marina directory import) with integrated deal/financial fields, accounts, contacts, infrastructure profiles, and quotes. Features Kanban, list, and map views for pipeline management. Opportunities fields are integrated directly into leads.
- **Address Autocomplete:** Reusable `AddressAutocomplete` component with debounced type-ahead search against Nominatim.
- **Nearby Marinas Map & Dashboard Map Widget:** Interactive Leaflet maps with dynamic viewport-based loading, CARTO Voyager basemaps, color-coded stage markers, and address autocomplete. Supports auto-geocoding of missing addresses.
- **Calendar:** Internal calendar system with day/week/month views, user-specific events (CRUD operations), and color-coded event types.
- **Support:** Provides a ticketing system with Kanban board and list views.
- **Communications:** Manages broadcast lists and campaign drafts.
- **Comments & Collaboration:** Features a threaded comments feed, user assignment, and action item creation.
- **Partnerships:** Tracks 7 partnership categories (Strategic Industry, Technology, Distribution, OEM, Government, Research, Pilot) via a single `partnerships` table with category-specific fields.
- **Ecosystem:** Manages 5 entity types (Organizations, People, Relationships, Events, Regions) across separate tables with full CRUD.
- **Activity & Tasks:** Provides a universal timeline for activities and a task management system.
- **Cortex AI Voice Assistant:** Full-height slide-out sidebar panel powered by OpenAI via Replit AI Integrations. Supports voice and text input, markdown rendering, conversation history, and CRM write capabilities via OpenAI tool calling (function calling) with access to all CRM database tables. Uses SSE streaming for responses.

### Quoting System (Pro Forma Invoice Generator)
- **Features:** Multi-tab QuoteBuilder dialog for customer, products, pricing & terms, and notes. Supports 6 countries with auto-set currency and tax rates. Includes a product catalog for VoltSafe hardware and software/services with list prices and global/per-line discounts.
- **Automation:** Automatically generates XLSX and HTML invoices on quote creation, storing them as base64 assets.
- **Functionality:** Provides print/download endpoints for styled HTML invoices and Excel workbooks. Includes payment terms breakdown, customer info, and line items.
- **Integration:** Quote XLSX/HTML files automatically appear in asset picker for Gmail integration.

### Database
- **Type:** PostgreSQL.
- **ORM:** Drizzle ORM.
- **Schema:** Comprehensive schema covering users, leads, accounts, contacts, opportunities, tickets, quotes, activities, tasks, comments, attachments, communication lists, campaign drafts, partnerships, and ecosystem entities.
- **File Attachments:** `attachments` table supports polymorphic file uploads (images/videos) linked to any object. Files stored on disk in `uploads/` directory, served via `/api/attachments/file/:fileName`. Uses `multer` for multipart upload handling (50MB max, images and videos only).
- **Sales & Marketing Assets CMS:** Full asset library at `/assets` route with `assets` table storing name, description, category, mimeType, size, and `file_data` (base64 text column). Uses `multer.memoryStorage()`. Provides CRUD API and an asset picker integrated into the Gmail Inbox ComposeDialog.
- **Gmail CRM Integration:** OAuth 2.0 flow via Google APIs. Features hourly and on-demand sync of Inbox, Sent, Drafts, Scheduled, and domain-filtered tabs. ComposeDialog supports full email functionality and asset attachments. All Gmail write actions are gated to `trevor@voltsafe.com`. Refresh token stored in `system_settings` DB table.
- **Multi-user Gmail rollout (3-step safe staged migration):**
  - **Step 1 — Data model + backfill + query isolation:** `email_accounts` expanded with `workspace_id`, `auth_status`, `display_name`, `sync_enabled`, `last_sync_at`, `last_history_id`, `sync_error_message`, `disconnected_at`. `workspace_id = 1` sentinel added to `mail_folders` and `email_folder_assignments`. All existing emails backfilled with `source_account_id` → Trevor's account. All DB-level email queries enforce `owner_user_id` filter. `GET /api/gmail/accounts` returns current user's accounts with full status.
  - **Step 2 — Per-user connect/disconnect + per-account sync:** `syncEmailAccount(accountId)` function in `gmail-sync.ts` — runs sync for one account, stamps all imported emails with `owner_user_id` + `source_account_id`, updates `last_sync_at` on success, marks `auth_status='expired'` on token failure. `runGmailSync` refactored to iterate all active `email_accounts` and delegate to `syncEmailAccount`. `POST /api/gmail/accounts/:id/resync` (per-account on-demand). `POST /api/gmail/accounts/:id/disconnect` (sets `disconnected_at`, `auth_status='revoked'`, preserves historical emails). Existing disconnect also stamps `email_accounts`. OAuth callback (`gmail-oauth.ts`) stamps `email_accounts` with email address, display name, `auth_status='active'` after successful connect.
  - **Step 3 — UI polish + status + isolation:** Connected account status footer in Gmail inbox sidebar: status dot (green/amber/red per auth_status), connected email address, last sync time, Resync icon button, Reconnect link if expired/revoked. `accountsQuery` auto-refreshes every 30s. All 6 folder routes confirmed owner-isolated.
- **Custom Inbox Folders:** `mail_folders`, `mail_folder_domains`, `email_folder_assignments` tables. Folders are per-user (owner_user_id + workspace_id), hold domain rules with `ends_with` subdomain matching (e.g. `nmma.org` catches `events.nmma.org` but NOT `fake-nmma.org`). Gmail inbox sidebar shows Custom Folders section with unread/total counts. Folder settings dialog supports domain CRUD and async backfill reprocessing. Manual remove-from-folder supported. UI: `tab="folder"` view in gmail-inbox.tsx.
- **Create Inbox Folder from Account:** AccountDetailDialog has "Create Inbox Folder" button that pre-fills folder name = account name and domain = account website. Uses `POST /api/mail-folders/from-account`.

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
- **CARTO Voyager:** Basemap tiles for Leaflet maps.