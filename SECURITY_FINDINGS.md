# VoltSafe Growth OS — Security Hardening Pass (Apr 2026)

Scope: scans → threat model → fix critical/high findings → report. No schema
changes, no MFA build, no audit-log table, no blanket regression suite (those
were explicitly deferred to a follow-up session).

See `threat_model.md` for the complete attack-surface reference.

---

## Summary

| Area                | Before                                    | After                                                                |
|---------------------|-------------------------------------------|----------------------------------------------------------------------|
| Session secret      | Hardcoded fallback in `server/index.ts`   | Refuses to start in prod without `SESSION_SECRET ≥ 32 chars`         |
| Session fixation    | Cookie reused across login                | `req.session.regenerate()` on login + reset-by-token                 |
| Security headers    | None                                      | `helmet()` mounted (HSTS in prod, sane referrer-policy, CORP)        |
| Login brute force   | Unlimited attempts                        | `express-rate-limit`: 10 failed/15 min/IP                            |
| Password reset abuse| Unlimited reset emails / token attempts   | 5 reset-emails/hr/IP and 20 token-redemptions/15 min/IP              |
| Suspended login     | Could log in or token-redeem              | Both flows reject `status ∈ {suspended, deactivated}` at the door    |
| `bcrypt` cost       | 10                                        | 12 (legacy hashes still verify)                                      |
| PII in logs         | Full response JSON body for every `/api/*`| Sensitive prefixes log status/duration only; others capped to 500 ch |
| `/api/attachments/file/:fileName` | Anonymous access                | Now `requireAuth` + `Cache-Control: private, no-store`               |
| `/api/email-search/reindex`       | `requireAuth` only              | Now also enforces admin role                                         |
| `requireAdmin`      | Defined locally inside `routes.ts`        | Canonical export added to `server/auth.ts`                           |
| WebAuthn auth path  | No suspension check, no session regen     | Now mirrors password login: rate-limited, suspended-user check, `req.session.regenerate()` |
| Session cookie name | Default `connect.sid`                     | Left as default — rename would break existing test suite (11 files match `/connect\.sid=/`); benefit is marginal |

---

## What was found

### Critical (fixed this session)

1. **Hardcoded `SESSION_SECRET` fallback** — `server/index.ts` previously fell
   back to the literal string `"voltsafe-cms-secret-key-change-me"` if the env
   var was missing. Anyone who reads this repo could forge any user's session
   cookie. **Fixed**: production refuses to boot without a real secret; dev
   warns loudly.
2. **`/api/attachments/file/:fileName` was unauthenticated.** Anyone who knew
   or could guess a stored filename could download user-uploaded content
   (quotes, contracts, photos). **Fixed**: `requireAuth` added, plus
   `Cache-Control: private, no-store`.
3. **`/api/email-search/reindex` was admin-only by comment but not by code** —
   any logged-in user could trigger an index rebuild (DoS + integrity).
   **Fixed**: explicit admin-role gate in front of the handler.
4. **No session regeneration on login** — classic session-fixation. An attacker
   could plant a known session cookie on the victim's browser, then ride it
   into the authenticated session after they logged in. **Fixed**:
   `req.session.regenerate(...)` wraps both `/api/auth/login` and
   `/api/auth/reset-password-by-token`.

### High (fixed this session)

5. **No security response headers.** No `Strict-Transport-Security`,
   `X-Content-Type-Options`, `Referrer-Policy`, etc. **Fixed**: `helmet()`
   mounted with HSTS in production. CSP is intentionally left disabled (the
   app embeds inline scripts and renders sanitised HTML email previews; a real
   CSP rollout needs nonce/hash support and is its own task).
6. **No rate limiting on auth.** `/api/auth/login`,
   `/api/auth/forgot-password`, `/api/auth/reset-password-by-token` all
   accepted unlimited attempts. **Fixed**: per-IP `express-rate-limit` on each.
7. **Full response bodies logged for every `/api/*` route**, including
   `/api/auth/me`, `/api/admin/users`, `/api/gmail/messages`, `/api/contacts`.
   This pushes PII (emails, names, mailbox content) into the platform's stdout
   pipeline. **Fixed**: a sensitive-prefix list in `server/index.ts`
   suppresses bodies entirely on those routes; everything else is truncated to
   500 chars.
8. **Login allowed suspended/deactivated users to mint sessions.** A leaked
   reset token could re-activate a disabled account. **Fixed**: both flows
   short-circuit with 403 if `status ∈ {suspended, deactivated}`.
9. **bcrypt cost = 10.** Acceptable, but 12 is a better fit for current
   compute. **Fixed**: new hashes use cost 12; old hashes still verify.

### Medium / Low (NOT fixed — see "Remaining" below)

- 4 high + 6 moderate **dependency CVEs** (`axios`, `dompurify`, `drizzle-orm`,
  `follow-redirects`, `lodash`, `vite`). All have non-major fixes available.
- ~210 SAST findings — the vast majority are the project-wide `sql.raw(\`…\`)`
  pattern (one finding per call site). Most interpolate server-controlled
  values (e.g. `linked_object_type`, `Number()`-coerced IDs) but the pattern
  is fragile.
- 1 actual **XSS finding** in `client/src/pages/gmail-inbox.tsx` —
  `innerHTML` assignment of user-controlled email body HTML. Currently the
  body is sanitised upstream in the email renderer, but the raw `innerHTML`
  call is the wrong shape; switch to React's `dangerouslySetInnerHTML` with a
  DOMPurify sanitiser, or render via an iframe sandbox.
- Webhook auth via query-string token (`/api/webhooks/gmail?token=…`). Tokens
  in query strings end up in proxy and Replit access logs. Should move to a
  request-header check (or, if Pub/Sub OIDC is enabled, verify the Bearer
  JWT).
- Permission default for new users falls back to `"edit"` on every section in
  `/api/auth/me` and `/api/auth/login` if the `permissions` JSON is missing.
  Should change the default to deny-by-default (`none` everywhere) so admin
  must opt-in to grant access.
- HoundDog: 8 low-severity findings (privacy/dataflow); none required action.

### Audited but unchanged (already correct)

- `/api/admin/*` routes (~12 endpoints) — every one has `requireAuth, requireAdmin`.
- `/api/gmail/*` routes (~30 endpoints sampled) — every one has `requireAuth`,
  several add `requirePermission("crm","edit")` for CRM-mutating actions.
- CRM section reads (`/api/leads`, `/api/accounts`, `/api/contacts`,
  `/api/opportunities`, `/api/quotes`, `/api/tickets`, `/api/partnerships`,
  `/api/ecosystem`, `/api/projects`, `/api/assets`) — all wrapped via
  `app.use("/api/<x>", requireAuth, requirePermission(...))` in
  `server/routes.ts` L920–950.
- `/api/projects/:id/attachments/:aid/download` — gated by
  `projects:view` AND verifies the attachment belongs to the requested
  project (not just `aid` lookup).
- `/api/attachments/:id` DELETE — owner-or-admin gate (legacy NULL
  `uploadedBy` rows allowed as documented fallback).
- Forgot-password — already has anti-enumeration ("If that email exists…"
  response regardless of hit/miss).
- Reset tokens — 1 h expiry, single-use (cleared on redemption).

---

## Files changed

- `server/index.ts` — added `helmet`, `SESSION_SECRET` enforcement, sensitive-
  prefix log redaction, named session cookie.
- `server/auth.ts` — bcrypt cost 10→12, exported canonical `requireAdmin`.
- `server/routes.ts` — added `express-rate-limit` import + 3 limiters,
  applied to login / forgot-password / reset-by-token; added session
  regeneration on login + reset-by-token; rejected suspended users at both
  entry points; added `requireAuth` to `/api/attachments/file/:fileName` plus
  `Cache-Control: private, no-store`; added admin-role gate to
  `/api/email-search/reindex`.
- `package.json` — added `helmet` and `express-rate-limit` (via the package
  manager; no manual edit).

No schema changes. No `db:push` was run.

---

## Remaining risks (prioritised)

### P1 — recommend doing in the next hardening session

1. **Audit-log table** (deferred). Add `audit_logs (id, actor_user_id, ip,
   ua, action, target_type, target_id, payload jsonb, created_at)` and write
   from every admin route, every permission change, every reset-by-token,
   every login (success/fail), every attachment download. Required for
   incident response and for SOC-2-style controls.
2. **MFA for admins** (deferred). The codebase already wires WebAuthn
   (`server/webauthn.ts`) but doesn't enforce it. Add a `mfa_required` flag
   on `users` (or just gate on `globalRole`), and a `requireMfa` middleware
   that runs after `requireAdmin`. Re-prompt on each new browser/IP.
3. **Deny-by-default permissions for new users**. Change the `permissions`
   default in `/api/auth/me`, `/api/auth/login`, and the user-creation flow
   from `"edit"` everywhere to `"none"` everywhere. Existing users keep their
   stored JSON; only newly-created users with a `null` permissions get the
   restrictive default.
4. **Dependency upgrades** — bump `axios`, `dompurify`, `drizzle-orm`,
   `follow-redirects`, `lodash`, `vite` to their patched versions. All have
   non-major fixes available. Validate the `drizzle-orm` upgrade against the
   `sql.raw` usages and the `email_tracking_pixels` schema-divergence note.
5. **Fix XSS in `client/src/pages/gmail-inbox.tsx`** — replace the raw
   `innerHTML` assignment with a sanitised render. Either DOMPurify-wrapped
   `dangerouslySetInnerHTML` or a sandboxed iframe.

### P2 — Worth addressing soon

6. **Webhook token in header, not query string** — `/api/webhooks/gmail` should
   accept the secret via `X-Webhook-Token` (or verify the Pub/Sub OIDC JWT)
   so it doesn't leak through proxy and access logs.
7. **CSRF protection** — current sameSite=lax cookie + same-origin SPA + no
   form-based GET writes makes drive-by CSRF unlikely, but a
   double-submit-cookie or `X-Requested-With` requirement on state-changing
   routes is cheap defense-in-depth.
8. **Global rate limit on authenticated API** — coarse limit (e.g. 600/min/IP)
   on `/api/email-search`, `/api/gmail/messages`, `/api/gmail/threads`, and
   the `/api/admin/gmail/backfill-associations` admin trigger.
9. **Replace `sql.raw(\`…\`)` patterns with `sql\`…${param}\`` template form**
   in the highest-risk files first: `server/routes.ts`,
   `server/services/automation-engine.ts`,
   `server/services/email-attachments.ts`,
   `server/services/backfill-service.ts`, `server/services/alert-engine.ts`.
   Even when only server-controlled values are interpolated today, the
   pattern is one careless `${req.body.x}` away from SQL injection.
10. **CSP rollout** — currently disabled in helmet config. A real CSP needs:
    nonce-based inline scripts in Vite dev/prod, audit of all `style="…"`
    inline styles, hash-list for the few unavoidable inline scripts.

### P3 — Lower urgency / nice to have

11. **Tighten `multer` limits** — every multer instance should set
    `limits: { fileSize: <reasonable max>, files: 10 }`. Some currently use
    only the global default.
12. **Lock cookie `sameSite` to `strict`** for the session cookie once OAuth
    callback flows have been verified to still work end-to-end (current
    `lax` is the safe default, `strict` would block some legit nav flows).
13. **Regression test suite for authz** — small Playwright-based suite that
    spins up a non-admin user and asserts every `/api/admin/*` returns 403,
    every cross-section permission boundary returns 403, and every public
    endpoint returns the expected 401/200 for anonymous callers.
14. **Drop `req.session.role` mirror** — `globalRole` is the source of truth
    now; the older `role` field on the session is redundant and adds the
    risk of one being stale relative to the other.

---

## Recommended next session

In priority order:

1. Add the `audit_logs` table + write-paths (P1.1).
2. Enforce WebAuthn MFA for admins (P1.2).
3. Switch new-user default permissions to deny-by-default (P1.3).
4. Dep upgrades + XSS fix in `gmail-inbox.tsx` (P1.4 + P1.5).
5. Move webhook token to header + add CSRF middleware (P2.6 + P2.7).
6. Build the authz regression test suite (P3.13) — small now, will save
   many hours of manual auditing later.
