#!/usr/bin/env node
/**
 * Zoom / Booking — Phase A.2 Regression Suite
 *
 * Public booking confirmation flow with optional Zoom auto-attach.
 *
 * Routes covered:
 *   GET  /api/booking-links/public/:token            (anon — safe projection)
 *   POST /api/booking-links/public/:token/confirm    (anon — confirms slot)
 *
 * Asserts:
 *   1. Public GET response shape is safe (no raw token, no zoom fields, no
 *      ownerUserId, no startUrl, no access/refresh tokens).
 *   2. POST confirm with NO zoom connection on owner still succeeds:
 *        - 201 returned
 *        - calendarEventId persisted with userId = owner
 *        - zoomJoinUrl = null
 *        - response NEVER contains startUrl / start_url / accessToken / refreshToken
 *   3. Idempotency — second POST for the same recipient returns 409
 *      `alreadyBooked: true`, surfaces the existing meetingUrl as zoomJoinUrl,
 *      and does NOT create a second calendar_events row.
 *   4. Idempotency surfaces the existing meeting (simulated zoom success):
 *      pre-seed a booked recipient with calendarEvent.meetingUrl=https://zoom.us/j/...
 *      POST confirm → 409 zoomJoinUrl matches; no new calendar_events row;
 *      response still excludes startUrl.
 *   5. Cross-owner isolation — a booking link owned by ADMIN cannot be used to
 *      create a calendar event under VIEWER's userId, and vice versa. The
 *      calendar event's userId always equals link.ownerUserId.
 *   6. Public confirm of an INVALID token → 400 / 404 with no leak.
 *   7. Revoked recipient token → 404, no booking persisted.
 *
 * Run: node tests/zoom-phase-a2.test.js
 */

import pg from "pg";
import crypto from "crypto";

const BASE = "http://localhost:5000";
const ADMIN_EMAIL  = "trevor@voltsafe.com";
const VIEWER_EMAIL = "viewer@voltsafe.com";

let passed = 0;
let failed = 0;
const ok  = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

async function getJson(path) {
  const r = await fetch(`${BASE}${path}`, { method: "GET", redirect: "manual" });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
async function postJson(path, payload) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify(payload ?? {}),
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

const PUBLIC_FORBIDDEN_KEYS = [
  "startUrl", "start_url",
  "accessToken", "access_token",
  "refreshToken", "refresh_token",
  "ownerUserId", "owner_user_id",
  "token",
];

function assertNoForbiddenKeys(label, body) {
  // Recursive scan — must not contain any sensitive key at any depth
  const found = [];
  const walk = (v, path) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (typeof v !== "object") return;
    for (const k of Object.keys(v)) {
      if (PUBLIC_FORBIDDEN_KEYS.includes(k)) found.push(`${path}.${k}`);
      walk(v[k], `${path}.${k}`);
    }
  };
  walk(body, "$");
  if (found.length === 0) ok(`${label} — no sensitive keys leaked`);
  else bad(`${label} sensitive keys`, found.join(", "));
}

// ─────────────────────────────────────────────────────────────────────────────
// Test seed helpers
// ─────────────────────────────────────────────────────────────────────────────

async function seedLinkAndRecipient(pool, ownerEmail, slug, recipientEmail) {
  const ownerId = (await pool.query(
    "SELECT id FROM users WHERE email=$1", [ownerEmail])).rows[0]?.id;
  if (!ownerId) throw new Error(`No user ${ownerEmail}`);

  // Use a unique slug per run to avoid the unique index collision
  const uniqueSlug = `${slug}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const [link] = (await pool.query(
    `INSERT INTO booking_links
       (owner_user_id, name, description, slug, slot_minutes, buffer_minutes,
        advance_days, min_notice_hours, time_zone, availability,
        location_type, require_recipient_match, active, created_at, updated_at)
     VALUES ($1, 'A.2 test link', 'phase a.2 regression', $2,
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
  // Delete dependent calendar events first (they FK back to recipients)
  const recipientIds = (await pool.query(
    "SELECT id FROM booking_link_recipients WHERE booking_link_id=$1",
    [linkId])).rows.map((r) => r.id);
  if (recipientIds.length) {
    await pool.query(
      "DELETE FROM calendar_events WHERE booking_link_recipient_id = ANY($1)",
      [recipientIds]);
  }
  await pool.query("DELETE FROM booking_link_recipients WHERE booking_link_id=$1", [linkId]);
  await pool.query("DELETE FROM booking_links WHERE id=$1", [linkId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Public GET shape — safe projection
// ─────────────────────────────────────────────────────────────────────────────

async function testPublicGetShape(pool) {
  console.log("\n[1] GET /api/booking-links/public/:token — safe projection");
  const seed = await seedLinkAndRecipient(pool, ADMIN_EMAIL, "a2-get-shape", "buyer1@example.com");
  try {
    const r = await getJson(`/api/booking-links/public/${seed.token}`);
    if (r.status !== 200) { bad("public GET", `expected 200, got ${r.status}`); return; }

    const expectedKeys = ["bookingLink", "recipientEmail", "alreadyBooked", "bookedAt"];
    const missing = expectedKeys.filter((k) => !(k in r.body));
    if (missing.length === 0) ok(`public GET has all ${expectedKeys.length} keys`);
    else bad("public GET missing keys", missing.join(","));

    // bookingLink subobject must not contain ownerUserId / id
    const blKeys = Object.keys(r.body.bookingLink || {});
    if (!blKeys.includes("ownerUserId") && !blKeys.includes("id")) {
      ok("bookingLink subobject hides ownerUserId / id");
    } else {
      bad("bookingLink leaks owner/id", blKeys.join(","));
    }

    if (r.body.recipientEmail === "buyer1@example.com") ok("recipientEmail surfaced");
    else bad("recipientEmail wrong", String(r.body.recipientEmail));

    assertNoForbiddenKeys("public GET", r.body);
  } finally {
    await cleanup(pool, seed.linkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST confirm — no zoom on owner → success without zoom
// ─────────────────────────────────────────────────────────────────────────────

async function testConfirmNoZoom(pool) {
  console.log("\n[2] POST /confirm with owner having NO Zoom → succeeds w/o zoom");

  // Make sure admin owner has no active zoom row (or has a disconnected one)
  const adminId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
  const beforeRow = (await pool.query(
    "SELECT id, disconnected_at FROM zoom_connections WHERE user_id=$1", [adminId])).rows[0];
  // If a connected row exists, mark it disconnected for this test, restore at end
  let restoreRow = null;
  if (beforeRow && !beforeRow.disconnected_at) {
    restoreRow = beforeRow;
    await pool.query(
      "UPDATE zoom_connections SET disconnected_at=NOW(), access_token='', refresh_token='' WHERE id=$1",
      [beforeRow.id]);
  }

  const seed = await seedLinkAndRecipient(pool, ADMIN_EMAIL, "a2-no-zoom", "buyer2@example.com");
  try {
    // Pick a slot 2 days in the future at 10:00 UTC
    const slotStart = new Date(Date.now() + 2 * 24 * 3600_000);
    slotStart.setUTCHours(17, 0, 0, 0); // 10am Pacific-ish

    const r = await postJson(`/api/booking-links/public/${seed.token}/confirm`, {
      slotStart: slotStart.toISOString(),
      attendeeName: "Buyer Two",
    });

    if (r.status === 201) ok(`confirm w/o zoom → 201 (calEventId=${r.body?.calendarEventId})`);
    else bad("confirm w/o zoom", `expected 201, got ${r.status} body=${JSON.stringify(r.body)}`);

    if (r.body?.alreadyBooked === false) ok("alreadyBooked === false");
    else bad("alreadyBooked", String(r.body?.alreadyBooked));

    if (r.body?.zoomJoinUrl === null) ok("zoomJoinUrl === null (no owner zoom)");
    else bad("zoomJoinUrl should be null", String(r.body?.zoomJoinUrl));

    if (r.body?.zoomMeetingId === null) ok("zoomMeetingId === null");
    else bad("zoomMeetingId should be null", String(r.body?.zoomMeetingId));

    assertNoForbiddenKeys("confirm w/o zoom response", r.body);

    // Verify DB: calendar event exists, userId=owner, meetingUrl=null
    const ev = (await pool.query(
      "SELECT user_id, meeting_url, location, booking_link_recipient_id FROM calendar_events WHERE id=$1",
      [r.body.calendarEventId])).rows[0];
    if (ev?.user_id === seed.ownerId) ok(`calendar_event.user_id == owner (${seed.ownerId})`);
    else bad("calendar_event.user_id mismatch", `${ev?.user_id} vs ${seed.ownerId}`);
    if (ev?.meeting_url === null) ok("calendar_event.meeting_url is null (no zoom)");
    else bad("meeting_url should be null", String(ev?.meeting_url));
    if (ev?.booking_link_recipient_id === seed.recipientId) ok("calendar_event.booking_link_recipient_id traces back");
    else bad("recipient traceback wrong", String(ev?.booking_link_recipient_id));
  } finally {
    await cleanup(pool, seed.linkId);
    if (restoreRow) {
      await pool.query(
        "UPDATE zoom_connections SET disconnected_at=NULL WHERE id=$1",
        [restoreRow.id]);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Idempotency — re-POST does NOT create a second calendar event
// ─────────────────────────────────────────────────────────────────────────────

async function testIdempotency(pool) {
  console.log("\n[3] Idempotency — re-POST does not duplicate the booking");
  const seed = await seedLinkAndRecipient(pool, ADMIN_EMAIL, "a2-idem", "buyer3@example.com");
  try {
    const slotStart = new Date(Date.now() + 3 * 24 * 3600_000);
    slotStart.setUTCHours(18, 30, 0, 0);

    const r1 = await postJson(`/api/booking-links/public/${seed.token}/confirm`, {
      slotStart: slotStart.toISOString(),
    });
    if (r1.status !== 201) { bad("first confirm", `status ${r1.status}`); return; }
    ok(`first confirm → 201 calEventId=${r1.body.calendarEventId}`);

    const r2 = await postJson(`/api/booking-links/public/${seed.token}/confirm`, {
      slotStart: slotStart.toISOString(),
    });
    if (r2.status === 409) ok("second confirm → 409 (already booked)");
    else bad("second confirm status", `expected 409, got ${r2.status}`);

    if (r2.body?.alreadyBooked === true) ok("second confirm body alreadyBooked === true");
    else bad("alreadyBooked flag", String(r2.body?.alreadyBooked));

    if (r2.body?.calendarEventId === r1.body.calendarEventId) {
      ok(`second confirm returns SAME calEventId (${r2.body.calendarEventId})`);
    } else {
      bad("calEventId differs across retries", `${r1.body.calendarEventId} vs ${r2.body?.calendarEventId}`);
    }

    // Verify no second row in calendar_events for this recipient
    const count = parseInt(
      (await pool.query(
        "SELECT COUNT(*)::int AS n FROM calendar_events WHERE booking_link_recipient_id=$1",
        [seed.recipientId])).rows[0].n, 10);
    if (count === 1) ok("calendar_events count for recipient === 1 (no duplicate)");
    else bad("duplicate calendar_events created", `count=${count}`);

    assertNoForbiddenKeys("idempotent 409 response", r2.body);
  } finally {
    await cleanup(pool, seed.linkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Idempotency surfaces existing zoom join URL (simulated zoom success)
// ─────────────────────────────────────────────────────────────────────────────

async function testIdempotencyPreservesZoom(pool) {
  console.log("\n[4] Idempotency surfaces previously-attached Zoom URL");
  const seed = await seedLinkAndRecipient(pool, ADMIN_EMAIL, "a2-idem-zoom", "buyer4@example.com");
  try {
    // Simulate a prior successful Zoom-attached booking by inserting the
    // calendar event + marking the recipient as booked.
    const slotStart = new Date(Date.now() + 4 * 24 * 3600_000);
    slotStart.setUTCHours(20, 0, 0, 0);
    const endTime = new Date(slotStart.getTime() + 30 * 60_000);
    const fakeJoin = "https://zoom.us/j/9999999999?pwd=fake-test-pwd";

    const [calEv] = (await pool.query(
      `INSERT INTO calendar_events
         (user_id, title, description, event_type, start_time, end_time,
          all_day, location, meeting_url, status, invitees,
          booking_link_recipient_id, created_at, updated_at)
       VALUES ($1, 'A.2 test link', 'desc', 'meeting', $2, $3,
               false, $4, $4, 'scheduled', ARRAY['buyer4@example.com'],
               $5, NOW(), NOW())
       RETURNING id`,
      [seed.ownerId, slotStart, endTime, fakeJoin, seed.recipientId])).rows;

    await pool.query(
      "UPDATE booking_link_recipients SET booked_at=NOW(), booked_calendar_event_id=$1 WHERE id=$2",
      [calEv.id, seed.recipientId]);

    // Now retry confirm — should hit the alreadyBooked branch and surface
    // the existing meeting URL as zoomJoinUrl (no startUrl ever)
    const r = await postJson(`/api/booking-links/public/${seed.token}/confirm`, {
      slotStart: slotStart.toISOString(),
    });
    if (r.status === 409) ok(`retry on already-zoomed booking → 409`);
    else bad("retry status", `expected 409, got ${r.status}`);

    if (r.body?.zoomJoinUrl === fakeJoin) ok("retry surfaces existing zoomJoinUrl");
    else bad("zoomJoinUrl mismatch", `expected ${fakeJoin}, got ${r.body?.zoomJoinUrl}`);

    if (r.body?.calendarEventId === calEv.id) ok("retry returns existing calEventId");
    else bad("calEventId mismatch on retry", String(r.body?.calendarEventId));

    assertNoForbiddenKeys("retry-on-zoomed booking", r.body);

    // No new calendar_events row created
    const count = parseInt(
      (await pool.query(
        "SELECT COUNT(*)::int AS n FROM calendar_events WHERE booking_link_recipient_id=$1",
        [seed.recipientId])).rows[0].n, 10);
    if (count === 1) ok("no duplicate calendar_event after retry");
    else bad("duplicate created", `count=${count}`);
  } finally {
    await cleanup(pool, seed.linkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Cross-owner isolation — calendar_event.user_id always equals link owner
// ─────────────────────────────────────────────────────────────────────────────

async function testCrossOwnerIsolation(pool) {
  console.log("\n[5] Cross-owner isolation — calendar_event.user_id == link owner");

  // Two links — one owned by admin, one by viewer
  const adminSeed  = await seedLinkAndRecipient(pool, ADMIN_EMAIL,  "a2-xown-a", "buyer5a@example.com");
  const viewerSeed = await seedLinkAndRecipient(pool, VIEWER_EMAIL, "a2-xown-v", "buyer5v@example.com");
  if (adminSeed.ownerId === viewerSeed.ownerId) {
    bad("seed sanity", "admin and viewer have same id?!");
  }

  try {
    const slot = new Date(Date.now() + 5 * 24 * 3600_000);
    slot.setUTCHours(16, 0, 0, 0);

    const ra = await postJson(`/api/booking-links/public/${adminSeed.token}/confirm`,
      { slotStart: slot.toISOString() });
    const rv = await postJson(`/api/booking-links/public/${viewerSeed.token}/confirm`,
      { slotStart: slot.toISOString() });

    if (ra.status === 201 && rv.status === 201) ok("both confirms succeeded");
    else bad("confirms", `admin=${ra.status} viewer=${rv.status}`);

    const evA = (await pool.query("SELECT user_id FROM calendar_events WHERE id=$1",
      [ra.body.calendarEventId])).rows[0];
    const evV = (await pool.query("SELECT user_id FROM calendar_events WHERE id=$1",
      [rv.body.calendarEventId])).rows[0];

    if (evA?.user_id === adminSeed.ownerId) ok(`admin link booking → user_id=${adminSeed.ownerId} (admin)`);
    else bad("admin booking userId", `${evA?.user_id} vs ${adminSeed.ownerId}`);

    if (evV?.user_id === viewerSeed.ownerId) ok(`viewer link booking → user_id=${viewerSeed.ownerId} (viewer)`);
    else bad("viewer booking userId", `${evV?.user_id} vs ${viewerSeed.ownerId}`);

    if (evA?.user_id !== evV?.user_id) ok("cross-owner: events scoped to their respective owners");
    else bad("cross-owner mixup", `both ended up under ${evA?.user_id}`);

    assertNoForbiddenKeys("admin confirm response", ra.body);
    assertNoForbiddenKeys("viewer confirm response", rv.body);
  } finally {
    await cleanup(pool, adminSeed.linkId);
    await cleanup(pool, viewerSeed.linkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Invalid token handling
// ─────────────────────────────────────────────────────────────────────────────

async function testInvalidTokens() {
  console.log("\n[6] Invalid token handling");

  const tooShort = await postJson("/api/booking-links/public/abc/confirm",
    { slotStart: new Date(Date.now() + 86400_000).toISOString() });
  if (tooShort.status === 400) ok(`too-short token → 400`);
  else bad("too-short token", `expected 400, got ${tooShort.status}`);

  const fakeButLong = await postJson(
    "/api/booking-links/public/" + crypto.randomBytes(32).toString("base64url") + "/confirm",
    { slotStart: new Date(Date.now() + 86400_000).toISOString() });
  if (fakeButLong.status === 404) ok(`unknown long token → 404`);
  else bad("unknown long token", `expected 404, got ${fakeButLong.status}`);

  // Also GET with too-short / unknown
  const getShort = await getJson("/api/booking-links/public/abc");
  if (getShort.status === 400) ok(`GET too-short token → 400`);
  else bad("GET too-short", `expected 400, got ${getShort.status}`);

  const getUnknown = await getJson("/api/booking-links/public/" + crypto.randomBytes(32).toString("base64url"));
  if (getUnknown.status === 404) ok(`GET unknown token → 404`);
  else bad("GET unknown", `expected 404, got ${getUnknown.status}`);

  assertNoForbiddenKeys("GET unknown body", getUnknown.body);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Revoked recipient → 404, no booking
// ─────────────────────────────────────────────────────────────────────────────

async function testRevokedRecipient(pool) {
  console.log("\n[7] Revoked recipient → 404, no booking persisted");
  const seed = await seedLinkAndRecipient(pool, ADMIN_EMAIL, "a2-revoked", "buyer7@example.com");
  try {
    await pool.query("UPDATE booking_link_recipients SET revoked_at=NOW() WHERE id=$1",
      [seed.recipientId]);

    const slotStart = new Date(Date.now() + 6 * 24 * 3600_000);
    slotStart.setUTCHours(15, 0, 0, 0);
    const r = await postJson(`/api/booking-links/public/${seed.token}/confirm`,
      { slotStart: slotStart.toISOString() });

    if (r.status === 404) ok("revoked token confirm → 404");
    else bad("revoked confirm", `expected 404, got ${r.status}`);

    const count = parseInt(
      (await pool.query(
        "SELECT COUNT(*)::int AS n FROM calendar_events WHERE booking_link_recipient_id=$1",
        [seed.recipientId])).rows[0].n, 10);
    if (count === 0) ok("no calendar_events row created for revoked recipient");
    else bad("revoked recipient created event", `count=${count}`);

    // GET also 404
    const g = await getJson(`/api/booking-links/public/${seed.token}`);
    if (g.status === 404) ok("revoked token GET → 404");
    else bad("revoked GET", `expected 404, got ${g.status}`);
  } finally {
    await cleanup(pool, seed.linkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  console.log("\u2550".repeat(63));
  console.log("Zoom / Booking — Phase A.2 Regression Suite");
  console.log("\u2550".repeat(63));

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await testPublicGetShape(pool);
    await testConfirmNoZoom(pool);
    await testIdempotency(pool);
    await testIdempotencyPreservesZoom(pool);
    await testCrossOwnerIsolation(pool);
    await testInvalidTokens();
    await testRevokedRecipient(pool);
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
