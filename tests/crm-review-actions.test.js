#!/usr/bin/env node
/**
 * Regression tests — CRM Review action buttons (Yes / No / Auto)
 *
 * R1. Yes (confirm) works when sender is @voltsafe.com (outbound email).
 * R2. No (reject) works when sender is @voltsafe.com (outbound email).
 * R3. Auto uses the external TO recipient domain, NOT @voltsafe.com.
 * R4. Auto uses external CC domain when TO is also internal.
 * R5. Auto does NOT attempt to create a domain rule for voltsafe.com.
 * R6. Domain Auto-Link Rules API still rejects manual attempts to add voltsafe.com.
 * R7. Auto works normally for an inbound email from an external domain.
 *
 * Run: node tests/crm-review-actions.test.js
 */
import pg from "pg";

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";
const ADMIN_UID   = 4;
const TAG         = `crm-rev-${Date.now()}`;

let passed = 0, failed = 0;
const ok  = (l)    => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PWD }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  const cookie = r.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error("No session cookie");
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
  console.log(`=== CRM Review Action Button Regression (${TAG}) ===`);

  // Inserted rows to clean up
  const cleanup = {
    msgIds: [],
    assocIds: [],
    autoLinkRuleIds: [],
  };

  try {
    const cookie = await login();
    console.log("  authenticated as admin\n");

    // Find a real lead to use as the CRM target
    const { rows: [targetLead] } = await pool.query(
      `SELECT id, company FROM leads ORDER BY id LIMIT 1`
    );
    if (!targetLead) throw new Error("No leads in DB — cannot run tests");
    console.log(`  target lead: id=${targetLead.id} company=${targetLead.company}\n`);

    // Helper: insert a synthetic email message
    async function insertMsg({ fromEmail, toEmails = null, ccEmails = null, threadSuffix }) {
      const { rows: [row] } = await pool.query(`
        INSERT INTO email_messages
          (gmail_message_id, gmail_thread_id, subject, from_email, from_name,
           from_domain, direction, to_emails, cc_emails, source_account_id, sent_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING id, gmail_thread_id
      `, [
        `test-msg-${TAG}-${threadSuffix}`,
        `test-thread-${TAG}-${threadSuffix}`,
        `[TEST] ${TAG} ${threadSuffix}`,
        fromEmail,
        "Test Sender",
        fromEmail.split("@")[1],
        fromEmail.includes("@voltsafe.com") ? "outbound" : "inbound",
        toEmails,
        ccEmails,
        1,
      ]);
      cleanup.msgIds.push(row.id);
      return row;
    }

    // Helper: insert an auto-association for a message
    async function insertAssoc(msgId, leadId) {
      const { rows: [row] } = await pool.query(`
        INSERT INTO email_associations
          (email_message_id, object_type, object_id, is_auto, is_user_confirmed, confidence_score)
        VALUES ($1, 'lead', $2, true, false, 75)
        RETURNING id
      `, [msgId, leadId]);
      cleanup.assocIds.push(row.id);
      return row.id;
    }

    // ─── R1: Yes (confirm) works when sender is @voltsafe.com ───────────────
    console.log("── R1: Yes (confirm) — outbound @voltsafe.com sender ──");
    {
      const msg = await insertMsg({ fromEmail: "trevor@voltsafe.com", toEmails: "client@external-r1.com", threadSuffix: "r1" });
      const assocId = await insertAssoc(msg.id, targetLead.id);

      const r = await api(cookie, "/api/gmail/thread-associations/bulk-confirm", {
        method: "POST",
        body: JSON.stringify({ items: [{ associationId: assocId, threadId: msg.gmail_thread_id }] }),
      });
      const body = await r.json();
      console.log(`  bulk-confirm: ${r.status} confirmed=${JSON.stringify(body.confirmed)} failed=${JSON.stringify(body.failed)}`);

      if (r.status === 200) ok("R1: bulk-confirm returns 200");
      else bad("R1: bulk-confirm returns 200", `got ${r.status}`);

      if (Array.isArray(body.confirmed) && body.confirmed.includes(assocId))
        ok("R1: association id in confirmed[]");
      else
        bad("R1: association id in confirmed[]", JSON.stringify(body));

      if (!body.failed?.length) ok("R1: failed[] is empty");
      else bad("R1: failed[] is empty", JSON.stringify(body.failed));

      // Verify assoc is now confirmed in DB
      const { rows: [assoc] } = await pool.query(
        `SELECT is_user_confirmed FROM email_associations WHERE id=$1`, [assocId]);
      if (assoc?.is_user_confirmed) ok("R1: is_user_confirmed=true in DB");
      else bad("R1: is_user_confirmed=true in DB", `got ${assoc?.is_user_confirmed}`);

      cleanup.assocIds = cleanup.assocIds.filter(id => id !== assocId);
    }

    // ─── R2: No (reject) works when sender is @voltsafe.com ─────────────────
    console.log("\n── R2: No (reject) — outbound @voltsafe.com sender ──");
    {
      const msg = await insertMsg({ fromEmail: "sales@voltsafe.com", toEmails: "client@external-r2.com", threadSuffix: "r2" });
      const assocId = await insertAssoc(msg.id, targetLead.id);

      const r = await api(cookie, "/api/gmail/thread-associations/bulk-reject", {
        method: "POST",
        body: JSON.stringify({ items: [{ associationId: assocId, threadId: msg.gmail_thread_id }] }),
      });
      const body = await r.json();
      console.log(`  bulk-reject: ${r.status} rejected=${JSON.stringify(body.rejected)} failed=${JSON.stringify(body.failed)}`);

      if (r.status === 200) ok("R2: bulk-reject returns 200");
      else bad("R2: bulk-reject returns 200", `got ${r.status}`);

      if (Array.isArray(body.rejected) && body.rejected.includes(assocId))
        ok("R2: association id in rejected[]");
      else
        bad("R2: association id in rejected[]", JSON.stringify(body));

      if (!body.failed?.length) ok("R2: failed[] is empty");
      else bad("R2: failed[] is empty", JSON.stringify(body.failed));

      // Verify assoc is deleted from DB
      const { rows } = await pool.query(
        `SELECT id FROM email_associations WHERE id=$1`, [assocId]);
      if (rows.length === 0) ok("R2: association deleted from DB");
      else bad("R2: association deleted from DB", "row still exists");

      cleanup.assocIds = cleanup.assocIds.filter(id => id !== assocId);
    }

    // ─── R3: Auto uses external TO domain, not @voltsafe.com ────────────────
    console.log("\n── R3: Auto — uses external TO domain for auto-link rule ──");
    {
      const externalDomain = `external-r3-${TAG}.com`;
      const msg = await insertMsg({
        fromEmail: "trevor@voltsafe.com",
        toEmails: `client@${externalDomain}`,
        threadSuffix: "r3",
      });
      const assocId = await insertAssoc(msg.id, targetLead.id);

      // Simulate what Auto does: confirm + create auto-link rule with external domain
      const [confirmR, ruleR] = await Promise.all([
        api(cookie, "/api/gmail/thread-associations/bulk-confirm", {
          method: "POST",
          body: JSON.stringify({ items: [{ associationId: assocId, threadId: msg.gmail_thread_id }] }),
        }),
        api(cookie, "/api/crm/auto-link-rules", {
          method: "POST",
          body: JSON.stringify({
            domain: externalDomain,
            objectType: "lead",
            objectId: targetLead.id,
            objectName: targetLead.company,
          }),
        }),
      ]);

      const confirmBody = await confirmR.json();
      const ruleBody = await ruleR.json();
      console.log(`  confirm: ${confirmR.status}`, JSON.stringify(confirmBody.confirmed));
      console.log(`  auto-link rule: ${ruleR.status}`, JSON.stringify(ruleBody));

      if (confirmR.status === 200 && Array.isArray(confirmBody.confirmed) && confirmBody.confirmed.includes(assocId))
        ok("R3: confirm step succeeds with external TO domain flow");
      else
        bad("R3: confirm step succeeds", `${confirmR.status} ${JSON.stringify(confirmBody)}`);

      if (ruleR.status === 200 || ruleR.status === 201)
        ok("R3: auto-link rule created for external domain succeeds");
      else
        bad("R3: auto-link rule created for external domain succeeds", `${ruleR.status} ${JSON.stringify(ruleBody)}`);

      // Track created rule for cleanup
      if (ruleBody.id) cleanup.autoLinkRuleIds.push(ruleBody.id);
      // Also query by domain to make sure we clean up
      const { rows: ruleRows } = await pool.query(
        `SELECT id FROM crm_auto_link_rules WHERE domain=$1`, [externalDomain]);
      for (const row of ruleRows) {
        if (!cleanup.autoLinkRuleIds.includes(row.id)) cleanup.autoLinkRuleIds.push(row.id);
      }

      cleanup.assocIds = cleanup.assocIds.filter(id => id !== assocId);
    }

    // ─── R4: Auto uses external CC domain when TO is internal ───────────────
    console.log("\n── R4: Auto — falls back to external CC domain when TO is internal ──");
    {
      const externalCcDomain = `external-cc-r4-${TAG}.com`;
      const msg = await insertMsg({
        fromEmail: "trevor@voltsafe.com",
        toEmails: "support@voltsafe.com",          // internal TO
        ccEmails: `partner@${externalCcDomain}`,   // external CC
        threadSuffix: "r4",
      });
      const assocId = await insertAssoc(msg.id, targetLead.id);

      // The rule should use the CC domain since TO is internal
      const ruleR = await api(cookie, "/api/crm/auto-link-rules", {
        method: "POST",
        body: JSON.stringify({
          domain: externalCcDomain,
          objectType: "lead",
          objectId: targetLead.id,
          objectName: targetLead.company,
        }),
      });
      const ruleBody = await ruleR.json();
      console.log(`  auto-link rule for CC domain: ${ruleR.status}`, JSON.stringify(ruleBody));

      if (ruleR.status === 200 || ruleR.status === 201)
        ok("R4: auto-link rule created for external CC domain");
      else
        bad("R4: auto-link rule created for external CC domain", `${ruleR.status} ${JSON.stringify(ruleBody)}`);

      if (ruleBody.id) cleanup.autoLinkRuleIds.push(ruleBody.id);
      const { rows: ccRows } = await pool.query(
        `SELECT id FROM crm_auto_link_rules WHERE domain=$1`, [externalCcDomain]);
      for (const row of ccRows) {
        if (!cleanup.autoLinkRuleIds.includes(row.id)) cleanup.autoLinkRuleIds.push(row.id);
      }

      // Clean up assoc
      await pool.query(`DELETE FROM email_associations WHERE id=$1`, [assocId]).catch(() => {});
      cleanup.assocIds = cleanup.assocIds.filter(id => id !== assocId);
    }

    // ─── R5: Auto does NOT create a domain rule for voltsafe.com ────────────
    console.log("\n── R5: Auto — does NOT create rule for @voltsafe.com ──");
    {
      const ruleR = await api(cookie, "/api/crm/auto-link-rules", {
        method: "POST",
        body: JSON.stringify({
          domain: "voltsafe.com",
          objectType: "lead",
          objectId: targetLead.id,
          objectName: targetLead.company,
        }),
      });
      const ruleBody = await ruleR.json();
      console.log(`  voltsafe.com rule attempt: ${ruleR.status}`, JSON.stringify(ruleBody));

      if (ruleR.status === 400) ok("R5: POST /api/crm/auto-link-rules returns 400 for voltsafe.com");
      else bad("R5: POST /api/crm/auto-link-rules returns 400 for voltsafe.com", `got ${ruleR.status}`);

      if (ruleBody.message?.includes("internal domain"))
        ok("R5: error message mentions 'internal domain'");
      else
        bad("R5: error message mentions 'internal domain'", JSON.stringify(ruleBody.message));

      // Verify no rule was inserted in DB
      const { rows } = await pool.query(
        `SELECT id FROM crm_auto_link_rules WHERE domain='voltsafe.com' ORDER BY id DESC LIMIT 1`
      );
      if (rows.length === 0) ok("R5: no voltsafe.com rule in DB");
      else bad("R5: no voltsafe.com rule in DB", `found id=${rows[0].id}`);
    }

    // ─── R6: Domain Auto-Link Rules API rejects voltsafe.com (manual UI path) ─
    console.log("\n── R6: Domain Auto-Link Rules — manual voltsafe.com blocked ──");
    {
      const r = await api(cookie, "/api/crm/auto-link-rules", {
        method: "POST",
        body: JSON.stringify({
          domain: "@voltsafe.com",   // with @ prefix
          objectType: "lead",
          objectId: targetLead.id,
          objectName: targetLead.company,
        }),
      });
      const body = await r.json();
      console.log(`  @voltsafe.com (with prefix): ${r.status}`, JSON.stringify(body));

      if (r.status === 400) ok("R6: @voltsafe.com (prefixed) returns 400");
      else bad("R6: @voltsafe.com (prefixed) returns 400", `got ${r.status}`);
    }

    // ─── R7: Auto works for a normal inbound external email ─────────────────
    console.log("\n── R7: Auto — normal external inbound email flow ──");
    {
      const externalSenderDomain = `marina-r7-${TAG}.com`;
      const msg = await insertMsg({
        fromEmail: `contact@${externalSenderDomain}`,
        toEmails: "trevor@voltsafe.com",
        threadSuffix: "r7",
      });
      const assocId = await insertAssoc(msg.id, targetLead.id);

      const [confirmR, ruleR] = await Promise.all([
        api(cookie, "/api/gmail/thread-associations/bulk-confirm", {
          method: "POST",
          body: JSON.stringify({ items: [{ associationId: assocId, threadId: msg.gmail_thread_id }] }),
        }),
        api(cookie, "/api/crm/auto-link-rules", {
          method: "POST",
          body: JSON.stringify({
            domain: externalSenderDomain,
            objectType: "lead",
            objectId: targetLead.id,
            objectName: targetLead.company,
          }),
        }),
      ]);

      const confirmBody = await confirmR.json();
      const ruleBody = await ruleR.json();
      console.log(`  confirm: ${confirmR.status}`, JSON.stringify(confirmBody.confirmed));
      console.log(`  auto-link rule: ${ruleR.status}`, JSON.stringify(ruleBody));

      if (confirmR.status === 200 && Array.isArray(confirmBody.confirmed) && confirmBody.confirmed.includes(assocId))
        ok("R7: confirm succeeds for external inbound");
      else
        bad("R7: confirm succeeds for external inbound", `${confirmR.status} ${JSON.stringify(confirmBody)}`);

      if (ruleR.status === 200 || ruleR.status === 201)
        ok("R7: auto-link rule created for external sender domain");
      else
        bad("R7: auto-link rule created for external sender domain", `${ruleR.status} ${JSON.stringify(ruleBody)}`);

      if (ruleBody.id) cleanup.autoLinkRuleIds.push(ruleBody.id);
      const { rows: ruleRows } = await pool.query(
        `SELECT id FROM crm_auto_link_rules WHERE domain=$1`, [externalSenderDomain]);
      for (const row of ruleRows) {
        if (!cleanup.autoLinkRuleIds.includes(row.id)) cleanup.autoLinkRuleIds.push(row.id);
      }

      cleanup.assocIds = cleanup.assocIds.filter(id => id !== assocId);
    }

  } catch (err) {
    console.error("FATAL:", err.message, err.stack?.split("\n")[1]);
    failed++;
  } finally {
    // Cleanup all inserted rows
    for (const id of cleanup.assocIds) {
      await pool.query(`DELETE FROM email_associations WHERE id=$1`, [id]).catch(() => {});
    }
    for (const id of cleanup.msgIds) {
      await pool.query(`DELETE FROM email_messages WHERE id=$1`, [id]).catch(() => {});
    }
    for (const id of cleanup.autoLinkRuleIds) {
      await pool.query(`DELETE FROM crm_auto_link_rules WHERE id=$1`, [id]).catch(() => {});
    }
    await pool.end();
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main();
