# Threat Model — VoltSafe Growth OS

## Project Overview

VoltSafe Growth OS is a single-tenant CRM / sales / mailbox platform for the
VoltSafe team (5–20 internal users, no external customer logins). Stack:

- **Frontend**: React 18 + TypeScript, Vite, Wouter, TanStack Query, shadcn/ui
- **Backend**: Node.js + Express + `tsx` (single process serving API + Vite SSR)
- **DB**: Replit-managed PostgreSQL via Drizzle ORM (schema in `shared/schema.ts`).
  ⚠️ The live `email_tracking_pixels` table has production columns that do NOT
  exist in `shared/schema.ts` — `npm run db:push` would DROP those columns.
- **Auth**: cookie-session (express-session + connect-pg-simple). Optional
  WebAuthn second factor wired but not enforced.
- **External integrations**: Gmail (per-user OAuth tokens), Jira, Confluence,
  OpenAI (modelfarm), Replit AI integrations (chat / image / audio).
- **Hosting**: Replit Deployments at `voltsafe.app`.

Login is internal-only — there is no public signup. New users are provisioned
by an admin and start with `mustChangePassword=true`.

## Assets

- **User credentials** — bcrypt-hashed passwords (now cost=12), session cookies,
  password-reset tokens (1 h expiry), WebAuthn credentials. Compromise =
  full impersonation.
- **Gmail OAuth tokens** — per-user refresh tokens stored in `email_accounts`.
  Compromise lets an attacker read or send email as any connected user.
- **Mailbox content** — full message bodies, headers, attachments, drafts,
  scheduled sends, search indexes. Includes customer PII, contracts, pricing,
  and inbound legal/compliance correspondence.
- **CRM records** — leads, accounts, contacts, opportunities, quotes, tickets,
  attachments, project documents. Includes pricing, marina locations, contact
  info, and quote PDFs.
- **Document uploads** — files in `/uploads` (general attachments) and
  `/uploads/assets` (knowledge base). Stored on disk, served via authenticated
  API routes.
- **Application secrets** — `SESSION_SECRET`, `DATABASE_URL`, `GOOGLE_CLIENT_*`,
  `GMAIL_WEBHOOK_TOKEN`, `GMAIL_PUBSUB_TOPIC`, `OPENAI_API_KEY`, Jira/Confluence
  tokens. Stored in Replit Secrets (env vars).
- **Audit context** — `lastLogin`, `suspendedAt/Reason`, `mustChangePassword`,
  basic activity rows. There is currently NO dedicated audit-log table.

## Trust Boundaries

- **Browser ↔ Express API** — same-origin SPA. The browser is untrusted; every
  protected route runs through `requireAuth` and (where applicable)
  `requirePermission(section, level)` or `requireAdmin`.
- **Express ↔ PostgreSQL** — server has full DB credentials. Any SQL injection
  at the API layer is total compromise of CRM + mailbox data. Most reads use
  Drizzle parameterized builders, but `routes.ts`, `routes-tasks.ts`, and many
  `services/*.ts` files use `db.execute(sql.raw(\`…${value}…\`))` — these MUST
  be reviewed any time user-controlled values are interpolated. (Current SAST
  flags hundreds of `sql.raw` usages; most interpolate trusted server-side
  values, but the pattern is fragile.)
- **Express ↔ Gmail / Google APIs** — outbound OAuth using the user's stored
  refresh token. Token theft = mailbox compromise.
- **Public ↔ Authenticated** — explicit public surfaces are:
  - `/health`
  - `/track/click/:trackingId` and the open-pixel route (intentional, for email
    engagement tracking; should never accept arbitrary HTML or perform writes
    beyond logging the event).
  - `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/reset-password-by-token`
  - `/api/webhooks/gmail` (Pub/Sub push, authenticated by `?token=` shared secret)
  - `/api/auth/google/callback` (Google OAuth redirect)
- **Authenticated ↔ Admin** — admin routes (`/api/admin/*`, user
  create/suspend/permissions, system reindex, global resync) require
  `globalRole ∈ {master_admin, admin}` and are guarded by `requireAdmin` /
  the admin-check helpers in `routes.ts`. Per-section permissions
  (`requirePermission("crm","view")` etc) gate non-admin reads/writes.
- **Internal users ↔ Each other** — this is intentionally a **shared workspace**.
  Authenticated employees with a section's `view` permission can see every
  record in that section (every contact, every lead, every quote). There is no
  per-record owner ACL beyond a few specific surfaces (mail_team mailbox
  scoping, calendar_team calendar sharing, attachment-delete owner-or-admin).
  This is by design for a 20-person internal CRM but is documented here so any
  future "guest user" / "external partner" feature understands the gap.

## Scan Anchors

- **Production entry points**:
  - `server/index.ts` — Express bootstrap, helmet, session, log middleware.
  - `server/routes.ts` (~19,800 lines) — primary API surface. Auth/admin/users/
    gmail/CRM/quotes/attachments/exports/webhooks all live here.
  - `server/routes-tasks.ts` — task management routes.
  - `server/replit_integrations/{chat,image,audio}/routes.ts` — AI passthrough.
- **Highest-risk code areas**:
  - `server/routes.ts` L600–930 — auth flows, session cookie issuance.
  - `server/routes.ts` L4490–4880 — `/api/admin/*` user management.
  - `server/routes.ts` L7290–9650 — Gmail surface (threads, drafts, send,
    associations, review queue).
  - `server/routes.ts` L4444 (file streaming), L10950, L12107 — disk file
    streaming routes; auth + ownership checks must be tight.
  - `server/routes.ts` L10136 — Gmail Pub/Sub webhook (shared-secret token).
  - Anything calling `sql.raw(\`…\`)` — search with grep before edits.
- **Public surfaces** (list above under Trust Boundaries).
- **Dev-only / scripts** — `scripts/*.ts`, `tests/*.test.js`, and the
  `Attachment backfill` / `HTML backfill` workflows. These run with full DB
  access but are not reachable over HTTP. SAST findings against `scripts/` are
  generally not production threats unless the script itself runs in prod.

## Threat Categories

### Spoofing

- Sessions are cookie-based, signed with `SESSION_SECRET` and stored in
  Postgres via `connect-pg-simple`. As of this hardening pass, the server
  **refuses to start in production if `SESSION_SECRET` is missing or <32 chars**.
- The login flow now **regenerates the session ID** before stamping the user's
  identity, preventing session-fixation attacks (an attacker can no longer
  pre-plant a session cookie and ride it into the victim's authenticated
  session).
- `/api/webhooks/gmail` requires a query-string shared secret matched against
  `GMAIL_WEBHOOK_TOKEN`. Pub/Sub-pushed payloads are then parsed; the email
  address claim is looked up in `email_accounts` and a sync is triggered. We
  do NOT verify the JWT in the `Authorization: Bearer …` header that Pub/Sub
  optionally provides — if Pub/Sub authentication is added later, switch to
  verifying that JWT instead of the query-string token (query-string secrets
  end up in proxy and access logs).
- Google OAuth callback (`/api/auth/google/callback`) uses Google's standard
  `code` exchange. State validation must match the originator's session — verify
  this when next touching that handler.

### Tampering

- All write routes are server-side authoritative — quote totals, line-item
  pricing, permissions, statuses are computed in Express against DB lookups,
  never trusted from the client.
- Drizzle parameterized queries are the default. The pervasive `sql.raw` usage
  is the main risk: anywhere user input is interpolated into `sql.raw(\`…\`)`,
  it MUST be coerced (e.g. `Number(req.params.id)` then validated) or escaped.
  See SAST output for the current list.

### Repudiation

- There is **no dedicated audit log**. `users.lastLogin` and the activities
  table capture some actions but not enough for forensic reconstruction (no
  per-route admin-action log, no permission-change history, no "who downloaded
  this attachment" trail).
- This is a known gap. Required guarantee: **adding an audit-log table is the
  recommended next step** (deferred this session per scope).

### Information Disclosure

- The most common foot-gun was full response bodies being JSON-stringified and
  written to stdout for every `/api/*` call (see `server/index.ts`'s logging
  middleware). This is now suppressed for all sensitive prefixes
  (`/api/auth`, `/api/admin`, `/api/users`, mailbox routes, CRM record routes,
  `/api/quotes`) — those routes log only `METHOD path STATUS in Xms`. Other
  responses are truncated to 500 chars.
- Response shapes for `/api/auth/login` and `/api/auth/me` deliberately
  exclude the password hash. The full `users` row is never returned to a
  non-admin caller.
- File downloads:
  - `/api/attachments/file/:fileName` is now `requireAuth`-gated and sets
    `Cache-Control: private, no-store`. Filenames are random/UUID-shaped so
    direct guessing is impractical, but anonymous access was previously
    possible if a filename leaked (e.g. via reused links, log scraping).
  - `/api/assets/:id/file` is gated by `requirePermission("knowledge","view")`.
  - `/api/projects/:id/attachments/:aid/download` is gated by
    `requirePermission("projects","view")` AND verifies the attachment belongs
    to the requested project — but any authenticated user with `projects:view`
    can download any project attachment. This is **by design** for an internal
    CRM (employees can see all projects in their permission section).
- Forgot-password endpoint always returns the same success message regardless
  of whether the email exists (anti-enumeration).

### Denial of Service

- **NEW**: `/api/auth/login` (10 fail/15 min/IP), `/api/auth/forgot-password`
  (5/hr/IP), and `/api/auth/reset-password-by-token` (20/15min/IP) now have
  per-IP rate limiters via `express-rate-limit`. Other unauthenticated POSTs
  (webhooks, callback) inherit no rate limit but are signature-/secret-gated.
- Body limits: `express.json({ limit: "10mb" })` and matching `urlencoded`.
  This caps inbound JSON but does NOT cap multipart file uploads — those use
  multer with route-specific limits. Audit any new multer config for
  `limits: { fileSize, files }`.
- No global rate limit on authenticated API. A logged-in attacker (or runaway
  client) can hammer expensive endpoints. Consider a coarse global limiter on
  `/api/email-search` and `/api/gmail/*` next.

### Elevation of Privilege

- Two role layers:
  1. `users.globalRole` (`master_admin` | `admin` | other) — gate for
     `/api/admin/*` and a handful of system-wide ops.
  2. `users.permissions` (per-section `view`/`edit`/`none` JSON) — gate for
     CRM / knowledge / projects / partnerships / etc. reads & writes.
- Centralised middleware: `requireAuth`, `requireAdmin` (now also exported
  from `server/auth.ts`), `requirePermission(section, level)`. Section reads
  are wrapped via `app.use("/api/<section>", requireAuth, requirePermission(...))`
  in the router setup block (`server/routes.ts` ~L920).
- **NEW**: `/api/email-search/reindex` — was previously only `requireAuth`.
  Now requires admin role.
- **NEW**: `/api/auth/login` and `/api/auth/reset-password-by-token` now
  refuse to mint a session for `status ∈ {suspended, deactivated}` users
  (previously only `change-password` flow checked this).
- Default new-user permission posture: when an admin creates a user via
  `POST /api/admin/users` they set the permissions explicitly; the default
  fallback in `/api/auth/me` is `edit` on every section. **This is permissive
  by default** — a future hardening pass should change the storage-layer
  default and the `/api/auth/me` fallback to `none` for newly-created users
  with no explicit `permissions` JSON, so admins must opt-in to access
  ("deny by default").

## Required Guarantees (Declarative)

- All `/api/*` routes except the explicit public list in **Trust Boundaries**
  MUST be gated by `requireAuth`.
- `/api/admin/*` and any route that mutates other users' accounts MUST be
  gated by `requireAdmin` in addition to `requireAuth`.
- `SESSION_SECRET` MUST be set to a random ≥32-char value in production. The
  bootstrap refuses to start otherwise.
- Sessions MUST be regenerated on login (and on reset-by-token sign-in).
- Session cookies MUST be `httpOnly`, `sameSite=lax`, and `secure` in
  production.
- Passwords MUST be bcrypt-hashed at cost ≥12. Plaintext passwords MUST NOT
  appear in any log or response body.
- Reset tokens MUST be single-use and expire within ≤1h.
- Response bodies for `/api/auth/*`, `/api/admin/*`, `/api/users*`,
  mailbox routes, and CRM record routes MUST NOT be written to stdout.
- File-streaming routes MUST require auth and SHOULD set
  `Cache-Control: private, no-store`.
- `/uploads` MUST be served only via the authenticated API routes — never
  by `express.static` from outside.
- `/api/webhooks/gmail` MUST verify the shared-secret token before doing any
  work; if Google Pub/Sub OIDC auth is enabled later, switch to verifying the
  Bearer JWT instead of the query-string token.
- All write routes MUST validate input via Zod schemas where
  `insertXSchema` exists in `shared/schema.ts`.
- `db.execute(sql.raw(\`…\`))` MUST never interpolate raw user input. Coerce
  to `Number()` or escape via Drizzle's `sql\`…${param}\`` template form.
