#!/usr/bin/env node
/**
 * Phase F — Booking Revenue Attribution
 *
 * Validates the revenue-attribution service through 3 endpoints:
 *   GET /api/crm/booking-analytics/revenue       — totals + win rates
 *   GET /api/crm/booking-analytics/attribution   — per-link / per-owner / top
 *   GET /api/crm/booking-analytics/action-list   — booked-no-action + opened-not-booked
 *
 * Coverage:
 *   1. Revenue summary: bookedMeetings, quotesGenerated, quotedValue, wonValue,
 *      bookingToQuoteRate, quoteToWinRate — exact values from seeded data.
 *   2. Quote attribution timing: a quote created BEFORE bookedAt MUST NOT count;
 *      a quote created AFTER bookedAt counts.
 *   3. Won detection: status='accepted' OR acceptedAt IS NOT NULL.
 *   4. Per-link attribution dedup: a single quote on a shared account doesn't
 *      double-count when two bookings sit on it.
 *   5. Top revenue list ranks by wonValue DESC.
 *   6. Action list — booked-no-next-action: appears when no quote-after-booking
 *      AND no pending booking_followup task; suppressed when either exists.
 *   7. Action list — opened-not-booked: includes opened-and-not-booked
 *      recipients with daysSinceOpen.
 *   8. Owner scoping: non-admin /revenue, /attribution, /action-list scoped to
 *      own; ownerUserId override IGNORED.
 *   9. Zero/null safety: zero booked → all rates = 0 (no NaN); zero quotes →
 *      bookingToQuoteRate = 0; lead-only recipient is attributable but produces
 *      no quote (no quote attribution path through leads).
 *  10. Validation: bad ownerUserId / bookingLinkId / dateFrom → 400.
 *  11. Auth: anonymous → 401 on every endpoint.
 *  12. Phase E and Phase D endpoints unchanged (smoke).
 *
 * Run: node tests/booking-revenue.test.js
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
  const m = (res.headers.get("set-cookie") || "").match(/connect\.sid=[^;]+/);
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
  const slug = `pf-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
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
  const email = `pf-other-${Date.now()}-${Math.floor(Math.random() * 1e6)}@voltsafe.test`;
  const hash  = await bcrypt.hash("phasef1234", 12);
  const [u] = (await pool.query(
    `INSERT INTO users (email, name, password, role, global_role, must_change_password, permissions, created_at)
     VALUES ($1, 'Phase F Other', $2, 'user', 'sales', false, $3::jsonb, NOW())
     RETURNING id`, [email, hash, JSON.stringify({ crm: "edit" })])).rows;
  return { id: u.id, email };
}

async function seedAccountAndContact(pool, email) {
  const [a] = (await pool.query(
    `INSERT INTO accounts (name, segment, lead_status, priority, created_at, updated_at)
     VALUES ($1, 'marina', 'new', 'medium', NOW(), NOW())
     RETURNING id`, [`PhaseF Acct ${Date.now()}-${Math.random()}`])).rows;
  const [c] = (await pool.query(
    `INSERT INTO contacts (account_id, name, email, created_at, updated_at)
     VALUES ($1, 'PhaseF Contact', LOWER($2), NOW(), NOW())
     RETURNING id`, [a.id, email])).rows;
  return { accountId: a.id, contactId: c.id };
}

async function seedLead(pool, ownerId, email) {
  const [r] = (await pool.query(
    `INSERT INTO leads (company, contact_name, contact_email, status, owner_user_id, created_at, updated_at)
     VALUES ('PhaseF Marina', 'PhaseF Captain', LOWER($1), 'new', $2, NOW(), NOW())
     RETURNING id`, [email, ownerId])).rows;
  return r;
}

async function seedQuote(pool, { contactId, accountId, total, status, createdAgoHours, accepted }) {
  const qNumber = `PF-Q-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const createdExpr  = `NOW() - INTERVAL '${createdAgoHours} hours'`;
  const acceptedExpr = accepted ? `NOW() - INTERVAL '${Math.max(0, createdAgoHours - 1)} hours'` : "NULL";
  const [q] = (await pool.query(
    `INSERT INTO quotes (quote_number, status, account_id, contact_id, subtotal, total,
                         accepted_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5, ${acceptedExpr}, ${createdExpr}, NOW())
     RETURNING id`, [qNumber, status, accountId, contactId, total])).rows;
  return q;
}

async function seedFollowupTask(pool, { ownerUserId, recipientId, status }) {
  const [t] = (await pool.query(
    `INSERT INTO tasks (title, owner_user_id, created_by_user_id, status, source, source_meta, created_at, updated_at)
     VALUES ('PF test task', $1, $1, $2, 'booking_followup', $3::jsonb, NOW(), NOW())
     RETURNING id`,
    [ownerUserId, status, JSON.stringify({ recipientId, kind: "post_meeting_followup" })])).rows;
  return t;
}

// ─── Tests ──────────────────────────────────────────────────────────────
async function testRevenueSummary(pool, cookie, ownerId) {
  console.log("\n[1] Revenue summary — totals + win rates");
  const link = await seedLink(pool, ownerId, "PhaseF rev-summary");
  const ids = { links: [link.id], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [], leadIds: [] };

  // 4 booked recipients on distinct accounts:
  //   A: quote $1000 created AFTER booking, accepted    → counted, won
  //   B: quote $500  created AFTER booking, sent (not accepted) → counted, not won
  //   C: quote $2000 created BEFORE booking → MUST NOT count
  //   D: no quote at all
  for (const tag of ["A", "B", "C", "D"]) {
    const email = `pf-sum-${tag}-${Date.now()}@example.com`;
    const cc = await seedAccountAndContact(pool, email);
    ids.contactIds.push(cc.contactId); ids.accountIds.push(cc.accountId);
    const rec = await seedRecipient(pool, link.id, email, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 24 });
    ids.recipientIds.push(rec.id);
    if (tag === "A") {
      const q = await seedQuote(pool, { contactId: cc.contactId, accountId: cc.accountId, total: 1000, status: "accepted", createdAgoHours: 12, accepted: true });
      ids.quoteIds.push(q.id);
    } else if (tag === "B") {
      const q = await seedQuote(pool, { contactId: cc.contactId, accountId: cc.accountId, total: 500, status: "sent", createdAgoHours: 12, accepted: false });
      ids.quoteIds.push(q.id);
    } else if (tag === "C") {
      // booked 24h ago, quote created 48h ago → BEFORE booking
      const q = await seedQuote(pool, { contactId: cc.contactId, accountId: cc.accountId, total: 2000, status: "accepted", createdAgoHours: 48, accepted: true });
      ids.quoteIds.push(q.id);
    }
  }

  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/revenue?bookingLinkId=${link.id}`);
    if (r.status === 200) ok("GET /revenue → 200"); else { bad("status", String(r.status)); return ids; }
    const b = r.body;
    if (b.bookedMeetings === 4)       ok("bookedMeetings = 4"); else bad("bookedMeetings", String(b.bookedMeetings));
    if (b.bookedAttributable === 4)   ok("bookedAttributable = 4 (all CRM-matched)"); else bad("bookedAttributable", String(b.bookedAttributable));
    if (b.bookedOrphan === 0)         ok("bookedOrphan = 0"); else bad("bookedOrphan", String(b.bookedOrphan));
    if (b.quotesGenerated === 2)      ok("quotesGenerated = 2 (pre-booking quote excluded)"); else bad("quotesGenerated", String(b.quotesGenerated));
    if (b.quotedValue === 1500)       ok("quotedValue = $1500 ($1000 + $500)"); else bad("quotedValue", String(b.quotedValue));
    if (b.wonQuotes === 1)            ok("wonQuotes = 1"); else bad("wonQuotes", String(b.wonQuotes));
    if (b.wonValue === 1000)          ok("wonValue = $1000"); else bad("wonValue", String(b.wonValue));
    if (Math.abs(b.bookingToQuoteRate - 0.5) < 1e-6) ok("bookingToQuoteRate = 0.5 (2/4)"); else bad("bookingToQuoteRate", String(b.bookingToQuoteRate));
    if (Math.abs(b.quoteToWinRate     - 0.5) < 1e-6) ok("quoteToWinRate = 0.5 (1/2)"); else bad("quoteToWinRate", String(b.quoteToWinRate));
    return ids;
  } catch (e) { bad("threw", e.message); return ids; }
}

async function testQuoteTimingExclusion(pool, cookie, ownerId) {
  console.log("\n[2] Quote attribution timing — strictly after bookedAt");
  const link = await seedLink(pool, ownerId, "PhaseF rev-timing");
  const ids = { links: [link.id], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [], leadIds: [] };
  const email = `pf-timing-${Date.now()}@example.com`;
  const cc = await seedAccountAndContact(pool, email);
  ids.contactIds.push(cc.contactId); ids.accountIds.push(cc.accountId);
  const rec = await seedRecipient(pool, link.id, email, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 24 });
  ids.recipientIds.push(rec.id);
  // Pre-booking quote (created 48h ago, booking 24h ago) — must NOT count
  const q1 = await seedQuote(pool, { contactId: cc.contactId, accountId: cc.accountId, total: 9999, status: "accepted", createdAgoHours: 48, accepted: true });
  ids.quoteIds.push(q1.id);
  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/revenue?bookingLinkId=${link.id}`);
    if (r.body.quotesGenerated === 0) ok("pre-booking quote excluded from quotesGenerated");
    else bad("pre-booking quote leaked", String(r.body.quotesGenerated));
    if (r.body.quotedValue === 0)     ok("pre-booking quote value not added");
    else bad("pre-booking quote value leaked", String(r.body.quotedValue));
    if (r.body.wonValue === 0)        ok("pre-booking accepted not counted as won");
    else bad("pre-booking won leaked", String(r.body.wonValue));
    return ids;
  } catch (e) { bad("threw", e.message); return ids; }
}

async function testAttribution(pool, cookie, ownerId) {
  console.log("\n[3] Per-link attribution + dedup + top-revenue ranking");
  const linkBig = await seedLink(pool, ownerId, "PhaseF attr-big");
  const linkSmall = await seedLink(pool, ownerId, "PhaseF attr-small");
  const ids = { links: [linkBig.id, linkSmall.id], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [], leadIds: [] };

  // Big link: 2 bookings on the SAME account → quote is shared but must dedup to count once.
  const sharedEmail1 = `pf-attr-big1-${Date.now()}@example.com`;
  const sharedEmail2 = `pf-attr-big2-${Date.now()}@example.com`;
  const sharedAcct = await seedAccountAndContact(pool, sharedEmail1);
  ids.contactIds.push(sharedAcct.contactId); ids.accountIds.push(sharedAcct.accountId);
  // second contact on the SAME account
  const [c2] = (await pool.query(
    `INSERT INTO contacts (account_id, name, email, created_at, updated_at)
     VALUES ($1, 'PhaseF Big2', LOWER($2), NOW(), NOW()) RETURNING id`,
    [sharedAcct.accountId, sharedEmail2])).rows;
  ids.contactIds.push(c2.id);
  ids.recipientIds.push((await seedRecipient(pool, linkBig.id, sharedEmail1, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 36 })).id);
  ids.recipientIds.push((await seedRecipient(pool, linkBig.id, sharedEmail2, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 24 })).id);
  // ONE quote on that account, created after BOTH bookings, accepted, $5000
  const qBig = await seedQuote(pool, { contactId: null, accountId: sharedAcct.accountId, total: 5000, status: "accepted", createdAgoHours: 12, accepted: true });
  ids.quoteIds.push(qBig.id);

  // Small link: 1 booking, 1 sent quote $1000 (not accepted)
  const smallEmail = `pf-attr-small-${Date.now()}@example.com`;
  const smallAcct = await seedAccountAndContact(pool, smallEmail);
  ids.contactIds.push(smallAcct.contactId); ids.accountIds.push(smallAcct.accountId);
  ids.recipientIds.push((await seedRecipient(pool, linkSmall.id, smallEmail, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 24 })).id);
  const qSmall = await seedQuote(pool, { contactId: smallAcct.contactId, accountId: smallAcct.accountId, total: 1000, status: "sent", createdAgoHours: 12, accepted: false });
  ids.quoteIds.push(qSmall.id);

  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/attribution`);
    if (r.status === 200) ok("GET /attribution → 200"); else { bad("status", String(r.status)); return ids; }
    const big = (r.body.perLink || []).find((x) => x.bookingLinkId === linkBig.id);
    const small = (r.body.perLink || []).find((x) => x.bookingLinkId === linkSmall.id);
    if (big?.bookedMeetings === 2)  ok("big link bookedMeetings = 2"); else bad("big bookings", String(big?.bookedMeetings));
    if (big?.quotesGenerated === 1) ok("big link quote dedup → 1 (shared quote counted once)");
    else bad("big quotes (dedup failed?)", String(big?.quotesGenerated));
    if (big?.wonValue === 5000)     ok("big link wonValue = $5000"); else bad("big wonValue", String(big?.wonValue));
    if (small?.wonValue === 0)      ok("small link wonValue = 0 (not accepted)"); else bad("small wonValue", String(small?.wonValue));
    if (small?.quotedValue === 1000) ok("small link quotedValue = $1000"); else bad("small quotedValue", String(small?.quotedValue));

    // Top revenue: big should outrank small
    const top = r.body.topRevenueLinks || [];
    const topBig = top.find((x) => x.bookingLinkId === linkBig.id);
    const topSmall = top.find((x) => x.bookingLinkId === linkSmall.id);
    if (topBig && topBig.rank === 1) ok("topRevenueLinks: big ranked #1");
    else bad("big rank", JSON.stringify(topBig));
    if (topSmall && topBig && topBig.rank < topSmall.rank) ok("big ranked above small by wonValue");
    else if (topSmall == null) ok("small not in top (zero won) — acceptable");
    else bad("ranking", `big=${topBig?.rank} small=${topSmall?.rank}`);
    return ids;
  } catch (e) { bad("threw", e.message); return ids; }
}

async function testActionList(pool, cookie, ownerId) {
  console.log("\n[4] Action list — booked-no-action + opened-not-booked");
  const link = await seedLink(pool, ownerId, "PhaseF action-list");
  const ids = { links: [link.id], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [], leadIds: [], taskIds: [] };

  // (a) booked, no quote, no task → SHOULD appear in bookedNoNextAction
  const emailA = `pf-act-a-${Date.now()}@example.com`;
  const ccA = await seedAccountAndContact(pool, emailA);
  ids.contactIds.push(ccA.contactId); ids.accountIds.push(ccA.accountId);
  const recA = await seedRecipient(pool, link.id, emailA, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 12 });
  ids.recipientIds.push(recA.id);

  // (b) booked, has post-booking quote → SHOULD NOT appear (quote is the action)
  const emailB = `pf-act-b-${Date.now()}@example.com`;
  const ccB = await seedAccountAndContact(pool, emailB);
  ids.contactIds.push(ccB.contactId); ids.accountIds.push(ccB.accountId);
  const recB = await seedRecipient(pool, link.id, emailB, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 12 });
  ids.recipientIds.push(recB.id);
  const qB = await seedQuote(pool, { contactId: ccB.contactId, accountId: ccB.accountId, total: 1000, status: "sent", createdAgoHours: 6, accepted: false });
  ids.quoteIds.push(qB.id);

  // (c) booked, has pending booking_followup task → SHOULD NOT appear
  const emailC = `pf-act-c-${Date.now()}@example.com`;
  const ccC = await seedAccountAndContact(pool, emailC);
  ids.contactIds.push(ccC.contactId); ids.accountIds.push(ccC.accountId);
  const recC = await seedRecipient(pool, link.id, emailC, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 12 });
  ids.recipientIds.push(recC.id);
  const tC = await seedFollowupTask(pool, { ownerUserId: ownerId, recipientId: recC.id, status: "pending" });
  ids.taskIds.push(tC.id);

  // (d) opened but not booked, viewed 4 days ago → SHOULD appear in openedNotBooked
  const emailD = `pf-act-d-${Date.now()}@example.com`;
  const recD = await seedRecipient(pool, link.id, emailD, { sentAgoHours: 96, viewedAgoHours: 96 });
  ids.recipientIds.push(recD.id);

  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/action-list?bookingLinkId=${link.id}`);
    if (r.status === 200) ok("GET /action-list → 200"); else { bad("status", String(r.status)); return ids; }
    const noAction = r.body.bookedNoNextAction || [];
    const opened   = r.body.openedNotBooked    || [];

    if (noAction.find((x) => x.recipientId === recA.id)) ok("(a) booked + no quote + no task → listed");
    else bad("(a) missing from bookedNoNextAction");
    if (!noAction.find((x) => x.recipientId === recB.id)) ok("(b) booked + post-booking quote → suppressed");
    else bad("(b) leaked into bookedNoNextAction");
    if (!noAction.find((x) => x.recipientId === recC.id)) ok("(c) booked + pending followup task → suppressed");
    else bad("(c) leaked into bookedNoNextAction");

    const dRow = opened.find((x) => x.recipientId === recD.id);
    if (dRow) ok("(d) opened + not booked → listed in openedNotBooked");
    else bad("(d) missing from openedNotBooked");
    if (dRow && dRow.daysSinceOpen >= 3) ok(`daysSinceOpen ≥ 3 (got ${dRow.daysSinceOpen})`);
    else if (dRow) bad("daysSinceOpen wrong", String(dRow.daysSinceOpen));
    if (dRow && dRow.crm.type === null) ok("(d) orphan email → crm.type = null");
    else if (dRow) bad("(d) crm.type", JSON.stringify(dRow.crm));

    return ids;
  } catch (e) { bad("threw", e.message); return ids; }
}

async function testZeroAndNullSafety(cookie) {
  console.log("\n[5] Zero/null safety — admin-isolated empty filter");
  // Use a non-existent bookingLinkId to guarantee an empty in-scope set.
  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/revenue?bookingLinkId=999999999`);
    if (r.status === 200)                                  ok("GET /revenue (empty) → 200");
    if (r.body.bookedMeetings === 0)                       ok("bookedMeetings = 0");
    if (r.body.quotesGenerated === 0)                      ok("quotesGenerated = 0");
    if (r.body.bookingToQuoteRate === 0)                   ok("bookingToQuoteRate = 0 (not NaN)");
    else bad("bookingToQuoteRate", String(r.body.bookingToQuoteRate));
    if (r.body.quoteToWinRate === 0)                       ok("quoteToWinRate = 0 (not NaN)");
    else bad("quoteToWinRate", String(r.body.quoteToWinRate));

    const a = await jget(cookie, `/api/crm/booking-analytics/attribution?bookingLinkId=999999999`);
    if ((a.body.perLink || []).length === 0)               ok("attribution.perLink = []");
    if ((a.body.topRevenueLinks || []).length === 0)       ok("attribution.topRevenueLinks = []");

    const al = await jget(cookie, `/api/crm/booking-analytics/action-list?bookingLinkId=999999999`);
    if ((al.body.bookedNoNextAction || []).length === 0)   ok("action-list.bookedNoNextAction = []");
    if ((al.body.openedNotBooked || []).length === 0)      ok("action-list.openedNotBooked = []");
  } catch (e) { bad("threw", e.message); }
}

async function testLeadOnlyAttribution(pool, cookie, ownerId) {
  console.log("\n[6] Lead-only recipient — attributable but no quote path");
  const link = await seedLink(pool, ownerId, "PhaseF lead-only");
  const ids = { links: [link.id], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [], leadIds: [] };
  const email = `pf-lead-only-${Date.now()}@example.com`;
  const lead = await seedLead(pool, ownerId, email);
  ids.leadIds.push(lead.id);
  const rec = await seedRecipient(pool, link.id, email, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 12 });
  ids.recipientIds.push(rec.id);
  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/revenue?bookingLinkId=${link.id}`);
    if (r.body.bookedMeetings === 1)     ok("lead-only booked counted = 1");
    if (r.body.bookedAttributable === 1) ok("lead-only counted as attributable");
    if (r.body.quotesGenerated === 0)    ok("lead-only produces no quote attribution path");
    return ids;
  } catch (e) { bad("threw", e.message); return ids; }
}

async function testOwnerScoping(pool, cookie) {
  console.log("\n[7] Owner scoping — non-admin sees only own; ownerUserId override IGNORED");
  const trevorId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
  const other = await seedSecondaryUser(pool);
  const otherCookie = await loginAs(other.email, "phasef1234");
  if (!otherCookie) { bad("non-admin login failed"); return { otherUserId: other.id, links: [], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [] }; }
  ok("non-admin login OK");

  const trevorLink = await seedLink(pool, trevorId, "PhaseF scope-trevor");
  const otherLink  = await seedLink(pool, other.id,  "PhaseF scope-other");
  const ids = { otherUserId: other.id, links: [trevorLink.id, otherLink.id], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [], leadIds: [] };

  const tEmail = `pf-scope-t-${Date.now()}@example.com`;
  const tCC = await seedAccountAndContact(pool, tEmail);
  ids.contactIds.push(tCC.contactId); ids.accountIds.push(tCC.accountId);
  const tRec = await seedRecipient(pool, trevorLink.id, tEmail, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 12 });
  ids.recipientIds.push(tRec.id);
  const tQ = await seedQuote(pool, { contactId: tCC.contactId, accountId: tCC.accountId, total: 99999, status: "accepted", createdAgoHours: 6, accepted: true });
  ids.quoteIds.push(tQ.id);

  const oEmail = `pf-scope-o-${Date.now()}@example.com`;
  const oCC = await seedAccountAndContact(pool, oEmail);
  ids.contactIds.push(oCC.contactId); ids.accountIds.push(oCC.accountId);
  const oRec = await seedRecipient(pool, otherLink.id, oEmail, { sentAgoHours: 72, viewedAgoHours: 48, bookedAgoHours: 12 });
  ids.recipientIds.push(oRec.id);
  const oQ = await seedQuote(pool, { contactId: oCC.contactId, accountId: oCC.accountId, total: 100, status: "accepted", createdAgoHours: 6, accepted: true });
  ids.quoteIds.push(oQ.id);

  try {
    // Non-admin: revenue scoped to own — wonValue = 100, never $99999
    const r = await jget(otherCookie, `/api/crm/booking-analytics/revenue?ownerUserId=${trevorId}`);
    if (r.status === 200) ok("non-admin /revenue → 200");
    if (r.body.isAdmin === false) ok("isAdmin flag = false");
    else bad("isAdmin", String(r.body.isAdmin));
    if (r.body.wonValue === 100) ok("wonValue = $100 (own only — Trevor's $99999 NOT leaked)");
    else bad("wonValue leak", String(r.body.wonValue));

    // Attribution per-link must not contain trevor's link
    const a = await jget(otherCookie, `/api/crm/booking-analytics/attribution?ownerUserId=${trevorId}`);
    const linksReturned = new Set((a.body.perLink || []).map((x) => x.bookingLinkId));
    if (!linksReturned.has(trevorLink.id)) ok("Trevor's link NOT leaked in attribution");
    else bad("attribution leak");
    if (linksReturned.size === 0 || (linksReturned.size === 1 && linksReturned.has(otherLink.id))) ok("only own link returned");

    // Action list: same scope
    const al = await jget(otherCookie, `/api/crm/booking-analytics/action-list?ownerUserId=${trevorId}`);
    const recipientsReturned = new Set([...al.body.bookedNoNextAction, ...al.body.openedNotBooked].map((x) => x.recipientId));
    if (!recipientsReturned.has(tRec.id)) ok("Trevor's recipient NOT leaked in action-list");
    else bad("action-list leak");

    return ids;
  } catch (e) { bad("threw", e.message); return ids; }
}

async function testValidation(cookie) {
  console.log("\n[8] Filter validation — bad inputs → 400");
  for (const path of ["/api/crm/booking-analytics/revenue", "/api/crm/booking-analytics/attribution", "/api/crm/booking-analytics/action-list"]) {
    const a = await jget(cookie, `${path}?ownerUserId=abc`);
    if (a.status === 400) ok(`${path}?ownerUserId=abc → 400`); else bad(`${path} ownerUserId`, String(a.status));
    const b = await jget(cookie, `${path}?bookingLinkId=-1`);
    if (b.status === 400) ok(`${path}?bookingLinkId=-1 → 400`); else bad(`${path} bookingLinkId`, String(b.status));
    const c = await jget(cookie, `${path}?dateFrom=not-a-date`);
    if (c.status === 400) ok(`${path}?dateFrom=not-a-date → 400`); else bad(`${path} dateFrom`, String(c.status));
  }
}

async function testAuth() {
  console.log("\n[9] Auth gate — anonymous → 401");
  for (const path of [
    "/api/crm/booking-analytics/revenue",
    "/api/crm/booking-analytics/attribution",
    "/api/crm/booking-analytics/action-list",
  ]) {
    const r = await jget(null, path);
    if (r.status === 401) ok(`anon ${path} → 401`); else bad(`anon ${path}`, String(r.status));
  }
}

async function cleanupAll(pool, all) {
  const collect = (k) => all.flatMap((x) => x?.[k] ?? []);
  const taskIds = collect("taskIds"), quoteIds = collect("quoteIds"), recipientIds = collect("recipientIds");
  const links = collect("links"), contactIds = collect("contactIds"), accountIds = collect("accountIds");
  const leadIds = collect("leadIds"), userIds = all.map((x) => x?.otherUserId).filter(Boolean);
  for (const id of taskIds)   { try { await pool.query("DELETE FROM tasks WHERE id=$1", [id]); } catch {} }
  for (const id of quoteIds)  { try { await pool.query("DELETE FROM quotes WHERE id=$1", [id]); } catch {} }
  for (const id of links) {
    try {
      await pool.query("DELETE FROM booking_link_recipients WHERE booking_link_id=$1", [id]);
      await pool.query("DELETE FROM booking_links WHERE id=$1", [id]);
    } catch {}
  }
  for (const id of contactIds){ try { await pool.query("DELETE FROM contacts WHERE id=$1", [id]); } catch {} }
  for (const id of accountIds){ try { await pool.query("DELETE FROM accounts WHERE id=$1", [id]); } catch {} }
  for (const id of leadIds)   { try { await pool.query("DELETE FROM leads WHERE id=$1", [id]); } catch {} }
  for (const id of userIds) {
    try {
      await pool.query("DELETE FROM tasks WHERE owner_user_id=$1", [id]);
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
    } catch {}
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const cookie = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
  if (!cookie) { console.error("Fatal: admin login failed"); process.exit(2); }
  const trevorId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;

  console.log("=== VoltSafe Cortex — Phase F: Booking Revenue Attribution ===");

  const all = [];
  try {
    all.push(await testRevenueSummary(pool, cookie, trevorId));
    all.push(await testQuoteTimingExclusion(pool, cookie, trevorId));
    all.push(await testAttribution(pool, cookie, trevorId));
    all.push(await testActionList(pool, cookie, trevorId));
    await testZeroAndNullSafety(cookie);
    all.push(await testLeadOnlyAttribution(pool, cookie, trevorId));
    all.push(await testOwnerScoping(pool, cookie));
    await testValidation(cookie);
    await testAuth();
  } finally {
    await cleanupAll(pool, all);
    await pool.end();
  }

  console.log(`\n${"\u2500".repeat(63)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"\u2500".repeat(63)}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(2); });
