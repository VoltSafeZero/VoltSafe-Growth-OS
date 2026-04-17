# Replit Agent Configuration

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
