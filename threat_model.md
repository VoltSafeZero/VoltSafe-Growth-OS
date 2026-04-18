# VoltSafe Growth OS — Threat Model

**Date:** 2026-04-18
**Scope:** Express/React/PostgreSQL CRM (single-tenant, internal team).
**Trust boundaries:** internet ↔ Express ↔ PostgreSQL ↔ Gmail/Jira/Confluence APIs ↔ Google Pub/Sub webhook.

## Trust zones

| Zone | Examples | Trust |
|------|----------|-------|
| **Public internet** | unauthenticated browser, anonymous bot, Pub/Sub publisher | none |
| **Authenticated user** | session cookie holder (sales rep, ops) | low — data scoping enforced by `requirePermission` |
| **Admin** | `globalRole ∈ {admin, master_admin}` | high — bypasses `requirePermission` |
| **Server process** | Express runtime, scheduled syncers | full DB + outbound API |
| **PostgreSQL** | session store + business data | full |
| **Third-party APIs** | Google OAuth, Gmail, Jira, Confluence, OpenAI | bounded by per-user OAuth tokens |

## STRIDE summary

| Threat | Surface | Mitigation in place |
|--------|---------|---------------------|
| **S**poofing | session cookie theft, replayed login | `httpOnly`, `secure` (prod), `sameSite=lax`, `connect-pg-simple` server-side store, session regenerate on login (fixation defence), bcrypt cost 12, `requireAuth` everywhere |
| **T**ampering | CSRF on state-changing routes | `csrfOriginGuard` allowlist on Origin/Referer; webhooks exempt |
| **R**epudiation | unattributable mutations | `activities` audit table for CRM writes; voice-assistant has additional `assistant_*` activity rows |
| **I**nformation disclosure | unauth list endpoints, IDOR, log leakage | `requireAuth` + `requirePermission` (now applied to quotes/exports/users/attachments — see findings); sensitive route prefixes redacted from response logs |
| **D**enial of service | brute-force login, password-reset flood | `loginRateLimiter`, `passwordResetRateLimiter`, `resetTokenRateLimiter`; helmet HSTS in prod |
| **E**levation of privilege | role manipulation, admin route bypass | `requireAdmin` checks `session.globalRole` (re-validated from session, not user input); permission grants restricted to `requireAdmin` routes |

## Key attack surface

1. **Session/auth (`server/index.ts`, `server/auth.ts`)** — solid baseline; `SESSION_SECRET` enforced ≥32 chars in prod, dev fallback only with loud warning.
2. **Login (`POST /api/auth/login`)** — rate-limited; bcrypt cost 12; session regen on login.
3. **Forgot/reset password** — `passwordResetRateLimiter`/`resetTokenRateLimiter`; user-enumeration-safe ("if that email exists" response); 1-hour token TTL with `crypto.randomBytes(32)`.
4. **Admin user CRUD (`/api/admin/users/*`)** — `requireAuth + requireAdmin` consistently.
5. **CRM mutate routes** — `requirePermission(section, "edit")` on POST/PUT/PATCH/DELETE for leads/accounts/quotes/etc.
6. **Voice-assistant tools (`server/voice-assistant-safety.ts`)** — write-tool safety lockdown (Build #1) + create-tool dispatch (Build #2): permission re-check, enum/scalar validation, risk-based confirmation gate via pending-confirm rows, per-conversation in-process mutex, audit rows.
7. **Gmail webhook (`POST /api/webhooks/gmail`)** — query token verified with `crypto.timingSafeEqual` against `GMAIL_WEBHOOK_TOKEN`; CSRF-exempt by design.
8. **CSV/XLSX/HTML exports** — now auth-gated (see findings).
9. **File uploads (`POST /api/attachments`)** — multer to `uploads/` dir; now auth-required; SQL audit insert switched to parameterized form (see findings).

## Top risks (ranked) — see SECURITY_FINDINGS.md for status

1. **[FIXED]** Unauthenticated read of quotes / quote PDFs / quote XLSX / exports — would have leaked all customer + pricing data.
2. **[FIXED]** Unauthenticated read of `/api/users` — leaked id/name/email of every team member.
3. **[FIXED]** SQL injection via `sql.raw` in `/api/attachments` POST/PATCH activity-write.
4. **[FIXED]** Unauthenticated `/api/attachments` upload + listing.
5. **[FIXED]** 4 high-severity CVEs in axios, dompurify, lodash, vite + 1 transitive (follow-redirects) — patched via overrides.
6. **[DEFERRED]** drizzle-orm 0.39.3 → 0.45.2 (high CVE) — major framework bump touches every storage call; needs scheduled work.
7. **[ACCEPTED]** CSP header disabled — quote-preview/email-render surfaces inject sanitized HTML; tightening requires nonce/hash rollout. Documented at `server/index.ts:30`.
8. **[ACCEPTED]** Session cookie name unchanged (`connect.sid`) — fingerprinting only; renaming would break 11 test files. Documented at `server/index.ts:91`.
