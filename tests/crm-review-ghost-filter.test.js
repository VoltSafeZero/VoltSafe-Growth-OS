#!/usr/bin/env node
/**
 * Regression test — CRM Review ghost/duplicate row filter
 *
 * Verifies that /api/gmail/review-queue:
 *   (A) excludes phantom messages that have no subject, no snippet, no body, and
 *       no attachments — even when they have an auto-association to a CRM lead.
 *   (B) still shows a legitimate (no subject) email when it HAS body content.
 *   (C) still shows the real paired message when a ghost duplicate is present.
 *
 * Fixture layout (all rows scoped to TAG so parallel test runs never collide):
 *
 *   lead_A           — CRM target for scenarios A + C
 *   thread_REAL      — real message: has subject + snippet → must appear
 *   thread_GHOST     — ghost message: all content null/false → must NOT appear
 *   lead_B           — CRM target for scenario B
 *   thread_NOSUBJECT — no subject but has body_text → must appear (legitimate)
 *
 * All fixtures are deleted in the finally block.
 *
 * Run: node tests/crm-review-ghost-filter.test.js
 */

import pg from "pg";
const { Client } = pg;

const BASE = "http://localhost:5000";
const LOGIN = { email: "trevor@voltsafe.com", password: "alberni1444" };
const TAG = `crm-rev-ghost-${Date.now()}`;

let passed = 0;
let failed = 0;
function ok(label)           { passed++; console.log(`  ✓ ${label}`); }
function fail(label, reason) { failed++; console.error(`  ✗ ${label}\n      → ${reason}`); }

async function authedFetch(cookie, path, opts = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE, ...(opts.headers ?? {}) },
  });
}

async function run() {
  console.log(`\n=== CRM Review Ghost-Row Filter Regression (${TAG}) ===\n`);

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify(LOGIN),
  });
  if (!loginRes.ok) {
    console.error(`FATAL: login failed (${loginRes.status})`);
    process.exit(1);
  }
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] ?? "";

  // ── DB client ────────────────────────────────────────────────────────────────
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Track everything we insert for cleanup
  const cleanupMsgIds  = [];
  const cleanupLeadIds = [];

  try {
    // ─── Seed: CRM lead A (target for real + ghost pair) ─────────────────────
    const { rows: [leadA] } = await client.query(
      `INSERT INTO leads (company, contact_name, contact_email, status, source)
       VALUES ($1, $2, $3, 'new', 'inbound')
       RETURNING id`,
      [`Ghost-Test-Marina-A-${TAG}`, `Test Contact A ${TAG}`, `a@${TAG}.example.com`]
    );
    cleanupLeadIds.push(leadA.id);

    // ─── Seed: real message (has subject + snippet) ───────────────────────────
    const { rows: [realMsg] } = await client.query(
      `INSERT INTO email_messages
         (gmail_message_id, gmail_thread_id, subject, snippet,
          from_email, from_name, from_domain, direction,
          body_html, body_text, has_attachments, label_ids, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       RETURNING id`,
      [
        `real-msg-${TAG}`,
        `real-thread-${TAG}`,
        `Briefly stopping by marina end of next week`,
        `Hi, I am in the area…`,
        `trevor@voltsafe.com`,
        `Trevor`,
        `voltsafe.com`,
        `outbound`,
        `<p>Hi, I am in the area…</p>`,
        `Hi, I am in the area…`,
        false,
        `SENT`,
      ]
    );
    cleanupMsgIds.push(realMsg.id);

    // ─── Seed: ghost message (all content null/empty, hasAttachments=false) ───
    const { rows: [ghostMsg] } = await client.query(
      `INSERT INTO email_messages
         (gmail_message_id, gmail_thread_id, subject, snippet,
          from_email, from_name, from_domain, direction,
          body_html, body_text, has_attachments, label_ids, sent_at)
       VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, NULL, NULL, false, $7, NOW())
       RETURNING id`,
      [
        `ghost-msg-${TAG}`,
        `ghost-thread-${TAG}`,
        `trevor@voltsafe.com`,
        `Trevor`,
        `voltsafe.com`,
        `outbound`,
        `SENT`,
      ]
    );
    cleanupMsgIds.push(ghostMsg.id);

    // ─── Seed associations for both messages → same lead A ───────────────────
    await client.query(
      `INSERT INTO email_associations
         (email_message_id, object_type, object_id, object_name,
          confidence_score, is_auto, is_user_confirmed)
       VALUES ($1, 'lead', $2, $3, 55, true, false),
              ($4, 'lead', $2, $3, 55, true, false)`,
      [realMsg.id, leadA.id, `Ghost-Test-Marina-A-${TAG}`, ghostMsg.id]
    );

    // ─── Seed: lead B (target for legitimate no-subject scenario) ────────────
    const { rows: [leadB] } = await client.query(
      `INSERT INTO leads (company, contact_name, contact_email, status, source)
       VALUES ($1, $2, $3, 'new', 'inbound')
       RETURNING id`,
      [`Ghost-Test-Marina-B-${TAG}`, `Test Contact B ${TAG}`, `b@${TAG}.example.com`]
    );
    cleanupLeadIds.push(leadB.id);

    // ─── Seed: legitimate no-subject message that HAS body_text ──────────────
    const { rows: [noSubjectMsg] } = await client.query(
      `INSERT INTO email_messages
         (gmail_message_id, gmail_thread_id, subject, snippet,
          from_email, from_name, from_domain, direction,
          body_html, body_text, has_attachments, label_ids, sent_at)
       VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, NULL, $7, false, $8, NOW())
       RETURNING id`,
      [
        `nosubject-msg-${TAG}`,
        `nosubject-thread-${TAG}`,
        `trevor@voltsafe.com`,
        `Trevor`,
        `voltsafe.com`,
        `outbound`,
        `This email intentionally has no subject but has a body.`,
        `SENT`,
      ]
    );
    cleanupMsgIds.push(noSubjectMsg.id);

    // Association for no-subject message → lead B
    await client.query(
      `INSERT INTO email_associations
         (email_message_id, object_type, object_id, object_name,
          confidence_score, is_auto, is_user_confirmed)
       VALUES ($1, 'lead', $2, $3, 60, true, false)`,
      [noSubjectMsg.id, leadB.id, `Ghost-Test-Marina-B-${TAG}`]
    );

    // ─── Fetch the review queue ───────────────────────────────────────────────
    const reviewRes = await authedFetch(cookie, "/api/gmail/review-queue?limit=100");
    if (!reviewRes.ok) {
      fail("GET /api/gmail/review-queue returns 200", `status ${reviewRes.status}`);
      return;
    }
    ok("GET /api/gmail/review-queue returns 200");
    const { items } = await reviewRes.json();

    const threadIds = items.map(i => i.gmailThreadId);

    // ─── Assertion A: ghost thread absent ────────────────────────────────────
    if (!threadIds.includes(`ghost-thread-${TAG}`)) {
      ok("Ghost thread (no subject/snippet/body/attachments) is excluded from review queue");
    } else {
      fail(
        "Ghost thread (no subject/snippet/body/attachments) is excluded from review queue",
        "ghost-thread appeared in the queue — phantom row was NOT filtered"
      );
    }

    // ─── Assertion B: real paired thread present ──────────────────────────────
    if (threadIds.includes(`real-thread-${TAG}`)) {
      ok("Real paired thread (has subject + snippet) still appears in review queue");
    } else {
      fail(
        "Real paired thread (has subject + snippet) still appears in review queue",
        "real-thread was missing — ghost filter may be too aggressive"
      );
    }

    // ─── Assertion C: legitimate no-subject thread present ───────────────────
    if (threadIds.includes(`nosubject-thread-${TAG}`)) {
      ok("Legitimate no-subject thread (has body_text) still appears in review queue");
    } else {
      fail(
        "Legitimate no-subject thread (has body_text) still appears in review queue",
        "nosubject-thread was missing — filter incorrectly dropped an email with body content"
      );
    }

    // ─── Assertion D: dedup — only one entry for lead A ──────────────────────
    // Both real-thread and ghost-thread point to lead A. After dedup the ghost is
    // dropped. Only real-thread should appear; lead A should appear exactly once.
    const leadAItems = items.filter(
      i => i.topCandidate?.objectId === leadA.id && i.topCandidate?.objectType === "lead"
    );
    if (leadAItems.length === 1) {
      ok("Lead A has exactly one review queue entry (dedup removed the ghost duplicate)");
    } else if (leadAItems.length === 0) {
      fail(
        "Lead A has exactly one review queue entry (dedup removed the ghost duplicate)",
        "Lead A has zero entries — real message was unexpectedly dropped"
      );
    } else {
      fail(
        "Lead A has exactly one review queue entry (dedup removed the ghost duplicate)",
        `Lead A has ${leadAItems.length} entries — ghost dedup did not fire`
      );
    }

    // ─── Assertion E: the surviving lead A entry is the real message ──────────
    if (leadAItems.length === 1) {
      const surviving = leadAItems[0];
      const hasContent =
        (surviving.latestMessage.subject?.trim() ?? "").length > 0 ||
        (surviving.latestMessage.snippet?.trim() ?? "").length > 0;
      if (hasContent) {
        ok("Surviving lead A entry has subject/snippet (real message, not ghost)");
      } else {
        fail(
          "Surviving lead A entry has subject/snippet (real message, not ghost)",
          `subject='${surviving.latestMessage.subject}' snippet='${surviving.latestMessage.snippet}'`
        );
      }
    }

  } finally {
    // ─── Cleanup ─────────────────────────────────────────────────────────────
    try {
      if (cleanupMsgIds.length) {
        await client.query(
          `DELETE FROM email_associations WHERE email_message_id = ANY($1::int[])`,
          [cleanupMsgIds]
        );
        await client.query(
          `DELETE FROM email_messages WHERE id = ANY($1::int[])`,
          [cleanupMsgIds]
        );
      }
      if (cleanupLeadIds.length) {
        await client.query(
          `DELETE FROM leads WHERE id = ANY($1::int[])`,
          [cleanupLeadIds]
        );
      }
      await client.query(
        `DELETE FROM email_threads WHERE gmail_thread_id LIKE $1`,
        [`%-thread-${TAG}`]
      );
    } catch (cleanupErr) {
      console.warn("  ⚠ Cleanup error (non-fatal):", cleanupErr.message);
    }
    await client.end();
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(55)}`);
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
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
