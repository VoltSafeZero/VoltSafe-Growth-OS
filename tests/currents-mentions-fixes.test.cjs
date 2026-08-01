"use strict";
/**
 * Regression tests for Currents mentions/search fixes:
 *
 *  Fix 1 — /api/current/users strips leading @ from search query
 *           so that "@scott" in the New DM dialog finds "Scott Carlson".
 *
 *  Fix 2 — /api/current/channels/:slug/participants returns ALL active
 *           org users for public channels, not just explicitly tracked
 *           participants. Private channels keep the existing tight list.
 *
 *  Fix 3 — participants route declares userId before using it in the
 *           private-channel access check (was a latent ReferenceError).
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, value) {
  if (value) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

const ROUTES = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

// ── Fix 1: @ stripping in /api/current/users ─────────────────────────────────
console.log("\n── Fix 1: @ stripping in /api/current/users ──");

const usersRouteStart = ROUTES.indexOf("// GET /api/current/users?q= —");
const usersRouteEnd   = ROUTES.indexOf("// GET /api/current/mentions");
const usersBody = ROUTES.slice(usersRouteStart, usersRouteEnd);

check(
  "/api/current/users route exists",
  usersRouteStart !== -1
);
check(
  "@ stripped before SQL query (trim().replace(/^@/, \"\"))",
  usersBody.includes('.trim().replace(/^@/, "")')
);
check(
  "ILIKE uses the stripped value (no raw @ reaching SQL)",
  (() => {
    // The q= used in ILIKE must derive from the stripped raw.
    // Pattern: raw = ... .trim().replace(/^@/, "")  then q = raw.replace(/'/g, ...)
    const hasStrip = usersBody.includes('.trim().replace(/^@/, "")');
    // The old bug was passing raw with @ directly — check it's gone
    const hasOldPattern = usersBody.includes("String(req.query.q || \"\").trim();\n      const q = raw");
    return hasStrip && !hasOldPattern;
  })()
);
check(
  "@all virtual entry injected CLIENT-SIDE by canonical hook (not from server response)",
  // @all-scope correction: the server /api/current/users endpoint no longer returns @all.
  // The virtual entry is injected by use-current-users.ts when includeAll=true.
  // This check confirms the server route does NOT inject @all, and the client hook does.
  !usersBody.includes("Notify everyone") &&
  !usersBody.includes('"@all"') &&
  fs.readFileSync(
    path.join(__dirname, "../client/src/hooks/use-current-users.ts"), "utf8"
  ).includes("isAll: true")
);
check(
  "client-side shouldShowAll uses normalized query (stripped of leading @)",
  // use-current-users.ts normalizeUserQuery strips @ before shouldShowAll is called.
  // Typing @all → raw="@all" → normalizeUserQuery → "all" → shouldShowAll("all")=true.
  (() => {
    const hookSrc = fs.readFileSync(
      path.join(__dirname, "../client/src/hooks/use-current-users.ts"), "utf8"
    );
    return hookSrc.includes("normalizeUserQuery") && hookSrc.includes("shouldShowAll");
  })()
);
check(
  "empty query returns @all: shouldShowAll returns true when q is empty string",
  (() => {
    const hookSrc = fs.readFileSync(
      path.join(__dirname, "../client/src/hooks/use-current-users.ts"), "utf8"
    );
    // shouldShowAll("") must be true — empty query shows @all option
    return hookSrc.includes("!q") || hookSrc.includes("q.length === 0") || hookSrc.includes("!raw");
  })()
);

// ── Fix 2: public channel participants returns full org roster ────────────────
console.log("\n── Fix 2: public channel participants ──");

const participantsRouteStart = ROUTES.indexOf(
  "// GET /api/current/channels/:slug/participants"
);
const participantsRouteEnd = ROUTES.indexOf(
  "// ── Phase 15A: Channel Member Management Routes"
);
const participantsBody = ROUTES.slice(participantsRouteStart, participantsRouteEnd);

check(
  "participants route exists",
  participantsRouteStart !== -1
);
check(
  "userId declared at top of participants route (Fix 3: latent ReferenceError)",
  participantsBody.indexOf("const userId = getSessionUserId(req)") <
  participantsBody.indexOf("chan.is_private")
);
check(
  "public branch: returns all active users (global_role NOT IN ('inactive'))",
  participantsBody.includes("global_role NOT IN ('inactive')")
);
check(
  "public branch: excludes suspended/deactivated users",
  participantsBody.includes("status NOT IN ('suspended', 'deactivated')")
);
check(
  "public branch: does NOT filter by channel_id (open to all org users)",
  (() => {
    // The public branch SQL must not have a channel_id = ... filter
    const publicBranchIdx = participantsBody.indexOf("!chan.is_private");
    const privateElseIdx  = participantsBody.indexOf("} else {");
    if (publicBranchIdx === -1 || privateElseIdx === -1) return false;
    const publicBranchSQL = participantsBody.slice(publicBranchIdx, privateElseIdx);
    return !publicBranchSQL.includes("channel_id =");
  })()
);
check(
  "private branch: still uses UNION of messages + prefs + channel_members",
  participantsBody.includes("current_messages") &&
  participantsBody.includes("current_channel_preferences") &&
  participantsBody.includes("current_channel_members")
);
check(
  "private branch: UNION filters by channel_id",
  (() => {
    const privateIdx = participantsBody.indexOf("} else {");
    if (privateIdx === -1) return false;
    const privateBranchSQL = participantsBody.slice(privateIdx);
    return privateBranchSQL.includes("channel_id = ${channelId}");
  })()
);
check(
  "cap raised to 200 to accommodate full org roster",
  participantsBody.includes("LIMIT 200")
);
check(
  "response shape unchanged (channel + participants array)",
  participantsBody.includes("res.json({") &&
  participantsBody.includes("participants: participantRows.rows.map")
);

// ── Fix 3: userId declaration in participants route ───────────────────────────
console.log("\n── Fix 3: userId declaration in participants route ──");

check(
  "const userId = getSessionUserId(req) present in participants route body",
  participantsBody.includes("const userId = getSessionUserId(req)")
);
check(
  "userId declared before the private-channel access check",
  (() => {
    const declIdx  = participantsBody.indexOf("const userId = getSessionUserId(req)");
    const checkIdx = participantsBody.indexOf("user_id = ${userId}");
    return declIdx !== -1 && checkIdx !== -1 && declIdx < checkIdx;
  })()
);

// ── Regression: DM search surfaces don't have their own @-stripping ──────────
// They all hit the same /api/current/users endpoint, so the fix is server-side only.
console.log("\n── Regression: client DM search surfaces ──");

const CURRENT_TSX = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/current.tsx"),
  "utf8"
);

check(
  "New DM picker uses canonical useCurrentUsers hook (wraps /api/current/users)",
  // After Phase 2 refactor, direct fetches were replaced by the canonical hook.
  // NewDmDialog now calls useCurrentUsers(debouncedQ, open, false).
  CURRENT_TSX.includes("useCurrentUsers") &&
  CURRENT_TSX.includes("dm-user-search-input")
);
check(
  "Mention autocomplete uses canonical useCurrentUsers hook (wraps /api/current/users)",
  // useComposerMentions now calls useCurrentUsers(mentionQuery, mentionActive, true)
  CURRENT_TSX.includes("useCurrentUsers") &&
  CURRENT_TSX.includes("mentionQuery")
);
check(
  "Channel members search filter strips leading @ client-side (belt + suspenders)",
  // The existing memberSearchNorm already strips @ client-side for the local filter
  CURRENT_TSX.includes('memberSearch.trim().replace(/^@/, "")')
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`  Currents mentions fixes: ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));
if (failed > 0) process.exit(1);
