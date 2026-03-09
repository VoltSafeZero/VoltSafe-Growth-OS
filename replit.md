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
- **Address Autocomplete:** Reusable `AddressAutocomplete` component (`client/src/components/address-autocomplete.tsx`) used in both maps. Debounced (300ms) type-ahead search against Nominatim via `/api/geocode/search?limit=5`. Shows dropdown of suggestions with formatted names. Backend endpoint supports `?limit=N` (max 8) to return multiple results for autocomplete.
- **Nearby Marinas Map:** Interactive Leaflet map view on the Leads page with dynamic viewport-based loading — marinas load automatically as you pan/zoom (debounced 400ms, AbortController for request cancellation). Uses CARTO Voyager basemap tiles (lighter, more readable), small 12px color-coded stage markers with hover tooltips showing marina name, click for popup with details and "Get Directions" button. Address autocomplete search bar. Never blocks on GPS — shows map immediately with saved/default location, GPS updates asynchronously. Backend uses Haversine formula for distance calculation via `/api/leads/nearby` endpoint. Auto-geocodes missing addresses via `/api/leads/:id/geocode-address` (reverse geocoding with Nominatim) and updates the marina record. Directions open via Google Maps (desktop) or Apple Maps (iOS). Leaflet scale control shows km/mi at bottom-left. Default zoom level 13 (~10km visible radius).
- **Dashboard Map Widget:** Large Leaflet map on the Dashboard with dynamic viewport-based loading. Lazy-loaded via React.lazy/Suspense. Uses CARTO Voyager tiles, small 12px color-coded stage markers with hover tooltips, XSS-safe DOM-node popups with "Get Directions" button. Features 5-closest marinas sidebar panel (with name, distance, stage dot, directions button), address autocomplete search bar, never blocks on GPS (shows map immediately with saved/default location), auto-geocode of missing addresses, Leaflet scale control (km/mi), proper cleanup on unmount. Default zoom level 13 (~10km visible radius). Component: `client/src/components/dashboard/dashboard-map.tsx`.
- **Calendar:** Internal calendar system with day/week/month views on a dedicated `/calendar` page. User-specific events (meetings, calls, tasks, reminders) with full CRUD via dialogs. Color-coded event types. Time-slot click to create. Dashboard widget (`client/src/components/dashboard/dashboard-calendar.tsx`) shows "Today's Schedule" card. API: `GET/POST /api/calendar/events` (supports `?start=&end=` date range), `GET/PUT/DELETE /api/calendar/events/:id`. Schema: `calendar_events` table with userId, title, description, eventType, startTime, endTime, allDay, location, meetingUrl, linkedObjectType/Id, color, status. Apple iCal-style fields: invitees (text array of emails), timeZone, repeat (none/daily/weekly/monthly/yearly), travelTime, alert & secondAlert (none/at_time/1min/5min/10min/15min/30min/45min/1hr/2hr/1day/2day), showAs (busy/free), visibility (default/public/private). Form uses date picker popovers and time Select dropdowns (15-min intervals, 12h AM/PM format). Location uses AddressAutocomplete component. Meeting URL labeled as "Zoom Meeting URL". Invitees section allows adding/removing emails.
- **Support:** Provides a ticketing system with Kanban board and list views for tracking support issues.
- **Communications:** Manages broadcast lists and campaign drafts.
- **Comments & Collaboration:** Features a threaded comments feed, user assignment for leads/accounts, and action item creation.
- **Partnerships:** Tracks 7 partnership categories via a single `partnerships` table with a `category` discriminator. Each category has specific fields:
  - **Strategic Industry** (`strategic_industry`): organizationType, membershipStatus, strategicImportance, influenceScore, marinasRepresented, keyContacts, eventsHosted, speakingOpportunities
  - **Technology** (`technology`): technologyCategory, integrationStatus, apiAvailable, integrationType, technicalContact, jointRoadmapNotes, priorityLevel, integrationDocLink
  - **Distribution** (`distribution`): channelType, territory, salesReach, certificationStatus, trainingCompletedDate, dealRegistrationEnabled, activeOpportunities, revenueGenerated
  - **OEM** (`oem`): industry, licenseType, territory, royaltyStructure, contractStatus, productIntegrationDescription, expectedRevenuePotential, strategicImportance
  - **Government** (`government`): agencyBody, grantType, fundingAmount, applicationStatus, reportingRequirements, startDate, endDate, deliverables
  - **Research** (`research`): institutionType, researchFocus, programName, projectDescription, participationStatus, ipConsiderations, keyResearchers
  - **Pilot** (`pilot`): slipCount, pilotStatus, deploymentSize, productVersionInstalled, startDate, caseStudyStatus, testimonialStatus, operationalFeedback
  - UI: Single reusable `PartnershipsPage` component (`client/src/pages/partnerships.tsx`) that accepts a `category` prop. 7 sidebar links, 7 routes in App.tsx.
  - API: `GET/POST /api/partnerships`, `GET/PUT/DELETE /api/partnerships/:id` (filter by `?category=X`)
- **Ecosystem:** Manages 5 entity types across separate tables with full CRUD:
  - **Organizations** (`ecosystem_organizations`): name, organizationType, region, country, website, marinasOrLocations, totalSlipCount, strategicTier, influenceScore, notes
  - **People** (`ecosystem_people`): fullName, title, organizationId, organizationName, roleType, linkedinProfile, email, phone, influenceScore, relationshipStrength, notes
  - **Relationships** (`ecosystem_relationships`): sourceEntityType/Id/Name, targetEntityType/Id/Name, relationshipType, startDate, strategicImportance, notes
  - **Events** (`ecosystem_events`): name, organizer, location, eventDate, industryCategory, voltsafeParticipation, keyContactsMet, notes
  - **Regions** (`ecosystem_regions`): name, country, stateProvince, numberOfMarinas, electricalCodeVersion, regulatoryNotes, strategicImportance
  - UI: 5 separate page components in `client/src/pages/ecosystem-*.tsx`
  - API: `GET/POST /api/ecosystem/{organizations|people|relationships|events|regions}`, `GET/PUT/DELETE /api/ecosystem/{...}/:id`
- **Activity & Tasks:** Provides a universal timeline for activities linked to various objects and a task management system with due dates and assignments.
- **Cortex AI Voice Assistant:** Full-height slide-out sidebar panel (right side, `sm:w-[440px]`) powered by OpenAI via Replit AI Integrations. Supports both voice (microphone recording with gpt-audio speech-to-speech) and text input modes. Features: markdown rendering (`react-markdown`/`remark-gfm`), conversation history (browse/load/delete), suggestion chips, new chat button, auto-loads most recent conversation on reopen (`hasLoadedMostRecent` ref resets on close), stop button to interrupt TTS playback, ChatGPT-style barge-in (mic click during speech stops playback and starts recording), AbortController-based request cancellation with turn-scoped guards to prevent stale stream events. Has full access to ALL CRM database tables with smart intent detection. Also has internet access via web search. Uses SSE streaming for responses. User-scoped conversations (`conversations.userId` column) with ownership checks on all endpoints. Auth-protected endpoints: `POST /api/voice-assistant/ask` (voice), `POST /api/voice-assistant/text` (text), `GET /api/voice-assistant/conversations`, `GET /api/voice-assistant/conversations/:id/messages`, `DELETE /api/voice-assistant/conversations/:id`. Component: `client/src/components/voice-assistant.tsx`. Backend: `server/voice-assistant.ts`. Storage: `server/replit_integrations/chat/storage.ts`. Schema: `shared/models/chat.ts`. Integration files in `server/replit_integrations/` and `client/replit_integrations/`.

### Database
- **Type:** PostgreSQL.
- **ORM:** Drizzle ORM.
- **Schema:** Comprehensive schema covering users, leads, accounts, contacts, opportunities, tickets, quotes, activities, tasks, comments, attachments, communication lists, campaign drafts, partnerships, and ecosystem entities.
- **File Attachments:** `attachments` table supports polymorphic file uploads (images/videos) linked to any object (lead, account, partnership) via `objectType`/`objectId`. Files stored on disk in `uploads/` directory, served via `/api/attachments/file/:fileName`. Reusable `AttachmentsSection` component (`client/src/components/attachments-section.tsx`) integrated into lead, account, and partnership detail dialogs. Uses `multer` for multipart upload handling (50MB max, images and videos only).

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