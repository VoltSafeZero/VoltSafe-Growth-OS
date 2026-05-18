#!/usr/bin/env node
// Signal 4b Regression Tests — Domain-token → Name fallback
//
// Verifies the hard prerequisite added to Signal 4b of the CRM association
// engine: an account or lead whose name contains the sender's domain token
// must ALSO have that name appear in the email subject or body before a
// candidate is created.
//
// This prevents @columbia.edu from matching every marina named "Columbia X".
//
// Uses the same fixture + API pattern as tests/association-engine.test.js.
// Run with: node tests/association-engine-signal4b.test.js

import pg from "pg";
const { Client } = pg;

const BASE  = "http://localhost:5000";
const LOGIN = { email: "trevor@voltsafe.com", password: "alberni1444" };

// The CSRF guard requires an Origin header for all POST requests.
// In dev mode, localhost:5000 is on the allowlist (server/csrf.ts).
const DEV_ORIGIN = "http://localhost:5000";

let passed = 0;
let failed = 0;
function ok(label)          { passed++; console.log(`  ✓ ${label}`); }
function fail(label, reason){ failed++; console.error(`  ✗ ${label}\n      → ${reason}`); }

async function authedFetch(cookie, path, opts = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Origin": DEV_ORIGIN,
      "Cookie": cookie,
      ...(opts.headers ?? {}),
    },
  });
}

async function triggerEngine(cookie, gmailThreadId) {
  const res = await authedFetch(cookie, `/api/gmail/thread-associations/${gmailThreadId}/refresh`, { method: "POST" });
  if (!res.ok) throw new Error(`Refresh failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getAssociations(cookie, gmailThreadId) {
  const res = await authedFetch(cookie, `/api/gmail/thread-associations/${gmailThreadId}`);
  if (!res.ok) throw new Error(`Get associations failed ${res.status}`);
  return res.json();
}

// ── Unique namespace ─────────────────────────────────────────────────────────
// Using a long timestamp-based token prevents any accidental ILIKE collision
// with real records in the database.
//
// Key invariant: the DOMAIN BASE (domain.split(".")[0]) must be a literal
// substring of both entity names so that ILIKE '%<base>%' matches them.
// Here the domain base is `ae4b-<TS>` and both names start with `AE4b-<TS>`
// so ILIKE '%ae4b-<TS>%' (case-insensitive) will find them.
const TS            = Date.now();
const BASE_TOKEN    = `ae4b-${TS}`;                   // IS the domain base AND a substring of names
const SENDER_DOMAIN = `${BASE_TOKEN}.testdomain.io`;  // split(".")[0] === BASE_TOKEN
const SENDER_EMAIL  = `info@${SENDER_DOMAIN}`;

// CRM entity names — both contain BASE_TOKEN as a literal prefix substring
const ACCT_NAME = `AE4b-${TS} Marina`;   // lowercase: "ae4b-<TS> marina" ⊇ "ae4b-<TS>"
const LEAD_NAME = `AE4b-${TS} Lead Co`;  // lowercase: "ae4b-<TS> lead co" ⊇ "ae4b-<TS>"

const INTERNAL_FROM = "noreply@voltsafe.com";

async function run() {
  console.log("\n=== Signal 4b Regression Tests (domain-token ← name prerequisite) ===\n");

  // ── Auth ──────────────────────────────────────────────────────────────────
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": DEV_ORIGIN,
    },
    body: JSON.stringify(LOGIN),
  });
  if (!loginRes.ok) {
    const body = await loginRes.text().catch(() => "");
    console.error(`Login failed (${loginRes.status}): ${body.slice(0, 200)}`);
    process.exit(1);
  }
  const cookies = loginRes.headers.get("set-cookie") ?? "";
  const cookie  = cookies.split(";")[0];
  await new Promise(r => setTimeout(r, 400)); // wait for session commit

  // ── DB client ─────────────────────────────────────────────────────────────
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // ── Create fixtures ───────────────────────────────────────────────────────
  // Account: name contains BASE_TOKEN; NO website → Signal 2 (website match) won't fire
  const { rows: [testAccount] } = await client.query(
    `INSERT INTO accounts (name, segment, org_type, lead_status, priority)
     VALUES ($1, 'marina', 'marina', 'new', 'medium') RETURNING id, name`,
    [ACCT_NAME]
  );

  // Lead: company contains BASE_TOKEN; NO contactEmail → Signals 3/4 won't fire
  const { rows: [testLead] } = await client.query(
    `INSERT INTO leads (company, contact_name, status, source)
     VALUES ($1, $2, 'new', 'email_inbox') RETURNING id, company`,
    [LEAD_NAME, `AE4b-Contact-${TS}`]
  );

  const cleanupEmails = [];

  // Helper: insert a synthetic email_message with optional body_text
  async function insertEmail({ gmailMsgId, gmailThreadId, subject = "Hello", bodyText = "" }) {
    const allParticipants = JSON.stringify([SENDER_EMAIL, INTERNAL_FROM]);
    const { rows: [msg] } = await client.query(
      `INSERT INTO email_messages
         (gmail_message_id, gmail_thread_id, subject, body_text, from_email, to_emails,
          all_participants, direction, auto_generated_score, bulk_email_score,
          sent_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'inbound', 0, 0, NOW(), NOW(), NOW())
       RETURNING id`,
      [gmailMsgId, gmailThreadId, subject, bodyText,
       SENDER_EMAIL, INTERNAL_FROM, allParticipants]
    );
    cleanupEmails.push(msg.id);
    return msg.id;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST SUITE
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Test 4b-A: Name NOT in subject/body → no candidate created ─────────
  console.log("── 4b-A: Name absent from email content → NO candidate (hard prerequisite) ──");
  {
    const tid = `ae4b-a-${TS}`;
    await insertEmail({
      gmailMsgId: `ae4b-a-msg-${TS}`,
      gmailThreadId: tid,
      subject: "Just checking in",         // does NOT mention ACCT_NAME or LEAD_NAME
      bodyText: "Hope you are well.",       // does NOT mention either name
    });

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const acctCand = candidates.find(c => c.objectType === "account" && c.objectId === testAccount.id);
    if (!acctCand)
      ok(`No account candidate when "${ACCT_NAME}" absent from email content`);
    else
      fail(
        "Account candidate must be absent when name not in content (4b prerequisite)",
        `got score=${acctCand.confidenceScore} reasons=${JSON.stringify(acctCand.reasons ?? [])}`
      );

    const leadCand = candidates.find(c => c.objectType === "lead" && c.objectId === testLead.id);
    if (!leadCand)
      ok(`No lead candidate when "${LEAD_NAME}" absent from email content`);
    else
      fail(
        "Lead candidate must be absent when company name not in content",
        `got score=${leadCand.confidenceScore}`
      );
  }

  // ── Test 4b-B: Account name in SUBJECT → candidate created ────────────
  console.log("\n── 4b-B: Account name in subject → candidate IS created (score ≥ 25) ──");
  {
    const tid = `ae4b-b-${TS}`;
    await insertEmail({
      gmailMsgId: `ae4b-b-msg-${TS}`,
      gmailThreadId: tid,
      subject: `Inquiry from ${ACCT_NAME}`,  // name IS in subject
      bodyText: "Please review the attached.",
    });

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const acctCand = candidates.find(c => c.objectType === "account" && c.objectId === testAccount.id);
    if (acctCand && (acctCand.confidenceScore ?? 0) >= 25)
      ok(`Account candidate created (score=${acctCand.confidenceScore}) when name in subject`);
    else if (acctCand)
      fail("Account candidate score below 25", `score=${acctCand.confidenceScore}`);
    else
      fail(
        "Account candidate should be created when name appears in subject",
        `candidates=${JSON.stringify(candidates.map(c => `${c.objectType}:${c.objectId}:${c.confidenceScore}`))}`
      );

    // Verify reasons include a content-evidence marker
    const reasons = acctCand
      ? (acctCand.reasons ?? JSON.parse(acctCand.associationReasonJson ?? "[]"))
      : [];
    const hasContentReason = reasons.some(r => /subject|body|content|confirmed/i.test(r));
    if (acctCand && hasContentReason)
      ok("Account candidate reasons include content-evidence marker");
    else if (acctCand)
      fail("Account candidate reason missing content evidence", `reasons=${JSON.stringify(reasons)}`);
  }

  // ── Test 4b-C: Lead company name in BODY → candidate created ──────────
  console.log("\n── 4b-C: Lead company name in body → candidate IS created (score ≥ 25) ──");
  {
    const tid = `ae4b-c-${TS}`;
    await insertEmail({
      gmailMsgId: `ae4b-c-msg-${TS}`,
      gmailThreadId: tid,
      subject: "Follow-up",
      bodyText: `We represent ${LEAD_NAME} and would like to discuss charging installation.`,
    });

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const leadCand = candidates.find(c => c.objectType === "lead" && c.objectId === testLead.id);
    if (leadCand && (leadCand.confidenceScore ?? 0) >= 25)
      ok(`Lead candidate created (score=${leadCand.confidenceScore}) when company name in body`);
    else if (leadCand)
      fail("Lead candidate score below 25", `score=${leadCand.confidenceScore}`);
    else
      fail(
        "Lead candidate should be created when company name appears in body",
        `candidates=${JSON.stringify(candidates.map(c => `${c.objectType}:${c.objectId}:${c.confidenceScore}`))}`
      );
  }

  // ── Test 4b-D: High bulk-email score → candidate filtered out ─────────
  console.log("\n── 4b-D: Name in content but bulk-email penalty drops score below minimum ──");
  {
    const tid = `ae4b-d-${TS}`;
    // bulk_email_score = 90 → applyPenalties subtracts 60 → 33 - 60 = -27 < 25
    const allParticipants = JSON.stringify([SENDER_EMAIL, INTERNAL_FROM]);
    const { rows: [msg] } = await client.query(
      `INSERT INTO email_messages
         (gmail_message_id, gmail_thread_id, subject, body_text, from_email, to_emails,
          all_participants, direction, auto_generated_score, bulk_email_score,
          sent_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'inbound', 0, 90, NOW(), NOW(), NOW())
       RETURNING id`,
      [
        `ae4b-d-msg-${TS}`, tid,
        `Unsubscribe from ${ACCT_NAME} newsletter`,
        `You are receiving this from ${ACCT_NAME}. Click to unsubscribe.`,
        SENDER_EMAIL, INTERNAL_FROM, allParticipants,
      ]
    );
    cleanupEmails.push(msg.id);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const acctCand = candidates.find(c => c.objectType === "account" && c.objectId === testAccount.id);
    if (!acctCand)
      ok("Bulk-email penalty (−60) drops 4b candidate below minimum 25 threshold (not stored)");
    else
      fail(
        "High bulk-email score candidate should be filtered by minimum score",
        `score=${acctCand.confidenceScore} (expected no candidate; 33 − 60 = −27 < 25)`
      );
  }

  // ── Test 4b-E: Domain base token shorter than 4 chars → skipped ───────
  console.log("\n── 4b-E: Domain base < 4 chars → Signal 4b skipped entirely ──");
  {
    const tid = `ae4b-e-${TS}`;
    // Domain "ab.testdomain.io" → base = "ab" (length 2) → fails the length guard
    const allParticipants = JSON.stringify([`info@ab.testdomain.io`, INTERNAL_FROM]);
    const { rows: [msg] } = await client.query(
      `INSERT INTO email_messages
         (gmail_message_id, gmail_thread_id, subject, body_text, from_email, to_emails,
          all_participants, direction, auto_generated_score, bulk_email_score,
          sent_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'inbound', 0, 0, NOW(), NOW(), NOW())
       RETURNING id`,
      [
        `ae4b-e-msg-${TS}`, tid,
        "Short domain test",
        "Nothing relevant.",
        `info@ab.testdomain.io`, INTERNAL_FROM, allParticipants,
      ]
    );
    cleanupEmails.push(msg.id);

    await triggerEngine(cookie, tid);
    const { candidates } = await getAssociations(cookie, tid);

    const spurious = candidates.filter(c =>
      (c.objectType === "account" && c.objectId === testAccount.id) ||
      (c.objectType === "lead"    && c.objectId === testLead.id)
    );
    if (spurious.length === 0)
      ok("Domain token shorter than 4 chars correctly skipped — no candidates");
    else
      fail("Short token should be skipped", `found ${spurious.length} spurious candidates`);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  try {
    if (cleanupEmails.length) {
      await client.query(
        `DELETE FROM email_associations WHERE email_message_id = ANY($1::int[])`,
        [cleanupEmails]
      );
      await client.query(
        `DELETE FROM association_feedback WHERE email_message_id = ANY($1::int[])`,
        [cleanupEmails]
      );
      await client.query(
        `DELETE FROM email_messages WHERE id = ANY($1::int[])`,
        [cleanupEmails]
      );
    }
    await client.query(`DELETE FROM leads    WHERE id = $1`, [testLead.id]);
    await client.query(`DELETE FROM accounts WHERE id = $1`, [testAccount.id]);
    await client.query(
      `DELETE FROM email_threads WHERE gmail_thread_id LIKE $1`,
      [`ae4b-%-${TS}`]
    );
  } catch (e) {
    console.warn("  ⚠ Cleanup error (non-fatal):", e.message);
  }
  await client.end();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  const total = passed + failed;
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`FAILED: ${failed} test(s)`);
    process.exit(1);
  } else {
    console.log("All Signal 4b tests passed.");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
