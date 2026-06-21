# Threat Model — VoltSafe Growth OS

## Project Overview

VoltSafe Growth OS is a marina-focused CRM and sales operations tool. Stack:

- **Frontend** — React + TypeScript + Vite (single-page app), shadcn UI, TanStack Query, wouter routing.
- **Backend** — Node.js + Express, served on the same origin as the SPA. Single `server/index.ts` entrypoint, ~650 routes registered in `server/routes.ts` (and `server/routes-tasks.ts`).
- **Database** — PostgreSQL accessed via Drizzle ORM. Sessions persisted in PG via `connect-pg-simple`.
- **Auth** — Email + bcrypt password (cost 12) with optional WebAuthn for second factor; session cookie (`connect.sid`, httpOnly, sameSite=lax, `secure` in production), 7-day lifetime.
- **Integrations** — Google Workspace (Gmail OAuth + Pub/Sub push webhooks), Jira, Confluence, OpenAI (gpt-5-nano + gpt-audio for the voice assistant).
- **Hosting** — Replit Deployments. Public origin via the assigned `*.replit.app` domain or a configured custom domain.

Users are VoltSafe sales / customer-success / admin staff plus designated read-only or limited-permission roles. There is no public end-user surface — all non-webhook routes require an authenticated session.

## Assets

- **User credentials & sessions** — bcrypt password hashes, WebAuthn credentials, `connect.sid` session cookie, password-reset tokens. Compromise = full account takeover, including admin accounts that can read every mailbox and CRM record.
- **Customer CRM data** — leads, accounts, contacts, opportunities, quotes, tickets, projects, install workflows, attachments, notes, activities. Contains company PII, deal sizes, contact emails, and proprietary marina infrastructure details.
- **Email content & metadata** — full Gmail message bodies, attachments, thread metadata, Gmail OAuth refresh tokens for every connected mailbox. The app holds the only practical attack surface for these tokens outside Google itself.
- **Calendar data** — Google Calendar / CalDAV events, attendees, locations.
- **Application secrets** — `SESSION_SECRET`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_WEBHOOK_TOKEN`, OpenAI API key, Jira/Confluence tokens.
- **Audit log** — `activities` table, plus the `assistant_denial` rows the voice assistant emits. A repudiation defense — must always be writable, hence the `safeAuditWrite` file fallback in `server/voice-assistant-create-guards.ts`.
- **File uploads** — `/uploads/*` on disk, served exclusively via `/api/attachments/file/:fileName`. Files are stored under random UUID filenames but are not encrypted at rest.

## Trust Boundaries

- **Browser ↔ API** — every state-changing request must carry the `connect.sid` cookie, originate from an allowlisted host (CSRF origin guard in `server/csrf.ts`), and pass route-level `requireAuth`/`requirePermission`/`requireAdmin` checks. The browser is untrusted.
- **API ↔ PostgreSQL** — the API has full DB privileges. SQL injection at the API layer = total data compromise. Drizzle parameterized queries are the default; the few remaining `sql.raw()` interpolations are gated by validators (`Number()` casts or whitelist checks) before interpolation.
- **API ↔ Google (Gmail / Pub/Sub / Calendar)** — outbound is OAuth-signed; inbound Pub/Sub push uses a shared secret in the webhook URL (`?token=…`) compared in constant time against `GMAIL_WEBHOOK_TOKEN`.
- **API ↔ OpenAI** — outbound only; no inbound webhooks. Voice assistant tool selection runs through a hardened dispatch layer (`server/voice-assistant-safety.ts`) with rate limits, idempotency, and a permission-aware visibility check on every linked-object operation.
- **Authenticated ↔ Admin** — admin-only routes (`/api/admin/*`, user management, suspend/activate, dry-run sweeps) are gated by `requireAdmin` (`server/auth.ts:93`). Section-level permissions (`crm`, `support`, etc.) are enforced by `requirePermission`.
- **Production ↔ Development** — `NODE_ENV=production` makes session cookies `secure: true`, enables HSTS, refuses to start without a real `SESSION_SECRET ≥ 32 chars`, and serves the prebuilt SPA via `serveStatic` (no Vite dev server reachable).

## Scan Anchors

- **Production entry points** — `server/index.ts`, `server/routes.ts` (heavy — 21k+ LOC), `server/routes-tasks.ts`, `server/voice-assistant.ts`, `server/voice-assistant-safety.ts`.
- **Highest-risk surfaces** — file streaming (`/api/attachments/file/:fileName`), Gmail send / draft / sync (`/api/gmail/*`), admin user management (`/api/admin/users/*`), webhook (`/api/webhooks/gmail`), voice-assistant create dispatch (`server/voice-assistant-safety.ts`), CSV / PDF export.
- **Authentication & session** — `server/auth.ts`, session config block in `server/index.ts:85-102`, login rate limiter in `server/routes.ts:99-122`.
- **CSRF** — `server/csrf.ts` (origin/referer host allowlist; webhooks exempt by design).
- **Public surfaces** — `/health`, `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/webhooks/gmail`, OAuth callbacks (`/api/auth/google/callback`, `/api/calendar/auth/callback`), tracking pixel (`/api/tracking/*`). Everything else requires an authenticated session.
- **Admin-only** — every route under `/api/admin/*` and a small number of `/api/users/:id` mutations; gated by `requireAdmin` in `server/auth.ts:93` or the local copy in `server/routes.ts:4612`.
- **Dev-only / not production** — `scripts/seed-low-perm-user.ts` (test fixture user), `scripts/build2-smoke.ts`, `scripts/build2-llm-harness.ts`, `scripts/security-attachment-idor.test.ts`, `scripts/run-migration-pipeline.js`. None are reachable at runtime in production.

## Threat Categories

### Spoofing

Sessions are signed with `SESSION_SECRET` (≥32 chars, enforced fail-closed in production) and stored server-side in PostgreSQL via `connect-pg-simple`, so cookie values are unguessable session IDs and not self-contained tokens. Login is rate-limited (10 failed attempts / IP / 15 min). The Gmail Pub/Sub webhook (`/api/webhooks/gmail`) is the only trust boundary that authenticates with a shared secret rather than a session: it uses `crypto.timingSafeEqual` after a constant-length pre-check, and the secret never appears in our application logs (the logger logs `req.path`, not `req.url`).

Required guarantees:

- All state-changing API endpoints MUST require a valid session cookie or a per-route signed token.
- The webhook secret MUST be compared in constant time and MUST be rotatable without code changes.
- Login MUST be rate-limited per IP and MUST regenerate the session ID on success (session-fixation defense — present at `server/routes.ts:624`).
- OAuth account-linking flows MUST generate a per-session `state` value and MUST validate it on callback before exchanging codes or upgrading the flow to a shared-workspace connection.
- Production startup MUST NOT create reachable accounts with shared or predictable bootstrap credentials; any seed-user path must be dev-only or otherwise blocked from running in production.

### Tampering

The frontend never carries authority — every business rule (price, permission, owner) is recomputed server-side in `server/routes.ts` or the storage layer. Drizzle parameterized queries are the default. The few remaining `sql.raw()` template-literal interpolations either coerce numerics with `Number()` first or whitelist string types against a fixed set (`SUMMARY_TYPES` in `server/routes.ts:1979`). The CSRF origin guard (`server/csrf.ts`) blocks cross-site state-changing requests for any path outside `/api/webhooks/*`.

Required guarantees:

- All SQL inputs from request bodies/params MUST be parameterized OR validated against a fixed allowlist before interpolation.
- All state-changing requests outside `/api/webhooks/*` MUST pass the Origin/Referer host check.
- Quote totals, lead deal amounts, and permission grants MUST be recomputed server-side; client-supplied amounts on `create_lead ≥ $100k` trigger a confirmation gate (voice assistant) before insert.

### Repudiation

The `activities` table records create/update/delete operations. The voice assistant additionally writes `assistant_denial` rows for every blocked request (rate-limit, permission, idempotency-skip), and `safeAuditWrite` (in `server/voice-assistant-create-guards.ts`) writes a fallback line to `logs/assistant-audit-fallback.log` if the DB write throws. The internal counter (`getAuditFallbackCount`) is exported so an operator can monitor for silent audit loss.

Required guarantees:

- Every authenticated mutation that touches CRM / mailbox / user data MUST emit an audit row including `created_by`, `created_at`, and the affected linked object.
- Audit-write failures MUST NOT silently drop the record AND MUST NOT roll back the underlying success.

### Information Disclosure

The API logger explicitly skips response-body logging for sensitive route prefixes (`/api/auth`, `/api/admin`, `/api/users`, `/api/webauthn`, `/api/gmail`, etc. — see `server/index.ts:124`). Stack traces are returned as `{ message }` only and the full error is logged server-side. `getUsers()` returns only `id, name, email` (no password hashes, no permission JSON). The voice-assistant visibility helper (`requireAccessibleLinkedObject`) returns the same opaque error for "doesn't exist" and "you don't have access" so authenticated users cannot enumerate object IDs they can't see.

The attachment file route (`/api/attachments/file/:fileName`) was previously vulnerable to enumeration by any authenticated user — fixed in this pass (F-09): it now performs a per-attachment ACL check (admin / uploader / section-permission) and returns a uniform `404` for both "no such file" and "no access".

Required guarantees:

- API response logging MUST be suppressed for any route prefix that can return PII or credentials; the SENSITIVE_LOG_PREFIXES list is the source of truth.
- Permission-denied responses MUST NOT include enumerable identifiers; uniform 403/404 strings are required for any per-row access check.
- Password hashes, WebAuthn credentials, and OAuth refresh tokens MUST NEVER be returned in any API response and MUST NEVER appear in logs.

### Denial of Service

Express body limit is 10 MB; multer file uploads are capped at 50 MB per file (assets at 100 MB) and restricted to a MIME allowlist. Login, password-reset, and reset-token endpoints have dedicated rate limiters (`server/routes.ts:99-122`). The voice assistant adds two further sliding-window limiters (per-tool 10/min, per-user 30/min). Long-running outbound calls (Gmail, OpenAI) use the upstream client's defaults; there are no application-level timeouts on every external call.

Required guarantees:

- Every public-facing auth endpoint MUST be rate-limited per IP.
- Body size and file upload limits MUST be set on every multipart entry point.
- Any newly added external-call dependency SHOULD be wrapped in a timeout to avoid a slow-loris style hang propagating into the request queue.

### Elevation of Privilege

`requireAdmin` (`server/auth.ts:93`) and `requirePermission(section, level)` are the canonical authorization gates and are enforced server-side on every admin/sensitive mutation. Every `/api/admin/*` route in `server/routes.ts` is wrapped with `requireAuth, requireAdmin`. Section permissions are stored in the `users.permissions` JSON column as `{ crm: "view"|"edit"|"none", support: ..., admin: ..., dashboard: ... }` and are evaluated at the API layer; admin/master_admin bypass section gates. The voice assistant additionally enforces visibility on every linked-object reference and rejects unknown-section access.

Required guarantees:

- Frontend role checks are advisory only; the server MUST re-check role and section permissions on every mutation.
- New admin functionality MUST be wrapped in `requireAdmin` (or a stricter gate) at registration time, never gated behind UI-only conditions.
- Any new file-system or DB-backed resource MUST go through a per-row ACL helper if accessible by ID (see `requireAccessibleLinkedObject` and `requireSectionView` in `server/voice-assistant-create-guards.ts`).
