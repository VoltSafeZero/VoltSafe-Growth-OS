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

### Core CMS Modules
- **Authentication:** Session-based authentication with `bcryptjs` for password hashing and `express-session`. Supports WebAuthn for biometric login. All API endpoints are protected.
- **Sales:** Manages leads (including a marina directory import) with integrated deal/financial fields (amount, probability, value breakdown, value driver, competitors, ROI story, close date), accounts, contacts, infrastructure profiles, and quotes. Features Kanban, list, and map views for pipeline management. Opportunities fields are integrated directly into leads (no separate Opportunities page).
- **Nearby Marinas Map:** Interactive Leaflet map view on the Leads page showing marinas sorted by GPS distance from the user. Uses CARTO Voyager basemap tiles (lighter, more readable), small 12px color-coded stage markers with hover tooltips showing marina name, click for popup with details and "Get Directions" button. Address search bar with Nominatim geocoding. Falls back to last viewed location (localStorage) when GPS unavailable. Backend uses Haversine formula for distance calculation via `/api/leads/nearby` endpoint. Auto-geocodes missing addresses via `/api/leads/:id/geocode-address` (reverse geocoding with Nominatim) and updates the marina record. Directions open via Google Maps (desktop) or Apple Maps (iOS).
- **Dashboard Map Widget:** Large Leaflet map on the Dashboard showing all marinas within 50km of the user's location. Lazy-loaded via React.lazy/Suspense. Uses CARTO Voyager tiles, small 12px color-coded stage markers with hover tooltips, XSS-safe DOM-node popups with "Get Directions" button. Features address search bar (Nominatim geocoding via `/api/geocode/search`), last-location fallback (localStorage), auto-geocode of missing addresses, proper cleanup on unmount. Component: `client/src/components/dashboard/dashboard-map.tsx`.
- **Support:** Provides a ticketing system with Kanban board and list views for tracking support issues.
- **Communications:** Manages broadcast lists and campaign drafts.
- **Comments & Collaboration:** Features a threaded comments feed, user assignment for leads/accounts, and action item creation.
- **Partnerships:** Tracks various partnership types (e.g., Strategic Industry, Technology, Distribution) with category-specific details.
- **Ecosystem:** Manages organizations, people, relationships, events, and regions within the VoltSafe ecosystem.
- **Activity & Tasks:** Provides a universal timeline for activities linked to various objects and a task management system with due dates and assignments.

### Database
- **Type:** PostgreSQL.
- **ORM:** Drizzle ORM.
- **Schema:** Comprehensive schema covering users, leads, accounts, contacts, opportunities, tickets, quotes, activities, tasks, comments, communication lists, campaign drafts, partnerships, and ecosystem entities.

## External Dependencies

- **PostgreSQL:** Primary database for all application data.
- **Drizzle ORM:** Used for interacting with the PostgreSQL database.
- **`bcryptjs`:** For secure password hashing.
- **`express-session` and `connect-pg-simple`:** For session management with a PostgreSQL store.
- **`@simplewebauthn/server` & `@simplewebauthn/browser`:** For WebAuthn (biometric login) functionality.
- **`TanStack React Query`:** For data fetching and state management in the frontend.
- **`shadcn/ui` & `Radix UI`:** UI component libraries for the frontend.
- **`Tailwind CSS`:** For styling the frontend.
- **`Recharts`:** For charting and data visualization.
- **`Lucide React`:** For icons.
- **`Wouter`:** For frontend routing.
- **`Leaflet`:** For interactive maps (Nearby Marinas Map view).