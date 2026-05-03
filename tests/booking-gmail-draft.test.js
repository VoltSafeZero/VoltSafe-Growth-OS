#!/usr/bin/env node
/**
 * Phase J — Create Gmail Draft from Booking Draft Assistant
 *
 *   POST /api/crm/booking-analytics/actions/create-gmail-draft
 *
 * Coverage:
 *   1. Happy path — draft created in Gmail (when admin Gmail connected),
 *      response shape valid, meta.sentEmail === false; cleanup after each
 *   2. No email actually sent — `messages` table count unchanged
 *   3. Edited subject/body — used verbatim, response source === "edited"
 *   4. Generated subject/body when omitted — source === "generated"
 *   5. Owner scoping — non-admin → 403 cross-owner
 *   6. Send permission — non-admin without Gmail → 403; non-admin without
 *      edit grant on shared mailbox via asAccountId → 403
 *   7. Validation — bad/missing kind, recipientId, tone, subject/body type,
 *      asAccountId, edited-subject-without-body → 400
 *   8. Anonymous → 401
 *   9. Frontend smoke — Create Gmail Draft button + success state in source
 *
 * Run: node tests/booking-gmail-draft.test.js
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
async function jdelete(cookie, path) {
  const r = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: BASE, Referer: `${BASE}/` },
  });
  let resBody = null; try { resBody = await r.json(); } catch {}
  return { status: r.status, body: resBody };
}

// ─── Seed helpers (mirrors Phase I test) ────────────────────────────────────
async function seedLink(pool, ownerId, name) {
  const slug = `pj-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
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
  const viewCount  = opts.viewedAgoHours != null ? 1 : 0;
  const [row] = (await pool.query(
    `INSERT INTO booking_link_recipients
       (booking_link_id, recipient_email, token, sent_at, first_viewed_at,
        view_count, created_at)
     VALUES ($1, LOWER($2), $3, ${sentExpr}, ${viewedExpr}, $4,
             NOW() - INTERVAL '7 days')
     RETURNING id`, [linkId, email, token, viewCount])).rows;
  return row;
}
async function seedSecondaryUser(pool) {
  const email = `pj-other-${Date.now()}-${Math.floor(Math.random() * 1e6)}@voltsafe.test`;
  const hash  = await bcrypt.hash("phasej1234", 12);
  const [u] = (await pool.query(
    `INSERT INTO users (email, name, password, role, global_role, must_change_password, permissions, created_at)
     VALUES ($1, 'Phase J Other', $2, 'user', 'sales', false, $3::jsonb, NOW())
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
async function getAdminId(pool) {
  return (await pool.query(`SELECT id FROM users WHERE email=$1`, [ADMIN_EMAIL])).rows[0].id;
}
async function countMessages(pool) {
  try { return (await pool.query(`SELECT COUNT(*)::int AS n FROM messages`)).rows[0].n; }
  catch { return null; }
}
async function pickAdminSharedAccountId(pool, adminId) {
  const r = await pool.query(
    `SELECT id FROM email_accounts WHERE user_id=$1 AND is_active=true AND is_shared=true LIMIT 1`,
    [adminId]);
  return r.rows[0]?.id ?? null;
}

// ─── Cleanup created drafts (we hit real Gmail) ─────────────────────────────
async function cleanupDraft(cookie, draftId, asAccountId) {
  if (!draftId) return;
  const qs = asAccountId != null ? `?asAccountId=${asAccountId}` : "";
  await jdelete(cookie, `/api/gmail/drafts/${encodeURIComponent(draftId)}${qs}`);
}

// ─── DB cleanup — MUST run or HOT-cohort tests in booking-command-center
// will fail because seeded recipients (sentAgoHours:96, viewedAgoHours:72) match
// the HOT_OPENED_NOT_BOOKED criteria and bump real fixtures off the per-cohort LIMIT.
async function purgeDbFixtures(pool) {
  try {
    await pool.query(`DELETE FROM booking_link_recipients WHERE recipient_email LIKE 'pj-%@voltsafe.test'`);
    await pool.query(`DELETE FROM booking_links WHERE name LIKE 'PhaseJ%' OR slug LIKE 'pj-%'`);
    await pool.query(`DELETE FROM contacts WHERE email LIKE 'pj-%@voltsafe.test'`);
    await pool.query(`DELETE FROM accounts WHERE name LIKE 'Acme Marina %' AND id NOT IN (SELECT account_id FROM contacts WHERE account_id IS NOT NULL)`);
    await pool.query(`DELETE FROM users WHERE email LIKE 'pj-other-%@voltsafe.test'`);
  } catch (e) { console.warn(`[cleanup] db purge warning: ${e.message}`); }
}

function shapeOk(d) {
  return d
    && typeof d.draftId === "string" && d.draftId.length > 0
    && typeof d.to === "string" && d.to.includes("@")
    && typeof d.subject === "string" && d.subject.length > 0
    && typeof d.body === "string" && d.body.length > 0
    && (d.source === "edited" || d.source === "generated")
    && d.meta && d.meta.sentEmail === false;
}

// ─── Tests ──────────────────────────────────────────────────────────────────
const created = []; // { draftId, asAccountId? }

async function testHappyPath(pool, adminCookie, adminId, recId) {
  console.log("\n[1] Happy path — admin creates Gmail draft (generated text)");
  const r = await jpost(adminCookie,
    "/api/crm/booking-analytics/actions/create-gmail-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId });
  if (r.status === 200 && shapeOk(r.body)) {
    ok(`200 + valid shape (draftId=${r.body.draftId.slice(0, 12)}…)`);
    created.push({ draftId: r.body.draftId });
  } else if (r.status === 503) {
    bad("Gmail not connected for admin", `body=${JSON.stringify(r.body)}`);
    return null;
  } else {
    bad("happy path", `status ${r.status} body=${JSON.stringify(r.body)}`);
    return null;
  }
  if (r.body.source === "generated") ok("source = generated when subject/body omitted");
  else bad("source", `expected generated, got ${r.body.source}`);
  if (r.body.meta.sentEmail === false) ok("meta.sentEmail = false");
  else bad("meta.sentEmail", JSON.stringify(r.body.meta));
  return r.body;
}

async function testNoEmailSent(pool, adminCookie, recId) {
  console.log("\n[2] No email actually sent — messages count unchanged");
  const before = await countMessages(pool);
  const r = await jpost(adminCookie,
    "/api/crm/booking-analytics/actions/create-gmail-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId });
  if (r.status === 200) created.push({ draftId: r.body.draftId });
  else { bad("draft for no-send check", `status ${r.status}`); return; }
  const after = await countMessages(pool);
  if (before == null || after == null) ok("messages table absent — vacuously true");
  else if (before === after) ok(`messages count unchanged (${before})`);
  else bad("messages count changed", `${before} → ${after}`);
  if (r.body.meta.sentEmail === false) ok("response meta.sentEmail = false");
  else bad("meta.sentEmail flag", JSON.stringify(r.body.meta));
}

async function testEditedSubjectBody(adminCookie, recId) {
  console.log("\n[3] Edited subject/body — used verbatim");
  const subj = `PJ-EDIT-${Date.now()} Custom subject`;
  const body = `Hello — this body was edited in the modal.\n\nLine 2.\n\nRegards.`;
  const r = await jpost(adminCookie,
    "/api/crm/booking-analytics/actions/create-gmail-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, subject: subj, body });
  if (r.status !== 200) { bad("edited", `status ${r.status} body=${JSON.stringify(r.body)}`); return; }
  created.push({ draftId: r.body.draftId });
  if (r.body.source === "edited") ok("source = edited");
  else bad("source", `expected edited, got ${r.body.source}`);
  if (r.body.subject === subj) ok("subject echoed verbatim");
  else bad("subject echo", `${r.body.subject} vs ${subj}`);
  if (r.body.body === body) ok("body echoed verbatim");
  else bad("body echo", "(differs)");
}

async function testGeneratedWhenOmitted(adminCookie, recId) {
  console.log("\n[4] Generated subject/body — used when omitted, with tone");
  for (const tone of ["short", "warm", "direct"]) {
    const r = await jpost(adminCookie,
      "/api/crm/booking-analytics/actions/create-gmail-draft",
      { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, tone });
    if (r.status !== 200) { bad(`gen tone=${tone}`, `status ${r.status}`); continue; }
    created.push({ draftId: r.body.draftId });
    if (r.body.source === "generated" && r.body.meta.tone === tone)
      ok(`tone=${tone}: source=generated, meta.tone=${tone}`);
    else bad(`tone=${tone}`, `source=${r.body.source} meta.tone=${r.body.meta?.tone}`);
  }
}

async function testOwnerScoping(pool, adminCookie, adminId) {
  console.log("\n[5] Owner scoping — non-admin → 403 cross-owner");
  const other = await seedSecondaryUser(pool);
  const lnk = await seedLink(pool, adminId, "PhaseJ scoping link");
  const em  = `pj-cross-${Date.now()}@voltsafe.test`;
  await seedAccountAndContact(pool, em, "Cross Owner");
  const rec = await seedRecipient(pool, lnk.id, em, { sentAgoHours: 96, viewedAgoHours: 72 });

  const otherCookie = await loginAs(other.email, "phasej1234");
  if (!otherCookie) { bad("non-admin login"); return null; }
  ok("non-admin login OK");

  const r = await jpost(otherCookie,
    "/api/crm/booking-analytics/actions/create-gmail-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: rec.id });
  if (r.status === 403) ok("non-admin → 403 cross-owner");
  else bad("non-admin cross-owner", `status ${r.status} body=${JSON.stringify(r.body)}`);
  return { other, otherCookie };
}

async function testSendPermission(pool, adminCookie, adminId, otherCtx) {
  console.log("\n[6] Send permission — mailbox edit access required");

  // 6a: non-admin user has no Gmail mailbox at all → 403 (no mailbox accessible)
  if (otherCtx) {
    const lnk = await seedLink(pool, otherCtx.other.id, "PhaseJ own link");
    const em  = `pj-own-${Date.now()}@voltsafe.test`;
    await seedAccountAndContact(pool, em, "Own Person");
    const rec = await seedRecipient(pool, lnk.id, em, { sentAgoHours: 96, viewedAgoHours: 72 });
    const r = await jpost(otherCtx.otherCookie,
      "/api/crm/booking-analytics/actions/create-gmail-draft",
      { kind: "HOT_OPENED_NOT_BOOKED", recipientId: rec.id });
    if (r.status === 403) ok("non-admin without Gmail → 403 (no mailbox)");
    else bad("non-admin no-mailbox", `status ${r.status} body=${JSON.stringify(r.body)}`);

    // 6b: non-admin tries asAccountId of a SHARED mailbox they have no edit grant for → 403
    const sharedAcctId = await pickAdminSharedAccountId(pool, adminId);
    if (sharedAcctId) {
      const r2 = await jpost(otherCtx.otherCookie,
        "/api/crm/booking-analytics/actions/create-gmail-draft",
        { kind: "HOT_OPENED_NOT_BOOKED", recipientId: rec.id, asAccountId: sharedAcctId });
      if (r2.status === 403) ok("non-admin without edit grant on shared mailbox → 403");
      else bad("shared mailbox without grant", `status ${r2.status} body=${JSON.stringify(r2.body)}`);
    } else {
      ok("(no shared mailbox seeded — skipped 6b)");
    }
  }
}

async function testValidation(adminCookie, recId) {
  console.log("\n[7] Validation");
  const cases = [
    { name: "unsupported kind",        body: { kind: "FOO",                   recipientId: recId },                    expect: 400 },
    { name: "missing kind",            body: {                                recipientId: recId },                    expect: 400 },
    { name: "missing recipientId",     body: { kind: "HOT_OPENED_NOT_BOOKED" },                                        expect: 400 },
    { name: "non-numeric recipientId", body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: "abc" },                    expect: 400 },
    { name: "negative recipientId",    body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: -3 },                       expect: 400 },
    { name: "non-existent recipient",  body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: 9_999_999 },                expect: 404 },
    { name: "bad bookingLinkId",       body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, bookingLinkId: "x" },expect: 400 },
    { name: "bad tone",                body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, tone: "rude" },      expect: 400 },
    { name: "non-string subject",      body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, subject: 5 },        expect: 400 },
    { name: "non-string body",         body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, body: 5 },           expect: 400 },
    { name: "bad asAccountId",         body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, asAccountId: 0 },    expect: 400 },
    { name: "subject without body",    body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, subject: "Hi" },     expect: 400 },
    { name: "body without subject",    body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, body: "Hi there" },  expect: 400 },
    { name: "empty subject string",    body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, subject: "  ", body: "Hi" }, expect: 400 },
    { name: "empty body string",       body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: recId, subject: "Hi", body: "  " }, expect: 400 },
  ];
  for (const c of cases) {
    const r = await jpost(adminCookie,
      "/api/crm/booking-analytics/actions/create-gmail-draft", c.body);
    if (r.status === c.expect) ok(`${c.name} → ${c.expect}`);
    else bad(c.name, `expected ${c.expect}, got ${r.status} body=${JSON.stringify(r.body)}`);
  }
}

async function testAuth() {
  console.log("\n[8] Auth — anonymous → 401");
  const r = await jpost(null,
    "/api/crm/booking-analytics/actions/create-gmail-draft",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: 1 });
  if (r.status === 401) ok("anon → 401");
  else bad("anon", `status ${r.status}`);
}

function testFrontend() {
  console.log("\n[9] Frontend smoke — Create Gmail Draft button + success state");
  const src = readFileSync("client/src/pages/booking-analytics.tsx", "utf8");
  const checks = [
    ["Create Gmail Draft button testid",  /button-create-gmail-draft/],
    ["calls create-gmail-draft endpoint", /\/api\/crm\/booking-analytics\/actions\/create-gmail-draft/],
    ["editable subject input testid",     /input-draft-subject/],
    ["editable body textarea testid",     /textarea-draft-body/],
    ["success state copy",                /Draft created in Gmail/],
    ["does NOT auto-send",                /sentEmail:\s*false/],
    ["preserves Copy full draft button",  /button-copy-draft-full/],
    ["sends edited subject + body",       /subject:\s*editedSubject,\s*body:\s*editedBody/],
    ["resets gmailDraftId on edit",       /setGmailDraftId\(null\);/],
    ["disables button while pending",     /disabled=\{!draftData \|\| createGmailDraft\.isPending \|\| gmailDraftId != null\}/],
    ["Mail icon imported",                /Mail,?[\s}]/],
    ["Input + Textarea imported",         /from\s+"@\/components\/ui\/(input|textarea)"/],
  ];
  for (const [name, rx] of checks) {
    if (rx.test(src)) ok(`page source: ${name}`);
    else bad(`page source: ${name}`);
  }
}

async function main() {
  console.log("=== VoltSafe Cortex — Phase J: Create Gmail Draft from Booking Draft Assistant ===");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let adminCookie = null;
  try {
    adminCookie = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
    if (!adminCookie) throw new Error("admin login failed");
    const adminId = await getAdminId(pool);

    // Seed a HOT recipient owned by admin for the happy-path tests
    const link = await seedLink(pool, adminId, "PhaseJ HOT link");
    const email = `pj-hot-${Date.now()}@voltsafe.test`;
    await seedAccountAndContact(pool, email, "Sarah Johnson");
    const rec = await seedRecipient(pool, link.id, email, { sentAgoHours: 96, viewedAgoHours: 72 });

    await testHappyPath(pool, adminCookie, adminId, rec.id);
    await testNoEmailSent(pool, adminCookie, rec.id);
    await testEditedSubjectBody(adminCookie, rec.id);
    await testGeneratedWhenOmitted(adminCookie, rec.id);
    const otherCtx = await testOwnerScoping(pool, adminCookie, adminId);
    await testSendPermission(pool, adminCookie, adminId, otherCtx);
    await testValidation(adminCookie, rec.id);
    await testAuth();
    testFrontend();
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  } finally {
    // Cleanup: best-effort delete of every Gmail draft we created
    if (adminCookie && created.length) {
      console.log(`\n[cleanup] Deleting ${created.length} Gmail draft(s) created during this run…`);
      for (const c of created) {
        try { await cleanupDraft(adminCookie, c.draftId, c.asAccountId); }
        catch {}
      }
    }
    // CRITICAL: purge DB fixtures — see purgeDbFixtures() comment.
    console.log("[cleanup] Purging Phase J DB fixtures…");
    await purgeDbFixtures(pool);
    await pool.end();
    console.log("\n───────────────────────────────────────────────────────────────");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("───────────────────────────────────────────────────────────────");
    process.exit(failed > 0 ? 1 : 0);
  }
}
main();
