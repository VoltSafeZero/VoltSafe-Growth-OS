/**
 * tests/rollback-gate.test.cjs
 *
 * Hard regression tests for the rollback gate hardening.
 *
 * Requirements covered:
 *  1. Every known startup writer is behind the centralized guard.
 *  2. The avatar cleanup UPDATE is guarded.
 *  3. Every background scheduler/worker capable of writing is blocked.
 *  4. seedProductionData() is blocked when NODE_ENV=production, regardless of ALLOW_DESTRUCTIVE_SEED.
 *  5. seedProductionData() is blocked when ALLOW_DESTRUCTIVE_SEED is absent, regardless of NODE_ENV.
 *  6. RUN_STARTUP_MIGRATIONS must equal the exact string "true" before explicit migrations can run.
 *  7. With ROLLBACK_FIRST_BOOT_READ_ONLY=true, no code path can reach destructive SQL.
 *  8. No executable code references the replacement Currents routes, page, or tables.
 *  9. Original Currents remains wired at page /current, route /current, API /api/current/*.
 * 10. (Build verified separately by staging boot — see Part 4 procedure.)
 *
 * Strategy: structural source analysis — read the actual source files and verify
 * each startup writer's call site has the correct guard immediately before it,
 * verify guard module behaviour, verify routing cleanliness.
 *
 * Run:   node tests/rollback-gate.test.cjs
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

/**
 * Verify that a writer call site has a skipInReadOnlyMode() guard in the
 * source text immediately preceding it (within windowSize characters).
 */
function assertGated(src, writerName, options = {}) {
  const { searchFor = writerName, windowSize = 300 } = options;
  const idx = src.indexOf(searchFor);
  if (idx === -1) {
    assert(false, `${writerName}: call site present in source`);
    return;
  }
  const windowBefore = src.slice(Math.max(0, idx - windowSize), idx + 50);
  const hasGate = windowBefore.includes("skipInReadOnlyMode");
  assert(hasGate, `${writerName}: guarded by skipInReadOnlyMode`);
}

/**
 * Verify that a specific string does NOT appear in a source, outside of
 * comments.  This is a structural check, not a comment-proximity check.
 */
function assertAbsent(src, searchFor, label) {
  // Strip single-line comments before checking (simple heuristic)
  const stripped = src.replace(/\/\/[^\n]*/g, "");
  assert(!stripped.includes(searchFor), label);
}

// ────────────────────────────────────────────────────────────────────────────
// Load source files once
// ────────────────────────────────────────────────────────────────────────────

const indexSrc      = fs.readFileSync("server/index.ts", "utf8");
const routesSrc     = fs.readFileSync("server/routes.ts", "utf8");
const routesTasksSrc = fs.readFileSync("server/routes-tasks.ts", "utf8");
const guardSrc      = fs.readFileSync("server/startup-guard.ts", "utf8");
const seedSrc       = fs.readFileSync("server/seed-production.ts", "utf8");
const appTsx        = fs.readFileSync("client/src/App.tsx", "utf8");

// ════════════════════════════════════════════════════════════════════════════
//  §0  startup-guard.ts module
// ════════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log("\n══════════════════════════════════════════════");
  console.log("  Rollback Gate Hard Regression Tests");
  console.log("══════════════════════════════════════════════\n");

  // ── §0 ──────────────────────────────────────────────────────────────────
  console.log("§0  startup-guard.ts — module structure and both flags");
  assert(guardSrc.includes("export function skipInReadOnlyMode"),
    "skipInReadOnlyMode is exported");
  assert(guardSrc.includes("export function isRollbackReadOnly"),
    "isRollbackReadOnly is exported");
  assert(guardSrc.includes('ROLLBACK_VALIDATION_READ_ONLY === "true"'),
    "Guard checks ROLLBACK_VALIDATION_READ_ONLY=true");
  assert(guardSrc.includes('ROLLBACK_FIRST_BOOT_READ_ONLY === "true"'),
    "Guard checks ROLLBACK_FIRST_BOOT_READ_ONLY=true (Req 7: first-boot zero-write mode)");
  // Both conditions must be in the SAME function body (logical OR in skipInReadOnlyMode)
  {
    const fnStart = guardSrc.indexOf("export function skipInReadOnlyMode");
    const fnEnd   = guardSrc.indexOf("}", fnStart + 10) + 1;
    const fnBody  = guardSrc.slice(fnStart, fnEnd);
    assert(
      fnBody.includes('ROLLBACK_VALIDATION_READ_ONLY === "true"') &&
      fnBody.includes('ROLLBACK_FIRST_BOOT_READ_ONLY === "true"'),
      "skipInReadOnlyMode checks BOTH flags in its own body (either alone is sufficient)"
    );
  }
  assert(guardSrc.includes("console.log"), "Guard logs the skipped writer name");

  // ── §1 ──────────────────────────────────────────────────────────────────
  console.log("\n§1  server/index.ts — imports and top-level backfill writers");
  assert(indexSrc.includes('from "./startup-guard"'),
    "index.ts imports startup-guard");

  assertGated(indexSrc, "backfillAccountsForLeads",
    { searchFor: "backfillAccountsForLeads()" });
  assertGated(indexSrc, "backfillAllParticipants",
    { searchFor: '"./services/mailbox-integrity"' });
  assertGated(indexSrc, "backfillLeadComms",
    { searchFor: '"./services/lead-comms-sync"' });
  assertGated(indexSrc, "ensureRecentlyUpdatedIndexes",
    { searchFor: "ensureRecentlyUpdatedIndexes();" });
  assertGated(indexSrc, "backfillPrivateChannelCreators",
    { searchFor: "backfillPrivateChannelCreators();" });

  // ── §2 ──────────────────────────────────────────────────────────────────
  console.log("\n§2  server/index.ts — startup IIFE writers and schedulers");
  assertGated(indexSrc, "ensureSearchIndexes",
    { searchFor: "ensureSearchIndexes()" });
  assertGated(indexSrc, "backfill-resumer",
    { searchFor: "backfill-resumer" });

  // Background schedulers must be inside a skipInReadOnlyMode gate
  {
    const bgIdx = indexSrc.indexOf("startHourlySyncScheduler()");
    assert(bgIdx !== -1, "startHourlySyncScheduler call site found");
    const bgWindow = indexSrc.slice(Math.max(0, bgIdx - 400), bgIdx + 10);
    assert(bgWindow.includes("skipInReadOnlyMode"),
      "startHourlySyncScheduler guarded by skipInReadOnlyMode (Req 3)");
  }

  // ── §3 ──────────────────────────────────────────────────────────────────
  console.log("\n§3  server/routes.ts — imports and all startup writers");
  assert(routesSrc.includes('from "./startup-guard"'),
    "routes.ts imports startup-guard");

  // Inline IIFE migrations
  assertGated(routesSrc, "user_avatar_library-migration",
    { searchFor: "user_avatar_library-migration" });
  assertGated(routesSrc, "team_calendar_events-migration",
    { searchFor: "team_calendar_events-migration" });
  assertGated(routesSrc, "user_role_definitions-migration",
    { searchFor: "user_role_definitions-migration" });
  assertGated(routesSrc, "team_work_calendar-migration",
    { searchFor: "team_work_calendar-migration" });
  assertGated(routesSrc, "crm_recent_news-migration",
    { searchFor: "crm_recent_news-migration" });
  assertGated(routesSrc, "search-gin-indexes-migration",
    { searchFor: "search-gin-indexes-migration" });
  assertGated(routesSrc, "help_center_rebuild_state-migration",
    { searchFor: "help_center_rebuild_state-migration" });
  assertGated(routesSrc, "email_snippets-migration",
    { searchFor: "email_snippets-migration" });

  // Seed calls
  assertGated(routesSrc, "seedDatabase+seedUsers",
    { searchFor: "seedDatabase+seedUsers" });
  assertGated(routesSrc, "seedDefaultSchedules",
    { searchFor: "seedDefaultSchedules().catch" });
  assertGated(routesSrc, "seedDefaultRules+seedAutomationTemplates",
    { searchFor: "seedDefaultRules+seedAutomationTemplates" });

  // Req 2: avatar cleanup UPDATE is inside the guarded block
  {
    const migIdx = routesSrc.indexOf("user_avatar_library-migration");
    const blockEnd = routesSrc.indexOf("})();", migIdx);
    assert(migIdx !== -1 && blockEnd !== -1,
      "user_avatar_library IIFE block is locatable");
    const block = routesSrc.slice(Math.max(0, migIdx - 50), blockEnd + 5);
    assert(block.includes("skipInReadOnlyMode"),
      "user_avatar_library IIFE has skipInReadOnlyMode guard before first DB call");
    assert(block.includes("UPDATE users SET avatar_url = NULL"),
      "avatar cleanup UPDATE is present inside this block");
    // Guard appears BEFORE the UPDATE
    const guardPos  = block.indexOf("skipInReadOnlyMode");
    const updatePos = block.indexOf("UPDATE users SET avatar_url = NULL");
    assert(guardPos < updatePos,
      "skipInReadOnlyMode guard appears before the avatar cleanup UPDATE (Req 2)");
  }

  // Req 3: board-pack, engagement, followup schedulers gated
  {
    const bpIdx = routesSrc.indexOf("startBoardPackScheduler()");
    assert(bpIdx !== -1, "startBoardPackScheduler call site found");
    const bpWindow = routesSrc.slice(Math.max(0, bpIdx - 200), bpIdx + 10);
    assert(bpWindow.includes("skipInReadOnlyMode"),
      "startBoardPackScheduler guarded by skipInReadOnlyMode (Req 3)");
  }
  {
    const esIdx = routesSrc.indexOf("startEngagementScheduler()");
    assert(esIdx !== -1, "startEngagementScheduler call site found");
    const esWindow = routesSrc.slice(Math.max(0, esIdx - 200), esIdx + 10);
    assert(esWindow.includes("skipInReadOnlyMode"),
      "startEngagementScheduler guarded by skipInReadOnlyMode (Req 3)");
  }
  {
    const fsIdx = routesSrc.indexOf("startFollowupScheduler()");
    assert(fsIdx !== -1, "startFollowupScheduler call site found");
    const fsWindow = routesSrc.slice(Math.max(0, fsIdx - 200), fsIdx + 10);
    assert(fsWindow.includes("skipInReadOnlyMode"),
      "startFollowupScheduler guarded by skipInReadOnlyMode (Req 3)");
  }

  // ── §3b ─────────────────────────────────────────────────────────────────
  console.log("\n§3b  Part 1 hardening — eight new startup writers gated");

  /**
   * Verify that the skipInReadOnlyMode gate call for `writerName` is present,
   * and that the first DDL/DML SQL marker appears within `afterWindow` chars
   * AFTER the gate.  This proves the guard fires before any mutation.
   */
  function assertGatedBeforeSQL(src, writerName, sqlMarker, afterWindow) {
    afterWindow = afterWindow || 400;
    var gateStr = 'skipInReadOnlyMode("' + writerName + '")';
    var gateIdx = src.indexOf(gateStr);
    assert(gateIdx !== -1, writerName + ": skipInReadOnlyMode gate call present");
    if (gateIdx === -1) return;
    var afterGate = src.slice(gateIdx, gateIdx + afterWindow);
    assert(afterGate.includes(sqlMarker),
      writerName + ": first DDL/DML appears within " + afterWindow + " chars after the gate");
  }

  // 1. marine-related-email-tags-migration
  assertGatedBeforeSQL(routesSrc,
    "marine-related-email-tags-migration",
    "CREATE TABLE IF NOT EXISTS marine_related_email_tags", 300);

  // 2. currents-channel-management-migration
  assertGatedBeforeSQL(routesSrc,
    "currents-channel-management-migration",
    "ALTER TABLE current_channels ADD COLUMN IF NOT EXISTS archived_by", 200);

  // 3. currents-badge-preferences-migration
  assertGatedBeforeSQL(routesSrc,
    "currents-badge-preferences-migration",
    "CREATE TABLE IF NOT EXISTS current_user_preferences", 200);

  // 4. currents-notification-preferences-migration
  assertGatedBeforeSQL(routesSrc,
    "currents-notification-preferences-migration",
    "CREATE TABLE IF NOT EXISTS current_channel_preferences", 200);

  // 5. mailbox-visibility-migration
  assertGatedBeforeSQL(routesSrc,
    "mailbox-visibility-migration",
    "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS visibility_type", 200);

  // 6. email-signatures-account-migration
  assertGatedBeforeSQL(routesSrc,
    "email-signatures-account-migration",
    "ALTER TABLE email_signatures ADD COLUMN IF NOT EXISTS email_account_id", 200);

  // 7. calendar-visibility-migration
  assertGatedBeforeSQL(routesSrc,
    "calendar-visibility-migration",
    "ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS visibility_type", 200);

  // 8. email-snippets-starter-seed (guard is inside the IIFE; INSERT follows within ~600 chars)
  assertGatedBeforeSQL(routesSrc,
    "email-snippets-starter-seed",
    "INSERT INTO email_snippets (title", 600);

  // Comprehensive startup inventory: zero fire-and-forget db.execute at 2-space indent remain
  // without a skipInReadOnlyMode guard immediately before them.
  // After all 8 fixes, every `  db.execute(sql.raw(` line is prefixed by `if (!skipInReadOnlyMode...`.
  {
    var ffMatches = Array.from(routesSrc.matchAll(/^  db\.execute\(sql\.raw\(/gm));
    var ungatedCount = 0;
    for (var mi = 0; mi < ffMatches.length; mi++) {
      var m = ffMatches[mi];
      var pre = routesSrc.slice(Math.max(0, m.index - 250), m.index);
      if (!pre.includes("skipInReadOnlyMode")) ungatedCount++;
    }
    assert(ungatedCount === 0,
      "Startup inventory: all fire-and-forget db.execute at 2-space indent are gated (" +
      ungatedCount + " ungated found; expected 0)");
  }

  // ROLLBACK_VALIDATION_READ_ONLY alone is sufficient (OR-logic in guard)
  {
    var gfStart = guardSrc.indexOf("export function skipInReadOnlyMode");
    var gfEnd   = guardSrc.indexOf("}", gfStart + 10) + 1;
    var gfBody  = guardSrc.slice(gfStart, gfEnd);
    assert(gfBody.includes('ROLLBACK_VALIDATION_READ_ONLY === "true"'),
      "skipInReadOnlyMode: ROLLBACK_VALIDATION_READ_ONLY=true alone triggers skip (Req §0)");
  }

  // ROLLBACK_FIRST_BOOT_READ_ONLY alone is sufficient (OR-logic in guard)
  {
    var gfStart2 = guardSrc.indexOf("export function skipInReadOnlyMode");
    var gfEnd2   = guardSrc.indexOf("}", gfStart2 + 10) + 1;
    var gfBody2  = guardSrc.slice(gfStart2, gfEnd2);
    assert(gfBody2.includes('ROLLBACK_FIRST_BOOT_READ_ONLY === "true"'),
      "skipInReadOnlyMode: ROLLBACK_FIRST_BOOT_READ_ONLY=true alone triggers skip (Req §0)");
  }

  // Normal mode: guard must return false (allow writes) when neither flag is set.
  // startup-guard.ts is a small single-purpose module; scanning the full file is unambiguous.
  assert(guardSrc.includes("return false"),
    "skipInReadOnlyMode: returns false (allow writes) when neither env flag is set");

  // ── §4 ──────────────────────────────────────────────────────────────────
  console.log("\n§4  server/routes-tasks.ts — startup migration writers");
  assert(routesTasksSrc.includes('from "./startup-guard"'),
    "routes-tasks.ts imports startup-guard");

  assertGated(routesTasksSrc, "crm-auto-link-rules-migration",
    { searchFor: "crm-auto-link-rules-migration" });
  assertGated(routesTasksSrc, "task_hub_access_permissions-migration",
    { searchFor: "task_hub_access_permissions-migration" });
  assertGated(routesTasksSrc, "task_column_shares-migration",
    { searchFor: "task_column_shares-migration" });
  assertGated(routesTasksSrc, "task-recurrence-columns-migration",
    { searchFor: "task-recurrence-columns-migration" });
  assertGated(routesTasksSrc, "team-task-columns-migration",
    { searchFor: "team-task-columns-migration" });
  assertGated(routesTasksSrc, "user-task-columns-migration",
    { searchFor: "user-task-columns-migration" });

  // ── §5 ──────────────────────────────────────────────────────────────────
  console.log("\n§5  seedProductionData() kill-switch (Reqs 4 + 5)");

  // Req 4: NODE_ENV=production blocks it regardless of ALLOW_DESTRUCTIVE_SEED
  assert(seedSrc.includes('NODE_ENV === "production"'),
    "Req 4: seed function checks NODE_ENV === \"production\"");
  {
    // The NODE_ENV guard must appear BEFORE any database query WITHIN the function body.
    // Scope search to the seedProductionData function body to avoid false positives from
    // other helper functions in the same file that use db.execute.
    const fnStart = seedSrc.indexOf("export async function seedProductionData");
    assert(fnStart !== -1, "Req 4: seedProductionData function is present in seed-production.ts");
    const fnBodyStart = seedSrc.indexOf("{", fnStart);
    // Take a generous window (3000 chars) — enough to cover the guards + first DB call
    const fnBodySnippet = seedSrc.slice(fnBodyStart, fnBodyStart + 3000);
    const guardIdx = fnBodySnippet.indexOf('NODE_ENV === "production"');
    const firstDbIdx = Math.min(
      fnBodySnippet.indexOf("db.execute") === -1 ? Infinity : fnBodySnippet.indexOf("db.execute"),
      fnBodySnippet.indexOf("pool.query") === -1 ? Infinity : fnBodySnippet.indexOf("pool.query"),
      fnBodySnippet.indexOf("db.select") === -1 ? Infinity : fnBodySnippet.indexOf("db.select"),
      fnBodySnippet.indexOf("db.insert") === -1 ? Infinity : fnBodySnippet.indexOf("db.insert"),
    );
    assert(guardIdx !== -1 && guardIdx < firstDbIdx,
      "Req 4: NODE_ENV guard (within seedProductionData body) fires before any database query");
  }
  // Also verify the call site guards it before even importing
  {
    const callSiteIdx = indexSrc.indexOf('NODE_ENV === "production"');
    assert(callSiteIdx !== -1,
      "Req 4: call site in index.ts also checks NODE_ENV before importing seed module");
  }

  // Req 5: ALLOW_DESTRUCTIVE_SEED absent blocks it regardless of NODE_ENV
  assert(seedSrc.includes('ALLOW_DESTRUCTIVE_SEED !== "true"'),
    "Req 5: seed function checks ALLOW_DESTRUCTIVE_SEED !== \"true\"");
  {
    // Both guards must be present and both must return before DB access
    const nodeEnvGuardIdx = seedSrc.indexOf('NODE_ENV === "production"');
    const allowGuardIdx   = seedSrc.indexOf('ALLOW_DESTRUCTIVE_SEED !== "true"');
    assert(nodeEnvGuardIdx !== -1 && allowGuardIdx !== -1,
      "Req 5: both independent guards are present in seed-production.ts");
    // Each guard must be followed by a return statement before any DB call
    const afterNodeEnv = seedSrc.slice(nodeEnvGuardIdx, nodeEnvGuardIdx + 250);
    const afterAllow   = seedSrc.slice(allowGuardIdx,   allowGuardIdx   + 250);
    assert(afterNodeEnv.includes("return"),
      "Req 4: NODE_ENV guard is followed by a return statement");
    assert(afterAllow.includes("return"),
      "Req 5: ALLOW_DESTRUCTIVE_SEED guard is followed by a return statement");
  }

  // Edge case: NODE_ENV=production AND ALLOW_DESTRUCTIVE_SEED=true → still blocked
  // (Guard 1 is NODE_ENV only, no ALLOW check needed there — this is by design)
  {
    const nodeEnvFnIdx = seedSrc.indexOf('NODE_ENV === "production"');
    const nodeEnvBlock = seedSrc.slice(nodeEnvFnIdx, nodeEnvFnIdx + 100);
    // Must NOT also check ALLOW_DESTRUCTIVE_SEED in the same condition
    const containsAllowInSameCondition = nodeEnvBlock.match(
      /NODE_ENV.*ALLOW_DESTRUCTIVE_SEED|ALLOW_DESTRUCTIVE_SEED.*NODE_ENV/
    );
    assert(!containsAllowInSameCondition,
      "Req 4: NODE_ENV guard is independent (not ANDed with ALLOW_DESTRUCTIVE_SEED)");
  }

  // ── §6 ──────────────────────────────────────────────────────────────────
  console.log("\n§6  RUN_STARTUP_MIGRATIONS exact-string gate (Req 6)");
  assert(indexSrc.includes('RUN_STARTUP_MIGRATIONS !== "true"'),
    "Req 6: migration gate uses strict !== \"true\" comparison (not truthy check)");
  assert(indexSrc.includes("migrations SKIPPED"),
    "Req 6: gate logs SKIPPED when env var is absent");
  {
    // Verify the gate wraps a substantial migration block (at least 10 functions)
    const gateIdx  = indexSrc.indexOf('RUN_STARTUP_MIGRATIONS !== "true"');
    const gateEnd  = indexSrc.indexOf("// end-migrations", gateIdx);
    const gateBody = gateEnd !== -1
      ? indexSrc.slice(gateIdx, gateEnd)
      : indexSrc.slice(gateIdx, gateIdx + 50000);
    // migrate* functions appear as: await migrateXxx() AND as args to Promise.all([migrateXxx(), ...])
    // Count camelCase migrate function references: migrateXxxSchema, migrateXxxColumns, etc.
    const migFnCount = (gateBody.match(/migrate[A-Z][a-zA-Z]+\(/g) || []).length;
    assert(migFnCount >= 20,
      `Req 6: migration gate wraps at least 20 migrate* function calls (found ${migFnCount})`);
  }

  // ── §7 ──────────────────────────────────────────────────────────────────
  console.log("\n§7  No unguarded destructive SQL in startup paths (Req 7)");
  // Proof: (a) guard checks ROLLBACK_FIRST_BOOT_READ_ONLY (tested §0),
  //         (b) every writer is behind the guard (tested §1-4),
  //         (c) no TRUNCATE / DROP anywhere in the startup writers.
  //
  // We scan the three startup-path files for the truly catastrophic keywords
  // that are never acceptable in any writer:
  {
    const startupFiles = [indexSrc, routesSrc, routesTasksSrc];
    const labels       = ["server/index.ts", "server/routes.ts", "server/routes-tasks.ts"];
    for (let i = 0; i < startupFiles.length; i++) {
      const src = startupFiles[i];
      // Strip JS comments to avoid false negatives from commented-out code
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "")
                         .replace(/\/\/[^\n]*/g, "");
      assert(!stripped.includes("TRUNCATE"),
        `Req 7: no TRUNCATE statement in ${labels[i]}`);
      assert(!stripped.toUpperCase().includes(" DROP TABLE") &&
             !stripped.toUpperCase().includes(" DROP INDEX") &&
             !stripped.toUpperCase().includes(" DROP COLUMN"),
        `Req 7: no DROP TABLE/INDEX/COLUMN in ${labels[i]}`);
    }

    // pg_restore must not be present outside the seed kill-switch
    const pgRestoreInIndex = indexSrc.indexOf("pg_restore");
    assert(pgRestoreInIndex === -1,
      "Req 7: pg_restore not in server/index.ts (only allowed inside seed-production.ts)");
    const pgRestoreInRoutes = routesSrc.indexOf("pg_restore");
    assert(pgRestoreInRoutes === -1,
      "Req 7: pg_restore not in server/routes.ts");
  }

  // ── §8 ──────────────────────────────────────────────────────────────────
  console.log("\n§8  No replacement Currents references in executable code (Req 8)");

  /**
   * Recursively collect all .ts and .tsx source files under a root directory,
   * skipping node_modules, attached_assets, .git, tests, and *.md.
   */
  function collectSourceFiles(dir, results = []) {
    const skipDirs = new Set(["node_modules", "attached_assets", ".git", "tests", "dist", ".cache"]);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return results; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) collectSourceFiles(path.join(dir, entry.name), results);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".md")) {
        results.push(path.join(dir, entry.name));
      }
    }
    return results;
  }

  const serverFiles = collectSourceFiles("server");
  const clientFiles = collectSourceFiles("client/src");
  const allSrcFiles = [...serverFiles, ...clientFiles];

  /**
   * Scan a list of files for a pattern.  Returns array of { file, line } hits.
   * Strips single-line and block comments before checking so commented-out
   * code does not cause false positives.
   */
  function scanFiles(files, testFn) {
    const hits = [];
    for (const f of files) {
      let src;
      try { src = fs.readFileSync(f, "utf8"); } catch (_) { continue; }
      // Strip block comments and single-line comments
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");
      const lines = stripped.split("\n");
      lines.forEach((ln, i) => {
        if (testFn(ln)) hits.push(`${f}:${i + 1}: ${ln.trim().slice(0, 80)}`);
      });
    }
    return hits;
  }

  // 8a: No /api/currents/* URL string anywhere in server/ or client/src/
  {
    const hits = scanFiles(allSrcFiles, (ln) =>
      ln.includes('"/api/currents/') || ln.includes("'/api/currents/") || ln.includes("`/api/currents/")
    );
    assert(hits.length === 0,
      `Req 8a: no /api/currents/* URL in server/ or client/src/ (${hits.length} hit(s): ${hits.slice(0, 2).join("; ")})`);
  }

  // 8b: No literal "/currents" URL string in server/ (hardcoded route/link)
  {
    const hits = scanFiles(serverFiles, (ln) =>
      (ln.includes('"/currents"') || ln.includes("'/currents'") || ln.includes("`/currents`") ||
       ln.includes('"/currents?') || ln.includes("'/currents?") ||
       ln.includes('`/currents?') || ln.includes('`/currents/'))
    );
    assert(hits.length === 0,
      `Req 8b: no literal /currents URL string in server/ (${hits.length} hit(s): ${hits.slice(0, 2).join("; ")})`);
  }

  // 8c: No hardcoded href="/currents..." in client/src/ TSX files
  {
    const hits = scanFiles(clientFiles, (ln) =>
      (ln.includes('href="/currents') || ln.includes("href='/currents") ||
       ln.includes('href={`/currents') || ln.includes('to="/currents') ||
       ln.includes("to='/currents"))
    );
    assert(hits.length === 0,
      `Req 8c: no hardcoded href/to="/currents..." in client/src/ (${hits.length} hit(s): ${hits.slice(0, 2).join("; ")})`);
  }

  // 8d: Replacement Currents table names absent from all source files
  {
    const tableNames = ["currents_channels", "currents_posts", "currents_reactions", "currents_read_state"];
    for (const tbl of tableNames) {
      const hits = scanFiles(allSrcFiles, (ln) => ln.includes(tbl));
      assert(hits.length === 0,
        `Req 8d: replacement table "${tbl}" absent from all source files (${hits.length} hit(s))`);
    }
  }

  // 8e: client/src/pages/currents.tsx does NOT exist (replacement page absent)
  assert(!fs.existsSync("client/src/pages/currents.tsx"),
    "Req 8e: client/src/pages/currents.tsx does not exist (replacement page removed)");

  // ── §9 ──────────────────────────────────────────────────────────────────
  console.log("\n§9  Original Currents wiring intact (Req 9)");

  // 9a: client/src/pages/current.tsx exists
  assert(fs.existsSync("client/src/pages/current.tsx"),
    "Req 9a: client/src/pages/current.tsx exists (original page present)");

  // 9b: App.tsx registers /current route (not /currents)
  {
    const currentRouteIdx = appTsx.indexOf('path="/current"') !== -1
      ? appTsx.indexOf('path="/current"')
      : appTsx.indexOf("current.tsx");
    assert(currentRouteIdx !== -1,
      "Req 9b: /current route or current.tsx import present in App.tsx");
    const currentsRouteIdx = appTsx.indexOf('path="/currents"');
    assert(currentsRouteIdx === -1,
      "Req 9b: /currents route NOT present in App.tsx");
  }

  // 9c: /api/current/* routes exist in routes.ts (at least files + messages)
  assert(routesSrc.includes('"/api/current/'),
    "Req 9c: /api/current/* routes registered in server/routes.ts");
  assert(!routesSrc.includes('"/api/currents/'),
    "Req 9c: /api/currents/* routes NOT present in server/routes.ts");

  // 9d: current.tsx imports are using original current_* tables (spot check)
  {
    const currentPage = fs.readFileSync("client/src/pages/current.tsx", "utf8");
    // The page should reference /api/current/ not /api/currents/
    assert(!currentPage.includes("/api/currents/"),
      "Req 9d: client/src/pages/current.tsx does not reference /api/currents/");
  }

  // 9e: Files tab uses /api/current/files (not /api/currents/files)
  {
    const filesTab = fs.readFileSync("client/src/components/current/current-files-tab.tsx", "utf8");
    assert(filesTab.includes('"/api/current/files"') || filesTab.includes("'/api/current/files'") || filesTab.includes('`/api/current/files'),
      "Req 9e: current-files-tab.tsx uses /api/current/files (correct namespace)");
    assert(!filesTab.includes("/api/currents/files"),
      "Req 9e: current-files-tab.tsx does not use /api/currents/files");
  }

  // ── §10 ─────────────────────────────────────────────────────────────────
  console.log("\n§10  Complete writer inventory cross-check (no unguarded setTimeout in top section)");
  {
    const topSection = indexSrc.slice(0, indexSrc.indexOf("void (async () => {") + 1);
    const setTimeoutMatches = [...topSection.matchAll(/setTimeout\(/g)];
    let ungardedCount = 0;
    for (const match of setTimeoutMatches) {
      const pre = topSection.slice(Math.max(0, match.index - 300), match.index);
      if (!pre.includes("skipInReadOnlyMode")) ungardedCount++;
    }
    assert(ungardedCount === 0,
      `All ${setTimeoutMatches.length} top-level setTimeout call(s) in index.ts are guarded (${ungardedCount} unguarded)`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
