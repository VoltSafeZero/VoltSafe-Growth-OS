#!/usr/bin/env node
/**
 * Inbox bug-fix regression test (Apr 2026)
 *
 * Pins the three fixes in this round:
 *   B1. mailSource=auto must NOT silently serve stale local data on first page.
 *       It now goes Gmail-first (X-Mail-Source: gmail), local only as fallback.
 *   B2. Thread detail must not return a "blank" body when local has only metadata.
 *       Auto mode falls back to Gmail when every local message has empty body+subject.
 *   B3. /toggle-star now mirrors the change to email_messages.label_ids so a refetch
 *       from local doesn't visually un-toggle the star.
 *
 * NO schema changes. Snapshot/restore for any DB inserts.
 * Run: node tests/inbox-bugfixes.test.js
 */
import pg from "pg";

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";
const ADMIN_USER_ID = 4;
const PERSONAL_ACCOUNT_ID = 1;
const FIXTURE_TAG = `inbox-bugfix-${Date.now()}`;

let passed = 0, failed = 0;
const ok  = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
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
  console.log("=== Inbox Bug-Fix Regression Test ===");
  console.log(`Fixture: ${FIXTURE_TAG}`);
  let createdMsgKey = null;
  let starMsgId = null;
  let starOriginalLabels = null;

  try {
    const cookie = await login();

    // ─────────────────────────────────────────────────────────────────────
    // B1: source=auto first page must come from Gmail
    // ─────────────────────────────────────────────────────────────────────
    console.log("\n── B1: mailSource=auto, first page (no pageToken) → X-Mail-Source: gmail ──");
    {
      const r = await fetch(`${BASE}/api/gmail/messages?source=auto&q=in:inbox&limit=10`, {
        headers: { Cookie: cookie },
      });
      const src = r.headers.get("x-mail-source");
      const j = await r.json();
      console.log(`  evidence: status=${r.status}, X-Mail-Source=${src}, messages=${j.messages?.length}`);
      if (r.status === 200) ok("auto first-page returns 200");
      else bad("auto first-page returns 200", `got ${r.status}`);
      if (src === "gmail") ok("first page served from Gmail (freshness)");
      else bad("first page served from Gmail (freshness)", `got X-Mail-Source=${src}`);
      if (Array.isArray(j.messages) && j.messages.length > 0) ok(`got ${j.messages.length} messages`);
      else bad("got messages", `got ${j.messages?.length}`);
    }

    console.log("\n── B1b: mailSource=auto WITH local pageToken (digits) → X-Mail-Source: local ──");
    {
      const r = await fetch(`${BASE}/api/gmail/messages?source=auto&q=in:inbox&limit=10&pageToken=10`, {
        headers: { Cookie: cookie },
      });
      const src = r.headers.get("x-mail-source");
      console.log(`  evidence: status=${r.status}, X-Mail-Source=${src}`);
      if (src === "local") ok("local-format pageToken routes to local for deep history");
      else bad("local pageToken routes to local", `got X-Mail-Source=${src}`);
    }

    console.log("\n── B1c: mailSource=local always serves local ──");
    {
      const r = await fetch(`${BASE}/api/gmail/messages?source=local&q=in:inbox&limit=5`, {
        headers: { Cookie: cookie },
      });
      const src = r.headers.get("x-mail-source");
      console.log(`  evidence: X-Mail-Source=${src}`);
      if (src === "local") ok("explicit local source preserved");
      else bad("explicit local source preserved", `got ${src}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // B2: getLocalThread no longer hard-binds owner_user_id when accountId is set.
    // We synthesize a row owned by a DIFFERENT user but tied to the active account,
    // and verify the local thread fetcher still returns it.
    // ─────────────────────────────────────────────────────────────────────
    console.log("\n── B2: getLocalThread returns shared-mailbox row not owned by viewer ──");
    {
      // Insert a synthetic message owned by user 999999 (does not exist) but on
      // PERSONAL_ACCOUNT_ID. Pre-fix this would be filtered out by owner_user_id.
      const msgKey  = `${FIXTURE_TAG}-foreign-owner-msg`;
      const thrKey  = `${FIXTURE_TAG}-foreign-owner-thr`;
      createdMsgKey = msgKey;
      await client.query(
        `INSERT INTO email_messages
           (gmail_message_id, gmail_thread_id, subject, from_email, sent_at,
            snippet, owner_user_id, source_account_id, direction, label_ids,
            body_text, body_html)
         VALUES ($1, $2, $3, 'shared@example.com', NOW(),
                 'foreign-owner sentinel', 999999, $4, 'inbound', '["INBOX"]',
                 'BODY-TEXT-FOREIGN-OWNER', '<p>BODY-HTML-FOREIGN-OWNER</p>')`,
        [msgKey, thrKey, `B2 foreign-owner ${FIXTURE_TAG}`, PERSONAL_ACCOUNT_ID]
      );

      const r = await fetch(
        `${BASE}/api/gmail/threads/${encodeURIComponent(thrKey)}?source=local&asAccountId=${PERSONAL_ACCOUNT_ID}`,
        { headers: { Cookie: cookie } }
      );
      const src = r.headers.get("x-mail-source");
      const j = await r.json();
      console.log(`  evidence: status=${r.status}, X-Mail-Source=${src}, messages=${j.messages?.length}`);
      if (r.status === 200 && src === "local") ok("local thread fetched (foreign-owner row found)");
      else bad("local thread fetched", `status=${r.status}, src=${src}`);
      const m = j.messages?.[0];
      if (m && m.body && m.body.includes("BODY-HTML-FOREIGN-OWNER")) ok("body content present (HTML chosen)");
      else bad("body content present", `body=${m?.body?.slice(0,80)}`);
      if (m && m.subject?.includes(FIXTURE_TAG)) ok("subject preserved");
      else bad("subject preserved", `subject=${m?.subject}`);
    }

    console.log("\n── B2b: auto-mode thread with empty body falls back to Gmail ──");
    {
      // Insert a metadata-only synthetic row (no body) and verify auto mode
      // does NOT serve it as the final response (it falls back to Gmail and
      // since this fake thread doesn't exist on Gmail, returns 5xx — which is
      // what we want: better an honest error than a blank message UI).
      const emptyMsg = `${FIXTURE_TAG}-empty-body-msg`;
      const emptyThr = `${FIXTURE_TAG}-empty-body-thr`;
      await client.query(
        `INSERT INTO email_messages
           (gmail_message_id, gmail_thread_id, subject, from_email, sent_at,
            snippet, owner_user_id, source_account_id, direction, label_ids,
            body_text, body_html)
         VALUES ($1, $2, '', 'meta@example.com', NOW(),
                 '', $3, $4, 'inbound', '["INBOX"]', '', '')`,
        [emptyMsg, emptyThr, ADMIN_USER_ID, PERSONAL_ACCOUNT_ID]
      );
      const r = await fetch(
        `${BASE}/api/gmail/threads/${encodeURIComponent(emptyThr)}?source=auto&asAccountId=${PERSONAL_ACCOUNT_ID}`,
        { headers: { Cookie: cookie } }
      );
      const src = r.headers.get("x-mail-source");
      console.log(`  evidence: status=${r.status}, X-Mail-Source=${src}`);
      // Either: status 200 with src=gmail (Gmail had it), or 503 (Gmail rejected the fake id).
      // The bug we're pinning is that pre-fix it would 200 with src=local + blank body.
      const isFallbackBehavior = (src === "gmail") || (r.status >= 500);
      if (isFallbackBehavior) ok("empty-body local was NOT served — fell back to Gmail");
      else bad("empty-body local was NOT served", `status=${r.status}, src=${src}`);

      // Cleanup synthetic empty row
      await client.query(`DELETE FROM email_messages WHERE gmail_message_id = $1`, [emptyMsg]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // B3: toggle-star now mirrors STARRED into email_messages.label_ids.
    // Find one existing real message in local, snapshot its labels, toggle on
    // and off via the API, verify both the API response AND the local DB row
    // reflect the change at each step.
    // ─────────────────────────────────────────────────────────────────────
    console.log("\n── B3: /toggle-star persists STARRED into local label_ids ──");
    {
      // Real Gmail message IDs are short lowercase hex strings (~16 chars).
      // Exclude this run's synthetic fixture rows AND any other obviously-fake
      // ids so we toggle a real, live Gmail message that the API will accept.
      const cand = await client.query(`
        SELECT id, gmail_message_id, label_ids
        FROM email_messages
        WHERE source_account_id = $1
          AND (label_ids ILIKE '%"INBOX"%' OR label_ids ILIKE '%INBOX%')
          AND (label_ids NOT ILIKE '%STARRED%' OR label_ids IS NULL)
          AND gmail_message_id ~ '^[0-9a-f]{14,20}$'
          AND gmail_message_id NOT LIKE 'inbox-bugfix-%'
          AND gmail_message_id NOT LIKE 'mbswitch-%'
        ORDER BY sent_at DESC NULLS LAST
        LIMIT 1
      `, [PERSONAL_ACCOUNT_ID]);
      if (cand.rowCount === 0) { bad("found candidate unstarred message", "no rows"); }
      else {
        const row = cand.rows[0];
        starMsgId = row.gmail_message_id;
        starOriginalLabels = row.label_ids;
        console.log(`  using gmail_message_id=${starMsgId}, original label_ids=${starOriginalLabels}`);

        // Toggle 1: should ADD STARRED
        const t1 = await fetch(`${BASE}/api/gmail/messages/${starMsgId}/toggle-star`, {
          method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({}),
        });
        const j1 = await t1.json();
        console.log(`  toggle-1 response: ${JSON.stringify(j1)}`);
        if (t1.ok && j1.starred === true) ok("toggle-1: API confirms starred=true");
        else bad("toggle-1: API confirms starred=true", `status=${t1.status}, body=${JSON.stringify(j1)}`);
        await sleep(250);
        const after1 = await client.query(`SELECT label_ids FROM email_messages WHERE id = $1`, [row.id]);
        const labels1 = after1.rows[0].label_ids || "";
        console.log(`  local label_ids after toggle-1: ${labels1}`);
        if (labels1.includes("STARRED")) ok("toggle-1: local DB now contains STARRED");
        else bad("toggle-1: local DB now contains STARRED", `got: ${labels1}`);

        // Toggle 2: should REMOVE STARRED
        const t2 = await fetch(`${BASE}/api/gmail/messages/${starMsgId}/toggle-star`, {
          method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({}),
        });
        const j2 = await t2.json();
        console.log(`  toggle-2 response: ${JSON.stringify(j2)}`);
        if (t2.ok && j2.starred === false) ok("toggle-2: API confirms starred=false (true toggle)");
        else bad("toggle-2: API confirms starred=false", `status=${t2.status}, body=${JSON.stringify(j2)}`);
        await sleep(250);
        const after2 = await client.query(`SELECT label_ids FROM email_messages WHERE id = $1`, [row.id]);
        const labels2 = after2.rows[0].label_ids || "";
        console.log(`  local label_ids after toggle-2: ${labels2}`);
        if (!labels2.includes("STARRED")) ok("toggle-2: local DB no longer contains STARRED");
        else bad("toggle-2: local DB no longer contains STARRED", `got: ${labels2}`);

        // Restore original label_ids exactly (in case test was interrupted between toggles).
        await client.query(`UPDATE email_messages SET label_ids = $1 WHERE id = $2`, [starOriginalLabels, row.id]);
      }
    }
  } finally {
    try {
      await client.query(`DELETE FROM email_messages WHERE gmail_message_id LIKE $1`, [`${FIXTURE_TAG}-%`]);
    } catch (e) { console.warn("cleanup:", e.message); }
    client.release(); await pool.end();
  }
  console.log("==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  if (failed > 0) { console.error("\u274C FAILED"); process.exit(1); }
  console.log("\u2705 All checks PASSED");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
