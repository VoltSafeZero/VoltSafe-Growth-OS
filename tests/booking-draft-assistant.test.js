#!/usr/bin/env node
/**
 * Phase I — Booking Follow-Up Draft Assistant
 *
 *   POST /api/crm/booking-analytics/actions/generate-followup-draft
 *
 * Coverage:
 *   1. Each supported kind generates correct draft shape
 *   2. Tone variants (short / warm / direct) produce different bodies
 *   3. CRM context interpolation — first name + account name appear when present
 *   4. Anti-hallucination — body never contains literal $ pricing or fabricated dates
 *   5. No-send guarantee — meta.sentEmail === false; no rows written to messages
 *   6. Owner scoping — non-admin → 403 cross-owner; admin → 200; non-admin own → 200
 *   7. Anonymous → 401
 *   8. Validation — bad/missing kind, bad recipientId, bad tone, mismatched
 *      bookingLinkId, non-existent recipient → 400/404
 *   9. Frontend smoke — Draft button + Dialog render in source
 *
 * Run: node tests/booking-draft-assistant.test.js
 */

import pg from "pg";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";

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
    body: JSON.stringify({ email, password }), redirect: "manual",
  });
  const m = (res.headers.get("set-cookie") || "").match(/connect\.sid=[^;]+/);
  return m ? m[0] : null;
}
async function jpost(cookie, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: BASE, Referer: `${BASE}/`,
    },
    body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
  });
  let resBody = null; try { resBody = await r.json(); } catch {}
  return { status: r.status, body: resBody };
}

// ─── Seed helpers ───────────────────────────────────────────────────────────
async function seedLink(pool, ownerId, name) {
  const slug = `pi-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [l] = (await pool.query(
    `INSERT INTO booking_links
       (owner_user_id, name, description, slug, slot_minutes, buffer_minutes,
        advance_days, min_notice_hours, time_zone, availability,
        location_type, require_recipient_match, active, created_at, updated_at)
     VALUES ($1, $2, '', $3, 30, 0, 14, 4, 'America/Los_Angeles', '[]'::jsonb,
             'zoom', true, true, NOW(), NOW())
     RETURNING id, name`, [ownerId, name, slug])).rows;
  return l;
}
async function seedRecipient(pool, linkId, email, opts = {}) {
  const token = `tok-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const sentExpr   = opts.sentAgoHours   != null ? `NOW() - INTERVAL '${opts.sentAgoHours} hours'`   : "NULL";
  const viewedExpr = opts.viewedAgoHours != null ? `NOW() - INTERVAL '${opts.viewedAgoHours} hours'` : "NULL";
  const bookedExpr = opts.bookedAgoHours != null ? `NOW() - INTERVAL '${opts.bookedAgoHours} hours'` : "NULL";
  const viewCount  = opts.viewedAgoHours != null ? 1 : 0;
  const [row] = (await pool.query(
    `INSERT INTO booking_link_recipients
       (booking_link_id, recipient_email, token, sent_at, first_viewed_at,
        view_count, booked_at, created_at)
     VALUES ($1, LOWER($2), $3, ${sentExpr}, ${viewedExpr}, $4, ${bookedExpr},
             NOW() - INTERVAL '7 days')
     RETURNING id`, [linkId, email, token, viewCount])).rows;
  return row;
}
async function seedSecondaryUser(pool) {
  const email = `pi-other-${Date.now()}-${Math.floor(Math.random() * 1e6)}@voltsafe.test`;
  const hash  = await bcrypt.hash("phasei1234", 12);
  const [u] = (await pool.query(
    `INSERT INTO users (email, name, password, role, global_role, must_change_password, permissions, created_at)
     VALUES ($1, 'Phase I Other', $2, 'user', 'sales', false, $3::jsonb, NOW())
     RETURNING id`, [email, hash, JSON.stringify({ crm: "edit" })])).rows;
  return { id: u.id, email };
}
async function seedAccountAndContact(pool, email, name) {
  const [a] = (await pool.query(
    `INSERT INTO accounts (name, segment, lead_status, priority, created_at, updated_at)
     VALUES ($1, 'marina', 'new', 'medium', NOW(), NOW()) RETURNING id, name`,
    [`Acme Marina ${Date.now()}-${Math.random()}`])).rows;
  const [c] = (await pool.query(
    `INSERT INTO contacts (account_id, name, email, created_at, updated_at)
     VALUES ($1, $2, LOWER($3), NOW(), NOW()) RETURNING id`,
    [a.id, name, email])).rows;
  return { accountId: a.id, accountName: a.name, contactId: c.id };
}
async function seedQuote(pool, contactId, accountId, total) {
  const qNumber = `PI-Q-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [q] = (await pool.query(
    `INSERT INTO quotes (quote_number, status, total, contact_id, account_id, created_at, updated_at)
     VALUES ($1, 'sent', $2, $3, $4, NOW() - INTERVAL '24 hours', NOW() - INTERVAL '24 hours')
     RETURNING id`, [qNumber, total, contactId, accountId])).rows;
  return q;
}
async function getAdminId(pool) {
  const r = await pool.query(`SELECT id FROM users WHERE email=$1`, [ADMIN_EMAIL]);
  return r.rows[0].id;
}
async function countMessages(pool) {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM messages`);
    return r.rows[0]?.n ?? 0;
  } catch { return null; }
}

// ─── Tests ──────────────────────────────────────────────────────────────────
function shapeOk(d) {
  return d
    && typeof d.subject === "string" && d.subject.length > 0
    && typeof d.body === "string"    && d.body.length > 0
    && typeof d.suggestedNextAction === "string" && d.suggestedNextAction.length > 0
    && d.context && typeof d.context.recipientEmail === "string"
    && d.meta && d.meta.sentEmail === false
    && (d.meta.tone === "short" || d.meta.tone === "warm" || d.meta.tone === "direct");
}

async function testHappyPath(pool, adminCookie, adminId) {
  console.log("\n[1] Happy path — each supported kind returns valid draft shape");
  const link = await seedLink(pool, adminId, "PhaseI HOT link");
  const email = `pi-hot-${Date.now()}@voltsafe.test`;
  const { accountId, contactId, accountName } = await seedAccountAndContact(pool, email, "Sarah Johnson");
  const hotRec = await seedRecipient(pool, link.id, email, { sentAgoHours: 96, viewedAgoHours: 72 });

  const nqLink = await seedLink(pool, adminId, "PhaseI NQ link");
  const nqEmail = `pi-nq-${Date.now()}@voltsafe.test`;
  await seedAccountAndContact(pool, nqEmail, "Marcus Chen");
  const nqRec = await seedRecipient(pool, nqLink.id, nqEmail,
    { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 48 });

  const leakLink = await seedLink(pool, adminId, "PhaseI LEAK link");
  const leakEmail = `pi-leak-${Date.now()}@voltsafe.test`;
  const leakCrm = await seedAccountAndContact(pool, leakEmail, "Diana Rodriguez");
  const leakRec = await seedRecipient(pool, leakLink.id, leakEmail,
    { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 48 });
  await seedQuote(pool, leakCrm.contactId, leakCrm.accountId, 5500);

  for (const [kind, recId] of [
    ["HOT_OPENED_NOT_BOOKED", hotRec.id],
    ["BOOKED_NO_QUOTE",       nqRec.id],
    ["REVENUE_LEAK",          leakRec.id],
  ]) {
    const r = await jpost(adminCookie,
      "/api/crm/booking-analytics/actions/generate-followup-draft",
      { kind, recipientId: recId });
    if (r.status === 200 && shapeOk(r.body)) ok(`draft ${kind} → 200 with valid shape`);
    else { bad(`draft ${kind}`, `status ${r.status} body=${JSON.stringify(r.body)}`); continue; }
    if (r.body.meta.kind === kind) ok(`meta.kind = ${kind}`);
    else bad(`meta.kind ${kind}`, JSON.stringify(r.body.meta));
    if (r.body.meta.sentEmail === false) ok(`meta.sentEmail = false (${kind})`);
    else bad(`meta.sentEmail ${kind}`, JSON.stringify(r.body.meta));
  }

  return { hotRec, nqRec, leakRec, link, accountName };
}

async function testToneVariants(adminCookie, recId) {
  console.log("\n[2] Tone variants produce different bodies");
  const tones = ["short", "warm", "direct"];
  const bodies = [];
  for (const tone of tones) {
    const r = await jpost(adminCookie,
      "/api/crm/booking-analytics/actions/generate-followup-draft",
      { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, tone });
    if (r.status === 200 && r.body.meta.tone === tone) ok(`tone=${tone} → 200 meta.tone=${tone}`);
    else { bad(`tone ${tone}`, `status ${r.status} body=${JSON.stringify(r.body)}`); continue; }
    bodies.push(r.body.body);
  }
  const allDifferent = new Set(bodies).size === bodies.length;
  if (allDifferent) ok("3 tones produced 3 distinct bodies");
  else bad("tone differentiation", "duplicate bodies across tones");

  // Default tone (no tone param) should default to warm
  const r = await jpost(adminCookie,
    "/api/crm/booking-analytics/actions/generate-followup-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId });
  if (r.status === 200 && r.body.meta.tone === "warm") ok("default tone = warm");
  else bad("default tone", `meta.tone=${r.body?.meta?.tone}`);
}

async function testCrmContext(adminCookie, recId, accountName) {
  console.log("\n[3] CRM context interpolation");
  const r = await jpost(adminCookie,
    "/api/crm/booking-analytics/actions/generate-followup-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, tone: "warm" });
  if (r.status !== 200) { bad("draft", `status ${r.status}`); return; }
  const body = r.body.body;
  if (body.includes("Sarah")) ok("first name 'Sarah' appears in body");
  else bad("first name interpolation", `body=${body.slice(0, 200)}`);
  if (r.body.context.contactName === "Sarah Johnson") ok("context.contactName populated");
  else bad("context.contactName", JSON.stringify(r.body.context));
  if (r.body.context.accountName === accountName) ok("context.accountName populated");
  else bad("context.accountName", `${r.body.context.accountName} vs ${accountName}`);
}

async function testAntiHallucination(adminCookie, leakRecId) {
  console.log("\n[4] Anti-hallucination — no fabricated prices/dates");
  for (const tone of ["short", "warm", "direct"]) {
    const r = await jpost(adminCookie,
      "/api/crm/booking-analytics/actions/generate-followup-draft",
      { kind: "REVENUE_LEAK", recipientId: leakRecId, tone });
    if (r.status !== 200) { bad(`leak tone=${tone}`, `status ${r.status}`); continue; }
    const txt = `${r.body.subject}\n${r.body.body}`;
    // Body must NOT contain $ pricing
    if (!/\$\d/.test(txt)) ok(`tone=${tone}: no $ pricing`);
    else bad(`tone=${tone}: $ pricing leaked`, txt.match(/\$\d[\d,.]*/g)?.join(", "));
    // Body must NOT contain fabricated future dates (no "next Tuesday", "tomorrow", "January 15", etc.)
    if (!/\b(?:tomorrow|next\s+\w+day|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(txt))
      ok(`tone=${tone}: no fabricated date phrases`);
    else bad(`tone=${tone}: date phrase leaked`);
  }
}

async function testNoSend(pool, adminCookie, recId) {
  console.log("\n[5] No-send guarantee — message count unchanged");
  const before = await countMessages(pool);
  const r = await jpost(adminCookie,
    "/api/crm/booking-analytics/actions/generate-followup-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId });
  if (r.status !== 200) { bad("draft for no-send", `status ${r.status}`); return; }
  if (r.body.meta.sentEmail === false) ok("response meta.sentEmail = false");
  else bad("meta.sentEmail", JSON.stringify(r.body.meta));
  const after = await countMessages(pool);
  if (before == null || after == null) ok("messages table absent — no-send vacuously true");
  else if (before === after) ok(`messages count unchanged (${before})`);
  else bad("messages table changed", `${before} → ${after}`);
}

async function testOwnerScoping(pool, adminCookie, adminId) {
  console.log("\n[6] Owner scoping");
  const other = await seedSecondaryUser(pool);
  const lnk = await seedLink(pool, adminId, "PhaseI scoping link");
  const em = `pi-cross-${Date.now()}@voltsafe.test`;
  await seedAccountAndContact(pool, em, "Cross Owner");
  const rec = await seedRecipient(pool, lnk.id, em, { sentAgoHours: 96, viewedAgoHours: 72 });

  const otherCookie = await loginAs(other.email, "phasei1234");
  if (!otherCookie) { bad("non-admin login"); return; }
  ok("non-admin login OK");

  const r1 = await jpost(otherCookie,
    "/api/crm/booking-analytics/actions/generate-followup-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: rec.id });
  if (r1.status === 403) ok("non-admin → 403 cross-owner draft");
  else bad("non-admin cross-owner", `status ${r1.status} body=${JSON.stringify(r1.body)}`);

  const r2 = await jpost(adminCookie,
    "/api/crm/booking-analytics/actions/generate-followup-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: rec.id });
  if (r2.status === 200 && shapeOk(r2.body)) ok("admin → 200 cross-owner draft");
  else bad("admin cross-owner", `status ${r2.status}`);

  const ownLink = await seedLink(pool, other.id, "PhaseI own link");
  const ownEm = `pi-own-${Date.now()}@voltsafe.test`;
  await seedAccountAndContact(pool, ownEm, "Own Person");
  const ownRec = await seedRecipient(pool, ownLink.id, ownEm, { sentAgoHours: 96, viewedAgoHours: 72 });
  const r3 = await jpost(otherCookie,
    "/api/crm/booking-analytics/actions/generate-followup-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: ownRec.id });
  if (r3.status === 200 && shapeOk(r3.body)) ok("non-admin → 200 own recipient");
  else bad("non-admin own", `status ${r3.status} body=${JSON.stringify(r3.body)}`);
}

async function testAuth() {
  console.log("\n[7] Auth — anonymous → 401");
  const r = await jpost(null,
    "/api/crm/booking-analytics/actions/generate-followup-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: 1 });
  if (r.status === 401) ok("anon → 401");
  else bad("anon", `status ${r.status}`);
}

async function testValidation(adminCookie, sampleRecipientId) {
  console.log("\n[8] Validation");
  const cases = [
    { name: "unsupported kind",        body: { kind: "FOOBAR",                recipientId: sampleRecipientId }, expect: 400 },
    { name: "missing kind",            body: {                                recipientId: sampleRecipientId }, expect: 400 },
    { name: "missing recipientId",     body: { kind: "HOT_OPENED_NOT_BOOKED"                                 }, expect: 400 },
    { name: "non-numeric recipientId", body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: "abc"             }, expect: 400 },
    { name: "negative recipientId",    body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: -5                }, expect: 400 },
    { name: "non-existent recipient",  body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: 9_999_999         }, expect: 404 },
    { name: "bad bookingLinkId",       body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: sampleRecipientId, bookingLinkId: "x" }, expect: 400 },
    { name: "mismatched bookingLinkId",body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: sampleRecipientId, bookingLinkId: 9_999_999 }, expect: 400 },
    { name: "unsupported tone",        body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: sampleRecipientId, tone: "rude" }, expect: 400 },
    { name: "non-string tone",         body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: sampleRecipientId, tone: 5 }, expect: 400 },
  ];
  for (const c of cases) {
    const r = await jpost(adminCookie,
      "/api/crm/booking-analytics/actions/generate-followup-draft", c.body);
    if (r.status === c.expect) ok(`${c.name} → ${c.expect}`);
    else bad(c.name, `expected ${c.expect}, got ${r.status} body=${JSON.stringify(r.body)}`);
  }
}

function testFrontend() {
  console.log("\n[9] Frontend smoke — Draft button + Dialog render");
  const src = readFileSync("client/src/pages/booking-analytics.tsx", "utf8");
  const checks = [
    ["Draft button testid",          /button-draft-email-/],
    ["Dialog component imported",    /from\s+"@\/components\/ui\/dialog"/],
    ["calls generate-followup-draft",/\/api\/crm\/booking-analytics\/actions\/generate-followup-draft/],
    ["uses tone selector",           /select-draft-tone/],
    ["renders subject",              /text-draft-subject/],
    ["renders body",                 /text-draft-body/],
    ["renders next action",          /text-draft-next-action/],
    ["copy subject button",          /button-copy-draft-subject/],
    ["copy body button",             /button-copy-draft-body/],
    ["copy full draft button",       /button-copy-draft-full/],
    ["DraftTone type",               /DraftTone\s*=\s*"short"\s*\|\s*"warm"\s*\|\s*"direct"/],
    ["meta.sentEmail typed false",   /sentEmail:\s*false/],
    ["dialog only on actionable kinds (TASK_ACTION_KINDS)",
                                     /showDraftBtn\s*=\s*TASK_ACTION_KINDS\.has\(kind\)/],
  ];
  for (const [name, rx] of checks) {
    if (rx.test(src)) ok(`page source: ${name}`);
    else bad(`page source: ${name}`);
  }
}

async function main() {
  console.log("=== VoltSafe Cortex — Phase I: Booking Follow-Up Draft Assistant ===");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const adminCookie = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
    if (!adminCookie) throw new Error("admin login failed");
    const adminId = await getAdminId(pool);

    const seed = await testHappyPath(pool, adminCookie, adminId);
    await testToneVariants(adminCookie, seed.hotRec.id);
    await testCrmContext(adminCookie, seed.hotRec.id, seed.accountName);
    await testAntiHallucination(adminCookie, seed.leakRec.id);
    await testNoSend(pool, adminCookie, seed.hotRec.id);
    await testOwnerScoping(pool, adminCookie, adminId);
    await testAuth();
    await testValidation(adminCookie, seed.hotRec.id);
    testFrontend();

    console.log("\n───────────────────────────────────────────────────────────────");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("───────────────────────────────────────────────────────────────");
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  } finally { await pool.end(); }
}
main();
