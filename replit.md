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

### Core CMS Modules
- **Authentication:** Session-based authentication with `bcryptjs` and WebAuthn for biometric login. All API endpoints are protected.
- **Sales:** Manages leads, accounts, contacts, and quotes with Kanban, list, and map views. Includes lead conversion workflows and bidirectional navigation between leads and organizations. Opportunities are integrated into leads.
- **Address Autocomplete & Maps:** Reusable `AddressAutocomplete` component with Nominatim integration. Interactive Leaflet maps with CARTO Voyager basemaps for nearby marinas and dashboards.
- **Calendar:** Internal calendar system with day/week/month views and user-specific event management.
- **Support:** Ticketing system with Kanban board and list views.
- **Communications:** Manages broadcast lists and campaign drafts.
- **Comments & Collaboration:** Threaded comments, user assignment, and action item creation.
- **Partnerships:** Tracks 7 categories of partnerships.
- **Ecosystem:** Manages Organizations, People, Relationships, Events, and Regions.
- **Activity & Tasks:** Universal timeline for activities and task management.
- **Cortex AI Voice Assistant:** Slide-out sidebar powered by OpenAI, supporting voice/text input, markdown, conversation history, and CRM write capabilities via tool calling.

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
- **Association Engine v2:** Enhanced engine for linking emails to CRM entities (contacts, accounts, leads, opportunities, partnerships) based on multiple signals. Includes an Association Review API for confirming, rejecting, or manually linking associations.
- **Create Contact from Sender (Phase 4):** In the Gmail CRM Context Panel, when a thread has no CRM associations and the sender is an eligible external business contact (not @voltsafe.com, not personal domains, not bulk/newsletter), a "Create Contact from Sender" CTA appears. Clicking it expands a compact inline form that pre-fills the sender's name and email. User must link the contact to an existing organization (searchable) or create a new stub organization (org name + type select). New endpoint `POST /api/gmail/sender/create-contact` handles atomic contact+org creation with server-side duplicate prevention: contact email dedup (409 CONTACT_EXISTS) and organization domain dedup (409 DOMAIN_CONFLICT with conflict org name returned). Org type picker has 7 options (Other is default — no marina hardcoding). Domain normalization: strips `www.`, lowercases, sets `website = https://<domain>` on new stub orgs. Conservative name parsing: `from_name` used as-is for `name`; `firstName`/`lastName` split only if exactly 2 whitespace-separated words. After creation, `POST /api/gmail/thread-associations/:threadId/refresh` re-runs the association engine on all messages in the thread so the new contact appears immediately in the panel. `GET /api/gmail/thread-record/:threadId` augmented with `sender` field (`fromEmail`, `fromName`, `bulkEmailScore`, `autoGeneratedScore`) for eligibility gating. CTA gated by `crm: "edit"` permission.

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