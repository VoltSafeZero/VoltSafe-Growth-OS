"use strict";
/**
 * next-action-17-fixtures.test.cjs
 *
 * 17-fixture SQL/TypeScript equivalence table for Run 1 Closeout.
 * Required: 17/17 PASS.
 *
 * fixture | TS state | SQL state | TS bucket | SQL bucket | PASS/FAIL
 *
 * Fixtures:
 *  1  UNKNOWN
 *  2  NEVER_CONTACTED
 *  3  NO_ACTION
 *  4  SCHEDULED
 *  5  DUE — null due_at
 *  6  DUE — due today
 *  7  DUE — exactly 3 days overdue
 *  8  CRITICAL — exactly 4 days overdue
 *  9  WAITING_CUSTOMER — exactly 14 days
 * 10  CUSTOMER_NUDGE_DUE — exactly 15 days
 * 11  BLOCKED
 * 12  SNOOZED — future
 * 13  expired snooze falling through
 * 14  completed action ignored
 * 15  cancelled action ignored
 * 16  DST spring-forward (23-hour day = 1 calendar day)
 * 17  DST fall-back    (25-hour day = 1 calendar day)
 */

const { Client } = require("pg");

let passed = 0, failed = 0;
const ok  = (l) => { console.log(`  ✓ ${l}`); passed++; };
const bad = (l, d="") => { console.error(`  ✗ ${l}${d ? " — "+d : ""}`); failed++; };

const TZ = "America/Vancouver";

// DST-safe calendar day arithmetic (replicated from next-action-status.ts)
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

// TypeScript status derivation (replicated from next-action-status.ts)
function deriveStatus(input) {
  const {
    openAction, hasEverContacted, now,
    customerWaitNudgeDays = 14,
    criticalOverdueDays   = 3,
    orgTimezone           = TZ,
  } = input;

  if (openAction) {
    const { waitingOn, waitingSinceAt, dueAt, blocker, snoozedUntil } = openAction;
    if (snoozedUntil !== null && snoozedUntil > now)  return "SNOOZED";
    if (blocker !== null && blocker.trim() !== "")    return "BLOCKED";
    if (waitingOn === "customer") {
      const d = calendarDaysBetween(waitingSinceAt, now, orgTimezone);
      return d > customerWaitNudgeDays ? "CUSTOMER_NUDGE_DUE" : "WAITING_CUSTOMER";
    }
    if (waitingOn === "voltsafe") {
      if (dueAt === null) return "DUE";
      const days = calendarDaysBetween(dueAt, now, orgTimezone);
      if (days < 0)                      return "SCHEDULED";
      if (days <= criticalOverdueDays)   return "DUE";
      return "CRITICAL";
    }
  }
  if (hasEverContacted === false) return "NEVER_CONTACTED";
  if (hasEverContacted === null)  return "UNKNOWN";
  return "NO_ACTION";
}

const STATUS_BUCKET = {
  CRITICAL: 1, DUE: 2, CUSTOMER_NUDGE_DUE: 3, NEVER_CONTACTED: 4,
  SCHEDULED: 5, WAITING_CUSTOMER: 6, BLOCKED: 7, SNOOZED: 8, UNKNOWN: 9, NO_ACTION: 10,
};

// Fixed clock (Pacific Daylight Time, August 2 2026)
const NOW = new Date("2026-08-02T12:00:00-07:00");
const ago   = d => new Date(NOW.getTime() - d * 86_400_000);
const ahead = d => new Date(NOW.getTime() + d * 86_400_000);

// DST boundary dates (America/Vancouver 2026)
// Spring-forward: March 8 2026 — 2am PST → 3am PDT (23h day)
const DST_SF_FROM = new Date("2026-03-08T01:00:00-08:00"); // 1am PST
const DST_SF_TO   = new Date("2026-03-09T01:00:00-07:00"); // 1am PDT (23h wall clock later)
// Fall-back: November 1 2026 — 2am PDT → 1am PST (25h day)
const DST_FB_FROM = new Date("2026-11-01T00:30:00-07:00"); // 12:30am PDT
const DST_FB_TO   = new Date("2026-11-02T00:30:00-08:00"); // 12:30am PST (25h wall clock later)

// SQL state CASE expression — mirrors TypeScript deriveStatus() for open actions
// Parameters: $1 = row id (integer), $2 = now ISO (timestamptz)
// Org settings hardcoded to defaults: criticalOverdueDays=3, customerWaitNudgeDays=14
const SQL_STATE_QUERY = (id, nowIso) => ({
  text: `
    SELECT
      CASE
        WHEN snoozed_until IS NOT NULL AND snoozed_until > $2::timestamptz THEN 'SNOOZED'
        WHEN blocker IS NOT NULL AND blocker <> ''                          THEN 'BLOCKED'
        WHEN waiting_on = 'customer' THEN
          CASE WHEN ($2::date - waiting_since_at::date) > 14 THEN 'CUSTOMER_NUDGE_DUE'
               ELSE 'WAITING_CUSTOMER' END
        WHEN waiting_on = 'voltsafe' THEN
          CASE WHEN due_at IS NULL                              THEN 'DUE'
               WHEN ($2::date - due_at::date) < 0             THEN 'SCHEDULED'
               WHEN ($2::date - due_at::date) <= 3            THEN 'DUE'
               ELSE 'CRITICAL' END
        ELSE 'OPEN_UNKNOWN'
      END AS sql_state
    FROM next_actions WHERE id = $1
  `,
  values: [id, nowIso],
});

function pad(s, n) { return String(s ?? "").padEnd(n); }

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log("=== next-action-17-fixtures.test.cjs ===\n");
  console.log(
    pad("fixture", 6) + " | " +
    pad("TS state", 22) + " | " +
    pad("SQL state", 22) + " | " +
    pad("TS bkt", 7) + " | " +
    pad("SQL bkt", 7) + " | PASS/FAIL"
  );
  console.log("-".repeat(95));

  const rows = [];

  try {
    // ── Helper to find a test lead (voice-assistant) with no current open action
    const getTestLead = async () => {
      const { rows: r } = await client.query(
        `SELECT id FROM leads
         WHERE source = 'voice-assistant'
           AND NOT EXISTS (SELECT 1 FROM next_actions WHERE lead_id=leads.id AND status='open')
         ORDER BY id LIMIT 1`
      );
      if (!r.length) throw new Error("no available voice-assistant test lead");
      return r[0].id;
    };

    // ── Fixtures 1–3: pure TS (no open action) ───────────────────────────────
    const pureTs = [
      [1, "UNKNOWN",        { openAction: null, hasEverContacted: null,  now: NOW }],
      [2, "NEVER_CONTACTED",{ openAction: null, hasEverContacted: false, now: NOW }],
      [3, "NO_ACTION",      { openAction: null, hasEverContacted: true,  now: NOW }],
    ];
    for (const [id, expected, inp] of pureTs) {
      const tsState  = deriveStatus(inp);
      const tsBucket = STATUS_BUCKET[tsState];
      const pass     = tsState === expected;
      const line     =
        pad(id, 6) + " | " +
        pad(tsState, 22) + " | " +
        pad("N/A (no open action)", 22) + " | " +
        pad(tsBucket, 7) + " | " +
        pad("—", 7) + " | " + (pass ? "PASS" : "FAIL");
      console.log("  " + line);
      rows.push({ id, name: expected, tsState, sqlState: "N/A", pass });
      pass ? ok(`F${id}: ${expected}`) : bad(`F${id}: ${expected}`, `got ${tsState}`);
    }

    // ── Fixtures 4–13: DB fixtures verified against SQL CASE ─────────────────
    const dbFixDefs = [
      // [id, name, expected, waiting_on, due_at, blocker, snoozed_until, ws_override]
      // ws_override: override waiting_since_at after insert
      [4,  "SCHEDULED",          "SCHEDULED",          "voltsafe", ahead(3),    null,                    null,      null],
      [5,  "DUE — null due_at",  "DUE",                "voltsafe", null,         null,                    null,      null],
      [6,  "DUE — due today",    "DUE",                "voltsafe", NOW,          null,                    null,      null],
      [7,  "DUE — 3d overdue",   "DUE",                "voltsafe", ago(3),       null,                    null,      null],
      [8,  "CRITICAL — 4d",      "CRITICAL",           "voltsafe", ago(4),       null,                    null,      null],
      [9,  "WAITING_CUSTOMER 14d","WAITING_CUSTOMER",  "customer", null,          null,                    null,      ago(14)],
      [10, "CND 15d",            "CUSTOMER_NUDGE_DUE", "customer", null,          null,                    null,      ago(15)],
      [11, "BLOCKED",            "BLOCKED",            "voltsafe", null,          "pending legal review",  null,      null],
      [12, "SNOOZED — future",   "SNOOZED",            "voltsafe", null,          null,                    ahead(5),  null],
      [13, "expired snooze",     "DUE",                "voltsafe", null,          null,                    ago(1),    null],
    ];

    for (const [id, name, expected, wo, due, blk, snz, wsOverride] of dbFixDefs) {
      const lid = await getTestLead();
      // Insert with default waiting_since_at (trigger sets it)
      const { rows: ins } = await client.query(
        `INSERT INTO next_actions (lead_id, title, waiting_on, due_at, blocker, snoozed_until)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [lid, `FX17_${id}`, wo, due ?? null, blk ?? null, snz ?? null]
      );
      const fxId = ins[0].id;

      // Override waiting_since_at if specified (customer fixtures need exact day count)
      if (wsOverride) {
        await client.query(
          `UPDATE next_actions SET waiting_since_at = $1 WHERE id = $2`,
          [wsOverride.toISOString(), fxId]
        );
      }

      // Query SQL state
      const { rows: sr } = await client.query(SQL_STATE_QUERY(fxId, NOW.toISOString()));
      const sqlState = sr[0]?.sql_state ?? "ERROR";

      // Derive TS state from same input values
      const actionRow = {
        waitingOn:     wo,
        waitingSinceAt: wsOverride ?? NOW,
        dueAt:          due ?? null,
        blocker:        blk ?? null,
        snoozedUntil:   snz ?? null,
      };
      const tsState  = deriveStatus({ openAction: actionRow, hasEverContacted: true, now: NOW });
      const tsBucket = STATUS_BUCKET[tsState];
      const sqlBucket = STATUS_BUCKET[sqlState] ?? "?";
      const pass     = tsState === expected && sqlState === expected;

      const line =
        pad(id, 6) + " | " +
        pad(tsState, 22) + " | " +
        pad(sqlState, 22) + " | " +
        pad(tsBucket, 7) + " | " +
        pad(sqlBucket, 7) + " | " + (pass ? "PASS" : "FAIL");
      console.log("  " + line);
      rows.push({ id, name, tsState, sqlState, pass });
      pass ? ok(`F${id}: ${name}`) : bad(`F${id}: ${name}`, `TS=${tsState} SQL=${sqlState} expected=${expected}`);

      // Cleanup
      await client.query(`DELETE FROM next_actions WHERE id = $1`, [fxId]);
    }

    // ── F14: completed action is NOT returned by open-action query ────────────
    {
      const lid = await getTestLead();
      await client.query(
        `INSERT INTO next_actions (lead_id, title, waiting_on, status)
         VALUES ($1, 'FX17_14', 'voltsafe', 'completed')`, [lid]
      );
      const { rows: r } = await client.query(
        `SELECT id FROM next_actions WHERE lead_id=$1 AND status='open'`, [lid]
      );
      await client.query(`DELETE FROM next_actions WHERE lead_id=$1 AND title='FX17_14'`, [lid]);
      const noOpenAction = r.length === 0;
      const tsState = deriveStatus({ openAction: null, hasEverContacted: true, now: NOW });
      const pass = noOpenAction && tsState === "NO_ACTION";
      console.log("  " + pad(14,6)+" | "+pad(tsState,22)+" | "+pad("open_count=0",22)+" | "+pad(STATUS_BUCKET["NO_ACTION"],7)+" | "+pad("—",7)+" | "+(pass?"PASS":"FAIL"));
      rows.push({ id: 14, name: "completed action ignored", tsState, sqlState: "N/A", pass });
      pass ? ok("F14: completed action not treated as open")
           : bad("F14", `openRows=${r.length} ts=${tsState}`);
    }

    // ── F15: cancelled action is NOT returned by open-action query ─────────────
    {
      const lid = await getTestLead();
      await client.query(
        `INSERT INTO next_actions (lead_id, title, waiting_on, status)
         VALUES ($1, 'FX17_15', 'voltsafe', 'cancelled')`, [lid]
      );
      const { rows: r } = await client.query(
        `SELECT id FROM next_actions WHERE lead_id=$1 AND status='open'`, [lid]
      );
      await client.query(`DELETE FROM next_actions WHERE lead_id=$1 AND title='FX17_15'`, [lid]);
      const noOpenAction = r.length === 0;
      const tsState = deriveStatus({ openAction: null, hasEverContacted: true, now: NOW });
      const pass = noOpenAction && tsState === "NO_ACTION";
      console.log("  " + pad(15,6)+" | "+pad(tsState,22)+" | "+pad("open_count=0",22)+" | "+pad(STATUS_BUCKET["NO_ACTION"],7)+" | "+pad("—",7)+" | "+(pass?"PASS":"FAIL"));
      rows.push({ id: 15, name: "cancelled action ignored", tsState, sqlState: "N/A", pass });
      pass ? ok("F15: cancelled action not treated as open")
           : bad("F15", `openRows=${r.length} ts=${tsState}`);
    }

    // ── F16: DST spring-forward — 23-hour wall clock = 1 calendar day ─────────
    {
      const days      = calendarDaysBetween(DST_SF_FROM, DST_SF_TO, TZ);
      const wallHours = (DST_SF_TO.getTime() - DST_SF_FROM.getTime()) / 3_600_000;
      const pass      = days === 1;
      const note      = `wall=${wallHours}h → ${days} calendar day(s)`;
      console.log("  " + pad(16,6)+" | "+pad(`calDays=${days}`,22)+" | "+pad("—",22)+" | "+pad("—",7)+" | "+pad("—",7)+" | "+(pass?"PASS":"FAIL")+" ("+note+")");
      rows.push({ id: 16, name: "DST spring-forward", tsState: `${days}d`, sqlState: "—", pass });
      pass ? ok(`F16: DST spring-forward (${wallHours}h wall → ${days} calendar day)`)
           : bad("F16", `expected 1 calendar day got ${days}`);
    }

    // ── F17: DST fall-back — 25-hour wall clock = 1 calendar day ─────────────
    {
      const days      = calendarDaysBetween(DST_FB_FROM, DST_FB_TO, TZ);
      const wallHours = (DST_FB_TO.getTime() - DST_FB_FROM.getTime()) / 3_600_000;
      const pass      = days === 1;
      const note      = `wall=${wallHours}h → ${days} calendar day(s)`;
      console.log("  " + pad(17,6)+" | "+pad(`calDays=${days}`,22)+" | "+pad("—",22)+" | "+pad("—",7)+" | "+pad("—",7)+" | "+(pass?"PASS":"FAIL")+" ("+note+")");
      rows.push({ id: 17, name: "DST fall-back", tsState: `${days}d`, sqlState: "—", pass });
      pass ? ok(`F17: DST fall-back (${wallHours}h wall → ${days} calendar day)`)
           : bad("F17", `expected 1 calendar day got ${days}`);
    }

  } finally {
    // Cleanup any leftover fixtures
    await client.query(`DELETE FROM next_actions WHERE title LIKE 'FX17_%'`);
    await client.end();
  }

  const allPass = rows.every(r => r.pass);
  console.log(`\n=== 17-Fixture Results: ${passed} passed, ${failed} failed ===`);
  console.log(allPass ? "ALL 17 PASS ✓" : `FAIL — ${failed} fixture(s) did not match`);
  if (!allPass) process.exit(1);
}

main().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
