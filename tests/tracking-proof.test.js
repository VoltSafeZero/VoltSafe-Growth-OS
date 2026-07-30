#!/usr/bin/env node
/**
 * End-to-end Open-Tracking Proof   [E2E SMOKE TEST — requires live Gmail OAuth]
 *
 * Sends one real tracked HTML email from Cortex (Trevor's account) to Trevor's
 * own inbox, then exercises every link in the open-tracking chain and prints
 * raw evidence at every stage. Designed to be re-runnable; cleans up the DB
 * rows it creates (the actual Gmail message remains in Trevor's Sent folder).
 *
 * CLASSIFICATION: E2E smoke test — NOT a deterministic unit/integration test.
 *   - Requires valid Gmail OAuth for trevor@voltsafe.com in the environment.
 *   - Should NOT be run in CI without dedicated test-Gmail credentials.
 *   - Will be SKIPPED (exit 0) unless GMAIL_E2E_ENABLED=1 is set explicitly.
 *
 * Run:
 *   GMAIL_E2E_ENABLED=1 node tests/tracking-proof.test.js   # runs the full test
 *   node tests/tracking-proof.test.js                        # exits SKIPPED
 */

// ── E2E skip guard ─────────────────────────────────────────────────────────
if (!process.env.GMAIL_E2E_ENABLED) {
  console.log("SKIPPED — tracking-proof.test.js is an E2E smoke test.");
  console.log("         It requires valid Gmail OAuth for trevor@voltsafe.com.");
  console.log("         Set GMAIL_E2E_ENABLED=1 to run it explicitly.");
  console.log("         Do NOT run in CI without dedicated E2E Gmail credentials.");
  process.exit(0); // exit 0 = SKIPPED (not a failure)
}

import pg from "pg";

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";
const FIXTURE_TAG = `proof-${Date.now()}`;

let passed = 0;
let failed = 0;
const ok = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error("No session cookie");
  await sleep(400);
  return cookie;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");
  const pool = new pg.Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  console.log("=== End-to-End Open Tracking Proof ===");
  console.log(`Fixture tag: ${FIXTURE_TAG}`);

  let trackingId = null;
  let gmailMessageId = null;

  try {
    // ── Step 1: send a real tracked HTML email ─────────────────────────
    console.log("\n── Step 1: send tracked email (Cortex → Trevor self) ──");
    const cookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const subject = `[TRACKING-PROOF ${FIXTURE_TAG}] open-tracking E2E`;
    const body = `<html><body>
      <p>Cortex open-tracking proof.</p>
      <p>Fixture tag: <code>${FIXTURE_TAG}</code></p>
      <p><a href="https://example.com/proof">Click target</a></p>
    </body></html>`;
    const sendRes = await fetch(`${BASE}/api/gmail/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE },
      body: JSON.stringify({ to: ADMIN_EMAIL, subject, body }),
    });
    const sendJson = await sendRes.json();
    if (!sendRes.ok) {
      bad(`send returned ${sendRes.status}`, JSON.stringify(sendJson));
      throw new Error("send failed; aborting proof");
    }
    ok(`send succeeded → status ${sendRes.status}`);
    console.log(`  evidence: ${JSON.stringify({
      gmailMessageId: sendJson.id,
      threadId: sendJson.threadId,
      trackingId: sendJson.trackingId,
      trackingEnabled: sendJson.trackingEnabled,
      trackingIds: sendJson.trackingIds,
      recipientCount: sendJson.recipientCount,
    })}`);
    trackingId = sendJson.trackingId || sendJson.trackingIds?.[0];
    gmailMessageId = sendJson.id || sendJson.gmailMessageId;
    if (!trackingId) bad("send response includes a trackingId");
    else ok(`send response includes trackingId=${trackingId}`);

    // ── Step 2: pixel row exists ──────────────────────────────────────
    console.log("\n── Step 2: pixel row created in email_tracking_pixels ──");
    const pix = await client.query(
      `SELECT tracking_id, gmail_message_id, subject, recipient_email, sent_by_user_id, engagement_score, signal_level, created_at
       FROM email_tracking_pixels WHERE tracking_id = $1`,
      [trackingId]
    );
    if (pix.rowCount === 1) {
      ok("pixel row found");
      console.log(`  evidence: ${JSON.stringify(pix.rows[0])}`);
    } else {
      bad("pixel row found", `expected 1 row, got ${pix.rowCount}`);
    }

    // ── Step 3: hit /track/open/<id> as a non-bot client ──────────────
    console.log("\n── Step 3: simulate recipient opening (hit /track/open) ──");
    const openRes = await fetch(`${BASE}/track/open/${trackingId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      },
    });
    if (openRes.status === 200) ok(`/track/open returned 200 (1×1 GIF)`);
    else bad(`/track/open status`, `expected 200, got ${openRes.status}`);
    await sleep(500);

    // ── Step 4: event row exists ──────────────────────────────────────
    console.log("\n── Step 4: open event recorded in email_engagement_events ──");
    const ev = await client.query(
      `SELECT id, event_type, is_bot, is_duplicate, recipient_email, occurred_at
       FROM email_engagement_events
       WHERE tracking_id = $1 AND event_type = 'open'
       ORDER BY occurred_at DESC`,
      [trackingId]
    );
    if (ev.rowCount >= 1) {
      ok(`event row(s) found (${ev.rowCount} total)`);
      console.log(`  evidence: ${JSON.stringify(ev.rows[0])}`);
      const real = ev.rows.filter(r => !r.is_bot && !r.is_duplicate);
      if (real.length >= 1) ok(`at least one event is non-bot, non-duplicate`);
      else bad(`at least one event is non-bot, non-duplicate`, "all events flagged bot or dup");
    } else {
      bad("event row(s) found", `got 0`);
    }

    // ── Step 5: by-message API reflects the open ──────────────────────
    console.log("\n── Step 5: /api/email-engagement/by-message/<id> shows the open ──");
    if (gmailMessageId) {
      const apiRes = await fetch(
        `${BASE}/api/email-engagement/by-message/${encodeURIComponent(gmailMessageId)}`,
        { headers: { Cookie: cookie } }
      );
      const apiJson = await apiRes.json();
      console.log(`  evidence: ${JSON.stringify(apiJson)}`);
      if (apiJson.trackingId === trackingId) ok("API returns matching trackingId");
      else bad("API returns matching trackingId", `got ${apiJson.trackingId}`);
      if (Number(apiJson.uniqueOpens) >= 1) ok(`uniqueOpens >= 1 (got ${apiJson.uniqueOpens})`);
      else bad(`uniqueOpens >= 1`, `got ${apiJson.uniqueOpens}`);
      if (apiJson.firstOpenAt) ok(`firstOpenAt populated: ${apiJson.firstOpenAt}`);
      else bad("firstOpenAt populated");
      if (apiJson.lastOpenAt) ok(`lastOpenAt populated: ${apiJson.lastOpenAt}`);
      else bad("lastOpenAt populated");
    } else {
      bad("by-message API check skipped: no gmailMessageId from send response");
    }

    // ── Step 6: pixel score updated ───────────────────────────────────
    console.log("\n── Step 6: pixel scoring updated by recordOpen ──");
    const scored = await client.query(
      `SELECT engagement_score, signal_level, is_hot, last_scored_at
       FROM email_tracking_pixels WHERE tracking_id = $1`,
      [trackingId]
    );
    console.log(`  evidence: ${JSON.stringify(scored.rows[0])}`);
    if (Number(scored.rows[0]?.engagement_score) > 0) ok(`engagement_score > 0`);
    else bad(`engagement_score > 0`, `got ${scored.rows[0]?.engagement_score}`);

  } finally {
    // ── Cleanup: remove the proof rows from DB so re-runs stay clean.
    // The sent Gmail message itself remains in Trevor's Sent folder
    // (clearly tagged with FIXTURE_TAG so he can identify/delete it).
    if (trackingId) {
      try {
        const dEv = await client.query(`DELETE FROM email_engagement_events WHERE tracking_id = $1`, [trackingId]);
        const dPx = await client.query(`DELETE FROM email_tracking_pixels WHERE tracking_id = $1`, [trackingId]);
        console.log(`\nCleanup: deleted ${dEv.rowCount} event row(s), ${dPx.rowCount} pixel row(s).`);
      } catch (e) { console.warn("cleanup:", e.message); }
    }
    client.release(); await pool.end();
  }

  console.log("==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  console.log(`(NOTE: Gmail-side message remains in Trevor's Sent folder, tagged "${FIXTURE_TAG}")`);
  if (failed > 0) { console.error("\u274C FAILED"); process.exit(1); }
  console.log("\u2705 All checks PASSED");
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
