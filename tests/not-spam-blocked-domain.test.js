#!/usr/bin/env node
/**
 * Regression tests — Bug 1: Not Spam / Blocked Domain persistence fix
 *
 * B1a. Not Spam on a true Gmail-SPAM message: SPAM removed, INBOX added in DB,
 *      remainingSpam=0 in API response.
 * B1b. Not Spam on a blocked-domain (inboxOther) message: the client calls
 *      DELETE /api/email-filters/:id — verify the domain filter is permanently
 *      removed from the DB and absent from subsequent GET /api/email-filters.
 * B1c. Page-refresh persistence: two consecutive fresh GETs after deletion both
 *      confirm the domain is absent (no server-side reconstitution).
 *
 * All inserted rows are cleaned up in the finally block.
 * Run: node tests/not-spam-blocked-domain.test.js
 */
import pg from "pg";

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";
const ADMIN_UID   = 4;
const TAG         = `notspam-reg-${Date.now()}`;

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
  await sleep(400);
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
  console.log(`=== Not Spam / Blocked Domain Regression (${TAG}) ===`);

  let insertedMsgId    = null;
  let insertedFilterId = null;

  try {
    const cookie = await login();
    console.log("  authenticated as admin\n");

    // ─── B1a: Not Spam on a real SPAM-labelled message ─────────────────────
    console.log("── B1a: Not Spam on a true SPAM-labelled message ──");
    {
      // Insert a synthetic inbox message with SPAM label
      const { rows: [row] } = await pool.query(`
        INSERT INTO email_messages
          (gmail_message_id, gmail_thread_id, subject, from_email, from_name,
           from_domain, direction, label_ids, source_account_id, sent_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        RETURNING id, gmail_thread_id
      `, [
        `test-msg-${TAG}`,
        `test-thread-${TAG}`,
        `[TEST] B1a spam message ${TAG}`,
        `spammer@b1a-${TAG}.example.com`,
        "Test Spammer",
        `b1a-${TAG}.example.com`,
        "inbound",
        '["SPAM"]',
        1,
      ]);
      insertedMsgId = row.id;
      const { gmail_thread_id: threadId } = row;

      // Verify SPAM label in DB before
      const { rows: [before] } = await pool.query(
        `SELECT label_ids FROM email_messages WHERE id=$1`, [insertedMsgId]);
      console.log(`  before: id=${insertedMsgId} label_ids=${before.label_ids}`);
      if (String(before.label_ids).includes("SPAM"))
        ok("B1a-pre: message has SPAM label in DB before calling not-spam");
      else
        bad("B1a-pre: message has SPAM label in DB", `got ${before.label_ids}`);

      // Call the not-spam API
      const r = await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(threadId)}/not-spam`,
        { method: "POST", body: "{}" });
      const body = await r.json();
      console.log(`  not-spam response: ${r.status} ${JSON.stringify(body)}`);

      if (r.status === 200)            ok("B1a: not-spam returns 200");
      else                             bad("B1a: not-spam returns 200", `got ${r.status}`);
      if (body.ok === true)            ok("B1a: body.ok=true");
      else                             bad("B1a: body.ok=true", JSON.stringify(body.ok));
      if (body.remainingSpam === 0)    ok("B1a: remainingSpam=0 (all spam cleared)");
      else                             bad("B1a: remainingSpam=0", `got ${body.remainingSpam}`);
      if ((body.linkedMessageCount ?? 0) >= 1) ok(`B1a: linkedMessageCount=${body.linkedMessageCount}`);
      else                             bad("B1a: linkedMessageCount>=1", `got ${body.linkedMessageCount}`);

      // Verify DB: SPAM removed, INBOX added
      const { rows: [after] } = await pool.query(
        `SELECT label_ids FROM email_messages WHERE id=$1`, [insertedMsgId]);
      const afterLabels = JSON.parse(after.label_ids || "[]");
      console.log(`  after: label_ids=${JSON.stringify(afterLabels)}`);

      if (!afterLabels.includes("SPAM"))  ok("B1a: SPAM removed from label_ids in DB");
      else                                bad("B1a: SPAM removed from label_ids", `still SPAM: ${JSON.stringify(afterLabels)}`);
      if (afterLabels.includes("INBOX"))  ok("B1a: INBOX added to label_ids in DB");
      else                                bad("B1a: INBOX added to label_ids", `no INBOX: ${JSON.stringify(afterLabels)}`);

      // Cleanup
      await pool.query(`DELETE FROM email_messages WHERE id=$1`, [insertedMsgId]);
      insertedMsgId = null;
    }

    // ─── B1b: Blocked-domain filter DELETE removes domain persistently ─────
    console.log("\n── B1b: Blocked-domain filter DELETE removes domain persistently ──");
    {
      const testDomain = `regression-b1b-${TAG}.example.com`;

      // Insert test domain filter directly in DB
      const { rows: [ins] } = await pool.query(
        `INSERT INTO email_filters (domain, added_by) VALUES ($1,$2) RETURNING id`,
        [testDomain, ADMIN_UID]);
      insertedFilterId = ins.id;
      console.log(`  inserted filter id=${insertedFilterId}, domain=${testDomain}`);

      // Verify it appears in GET /api/email-filters
      const getR = await api(cookie, "/api/email-filters");
      const filters = await getR.json();
      console.log(`  GET /api/email-filters status=${getR.status}, count=${Array.isArray(filters) ? filters.length : "?"}`);
      const before = Array.isArray(filters) && filters.find(f => f.domain === testDomain);
      if (before) ok("B1b-pre: domain filter visible in GET /api/email-filters before deletion");
      else         bad("B1b-pre: domain filter visible before deletion", JSON.stringify(filters?.slice(-3)));

      // DELETE via API (this is exactly what the Not Spam fix calls)
      const delR = await api(cookie, `/api/email-filters/${insertedFilterId}`, { method: "DELETE" });
      const delBody = await delR.text();
      console.log(`  DELETE /api/email-filters/${insertedFilterId} → ${delR.status} ${delBody}`);
      if (delR.status === 200 || delR.status === 204) ok("B1b: DELETE returns 2xx");
      else bad("B1b: DELETE returns 2xx", `got ${delR.status}: ${delBody}`);
      insertedFilterId = null;

      // Verify domain is GONE from GET /api/email-filters
      const afterR = await api(cookie, "/api/email-filters");
      const afterFilters = await afterR.json();
      const gone = Array.isArray(afterFilters) && !afterFilters.find(f => f.domain === testDomain);
      console.log(`  after DELETE: domain present=${!gone}, total=${afterFilters.length ?? "?"}`);
      if (gone) ok("B1b: domain ABSENT from GET /api/email-filters after deletion");
      else       bad("B1b: domain absent after deletion", "domain still present");
    }

    // ─── B1c: Page-refresh persistence (two consecutive GETs, no reconstitution) ──
    console.log("\n── B1c: Page-refresh persistence — deleted filter does not come back ──");
    {
      const testDomain = `regression-b1c-${TAG}.example.com`;

      // Insert then immediately delete
      const { rows: [ins] } = await pool.query(
        `INSERT INTO email_filters (domain, added_by) VALUES ($1,$2) RETURNING id`,
        [testDomain, ADMIN_UID]);
      await api(cookie, `/api/email-filters/${ins.id}`, { method: "DELETE" });
      console.log(`  inserted id=${ins.id}, deleted, now simulating two page-refresh GETs`);

      // 1st fresh GET — simulates first page load after fix applied
      const r1 = await api(cookie, "/api/email-filters");
      const f1 = await r1.json();
      const found1 = Array.isArray(f1) && f1.some(f => f.domain === testDomain);
      console.log(`  1st GET: total=${f1.length ?? "?"}, domain_present=${found1}`);
      if (!found1) ok("B1c: domain absent on 1st fresh GET (1st page-refresh simulation)");
      else          bad("B1c: domain absent on 1st GET", "domain re-appeared");

      // 2nd fresh GET — confirms no race condition or background reinsert
      const r2 = await api(cookie, "/api/email-filters");
      const f2 = await r2.json();
      const found2 = Array.isArray(f2) && f2.some(f => f.domain === testDomain);
      console.log(`  2nd GET: total=${f2.length ?? "?"}, domain_present=${found2}`);
      if (!found2) ok("B1c: domain absent on 2nd fresh GET (no server-side reconstitution)");
      else          bad("B1c: domain absent on 2nd GET", "domain re-appeared");
    }

  } catch (err) {
    console.error("FATAL:", err.message, err.stack?.split("\n")[1]);
    failed++;
  } finally {
    if (insertedMsgId)    await pool.query(`DELETE FROM email_messages WHERE id=$1`, [insertedMsgId]).catch(() => {});
    if (insertedFilterId) await pool.query(`DELETE FROM email_filters WHERE id=$1`, [insertedFilterId]).catch(() => {});
    await pool.end();
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main();
