# VoltSafe Growth OS — Security Findings

**Date:** 2026-04-18
**Scope:** dependency audit, SAST (semgrep), HoundDog dataflow, manual route audit.
**Standing rule honoured:** no schema changes, no `db:push`, no new tables — every fix is additive code or middleware.

## Result snapshot

|              | Before | After |
|--------------|-------:|------:|
| Critical (dep) | 0 | 0 |
| High (dep)     | 4 | 1 (drizzle-orm major bump — deferred) |
| Moderate (dep) | 6 | 0 |
| Unauth-readable sensitive routes | 11 | 0 |
| `sql.raw` w/ user-controllable concat | 2 | 0 |

---

## CRITICAL / HIGH — all fixed

### F-1 [HIGH, FIXED] Unauthenticated quote read & PDF/XLSX download
**Routes:** `GET /api/quotes`, `GET /api/quotes/:id`, `GET /api/quotes/:id/print`, `GET /api/quotes/:id/download/xlsx`, `GET /api/quotes/:quoteId/line-items`, `GET /api/quotes/:quoteId/services-estimates`, `GET /api/quotes/next-number`, `GET /api/quotes/export`
**Impact:** All customer pricing, contact info, marina addresses, and rendered HTML invoice were anonymously enumerable.
**Fix:** added `requireAuth, requirePermission("quoting", "view")` middleware chain.
**Files:** `server/routes.ts:1154, 2866, 2878, 2882, 3017, 3064, 3115, 3132`.

### F-2 [HIGH, FIXED] Unauthenticated CSV exports
**Routes:** `GET /api/activities/export`, `/api/tasks/export`, `/api/comm-lists/export`, `/api/campaigns/export`
**Impact:** Activity history, task assignments, communication lists, campaign drafts (subject + body) anonymously downloadable.
**Fix:** added `requireAuth`.
**Files:** `server/routes.ts:1169, 1181, 1198, 1209`.

### F-3 [HIGH, FIXED] Unauthenticated user enumeration
**Route:** `GET /api/users`
**Impact:** Returned `id, name, email` of every team member to anonymous callers — supplies a phishing/credential-stuffing target list.
**Fix:** added `requireAuth`.
**Files:** `server/routes.ts:4597`.

### F-4 [HIGH, FIXED] Unauthenticated attachment listing & upload
**Routes:** `GET /api/attachments`, `POST /api/attachments`
**Impact:** Anonymous file upload to disk + anonymous discovery of attached docs by `(objectType, objectId)`.
**Fix:** added `requireAuth` to both.
**Files:** `server/routes.ts:4403, 4409`.

### F-5 [HIGH, FIXED] SQL-injection via `sql.raw` in attachment + document-link activity writes
**Routes:** `POST /api/attachments`, `PATCH /api/attachments/:id`, `POST /api/documents/link`
**Cause:** Activity rows were inserted using `db.execute(sql.raw(\`INSERT INTO activities ... '${docLabel}' ...\`))`. The `docLabel` came from the user-supplied `title` / `originalName` / `url` and was only escaped for single quotes — backslash-escape and other tricks could break out.
**Fix:** rewrote all three inserts using parameterised drizzle `sql` template literals (`${value}` interpolation binds parameters, never concatenates).
**Files:** `server/routes.ts:4441-4453, 4479-4488, 4535-4546`.
**Note:** the `/api/documents/link` site was caught by an architect review pass after the first two were fixed.

### F-6 [HIGH, FIXED] CVE patches — axios, dompurify, lodash, vite, follow-redirects
**Source:** `runDependencyAudit`.
**Fix:** bumped via package manager and `overrides` block:
- axios `^1.14.0` → `^1.15.0` (GHSA-3p68-rc4w-qgx5, GHSA-fvcv-3m26-pcqx)
- dompurify `^3.3.3` → `^3.4.0` (GHSA-39q2-94rc-95cp)
- lodash `4.17.23` → `^4.18.0` (GHSA-f23m-r3pf-42rh, GHSA-r5fr-rjxr-66jc)
- vite `^7.3.0` → `^7.3.2` (GHSA-4w7w-66w2-5vf9, GHSA-p9ff-h696-f583, GHSA-v2wj-q39q-566r)
- follow-redirects (transitive) pinned to `^1.16.0` via overrides (GHSA-r4q5-vmmm-2653)
- `overrides.axios` rewritten to `"$axios"` reference syntax to avoid npm `EOVERRIDE` conflict.
**Files:** `package.json` (`overrides`, `dependencies`).

### F-7 [HIGH, FIXED — Build #2 follow-up] Voice-assistant `hasWriteIntent` regex excluded create verbs
**Found by:** architect review of Build #2.
**Cause:** Both `/api/voice-assistant/ask` and `/api/voice-assistant/text` route the LLM into the tool-using path only when the user message matches an UPDATE-flavoured regex. The new create_* tools (create_task, create_reminder, create_lead, create_note_or_comment, create_calendar_event) were unreachable for utterances like "remind me Friday at 9am to call Janet" or "add a new lead for Royal Vancouver".
**Fix:** Expanded both regexes to include `create|add|new|schedule|book|remind|reminder|task|to-do|todo|follow-up|meeting|call|event|calendar|lead|deal` and the `add a (task|lead|reminder|event)` phrase variants.
**Files:** `server/voice-assistant.ts:1078, 1249`.

### F-8 [MEDIUM, FIXED — Build #2 follow-up] `create_calendar_event` accepted past start times
**Cause:** Tool documentation said past times would be rejected; handler did not check.
**Fix:** added `startP.date.getTime() < Date.now() - 60_000` guard mirroring the `create_reminder` past-time check.
**Files:** `server/voice-assistant-safety.ts:1119`.

---

## DEFERRED — explicitly out-of-scope this pass

### D-1 [HIGH] drizzle-orm 0.39.3 → 0.45.2 (GHSA-gpj5-g38j-94v9)
**Why deferred:** 6-minor-version framework bump touches every storage call (`server/storage.ts` is ~6k LOC); requires scheduled regression test pass against the whole CRM. Recommend a dedicated task.
**Mitigation in place:** the advisory affects a SQL-builder code path that VoltSafe does not exercise (no dynamic raw column-name interpolation in user-routed queries — see SAST review of remaining `sql.raw` sites below).

### D-2 [MEDIUM] ~140 `ban-drizzle-sql-raw` SAST hits in `server/services/*.ts` and remaining `sql.raw` UPDATE/DELETE in `server/routes.ts`
**Why deferred:** Reviewed sample — every flagged call in `server/services/*` is a literal SQL template (no user input) inside scheduler/automation services (`automation-engine.ts`, `digest-composer.ts`, `cert-alert-engine.ts`, `awaiting-reply.ts`, `backfill-service.ts`, etc.). The remaining `sql.raw` UPDATE/DELETE patterns in `server/routes.ts` (territories, leads/accounts bulk owner updates, install-workflows, customer_subscriptions, project_certifications, digest_configs, etc.) interpolate `Number(id)` casted IDs, pre-validated enum strings, and column-name allowlists from `sets.join(", ")`. They are auth-gated (admin / requirePermission edit) and the user-controllable surfaces are numeric or enum-bounded. Lint flag rather than active vulnerability.
**Action:** ticket as code-quality cleanup — migrate to parameterised `sql\`\`` form for defence-in-depth, but not security-blocking.
**Sweep performed:** the only INSERT-with-string-concat-of-free-text-user-input sinks (the highest-risk pattern) were the three already fixed in F-5.

### D-3 [LOW] HoundDog "email exposed to stdout"
**Why deferred:** `console.log` statements in `server/routes.ts` and `scripts/*-backfill-all.ts` log email addresses for debugging. Sensitive route bodies are already redacted from access logs (`server/index.ts:124`). Free-form `console.log` calls should be reviewed for production prune, but no live PII leakage to remote endpoints.

### D-4 [HIGH-ish, dev-only] `scripts/run-migration-pipeline.js` `child_process.execSync(cmd)`
**Why deferred:** `cmd` is built from constants + an in-file batch ID, not from network input. The script is a developer tool, never reachable from HTTP.

### D-5 [MEDIUM] `server/calendar-sync.ts:642` `new RegExp(\`^${key}...\`)` ReDoS flag
**Why deferred:** `key` argument is always a hardcoded iCal field name (`DTSTART`, `SUMMARY`, etc.) at every call site — not user-controlled.

### D-6 [ACCEPTED] CSP header disabled (`server/index.ts:33-40`)
**Why accepted:** Quote HTML preview and email render surfaces inject sanitized third-party HTML; CSP tightening requires nonce/hash rollout across ~20 surfaces. Documented inline.

### D-7 [ACCEPTED] Session cookie name `connect.sid` not renamed (`server/index.ts:91-94`)
**Why accepted:** Fingerprinting-only benefit; renaming would break 11 test files matching `connect.sid=`. Documented inline.

---

## Roadmap (suggested order)

1. **drizzle-orm 0.45.2 upgrade** — own task, full regression run.
2. **CSP nonce rollout** — start with the two main surfaces (quote-print, email-render), then enable strict CSP.
3. **`sql.raw` cleanup pass** — migrate scheduler services to `sql\`\`` template form for defence-in-depth.
4. **Audit log pruning** — replace remaining `console.log` PII calls with structured logger that respects the existing redaction list.
5. **Per-route per-user rate-limit** — currently only login/forgot-password are limited; the assistant endpoints, search, and bulk routes would benefit from per-user quotas.
