#!/usr/bin/env node
/**
 * Multi-Recipient Open-Tracking Proof  [E2E SMOKE TEST — requires live Gmail OAuth]
 *
 * Sends ONE compose with 3 recipients (To + Cc + Bcc) using Gmail
 * plus-addressing so all copies route to Trevor's inbox without spamming
 * anyone. Verifies the per-recipient fanout:
 *   - 3 separate Gmail messages were sent (one envelope per recipient)
 *   - 3 distinct trackingIds and pixel rows exist, each tagged with the
 *     recipient's email (kind preserved in the response)
 *   - opening recipient B's pixel attributes the open ONLY to B's row
 *   - the by-message API returns the correct recipient_email per message
 *
 * CLASSIFICATION: E2E smoke test — NOT a deterministic unit/integration test.
 *   - Requires valid Gmail OAuth for trevor@voltsafe.com in the environment.
 *   - Should NOT be run in CI without dedicated test-Gmail credentials.
 *   - Will be SKIPPED (exit 0) unless GMAIL_E2E_ENABLED=1 is set explicitly.
 *
 * Run:
 *   GMAIL_E2E_ENABLED=1 node tests/tracking-multi-proof.test.js   # full test
 *   node tests/tracking-multi-proof.test.js                        # SKIPPED
 */

// ── E2E skip guard ─────────────────────────────────────────────────────────
if (!process.env.GMAIL_E2E_ENABLED) {
  console.log("SKIPPED — tracking-multi-proof.test.js is an E2E smoke test.");
  console.log("         It requires valid Gmail OAuth for trevor@voltsafe.com.");
  console.log("         Set GMAIL_E2E_ENABLED=1 to run it explicitly.");
  console.log("         Do NOT run in CI without dedicated E2E Gmail credentials.");
  process.exit(0); // exit 0 = SKIPPED (not a failure)
}

import pg from "pg";

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";
const FIXTURE_TAG = `multi-${Date.now()}`;

let passed = 0, failed = 0;
const ok = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", "Origin": BASE },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PWD }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  await sleep(400);
  return cookie;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  console.log("=== Multi-Recipient Fanout Proof ===");
  console.log(`Fixture: ${FIXTURE_TAG}`);

  let trackingIds = [];
  try {
    const cookie = await login();

    // ── Step 1: send to To + Cc + Bcc (3 plus-aliases of trevor) ─────
    console.log("\n── Step 1: send 1 compose with 3 recipients (To/Cc/Bcc) ──");
    const toAddr  = `trevor+${FIXTURE_TAG}-to@voltsafe.com`;
    const ccAddr  = `trevor+${FIXTURE_TAG}-cc@voltsafe.com`;
    const bccAddr = `trevor+${FIXTURE_TAG}-bcc@voltsafe.com`;

    const sendRes = await fetch(`${BASE}/api/gmail/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE },
      body: JSON.stringify({
        to: toAddr, cc: ccAddr, bcc: bccAddr,
        subject: `[FANOUT-PROOF ${FIXTURE_TAG}]`,
        body: `<html><body><p>Per-recipient fanout proof. Tag: ${FIXTURE_TAG}</p></body></html>`,
      }),
    });
    const sendJson = await sendRes.json();
    console.log(`  evidence (response): ${JSON.stringify(sendJson, null, 2)}`);
    if (!sendRes.ok) { bad(`send status`, JSON.stringify(sendJson)); throw new Error("send failed"); }

    if (sendJson.fanout === true) ok("response.fanout === true");
    else bad("response.fanout === true", `got ${sendJson.fanout}`);
    if (sendJson.recipientCount === 3) ok("recipientCount === 3");
    else bad("recipientCount === 3", `got ${sendJson.recipientCount}`);
    if (sendJson.sentCount === 3) ok("sentCount === 3 (all envelopes sent)");
    else bad("sentCount === 3", `got ${sendJson.sentCount}`);
    if (Array.isArray(sendJson.trackingIds) && sendJson.trackingIds.length === 3) ok("3 trackingIds returned");
    else bad("3 trackingIds returned", `got ${sendJson.trackingIds?.length}`);
    if (Array.isArray(sendJson.recipients) && sendJson.recipients.length === 3) ok("3 recipient breakdown rows returned");
    else bad("3 recipient breakdown rows returned", `got ${sendJson.recipients?.length}`);

    // Each recipient should have a unique gmailMessageId and unique trackingId.
    const gmIds  = new Set(sendJson.recipients.map((r) => r.gmailMessageId));
    const tIds   = new Set(sendJson.recipients.map((r) => r.trackingId));
    if (gmIds.size === 3) ok("3 distinct gmailMessageIds (separate envelopes)");
    else bad("3 distinct gmailMessageIds", `got ${gmIds.size}`);
    if (tIds.size === 3)  ok("3 distinct trackingIds");
    else bad("3 distinct trackingIds", `got ${tIds.size}`);

    const kinds = sendJson.recipients.map((r) => r.recipientKind).sort().join(",");
    if (kinds === "bcc,cc,to") ok("kinds preserved: to + cc + bcc");
    else bad("kinds preserved", `got ${kinds}`);

    trackingIds = sendJson.trackingIds;

    // ── Step 2: pixel rows persisted per recipient ────────────────────
    console.log("\n── Step 2: 3 pixel rows persisted, each tagged with its recipient ──");
    const pxRows = await client.query(
      `SELECT tracking_id, gmail_message_id, recipient_email
       FROM email_tracking_pixels
       WHERE tracking_id = ANY($1::text[])
       ORDER BY id ASC`, [trackingIds]
    );
    console.log(`  evidence: ${JSON.stringify(pxRows.rows, null, 2)}`);
    if (pxRows.rowCount === 3) ok("3 pixel rows in email_tracking_pixels");
    else bad("3 pixel rows", `got ${pxRows.rowCount}`);

    const dbRecipients = new Set(pxRows.rows.map((r) => r.recipient_email));
    [toAddr, ccAddr, bccAddr].forEach((addr) => {
      if (dbRecipients.has(addr.toLowerCase())) ok(`pixel for ${addr}`);
      else bad(`pixel for ${addr}`, `set has: ${[...dbRecipients].join(",")}`);
    });

    // ── Step 3: open ONLY the Cc-recipient's pixel; verify per-recipient attribution ─
    console.log("\n── Step 3: open ONLY the Cc recipient's pixel — opens must NOT cross-attribute ──");
    const ccRecipient = sendJson.recipients.find((r) => r.recipientKind === "cc");
    const openTarget = ccRecipient.trackingId;
    const openRes = await fetch(`${BASE}/track/open/${openTarget}`, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
    });
    if (openRes.status === 200) ok(`/track/open[cc] returned 200`);
    else bad(`/track/open[cc] status`, `${openRes.status}`);
    await sleep(500);

    for (const r of sendJson.recipients) {
      const apiRes = await fetch(
        `${BASE}/api/email-engagement/by-message/${encodeURIComponent(r.gmailMessageId)}`,
        { headers: { Cookie: cookie } }
      );
      const json = await apiRes.json();
      const expected = r.recipientKind === "cc" ? 1 : 0;
      const got = Number(json.uniqueOpens || 0);
      console.log(`  evidence [${r.recipientKind} ${r.recipient}]: tracked=${json.tracked}, recipientEmail=${json.recipientEmail}, uniqueOpens=${got}, trackingId=${json.trackingId}`);
      if (json.tracked === true) ok(`[${r.recipientKind}] by-message returns tracked=true`);
      else bad(`[${r.recipientKind}] tracked=true`, `got ${json.tracked}`);
      if (json.recipientEmail === r.recipient) ok(`[${r.recipientKind}] recipientEmail attribution correct`);
      else bad(`[${r.recipientKind}] recipientEmail`, `got ${json.recipientEmail}`);
      if (got === expected) ok(`[${r.recipientKind}] uniqueOpens = ${expected} (no cross-attribution)`);
      else bad(`[${r.recipientKind}] uniqueOpens = ${expected}`, `got ${got}`);
    }

  } finally {
    if (trackingIds.length) {
      try {
        const dEv = await client.query(`DELETE FROM email_engagement_events WHERE tracking_id = ANY($1::text[])`, [trackingIds]);
        const dPx = await client.query(`DELETE FROM email_tracking_pixels  WHERE tracking_id = ANY($1::text[])`, [trackingIds]);
        console.log(`\nCleanup: deleted ${dEv.rowCount} event(s), ${dPx.rowCount} pixel(s).`);
      } catch (e) { console.warn("cleanup:", e.message); }
    }
    client.release(); await pool.end();
  }
  console.log("==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log(`(NOTE: 3 sent messages remain in Trevor's Sent folder, tagged "${FIXTURE_TAG}")`);
  if (failed > 0) { console.error("\u274C FAILED"); process.exit(1); }
  console.log("\u2705 All checks PASSED");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
