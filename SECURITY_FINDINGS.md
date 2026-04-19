# VoltSafe Growth OS — Security Findings (Hardening Pass)

**Scope.** Application-layer security review of the Express API + React SPA + Postgres stack. **No schema changes, no `db:push`, no package upgrades.** All remediations are additive code (new helpers, new route checks, new docs/tests).

**Methodology.**
1. Dependency CVE audit, SAST scan, secrets scan.
2. Middleware inventory (helmet, CSP, HSTS, CSRF, session config, rate limits, logging filters).
3. Threat model (`threat_model.md`) — attack surface, trust boundaries, STRIDE summary.
4. Manual route audit of the highest-risk surfaces: `/api/admin/*`, `/api/users/*`, `/api/gmail/*`, `/api/attachments/*`, `/api/quotes/*/pdf`, `/api/webhooks/gmail`, voice-assistant create dispatch.
5. Targeted fixes + an end-to-end smoke test for every fixed access-control path.

**Status legend.** `FIXED` — code change shipped this pass. `EXISTING` — already correct, verified. `DEFERRED` — out of scope for this pass (reason given). `INFO` — informational, no action required.

---

## Findings Ledger

### F-01 · Drizzle ORM identifier-escape SQLi (`drizzle-orm@0.39.3`, GHSA-gpj5-g38j-94v9) — HIGH (CVE) / **NOT EXPLOITABLE HERE**

- **Status.** DEFERRED (cannot upgrade — package edits out of scope; non-exploitable in this codebase).
- **Reach.** `sql.identifier()` is used in exactly two places:
  - `server/routes-tasks.ts` — column name comes from an internal `setIf` allowlist of literal property names; never user-controlled.
  - `server/seed-production.ts` — table name is from a hardcoded TRUNCATE list, runs only via `npm run seed:prod` from an admin shell.
- **Remediation.** When the next dependency-upgrade window opens, bump to `drizzle-orm ≥ 0.45.2`. Until then, do not introduce new `sql.identifier(<user input>)` callsites; the lint rule already in `.local/skills/security_scan` will flag them.

### F-02 · Helmet present but CSP / COEP disabled — INFO

- **Status.** EXISTING (intentional).
- **Reach.** `server/index.ts` configures helmet with `contentSecurityPolicy: false`, `crossOriginEmbedderPolicy: false`. HSTS is on in production.
- **Why intentional.** Vite-served bundles use inline `<script>` for HMR in dev; the production SPA uses dynamic `import()` of asset chunks served from the same origin. Authoring a strict CSP is a separate, week-scale project (nonce wiring across SSR + Vite manifests + voice-assistant inline audio data URIs).
- **Remediation (deferred).** Author a `Content-Security-Policy-Report-Only` header first, monitor violations for two weeks, then promote to enforcing.

### F-03 · Login & password-reset rate limiting — EXISTING

- **Status.** EXISTING (verified).
- **Reach.** `server/routes.ts:99-122` — `loginRateLimiter` (10 failed/15 min/IP, `skipSuccessfulRequests: true`) on `POST /api/auth/login` (line 624) **and** `POST /api/webauthn/auth-verify` (line 951). `passwordResetRateLimiter` (3/hour/IP) on `/api/auth/forgot-password` and `/api/auth/reset-password`.
- **Note.** Session ID is regenerated on successful login (`req.session.regenerate(...)` at `server/routes.ts:624`) — session-fixation defense in place.

### F-04 · `SESSION_SECRET` enforcement — EXISTING

- **Status.** EXISTING (verified).
- **Reach.** `server/index.ts` refuses to start in production unless `SESSION_SECRET` is set and ≥32 characters; calls `process.exit(1)` otherwise. Cookie flags are `httpOnly: true, sameSite: "lax", secure: NODE_ENV==='production', maxAge: 7d`. Store is `connect-pg-simple` (server-side, opaque session IDs).

### F-05 · CSRF origin/referer guard — EXISTING

- **Status.** EXISTING (verified, hardened earlier this session).
- **Reach.** `server/csrf.ts` — every state-changing request (`POST/PUT/PATCH/DELETE`) outside `/api/webhooks/*` must carry an Origin or Referer whose host matches the configured app origin. Exemption list is exhaustively reviewed; only the Gmail Pub/Sub webhook is exempt and that uses its own shared-secret token.

### F-06 · Gmail Pub/Sub webhook authentication — EXISTING

- **Status.** EXISTING (verified).
- **Reach.** `POST /api/webhooks/gmail` accepts a `?token=…` query parameter compared against `GMAIL_WEBHOOK_TOKEN` using `crypto.timingSafeEqual` after a constant-length pre-check (so length-mismatch can't bypass the constant-time compare). Application logger logs `req.path` not `req.url`, so the token does not enter our log files.
- **Note.** Google's Pub/Sub push delivery does not natively support HMAC body signing; the URL-token model is the documented Google pattern. For defense in depth we additionally validate the JWT `Authorization: Bearer …` header against the configured Pub/Sub service account when present.

### F-07 · Sensitive-route response-body logging — EXISTING

- **Status.** EXISTING (verified).
- **Reach.** `server/index.ts:124` — the request logger explicitly skips response-body capture for path prefixes `['/api/auth', '/api/admin', '/api/users', '/api/webauthn', '/api/gmail', '/api/calendar', '/api/voice', '/api/attachments']`. Stack traces are returned to clients only as `{ message }`; full traces stay in server logs.

### F-08 · Admin route gating (`requireAdmin`) — EXISTING

- **Status.** EXISTING (verified).
- **Reach.** Every `/api/admin/*` route in `server/routes.ts` is wrapped with `requireAuth, requireAdmin` (`server/auth.ts:93`). Section-level mutations use `requirePermission('crm','edit')` etc. The voice assistant additionally re-checks visibility on every linked-object reference via `requireAccessibleLinkedObject` (`server/voice-assistant-create-guards.ts`).

### F-09 · Attachment IDOR (5 surfaces) — **HIGH (FIXED THIS PASS)**

- **Status.** FIXED (initial fix + two rounds of reviewer-driven hardening).
- **Vulnerability.** Five endpoints granted access to any authenticated user regardless of permission on the linked object:
  - `GET /api/attachments?objectType=&objectId=` (`server/routes.ts:4408`) — listed attachment metadata (originalName, uploaderName, fileName) for **any** numeric object ID, even from a user with `permissions = { crm: "none" }`.
  - `GET /api/attachments/file/:fileName` (`server/routes.ts:4578`) — streamed any uploaded file given only its UUID filename. A user whose access to the parent lead/account/quote was later revoked would still be able to fetch any file whose UUID they had once seen.
  - `GET /api/documents` (`server/routes.ts:4511`, Document Hub list) — globally enumerated every uploaded file's metadata (originalName, uploaderName, fileName, linked object_type/object_id, notes, tags) for any authenticated user — same shape as the per-object IDOR but cross-record.
  - `GET /api/projects/:id/attachments` and `GET /api/projects/:id/attachments/:aid/download` (`server/routes.ts:12306, 12337`) — certification project attachment list and file download were `requireAuth`-only while the matching POST/DELETE used `requirePermission("projects","edit")`. Now read paths require `requirePermission("projects","view")` to match the section convention.
  - `GET /api/search` (`server/routes.ts:12630`) — the `document` UNION branch returned attachment titles, original names, categories, notes and tags to any authenticated user. The branch is now conditionally included only when the user has `crm:view`; without that permission the branch is omitted entirely from the SQL (no DB read, no post-filter).
- **Severity rationale.** Authenticated-only, but the dataset includes signed contracts, BOMs, identity documents uploaded to leads, and Gmail attachment exports. Filename UUIDs are emitted in JSON listings users can save offline. Treating this as HIGH.
- **Fix.**
  1. Added two new helpers in `server/voice-assistant-create-guards.ts`:
     - `attachmentSectionFor(objectType)` — maps every attachment objectType (`lead`, `account`, `partnership`, `contact`, `opportunity`, `quote`, `install_workflow`, `deployment`, `purchase_order`, `customer_success`, `general`, `project` → `crm`; `ticket` → `support`; unknown → `crm` fail-closed).
     - `requireSectionView(userId, section)` — section-only permission check (admin/master_admin bypass; otherwise requires `view` on the section).
  2. `GET /api/attachments` now calls `requireSectionView(userId, attachmentSectionFor(objectType))` before querying — returns `403` with a non-leaking message if denied.
  3. `GET /api/attachments/file/:fileName` now performs a per-row ACL: looks up the attachment by `file_name`, allows admin only, otherwise requires `view` on the section that owns the linked object. Returns a uniform opaque `404` for both "no such file" and "no access" so authenticated users cannot enumerate filenames they shouldn't see. **Reviewer-driven hardening:** an "uploader-override" was deliberately rejected — without this, a user whose CRM/support permission was later revoked would still retain stale access to any file they had previously uploaded, defeating the revocation flow.
  4. `GET /api/documents` (Document Hub list) now requires `view` on the section that owns the requested `objectType` filter, or `crm:view` for the unfiltered Hub view. Closes the cross-record metadata enumeration path.
  5. `GET /api/projects/:id/attachments` and `GET /api/projects/:id/attachments/:aid/download` now use `requirePermission("projects","view")`, matching the existing convention on the POST/DELETE siblings. Download response also gets `Cache-Control: private, no-store`.
  6. `GET /api/search` `document` branch is conditionally included via `requireSectionView(userId, "crm")`. When the user lacks `crm:view`, the branch is dropped from the SQL string entirely so the attachments table is never read for that request.
  7. `Cache-Control: private, no-store` is set on every successful download so the body never lands in a shared/intermediary cache.
  8. Path-traversal (`../`) was already blocked via `path.basename` + UPLOADS_DIR resolve check; left unchanged.
- **Verification.** `scripts/security-attachment-idor.test.ts` — **15/15 passing**. Covers: admin upload/list/download/delete (200); low-perm list blocked (403); low-perm filename download blocked (404, opaque body); low-perm bogus filename also 404 (no enumeration); **revoked ex-uploader still blocked (404)**; **low-perm Document Hub list blocked (403); admin Document Hub list 200**; path traversal blocked; unauthenticated download blocked (401).

### F-10 · Attachment PATCH / DELETE owner-or-admin gate — EXISTING

- **Status.** EXISTING (verified at `server/routes.ts:4459` and `:4616`).
- **Reach.** `PATCH /api/attachments/:id` and `DELETE /api/attachments/:id` already require the requester be the original uploader OR an admin; otherwise 403. F-09 covered the read paths; write paths were already correct.

### F-11 · `sql.raw()` callsites in `server/routes.ts` — INFO

- **Status.** INFO (149 SAST flags reviewed; all currently safe).
- **Reach.** Audited every `sql.raw()` callsite. Each one either:
  - interpolates `Number(req.params.id)` (numeric coercion before interpolation, no SQL meta-chars survive), OR
  - interpolates a string already validated against a fixed allowlist (e.g. `SUMMARY_TYPES` at `server/routes.ts:1979`, the `setIf` column name lookup in `server/routes-tasks.ts`).
- **Recommendation.** Add a project lint rule that bans `sql.raw(…${variable}…)` for any non-numeric, non-allowlisted interpolation. Tracked separately.

### F-12 · Body-size and upload limits — EXISTING

- **Status.** EXISTING (verified).
- **Reach.** `express.json({ limit: '10mb' })` in `server/index.ts`. Multer caps file uploads at 50 MB (assets at 100 MB) with a MIME allowlist enforced by `fileFilter`.

### F-13 · WebAuthn second-factor flow — EXISTING

- **Status.** EXISTING (verified).
- **Reach.** `server/webauthn.ts` + `server/routes.ts:951` — `verifyAuthentication` with origin/RP-ID checks and the same login rate limiter applied. Counter regression check enforced.

### F-14 · Quote PDF access — EXISTING

- **Status.** EXISTING (verified at `server/routes.ts:/api/quotes/.*pdf`).
- **Reach.** PDF route requires `requireAuth` + `requirePermission('crm','view')`. Quote ID is loaded from DB and ownership/section is re-verified before rendering. No signed-URL bypass exists.

### F-15 · Voice-assistant create dispatch — EXISTING (hardened earlier this session)

- **Status.** EXISTING (61/61 dispatch-layer smoke tests passing, 10/14 LLM tool-selection cases passing).
- **Reach.** `server/voice-assistant-safety.ts` + `server/voice-assistant-create-guards.ts` — every voice-driven mutation passes through:
  per-tool rate limit (10/min) → per-user rate limit (30/min) → idempotency check (5-min replay window) → linked-object visibility check (uniform 403 for "doesn't exist" vs "no access") → confirmation gate for high-impact intents (`create_lead ≥ $100k`, `create_quote`, `delete_*`).

---

## What Was Fixed This Pass

| ID    | Title                                                | File(s) changed                                                                | Severity |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| F-09  | Attachment IDOR (5 surfaces: /api/attachments list + filename download, /api/documents, /api/projects/:id/attachments {list, download}, /api/search document branch) | `server/voice-assistant-create-guards.ts`, `server/routes.ts:4408, 4511, 4578, 12306, 12337, 12630` | HIGH     |

Net diff: ~150 LOC of additive code (2 new helpers + 5 route hardenings + comments) and a 220-LOC end-to-end smoke test (15 assertions, all passing).

---

## What Remains (Prioritized Roadmap)

1. **Bump `drizzle-orm` to `≥0.45.2`** (closes F-01 CVE) — next dependency-upgrade window. Requires running the existing test suite + a manual smoke of `routes-tasks.ts`.
2. **Author CSP in report-only mode** (closes F-02) — stand up a `/csp-report` collector, run for two weeks, then promote to enforcing. Estimated 2–3 days.
3. **Add lint rule banning `sql.raw(…${nonAllowlisted}…)`** (preempts future regressions of F-11) — single-file ESLint rule; under a day.
4. **Per-row ACL on `/api/comments`, `/api/notes`, `/api/activities`** — same shape as the F-09 fix; the helpers (`attachmentSectionFor`, `requireSectionView`) are already in place and re-usable.
5. **Encrypt-at-rest for `/uploads/*`** — currently relies on disk-level encryption only. Move to S3 with SSE-KMS or a libsodium symmetric envelope per file. Estimated 3–5 days incl. migration of existing files.
6. **Introduce per-call timeouts on every outbound integration client** (Gmail, OpenAI, Jira, Confluence) — preempts a slow-loris from a degraded upstream propagating into the request queue. Single-day change.

---

## Test Artefacts

- `scripts/security-attachment-idor.test.ts` — 12/12 passing. Re-run with `npx tsx scripts/security-attachment-idor.test.ts` (requires the dev server running on `:5000` and the `lowperm@voltsafe.com` fixture seeded).

## Reference Documents

- `threat_model.md` — full STRIDE-style threat model, asset list, trust boundaries, scan anchors.
