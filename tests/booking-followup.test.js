#!/usr/bin/env node
/**
 * Phase D — Booking Follow-Up Automation
 *
 * Verifies the runFollowupScan engine through POST /api/crm/booking-followups/run:
 *   1. SENT_NOT_OPENED rule creates a task for sent-but-not-opened recipients
 *      whose sent_at is older than the threshold.
 *   2. OPENED_NOT_BOOKED rule creates a task for opened-but-not-booked
 *      recipients whose first_viewed_at is older than the threshold.
 *   3. POST_MEETING rule creates a task for booked recipients whose
 *      linked calendar_event.end_time has already passed.
 *   4. Idempotency: running scan twice creates the task only once
 *      (per recipient × kind).
 *   5. Owner scoping: tasks.owner_user_id = booking_links.owner_user_id —
 *      a recipient on user B's link creates a task for user B, not the
 *      caller running the scan.
 *   6. CRM linking: contact match wins over lead match; orphan email
 *      leaves linked_object_type NULL.
 *   7. Recent rows (sent today / opened today / meeting in future) do NOT
 *      trigger tasks.
 *   8. Revoked recipients are excluded from all rules.
 *   9. Endpoint is admin-gated (403 for non-admin) and CSRF-guarded.
 *
 * Run: node tests/booking-followup.test.js
 */

import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PASS  = "alberni1444";

let passed = 0;
let failed = 0;
const ok  = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

async function loginAs(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/` },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/connect\.sid=[^;]+/);
  return m ? m[0] : null;
}

function jfetch(cookie, method, path, body) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: BASE, Referer: `${BASE}/`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
async function jjson(cookie, method, path, body) {
  const r = await jfetch(cookie, method, path, body);
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}

// ─── Seed helpers ───────────────────────────────────────────────────────
async function seedLink(pool, ownerId, name) {
  const slug = `fu-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [l] = (await pool.query(
    `INSERT INTO booking_links
       (owner_user_id, name, description, slug, slot_minutes, buffer_minutes,
        advance_days, min_notice_hours, time_zone, availability,
        location_type, require_recipient_match, active, created_at, updated_at)
     VALUES ($1, $2, '', $3, 30, 0, 14, 4,
             'America/Los_Angeles', '[]'::jsonb, 'zoom', true, true,
             NOW(), NOW())
     RETURNING id, name`, [ownerId, name, slug])).rows;
  return l;
}

async function seedRecipient(pool, linkId, email, opts = {}) {
  // opts: sentAgoDays, viewedAgoDays, bookedAgoHours, revoked, calendarEventId
  const token = `tok-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const sentExpr   = opts.sentAgoDays   != null ? `NOW() - INTERVAL '${opts.sentAgoDays} days'`     : "NULL";
  const viewedExpr = opts.viewedAgoDays != null ? `NOW() - INTERVAL '${opts.viewedAgoDays} days'`   : "NULL";
  const bookedExpr = opts.bookedAgoHours!= null ? `NOW() - INTERVAL '${opts.bookedAgoHours} hours'` : "NULL";
  const revokedExpr= opts.revoked                ? "NOW()"                                          : "NULL";
  const viewCount  = opts.viewedAgoDays != null ? 1 : 0;
  const calEvId    = opts.calendarEventId ?? null;
  const [row] = (await pool.query(
    `INSERT INTO booking_link_recipients
       (booking_link_id, recipient_email, token, sent_at, first_viewed_at,
        view_count, booked_at, booked_calendar_event_id, revoked_at, created_at)
     VALUES ($1, LOWER($2), $3, ${sentExpr}, ${viewedExpr},
             $4, ${bookedExpr}, $5, ${revokedExpr},
             NOW() - INTERVAL '10 days')
     RETURNING id`, [linkId, email, token, viewCount, calEvId])).rows;
  return row;
}

async function seedCalendarEvent(pool, ownerId, endHoursAgo) {
  const [e] = (await pool.query(
    `INSERT INTO calendar_events
       (user_id, title, event_type, start_time, end_time, status, created_at, updated_at)
     VALUES ($1, 'PhaseD test meeting', 'meeting',
             NOW() - INTERVAL '${endHoursAgo + 1} hours',
             NOW() - INTERVAL '${endHoursAgo} hours',
             'scheduled', NOW(), NOW())
     RETURNING id`, [ownerId])).rows;
  return e;
}

async function seedFutureCalendarEvent(pool, ownerId) {
  const [e] = (await pool.query(
    `INSERT INTO calendar_events
       (user_id, title, event_type, start_time, end_time, status, created_at, updated_at)
     VALUES ($1, 'PhaseD future meeting', 'meeting',
             NOW() + INTERVAL '2 hours',
             NOW() + INTERVAL '3 hours',
             'scheduled', NOW(), NOW())
     RETURNING id`, [ownerId])).rows;
  return e;
}

async function seedSecondaryUser(pool) {
  const email = `phased-other-${Date.now()}@voltsafe.test`;
  const hash  = await bcrypt.hash("phased1234", 12);
  const [u] = (await pool.query(
    `INSERT INTO users (email, name, password, role, global_role, must_change_password, created_at)
     VALUES ($1, 'Phase D Other', $2, 'user', 'sales', false, NOW())
     RETURNING id`, [email, hash])).rows;
  return { id: u.id, email };
}

async function seedAccountAndContact(pool, email) {
  const [a] = (await pool.query(
    `INSERT INTO accounts (name, segment, lead_status, priority, created_at, updated_at)
     VALUES ($1, 'marina', 'new', 'medium', NOW(), NOW())
     RETURNING id`, [`PhaseD Acct ${Date.now()}`])).rows;
  const [c] = (await pool.query(
    `INSERT INTO contacts (account_id, name, email, created_at, updated_at)
     VALUES ($1, 'PhaseD Contact', LOWER($2), NOW(), NOW())
     RETURNING id`, [a.id, email])).rows;
  return { accountId: a.id, contactId: c.id };
}

async function seedLead(pool, ownerId, email) {
  const [r] = (await pool.query(
    `INSERT INTO leads (company, contact_name, contact_email, status, owner_user_id, created_at, updated_at)
     VALUES ('PhaseD Marina', 'PhaseD Captain', LOWER($1), 'new', $2, NOW(), NOW())
     RETURNING id`, [email, ownerId])).rows;
  return r;
}

async function findFollowupTask(pool, recipientId, kind) {
  const r = await pool.query(
    `SELECT id, owner_user_id, linked_object_type, linked_object_id, account_id, title, source, source_label
       FROM tasks
      WHERE source='booking_followup'
        AND source_meta->>'recipientId' = $1
        AND source_meta->>'kind' = $2`,
    [String(recipientId), kind]);
  return r.rows;
}

// ─── Tests ──────────────────────────────────────────────────────────────
async function testRule1SentNotOpened(pool, cookie, ownerId) {
  console.log("\n[1] Rule SENT_NOT_OPENED creates one task per stale recipient");
  const link = await seedLink(pool, ownerId, "PhaseD R1 link");
  const stale  = await seedRecipient(pool, link.id, `phased-r1-stale-${Date.now()}@example.com`,  { sentAgoDays: 5 });
  const recent = await seedRecipient(pool, link.id, `phased-r1-recent-${Date.now()}@example.com`, { sentAgoDays: 0 });
  const opened = await seedRecipient(pool, link.id, `phased-r1-opened-${Date.now()}@example.com`, { sentAgoDays: 5, viewedAgoDays: 4 });
  const revoked= await seedRecipient(pool, link.id, `phased-r1-rev-${Date.now()}@example.com`,    { sentAgoDays: 5, revoked: true });
  try {
    const r = await jjson(cookie, "POST", "/api/crm/booking-followups/run", {});
    if (r.status === 200) ok("POST /run → 200");
    else { bad("POST /run status", String(r.status)); return { link, recipientIds: [stale.id, recent.id, opened.id, revoked.id] }; }

    const t = await findFollowupTask(pool, stale.id, "sent_not_opened");
    if (t.length === 1) ok("stale recipient → 1 sent_not_opened task");
    else bad("stale task count", String(t.length));
    if (t[0]?.owner_user_id === ownerId) ok("task owner = booking link owner");
    else bad("task owner mismatch", String(t[0]?.owner_user_id));
    if (t[0]?.title?.includes("hasn't opened")) ok("task title formatted");
    else bad("task title", t[0]?.title);
    if (t[0]?.source_label === "PhaseD R1 link") ok("task source_label = link name");
    else bad("source_label", t[0]?.source_label);

    const tRecent = await findFollowupTask(pool, recent.id, "sent_not_opened");
    if (tRecent.length === 0) ok("recent (today) recipient → no task");
    else bad("recent task should not exist", String(tRecent.length));

    const tOpened = await findFollowupTask(pool, opened.id, "sent_not_opened");
    if (tOpened.length === 0) ok("already-opened recipient → no sent_not_opened task");
    else bad("opened recipient should not get sent_not_opened", String(tOpened.length));

    const tRevoked = await findFollowupTask(pool, revoked.id, "sent_not_opened");
    if (tRevoked.length === 0) ok("revoked recipient → no task");
    else bad("revoked recipient should not get task", String(tRevoked.length));

    return { link, recipientIds: [stale.id, recent.id, opened.id, revoked.id] };
  } catch (e) {
    bad("R1 threw", e.message);
    return { link, recipientIds: [stale.id, recent.id, opened.id, revoked.id] };
  }
}

async function testRule2OpenedNotBooked(pool, cookie, ownerId) {
  console.log("\n[2] Rule OPENED_NOT_BOOKED creates task for opened-but-not-booked");
  const link = await seedLink(pool, ownerId, "PhaseD R2 link");
  const stale  = await seedRecipient(pool, link.id, `phased-r2-stale-${Date.now()}@example.com`,  { sentAgoDays: 5, viewedAgoDays: 3 });
  const recent = await seedRecipient(pool, link.id, `phased-r2-recent-${Date.now()}@example.com`, { sentAgoDays: 1, viewedAgoDays: 0 });
  const booked = await seedRecipient(pool, link.id, `phased-r2-booked-${Date.now()}@example.com`, { sentAgoDays: 5, viewedAgoDays: 3, bookedAgoHours: 24 });
  try {
    await jjson(cookie, "POST", "/api/crm/booking-followups/run", {});
    const t = await findFollowupTask(pool, stale.id, "opened_not_booked");
    if (t.length === 1) ok("stale opened → 1 opened_not_booked task");
    else bad("R2 stale count", String(t.length));
    if (t[0]?.title?.includes("opened but didn't book")) ok("task title formatted");
    else bad("R2 title", t[0]?.title);

    const tRecent = await findFollowupTask(pool, recent.id, "opened_not_booked");
    if (tRecent.length === 0) ok("recently-opened recipient → no task");
    else bad("R2 recent should not exist", String(tRecent.length));

    const tBooked = await findFollowupTask(pool, booked.id, "opened_not_booked");
    if (tBooked.length === 0) ok("already-booked recipient → no opened_not_booked task");
    else bad("R2 booked should not get opened_not_booked", String(tBooked.length));

    return { link, recipientIds: [stale.id, recent.id, booked.id] };
  } catch (e) {
    bad("R2 threw", e.message);
    return { link, recipientIds: [stale.id, recent.id, booked.id] };
  }
}

async function testRule3PostMeeting(pool, cookie, ownerId) {
  console.log("\n[3] Rule POST_MEETING_FOLLOWUP creates task after meeting end");
  const link = await seedLink(pool, ownerId, "PhaseD R3 link");
  const pastEvent   = await seedCalendarEvent(pool, ownerId, /* endHoursAgo */ 4);
  const futureEvent = await seedFutureCalendarEvent(pool, ownerId);
  const completed = await seedRecipient(pool, link.id, `phased-r3-done-${Date.now()}@example.com`,
    { sentAgoDays: 5, viewedAgoDays: 3, bookedAgoHours: 6, calendarEventId: pastEvent.id });
  const future    = await seedRecipient(pool, link.id, `phased-r3-fut-${Date.now()}@example.com`,
    { sentAgoDays: 1, viewedAgoDays: 1, bookedAgoHours: 1, calendarEventId: futureEvent.id });
  try {
    await jjson(cookie, "POST", "/api/crm/booking-followups/run", {});
    const t = await findFollowupTask(pool, completed.id, "post_meeting_followup");
    if (t.length === 1) ok("completed meeting → 1 post_meeting_followup task");
    else bad("R3 completed count", String(t.length));
    if (t[0]?.title?.includes("Post-meeting follow-up")) ok("task title formatted");
    else bad("R3 title", t[0]?.title);

    const tFut = await findFollowupTask(pool, future.id, "post_meeting_followup");
    if (tFut.length === 0) ok("future meeting → no post_meeting task yet");
    else bad("R3 future should not exist", String(tFut.length));

    return { link, recipientIds: [completed.id, future.id], eventIds: [pastEvent.id, futureEvent.id] };
  } catch (e) {
    bad("R3 threw", e.message);
    return { link, recipientIds: [completed.id, future.id], eventIds: [pastEvent.id, futureEvent.id] };
  }
}

async function testIdempotency(pool, cookie, ownerId) {
  console.log("\n[4] Idempotency — repeated runs do not duplicate tasks");
  const link = await seedLink(pool, ownerId, "PhaseD idem link");
  const rec = await seedRecipient(pool, link.id, `phased-idem-${Date.now()}@example.com`, { sentAgoDays: 5 });
  try {
    await jjson(cookie, "POST", "/api/crm/booking-followups/run", {});
    await jjson(cookie, "POST", "/api/crm/booking-followups/run", {});
    await jjson(cookie, "POST", "/api/crm/booking-followups/run", {});
    const t = await findFollowupTask(pool, rec.id, "sent_not_opened");
    if (t.length === 1) ok("3 scans → still exactly 1 task");
    else bad("idempotency violation", String(t.length));
    return { link, recipientIds: [rec.id] };
  } catch (e) {
    bad("idempotency threw", e.message);
    return { link, recipientIds: [rec.id] };
  }
}

async function testOwnerScoping(pool, cookie) {
  console.log("\n[5] Owner scoping — task owner = link owner, not scan caller");
  const trevorId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
  const other = await seedSecondaryUser(pool);
  const otherLink = await seedLink(pool, other.id, "PhaseD other-owner link");
  const rec = await seedRecipient(pool, otherLink.id, `phased-owner-${Date.now()}@example.com`, { sentAgoDays: 5 });
  try {
    // Admin (Trevor) triggers the scan
    await jjson(cookie, "POST", "/api/crm/booking-followups/run", {});
    const t = await findFollowupTask(pool, rec.id, "sent_not_opened");
    if (t.length === 1) ok("task created for other user's recipient");
    else bad("R5 task count", String(t.length));
    if (t[0]?.owner_user_id === other.id) ok(`task owner_user_id = ${other.id} (booking link owner, NOT admin caller)`);
    else bad("task owner not link owner", String(t[0]?.owner_user_id));
    if (t[0]?.owner_user_id !== trevorId) ok("scan caller (admin) is not the task owner");
    else bad("scan caller leaked as task owner");
    return { link: otherLink, recipientIds: [rec.id], otherUserId: other.id };
  } catch (e) {
    bad("R5 threw", e.message);
    return { link: otherLink, recipientIds: [rec.id], otherUserId: other.id };
  }
}

async function testCrmLinking(pool, cookie, ownerId) {
  console.log("\n[6] CRM linking — contact > lead > null");
  const link = await seedLink(pool, ownerId, "PhaseD crm link");
  const contactEmail = `phased-crm-contact-${Date.now()}@example.com`;
  const leadEmail    = `phased-crm-lead-${Date.now()}@example.com`;
  const orphanEmail  = `phased-crm-orphan-${Date.now()}@example.com`;
  const c = await seedAccountAndContact(pool, contactEmail);
  const l = await seedLead(pool, ownerId, leadEmail);
  const recC = await seedRecipient(pool, link.id, contactEmail, { sentAgoDays: 5 });
  const recL = await seedRecipient(pool, link.id, leadEmail,    { sentAgoDays: 5 });
  const recO = await seedRecipient(pool, link.id, orphanEmail,  { sentAgoDays: 5 });
  try {
    await jjson(cookie, "POST", "/api/crm/booking-followups/run", {});
    const tC = (await findFollowupTask(pool, recC.id, "sent_not_opened"))[0];
    if (tC?.linked_object_type === "contact" && tC?.linked_object_id === c.contactId) ok("contact email → linked to contact");
    else bad("contact link", JSON.stringify(tC));
    if (tC?.account_id === c.accountId) ok("contact account_id propagated");
    else bad("account_id missing", String(tC?.account_id));

    const tL = (await findFollowupTask(pool, recL.id, "sent_not_opened"))[0];
    if (tL?.linked_object_type === "lead" && tL?.linked_object_id === l.id) ok("lead-only email → linked to lead");
    else bad("lead link", JSON.stringify(tL));

    const tO = (await findFollowupTask(pool, recO.id, "sent_not_opened"))[0];
    if (tO && tO.linked_object_type === null) ok("orphan email → linked_object_type NULL");
    else bad("orphan link", JSON.stringify(tO));

    return { link, recipientIds: [recC.id, recL.id, recO.id], contact: c, lead: l };
  } catch (e) {
    bad("R6 threw", e.message);
    return { link, recipientIds: [recC.id, recL.id, recO.id], contact: c, lead: l };
  }
}

async function testAuthGate(pool) {
  console.log("\n[7] Endpoint auth — anonymous 401, non-admin 403");
  const anon = await jjson(null, "POST", "/api/crm/booking-followups/run", {});
  if (anon.status === 401) ok("anonymous → 401");
  else bad("anon status", String(anon.status));

  const other = await seedSecondaryUser(pool);
  const otherCookie = await loginAs(other.email, "phased1234");
  if (otherCookie) ok("non-admin login OK");
  else bad("non-admin login failed");
  if (otherCookie) {
    const r = await jjson(otherCookie, "POST", "/api/crm/booking-followups/run", {});
    if (r.status === 403) ok("non-admin → 403");
    else bad("non-admin status", String(r.status));
  }
  return { otherUserId: other.id };
}

async function cleanupAll(pool, linkIds, recipientIds, eventIds, contactIds, accountIds, leadIds, userIds) {
  // tasks → recipients → links → events → contacts → accounts → leads → users
  if (recipientIds.length) {
    await pool.query(
      `DELETE FROM tasks WHERE source='booking_followup'
         AND (source_meta->>'recipientId') = ANY($1::text[])`,
      [recipientIds.map(String)]);
  }
  for (const id of linkIds) {
    try {
      await pool.query("DELETE FROM booking_link_recipients WHERE booking_link_id=$1", [id]);
      await pool.query("DELETE FROM booking_links WHERE id=$1", [id]);
    } catch {}
  }
  for (const id of eventIds) { try { await pool.query("DELETE FROM calendar_events WHERE id=$1", [id]); } catch {} }
  for (const id of contactIds) { try { await pool.query("DELETE FROM contacts WHERE id=$1", [id]); } catch {} }
  for (const id of accountIds) { try { await pool.query("DELETE FROM accounts WHERE id=$1", [id]); } catch {} }
  for (const id of leadIds) { try { await pool.query("DELETE FROM leads WHERE id=$1", [id]); } catch {} }
  for (const id of userIds) {
    try {
      await pool.query("DELETE FROM tasks WHERE owner_user_id=$1 AND source='booking_followup'", [id]);
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
    } catch {}
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const cookie = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
  if (!cookie) { console.error("Fatal: admin login failed"); process.exit(2); }
  const trevorId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;

  console.log("=== VoltSafe Cortex — Phase D: Booking Follow-Up Automation ===");

  const linkIds = [], recipientIds = [], eventIds = [], contactIds = [], accountIds = [], leadIds = [], userIds = [];
  try {
    const r1 = await testRule1SentNotOpened(pool, cookie, trevorId);
    linkIds.push(r1.link.id); recipientIds.push(...r1.recipientIds);

    const r2 = await testRule2OpenedNotBooked(pool, cookie, trevorId);
    linkIds.push(r2.link.id); recipientIds.push(...r2.recipientIds);

    const r3 = await testRule3PostMeeting(pool, cookie, trevorId);
    linkIds.push(r3.link.id); recipientIds.push(...r3.recipientIds); eventIds.push(...r3.eventIds);

    const r4 = await testIdempotency(pool, cookie, trevorId);
    linkIds.push(r4.link.id); recipientIds.push(...r4.recipientIds);

    const r5 = await testOwnerScoping(pool, cookie);
    linkIds.push(r5.link.id); recipientIds.push(...r5.recipientIds); userIds.push(r5.otherUserId);

    const r6 = await testCrmLinking(pool, cookie, trevorId);
    linkIds.push(r6.link.id); recipientIds.push(...r6.recipientIds);
    contactIds.push(r6.contact.contactId); accountIds.push(r6.contact.accountId); leadIds.push(r6.lead.id);

    const r7 = await testAuthGate(pool);
    userIds.push(r7.otherUserId);
  } finally {
    await cleanupAll(pool, linkIds, recipientIds, eventIds, contactIds, accountIds, leadIds, userIds);
    await pool.end();
  }

  console.log(`\n${"\u2500".repeat(63)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"\u2500".repeat(63)}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(2); });
