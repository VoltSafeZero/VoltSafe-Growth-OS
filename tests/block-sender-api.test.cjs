#!/usr/bin/env node
/**
 * Block Sender — behavioral/API regression tests
 *
 * Tests real HTTP interactions against the running server:
 *  A1. POST /api/blocked-senders creates exact email block
 *  A2. Duplicate POST does NOT create a second row (ON CONFLICT DO NOTHING)
 *  A3. POST /api/inbox/threads/:id/mark-spam moves thread out of Inbox into Spam in DB
 *  A4. POST /api/inbox/threads/:id/not-spam removes block and restores Inbox in DB
 *  A5. DELETE /api/blocked-senders/:id removes the exact block
 *  A6. GET /api/blocked-senders returns all blocks for the authed user
 *
 * Run: node tests/block-sender-api.test.cjs
 */
const pg = require("pg");

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";
const ADMIN_UID   = 4;
const TAG         = `bs-api-${Date.now()}`;

let passed = 0, failed = 0;
const ok  = (l)    => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };
const sleep = ms   => new Promise(r => setTimeout(r, ms));

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PWD }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const cookie = r.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  await sleep(300);
  return cookie;
}

const api = (cookie, url, opts = {}) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      Cookie: cookie,
      ...(opts.headers || {}),
    },
  });

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  console.log(`=== Block Sender API Regression (${TAG}) ===\n`);

  const testEmail  = `blocked-sender-${TAG}@test-domain.example.com`;
  const testThread = `test-thread-${TAG}`;
  const testMsgId  = `test-msg-${TAG}`;

  let insertedRowId   = null;
  let insertedMsgDbId = null;

  try {
    const cookie = await login();
    console.log("  authenticated as admin\n");

    // ─── A1: POST /api/blocked-senders creates exact email block ───────────
    console.log("── A1: POST /api/blocked-senders creates exact email block ──");
    {
      const r = await api(cookie, "/api/blocked-senders", {
        method: "POST",
        body: JSON.stringify({ email: testEmail }),
      });
      const body = await r.json();
      console.log(`  response: ${r.status} ${JSON.stringify(body)}`);

      if (r.status === 200 || r.status === 201) ok("A1: POST /api/blocked-senders returns 2xx");
      else bad("A1: POST returns 2xx", `got ${r.status}: ${JSON.stringify(body)}`);

      // Confirm in DB
      const { rows } = await pool.query(
        `SELECT id, email, added_by FROM blocked_senders WHERE email=$1`, [testEmail]);
      if (rows.length === 1) {
        ok(`A1: exactly 1 row in blocked_senders for ${testEmail}`);
        insertedRowId = rows[0].id;
        console.log(`  db row: id=${rows[0].id} email=${rows[0].email} added_by=${rows[0].added_by}`);
      } else {
        bad(`A1: exactly 1 row in blocked_senders`, `found ${rows.length} rows`);
      }
    }

    // ─── A2: Duplicate POST does NOT create a second row ───────────────────
    console.log("\n── A2: Duplicate POST does NOT create a second row ──");
    {
      const r = await api(cookie, "/api/blocked-senders", {
        method: "POST",
        body: JSON.stringify({ email: testEmail }),
      });
      const body = await r.json();
      console.log(`  duplicate response: ${r.status} ${JSON.stringify(body)}`);

      // Route uses ON CONFLICT (email) DO NOTHING — should still return 2xx
      if (r.status === 200 || r.status === 201) ok("A2: duplicate POST still returns 2xx (idempotent)");
      else bad("A2: duplicate POST returns 2xx", `got ${r.status}`);

      const { rows } = await pool.query(
        `SELECT id FROM blocked_senders WHERE email=$1`, [testEmail]);
      if (rows.length === 1) ok("A2: still exactly 1 row in DB (no duplicate inserted)");
      else bad("A2: exactly 1 row after duplicate POST", `got ${rows.length}`);
    }

    // ─── A3: POST /api/inbox/threads/:id/mark-spam moves thread to SPAM ────
    console.log("\n── A3: POST mark-spam moves thread out of INBOX into SPAM ──");
    {
      // Insert a synthetic inbox message
      const { rows: [row] } = await pool.query(`
        INSERT INTO email_messages
          (gmail_message_id, gmail_thread_id, subject, from_email, from_name,
           from_domain, direction, label_ids, source_account_id, sent_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        RETURNING id, gmail_thread_id
      `, [
        testMsgId,
        testThread,
        `[TEST] mark-spam ${TAG}`,
        testEmail,
        "Test Sender",
        `test-domain.example.com`,
        "inbound",
        '["INBOX","UNREAD"]',
        1,
      ]);
      insertedMsgDbId = row.id;
      console.log(`  inserted msg id=${insertedMsgDbId} thread=${testThread}`);

      // Verify INBOX in DB before
      const { rows: [before] } = await pool.query(
        `SELECT label_ids FROM email_messages WHERE id=$1`, [insertedMsgDbId]);
      const beforeLabels = JSON.parse(before.label_ids || "[]");
      if (beforeLabels.includes("INBOX")) ok("A3-pre: message has INBOX label before mark-spam");
      else bad("A3-pre: message has INBOX label before mark-spam", `got ${JSON.stringify(beforeLabels)}`);

      // Call mark-spam
      const r = await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(testThread)}/mark-spam`,
        { method: "POST", body: "{}" });
      const body = await r.json();
      console.log(`  mark-spam response: ${r.status} ${JSON.stringify(body)}`);

      if (r.status === 200) ok("A3: mark-spam returns 200");
      else bad("A3: mark-spam returns 200", `got ${r.status}: ${JSON.stringify(body)}`);

      if (body.ok === true) ok("A3: response body has ok:true");
      else bad("A3: response body has ok:true", `got ${JSON.stringify(body)}`);

      // Verify DB: INBOX removed, SPAM added
      const { rows: [after] } = await pool.query(
        `SELECT label_ids FROM email_messages WHERE id=$1`, [insertedMsgDbId]);
      const afterLabels = JSON.parse(after.label_ids || "[]");
      console.log(`  after mark-spam label_ids: ${JSON.stringify(afterLabels)}`);

      if (!afterLabels.includes("INBOX")) ok("A3: INBOX removed from label_ids in DB");
      else bad("A3: INBOX removed from label_ids", `still has INBOX: ${JSON.stringify(afterLabels)}`);

      if (afterLabels.includes("SPAM")) ok("A3: SPAM added to label_ids in DB");
      else bad("A3: SPAM added to label_ids", `no SPAM: ${JSON.stringify(afterLabels)}`);
    }

    // ─── A4: POST not-spam removes block and restores INBOX ────────────────
    console.log("\n── A4: POST not-spam removes block and restores INBOX ──");
    {
      // The blocked_senders row was created in A1. Confirm it still exists.
      const { rows: blockBefore } = await pool.query(
        `SELECT id FROM blocked_senders WHERE email=$1`, [testEmail]);
      if (blockBefore.length === 1) ok("A4-pre: blocked_senders row still present before not-spam");
      else bad("A4-pre: blocked_senders row still present", `got ${blockBefore.length}`);

      const r = await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(testThread)}/not-spam`,
        { method: "POST", body: "{}" });
      const body = await r.json();
      console.log(`  not-spam response: ${r.status} ${JSON.stringify(body)}`);

      if (r.status === 200) ok("A4: not-spam returns 200");
      else bad("A4: not-spam returns 200", `got ${r.status}: ${JSON.stringify(body)}`);

      if (body.ok === true) ok("A4: response body has ok:true");
      else bad("A4: response body has ok:true", `got ${JSON.stringify(body)}`);

      if (body.remainingSpam === 0) ok("A4: remainingSpam=0 (all spam cleared)");
      else bad("A4: remainingSpam=0", `got ${body.remainingSpam}`);

      // Verify DB: SPAM removed, INBOX added
      const { rows: [after] } = await pool.query(
        `SELECT label_ids FROM email_messages WHERE id=$1`, [insertedMsgDbId]);
      const afterLabels = JSON.parse(after.label_ids || "[]");
      console.log(`  after not-spam label_ids: ${JSON.stringify(afterLabels)}`);

      if (!afterLabels.includes("SPAM")) ok("A4: SPAM removed from label_ids in DB");
      else bad("A4: SPAM removed from label_ids", `still has SPAM: ${JSON.stringify(afterLabels)}`);

      if (afterLabels.includes("INBOX")) ok("A4: INBOX added back to label_ids in DB");
      else bad("A4: INBOX added back to label_ids", `no INBOX: ${JSON.stringify(afterLabels)}`);

      // Verify the blocked_senders row is GONE
      const { rows: blockAfter } = await pool.query(
        `SELECT id FROM blocked_senders WHERE email=$1`, [testEmail]);
      if (blockAfter.length === 0) {
        ok("A4: blocked_senders row removed after not-spam (trust sender)");
        insertedRowId = null; // no longer needs cleanup
      } else {
        bad("A4: blocked_senders row removed after not-spam", `still has ${blockAfter.length} row(s)`);
      }

      // Verify spam_trusted_senders has the email
      const { rows: trusted } = await pool.query(
        `SELECT id FROM spam_trusted_senders WHERE email=$1 LIMIT 1`,
        [testEmail]);
      if (trusted.length >= 1) ok("A4: sender in spam_trusted_senders after not-spam");
      else bad("A4: sender in spam_trusted_senders", "no matching row found");
    }

    // ─── A5: DELETE /api/blocked-senders/:id removes the exact block ───────
    console.log("\n── A5: DELETE /api/blocked-senders/:id removes the exact block ──");
    {
      // Re-insert a fresh block for this test
      const r1 = await api(cookie, "/api/blocked-senders", {
        method: "POST",
        body: JSON.stringify({ email: `del-test-${TAG}@test.example.com` }),
      });
      const b1 = await r1.json();
      const { rows: [row] } = await pool.query(
        `SELECT id FROM blocked_senders WHERE email=$1`,
        [`del-test-${TAG}@test.example.com`]);
      if (!row) { bad("A5-pre: fresh block for delete test", "no row found"); }
      else {
        ok(`A5-pre: fresh block inserted id=${row.id}`);
        const delR = await api(cookie, `/api/blocked-senders/${row.id}`, { method: "DELETE" });
        const delStatus = delR.status;
        console.log(`  DELETE /api/blocked-senders/${row.id} → ${delStatus}`);
        if (delStatus === 200 || delStatus === 204) ok("A5: DELETE returns 2xx");
        else bad("A5: DELETE returns 2xx", `got ${delStatus}`);

        const { rows: after } = await pool.query(
          `SELECT id FROM blocked_senders WHERE id=$1`, [row.id]);
        if (after.length === 0) ok("A5: row removed from DB after DELETE");
        else bad("A5: row removed from DB", `still has ${after.length} row(s)`);
      }
    }

    // ─── A6: GET /api/blocked-senders returns list ──────────────────────────
    console.log("\n── A6: GET /api/blocked-senders returns current block list ──");
    {
      const r = await api(cookie, "/api/blocked-senders");
      if (r.status === 200) ok("A6: GET /api/blocked-senders returns 200");
      else bad("A6: GET returns 200", `got ${r.status}`);

      const body = await r.json();
      if (Array.isArray(body)) ok(`A6: response is an array (${body.length} entries)`);
      else bad("A6: response is array", `got ${typeof body}`);
    }

  } catch (err) {
    console.error("FATAL:", err.message, err.stack?.split("\n")[1]);
    failed++;
  } finally {
    // Clean up any test rows still in the DB
    if (insertedRowId)   await pool.query(`DELETE FROM blocked_senders WHERE id=$1`, [insertedRowId]).catch(() => {});
    await pool.query(`DELETE FROM blocked_senders WHERE email LIKE $1`, [`%-${TAG}@%`]).catch(() => {});
    if (insertedMsgDbId) await pool.query(`DELETE FROM email_messages WHERE id=$1`, [insertedMsgDbId]).catch(() => {});
    await pool.query(`DELETE FROM spam_trusted_senders WHERE email LIKE $1`, [`%-${TAG}@%`]).catch(() => {});
    await pool.end();
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  }
}

main();
