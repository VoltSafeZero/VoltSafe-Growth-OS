#!/usr/bin/env node
/**
 * Phase H — Booking Command Center: One-Click Actions
 *
 *   POST /api/crm/booking-analytics/actions/create-followup-task
 *
 * Coverage:
 *   1. Successful create for HOT_OPENED_NOT_BOOKED, BOOKED_NO_QUOTE, REVENUE_LEAK
 *   2. Dedup — second call returns existing taskId, created=false
 *   3. Task suppresses HOT and REVENUE_LEAK rows from /command-center on next call
 *   4. Non-admin cannot create a task on another owner's recipient (403)
 *   5. Admin can create a task on any recipient (200)
 *   6. Anonymous → 401
 *   7. Validation: missing/invalid recipientId, unsupported kind, mismatched
 *      bookingLinkId, malformed body → 400
 *   8. Non-existent recipient → 404
 *   9. Frontend: Command Center buttons render where expected
 *      (smoke check via static page-source string match)
 *
 * Run: node tests/booking-command-actions.test.js
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
  const slug = `ph-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
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
  const revokedExpr= opts.revoked                ? "NOW()"                                          : "NULL";
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
  const email = `ph-other-${Date.now()}-${Math.floor(Math.random() * 1e6)}@voltsafe.test`;
  const hash  = await bcrypt.hash("phaseh1234", 12);
  const [u] = (await pool.query(
    `INSERT INTO users (email, name, password, role, global_role, must_change_password, permissions, created_at)
     VALUES ($1, 'Phase H Other', $2, 'user', 'sales', false, $3::jsonb, NOW())
     RETURNING id`, [email, hash, JSON.stringify({ crm: "edit" })])).rows;
  return { id: u.id, email };
}
async function seedAccountAndContact(pool, email) {
  const [a] = (await pool.query(
    `INSERT INTO accounts (name, segment, lead_status, priority, created_at, updated_at)
     VALUES ($1, 'marina', 'new', 'medium', NOW(), NOW()) RETURNING id`,
    [`PhaseH Acct ${Date.now()}-${Math.random()}`])).rows;
  const [c] = (await pool.query(
    `INSERT INTO contacts (account_id, name, email, created_at, updated_at)
     VALUES ($1, 'PhaseH Contact', LOWER($2), NOW(), NOW()) RETURNING id`,
    [a.id, email])).rows;
  return { accountId: a.id, contactId: c.id };
}
async function seedQuote(pool, { contactId, accountId, total, createdAgoHours }) {
  const qNumber = `PH-Q-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const createdExpr = `NOW() - INTERVAL '${createdAgoHours} hours'`;
  const [q] = (await pool.query(
    `INSERT INTO quotes
       (quote_number, status, total, contact_id, account_id, created_at, updated_at)
     VALUES ($1, 'sent', $2, $3, $4, ${createdExpr}, ${createdExpr})
     RETURNING id`, [qNumber, total, contactId, accountId])).rows;
  return q;
}

async function getAdminId(pool) {
  const r = await pool.query(`SELECT id FROM users WHERE email=$1`, [ADMIN_EMAIL]);
  return r.rows[0].id;
}

// ─── Tests ──────────────────────────────────────────────────────────────────
async function testHappyPath(pool, adminCookie, adminId) {
  console.log("\n[1] Happy path — create one task per supported kind, dedup on 2nd call");

  // HOT seed
  const hotLink = await seedLink(pool, adminId, "PhaseH HOT link");
  const hotEmail = `ph-hot-${Date.now()}@voltsafe.test`;
  await seedAccountAndContact(pool, hotEmail);
  const hotRec = await seedRecipient(pool, hotLink.id, hotEmail,
    { sentAgoHours: 96, viewedAgoHours: 72 });

  // BOOKED_NO_QUOTE seed
  const nqLink = await seedLink(pool, adminId, "PhaseH NQ link");
  const nqEmail = `ph-nq-${Date.now()}@voltsafe.test`;
  await seedAccountAndContact(pool, nqEmail);
  const nqRec = await seedRecipient(pool, nqLink.id, nqEmail,
    { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 48 });

  // REVENUE_LEAK seed
  const leakLink = await seedLink(pool, adminId, "PhaseH LEAK link");
  const leakEmail = `ph-leak-${Date.now()}@voltsafe.test`;
  const { accountId, contactId } = await seedAccountAndContact(pool, leakEmail);
  const leakRec = await seedRecipient(pool, leakLink.id, leakEmail,
    { sentAgoHours: 96, viewedAgoHours: 72, bookedAgoHours: 48 });
  await seedQuote(pool, { contactId, accountId, total: 4500, createdAgoHours: 24 });

  for (const [kind, recId] of [
    ["HOT_OPENED_NOT_BOOKED", hotRec.id],
    ["BOOKED_NO_QUOTE",       nqRec.id],
    ["REVENUE_LEAK",          leakRec.id],
  ]) {
    const r = await jpost(adminCookie,
      "/api/crm/booking-analytics/actions/create-followup-task",
      { kind, recipientId: recId });
    if (r.status === 200 && r.body?.created === true && r.body?.taskId > 0) {
      ok(`create ${kind} → 200 created=true taskId=${r.body.taskId}`);
    } else {
      bad(`create ${kind}`, `status ${r.status} body=${JSON.stringify(r.body)}`);
    }

    // Dedup
    const r2 = await jpost(adminCookie,
      "/api/crm/booking-analytics/actions/create-followup-task",
      { kind, recipientId: recId });
    if (r2.status === 200 && r2.body?.created === false && r2.body?.taskId === r.body?.taskId) {
      ok(`dedup ${kind} → returns existing taskId, created=false`);
    } else {
      bad(`dedup ${kind}`, `status ${r2.status} body=${JSON.stringify(r2.body)}`);
    }

    // Verify DB row
    const tr = await pool.query(
      `SELECT source, source_meta, status FROM tasks WHERE id=$1`, [r.body.taskId]);
    const row = tr.rows[0];
    if (row?.source === "booking_followup"
        && row?.source_meta?.source === "booking_command_center"
        && row?.source_meta?.kind === kind
        && Number(row?.source_meta?.recipientId) === recId
        && row?.status === "pending") {
      ok(`task row sourceMeta correct for ${kind}`);
    } else {
      bad(`task row sourceMeta ${kind}`, JSON.stringify(row));
    }
  }

  return { hotRec, nqRec, leakRec, hotLink, nqLink, leakLink };
}

async function testSuppression(adminCookie, ids) {
  console.log("\n[2] Suppression — HOT and LEAK rows hidden after task creation");
  const r = await jget(adminCookie, "/api/crm/booking-analytics/command-center");
  if (r.status !== 200) { bad("command-center 200", r.status); return; }

  const hotIds  = (r.body.buckets.HOT_OPENED_NOT_BOOKED ?? []).map((c) => c.recipientId);
  const leakIds = (r.body.buckets.REVENUE_LEAK         ?? []).map((c) => c.recipientId);
  if (!hotIds.includes(ids.hotRec.id))   ok(`HOT bucket no longer contains ${ids.hotRec.id}`);
  else bad(`HOT suppression`, `still includes ${ids.hotRec.id}`);
  if (!leakIds.includes(ids.leakRec.id)) ok(`REVENUE_LEAK bucket no longer contains ${ids.leakRec.id}`);
  else bad(`LEAK suppression`, `still includes ${ids.leakRec.id}`);

  // BOOKED_NO_QUOTE is suppressed via actionLists (any pending booking_followup task hides it)
  const nqIds = (r.body.buckets.BOOKED_NO_QUOTE ?? []).map((c) => c.recipientId);
  if (!nqIds.includes(ids.nqRec.id)) ok(`BOOKED_NO_QUOTE bucket no longer contains ${ids.nqRec.id}`);
  else bad(`NQ suppression`, `still includes ${ids.nqRec.id}`);
}

async function testOwnerScoping(pool, adminCookie, adminId) {
  console.log("\n[3] Owner scoping — non-admin cannot create task on another owner's recipient");
  const other = await seedSecondaryUser(pool);
  // Recipient belongs to ADMIN's link
  const lnk = await seedLink(pool, adminId, "PhaseH owner-scope link");
  const em = `ph-cross-${Date.now()}@voltsafe.test`;
  await seedAccountAndContact(pool, em);
  const rec = await seedRecipient(pool, lnk.id, em,
    { sentAgoHours: 96, viewedAgoHours: 72 });

  const otherCookie = await loginAs(other.email, "phaseh1234");
  if (!otherCookie) { bad("non-admin login"); return; }
  ok("non-admin login OK");

  const r = await jpost(otherCookie,
    "/api/crm/booking-analytics/actions/create-followup-task",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: rec.id });
  if (r.status === 403) ok("non-admin → 403 for cross-owner recipient");
  else bad("non-admin cross-owner", `status ${r.status} body=${JSON.stringify(r.body)}`);

  // And admin CAN create on the same recipient
  const r2 = await jpost(adminCookie,
    "/api/crm/booking-analytics/actions/create-followup-task",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: rec.id });
  if (r2.status === 200 && r2.body?.created === true) ok("admin → 200 created on cross-owner recipient");
  else bad("admin cross-owner", `status ${r2.status} body=${JSON.stringify(r2.body)}`);

  // Non-admin can act on OWN recipient
  const ownLink = await seedLink(pool, other.id, "PhaseH own link");
  const ownEm = `ph-own-${Date.now()}@voltsafe.test`;
  await seedAccountAndContact(pool, ownEm);
  const ownRec = await seedRecipient(pool, ownLink.id, ownEm,
    { sentAgoHours: 96, viewedAgoHours: 72 });
  const r3 = await jpost(otherCookie,
    "/api/crm/booking-analytics/actions/create-followup-task",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: ownRec.id });
  if (r3.status === 200 && r3.body?.created === true) ok("non-admin → 200 created on own recipient");
  else bad("non-admin own recipient", `status ${r3.status} body=${JSON.stringify(r3.body)}`);
}

async function testValidation(adminCookie, sampleRecipientId) {
  console.log("\n[4] Validation");

  const cases = [
    { name: "unsupported kind",        body: { kind: "FOOBAR",                recipientId: sampleRecipientId }, expect: 400 },
    { name: "REWRITE_LINK not allowed",body: { kind: "REWRITE_LINK",          recipientId: sampleRecipientId }, expect: 400 },
    { name: "missing kind",            body: {                                recipientId: sampleRecipientId }, expect: 400 },
    { name: "missing recipientId",     body: { kind: "HOT_OPENED_NOT_BOOKED"                                 }, expect: 400 },
    { name: "non-numeric recipientId", body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: "abc"             }, expect: 400 },
    { name: "negative recipientId",    body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: -5                }, expect: 400 },
    { name: "non-existent recipient",  body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: 9_999_999         }, expect: 404 },
    { name: "bad bookingLinkId",       body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: sampleRecipientId, bookingLinkId: "x" }, expect: 400 },
    { name: "mismatched bookingLinkId",body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: sampleRecipientId, bookingLinkId: 9_999_999 }, expect: 400 },
    { name: "note too long",           body: { kind: "HOT_OPENED_NOT_BOOKED", recipientId: sampleRecipientId, note: "x".repeat(501) }, expect: 400 },
  ];

  for (const c of cases) {
    const r = await jpost(adminCookie,
      "/api/crm/booking-analytics/actions/create-followup-task", c.body);
    if (r.status === c.expect) ok(`${c.name} → ${c.expect}`);
    else bad(c.name, `expected ${c.expect}, got ${r.status} body=${JSON.stringify(r.body)}`);
  }
}

async function testAuth() {
  console.log("\n[5] Auth — anonymous → 401");
  const r = await jpost(null,
    "/api/crm/booking-analytics/actions/create-followup-task",
    { kind: "HOT_OPENED_NOT_BOOKED", recipientId: 1 });
  if (r.status === 401) ok("anon → 401");
  else bad("anon", `status ${r.status}`);
}

async function testFrontendRendering() {
  console.log("\n[6] Frontend — buttons present in source");
  // Smoke-check: read the page source and confirm the testId conventions
  // and labels exist in the bundle. (This page is statically authored.)
  const src = readFileSync("client/src/pages/booking-analytics.tsx", "utf8");
  const checks = [
    ["TASK_ACTION_KINDS includes HOT/NQ/LEAK",
      /TASK_ACTION_KINDS[\s\S]*HOT_OPENED_NOT_BOOKED[\s\S]*BOOKED_NO_QUOTE[\s\S]*REVENUE_LEAK/],
    ["COPY_LINK_KINDS includes REUSE/WINNER",
      /COPY_LINK_KINDS[\s\S]*REUSE_LINK[\s\S]*REVENUE_WINNER/],
    ["create-task button testid present", /button-create-task-/],
    ["copy-link button testid present",   /button-copy-link-/],
    ["calls POST endpoint",               /\/api\/crm\/booking-analytics\/actions\/create-followup-task/],
    ["uses navigator.clipboard",          /navigator\.clipboard\.writeText/],
    ["uses useToast",                     /useToast/],
    ["disables button when acted",        /disabled=\{acted/],
  ];
  for (const [name, rx] of checks) {
    if (rx.test(src)) ok(`page source: ${name}`);
    else bad(`page source: ${name}`);
  }
}

async function main() {
  console.log("=== VoltSafe Cortex — Phase H: Command Center One-Click Actions ===");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const adminCookie = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
    if (!adminCookie) throw new Error("admin login failed");
    const adminId = await getAdminId(pool);

    const ids = await testHappyPath(pool, adminCookie, adminId);
    await testSuppression(adminCookie, ids);
    await testOwnerScoping(pool, adminCookie, adminId);
    await testValidation(adminCookie, ids.hotRec.id);
    await testAuth();
    await testFrontendRendering();

    console.log("\n───────────────────────────────────────────────────────────────");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("───────────────────────────────────────────────────────────────");
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
main();
