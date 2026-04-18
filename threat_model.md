# VoltSafe Growth OS — Threat Model

_Generated: 2026-04-18 during the security hardening pass._
_Scope: server (Express/TypeScript), client (React/TS/Vite), PostgreSQL, integrations (Gmail/Jira/Confluence/OpenAI)._

---

## 1. Asset Inventory

| Asset | Sensitivity | Where it lives |
|---|---|---|
| User credentials (bcrypt cost-12 hashes) | Critical | `users` table |
| Session cookies (`connect.sid`, HttpOnly + Secure-prod + SameSite=Lax + 7-day) | Critical | Browser ↔ pg session store (`connect-pg-simple`) |
| Gmail OAuth tokens (access + refresh) | Critical | `email_accounts` table (per-user) |
| Inbound/outbound email content + attachments | High | `email_messages`, `email_attachments`, `/uploads` filesystem |
| CRM data (leads, accounts, contacts, opportunities, quotes, tickets) | High (PII + commercial) | Postgres (Neon) |
| Quote PDFs / XLSX exports | High | Generated on demand from DB |
| AI conversation history (OpenAI chats) | Medium-High (often contains CRM extracts) | `conversations` + `messages` tables |
| Help-center markdown / JSON assets | Low | Filesystem (`runtime/help-center`) |
| Webhook secrets (`GMAIL_WEBHOOK_TOKEN`, `SESSION_SECRET`) | Critical | Replit Secrets / `process.env` |
| Trackable email pixels + click links | Medium | Public — by design (`/track/open/:id`, `/track/click/:id`) |

## 2. Trust Boundaries

```
[Public Internet]
   │
   │  HTTPS / Cloudflare → Replit edge
   ▼
[Express server]   ── requireAuth ──> [authenticated user surface]
                                         │
                                         ├── requirePermission(section, level) ──> [section-scoped surface]
                                         │
                                         └── requireAdmin ──> [admin-only surface]
   │
   ├── /api/webhooks/gmail  (no session — token in query string)
   │
   └── /track/open|click/:id  (no session — public by design)

[Postgres / Neon]
   ⇡ all queries go through Drizzle (parameterised) or sql.raw template-literals (audited case-by-case)

[Gmail / Google Pub/Sub] → push notifications → /api/webhooks/gmail
[OpenAI / Jira / Confluence] → outbound only, server-side credentials
```

## 3. Existing Controls (verified)

| Control | Status | Evidence |
|---|---|---|
| `helmet` (CSP off, others on, HSTS in prod) | ✅ | `server/index.ts:33-41` |
| `trust proxy = 1` | ✅ | `server/index.ts:20` |
| Body limit 10 MB JSON + 10 MB urlencoded | ✅ | `server/index.ts:48-56` |
| Session: pg-store, HttpOnly, Secure(prod), SameSite=Lax, 7-day | ✅ | `server/index.ts:85-101` |
| `SESSION_SECRET` length-checked ≥32 in prod (refuses to boot otherwise) | ✅ | `server/index.ts:72-79` |
| CSRF origin/referer host-allowlist guard (fail-closed) | ✅ | `server/csrf.ts` |
| `requireAuth`, `requireAdmin`, `requirePermission(section, level)` | ✅ | `server/auth.ts:77-138` |
| bcrypt cost-12 password hashing | ✅ | `server/auth.ts:10-13` |
| `express-rate-limit` on `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/reset-password-by-token`, `/api/webauthn/auth-verify` | ✅ | `server/routes.ts:99-116, 624, 828, 872, 951` |
| Sensitive log-prefix redaction (passwords, tokens) | ✅ | `server/index.ts:155-183` (`SENSITIVE_LOG_PREFIXES`) |
| Email/Confluence HTML sanitiser (DOMParser-based, anchor hook, all event handlers + javascript:/data: hrefs neutralised) | ✅ shipped this session | `client/src/lib/sanitize-html.ts` (counter-validated 0 alerts across 21 attack payloads in real Vite build) |
| Email iframe `sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"` + `referrerPolicy="no-referrer"` | ✅ | `client/src/pages/gmail-inbox.tsx` |
| Attachment-file streaming requires auth + path containment + `Cache-Control: private,no-store` | ✅ | `server/routes.ts:4537-4552` |
| Attachment DELETE: owner-or-admin gate | ✅ | `server/routes.ts:4554-4575` |
| Email-search forces `scope=mine` for non-admins | ✅ | `server/routes.ts:10275-10306` |
| `/api/admin/*` use `requireAuth + requireAdmin` consistently | ✅ | spot-checked across `/api/admin/users`, `/api/admin/team-members`, `/api/admin/integrations`, etc. |
| Gmail mail-folder access scoped via `getAccessibleAccountIds` (own mailboxes + team-permission-grants) | ✅ | `server/services/gmail.ts` |

## 4. STRIDE — top risks remaining

### 🔴 ELEVATION-OF-PRIVILEGE / INFORMATION-DISCLOSURE — IDOR

| ID | Endpoint(s) | Severity | Status |
|---|---|---|---|
| **F-01** | `/api/conversations`, `/api/conversations/:id`, `/api/conversations/:id/messages`, `/api/conversations/:id/voice`, `DELETE /api/conversations/:id` — uses `chatStorage.getConversation/getAllConversations/deleteConversation` (no userId scoping) even though `chatStorage` already exposes safe `…ForUser` variants and `conversations.userId` column exists | **CRITICAL** | OPEN |
| F-02 | `/api/leads/:id`, `/api/accounts/:id`, `/api/contacts/:id`, `/api/opportunities/:id` (GET/PUT/DELETE) — section-level `requirePermission("crm","view\|edit")` only; no per-record ownership check | High | DEFERRED — likely intentional for 5-user team where everyone shares CRM; **must confirm with operator** |
| F-03 | `/api/quotes/:id/print` and `/api/quotes/:id/download/xlsx` — section-level `requirePermission("quoting","view")` only (NOT unauthenticated as previously feared — `app.use("/api/quotes", requireAuth, requirePermission(...))` at routes.ts:1025 wraps them) | High | DEFERRED — same intentional-team rationale as F-02 |
| F-04 | `/api/tasks/:id` PATCH — section-level only, no creator/owner check | Medium | DEFERRED — same intentional-team rationale |

### 🟠 SPOOFING — Webhook authentication

| ID | Endpoint | Severity | Status |
|---|---|---|---|
| **F-05** | `/api/webhooks/gmail` token comparison uses non-constant-time `req.query.token !== expected` (timing oracle) and the token sits in the URL query string (logged by upstream proxies / our own request logger) | High | OPEN |

### 🟠 STORED XSS — UI surfaces outside the email body

| ID | Component | Severity | Status |
|---|---|---|---|
| **F-06** | Leaflet map popups built via template literals interpolating CRM strings (`account.name`, `marina.name`, etc.) into raw HTML — see `client/src/pages/accounts.tsx:845-852`, `client/src/components/dashboard/dashboard-map.tsx`, `client/src/components/nearby-marinas-map.tsx`. If an attacker can store `<img src=x onerror=…>` in an account name (no server-side HTML rejection found on lead/account create), the payload fires for every user opening the map. | Medium-High | OPEN |
| F-07 | `client/src/pages/activity-feed.tsx:43` — `ENTITY_LINKS[type]?.(id)` uses dynamic property access where `type` is from the activity record. The dispatch table is closed (`contact|account|opportunity` → static template), so this is **NOT** exploitable; SAST false-positive. | None | RESOLVED (false positive) |

### 🟡 TAMPERING — SQL injection via fragile escaping

| ID | Location | Severity | Status |
|---|---|---|---|
| F-08 | `server/routes.ts:4570` — `db.execute(sql.raw(\`INSERT INTO activities … VALUES ('${attachment.objectType}', ${attachment.objectId}, …, 'Removed: ${docLabel}', …)\`))`. `docLabel` is hand-escaped with `replace(/'/g,"''")`; `objectType`/`objectId` come from a DB row written by the same app (so no direct user channel) but the pattern is brittle. | Low (chained risk only) | OPEN — recommend rewrite to parameterised drizzle insert |

### 🟡 DENIAL-OF-SERVICE — ReDoS

| ID | Location | Severity | Status |
|---|---|---|---|
| F-09 | `server/calendar-sync.ts:642` — `new RegExp(\`^${key}…\`)`. `key` is one of a closed list (`UID`, `SUMMARY`, `DTSTART`, etc.) — no user input. **NOT exploitable.** | None | RESOLVED (false positive) |
| F-10 | `server/services/engagement-rules.ts:181` — `new RegExp(cfg.urlPattern, "i")`. `cfg.urlPattern` is rule-config data, admin-controlled. Catastrophic backtracking possible if an admin writes a pathological pattern; defended by `try/catch`. | Low | ACCEPT |

### 🟢 INFORMATION DISCLOSURE — defence-in-depth gaps

| ID | Location | Severity | Status |
|---|---|---|---|
| F-11 | `helmet` Content-Security-Policy disabled (`contentSecurityPolicy: false`). Documented as intentional for Vite + inline scripts. XSS surface is already mitigated via the sanitiser + iframe sandbox, but CSP would add defence-in-depth. | Low | DEFER (would require Vite-aware nonce strategy; out of scope for this pass) |
| F-12 | `scripts/run-migration-pipeline.js:72` — `child_process` invocation with `cmd` arg. Dev-only script, never reachable from the running server. | None | ACCEPT (dev-only) |
| F-13 | `server/services/help-center-refresh.ts:355` `fs.readFile(path.join(RUNTIME_DIR, name))`. Caller at `server/routes.ts:433` validates `name` against `HELP_CENTER_ASSET_NAMES` allowlist before invoking, so the path-traversal sink is unreachable. | None | RESOLVED (false positive) |

## 5. Already shipped this session

| Fix | File(s) |
|---|---|
| CSRF origin/referer host-allowlist guard (fail-closed, webhook-prefix exempt) | `server/csrf.ts`, `server/index.ts` |
| Email/Confluence HTML sanitiser + DOMParser-based plaintext + safe anchor hook | `client/src/lib/sanitize-html.ts`, `client/src/pages/gmail-inbox.tsx`, `client/src/pages/confluence.tsx` |
| Email-iframe sandbox tightening (`allow-popups-to-escape-sandbox`, `referrerPolicy="no-referrer"`) | `client/src/pages/gmail-inbox.tsx` |
| Real-browser XSS validation harness (probe page deleted after run) | (validated → 0 alerts across 21 attack payloads) |

## 6. Proposed remediation order for T004

| Order | Finding | Effort | Blast radius |
|---|---|---|---|
| 1 | **F-01** Conversations IDOR — switch routes to `…ForUser` variants of chatStorage | XS (5 lines × 4 routes) | None — column already exists |
| 2 | **F-05** Webhook timing-attack — `crypto.timingSafeEqual`, redact `?token=` in request logger | S | None |
| 3 | **F-06** Map popup XSS — escape interpolated strings (or use Leaflet `bindPopup(domNode)` instead of HTML string) | S–M (3 files, ~6 popups) | UI-only |
| 4 | **F-08** Attachment-delete `sql.raw` — replace with parameterised drizzle `db.insert(activities).values({…})` | S | None |
| 5 | **F-02 / F-03 / F-04** record-level CRM/quote/task IDOR — **CONFIRM-WITH-OPERATOR FIRST**: is shared-team access intentional? If yes, mark ACCEPTED. If no, design owner-or-grantee filter and apply uniformly. | M–L | High (changes data visibility) |
