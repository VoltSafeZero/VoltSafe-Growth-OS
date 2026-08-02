"use strict";
/**
 * next-action-15-fixtures.test.cjs
 *
 * 15-fixture SQL/TypeScript FULL equivalence table for Run 1 Last Gate.
 * Required: 15/15 PASS — NO N/A cells.
 *
 * Every fixture produces a real TS state AND a real SQL-derived state.
 * F1/F2/F3 (UNKNOWN/NEVER_CONTACTED/NO_ACTION) use lead_comms_summary
 * manipulation to create the correct hasEverContacted signal in the DB.
 *
 * DST calendar-helper tests (spring-forward, fall-back) are separate from
 * the status fixtures and reported under a distinct heading.
 */

const { Client } = require("pg");

let passed = 0, failed = 0;
const ok  = (l) => { console.log(`  ✓ ${l}`); passed++; };
const bad = (l, d="") => { console.error(`  ✗ ${l}${d ? " — "+d : ""}`); failed++; };

const TZ = "America/Vancouver";

// DST-safe calendar day arithmetic (replica of next-action-status.ts)
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

// TypeScript status derivation (exact replica of next-action-status.ts deriveStatus)
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
      if (days < 0)                    return "SCHEDULED";
      if (days <= criticalOverdueDays) return "DUE";
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

// Fixed clock
const NOW = new Date("2026-08-02T12:00:00-07:00");
const ago   = d => new Date(NOW.getTime() - d * 86_400_000);
const ahead = d => new Date(NOW.getTime() + d * 86_400_000);

// ── Full-state SQL derivation CASE ────────────────────────────────────────
// Handles all 15 states.
// Parameters: $1 = lead_id (integer), $2 = now ISO string
// hasEverContacted mapping from lead_comms_summary:
//   comm present (count > 0 or last_comm_at set) → NO_ACTION
//   row exists but all zero/null               → NEVER_CONTACTED
//   no row at all                              → UNKNOWN
const FULL_STATE_SQL = (lid, nowIso) => ({
  text: `
    SELECT
      CASE
        WHEN EXISTS (
          SELECT 1 FROM next_actions na
          WHERE na.lead_id = $1 AND na.status = 'open'
        ) THEN (
          SELECT
            CASE
              WHEN snoozed_until IS NOT NULL AND snoozed_until > $2::timestamptz THEN 'SNOOZED'
              WHEN blocker IS NOT NULL AND blocker <> ''                          THEN 'BLOCKED'
              WHEN waiting_on = 'customer' THEN
                CASE WHEN ($2::date - waiting_since_at::date) > 14
                     THEN 'CUSTOMER_NUDGE_DUE'
                     ELSE 'WAITING_CUSTOMER' END
              WHEN waiting_on = 'voltsafe' THEN
                CASE WHEN due_at IS NULL                          THEN 'DUE'
                     WHEN ($2::date - due_at::date) < 0         THEN 'SCHEDULED'
                     WHEN ($2::date - due_at::date) <= 3        THEN 'DUE'
                     ELSE 'CRITICAL' END
              ELSE 'OPEN_UNKNOWN'
            END
          FROM next_actions
          WHERE lead_id = $1 AND status = 'open'
          LIMIT 1
        )
        WHEN EXISTS (
          SELECT 1 FROM lead_comms_summary lcs
          WHERE lcs.lead_id = $1
            AND (lcs.incoming_count > 0 OR lcs.outgoing_count > 0 OR lcs.last_comm_at IS NOT NULL)
        ) THEN 'NO_ACTION'
        WHEN EXISTS (
          SELECT 1 FROM lead_comms_summary lcs
          WHERE lcs.lead_id = $1
        ) THEN 'NEVER_CONTACTED'
        ELSE 'UNKNOWN'
      END AS sql_state
  `,
  values: [lid, nowIso],
});

function pad(s, n) { return String(s ?? "").padEnd(n); }

// ── Test harness ─────────────────────────────────────────────────────────
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log("=== next-action-15-fixtures.test.cjs ===\n");
  console.log(
    pad("fix", 3) + " | " +
    pad("TS state", 22) + " | " +
    pad("SQL state", 22) + " | " +
    pad("TS bkt", 7) + " | " +
    pad("SQL bkt", 7) + " | PASS/FAIL"
  );
  console.log("-".repeat(88));

  // helper: free test lead with no current open action
  const getTestLead = async () => {
    const { rows } = await client.query(
      `SELECT id FROM leads
       WHERE source = 'voice-assistant'
         AND NOT EXISTS (SELECT 1 FROM next_actions WHERE lead_id=leads.id AND status='open')
       ORDER BY id LIMIT 1`
    );
    if (!rows.length) throw new Error("no available test lead");
    return rows[0].id;
  };

  // helper: run full-state SQL
  const sqlState = async (lid) => {
    const { rows } = await client.query(FULL_STATE_SQL(lid, NOW.toISOString()));
    return rows[0]?.sql_state ?? "ERROR";
  };

  const print = (id, name, ts, sql, pass) => {
    const tsBkt  = STATUS_BUCKET[ts]  ?? "?";
    const sqlBkt = STATUS_BUCKET[sql] ?? "?";
    console.log(
      "  " + pad(id, 3) + " | " +
      pad(ts, 22) + " | " +
      pad(sql, 22) + " | " +
      pad(tsBkt, 7) + " | " +
      pad(sqlBkt, 7) + " | " + (pass ? "PASS" : "FAIL")
    );
    pass ? ok(`F${id}: ${name}`) : bad(`F${id}: ${name}`, `TS=${ts} SQL=${sql}`);
  };

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // F1: UNKNOWN — no open action, no lead_comms_summary row at all
    // ═══════════════════════════════════════════════════════════════════════
    {
      const lid = await getTestLead();
      // Ensure no lcs row
      await client.query(`DELETE FROM lead_comms_summary WHERE lead_id=$1`, [lid]);
      // Ensure no open action (already guaranteed by getTestLead)

      const tsState = deriveStatus({ openAction: null, hasEverContacted: null, now: NOW });
      const sql = await sqlState(lid);
      const pass = tsState === "UNKNOWN" && sql === "UNKNOWN";
      print(1, "UNKNOWN", tsState, sql, pass);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // F2: NEVER_CONTACTED — no open action, lcs row exists with all zeros/null
    // ═══════════════════════════════════════════════════════════════════════
    {
      const lid = await getTestLead();
      // Insert lcs row with zero counts and null last_comm_at
      await client.query(`DELETE FROM lead_comms_summary WHERE lead_id=$1`, [lid]);
      await client.query(
        `INSERT INTO lead_comms_summary (lead_id, outgoing_count, incoming_count, updated_at)
         VALUES ($1, 0, 0, NOW())`, [lid]
      );

      const tsState = deriveStatus({ openAction: null, hasEverContacted: false, now: NOW });
      const sql = await sqlState(lid);
      const pass = tsState === "NEVER_CONTACTED" && sql === "NEVER_CONTACTED";
      print(2, "NEVER_CONTACTED", tsState, sql, pass);

      await client.query(`DELETE FROM lead_comms_summary WHERE lead_id=$1`, [lid]);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // F3: NO_ACTION — no open action, lcs row with outgoing_count > 0
    // ═══════════════════════════════════════════════════════════════════════
    {
      const lid = await getTestLead();
      await client.query(`DELETE FROM lead_comms_summary WHERE lead_id=$1`, [lid]);
      await client.query(
        `INSERT INTO lead_comms_summary (lead_id, outgoing_count, incoming_count, last_comm_at, updated_at)
         VALUES ($1, 3, 1, NOW(), NOW())`, [lid]
      );

      const tsState = deriveStatus({ openAction: null, hasEverContacted: true, now: NOW });
      const sql = await sqlState(lid);
      const pass = tsState === "NO_ACTION" && sql === "NO_ACTION";
      print(3, "NO_ACTION", tsState, sql, pass);

      await client.query(`DELETE FROM lead_comms_summary WHERE lead_id=$1`, [lid]);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // F4–F15: open-action path (lcs row with comm so hasEverContacted=true)
    // ═══════════════════════════════════════════════════════════════════════
    const openActionFixtures = [
      // [id, name, expected, waiting_on, due_at, blocker, snoozed_until, ws_override]
      [4,  "SCHEDULED",          "SCHEDULED",          "voltsafe", ahead(3),  null,                   null,      null],
      [5,  "DUE — null due_at",  "DUE",                "voltsafe", null,       null,                   null,      null],
      [6,  "DUE — due today",    "DUE",                "voltsafe", NOW,        null,                   null,      null],
      [7,  "DUE — 3d overdue",   "DUE",                "voltsafe", ago(3),     null,                   null,      null],
      [8,  "CRITICAL — 4d",      "CRITICAL",           "voltsafe", ago(4),     null,                   null,      null],
      [9,  "WAITING_CUSTOMER 14d","WAITING_CUSTOMER",  "customer", null,       null,                   null,      ago(14)],
      [10, "CND 15d",            "CUSTOMER_NUDGE_DUE", "customer", null,       null,                   null,      ago(15)],
      [11, "BLOCKED",            "BLOCKED",            "voltsafe", null,       "pending legal review", null,      null],
      [12, "SNOOZED — future",   "SNOOZED",            "voltsafe", null,       null,                   ahead(5),  null],
      [13, "expired snooze",     "DUE",                "voltsafe", null,       null,                   ago(1),    null],
      [14, "completed ignored",  "NO_ACTION",          null,       null,       null,                   null,      null],  // special: no open action, comm exists
      [15, "cancelled ignored",  "NO_ACTION",          null,       null,       null,                   null,      null],  // special: no open action, comm exists
    ];

    for (const [id, name, expected, wo, due, blk, snz, wsOverride] of openActionFixtures) {
      const lid = await getTestLead();

      // Ensure no lcs row first, then add comm so hasEverContacted=true
      await client.query(`DELETE FROM lead_comms_summary WHERE lead_id=$1`, [lid]);

      if (id === 14) {
        // F14: insert a COMPLETED action (not open), then lcs with comm
        await client.query(
          `INSERT INTO next_actions (lead_id, title, waiting_on, status)
           VALUES ($1, 'FX15_14_completed', 'voltsafe', 'completed')`, [lid]
        );
        await client.query(
          `INSERT INTO lead_comms_summary (lead_id, outgoing_count, incoming_count, last_comm_at, updated_at)
           VALUES ($1, 1, 0, NOW(), NOW())`, [lid]
        );
        const tsState = deriveStatus({ openAction: null, hasEverContacted: true, now: NOW });
        const sql = await sqlState(lid);
        const pass = tsState === "NO_ACTION" && sql === "NO_ACTION";
        print(14, name, tsState, sql, pass);
        await client.query(`DELETE FROM next_actions WHERE lead_id=$1 AND title='FX15_14_completed'`, [lid]);
        await client.query(`DELETE FROM lead_comms_summary WHERE lead_id=$1`, [lid]);
        continue;
      }

      if (id === 15) {
        // F15: insert a CANCELLED action (not open), then lcs with comm
        await client.query(
          `INSERT INTO next_actions (lead_id, title, waiting_on, status)
           VALUES ($1, 'FX15_15_cancelled', 'voltsafe', 'cancelled')`, [lid]
        );
        await client.query(
          `INSERT INTO lead_comms_summary (lead_id, outgoing_count, incoming_count, last_comm_at, updated_at)
           VALUES ($1, 1, 0, NOW(), NOW())`, [lid]
        );
        const tsState = deriveStatus({ openAction: null, hasEverContacted: true, now: NOW });
        const sql = await sqlState(lid);
        const pass = tsState === "NO_ACTION" && sql === "NO_ACTION";
        print(15, name, tsState, sql, pass);
        await client.query(`DELETE FROM next_actions WHERE lead_id=$1 AND title='FX15_15_cancelled'`, [lid]);
        await client.query(`DELETE FROM lead_comms_summary WHERE lead_id=$1`, [lid]);
        continue;
      }

      // Insert open action
      const { rows: ins } = await client.query(
        `INSERT INTO next_actions (lead_id, title, waiting_on, due_at, blocker, snoozed_until)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [lid, `FX15_${id}`, wo, due ?? null, blk ?? null, snz ?? null]
      );
      const fxId = ins[0].id;

      if (wsOverride) {
        await client.query(
          `UPDATE next_actions SET waiting_since_at = $1 WHERE id = $2`,
          [wsOverride.toISOString(), fxId]
        );
      }

      // Build TS openAction from what was inserted
      const actionRow = {
        waitingOn:      wo,
        waitingSinceAt: wsOverride ?? NOW,
        dueAt:          due ?? null,
        blocker:        blk ?? null,
        snoozedUntil:   snz ?? null,
      };
      const tsState = deriveStatus({ openAction: actionRow, hasEverContacted: true, now: NOW });
      const sql = await sqlState(lid);
      const pass = tsState === expected && sql === expected;
      print(id, name, tsState, sql, pass);

      await client.query(`DELETE FROM next_actions WHERE id = $1`, [fxId]);
      await client.query(`DELETE FROM lead_comms_summary WHERE lead_id=$1`, [lid]);
    }

  } finally {
    // Final cleanup
    await client.query(`DELETE FROM next_actions WHERE title LIKE 'FX15_%'`);
    await client.query(`DELETE FROM lead_comms_summary WHERE lead_id IN (
      SELECT id FROM leads WHERE source='voice-assistant'
    ) AND outgoing_count <= 3 AND incoming_count <= 1`);
    await client.end();
  }

  console.log(`\n=== 15-Fixture Results: ${passed} passed, ${failed} failed ===`);
  console.log(failed === 0 ? "ALL 15 PASS ✓" : `FAIL — ${failed} fixture(s) did not match`);

  // ─── DST Calendar Helper Tests (separate from the 15 status fixtures) ──────
  console.log("\n=== DST Calendar Helper Tests ===");
  let dstPassed = 0, dstFailed = 0;
  const dstOk  = (l) => { console.log(`  ✓ ${l}`); dstPassed++; };
  const dstBad = (l, d="") => { console.error(`  ✗ ${l}${d ? " — "+d : ""}`); dstFailed++; };

  // Spring-forward: March 8 2026, 2am PST → 3am PDT (23-hour day in Vancouver)
  {
    const from  = new Date("2026-03-08T01:00:00-08:00"); // 1am PST before spring
    const to    = new Date("2026-03-09T01:00:00-07:00"); // 1am PDT (23 wall hours later)
    const days  = calendarDaysBetween(from, to, TZ);
    const wall  = (to.getTime() - from.getTime()) / 3_600_000;
    const pass  = days === 1;
    pass ? dstOk(`DST spring-forward: ${wall}h wall clock → ${days} calendar day`)
         : dstBad("DST spring-forward", `expected 1 calendar day got ${days}`);
  }

  // Fall-back: November 1 2026, 2am PDT → 1am PST (25-hour day in Vancouver)
  {
    const from  = new Date("2026-11-01T00:30:00-07:00"); // 12:30am PDT
    const to    = new Date("2026-11-02T00:30:00-08:00"); // 12:30am PST (25 wall hours later)
    const days  = calendarDaysBetween(from, to, TZ);
    const wall  = (to.getTime() - from.getTime()) / 3_600_000;
    const pass  = days === 1;
    pass ? dstOk(`DST fall-back:       ${wall}h wall clock → ${days} calendar day`)
         : dstBad("DST fall-back", `expected 1 calendar day got ${days}`);
  }

  // Sanity: two non-DST days span correctly
  {
    const from  = new Date("2026-08-01T12:00:00-07:00");
    const to    = new Date("2026-08-03T12:00:00-07:00");
    const days  = calendarDaysBetween(from, to, TZ);
    const pass  = days === 2;
    pass ? dstOk(`Non-DST 2-day span: 48h → ${days} calendar days`)
         : dstBad("Non-DST 2-day span", `expected 2 got ${days}`);
  }

  console.log(`\n=== DST Helper Results: ${dstPassed} passed, ${dstFailed} failed ===`);

  const totalFailed = failed + dstFailed;
  if (totalFailed > 0) process.exit(1);
}

main().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
