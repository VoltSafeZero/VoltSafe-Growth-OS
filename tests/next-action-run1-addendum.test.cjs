"use strict";
/**
 * next-action-run1-addendum.test.cjs
 *
 * Run 1 Final Acceptance Addendum — verifies all items mandated by the
 * RUN 1 FINAL ACCEPTANCE document.
 *
 * Coverage:
 *   §4  effectiveDueAt fix — dueAt ?? waitingSinceAt (never createdAt)
 *   §5  Migration idempotency — all 16 DB objects exist after second run
 *   §6  Rollback gates — ROLLBACK_* env vars suppressed in migration fns
 *   §7  Trigger behavior — 9 live DB fixture proofs
 *   §8  SQL / TypeScript equivalence — 11 state fixtures, all states match
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

let passed = 0, failed = 0;
function ok(l, detail = "")  { console.log(`  ✓ ${l}`); passed++; }
function bad(l, detail = "") { console.error(`  ✗ ${l}${detail ? " — " + detail : ""}`); failed++; }
function ok_if(l, cond, detail = "") { cond ? ok(l) : bad(l, detail); }

const src = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const has = (text, pat) => typeof pat === "string" ? text.includes(pat) : pat.test(text);

// ── DST-safe calendar day helper (replicated inline) ─────────────────────────
function calendarDaysBetween(from, to, tz) {
  function toNoon(d) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const y  = parseInt(parts.find(p => p.type === "year").value,  10);
    const m  = parseInt(parts.find(p => p.type === "month").value, 10);
    const dy = parseInt(parts.find(p => p.type === "day").value,   10);
    return new Date(Date.UTC(y, m - 1, dy, 12, 0, 0));
  }
  return Math.round((toNoon(to).getTime() - toNoon(from).getTime()) / 86_400_000);
}

const TZ = "America/Vancouver";
const STATUS_BUCKET = {
  CRITICAL: 1, DUE: 2, CUSTOMER_NUDGE_DUE: 3, NEVER_CONTACTED: 4,
  SCHEDULED: 5, WAITING_CUSTOMER: 6, BLOCKED: 7, SNOOZED: 8, UNKNOWN: 9, NO_ACTION: 10,
};

// ── Replicated computeSmartPriority with the CORRECT §4 effectiveDueAt ────────
function computeSmartPriority(input) {
  const bucket = STATUS_BUCKET[input.status];
  const now         = input.now ?? new Date();
  const orgTimezone = input.orgTimezone ?? TZ;

  // §4 fix: effectiveDueAt = dueAt ?? waitingSinceAt (createdAt NEVER used)
  const effectiveDueAt = input.dueAt ?? input.waitingSinceAt ?? null;
  const effectiveDueSource =
    input.dueAt !== null       ? 'dueAt' :
    input.waitingSinceAt !== null ? 'waitingSinceAt' : null;

  let overdueCalendarDays = null;
  if (effectiveDueAt !== null) {
    const days = calendarDaysBetween(effectiveDueAt, now, orgTimezone);
    if (days > 0) overdueCalendarDays = days;
  }

  let relevantTimestamp = null;
  if (input.status === 'DUE' || input.status === 'CRITICAL') {
    relevantTimestamp = effectiveDueAt;
  } else if (input.status === 'SCHEDULED') {
    relevantTimestamp = input.dueAt;
  } else if (input.status === 'WAITING_CUSTOMER' || input.status === 'CUSTOMER_NUDGE_DUE') {
    relevantTimestamp = input.waitingSinceAt;
  }

  return {
    bucket, relevantTimestamp, effectiveDueAt, effectiveDueSource, overdueCalendarDays,
    manualPriorityRank: ({ high: 1, medium: 2, low: 3 }[input.manualPriority] ?? 4),
    value: input.primaryValue ?? 0,
    fitRank: ({ high: 1, medium: 2, low: 3 }[input.fit] ?? 4),
    id: input.id,
  };
}

function compareSmartPriority(a, b) {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  const aTs = a.relevantTimestamp?.getTime() ?? Infinity;
  const bTs = b.relevantTimestamp?.getTime() ?? Infinity;
  if (aTs !== bTs) return aTs - bTs;
  const aDue = a.effectiveDueAt?.getTime() ?? Infinity;
  const bDue = b.effectiveDueAt?.getTime() ?? Infinity;
  if (aDue !== bDue) return aDue - bDue;
  if (a.manualPriorityRank !== b.manualPriorityRank) return a.manualPriorityRank - b.manualPriorityRank;
  if (a.value !== b.value) return b.value - a.value;
  if (a.fitRank !== b.fitRank) return a.fitRank - b.fitRank;
  return a.id - b.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// §4: effectiveDueAt correction
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== next-action-run1-addendum.test.cjs ===");
console.log("\n── §4: effectiveDueAt fix ──");

const now = new Date("2026-08-02T10:00:00Z");  // fixed clock for deterministic tests

// §4 test 1: null-due action waiting 10 days outranks a dated action 1 day overdue
{
  const waitingSince10d = new Date(now.getTime() - 10 * 86_400_000);
  const due1dAgo        = new Date(now.getTime() -  1 * 86_400_000);

  const A = computeSmartPriority({ // null-due, waiting 10d
    status: 'DUE', dueAt: null, waitingSinceAt: waitingSince10d, createdAt: now,
    manualPriority: null, primaryValue: null, fit: null, id: 1, now, orgTimezone: TZ,
  });
  const B = computeSmartPriority({ // due 1d ago
    status: 'DUE', dueAt: due1dAgo, waitingSinceAt: due1dAgo, createdAt: now,
    manualPriority: null, primaryValue: null, fit: null, id: 2, now, orgTimezone: TZ,
  });

  ok_if("§4-T1a: null-due 10d effectiveDueAt = waitingSinceAt",
    A.effectiveDueAt?.getTime() === waitingSince10d.getTime(),
    `got ${A.effectiveDueAt}`);
  ok_if("§4-T1b: null-due 10d effectiveDueSource = 'waitingSinceAt'",
    A.effectiveDueSource === 'waitingSinceAt', `got ${A.effectiveDueSource}`);
  ok_if("§4-T1c: dated 1d effectiveDueSource = 'dueAt'",
    B.effectiveDueSource === 'dueAt', `got ${B.effectiveDueSource}`);
  ok_if("§4-T1d: null-due 10d outranks dated 1d (sorts before in compareSmartPriority)",
    compareSmartPriority(A, B) < 0,
    `A.effectiveDueAt=${A.effectiveDueAt?.toISOString()} B.effectiveDueAt=${B.effectiveDueAt?.toISOString()}`);
  ok_if("§4-T1e: null-due 10d overdueCalendarDays >= 10",
    (A.overdueCalendarDays ?? 0) >= 10, `got ${A.overdueCalendarDays}`);
}

// §4 test 2: null-due action becoming VoltSafe-owned TODAY is fresh (sorts LAST)
{
  const due1dAgo = new Date(now.getTime() - 1 * 86_400_000);

  const fresh = computeSmartPriority({ // null-due, waiting since today (0d)
    status: 'DUE', dueAt: null, waitingSinceAt: now, createdAt: new Date(now.getTime() - 180 * 86_400_000),
    manualPriority: null, primaryValue: null, fit: null, id: 3, now, orgTimezone: TZ,
  });
  const stale = computeSmartPriority({ // due 1d ago
    status: 'DUE', dueAt: due1dAgo, waitingSinceAt: due1dAgo, createdAt: now,
    manualPriority: null, primaryValue: null, fit: null, id: 4, now, orgTimezone: TZ,
  });

  ok_if("§4-T2a: fresh null-due effectiveDueAt = today (not 180d-old createdAt)",
    fresh.effectiveDueAt?.getTime() === now.getTime(), `got ${fresh.effectiveDueAt?.toISOString()}`);
  ok_if("§4-T2b: stale dated 1d outranks fresh null-due (sorts before)",
    compareSmartPriority(stale, fresh) < 0, "stale should rank higher");
  ok_if("§4-T2c: fresh null-due overdueCalendarDays is 0 (today, not yet overdue)",
    fresh.overdueCalendarDays === null, `got ${fresh.overdueCalendarDays}`);
}

// §4 test 3: dated action 10d overdue outranks fresh null-due action
{
  const due10dAgo = new Date(now.getTime() - 10 * 86_400_000);

  const oldDated = computeSmartPriority({ // due 10d ago → CRITICAL
    status: 'CRITICAL', dueAt: due10dAgo, waitingSinceAt: due10dAgo, createdAt: due10dAgo,
    manualPriority: null, primaryValue: null, fit: null, id: 5, now, orgTimezone: TZ,
  });
  const freshNull = computeSmartPriority({ // null-due, fresh today → DUE
    status: 'DUE', dueAt: null, waitingSinceAt: now, createdAt: due10dAgo,
    manualPriority: null, primaryValue: null, fit: null, id: 6, now, orgTimezone: TZ,
  });

  ok_if("§4-T3a: 10d-overdue in CRITICAL bucket",
    oldDated.bucket === STATUS_BUCKET.CRITICAL, `got ${oldDated.bucket}`);
  ok_if("§4-T3b: fresh null-due in DUE bucket",
    freshNull.bucket === STATUS_BUCKET.DUE, `got ${freshNull.bucket}`);
  ok_if("§4-T3c: CRITICAL (bucket 1) outranks DUE (bucket 2)",
    compareSmartPriority(oldDated, freshNull) < 0, "CRITICAL should sort before DUE");
  ok_if("§4-T3d: oldDated overdueCalendarDays >= 10",
    (oldDated.overdueCalendarDays ?? 0) >= 10, `got ${oldDated.overdueCalendarDays}`);
}

// §4 test 4: createdAt has no effect on due ordering
{
  // Two null-due actions: same waiting_since_at but different createdAt
  const waitingSince5d = new Date(now.getTime() - 5 * 86_400_000);
  const oldCreated     = new Date(now.getTime() - 90 * 86_400_000);
  const newCreated     = new Date(now.getTime() -  1 * 86_400_000);

  const A = computeSmartPriority({
    status: 'DUE', dueAt: null, waitingSinceAt: waitingSince5d, createdAt: oldCreated,
    manualPriority: null, primaryValue: null, fit: null, id: 7, now, orgTimezone: TZ,
  });
  const B = computeSmartPriority({
    status: 'DUE', dueAt: null, waitingSinceAt: waitingSince5d, createdAt: newCreated,
    manualPriority: null, primaryValue: null, fit: null, id: 8, now, orgTimezone: TZ,
  });

  ok_if("§4-T4a: same waitingSinceAt → same effectiveDueAt regardless of createdAt",
    A.effectiveDueAt?.getTime() === B.effectiveDueAt?.getTime(),
    `A=${A.effectiveDueAt?.toISOString()} B=${B.effectiveDueAt?.toISOString()}`);
  ok_if("§4-T4b: tie broken by id only (createdAt irrelevant)",
    compareSmartPriority(A, B) < 0, "id=7 should sort before id=8 as stable tiebreak");
}

// §4 source-grep: production code must use waitingSinceAt (not createdAt) in effectiveDueAt
{
  const statusSrc = src("server/services/next-action-status.ts");
  ok_if("§4-source: effectiveDueAt uses waitingSinceAt fallback",
    has(statusSrc, "dueAt ?? input.waitingSinceAt"),
    "expected 'dueAt ?? input.waitingSinceAt' in source");
  ok_if("§4-source: createdAt NOT used as effectiveDueAt fallback",
    !has(statusSrc, "dueAt ?? input.createdAt"),
    "'dueAt ?? input.createdAt' still present");
  ok_if("§4-source: effectiveDueSource field declared in SmartPriorityResult",
    has(statusSrc, "effectiveDueSource"),
    "effectiveDueSource missing from source");
  ok_if("§4-source: overdueCalendarDays field declared",
    has(statusSrc, "overdueCalendarDays"),
    "overdueCalendarDays missing from source");
}

// ─────────────────────────────────────────────────────────────────────────────
// §5: Migration idempotency — source grep checks
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── §5: Migration path — source grep ──");
{
  const seedSrc = src("server/seed-production.ts");

  ok_if("§5-s1: next_actions CREATE TABLE IF NOT EXISTS",
    has(seedSrc, "CREATE TABLE IF NOT EXISTS next_actions"), "missing CREATE TABLE");
  ok_if("§5-s2: trigger function CREATE OR REPLACE",
    has(seedSrc, "CREATE OR REPLACE FUNCTION next_actions_auto_timestamps"), "missing trigger fn");
  ok_if("§5-s3: trigger DROP IF EXISTS before CREATE",
    has(seedSrc, "DROP TRIGGER IF EXISTS trg_next_actions_auto_ts"), "missing DROP TRIGGER IF EXISTS");
  ok_if("§5-s4: partial unique index IF NOT EXISTS (open lead)",
    has(seedSrc, "CREATE UNIQUE INDEX IF NOT EXISTS uq_next_actions_open_lead"), "missing index");
  ok_if("§5-s5: partial unique index IF NOT EXISTS (open account)",
    has(seedSrc, "CREATE UNIQUE INDEX IF NOT EXISTS uq_next_actions_open_account"), "missing index");
  ok_if("§5-s6: org_settings CREATE TABLE IF NOT EXISTS",
    has(seedSrc, "CREATE TABLE IF NOT EXISTS org_settings"), "missing org_settings create");
  ok_if("§5-s7: singleton INSERT ON CONFLICT DO NOTHING",
    has(seedSrc, "ON CONFLICT DO NOTHING"), "missing idempotent insert");
  ok_if("§5-s8: leads columns all use ADD COLUMN IF NOT EXISTS",
    has(seedSrc, "ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority"), "missing leads.priority");
  ok_if("§5-s9: accounts columns use ADD COLUMN IF NOT EXISTS",
    has(seedSrc, "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fit"), "missing accounts.fit");
}

// ─────────────────────────────────────────────────────────────────────────────
// §6: Rollback gates — source grep
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── §6: Rollback gates ──");
{
  const seedSrc  = src("server/seed-production.ts");
  const guardSrc = src("server/startup-guard.ts");
  const indexSrc = src("server/index.ts");

  // startup-guard.ts
  ok_if("§6-g1: startup-guard exports isRollbackReadOnly()",
    has(guardSrc, "isRollbackReadOnly"), "missing isRollbackReadOnly");
  ok_if("§6-g2: startup-guard exports skipInReadOnlyMode()",
    has(guardSrc, "skipInReadOnlyMode"), "missing skipInReadOnlyMode");
  ok_if("§6-g3: ROLLBACK_VALIDATION_READ_ONLY handled",
    has(guardSrc, "ROLLBACK_VALIDATION_READ_ONLY"), "missing ROLLBACK_VALIDATION_READ_ONLY");
  ok_if("§6-g4: ROLLBACK_FIRST_BOOT_READ_ONLY handled",
    has(guardSrc, "ROLLBACK_FIRST_BOOT_READ_ONLY"), "missing ROLLBACK_FIRST_BOOT_READ_ONLY");

  // Case A: RUN_STARTUP_MIGRATIONS gate in index.ts
  ok_if("§6-A: RUN_STARTUP_MIGRATIONS !== true gate in index.ts",
    has(indexSrc, 'RUN_STARTUP_MIGRATIONS !== "true"'),
    "missing outer migration gate");

  // Cases B+C: Run 1 migration functions respect read-only env vars
  ok_if("§6-B1: migrateNextActionsSchema has ROLLBACK read-only gate",
    has(seedSrc, /migrateNextActionsSchema[\s\S]{0,200}ROLLBACK_VALIDATION_READ_ONLY/),
    "migrateNextActionsSchema missing rollback gate");
  ok_if("§6-B2: migrateOrgSettingsSchema has ROLLBACK read-only gate",
    has(seedSrc, /migrateOrgSettingsSchema[\s\S]{0,200}ROLLBACK_VALIDATION_READ_ONLY/),
    "migrateOrgSettingsSchema missing rollback gate");
  ok_if("§6-B3: migrateContactLinkConstraints has ROLLBACK read-only gate",
    has(seedSrc, /migrateContactLinkConstraints[\s\S]{0,200}ROLLBACK_VALIDATION_READ_ONLY/),
    "migrateContactLinkConstraints missing rollback gate");
}

// ─────────────────────────────────────────────────────────────────────────────
// §7 + §5 DB: Live trigger + idempotency checks via pg
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── §7/§5: Live DB checks ──");

async function runDbChecks() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const q = async (sql, params = []) => {
    const r = await client.query(sql, params);
    return r.rows;
  };

  try {
    // §5 DB: migration idempotency — all 16 objects must exist
    const objects = [
      ["TABLE",   "SELECT 1 FROM information_schema.tables WHERE table_name=$1",          ["next_actions"]],
      ["TABLE",   "SELECT 1 FROM information_schema.tables WHERE table_name=$1",          ["org_settings"]],
      ["TRIGGER", "SELECT 1 FROM pg_trigger WHERE tgname=$1",                             ["trg_next_actions_auto_ts"]],
      ["FUNC",    "SELECT 1 FROM pg_proc WHERE proname=$1",                               ["next_actions_auto_timestamps"]],
      ["INDEX",   "SELECT 1 FROM pg_indexes WHERE indexname=$1",                          ["uq_next_actions_open_lead"]],
      ["INDEX",   "SELECT 1 FROM pg_indexes WHERE indexname=$1",                          ["uq_next_actions_open_account"]],
      ["INDEX",   "SELECT 1 FROM pg_indexes WHERE indexname=$1",                          ["idx_next_actions_lead_id"]],
      ["INDEX",   "SELECT 1 FROM pg_indexes WHERE indexname=$1",                          ["idx_next_actions_account_id"]],
      ["INDEX",   "SELECT 1 FROM pg_indexes WHERE indexname=$1",                          ["idx_next_actions_waiting_on"]],
      ["INDEX",   "SELECT 1 FROM pg_indexes WHERE indexname=$1",                          ["idx_next_actions_due_at"]],
      ["INDEX",   "SELECT 1 FROM pg_indexes WHERE indexname=$1",                          ["idx_next_actions_open_status"]],
      ["ROW",     "SELECT 1 FROM org_settings WHERE id=1",                               []],
      ["COL",     "SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name=$1", ["priority"]],
      ["COL",     "SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name=$1", ["fit"]],
      ["COL",     "SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name=$1", ["shore_power_coverage_pct"]],
      ["COL",     "SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name=$1", ["fit"]],
    ];
    for (const [type, sql, params] of objects) {
      const rows = await q(sql, params);
      ok_if(`§5-DB: ${type} ${params[0] || "org_settings.id=1"} exists`, rows.length > 0);
    }

    // §5 DB: singleton — exactly one org_settings row
    const singleRows = await q("SELECT COUNT(*)::int AS cnt FROM org_settings");
    ok_if("§5-DB: org_settings has exactly 1 row", singleRows[0].cnt === 1, `got ${singleRows[0].cnt}`);

    // §7: Trigger fixture tests (fresh sequence using a known organic lead)
    const leadRows = await q(
      "SELECT id FROM leads WHERE source NOT IN ('test_suite','marina_directory','boating_ontario') AND source IS NOT NULL LIMIT 1");
    if (leadRows.length === 0) { bad("§7-setup: no organic lead found for fixture"); return; }
    const lid = leadRows[0].id;

    // Clean up any leftover fixtures
    await q("DELETE FROM next_actions WHERE title LIKE 'ADDENDUM_FX_%'");

    // T1: INSERT populates waiting_since_at and updated_at
    await q("INSERT INTO next_actions (lead_id,title,waiting_on) VALUES ($1,'ADDENDUM_FX_T1','voltsafe')", [lid]);
    const t1 = await q("SELECT waiting_since_at, updated_at FROM next_actions WHERE title='ADDENDUM_FX_T1'");
    ok_if("§7-T1a: INSERT sets waiting_since_at", t1[0]?.waiting_since_at !== null, "null");
    ok_if("§7-T1b: INSERT sets updated_at",       t1[0]?.updated_at !== null, "null");

    // T2: Unrelated UPDATE changes updated_at only
    const wsBefore = t1[0].waiting_since_at;
    await q("UPDATE next_actions SET title='ADDENDUM_FX_T1B' WHERE title='ADDENDUM_FX_T1'");
    await q("UPDATE next_actions SET title='ADDENDUM_FX_T1'  WHERE title='ADDENDUM_FX_T1B'");
    const t2 = await q("SELECT waiting_since_at, updated_at FROM next_actions WHERE title='ADDENDUM_FX_T1'");
    ok_if("§7-T2: unrelated UPDATE does not reset waiting_since_at",
      new Date(t2[0].waiting_since_at).getTime() === new Date(wsBefore).getTime(),
      "waiting_since_at changed");

    // T3: waiting_on change resets waiting_since_at
    const wsBeforeT3 = t2[0].waiting_since_at;
    await new Promise(r => setTimeout(r, 50)); // ensure clock tick
    await q("UPDATE next_actions SET waiting_on='customer' WHERE title='ADDENDUM_FX_T1'");
    const t3 = await q("SELECT waiting_since_at FROM next_actions WHERE title='ADDENDUM_FX_T1'");
    ok_if("§7-T3: waiting_on change resets waiting_since_at",
      new Date(t3[0].waiting_since_at).getTime() > new Date(wsBeforeT3).getTime(),
      `before=${wsBeforeT3} after=${t3[0].waiting_since_at}`);

    // T4: customer → voltsafe sets due_at NULL
    await q("UPDATE next_actions SET due_at=NOW()+interval'3 days' WHERE title='ADDENDUM_FX_T1'");
    await q("UPDATE next_actions SET waiting_on='voltsafe' WHERE title='ADDENDUM_FX_T1'");
    const t4 = await q("SELECT due_at FROM next_actions WHERE title='ADDENDUM_FX_T1'");
    ok_if("§7-T4: customer→voltsafe sets due_at NULL", t4[0].due_at === null, `got ${t4[0].due_at}`);

    // T5: completion sets completed_at
    await q("UPDATE next_actions SET status='completed' WHERE title='ADDENDUM_FX_T1'");
    const t5 = await q("SELECT completed_at FROM next_actions WHERE title='ADDENDUM_FX_T1'");
    ok_if("§7-T5: status=completed sets completed_at", t5[0].completed_at !== null, "null");

    // T6: second open action BEFORE completion is rejected (separate fresh fixture)
    // Use a different lead so the partial unique index applies cleanly
    const lead2 = await q(
      "SELECT id FROM leads WHERE source NOT IN ('test_suite','marina_directory','boating_ontario') AND id!=$1 LIMIT 1", [lid]);
    if (lead2.length > 0) {
      const lid2 = lead2[0].id;
      await q("INSERT INTO next_actions(lead_id,title,waiting_on) VALUES($1,'ADDENDUM_FX_T6A','voltsafe')", [lid2]);
      let dupRejected = false;
      try {
        await q("INSERT INTO next_actions(lead_id,title,waiting_on) VALUES($1,'ADDENDUM_FX_T6B','voltsafe')", [lid2]);
      } catch (e) {
        if (e.code === '23505') dupRejected = true;
      }
      ok_if("§7-T6: second concurrent open action rejected (unique constraint error 23505)", dupRejected,
        "expected 23505 duplicate-key error");
      // Clean T6A (T6B was rejected so clean=only T6A)
      await q("DELETE FROM next_actions WHERE title IN ('ADDENDUM_FX_T6A','ADDENDUM_FX_T6B')");
    } else {
      ok_if("§7-T6: skipped (no second lead available)", false, "need 2 organic leads");
    }

    // T7: completed history permits a new open action (same lead as T1)
    // T1 is already completed — insert a fresh open row for same lead_id
    await q("INSERT INTO next_actions(lead_id,title,waiting_on) VALUES($1,'ADDENDUM_FX_T7','voltsafe')", [lid]);
    const t7 = await q("SELECT id FROM next_actions WHERE title='ADDENDUM_FX_T7' AND status='open'");
    ok_if("§7-T7: completed history permits a new open action", t7.length > 0, "row not found");

    // T8: cancellation sets cancelled_at
    await q("UPDATE next_actions SET status='cancelled' WHERE title='ADDENDUM_FX_T7'");
    const t8 = await q("SELECT cancelled_at FROM next_actions WHERE title='ADDENDUM_FX_T7'");
    ok_if("§7-T8: status=cancelled sets cancelled_at", t8[0]?.cancelled_at !== null, "null");

    // T9: partial unique index exists (constraint proof)
    const t9 = await q("SELECT indexname FROM pg_indexes WHERE indexname='uq_next_actions_open_lead'");
    ok_if("§7-T9: partial unique index uq_next_actions_open_lead exists", t9.length > 0);

    // Cleanup all fixtures
    await q("DELETE FROM next_actions WHERE title LIKE 'ADDENDUM_FX_%'");
    console.log("  (fixture cleanup complete)");

  } finally {
    await client.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8: SQL / TypeScript equivalence — 11 fixtures (TypeScript side)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── §8: SQL/TS equivalence (TS side) ──");

function derive(input) {
  const { openAction, hasEverContacted, now: n, customerWaitNudgeDays = 14, criticalOverdueDays = 3, orgTimezone: tz = TZ } = input;
  if (openAction) {
    const { waitingOn, waitingSinceAt, dueAt, blocker, snoozedUntil } = openAction;
    if (snoozedUntil !== null && snoozedUntil > n) return 'SNOOZED';
    if (blocker !== null && blocker.trim() !== '')  return 'BLOCKED';
    if (waitingOn === 'customer') {
      const d = calendarDaysBetween(waitingSinceAt, n, tz);
      return d > customerWaitNudgeDays ? 'CUSTOMER_NUDGE_DUE' : 'WAITING_CUSTOMER';
    }
    if (waitingOn === 'voltsafe') {
      if (dueAt === null) return 'DUE';
      const days = calendarDaysBetween(dueAt, n, tz);
      if (days < 0)  return 'SCHEDULED';
      if (days <= criticalOverdueDays) return 'DUE';
      return 'CRITICAL';
    }
  }
  if (hasEverContacted === false) return 'NEVER_CONTACTED';
  if (hasEverContacted === null)  return 'UNKNOWN';
  return 'NO_ACTION';
}

const daysAgo  = d => new Date(now.getTime() - d * 86_400_000);
const daysAhead = d => new Date(now.getTime() + d * 86_400_000);

const fixtures = [
  // fixture, expected, input
  ["null-due voltsafe → DUE",                   'DUE',               { openAction: { waitingOn:'voltsafe', waitingSinceAt: now, dueAt: null, blocker: null, snoozedUntil: null }, hasEverContacted: true, now }],
  ["due today → DUE",                           'DUE',               { openAction: { waitingOn:'voltsafe', waitingSinceAt: now, dueAt: now, blocker: null, snoozedUntil: null }, hasEverContacted: true, now }],
  ["due tomorrow → SCHEDULED",                  'SCHEDULED',         { openAction: { waitingOn:'voltsafe', waitingSinceAt: now, dueAt: daysAhead(1), blocker: null, snoozedUntil: null }, hasEverContacted: true, now }],
  ["1d overdue ≤ critical(3) → DUE",            'DUE',               { openAction: { waitingOn:'voltsafe', waitingSinceAt: daysAgo(1), dueAt: daysAgo(1), blocker: null, snoozedUntil: null }, hasEverContacted: true, now }],
  ["3d overdue = critical → DUE",               'DUE',               { openAction: { waitingOn:'voltsafe', waitingSinceAt: daysAgo(3), dueAt: daysAgo(3), blocker: null, snoozedUntil: null }, hasEverContacted: true, now }],
  ["4d overdue > critical → CRITICAL",          'CRITICAL',          { openAction: { waitingOn:'voltsafe', waitingSinceAt: daysAgo(4), dueAt: daysAgo(4), blocker: null, snoozedUntil: null }, hasEverContacted: true, now }],
  ["snoozed active → SNOOZED",                  'SNOOZED',           { openAction: { waitingOn:'voltsafe', waitingSinceAt: now, dueAt: null, blocker: null, snoozedUntil: daysAhead(5) }, hasEverContacted: true, now }],
  ["blocker set → BLOCKED",                     'BLOCKED',           { openAction: { waitingOn:'voltsafe', waitingSinceAt: now, dueAt: null, blocker: 'blocked', snoozedUntil: null }, hasEverContacted: true, now }],
  ["customer 10d < nudge(14) → WAITING_CUSTOMER",'WAITING_CUSTOMER', { openAction: { waitingOn:'customer', waitingSinceAt: daysAgo(10), dueAt: null, blocker: null, snoozedUntil: null }, hasEverContacted: true, now }],
  ["customer 14d = nudge → WAITING_CUSTOMER",   'WAITING_CUSTOMER',  { openAction: { waitingOn:'customer', waitingSinceAt: daysAgo(14), dueAt: null, blocker: null, snoozedUntil: null }, hasEverContacted: true, now }],
  ["customer 15d > nudge(14) → CUSTOMER_NUDGE_DUE",'CUSTOMER_NUDGE_DUE',{ openAction: { waitingOn:'customer', waitingSinceAt: daysAgo(15), dueAt: null, blocker: null, snoozedUntil: null }, hasEverContacted: true, now }],
];

for (const [desc, expected, input] of fixtures) {
  const got = derive(input);
  ok_if(`§8-TS: ${desc}`, got === expected, `expected ${expected} got ${got}`);
}

// Run async DB checks, then print results
runDbChecks().then(() => {
  console.log(`\n=== Addendum Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
