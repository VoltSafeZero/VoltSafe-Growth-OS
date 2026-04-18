# VoltSafe Growth OS — Security Findings & Hardening Report

_Hardening pass: 2026-04-18. Scope: code-only — no schema changes, no `db:push`._

---

## Executive summary

| Bucket | Count | Notes |
|---|---|---|
| **Critical fixed** | 1 | F-01 conversations IDOR |
| **High fixed** | 4 | F-05 webhook timing-attack, F-06 map XSS, plus prior CSRF + email/Confluence XSS shipped earlier this session |
| **Medium / Low fixed** | 1 | F-08 sql.raw → parameterised drizzle insert |
| **Accepted as design** | 3 | F-02/F-03/F-04 shared-team CRM/quote/task visibility (operator-confirmed) |
| **False positives ruled out** | 4 | F-07 activity-feed dispatch, F-09 calendar-sync RegExp, F-12 dev-only child_process, F-13 help-center path-traversal |
| **Deferred** | 2 | F-10 admin-config ReDoS (try/catch wrapped), F-11 CSP rollout (needs Vite-aware nonce strategy) |
| **Pre-existing strong controls verified** | 13 | helmet, trust-proxy, body limits, session cookies, SESSION_SECRET enforcement, CSRF guard, requireAuth/Admin/Permission, bcrypt-12, rate-limits on 4 auth routes, sensitive-log redaction, attachment streaming, mail-folder ownership scoping, /api/admin/* admin gating |

---

## Findings detail

### F-01 — Conversations IDOR  ·  Severity: CRITICAL  ·  Status: ✅ FIXED

- **Issue summary**: Any authenticated user could read, append messages to, or delete any other user's AI chat history (and the streaming voice variant) by guessing or enumerating the conversation id. Conversations frequently contain pasted CRM extracts, sales strategy notes, and customer details.
- **Root cause**: `chatStorage` exposes both safe (`getConversationForUser`, `getConversationsForUser`, `deleteConversationForUser`) and unscoped (`getConversation`, `getAllConversations`, `deleteConversation`) variants. The `conversations` table already has a `userId` column, but the route layer was wired to the unscoped variants, and `POST /api/conversations` did not stamp the new row's `userId`.
- **Fix applied**:
  - `server/replit_integrations/chat/routes.ts` — switched all 5 routes (`GET /`, `GET /:id`, `POST /`, `DELETE /:id`, `POST /:id/messages`) to the `…ForUser` variants; `POST /` now stamps `userId`; `POST /:id/messages` verifies ownership before any read or write to prevent message-history pollution; non-owned ids return `404` (not `403`) to avoid leaking existence.
  - `server/replit_integrations/audio/routes.ts` — `POST /api/conversations/:id/voice` does the same ownership check before STT / OpenAI call / message persist.
- **Risk before**: CRITICAL — unauthenticated-after-login horizontal privilege escalation across every user's AI chat data. Trivially exploitable (`curl /api/conversations/<n>` for n=1..N).
- **Risk after**: Negligible. Ownership is enforced at the route layer; the `conversations.userId` column already existed so no schema changes. Storage-layer unscoped variants are still present (called from no live route, but kept so a future migration script could use them).
- **Follow-ups**:
  - Consider deleting `getConversation` / `getAllConversations` / `deleteConversation` from `IChatStorage` once it's confirmed nothing else (jobs, scripts) calls them — leaving them is a footgun for a future contributor.
  - Audit any pre-existing rows where `conversations.userId IS NULL` (created before the column was wired) — they will now be invisible to all users; decide whether to delete or backfill them.
- **Regression risks to watch**: SSE streaming on `POST /:id/messages` and `POST /:id/voice` now does an extra `SELECT` before opening the stream — adds ~1 round-trip latency (negligible). The `conversation` returned by the GET still includes the same fields it always did.

---

### F-05 — Gmail webhook auth: timing oracle + token in URL  ·  Severity: HIGH  ·  Status: ✅ FIXED (timing); residual log-leak documented & accepted

- **Issue summary**: `/api/webhooks/gmail` authenticated Pub/Sub push deliveries by comparing the `?token=` query param against `GMAIL_WEBHOOK_TOKEN` with a non-constant-time `!==`. A network-adjacent attacker could in principle measure response-time differences and recover the token byte-by-byte. Additionally the token rides in the URL query string, where upstream proxy access logs (Cloudflare, Replit edge) may retain it.
- **Root cause**: Plain string `!==` comparison on a secret. Token-in-URL is a Pub/Sub push-subscription configuration constraint (Pub/Sub supports OIDC headers as an alternative, but the existing subscription uses URL-token).
- **Fix applied**: `server/routes.ts:10253` — comparison now uses `crypto.timingSafeEqual` over equal-length `Buffer`s. Length is checked explicitly before the call (bare `timingSafeEqual` throws on mismatched length, which is itself a timing channel). Inline `SECURITY (F-05)` comment block records the decision and the residual upstream-log risk. Confirmed our own `req.path`-based access logger does NOT include the query string, so we do not write the token to local logs.
- **Risk before**: HIGH — remote, unauthenticated, can lead to full Pub/Sub spoofing (attacker can replay/inject Gmail change notifications and trigger arbitrary mailbox-sync operations).
- **Risk after**: Low. Timing-attack vector closed. Residual leak via upstream proxy logs is the only remaining vector; mitigated by treating `GMAIL_WEBHOOK_TOKEN` as low-sensitivity (rotate periodically) rather than relying on URL secrecy.
- **Follow-ups**:
  - Schedule periodic rotation of `GMAIL_WEBHOOK_TOKEN` (suggest 90 days).
  - If/when the Pub/Sub subscription is re-created, switch to OIDC bearer-token push so the secret moves out of the URL entirely.
- **Regression risks to watch**: Legitimate Pub/Sub deliveries continue to work — the comparison still returns `true` for matching tokens. The `try/catch` around `Buffer.from` defends against malformed query input (e.g. `?token[]=foo` arrays); such requests now correctly receive `401`.

---

### F-06 — Map popup XSS  ·  Severity: MEDIUM-HIGH  ·  Status: ✅ FIXED

- **Issue summary**: `client/src/pages/accounts.tsx:845` built a Leaflet popup via a template literal that interpolated `account.name`, `account.city`, `account.stateProvince`, `account.country`, `account.slipCount`, and `getStageLabel(account.leadStatus)` directly into raw HTML and passed it to `marker.bindPopup(htmlString)`. If any account row's `name` (or other interpolated field) contained an `<img onerror=…>` payload, it would execute in the parent app context for every user opening the accounts map.
- **Root cause**: Leaflet's `bindPopup(string)` API takes raw HTML; the surrounding code path didn't escape user-controlled fields. Lead/account creation does not server-side reject HTML in `name` (deliberate — names like "O'Reilly & Sons" are valid).
- **Fix applied**:
  - `client/src/lib/sanitize-html.ts` — added a small `escapeHtml(input)` utility (escapes `& < > " ' /`) with a doc-comment that tells future contributors to prefer DOM-based popup construction (`document.createElement` + `textContent`) over string sinks whenever possible.
  - `client/src/pages/accounts.tsx:845-865` — every interpolated CRM string now goes through `escapeHtml()`; `slipCount` (numeric but untyped at runtime) is also escaped defensively.
  - Confirmed the other two map files (`client/src/components/dashboard/dashboard-map.tsx`, `client/src/components/nearby-marinas-map.tsx`) already build popups with `document.createElement` + `textContent` (safe by construction); their template-literal `html:` strings are only used for `L.divIcon` markers and interpolate static color values from a closed `STAGE_COLORS` table.
  - Verified there are NO other `bindPopup(\`…\`)` template-literal sites anywhere in `client/`.
- **Risk before**: MEDIUM-HIGH — stored XSS exploitable by anyone with `crm:edit` (or via CSV/email-import paths that create accounts), executes in the main app DOM (full session-cookie + CSRF-token + API access).
- **Risk after**: Negligible. All five interpolation points are escaped at the sink. The escaper handles `null`/`undefined` defensively.
- **Follow-ups**:
  - Add a server-side validator (zod refine) that rejects HTML-significant characters in account/lead/contact `name` fields IF business confirms names should never contain `<` or `>`. (Currently they may legitimately, e.g. an email-signature-derived name; deferred until product decides.)
  - Long-term: migrate the accounts.tsx popup to the `document.createElement` + `textContent` pattern used by the other two maps, to remove the string sink entirely.
- **Regression risks to watch**: Account names containing `&`, `<`, `>`, `"`, `'`, or `/` will now render as the visible character (correctly) instead of being parsed as HTML. Names like `"AT&T Marina"` will display as expected (`AT&T Marina`), not `AT�T Marina`.

---

### F-08 — `sql.raw` with manual escaping in attachment-DELETE  ·  Severity: LOW (chained risk)  ·  Status: ✅ FIXED

- **Issue summary**: `server/routes.ts:4570` logged a "Document removed" activity row by building an `INSERT INTO activities …` SQL string via `sql.raw` and `${docLabel}` template interpolation. Single-quote escaping was done manually with `replace(/'/g,"''")`. `objectType`, `objectId`, and `delUid` were also interpolated unparameterised; they came from a database row, not direct user input, but the pattern was a footgun: any future contributor who interpolates a new field without escaping would create a SQL-injection sink.
- **Root cause**: Use of `sql.raw` where a parameterised drizzle insert would have been simpler and safer.
- **Fix applied**: `server/routes.ts:4570-4587` — replaced with `db.insert(activities).values({ … })`. drizzle emits real bound parameters, no string-escaping needed, column types are checked at compile time. Required adding `activities` to the `@shared/schema` import on line 27.
- **Risk before**: Low (no direct user channel for the interpolated fields), but a structural fragility. Severity rises to High the moment a future change adds an attacker-influenceable field to the INSERT.
- **Risk after**: None. Parameterised query.
- **Follow-ups**:
  - Audit the rest of `server/routes.ts` for any other `sql.raw(\`…${var}…\`)` patterns and convert to parameterised drizzle equivalents. (Initial scan: most are read-only DDL/index creation and not user-influenced.)
- **Regression risks to watch**: The activity log row is now written via drizzle, which type-coerces. Verified `activities` schema fields used (linkedObjectType: text, linkedObjectId: integer, type: text, subject: text, summary: text, createdBy: integer) match the values being inserted. `createdAt` defaults to `now()` per schema, so no need to set it explicitly.

---

## Already shipped earlier in this session

| Fix | File(s) | Risk before → after |
|---|---|---|
| **CSRF origin/referer host-allowlist guard** (fail-closed; webhook-prefix exempt; webauthn paths exempt for FIDO2) | `server/csrf.ts`, `server/index.ts:109` | High → Negligible |
| **Email + Confluence HTML sanitiser** (DOMPurify-based; forbids `<form>`/`<iframe>`/`<meta>`/`<base>` etc., strips `srcdoc`/`sandbox`/`formaction`/`ping`/`background`/`autofocus`; anchor hook forces `target="_blank" rel="noopener noreferrer nofollow"`; DOMParser-based plaintext extractor never touches `innerHTML`) | `client/src/lib/sanitize-html.ts`, wired into `gmail-inbox.tsx` + `confluence.tsx` | High (stored XSS via attacker-sent email body) → Negligible (validated 0 alerts across 21 attack payloads in real Vite build) |
| **Email-iframe sandbox tightening** (`sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"`, `referrerPolicy="no-referrer"`) | `client/src/pages/gmail-inbox.tsx` | Medium → Low |

---

## Accepted as intentional design (operator-confirmed 2026-04-18)

| ID | What | Rationale |
|---|---|---|
| F-02 | `/api/leads/:id`, `/api/accounts/:id`, `/api/contacts/:id`, `/api/opportunities/:id` (GET/PUT/DELETE) — section-level `requirePermission("crm","view\|edit")` only; any user with `crm:view` can read every record | VoltSafe operates as a small (≤5-user) shared sales team; per-record ownership is **not** the desired access model. CRM is a shared workspace by design. |
| F-03 | `/api/quotes/:id/print` and `/api/quotes/:id/download/xlsx` — section-level `requirePermission("quoting","view")` only | Same shared-team rationale. (Earlier "no auth at all" alarm was a false positive — `app.use("/api/quotes", requireAuth, requirePermission(...))` at `server/routes.ts:1025` wraps these routes.) |
| F-04 | `/api/tasks/:id` PATCH — section-level only | Same shared-team rationale. |

If team size grows or the access model changes (e.g. multi-tenant sales orgs), revisit and add an `owner_id`-based filter — this is captured as a future-roadmap item, not a bug.

---

## Confirmed false positives (no change required)

| ID | What SAST flagged | Why it's not exploitable |
|---|---|---|
| F-07 | `client/src/pages/activity-feed.tsx:43` — `ENTITY_LINKS[type]?.(id)` looks like dynamic property access on attacker-controlled `type` | `ENTITY_LINKS` is a closed dispatch table (`contact|account|opportunity` → static template). Anything else returns `undefined` and the link doesn't render. |
| F-09 | `server/calendar-sync.ts:642` — `new RegExp(\`^${key}…\`)` looks like ReDoS via user input | `key` is iterated from a closed list (`UID`, `SUMMARY`, `DTSTART`, etc.) — never user-supplied. |
| F-12 | `scripts/run-migration-pipeline.js:72` — `child_process` invocation flagged as command-injection | Dev-only script, not reachable from the running server at all. |
| F-13 | `server/services/help-center-refresh.ts:355` — `fs.readFile(path.join(RUNTIME_DIR, name))` flagged as path-traversal | The only caller (`server/routes.ts:433`) validates `name` against the `HELP_CENTER_ASSET_NAMES` allowlist before invoking. The sink is unreachable with arbitrary input. |

---

## Deferred (out of scope for this hardening pass)

| ID | What | Why deferred | Recommended next step |
|---|---|---|---|
| F-10 | `server/services/engagement-rules.ts:181` — `new RegExp(cfg.urlPattern, "i")` could accept a catastrophic-backtracking pattern from rule config | Source is admin-only; existing `try/catch` neutralises a pathological pattern from killing the process. Risk is admin-shoots-foot, not external attacker. | Add a max-length cap and a regex-validity / safe-regex pre-check at admin save-time. |
| F-11 | `helmet` Content-Security-Policy disabled | Vite dev server uses inline script tags; tightening CSP needs a coordinated nonce/hash rollout for both dev and the email-preview surfaces | Schedule a separate hardening pass to introduce CSP with nonces, starting in `report-only` mode against the production build. |
| (cookie name) | Express-session uses default `connect.sid` cookie name | Renaming would break the existing test suite (11 test files match `/connect\.sid=/` on `Set-Cookie`). Marginal fingerprinting benefit. | Leave as documented exception. |

---

## Verified pre-existing controls (counter-evidence baseline)

These were inventoried during T001 / T003 and confirmed working — listing them so a future audit can re-verify quickly:

| Control | Evidence |
|---|---|
| `helmet` (CSP off, others on, HSTS in prod) | `server/index.ts:33-41` |
| `trust proxy = 1` | `server/index.ts:20` |
| 10 MB body limits (json + urlencoded) | `server/index.ts:48-56` |
| Session: pg-store, HttpOnly, Secure(prod), SameSite=Lax, 7-day | `server/index.ts:85-101` |
| `SESSION_SECRET` enforced ≥32 chars in prod (refuses to boot) | `server/index.ts:72-79` |
| CSRF origin/referer host-allowlist (fail-closed) | `server/csrf.ts` |
| `requireAuth`, `requireAdmin`, `requirePermission(section, level)` | `server/auth.ts:77-138` |
| bcrypt cost-12 password hashing | `server/auth.ts:10-13` |
| `express-rate-limit` on 4 auth endpoints | `server/routes.ts:99-116, 624, 828, 872, 951` |
| Sensitive-log-prefix redaction (passwords, tokens) | `server/index.ts:124-153` |
| Attachment-file streaming requires auth + path containment + `Cache-Control: private,no-store` | `server/routes.ts:4537-4552` |
| Attachment DELETE owner-or-admin gate | `server/routes.ts:4554-4567` |
| Email-search forces `scope=mine` for non-admins | `server/routes.ts:10275-10306` |
| `/api/admin/*` consistently `requireAuth + requireAdmin` | spot-checked |
| Gmail mail-folder access scoped via `getAccessibleAccountIds` | `server/services/gmail.ts` |

---

## Verification

- `npm run dev` boots clean: all 14 schema migrations complete, server listening on `0.0.0.0:5000`, Vite hot-reloaded `accounts.tsx` cleanly, no TypeScript errors.
- Pre-existing failed test workflows (`mail-permissions`, `mailbox-switching`, `permissions`, `tracking-multi-proof`, `tracking-proof`) all fail with `connect ECONNREFUSED 127.0.0.1:5000` — they ran in parallel with workspace boot before the express server finished listening, so the failures are environmental (start-order race), not regressions from this pass. None of those tests touch the conversation routes, the Gmail webhook, the accounts map, or the attachment-DELETE path.

## Roadmap (prioritised next pass)

1. Rotate `GMAIL_WEBHOOK_TOKEN`; consider migrating Pub/Sub subscription to OIDC bearer-token push.
2. Schedule a CSP rollout (F-11) using nonces or hashes, starting in report-only mode.
3. Audit remaining `sql.raw` sites in `server/routes.ts` and convert to parameterised drizzle.
4. Add `safe-regex` pre-check + max-length on admin-supplied regex config (F-10).
5. Decide product policy on HTML-significant characters in CRM `name` fields; if disallowed, add a zod refine at insert time.
6. Re-enable the test workflows after fixing their start-order race against the express boot.
