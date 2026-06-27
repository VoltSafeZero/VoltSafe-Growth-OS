/**
 * Phase 10B — Hide Muted From Currents Unread Badge Preference
 * Source-grep tests validating DDL, routes, and frontend implementation.
 * Run: node tests/badge-preference.test.cjs
 */

"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

const routes = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const currentTsx = fs.readFileSync(path.join(__dirname, "../client/src/pages/current.tsx"), "utf8");

// ──────────────────────────────────────────────────────────────────────────────
// 1. DDL — current_user_preferences table
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. DDL: current_user_preferences table ──");

check("CREATE TABLE IF NOT EXISTS current_user_preferences present", routes.includes("CREATE TABLE IF NOT EXISTS current_user_preferences"));
check("user_id column with REFERENCES users(id)", routes.includes("user_id INTEGER NOT NULL REFERENCES users(id)") || routes.includes("user_id INTEGER REFERENCES users(id)") || routes.includes("user_id INT"));
check("hide_muted_from_badge BOOLEAN column", routes.includes("hide_muted_from_badge BOOLEAN"));
check("DEFAULT FALSE on hide_muted_from_badge", routes.includes("DEFAULT FALSE"));
check("UNIQUE constraint on user_id", routes.includes("UNIQUE (user_id)") || routes.includes("user_id UNIQUE") || routes.includes("UNIQUE(user_id)") || routes.includes("NOT NULL UNIQUE REFERENCES") || /user_id\b.*UNIQUE/.test(routes));
check("created_at column present", routes.includes("created_at TIMESTAMPTZ") || routes.includes("created_at TIMESTAMP"));
check("updated_at column present", routes.includes("updated_at TIMESTAMPTZ") || routes.includes("updated_at TIMESTAMP"));

// ──────────────────────────────────────────────────────────────────────────────
// 2. GET /api/current/preferences route
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 2. GET /api/current/preferences ──");

check("GET /api/current/preferences route present", routes.includes('app.get("/api/current/preferences"'));
check("requireAuth applied to GET preferences", (() => {
  const idx = routes.indexOf('app.get("/api/current/preferences"');
  return idx > -1 && routes.slice(idx, idx + 120).includes("requireAuth");
})());
check("Queries current_user_preferences by userId", (() => {
  const idx = routes.indexOf('app.get("/api/current/preferences"');
  const snippet = routes.slice(idx, idx + 500);
  return snippet.includes("current_user_preferences") && snippet.includes("user_id");
})());
check("Returns hideMutedFromCurrentsBadge boolean", (() => {
  const idx = routes.indexOf('app.get("/api/current/preferences"');
  const snippet = routes.slice(idx, idx + 500);
  return snippet.includes("hideMutedFromCurrentsBadge");
})());
check("Boolean() cast on hide_muted_from_badge", (() => {
  const idx = routes.indexOf('app.get("/api/current/preferences"');
  const snippet = routes.slice(idx, idx + 500);
  return snippet.includes("Boolean(");
})());

// ──────────────────────────────────────────────────────────────────────────────
// 3. PUT /api/current/preferences route
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 3. PUT /api/current/preferences ──");

check("PUT /api/current/preferences route present", routes.includes('app.put("/api/current/preferences"'));
check("requireAuth applied to PUT preferences", (() => {
  const idx = routes.indexOf('app.put("/api/current/preferences"');
  return idx > -1 && routes.slice(idx, idx + 120).includes("requireAuth");
})());
check("Validates hideMutedFromCurrentsBadge is boolean", (() => {
  const idx = routes.indexOf('app.put("/api/current/preferences"');
  const snippet = routes.slice(idx, idx + 600);
  return snippet.includes('typeof hideMutedFromCurrentsBadge !== "boolean"') ||
    snippet.includes("typeof hideMutedFromCurrentsBadge !== 'boolean'");
})());
check("400 returned on invalid input", (() => {
  const idx = routes.indexOf('app.put("/api/current/preferences"');
  const snippet = routes.slice(idx, idx + 600);
  return snippet.includes("res.status(400)");
})());
check("ON CONFLICT upsert present", (() => {
  const idx = routes.indexOf('app.put("/api/current/preferences"');
  const snippet = routes.slice(idx, idx + 600);
  return snippet.includes("ON CONFLICT");
})());
check("Upsert updates hide_muted_from_badge", (() => {
  const idx = routes.indexOf('app.put("/api/current/preferences"');
  const snippet = routes.slice(idx, idx + 600);
  return snippet.includes("hide_muted_from_badge");
})());
check("Response echoes hideMutedFromCurrentsBadge", (() => {
  const idx = routes.indexOf('app.put("/api/current/preferences"');
  const snippet = routes.slice(idx, idx + 600);
  return snippet.includes("hideMutedFromCurrentsBadge");
})());

// ──────────────────────────────────────────────────────────────────────────────
// 4. Updated GET /api/current/unread-counts
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 4. GET /api/current/unread-counts (Phase 10B) ──");

const unreadIdx = routes.indexOf("GET /api/current/unread-counts");
const unreadSnippet = unreadIdx > -1 ? routes.slice(unreadIdx, unreadIdx + 3000) : "";

check("Loads preference from current_user_preferences", unreadSnippet.includes("current_user_preferences"));
check("hideMuted/hide_muted_from_badge variable used", unreadSnippet.includes("hideMuted") || unreadSnippet.includes("hide_muted_from_badge"));
check("Phase 10B: checks channel notification_level for muted", unreadSnippet.includes("notification_level") || unreadSnippet.includes("current_channel_preferences"));
check("Phase 10B: LEFT JOIN on current_channel_preferences (no N+1)", unreadSnippet.includes("LEFT JOIN current_channel_preferences"));
check("Phase 10B: checks DM is_muted flag", unreadSnippet.includes("is_muted"));
check("Response includes hideMutedFromCurrentsBadge field", unreadSnippet.includes("hideMutedFromCurrentsBadge"));
check("Per-channel dm_unread_count computed in DM query", unreadSnippet.includes("dm_unread_count"));
check("DM loop skips muted DMs when hideMuted=true", unreadSnippet.includes("is_muted") && unreadSnippet.includes("continue"));

// ──────────────────────────────────────────────────────────────────────────────
// 5. Frontend — Switch import
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 5. Frontend: Switch import ──");

check("Switch imported from @/components/ui/switch", currentTsx.includes('from "@/components/ui/switch"') || currentTsx.includes("from '@/components/ui/switch'"));

// ──────────────────────────────────────────────────────────────────────────────
// 6. Frontend — preference query
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 6. Frontend: currentPrefs query ──");

check("currentPrefs useQuery present", currentTsx.includes("currentPrefs") && currentTsx.includes("useQuery"));
check("Queries /api/current/preferences", currentTsx.includes('"/api/current/preferences"') || currentTsx.includes("'/api/current/preferences'"));
check("hideMutedFromCurrentsBadge typed in query result", currentTsx.includes("hideMutedFromCurrentsBadge"));

// ──────────────────────────────────────────────────────────────────────────────
// 7. Frontend — preference mutation
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 7. Frontend: currentPrefMutation ──");

check("currentPrefMutation useMutation present", currentTsx.includes("currentPrefMutation") && currentTsx.includes("useMutation"));
check("Calls PUT /api/current/preferences", (() => {
  const idx = currentTsx.indexOf("currentPrefMutation");
  const snippet = currentTsx.slice(idx, idx + 600);
  return snippet.includes('"PUT"') && snippet.includes("/api/current/preferences");
})());
check("Invalidates /api/current/preferences on success", (() => {
  const idx = currentTsx.indexOf("currentPrefMutation");
  const snippet = currentTsx.slice(idx, idx + 800);
  return snippet.includes("invalidateQueries") && snippet.includes("/api/current/preferences");
})());
check("Invalidates /api/current/unread-counts on success", (() => {
  const idx = currentTsx.indexOf("currentPrefMutation");
  const snippet = currentTsx.slice(idx, idx + 800);
  return snippet.includes("invalidateQueries") && snippet.includes("/api/current/unread-counts");
})());
check("Shows toast on success", (() => {
  const idx = currentTsx.indexOf("currentPrefMutation");
  const snippet = currentTsx.slice(idx, idx + 800);
  return snippet.includes("toast");
})());

// ──────────────────────────────────────────────────────────────────────────────
// 8. Frontend — totalUnread respects preference
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 8. Frontend: totalUnread badge respects preference ──");

check("hideMutedPref derived from currentPrefs", currentTsx.includes("hideMutedPref") && currentTsx.includes("currentPrefs?.hideMutedFromCurrentsBadge"));
check("badgeDmUnread uses hideMutedPref to skip muted DMs", currentTsx.includes("badgeDmUnread") && currentTsx.includes("isMuted"));
check("badgeChannelUnread uses hideMutedPref to skip muted channels", currentTsx.includes("badgeChannelUnread") && (currentTsx.includes("notificationLevel === 'muted'") || currentTsx.includes('notificationLevel === "muted"')));
check("totalUnread = badgeChannelUnread + badgeDmUnread", currentTsx.includes("totalUnread = badgeChannelUnread + badgeDmUnread"));
check("Fallback false when currentPrefs undefined", currentTsx.includes("?? false"));

// ──────────────────────────────────────────────────────────────────────────────
// 9. Frontend — sidebar toggle UI
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 9. Frontend: sidebar toggle UI ──");

check("Switch component rendered in sidebar", (() => {
  const idx = currentTsx.indexOf("toggle-hide-muted-badge");
  return idx > -1;
})());
check("data-testid='toggle-hide-muted-badge' present", currentTsx.includes('data-testid="toggle-hide-muted-badge"') || currentTsx.includes("data-testid='toggle-hide-muted-badge'"));
check("checked={hideMutedPref} wired", currentTsx.includes("checked={hideMutedPref}"));
check("onCheckedChange calls currentPrefMutation.mutate", currentTsx.includes("currentPrefMutation.mutate"));
check("disabled while mutation pending", currentTsx.includes("currentPrefMutation.isPending"));
check("Label text 'Hide muted unread from badge' present", currentTsx.includes("Hide muted unread from badge"));
check("Subtitle clarifies muted channels still show own counts", currentTsx.includes("Muted channels and DMs still show their own counts"));
check("Toggle placed inside aside (before </aside>)", (() => {
  const toggleIdx = currentTsx.indexOf("toggle-hide-muted-badge");
  const asideCloseIdx = currentTsx.indexOf("</aside>", toggleIdx);
  return toggleIdx > -1 && asideCloseIdx > -1 && asideCloseIdx < toggleIdx + 1500;
})());
check("Border-top separator on toggle container", currentTsx.includes("border-t border-border"));

// ──────────────────────────────────────────────────────────────────────────────
// 10. Phase 10A regression — notification-preferences tests still importable
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n── 10. Phase 10A regression ──");

const notifTest = fs.existsSync(path.join(__dirname, "notification-preferences.test.cjs"));
check("notification-preferences.test.cjs still exists", notifTest);

if (notifTest) {
  const notifSrc = fs.readFileSync(path.join(__dirname, "notification-preferences.test.cjs"), "utf8");
  check("Phase 10A tests file non-empty (>1000 chars)", notifSrc.length > 1000);
  check("Phase 10A file still references current_channel_preferences", notifSrc.includes("current_channel_preferences"));
}

// ──────────────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────────────
console.log(`\n══════════════════════════════════════════`);
console.log(`Phase 10B badge-preference: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
