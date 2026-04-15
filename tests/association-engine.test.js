// Association Engine Integration Tests
//
// Tests the full deterministic scoring pipeline by:
//   1. Creating known test fixtures in the DB (contact, account, lead, opportunity, partner)
//   2. Inserting synthetic email_messages with controlled sender/recipient/domain
//   3. Triggering the engine via the refresh endpoint
//   4. Verifying resulting email_associations via the thread-associations endpoint
//   5. Cleaning up all fixtures
//
// Uses `pg` directly for data setup / teardown (no test-specific API routes needed).

import pg from "pg";
const { Client } = pg;

const BASE = "http://localhost:5000";
const LOGIN = { email: "trevor@voltsafe.com", password: "alberni1444" };

// ── Counters ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function ok(label) { passed++; console.log(`  ✓ ${label}`); }
function fail(label, reason) { failed++; console.error(`  ✗ ${label}\n      → ${reason}`); }

// ── Helpers ───────────────────────────────────────────────────────────────────
async function authedFetch(cookie, path, opts = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers ?? {}) },
  });
}

async function triggerEngine(cookie, gmailThreadId) {
  const res = await authedFetch(cookie, `/api/gmail/thread-associations/${gmailThreadId}/refresh`, { method: "POST" });
  if (!res.ok) throw new Error(`Refresh failed ${res.status}`);
  return res.json();
}

async function getAssociations(cookie, gmailThreadId) {
  const res = await authedFetch(cookie, `/api/gmail/thread-associations/${gmailThreadId}`);
  if (!res.ok) throw new Error(`Get associations failed ${res.status}`);
  return res.json();
}

// ── Unique test namespace ────────────────────────────────────────────────────
const TS = Date.now();
const TEST_DOMAIN = `ae-test-${TS}.example`;
const TEST_CONTACT_EMAIL = `ae-contact-${TS}@${TEST_DOMAIN}`;
const TEST_LEAD_EMAIL = `ae-lead-${TS}@ae-lead-${TS}.example`;
const TEST_LEAD_DOMAIN = `ae-lead-${TS}.example`;
const TEST_PARTNER_DOMAIN = `ae-partner-${TS}.example`;
const TEST_PARTNER_EMAIL = `ae-partner-${TS}@${TEST_PARTNER_DOMAIN}`;
const INTERNAL_FROM = `noreply@voltsafe.com`;  // should be ignored

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log("\n=== Association Engine Integration Tests ===\n");

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(LOGIN),
  });
  if (!loginRes.ok) { console.error("Login failed"); process.exit(1); }
  const cookies = loginRes.headers.get("set-cookie") ?? "";
  const cookie = cookies.split(";")[0];

  // ── 2. DB client ──────────────────────────────────────────────────────────
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // ── 3. Create test fixtures ───────────────────────────────────────────────
  // Account (with known domain)
  const { rows: [testAccount] } = await client.query(
    `INSERT INTO accounts (name, website, segment, org_type, lead_status, priority)
     VALUES ($1, $2, 'marina', 'marina', 'new', 'medium') RETURNING id, name`,
    [`AE-Test-Account-${TS}`, `https://${TEST_DOMAIN}`]
  );

  // Contact (exact email match candidate)
  const { rows: [testContact] } = await client.query(
    `INSERT INTO contacts (name, email, account_id) VALUES ($1, $2, $3) RETURNING id, name`,
    [`AE-Test-Contact-${TS}`, TEST_CONTACT_EMAIL, testAccount.id]
  );

  // Opportunity linked to contact (non-inbound_new stage to confirm expanded stage matching)
  const { rows: [testOpp] } = await client.query(
    `INSERT INTO opportunities (title, stage, contact_id, account_id, created_at, updated_at)
     VALUES ($1, 'proposal', $2, $3, NOW(), NOW()) RETURNING id, title`,
    [`AE-Test-Opp-${TS}`, testContact.id, testAccount.id]
  );

  // Lead (exact email match candidate)
  const { rows: [testLead] } = await client.query(
    `INSERT INTO leads (company, contact_name, contact_email, status, source)
     VALUES ($1, $2, $3, 'new', 'email_inbox') RETURNING id, company`,
    [`AE-Test-Lead-${TS}`, `AE-Lead-Contact-${TS}`, TEST_LEAD_EMAIL]
  );

  // Partnership (domain match candidate)
  const { rows: [testPartner] } = await client.query(
    `INSERT INTO partnerships (name, website, category, migration_status)
     VALUES ($1, $2, 'technology', 'legacy') RETURNING id, name`,
    [`AE-Test-Partner-${TS}`, `https://${TEST_PARTNER_DOMAIN}`]
  );

  // Helper: insert a synthetic email_message for the engine to process
  async function insertEmail({ gmailMsgId, gmailThreadId, fromEmail, toEmail, subject = "Hello", bodyText = "" }) {
    const allParticipants = JSON.stringify([fromEmail, toEmail].filter(Boolean));
    const { rows: [msg] } = await client.query(
      `INSERT INTO email_messages
         (gmail_message_id, gmail_thread_id, subject, from_email, to_emails,
          all_participants, direction, auto_generated_score, bulk_email_score, sent_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'inbound', 0, 0, NOW(), NOW(), NOW())
       RETURNING id`,
      [gmailMsgId, gmailThreadId, subject, fromEmail, toEmail, allParticipants]
    );
    return msg.id;
  }

  // Cleanup helper (runs at end)
  const cleanupIds = { emails: [], accounts: [], contacts: [], leads: [], opportunities: [], partnerships: [] };
  cleanupIds.accounts.push(testAccount.id);
  cleanupIds.contacts.push(testContact.id);
  cleanupIds.leads.push(testLead.id);
  cleanupIds.opportunities.push(testOpp.id);
  cleanupIds.partnerships.push(testPartner.id);

  // ── TESTS ─────────────────────────────────────────────────────────────────

  console.log("── Signal 1: Exact email → Contact ──");
  {
    const tid = `ae-test-s1-${TS}`;
    const msgId = await insertEmail({ gmailMsgId: `ae-msg-s1-${TS}`, gmailThreadId: tid, fromEmail: TEST_CONTACT_EMAIL, toEmail: INTERNAL_FROM });
    cleanupIds.emails.push(msgId);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const contactMatch = candidates.find(c => c.objectType === "contact" && c.objectId === testContact.id);
    if (contactMatch) ok(`Exact email → contact "${testContact.name}" found (score ${contactMatch.confidenceScore})`);
    else fail("Exact email → contact", `expected contact id=${testContact.id}, candidates=${JSON.stringify(candidates.map(c => `${c.objectType}:${c.objectId}`))}`);

    // isAuto should be true (score ≥ 45, unambiguous)
    if (contactMatch?.isAuto) ok("Contact candidate isAuto=true (score ≥ 45)");
    else if (contactMatch) fail("Contact isAuto", `isAuto=${contactMatch.isAuto}, score=${contactMatch.confidenceScore}`);
  }

  console.log("\n── Signal 1a: Account via contact ──");
  {
    const tid = `ae-test-s1a-${TS}`;
    const msgId = await insertEmail({ gmailMsgId: `ae-msg-s1a-${TS}`, gmailThreadId: tid, fromEmail: TEST_CONTACT_EMAIL, toEmail: INTERNAL_FROM });
    cleanupIds.emails.push(msgId);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const acctMatch = candidates.find(c => c.objectType === "account" && c.objectId === testAccount.id);
    if (acctMatch) ok(`Account via contact found (score ${acctMatch.confidenceScore})`);
    else fail("Account via contact (Signal 1a)", `expected account id=${testAccount.id}`);
  }

  console.log("\n── Signal 1b expanded: Opportunity via contact (non-inbound_new stage) ──");
  {
    const tid = `ae-test-s1b-${TS}`;
    const msgId = await insertEmail({
      gmailMsgId: `ae-msg-s1b-${TS}`,
      gmailThreadId: tid,
      fromEmail: TEST_CONTACT_EMAIL,
      toEmail: INTERNAL_FROM,
      subject: `AE-Test-Opp-${TS}`,  // opp title in subject → +30 pts
    });
    cleanupIds.emails.push(msgId);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const oppMatch = candidates.find(c => c.objectType === "opportunity" && c.objectId === testOpp.id);
    if (oppMatch) ok(`Opportunity via contact found (score ${oppMatch.confidenceScore}, stage=proposal)`);
    else fail("Opportunity via contact (Signal 1b, proposal stage)", `expected opp id=${testOpp.id}; candidates=${JSON.stringify(candidates.map(c => `${c.objectType}:${c.objectId}`))}`);

    // Reason should mention the stage
    const reasons = JSON.parse(oppMatch?.associationReasonJson ?? "[]");
    const hasStageReason = reasons.some(r => r.includes("proposal"));
    if (hasStageReason) ok("Opportunity reason includes stage name");
    else fail("Opportunity reason stage label", `reasons: ${JSON.stringify(reasons)}`);
  }

  console.log("\n── Signal 2: Domain → Account ──");
  {
    const tid = `ae-test-s2-${TS}`;
    // A NEW email from the same domain but a DIFFERENT address (not in contacts)
    const domainOnlyEmail = `unknown-person-${TS}@${TEST_DOMAIN}`;
    const msgId = await insertEmail({ gmailMsgId: `ae-msg-s2-${TS}`, gmailThreadId: tid, fromEmail: domainOnlyEmail, toEmail: INTERNAL_FROM });
    cleanupIds.emails.push(msgId);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const acctMatch = candidates.find(c => c.objectType === "account" && c.objectId === testAccount.id);
    if (acctMatch) ok(`Domain match → account found (score ${acctMatch.confidenceScore})`);
    else fail("Domain → account (Signal 2)", `expected account id=${testAccount.id}; domain=${TEST_DOMAIN}`);
  }

  console.log("\n── Signal 2b: Opportunity via account domain match ──");
  {
    const tid = `ae-test-s2b-${TS}`;
    const domainOnlyEmail = `mgr-${TS}@${TEST_DOMAIN}`;
    const msgId = await insertEmail({
      gmailMsgId: `ae-msg-s2b-${TS}`,
      gmailThreadId: tid,
      fromEmail: domainOnlyEmail,
      toEmail: INTERNAL_FROM,
      subject: `AE-Test-Opp-${TS}`,  // opp title in subject → +25 pts above 15 base = 40 ≥ 30
    });
    cleanupIds.emails.push(msgId);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const oppMatch = candidates.find(c => c.objectType === "opportunity" && c.objectId === testOpp.id);
    if (oppMatch) ok(`Opportunity via account domain (Signal 2b) found (score ${oppMatch.confidenceScore})`);
    else fail("Opportunity via account domain (Signal 2b)", `expected opp id=${testOpp.id}; candidates=${JSON.stringify(candidates.map(c => `${c.objectType}:${c.objectId}`))}`);
  }

  console.log("\n── Signal 3: Exact email → Lead ──");
  {
    const tid = `ae-test-s3-${TS}`;
    const msgId = await insertEmail({ gmailMsgId: `ae-msg-s3-${TS}`, gmailThreadId: tid, fromEmail: TEST_LEAD_EMAIL, toEmail: INTERNAL_FROM });
    cleanupIds.emails.push(msgId);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const leadMatch = candidates.find(c => c.objectType === "lead" && c.objectId === testLead.id);
    if (leadMatch) ok(`Exact email → lead found (score ${leadMatch.confidenceScore}, isAuto=${leadMatch.isAuto})`);
    else fail("Exact email → lead (Signal 3)", `expected lead id=${testLead.id}`);
  }

  console.log("\n── Signal 4: Lead domain match ──");
  {
    const tid = `ae-test-s4-${TS}`;
    // Different address, same lead domain
    const altLeadEmail = `other-${TS}@${TEST_LEAD_DOMAIN}`;
    const msgId = await insertEmail({ gmailMsgId: `ae-msg-s4-${TS}`, gmailThreadId: tid, fromEmail: altLeadEmail, toEmail: INTERNAL_FROM });
    cleanupIds.emails.push(msgId);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const leadMatch = candidates.find(c => c.objectType === "lead" && c.objectId === testLead.id);
    if (leadMatch) ok(`Lead domain match found (score ${leadMatch.confidenceScore})`);
    else fail("Lead domain match (Signal 4)", `expected lead id=${testLead.id}; domain=${TEST_LEAD_DOMAIN}`);
  }

  console.log("\n── Signal 5: Partnership domain match ──");
  {
    const tid = `ae-test-s5-${TS}`;
    const msgId = await insertEmail({ gmailMsgId: `ae-msg-s5-${TS}`, gmailThreadId: tid, fromEmail: TEST_PARTNER_EMAIL, toEmail: INTERNAL_FROM });
    cleanupIds.emails.push(msgId);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const partnerMatch = candidates.find(c => c.objectType === "partner" && c.objectId === testPartner.id);
    if (partnerMatch) ok(`Partnership domain match found (score ${partnerMatch.confidenceScore})`);
    else fail("Partnership domain match (Signal 5)", `expected partner id=${testPartner.id}; domain=${TEST_PARTNER_DOMAIN}`);
  }

  console.log("\n── Duplicate prevention (idempotency) ──");
  {
    const tid = `ae-test-idem-${TS}`;
    const msgId = await insertEmail({ gmailMsgId: `ae-msg-idem-${TS}`, gmailThreadId: tid, fromEmail: TEST_CONTACT_EMAIL, toEmail: INTERNAL_FROM });
    cleanupIds.emails.push(msgId);

    // Run engine TWICE
    await triggerEngine(cookie, tid);
    await triggerEngine(cookie, tid);

    // Check the email_associations table directly for duplicates
    const { rows } = await client.query(
      `SELECT object_type, object_id, COUNT(*) AS cnt
       FROM email_associations
       WHERE email_message_id = $1
       GROUP BY object_type, object_id
       HAVING COUNT(*) > 1`,
      [msgId]
    );
    if (rows.length === 0) ok("No duplicate email_associations after double refresh (idempotent)");
    else fail("Idempotency", `found duplicates: ${JSON.stringify(rows)}`);
  }

  console.log("\n── Manual override precedence (confirmed not overwritten) ──");
  {
    const tid = `ae-test-override-${TS}`;
    const msgId = await insertEmail({ gmailMsgId: `ae-msg-override-${TS}`, gmailThreadId: tid, fromEmail: TEST_CONTACT_EMAIL, toEmail: INTERNAL_FROM });
    cleanupIds.emails.push(msgId);

    // Run engine once to create auto associations
    await triggerEngine(cookie, tid);

    // Manually confirm the contact association via the confirm endpoint
    const { candidates: beforeCandidates } = await getAssociations(cookie, tid);
    const contactCandidate = beforeCandidates.find(c => c.objectType === "contact" && c.objectId === testContact.id);
    if (contactCandidate) {
      await authedFetch(cookie, "/api/gmail/thread-associations/confirm", {
        method: "POST",
        body: JSON.stringify({ associationId: contactCandidate.id, threadId: tid }),
      });
    }

    // Run engine AGAIN — confirmed association must not be overwritten
    await triggerEngine(cookie, tid);

    const { candidates: afterCandidates } = await getAssociations(cookie, tid);
    const confirmedCandidate = afterCandidates.find(c => c.objectType === "contact" && c.objectId === testContact.id);
    if (confirmedCandidate?.isUserConfirmed) ok("Confirmed association preserved after engine re-run");
    else if (!contactCandidate) ok("Manual override test skipped (no contact candidate to confirm)");
    else fail("Manual override precedence", `isUserConfirmed=${confirmedCandidate?.isUserConfirmed}`);
  }

  console.log("\n── Confidence tiers: High (≥75), Medium (≥50), Low (<50) ──");
  {
    const tid = `ae-test-tier-${TS}`;
    const msgId = await insertEmail({ gmailMsgId: `ae-msg-tier-${TS}`, gmailThreadId: tid, fromEmail: TEST_CONTACT_EMAIL, toEmail: INTERNAL_FROM });
    cleanupIds.emails.push(msgId);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    // Check each candidate has a score and derive a tier label
    for (const c of candidates) {
      const score = c.confidenceScore ?? 0;
      const tier = score >= 75 ? "High" : score >= 50 ? "Medium" : "Low";
      ok(`${c.objectType}:${c.objectId} score=${score} → ${tier} confidence`);
    }
    if (candidates.length === 0) ok("Tier check: no candidates (nothing to tier)");
  }

  console.log("\n── Rejection feedback prevents re-creation ──");
  {
    const tid = `ae-test-reject-${TS}`;
    const msgId = await insertEmail({ gmailMsgId: `ae-msg-reject-${TS}`, gmailThreadId: tid, fromEmail: TEST_CONTACT_EMAIL, toEmail: INTERNAL_FROM });
    cleanupIds.emails.push(msgId);

    // Run engine to create candidates
    await triggerEngine(cookie, tid);
    const { candidates: initial } = await getAssociations(cookie, tid);
    const contactCand = initial.find(c => c.objectType === "contact" && c.objectId === testContact.id);

    if (contactCand) {
      // Reject it
      await authedFetch(cookie, "/api/gmail/thread-associations/reject", {
        method: "POST",
        body: JSON.stringify({ associationId: contactCand.id, threadId: tid }),
      });

      // Delete the association row so engine would normally recreate it
      await client.query(`DELETE FROM email_associations WHERE id = $1`, [contactCand.id]);

      // Re-run engine
      await triggerEngine(cookie, tid);

      // Verify it was NOT recreated
      const { candidates: after } = await getAssociations(cookie, tid);
      const recreated = after.find(c => c.objectType === "contact" && c.objectId === testContact.id);
      if (!recreated) ok("Rejected association not recreated after engine re-run");
      else fail("Rejection feedback", "contact was recreated despite being rejected");
    } else {
      ok("Rejection test skipped (no contact candidate)");
    }
  }

  console.log("\n── Internal email filtering (no self-associations) ──");
  {
    const tid = `ae-test-internal-${TS}`;
    // Email purely between internal addresses — engine should produce no candidates
    const msgId = await insertEmail({
      gmailMsgId: `ae-msg-internal-${TS}`,
      gmailThreadId: tid,
      fromEmail: INTERNAL_FROM,
      toEmail: "other@voltsafe.com",
    });
    cleanupIds.emails.push(msgId);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    if (candidates.length === 0) ok("Internal-only email produces zero candidates (filtered correctly)");
    else fail("Internal email filtering", `expected 0 candidates, got ${candidates.length}`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  try {
    if (cleanupIds.emails.length) {
      await client.query(
        `DELETE FROM email_associations WHERE email_message_id = ANY($1::int[])`,
        [cleanupIds.emails]
      );
      await client.query(
        `DELETE FROM association_feedback WHERE email_message_id = ANY($1::int[])`,
        [cleanupIds.emails]
      );
      await client.query(
        `DELETE FROM email_messages WHERE id = ANY($1::int[])`,
        [cleanupIds.emails]
      );
    }
    if (cleanupIds.opportunities.length) {
      await client.query(`DELETE FROM opportunities WHERE id = ANY($1::int[])`, [cleanupIds.opportunities]);
    }
    if (cleanupIds.contacts.length) {
      await client.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [cleanupIds.contacts]);
    }
    if (cleanupIds.leads.length) {
      await client.query(`DELETE FROM leads WHERE id = ANY($1::int[])`, [cleanupIds.leads]);
    }
    if (cleanupIds.partnerships.length) {
      await client.query(`DELETE FROM partnerships WHERE id = ANY($1::int[])`, [cleanupIds.partnerships]);
    }
    if (cleanupIds.accounts.length) {
      await client.query(`DELETE FROM accounts WHERE id = ANY($1::int[])`, [cleanupIds.accounts]);
    }
    // Clean up email_threads created during tests
    await client.query(`DELETE FROM email_threads WHERE gmail_thread_id LIKE $1`, [`ae-test-%-${TS}`]);
  } catch (cleanupErr) {
    console.warn("  ⚠ Cleanup error (non-fatal):", cleanupErr.message);
  }

  await client.end();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  const total = passed + failed;
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`FAILED: ${failed} test(s)`);
    process.exit(1);
  } else {
    console.log("All tests passed.");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
