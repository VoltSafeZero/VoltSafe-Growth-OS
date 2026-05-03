#!/usr/bin/env node
/**
 * Phase G — Booking Command Center
 *
 * Validates the orchestration through one endpoint:
 *   GET /api/crm/booking-analytics/command-center
 *
 * Coverage:
 *   1. Bucket population — each of the 6 buckets receives the correct seed
 *   2. HOT ranking — contact > lead > orphan, then most recent open
 *   3. BOOKED_NO_QUOTE suppression by post-booking quote and pending task
 *   4. REUSE_LINK threshold (sent ≥ 5, bookingRate ≥ 20%) and ranking
 *   5. REWRITE_LINK uses leaderboard underperforming (sent ≥ 5, rate < 10%)
 *   6. REVENUE_WINNER ranks by wonValue DESC; zero-won links excluded
 *   7. REVENUE_LEAK — booked + quote-after-booking + zero won; suppressed if any won
 *   8. No duplicate recipients across HOT (each recipientId once); no duplicate
 *      quotes inflating REVENUE_LEAK totals when quote sits on shared account
 *   9. Owner scoping — non-admin /command-center scoped to own; ownerUserId override IGNORED
 *  10. Admin filtering by ownerUserId
 *  11. Empty/null-safe response — counts all 0, buckets all [], totals all 0
 *  12. Validation: bad ownerUserId / bookingLinkId / dateFrom → 400
 *  13. Auth: anonymous → 401
 *
 * Run: node tests/booking-command-center.test.js
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

async function seedLink(pool, ownerId, name) {
  const slug = `pg-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [l] = (await pool.query(
    `INSERT INTO booking_links
       (owner_user_id, name, description, slug, slot_minutes, buffer_minutes,
        advance_days, min_notice_hours, time_zone, availability,
        location_type, require_recipient_match, active, created_at, updated_at)
     VALUES ($1, $2, '', $3, 30, 0, 14, 4, 'America/Los_Angeles', '[]'::jsonb, 'zoom', true, true, NOW(), NOW())
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
     VALUES ($1, LOWER($2), $3, ${sentExpr}, ${viewedExpr}, $4, ${bookedExpr}, ${revokedExpr},
             NOW() - INTERVAL '7 days')
     RETURNING id`, [linkId, email, token, viewCount])).rows;
  return row;
}

async function seedSecondaryUser(pool) {
  const email = `pg-other-${Date.now()}-${Math.floor(Math.random() * 1e6)}@voltsafe.test`;
  const hash  = await bcrypt.hash("phaseg1234", 12);
  const [u] = (await pool.query(
    `INSERT INTO users (email, name, password, role, global_role, must_change_password, permissions, created_at)
     VALUES ($1, 'Phase G Other', $2, 'user', 'sales', false, $3::jsonb, NOW())
     RETURNING id`, [email, hash, JSON.stringify({ crm: "edit" })])).rows;
  return { id: u.id, email };
}

async function seedAccountAndContact(pool, email) {
  const [a] = (await pool.query(
    `INSERT INTO accounts (name, segment, lead_status, priority, created_at, updated_at)
     VALUES ($1, 'marina', 'new', 'medium', NOW(), NOW()) RETURNING id`,
    [`PhaseG Acct ${Date.now()}-${Math.random()}`])).rows;
  const [c] = (await pool.query(
    `INSERT INTO contacts (account_id, name, email, created_at, updated_at)
     VALUES ($1, 'PhaseG Contact', LOWER($2), NOW(), NOW()) RETURNING id`,
    [a.id, email])).rows;
  return { accountId: a.id, contactId: c.id };
}

async function seedLead(pool, ownerId, email) {
  const [r] = (await pool.query(
    `INSERT INTO leads (company, contact_name, contact_email, status, owner_user_id, created_at, updated_at)
     VALUES ('PhaseG Marina', 'PhaseG Captain', LOWER($1), 'new', $2, NOW(), NOW()) RETURNING id`,
    [email, ownerId])).rows;
  return r;
}

async function seedQuote(pool, { contactId, accountId, total, status, createdAgoHours, accepted }) {
  const qNumber = `PG-Q-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const createdExpr  = `NOW() - INTERVAL '${createdAgoHours} hours'`;
  const acceptedExpr = accepted ? `NOW() - INTERVAL '${Math.max(0, createdAgoHours - 1)} hours'` : "NULL";
  const [q] = (await pool.query(
    `INSERT INTO quotes (quote_number, status, account_id, contact_id, subtotal, total, accepted_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5, ${acceptedExpr}, ${createdExpr}, NOW()) RETURNING id`,
    [qNumber, status, accountId, contactId, total])).rows;
  return q;
}

async function seedFollowupTask(pool, { ownerUserId, recipientId, status }) {
  const [t] = (await pool.query(
    `INSERT INTO tasks (title, owner_user_id, created_by_user_id, status, source, source_meta, created_at, updated_at)
     VALUES ('PG test task', $1, $1, $2, 'booking_followup', $3::jsonb, NOW(), NOW()) RETURNING id`,
    [ownerUserId, status, JSON.stringify({ recipientId, kind: "post_meeting_followup" })])).rows;
  return t;
}

// ─── Tests ──────────────────────────────────────────────────────────────
async function testBucketsAndRanking(pool, cookie, ownerId) {
  console.log("\n[1] Buckets — each gets the right seed; HOT ranking is contact > lead > orphan");
  const linkHot = await seedLink(pool, ownerId, "PhaseG hot");
  const ids = { links: [linkHot.id], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [], leadIds: [], taskIds: [] };

  // HOT seeds — 1 contact open 3d, 1 lead open 2d, 1 orphan open 4d
  const eHotContact = `pg-h-c-${Date.now()}@example.com`;
  const ccHotC = await seedAccountAndContact(pool, eHotContact); ids.contactIds.push(ccHotC.contactId); ids.accountIds.push(ccHotC.accountId);
  const recHotC = await seedRecipient(pool, linkHot.id, eHotContact, { sentAgoHours: 96, viewedAgoHours: 72 });
  ids.recipientIds.push(recHotC.id);

  const eHotLead = `pg-h-l-${Date.now()}@example.com`;
  const lH = await seedLead(pool, ownerId, eHotLead); ids.leadIds.push(lH.id);
  const recHotL = await seedRecipient(pool, linkHot.id, eHotLead, { sentAgoHours: 72, viewedAgoHours: 48 });
  ids.recipientIds.push(recHotL.id);

  const eHotOrphan = `pg-h-o-${Date.now()}@example.com`;
  const recHotO = await seedRecipient(pool, linkHot.id, eHotOrphan, { sentAgoHours: 120, viewedAgoHours: 96 });
  ids.recipientIds.push(recHotO.id);

  // BOOKED_NO_QUOTE seed — booked, no quote, no task
  const linkNQ = await seedLink(pool, ownerId, "PhaseG noquote"); ids.links.push(linkNQ.id);
  const eNQ = `pg-nq-${Date.now()}@example.com`;
  const ccNQ = await seedAccountAndContact(pool, eNQ); ids.contactIds.push(ccNQ.contactId); ids.accountIds.push(ccNQ.accountId);
  const recNQ = await seedRecipient(pool, linkNQ.id, eNQ, { sentAgoHours: 120, viewedAgoHours: 96, bookedAgoHours: 96 });
  ids.recipientIds.push(recNQ.id);

  // BOOKED suppression — booked + post-booking quote should NOT appear
  const eSup = `pg-sup-${Date.now()}@example.com`;
  const ccSup = await seedAccountAndContact(pool, eSup); ids.contactIds.push(ccSup.contactId); ids.accountIds.push(ccSup.accountId);
  const recSup = await seedRecipient(pool, linkNQ.id, eSup, { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 48 });
  ids.recipientIds.push(recSup.id);
  ids.quoteIds.push((await seedQuote(pool, { contactId: ccSup.contactId, accountId: ccSup.accountId, total: 100, status: "sent", createdAgoHours: 24, accepted: false })).id);

  // BOOKED suppression — booked + pending followup task should NOT appear
  const eTask = `pg-task-${Date.now()}@example.com`;
  const ccT = await seedAccountAndContact(pool, eTask); ids.contactIds.push(ccT.contactId); ids.accountIds.push(ccT.accountId);
  const recT = await seedRecipient(pool, linkNQ.id, eTask, { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 48 });
  ids.recipientIds.push(recT.id);
  ids.taskIds.push((await seedFollowupTask(pool, { ownerUserId: ownerId, recipientId: recT.id, status: "pending" })).id);

  // REUSE_LINK — sent 10, booked 3 (30%) → qualifies (sent ≥5, rate ≥20%)
  const linkReuse = await seedLink(pool, ownerId, "PhaseG reuse-A"); ids.links.push(linkReuse.id);
  for (let i = 0; i < 3; i++) ids.recipientIds.push((await seedRecipient(pool, linkReuse.id, `pg-ru-b-${i}-${Date.now()}@example.com`, { sentAgoHours: 96, viewedAgoHours: 48, bookedAgoHours: 24 })).id);
  for (let i = 0; i < 7; i++) ids.recipientIds.push((await seedRecipient(pool, linkReuse.id, `pg-ru-s-${i}-${Date.now()}@example.com`, { sentAgoHours: 96 })).id);

  // REWRITE_LINK — sent 12, booked 0 (0%) → qualifies (sent ≥5, rate <10%)
  const linkRewrite = await seedLink(pool, ownerId, "PhaseG rewrite-X"); ids.links.push(linkRewrite.id);
  for (let i = 0; i < 12; i++) ids.recipientIds.push((await seedRecipient(pool, linkRewrite.id, `pg-rw-${i}-${Date.now()}@example.com`, { sentAgoHours: 96 })).id);

  // REVENUE_WINNER — booked + accepted quote $7000 post-booking
  const linkWin = await seedLink(pool, ownerId, "PhaseG winner"); ids.links.push(linkWin.id);
  const eWin = `pg-win-${Date.now()}@example.com`;
  const ccW = await seedAccountAndContact(pool, eWin); ids.contactIds.push(ccW.contactId); ids.accountIds.push(ccW.accountId);
  const recWin = await seedRecipient(pool, linkWin.id, eWin, { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 48 });
  ids.recipientIds.push(recWin.id);
  ids.quoteIds.push((await seedQuote(pool, { contactId: ccW.contactId, accountId: ccW.accountId, total: 7000, status: "accepted", createdAgoHours: 24, accepted: true })).id);

  // REVENUE_LEAK — booked + quote $3000 post-booking, NOT accepted
  const linkLeak = await seedLink(pool, ownerId, "PhaseG leak"); ids.links.push(linkLeak.id);
  const eLeak = `pg-leak-${Date.now()}@example.com`;
  const ccL = await seedAccountAndContact(pool, eLeak); ids.contactIds.push(ccL.contactId); ids.accountIds.push(ccL.accountId);
  const recLeak = await seedRecipient(pool, linkLeak.id, eLeak, { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 48 });
  ids.recipientIds.push(recLeak.id);
  ids.quoteIds.push((await seedQuote(pool, { contactId: ccL.contactId, accountId: ccL.accountId, total: 3000, status: "sent", createdAgoHours: 24, accepted: false })).id);

  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/command-center`);
    if (r.status === 200) ok("GET /command-center → 200"); else { bad("status", String(r.status)); return ids; }
    const b = r.body.buckets;

    // HOT
    const hotIds = b.HOT_OPENED_NOT_BOOKED.map((c) => c.recipientId);
    if (hotIds.includes(recHotC.id)) ok("HOT contains contact recipient");
    if (hotIds.includes(recHotL.id)) ok("HOT contains lead recipient");
    if (hotIds.includes(recHotO.id)) ok("HOT contains orphan recipient");
    // Ranking: contact must come before lead, lead before orphan
    const idxC = hotIds.indexOf(recHotC.id);
    const idxL = hotIds.indexOf(recHotL.id);
    const idxO = hotIds.indexOf(recHotO.id);
    if (idxC >= 0 && idxL >= 0 && idxC < idxL) ok("HOT rank: contact before lead");
    else bad("HOT rank C<L", `C=${idxC} L=${idxL}`);
    if (idxL >= 0 && idxO >= 0 && idxL < idxO) ok("HOT rank: lead before orphan");
    else bad("HOT rank L<O", `L=${idxL} O=${idxO}`);
    // No duplicate recipients
    if (new Set(hotIds).size === hotIds.length) ok("HOT has no duplicate recipients");
    else bad("HOT duplicates");

    // BOOKED_NO_QUOTE
    const nqIds = b.BOOKED_NO_QUOTE.map((c) => c.recipientId);
    if (nqIds.includes(recNQ.id))   ok("BOOKED_NO_QUOTE contains booked + no quote + no task");
    else bad("noquote missing");
    if (!nqIds.includes(recSup.id)) ok("BOOKED_NO_QUOTE suppressed by post-booking quote");
    else bad("suppression by quote failed");
    if (!nqIds.includes(recT.id))   ok("BOOKED_NO_QUOTE suppressed by pending followup task");
    else bad("suppression by task failed");

    // REUSE_LINK
    const reuseIds = b.REUSE_LINK.map((c) => c.bookingLinkId);
    if (reuseIds.includes(linkReuse.id)) ok("REUSE_LINK contains link with sent=10 / 30% rate");
    else bad("reuse missing");
    const reuseEntry = b.REUSE_LINK.find((c) => c.bookingLinkId === linkReuse.id);
    if (reuseEntry?.bookedMeetings === 3 && Math.abs(reuseEntry.bookingRate - 0.3) < 1e-6) ok("REUSE_LINK reports booked=3, rate=0.3");
    else bad("reuse metrics", JSON.stringify(reuseEntry));

    // REWRITE_LINK
    const rewriteIds = b.REWRITE_LINK.map((c) => c.bookingLinkId);
    if (rewriteIds.includes(linkRewrite.id)) ok("REWRITE_LINK contains link sent=12 / 0%");
    else bad("rewrite missing");
    if (!rewriteIds.includes(linkReuse.id))  ok("REWRITE_LINK does NOT contain high-conv link");
    else bad("reuse leaked into rewrite");

    // REVENUE_WINNER
    const winIds = b.REVENUE_WINNER.map((c) => c.bookingLinkId);
    if (winIds.includes(linkWin.id)) ok("REVENUE_WINNER contains link with $7000 won");
    else bad("winner missing");
    const winEntry = b.REVENUE_WINNER.find((c) => c.bookingLinkId === linkWin.id);
    if (winEntry?.wonValue === 7000) ok("REVENUE_WINNER wonValue = $7000");
    else bad("winner wonValue", String(winEntry?.wonValue));
    if (!winIds.includes(linkLeak.id)) ok("REVENUE_WINNER excludes zero-won link");
    else bad("zero-won leaked into winners");

    // REVENUE_LEAK
    const leakIds = b.REVENUE_LEAK.map((c) => c.recipientId);
    if (leakIds.includes(recLeak.id)) ok("REVENUE_LEAK contains booked + unaccepted $3000 quote");
    else bad("leak missing");
    if (!leakIds.includes(recWin.id)) ok("REVENUE_LEAK excludes won-quote recipient");
    else bad("won leaked into leak");
    const leakEntry = b.REVENUE_LEAK.find((c) => c.recipientId === recLeak.id);
    if (leakEntry?.quotedValue === 3000) ok("REVENUE_LEAK quotedValue = $3000");
    else bad("leak quotedValue", String(leakEntry?.quotedValue));
    if (leakEntry?.wonValue === 0) ok("REVENUE_LEAK wonValue = 0");

    // Counts must match bucket lengths
    if (r.body.counts.HOT_OPENED_NOT_BOOKED === b.HOT_OPENED_NOT_BOOKED.length &&
        r.body.counts.BOOKED_NO_QUOTE === b.BOOKED_NO_QUOTE.length &&
        r.body.counts.REUSE_LINK === b.REUSE_LINK.length &&
        r.body.counts.REWRITE_LINK === b.REWRITE_LINK.length &&
        r.body.counts.REVENUE_WINNER === b.REVENUE_WINNER.length &&
        r.body.counts.REVENUE_LEAK === b.REVENUE_LEAK.length) ok("counts match bucket lengths");
    else bad("counts mismatch", JSON.stringify(r.body.counts));

    // Totals = sum of urgencies across all cards
    const all = [...b.HOT_OPENED_NOT_BOOKED, ...b.BOOKED_NO_QUOTE, ...b.REUSE_LINK, ...b.REWRITE_LINK, ...b.REVENUE_WINNER, ...b.REVENUE_LEAK];
    const high = all.filter((c) => c.urgency === "high").length;
    const med  = all.filter((c) => c.urgency === "medium").length;
    const low  = all.filter((c) => c.urgency === "low").length;
    if (r.body.totals.highUrgency === high && r.body.totals.mediumUrgency === med && r.body.totals.lowUrgency === low) ok("totals match urgency tallies");
    else bad("totals", JSON.stringify(r.body.totals) + " vs " + JSON.stringify({ high, med, low }));

    // Each card has required fields
    const allHaveKind = all.every((c) => c.kind && c.urgency && c.title && c.subtitle && c.recommendation);
    if (allHaveKind) ok("every card has kind/urgency/title/subtitle/recommendation");
    else bad("missing required fields on some cards");

    return ids;
  } catch (e) { bad("threw", e.message); return ids; }
}

async function testSharedAccountDedup(pool, cookie, ownerId) {
  console.log("\n[2] Shared account — single quote does NOT inflate REVENUE_LEAK across recipients");
  const link = await seedLink(pool, ownerId, "PhaseG dedup");
  const ids = { links: [link.id], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [], leadIds: [] };

  const e1 = `pg-d-1-${Date.now()}@example.com`, e2 = `pg-d-2-${Date.now()}@example.com`;
  const cc = await seedAccountAndContact(pool, e1); ids.contactIds.push(cc.contactId); ids.accountIds.push(cc.accountId);
  const [c2] = (await pool.query(
    `INSERT INTO contacts (account_id, name, email, created_at, updated_at) VALUES ($1, 'PG D2', LOWER($2), NOW(), NOW()) RETURNING id`,
    [cc.accountId, e2])).rows;
  ids.contactIds.push(c2.id);
  const r1 = await seedRecipient(pool, link.id, e1, { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 48 });
  const r2 = await seedRecipient(pool, link.id, e2, { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 36 });
  ids.recipientIds.push(r1.id, r2.id);
  ids.quoteIds.push((await seedQuote(pool, { contactId: null, accountId: cc.accountId, total: 4000, status: "sent", createdAgoHours: 12, accepted: false })).id);

  try {
    const r = await jget(cookie, `/api/crm/booking-analytics/command-center?bookingLinkId=${link.id}`);
    const leaks = r.body.buckets.REVENUE_LEAK;
    const recipientIds = leaks.map((c) => c.recipientId);
    if (new Set(recipientIds).size === recipientIds.length) ok("no duplicate recipients in REVENUE_LEAK");
    else bad("dup recipients", JSON.stringify(recipientIds));
    // Each recipient on shared account has its own card; quotedValue per card = $4000 (the shared quote)
    for (const rid of [r1.id, r2.id]) {
      const entry = leaks.find((c) => c.recipientId === rid);
      if (entry?.quotedValue === 4000) ok(`recipient ${rid} quotedValue = $4000`);
      else bad(`recipient ${rid} quotedValue`, String(entry?.quotedValue));
    }
    return ids;
  } catch (e) { bad("threw", e.message); return ids; }
}

async function testEmptySafety(cookie) {
  console.log("\n[3] Empty/null-safe — non-existent bookingLinkId");
  const r = await jget(cookie, `/api/crm/booking-analytics/command-center?bookingLinkId=999999999`);
  if (r.status === 200) ok("GET /command-center (empty) → 200"); else bad("status", String(r.status));
  const b = r.body.buckets;
  const allEmpty = Object.values(b).every((arr) => Array.isArray(arr) && arr.length === 0);
  if (allEmpty) ok("all 6 buckets = []"); else bad("buckets not empty", JSON.stringify(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.length]))));
  if (Object.values(r.body.counts).every((n) => n === 0)) ok("all counts = 0");
  if (r.body.totals.highUrgency === 0 && r.body.totals.mediumUrgency === 0 && r.body.totals.lowUrgency === 0) ok("all totals = 0");
}

async function testOwnerScoping(pool, cookie) {
  console.log("\n[4] Owner scoping — non-admin scoped to own; ownerUserId override IGNORED");
  const trevorId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
  const other = await seedSecondaryUser(pool);
  const otherCookie = await loginAs(other.email, "phaseg1234");
  if (!otherCookie) { bad("non-admin login failed"); return { otherUserId: other.id, links: [], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [] }; }
  ok("non-admin login OK");

  const tLink = await seedLink(pool, trevorId, "PhaseG scope-trevor");
  const oLink = await seedLink(pool, other.id, "PhaseG scope-other");
  const ids = { otherUserId: other.id, links: [tLink.id, oLink.id], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [], leadIds: [] };

  // Trevor: $99999 won
  const tEmail = `pg-st-${Date.now()}@example.com`;
  const tCC = await seedAccountAndContact(pool, tEmail); ids.contactIds.push(tCC.contactId); ids.accountIds.push(tCC.accountId);
  const tRec = await seedRecipient(pool, tLink.id, tEmail, { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 48 });
  ids.recipientIds.push(tRec.id);
  ids.quoteIds.push((await seedQuote(pool, { contactId: tCC.contactId, accountId: tCC.accountId, total: 99999, status: "accepted", createdAgoHours: 24, accepted: true })).id);

  // Other: opened-not-booked 3d ago, with contact
  const oEmail = `pg-so-${Date.now()}@example.com`;
  const oCC = await seedAccountAndContact(pool, oEmail); ids.contactIds.push(oCC.contactId); ids.accountIds.push(oCC.accountId);
  const oRec = await seedRecipient(pool, oLink.id, oEmail, { sentAgoHours: 96, viewedAgoHours: 72 });
  ids.recipientIds.push(oRec.id);

  try {
    const r = await jget(otherCookie, `/api/crm/booking-analytics/command-center?ownerUserId=${trevorId}`);
    if (r.status === 200) ok("non-admin /command-center → 200");
    if (r.body.isAdmin === false) ok("isAdmin = false");
    const b = r.body.buckets;
    // Other should see own opened-not-booked recipient
    if (b.HOT_OPENED_NOT_BOOKED.find((c) => c.recipientId === oRec.id)) ok("non-admin sees own HOT recipient");
    else bad("own HOT missing");
    // Other must NOT see Trevor's data anywhere
    const allRecipientIds = new Set(Object.values(b).flat().filter((c) => c.recipientId).map((c) => c.recipientId));
    const allLinkIds      = new Set(Object.values(b).flat().filter((c) => c.bookingLinkId).map((c) => c.bookingLinkId));
    if (!allRecipientIds.has(tRec.id)) ok("Trevor's recipient NOT leaked across any bucket");
    else bad("recipient leak");
    if (!allLinkIds.has(tLink.id))     ok("Trevor's link NOT leaked across any bucket");
    else bad("link leak");
    // Most importantly — $99999 must not appear
    const hasBigMoney = Object.values(b).flat().some((c) => (c.wonValue ?? 0) === 99999 || (c.quotedValue ?? 0) === 99999);
    if (!hasBigMoney) ok("Trevor's $99999 NOT leaked");
    else bad("money leak");
    return ids;
  } catch (e) { bad("threw", e.message); return ids; }
}

async function testAdminFiltering(pool, cookie) {
  console.log("\n[5] Admin filtering — ownerUserId narrows results to that owner");
  const trevorId = (await pool.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
  const other = await seedSecondaryUser(pool);
  const ids = { otherUserId: other.id, links: [], recipientIds: [], contactIds: [], accountIds: [], quoteIds: [], leadIds: [] };
  const oLink = await seedLink(pool, other.id, "PhaseG admin-filter-other");
  ids.links.push(oLink.id);
  for (let i = 0; i < 12; i++) ids.recipientIds.push((await seedRecipient(pool, oLink.id, `pg-af-${i}-${Date.now()}@example.com`, { sentAgoHours: 96 })).id);
  try {
    // Admin filters by other's ownerUserId — should see other's REWRITE_LINK
    const r = await jget(cookie, `/api/crm/booking-analytics/command-center?ownerUserId=${other.id}`);
    if (r.body.isAdmin === true) ok("isAdmin = true");
    if (r.body.buckets.REWRITE_LINK.find((c) => c.bookingLinkId === oLink.id)) ok("admin filter shows other owner's underperforming link");
    else bad("admin filter missed", JSON.stringify(r.body.buckets.REWRITE_LINK.map((c) => c.bookingLinkId)));
    return ids;
  } catch (e) { bad("threw", e.message); return ids; }
}

async function testValidation(cookie) {
  console.log("\n[6] Validation — bad inputs → 400");
  const a = await jget(cookie, `/api/crm/booking-analytics/command-center?ownerUserId=abc`);
  if (a.status === 400) ok("ownerUserId=abc → 400"); else bad("ownerUserId", String(a.status));
  const b = await jget(cookie, `/api/crm/booking-analytics/command-center?bookingLinkId=-1`);
  if (b.status === 400) ok("bookingLinkId=-1 → 400"); else bad("bookingLinkId", String(b.status));
  const c = await jget(cookie, `/api/crm/booking-analytics/command-center?dateFrom=not-a-date`);
  if (c.status === 400) ok("dateFrom=not-a-date → 400"); else bad("dateFrom", String(c.status));
}

async function testAuth() {
  console.log("\n[7] Auth — anonymous → 401");
  const r = await jget(null, `/api/crm/booking-analytics/command-center`);
  if (r.status === 401) ok("anon → 401"); else bad("anon status", String(r.status));
}

async function cleanupAll(pool, all) {
  const collect = (k) => all.flatMap((x) => x?.[k] ?? []);
  const taskIds = collect("taskIds"), quoteIds = collect("quoteIds");
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

  console.log("=== VoltSafe Cortex — Phase G: Booking Command Center ===");

  const all = [];
  try {
    all.push(await testBucketsAndRanking(pool, cookie, trevorId));
    all.push(await testSharedAccountDedup(pool, cookie, trevorId));
    await testEmptySafety(cookie);
    all.push(await testOwnerScoping(pool, cookie));
    all.push(await testAdminFiltering(pool, cookie));
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
