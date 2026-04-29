# Replit Agent Configuration

## Post-Publish Operational Follow-ups (deferred — not in any open commit)

These are operational items deliberately scoped OUT of the active 8-commit
unified-inbox plan. They become relevant only after the app is published to
`.replit.app` (deployment URL stable, Pub/Sub subscription re-pointable, no
container-sleep killing background work). Track them here so they don't get
lost between commits.

### Gmail watch / Pub/Sub push delivery
- **Symptom seen 2026-04-27**: trevor's `email_accounts.last_webhook_at` is
  10.7 days stale (Apr 17) despite `incremental_event_count=2705` and a
  current `last_sync_at`. Polling sync masks the issue end-user-side, so
  there's no immediate user impact.
- **Why it's deferred, not Commit 5**: push is structurally broken in the
  dev environment anyway (Replit container sleep terminates the long-lived
  Pub/Sub listener), and the polling fallback being built in Commit 5 is
  the actual user-facing safety net. Fixing push in dev would just be a
  cosmetic green-light that doesn't reflect production behaviour.
- **Diagnostic confirmation (`scripts/pubsub-diagnostic.ts`, 2026-04-28)**:
  ran end of Commit 5 to test whether the freshly-watched accounts (92 +
  93, expirations 2026-05-05 from the post-Commit-4.1 OAuth-completion
  restart) would receive push notifications. Sent two real test emails
  (`trevor → support` gmail msg id `19dd1a8a1ce0e709`, `trevor → sales`
  gmail msg id `19dd1a8a3ee953b1`), then polled `last_webhook_at` every 5s
  for 90s. Result: **NO webhook fired for ANY of the three accounts (1, 92,
  93)**. So trevor's stale 10-day-old `last_webhook_at` is NOT specific to
  its old watch — push is structurally broken in dev regardless of watch
  freshness. This pins the diagnosis: the Commit 5 foreground polling
  fallback IS the actual user-facing safety net in the dev environment,
  not just a redundant belt-and-braces. Script is left in `scripts/` as a
  written record; re-run after first publish to `.replit.app` to confirm
  push works in the production environment.
- **What to do post-Commit-8 / on first publish to `.replit.app`**:
  1. Verify the Gmail Pub/Sub topic + subscription are pointed at the
     `.replit.app` webhook URL (NOT the rotating `.janeway.replit.dev` dev
     URL).
  2. Confirm the watch auto-renew cron is firing weekly (watches expire
     ~7 days after `users.watch` is called). **Status update post-Commit 8:
     the renewal scheduler IS wired — `renewExpiringWatches()` in
     `server/services/gmail-watch.ts:143` is invoked from `server/index.ts:274`
     on the same hourly tick as the incremental scheduler. The earlier
     "renewal job either isn't running or isn't bumping the timestamp"
     concern reflected the absence of an observability surface, not an
     absence of the cron itself. Commit 8's
     `GET /api/admin/mailbox/diagnostics` now returns
     `watch.{expirationAt, isExpired, expiresInMs}` for every active
     mailbox in one round-trip, so post-publish verification of "is the
     renewal cron actually bumping watch_expiration_at?" is a single
     curl + eyeball on `expiresInMs > 0`. Mark this sub-item RESOLVED-
     AS-OBSERVABLE: no code change required, just the operator habit of
     hitting the diagnostic endpoint after the first weekly tick post-
     publish to confirm timestamps advance.**
  3. After re-arming, monitor `last_webhook_at` for movement on the next
     real inbound message; if still stale, check Cloud Pub/Sub delivery
     metrics for ack failures. Same diagnostic endpoint surfaces
     `webhookStaleness.{ageMs, isStale, isOlderThanThreshold}` per
     mailbox so the "monitor" step doesn't require psql either.
  4. Re-run `scripts/pubsub-diagnostic.ts` against the production
     environment to confirm push works end-to-end. If it fires, the
     foreground polling fallback becomes a belt-and-braces redundancy in
     prod (still useful for blip recovery; never harmful).

### Orphan rows in `email_messages` (cosmetic, not user-facing)
- **Symptom seen 2026-04-28**: 5,938 rows exist with
  `source_account_id = 91`, but no `email_accounts` row with `id = 91`
  exists. Top senders look like a previously-connected personal Gmail
  (Air Canada, Adidas, Craigslist, 23andMe, etc.) — the account was
  disconnected and the rows were never garbage-collected.
- **Impact**: none — the route's `resolveAccount` would never resolve to
  `91`, so these rows are dead storage only. ~5,938 rows out of ~65k total
  is meaningful but not urgent.
- **What to do post-Commit-8 if/when storage becomes a concern**: write a
  one-shot cleanup script that deletes `email_messages WHERE
  source_account_id NOT IN (SELECT id FROM email_accounts)`. Run inside a
  transaction with a row-count assertion. Also consider adding a periodic
  GC pass when an account is disconnected via the UI so this doesn't
  re-accumulate.

### OAuth-completion admin tasks: missed for accounts 92 and 93 (data correction, ran post-Commit-4.1)
- **Symptom seen 2026-04-28**: support@voltsafe.com (id 92) and
  sales@voltsafe.com (id 93) did not appear in the Work → Inbox sidebar
  after Commit 4.1 landed. They WERE visible in Admin → My Mailboxes
  (different endpoint). User suspected a 4.1 regression.
- **Actual cause (NOT a 4.1 regression)**: when these two accounts were
  added via OAuth, the post-OAuth admin tasks were never run. The rows
  came in with the default shape (`user_id = trevor's user_id = 4` AND
  `is_shared = false`), which means `/api/gmail/accounts` annotated all
  three accessible rows as `isOwner = true` (the rule is
  `userId === sessionUserId && !isShared`). The sidebar then collapsed:
  `personalAccount = data.find(isOwner)` returned trevor (first match);
  `sharedAccounts = data.filter(!isOwner && ...)` returned `[]`. Net:
  the other two were silently dropped before render. The bug had been
  latent in the data model since OAuth completion; 4.1's frontend made
  it visible only because the user happened to actively check the
  sidebar around the same time. Confirmed by reading
  `client/src/pages/gmail-inbox.tsx:3116-3122` (sidebar filter) and
  `server/routes.ts:10509` (server isOwner annotation), plus the live
  state of `email_accounts` and `users.permissions.mail_team` for
  user 4 (`{}` — empty, no shared-inbox grants).
- **Data correction applied (NOT a Commit 4.2 — purely operational)**:
  ```sql
  -- 1. Mark 92 and 93 as shared inboxes so isOwner→false on them.
  UPDATE email_accounts SET is_shared = TRUE WHERE id IN (92, 93);
  -- before: is_shared=f for both;  after: is_shared=t for both
  -- trevor (id 1) is_shared=f UNCHANGED.

  -- 2. Grant trevor view+edit on both shared inboxes (he is role='sales',
  -- not admin, so the isAdmin shortcut in sharedAccounts filter doesn't
  -- apply — needs an explicit grant).
  UPDATE users
  SET permissions = jsonb_set(
    permissions,
    '{mail_team}',
    '{"92": {"view": true, "edit": true}, "93": {"view": true, "edit": true}}'::jsonb,
    true
  )
  WHERE id = 4;
  -- before: permissions.mail_team = {} (empty)
  -- after:  permissions.mail_team = {"92":{"view":true,"edit":true},"93":{"view":true,"edit":true}}
  -- All 10 other top-level permission keys (crm, quoting, support,
  -- calendar, projects, knowledge, partnerships, calendar_team,
  -- team_workload, communications) preserved. Verified by exact JSONB
  -- equality check post-update.

  -- 3. One-shot operational catch-up sync for sales (account 93 had
  -- last_sync_at IS NULL, was serving only backfill rows).
  -- See scripts/resync-account-93.ts. Invoked syncEmailAccount(93,
  -- {maxPages:3, pageSize:100}) directly (auth bypass — test admin
  -- credentials in this repo have drifted; standard /api/gmail/
  -- accounts/93/resync would also work in browser). Result: pages=3,
  -- processed=300, newMessages=1, hitPageLimit=true, elapsed 2.4s.
  -- last_sync_at: NULL → 2026-04-28 01:03:02 ✓
  -- total_msgs: 6010 → 6011, inbox_msgs: 4164 → 4165,
  -- newest_msg_at: 2026-04-27 20:59 → 2026-04-28 00:17.
  ```
- **Why this is documented here, not in a new commit entry**: the
  active commit plan (Commits 1–8) is for code/feature work. This was
  pure data correction — the cleanup that should have run at OAuth
  completion. No code changed. The script (`scripts/resync-account-93.ts`)
  is preserved in the repo as a written record of what was run; do
  NOT delete it.
- **Process gap to close**: today there is no automated post-OAuth
  hook that prompts the operator to set `is_shared` and grant
  `mail_team` perms on a fresh account. Whoever connects a shared
  inbox via OAuth has to remember to run the two updates manually.
  Worth productising in a later commit (e.g., a "Mark as shared
  inbox" toggle on the mailbox-settings page that handles both
  flips atomically and grants the connector view+edit by default).
  NOT in scope for any open commit today.
- **Verification owner**: user verifies in `.dev` after this entry
  lands. Expected outcome: trevor under "Personal", support and sales
  under "Shared Inboxes" in the Work → Inbox sidebar. Sidebar refreshes
  on the next 30s `accountsQuery` poll; no app restart required.

### Process note: audit-gap lesson learned (Commit 1 keyset bug + Commit 4.1 source-default bug)
Both bugs had the same shape: a code path was correctly built but **not
actually reached** in the active flow. The reviews verified "does this
code execute correctly when called?" without verifying "does this code
actually get called?". Going forward, architecture/code reviews on this
project should explicitly answer BOTH questions for any non-trivial code
path. A one-line guard test (like `tests/source-default.test.js`) that
pins the wiring is cheap insurance — write it any time the answer to
"does this default value matter?" is yes.

---

## Unified Inbox — Commit 8 of 8: Admin diagnostic + recovery endpoints (Complete, 2026-04-28)

### Why this exists
After Commits 1–7 the user-facing path was watertight (auto-backfill on OAuth,
visible progress, atomic cancel/resume, foreground polling, new-message pill,
keyset pagination). But the **operator** path was opaque. When a mailbox stalled
in production — webhook stale, backfill stuck, history-id desynced — there was
no single place to look at "is the sync layer healthy across all mailboxes?"
and no way to recover without dropping into the database. The Post-Publish
section above is full of exactly this kind of investigation done by hand.

Commit 8 closes the operator gap with four admin-only endpoints. Together they
answer the two questions an operator actually has when something looks wrong:
1. **"Is anything stale?"** — `GET /api/admin/mailbox/diagnostics` returns one
   row per active mailbox with sync state, watch state, queue depth, in-flight
   backfill, last terminal backfill, and stored message count. All in a single
   round-trip with derived freshness flags (`webhookStaleness.isStale`,
   `watch.isExpired`, `watch.expiresInMs`) computed server-side so the
   operator doesn't have to do mental math against the current timestamp.
2. **"Can I fix it without a DB shell?"** — `POST .../trigger-backfill` and
   `POST .../force-full-resync` are the recovery levers. Trigger-backfill
   delegates to the same `autoEnqueueBackfillForNewAccount` helper the OAuth
   completion path uses (single source of truth — fixing one fixes both).
   Force-full-resync clears `last_history_id + sync_error_message` and fires
   `syncIncremental` async, which falls into the SEED branch and re-anchors
   the cursor from Gmail's `Profile.historyId`.

### What changed (the diff, in plain English)

**Backend — canonical enqueue helper exported (`server/gmail-oauth.ts`):**
- `autoEnqueueBackfillForNewAccount` was a private function called only from
  the OAuth callback. It is now `export`ed and accepts three new optional
  knobs: `dateFromOverride`, `dateToOverride`, and `skipIdempotencyCheck`.
- Return shape is now structured: `{ enqueued: true, jobId, dateFrom, dateTo }`
  on success, `{ enqueued: false, reason }` on the no-op path. This lets the
  admin route distinguish "blocked by in-flight guard" (409) from "actual
  enqueue/DB failure" (500).
- The idempotency guard widened from `('pending','running')` to
  `('pending','running','cancelling')`. Without `cancelling`, hitting the
  Stop button mid-run and immediately re-clicking the (admin) trigger could
  spawn a second worker before the first one had cooperatively exited.
- **Architect-flagged SEV-HIGH (TOCTOU race) — fixed**: the original guard
  was `SELECT existing` followed by `INSERT`. Two concurrent OAuth callbacks
  (or two trigger-backfill clicks within the same millisecond) could both
  pass the SELECT and both INSERT, spawning duplicate workers. The fix
  collapses both statements into a single
  `INSERT INTO backfill_jobs ... SELECT ... WHERE NOT EXISTS (...)` query.
  The DB enforces mutual exclusion — at most one of two concurrent inserts
  actually writes a row, the loser's RETURNING comes back empty, and we
  report `enqueued: false, reason: "in-flight job already exists"` exactly
  the same way the old guard did. The `skipIdempotencyCheck=true` admin
  override path uses an unconditional INSERT — that's the by-design "force"
  semantics, documented at the route level.

**Backend — four new admin endpoints (`server/routes.ts`, cluster ~L5254):**
All four gated by `requireAuth + requireAdmin` (session.globalRole must be
`master_admin` or `admin`). Verified by curl: all return 401/403 unauthenticated.

- `GET /api/admin/mailbox/diagnostics` — system overview. One row per
  active mailbox in a single query: `accountId`, `userId`, `emailAddress`,
  `provider`, `lastWebhookAt`, `lastIncrementalSyncAt`, `lastHistoryId`,
  `watchExpirationAt`, `watchTopic`, `syncErrorMessage`, `storedMessageCount`,
  `lastMessageAt`, `queueDepth`, `inflightBackfill` (json subquery),
  `latestTerminalBackfill` (json subquery). Server-side derived flags:
  `webhookStaleness.{ageMs, isStale, isOlderThanThreshold}`,
  `incrementalStaleness.{ageMs, isStale}`,
  `watch.{expirationAt, isExpired, expiresInMs}`,
  `pushConfigured` (server-wide flag from `isPushConfigured()`).
  Stale threshold is 24h (`24*60*60*1000`).

- `GET /api/admin/mailbox/:id/diagnostics` — single-mailbox detail view.
  Same shape as the overview row PLUS `recentBackfills` (last 10
  `backfill_jobs` rows for this account, ordered by id DESC). 404s on
  missing mailbox; validates `:id` via `parseInt(req.params.id, 10)`.

- `POST /api/admin/mailbox/:id/trigger-backfill` — recovery lever #1.
  Body `{ dateFrom?: string, dateTo?: string }` (both validated against
  `^\d{4}-\d{2}-\d{2}$`). Query `?force=true` maps to
  `skipIdempotencyCheck=true` (admin override of the in-flight guard).
  Delegates to canonical `autoEnqueueBackfillForNewAccount` helper —
  trigger-backfill and OAuth completion now run the SAME enqueue code
  path. Response: `{ ok: true, enqueued: true, jobId, dateFrom, dateTo }`
  on success; `{ ok: false, message: "Not enqueued: <reason>" }` with
  status 409 (in-flight conflict) or 500 (actual failure) on the no-op path.

- `POST /api/admin/mailbox/:id/force-full-resync` — recovery lever #2.
  Operator-of-last-resort tool: clears `last_history_id` and
  `sync_error_message` via a single UPDATE, then fires `syncIncremental`
  fire-and-forget. With `last_history_id` NULL, `syncIncremental` falls
  into its SEED branch (`syncEmailAccount({ maxPages: 1 })` then
  `captureProfileHistoryId`) and re-anchors the cursor from Gmail's current
  `Profile.historyId`. Optional `?withBackfill=true` ALSO enqueues a
  90-day backfill via the canonical helper for cases where the operator
  wants to re-fetch recent history into storage as well as re-anchor the
  cursor. Response: `{ ok: true, clearedHistoryId: true, reseedScheduled: true,
  backfill: ... }`.

**Tests — `tests/admin-diagnostics.test.js` (27 source-grep assertions):**
- Group A (4 tests): canonical enqueue helper export, parameters, atomic
  TOCTOU fix, structured return shape.
- Group B (5 tests): GET overview — auth gate, all required field aliases
  in the SELECT, json subqueries for backfill state, derived freshness
  flags, `pushConfigured` global.
- Group C (4 tests): GET detail — auth gate, :id parsing + 404, recentBackfills
  query, single-mailbox storedMessageCount.
- Group D (5 tests): POST trigger-backfill — auth gate, canonical-helper
  delegation, `?force=true` mapping, dateFrom/dateTo validation, 409 vs 500
  signal split.
- Group E (6 tests): POST force-full-resync — auth gate, clears last_history_id,
  clears sync_error_message, fires syncIncremental async, `?withBackfill=true`
  branch, response shape.
- Group F (3 tests): structural integrity — Commit 8 cluster header
  comment present, no duplicate route registrations.
- **All 27 passing.** Pinned the structural contract of the four routes
  AND the canonical-helper refactor in one place.
- Why source-grep instead of live HTTP: the recovery endpoints fire workers
  that touch real Gmail. A live test would either need a Gmail mock or
  make real Google API calls — both expensive given what we're actually
  trying to pin (route definitions, auth gates, payload shapes, trigger →
  worker call edges). Live validation is the operator's job — they'll
  curl these endpoints with their session cookie against `.replit.app`
  to confirm they work end-to-end with their real mailboxes.

**Regression tests (all four other suites still green after architect fixes):**
- `tests/auto-backfill.test.js`: 14/14 (Commit 7 backfill UI/UX contract).
- `tests/new-messages-pill.test.js`: 20/20 (Commit 6 pill).
- `tests/foreground-polling.test.js`: 23/23 (Commit 5 fallback).
- `tests/admin-diagnostics.test.js`: 27/27 (Commit 8, this entry).

### Race / safety analysis (architect review summary)

The architect review (`includeGitDiff: true`) found four issues. Two were
fixed in-commit (above), two are documented design choices:

1. **SEV-HIGH — TOCTOU enqueue race**: FIXED with atomic
   INSERT-WHERE-NOT-EXISTS (above).

2. **SEV-LOW — 409 vs 500 signal blurring**: FIXED with `isConflict`
   ternary in trigger-backfill route (above).

3. **SEV-MED — `?force=true` can spawn parallel workers**: by-design.
   `?force=true` is the explicit "I, the operator, am intentionally
   overriding the in-flight guard" knob. The canonical helper logs
   `[auto-backfill] enqueued job N` on every fire; if the operator
   double-clicks force, two workers run concurrently and both write to
   the same `backfill_jobs` rows — recoverable via the cancel endpoints,
   but disorderly. Mitigation: the route is admin-only and the worker
   has a per-page cancel-check (Commit 7), so the overlap window is
   bounded. Not adding an account-level lock today — that would change
   the contract of the canonical helper and risk regressing the OAuth
   path's fast-fire behaviour.

4. **SEV-MED — `force-full-resync` can overlap with concurrent webhook /
   poll syncs**: by-design (and pre-existing). `syncIncremental` is
   already called from the hourly scheduler, the foreground polling loop
   (Commit 5), AND the webhook handler. There is no account-level lock
   on `syncIncremental` today; two concurrent runs are tolerated because
   Gmail's history API is idempotent and the `last_history_id` cursor
   simply advances to whichever writer commits last. Force-resync is a
   clean RESET of the cursor, not a new race vector. Adding an
   account-scoped `pg_advisory_xact_lock` would be a worthwhile cleanup
   but it would affect ALL three callers, not just this one — out of
   scope for Commit 8, properly belongs in a future "sync-pipeline lock"
   commit.

### Process note: audit-gap lesson #2 (visibility ≠ recovery)

Commits 1–7 were technically correct but **operationally insufficient**:
the system had no operator-facing answer to "is anything stale across all
mailboxes?" or "how do I unstuck this without a DB shell?". The audit-gap
lesson from earlier (Commit 1 keyset bug + Commit 4.1 source-default bug)
said: a code path that's correctly built but not actually reached is the
same as no code path at all.

Commit 8 generalises that lesson: when building observability or
recovery for a long-running pipeline, **distinguish two classes of
question and answer BOTH**:

1. **"Is the system healthy?"** — the diagnostic question. Answered by a
   read-only endpoint that returns enough state in one round-trip for
   the operator to triage without writing SQL. Server-side derived flags
   (e.g., `isStale`, `isExpired`) are critical — leaving date math to
   the caller invites bugs on the dashboard.
2. **"Can the operator fix it without changing code or data manually?"**
   — the recovery question. Answered by trigger endpoints that delegate
   to the same canonical worker code paths the normal happy-path uses.
   `trigger-backfill` shares its enqueue code with the OAuth callback;
   `force-full-resync` shares its seed code with the webhook handler.
   Single source of truth → one place to fix bugs in.

Doing only #1 (a dashboard) leaves the operator helpless when they see
red. Doing only #2 (a button) leaves them blind about when to push it.
Both questions need first-class answers in the same commit.

### Verification

User verifies in `.dev` (and post-publish in `.replit.app`) by:
1. Hitting `GET /api/admin/mailbox/diagnostics` with their admin
   session cookie. Expect: 200 with `{ accounts: [...], pushConfigured,
   staleThresholdMs }`. Sanity check that `webhookStaleness.isStale`
   matches the Post-Publish section's known-stale account (trevor's
   `last_webhook_at` is the canonical "stale push" example).
2. Hitting `GET /api/admin/mailbox/93/diagnostics` (or any active id)
   to verify the detail endpoint returns the same row plus
   `recentBackfills`.
3. Optionally: `POST /api/admin/mailbox/93/trigger-backfill` with
   `?force=true` to confirm the recovery path enqueues a job and the
   Commit 7 progress banner appears in the inbox immediately.

Watch-renewal cron is wired (see updated Post-Publish entry below) and
its current expiration is now visible per-mailbox in the diagnostic
output as `watch.expirationAt + watch.expiresInMs + watch.isExpired`,
so push-delivery health no longer requires a DB shell to investigate.

### Files touched
- `server/gmail-oauth.ts` — exported helper, added 3 optional params,
  atomic INSERT-WHERE-NOT-EXISTS replaces SELECT-then-INSERT, structured
  return shape.
- `server/routes.ts` — 4 new admin endpoints in the cluster at ~L5254
  (immediately before `/api/admin/users/:id` PUT). Cluster header
  comment present for operator-readable provenance.
- `tests/admin-diagnostics.test.js` — new, 27 source-grep assertions,
  all green.

### Post-Commit 8 product tweak: plain-text email reader (2026-04-28)

**Trigger**: user-reported visual bug — opening certain Gmail threads
showed the message body as raw plain text with `<https://very-long-url>`
angle-bracket wrapping and literal markdown asterisks
(`*Beki Kabanzira*`) instead of clean typography. Screenshot was
unmistakable: a Survey-Monkey-style "application link" email rendered as
a wall of monospace.

**Root cause**: the inbox reader's `MessageBody` component had two
rendering paths — a sandboxed-iframe srcDoc for `isHtml=true` (with
Apple-Mail-grade CSS, image scaling, link styling, zoom controls) and a
naked `<pre>` block for everything else. Any message that arrived as
text/plain — either because the sender (Gmail's YAMM tracker, in this
case) only ships text/plain, or because we couldn't reach the multipart
HTML alternative for a thread that fell through to the Gmail-direct
fetch — got the `<pre>` treatment. URLs were unclickable, asterisks were
literal, quoted reply chains were `> > >` walls, and `[image: ...]`
placeholders just sat there as confusing dead text.

**Decision**: keep ONE iframe rendering path; convert plain-text emails
to presentation-grade HTML on the client first. Single typography
contract, single security perimeter, single zoom/fit treatment.

**Code change** (NO schema, NO new commit number — Commit 8 was the last
in the 8-commit plan, this is purely client-side rendering):

- `client/src/lib/sanitize-html.ts` — new exported
  `plainTextToEmailHtml(text)`. Eight ordered passes, each operating on
  the previous step's already-escaped output:
  1. HTML-escape every char first (`&` `<` `>` `"` `'`) so subsequent
     steps can ONLY add tags, never inject content.
  2. Replace `[image: URL]` placeholders with a tiny muted `[image]`
     marker — the bracketed URL is the source page of the image, not
     a real image file, so there's nothing renderable.
  3. Linkify Gmail's RFC-3676 `<URL>` plain-text wrapping → clickable
     `<a target="_blank" rel="noopener noreferrer nofollow">URL</a>`
     with the angle brackets stripped from the visible text. This is
     the regex that fixes the screenshot's exact URL pattern.
  4. Linkify bare `http(s)://` URLs not already inside an `<a href>`
     (look-behind class `[^"'>]` blocks double-wrapping); trailing
     punctuation `.,;:!?)]}` is excluded so `see https://x.com.` doesn't
     link the period.
  5. Linkify bare email addresses as `mailto:` (same look-behind trick).
  6. Markdown emphasis: `**bold**` first, then `*bold*` (Gmail-signature
     style, fixes literal-asterisk on `*Beki Kabanzira*`), then
     `_italic_`. `**` must run first or single-`*` would half-eat it.
     Inner content forbids `\n` and `*` so emphasis can't span across
     paragraphs.
  7. Group consecutive lines starting with `>` (now `&gt;` after step 1)
     into a single `<blockquote>`. Multiple-level quotes (`>>`, `>>>`)
     all collapse into the same block — visual nesting of
     reply-of-reply-of-reply is rarely useful and hurts horizontal width.
  8. Paragraph breaks on blank lines; single newlines → `<br>`. Already
     block-level `<blockquote>` chunks pass through untouched.
- `client/src/pages/gmail-inbox.tsx` — `MessageBody`:
  - Import the new helper.
  - `sanitized` useMemo now does `isHtml ? sanitizeEmailHtml(body) :
    sanitizeEmailHtml(plainTextToEmailHtml(body))`. DOMPurify is STILL
    the last step on either branch — the new converter is purely a
    cosmetic transform; security is unchanged.
  - Reading-mode toolbar (Beautiful / Source / Plain) ungated from
    `isHtml` → shown for any non-empty body. Toolbar now equally
    useful for plain-text emails: Beautiful = rendered, Source = the
    HTML we built, Plain = the original text.
  - Iframe branch ungated from `isHtml` → renders for ANY body in
    Beautiful mode.
  - Legacy `mode === "beautiful" && !isHtml` `<pre>` branch removed
    (now superseded by the single iframe path).

**Safety**: zero security regression. Every byte still funnels through
DOMPurify before reaching the iframe srcDoc. The new converter only
inserts already-escaped content into a fixed allow-list of tags
(`<a>` `<p>` `<br>` `<strong>` `<em>` `<blockquote>` `<span>`); even if
the regex logic broke, DOMPurify would strip anything dangerous on the
second pass.

**Tests**: 9-assertion converter sanity check (Node, no DOM) covers
every pattern from the screenshot — angle-bracket URL, `*bold*`
signature, `[image: URL]` placeholder, mailto, quoted lines,
paragraphs, no-leftover-literal-`&lt;https`, no-leftover-`[image:`.
All 9 pass. TypeScript compile shows ZERO new errors in either touched
file (the pre-existing TS errors in unrelated files are untouched and
out of scope).

**Files**:
- `client/src/lib/sanitize-html.ts` — `+~110` lines (new function +
  jsdoc explaining the 8-step pipeline and the security argument).
- `client/src/pages/gmail-inbox.tsx` — `~12` lines changed (import,
  `sanitized` memo, two `isHtml &&` gates removed, legacy `<pre>`
  branch deleted with a breadcrumb comment).

### Post-Commit 8 product tweak: default backfill window 90d → 1 year (2026-04-28)

**Trigger**: post-deploy product feedback that 90 days of email is too
short for a CRM-grade unified inbox — renewal cycles, project timelines,
and customer threads routinely span 6–12 months. A new user connecting
their Gmail and only seeing the last quarter of history undersells the
"endless scrolling, all your email in one place" promise that defines
the feature.

**Decision**: every newly OAuth'd user mailbox now backfills the last
**365 days (1 year)** by default. The three special voltsafe addresses
(trevor / sales / support) keep their `2020-01-01 → today` override per
ops policy — they're not affected by this change.

**Code change is a one-line constant flip + copy updates** (NO schema
change, NO new commit number — Commit 8 was the last commit in the
8-commit plan; this is a config tweak):
- `server/gmail-oauth.ts`: `DEFAULT_BACKFILL_DAYS = 90` → `365`. The
  `computeDefaultBackfillFrom()` helper picks up the new value
  automatically — every downstream caller (OAuth completion, admin
  trigger-backfill, admin force-full-resync `?withBackfill=true`) gets
  the new window for free since they all funnel through
  `autoEnqueueBackfillForNewAccount`.
- `client/src/pages/gmail-inbox.tsx`: the four user-visible status-text
  strings on the backfill progress banner now say "your last year of
  email" / "from the last year" instead of "your last 90 days" / "from
  the last 90 days". Comment headers updated to match.
- `server/routes.ts`: comments inside the Commit 8 admin cluster now
  mention "365-day / 1-year default" and "1-year backfill" for accuracy.
- `tests/auto-backfill.test.js`: A1 regex now pins `DEFAULT_BACKFILL_DAYS = 365`
  (was `90`). All 14 tests still green.
- `tests/admin-diagnostics.test.js`: E5 description string updated to
  "1-year backfill". All 27 tests still green.

**Scope of effect**:
- **Future OAuths**: get the new 1-year window automatically. No data
  migration needed.
- **Already-connected mailboxes**: NOT auto-rebackfilled. They keep
  whatever history they already imported. An operator who wants to
  extend an existing mailbox to a year of history can hit
  `POST /api/admin/mailbox/:id/trigger-backfill` with body
  `{ "dateFrom": "<today minus 365 days as YYYY-MM-DD>" }`, or
  `{ "dateTo": "<existing earliest date>" }` to fill the gap without
  re-fetching what's already stored. The Commit 7 idempotency guard
  prevents accidental duplicate workers.
- **Production rollout**: requires a republish to `.replit.app` since
  the constant is compiled into the server bundle.

**What stayed the same**:
- Cancel / resume semantics (Commit 7) unchanged — a 1-year backfill is
  resumable from the persisted `last_page_token` exactly the same way a
  90-day one was.
- TOCTOU-safe atomic enqueue (Commit 8 SEV-HIGH fix) unchanged.
- The user-visible progress banner text now reads "your last year of
  email" — same banner, same z-index stack, same Stop/Resume buttons,
  same 5s/30s polling cadence.

**Test sweep after change**: all 4 unified-inbox source-grep suites
green — admin-diagnostics 27/27, auto-backfill 14/14,
new-messages-pill 20/20, foreground-polling 23/23. Total 84/84.

### Architecture: unified-inbox canonical flow (post-Commit-8, end-to-end)

After 8 commits the unified-inbox feature is complete. For future
contributors, here is the canonical flow from "user clicks Connect Gmail"
to "user reads a brand-new inbound message":

```
        ┌────────────────────────────────────────────────────────────────┐
        │  USER → /api/oauth/google/start  (Commit 4.1, gmail-oauth.ts)  │
        │                  ↓ Google consent screen                        │
        │       Google → /api/oauth/google/callback                       │
        │                  ↓ exchange code, persist email_accounts row    │
        │       autoEnqueueBackfillForNewAccount(accountId, email, user)  │
        │       ────────────────────────────────────────────────────────  │
        │       INSERT-WHERE-NOT-EXISTS into backfill_jobs (Commit 8)     │
        │       fire-and-forget runBackfillJob(jobId)                     │
        │       startWatch(emailAccount) → Gmail Pub/Sub watch (Commit 5) │
        └────────────────────────────────────────────────────────────────┘
                            │                                │
                            │                                │
        ┌───────────────────▼──────────────┐  ┌──────────────▼──────────────┐
        │  BACKGROUND: runBackfillJob       │  │  STEADY-STATE: incremental │
        │  (server/services/backfill-       │  │  (server/services/gmail-   │
        │   service.ts, Commit 7)           │  │   incremental.ts)          │
        │  ─────────────────────────────    │  │  ──────────────────────    │
        │  page Gmail messages.list from    │  │  webhook arrives           │
        │  date_from→date_to, 100/page      │  │   ↓                        │
        │  per-page cancel check at top     │  │  syncIncremental(accountId)│
        │  of loop (atomic UPDATE WHERE     │  │   ├─ if !lastHistoryId →   │
        │  status IN cancelling/cancelled)  │  │   │  SEED via              │
        │  persist last_page_token+         │  │   │  syncEmailAccount({    │
        │  processed every page; resume     │  │   │    maxPages:1 }) +     │
        │  from saved values on restart     │  │   │  captureProfileHistory │
        │  writes to email_messages         │  │   └─ else → history.list   │
        └───────────────────┬──────────────┘  └──────────────┬─────────────┘
                            │                                │
                            └────────────────┬───────────────┘
                                             ▼
        ┌────────────────────────────────────────────────────────────────┐
        │  email_messages table (RECEIVING SIDE OF EVERYTHING)            │
        │  insert-or-update on (source_account_id, gmail_id) unique key   │
        └────────────────────────────────────────────────────────────────┘
                                             │
        ┌────────────────────────────────────▼───────────────────────────┐
        │  FRONTEND: /api/my/inbox (Commit 1 keyset, Commit 4.1 source-  │
        │  filter), /api/my/mailbox/backfill/status (Commit 7 banner),   │
        │  /api/my/inbox/changes (Commit 5 polling, Commit 6 pill)       │
        │  ─────────────────────────────────────────────────────────────  │
        │  gmail-inbox.tsx renders:                                       │
        │    • banner (Commit 7) — sticky top-0, in-flight backfill UI    │
        │    • pill   (Commit 6) — sticky top-2, "N new messages" jump-up │
        │    • toolbar          — sticky top-0 z-10, bulk actions         │
        │    • message list     — keyset paginated                        │
        └────────────────────────────────────────────────────────────────┘

        ┌────────────────────────────────────────────────────────────────┐
        │  ADMIN OBSERVABILITY (Commit 8, server/routes.ts ~L5254)        │
        │  ─────────────────────────────────────────────────────────────  │
        │  GET   /api/admin/mailbox/diagnostics       — system overview   │
        │  GET   /api/admin/mailbox/:id/diagnostics   — single mailbox    │
        │  POST  /api/admin/mailbox/:id/trigger-backfill  → calls         │
        │        autoEnqueueBackfillForNewAccount (same as OAuth path)    │
        │  POST  /api/admin/mailbox/:id/force-full-resync → clears        │
        │        last_history_id then fires syncIncremental (same as      │
        │        webhook path, just with cleared cursor)                  │
        └────────────────────────────────────────────────────────────────┘
```

**Key invariants:**
- No Drizzle schema changes were ever made for any of the 8 commits.
  All new state lives on existing tables: `email_accounts.last_history_id`,
  `last_webhook_at`, `last_incremental_sync_at`, `incremental_event_count`,
  `watch_expiration_at`, `watch_history_id`, `watch_topic`, `sync_error_message`;
  `backfill_jobs.{status, last_page_token, processed, total_estimate}`
  (raw-SQL managed table, NOT in `shared/schema.ts`).
- Single source of truth for enqueue: `autoEnqueueBackfillForNewAccount`
  is called from BOTH OAuth completion AND admin trigger-backfill.
- Single source of truth for seed: `syncEmailAccount({ maxPages: 1 })` +
  `captureProfileHistoryId` is the SEED branch of `syncIncremental` AND
  the path that force-full-resync funnels through (by clearing
  `last_history_id` and re-firing `syncIncremental`).
- Race safety: cancel/resume use atomic `UPDATE...WHERE status IN
  (...) RETURNING id` (Commit 7); enqueue uses atomic
  `INSERT...WHERE NOT EXISTS` (Commit 8).
- All background work is fire-and-forget at the call site with
  `.catch(err => console.error(...))` — workers maintain their own
  state on disk so a crash mid-loop is recoverable on next call.

---

## Unified Inbox — Commit 7 of 8: Auto 90-day backfill on OAuth + visible progress UI (Complete, 2026-04-28)

### Why this exists
A brand-new Gmail OAuth completion was previously a "trust fall" — the inbox
either showed nothing (no backfill, until the next manual trigger) or it
showed an unbounded "2024-01-01 → today" import that the user couldn't see
the status of, couldn't stop, and couldn't resume. Commit 7 closes both
gaps: a freshly connected mailbox automatically enqueues a backfill of the
last 90 days of email AND surfaces a sticky progress banner at the very
top of the inbox showing the import in real time. The user always sees
what's happening, can pause cleanly mid-flight, and can resume from the
exact same place on the next visit.

This commit deliberately reuses the existing `runBackfillJob` worker and
`backfill_jobs` table (raw-SQL managed, NOT in `shared/schema.ts`) — the
only "new state" is two free-text values added to the existing free-text
`status` column: `cancelling` (cancel requested by the user) and
`cancelled` (loop exited cleanly mid-run). NO Drizzle schema changes; the
`total_estimate` column also already existed and is now populated by the
worker on the first Gmail API call.

### What changed (the diff, in plain English)

**Backend — automatic enqueue (`server/gmail-oauth.ts`):**
- New constant `DEFAULT_BACKFILL_DAYS = 90` and helper
  `computeDefaultBackfillFrom()` that returns today−90d as `YYYY-MM-DD`.
- `autoEnqueueBackfillForNewAccount` now uses this helper as the default
  `date_from`. The hardcoded `"2024-01-01"` is gone.
- `SPECIAL_2020_ADDRESSES` set (trevor / sales / support @voltsafe.com)
  is preserved — those mailboxes still get the longer 2020-01-01 history
  per ops policy.

**Backend — runBackfillJob worker (`server/services/backfill-service.ts`):**
- On entry, reads `last_page_token`, `total_estimate`, AND `processed`
  from the existing job row. Resume-aware: if the job was previously
  cancelled or failed mid-run, `processed` continues counting from the
  persisted value instead of rewinding to 0.
- On the **first iteration only** (when `!pageToken && totalEstimate === null`),
  captures Gmail's `resultSizeEstimate` from the very first
  `messages.list` response and writes it to `backfill_jobs.total_estimate`.
  Gmail's estimate is approximate (often ±20%) but it's the right starting
  point for the progress bar — better than nothing.
- At the **top of the `while (hasMore)` loop**, re-reads the live status
  from the DB. If it's `cancelling` or `cancelled`, persists status
  `cancelled` with the current `processed` count, leaves `last_page_token`
  populated, and returns. Per-page granularity (not per-message) is
  intentional — each Gmail page is up to 100 messages, so worst-case the
  user waits ~5–15s for a Stop click to take effect, but we avoid
  hammering the DB with a status SELECT per message.

**Backend — two new endpoints (`server/routes.ts`):**
- `POST /api/my/mailbox/:id/backfill/cancel` — owner-scoped (verifies
  `email_accounts.user_id = session.userId`); flips the most-recent
  in-flight job (`status IN ('pending','running')`) to `cancelling` via
  a single **atomic conditional UPDATE with `RETURNING id`**. If 0 rows
  come back (no in-flight job, OR worker just finished in the same
  millisecond), returns 404. The atomic shape is the architect's
  SEV-HIGH fix below.
- `POST /api/my/mailbox/:id/backfill/resume` — same atomic-conditional-
  UPDATE pattern, but flips `status IN ('cancelled','failed')` back to
  `pending` and returns `date_from` / `date_to`. On success, fires
  `runBackfillJob` fire-and-forget the same way `autoEnqueueBackfillForNewAccount`
  does. If 0 rows come back (nothing resumable, OR a peer request beat
  us to it), returns 409 (NOT 404 — 404 would be misleading on a
  successful peer-resume).

**Frontend — sticky progress banner (`client/src/pages/gmail-inbox.tsx`):**
- New `backfillStatusQuery` hits the existing `GET /api/my/mailbox/backfill/status`
  endpoint with a **gated `refetchInterval`**: returns `5_000` only when
  there's an in-flight job for the active account (status in
  pending/running/cancelling), plus a 30-second tail after a terminal
  transition so the user sees the resolution land. Returns `false`
  otherwise — the endpoint is NOT polled when nothing is going on.
- `activeBackfillJob` `useMemo` filters the response to the currently
  active mailbox; "all" view shows the most-recent active job across any
  account so the user knows something is still happening even when not
  focused on it.
- `cancelBackfillMut` + `resumeBackfillMut` call the new endpoints via
  `apiRequest`; both invalidate the status query in `onSuccess` so the
  banner reflects the new state immediately without waiting for the next
  5s poll tick.
- The banner JSX is inserted as the **first child of the `inboxScrollRef`
  scroll container, BEFORE the Commit 6 pill**. Layering is `sticky top-0
  z-30` (banner) > `sticky top-2 z-20` (Commit 6 pill) > `sticky top-0 z-10`
  (bulk-action toolbar) — they stack visually without overlap.
- Six data-testids (banner-backfill-progress, button-backfill-cancel,
  button-backfill-resume, text-backfill-status, text-backfill-counts,
  progress-backfill-bar). Stop button gated to pending/running only;
  Resume button gated to cancelled/failed only.

### Race-condition analysis (architect-driven)

The architect self-review (with `includeGitDiff: true`) flagged one
SEV-HIGH and two SEV-MEDs in the v1 backend draft. All three are fixed:

1. **SEV-HIGH (was): Cancel route could overwrite a just-completed job.**
   The original cancel route did `SELECT id WHERE status IN ('pending','running')`
   then a separate unconditional `UPDATE ... SET status='cancelling' WHERE id=?`.
   If the worker finished between SELECT and UPDATE, status would race
   `running → completed → cancelling` with no loop left to convert
   `cancelling → cancelled`. The resume endpoint's old in-flight guard
   (`status IN ('pending','running','cancelling')`) would then 409 forever
   — the user could neither resume NOR re-trigger.
   **Fix:** Single atomic `UPDATE ... SET status='cancelling' WHERE id =
   (SELECT ... status IN ('pending','running')) RETURNING id`. If 0 rows
   come back, return 404 — the job is no longer cancellable, period. No
   ghost `cancelling` rows possible.

2. **SEV-MED (was): Resume race under concurrent clicks.**
   The original resume route also split SELECT-then-UPDATE; two
   simultaneous clicks could both pass the in-flight guard and both fire
   `runBackfillJob` on the same job. No data loss (DB dedupe handles it)
   but real correctness churn.
   **Fix:** Same atomic-UPDATE-with-RETURNING shape, additionally guarded
   by `WHERE id = ... AND status IN ('cancelled','failed')`. The losing
   request gets 0 rows back and returns 409.

3. **SEV-MED (was): `processed` rewinds on resume.**
   Original `runBackfillJob` initialized `let processed = 0` every entry.
   After a resume, the banner counter would visually jump from
   "1,247 of ~5,000" back to "0 of ~5,000" even though `last_page_token`
   meant the worker was correctly continuing where it left off.
   **Fix:** Read `processed` from the DB on entry alongside
   `last_page_token` and `total_estimate`; initialize the local counter to
   that value.

### Architect verdict
After fixes: **PASS-with-followups**. One SEV-LOW deferred:

- *(SEV-LOW deferred):* Banner polling becomes `false` after the 30-second
  terminal tail. If a brand-new OAuth happens **while the inbox tab is
  already open and idle** (rare — OAuth normally redirects away and back,
  which remounts the page and refetches), the new job won't be discovered
  until the next focus event, page nav, or other invalidation. Acceptable
  for v1 because the actual OAuth flow always redirects through the page
  remount path. Will revisit if real users report banner-miss in
  monitoring.

### User-facing verification (the disconnect/reconnect of sales@voltsafe.com)

1. Land on inbox; banner is invisible (no in-flight job).
2. Settings → Mailboxes → Disconnect `sales@voltsafe.com`.
3. Settings → Mailboxes → Connect → complete OAuth → land back on inbox.
4. Banner appears at the top: "Preparing to import your last 90 days of
   email · sales@voltsafe.com…" within ~1 second.
5. Within ~5 seconds the text flips to "Importing your last 90 days of
   email · sales@voltsafe.com — N of ~M (X%)" with a thin progress bar.
   The N value advances on every 5s tick.
6. Click **Stop**. Toast appears: "Stopping import…". Banner text changes
   to "Stopping import · sales@voltsafe.com — N imported so far". Within
   one batch boundary (~5–15s) banner flips to "Import paused at N
   message(s)" with a `[Resume]` button.
7. Click **Resume**. Banner text resumes from N (NOT 0). The denominator
   ~M is preserved.
8. Let it complete naturally. Banner briefly flashes "✓ Imported N
   messages from the last 90 days" then disappears within 30 seconds.
9. Re-test sequence with a non-special address (e.g., a personal Gmail) —
   verify the date range really IS today−90d, NOT 2020-01-01.
10. Concurrent-click stress: open inbox in two tabs during a running
    import; click Stop in both within the same second. Verify exactly
    one toast + exactly one transition (the loser tab gets a 404 toast
    or silently invalidates — no double-cancel artifacts).

### Done definition
- Commit 6's pill behavior unchanged (20/20 tests still green).
- Commit 5's foreground-polling behavior unchanged (23/23 tests still green).
- New `tests/auto-backfill.test.js` source-grep test: 14/14 green.
- Architect self-review applied: 1× SEV-HIGH + 2× SEV-MED fixed inline;
  1× SEV-LOW deferred and documented above.
- ZERO Drizzle schema changes. The `backfill_jobs` table is unchanged at
  the column level — only the value space of the existing free-text
  `status` column gained two new strings (`cancelling`, `cancelled`).
- The existing resumer in `server/index.ts` is `cancelled`-aware by
  construction: it picks up `status='pending'` and zombie `status='running'`
  (older-than-grace-period) only — it will NOT touch the new `cancelled`
  rows, which is exactly what we want (resume must be user-initiated).

### Operational items unchanged
- The 5 legacy test workflows (mail-permissions, mailbox-switching,
  permissions, tracking-multi-proof, tracking-proof) remain failing on
  pre-existing drifted login credentials (login-403 / fetch-failed during
  workflow restart). Documented in the Commit 6 entry below; unchanged
  by Commit 7.
- No new environment variables or secrets.
- No new background workers or schedulers.
- No new Drizzle migrations.

---

## Unified Inbox — Commit 6 of 8: "X new messages" top-of-list pill (Complete, 2026-04-28)

### Why this exists
With Commit 5's foreground 15s polling now reliably landing fresh mail in
the local mirror, we needed the user-facing notification piece. Without a
pill, fresh mail just silently appears at the top of the list — which is
fine if the user is already at the top, but invisible if they're scrolled
down reading something. Commit 6 surfaces a Superhuman/Gmail/Apple-Mail-style
pill ("1 new message" / "X new messages") at the top of the visible scroll
viewport whenever new mail arrives AND the user is not already at the top.
Click → smooth-scroll to top + dismiss + advance baseline. **Zero refetch**
— the new mail is already in the local mirror (delivered via the Commit 5
15s tick or push), already rendered just above the current scroll fold.

This commit covers ALL sources of new mail with a single detection path:
the Commit 5 foreground 15s tick, push delivery (when working in
production), and the backend hourly tick. They all flow into the same
`inboxQuery.data?.messages` array via react-query, and the detection
useEffect watches THAT array — not the polling fetch event. The user
explicitly flagged this as the race-safety contract: "appear AFTER the
new mail lands in the local mirror, not as a blind 'polling fired'
trigger."

### What changed (one frontend file + one source-grep test)

**`client/src/pages/gmail-inbox.tsx`** (+172 lines / -2 lines):

1. New lucide import: `ArrowUp` (line 23, slotted into the existing
   alphabetical-ish import group).

2. Five state primitives + two useEffects + one useCallback, placed
   **right after `inboxQuery`** (TDZ — the detection effect closes over
   `inboxQuery.data?.messages` and lists it in deps, so the declaration
   must precede this block; an earlier draft put them above the queries
   and triggered TS2448/TS2454 used-before-declaration errors. The
   relocated block is now at lines ~3288-3424 with a section-header
   comment block explaining the design):
   - `inboxScrollRef = useRef<HTMLDivElement>(null)` — ref attached to
     the message-list scroll container at line ~4871.
   - `lastSeenInboxIdsRef = useRef<Set<string>>(new Set())` — baseline
     of message ids the user has "acknowledged" (either by being at the
     top when they arrived, or by clicking the pill).
   - `lastSeenViewKeyRef = useRef<string>("")` — tracks the
     `${activeAccountId ?? "personal"}|${tab}|${searchQuery}` tuple so
     view changes silently re-baseline (no pill on view switch).
   - `[newMessagesCount, setNewMessagesCount] = useState(0)` — the
     visible pill count.
   - `[isAtTop, setIsAtTop] = useState(true)` — driven by the scroll
     listener; gates whether new arrivals increment the pill or just
     advance the baseline silently.
   - **Detection useEffect** on `[inboxQuery.data?.messages,
     activeAccountId, tab, searchQuery, isAtTop]`. Five branches:
     view-change → silent baseline reset (functional setState avoids
     reading newMessagesCount in deps and self-retriggering); empty
     baseline + first-non-empty data → silent re-baseline (without
     this guard, the very first data tick would falsely count all 50
     messages as "new" on initial load); top-down walk with
     early-break to count new arrivals; "walked-to-end without finding
     any known id" → silent re-baseline (without this, a long polling
     gap that rotated the entire 50-row window would falsely pop a
     "50 new messages" pill); on real new arrivals, ALWAYS advance the
     baseline (prevents double-counting on the next data tick) and
     only increment the pill count when `!isAtTop`.
   - **Scroll listener useEffect** on `[tab]` (re-attaches when the
     scroll container DOM node may have changed via React tree
     reshuffles between tab switches). Uses `{ passive: true }` to
     avoid jank. Threshold `scrollTop < 50` (50px tolerance for
     sub-pixel scroll states / inertia). On reaching top, auto-
     dismisses the pill — avoids the surreal "user is looking at the
     top of the inbox, sees the new emails right there, pill still
     says '5 new messages' pointing where they already are."
   - **`handleScrollToTop` useCallback** (`[]` deps): smooth scroll
     via `scrollTo({ top: 0, behavior: "smooth" })` with a try/catch
     fallback to `scrollTop = 0` for old browsers, then
     `setNewMessagesCount(0)`. **Zero `invalidateQueries` /
     `refetchQueries` / `.refetch()`** in the body — that's the
     user-flagged click-without-refetch contract.

3. The scroll container at line ~4871 gets `ref={inboxScrollRef}` added
   inline. Inside the container, as the first child (above the tab-
   conditional render branches), the pill JSX:
   - Wrapper: `sticky top-2 z-20 flex justify-center pointer-events-none`
     with `aria-live="polite" aria-atomic="true"` (the architect-flagged
     a11y contract — count changes get announced to screen readers).
     `pointer-events-none` on the wrapper so the empty horizontal space
     flanking the pill doesn't intercept row clicks underneath.
   - Inner button: `pointer-events-auto` (re-enables clickability on
     just the visible pill area), pill-shaped (`rounded-full`),
     primary-colored, with hover state and a fade+slide-in animation.
     Render-gated by `tab === "inbox" && newMessagesCount > 0 && !isAtTop`.
   - `<ArrowUp aria-hidden="true" focusable="false" />` — purely
     decorative, the visible "1 new message" / "X new messages" text
     is the accessible name. Without `aria-hidden`, screen readers
     would double-announce the icon alongside the text.
   - Text: `{count === 1 ? "1 new message" : `${count} new messages`}`.
     Singular/plural is exact per the user spec — no "X new messages"
     literal substitution.
   - Three `data-testid`s: `pill-new-messages` (wrapper),
     `button-pill-scroll-top` (inner button),
     `text-pill-new-messages-count` (count span).
   - z-20 layers above the existing sticky bulk-action toolbar (z-10 at
     line ~5048) so both can coexist on the rare occasions both
     conditions hold (user has selected messages AND new mail just
     arrived).

**`tests/new-messages-pill.test.js`** (new, 20 source-grep assertions
in two groups). Same shape as `tests/foreground-polling.test.js` from
Commit 5: read the source, regex-assert each invariant, exit 1 on any
fail. Group A (13 assertions) covers detection / state / lifecycle:
state primitives declared, viewKey shape, view-change reset branch,
both silent re-baseline guards (empty baseline + walked-to-end), top-
down early-break loop, baseline-advance + !isAtTop gate on increment,
scrollTop < 50 threshold, auto-dismiss-on-reach-top, passive scroll
listener with [tab] in deps, smooth-scroll click handler with
try/catch fallback, click handler does NOT call invalidate/refetch,
detection sourced from `inboxQuery.data?.messages`. Group B (7
assertions) covers render/UI: render gate, singular/plural text
formatting, ArrowUp imported AND rendered with `aria-hidden`, three
data-testids, sticky+z-20+pointer-events-none tokens (any order; not
class-string-position-coupled), pointer-events split between wrapper
and inner button, ref attached to scroll container.

Per-architect-review test relaxations (so innocent reformatting won't
fail the test): A12 accepts ANY useCallback deps array shape (not just
`[]`); B3 doesn't pin the exact icon size class; B5 checks for
sticky/top-2/z-20/pointer-events-none as independent tokens in any
order rather than a fixed class string. Behavior invariants preserved.

### Why source-grep instead of HTTP / Vitest (continued from Commit 5)
Same rationale as Commit 5:
- HTTP path requires a valid admin session cookie; test credentials in
  this repo are drifted (5 legacy test workflows still failing for
  login-403 — pre-existing, out of scope, documented in Operational
  follow-ups).
- The actual regression we're guarding against is a SOURCE EDIT to
  this exact JSX/state block. Source-grep catches it with zero
  dependencies, zero env setup, zero runtime cost.
- End-to-end behavior verified manually in `.dev` per the user-facing
  verification list below.

### Race-condition analysis (architect-reviewed)
1. **Pill detection vs polling fetch**: detection useEffect closes over
   `inboxQuery.data?.messages` and lists it in deps, so it fires AFTER
   react-query has updated its cache from a fetch. Detection naturally
   serializes after the local-mirror update. No race.
2. **Consecutive polling ticks**: baseline (`lastSeenInboxIdsRef`)
   advances on the same tick we increment the pill count, so the next
   tick sees the new ids as "known" and doesn't re-count. No double-
   counting.
3. **Long polling gap rotates the 50-row window**: walked-to-end guard
   silently re-baselines without popping a misleading "50 new messages"
   pill. Confirmed correct by architect review.
4. **Rapid view switches**: viewKey check fires first, baseline is
   reset before any counting happens. No phantom pill on tab/search/
   account swap.
5. **Pagination interaction**: the inboxQuery returns the FIRST page
   only (50 newest). Load-more appends to a separate `inboxExtra`
   array (line ~3964) that detection does NOT watch. Top-of-list
   newest-first detection is unaffected by pagination state.
6. **Click during in-flight polling tick**: click sets count to 0
   immediately. If a polling tick lands new messages right after the
   click, the next detection effect tick sees those messages as not in
   `lastSeenInboxIdsRef`, advances the baseline, and (if user is now
   at top from the smooth-scroll) silently absorbs them; otherwise
   pops a fresh pill. Both are correct user-perceived behavior.

### Architect review verdict
PASS with two minor follow-ups, both applied in-line:
- A11y patch: `aria-live="polite" aria-atomic="true"` on the pill
  wrapper, `aria-hidden="true" focusable="false"` on the ArrowUp icon.
- Three test-assertion relaxations (A12, B3, B5) so syntax-level
  reformatting can't break the test without a behavior change.

### User-facing verification list (per user direction — STOP after Commit 6)
Verify these in `.dev` before approving Commit 7:
1. Open the inbox tab. Scroll down past the first ~5 messages. Wait
   for new mail to arrive (use the Commit 5 15s tick — send yourself
   an email from a different account and wait up to ~30s). Pill
   should appear at the top of the visible scroll viewport with text
   "1 new message" (singular).
2. Send 2-3 more messages quickly. Pill count should increment to
   "3 new messages" (plural).
3. Click the pill. List should smooth-scroll to the top, the pill
   should disappear, and the new messages should be visible at the
   top of the list. Open the network panel and confirm NO `/api/gmail/
   messages?...` request fires from the click — the new mail was
   already in the local mirror.
4. Scroll back down. Pill should NOT reappear (baseline already
   advanced).
5. Switch to the Drafts tab. Pill should disappear (it's inbox-only).
   Switch back to inbox. No pill (baseline silently reset on tab
   switch).
6. Switch accounts (if you have multiple). No pill (baseline silently
   reset on account switch).
7. Type a search query. No pill (baseline silently reset on search
   change). Clear the search. No pill.
8. Repeat #1 but stay scrolled to the top. New mail should just
   appear at the top of the list — no pill (the user is already
   looking at the top, no notification needed).
9. With messages selected (bulk-action toolbar visible at the top),
   trigger fresh mail from a different account. Both the bulk-action
   toolbar AND the pill should be visible — pill stacks ABOVE the
   toolbar (z-20 vs z-10).
10. Screen-reader spot check: with VoiceOver / NVDA enabled, when the
    pill appears the count should be announced ("1 new message" or
    "3 new messages") via the `aria-live="polite"` region. The arrow
    icon should NOT be announced separately.

### Done definition (Commit 6)
- [x] T001: read existing inbox scroll/sticky patterns (line 4731
  scroll container, line 5048 bulk-action toolbar, line 3404
  inboxQuery declaration).
- [x] T002: pill state + detection useEffect + scroll listener
  useEffect implemented; functional setState used in view-reset
  branch to keep newMessagesCount out of deps.
- [x] T003: ref attached to scroll container, pill JSX inserted as
  first child with sticky positioning + a11y attributes + click
  handler.
- [x] T004: source-grep test (`tests/new-messages-pill.test.js`),
  20/20 passing. Three assertions de-brittled per architect review.
- [x] T005: architect review with `includeGitDiff=true`, verdict
  PASS, two minor follow-ups applied (a11y patch + test relaxations).
- [x] T006: this entry.
- [x] App workflow running healthy; Vite HMR processed all edits.
- [x] Existing test suites still pass (`tests/source-default.test.js`
  9/9, `tests/foreground-polling.test.js` 23/23). The 5 legacy test
  workflows are still failing for login-403 — pre-existing, no
  regression introduced by Commit 6, documented in Operational
  follow-ups (unchanged from Commit 5).
- [x] Typecheck baseline unchanged at 278 errors. The only error in
  `gmail-inbox.tsx` is the pre-existing TS2802 at line 4100
  (`[...new Set(...)]` spread, unrelated to Commit 6).
- STOP. Wait for user `.dev` verification before starting Commit 7.

### Operational items unchanged (still pending, NOT for Commit 6)
- Pub/Sub push delivery in dev — still broken, still relies on the
  Commit 5 polling fallback as the actual safety net. Already
  documented in the Post-Publish section.
- Test credential drift — same 5 legacy test workflows still failing
  with login-403, no change. Already documented in Operational
  follow-ups + Commit 5 entry.
- TS2802 `[...new Set(...)]` at line 4100 — pre-existing,
  not in scope for any open commit.

---

## Unified Inbox — Commit 5 of 8: Foreground 15s polling fallback for incremental Gmail sync (Complete, 2026-04-28)

### Why this exists
The dev environment (Replit container) puts the long-lived Pub/Sub
listener to sleep, so push delivery is unreliable in `.dev`. Without push,
new mail only lands when the backend hourly tick runs `runIncrementalForAll`
— fine for backups, terrible for a user staring at their inbox waiting
for "where's my email?". Commit 5 adds a foreground-only, per-account 15s
polling fallback that calls the existing incremental-sync endpoint while
the user is on the inbox page and the tab is visible. Layered on top of
the existing 15s `inboxQuery` refetch (which re-reads the local DB
mirror) and the 30s `accountsHealthQuery` refetch.

The diagnostic confirming push is broken in dev (and therefore that this
fallback is the actual safety net, not a redundancy) is captured in the
Post-Publish "Pub/Sub push delivery" follow-up section above.

### What changed (one frontend hook + one backend SQL hardening + one diagnostic + one test)

**`client/src/pages/gmail-inbox.tsx`** (~+115 lines, single new
`useEffect` block placed just after `accountsHealthQuery` / `healthById`):
A 15s `setInterval` tick that, for each account in
`accountsHealthQuery.data`, decides independently whether to POST
`/api/gmail/sync-incremental?accountId=N`. Five gates must all hold:
1. `document.visibilityState === "visible"` (don't poll a hidden tab).
2. `account.authStatus === "active"` (skip revoked/expired auth).
3. `account.syncEnabled !== false` (respect deliberate pauses).
4. `now - max(lastWebhookAt, lastIncrementalSyncAt) > 60s` (staleness
   threshold).
5. `now - lastPolledByThisHook > 15s` AND not currently in-flight
   (per-account cooldown + double-fire guard, both via `useRef`-held
   `Map<id, ts>` and `Set<id>`).

Note on `watchExpirationAt`: an early draft skipped polling when the
account's watch was expired or null. **That gate was removed in the same
commit** after architect review pointed out it's semantically backwards
— watch state governs PUSH delivery, not the history-API polling path
that `syncIncremental` uses. Expired/null watch is precisely WHEN polling
matters most (push is dead → polling is the only path). The test file
includes an explicit anti-regression assertion to prevent the broken
gate from being reintroduced.

The hook reads from a `healthDataRef` (kept in sync via a tiny
`useEffect` that just writes `accountsHealthQuery.data` into the ref).
This avoids both stale-closure bugs (empty-deps interval) AND extra
network round-trips (no separate fetch — uses the data the existing 30s
health query already pulls). On a successful sync that actually changed
something (`r.added > 0 || r.deleted > 0 || r.labelsChanged > 0`), the
hook invalidates `["/api/gmail/messages"]`, `["/api/gmail/threads"]`, and
`["/api/gmail/accounts","health"]` — TanStack Query v5's prefix matching
ensures all the per-folder + per-account subkeys (e.g.
`["/api/gmail/messages","inbox",searchQuery,activeAccountId]`) are
covered. Cleanup on unmount: `clearInterval` + `removeEventListener`.

There's also a `visibilitychange` listener so coming back to the tab
after a blur runs an immediate tick instead of waiting up to 15s — the
most common "show me new mail" moment.

**Endpoint reuse, no new route**: the original session plan (T002) was to
add `POST /api/gmail/accounts/:id/poll-now`. On inspection it collapsed
to zero new code: `POST /api/gmail/sync-incremental?accountId=N`
(`server/routes.ts:11119`) already does exactly the same thing
(`requireAuth` + `requireOwnerOrAdmin` + call `syncIncremental`). The
critical detail is `requireOwnerOrAdmin`'s `isOwner` check is
`acct.userId === userId` (NOT `&& !isShared`), so it correctly passes for
the original creator (trevor, userId 4) even on accounts marked shared
via the post-Commit-4.1 data correction (92 + 93). The test file pins
this contract: it asserts the existing endpoint stays registered AND
that no redundant `/poll-now` route was added.

**`server/services/gmail-incremental.ts`** (architect-flagged hardening
nit — atomic-update for concurrency): the final `UPDATE email_accounts`
that persists `lastHistoryId` + `incrementalEventCount` previously wrote
both from the stale account snapshot read at the top of the function.
With the new 15s tick, the chance of two concurrent `syncIncremental`
calls for the same account (foreground tick + backend hourly tick + push
event collision) goes up, and a "last writer wins" race could (a)
regress `lastHistoryId` when the slower run finishes second, causing
redundant re-fetches (NOT data loss — `upsertMessageById`'s
`onConflictDoNothing` absorbs the dups), or (b) lose the slower run's
counter increment. Both fixed in-place:
```diff
-  lastHistoryId: endHistoryId,
+  lastHistoryId: sql`GREATEST(${emailAccounts.lastHistoryId}::bigint, ${endHistoryId}::bigint)::text`,
   lastIncrementalSyncAt: new Date(),
-  incrementalEventCount: (account.incrementalEventCount ?? 0) + events,
+  incrementalEventCount: sql`COALESCE(${emailAccounts.incrementalEventCount}, 0) + ${events}`,
```
- `GREATEST(...::bigint)::text` — Gmail history IDs are numeric strings;
  the bigint cast avoids lexicographic comparison breaking when ids cross
  digit-count boundaries (e.g. 9 → 10 digits). PostgreSQL's `GREATEST`
  ignores NULLs unless all args are NULL; the seed branch above already
  handles the all-null case via `captureProfileHistoryId`, so by the
  time we reach this UPDATE both args are non-null.
- `COALESCE(col, 0) + events` — atomic SQL increment, concurrent-safe.

No schema change, no migration. Just SQL semantics inside the existing
UPDATE.

**`scripts/pubsub-diagnostic.ts`** (NEW, ~150 lines): one-off diagnostic
that snapshots `last_webhook_at` for accounts 1/92/93, sends two test
emails as trevor (`trevor → support`, `trevor → sales`, uniquely tagged
subject `[pubsub-diag {ISO}]`), polls every 5s for up to 90s watching
each account's webhook timestamp, then reports per-account: did the
webhook fire? did the message land in the local mirror? Includes
interpretation guidance in the script itself. Result of the 2026-04-28
run is captured in the Post-Publish Pub/Sub follow-up entry. Left in
the repo as a written record; re-run after first publish to confirm
push works in production.

**`tests/foreground-polling.test.js`** (NEW, 23 source-grep assertions):
splits into Group A (server endpoint exists, still uses `requireAuth` +
`requireOwnerOrAdmin` + `syncIncremental`, no redundant `/poll-now`
added) and Group B (frontend has all 5 gates, the 15s/60s/15s constants,
the in-flight + cooldown refs, the visibilitychange wake-up, the
healthDataRef indirection, the cache invalidations, the cleanup, AND
the explicit anti-regression for the watchExpirationAt gate that was
removed). Same source-grep philosophy as `tests/source-default.test.js`
(documented in Commit 4.1 entry below): the test guards against a
SOURCE EDIT regression at zero runtime cost, with zero environment
setup, runs in any context including CI without DB or network. The
HTTP behaviour is verified manually in `.dev` per the user-facing
checklist below.

Run: `node tests/foreground-polling.test.js`. No DB writes, no fixture
rows, no schema changes.

### Architect verdict (2026-04-28, `includeGitDiff=true`)
PASS-WITH-NITS, zero critical issues. Two nits, both fixed in the same
commit:
1. Concurrency in `syncIncremental`'s UPDATE — fixed via the
   `GREATEST` + atomic-counter SQL change above.
2. `watchExpirationAt` skip semantically backwards — gate removed,
   anti-regression assertion pinned in the test.

### What this commit deliberately does NOT do
- **No schema changes** (project standing rule).
- **No new endpoints** (T002 collapsed to zero new code; the existing
  `/api/gmail/sync-incremental` does the job).
- **No backend cron change**. The existing hourly `runIncrementalForAll`
  remains as-is. The new 15s tick is additive, not a replacement.
- **No fix to push-in-dev**. The diagnostic confirmed push is broken in
  dev for ALL three accounts including freshly-watched ones; that's
  documented as a deferred post-publish item, not a Commit 5 task.
- **No retroactive sync of the pubsub-diagnostic test emails into the
  local mirror**. They'll land naturally on the first foreground tick
  the next time trevor opens `.dev` (both 92 and 93 have null
  `lastWebhookAt`/`lastIncrementalSyncAt`, so they're infinitely stale
  → polling fires on the very first tick).

### Done definition (Commit 5)
- `client/src/pages/gmail-inbox.tsx` — one `useEffect` block + one
  `useRef`-tracking sibling effect, ~+115 lines net.
- `server/services/gmail-incremental.ts` — final UPDATE switched to
  atomic SQL (GREATEST + COALESCE-add), ~+30 lines net (mostly comments).
- `scripts/pubsub-diagnostic.ts` — NEW, ~150 lines.
- `tests/foreground-polling.test.js` — NEW, 23/23 passing.
- `tests/source-default.test.js` — still 9/9 passing (no regression).
- App workflow restarted; server boots clean (migrations, scheduler,
  Express on :5000, browser HMR'd). No SQL syntax errors from the
  GREATEST/CAS change.
- replit.md updated: this entry + the diagnostic-result capture in the
  Post-Publish Pub/Sub follow-up + the "resolved by Commit 5" note in
  the Commit 4.1 operational-caveat section.

### User-facing verification list (per user direction — STOP after Commit 5)
Verify these in `.dev` before approving Commit 6:
1. Open the Gmail inbox tab. Within ~15s of arriving, support@ and
   sales@ should populate (their `lastWebhookAt`/`lastIncrementalSyncAt`
   are both NULL → infinitely stale → polling fires immediately).
2. The two `[pubsub-diag ...]` test emails sent during the diagnostic
   should appear in support@ and sales@ inboxes shortly after.
3. Send yourself a fresh email from any other inbox to one of the three
   mailboxes. It should appear in the corresponding inbox view within
   ~15s WITHOUT requiring a manual refresh.
4. Switch to a different browser tab for >15s. New mail should NOT
   trigger sync (visibility gate). Switch back — sync should fire
   immediately on the visibilitychange event.
5. Verify the polling does not double-fire: open the network panel,
   wait 30s on the inbox page, count POSTs to
   `/api/gmail/sync-incremental` per account — at most 2 per account
   per 30s (the 15s cooldown).

### Operational items unchanged (still pending, NOT for Commit 5)
- 5 legacy test workflows (`mail-permissions`, `mailbox-switching`,
  `permissions`, `tracking-multi-proof`, `tracking-proof`) continue to
  fail with login-403 due to drifted admin test credentials. Re-checked
  at end of Commit 5 — still failing for the same reason, no change.
  Already documented in the Post-Publish section + in the Commit 4.1
  test rationale (line ~208 above). Out of scope until a dedicated
  test-credential refresh pass.
- Push-delivery in dev — still broken (architecturally, see Pub/Sub
  follow-up above). Polling fallback is the live answer until first
  publish to `.replit.app`.

---

## Unified Inbox — Commit 4.1 amendment: Flip server source default to "local" (Complete, 2026-04-28)

### Why this exists
Commit 4 removed `params.set("source", mailSource)` from the frontend (correct
intent — kill the toggle), but the matching server-side defaults were left at
`|| "gmail"`. End result: every list request silently bypassed the local
mirror and round-tripped to Gmail's REST API. Invisible for trevor (his
mirror is always fresh; the live result looked identical), catastrophic for
shared mailboxes — sales/support showed only the live recent-N slice instead
of their historical local archive, which the user perceived as
"sales is showing trevor's emails" (in fact: sales' live inbox is dominated
by internal CC'd threads where trevor is the visible participant, while the
2,615 marine-industry rows that distinguish sales' real character live in
the local mirror that the route had stopped reading).

The diagnostic for this regression is captured in chat history (2026-04-28).
The audit-gap that allowed this to slip past Commit 4's review is documented
in the Post-Publish section above ("Process note: audit-gap lesson learned").

### What changed (3 single-line server edits + 1 new test)

**`server/routes.ts:7916`** (`/api/gmail/messages`):
```diff
- const source = ((req.query.source as string) || "gmail").toLowerCase();
+ const source = ((req.query.source as string) || "local").toLowerCase();
```

**`server/routes.ts:8124`** (`/api/gmail/threads` — thread list):
```diff
- const source = ((req.query.source as string) || "gmail").toLowerCase();
+ const source = ((req.query.source as string) || "local").toLowerCase();
```

**`server/routes.ts:8195`** (`/api/gmail/threads/:id` — single-thread fetch):
```diff
- const source = ((req.query.source as string) || "gmail").toLowerCase();
+ const source = ((req.query.source as string) || "local").toLowerCase();
```

(Note: my original diagnostic mis-labeled the third endpoint as
`/api/gmail/sent`. There is no `/api/gmail/sent` route — the sent view is
served by `/api/gmail/messages` with `q=in:sent`, so it's covered by the
first edit. The third line is `/api/gmail/threads/:id`, which was hit
once-per-thread-click and had the same regression.)

Comment block on the first edit explains the backstory; the other two refer
back to it. Explicit `?source=gmail` is still honoured by every endpoint —
this is purely a default flip, not a removal of the override capability.

**NEW `tests/source-default.test.js`** (~130 lines): pure source-grep
regression test against `server/routes.ts`, no HTTP, no DB, no auth, no
env vars. Pins the wiring with nine assertions (currently 9/9 PASS):
1. routes.ts is readable.
2. ZERO occurrences of `(req.query.source as string) || "gmail"` remain
   anywhere in routes.ts. This is the strongest guard — re-introducing
   the regressed pattern on ANY new or existing list route fails the
   test immediately.
3. EXACTLY THREE occurrences of `(req.query.source as string) || "local"`
   exist. Drift from 3 means either we lost one (regression) or someone
   added a new list route without thinking about the default — fail
   loud and force a re-read of this entry.
4–6. Each of the three named routes (`/api/gmail/messages`,
   `/api/gmail/threads`, `/api/gmail/threads/:id`) is still registered.
7–9. Each `|| "local"` line sits within 12 source-lines downstream of
   an `if (!resolved)` guard — sanity-check that the default flip
   didn't accidentally land in some unrelated code path with a
   structurally similar query-param read.

Why source-grep instead of HTTP: an earlier draft hit the routes over
HTTP and asserted `X-Mail-Source` headers. It required a valid admin
session cookie, and the test credentials in this repo have drifted
(all five legacy test workflows currently fail with login-403 for the
same reason). A source-grep catches the actual regression we're guarding
against — a source-code edit — at zero runtime cost, with zero
environment setup, and runs in any context including CI without DB or
network access. The HTTP behaviour is verified manually in `.dev` per
the user-facing checklist below.

Run: `node tests/source-default.test.js`. No DB writes, no fixture rows,
no schema changes.

### Deliberately deferred to a separate cleanup pass (NOT Commit 5)
Two items the diagnostic flagged that were intentionally NOT bundled into
4.1, per user direction. Land separately once 4.1 is verified in `.dev`:
- **Drop the `source === "auto"` branch** in `/api/gmail/messages` (lines
  ~8071–8079) and the `source === "auto"` Gmail-failure fallback (~8093).
  The toggle that produced "auto" is gone; the branch is dead code today.
- **Strip the `source` query param from the public API surface entirely**.
  Currently it's a reserved escape hatch for internal probes. If we keep
  it, document it as such; if we don't need it, remove it everywhere
  including the three new comment blocks.

Do NOT do either of these until Commit 4.1 has been observed in production
behaviour for at least one cycle. The `source === "gmail"` branch is the
documented escape hatch right now — removing it before we're sure no
internal tooling depends on it would be a worse regression than the one
we're fixing.

### Operational caveat (visible in `.dev` immediately after this commit)
Sales' `email_accounts.last_sync_at IS NULL` even though the local mirror
has 2,615 inbox rows for it (likely populated by the
`Attachment backfill` / `HTML backfill` workflows, which insert without
touching `last_sync_at`). After 4.1 lands, the sales inbox will correctly
show its 2,615 historical marine-industry emails — but the ~6 most recent
live messages from today will be missing until the regular sync fires for
sales. Either trigger a one-shot full sync for accounts 92 and 93 from the
Mailbox admin page, or wait for the polling fallback in Commit 5 to close
the gap. This is operational, not a code issue.

**Resolved by Commit 5 (2026-04-28)**: support@ and sales@ both have
`lastWebhookAt IS NULL` AND `lastIncrementalSyncAt IS NULL` → infinitely
stale by the polling hook's gate, so the foreground 15s tick fires on the
very first iteration the moment trevor opens the inbox in `.dev`. The
`pubsub-diagnostic` test emails (gmail msg ids `19dd1a8a1ce0e709` +
`19dd1a8a3ee953b1`) will appear within ~5–15s of opening the page on
either mailbox. That's the live demonstration of the safety net.

### Done definition (4.1)
- 3 route edits applied; comments in code reference Commit 4.1 for traceability.
- `tests/source-default.test.js` passes (9/9).
- replit.md updated with this entry + the orphan-rows note + the audit-gap
  lesson learned (above, in Post-Publish section).
- App workflow restarted; `/api/gmail/messages?limit=1` returns
  `X-Mail-Source: local` for trevor's session.
- User-facing verification list (per user direction):
  1. Click sales@voltsafe.com → see sales' marine-industry mail.
  2. Click support@voltsafe.com → see support's content.
  3. Click trevor@voltsafe.com → see trevor's content unchanged.
  4. Scroll deep → historical local-mirror data, not just live recent-N.
  5. Toggle between accounts → each transition shows the correct content.

---

## Unified Inbox — Commit 4 of 8: Remove mailSource toggle + multi-account bulk fan-out (Complete, 2026-04-27)

### Goal
Two paired cleanups that together finish the "everything is the local mirror"
story Commit 1.1 started:
1. **UI cleanup** — delete every surface that lets the user (or a URL) choose
   between live Gmail and the local mirror. The local mirror is the only
   source going forward; anything else is dead weight that fragments the
   query cache and confuses operators.
2. **Multi-account bulk fan-out** — the carry-over flagged in Commit 3.
   `bulk-mark-read` and `bulk-archive` were silently funneling
   `asAccountId === "all"` through `Number()` → NaN → personal account, so
   cross-account row selections in unified mode failed without explanation.
   Now they group by `email_messages.source_account_id` and dispatch one
   Gmail client per account.

### What changed

**NEW `server/services/bulk-account-router.ts`** (~187 lines, pure SELECT):
- `groupMessageIdsByAccount(gmailMessageIds, accessibleAccountIds)` — looks
  up each ID's `source_account_id` in `email_messages`, buckets known IDs
  by account, drops IDs whose account isn't in the accessible set into
  `forbiddenIds`, drops IDs with no local row into `unknownIds`. Dedupes.
  Returns `{ byAccount: Map<number, string[]>, unknownIds, forbiddenIds }`.
- `groupThreadIdsByAccount(gmailThreadIds, accessibleAccountIds)` — same
  shape but queries by `gmail_thread_id` (DISTINCT to handle multi-message
  threads). Gmail thread IDs are per-mailbox so each thread maps to exactly
  one account.
- Side-effect-free. Caller decides what to do with the buckets.

**`/api/gmail/bulk-mark-read` (`server/routes.ts:9684`)** — added an
`if (rawAcc === "all")` branch BEFORE the existing single-account path:
- `getAccessibleAccountIds(userId, isAdmin, mailTeamPerms)` for view scope.
- Inline edit-access filter per account: owner OR admin OR
  `mailTeamPerms[id].edit === true`. View-only accounts demoted to
  forbidden, NOT a request-level 403.
- Empty editable set → 403 with `{ message, success: 0, failed: N }`.
- For each `[accountId, ids]` bucket: one `getGmailClient`, one Gmail
  modify per ID, then per-account `mirrorLabelChangeForMessages` over the
  succeededIds. `getGmailClient` failure (token expired, account inactive)
  counts every ID in that bucket as failed and continues to the next
  account — does NOT poison the rest of the request.
- Response: backwards-compatible `{ success, failed }` PLUS optional
  `failedNoPermission` (= forbidden bucket size), `failedNotFound`
  (= unknown bucket size), and `perAccount` map for observability.
- Single-account path preserved: `numAcc = (rawAcc != null && rawAcc !== "all") ? Number(rawAcc) : undefined`
  prevents the NaN coercion when `asAccountId` is the string "all".

**`/api/gmail/bulk-archive` (`server/routes.ts:9860`)** — mirror image of
the above but uses `groupThreadIdsByAccount` +
`mirrorLabelChangeForThreads`. Same per-account dispatch, same aggregation
shape, same single-account preservation.

**`client/src/pages/gmail-inbox.tsx`** — full mailSource removal:
- Deleted state: `mailSource`, `setMailSource`, `savedMailSource`,
  `setSavedMailSource`. (Pre-Commit-4: a 3-way `"local" | "gmail" | "auto"`
  picker initialized from a URL param, then localStorage, then default
  "local".)
- Deleted from query keys: 3 `useQuery` keyArrays + 6 `setQueryData` keys
  collapsed from 5-tuples (`["...", tab, q, acct, mailSource]`) to
  4-tuples (`["...", tab, q, acct]`). Threads from 4-tuple to 3-tuple.
- Deleted from request URLs: 5 call sites of `params.set("source", mailSource)`
  removed (inbox query, sent query, thread query, loadMoreInbox, loadMoreSent).
- Deleted from effect deps: 3 useEffects + `inboxEpochRef`/`sentEpochRef`
  triggers + `ctxKey` strings + `inboxChainKey` no longer mention mailSource.
- Collapsed conditional refetch intervals: `mailSource === "local" ? 15_000 : 30_000`
  → fixed `15_000` (inbox) / `30_000` (sent) — the local mirror is always
  cheap to poll.
- Deleted the in-sentinel switch CTAs: the `localShortfall` /
  `archiveShortfall` branches and their two `<button>` toggles
  (`button-switch-to-gmail`, `button-switch-to-local`) are gone. The
  "all caught up" sentinel is now a single quiet status line; any
  shortfall is a backfill issue and shows up in Mailbox Health instead.
- Deleted source-toggle remnants in account row clicks (the
  "save/restore mailSource around All Inboxes" dance is no longer needed
  since there's no preference to preserve).
- **One-shot cleanup useEffect on mount**: `localStorage.removeItem("voltsafe.mailSource")`
  PLUS defensive `queryClient.removeQueries({ predicate })` that drops any
  cached entry whose key still has the legacy 5-tuple shape (5th segment
  in `{"local","gmail","auto"}`). Keeps the post-deploy cache from leaking
  stale rows on first load.
- **NEW** "synced N min ago" footer line at ~4399: replaced
  `Synced HH:MM` (`toLocaleTimeString`) with
  `formatDistanceToNow(new Date(connectedAccount.lastSyncAt), { addSuffix: true })`.
  Sourced from the server's `email_accounts.last_sync_at` (already in
  `accountsQuery`'s 30s poll), so no separate ticker is needed.

**`client/src/pages/mailbox-settings.tsx`**:
- Deleted the `MailPreferencesCard` component (~80 lines: localStorage-
  backed `<Select>` of "Gmail / Local / Auto" with description copy) AND
  its `<MailPreferencesCard />` invocation in the page body.
- Stub comment left in place explaining the deletion — the localStorage
  cleanup happens in `gmail-inbox.tsx`'s mount effect (single source of
  truth), so this page no longer needs to know about the legacy key.

**NEW `scripts/test-bulk-fanout.ts`** — read-only self-test for the
grouping helpers. Result: **29/29 PASS** (multi-account dispatch case
SKIPS in dev because the dev DB only has 1 account with messages —
correctly distinguished from a fail). Coverage:
- Empty input invariants (both helpers, both ID types, empty accessible).
- Unknown IDs (3 fake msg + 2 fake thread → all in `unknownIds`,
  `byAccount` empty).
- Known IDs route to the correct source account.
- Forbidden: known IDs whose account isn't in caller's set → `forbiddenIds`.
- Multi-account dispatch (when 2+ accounts available): mixed input splits
  into the right buckets; partial-access drops the inaccessible bucket
  into forbidden.
- Duplicate input dedupes to one bucket entry.
- Conservation invariant: every input ID lands in exactly one of
  `byAccount` ∪ `unknownIds` ∪ `forbiddenIds` (no drops, no double-counts).

### Validation
- `scripts/test-bulk-fanout.ts`: 29/29 PASS, 0 fail.
- `Start application` workflow: running, HMR clean after the leftover
  `savedMailSource` ref was deleted (line 4298 was missed in the first
  pass — `mailSource is not defined` ReferenceError surfaced in the
  browser console; fixed; no further runtime errors).
- `/api/gmail/messages` continues to return 200/304.
- Confirmed: **no schema changes**, **no migrations**. Pure read-side
  routing helper + UI/route deletions.

### Architect review
Triggered async at end of session — fix any blocking notes inline.

### Files touched
- `server/services/bulk-account-router.ts` (NEW — 187 lines, SELECT-only)
- `server/routes.ts` (+~120 lines for two `if (rawAcc === "all")` branches
  and `numAcc` coercion guard)
- `client/src/pages/gmail-inbox.tsx` (~−180 lines net: state + 5 source
  params + 9 5-tuple keys + 2 CTA branches + savedMailSource dance, +
  cleanup useEffect + relative footer)
- `client/src/pages/mailbox-settings.tsx` (~−80 lines: MailPreferencesCard
  definition + invocation deleted)
- `scripts/test-bulk-fanout.ts` (NEW — 220 lines, 29 assertions)

### Carry-overs for Commit 5
- **Live API probe** of the multi-account fan-out: real cross-account
  bulk-mark-read on 2 test rows from 2 accounts; verify `perAccount`
  counts match. Skipped here for the same reason as Commit 3 (would
  mutate the user's real inbox).
- **Mirror queue** for label changes that arrive while a fan-out is
  in flight (the read-modify-write window is still open per Commit 3
  architect note #5).
- **Surface `failedNoPermission` + `failedNotFound` in the UI toast**
  on bulk action completion — currently only `success` / `failed`
  are read by `bulkMarkReadMutation` / `bulkArchiveMutation`. Worth
  splitting so users see "3 archived, 1 not in your mailboxes"
  instead of just "3 archived, 1 failed".

---

## Unified Inbox — Commit 3 of 8: Inline local mirror for bulk-mark-read & bulk-archive (Complete, 2026-04-27)

### Goal
Eliminate the visual "flash" where bulk-archived or bulk-marked-read emails
briefly reappear with stale labels after the optimistic UI hides them.
Root cause: the bulk endpoints mutated Gmail successfully but never updated
the local `email_messages` rows; the next react-query refetch landed before
the hourly poll / push event had a chance to reconcile. With Commit 1.1's
local-default inbox, the flash was much more obvious — essentially a
regression vs. Gmail-direct.

### What changed

**NEW `server/services/local-label-mirror.ts`:**
- `mirrorLabelChangeForMessages(gmailMessageIds, accountId, op)` — SELECT
  matching rows by `gmail_message_id IN (...)` (account-scoped if
  `accountId` provided), parse current `label_ids` (handles both legacy
  CSV and new JSON formats), apply add/remove ops as a Set, re-serialize
  as JSON, UPDATE per-row by primary key. Returns
  `{updated, missing, errors}`.
- `mirrorLabelChangeForThreads(gmailThreadIds, accountId, op)` — same
  pattern but queries by `gmail_thread_id IN (...)`. Used by bulk-archive
  because Gmail's `users.threads.modify` removes INBOX from EVERY message
  in the thread, so the local mirror has to reach the same set of rows.
- Both follow the inline-mirror pattern shipped Apr 2026 in toggle-star
  (`server/routes.ts:9650-9677`): SELECT → parse → mutate Set → re-serialize
  as JSON → UPDATE by PK. Quote-escaping uses `replace(/'/g, "''")` to match
  toggle-star's `sql.raw` style.

**`/api/gmail/bulk-mark-read` (`server/routes.ts` ~9694):**
- Added `succeededIds: string[]` — only IDs Gmail confirmed get mirrored
  locally. Partial-failure case (5 requested, 3 succeed, 2 fail) → mirror
  updates exactly the 3.
- Replaced bare `} catch { failed++; }` with
  `} catch (e: any) { console.error(\`[bulk-mark-read] gmail modify failed for id=\${messageId}:\`, e.message); failed++; }`
  — this is one of the **two pre-existing 1-line bugs** from the original
  investigation report. The bare catch hid which message failed, making
  partial-failure debugging impossible.
- After Gmail loop completes, invokes
  `mirrorLabelChangeForMessages(succeededIds, resolved.accountId, op)`
  inside a try/catch. Mirror failure is non-fatal (Gmail is source of
  truth, next sync reconciles) but logged loudly with full context
  (user, account, markAs, ids).

**`/api/gmail/bulk-archive` (`server/routes.ts` ~9776):**
- Same `succeededThreadIds[]` pattern.
- Same one-line error-context fix (the second of the two 1-line bugs).
- Calls `mirrorLabelChangeForThreads(succeededThreadIds, resolved.accountId, { remove: ["INBOX"] })`.

### Architect review (evaluate_task, includeGitDiff: true) — Verdict: PASS
1. ✅ Partial-success drift handling correct (succeededIds gating).
2. ✅ Thread-level archive mirroring correct (queries by thread, updates all
   messages in matched threads — matches Gmail's threads.modify semantics).
3. ✅ Per-iteration error context fixes meaningful.
4. ✅ Template alignment with toggle-star faithful (best-effort, non-fatal,
   parse CSV/JSON, re-serialize JSON, update by PK).
5. ⚠ **Race claim slightly overstated** — softened the docstring to be
   honest: this IS a read-modify-write pattern WITHOUT `SELECT ... FOR
   UPDATE`. A push event landing in the SELECT/UPDATE window could lose a
   non-target label change (e.g. push added STARRED, mirror removes UNREAD
   from stale pre-image without STARRED → STARRED dropped). Window is
   single-digit ms, self-healing on next sync. Acceptable for cosmetic
   mirror; if strict consistency needed later, wrap in transaction with
   `FOR UPDATE`.
6. ⚠ **Crosses into Commit 4 scope** (flagged, NOT pulled forward):
   frontend can send `asAccountId: "all"` for bulk endpoints in unified
   mode, which `Number()`-coerces to NaN and routes through the default
   single-account path. True multi-account fan-out (group selected rows by
   `sourceAccountId`, execute per-account Gmail+mirror batches) is a
   Commit 4 task.

### Validation
- 37/37 self-tests PASS (`scripts/test-bulk-mirror.ts`):
  - Parser/serializer round-trip: 14 cases (JSON, CSV, malformed, dedupe,
    add/remove idempotency, combined ops).
  - mark-read on 3 real UNREAD rows: BEFORE/AFTER verified, idempotent
    re-run, snapshot+restore so test is non-destructive.
  - mark-unread on 2 real read rows.
  - missing-id case: updated=0, missing=2, no errors.
  - account scoping: wrong account doesn't touch the row.
  - thread archive: 6-message thread, all 6 lose INBOX, threads=1, idempotent.
  - missing-thread case: updated=0, missing=2, no errors.
- App running healthy, `/api/gmail/messages` serving 304s through
  Commit 1.1+2 paths.

### Live API probe — INTENTIONALLY SKIPPED
Spec asked for one (mark-read 3 real messages, verify DB; archive 2 real
threads, verify DB), but bulk-mark-read and bulk-archive against the real
Gmail account would actually mark the user's production inbox messages as
read and archive their threads. The service-layer harness already covers
the persistence logic against real DB rows non-destructively (37/37 PASS).
User to validate end-to-end in .dev with real UI clicks on test emails
(same workflow as Commits 1.1 and 2 verification).

### Files touched
- `server/services/local-label-mirror.ts` (NEW — 175 lines)
- `server/routes.ts` (bulk-mark-read & bulk-archive: succeededIds tracking,
  per-iteration logging, inline mirror invocation)
- `scripts/test-bulk-mirror.ts` (NEW — 7-test self-test harness, snapshot+restore)

### Carry-overs for Commit 4
- True multi-account bulk routing when `asAccountId === "all"` (group by
  `sourceAccountId`, fan out).
- Optional: integration test for unified-mode bulk action payloads.

---

## Unified Inbox — Commit 2 of 8: Auto-overflow to Gmail when local exhausted (Complete, 2026-04-27)

### Goal
The local archive holds ~55K rows but doesn't reach all the way back to the
beginning of time. When a user keysets to the bottom of their local mailbox,
they used to just see "no more messages" — now we transparently fetch older
messages from Gmail, persist them, and stitch the cursor so pagination keeps
flowing seamlessly.

### What changed

**Extended `server/services/local-mailbox.ts`:**
- `listLocalMessages` return value now additively carries `localExhausted`,
  `oldestLocalSentAt`, `oldestLocalPk` so the route knows when (and from
  where) to overflow.
- New exported helper `encodeMsgCursorToken(sentAtIso, pk)` so the route can
  mint fresh keyset tokens pointing at backfilled rows.
- All Commit 1.1 keyset tests still pass — purely additive.

**`server/services/gmail-incremental.ts`:**
- Exported the previously-private `upsertMessageById` so the new backfill
  service can reuse the same single-message persistence path that incremental
  sync uses. Avoids a second insert codepath drifting from the canonical one.

**NEW `server/services/gmail-history-backfill.ts`:**
- `fetchOlderFromGmail(account, before, limit)` — Gmail `messages.list` with
  `q='in:inbox OR in:sent before:<unix-seconds>'` (widened from spec's
  `in:inbox` to match unified-inbox semantics: local archive contains both
  directions, so backfill must too). Concurrency cap of 5 in-flight detail
  fetches, 429 retry honoring `Retry-After` (max 3 retries, 2s/4s/8s
  exponential fallback), per-account `Map<accountId, Promise>` mutex so two
  concurrent requests for the same account don't double-insert or
  double-debit quota — the follower path returns rows:[] AND
  inserted/skipped/errors zeroed so the route's session counter is only
  charged by the leader.
- Returns `{rows, fetched, inserted, skipped, errors, noMoreHistory, failed,
  failureReason, oldest, tookMs}`.

**`/api/gmail/messages` route (`server/routes.ts` ~line 7960):**
- New auto-overflow branch in `source=local` path. Triggers when ALL of:
  - single account (not unified-mode fan-out — that's a later commit);
  - empty `q` (Gmail's q syntax doesn't 1:1 map our local q-translator;
    blindly backfilling with a different filter would pollute filtered pages);
  - `localExhausted=true` AND short page;
  - per-session backfill count below the soft cap (5,000 inserts).
- Clamps `wantMore` to `min(maxResults - local.length, SOFT_CAP - sofar)`
  so a request near the cap can't overshoot by up to a full page.
- Recomputes `capReached` AFTER the increment so the response reflects
  post-request truth (a request that crosses the cap surfaces the signal
  on THAT response, not the next one).
- Stitches `nextPageToken` via `encodeMsgCursorToken` pointing at the
  oldest backfilled row (or oldest local row if backfill yielded nothing
  new but Gmail isn't end-of-history yet).
- New response flags: `historyLoadFailed`, `endOfHistory`,
  `historyLoadCapReached`. Header `X-Mail-Source: "local+backfill"`.

### Architect review (evaluate_task, includeGitDiff: true)
First pass came back **Fail** with three real bugs — all fixed in this commit:
1. Query corruption: backfill ignored `q`. Fix: gate overflow to empty `q`.
2. Cap math off-by-one: `capReached` computed pre-backfill, used post-backfill.
   Fix: clamp to remaining budget AND recompute after the session counter
   increments.
3. Follower accounting: leader's `inserted` count was preserved on the
   follower's response, double-counting against the cap. Fix: zero
   `inserted/skipped/errors/fetched` on the follower path.

### Validation
- 17/17 Commit 2 tests PASS (`scripts/test-history-backfill.ts`):
  listLocalMessages shape (11), backfill noMoreHistory path (3), in-flight
  de-dupe (3, completes in <200ms).
- All Commit 1.1 keyset tests still PASS — pure additive.
- App running healthy, `/api/gmail/messages` serving 304s through new path.

### Files touched
- `server/services/local-mailbox.ts` (additive return fields + encode helper)
- `server/services/gmail-incremental.ts` (export upsertMessageById)
- `server/services/gmail-history-backfill.ts` (NEW)
- `server/routes.ts` (auto-overflow branch in source=local)
- `scripts/test-history-backfill.ts` (NEW — 3-test self-test harness)

### Deliberate scope punts (tracked for later commits)
- **Unified-mode overflow**: when the user is viewing "all accounts", overflow
  is skipped. Implementing fan-out across N accounts with per-account caps is
  a later commit.
- **q-translation in backfill**: when the user has a non-empty filter, overflow
  is skipped (we serve the local result and emit no cap signal). Plumbing
  the q-translator into the Gmail backfill is a later commit.

---

## Premium "My Calendar" Widget — Replaces Today's Meetings (Complete, 2026-04-27)

### Goal
User asked for "a premium calendar widget that any user can add (their own
calendar)" in place of the existing "Today's Meetings" widget on the role
command center. The old widget read from a daily-command-center aggregate and
just listed today's items with no way to connect a personal calendar.

### What changed
**NEW `client/src/components/widgets/my-calendar-widget.tsx`** — drop-in
replacement that:
- Reads `/api/calendar/integrations` to detect connected providers
  (Google + CalDAV/Apple). Filters to `isActive !== false` so disconnected
  rows don't fake a connection.
- Reads `/api/calendar/events?start=today&end=today+7d`. Polls every 60s
  in foreground, off in background.
- **Empty state** (no calendar connected): friendly card with two buttons —
  "Connect Google Calendar" (kicks off `/api/calendar/integrations/google/
  auth-url` and redirects, mirroring `settings.tsx`'s flow) and "Connect
  Apple / iCloud" (deep-links to `/settings` where the existing CalDAV
  dialog lives). Includes double-click guard.
- **Connected state**:
  - 7-day mini week-strip with event-density dots, today highlighted
  - "Today · {date}" section listing up to 4 events with time chips,
    title, location/video host/attendee count, and live status pills
    ("Now" / "in 12m" / "in 2h")
  - "+ N more today" overflow link to `/execution/calendar`
  - "Tomorrow" preview with up to 2 events (muted styling)
  - Footer: "Open full calendar →" + quick "+ Event" CTA
- Sniffs Zoom/Meet/Teams/Webex/Whereby links from event descriptions when
  no explicit `meetingUrl` is set, so the join-icon still appears.
- Date range computed each render (not memoized) so the week window
  rolls over naturally at midnight in long-lived tabs without restarting
  the query — same calendar day produces the same ISO strings → same
  react-query key → no extra fetches.

**`client/src/components/command-centers/action-widgets.tsx`**:
- Added `import { MyCalendarWidget } from "@/components/widgets/my-calendar-widget";`
- Removed the old `TodaysMeetingsWidget` body (replaced with comment
  pointing to the new file).
- Registry: `todays_meetings: MyCalendarWidget` (intentionally kept the
  same widget id so existing user layouts and visibility prefs continue
  to work without a migration).

**`client/src/lib/dashboard-config.ts`**:
- Renamed widget label "Today's Meetings" → "My Calendar".
- Updated description to match the upgrade.
- Removed `visibility.permKey: "calendar"` requirement so any user can
  add the widget — mirrors the `my_inbox` pattern (every user has their
  own personal calendar).

### What was NOT changed
- Zero schema changes, zero `db:push`, zero migrations. Calendar tables
  and `/api/calendar/*` endpoints already exist and are used as-is.
- No server route changes.
- Per-role `defaultVisible` flags in `dashboard-config.ts` (lines 280-455)
  intentionally left as-is — users opt in via the Widgets panel.
- The full `/execution/calendar` page, the existing settings → calendar
  panel, the Google OAuth callback, and the CalDAV connect flow all
  untouched.

### Validation
- App restarts cleanly, vite hot-reload picked up all four edits, no
  compile errors.
- Architect code review PASS — three minor hardening fixes
  (double-click guard, isActive filter, midnight-rollover-safe date range)
  applied before final commit.

---

## GMAIL Inbox "Only 17 messages" — Surface Local Archive Hint (Complete, 2026-04-27)

### Goal
Fix Trevor's report: "Even though my source is set to GMAIL, the inbox shows
less than 20 messages and scrolling down loads no more." Investigation of his
actual data showed:
- Live Gmail INBOX label: only 17 messages (he archives aggressively).
- Local cache (`email_messages`): **48,437 INBOX-tagged messages going back
  to 2020-01-01** plus 8,221 SENT — synced when those messages were originally
  in INBOX before Trevor archived them.
- With `mailSource=gmail` (default), the inbox correctly shows the 17 live
  messages and Gmail returns no `nextPageToken`, so the UI lands in the
  terminal "all caught up" state with no way to discover the local archive.
- An existing hint already covered the inverse direction (when source=local
  but Gmail has more → "Switch to live Gmail to see the rest"); the
  Gmail→local direction had no equivalent.

### What changed
**`server/routes.ts`** — `/api/gmail/accounts/health` response:
- Added a SELECT-time computed `inbox_count` column (COUNT(*) FILTER on
  email_messages where source_account_id matches AND label_ids LIKE
  '%"INBOX"%') and exposed it as `inboxCount` in the response object. No
  schema column added; no migration. INBOX-only count is required so the new
  hint doesn't false-positive on accounts where SENT/drafts inflate the total.

**`client/src/pages/gmail-inbox.tsx`** — three coordinated UI changes:
1. **Manual Load More resumes the chain** (sentinel CTA): when the
   auto-chain has exhausted its 25-page budget but the user clicks "Load
   more", reset `autoChainRef.current.count = 0` and clear
   `autoChainExhaustedKey` before firing `loadMore()`. One click now resumes
   the chain for another batch of pages instead of fetching just one — useful
   for inboxes with heavy blocked-domain stripping.
2. **CTA copy** rewritten to surface meaningful counts: `{shown} shown ·
   {scanned} scanned · {N} in Other` (also fixes a prior typo
   "Load more — showing X of more available" with a missing variable).
3. **New `archive-available` hint** in the all-caught-up sentinel:
   - Mirrors the existing `localShortfall` hint but inverse-direction.
   - Fires only when: `mailSource !== "local"` AND `tab === "inbox"` AND
     `healthById.get(activeAcct).inboxCount > visible + 100`. Restricting to
     the inbox tab avoids misleading numbers on the derived "Other" slice.
   - Renders amber two-line: "Live Gmail INBOX: X · Local archive: Y" plus a
     "Switch to local archive to see history" button.
   - Click handler **persists** the choice to localStorage
     (`voltsafe.mailSource` = "local") + shows a confirmation toast — this
     differs intentionally from the inverse hint (which is a transient
     fallback). Documented this exception in the comment block above the
     `mailSource` useState.

### What was NOT changed
- Zero schema changes, zero `db:push`, zero migrations.
- `MarinasDayPlannerDialog` (unrelated), `getMessageSummaries`,
  `/api/gmail/messages`, blocked-domain rules, the local/gmail/auto source
  routing policy, and the existing inverse "Switch to live Gmail" hint all
  untouched.

### Validation
- App restarts cleanly, Vite hot-reloaded each change, no compile errors,
  `/api/gmail/accounts/health` returns 401 unauthenticated as expected.
- Architect review (two rounds): first round flagged three issues
  (messageCount vs inboxCount false-positive, "Other" tab inconsistency,
  persistence comment), all three resolved in round two; final mapping gap
  (`inbox_count` in SQL but missing from annotated mapper) caught and fixed.

## Leads Nearby — Migrated to Draggable Dashboard Widget (Complete, 2026-04-26)

### Goal
Move "Leads Nearby" off the hard-coded slot at the top of `/role-command-center`
and into the same draggable + resizable grid that already hosts the other action
widgets (Travel Calendar, Today's Critical Actions, Inbox Priority Radar, …).
Users now reorder, resize, hide, or restore it like every other widget.

### What changed (UI only, zero schema/db work)
- `client/src/components/leads/leads-mission-control-widget.tsx`
  - `onPlanDay` is now optional. When omitted (the new grid-mounted path), the
    widget mounts its **own** `MarinasDayPlannerDialog` and manages internal
    `internalPlannerOpen` / `internalPlannerLoc` state (mirrors the
    self-contained pattern Travel Calendar already uses).
  - Wrapped JSX in a fragment so the inline dialog can sit beside the card.
- `client/src/components/command-centers/action-widgets.tsx`
  - New `LeadsNearbyGridWidget` wrapper (matches `WidgetProps` contract).
  - Registered under `leads_nearby` in `ACTION_WIDGET_MAP`.
- `client/src/components/command-centers/dashboard-grid.tsx`
  - Size hint added: `leads_nearby: { w: 6, h: 9, minW: 3, minH: 6 }`.
- `client/src/lib/dashboard-config.ts`
  - New `NEW_WIDGETS.leads_nearby` entry (`isNew: true`, `defaultVisible: true`,
    `category: "action"`, no `permKey` — geolocation gating happens inside the
    widget itself via the "use my location" CTA).
  - Inserted as the **first** entry of `UNIVERSAL_EXTRAS` (powers the `default`
    center) and the first new-widgets-section entry of every explicit role
    array (`ceo / cfo / cto / cmo / sales / cs`). Because `widgetOrder` is built
    from `widgets.filter(w => w.isNew)`, this places it top-left in every fresh
    dashboard, matching its prior pinned-to-top prominence.
- `client/src/pages/role-command-center.tsx`
  - Removed the static `<LeadsMissionControlWidget>` block that lived above the
    dashboard grid.
  - Removed the now-orphaned `LeadsMissionControlWidget` and
    `MarinasDayPlannerDialog` imports.
  - Removed the orphaned `marinaDayOpen` / `plannerLocation` state and the
    `<MarinasDayPlannerDialog>` instance that fed it.

### Validation
- `Start application` workflow restarts cleanly with no compile errors.
- Architect (`evaluate_task` + git diff) returned PASS on every functional
  check (self-contained pattern, registration, size hint, cleanup, untouched
  `nearby-marinas-map.tsx` keeps its own dialog usage).

### What was NOT changed (per standing project rules)
- No schema changes, no `db:push`, no migrations, no ID column edits.
- `client/src/components/marinas-day-planner-dialog.tsx` itself untouched —
  still imported and used by `client/src/components/nearby-marinas-map.tsx`.
- Per-user saved layouts: existing users keep their saved positions; the new
  `leads_nearby` id auto-appends to their grid via the standard
  `reconcileLayouts` path with the size hint above.

## Nav Config Consolidation — Single Source of Truth (Complete, 2026-04-26)

### Goal
Eliminate the maintenance hazard of two parallel nav arrays (one in `app-sidebar.tsx`, one in `mobile-nav.tsx`) that the previous reconciliation had to manually keep in lockstep. Move both into a shared config so future edits happen in exactly one place.

### What changed
- **New file** `client/src/lib/nav-config.ts` (~285 lines): exports `NAV_CONFIG` (full schema) + two projection helpers `getDesktopSections()` and `getMobileNavGroups()`. Schema supports:
  - `label: string | { desktop, mobile }` for surface-specific naming (e.g. `Accounts Won` desktop / `Won` mobile).
  - `showOn: ["desktop"] | ["mobile"]` for platform-only entries (Field Mode + Nearby on mobile, ADMIN divider on desktop).
  - `permKey`, `adminOnly`, `exactMatch`, `badge` carried through to both projections.
- `client/src/components/dashboard/app-sidebar.tsx`: trimmed lucide imports to (ChevronRight, Sun, Moon, Flame, Ghost) used only by the theme pill; replaced inline 130-line `sections` array with `const sections = getDesktopSections()`. Render logic unchanged.
- `client/src/components/dashboard/mobile-nav.tsx`: trimmed lucide imports to (Home, Building2, Target, Plus, LayoutGrid, X) used only by the bottom bar + sheet chrome; replaced inline 100-line `allNavGroups` array with `const allNavGroups = getMobileNavGroups()`. Render logic unchanged.

### Validation
- `npx tsc --noEmit` — zero errors in `nav-config.ts`, `app-sidebar.tsx`, `mobile-nav.tsx`. Pre-existing TS errors in `server/voice-assistant*.ts` are unrelated and untouched.
- `Start application` workflow restarted clean; login screen renders, browser console has no JS errors.

### What was NOT changed
- `shared/schema.ts` — untouched. Zero `db:push`. Zero schema changes.
- No backend routes, no APIs, no permission logic. The `canSeeSection`/`canSeeItem` filters in app-sidebar.tsx and the `adminOnly` filter in mobile-nav.tsx still own runtime gating.
- No nav routes added or removed — the projection helpers produce exactly the entries the prior reconciliation defined.

---

## Mobile Nav Drift Reconciliation (Complete, 2026-04-26)

### Goal
Bring `client/src/components/dashboard/mobile-nav.tsx` back into lockstep with `client/src/components/dashboard/app-sidebar.tsx` after they had drifted. The lockstep comment at the top of mobile-nav.tsx already declared this contract.

### Coverage gaps closed
- **Insights**: added `Source Attribution` → `/analytics/source-attribution` (4th item, matches desktop order). Now 8 items, parity with desktop.
- **More**: expanded from 5 → 15 items to match desktop. Added `Daily Execution`, `Revenue Hub`, `Revenue Ops`, `Revenue Simulator`, `Rel. Intelligence`, `Score Feedback`, `Digest & Alerts`, `Territory Routing`, `Data Quality`, `Task Rules`, `Winter Support`. `Settings` removed from More (moved to Admin).
- **Admin**: expanded from 3 → 5 items. Added `Global Search` → `/search` and `Settings` → `/settings`. All admin items have `adminOnly: true`.

### Imports added (lucide-react)
`PlayCircle, FlaskRound, BellRing, Snowflake, Search` — appended to existing import block. No removals.

### Intentional differences preserved (NOT changed)
- Mobile uses shortened labels for thumb-readable bottom-sheet (`Activity`, `Won`, `Exec Dashboard`, `Copilot`, `Briefs`, `Signals`, `Territory`, `Industry`, `Dealers`, `Alliances`, `Media`, `Tickets`, `Mailboxes`).
- Mobile `Today` group has 3 items (Today, Field Mode, Nearby) for phone-first field flows; desktop `Today` is single link.
- Mobile bottom bar = 4 quick tabs (Home, Leads, Pipeline, Log) + center Menu button → opens the All Sections sheet.

### Validation
- `npx tsc --noEmit` — zero errors in `mobile-nav.tsx`. Pre-existing TS errors in `dashboard-grid.tsx`, `header.tsx`, `automations.tsx`, etc. are unrelated and untouched.
- All 13 newly-referenced URLs verified present in `client/src/App.tsx`.
- Vite HMR picked up edit; `Start application` workflow running.

### What was NOT changed
- `shared/schema.ts` — untouched. Zero `db:push`. Zero schema changes.
- `app-sidebar.tsx` — untouched (mobile pulled up to desktop's coverage, not the reverse).
- No backend routes or APIs.

---

## UX Declutter Phase 5 — Account Detail Dialog Consolidation (Complete)

### Goal
Collapse the AccountDetailDialog from 8 overflowing tabs into 3 logical groups so desktop fits one row and mobile becomes scannable. Pure UI graduation — no schema, no API, no data flow changes.

### Source of design
Mockup `artifacts/mockup-sandbox/src/components/mockups/account-detail-redesign/Consolidated.tsx` (variant approved by user via "Graduate it!"). Live preview at `/__mockup/preview/account-detail-redesign/Consolidated`.

### Tab mapping (old → new)
| Old (8 tabs)                                        | New (3 tabs)                |
|-----------------------------------------------------|------------------------------|
| Details, Notes (NotesPanel), Infrastructure         | **Overview**                 |
| Contacts, Deals, Tickets                            | **People & Pipeline**        |
| Emails, Timeline                                    | **Activity**                 |

### File touched
`client/src/pages/accounts.tsx` only — surgical edit of `AccountDetailDialog` component (lines ~946-1500).

### What changed
1. Added 4 lucide imports: `Briefcase`, `LifeBuoy`, `History as HistoryIcon`, `MessageSquare`, `FileText`.
2. Added two presentational helpers above `AccountDetailDialog` (lines ~901-944):
   - `CollapsibleSection({ title, icon, count, defaultOpen, testId, children })` — bordered card with chevron-button header that toggles `useState(defaultOpen)` open state.
   - `SectionHeader({ icon, title, count })` — small uppercase tracking label used inside People & Activity tab bodies.
3. Replaced the 8-trigger `<TabsList className="flex-wrap h-auto">` with a `grid grid-cols-3 w-full` 3-trigger list. The People tab label says "People & Pipeline" on `sm+` screens, "People" on mobile.
4. Renamed `defaultValue="details"` → `defaultValue="overview"`. Tab `data-testid` values: `tab-overview`, `tab-people`, `tab-activity`.
5. **Overview** body = the entire previous Details body (edit-mode toggle, Address, profile field grid, Expansion / Red Flags / Next Action callouts, Notes text, Assigned-to + CreateActionItem, full Source Lead expansion block with conversionHistory) PLUS two new collapsibles inserted just above the Attachments/Comments footer:
   - `CollapsibleSection title="Infrastructure profile" defaultOpen={false}` wrapping the existing `InfrastructureProfileTab`.
   - `CollapsibleSection title="Note feed" defaultOpen={false}` wrapping the existing `NotesPanel`.
   Attachments + Comments still render full-width at the bottom.
6. **People & Pipeline** body = three stacked `<section>` blocks each headed by `SectionHeader`:
   - Contacts (with the existing Add Contact `Dialog` wired to `addContactOpen`, count badge, `canEdit` gate intact).
   - Deals (existing opps list, count badge).
   - Tickets (existing tickets list, count badge).
7. **Activity** body = two stacked sections: Emails (`EmailsTab`) + Timeline (`TimelineTab`).

### Functional preservation (verified by architect review)
All handlers and components survived intact: `EditAccountForm`, `InfrastructureProfileTab`, `EmailsTab`, `TimelineTab`, `NotesPanel`, `AssignUserSelect`, `CreateActionItem`, `AttachmentsSection`, `CommentsFeed`, `CreateContactForm`, source-lead expansion + `conversionHistory`, edit-mode toggle, folder dialog, all data-testids, `canEdit` permission gating on Edit / Add Contact / InfrastructureProfileTab.

### Validation
- `npx tsc --noEmit` — zero errors in `accounts.tsx`.
- Architect code review (evaluate_task with includeGitDiff): **PASS**, no severe regressions, no security issues.
- Vite HMR picked up edit; `Start application` workflow running.
- Pre-existing test workflow failures (mail-permissions, mailbox-switching, permissions, tracking-multi-proof, tracking-proof) are race-condition ECONNREFUSED:5000 unrelated to this change — left untouched.

### What was NOT changed
- `shared/schema.ts` — untouched.
- No `db:push` invoked. Zero schema changes.
- No backend route changes.
- No package.json changes.
- Mockup sandbox files (`artifacts/mockup-sandbox/.../account-detail-redesign/*`) and canvas iframe shapes (`drawer-current-account`, `drawer-redesign-account`) left in place pending user decision on cleanup.

### Phase status (UX Declutter overall)
Phase 1 ✓ · Phase 2 ✓ · Phase 3 (no-op) ✓ · Phase 4 ✓ · **Phase 5 ✓** — UX Declutter campaign complete.

---

## Attachment Metadata + Search Filters (Phase 2E — Complete)

### Goal
Make Trevor's mailbox searchable by attachment without storing any binary data yet. Pure metadata + filter pipeline.

### New table — `email_attachments` (additive only)
| col | type | notes |
|---|---|---|
| id | serial PK | matches existing pattern |
| message_id | integer FK → email_messages.id ON DELETE CASCADE | exact type match to email_messages.id |
| gmail_attachment_id | text | Gmail's attachment handle (for future binary fetch) |
| filename | text | best-effort name |
| mime_type | text | e.g. application/pdf |
| size_bytes | integer | from Gmail body.size |
| content_id | text | for inline cid: refs |
| is_inline | boolean | distinguishes inline images from real attachments |
| part_id | text | MIME part for future fetch |
| created_at | timestamp | |

Indexes: `idx_email_attach_message`, `idx_email_attach_mime`, `idx_email_attach_filename_trgm` (gin_trgm_ops on lower(filename)). All registered in `ensureSearchIndexes()` so they survive any DB rebuild.

### Parser — `email-parser.ts`
- New `extractAttachments(payload)` does DFS over the MIME tree and emits a `ParsedAttachment` for any non-multipart part with a filename, attachment-id, or `Content-Disposition: attachment/inline`.
- `ParsedEmail` now carries `attachments: ParsedAttachment[]`. All 3 sync sites destructure and route them to the new helper `insertAttachmentsForMessage(messageId, attachments)`.

### Sync sites updated
- `gmail-sync.ts` (paginated catch-up sync)
- `gmail-incremental.ts` (real-time push handler)
- `backfill-service.ts` (bulk historical backfill)

All 3 now write attachment rows transactionally after the parent email row is inserted.

### Backfill — `scripts/attachment-backfill.ts`
One-off utility that re-fetches messages where `has_attachments=true` but no attachment rows exist yet. Supports throttle: `npx tsx scripts/attachment-backfill.ts <limit> <accountId> <sleepMs>` (default 80 ms when limit > 100). Backfilled the full Trevor mailbox.

### Search filters added
Available via the Gmail-style `q` param on **all local routes** (`/api/gmail/messages`, `/api/gmail/threads`, `/api/email-search`). They compose freely with each other and with free text:

| filter | example | semantics |
|---|---|---|
| `has:attachment` | `in:inbox has:attachment` | EXISTS join, excludes inline images |
| `filename:foo` | `filename:invoice`, `filename:"PO 4023"` | trigram LIKE on lower(filename) |
| `mime:type` | `mime:application/pdf`, `mime:image` | substring on lower(mime_type) |
| `from:term` | `from:zoom`, `from:"acme corp"` | substring on from_email or from_name |
| `after:YYYY-MM-DD` | `after:2025-01-01` | sent_at >= |
| `before:YYYY-MM-DD` | `before:2026-01-01` | sent_at < |

All filter values are SQL-escaped via the existing `safe()` wrapper.

### Thread view
`getLocalThread` now batch-loads attachments for all messages in a single `WHERE message_id IN (...)` query and returns them on each message:
```json
{ "filename": "VoltSafe Investor Deck_April 2026.pdf", "mimeType": "application/pdf", "sizeBytes": 3883461, "isInline": false, "contentId": null }
```
The inbox UI (`gmail-inbox.tsx`) renders a chip strip below each message body — paperclip icon, filename (truncated 260 px), KB size, full title tooltip with mime+size. Inline attachments (cid: references) are filtered out so the strip shows only real document/image attachments the user would click.

### Performance (Trevor dataset, 14,941 messages)
| query | time |
|---|---|
| `in:inbox` (50 rows) | 9.7 ms |
| `in:inbox has:attachment` (50 rows) | 10.3 ms |
| `filename:agreement` (50 rows) | 9.4 ms |
| `mime:application` (50 rows) | 9.7 ms |

The `has:attachment` EXISTS subquery hits `idx_email_attach_message`. Trigram filename + mime indexes keep filename/mime queries flat.

### Files touched
- `shared/schema.ts` (new `emailAttachments` table)
- `server/services/email-parser.ts` (extractAttachments + ParsedEmail.attachments)
- `server/services/email-attachments.ts` (NEW — insert helper)
- `server/services/local-mailbox.ts` (filter parser + thread attachments)
- `server/services/email-search.ts` (3 new index entries)
- `server/services/gmail-sync.ts`, `gmail-incremental.ts`, `backfill-service.ts` (insert site wiring)
- `scripts/attachment-backfill.ts` (NEW)
- `client/src/pages/gmail-inbox.tsx` (chip strip below message body)

### Validation
- 71/71 permissions tests pass
- Live Gmail source still returns full results (no regressions)
- Trevor watch still active (incremental sync unchanged)

---

## Trevor Push Completion + Local Fidelity (Phase 2D — Complete)

### What was built
Tightened Trevor's real-time push pipeline, eliminated local↔Gmail drift, and added rich-HTML body storage so the local inbox renders the same content the live Gmail view shows.

### Trevor watch verified live
- watch_topic = `projects/prime-phalanx-461723-a3/topics/gmail-watch`
- watch_expiration_at = 2026-04-24 (7 days out, scheduler renews every 6h, 24h before expiry)
- After triggering `/api/gmail/sync-incremental?accountId=1`, **stored historyId 17381321 == live historyId 17381321** (fully caught up); +8 events processed (6 new messages, 2 label changes), `incremental_event_count` 19 → 27
- Webhook handler validated end-to-end with a simulated Pub/Sub envelope (`POST /api/webhooks/gmail?token=$GMAIL_WEBHOOK_TOKEN` with base64-wrapped `{emailAddress, historyId}`) → 200 OK, stamps `last_webhook_at`, kicks off `syncIncremental` immediately. Bad token → 401.
- `mailbox-health.tsx` already exposes the full Trevor block: live status badge, watch_topic, watch_expires, last webhook received, last incremental, eventCount, stored vs live historyId — all rendered prominently in "Push & incremental sync".

### Local↔Gmail parity tightened
- Re-ran `/api/email-search/parity` after incremental sync caught up:
  - INBOX: localCount 14,355 · **intersect 10/10** · onlyLocal 0 · onlyGmail 0
  - SENT: **intersect 10/10** · onlyLocal 0 · onlyGmail 0
- The 1-row drift seen in Phase 2C closed automatically once incremental advanced.
- Optimistic updates verified across all three `mailSource` modes (cache keys include source so star/archive/unread land in active cache).

### Rich HTML body storage
- Added `body_html text` column to `email_messages` (additive, no PK touch).
- `email-parser.ts` now extracts both `text/plain` and `text/html` parts (`extractHtmlBody` does DFS over the MIME tree). New `bodyHtml` field on `ParsedEmail` (clipped to 200 KB).
- All 3 sync sites (`gmail-sync.ts`, `gmail-incremental.ts`, `backfill-service.ts`) auto-pick up the new field via existing `...parsed` spread — no insert-site changes needed.
- `local-mailbox.ts:getLocalThread` now serves HTML when present and sets `isHtml: !!body_html`. Falls back to plain text → snippet.
- One-off backfill script `scripts/html-backfill-recent.ts` populated HTML for the 50 most recent rows: **47/50 captured (94%)**, avg 33 KB. The 3 remaining are genuinely plain-text-only emails.

### What still drives a user to "Source: Gmail"
1. **HTML for older messages** — only the 50 most recent rows have HTML so far. The full mailbox (~14.4k rows) needs an HTML backfill pass; existing rows still render plain text from local. Run `npx tsx scripts/html-backfill-recent.ts <N> 1` to widen coverage on demand. Otherwise: rich rendering for all *new* messages from now on (parser fills `body_html` on every insert).
2. **Inline images / CID-referenced attachments** — `body_html` references `cid:` images that aren't stored locally yet (attachment binary storage is intentionally out of scope per Phase 2D charter).
3. **Real-time Pub/Sub delivery in production** — `last_webhook_at` populates correctly when the webhook endpoint is hit (proven via local simulation). If production GCP push subscription is paused or pointed at a stale URL, watch the badge in mailbox-health: it goes from "● Live" → "Configured — awaiting first webhook" within 30 minutes.

### Files touched
- `shared/schema.ts` (added `body_html text`)
- `server/services/email-parser.ts` (extractHtmlBody + ParsedEmail.bodyHtml)
- `server/services/local-mailbox.ts` (serve HTML in getLocalThread)
- `scripts/html-backfill-recent.ts` (NEW — one-off HTML backfill utility)
- DB: `ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS body_html text` (single additive ADD COLUMN; npm run db:push --force was blocked by an unrelated webauthn TTY prompt — equivalent statement applied directly)

### Validation
- 71/71 permissions tests pass · live Gmail sync, watch, backfill #2 (14,900) all untouched.

---

## Local Inbox Cutover (Phase 2C — Complete)

### What was built
The inbox/threads list and thread-detail views now read from the **local `email_messages` table by default**, with transparent fallback to live Gmail. UI-selectable Source toggle (Local / Gmail / Auto) in the inbox header.

### New file
- `server/services/local-mailbox.ts` — `listLocalMessages`, `listLocalThreads`, `getLocalThread`, `parityCheckLocal`. Returns Gmail-shaped objects (`{id, threadId, snippet, internalDate, labelIds, from, to, subject, date}`) so the frontend needed no shape changes. Parses `in:inbox` / `in:sent` from `q` into label_ids ILIKE; free text falls through to FTS via the `idx_email_fts` GIN index from Phase 2B. Pagination via offset-as-string in pageToken.

### Modified routes (`server/routes.ts`)
All three accept `?source=local|gmail|auto` (default `gmail` for backward compatibility):
- `GET /api/gmail/messages` — inbox/sent list
- `GET /api/gmail/threads` — threaded list
- `GET /api/gmail/threads/:id` — thread detail
Each response includes `X-Mail-Source` and `X-Mail-Took-Ms` headers. `auto` falls back to Gmail only when local returns 0 rows.

New: `GET /api/email-search/parity?label=&accountId=&limit=` — compares local vs live Gmail first page; reports counts, latencies, intersect / onlyLocal / onlyGmail.

### UI (`client/src/pages/gmail-inbox.tsx`)
- `mailSource` state (URL param `?mailSource=`, default `auto`) wired into `inboxQuery`, `sentQuery`, `loadMoreInbox`, `loadMoreSent`, and `threadQuery`. Query keys + the existing extras-reset effects all include `mailSource` so source switches refetch cleanly and clear stale pagination tokens.
- All 6 `setQueryData` cache-update callsites (star/archive/unread) updated to the 5-element key including `mailSource` so optimistic updates land in the active cache.
- Small Source selector (Auto / Local / Gmail) added to the inbox header next to the Search Mailbox button.

### Validated on Trevor's mailbox (live, backfill #2 still progressing at 14,900)
- Inbox first page: **local 10ms vs Gmail 650ms (~65× faster)**, 5/5 runs each
- Threads list local: 21ms · Thread detail local: served from local
- Parity INBOX: 14,352 local rows · local 18ms vs Gmail 384ms · intersect 9 / onlyLocal 1 / onlyGmail 1 (1-row drift = backfill in flight)
- Parity SENT: 595 local rows · local 26ms vs Gmail 220ms · intersect 10/10 (perfect)
- 71/71 permissions tests pass; live Gmail sync, watch, and backfill #2 all untouched

### Known limitations / follow-ups
- `getLocalThread` hardcodes `isHtml=false` (uses `body_text`). Live Gmail still has rich HTML; switch to Gmail for HTML-rendered view if needed.
- Auto mode falls back only on 0 rows; a partially-backfilled mailbox could appear truncated. Backfill #2 is closing the gap; once complete, parity should be ~100%.

---

## Mailbox Local Search (Phase 2B — Complete)

### What was built
Fast, local indexed search across `email_messages` (full mailbox history, ms-fast) — independent of Gmail's slow search API. Sits next to the live Gmail inbox view; does not replace it.

### New files
- `server/services/email-search.ts` — `ensureSearchIndexes()` (idempotent index DDL) + `searchEmails(params)` with FTS, trigram, composite indexes, ts_rank ordering, and ts_headline snippet highlighting (`<<…>>` markers).

### Indexes added (all `CREATE INDEX IF NOT EXISTS` — pure additive, no Drizzle schema change)
- `idx_email_owner_sent` (owner_user_id, sent_at DESC) — per-user inbox hot path
- `idx_email_account_sent` (source_account_id, sent_at DESC) — per-mailbox hot path
- `idx_email_thread`, `idx_email_from_domain`, `idx_email_direction_sent`
- `pg_trgm` extension + `idx_email_participants_trgm`, `idx_email_subject_trgm` — fast ILIKE
- `idx_email_fts` GIN on `to_tsvector('english', subject || from_name || from_email || snippet || body_text)` — full-text search

### Routes (`server/routes.ts` ~9441)
- `GET /api/email-search?q=&from=&to=&domain=&dateFrom=&dateTo=&label=&direction=&accountId=&scope=&limit=&offset=` — local DB search.
  - `scope=mine` (default) restricts to caller's `owner_user_id`. `scope=all` is admin-only (master_admin/admin); silently downgraded to `mine` for non-admins.
  - `direction` is whitelisted to `inbound|outbound` (anything else dropped).
- `POST /api/email-search/reindex` — re-runs `ensureSearchIndexes()` (idempotent).

### Startup
`server/index.ts` runs `ensureSearchIndexes()` on boot (non-blocking, after Gmail watch renewal scheduler).

### UI (`client/src/pages/gmail-inbox.tsx`)
New `LocalSearchButton` next to refresh-inbox in the mail header opens a right-side Sheet with: full-text query, from/domain, direction, date range. Hits `/api/email-search`, renders ranked results with highlighted snippets (`<<…>>` → `<mark>`), shows `{total} matches · {tookMs}ms`, click row → opens that thread in inbox.

### Validated on Trevor's mailbox (14,935 rows)
- FTS `q=invoice` → 317 hits in **96ms**
- domain=gmail.com → 166 hits in **1ms**
- from=stripe → 20 hits in 22ms
- bad direction `BAD;DROP` → silently dropped, no SQL error (14,935 baseline)
- 71/71 permissions tests pass
- live Gmail sync + backfill job #2 untouched (still progressing)

### Phase 2A recap (still live)
GCP Pub/Sub topic + IAM, secrets `GMAIL_PUBSUB_TOPIC` + `GMAIL_WEBHOOK_TOKEN`, watch on support@voltsafe.com 🟢; production webhook `https://image-linker-burgesstrevor76.replit.app/api/webhooks/gmail?token=…`; UI surface in `mailbox-health.tsx`.

## Global Layout Safety Rules (Established in UI Overlap Audit)

### Z-Index Layer System
Always use these z-index values — do not deviate:
| Layer | z-index | Elements |
|---|---|---|
| sticky | 10 | sticky headers, sub-navs |
| sidebar | 20 | desktop sidebar rail |
| panel | 40 | side panels, mobile nav, mobile overlays |
| modal | 50 | Radix dialogs/sheets (portals), FAB |
| non-portal modals | 60 | custom `fixed inset-0` divs that don't use Radix portals |
| toast | 100 | toast notifications |

### FAB (Quick Capture) Rules
- **`id="quick-capture-fab"`** — required ID for CSS targeting
- **Mobile position**: `bottom-24 right-4` (96px from bottom)
- **Desktop position**: `md:bottom-10 md:right-6` (40px from bottom)
- **z-index**: z-50 (Radix portals naturally render above it; custom modals use z-[60])
- **has-modal**: Pages that open a custom non-Radix modal/panel must call `document.body.classList.add("has-modal")` when opening and remove on close/unmount. CSS in index.css hides the FAB (`opacity:0 pointer-events:none visibility:hidden`) while `body.has-modal` is active.
- **has-right-panel**: ONLY for true fixed right-rail panels. `renewals.tsx` uses this correctly (480px side panel). Do NOT apply to centered dialogs.
- Currently using `has-right-panel`: `renewals.tsx` (CS customer detail panel — genuine right rail)
- Currently using `has-modal`: `data-quality.tsx`, `procurement.tsx`, `deployments.tsx`

### Scroll Container Bottom Padding Rule
Any `flex-1 overflow-y-auto` container that reaches the bottom of the viewport must have:
- **Mobile**: `pb-24` minimum (96px) to clear the FAB
- **Desktop**: `pb-6` or `md:pb-6`
- Use `pb-24 md:pb-6` shorthand on the scroll container
- Applied to: gmail-inbox, relationship-intelligence, tasks-hub, board-pack, data-quality, jira, confluence, documents, assets

### App.tsx Main Container
`main` has `pb-36 md:pb-8` — provides 144px bottom clearance on mobile (FAB + nav + breathing room), 32px on desktop.
Do not reduce `pb-36` below `pb-28`.

### Toast Viewport
Toast viewport uses `sm:bottom-[5.5rem] sm:right-4` to sit above the FAB on desktop. Do not move it back to `sm:bottom-0`.

### Utility CSS Classes (index.css)
- `.safe-area-bottom` — `padding-bottom: env(safe-area-inset-bottom, 0px)` for iOS home bar
- `.pb-fab` — 9rem mobile / 5.5rem desktop, for pages that manage their own scroll container

---

## Certification Tracker Alert Engine (Complete — Phase 6)

### What was built
Active alerting layer on top of the Live Test Tracker. Synced sheet counts now trigger per-project notifications, tasks, executive alerts, and a persistent alert banner — with cooldown/dedupe to prevent spam.

### New Files
- `server/services/cert-alert-engine.ts` — Core alert engine: `evaluateConditions()`, `runAlertEngine()`, `parseAlertState()`, `getActiveAlerts()`
- `scripts/migrate-cert-alerts.ts` — Migration that adds `tracker_alert_state TEXT` column to `project_certifications`
- `tests/cert-alerts.test.js` — **28/28 tests passing**

### Schema Change
`project_certifications.tracker_alert_state TEXT` — JSON blob: `{ lastEvalAt, conditions: { failed_test, blocker, retest_required, cert_risk, due_soon } }`

### Backend Routes Added (in `server/routes.ts`)
- `GET  /api/projects/:id/tracker-alerts/state` — Returns current stored alert state + list of active (within-cooldown) alert types
- `POST /api/projects/:id/tracker-alerts/evaluate` — Accepts SheetSyncSnapshot body, evaluates all 5 alert conditions, runs outputs (notification + task + exec alert), saves new state; returns `{ triggered, cooledDown, notificationsCreated, tasksCreated, execAlertsCreated, newState }`
- `certSqlSets` extended with `trackerAlertState → tracker_alert_state`
- `GET /api/executive/risk-alerts` extended with `certTrackerAlerts` array + updated `distinctAtRiskCount`

### Alert Engine Logic (5 conditions)
| Alert Type | Trigger | Severity |
|---|---|---|
| `failed_test` | failed > 0 | medium / high (≥3) |
| `blocker` | blockerCount > 0 | high / critical (≥2) |
| `retest_required` | retestCount > 0 | medium |
| `cert_risk` | alertConditions.certRisk=true | high |
| `due_soon` | dueSoonCount ≥ threshold (default 5) | medium |

**Dedupe / cooldown logic:** alert triggers only if `(!prevTriggered && conditionMet)` OR `(conditionMet && currentCount > prevCount)`. Configurable `cooldownHours` (default 24) per `alertHooks` in `trackerSheetConfig`.

### Outputs (per triggered condition)
1. **Notification** — `cert_tracker_alert` type with dedupe key `cert_alert_{projectId}_{type}_{YYYY-MM-DD}`
2. **Task** — `source: 'cert_alert'` linked to project, 48h due date; only for high/critical severity
3. **Executive alert** — `executive_alerts` table; only for high/critical severity
4. **State persisted** — `tracker_alert_state` saved on every evaluate call

### Frontend Changes (`client/src/pages/projects.tsx`)
- New types: `AlertState`, `AlertConditionState`, `AlertType`, `ALERT_LABELS`, `ALERT_SEVERITY`, `getActiveAlertTypes()`
- `LiveTestTrackerTab`: loads alert state on mount via `GET /api/projects/:id/tracker-alerts/state`; after every successful sync, auto-calls `POST /api/projects/:id/tracker-alerts/evaluate`
- `LiveTrackerCertSummary`: accepts `alertState` prop; shows persistent "Active Alerts" banner above health badge when active alerts exist
- `ProjectDetailDialog`: queries alert state; shows red badge count on "Live Test Tracker" tab trigger
- Tab badge: `data-testid="badge-tracker-alerts"` — red pill showing count of active alerts

### Tests (`tests/cert-alerts.test.js`) — 28/28 ✓
Phase 1 (evaluation), Phase 2 (notification/task/exec alert creation), Phase 3 (cooldown/dedupe), Phase 4 (exec risk-alerts), validation, regression, cleanup.

Also: `tests/live-tracker.test.js` — still **27/27 ✓** (no regression).

---

## Help Center & AI Training System (Complete — Feature 11)

### What was built
A complete documentation, training, and AI knowledge system integrated directly into VoltSafe Cortex.

**Files created:**
- `docs/quick-start-guide.md` — New employee quick start (5 min read, login to first 15 min)
- `docs/operations-manual.md` — Full 34-section operations manual covering every module, daily workflows, troubleshooting, glossary, top 20 rules
- `docs/training-handbook.md` — Role-based training (CEO/Admin, Sales, Operations, Read-only) with 30-min plan, 7-day mastery plan, onboarding checklists
- `docs/ai-knowledge-base.json` — Structured knowledge base: 100 FAQs, 16 feature cards, 10 troubleshooting guides, 32 glossary terms
- `client/src/docs/` — Mirror of docs/ within Vite root for frontend imports
- `client/src/pages/help-center.tsx` — In-app Help Center with 4 tabs + PDF download + searchable FAQ

**App changes:**
- `/help` route added to `App.tsx`
- "Help Center" section added to sidebar under TOOLS with Quick Start / Operations Manual / Training Handbook / FAQ & Glossary sub-items
- `GraduationCap`, `HelpCircle` icons added to sidebar imports

**AI integration:**
- `searchKnowledgeBase(query)` function added to `server/voice-assistant.ts`
- Detects help-type queries ("how do I", "what is", "explain", etc.)
- Returns top-5 relevant FAQ answers as context in every AI response
- `SYSTEM_PROMPT` updated with capability #3: Help & Training Knowledge Base
- Cortex now answers system usage questions from the 100-item FAQ database

---

## Production Hardening Pass 2 (Complete — Comprehensive audit)

### Issues found and fixed

#### Security (Critical/High)
1. **Chat/Audio/Image routes not registered**: `registerChatRoutes`, `registerAudioRoutes`, `registerImageRoutes` were never called in `registerRoutes`. Routes now properly mounted in `server/routes.ts` at boot, with all handlers guarded by `requireAuth`.
2. **Admin write routes missing `requireAdmin`**: 8 routes only had `requireAuth` — any logged-in user could create/edit/suspend/delete users. Fixed with `requireAdmin` middleware on: `PATCH/PUT/POST /api/admin/users*`, `DELETE /api/admin/users/:id`.
3. **Dead sidebar links removed**: `/segments`, `/tags`, `/imports` pointed to non-existent pages.

#### UX (Medium) — Silent mutation failures
Added `onError` toast handlers to 8 pages that had mutations with `onSuccess` but no error feedback:
- `tickets.tsx`: createMutation + updateMutation (+ added success toast on update)
- `communications.tsx`: createListMutation, createCampaignMutation, updateCampaignMutation
- `ecosystem-events/organizations/people/regions/relationships.tsx`: all 3 mutations per page (15 total)
- `role-command-center.tsx`: saveMutation (also added `useToast` import + success toast)

#### Accessibility (Low)
- `change-password.tsx`: added `autoComplete="new-password"` to confirm password input
- `settings.tsx`: added `autoComplete="current-password"` to CalDAV password input

### Audit results — all clean
- **Sidebar/route parity**: all 54 sidebar links have matching App.tsx routes ✓
- **API response shapes**: all paginated queries use correct `data?.data` / `data = []` defaults ✓
- **Empty/loading states**: all pages with `useQuery` have `isLoading` handling ✓
- **Server logs**: no 500 errors, no unhandled rejections ✓
- **Browser console**: no errors when authenticated ✓
- **Export routes**: covered by `app.use("/api/leads", requireAuth)` middleware chain ✓

### Test coverage
- `tests/permissions.test.js` — **71/71 tests pass**
  - Original 54 tests (viewer/mixed/admin × all modules)
  - +12 new unauthenticated access tests (chat API, generate-image, 6 export routes, 2 CRM reads)
  - +5 new admin privilege escalation tests (viewer → 403 on all admin write routes)

---

## Personal + Team Relationship Intelligence (Complete — Feature 10)

### What was added
Full 8-phase expansion of the Multi-Mailbox system covering per-user mailbox connections, historical backfill, relationship graph with warmness scoring, contact auto-linking, permissions, intelligence views, global search, and testing.

**DB Schema additions** (via direct SQL):
- `email_accounts.privacy_mode` — `private | metadata_only | business_visible` (default)
- `backfill_jobs` — resumable per-user job tracking (id, user_id, email_account_id, status, date_from, date_to, processed, total, last_page_token, error_message, created_at, completed_at)
- `contact_relationships` — warmness cache (email_address, domain, contact_id FK, user_id, first_seen, last_seen, total_sent, total_received, warmness_score)

**Backend** (`server/routes.ts` + `server/services/backfill-service.ts`):
- `GET/PATCH/DELETE /api/my/mailbox/*` — per-user mailbox list, privacy mode, disconnect
- `GET /api/my/mailbox/connect` — OAuth redirect (state="personal") → redirects to /settings/mailbox
- `POST /api/my/mailbox/:id/backfill` + `GET /api/my/mailbox/backfill/status` — async resumable backfill
- `GET /api/relationships/graph` — per-contact warmness data
- `GET /api/relationships/views?view=` — 4 views: dormant_leads, warm_to_reengage, multi_threaded, no_contact_180
- `GET /api/search/global?q=` — search contacts, accounts, emails, relationships
- `GET /api/team/mailboxes` — team mailbox overview (respects privacy_mode)
- Warmness formula: score = 100 - (days_since_last_email / 2) + min(30, total_emails/3), clamped 0-100

**Frontend**:
- `client/src/pages/mailbox-settings.tsx` — `/settings/mailbox` page with personal mailbox list, Connect Gmail button, privacy mode selector, backfill panel with date range + live progress, team mailboxes overview
- `client/src/pages/relationship-intelligence.tsx` — enhanced with 5-tab layout: Email Activity (existing), Re-engage, Dormant Leads, Multi-Threaded, 180d No Contact; WarmBadge component (🔥/☀️/❄️/💤)
- `client/src/components/global-search.tsx` — Cmd+K modal with real-time search across contacts/accounts/emails; keyboard navigation (↑↓ arrows, Enter, ESC)
- `/search` route in App.tsx with search launcher page
- Sidebar link "Global Search" added to Admin section

**Test suite** `tests/relationship-intelligence.test.js`: 26 tests across 8 groups (personal mailbox, privacy mode, backfill, relationship graph, intelligence views, global search, team mailboxes, no-regression)

### Phase 4 — Authorization Governance (Complete)
Closes the "view-only must be read-only" enforcement gap on shared Gmail mailboxes. Zero schema changes — pure server-side guard logic plus frontend polish.

**Permission model (existing fields, no migrations):**
- `users.permissions.mail_team[String(accountId)] = { view: boolean, edit: boolean }`
- Admins (`master_admin`, `admin`) have implicit full access
- Owners (`email_accounts.user_id === session.userId`) have implicit full access
- `edit` implies `view`; view-only grants are blocked from all mutations

**Server helpers** (`server/routes.ts`):
- `requireAccountEditAccess(req, res, accountId)` → 403 `"Edit access required for this mailbox. You have read-only access."` for view-only grants; passes for owner/admin/edit-grant
- `requireAdminOnly(req, res)` → 403 `"Admin only"` for non-admins; gates system-wide ops

**Edit guards on 8 Gmail mutation routes** (placed after `resolveAccount`):
- `POST /api/gmail/drafts`
- `DELETE /api/gmail/drafts/:id`
- `POST /api/gmail/messages/:id/mark-read`
- `POST /api/gmail/messages/:id/toggle-star`
- `POST /api/gmail/bulk-mark-read`
- `POST /api/gmail/bulk-archive`
- `POST /api/gmail/send`
- `PATCH /api/gmail/thread-record/:threadId` — guarded by mailbox lookup of any anchor message; brand-new thread metadata (no anchor yet) is permitted

**Sync/watch guards:**
- `POST /api/gmail/sync` → admin-only
- `POST /api/gmail/sync-incremental` → owner-or-admin (with `accountId`); admin-only otherwise
- `POST /api/gmail/watch/start|stop` → owner-or-admin

**Frontend polish** (`client/src/pages/gmail-inbox.tsx`):
- Compose button is replaced by a "Read-only" badge (with `Eye` icon) when `canSend` is false
- Bulk mark-read/unread buttons gated by `canSend`
- Reuses existing `canSend` derivation (isOwner || admin || mailTeamPerms[id]?.edit)

**Smoke test (verified end-to-end with a temporarily seeded view-only grant):** all 8 mutation routes return 403 with the correct message; reads return 200; admin/owner sync gates fire correctly; admin path returns 200. Test fixtures restored after testing.

**Deferred / out of scope:** thread-association mutation endpoints (`/api/gmail/thread-associations/*`) are CRM linkage operations that straddle CRM/mailbox policy boundaries — left under existing `requireAuth` until product policy is decided.

---

## Executive AI Copilot — Daily Decisions Engine (Complete — Feature 9)

### What was added
A top-level intelligence layer that scans CRM, revenue ops, tasks, email signals, and board pack data to surface the 5 actions that matter most today — deterministic, data-grounded, no fake AI text.

**Schema additions** (via direct SQL + shared/schema.ts):
- `executive_briefs` — id, brief_date (unique YYYY-MM-DD), headline, summary, payload_json (topSignals + radar), created_at
- `executive_alerts` — id, type, severity, title, description, linked_object_type/id, status (open/dismissed/resolved), score, brief_date, suggested_move, created_at

**`server/services/executive-copilot.ts`** (new service):
- `detectExecutiveAlerts()` — scans 7 alert types: stalled_deal (14+ days no activity), commit_off_track (>15% gap), critical_task_overdue, no_new_leads (7 days), awaiting_reply (>48h), board_pack_stale (enabled but no run ≥7d), open_ticket_high (high/critical severity)
- `rankPriorities()` — scores by severity (critical=40, high=25, medium=12, low=4) + domain-specific revenue impact; returns sorted descending
- `generateSuggestedMoves()` — deterministic per-type next-action string (not AI-generated)
- `generateDailyBrief()` — runs all scanners in parallel, picks top 5 signals, builds headline + summary from live radar, upserts to `executive_briefs` + `executive_alerts` by brief_date
- `getTodaysBrief()` — read today's cached brief
- `getAlerts()` / `updateAlertStatus()` — list and dismiss/resolve alerts

**5 new API routes** in `server/routes.ts`:
- `GET /api/executive/brief/today` — get today's brief (null if not yet generated)
- `POST /api/executive/brief/refresh` — regenerate from live data (idempotent upsert)
- `GET /api/executive/alerts` — list open/dismissed/resolved alerts, sorted by score
- `PATCH /api/executive/alerts/:id` — dismiss or resolve an alert
- `GET /api/executive/priorities` — returns topSignals from today's brief

**Frontend** `client/src/pages/executive-copilot.tsx` (new page):
- Today's Brief card — headline + summary + generated timestamp
- Live Radar strip — 6 KPI tiles: commit status, stalled deals, overdue tasks, new leads MTD, awaiting reply, board pack age
- Top Priorities — signal cards with severity badge, detail, suggested move, and "open record" link
- All Open Alerts — dismissable list, sorted by score; "show all / show less" toggle
- Quick Actions — 4 shortcuts: Revenue Ops, Board Pack, Task Hub, Inbox
- Route `/executive-copilot` in App.tsx; added at top of Intelligence sidebar section

**Test suite** `tests/executive-copilot.test.js`: 39 tests across 5 groups (brief, alerts, priorities, detection logic, regression)

**Bug fixed during build**: `board_pack_schedules` uses `enabled` column (not `is_active`); SQL string literals used `sqlStr()`/`sqlJson()` helpers to avoid PostgreSQL treating double-quoted strings as column identifiers.

---

## Revenue Operating System v3 — Plan Commits, Gap-to-Plan, Auto-Tasks (Complete — Feature 8)

### What was added in v3
Monthly plan commitment workflow with real-time gap-to-plan scoring, gap driver analysis, AI-recommended gap-closure actions, one-click task automation, and historical snapshots for trend tracking.

**Schema additions** (via direct SQL migration):
- `revenue_plan_commits` — id, name, scenario_id FK, month_key (YYYY-MM), committed_revenue, baseline_revenue, stretch_revenue, notes, status (active/superseded/closed/draft), committed_by FK, created_at
- `revenue_gap_snapshots` — id, plan_commit_id FK, month_key, snapshot_date, committed/actual/forecast/projected revenue, gap_amount, gap_percent, created_at
- `revenue_simulator_actions` — 6 new v3 columns: priority, action_type, plan_commit_id FK, metric_target, metric_unit, completed_at

**`server/services/revenue-operating-system.ts`** (new service):
- `createPlanCommitFromScenario()` — creates/supersedes commits, links to simulator scenario
- `computeGapToPlan()` — computes actuals, CRM forecast, pace rate, gap amount+%, status (on_track/at_risk/off_track/no_commit), drivers
- `generateGapClosureActions()` — pure function: maps gap drivers → prioritised actions with metric targets
- `autoCreateTasksFromActions()` — converts actions to real tasks (dedup by title+source)
- `snapshotGapStatus()` — persists current gap state to `revenue_gap_snapshots`
- `buildRevenueExecutionBlock()` — assembles board pack execution summary block

**9 new API routes** in `server/routes.ts`:
- `GET /api/revenue-ops/plan-commits` — list all plan commits
- `POST /api/revenue-ops/plan-commits` — create a commit (supersedes prior active for same month)
- `PATCH /api/revenue-ops/plan-commits/:id` — update commit fields
- `POST /api/revenue-ops/plan-commits/:id/set-active` — reactivate a superseded commit
- `GET /api/revenue-ops/gap/:monthKey` — compute gap to plan for a month
- `POST /api/revenue-ops/gap/:monthKey/snapshot` — save current gap state
- `GET /api/revenue-ops/gap-history/:monthKey` — historical snapshots for a month
- `POST /api/revenue-ops/gap/:monthKey/actions` — generate gap-closure actions
- `POST /api/revenue-ops/actions/:id/create-task` — convert a gap action to a tracked task

**Board Pack integration** (`server/services/board-pack-scheduler.ts`):
- `generateAndDeliver` now calls `buildRevenueExecutionBlock()` in parallel
- Appends `revenue_execution` block to `payloadMeta`
- `formatReportAsHtml` renders an Execution Block section in board pack HTML emails

**Frontend** `client/src/pages/revenue-ops.tsx` (new page):
- Gap Scoreboard — 6 KPI cards (committed, actuals, projected, gap $, gap %, days elapsed), status badge (on_track / at_risk / off_track / no_commit)
- Gap Drivers panel — visual breakdown of volume/conversion/velocity/churn/expansion impact
- Gap-Closure Actions panel — collapsible, with one-click "Create Tasks" button for high+critical actions (dedup skipped automatically)
- Gap History chart — area chart of committed vs projected vs gap across saved snapshots
- Plan Commits table — all commits, active badge, "Set Active" action, superseded indicator
- New Commit Dialog — scenario prefill (auto-populates revenue from simulator), month picker, stretch target, notes
- Route: `/revenue-ops` registered in `App.tsx`; "Revenue Ops" added to sidebar under same Revenue section

**Test suite** `tests/revenue-ops.test.js`: 49 tests across 8 groups (CRUD, supersede, gap calc, snapshots, actions, task creation, board pack, regression)

---

## Smart Revenue Simulator v2 — CRM Integration + Board Pack (Complete — Feature 7+)

### What was added in v2
Full CRM-connected scenario intelligence: derive parameters from live pipeline data, track actions per scenario, pin the canonical scenario, toggle board-pack inclusion, and compare forecast vs actuals month by month.

**Schema additions** (via ALTER TABLE / CREATE TABLE migration):
- `revenue_scenarios` — 4 new cols: `is_pinned bool`, `board_pack_include bool`, `source_type text`, `snapshot_date timestamptz`
- `revenue_simulator_actions` (new table) — id, scenario_id FK, title, status (open/in_progress/done/dropped), notes, owner_name, linked_object_type, due_date
- `revenue_forecast_actuals` (new table) — id, month_key (YYYY-MM unique), forecast_amount, actual_amount, variance_amount, variance_pct, scenario_id FK

**`server/services/revenue-simulator-insights.ts`** (new service):
- `deriveScenarioFromCRM()` — queries live opps (180-day window) to compute avgDealSize, winRate, avgSalesCycleDays, implied SimParams, data coverage, and notes
- `generateScenarioActions(result)` — pure function: maps SimResult deltas → up to 7 recommended actions with title/rationale/priority/linkedObjectType
- `computeForecastVsActuals()` — joins revenue_forecast_actuals with pinned scenario projection to compute variance
- `chooseBoardPackScenario()` — picks board_pack_include=true scenario, falling back to is_pinned, for board pack reports

**8 new API routes** in `server/routes.ts`:
- `GET /api/revenue-sim/crm-baseline` — CRM-derived parameters + data coverage
- `GET /api/revenue-sim/forecast-vs-actuals` — forecast vs actuals with variance
- `POST /api/revenue-sim/actuals/upsert` — upsert monthly actual (YYYY-MM)
- `POST /api/revenue-sim/:id/pin` — toggle pin (one at a time — unpins others)
- `POST /api/revenue-sim/:id/board-pack-toggle` — toggle board pack inclusion
- `GET /api/revenue-sim/:id/actions` — list actions for scenario
- `POST /api/revenue-sim/:id/actions` — create action(s) (single or array)
- `PATCH /api/revenue-sim/actions/:id` — update action status/notes

**Board Pack integration** (`server/services/board-pack-scheduler.ts`):
- `generateAndDeliver` now calls `chooseBoardPackScenario()` in parallel with `composeReport()`
- Appends `revenue_simulator` block to `payloadMeta` when a scenario is selected
- `formatReportAsHtml` renders a Revenue Scenario section in board pack HTML emails

**Frontend** `client/src/pages/revenue-sim.tsx` (full rewrite):
- CRM Baseline dialog — data coverage badge, key stats, implies param changes, Apply button
- Forecast vs Actuals panel (collapsible) — bar chart with green/red variance bars, Add Actual dialog
- Pin button (📌) and Board Pack button (grid) on every saved scenario row
- Provenance badge — Manual / CRM Snapshot / Board Pack on every scenario
- Actions dialog — shows saved actions with status cycling (open→in_progress→done→dropped), batch save from generated recommendations
- Recommended Actions quick view in left panel (top 3 from current simulation)

**Tests**:
- `tests/revenue-simulator.test.js` — 55 tests, 0 failures (v1 regression suite)
- `tests/revenue-simulator-v2.test.js` — 48 tests, 0 failures (groups: CRM baseline, actuals/fva, v2 fields, pin/unpin, board-pack toggle, actions CRUD, board-pack integration, v1 regression)

### What was built in v1
Interactive scenario modelling tool that applies multipliers to the live opportunity pipeline and projects month-by-month revenue over up to 24 months.

**`server/services/revenue-simulator.ts`** (core service):
- `getBaseline(months)` — queries open opps, computes per-month weighted revenue
- `runSimulation(params)` — applies 8 scenario parameters: winRateMultiplier, dealSizeMultiplier, velocityWeeks, newPipelineDeals, newPipelineAvgSize, forecastCategory, churnRateMonthly, expansionRateMonthly
- Returns `{ months: MonthProjection[], summary: SimSummary }` with baseline + simulated per month, delta, deltaPct

## Predictive Score Feedback Loop (Complete)

### What was built
Closed-loop ML feedback system that tracks score predictions vs actual outcomes and continuously improves model quality.

**Schema** (3 new tables via direct SQL):
- `score_snapshots` — every score ever computed per entity/model, with delta tracking, confidence, and reasons
- `score_outcomes` — final outcomes (won/lost/churned/expanded/renewed) linked back to snapshot predictions
- `score_model_configs` — per-model configuration: display name, entity type, underperformance threshold, accuracy metrics, weight overrides, tuning recommendations

**`server/services/scoring-engine.ts` updated**:
- Added `confidence: number`, `confidenceLabel: "low"|"medium"|"high"`, `modelName: string` to `ScoreResult` interface
- All 6 score functions compute confidence from data completeness (0-100) and return `modelName`

**`server/services/feedback-engine.ts`** (new service):
- `snapshotScore()` — stores a score reading, skips duplicates within 1h, tracks delta from prior reading
- `recordOutcome()` — logs a final outcome, linking back to the most recent snapshot for predicted score/band
- `computeModelAccuracy(modelName)` — direction accuracy, band accuracy, avg score on win/loss, band breakdown, rep/region breakdown; persists to `score_model_configs`
- `getAllModelAccuracy()` — runs all 6 models in parallel
- `getTuningRecommendations(modelName)` — AI-style recommendations: score separation, band calibration, sample size guidance
- `getExplainabilityData(entityType, entityId)` — full explainability: current score + reasons + 30-point history + 7d/30d deltas + outcome + prediction accuracy
- `checkUnderperformance()` — returns models below threshold
- `getOutcomes()` — paginated, filterable outcome list
- `getFeedbackOverview()` — dashboard summary data

**`server/services/alert-engine.ts`**: Fixed `score_history` → `score_snapshots` reference

**Auto-snapshotting**: 5 existing score routes (`/api/scores/lead/:id`, `/api/scores/opportunity/:id`, `/api/scores/quote/:id`, `/api/scores/deployment/:id`, `/api/scores/account/churn/:id`) now fire a non-blocking snapshot on every score computation

**14 new API routes** under `/api/scores/`:
- `POST /api/scores/snapshot`, `POST /api/scores/outcome`
- `GET /api/scores/outcomes`, `GET /api/scores/snapshots/:entityType/:entityId`
- `GET /api/scores/accuracy`, `GET /api/scores/accuracy/:modelName`
- `GET /api/scores/recommendations`, `GET /api/scores/recommendations/:modelName`
- `GET /api/scores/explainability/:entityType/:entityId`
- `GET /api/scores/underperforming`, `GET /api/scores/feedback/overview`
- `GET /api/scores/model-configs`, `PUT /api/scores/model-configs/:modelName`
- `POST /api/scores/evaluate-all`

**Frontend** (`client/src/pages/score-feedback.tsx`) at `/scores/feedback`:
- 5-tab layout: Overview, Outcomes, Explainability, Recommendations, History
- Overview: per-model accuracy cards with band breakdown bars, re-evaluate button, recent activity feed
- Outcomes: outcome recording form + filterable list with predicted vs actual display
- Explainability: entity search → reasons list (✓/✗ per factor) + sparkline history + prediction accuracy verdict
- Recommendations: weight tuning suggestions grouped by model with improvement projections
- History: outcome timeline chart + outcome log with filters
- Sidebar link: "Score Feedback" under Intelligence section

**Tests** (`tests/score-feedback.test.js`): 64 tests, 0 failures covering all 7 sections

**Cumulative test totals**: 778 (prior) + 64 = 842 tests, 0 failures

## Field Execution Mobile Mode (Complete)

### What was built
A full mobile-first operating mode for on-site reps, installers, and traveling operators. No separate app — the existing web app is made fully usable on a phone.

**Phase 1 — Mobile Shell** (`client/src/index.css`)
- `.safe-area-bottom` CSS class using `env(safe-area-inset-bottom)` for iOS home indicator
- `-webkit-tap-highlight-color: transparent` for all interactive elements on mobile
- `slideUpIn` animation for field card transitions
- `pb-16 md:pb-0` already in App.tsx ensures content clears the bottom nav

**Phase 2 — Field Command Page** (`client/src/pages/field.tsx`)
- Route: `/field`
- Sticky header with date, item count, Nearby button, and refresh
- Sections: Overdue tasks, Due today, Priority Hot List (from scoring engine), Blocked installs, Hot opportunities, Hot leads
- All cards are swipe-enabled and tappable to act
- Uses `/api/dashboard/today`, `/api/scores/hot-list`, `/api/procurement/blocked-installs`

**Phase 3 — Swipe Action Cards** (`client/src/components/mobile/swipe-action-card.tsx`)
- Touch event-driven swipe-left to reveal colored action buttons
- Configurable action sets per entity type
- Tasks: Done (green), Snooze (amber), Note (blue)
- Leads/Opportunities: Note, Call, Email
- Installs: Note

**Phase 4 — Quick Log Modal** (`client/src/components/mobile/quick-log-modal.tsx`)
- Universal fast logging modal — Note | Call | Visit | Next Step tabs
- Attaches to any record type (lead, opportunity, install_workflow, general)
- ⌘+Enter to save; posts to `/api/notes`
- Defaults `linkedObjectType="general"`, `linkedObjectId=0` when no record selected
- Available in bottom nav (+ Log FAB), Field page, and Nearby page

**Phase 5 — Geo Context** (`client/src/pages/field-nearby.tsx`)
- Route: `/field/nearby`
- Browser geolocation API (`navigator.geolocation`)
- Calls `/api/leads/nearby?lat=&lng=&radius=`
- Radius filter: 10 / 25 / 50 / 100 km chips
- Cards show: name, status badge, distance, contact name/location, slips
- Quick actions: Call (tel:), Directions (Google Maps / Apple Maps), Note (QuickLog)
- Back button → `/field`

**Phase 6 — Mobile Navigation** (`client/src/components/dashboard/mobile-nav.tsx`)
- Bottom bar: **Home | Field | [+ Log FAB] | Accounts | Pipeline | More**
- Centre FAB is a raised circle button that opens QuickLogModal directly
- "More" opens full-screen panel with all nav groups (Command Center, Revenue, Operations, Intelligence, etc.)
- Field and Nearby added to More panel
- All buttons have `min-h-[44px]` for accessible touch targets

**Phase 7 — Tests** (`tests/mobile.test.js`)
- 69/69 passing — auth guards, field page APIs, nearby API (shape + sorting + error), quick log creation (note/call/visit/next step), task snooze, hot list shape, mobile nav destinations, desktop + scoring regression

### Key files
- `client/src/pages/field.tsx` — Mobile Field Command page
- `client/src/pages/field-nearby.tsx` — Geo context page
- `client/src/components/mobile/quick-log-modal.tsx` — Fast log modal
- `client/src/components/mobile/swipe-action-card.tsx` — Swipe action cards
- `client/src/components/dashboard/mobile-nav.tsx` — Redesigned bottom nav
- `tests/mobile.test.js` — 69 tests

### Cumulative test count
mobile.test.js 69 + scoring.test.js 135 + prior suites 520 = **724 tests, 0 failures**

---

## Predictive Scoring Layer (Complete)

### What was built
Deterministic, explainable predictive scoring across 6 business object types. All scores are rule-based with no black-box AI — every score shows the exact reasons it was computed.

**Score Types:**
1. **Lead Quality** (0-100) — Source quality, contact info, owner assigned, deal size, site size, status, recency, next step
2. **Opportunity Close** (0-100) — Stage base, quote attached, champion/buyer identified, close date proximity, activity recency, stalled flag
3. **Quote Follow-up Urgency** (0-100) — Status, days since sent, validity expiry, deal size, task coverage
4. **Deployment Delay Risk** (0-100) — Open blockers, overdue go-live, no actual start, no owner, stale updates
5. **Churn Risk** (0-100) — Health score/status, billing status, renewal timing, check-in recency, churn risk flags
6. **Expansion Likelihood** (0-100) — Expansion plans, potential, remaining contracted units, live slips, account health, activity level

**Score Engine** (`server/services/scoring-engine.ts`): Pure TypeScript functions, no DB access. Each returns `{ score, band, label, reasons[], scoredAt }`. Bands: low/medium/high/critical.

**API Routes** (all under `/api/scores/`):
- Bulk: `GET /api/scores/leads|opportunities|quotes|deployments/risk|accounts/churn|accounts/expansion`
- Single: `GET /api/scores/lead/:id|opportunity/:id|quote/:id|deployment/:id|account/churn/:id|account/expansion/:id`
- Hot list: `GET /api/scores/hot-list?limit=15` — top priority items across all entity types, sorted by band+score

**UI Components** (`client/src/components/scores/score-badge.tsx`):
- `ScoreBadge` — variants: `pill` (default), `compact`, `ring`, `inline`; shows tooltip with all reasons
- `ScorePanel` — expanded view with full reason list

**Hook** (`client/src/hooks/use-scores.ts`): `useLeadScores()`, `useOpportunityScores()`, `useQuoteScores()`, `useDeploymentRiskScores()`, `useChurnRiskScores()`, `useHotList(limit)` — all fetch bulk and return `Record<id, ScoreData>` maps. 5-min staleTime.

**UI Integration:**
- Leads table — "Quality" column with compact score badge (XL+ screen)
- Opportunities kanban — compact score badge below DealSignals on each card
- Deployments list — delay risk badge shown on high/critical cards
- Renewals — churn risk badge on upcoming renewal items (medium+ only)
- Sales Command Center — "Priority Hot List" widget (full-width) showing top items with type icon, name, action hint, score badge, and link

**Tests** (`tests/scoring.test.js`): 135/135 — auth guards, all 6 bulk endpoints, all 6 single endpoints, 404 handling, hot list (structure, sorting, custom limit), band logic (all valid, 0-100 range, all have reasons), scoredAt freshness, reason quality checks, regression across command-center/revenue/CS/automations.

### Key files
- `server/services/scoring-engine.ts` — pure scoring functions
- `client/src/components/scores/score-badge.tsx` — ScoreBadge + ScorePanel components
- `client/src/hooks/use-scores.ts` — data fetching hooks
- `tests/scoring.test.js` — 135 tests

### Running total test count
scoring.test.js 135 new — added on top of existing suites.
Prior totals: cs 44, oversight 70, geography 111, documents 20, documents-search-timeline 20, automations 38, board-pack 45, revenue 58, command-center 114 = 520 existing + 135 = **655 tests across key suites**

---

## Role-Based Daily Command Center 2.0 (Complete)

### What was built
An adaptive command center system that auto-detects the user's role (CEO/CFO/CTO/CMO/Sales/CS/Default) from their job title, department, and global role, then renders a purpose-built view populated from live API data.

**Schema** (`shared/schema.ts`): Added `preferredLayout` (text, default 'expanded'), `widgetVisibility` (jsonb), `defaultCommandCenter` (text) to users table.

**API** (`server/routes.ts`):
- `GET /api/users/me/profile` — extended user profile with all layout/role fields
- `PATCH /api/users/me/layout` — persist layout preferences with validation (preferredLayout must be expanded/compact, defaultCommandCenter must be valid center type, widgetVisibility must be object)
- `/api/auth/me` — extended to include department/jobTitle/userType

**Config Engine** (`client/src/lib/dashboard-config.ts`): `detectCenterType()` maps user profile → center type via title keywords → dept keywords → globalRole fallback. `buildDashboardConfig()` produces full widget list with per-widget visibility. `ALL_CENTER_TYPES` for admin preview dropdown.

**Executive Centers** (`client/src/components/command-centers/`):
- `ceo-center.tsx` — Executive snapshot, pipeline health (periods), revenue at risk (CS overview), cert blockers, deployment blockers, key accounts (risk-alerts signal)
- `cfo-center.tsx` — MRR overview, hardware revenue, pricing lock expiries, renewal exposure, billing anomalies, forecast pressure
- `cto-center.tsx` — Cert blockers, deployment blockers, install workflows at risk, procurement blocked, critical tasks
- `cmo-center.tsx` — Lead volume, source attribution, territory whitespace, pipeline by source, conversion by source

**Main Page** (`client/src/pages/role-command-center.tsx`): Full adaptive page including:
- My Layout / Role Default toggle
- Admin preview dropdown (preview any center type without changing default)
- Widget show/hide sheet with per-widget toggles + save/reset
- Compact/expanded layout mode toggle
- Inline Sales and CS center implementations
- Home route (`/`) now serves the Role Command Center

**Tests** (`tests/command-center.test.js`): 114/114 passing — auth/me fields, profile endpoint, layout persistence (preferredLayout/widgetVisibility/defaultCommandCenter), input validation, auth guards, all 6 underlying widget data endpoints, schema regression.

### Key files
- `client/src/lib/dashboard-config.ts` — center type detection + widget config
- `client/src/pages/role-command-center.tsx` — main adaptive page
- `client/src/components/command-centers/ceo-center.tsx`
- `client/src/components/command-centers/cfo-center.tsx`
- `client/src/components/command-centers/cto-center.tsx`
- `client/src/components/command-centers/cmo-center.tsx`
- `tests/command-center.test.js` — 114 tests

### API field notes (actual response shapes)
- `/api/executive/kpis`: `pipeline.totalOpps.current`, `quotes.winRate.current`, `installs.overdueInstalls`, `risks.overdueTaskCount`
- `/api/pipeline/forecast`: `{ periods: [...], summary: { commit, best_case, pipeline, closed_won, totalWeighted } }`
- `/api/executive/risk-alerts`: `{ stalledOpps, overdueTasks, installBlockers, awaitingQuotes, severity, distinctAtRiskCount }`
- `/api/cs/dashboard`: `{ overview: { renewalDue, churnRisk, active, totalArr, ... }, atRisk: [], upcomingRenewals: [] }`
- `/api/projects/cert-summary`: `{ total, blocked, at_risk, failure_open, certified, cert_expiring_90d, ... }`
- `/api/deployments/dashboard`: `{ overview: { total, blocked, commissioning, liveThisMonth, overdue }, blockedDeployments: [] }`

### Test totals (all suites)
cs.test.js 44/44, oversight.test.js 70/70, geography.test.js 111/111, documents.test.js 20/20, documents-search-timeline.test.js 20/20, automations.test.js 38/38, board-pack.test.js 45/45, revenue.test.js 58/58, command-center.test.js 114/114

## Executive PDF / Board Pack Export (All 7 Phases Complete)

### What was built
A leadership and board-ready report generation layer that composes live data from all VoltSafe modules.

**Phase 1 — Report Data Composer** (`server/services/report-composer.ts`): Assembles board-ready data from direct DB queries across all modules — KPI summary, pipeline forecast, quote snapshot, installs/deployments, procurement risks, certification oversight, customer success/renewals, geography/territory, source attribution, and risks/blockers.

**Phase 2 — Board Pack UI** (`client/src/pages/board-pack.tsx`): Full builder page at `/board-pack` with report type selector (5 types), date range presets, region filter, 11 section toggles (enable/disable individually), saved presets sidebar, and live preview panel.

**Phase 3 — Export Output**: Download as HTML (clean branded file), Download as Markdown (structured), and Print/PDF via browser print dialog with `@media print` CSS (VoltSafe branded, portrait-optimised).

**Phase 4 — Report Sections**: 11 reusable section components — KPI grid, pipeline table, quote snapshot, installs, procurement, certification, customer success, geography, source attribution, risk/blockers, narrative.

**Phase 5 — Narrative Layer**: Deterministic auto-generated summary bullets derived from live metrics (pipeline size, stalled opps, win rate, renewal exposure, source attribution, certification blockers, territory leader).

**Phase 6 — Saved Report Configs**: `report_presets` table + full CRUD (`GET/POST/PUT/DELETE /api/reports/presets`) for saving named presets (name, report type, date range, included sections).

**Phase 7 — Tests**: `tests/board-pack.test.js` 45/45.

### Key files
- `server/services/report-composer.ts` — multi-section data composer
- `client/src/pages/board-pack.tsx` — board pack builder UI
- `shared/schema.ts` — `report_presets` table (added at end)
- `tests/board-pack.test.js` — 45 tests

### API endpoints
- `GET /api/reports/types` — 5 report type definitions
- `GET /api/reports/sections` — 11 section definitions with defaultFor maps
- `POST /api/reports/compose` — compose report data (reportType, dateFrom/To, region, sections)
- `GET/POST /api/reports/presets` — list/create presets
- `GET/PUT/DELETE /api/reports/presets/:id` — single preset CRUD

### Report types
executive_weekly, monthly_leadership, board_pack, fundraising_snapshot, ops_review

### Report sections (11)
kpi_summary, pipeline_forecast, quote_snapshot, installs_deployments, procurement_risks,
certification_oversight, customer_success, geography_territory, source_attribution,
risk_blockers, narrative_bullets

## Advanced Automation Builder (All 7 Phases Complete)

### What was built
A rule-based automation layer integrated across CRM, quotes, deployments, certification, procurement, customer success, and documents.

**Phase 1 — Schema**: `automation_rules` and `automation_run_logs` tables added to `shared/schema.ts` and migrated to PostgreSQL.

**Phase 2 — Condition Engine** (`server/services/automation-engine.ts`): Deterministic condition evaluator supporting `equals`, `not_equals`, `contains`, `in`, `date_within_days`, `date_overdue`, `changed_to`, `changed_from`, `is_null`, `is_not_null`, `gt/gte/lt/lte`, AND/OR chaining.

**Phase 3 — Action Engine**: Executes `create_task`, `create_suggestion`, `create_notification`, `add_timeline_event`, `change_status`, `flag_record`, `assign_owner` against real DB records.

**Phase 4 — Backend Routes** (`server/routes.ts`): Full CRUD for automation rules + toggle, manual run, run history, condition preview, metadata endpoints (trigger-types, condition-ops, action-types). Seed function for starter templates.

**Phase 4 — Frontend** (`client/src/pages/automations.tsx`): Automation Builder page at `/automations` with rule list (grouped: templates / custom), enable/disable toggle, rule editor dialog (trigger selector, condition builder, action builder), run rule dialog (with dry-run), run history dialog, and search/filter controls.

**Phase 5 — Safety**: Cooldown windows enforced per-rule; dry-run mode returns `skipped=true` for all actions without side effects; dedupe key support.

**Phase 6 — Starter Templates**: 7 VoltSafe templates auto-seeded on first boot (idempotent): Quote Accepted → Onboarding, Deployment Blocked → Ops Alert, Cert Retest Required, Renewal Due 90 Days, Lab Report Added → Timeline Alert, Quote Not Opened → Follow-up, Install Workflow Overdue → Escalation.

**Phase 7 — Tests**: `tests/automations.test.js` 38/38.

### Key files
- `server/services/automation-engine.ts` — condition/action engine
- `client/src/pages/automations.tsx` — full automation builder UI
- `tests/automations.test.js` — 38 tests

### Supported triggers (13)
record_created, field_changed, status_changed, date_approaching, date_overdue, task_overdue, quote_accepted, deployment_blocked, certification_blocker, renewal_due, document_added, engagement_signal, manual

### Supported actions (7)
create_task, create_suggestion, create_notification, add_timeline_event, change_status, flag_record, assign_owner

## Overview

**VoltSafe Growth OS** is VoltSafe's internal sales intelligence and CRM platform for marina-focused sales, support, and relationship management. It features a comprehensive sales pipeline (Leads to Quotes), support ticketing, a marina directory, communication tools, and an analytics dashboard. **Cortex** is the embedded AI assistant within the platform.

### Smart Document Hub (all phases complete)

**Phase 5 — Global Search Integration**
- `GET /api/search` UNION branch: searches `title`, `original_name`, `notes`, `category`, `tags`; returns `type="document"`, `sub=category`, `sub2="ObjectType · record name"`, `linked_id="objectType:objectId"`, LIMIT 4.
- `header.tsx` updated: `SearchResultItem` includes `"document"`, `BookOpen` icon; `SEARCH_TYPE_META` / `TYPE_ORDER` updated; `navigateToResult` and `open-linked` action parse `linked_id` as `objectType:objectId`.

**Phase 6 — Timeline / Audit Events**
- Upload notable categories (certification, contract, lab_report, quote_proposal) → activity emitted.
- URL link with notable category → activity emitted.
- DELETE attachment → "Document removed" activity logged before row deletion.
- PATCH category change → "Category changed" activity logged only when value actually changes.
- Timeline attachment `body` now shows `Category · external link` or `Category · X KB` (not raw mime type); `title` field used with fallback chain.

**Tests**: `tests/documents-search-timeline.test.js` 20/20; `tests/documents.test.js` 20/20.

### Smart Document Hub (complete)
- **Schema**: Extended `attachments` table with new columns: `title`, `category` (default `general`), `notes`, `tags text[]`, `source` (upload/link), `url`. Migration: `migrateDocumentSchema()` in seed-production.ts runs idempotently via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- **Supported object types (broadened)**: `lead`, `account`, `partnership`, `contact`, `opportunity`, `quote`, `install_workflow`, `deployment`, `purchase_order`, `project`, `customer_success`, `general`.
- **File types (broadened)**: Now accepts images, video, PDF, Word, Excel, PowerPoint, CSV, TXT, ZIP (not just image/video).
- **11 document categories**: quote_proposal, contract, certification, lab_report, drawing_spec, install_doc, deployment_photo, procurement_po, invoice_billing, cs_renewal, general.
- **Document Hub page** (`/documents`): Full-page hub with search, category chips, object-type filter, source filter (upload/link), recent docs grid, master-detail list view with detail panel (edit metadata, download, delete, open URL). Upload modal + Link URL modal.
- **API**: `GET /api/documents` (hub listing with filters: category, objectType, search, limit, offset); `POST /api/documents/link` (URL linking); `PATCH /api/attachments/:id` (metadata update — owner-or-admin gated).
- **Enhanced AttachmentsSection**: All record pages now show category badges, download links, URL open links, and "Link URL" option alongside file upload. Category selector before upload.
- **Nav**: "Document Hub" entry added to Operations section in sidebar.
- **Tests**: `tests/documents.test.js` — 20/20 assertions pass (auth guard, URL linking, file upload, hub listing, record linkage, metadata update, deletion, no regression).

### Territory + Geographic Intelligence Layer (complete)
- **Schema**: `territories` table (id, name, code, owner_user_id, status, notes, color, regions, countries); `territory_id` FK added to `accounts` and `leads`; `region` field added to `leads` for region normalization.
- **Territory CRUD**: Full REST — `GET/POST /api/territories`, `GET/PATCH/DELETE /api/territories/:id`; search + status filter support; account/lead count rollups in list + detail.
- **Assignment**: `POST /api/territories/:id/assign` (bulk assign accounts + leads); `POST /api/territories/:id/unassign`; `PATCH /api/accounts/:id/territory`; `PATCH /api/leads/:id/territory`.
- **Geo Analytics**: `/api/analytics/geo/overview` (region-level rollup: accounts/leads/deployments/customers/ARR); `/api/analytics/geo/territories` (per-territory rollup); `/api/analytics/geo/whitespace` (regions with leads but no accounts, accounts with no deployments); `/api/analytics/geo/win-rate` (win rate + revenue by region); `/api/analytics/geo/accounts` + `/api/analytics/geo/leads` (filtered by region/territory/country).
- **Geography UI** (`/geography`): 5-tab page — Region Overview (card grid + detail pane), Territories (CRUD table + TerritoryForm), Whitespace (leadsWithoutAccounts + accountsWithoutDeployments), Analytics (win-rate bar chart table), Saved Views (BC, Ontario, SoCal, Great Lakes, Atlantic, Pacific NW quick-filter chips).
- **Nav**: Globe icon "Territory & Geo" item added to Intelligence section in sidebar.
- **Tests**: `tests/geography.test.js` — 111 assertions; 0 failures. All 217 prior CS/oversight tests still pass.

### Certification Oversight Layer (complete)
- **CertSummaryStrip**: Live dashboard banner on /projects showing total/blocked/at-risk/on-track/retest/certified/expiring-90d counts + due-soon items; clicking a stat activates the cert quick-filter.
- **Cert quick-filter chips** (Phase 2): Second filter row on /projects for All Certification / Blocked / Retest Required / Due in 30 days / Cert Expiring / Passed+Certified — maps to `?certFilter=` backend param.
- **Attachments** (Phase 3): Drag-and-drop + click-to-upload file attachments per certification project; stored in `uploads/cert-attachments/`; metadata in `project_attachments` table; download via signed GET route; delete with disk cleanup. Shown as "Attachments" section in `CertificationDetailPanel`.
- **Timeline** (Phase 4): `project_timeline_events` table; auto-emitted events: `status_change`, `launch_blocker_on`, `launch_blocker_off`, `retest_required`, `cert_issued`, `milestone_done`, `attachment_added`. Rendered in a "Timeline" tab (cert projects only) with icon + color per event type.
- **Tests**: `tests/oversight.test.js` — 70 assertions covering all four phases (100% pass rate).

### Dual-Brand Architecture
- **Platform name:** VoltSafe Growth OS — shown in sidebar, login, browser tab, emails, all UI surfaces
- **AI assistant name:** Cortex — the in-app chatbot/AI layer (formerly "Cortex AI")
- **Tagline:** "Your marina sales intelligence platform"
- **Centralized branding constants:** `client/src/lib/branding.ts` exports `PLATFORM_NAME`, `ASSISTANT_NAME`, `TAGLINE`, and the `BRANDING` object with derived strings (askAssistant, assistantSuggestions, assistantSearch, assistantBriefing, assistantSubtitle)

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

### Permission System
- **Granular per-user permissions**: `permissions` JSONB column on `users` table, allowing section-level `AccessLevel` ("none" | "view" | "edit") for various modules.
- **Team Inbox Permissions**: `mail_team` map controls access to shared Gmail inboxes.
- **Calendar Overlays**: `calendar_team` array for overlaying team members' calendars.
- **Enforcement**: Both backend middleware (`requirePermission`) and frontend guards (`guard`) enforce permissions. An Admin UI provides comprehensive management of user permissions.

### Navigation: Growth OS
The sidebar is organized under a **Growth OS** umbrella — the central module for all revenue, partnership, and pipeline activities. Structure:
1. **Command Center** — Dashboard, Activity Feed, Reports, Forecasting
2. **Relationships** — Contacts, Organizations, Notes, Tasks
3. **Revenue Engine** — Opportunities, Pipeline, Deals, Data Quality, Install Workflows, Renewals, Quotes
   - **Command Center** also includes: Source Attribution (`/analytics/source-attribution`), Executive Dashboard (`/executive-dashboard`)
4. **Growth Channels** — Industry Partnerships, Dealers/Resellers, Strategic Alliances, Investors, Govt & Grants, Referrals, Media & Tradeshows
5. **Intelligence** — Inbox, Calendar, Meeting Briefs, Signals & Alerts, Rel. Intelligence
6. **Operations** — Segments, Tags, Automations, Imports/Exports, Projects, Communications, Assets, Price Lists

The sidebar also includes a **search box** that filters all nav items in real time. Stub pages (`/renewals`, `/segments`, `/tags`, `/automations`, `/imports`) show a "Coming Soon" placeholder. All existing URLs are preserved.

### Relationship Intelligence Profile Pages
Clickable detail pages for every CRM entity:
- **`/contacts/:id`** — ContactProfilePage: header card, suggested action banner, NoteComposer, related emails/meetings/tasks. Powered by `GET /api/contacts/:id/profile`.
- **`/accounts/:id`** — AccountProfilePage: same layout + contacts list. Powered by `GET /api/accounts/:id/profile`.
- **`/opportunities/:id`** — OpportunityProfilePage: same + deal stage bar, stakeholders list. Powered by `GET /api/opportunities/:id/profile`.
- Contacts list rows are clickable (→ `/contacts/:id`). Pipeline cards titles link to `/opportunities/:id`. AccountDetailDialog has "Intelligence Profile" button.

### Record Summary Bar + Relationship Health
A compact activity/health strip added to every CRM profile surface.
- **Component:** `client/src/components/record-summary-bar.tsx` (`RecordSummaryBar`)
  - Props: `objectType` ("account" | "contact" | "opportunity" | "lead" | "partner"), `objectId`, `compact?` (boolean, default false)
  - Shows: health badge (score 0–100, label), last inbound email, last outbound email, last note, last activity, open tasks (with overdue highlighted red), open deals + pipeline value, contacts count, attachments count
  - Warning strip for: no outbound 21d, no touch 30d, inbound stale 45d, overdue tasks, stale opportunity
  - Tooltips on hover for every metric pill; health badge tooltip shows score breakdown
- **API Endpoint:** `GET /api/record-summary/:objectType/:objectId`
  - Permission: `requirePermission("crm", "view")`
  - Returns standardized shape for all 5 object types
  - Health scoring: base 100, touch recency deductions, inbound warmth bonus/deduction, overdue task penalty, stale opportunity penalty; clamped 0–100
- **Integration points:**
  - `account-profile.tsx` — full bar between identity card and main grid
  - `contact-profile.tsx` — full bar between identity card and main grid
  - `opportunity-profile.tsx` — full bar between identity card and main grid
  - `leads.tsx` — compact bar inside LeadDetailDialog (below header)
  - `partnerships.tsx` — compact bar inside PartnerDetailDialog (below header)

### Daily Command Center (`/`)
The primary landing page after login — a cockpit-style CRM intelligence hub that shows what needs attention today.

- **Route:** `/` (DailyCommandCenter component replaces old CommandCenter; old CommandCenter moved to `/command-center`)
- **API Endpoint:** `GET /api/daily-command-center?view=mine|team` — `requireAuth` + `requirePermission("crm","view")`
  - Returns 7 sections, each with `count` + `items` arrays
  - Admin users can switch to `view=team` to see all records across the team
  - Viewers and non-admins always get `viewMode="mine"`
- **7 Dashboard Sections:**
  1. **Overdue Tasks** — Tasks past due date; items include `days_overdue`, `linked_object_name`, `severity`, `deepLink`
  2. **Suggested Actions** — Live pull from `task_suggestions` table (pending, not snoozed/cooldown); shows `reason`, `suggested_action_label`
  3. **Inbox Follow-Ups Needed** — Inbound emails ≤14 days old with no outbound reply since; severity always high
  4. **Relationships At Risk** — Accounts with `last_interaction_at > 21 days ago` or NULL, sorted by open deal value DESC
  5. **Stale Deals** — Open opportunities with no activity in 21+ days; sorted by amount DESC
  6. **New / Unlinked Emails** — Inbound emails with no `source_account_id`, last 30 days
  7. **This Week's Priorities** — Tasks due next 7 days + calendar meetings next 7 days
- **UI Features:**
  - Greeting header + urgency banner (shows total overdue + follow-ups count when > 0)
  - Stat strip: 6 count pills for quick snapshot
  - 2-column layout (xl breakpoint): 5 primary sections left + 2 sidebar sections + Quick Links right
  - Severity color coding: red (high), amber (medium), blue (low); dot indicator per row
  - Hover-reveal action labels with ArrowRight icon per row
  - Click-through deep links to record profiles for every item
  - Empty states with witty contextual messages per section
  - Skeleton loading states while fetching
  - Auto-refresh every 5 minutes
  - `generatedAt` footer timestamp
- **Ranking Logic within sections:**
  - `overdueTasks`: sorted by `due_date ASC` (oldest first); severity = high if >7d, medium if >3d, else low
  - `suggestedActions`: sorted by severity DESC then created_at ASC
  - `accountsAtRisk`: sorted by `open_deal_value DESC`, then `last_interaction_at ASC NULLS LAST`
  - `staleOpportunities`: sorted by `amount DESC NULLS LAST`, then `days_stale DESC`; severity = high if >$10k, medium if >$2k
  - `inboxFollowUps`: sorted by `sent_at DESC`

### Signal-Driven Task Suggestions
A deterministic, explainable task suggestion engine that surfaces the next best action for each CRM record based on relationship signals.

- **Signal Engine:** `server/services/signal-engine.ts` — pure function `computeSignals(input: SignalInput): Signal[]`
  - Evaluates 11 signals in priority order: `overdue_task`, `recent_inbound_no_followup`, `high_value_stale_opp`, `stale_open_opp`, `no_inbound_45d`, `health_stale`, `no_outbound_21d`, `no_inbound_30d`, `health_at_risk`, `no_inbound_14d`, `health_cooling`
  - Each signal outputs: `signalType`, `severity` (low/medium/high), `title`, `reason`, `suggestedActionType`, `suggestedActionLabel`, `priority`, `suggestedDueDays`
- **DB Table:** `task_suggestions` (id, object_type, object_id, signal_type, severity, title, reason, suggested_action_type, suggested_action_label, priority, suggested_due_date, status, snoozed_until, created_task_id, dismissed_at, accepted_at, source_signals)
- **API Endpoints:**
  - `GET /api/suggestions/:objectType/:objectId` — `requirePermission("crm","view")` — Returns top 3 active suggestions; creates DB rows on first visit; respects cooldown windows (dismissed: 7d, accepted: 3d, snoozed: until date)
  - `POST /api/suggestions/:id/accept` — `requirePermission("crm","edit")` — Marks accepted + optionally creates a real task (`createTask=true`)
  - `POST /api/suggestions/:id/dismiss` — `requirePermission("crm","view")` — Suppresses for 7 days
  - `POST /api/suggestions/:id/snooze` — `requirePermission("crm","view")` — Suppresses until `NOW() + days` (1–90 days)
- **UI Component:** `client/src/components/suggested-actions-card.tsx` (`SuggestedActionsCard`)
  - Props: `objectType`, `objectId`, `compact?`, `onOpenNoteComposer?`, `onScrollToSection?`
  - Renders as a Card with severity badges, reason tooltip, and Accept/Dismiss/Snooze actions per row
  - Hidden when suggestions array is empty (returns null — no empty state shown)
  - Smart actions: `add_note` scrolls to notes section; `review_opportunity`/`complete_task` scrolls to relevant section
- **Integration:** Added below the RecordSummaryBar on `account-profile.tsx`, `contact-profile.tsx`, `opportunity-profile.tsx`
- **Deduplication / Cooldown:** Dismissed suggestions re-surface after 7 days; accepted ones after 3 days; snoozed ones after the chosen duration

### Activity Feed (`/activity`)
Real aggregated activity timeline replacing the "Coming Soon" stub. Pulls from `notes`, `email_messages`, `calendar_events`, `tasks`, and `activities` tables via `GET /api/activity-feed`. Features per-type filter tabs (Note/Email/Meeting/Task/Activity) and live text search. Auto-refreshes every 2 minutes.

### Notes Page (`/notes`)
Full CRUD notes module replacing the "Coming Soon" stub. Powered by `GET /api/notes/all` (new endpoint; supports type + search filters). Supports create (Add Note dialog), inline edit, and delete with entity cross-linking (contact / account / opportunity with clickable links to their profile pages).

"CRM" label renamed to "Growth OS" across: sidebar, mobile nav, admin user permissions UI, calendar event dialog tabs (now "Relationships"), voice assistant description, and login page.

### Core CMS Modules
- **Authentication:** Session-based authentication with `bcryptjs` and WebAuthn for biometric login. All API endpoints are protected.
- **Sales (Growth OS):** Manages leads, accounts, contacts, and quotes with Kanban, list, and map views. Includes lead conversion workflows and bidirectional navigation between leads and organizations. Opportunities are integrated into leads.
- **Address Autocomplete & Maps:** Reusable `AddressAutocomplete` component with Nominatim integration. Interactive Leaflet maps with CARTO Voyager basemaps for nearby marinas and dashboards.
- **Calendar:** Internal calendar system with day/week/month views and user-specific event management. Includes calendar sync with external providers (Google Calendar OAuth, Apple iCloud / generic CalDAV). Provider cards in Settings → Calendar Integrations. Sync runs on-demand via "Sync" button on calendar page or per-provider in settings. Two-way sync supported for Google Calendar (pull + push). CalDAV/Apple is pull-only. Microsoft 365 is planned (Coming Soon). New table: `calendar_connections`. New columns on `calendar_events`: `external_id`, `external_provider`, `external_calendar_id`.
- **Support:** Ticketing system with Kanban board and list views.
- **Communications:** Manages broadcast lists and campaign drafts.
- **Comments & Collaboration:** Threaded comments, user assignment, and action item creation.
- **Partnerships:** Tracks 7 categories of partnerships.
- **Ecosystem:** Manages Organizations, People, Relationships, Events, and Regions.
- **Activity & Tasks:** Universal timeline for activities and task management.
- **Unified Record Timeline:** `TimelineTab` component (`client/src/components/timeline-tab.tsx`) renders a chronological feed on Contact, Opportunity, and Account profile pages. Backend: `GET /api/timeline?objectType=X&objectId=Y` UNION-queries notes, activities, attachments, emails, **tasks**, **quotes** (account/opp only), and **stage_changes** (opportunity only via `deal_stage_history`). Per-record shortcut endpoints: `GET /api/timeline/account/:id`, `/lead/:id`, `/contact/:id`, `/opportunity/:id`. Type filters: all 7 types supported. Composer shortcuts for Note/Task/Activity at the top of the feed. Pagination: 50 items shown initially with "Load more" button. Audit logging: `PUT /api/leads/:id` logs status-change and owner-change activities. `PUT /api/opportunities/:id` already creates `deal_stage_history` + activity rows. Stage-change activities are deduplicated — they surface as `stage_change` type (not `activity`) on the opportunity timeline. Test suite: `tests/timeline.test.js` (55 assertions).
- **Lead Conversion + Dedupe:** Full multi-step lead-to-Account+Contact+Opportunity conversion flow with duplicate detection. Schema: `leads` table has `converted_account_id`, `converted_contact_id`, `converted_opportunity_id`, `converted_at` columns (SQL-migrated). Backend: `GET /api/leads/:id/convert-check` returns both `matches` (account dupes by domain/name) and `contactMatches` (by exact email or name similarity). `POST /api/leads/:id/convert` accepts `existingAccountId`, `existingContactId`, `skipContact`, `createOpportunity`, `opportunityTitle/Amount/Stage`, `fieldOverrides` — creates/links Account+Contact+Opportunity, stores converted IDs on lead, creates `lead_converted` activity on both lead and account timelines, creates handoff note on account (if lead had notes), migrates email associations. `GET /api/leads/:id/linked-org` returns `{account, contact, opportunity}` using `convertedAccountId`/`convertedContactId`/`convertedOpportunityId`. Frontend: 4-step `ConvertToOrgDialog` — Step 1 (Dedupe: shows account + contact matches with "Use" buttons), Step 2 (Configure: account new/link, contact new/link/skip, opportunity toggle), Step 3 (Field Review: name, orgType, contact fields, opp fields — auto-skipped if nothing to edit), Step 4 (Confirm: summary card + convert button). Test suite: `tests/lead-conversion.test.js` (18 assertions).
- **Outbound Email Engagement Tracking:** Privacy-safe open/click tracking injected into all CRM-outbound emails. Schema: `email_tracking_pixels` (one row per sent email — `tracking_id`, `gmail_message_id`, `subject`, `recipient_email`, `sent_by_user_id`, `engagement_score`, `signal_level`, `is_hot`, `last_scored_at`), `email_engagement_events` (per event — type: open|click, `ip_hash` SHA-256+salt, `user_agent` up to 500 chars, `is_bot`, `is_duplicate`, `timeline_created`), `email_engagement_rules` (table-driven automation — `trigger_type`, `trigger_config` JSONB, `min_events`, `action_type`, `action_config` JSONB, `cooldown_hours`), `email_rule_triggers` (cooldown tracking per rule+pixel). Service: `server/tracking.ts` — `generateTrackingId()` (UUID), `hashIp()` (HMAC-SHA256 16-hex), `isBotUserAgent()` (30+ patterns), `injectTracking()`, `computeScore()`, `updateScore()`. Public routes: `GET /track/open/:trackingId.gif`, `GET /track/click/:trackingId?url=...`. Auth routes: `GET /api/email-engagement/:trackingId`, `GET /api/email-engagement/by-message/:gmailMessageId` (returns score/signalLevel/isHot). Rules CRUD: `GET|POST|PATCH|DELETE /api/email-engagement-rules` (accept triggerConfig, cooldownHours). Frontend: `EmailsTab` shows signal badges (Hot/Clicked/Active/Opened) on outbound email rows using score from crm-emails batch join; `EngagementPanel` shows score bar, signal level, isHot indicator, timeline. Test suite: `tests/email-engagement.test.js` (37 assertions).
- **Engagement-Driven Follow-Up Automations:** Extended rules engine that fires actions based on recipient engagement signals. Scoring: opens→10/20/30pts (1/2/3+), clicks→+40/55pts (1/2+); signal levels: none/low/medium/high/hot; is_hot = score≥70 OR (3+ opens AND 1+ click). Trigger types: `first_open`, `repeated_open`, `first_click`, `pricing_link_clicked` (urlPattern match), `no_open_after_days`, `opened_no_reply_after_days` (time-based). Action types: `create_notification`, `create_task`, `mark_hot`, `bump_priority`, `add_timeline`. Cooldown: `email_rule_triggers` table prevents duplicate fires within `cooldown_hours` window. Scheduler: `server/services/engagement-scheduler.ts` runs time-based checks every 6h. Defaults: `server/services/engagement-defaults.ts` seeds 6 B2B rules on first startup. Rules engine: `server/services/engagement-rules.ts`. Test suite: `tests/engagement-automations.test.js` (12 assertions).
- **Engagement Gap Guardrails:** Reply-signal detection and suggestion creation added to the engagement engine. DB: added `is_replied boolean DEFAULT false` to `email_tracking_pixels`. New trigger type: `replied` — fires when a tracked outbound email's thread receives a real inbound reply (detected via `processReplyForThread()` called from `computeAwaitingReply()`). New action type: `create_suggestion` — inserts a row into `task_suggestions` with deduplication by `source_signals` key (format: `eng_sug_rule{ruleId}_{trackingId}_{objectType}_{objectId}`) within cooldown window; links suggestions to all CRM associations of the thread. Reply signal priority: `updateScore()` preserves `signal_level='replied'` via CASE WHEN guard when `is_replied=true` (prevents open/click events from downgrading). Signal hierarchy (highest→lowest): replied > hot > clicked(high) > opened_repeatedly(medium) > opened(low) > unopened(none). Frontend: `EmailItem` type extended with `isReplied: boolean`; `SignalBadge` component resolves `isReplied ? "replied" : isHot ? "hot" : level` — replied badge overrides all other states; `hasSignal` logic includes `isReplied`. Routes: signal map batch query now fetches `is_replied` from pixels and exposes `isReplied` per email message. `processReplyForThread(gmailThreadId)` in `server/tracking.ts` scans for outbound pixels with inbound replies after pixel creation date, marks `is_replied=true` and fires `replied`-trigger rules. Test suite: `tests/engagement-guardrails.test.js` (12/12 assertions).
- **Cortex AI Voice Assistant:** Slide-out sidebar powered by OpenAI, supporting voice/text input, markdown, conversation history, and CRM write capabilities via tool calling.

### Daily Command Center (Growth OS Command Center)
- **Command Center (`/`):** Default landing screen — greeting header, 7 stat cards (open opps, hot deals, overdue, meetings today, partnerships, investor convos, govt/grants), Today section (meetings + tasks), Needs Attention (overdue tasks, stalled deals, no next step), Pipeline Momentum, Partnership Activity, Relationship Activity, Intelligence panel, and Suggested Actions. Supports Mine/Team view toggle for admins. Powered by `GET /api/command-center?view=mine|team`.
- **Today Dashboard (`/today`):** Personal daily briefing page — shows today's meetings, tasks due today, overdue tasks, hot opportunities, new leads this week, recent activity, and AI-suggested actions. Powered by `GET /api/dashboard/today`.
- **Pipeline Health (`/pipeline`):** Multi-tab pipeline management view — Stalled Deals, No Next Step, High Value, Revenue Forecast, and By Owner tabs with inline stage advance. Powered by `GET /api/pipeline/insights`.
- **Quick Capture:** Global floating "+" button (bottom-right) + Cmd/Ctrl+K shortcut opens a 5-tab capture dialog (Note, Task, Contact, Opportunity, Meeting Note). Wired globally in App.tsx. Opens programmatically via `window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "task" } }))`.
- **Persistent Notifications System:** Bell icon in header opens a popover with a numeric badge (count >0). Notifications are persisted to the `notifications` DB table (per-user, with `type`, `severity`, `isRead`, `dedupeKey`, `expiresAt`). 7 signal types: `overdue_task`, `reminder`, `stale_opportunity`, `account_at_risk`, `inbox_followup_needed`, `meeting`, `lead`. Deduplicated with daily/weekly cooldowns. Refreshes every 60s. Full endpoints: `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`, `GET /api/notifications/digest`. NotificationPanel shows unread count, "Mark all read" button, severity color-coding, read/unread dim state, and timestamp. Test suite: `tests/notifications.test.js` (45 assertions).
- **Task Reminders:** `reminder_at` column on `tasks`. `POST /api/tasks/:id/reminder` accepts `preset` (`later_today`=+3h, `tomorrow_morning`=next-day 9am, `next_week`=+7d 9am) or ISO `reminderAt`. `DELETE /api/tasks/:id/reminder` clears it.
- **Tasks Hub (`/execution/tasks`):** First-class execution queue page. Tab views: My Tasks, Team Tasks, Due Today, Overdue, Upcoming, Completed — each with live count badges. Grouping by: Due Date, Priority, Linked Record, Assignee (dropdown). Task rows show priority dot, overdue age, account link, owner. Fast inline actions on hover: complete (circle toggle), snooze (preset picker: later today / tomorrow / next week), reassign (user picker), change due date (date picker). Keyboard shortcut `/` to focus search. Empty states per view. Overdue rows highlighted red. Integrates `source` (manual/suggestion/email/automation) and `snoozed_until` fields. Test suite: `tests/tasks-hub.test.js` (81 assertions). Route: `/execution/tasks`. Legacy `/tasks` redirects here.
- **Tasks model extended:** Added `source` (text, default `manual`) and `snoozed_until` (timestamp) columns. Quick-action API: `POST /api/tasks/:id/complete`, `POST /api/tasks/:id/snooze` (preset or ISO), `POST /api/tasks/:id/reassign`. Hub API: `GET /api/tasks/hub?view=<view>&groupBy=<groupBy>` returns tasks with user/account joins, grouped results, and 5 count badges.
- **PUT /api/tasks/:id** now converts date strings (dueDate, reminderAt, snoozedUntil) to Date objects before passing to storage.
- **Task Suggestions Layer:** `server/services/global-suggestions.ts` runs 6 deterministic rules across all CRM records to generate task suggestions (unanswered email, stale lead, missing next step, quote follow-up, account needs attention, overdue task reminder). Results are upserted into `task_suggestions` with cooldowns: 7-day dismiss, 3-day accept. API: `GET /api/tasks/suggestions` (returns `{suggestions, total}`), `POST /api/tasks/suggestions/:id/accept` (creates real task from suggestion), `POST /api/tasks/suggestions/:id/dismiss`, `POST /api/tasks/suggestions/:id/snooze`. Accept preserves source/sourceLabel/confidence on created task. Test suite: `tests/task-suggestions.test.js` (151 assertions).
- **Task Rule Configs:** `task_rule_configs` table stores 6 configurable rules with thresholdValue, thresholdUnit, isEnabled, assigneeStrategy, defaultAssigneeUserId. API: `GET /api/task-rules`, `PUT /api/task-rules/:ruleId`. Only `crm:edit` users can PUT.
- **Task Rules Settings page (`/automation/tasks`):** Admin page to configure automation rule thresholds, enable/disable rules, and set assignee strategy per rule. Linked from Operations sidebar under "Task Rules" and from the Tasks Hub "Suggestions" tab.
- **Suggestions tab in Tasks Hub:** Seventh tab "Suggestions" (Sparkles icon) added to Tasks Hub. Shows global suggestion cards with: title, reason, severity badge, source badge, confidence score, linked record, suggested due date. Action buttons: Accept (creates task), Snooze (1/7 days), Dismiss. Links to `/automation/tasks` to configure rules. Badge count shown in tab. Query: `GET /api/tasks/suggestions` (lazy loaded only when tab active).
- **tasks table extended:** Added `source_label` (text), `source_meta` (jsonb), `dismissed_at` (timestamp), `dismissed_by` (integer) columns.
- **task_suggestions table extended:** Added `suggested_assignee_id` (integer), `confidence` (integer, default 50), `source_label` (text), `dismissed_by` (integer) columns.
- **AI Meeting Briefing:** "Briefing" tab (✨ icon) in the EventDetailDialog on the Calendar page. Calls `POST /api/calendar/events/:id/briefing` which uses GPT-4o-mini to generate pre-meeting prep with talking points, CRM context, and recommended questions.

### Critical DB/ORM Notes
- **Drizzle 0.39 + PostgreSQL bug**: Using `and()` with multiple `ne()` or `not(eq())` conditions generates invalid SQL ("syntax error at or near '='"). All new complex queries in the Command Center routes use `db.execute(sql.raw(...))` with plain PostgreSQL strings instead of Drizzle query builders.
- **opportunities table**: Uses `owner_user_id` (Drizzle: `ownerUserId`) — there is NO `assignedToUserId` on opportunities.
- **email_messages table**: Uses `owner_user_id` (NOT `user_id`) for user filtering.
- **calendar_events table**: Uses `user_id` (not `owner_user_id`).

### Quoting System (Pro Forma Invoice Generator)
- **Features:** Multi-tab QuoteBuilder for customer, products, pricing, and terms. Supports 6 countries with auto-set currency and tax rates. Includes a product catalog with discounting.
- **Automation:** Automatically generates XLSX and HTML invoices, stored as base64 assets. Provides print/download endpoints.
- **Integration:** Quote files appear in the asset picker for Gmail integration.

### Database
- **Type:** PostgreSQL with Drizzle ORM.
- **Schema:** Comprehensive schema for all CMS modules.
- **File Attachments:** Polymorphic `attachments` table for file uploads (images/videos) stored on disk, served via API.
- **Sales & Marketing Assets CMS:** Full asset library with CRUD API and asset picker.
- **Gmail CRM Integration:** OAuth 2.0 via Google APIs. Features hourly and on-demand sync of emails. Supports multi-user Gmail accounts with per-user connect/disconnect and shared inbox functionality.
- **Custom Inbox Folders:** Per-user custom folders with domain-based rules for email organization.
- **Email Module Redesign:** 3-pane Gmail-like client with workflow states, linked CRM records, and a CRM Context Panel for association review and management.
- **Shared Team Inboxes:** Supports shared `email_accounts` with access control, allowing users to manage emails from shared inboxes.
- **Association Engine v3:** Full deterministic scoring pipeline for linking emails to CRM entities (contacts, accounts, leads, opportunities, partnerships). Signals: (1) exact contact email match (+50), (1a) account via contact (+35), (1b) open opportunity via contact — all active stages except closed_won/closed_lost (+20 base, +30 if title in subject), (2) sender domain → account (+20), (2b) open opportunity via matched account (+15 base, +25 if title in subject), (3) exact lead email match (+50), (4) lead domain match (+30), (5) partner domain match (+35), (6) lead company name in subject (+25). Penalties for bulk/auto-generated email. Thread bonus +25 if thread already CRM-associated. Disambiguation: if two candidates of same type score within 20 pts and both ≥ 30, both marked ambiguous (suggestions only). Feedback table prevents rejected associations from being recreated. User-confirmed associations are never overwritten. Idempotent: re-running on same message creates no duplicates. Stores `confidenceScore`, `associationReasonJson` (human-readable reasons), `isAuto`, `isUserConfirmed` on each `email_associations` row.
- **Email Relationship Intelligence Dashboard:** New page at `/relationships` (nav: Execution → Rel. Intelligence). Shows 5 stat cards (External Contacts emailed, Active Relationships 2+ emails, Dormant 60d+, New in period, Unlinked Senders), activity trend line chart, top-orgs horizontal bar chart, Most Active Contacts table, Neglected Relationships table, Top Organizations by Volume table, and Unlinked Real Senders table with "Open in inbox" link for CRM seeding. All tables are sortable by any column. Period filter (7d/30d/90d/All) drives all data. Single endpoint `GET /api/relationships/intelligence?days=N` executes all queries in one round-trip. No schema changes. Permission gate: `requireAuth` (accessible to all logged-in users).
- **Inbox Quick-Create (Lead, Account, Contact from Sender):** In the Gmail CRM Context Panel, when a thread has no CRM associations and the sender is an eligible external business contact (not @voltsafe.com, not personal domains, not bulk/newsletter), three quick-create buttons appear: Contact (sky blue), Lead (amber), Organization (violet). Each expands an inline form pre-populated from sender data. Endpoints: `POST /api/gmail/sender/create-contact`, `POST /api/gmail/sender/create-lead`, `POST /api/gmail/sender/create-account`. All use 409 dedup codes and re-trigger the association engine on success. Gated by `crm: "edit"` permission.
- **Mobile + Field Usability Polish (T10):** Makes Cortex fast and practical on phones at marinas, in meetings, and between calls. (1) **Field Quick Actions on profile pages** — prominent 2×2 or 3-button grid below the identity card on Contact (Call/Email/Note/Task), Account (Website/Note/Task/Deal), and Opportunity (Note/Task/Log Call) profiles; all buttons are 44px+ touch targets with `active:scale-95` animation; Quick Actions sidebar in contact profile upgraded to 44px tap rows. (2) **Daily Command Center mobile fix** — responsive padding (`p-4 sm:p-6`), stat strip changed to `grid grid-cols-3 sm:flex sm:flex-wrap` to fill space evenly on mobile. (3) **Accounts page collapsible filter bar** — Settings2 toggle button on mobile (sm:hidden) reveals/hides filter selects; active filter count badge shown on toggle button. (4) **Gmail inbox mobile improvements** — mobile-only tab switcher (`md:hidden`) shown at top of thread list, replacing hidden sidebar navigation on phones (tabs: Inbox/Sent/Drafts/Review/Other with unread badges); category pills and CRM filter pills both wrapped in `overflow-x-auto` + `min-w-max` for horizontal scroll; thread row touch targets increased from `py-[9px]` to `py-3` across all row types (inbox, review queue, folder); bulk action toolbar updated with `min-h-[32px]` buttons and icon-only mode on narrow screens.
- **Email Workspace Triage Layer:** Adds awaiting-reply tracking and three triage sub-filter tabs to the inbox. DB: added `awaiting_reply_since`, `last_inbound_at`, `last_outbound_at`, `reply_status` columns to `email_threads`. Backend service (`server/services/awaiting-reply.ts`) computes reply obligations by comparing inbound/outbound message timestamps — sets `awaiting_reply_since` when an external inbound has no outbound reply, clears it when we send a reply or manually mark the thread done/waiting. API: `GET /api/inbox/triage-summary` (badge counts), `GET /api/inbox/triage-thread-ids` (thread ID sets per bucket), `GET /api/inbox/awaiting-reply` (full thread list), `POST /api/inbox/compute-awaiting-reply` (manual trigger). PATCH `/api/gmail/thread-record` extended to accept `replyStatus` (`needs_reply`/`waiting_on_them`/`done`) and automatically manages `awaiting_reply_since`. `clearAwaitingReply()` called automatically when a reply is sent via `POST /api/gmail/send`. Frontend: three new triage pill tabs in the inbox sidebar — **Awaiting Reply** (clock/amber), **Hot / Engaged** (flame/rose), **Unlinked** (link/slate) — each with live count badges from the triage summary. Inbox message list is filtered client-side by cross-referencing Gmail thread IDs with the triage ID sets. Each tab has a themed empty state. Workflow pill clicks in the thread CRM panel co-update `replyStatus` and invalidate triage caches. An amber "Awaiting reply since [date]" badge appears in the thread panel when `awaitingReplySince` is set (data-testid: `awaiting-reply-badge`). Computation runs on server boot and can be triggered on demand. 12/12 new email-workspace tests all passing.
- **Inbox Power Workflow (T9):** Makes the inbox the fastest place to triage, link, and act. Features: (1) **Bulk selection** — checkboxes appear on hover (or when any thread is selected), `x` keyboard shortcut toggles selection on focused thread, Escape clears selection; (2) **Bulk action toolbar** — sticky bar appears above thread list with count, Mark Read, Mark Unread, and Archive buttons; (3) **CRM fast filters** — second row of filter pills on inbox tab: All / Unread / Starred / Needs Reply / Follow Up, applied client-side; (4) **Quick-create Task from email** — `Task` button in CRM panel opens inline title input, Enter saves, Escape cancels, auto-populates with sender and subject context, pre-links to top confirmed CRM record; (5) **Quick-create Note from email** — `Note` button (disabled until thread is linked to CRM record) adds a structured note with sender/subject context, linked to the top confirmed CRM record. New backend endpoints: `POST /api/gmail/bulk-mark-read` (max 100 messages, validates markAs=read|unread), `POST /api/gmail/bulk-archive` (max 50 threads, removes INBOX label), `POST /api/inbox/create-task-from-thread` (gated crm:edit, auto-sets due date to tomorrow, priority medium, status pending), `POST /api/inbox/create-note-from-thread` (gated crm:edit, requires linkedObjectType+linkedObjectId due to DB NOT NULL constraint). 27 T9 tests added → 140/140 total passing.

### Pipeline Forecasting + Rep Performance
- **Forecast API:** `GET /api/pipeline/forecast?months=6&ownerId=N` returns monthly rollup by forecast category (commit/best_case/pipeline/closed_won) with weighted amounts and summary totals.
- **Rep Performance API:** `GET /api/pipeline/rep-performance?days=90` returns per-rep metrics: open opps, win rate, avg cycle, stale count, quotes sent/accepted, closed won/lost, activities 7d/30d.
- **Extended Pipeline Insights:** `/api/pipeline/insights` extended with `quotesAwaitingResponse`, `closingThisMonth`, `noOpenTask`, `byCat` (forecast category breakdown).
- **Tests:** `tests/pipeline-forecast.test.js` — 15/15 passing.

### Data Quality / Dedupe Center
- **Page:** `/data-quality` — accessible via Revenue Engine → Data Quality in sidebar (CRM permission required).
- **Detection API:** `GET /api/data-quality/summary` returns health scores (0-100) per object type (accounts, contacts, leads, opportunities, quotes), issue counts across 13 categories, and forecast risk metrics.
- **Issues API:** `GET /api/data-quality/issues?category=duplicates|missing_owner|missing_fields|orphans|stale` returns paginated, ignore-filtered issue records.
  - **Duplicates:** exact normalized name/email clustering for accounts, contacts, leads; shows side-by-side record cards with suggested primary.
  - **Missing Owners:** unowned active opportunities, tasks, and leads.
  - **Missing Fields:** opportunities without close date or with zero/null amount.
  - **Orphans:** quotes linked to deleted opportunities, opportunities linked to deleted accounts, converted leads with broken opportunity links.
  - **Stale Records:** leads with no activity/owner in 30+ days, contacts with no valid account.
- **Ignore API:** `POST /api/data-quality/ignore` + idempotent (ON CONFLICT DO NOTHING). Ignored issues are filtered out of subsequent queries.
- **Fix API:** `PATCH /api/data-quality/fix` — supports: `assign_owner`, `set_close_date`, `set_amount`, `archive_record`, `relink_opportunity`, `bulk_assign_owner`, `bulk_create_tasks`.
- **DB:** `data_quality_ignores` table (id, object_type, object_id, cluster_key, issue_type, ignored_by, note, created_at) with unique index.
- **Frontend tabs:** Overview (forecast risk alerts + issue list) | Duplicates | Missing Owners | Missing Fields | Orphans | Stale Records.
- **Actions per tab:** Ignore (dismiss), Assign Owner (dialog with user select), Set Close Date (date picker dialog), Set Amount (number input dialog), Archive, Bulk Create Follow-up Tasks.
- **Tests:** `tests/data-quality.test.js` — 20/20 passing.

## Procurement / Manufacturing Workflow

End-to-end hardware delivery layer sitting beneath the Install Workflows. All tables migrated via `migrateProcurementSchema()` in `server/seed-production.ts`.

### DB Tables (6 new)
| Table | Purpose |
|---|---|
| `suppliers` | Vendor directory — name, lead time, country, status |
| `parts` | SKU catalog — unit, unit_cost, supplier FK |
| `purchase_orders` | PO lifecycle (draft → issued → received) with auto-numbering `PO-NNNN` |
| `purchase_order_lines` | Line items — qty, qty_received; auto-advances PO to partially_received / received |
| `production_batches` | Assembly runs (planned → in_assembly → testing → ready → shipped); auto-numbers `BATCH-NNNN` |
| `inventory_allocations` | On-hand / allocated / reserved-cert per part per location; computes quantity_available |

### Key API Endpoints (all under `/api/procurement/`)
- `GET/POST /suppliers`, `PATCH /suppliers/:id`
- `GET/POST /parts`, `PATCH /parts/:id`
- `GET/POST /purchase-orders`, `GET/PATCH /purchase-orders/:id`
- `GET/POST /purchase-orders/:id/lines`, `PATCH/DELETE /purchase-orders/:id/lines/:lineId`
- `GET/POST /production-batches`, `GET/PATCH /production-batches/:id`
- `GET/POST /inventory`, `PATCH /inventory/:id`
- `GET /blocked-installs` — install workflows missing ready/shipped batches or with delayed POs
- `GET /dashboard` — KPI aggregates across all four layers

### Auto-Task Creation (Phase 6)
- PO → `delayed`: creates a "Follow up on delayed PO …" task (priority high, due 2 days)
- Batch → `blocked`: creates a "Resolve blocker …" task (priority high, due 1 day)
- Batch → `testing`: creates a "Complete testing …" task (priority medium, due 5 days)

### Frontend
- Route: `/procurement` (`client/src/pages/procurement.tsx`)
- Sidebar section: **Procurement & Mfg** (Package icon, crm perm)
- 7 tabs: Dashboard · Purchase Orders · Production · Inventory · Blocked Installs · Suppliers · Parts
- KPI strip (8 cards) + inline status dropdowns + create modals for POs and Batches

### Tests
`tests/procurement.test.js` — 93 assertions covering full CRUD, status lifecycle, auto-advance, auto-task triggers, blocked-installs, and dashboard shape.

## Deployment / Site Rollout Manager

End-to-end field execution layer for marina/site deployments. Sits above Install Workflows and Procurement.

### DB Tables (4 new)
| Table | Purpose |
|---|---|
| `deployments` | Master site record — status flow, dates, docks/units count, auto-numbered DEPLOY-NNNN |
| `deployment_hardware_allocations` | Links parts/inventory to a deployment — tracks required/reserved/shipped/delivered/missing |
| `commissioning_checkpoints` | 6 deterministic milestones auto-seeded on create; pass/fail with timestamp + user |
| `deployment_blockers` | Field issues — title, severity, status (open/resolved), triggers auto-task on create |

### Status Flow
`planned → scheduled → mobilizing → in_install → commissioning → partially_live → live → blocked → complete`

### Key API Endpoints (all under `/api/deployments/`)
- Static routes **before** dynamic routes to avoid `:id` collision:
  - `GET /dashboard` — 7 KPI overview stats + overdue/blocked/commissioning-progress lists
  - `GET /blocked` — deployments with open blockers or missing hardware
- `GET / POST /api/deployments`
- `GET / PATCH /api/deployments/:id`
- `GET / POST / PATCH / DELETE /api/deployments/:id/hardware`
- `GET / POST / PATCH /api/deployments/:id/checkpoints`
- `GET / POST / PATCH /api/deployments/:id/blockers`

### Auto-behaviors (Phase 6)
- On **create deployment**: 6 commissioning checkpoints seeded automatically
- On **status → blocked**: task created (priority high, due 1 day)
- On **hardware → missing**: task created (priority high, due 2 days; de-duped)
- On **go-live overdue** (target date < now, status != live/complete): task created (de-duped)
- On **all checkpoints passed**: deployment auto-advances to `live` + sets `actual_go_live`
- On **new blocker logged**: task always created matching blocker severity

### Frontend
- Route: `/deployments` (`client/src/pages/deployments.tsx`)
- Sidebar: under "Procurement & Mfg" section with Layers icon
- Tabs: Deployments (card list) · Blocked · Dashboard
- Inline status dropdown per card; click card → detail panel
- Detail panel: Commissioning Checklist · Blockers · Hardware · Info tabs
- Progress bar per deployment (passed checkpoints / total)

### Tests
`tests/deployment.test.js` — **102 assertions** covering full lifecycle, auto-live, blocker create/resolve, hardware allocations, blocked list, dashboard shape, and procurement + executive regression checks.

## True Duplicate Merge Engine

Safe, audited, field-resolution-driven merge for accounts, contacts, and leads.

### New DB Table
`merge_audit_log` — captures who merged, when, which records, field resolutions chosen, counts of linked objects moved, before/after snapshots, warnings.

### API Endpoints (`/api/merge/*`)
| Endpoint | Description |
|---|---|
| `GET /api/merge/preview/:type/:primaryId/:secondaryId` | Side-by-side field comparison + linked object counts + warnings |
| `POST /api/merge/apply` | Execute the merge (admin-only) |
| `GET /api/merge/audit` | Paginated merge history (filter by `entityType`) |
| `GET /api/merge/audit/:id` | Single audit record |

### Safety Guardrails
- Admin-only (`isAdmin` check; 403 for non-admins)
- Self-merge prevention (400)
- Invalid entity type rejection (400)
- Nonexistent record rejection (404)
- Prior-merge warning displayed in preview

### Merge Logic Per Entity
**Account**: relinks contacts, opps, quotes, tasks, notes, activities, email associations, install workflows, deployments, leads.converted_account_id → archives secondary (`leadStatus = 'archived'`) + activity logged

**Contact**: relinks opps, quotes, tasks, notes, activities, email_associations, leads.converted_contact_id, opportunity_contacts (deduped) → archives secondary (name prefixed `[archived]`, notes updated) + activity logged

**Lead**: relinks tasks, notes → archives secondary (`status = 'closed_lost'`)

### Field Resolution UI
- Per-field winner picker (click primary value or secondary value)
- Highlighted selected field (emerald = primary, blue = secondary)
- Automatic defaults based on which side has a non-null value
- Swap primary/secondary button (resets resolutions)
- Two-step confirm flow: Review → Confirm → Apply

### Frontend
Data Quality page → Duplicates tab:
- Each cluster now shows **"Merge #X → #Y"** button (primary action) + Archive (secondary fallback)
- Clicking Merge opens `MergeReviewPanel` overlay
- "Merge History" button opens `MergeAuditPanel` overlay

### Tests
`tests/merge.test.js` — **84 assertions** covering account/contact/lead merges, linked object relinking, secondary archival, field resolution correctness, audit creation, prior-merge warning, entity filter, and full regression suite.

## Projects — Safety Certification Extension

Enhanced the existing Operations → Projects module with a dedicated Safety Certification type and full certification lifecycle tracking. No separate module built — all integrated into Projects.

### New Project Type
`certification` — "Safety Certification" (red ShieldCheck icon) added to `PROJECT_TYPES` alongside existing 8 types. The form dialog shows an info hint that 12 milestones will be auto-created.

### New DB Tables
- `project_certifications` — 1-to-1 with `projects` via unique `project_id`. Holds 50+ certification-specific fields across 7 sections: Core, Lab, Status, Samples, Failure/CA, Commercial, Documentation. Migrated via `migrateProjectCertificationSchema()`.
- `project_milestones` — 1-to-many checklist items for any project; used for cert milestone tracking.

### API Endpoints (new)
| Endpoint | Description |
|---|---|
| `GET /api/projects` | Enhanced: LEFT JOINs `project_certifications` — returns `certification_status`, `overall_risk`, `launch_blocker`, `cert_target_completion_date`, `certification_program`, `next_action_due_date` for list view |
| `GET /api/projects/:id` | Enhanced: same JOIN for detail |
| `GET /api/projects/:id/certification` | Full cert record |
| `POST /api/projects/:id/certification` | Upsert cert fields (camelCase→snake_case mapped) |
| `PUT /api/projects/:id/certification` | Update existing cert record |
| `GET /api/projects/:id/milestones` | Milestone checklist (sorted by sort_order) |
| `POST /api/projects/:id/milestones` | Add custom milestone |
| `PATCH /api/projects/:id/milestones/:mid` | Update milestone status (setting done sets completed_at) |
| `POST /api/projects/:id/create-alerts` | Smart task creation — idempotent, deduped by source_label |

### Auto-Scaffolding
- Creating a project with `type: "certification"` auto-creates: an empty `project_certifications` record + 12-milestone default checklist
- Changing existing project type to "certification" also auto-scaffolds (idempotent — won't duplicate milestones)

### Smart Alert Engine (Phase 5)
`POST /api/projects/:id/create-alerts` creates tasks for:
1. `next_action_due_date` ≤7 days away → high priority
2. `target_completion_date` within 14 days and not Certified/Passed → high priority
3. `target_completion_date` overdue → urgent
4. `launch_blocker = true` → urgent
5. `retest_required = true` → high priority
6. `certificate_expiry_date` ≤90 days → medium/high

All tagged with `source_label` for idempotent re-runs.

### Certification Fields (50+)
Core: program (multi-select JSON), scope, product_name/version/revision, SKU, priority, standard_codes, target_market
Lab: testing_lab_name, lab_contact_name/email/phone
Dates: application_submission, planned/actual_test_start, target/actual_completion, retest, pass, certificate_issue/expiry
Status: certification_status (12 values), overall_risk, launch_blocker, blocker_summary, next_action/due_date, last_status_update
Samples: units_required/built/shipped/received_by_lab, serial_numbers, sample_notes
Failure/CA: failure_found/summary, corrective_action_required/summary, retest_required/date, pass_date
Commercial: engineering_owner, operations_owner, linked_supplier/batch, est/actual_cost, budget_status
Docs: certification_doc_link, test_report_link, shared_drive_folder_link, certificate_file, compliance_notes

### Frontend Changes (`client/src/pages/projects.tsx`)
- **Project Cards**: Certification cards show `certification_status` badge, `overall_risk` pill, launch blocker badge, product name, target completion date
- **Detail Dialog**: New "Certification" tab (full field editor with section groups, multi-select programs, boolean toggles, doc links) + "Milestones" tab (progress bar + status-per-item checklist) — both only visible for certification type; default open tab is "Certification"
- **Certification tab** has "Create Alerts" + "Edit/Save" buttons inline
- Conditional hint in form when selecting certification type

### Tests
`tests/certification.test.js` — **38 assertions** covering all 7 phases: type CRUD, field persistence, list badges (joined fields), milestone auto-creation, milestone status updates, alert creation (idempotent), auth guards, type conversion, and regression for existing project types.

### Test Totals
- Procurement: 93 tests
- Deployment: 102 tests
- Merge Engine: 84 tests
- Customer Success: 44 tests
- Safety Certification: 38 tests
- **Total: 361 tests**

## Customer Success + Renewals Layer

Post-deployment layer for tracking live customers, health scores, renewals, and expansion.

### New DB Table
`customer_subscriptions` — full customer lifecycle tracking: MRR/ARR, health score, renewal date, billing status, expansion potential, churn risk flags, renewal task automation. Migrated via `migrateCustomerSuccessSchema()` in `server/seed-production.ts`.

### API Endpoints (`/api/cs/*`)
| Endpoint | Description |
|---|---|
| `GET /api/cs/dashboard` | KPI overview, upcoming renewals, at-risk accounts, expansion opps |
| `GET /api/cs` | Paginated list with status/health/owner/expansion filters |
| `POST /api/cs` | Create subscription (admin); auto-computes ARR from MRR |
| `GET /api/cs/:id` | Detail + live health recompute + linked tasks |
| `PATCH /api/cs/:id` | Update any field; camelCase→snake_case auto-mapped |
| `POST /api/cs/:id/compute-health` | Recompute & persist health score |
| `POST /api/cs/renewal-check` | Create idempotent renewal reminder tasks (de-duped by source_label) |
| `DELETE /api/cs/:id` | Soft-cancel (sets status = 'cancelled') |

### Health Score Engine (deterministic, 0-100)
6 weighted signals computed at `GET /api/cs/:id` and `POST .../compute-health`:
1. Open deployment blockers (−15 each, max −30)
2. Overdue tasks (−10 each, max −20)
3. No activity in 60+ days (−20)
4. Billing status overdue (−25)
5. Renewal within 30 days but not in-progress (−10)
6. Recent check-in within 30 days (+20)

Health status thresholds: ≥75 = healthy, ≥50 = at_risk, <50 = critical

### Renewal Reminder Automation
`createRenewalReminderTasks()` creates tasks at 120d/90d/60d/30d/overdue milestones, idempotently tagged via `source_label = '{n}d-renewal'` on tasks table. `POST /api/cs/renewal-check` triggers this for all non-cancelled accounts with upcoming renewals.

### Frontend — Customer Success Workspace (`/renewals`)
5-tab workspace page at `client/src/pages/renewals.tsx`:
- **Customers** — grid of CustomerCards with status + health filters
- **Renewals** — list sorted by urgency with countdown badges
- **Churn Risk** — at-risk accounts with flag chips
- **Expansion** — expansion opportunity grid
- **Dashboard** — KPI strip, upcoming renewals, health breakdown, at-risk accounts, expansion list + "Run Renewal Check" button
- Slide-in `CustomerDetailPanel` with inline edit, health bar + flag list, recompute button, linked record summary, task list
- `NewCustomerModal` with account search, owner assign, MRR/ARR, dates, expansion

### Tests
`tests/cs.test.js` — **44 assertions** covering full CRUD, health engine signals, renewal-check idempotency, task creation, auth guards, status transitions, ARR auto-compute, dashboard shapes.

### Test Totals
- Procurement: 93 tests
- Deployment: 102 tests
- Merge Engine: 84 tests
- Customer Success: 44 tests
- **Total: 323 tests**

## External Dependencies

- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interaction.
- **`bcryptjs`:** Password hashing.
- **`express-session` & `connect-pg-simple`:** Session management.
- **`@simplewebauthn/server` & `@simplewebauthn/browser`:** WebAuthn for biometric login.
- **`TanStack React Query`:** Frontend data fetching and state management.
- **`shadcn/ui` & `Radix UI`:** UI component libraries.
- **`Tailwind CSS`:** Frontend styling.
- **`Recharts`:** Data visualization.
- **`Lucide React`:** Icons.
- **`Wouter`:** Frontend routing.
- **`Leaflet`:** Interactive maps.
- **OpenAI:** Powering Cortex AI Voice Assistant (via Replit AI Integrations).
- **Google APIs:** For Gmail CRM Integration.
- **Nominatim:** For address geocoding and autocomplete.
- **CARTO Voyager:** Basemap tiles for Leaflet maps.- **Universal Global Search:** Fully wired search bar in the header (`GET /api/search?q=`). UNION query across accounts, contacts, opportunities, and notes. Results grouped by entity type with color-coded icons. Cmd+K focuses the input; click-away closes the dropdown; click result navigates to the entity's profile page. Note results navigate to the linked record's profile.
- **Pinned Notes / Key Facts:** Notes can be pinned via a pin toggle on each note card in NotesPanel (`PATCH /api/notes/:id/pin` flips `is_pinned`). Pinned notes appear at the top of NotesPanel with a teal highlight. Account and Opportunity profile pages show a **Key Facts** section that renders all pinned notes for that record. Schema: `is_pinned boolean DEFAULT false` column added to `notes` table. Both profile SQL queries now include `is_pinned` and sort by `is_pinned DESC, created_at DESC`.
- **Saved Filters / Custom Views (Accounts):** Accounts page has a "Save view" button (Bookmark icon) below the filter bar. Clicking it expands an inline name input; pressing Enter or clicking Save persists the current filter state (segment, status, priority, orgType, sort) to the existing `saved_views` table via `POST /api/saved-views`. Saved views appear as chips; clicking a chip restores all filters; hovering a chip shows an X to delete it. Backend routes (`/api/saved-views` CRUD) and schema already existed.

## Phase 3: Executive Alerting / Digest Automation (Complete)

### Overview
Role-aware executive digest system that proactively surfaces risks, opportunities, and actions. Runs in-app and via Gmail.

### New Files
- `server/services/digest-composer.ts` — deterministic digest assembly; 14 section types, role-aware section selection, HTML + text formatters
- `server/services/alert-engine.ts` — 8 configurable alert trigger types with per-user thresholds and dedup logic
- `client/src/pages/alerts-digest.tsx` — full settings UI with 5 tabs: Digest Preview, Active Alerts, Settings, Alert Rules, History

### New Schema Tables
- `digest_configs` — per-user digest config (cadence, channels, sections, severity threshold, quiet hours, alert rules)
- `digest_runs` — digest delivery history (type, status, channel, sections sent, payload summary, errors)

### New API Routes
- `GET /api/digest/config` — get or auto-create role-default config
- `PUT /api/digest/config` — update any config field
- `GET /api/digest/preview` — live digest composition (`?format=html|text|json`)
- `POST /api/digest/send-now` — trigger immediate delivery (in-app or email)
- `GET /api/digest/runs` — delivery history
- `GET /api/digest/role-defaults` — default sections for current user role
- `POST /api/digest/reset-to-defaults` — reset to role defaults
- `GET /api/alerts/active` — unread alert notifications
- `POST /api/alerts/run-engine` — run alert engine for current user
- `GET /api/alerts/rules` — per-user alert thresholds
- `PUT /api/alerts/rules` — update thresholds

### Role-Based Default Sections
- CEO: revenue at risk, blocked installs, cert blockers, pipeline movement, renewal/churn risks
- CFO: MRR summary, revenue at risk, renewal risks, procurement blockers, quotes follow-up
- CTO: cert blockers, blocked installs, procurement blockers, overdue tasks
- CMO: hot leads, territory whitespace, pipeline movement, quotes follow-up
- Sales: top priorities, hot leads/opps, overdue tasks, quotes follow-up, pipeline movement
- CS: renewal risks, churn risks, overdue tasks, top priorities
- Ops: blocked installs, procurement blockers, cert blockers, overdue tasks

### Alert Triggers (8 types)
1. Stalled deal (configurable days threshold)
2. Unanswered quote (configurable days)
3. Churn score threshold breach
4. Deployment blocked beyond threshold
5. Certification blocker active
6. Renewal due or overdue
7. Pricing lock expiry approaching
8. Major score band change (≥20 pts)

### Navigation
Added "Digest & Alerts" link under Intelligence nav group in sidebar, routed to `/alerts-digest`.

### Tests
`tests/digest.test.js` — **54 assertions** covering all 7 phases: data model, composer, role defaults, alert engine, UI/config, delivery, section filtering, no-regression, auth guards.

### Cumulative Test Count
- Previous total: 724 tests
- New: +54 tests
- **Total: 778 tests, 0 failures**

---

## Board Pack Auto-Scheduling (Complete)

### What was built
Recurring auto-delivery system for board packs and executive reports. Admins configure schedules (weekly/monthly/quarterly) that automatically compose and deliver reports via email and in-app notifications on a cron-like interval.

**Schema** (2 new tables via direct SQL — `shared/schema.ts`):
- `board_pack_schedules` — schedule config: cadence, send_hour, recipients, delivery_channels (jsonb), included_sections (jsonb), enabled flag, next_run_at, run stats
- `board_pack_runs` — execution log: status, recipient_count, errors, metadata, generated_at

**`server/services/board-pack-scheduler.ts`** (new service):
- `computeNextRunAt(schedule)` — computes next UTC run timestamp for weekly/monthly/quarterly cadences
- `generateAndDeliver(scheduleId, triggeredBy?)` — composes report via `/api/reports/compose`, sends Gmail email if connected, sends in-app notification, logs run record, updates schedule stats
- `formatReportAsHtml(data, meta)` — renders branded HTML email body from report data
- `evaluateDueSchedules()` — scans all enabled schedules due now (with 5-min tolerance), triggers generateAndDeliver for each
- `startBoardPackScheduler()` — 5-minute setInterval loop that calls evaluateDueSchedules
- `seedDefaultSchedules()` — seeds 4 default templates (Weekly Executive, Monthly Leadership, Quarterly Board Pack, Fundraising Snapshot) if no schedules exist

**9 new API routes** (all `requireAuth + requireAdmin`):
- `GET /api/board-pack/schedules` — list all schedules
- `POST /api/board-pack/schedules` — create schedule (validates name, scheduleType, etc.)
- `GET /api/board-pack/schedules/:id` — get single (404 if missing)
- `PATCH /api/board-pack/schedules/:id` — partial update (name, sendHour, recipients, channels, sections, etc.) using sql.raw JSONB
- `DELETE /api/board-pack/schedules/:id` — delete with cascade runs (404 if missing)
- `POST /api/board-pack/schedules/:id/toggle` — flip enabled (404 if missing)
- `POST /api/board-pack/schedules/:id/run-now` — async fire-and-forget, returns 202
- `GET /api/board-pack/schedules/:id/history?limit=N` — run log for a schedule (404 if schedule missing)
- `GET /api/board-pack/runs?limit=N` — all recent runs across schedules

**Frontend** (`client/src/pages/board-pack.tsx`) extended:
- Added `pageView` state toggle: `"builder" | "schedules"` with header tab switcher (Report Builder / Auto-Scheduling)
- New `ScheduleModal` component — create/edit modal: name, cadence, day/weekday/quarter controls, send hour, report type, delivery channels (checkboxes), recipients (textarea), included sections (grid of checkboxes)
- New `RunHistoryPanel` component — collapsible run log per schedule
- New `SchedulesPanel` component — full schedule list with per-card: enabled toggle, send-now, history expand, edit, delete

### Tests
`tests/board-pack-scheduler.test.js` — **48 assertions** covering 14 suites: auth/permission, list, CRUD (weekly/monthly/quarterly), single-get 404, PATCH fields, toggle on/off, run-now (202), run history (404 for missing), recent runs, next_run_at math for all 3 cadences, included sections, delete with verify, and regression of prior routes.

### Cumulative Test Count
- Previous total: 778 tests (through Territory Routing / Executive Alerting / etc.)
- Session additions: +903 (territory routing sprint) → tracked separately
- Board Pack Scheduler: +48 new tests
- **Total new scheduler tests: 48, 0 failures**

## Winter Support + Legacy Product Operations Module

### Database Tables
- `winter_products` — product registry (name, SKU, version, launch year, certifications, units sold, channels, status)
- `winter_support_cases` — support case intake (case number, customer info, gmail thread, issue type, severity, sentiment, auto-detected flag)
- `winter_kb_articles` — knowledge base with approved customer responses and internal notes

### Backend Routes (`/api/winter/*`)
- `GET/POST /api/winter/products` — product list + create
- `PUT /api/winter/products/:id` — update product
- `GET/POST /api/winter/cases` — case list (filterable by status/issueType/severity/search) + create
- `GET /api/winter/cases/:id` — single case detail
- `PUT /api/winter/cases/:id` — update case status/severity/resolution
- `GET/POST /api/winter/kb` — KB article list + create
- `PUT /api/winter/kb/:id` — update article
- `GET /api/winter/dashboard` — command center stats (open cases, critical, demand score, revenue opp, top issues, weekly trend, product breakdown)
- `GET /api/winter/demand-signals` — signals by country, retailers, feature requests, monthly trend, sentiment
- `POST /api/winter/scan-emails` — scans `email_messages` for Winter keywords, auto-creates cases

### Email Detector (`server/services/winter-detector.ts`)
Keyword detection, issue type classification, severity scoring, sentiment scoring. Scans `email_messages.sent_at` column; skips threads already in `winter_support_cases`.

### Frontend (`client/src/pages/winter-hub.tsx`)
5-tab interface: Command Center, Cases, Knowledge Base, Demand Signals, Products. Supports full CRUD via dialogs. Route: `/winter`. Sidebar: Support → Winter Support (Snowflake icon).

### Tests
`tests/winter-support.test.js` — **73/73 assertions, 0 failures**
Covers: auth guards (6), products CRUD (12), cases CRUD (15), KB CRUD (15), dashboard (11), demand signals (6), email scan (5).

### Seed Data
Auto-seeded on boot (if empty): 3 products (Gen 1, Gen 2, Pro) + 7 KB articles covering overheating, charging issues, magnet/cable/compatibility/warranty/retailer.

## Trello-style Tasks System — Slice A (Complete)

Major upgrade to the existing Tasks Hub at `/execution/tasks`. The legacy List view is preserved alongside a new Board view as the new default.

### Schema (additive, applied via raw SQL — no destructive migrations)
- `tasks` gained columns: `completed_by_user_id`, `last_updated_by_user_id`, `start_date`, `completion_notes`, `archived` (default false), `sort_order` (default 0), `board_column` (backfilled for 161 existing rows)
- New tables: `task_dependencies`, `task_labels`, `task_label_assignments`, `task_checklists`, `task_checklist_items`, `task_watchers`, `task_activity`
- 8 default labels seeded (Urgent, Customer, Internal, Sales, Engineering, Field, Blocker, Quick Win)
- Comments are reused via the existing polymorphic `comments` table (`object_type='task'`, `object_id`, `user_id`, `user_name`, `content`)

### Routes (all in `server/routes-tasks.ts`, registered from `server/routes.ts`)
All endpoints guarded by `requirePermission("crm", "view"|"edit")`.
- `GET /api/tasks/:id/full` — task + labels + dependencies + blocking + checklists + watchers + activity (incl. `isBlocked` flag)
- `GET /api/tasks/board?view=my|team` — grouped by column with embedded labels, checklist progress, comment count, openDependencies
- `PATCH /api/tasks/:id/board` — column move + sort_order; auto-syncs status<->column for `done`; **rejects move to `done` when openDependencies > 0**
- `PATCH /api/tasks/:id` — generic field updates (title, desc, priority, due_date, start_date, owner, completion_notes, archived). **status & boardColumn are intentionally read-only here** to preserve invariants.
- `POST /api/tasks/:id/complete` + `/reopen` — completion lifecycle
- `POST/DELETE /api/tasks/:id/dependencies[/:depId]` — with recursive cycle detection
- `GET/POST /api/task-labels` and `POST/DELETE /api/tasks/:id/labels/:labelId`
- Checklists: `POST /api/tasks/:id/checklists`, `DELETE /api/task-checklists/:id`, `POST /api/task-checklists/:id/items`, `PATCH/DELETE /api/task-checklist-items/:id`
- Watchers: `POST/DELETE /api/tasks/:id/watchers/:userId`
- `GET/POST /api/tasks/:id/comments`
- `GET /api/tasks/search?q&exclude` — picker for dependency selection
- Every meaningful change writes to `task_activity` via `logActivity()`

### Frontend
- `client/src/components/tasks/task-board.tsx` — 5-column board with HTML5 native drag-and-drop, optimistic updates, auto-blocked badge, due-date colour coding, label color bars, priority dots, assignee + completed-by chips
- `client/src/components/tasks/task-detail-drawer.tsx` — right-side Sheet drawer with Trello-style action row (Labels / Dates / Checklist / Assignee / Move / Dependencies), inline-editable title & description, completion notes, comments, full activity feed
- `client/src/pages/tasks-hub.tsx` — adds **Board** as the first view tab (and new default); legacy List views preserved; integrates `TaskDetailDrawer` (also openable from anywhere via `window.dispatchEvent(new CustomEvent('open-task-drawer', { detail: { taskId } }))`)

### Slice B/C (deferred)
- Saved board filters per user, column-specific sort, archive bin
- Attachments on tasks (currently action button absent)
- Bulk drag-select on the board
- Real-time updates via WebSocket
- Email-task threading (reply directly from drawer)

## Tasks System — Slice B (Saved views, Archive, Embedded creation, Notification polish)

### What shipped
1. **Saved board views** — `task_board_views` table (id serial PK, user_id, name, filters jsonb, is_default bool, sort_order, created_at). CRUD endpoints `/api/task-board-views` (GET/POST/PATCH/DELETE). Single-default enforced per user. Board UI now has filter bar (search, owner [me/unassigned/user], priority, label multi-select), saved-views dropdown with set-default + delete, and "Save current filters" dialog. Default view auto-applies on first board load.
2. **Archive bin** — `tasks.archived` boolean already existed. Added `GET /api/tasks/archived` and `archived` field to PATCH whitelist. Drawer header gets an Archive/Restore button (closes drawer on archive). New "Archived" tab in Tasks Hub renders the archived list with per-row Restore button. Board endpoint already excludes archived.
3. **Embedded task creation** — `Add Task` buttons now appear on:
   - `tickets.tsx` — `TicketDetailDialog` header
   - `renewals.tsx` — `CustomerDetailPanel` "Renewal Tasks" subhead
   - `deployments.tsx` — `DeploymentDetail` header (next to Close)
   All dispatch `window.dispatchEvent("open-quick-capture", { detail: { tab: "task", prefill: { title, linkedObjectType, linkedObjectId, accountId } } })`.
   `quick-capture.tsx` `TaskForm` updated to honor `prefill` (title/dueDate/priority/linkedObjectType/linkedObjectId/accountId).
4. **Notification polish** — helpers `notifyAssignment`, `notifyCompletion`, `notifyDependencyUnblock` write to `notifications` with dedupe_key. Wired into:
   - PATCH /api/tasks/:id when ownerUserId changes (assigned + reassigned-away)
   - POST /api/tasks/:id/complete + PATCH /board→done (completion + cascading dep-unblock)
   - DELETE /api/tasks/:id/dependencies/:depId (manual unblock)

### Schema change (raw SQL, type-safe)
Added `task_board_views` table via `CREATE TABLE IF NOT EXISTS` matching the new Drizzle schema in `shared/schema.ts`. Reason: drizzle-kit `db:push --force` blocked on an interactive rename-disambiguation prompt; CREATE statement is the exact equivalent of what drizzle would emit (serial PK, integer FK to users, jsonb filters, boolean is_default, etc.). No existing PK types changed.

### Files touched
- `shared/schema.ts` — added `taskBoardViews` table + insertSchema + types
- `server/routes-tasks.ts` — CRUD `/api/task-board-views`, `/api/tasks/archived`, notification helpers, hooks on assign/complete/board-move/dep-delete
- `client/src/components/tasks/task-board.tsx` — full rewrite with filter bar + saved-views dropdown + save dialog
- `client/src/components/tasks/task-detail-drawer.tsx` — Archive/Restore button + archived banner
- `client/src/components/quick-capture.tsx` — prefill propagation through open-quick-capture event
- `client/src/pages/tasks-hub.tsx` — Archived tab + ArchivedList component
- `client/src/pages/tickets.tsx`, `renewals.tsx`, `deployments.tsx` — Add Task buttons

### Smoke-tested
- Saved view CRUD (create/list/patch isDefault/delete) ✓
- Default isDefault=true clears prior default ✓
- Archive→restore round-trip via PATCH /api/tasks/:id ✓
- Board endpoint omits archived ✓

## Slice C — Draggable + Resizable Dashboard Grid (Complete)

**Goal**: Replace the fixed `ActionWidgetsGrid` in the Role Command Center with a true responsive grid where users can drag and resize widgets, and persist their layout per command-center type (sales/cs/ops/cert/ceo/inbox/default).

### Schema
- Added `users.dashboard_layouts jsonb DEFAULT '{}'` (non-destructive ADD COLUMN). Shape: `{ [centerType]: { lg: Layout[], md: Layout[], sm: Layout[], xs: Layout[], xxs: Layout[] } }`.
- `shared/schema.ts` updated; `UserProfile` in `client/src/lib/dashboard-config.ts` adds `dashboardLayouts?: Record<string, any>`.

### API
- `GET /api/users/me/profile` now returns `dashboardLayouts`.
- `PATCH /api/users/me/layout` accepts `dashboardLayouts: { [centerType]: Layouts }` — server merges per-centerType so other centers are preserved.
- `POST /api/users/me/layout/reset` body `{ centerType }` — deletes that key, falling back to client-generated defaults.

### Frontend
- New `client/src/components/command-centers/dashboard-grid.tsx`:
  - `WIDGET_SIZE_HINTS` per-widget defaults (w/h/minW/minH).
  - `generateDefaultLayouts(ids)` produces sensible per-breakpoint layouts (12/10/6/4/2 cols).
  - `reconcileLayouts(saved, visibleIds)` preserves user positions, adds new widgets at the bottom, strips removed widgets — survives admin widget visibility toggles.
  - `DashboardGrid` uses `Responsive` from react-grid-layout. Drag is gated behind `editing` flag using `.widget-drag-handle` overlay; resize handles only show in edit mode.
  - `DashboardEditToolbar` — single "Edit Layout" button → expands to Save / Cancel / Reset to Default.
- `client/src/index.css` — react-grid-layout + react-resizable CSS imports + custom placeholder/handle/edit-mode outline styles.
- `client/src/pages/role-command-center.tsx`:
  - Replaced `ActionWidgetsGrid` with `DashboardGrid`.
  - Added edit state (`editingLayout`, `draftLayouts`, `resetSeed`) and handlers wired to PATCH/reset endpoints.
  - Save sends `{ dashboardLayouts: { [centerType]: layouts } }`; reset bumps `resetSeed` to remount the grid with regenerated defaults.

### Smoke-tested
- Login + GET profile returns `dashboardLayouts` ✓
- PATCH `/api/users/me/layout` with `{dashboardLayouts:{sales:{lg:[…]}}}` saves and persists ✓
- POST `/api/users/me/layout/reset` with `{centerType:"sales"}` clears the key ✓
- Vite/React bundle compiles cleanly (no runtime overlay) after fixing react-grid-layout type names (LayoutItem/ResponsiveLayouts) and removing the now-deprecated WidthProvider wrapper ✓

### Drag/resize regression fix (2026-04-27)
- **Symptom**: In Edit Layout mode the drag handle rendered but widgets could not be dragged or resized.
- **Root causes**:
  1. The installed `react-grid-layout@^2.2.3` is the v2 API rewrite. The v1 props (`isDraggable`, `isResizable`, `draggableHandle`, `compactType`, `preventCollision`, `useCSSTransforms`) are silently ignored — v2 reads `dragConfig`/`resizeConfig`/`compactor`/`positionStrategy` instead.
  2. The non-edit branch baked `static: true` onto every layout item, the grid echoed those items back through `onLayoutChange`, and we stored them in state. Re-entering edit mode kept `static: true` per item, which v2 honors over the grid-level enable flag — so drag/resize stayed locked.
- **Fix in `client/src/components/command-centers/dashboard-grid.tsx`**:
  - `dragConfig={{ enabled: editing, handle: ".widget-drag-handle" }}` and `resizeConfig={{ enabled: editing }}`, both memoized.
  - `lockedLayouts` now always strips a pre-existing `static` flag before deciding whether to re-apply it, so transitioning non-edit → edit fully releases the items.
  - Dropped the dead v1 props; `verticalCompactor` + `transformStrategy` are v2 defaults so the behavior is preserved.
- Type drift cleaned up at the same time: `reconcileLayout(saved: readonly Layout[] | undefined, …)` matches v2's `ResponsiveLayouts.lg: readonly LayoutItem[]`; `role-command-center.tsx` now imports `Layouts` from our local re-export instead of the (no-longer-exported) symbol on the package itself.
- `npx tsc --noEmit` reports zero errors in either touched file.

---

## Security hardening pass (2026-04-18)

**Standing rule:** no schema changes, no `db:push`, no new tables — every fix is additive.

### Fixed
- **Auth gates added** to 13 unauthenticated endpoints in `server/routes.ts`: `/api/users`, `/api/attachments` GET+POST, `/api/quotes` (+`:id`, `/next-number`, `/:id/print`, `/:id/download/xlsx`, `/export`, `/:quoteId/line-items`, `/:quoteId/services-estimates`), `/api/activities|tasks|comm-lists|campaigns/export`. All return 401 to anonymous callers.
- **SQL-injection fix**: two `sql.raw` activity inserts in `/api/attachments` POST/PATCH replaced with parameterised `sql\`\`` template literals — malicious filename/title can no longer break out.
- **CVE patches** via `package.json` deps + overrides:
  - axios `^1.14.0` → `^1.15.0`, dompurify → `^3.4.0`, lodash → `^4.18.0`, vite → `^7.3.2`
  - follow-redirects pinned to `^1.16.0` via overrides (transitive)
  - `overrides.axios` rewritten to `"$axios"` reference syntax to avoid `EOVERRIDE` conflict.
- Final dep audit: critical=0, high=1 (drizzle-orm major bump, deferred), moderate=0.

### Voice-assistant Build #2 follow-up fixes
- `hasWriteIntent` regex in `server/voice-assistant.ts` (lines 1078, 1249) expanded to match create/schedule/remind/book/task/lead verbs so create_* tools are reachable.
- `executeCreateCalendarEvent` in `server/voice-assistant-safety.ts:1119` now rejects past `start_time`.

### Reports
- `threat_model.md` — STRIDE summary, trust zones, top risks ranked.
- `SECURITY_FINDINGS.md` — every finding with severity, status, file:line, and remediation; deferred items ledgered with rationale.

## Weather Forecast Widget (Apr 2026)
**Scope (Option C, additive only — no schema changes, no migrations, no package edits).**

Per-user opt-in dashboard widget showing current conditions, 24-hour hourly strip, and 7-day forecast for one or more saved locations. Uses Open-Meteo (no API key, no SDK).

**Schema reuse**: prefs persist at `users.permissions.weather` (existing JSONB column). Single source of truth in `shared/weather-types.ts` (Zod `weatherPrefsSchema` + derived TS).

**Server**: `PATCH /api/users/me/layout` extended to accept a `weather` payload — strict Zod validation, ~8KB byte cap, atomic single-key merge via `jsonb_set(coalesce(permissions,'{}'::jsonb),'{weather}',$1::jsonb,true)` so sibling permission keys (e.g. `mail_team`) are preserved and there's no read-modify-write race.

**Client** (`client/src/components/widgets/weather/`): 13 files — types, WMO→lucide icon map, condition×time-of-day gradient bg, prefs hook (parse-on-read + serialized mutation queue + optimistic overlay), geolocation→IP→fallback resolver, Open-Meteo forecast hook (15min cache + auto-refresh), debounced+abortable geocoding, skeleton (CLS-safe), current/hourly/7-day blocks, locations dialog (search, drag-reorder, dedup, max 10), main widget. Reduced-motion respected; ARIA labels on temp/location/hourly/7-day; keyboard-accessible Select.

**Wiring**: `weather: WeatherWidget` registered in `ACTION_WIDGET_MAP` (`action-widgets.tsx`); size hint `{w:4,h:11,minW:3,minH:7}` in `dashboard-grid.tsx`; `weather` widget def added to `NEW_WIDGETS` in `dashboard-config.ts` with `defaultVisible:false, isNew:true` and appended to all 7 center arrays (ceo/cfo/cto/cmo/sales/cs/default) so every user sees the toggle in their visibility panel — defaulted off until they enable it.

**Default fallback city** when geolocation and IP-based detection both fail: Vancouver, BC (`HARDCODED_FALLBACK_CITY` in `client/src/components/widgets/weather/weather-types.ts`). User-overridable via `permissions.weather.defaultCityFallback`.

## Role-card widget migration into draggable grid (Apr 2026)
**Scope (additive only — no schema changes, no migrations, no package edits).**

Six widgets that historically rendered as a static block underneath the draggable `DashboardGrid` (and so could not be reordered or hidden by drag-and-drop) were migrated into the grid system:

| Widget id | Title | Source | New file |
|---|---|---|---|
| `summary_bullets` | Executive Snapshot | `ceo-center.tsx` | `client/src/components/widgets/role-cards/executive-snapshot.tsx` |
| `pipeline_health` | Pipeline Health | `ceo-center.tsx` | `client/src/components/widgets/role-cards/pipeline-health.tsx` |
| `cert_blockers` | Certification Blockers | `ceo-center.tsx` + `cto-center.tsx` | `client/src/components/widgets/role-cards/cert-blockers.tsx` |
| `deployment_blockers` | Deployment Blockers | `ceo-center.tsx` + `cto-center.tsx` | `client/src/components/widgets/role-cards/deployment-blockers.tsx` |
| `close_opps_score` | Close-Likelihood Deals | `ceo-center.tsx` | `client/src/components/widgets/role-cards/close-likelihood-deals.tsx` |
| `key_accounts` | Key Accounts Needing Action | `ceo-center.tsx` | `client/src/components/widgets/role-cards/key-accounts-action.tsx` |

Each component is self-contained: it fetches its own data through React Query (queryKeys `/api/executive/kpis`, `/api/executive/risk-alerts`, `/api/pipeline/forecast`, `/api/cs/dashboard`, `/api/projects/cert-summary`, `/api/deployments/dashboard`, plus `useCommandCenterWidgets`). Shared queryKeys are deduplicated by React Query's cache, so registering the same widget multiple times across role centers does not multiply network traffic. Shared layout primitives (`RoleWidgetCard`, `RoleRow`, `fmt$`) live in `client/src/components/widgets/role-cards/role-card-helpers.tsx`; the directory's `index.ts` is a barrel export.

**Wiring**: each widget id is registered in `ACTION_WIDGET_MAP` (`action-widgets.tsx`) and given a size hint in `dashboard-grid.tsx` (mostly `w:6, h:8–10`). The widget-visibility keys already existed in `dashboard-config.ts` (`CLASSIC_WIDGETS` + per-role `WIDGET_DEFS`), so no config changes were needed — visibility, ordering, and gating just work.

**Duplicate removal**: the conditional render blocks for these 6 widgets were stripped from `ceo-center.tsx` (all 6) and `cto-center.tsx` (`cert_blockers`, `deployment_blockers`) so they now appear exclusively inside the draggable grid. Other role-center widgets (`revenue_at_risk`, `churn_score`, `install_workflows`, `procurement_blocked`, etc.) were left in place.

## Mail source default + settings consolidation (Apr 2026)
**Scope (UI / localStorage only — zero schema changes, zero `db:push`, zero backend.)**

The inbox `mailSource` selector (Auto / Local / Gmail) was removed from the in-page toolbar in `client/src/pages/gmail-inbox.tsx` and the global default was flipped from `"local"` to **`"gmail"`** so every user (current + future) lands on the live Gmail view by default. The state initializer at line ~2587 now resolves in this order: `?mailSource=` URL param → `localStorage["voltsafe.mailSource"]` → `"gmail"`.

A new **Mail preferences** card was added to `client/src/pages/mailbox-settings.tsx` (component `MailPreferencesCard`, defined just above `HealthLegend`, rendered right after the page header). It writes the selection to `localStorage["voltsafe.mailSource"]` and shows a toast confirming the change applies on next inbox open. Programmatic, transient `setMailSource` calls inside the inbox (forced `"local"` for the All Inboxes unified view; "Switch to live Gmail" backfill CTA) are intentionally left untouched and do **not** persist back to localStorage — they are mode switches, not preferences.

## Vite runtime-error-overlay extension-noise filter (Apr 2026)
**Scope (vite.config.ts only — zero schema changes, zero backend changes.)**

The `[plugin:runtime-error-plugin] (unknown runtime error)` overlay was firing on `/gmail` (and intermittently elsewhere) with no actionable stack. Root cause: SES (Hardened JavaScript, used by MetaMask / Phantom / Coinbase Wallet extensions) injects `lockdown-install.js` into every page; when the injection runs inside our intentionally-sandboxed email-body `srcdoc` iframes (no `allow-scripts` token), it throws bare `null`. The Vite plugin's client script (`node_modules/@replit/vite-plugin-runtime-error-modal/dist/index.mjs` lines 56–78) wraps any non-`Error` value caught by `window.onerror` / `unhandledrejection` as `new Error("(unknown runtime error)")` and forwards it to the dev server, which then renders the full-screen overlay.

**Fix** (`vite.config.ts`): added the plugin's documented `filter(error)` option (server-side hook in `configureServer`, lines 21–32 of the plugin) to drop overlays where (a) `error.message === "(unknown runtime error)"` — the exact wrapper string for non-Error throws; (b) the stack contains `chrome-extension://` / `moz-extension://` / `safari-web-extension://` / `safari-extension://` / `lockdown-install`; or (c) the message contains `SES_UNCAUGHT_EXCEPTION`. Returning `false` suppresses only the overlay — errors remain visible in DevTools. Verified safe: zero `Promise.reject(<value>)` and zero `throw <literal>` in `client/src`, so the wrapper-message filter cannot mask any legitimate app error. Trade-off documented inline: a future `new Error("(unknown runtime error)")` in app code would also be silently suppressed — pick a different message string if that ever needs an overlay.

**Earlier attempt rejected**: an inline `<script>` in `<head>` of `client/index.html` registering capture-phase `error` / `unhandledrejection` listeners with `stopImmediatePropagation()` was prototyped, then reverted on architect review — it would have suppressed events for *all* downstream observers (Sentry, custom telemetry, etc.), and missed the bare-`null` rejection case. The plugin-filter path is the cleaner extension point.

## Canadian marinas CSV export for ChatGPT enrichment (Apr 2026)
**Scope (one-shot data export — zero schema changes, zero `db:push`, zero backend route changes.)**

Operator request: hand ChatGPT a single file containing every fillable marina field in the CMS, pre-populated with all existing Canadian accounts so it can dedupe + enrich, plus copy-paste research instructions for finding additional Canadian marinas.

**Deliverables** (both in `exports/`, presented to user via the asset card):
- `canadian_marinas_for_chatgpt.csv` — 234.5 KB, 971 lines (1 header + 3 example rows + **967 existing Canadian accounts**, filter `country ILIKE 'canada' OR country ILIKE 'ca'`). Distribution: ON 462, BC 227, QC 88, NS 52, plus rest. Generated by `scripts/export-canadian-marinas-csv.ts` via `db.execute(sql\`…\`)` (drizzle, neon-http) — NOT through the SQL tool, because that returned pre-serialized comma-CSV that broke on multi-line `notes` fields and produced phantom rows (1562 instead of 967). Real client returns clean object rows; the script's `csvEsc()` is RFC-4180-compliant (quotes any cell with `,` `"` `\r` `\n`).
- `chatgpt_marina_research_instructions.md` — 12.4 KB, 223 lines. Defines the 4 dedup heuristics (name / city+name / postal+name / street), the 3 action codes (`NEW` / `EXISTING_ENRICH` / `EXISTING_KEEP`), per-column allowed values (full English province names, IANA timezones, region buckets Atlantic|Central|Prairie|Pacific|Northern, segment/marina_type/ownership_type enums, E.164 phone format), source-quality rules, and a target of "200–400 new marinas" with priority on under-represented regions (Atlantic Canada, Quebec, BC inland lakes, MB/SK, Northern ON).

**Column set (33 total)** — DELIBERATELY excludes every CRM-internal column so ChatGPT cannot clobber operator state on re-import: omitted are `lead_status`, `priority`, `assigned_to_user_id`, `beta_tester`, `pilot_candidate_score`, `red_flags`, `last_interaction_at`, `next_action*`, `notes_summary`, `org_type`, `partner_*`, `influence_score`, `strategic_importance`, `priority_level`, `membership_status`, `marinas_represented`, `partner_metadata`, `converted_from_*`, `acquisition_channel`, `original_source`, `source_captured_at`, `territory_id`, and the entire revenue-architecture block (`total_slips`, `voltsafe_slips_live`, `non_voltsafe_slips_on_software`, `future_upgrade_slips`, `contracted_units`, `installed_units`, `remaining_units`, `contracted_hardware_value`, `booked_hardware_value`, `delivered_hardware_value`, `rollout_*`, `pricing_lock_*`, `commercial_notes`). Included are the 32 researchable identity / location / marina-spec / contact fields plus a leading `action` column for ChatGPT to flag each row.

**Primary contact join**: `LEFT JOIN` on a `DISTINCT ON (account_id) … ORDER BY is_primary DESC, id ASC` CTE so accounts with zero contacts still appear with empty contact cells, and accounts with multiple contacts surface the flagged primary (or oldest contact as fallback).

**Verified incidental**: legacy `accounts.address` column has zero rows populated for Canadian accounts (`COUNT FILTER WHERE address IS NOT NULL = 0`), so omitting it from the export drops no data. Architect flagged this as a precaution; no fix needed.

**No re-import path was built** — operator will hand the resulting enriched CSV back for manual review before any DB changes. Importer is a follow-up task if/when desired.

## US marinas CSV export — same exercise for the US (Apr 2026)
**Scope (one-shot data export — zero schema changes, zero `db:push`, zero backend route changes.)**

Operator follow-up to the Canadian export: same CSV + ChatGPT-instructions deliverable for US accounts. Refactored the original single-purpose `scripts/export-canadian-marinas-csv.ts` into a parameterized `scripts/export-marinas-csv.ts` accepting `--country=CA|US`; old script deleted (the new one writes the identical CA filename so re-running CA still produces `canadian_marinas_for_chatgpt.csv` byte-equivalent).

**Country config** (`COUNTRY_CFG` map in the script): each entry holds the `country ILIKE` SQL filter, slug for filename, default `lead_source` value, and the example-row vitals (province/city/postal/timezone/lat-lng/tags/phone). Filter for US is broad: `country ILIKE 'usa' OR country ILIKE 'us' OR country ILIKE 'united states' OR country ILIKE 'united states of america'`.

**Deliverables** (both in `exports/`, presented via the asset card):
- `usa_marinas_for_chatgpt.csv` — 1.4 MB, 9,917 lines (1 header + 3 example rows + **9,913 existing US accounts**). State leaders: FL 1309, NY 1192, CA 660, MI 520, NJ 506, MA 496, MD 468, WA 364, ME 332, CT 314.
- `chatgpt_usa_marina_research_instructions.md` — 14.0 KB. Mirror of the CA prompt with US-specific values: full English state names (no `FL`/`NY` abbreviations), 5-digit or 5+4 ZIP, **11 region buckets** (`Northeast` / `Mid-Atlantic` / `Southeast` / `Gulf` / `Great Lakes` / `Inland South` / `Plains` / `Mountain` / `Pacific Northwest` / `Pacific Southwest` / `Alaska` / `Territories`), full IANA timezone reference table (Eastern through American Samoa), and a target of **1,500–3,000 new marinas** with priority-gap callouts grounded in the actual distribution: TX (290 → should be 600+, Galveston/Corpus/Travis/Conroe/Texoma), CA (660 → 1000+, SF Bay/Delta/Tahoe/Shasta/Havasu), Mountain West reservoirs (AZ 23, CO 25, NV 10, UT 13, NM 5 — Powell/Mead/Mohave/Havasu/Pleasant), Inland South lakes (AR/OK/KY/MO — Cumberland/Texoma/Bull Shoals/Beaver), OR 123, HI 39, AK 60, MN 103, PA 122, MS 56. Source-quality section adds USACE/BoR/NPS/state-park concessionaire lists and AMI/state marine-trades rosters. Also adds parent-company guidance (Suntex / Safe Harbor / Westrec / Marinas International / Oasis / F3) since US consolidation has been heavy.

**Same researcher-safety guarantee**: 33-column header set is identical across both countries — every CRM-internal column (lead_status, priority, assigned_to_user_id, beta_tester, pilot_candidate_score, all `partner_*`, all revenue-architecture columns, source-attribution stamps, territory_id, etc.) is OMITTED so an enrichment cycle cannot clobber operator-only state.

## Canadian marinas import — first ChatGPT-enriched batch (Apr 2026)
**Scope (one-shot data import — zero schema changes, zero `db:push`, zero backend route changes.)**

Operator handed me a 52-row CSV (`attached_assets/canadian_marinas_enriched_import_*.csv`) of new Canadian marinas found via ChatGPT research using the prompt + CSV from the prior task. All 52 rows marked `action=NEW`. Built `scripts/import-marinas-from-csv.ts` to dedup against the existing 967 Canadian accounts and insert non-duplicates in a single transaction.

**Dedup strategy** (conservative): for each candidate, `normaliseName()` lowercases + strips a small stop-word list (`marina`, `marinas`, `the`, `inc`, `ltd`, `llc`, `resort`, `harbour`/`harbor`, `wharf`, `dock`, `yacht`, `club`, `boat`/`boats`, `and`, `&`, `at`, `of`) + Unicode-folds fancy quotes/hyphens (so "Ballantyne's Cove" matches "Ballantynes Cove" and "Pender Harbour Resort and Marina" matches "Pender Harbour Resort & Marina"). Match if (norm_name + state_province) hits OR (norm_name + norm_city) hits. Conservative auto-skip on any match. Anything name-empty after normalisation is flagged "suspect" and skipped for human review (zero in this batch).

**Sanitisation**: `parseIntOrNull` for numerics; `parseFloatOrNull` for lat/long; `parseBoolOrFalse` for booleans (defaulting to `false` instead of NULL because `expansion_plans` is `NOT NULL DEFAULT FALSE`); `sanitisePhone` rejects strings with fewer than 7 digits — caught the corrupted `-3464` value in the West Point Marina (PE) row's `contact_phone` cell (looked like a stray longitude fragment from ChatGPT's column shifting) and dropped it on insert. UTF-8 BOM at file start is also stripped.

**Insert path**: pure SQL `INSERT INTO accounts(...) VALUES(...) RETURNING id` via `tx.execute`, wrapped in `db.transaction()` so the whole batch rolls back on any failure. Defaults left to the table (`lead_status='new'`, `priority='medium'`, `org_type='marina_prospect'`, `segment='marina'`, `created_at`/`updated_at = now()`). No `contacts` rows created — none of the 52 supplied rows had a real contact name + email; importer logs but does not insert empty contact triples.

**Results**: 50 inserted (IDs **11127–11176**), 2 duplicates skipped:
- "Pender Harbour Resort **and** Marina" (Garden Bay, BC) → existing #820 "Pender Harbour Resort **&** Marina" (Sunshine Coast Regional District) — the `&`-vs-`and` fold from `STOP_WORDS` caught it
- "The Marina at Brentwood Bay Resort" (Brentwood Bay, BC) → existing #704 "Brentwood Bay Resort" (Brentwood Bay) — the marina is the resort

Provincial breakdown of the 50 inserts: NB 17, NS 15, BC 8, PE 6, NL 4. Canadian total: 967 → 1017.

**Dry-run mode**: `--dry-run` flag prints the dedup report and a sample of 5 would-be INSERTs but commits nothing. Was used to sanity-check before the real run.

**Re-runnability**: this script is idempotent against the same input file because the dedup logic now treats the just-inserted rows as existing. Re-running on the same CSV would skip all 52 rows as duplicates (verified mentally; not actually re-run to avoid noise).

## Today page — customisable widget grid (Apr 2026)

The `/today` page used to be a static "your day at a glance" dashboard. Replaced
with a fully customisable widget grid that mirrors the Command Center
architecture but is **independent** from it — toggling Today widgets does not
change Command Center widgets and vice versa.

**Files**
- `client/src/components/today/today-widgets.tsx` (NEW) — 8 widgets, catalog
  (`TODAY_WIDGET_DEFS`), id→component map (`TODAY_ACTION_WIDGET_MAP`), size
  hints (`TODAY_WIDGET_SIZE_HINTS`), and shared `useTodayData()` hook (one
  `useQuery(['/api/dashboard/today'])` — React Query dedupes across all 8
  widgets so only one network request fires).
- `client/src/components/command-centers/dashboard-grid.tsx` — merges
  Command Center registries with the Today registries at the grid layer
  (avoids a circular import with `action-widgets.tsx`).
- `client/src/pages/today.tsx` (REWRITTEN) — header with edit toolbar +
  Widgets sheet + DashboardGrid keyed by `resetSeed`.

**8 Today widgets** (all id-prefixed `today_*` so they cannot collide with
Command Center widgets in the flat `widgetVisibility` jsonb map):
`today_overview` (greeting + KPI strip), `today_suggested_actions`,
`today_meetings`, `today_tasks_due`, `today_overdue`, `today_email_activity`,
`today_hot_opportunities`, `today_new_leads`.

**Persistence model** — uses the EXISTING jsonb columns on `users`, no schema
work:
- `widgetVisibility` is a single flat map shared by every page; namespacing by
  id prefix (`today_*`) keeps the two surfaces isolated. Server PATCH
  `/api/users/me/layout` REPLACES this field, so visibility writes always merge
  against the freshest stored map (read via `queryClient.getQueryData` at
  mutate-time, not from the closure-captured profile — protects against
  cross-tab races).
- `dashboardLayouts.today` holds Today's grid positions. Server merges
  `dashboardLayouts` per-key, so saving here cannot disturb other dashboards.
- Reset visibility strips only `today_*` keys; reset layout sends
  `{ today: {} }` so the grid falls back to defaults via `reconcileLayouts`.

**Architect review** — pass; race-on-stale-write hardening applied as suggested.

## Quick Capture → Create Contact (auto-import + optional org)

**Auto-fetch on URL paste** (`client/src/components/contacts/create-contact-dialog.tsx`):
the URL tab watches the input via a debounced (~600ms) effect and silently
calls `POST /api/contacts/extract-from-url` as soon as the typed/pasted text
matches `^https?://[^\s]{6,}`. A `useRef` wrapper around `handleUrlFetch` keeps
the debounce timer from being torn down on unrelated re-renders. Guards:
the same trimmed URL is never auto-fetched twice (`autoFetched` state), the
auto-fire is skipped while `fetchingUrl` is true, and `autoFetched` is reset
both on dialog open/close (so reopening with the same URL still works) and on
fetch failure (so users can retry by pressing Import or editing). Manual Import
button pre-marks `autoFetched` so a manual click doesn't trigger the debounce
to re-fire after the response lands.

**Organization is optional** — backend "Unassigned Contacts" sentinel
(`server/routes.ts` ~L2767-2803): the `contacts.account_id` column is
`NOT NULL` in the existing schema and we do not change it. To make org
optional from the user's POV, `POST /api/contacts` substitutes a system
account named "Unassigned Contacts" (segment `system`, leadStatus `new`,
priority `low`) whenever the request body has no `accountId`. The helper
`getOrCreateUnassignedAccountId` caches the resolved id in module scope and
serializes the first cold-start lookup through an in-process promise lock
(`pendingUnassignedAccountId`) so concurrent first-request traffic cannot
create duplicate sentinels — the lookup uses an exact-name match against a
generous ilike search (limit 200) before falling through to creation. The
dialog's `canSave` was relaxed from "needs org" to "needs name only", and
`handleSave` only spreads `accountId` into the request body when one was
picked. The org picker label drops the asterisk and shows
"Optional — link later"; users can move the contact out of the sentinel later
by editing it and choosing the right organization.

---

## Smart Inbox view (Spark-style sectioned grouping) — Apr 2026

`client/src/pages/gmail-inbox.tsx` now ships with **two inbox views** the user
toggles between via a 2-button radiogroup in the toolbar (next to the density
picker, gated behind `md:`):

- **Classic Inbox** *(default)* — flat chronological list (the existing
  behaviour, untouched).
- **Smart Inbox** — sections in the order **Priority → Unread (People /
  Notifications / Newsletters) → Pinned → Seen**, modelled on Spark Mail.

### Mapping (no schema change)

| Section        | Source                                                           |
| -------------- | ---------------------------------------------------------------- |
| Priority       | `STARRED` Gmail label (read OR unread)                           |
| Unread/People  | `UNREAD` & not in any `CATEGORY_*` label other than primary      |
| Notifications  | `UNREAD` & `CATEGORY_UPDATES` or `CATEGORY_SOCIAL`               |
| Newsletters    | `UNREAD` & `CATEGORY_PROMOTIONS` or `CATEGORY_FORUMS`            |
| Pinned         | localStorage `inbox.pinnedThreads` (read+unread, **not** STARRED)|
| Seen           | everything else, newest first                                    |

A message lands in **exactly one** bucket — the grouper short-circuits with
`continue` after the first match, so the same row can't render twice.

### Files

- **NEW** `client/src/components/inbox/smart-inbox-grouper.ts` — pure
  `groupSmartInbox()` returning a discriminated `SmartItem<M>` union of header
  and message items, plus `useInboxViewMode()` and `usePinnedThreads()` hooks
  (both localStorage-backed with cross-tab `storage` event sync).
  - localStorage keys: `inbox.viewMode` (`"classic" | "smart"`, default
    `"classic"`) and `inbox.pinnedThreads` (JSON `string[]` of threadIds).

- **MODIFIED** `client/src/pages/gmail-inbox.tsx`:
  - View-mode picker UI added next to the density toggle (`data-testid=
    "view-mode-toggle"`, button testids `button-view-smart` /
    `button-view-classic`).
  - `viewItems` `useMemo` computes the grouped item array when smart mode is
    active and the tab supports it (drafts/scheduled/folder/review fall back to
    classic). Memo deps: `[isSmartView, crmFilteredMessages, pinnedAPI.pinned]`.
  - The single `crmFilteredMessages?.map((msg) => ...)` row iterator now
    iterates `viewItems ?? <fallback union>` and branches at the top: header
    items render a `sticky top-0 z-[1] bg-muted/15 backdrop-blur-sm`
    section bar with an icon (Flame / Users / Bell / Newspaper / Pin /
    MailOpen) and a count; message items destructure `const msg = item.msg`
    and run the existing 200-line row JSX **unchanged**. This keeps the diff
    surgical and means *every* existing row interaction (selection, star,
    archive, reply, block, hover actions) keeps working untouched.
  - A small **Pin / PinOff** button appears in the row hover action bar
    immediately after the Star button, **only when Smart view is active** —
    Classic users never see it. Pinning surfaces a read thread in the Pinned
    section without re-marking it unread.

### Why localStorage for Pin (not Gmail's IMPORTANT label)

Gmail auto-applies `IMPORTANT` to a wide swath of mail, which would make the
Pinned section unmanageable on day one. Using a per-user localStorage set
keeps the Pinned section curated by the user and avoids round-tripping a
schema-touching API. Pin state is therefore browser-local — fine for v1; a
future revision can promote it to a server-side column when the team is ready.

### Sticky headers

Section headers use `sticky top-0` and rely on the existing `inboxScrollRef`
container (`<div ref={inboxScrollRef} className="flex-1 overflow-y-auto …">`)
as their containing block. Don't add `overflow: hidden` to any wrapper between
the row map and `inboxScrollRef` or sticky behaviour will silently break.
