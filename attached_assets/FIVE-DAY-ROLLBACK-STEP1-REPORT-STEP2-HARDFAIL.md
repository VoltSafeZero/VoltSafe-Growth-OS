# CONTROLLED FIVE-DAY CODE ROLLBACK — TEST BEFORE PROMOTION
# Step 1 Report + Step 2 Hard-Fail

**Document:** CONTROLLED-FIVE-DAY-CODE-ROLLBACK-TEST-BEFORE-PROMOTION  
**Branch:** `recovery/pre-mail-stable-staging`  
**Report date:** 2026-08-01  
**Status:** STEP 1 COMPLETE (with contamination findings) — STEP 2 HARD FAIL (ROLLBACK_CLONE_DB_URL not set)

---

## STEP 1 — VERIFY RECOVERY BRANCH

### 1.1 Branch identity

```
Current branch:  recovery/pre-mail-stable-staging ✅
```

### 1.2 HEAD SHA and full parent chain

```
HEAD    00568e4b71f14afd921be6d48a84c86140315719
        "Add recovery validation logs and gate reports to attached assets"
        2026-08-01 00:36:21 UTC  — documentation only, no code changes
        Parent: 02788b2e

02788b2e c14f1e178be90a112b03aeac59c92afa
        "Add functional validation report for production clone controlled rollback"
        2026-08-01 00:26:58 UTC  — documentation only
        Parent: cd0226e2

cd0226e2 4cf40aa1699b13bfb8d9151ddd3ffc18
        "Add rollback gate correction verification and completion report documentation"
        2026-08-01 00:04:43 UTC  — documentation only
        Parent: e71a0d20

e71a0d20 6fc552c4ab3b5a95b02220bebd1b924a  ← TAG: pre-mail-stable-hardened-staging
        "step5: gate all startup writers behind ROLLBACK_VALIDATION_READ_ONLY"
        2026-08-01 00:03:42 UTC  — all 27 startup writers gated
        Parent: 10881eb6

10881eb6 e0481dcdfeca7e9668b23efee9521b60
        "Update help center documentation and add rollback instructions asset"
        2026-07-31 23:35:26 UTC  — documentation only
        Parent: f08ea105

f08ea105 77c479c6af29bbd96deb9b80fd7d3593
        "docs: add Step 4 completion report for controlled rollback build"
        2026-07-31 23:34:49 UTC  — documentation only
        Parent: ba539a7e

ba539a7e 42395cd7ba1c4420d8e704e1e0faa541
        "recovery: add seed kill-switch, call-site guard, and migration gate"
        2026-07-31 23:32:50 UTC  — seed/migration kill-switches added
        Parent: b95e5374

b95e5374 4ae32fc0991e3d7965de2af77a4c55c3  ← recovery/pre-mail-stable
        "Add rollback discovery documentation asset"
        Parent: 0dc8f604

0dc8f604 62135e58f7c0d13d42a521a0f40a4224  ← TAG: pre-mail-stable-2026-07-27
        "Published your App"
        2026-07-27 08:05:24 UTC  ← CLEAN BASELINE
```

**Ancestry check:** `0dc8f604 IS ancestor of HEAD` ✅ — confirmed via `git merge-base`.

All commits between `0dc8f604` and HEAD are linear (no merge commits; every commit has exactly one parent). The documentation-only commits between `e71a0d20` and HEAD (`00568e4b`) contain no code changes.

### 1.3 Key file checks

| Check | Result |
|-------|--------|
| `client/src/pages/current.tsx` exists | ✅ PRESENT |
| `client/src/pages/currents.tsx` absent | ✅ ABSENT |
| Original `/api/current/*` routes exist | ✅ CONFIRMED (37 routes from line 36828 onward) |
| Replacement `/api/currents/*` routes absent | ❌ ONE ROUTE FOUND — see §1.4 |
| `git status` clean | ✅ Clean (only untracked: uploaded document) |

### 1.4 Contamination findings — replacement namespace remnants

Three contamination issues were found. None corrupt schema or data. All are navigational or URL-naming artifacts introduced during the July 27–31 Mail campaign period.

---

#### CONTAMINATION-1 (server) — `/api/currents/files` route

**File:** `server/routes.ts` line 39753  
**Severity:** MEDIUM — wrong URL namespace; the route itself is legitimate

```
// GET /api/currents/files — paginated file library for a channel or DM conversation
app.get("/api/currents/files", requireAuth, async (req, res) => {
```

**What it does:**  
A paginated attachment file library for channels and DMs, with search, file type filter, uploader filter, and date range filter. Access-checked via channel membership and admin role guard.

**Why it is contamination:**  
The route is registered under `/api/currents/` (plural — the replacement namespace) instead of `/api/current/` (singular — the original namespace). This URL was never present in `0dc8f604`.

**What it queries:**  
It queries the ORIGINAL schema tables only — `current_messages`, `current_conversation_members`, `attachments`. It does NOT reference any `currents_*` replacement tables. The data access is correct; only the URL prefix is wrong.

**Impact if shipped as-is:**  
Any client code calling `/api/currents/files` would work because the route exists. Any client code calling `/api/current/files` (the correct path) would 404 because that route doesn't exist. The Currents attachment file library feature would only work if the client uses the wrong URL.

**Correct fix (do not apply until Step 6 PASS):**  
Rename the route from `"/api/currents/files"` to `"/api/current/files"`.

---

#### CONTAMINATION-2 (server) — smart inbox aggregator link

**File:** `server/routes.ts` line 12017  
**Severity:** LOW — string value only; no route or schema impact

```js
currents: {
  title: "CURRENTS",
  count: currentsChannelMessages.length + currentsDmMessages.length,
  channel_messages: currentsChannelMessages,
  dm_messages: currentsDmMessages,
  empty_state: "No new messages.",
  link: "/currents"   // ← should be "/current"
},
```

**Impact:** The AI-assistant aggregator (used in the Cortex / smart-inbox sidebar widget) returns a link of `/currents` for the Currents section. That route does not exist in the router — only `/current` is registered (confirmed at `App.tsx` line 435). Any "Open Currents" link generated by the AI aggregator would navigate to a non-existent page.

**Correct fix (do not apply until Step 6 PASS):**  
Change `link: "/currents"` → `link: "/current"` (one character).

---

#### CONTAMINATION-3 (client) — CEO cockpit deep-links to `/currents`

**File:** `client/src/components/today/ceo-cockpit-sections.tsx` lines 644, 657, 682  
**Severity:** LOW — dead navigation links in the CEO Today view only

```tsx
// Line 644 — "View all in Currents" button
<Link href="/currents">

// Lines 657, 682 — per-channel hotspot links
<Link key={ch.id} href={`/currents?channel=${ch.slug}`}>
```

**Impact:** The CEO Today cockpit renders Currents channel hotspots and a "View in Currents" button. These three Link elements point to `/currents?channel=...` which the router does not handle — only `/current` is registered. Clicking these links in the CEO view navigates to a blank/404 page instead of the channel. Does not crash the app; the Currents module itself is still reachable directly at `/current`.

**Note — task-detail-drawer.tsx is CLEAN:** The `buildCurrentsUrl()` helper in `task-detail-drawer.tsx` correctly generates `/current?channel=...` URLs (line 31). The `sourceContext: "currents_channel"` / `"currents_record"` strings in that file are data enum values, not URLs — they are fine.

**Correct fixes (do not apply until Step 6 PASS):**  
Change the three `href="/currents"` / `href={\`/currents?...\`}` references to `/current`.

---

### 1.5 Step 1 summary

| Check | Status |
|-------|--------|
| Branch: `recovery/pre-mail-stable-staging` | ✅ PASS |
| Contains `0dc8f604` as ancestor | ✅ PASS |
| `current.tsx` present | ✅ PASS |
| `currents.tsx` absent | ✅ PASS |
| Original `/api/current/*` routes present | ✅ PASS |
| Replacement `/api/currents/*` routes absent | ❌ ONE FOUND — `GET /api/currents/files` |
| `git status` clean | ✅ PASS |
| No `currents_*` schema contamination in server code | ✅ PASS (route queries `current_*` tables only) |
| Contamination count | 3 issues — 1 server route (wrong URL prefix), 2 client link sets (wrong path) |

**The contamination is superficial and fixable.** All three issues are URL-naming artifacts. None touch the database schema, none query `currents_*` tables, and the Currents module itself (`current.tsx` + `/api/current/*`) is completely intact. All three can be fixed with trivial single-line changes once Step 6 returns PASS.

---

## STEP 2 — DATABASE CLONE ONLY

### Hard-fail conditions checked

| Condition | Result |
|-----------|--------|
| `ROLLBACK_CLONE_DB_URL` is set | ❌ NOT SET (length = 0) |
| Equals `DATABASE_URL` | — (cannot compare; primary is missing) |
| Equals production connection string | — (cannot compare; primary is missing) |
| Clone identity matches production | — (cannot connect; no URL) |

**HARD FAIL: `ROLLBACK_CLONE_DB_URL` is not set in the workspace secrets.**

This check failed at the first condition. Per document instructions, execution stops here.

Steps 3–7 cannot proceed until `ROLLBACK_CLONE_DB_URL` is added to the Replit workspace secrets.

---

## WHAT TREVOR MUST DO BEFORE PROCEEDING

Trevor needs to:

1. **Create a Neon branch clone** of the production database:
   - Go to `https://console.neon.tech`
   - Create a new branch from the primary/production branch
   - Suggested name: `rollback-validation-2026-07-31`
   - Branch from: Head (current production state)
   - Note the connection string for a read-only (or read-write) role on the clone

2. **Add the secret to the Replit workspace:**
   - In the Replit sidebar, open **Secrets** (lock icon)
   - Add key: `ROLLBACK_CLONE_DB_URL`
   - Value: the full Neon connection string (postgresql://...) for the clone
   - The connection string must NOT be the same as `DATABASE_URL` (dev) or the production `PROD_DATABASE_URL`

3. **Report back** that the secret has been added, with (no credentials needed):
   - Clone branch name
   - Clone creation timestamp
   - Source LSN (shown in Neon branch details as "Parent LSN")
   - Approximate clone size as shown in the Neon console
   - Confirmation that the production branch was not modified

Detailed Neon console steps (Option A/B/C) are in: `attached_assets/RECOVERY-GATE1-COMPLETE-GATE2-BLOCKED-REPORT.md` §"EXACT HUMAN STEPS FOR TREVOR"

---

## STOPPED — STEP 3 NOT ENTERED

Steps 3–7 are blocked until `ROLLBACK_CLONE_DB_URL` is available in the workspace secrets.

When Trevor adds the secret, the agent will immediately proceed with Step 2 identity verification, Step 3 read-only startup against the clone, Steps 4–6 functional walkthrough and acceptance gate, and Step 7 final report.
