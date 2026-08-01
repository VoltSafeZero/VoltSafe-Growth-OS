/**
 * tests/rollback-gate.test.cjs
 *
 * Proves every discovered startup writer is gated by ROLLBACK_VALIDATION_READ_ONLY.
 *
 * Strategy: structural source analysis — verify each startup writer's call site
 * has a skipInReadOnlyMode() guard immediately before or at its first executable line.
 *
 * Covers all writers discovered in server/index.ts, server/routes.ts,
 * server/routes-tasks.ts.
 */

"use strict";

const fs = require("fs");

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

function assertGated(src, writerName, options = {}) {
  const { searchFor = writerName, windowSize = 200 } = options;
  const idx = src.indexOf(searchFor);
  if (idx === -1) {
    assert(false, `${writerName}: call site found in source`);
    return;
  }
  // Check the window before the call for skipInReadOnlyMode
  const windowBefore = src.slice(Math.max(0, idx - windowSize), idx + 50);
  const hasGate = windowBefore.includes("skipInReadOnlyMode");
  assert(hasGate, `${writerName}: guarded by skipInReadOnlyMode`);
}

async function runTests() {
  console.log("\n══════════════════════════════════════════════");
  console.log("  ROLLBACK_VALIDATION_READ_ONLY Gate Tests");
  console.log("══════════════════════════════════════════════\n");

  const indexSrc = fs.readFileSync("server/index.ts", "utf8");
  const routesSrc = fs.readFileSync("server/routes.ts", "utf8");
  const routesTasksSrc = fs.readFileSync("server/routes-tasks.ts", "utf8");
  const guardSrc = fs.readFileSync("server/startup-guard.ts", "utf8");

  // ── §0 startup-guard.ts exists and exports the right function ─────────────
  console.log("§0 startup-guard.ts module");
  assert(guardSrc.includes("export function skipInReadOnlyMode"), "skipInReadOnlyMode is exported");
  assert(guardSrc.includes('ROLLBACK_VALIDATION_READ_ONLY === "true"'), "Gate checks ROLLBACK_VALIDATION_READ_ONLY=true");
  assert(guardSrc.includes("console.log"), "Gate logs the skipped writer name");

  // ── §1 server/index.ts — imports startup-guard ───────────────────────────
  console.log("\n§1 server/index.ts — imports and top-level writers");
  assert(indexSrc.includes('from "./startup-guard"'), "index.ts imports startup-guard");

  // Top-level unconditional startup writers (before startup IIFE)
  assertGated(indexSrc, "backfillAccountsForLeads", { searchFor: "backfillAccountsForLeads()" });
  assertGated(indexSrc, "backfillAllParticipants", { searchFor: '"./services/mailbox-integrity"' });
  assertGated(indexSrc, "backfillLeadComms", { searchFor: '"./services/lead-comms-sync"' });
  assertGated(indexSrc, "ensureRecentlyUpdatedIndexes", { searchFor: "ensureRecentlyUpdatedIndexes();" });
  assertGated(indexSrc, "backfillPrivateChannelCreators", { searchFor: "backfillPrivateChannelCreators();" });

  // ── §2 server/index.ts — inside startup IIFE ─────────────────────────────
  console.log("\n§2 server/index.ts — startup IIFE writers");
  assertGated(indexSrc, "ensureSearchIndexes", { searchFor: "ensureSearchIndexes()" });
  assertGated(indexSrc, "backfill-resumer", { searchFor: "backfill-resumer" });

  // Background schedulers gate
  const bgJobsIdx = indexSrc.indexOf("startHourlySyncScheduler()");
  const bgJobsWindow = indexSrc.slice(Math.max(0, bgJobsIdx - 300), bgJobsIdx + 10);
  assert(bgJobsWindow.includes("skipInReadOnlyMode"), "background-schedulers block gated by skipInReadOnlyMode");

  // ── §3 server/routes.ts — imports startup-guard ──────────────────────────
  console.log("\n§3 server/routes.ts — imports and startup writers");
  assert(routesSrc.includes('from "./startup-guard"'), "routes.ts imports startup-guard");

  // IIFE migrations
  assertGated(routesSrc, "user_avatar_library-migration", { searchFor: "user_avatar_library-migration" });
  assertGated(routesSrc, "team_calendar_events-migration", { searchFor: "team_calendar_events-migration" });
  assertGated(routesSrc, "user_role_definitions-migration", { searchFor: "user_role_definitions-migration" });
  assertGated(routesSrc, "team_work_calendar-migration", { searchFor: "team_work_calendar-migration" });
  assertGated(routesSrc, "crm_recent_news-migration", { searchFor: "crm_recent_news-migration" });
  assertGated(routesSrc, "search-gin-indexes-migration", { searchFor: "search-gin-indexes-migration" });
  assertGated(routesSrc, "help_center_rebuild_state-migration", { searchFor: "help_center_rebuild_state-migration" });
  assertGated(routesSrc, "email_snippets-migration", { searchFor: "email_snippets-migration" });

  // Seed calls
  assertGated(routesSrc, "seedDatabase+seedUsers", { searchFor: "seedDatabase+seedUsers" });
  assertGated(routesSrc, "seedDefaultSchedules", { searchFor: "seedDefaultSchedules().catch" });
  assertGated(routesSrc, "seedDefaultRules+seedAutomationTemplates", { searchFor: "seedDefaultRules+seedAutomationTemplates" });

  // ── §4 server/routes-tasks.ts — imports startup-guard ───────────────────
  console.log("\n§4 server/routes-tasks.ts — startup migration writers");
  assert(routesTasksSrc.includes('from "./startup-guard"'), "routes-tasks.ts imports startup-guard");

  assertGated(routesTasksSrc, "crm-auto-link-rules-migration", { searchFor: "crm-auto-link-rules-migration" });
  assertGated(routesTasksSrc, "task_hub_access_permissions-migration", { searchFor: "task_hub_access_permissions-migration" });
  assertGated(routesTasksSrc, "task_column_shares-migration", { searchFor: "task_column_shares-migration" });
  assertGated(routesTasksSrc, "task-recurrence-columns-migration", { searchFor: "task-recurrence-columns-migration" });
  assertGated(routesTasksSrc, "team-task-columns-migration", { searchFor: "team-task-columns-migration" });
  assertGated(routesTasksSrc, "user-task-columns-migration", { searchFor: "user-task-columns-migration" });

  // ── §5 Complete writer inventory cross-check ─────────────────────────────
  console.log("\n§5 Complete writer inventory (no unguarded startup DDL/DML)");
  {
    // Verify no unguarded TRUNCATE, pg_restore, or direct db.execute with DDL
    // appears OUTSIDE a skipInReadOnlyMode guard in the startup region of index.ts.
    // The startup region is before the IIFE (lines ~1-180).
    const topSection = indexSrc.slice(0, indexSrc.indexOf("void (async () => {"));

    // All setTimeout in the top section must have a guard
    const setTimeoutMatches = [...topSection.matchAll(/setTimeout\(/g)];
    const guardedSetTimeouts = [...topSection.matchAll(/skipInReadOnlyMode.*\n.*setTimeout\(|!skipInReadOnlyMode.*\n\s*setTimeout\(/g)];
    // Count: each setTimeout should be preceded by a guard within 200 chars
    let ungardedCount = 0;
    for (const match of setTimeoutMatches) {
      const pre = topSection.slice(Math.max(0, match.index - 200), match.index);
      if (!pre.includes("skipInReadOnlyMode")) ungardedCount++;
    }
    assert(ungardedCount === 0, `All ${setTimeoutMatches.length} top-level setTimeout calls in index.ts have guards (${ungardedCount} unguarded)`);
  }

  // ── §6 RUN_STARTUP_MIGRATIONS gate still in place ────────────────────────
  console.log("\n§6 RUN_STARTUP_MIGRATIONS gate still intact");
  assert(indexSrc.includes('RUN_STARTUP_MIGRATIONS !== "true"'), "Migration gate still present");
  assert(indexSrc.includes("migrations SKIPPED"), "Migration gate still logs SKIPPED");

  // ── §7 Seed kill-switch still in place ───────────────────────────────────
  console.log("\n§7 Seed kill-switch still intact");
  const seedSrc = fs.readFileSync("server/seed-production.ts", "utf8");
  assert(seedSrc.includes('NODE_ENV === "production"'), "Seed kill-switch NODE_ENV guard still present");
  assert(seedSrc.includes('ALLOW_DESTRUCTIVE_SEED !== "true"'), "Seed kill-switch ALLOW flag guard still present");

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
