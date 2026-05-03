#!/usr/bin/env node
/**
 * Phase E — Booking Conversion Intelligence
 *
 * Validates the analytics service through 5 endpoints:
 *   GET /api/crm/booking-analytics/links       — per-link metrics
 *   GET /api/crm/booking-analytics/owners      — per-owner (admin only)
 *   GET /api/crm/booking-analytics/segments    — contact / lead / orphan
 *   GET /api/crm/booking-analytics/timing      — avg time-to-convert
 *   GET /api/crm/booking-analytics/leaderboard — top + underperforming
 *
 * Coverage:
 *   1. Per-link counts: sent / opened / booked exact, plus open & booking rate
 *   2. Per-link rates (zero-sent edge case → 0, no NaN)
 *   3. Per-owner aggregation across multiple links of one owner
 *   4. Per-segment classification: contact > lead > orphan
 *   5. Time-to-convert avgs (sent→opened, opened→booked, sent→booked)
 *   6. Time-to-convert empty samples → null avg, 0 samples
 *   7. Leaderboard ranking by booking rate with min-sent floor
 *   8. Underperforming detection (≥5 sent, <10% booking rate)
 *   9. Owner scoping — non-admin sees only own; ownerUserId override IGNORED
 *  10. Admin-gated /owners endpoint → 403 for non-admin
 *  11. Validation: bad ownerUserId / bookingLinkId / dateFrom → 400
 *  12. Auth: anonymous → 401 on every endpoint
 *  13. Revoked recipients excluded from all counts
 *
 * Run: node tests/booking-analytics.test.js
 */

import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PASS  = "alberni1444";

let passed = 0, failed = 0;
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

async function jget(cookie, path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: BASE, Referer: `${BASE}/` },
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

// ─── Seed helpers ───────────────────────────────────────────────────────
async function seedLink(pool, ownerId, name) {
  const slug = `pe-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
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
  const token = `tok-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const sentExpr   = opts.sentAgoHours   != null ? `NOW() - INTERVAL '${opts.sentAgoHours} hours'`     : "NULL";
  const viewedExpr = opts.viewedAgoHours != null ? `NOW() - INTERVAL '${opts.viewedAgoHours} hours'`   : "NULL";
  const bookedExpr = opts.bookedAgoHours != null ? `NOW() - INTERVAL '${opts.bookedAgoHours} hours'`   : "NULL";
  const revokedExpr= opts.revoked                ? "NOW()"                                            : "NULL";
  const viewCount  = opts.viewedAgoHours != null ? 1 : 0;
  const [row] = (await pool.query(
    `INSERT INTO booking_link_recipients
       (booking_link_id, recipient_email, token, sent_at, first_viewed_at,
        view_count, booked_at, revoked_at, created_at)
     VALUES ($1, LOWER($2), $3, ${sentExpr}, ${viewedExpr},
             $4, ${bookedExpr}, ${revokedExpr},
             NOW() - INTERVAL '7 days')
     RETURNING id`, [linkId, email, token, viewCount])).rows;
  return row;
}

async function seedSecondaryUser(pool) {
  const email = `phasee-other-${Date.now()}@voltsafe.test`;
  const hash  = await bcrypt.hash("phasee1234", 12);
  const [u] = (await pool.query(
    `INSERT INTO users (email, name, password, role, global_role, must_change_password, permissions, created_at)
     VALUES ($1, 'Phase E Other', $2, 'user', 'sales', false, $3::jsonb, NOW())
     RETURNING id`, [email, hash, JSON.stringify({ crm: "edit" })])).rows;
  return { id: u.id, email };
}

async function seedAccountAndContact(pool, email) {
  const [a] = (await pool.query(
    `INSERT INTO accounts (name, segment, lead_status, priority, created_at, updated_at)
     VALUES ($1, 'marina', 'new', 'medium', NOW(), NOW())
     RETURNING id`, [`PhaseE Acct ${Date.now()}-${Math.random()}`])).rows;
  const [c] = (await pool.query(
    `INSERT INTO contacts (account_id, name, email, created_at, updated_at)
     VALUES ($1, 'PhaseE Contact', LOWER($2), NOW(), NOW())
     RETURNING id`, [a.id, email])).rows;
  return { accountId: a.id, contactId: c.id };
}

async function seedLead(pool, ownerId, email) {
  const [r] = (await pool.query(
    `INSERT INTO leads (company, contact_name, contact_email, status, owner_user_id, created_at, updated_at)
     VALUES ('PhaseE Marina', 'PhaseE Captain', LOWER($1), 'new', $2, NOW(), NOW())
     RETURNING id`, [email, ownerId])).rows;
  return r;
}

// ─── Tests ──────────────────────────────────────────────────────────────
async function testPerLinkCounts(pool, cookie, ownerId) {
  console.log("\n[1] Per-link metrics — exact counts and rates");
  // 10 sent, 6 opened, 2 booked, 1 revoked (revoked excluded from sent)
  const link = await seedLink(pool, ownerId, "PhaseE link counts");
  const recipientIds = [];
  for (let i = 0; i < 4; i++) {
    const r = await seedRecipient(pool, link.id, `pe-c-only-sent-${i}-${Date.now()}@example.com`, { sentAgoHours: 50 });
    recipientIds.push(r.id);
  }
  for (let i = 0; i < 4; i++) {
    const r = await seedRecipient(pool, link.id, `pe-c-opened-${i}-${Date.now()}@example.com`, { sentAgoHours: 50, viewedAgoHours: 24 });
    recipientIds.push(r.id);
  }
  for (let i = 0; i < 2; i++) {
    const r = await seedRecipient(pool, link.id, `pe-c-booked-${i}-${Date.now()}@example.com`, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 24 });
    recipientIds.push(r.id);
  }
  const rev = await seedRecipient(pool, link.id, `pe-c-rev-${Date.now()}@example.com`, { sentAgoHours: 50, revoked: true });
  recipientIds.push(rev.id);
  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/links?bookingLinkId=${link.id}`);
    if (r.status === 200) ok("GET /links → 200");
    else { bad("status", String(r.status)); return { link, recipientIds }; }
    const row = (r.body.rows || []).find((x) => x.bookingLinkId === link.id);
    if (!row) { bad("link row missing"); return { link, recipientIds }; }
    if (row.sent === 10) ok(`sent = 10 (revoked excluded)`); else bad("sent", String(row.sent));
    if (row.opened === 6) ok(`opened = 6`); else bad("opened", String(row.opened));
    if (row.booked === 2) ok(`booked = 2`); else bad("booked", String(row.booked));
    if (Math.abs(row.openRate    - 0.6) < 1e-6) ok("openRate = 0.6 (6/10)"); else bad("openRate", String(row.openRate));
    if (Math.abs(row.bookingRate - 0.2) < 1e-6) ok("bookingRate = 0.2 (2/10)"); else bad("bookingRate", String(row.bookingRate));
    return { link, recipientIds };
  } catch (e) { bad("threw", e.message); return { link, recipientIds }; }
}

async function testZeroSentEdge(pool, cookie, ownerId) {
  console.log("\n[2] Edge case — zero sent → rates = 0, not NaN");
  const link = await seedLink(pool, ownerId, "PhaseE link zero");
  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/links?bookingLinkId=${link.id}`);
    const row = (r.body.rows || []).find((x) => x.bookingLinkId === link.id);
    if (row?.sent === 0)        ok("sent = 0"); else bad("zero-sent count", String(row?.sent));
    if (row?.openRate === 0)    ok("openRate = 0 (not NaN)"); else bad("zero openRate", String(row?.openRate));
    if (row?.bookingRate === 0) ok("bookingRate = 0 (not NaN)"); else bad("zero bookingRate", String(row?.bookingRate));
    return { link, recipientIds: [] };
  } catch (e) { bad("threw", e.message); return { link, recipientIds: [] }; }
}

async function testPerOwnerAggregation(pool, cookie, trevorId) {
  console.log("\n[3] Per-owner — admin sees aggregate per owner");
  const linkA = await seedLink(pool, trevorId, "PhaseE owner-agg A");
  const linkB = await seedLink(pool, trevorId, "PhaseE owner-agg B");
  const recipientIds = [];
  for (let i = 0; i < 3; i++) {
    const r = await seedRecipient(pool, linkA.id, `pe-oa-${i}-${Date.now()}@example.com`, { sentAgoHours: 48, viewedAgoHours: 24, bookedAgoHours: 12 });
    recipientIds.push(r.id);
  }
  for (let i = 0; i < 2; i++) {
    const r = await seedRecipient(pool, linkB.id, `pe-ob-${i}-${Date.now()}@example.com`, { sentAgoHours: 48, viewedAgoHours: 24 });
    recipientIds.push(r.id);
  }
  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/owners?ownerUserId=${trevorId}`);
    if (r.status === 200) ok("GET /owners (admin) → 200"); else bad("status", String(r.status));
    const row = (r.body.rows || []).find((x) => x.ownerUserId === trevorId);
    if (row?.sent >= 5)   ok(`owner sent ≥ 5 (got ${row.sent})`); else bad("owner sent", String(row?.sent));
    if (row?.opened >= 5) ok(`owner opened ≥ 5 (got ${row.opened})`); else bad("owner opened", String(row?.opened));
    if (row?.booked >= 3) ok(`owner booked ≥ 3 (got ${row.booked})`); else bad("owner booked", String(row?.booked));
    return { linkIds: [linkA.id, linkB.id], recipientIds };
  } catch (e) { bad("threw", e.message); return { linkIds: [linkA.id, linkB.id], recipientIds }; }
}

async function testPerSegment(pool, cookie, ownerId) {
  console.log("\n[4] Per-segment — contact > lead > orphan classification");
  const link = await seedLink(pool, ownerId, "PhaseE segments");
  const contactEmail = `pe-seg-contact-${Date.now()}@example.com`;
  const leadEmail    = `pe-seg-lead-${Date.now()}@example.com`;
  const orphanEmail  = `pe-seg-orphan-${Date.now()}@example.com`;
  const c = await seedAccountAndContact(pool, contactEmail);
  const l = await seedLead(pool, ownerId, leadEmail);
  const recipientIds = [];
  recipientIds.push((await seedRecipient(pool, link.id, contactEmail, { sentAgoHours: 48, viewedAgoHours: 24, bookedAgoHours: 12 })).id);
  recipientIds.push((await seedRecipient(pool, link.id, leadEmail,    { sentAgoHours: 48, viewedAgoHours: 24 })).id);
  recipientIds.push((await seedRecipient(pool, link.id, orphanEmail,  { sentAgoHours: 48 })).id);
  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/segments?bookingLinkId=${link.id}`);
    if (r.status === 200) ok("GET /segments → 200"); else bad("status", String(r.status));
    const get = (s) => (r.body.rows || []).find((x) => x.segment === s);
    const C = get("contact"), L = get("lead"), O = get("orphan");
    if (C?.sent === 1 && C?.opened === 1 && C?.booked === 1) ok("contact: 1/1/1");
    else bad("contact counts", JSON.stringify(C));
    if (L?.sent === 1 && L?.opened === 1 && L?.booked === 0) ok("lead: 1/1/0");
    else bad("lead counts", JSON.stringify(L));
    if (O?.sent === 1 && O?.opened === 0 && O?.booked === 0) ok("orphan: 1/0/0");
    else bad("orphan counts", JSON.stringify(O));
    if (Math.abs(C?.bookingRate - 1.0) < 1e-6) ok("contact bookingRate = 100%");
    else bad("contact bookingRate", String(C?.bookingRate));
    return { link, recipientIds, contact: c, lead: l };
  } catch (e) { bad("threw", e.message); return { link, recipientIds, contact: c, lead: l }; }
}

async function testTiming(pool, cookie, ownerId) {
  console.log("\n[5] Time-to-convert — avg duration in seconds");
  const link = await seedLink(pool, ownerId, "PhaseE timing");
  // sent 10h ago, viewed 8h ago (sent→opened ≈ 2h = 7200s), booked 6h ago (opened→booked ≈ 2h, sent→booked ≈ 4h)
  const recipientIds = [];
  for (let i = 0; i < 3; i++) {
    recipientIds.push((await seedRecipient(pool, link.id, `pe-t-${i}-${Date.now()}@example.com`,
      { sentAgoHours: 10, viewedAgoHours: 8, bookedAgoHours: 6 })).id);
  }
  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/timing?bookingLinkId=${link.id}`);
    if (r.status === 200) ok("GET /timing → 200"); else bad("status", String(r.status));
    if (r.body.sentToOpenedSamples === 3)   ok("sent→opened samples = 3");   else bad("s2o samples", String(r.body.sentToOpenedSamples));
    if (r.body.openedToBookedSamples === 3) ok("opened→booked samples = 3"); else bad("o2b samples", String(r.body.openedToBookedSamples));
    if (r.body.sentToBookedSamples === 3)   ok("sent→booked samples = 3");   else bad("s2b samples", String(r.body.sentToBookedSamples));
    // Allow ±60s drift for clock skew during seeding
    if (Math.abs(r.body.sentToOpenedSec   - 7200)  < 60)  ok(`sent→opened ≈ 7200s (got ${Math.round(r.body.sentToOpenedSec)}s)`);
    else bad("sent→opened", String(r.body.sentToOpenedSec));
    if (Math.abs(r.body.openedToBookedSec - 7200)  < 60)  ok(`opened→booked ≈ 7200s (got ${Math.round(r.body.openedToBookedSec)}s)`);
    else bad("opened→booked", String(r.body.openedToBookedSec));
    if (Math.abs(r.body.sentToBookedSec   - 14400) < 60)  ok(`sent→booked ≈ 14400s (got ${Math.round(r.body.sentToBookedSec)}s)`);
    else bad("sent→booked", String(r.body.sentToBookedSec));
    return { link, recipientIds };
  } catch (e) { bad("threw", e.message); return { link, recipientIds }; }
}

async function testTimingEmpty(cookie) {
  console.log("\n[6] Timing — empty sample set returns null avg, 0 samples");
  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/timing?bookingLinkId=999999999`);
    if (r.status === 200)                          ok("GET /timing (empty) → 200"); else bad("status", String(r.status));
    if (r.body.sentToOpenedSec === null)           ok("sent→opened avg = null"); else bad("s2o avg", String(r.body.sentToOpenedSec));
    if (r.body.sentToOpenedSamples === 0)          ok("sent→opened samples = 0"); else bad("s2o samples", String(r.body.sentToOpenedSamples));
    if (r.body.openedToBookedSec === null)         ok("opened→booked avg = null"); else bad("o2b avg", String(r.body.openedToBookedSec));
    if (r.body.sentToBookedSec === null)           ok("sent→booked avg = null"); else bad("s2b avg", String(r.body.sentToBookedSec));
  } catch (e) { bad("threw", e.message); }
}

async function testLeaderboard(pool, cookie, ownerId) {
  console.log("\n[7] Leaderboard — ranking + min-sent floor + underperforming");
  // High performer: 10 sent, 5 booked → 50% booking rate
  const high = await seedLink(pool, ownerId, "PhaseE LB high");
  const recipientIds = [];
  for (let i = 0; i < 5; i++)
    recipientIds.push((await seedRecipient(pool, high.id, `pe-lh-${i}-${Date.now()}@example.com`,
      { sentAgoHours: 48, viewedAgoHours: 24, bookedAgoHours: 12 })).id);
  for (let i = 0; i < 5; i++)
    recipientIds.push((await seedRecipient(pool, high.id, `pe-lhs-${i}-${Date.now()}@example.com`,
      { sentAgoHours: 48 })).id);
  // Underperformer: 8 sent, 0 booked → 0%
  const low = await seedLink(pool, ownerId, "PhaseE LB low");
  for (let i = 0; i < 8; i++)
    recipientIds.push((await seedRecipient(pool, low.id, `pe-ll-${i}-${Date.now()}@example.com`,
      { sentAgoHours: 48 })).id);
  // Below min-sent: 1 sent, 1 booked → 100% but only 1 sample, must be excluded with minSent=3
  const tiny = await seedLink(pool, ownerId, "PhaseE LB tiny");
  recipientIds.push((await seedRecipient(pool, tiny.id, `pe-lt-${Date.now()}@example.com`,
    { sentAgoHours: 48, viewedAgoHours: 24, bookedAgoHours: 12 })).id);
  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/leaderboard?minSent=3`);
    if (r.status === 200) ok("GET /leaderboard → 200"); else bad("status", String(r.status));
    if (r.body.minSent === 3) ok("minSent echoed = 3"); else bad("minSent", String(r.body.minSent));
    const top = r.body.top || [];
    const tinyInTop = top.find((x) => x.bookingLinkId === tiny.id);
    if (!tinyInTop) ok("tiny link (1 sent) excluded by min-sent floor");
    else bad("tiny should be excluded");
    const highEntry = top.find((x) => x.bookingLinkId === high.id);
    if (highEntry) ok(`high link present (rank ${highEntry.rank})`);
    else bad("high missing from leaderboard");
    if (highEntry && Math.abs(highEntry.bookingRate - 0.5) < 1e-6) ok("high bookingRate = 0.5");
    else bad("high bookingRate", String(highEntry?.bookingRate));
    // Both eligible links present; high should rank above low
    const lowEntry = top.find((x) => x.bookingLinkId === low.id);
    if (highEntry && lowEntry && highEntry.rank < lowEntry.rank) ok("high ranked above low");
    else bad("ranking order", `${highEntry?.rank} vs ${lowEntry?.rank}`);

    const under = (r.body.underperforming || []).find((x) => x.bookingLinkId === low.id);
    if (under) ok("low link flagged as underperforming");
    else bad("low not flagged underperforming");
    if (under?.bookingRate === 0) ok("under bookingRate = 0");
    else bad("under bookingRate", String(under?.bookingRate));

    return { linkIds: [high.id, low.id, tiny.id], recipientIds };
  } catch (e) {
    bad("threw", e.message);
    return { linkIds: [high.id, low.id, tiny.id], recipientIds };
  }
}

async function testOwnerScoping(pool, cookie) {
  console.log("\n[8] Owner scoping — non-admin sees only own; ownerUserId override IGNORED");
  const trevorId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
  const other = await seedSecondaryUser(pool);
  const otherCookie = await loginAs(other.email, "phasee1234");
  if (!otherCookie) { bad("non-admin login failed"); return { otherUserId: other.id, linkIds: [], recipientIds: [] }; }
  ok("non-admin login OK");
  const trevorLink = await seedLink(pool, trevorId, "PhaseE scope-trevor");
  const otherLink  = await seedLink(pool, other.id,  "PhaseE scope-other");
  const recipientIds = [];
  recipientIds.push((await seedRecipient(pool, trevorLink.id, `pe-s-t-${Date.now()}@example.com`, { sentAgoHours: 48, bookedAgoHours: 6 })).id);
  recipientIds.push((await seedRecipient(pool, otherLink.id,  `pe-s-o-${Date.now()}@example.com`, { sentAgoHours: 48 })).id);
  try {
    // Non-admin tries to escalate to Trevor's data
    const r = await jget(otherCookie, `/api/crm/booking-analytics/links?ownerUserId=${trevorId}`);
    if (r.status === 200) ok("non-admin /links → 200");
    if (r.body.isAdmin === false) ok("isAdmin flag = false for non-admin");
    else bad("isAdmin flag", String(r.body.isAdmin));
    const rows = r.body.rows || [];
    const ownerIds = new Set(rows.map((x) => x.ownerUserId));
    if (!ownerIds.has(trevorId)) ok("Trevor's links NOT leaked despite ownerUserId override");
    else bad("non-admin saw admin's links");
    if (ownerIds.size === 0 || (ownerIds.size === 1 && ownerIds.has(other.id))) ok("non-admin sees only own owner_user_id");
    else bad("non-admin owner scope leak", JSON.stringify([...ownerIds]));

    // /owners must 403 for non-admin
    const o = await jget(otherCookie, `/api/crm/booking-analytics/owners`);
    if (o.status === 403) ok("non-admin /owners → 403");
    else bad("non-admin /owners status", String(o.status));

    return { otherUserId: other.id, linkIds: [trevorLink.id, otherLink.id], recipientIds };
  } catch (e) {
    bad("threw", e.message);
    return { otherUserId: other.id, linkIds: [trevorLink.id, otherLink.id], recipientIds };
  }
}

async function testValidation(cookie) {
  console.log("\n[9] Filter validation — bad inputs → 400");
  const a = await jget(cookie, `/api/crm/booking-analytics/links?ownerUserId=abc`);
  if (a.status === 400) ok("ownerUserId=abc → 400"); else bad("ownerUserId validation", String(a.status));
  const b = await jget(cookie, `/api/crm/booking-analytics/links?bookingLinkId=-1`);
  if (b.status === 400) ok("bookingLinkId=-1 → 400"); else bad("bookingLinkId validation", String(b.status));
  const c = await jget(cookie, `/api/crm/booking-analytics/links?dateFrom=not-a-date`);
  if (c.status === 400) ok("dateFrom=not-a-date → 400"); else bad("dateFrom validation", String(c.status));
}

async function testAuth() {
  console.log("\n[10] Auth gate — anonymous → 401 on every endpoint");
  for (const path of [
    "/api/crm/booking-analytics/links",
    "/api/crm/booking-analytics/owners",
    "/api/crm/booking-analytics/segments",
    "/api/crm/booking-analytics/timing",
    "/api/crm/booking-analytics/leaderboard",
  ]) {
    const r = await jget(null, path);
    if (r.status === 401) ok(`anon ${path} → 401`); else bad(`anon ${path}`, String(r.status));
  }
}

async function cleanupAll(pool, linkIds, recipientIds, contactIds, accountIds, leadIds, userIds) {
  for (const id of linkIds) {
    try {
      await pool.query("DELETE FROM booking_link_recipients WHERE booking_link_id=$1", [id]);
      await pool.query("DELETE FROM booking_links WHERE id=$1", [id]);
    } catch {}
  }
  for (const id of contactIds) { try { await pool.query("DELETE FROM contacts WHERE id=$1", [id]); } catch {} }
  for (const id of accountIds) { try { await pool.query("DELETE FROM accounts WHERE id=$1", [id]); } catch {} }
  for (const id of leadIds)    { try { await pool.query("DELETE FROM leads WHERE id=$1", [id]); } catch {} }
  for (const id of userIds)    { try { await pool.query("DELETE FROM users WHERE id=$1", [id]); } catch {} }
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const cookie = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
  if (!cookie) { console.error("Fatal: admin login failed"); process.exit(2); }
  const trevorId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;

  console.log("=== VoltSafe Cortex — Phase E: Booking Conversion Intelligence ===");

  const linkIds = [], recipientIds = [], contactIds = [], accountIds = [], leadIds = [], userIds = [];
  try {
    const r1 = await testPerLinkCounts(pool, cookie, trevorId);
    linkIds.push(r1.link.id); recipientIds.push(...r1.recipientIds);

    const r2 = await testZeroSentEdge(pool, cookie, trevorId);
    linkIds.push(r2.link.id);

    const r3 = await testPerOwnerAggregation(pool, cookie, trevorId);
    linkIds.push(...r3.linkIds); recipientIds.push(...r3.recipientIds);

    const r4 = await testPerSegment(pool, cookie, trevorId);
    linkIds.push(r4.link.id); recipientIds.push(...r4.recipientIds);
    contactIds.push(r4.contact.contactId); accountIds.push(r4.contact.accountId); leadIds.push(r4.lead.id);

    const r5 = await testTiming(pool, cookie, trevorId);
    linkIds.push(r5.link.id); recipientIds.push(...r5.recipientIds);

    await testTimingEmpty(cookie);

    const r7 = await testLeaderboard(pool, cookie, trevorId);
    linkIds.push(...r7.linkIds); recipientIds.push(...r7.recipientIds);

    const r8 = await testOwnerScoping(pool, cookie);
    linkIds.push(...r8.linkIds); recipientIds.push(...r8.recipientIds); userIds.push(r8.otherUserId);

    await testValidation(cookie);
    await testAuth();
  } finally {
    await cleanupAll(pool, linkIds, recipientIds, contactIds, accountIds, leadIds, userIds);
    await pool.end();
  }

  console.log(`\n${"\u2500".repeat(63)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"\u2500".repeat(63)}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(2); });
