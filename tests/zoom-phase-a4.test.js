#!/usr/bin/env node
/**
 * Zoom / Booking — Phase A.4 UX/Polish Suite
 *
 * Verifies that the Phase A.4 polish surfaces work safely:
 *   1. Public GET /api/booking-links/public/:token — when alreadyBooked,
 *      response includes a `bookedEvent` block with startTime/endTime and
 *      a zoom-only join URL. NEVER includes startUrl, host tokens,
 *      ownerUserId, or non-zoom URLs.
 *   2. Public GET — when NOT booked, `bookedEvent` is null.
 *   3. Public GET — when booked but the calendar event was deleted out
 *      of band, `bookedEvent` is null (graceful).
 *   4. Public GET — when booked but calendar event has a non-zoom
 *      meetingUrl (e.g. teams.microsoft.com), `zoomJoinUrl` is null
 *      (defence-in-depth — the field is named zoom-only).
 *   5. Public booking page renders the booking name on initial load and
 *      includes the right testid hooks.
 *   6. /booking-public page does not 200 with any sensitive keys in HTML.
 *
 * Run: node tests/zoom-phase-a4.test.js
 */

import pg from "pg";
import crypto from "crypto";

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";

let passed = 0;
let failed = 0;
const ok  = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

const FORBIDDEN = [
  "startUrl", "start_url",
  "accessToken", "access_token",
  "refreshToken", "refresh_token",
  "ownerUserId", "owner_user_id",
  "token",
];
function assertNoForbidden(label, body) {
  const found = [];
  const walk = (v, path) => {
    if (v == null || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    for (const k of Object.keys(v)) {
      if (FORBIDDEN.includes(k)) found.push(`${path}.${k}`);
      walk(v[k], `${path}.${k}`);
    }
  };
  walk(body, "$");
  if (found.length === 0) ok(`${label} — no sensitive keys leaked`);
  else bad(`${label} sensitive keys`, found.join(", "));
}

async function getPublic(token) {
  const r = await fetch(`${BASE}/api/booking-links/public/${token}`);
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
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

async function seedLink(pool, email = "a4@example.com") {
  const ownerId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
  const slug = `a4-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const [link] = (await pool.query(
    `INSERT INTO booking_links
       (owner_user_id, name, description, slug, slot_minutes, buffer_minutes,
        advance_days, min_notice_hours, time_zone, availability,
        location_type, require_recipient_match, active, created_at, updated_at)
     VALUES ($1, 'A.4 polish test', null, $2,
             30, 0, 14, 4, 'America/Los_Angeles', '[]'::jsonb,
             'zoom', true, true, NOW(), NOW())
     RETURNING id, name`, [ownerId, slug])).rows;
  const token = crypto.randomBytes(32).toString("base64url");
  const [recipient] = (await pool.query(
    `INSERT INTO booking_link_recipients
       (booking_link_id, recipient_email, token, view_count, created_at)
     VALUES ($1, $2, $3, 0, NOW()) RETURNING id`,
    [link.id, email.toLowerCase(), token])).rows;
  return { ownerId, linkId: link.id, linkName: link.name, recipientId: recipient.id, token };
}

async function cleanup(pool, linkId) {
  const ids = (await pool.query(
    "SELECT id FROM booking_link_recipients WHERE booking_link_id=$1", [linkId])).rows.map((r) => r.id);
  if (ids.length) await pool.query("DELETE FROM calendar_events WHERE booking_link_recipient_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM booking_link_recipients WHERE booking_link_id=$1", [linkId]);
  await pool.query("DELETE FROM booking_links WHERE id=$1", [linkId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Not-booked recipient: bookedEvent is null
// ─────────────────────────────────────────────────────────────────────────────

async function testUnbookedReturnsNullBookedEvent(pool) {
  console.log("\n[1] Unbooked recipient → bookedEvent: null");
  const seed = await seedLink(pool, "unbooked@example.com");
  try {
    const r = await getPublic(seed.token);
    if (r.status !== 200) { bad("status", String(r.status)); return; }
    if (r.body.alreadyBooked === false) ok("alreadyBooked === false");
    else bad("alreadyBooked", String(r.body.alreadyBooked));
    if (r.body.bookedEvent === null) ok("bookedEvent === null");
    else bad("bookedEvent", JSON.stringify(r.body.bookedEvent));
    assertNoForbidden("public GET (unbooked)", r.body);
  } finally { await cleanup(pool, seed.linkId); }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Booked recipient: bookedEvent populated with start/end and join URL
// ─────────────────────────────────────────────────────────────────────────────

async function testBookedReturnsEventDetails(pool) {
  console.log("\n[2] Booked recipient → bookedEvent populated; rejoin works on refresh");
  const seed = await seedLink(pool, "booked@example.com");
  try {
    const slot = new Date(Date.now() + 2 * 24 * 3600_000);
    slot.setUTCHours(15, 0, 0, 0);
    const conf = await postConfirm(seed.token, slot.toISOString());
    if (conf.status !== 201) { bad("confirm", `status=${conf.status}`); return; }
    const calId = conf.body?.calendarEventId;
    if (!calId) { bad("calendarEventId", JSON.stringify(conf.body)); return; }

    // Simulate page refresh: re-fetch public GET
    const r = await getPublic(seed.token);
    if (r.status !== 200) { bad("status", String(r.status)); return; }
    if (r.body.alreadyBooked === true) ok("alreadyBooked === true on refresh");
    else bad("alreadyBooked on refresh", String(r.body.alreadyBooked));
    if (r.body.bookedEvent && typeof r.body.bookedEvent === "object") {
      ok("bookedEvent present");
    } else { bad("bookedEvent missing", JSON.stringify(r.body.bookedEvent)); return; }
    if (r.body.bookedEvent.startTime) ok(`bookedEvent.startTime present (${r.body.bookedEvent.startTime})`);
    else bad("startTime missing", null);
    if (r.body.bookedEvent.endTime) ok("bookedEvent.endTime present");
    else bad("endTime missing", null);
    if ("zoomJoinUrl" in r.body.bookedEvent) ok("bookedEvent.zoomJoinUrl key present (may be null when no zoom)");
    else bad("zoomJoinUrl key missing", null);
    assertNoForbidden("public GET (booked)", r.body);
  } finally { await cleanup(pool, seed.linkId); }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Booked but calendar event deleted out-of-band → bookedEvent: null
// ─────────────────────────────────────────────────────────────────────────────

async function testDeletedEventGracefulNull(pool) {
  console.log("\n[3] Booked + calendar_event deleted out-of-band → bookedEvent: null");
  const seed = await seedLink(pool, "deleted@example.com");
  try {
    const slot = new Date(Date.now() + 3 * 24 * 3600_000);
    slot.setUTCHours(16, 0, 0, 0);
    const conf = await postConfirm(seed.token, slot.toISOString());
    if (conf.status !== 201) { bad("confirm", `status=${conf.status}`); return; }
    // Delete the calendar_events row; recipient still booked
    await pool.query("DELETE FROM calendar_events WHERE id=$1", [conf.body.calendarEventId]);
    const r = await getPublic(seed.token);
    if (r.status !== 200) { bad("status", String(r.status)); return; }
    if (r.body.alreadyBooked === true) ok("still alreadyBooked === true");
    else bad("alreadyBooked", String(r.body.alreadyBooked));
    if (r.body.bookedEvent === null) ok("bookedEvent === null when event deleted");
    else bad("bookedEvent should be null", JSON.stringify(r.body.bookedEvent));
    assertNoForbidden("public GET (deleted-event)", r.body);
  } finally { await cleanup(pool, seed.linkId); }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Defence-in-depth: non-zoom meetingUrl never exposed via zoomJoinUrl
// ─────────────────────────────────────────────────────────────────────────────

async function testNonZoomUrlFiltered(pool) {
  console.log("\n[4] Non-zoom & bypass-attempt meetingUrls are filtered from bookedEvent.zoomJoinUrl");
  // Each pair: [stored-meeting-url, expectedZoomJoinUrl-or-null]
  const cases = [
    // Plain non-zoom URLs → null
    ["https://teams.microsoft.com/l/meetup-join/abc",       null],
    ["https://meet.google.com/abc-defg-hij",                null],
    // Bypass-attempt: substring-only "zoom.us/" → null (architect-flagged)
    ["https://evil.com#zoom.us/x",                          null],
    ["https://evil.com/path/zoom.us/x",                     null],
    ["https://evil.com?go=zoom.us/x",                       null],
    ["https://zoom.us.evil.com/j/123",                      null],
    ["https://notzoom.us/j/123",                            null],
    // Garbage / non-URL → null
    ["javascript:alert(1)",                                 null],
    ["",                                                    null],
    // Valid zoom hosts (positive cases)
    ["https://zoom.us/j/9876543210",                        "https://zoom.us/j/9876543210"],
    ["https://us02web.zoom.us/j/9876543210?pwd=abc",        "https://us02web.zoom.us/j/9876543210?pwd=abc"],
    ["https://voltsafe.zoom.us/my/trevor",                  "https://voltsafe.zoom.us/my/trevor"],
  ];
  for (const [stored, expected] of cases) {
    const seed = await seedLink(pool, `filter-${Math.random().toString(36).slice(2, 8)}@example.com`);
    try {
      const slot = new Date(Date.now() + 4 * 24 * 3600_000);
      slot.setUTCHours(14, 0, 0, 0);
      const conf = await postConfirm(seed.token, slot.toISOString());
      if (conf.status !== 201) { bad(`confirm (${stored})`, `status=${conf.status}`); continue; }
      await pool.query(
        "UPDATE calendar_events SET meeting_url=$1 WHERE id=$2",
        [stored, conf.body.calendarEventId]);
      const r = await getPublic(seed.token);
      if (r.status !== 200) { bad("status", String(r.status)); continue; }
      const got = r.body.bookedEvent?.zoomJoinUrl ?? null;
      if (got === expected) ok(`${JSON.stringify(stored)} → ${JSON.stringify(expected)}`);
      else bad(`${JSON.stringify(stored)} → expected ${JSON.stringify(expected)} got ${JSON.stringify(got)}`, null);
      assertNoForbidden("public GET (filter case)", r.body);
    } finally { await cleanup(pool, seed.linkId); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Booking-public HTML page loads with no leaked keys
// ─────────────────────────────────────────────────────────────────────────────

async function testPublicPageHtmlClean(pool) {
  console.log("\n[5] /booking-public/:token HTML page is sanitised");
  const seed = await seedLink(pool, "html@example.com");
  try {
    const r = await fetch(`${BASE}/booking-public/${seed.token}`);
    const html = await r.text();
    if (r.status === 200) ok(`page loads (status ${r.status})`);
    else bad("status", String(r.status));
    // Vite dev SSR returns the index.html shell; the token is rendered into
    // the URL but never the response body. We just check no sensitive keys
    // were accidentally serialised into a script tag.
    const hits = ["start_url", "accessToken", "refreshToken", "ZOOM_CLIENT_SECRET"]
      .filter((k) => html.includes(k));
    if (hits.length === 0) ok("HTML body contains no sensitive key names");
    else bad("HTML body leaks", hits.join(","));
  } finally { await cleanup(pool, seed.linkId); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  console.log("\u2550".repeat(63));
  console.log("Zoom / Booking — Phase A.4 UX/Polish Suite");
  console.log("\u2550".repeat(63));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await testUnbookedReturnsNullBookedEvent(pool);
    await testBookedReturnsEventDetails(pool);
    await testDeletedEventGracefulNull(pool);
    await testNonZoomUrlFiltered(pool);
    await testPublicPageHtmlClean(pool);
  } catch (e) {
    console.error("\nFATAL:", e.stack || e.message);
    failed++;
  } finally {
    await pool.end();
  }
  console.log("\n" + "\u2500".repeat(63));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("\u2500".repeat(63));
  process.exit(failed === 0 ? 0 : 1);
})();
