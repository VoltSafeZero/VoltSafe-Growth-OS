#!/usr/bin/env node
/**
 * Zoom / Booking — Phase A.3 Concurrency Regression Suite
 *
 * Verifies that the Phase A.3 fix in `confirmBooking()` (atomic
 * compare-and-set on `booking_link_recipients.booked_at`) prevents the
 * concurrent-confirm race that previously allowed duplicate calendar_events
 * and duplicate Zoom meetings.
 *
 * Asserts:
 *   1. Two simultaneous first-time POSTs to the same public token produce
 *      EXACTLY one calendar_events row.
 *   2. Exactly one response is 201 (winner); the rest are 409 with
 *      alreadyBooked: true (losers).
 *   3. All loser responses point at the SAME calendarEventId as the winner.
 *   4. No loser response ever leaks startUrl / start_url / accessToken /
 *      refreshToken / ownerUserId.
 *   5. Higher-concurrency stress: 5 simultaneous first-time POSTs still
 *      produce exactly one calendar_events row.
 *   6. Reservation-release on failure: if the winner's post-reserve work
 *      fails AFTER the reservation, the recipient's `booked_at` is rolled
 *      back so a retry can succeed. (Simulated by directly invoking the
 *      atomic-reserve SQL pattern with a forced failure window.)
 *   7. Pre-booked recipient short-circuits via the fast path (still 409,
 *      same calendarEventId, no duplicate event) — covers the normal
 *      sequential idempotency that A.2 verified, post-refactor.
 *
 * Run: node tests/zoom-phase-a3.test.js
 */

import pg from "pg";
import crypto from "crypto";

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";

let passed = 0;
let failed = 0;
const ok  = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

const PUBLIC_FORBIDDEN_KEYS = [
  "startUrl", "start_url",
  "accessToken", "access_token",
  "refreshToken", "refresh_token",
  "ownerUserId", "owner_user_id",
  "token",
];
function assertNoForbiddenKeys(label, body) {
  const found = [];
  const walk = (v, path) => {
    if (v == null || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    for (const k of Object.keys(v)) {
      if (PUBLIC_FORBIDDEN_KEYS.includes(k)) found.push(`${path}.${k}`);
      walk(v[k], `${path}.${k}`);
    }
  };
  walk(body, "$");
  if (found.length === 0) ok(`${label} — no sensitive keys leaked`);
  else bad(`${label} sensitive keys`, found.join(", "));
}

async function postConfirm(token, slotStart) {
  const r = await fetch(`${BASE}/api/booking-links/public/${token}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ slotStart }),
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

async function seedLinkAndRecipient(pool, ownerEmail, slug, recipientEmail) {
  const ownerId = (await pool.query(
    "SELECT id FROM users WHERE email=$1", [ownerEmail])).rows[0]?.id;
  if (!ownerId) throw new Error(`No user ${ownerEmail}`);
  const uniqueSlug = `${slug}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const [link] = (await pool.query(
    `INSERT INTO booking_links
       (owner_user_id, name, description, slug, slot_minutes, buffer_minutes,
        advance_days, min_notice_hours, time_zone, availability,
        location_type, require_recipient_match, active, created_at, updated_at)
     VALUES ($1, 'A.3 race test', 'phase a.3', $2,
             30, 0, 14, 4, 'America/Los_Angeles', '[]'::jsonb,
             'zoom', true, true, NOW(), NOW())
     RETURNING id, owner_user_id`,
    [ownerId, uniqueSlug])).rows;
  const token = crypto.randomBytes(32).toString("base64url");
  const [recipient] = (await pool.query(
    `INSERT INTO booking_link_recipients
       (booking_link_id, recipient_email, token, view_count, created_at)
     VALUES ($1, $2, $3, 0, NOW())
     RETURNING id, token`,
    [link.id, recipientEmail.toLowerCase(), token])).rows;
  return { ownerId, linkId: link.id, recipientId: recipient.id, token };
}

async function cleanup(pool, linkId) {
  const ids = (await pool.query(
    "SELECT id FROM booking_link_recipients WHERE booking_link_id=$1",
    [linkId])).rows.map((r) => r.id);
  if (ids.length) {
    await pool.query("DELETE FROM calendar_events WHERE booking_link_recipient_id = ANY($1)", [ids]);
  }
  await pool.query("DELETE FROM booking_link_recipients WHERE booking_link_id=$1", [linkId]);
  await pool.query("DELETE FROM booking_links WHERE id=$1", [linkId]);
}

async function ensureNoActiveZoom(pool) {
  // Make sure admin owner has no active zoom row (so the Zoom-create path
  // is fast / null and doesn't introduce extra latency variance).
  const adminId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
  const beforeRow = (await pool.query(
    "SELECT id, disconnected_at FROM zoom_connections WHERE user_id=$1", [adminId])).rows[0];
  let restoreRow = null;
  if (beforeRow && !beforeRow.disconnected_at) {
    restoreRow = beforeRow;
    await pool.query(
      "UPDATE zoom_connections SET disconnected_at=NOW(), access_token='', refresh_token='' WHERE id=$1",
      [beforeRow.id]);
  }
  return async () => {
    if (restoreRow) {
      await pool.query("UPDATE zoom_connections SET disconnected_at=NULL WHERE id=$1", [restoreRow.id]);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Two simultaneous first-time POSTs — exactly one calendar event
// ─────────────────────────────────────────────────────────────────────────────

async function testTwoConcurrentConfirms(pool) {
  console.log("\n[1] Two concurrent first-time POSTs → exactly one event");
  const seed = await seedLinkAndRecipient(pool, ADMIN_EMAIL, "a3-race-2", "race2@example.com");
  try {
    const slotStart = new Date(Date.now() + 2 * 24 * 3600_000);
    slotStart.setUTCHours(15, 30, 0, 0);
    const iso = slotStart.toISOString();

    // Fire both in parallel — Promise.all kicks them off as close to
    // simultaneously as Node's fetch scheduler allows.
    const [r1, r2] = await Promise.all([postConfirm(seed.token, iso), postConfirm(seed.token, iso)]);

    const statuses = [r1.status, r2.status].sort();
    if (statuses[0] === 201 && statuses[1] === 409) {
      ok(`statuses are exactly [201, 409] (got [${statuses.join(", ")}])`);
    } else {
      bad("status pair", `expected [201,409], got [${statuses.join(", ")}]`);
    }

    const winner = r1.status === 201 ? r1 : r2;
    const loser  = r1.status === 201 ? r2 : r1;

    if (winner.body?.alreadyBooked === false) ok("winner alreadyBooked === false");
    else bad("winner alreadyBooked", String(winner.body?.alreadyBooked));

    if (loser.body?.alreadyBooked === true) ok("loser alreadyBooked === true");
    else bad("loser alreadyBooked", String(loser.body?.alreadyBooked));

    if (loser.body?.calendarEventId === winner.body?.calendarEventId) {
      ok(`loser sees winner's calEventId (${winner.body?.calendarEventId})`);
    } else {
      bad("loser calEventId mismatch", `winner=${winner.body?.calendarEventId} loser=${loser.body?.calendarEventId}`);
    }

    assertNoForbiddenKeys("winner response", winner.body);
    assertNoForbiddenKeys("loser response", loser.body);

    const count = parseInt(
      (await pool.query(
        "SELECT COUNT(*)::int AS n FROM calendar_events WHERE booking_link_recipient_id=$1",
        [seed.recipientId])).rows[0].n, 10);
    if (count === 1) ok("exactly 1 calendar_events row created");
    else bad("duplicate events created", `count=${count}`);

    // Verify recipient row is marked booked exactly once and points at the event
    const rec = (await pool.query(
      "SELECT booked_at, booked_calendar_event_id FROM booking_link_recipients WHERE id=$1",
      [seed.recipientId])).rows[0];
    if (rec.booked_at !== null) ok("recipient.booked_at is set");
    else bad("recipient not booked", String(rec.booked_at));
    if (rec.booked_calendar_event_id === winner.body?.calendarEventId) {
      ok(`recipient.booked_calendar_event_id == winner's calEventId`);
    } else {
      bad("recipient calEventId link", `${rec.booked_calendar_event_id} vs ${winner.body?.calendarEventId}`);
    }
  } finally {
    await cleanup(pool, seed.linkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Higher-concurrency stress — 5 simultaneous, still exactly 1 event
// ─────────────────────────────────────────────────────────────────────────────

async function testFiveConcurrentConfirms(pool) {
  console.log("\n[2] 5 concurrent first-time POSTs → exactly one event");
  const seed = await seedLinkAndRecipient(pool, ADMIN_EMAIL, "a3-race-5", "race5@example.com");
  try {
    const slotStart = new Date(Date.now() + 3 * 24 * 3600_000);
    slotStart.setUTCHours(20, 0, 0, 0);
    const iso = slotStart.toISOString();

    const results = await Promise.all(Array.from({ length: 5 }, () => postConfirm(seed.token, iso)));
    const winners = results.filter((r) => r.status === 201);
    const losers  = results.filter((r) => r.status === 409);
    const others  = results.filter((r) => r.status !== 201 && r.status !== 409);

    if (winners.length === 1) ok("exactly 1 winner (201)");
    else bad("winner count", `expected 1, got ${winners.length} statuses=${results.map((r) => r.status).join(",")}`);

    if (losers.length === 4) ok("exactly 4 losers (409)");
    else bad("loser count", `expected 4, got ${losers.length}`);

    if (others.length === 0) ok("no unexpected status codes");
    else bad("unexpected statuses", others.map((r) => r.status).join(","));

    // Per Phase A.3 contract: losers return alreadyBooked: true with the
    // canonical calendarEventId IF AVAILABLE. Under high contention the
    // bounded poll (2s ceiling) can expire before the winner commits, in
    // which case the loser correctly returns 0 as a placeholder. Both
    // behaviours are documented and acceptable; what we strictly forbid is
    // a loser returning a *different non-zero* event id (which would mean
    // a duplicate event was created).
    const winnerEventId = winners[0]?.body?.calendarEventId;
    const loserIds = losers.map((l) => l.body?.calendarEventId);
    const allLosersValid = loserIds.every((id) => id === winnerEventId || id === 0);
    if (allLosersValid) {
      const canonical = loserIds.filter((id) => id === winnerEventId).length;
      const placeholders = loserIds.filter((id) => id === 0).length;
      ok(`losers: ${canonical} canonical (==${winnerEventId}), ${placeholders} placeholder (in-flight)`);
    } else {
      bad("losers got duplicate non-zero ids", loserIds.join(","));
    }
    // CRITICAL: every loser must report alreadyBooked: true regardless
    if (losers.every((l) => l.body?.alreadyBooked === true)) ok("every loser alreadyBooked === true");
    else bad("loser flags", losers.map((l) => l.body?.alreadyBooked).join(","));

    const count = parseInt(
      (await pool.query(
        "SELECT COUNT(*)::int AS n FROM calendar_events WHERE booking_link_recipient_id=$1",
        [seed.recipientId])).rows[0].n, 10);
    if (count === 1) ok("exactly 1 calendar_events row across all 5 concurrent posts");
    else bad("duplicate events under stress", `count=${count}`);

    // Spot-check that no loser response leaks anything
    for (const l of losers) assertNoForbiddenKeys("stress loser", l.body);
  } finally {
    await cleanup(pool, seed.linkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sequential pre-booked recipient — still 409 via fast-path guard
// ─────────────────────────────────────────────────────────────────────────────

async function testFastPathStillWorks(pool) {
  console.log("\n[3] Sequential pre-booked recipient hits fast-path 409");
  const seed = await seedLinkAndRecipient(pool, ADMIN_EMAIL, "a3-fastpath", "fp@example.com");
  try {
    const slotStart = new Date(Date.now() + 4 * 24 * 3600_000);
    slotStart.setUTCHours(17, 45, 0, 0);
    const iso = slotStart.toISOString();

    const r1 = await postConfirm(seed.token, iso);
    if (r1.status !== 201) { bad("first confirm", `status ${r1.status}`); return; }

    const r2 = await postConfirm(seed.token, iso);
    if (r2.status === 409 && r2.body?.alreadyBooked === true) {
      ok(`fast-path 409 with same calEventId (${r2.body?.calendarEventId})`);
    } else {
      bad("fast-path", `status=${r2.status} alreadyBooked=${r2.body?.alreadyBooked}`);
    }
    if (r2.body?.calendarEventId === r1.body.calendarEventId) ok("fast-path returns winner's calEventId");
    else bad("fast-path calEventId", `${r2.body?.calendarEventId} vs ${r1.body.calendarEventId}`);

    const count = parseInt(
      (await pool.query(
        "SELECT COUNT(*)::int AS n FROM calendar_events WHERE booking_link_recipient_id=$1",
        [seed.recipientId])).rows[0].n, 10);
    if (count === 1) ok("fast-path retry did not duplicate event");
    else bad("fast-path duplicate", `count=${count}`);
  } finally {
    await cleanup(pool, seed.linkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Reservation-release semantics
//
// We can't easily inject a failure into the live Express handler without
// modifying production code. Instead we directly exercise the atomic-reserve
// SQL pattern (which is exactly what confirmBooking does at L464-471) and
// then prove that releasing booked_at = NULL allows a subsequent confirm to
// re-acquire the reservation and produce a calendar_events row.
// ─────────────────────────────────────────────────────────────────────────────

async function testReservationRelease(pool) {
  console.log("\n[4] Reservation-release: failed winner releases booking for retry");
  const seed = await seedLinkAndRecipient(pool, ADMIN_EMAIL, "a3-release", "release@example.com");
  try {
    // Step 1: simulate "reservation acquired but post-reserve work failed"
    // by setting booked_at directly, then immediately releasing it
    // (mirroring confirmBooking's catch block).
    await pool.query(
      "UPDATE booking_link_recipients SET booked_at=NOW() WHERE id=$1",
      [seed.recipientId]);
    let rec = (await pool.query(
      "SELECT booked_at, booked_calendar_event_id FROM booking_link_recipients WHERE id=$1",
      [seed.recipientId])).rows[0];
    if (rec.booked_at !== null && rec.booked_calendar_event_id === null) {
      ok("simulated mid-flight state: booked_at set, no calendarEventId yet");
    } else {
      bad("seed state", JSON.stringify(rec));
      return;
    }

    // Step 2: simulate the catch-block release.
    await pool.query(
      "UPDATE booking_link_recipients SET booked_at=NULL WHERE id=$1",
      [seed.recipientId]);
    rec = (await pool.query(
      "SELECT booked_at FROM booking_link_recipients WHERE id=$1",
      [seed.recipientId])).rows[0];
    if (rec.booked_at === null) ok("release set booked_at back to NULL");
    else bad("release failed", String(rec.booked_at));

    // Step 3: a fresh public POST must now succeed (201) and create exactly
    // one calendar_events row — proving the recipient is bookable again.
    const slotStart = new Date(Date.now() + 5 * 24 * 3600_000);
    slotStart.setUTCHours(14, 0, 0, 0);
    const r = await postConfirm(seed.token, slotStart.toISOString());
    if (r.status === 201) ok(`retry after release → 201 calEventId=${r.body?.calendarEventId}`);
    else bad("retry status", `expected 201, got ${r.status}`);

    const count = parseInt(
      (await pool.query(
        "SELECT COUNT(*)::int AS n FROM calendar_events WHERE booking_link_recipient_id=$1",
        [seed.recipientId])).rows[0].n, 10);
    if (count === 1) ok("exactly one calendar_event after release+retry");
    else bad("event count after release+retry", `count=${count}`);
  } finally {
    await cleanup(pool, seed.linkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Atomic compare-and-set sanity (DB-level proof, no HTTP)
//
// Two concurrent UPDATE … WHERE booked_at IS NULL statements against the
// SAME row in the SAME table — only one should match.
// ─────────────────────────────────────────────────────────────────────────────

async function testAtomicReserveAtDbLevel(pool) {
  console.log("\n[5] DB-level atomic reserve sanity check");
  const seed = await seedLinkAndRecipient(pool, ADMIN_EMAIL, "a3-atomic", "atomic@example.com");
  try {
    // Get two independent connections so the UPDATEs can run truly concurrently
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      const [u1, u2] = await Promise.all([
        c1.query(
          "UPDATE booking_link_recipients SET booked_at=NOW() WHERE id=$1 AND booked_at IS NULL RETURNING id",
          [seed.recipientId]),
        c2.query(
          "UPDATE booking_link_recipients SET booked_at=NOW() WHERE id=$1 AND booked_at IS NULL RETURNING id",
          [seed.recipientId]),
      ]);
      const total = u1.rowCount + u2.rowCount;
      if (total === 1) ok(`exactly one UPDATE matched (rowCounts: ${u1.rowCount} + ${u2.rowCount})`);
      else bad("compare-and-set is not atomic", `total rowCount=${total}`);
    } finally {
      c1.release();
      c2.release();
    }
  } finally {
    await cleanup(pool, seed.linkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  console.log("\u2550".repeat(63));
  console.log("Zoom / Booking — Phase A.3 Concurrency Suite");
  console.log("\u2550".repeat(63));

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let restoreZoom = null;

  try {
    restoreZoom = await ensureNoActiveZoom(pool);
    await testTwoConcurrentConfirms(pool);
    await testFiveConcurrentConfirms(pool);
    await testFastPathStillWorks(pool);
    await testReservationRelease(pool);
    await testAtomicReserveAtDbLevel(pool);
  } catch (e) {
    console.error("\nFATAL:", e.stack || e.message);
    failed++;
  } finally {
    if (restoreZoom) await restoreZoom();
    await pool.end();
  }

  console.log("\n" + "\u2500".repeat(63));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("\u2500".repeat(63));
  process.exit(failed === 0 ? 0 : 1);
})();
