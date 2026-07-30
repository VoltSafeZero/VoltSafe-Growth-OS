#!/usr/bin/env node
/**
 * mark-spam / not-spam — derived column regression tests (Commit 1)
 *
 * Verifies that mark-spam and not-spam immediately update derived columns
 * (is_spam, is_inbox) in the same local DB operation — without waiting for
 * the next Gmail incremental sync.
 *
 *  C1.  mark-spam sets is_spam=true and is_inbox=false on all messages.
 *  C2.  mark-spam adds SPAM and removes INBOX from label_ids.
 *  C3.  mark-spam does NOT alter is_unread on an already-read message.
 *  C4.  mark-spam does NOT alter is_unread on an already-unread message.
 *  C5.  not-spam sets is_spam=false and is_inbox=true.
 *  C6.  not-spam removes SPAM and adds INBOX in label_ids.
 *  C7.  not-spam does NOT blanket-set is_unread=true on a read message.
 *  C8.  not-spam deletes the exact sender from blocked_senders.
 *  C9.  not-spam inserts the exact sender into spam_trusted_senders.
 *  C10. Round-trip: inbox → spam → inbox; is_unread preserved throughout.
 *
 * Run: node tests/mark-spam-derived-columns.test.cjs
 */
"use strict";

const pg = require("pg");

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";
const TAG         = `spam-derived-${Date.now()}`;

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
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  const cookie = r.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error("no session cookie");
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

/**
 * Insert a synthetic email_messages row into the local DB with explicit
 * is_inbox / is_spam / is_unread values so we control the starting state.
 */
async function insertMsg(pool, { msgId, threadId, fromEmail, isInbox, isSpam, isUnread, labelIds, sourceAccountId = 1 }) {
  const { rows: [row] } = await pool.query(`
    INSERT INTO email_messages
      (gmail_message_id, gmail_thread_id, subject, from_email, from_name,
       from_domain, direction, label_ids, source_account_id, sent_at,
       is_inbox, is_spam, is_unread)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10,$11,$12)
    RETURNING id
  `, [
    msgId,
    threadId,
    `[TEST] ${TAG}`,
    fromEmail,
    "Test Sender",
    fromEmail.split("@")[1] || "test.example",
    "inbound",
    JSON.stringify(labelIds),
    sourceAccountId, // must be in the caller's accessible account set
    isInbox,
    isSpam,
    isUnread,
  ]);
  return row.id;
}

async function getMsg(pool, id) {
  const { rows: [row] } = await pool.query(
    `SELECT label_ids, is_inbox, is_spam, is_unread FROM email_messages WHERE id=$1`, [id]);
  return row
    ? { ...row, labels: JSON.parse(row.label_ids || "[]") }
    : null;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  console.log(`=== mark-spam / not-spam Derived Column Tests (${TAG}) ===\n`);

  // Track everything we insert for cleanup
  const insertedMsgIds = [];
  const testSenderEmail = `spam-test-${TAG}@test-domain.example.com`;
  let cookie;

  // Resolve a real accessible Gmail account ID — the mark-spam route requires
  // source_account_id to be in the caller's accessible account set.
  let realAccountId = 1; // fallback (may not exist)
  try {
    const tmpCookie = await login();
    const acctRes = await api(tmpCookie, "/api/gmail/accounts");
    const accts = await acctRes.json();
    if (Array.isArray(accts) && accts.length > 0) realAccountId = accts[0].id;
  } catch (_) { /* use fallback */ }
  console.log(`  using Gmail account id=${realAccountId} for synthetic message inserts\n`);

  try {
    cookie = await login();
    console.log("  authenticated as admin\n");

    // ── C1 + C2: mark-spam sets derived columns + label_ids ─────────────────
    console.log("── C1 + C2: mark-spam → is_spam=true, is_inbox=false, labels correct ──");
    {
      const thread  = `thread-c1-${TAG}`;
      const msgId   = await insertMsg(pool, {
        msgId:     `msg-c1-${TAG}`,
        threadId:  thread,
        fromEmail: testSenderEmail,
        isInbox:   true,
        isSpam:    false,
        isUnread:  true,
        labelIds:  ["INBOX", "UNREAD"],
        sourceAccountId: realAccountId,
      });
      insertedMsgIds.push(msgId);

      const before = await getMsg(pool, msgId);
      console.log(`  before: is_inbox=${before.is_inbox} is_spam=${before.is_spam} labels=${JSON.stringify(before.labels)}`);

      const r = await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(thread)}/mark-spam`,
        { method: "POST", body: "{}" });
      const body = await r.json();
      console.log(`  mark-spam response: ${r.status} ${JSON.stringify(body)}`);

      if (r.status === 200) ok("C1/C2: mark-spam returns 200");
      else bad("C1/C2: mark-spam returns 200", `got ${r.status}: ${JSON.stringify(body)}`);

      const after = await getMsg(pool, msgId);
      console.log(`  after:  is_inbox=${after.is_inbox} is_spam=${after.is_spam} labels=${JSON.stringify(after.labels)}`);

      // Derived columns
      if (after.is_spam === true)   ok("C1: is_spam=true after mark-spam");
      else bad("C1: is_spam=true",  `got ${after.is_spam}`);

      if (after.is_inbox === false) ok("C1: is_inbox=false after mark-spam");
      else bad("C1: is_inbox=false", `got ${after.is_inbox}`);

      // label_ids
      if (after.labels.includes("SPAM"))    ok("C2: SPAM added to label_ids");
      else bad("C2: SPAM added",            `labels=${JSON.stringify(after.labels)}`);

      if (!after.labels.includes("INBOX"))  ok("C2: INBOX removed from label_ids");
      else bad("C2: INBOX removed",         `labels=${JSON.stringify(after.labels)}`);
    }

    // ── C3: mark-spam does NOT alter is_unread on an already-read message ────
    console.log("\n── C3: mark-spam preserves is_unread=false (read message) ──");
    {
      const thread = `thread-c3-${TAG}`;
      const msgId  = await insertMsg(pool, {
        msgId:    `msg-c3-${TAG}`,
        threadId: thread,
        fromEmail: testSenderEmail,
        isInbox:  true,
        isSpam:   false,
        isUnread: false,
        labelIds: ["INBOX"],
        sourceAccountId: realAccountId,
      });
      insertedMsgIds.push(msgId);

      await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(thread)}/mark-spam`,
        { method: "POST", body: "{}" });

      const after = await getMsg(pool, msgId);
      console.log(`  after: is_unread=${after.is_unread}`);

      if (after.is_unread === false) ok("C3: is_unread remains false on a read message after mark-spam");
      else bad("C3: is_unread unchanged (was false)", `got ${after.is_unread}`);
    }

    // ── C4: mark-spam does NOT alter is_unread on an unread message ──────────
    console.log("\n── C4: mark-spam preserves is_unread=true (unread message) ──");
    {
      const thread = `thread-c4-${TAG}`;
      const msgId  = await insertMsg(pool, {
        msgId:    `msg-c4-${TAG}`,
        threadId: thread,
        fromEmail: testSenderEmail,
        isInbox:  true,
        isSpam:   false,
        isUnread: true,
        labelIds: ["INBOX", "UNREAD"],
        sourceAccountId: realAccountId,
      });
      insertedMsgIds.push(msgId);

      await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(thread)}/mark-spam`,
        { method: "POST", body: "{}" });

      const after = await getMsg(pool, msgId);
      console.log(`  after: is_unread=${after.is_unread}`);

      if (after.is_unread === true) ok("C4: is_unread remains true on an unread message after mark-spam");
      else bad("C4: is_unread unchanged (was true)", `got ${after.is_unread}`);
    }

    // ── C5 + C6: not-spam sets derived columns + label_ids ──────────────────
    console.log("\n── C5 + C6: not-spam → is_spam=false, is_inbox=true, labels correct ──");
    {
      const thread = `thread-c5-${TAG}`;
      const msgId  = await insertMsg(pool, {
        msgId:    `msg-c5-${TAG}`,
        threadId: thread,
        fromEmail: testSenderEmail,
        isInbox:  false,
        isSpam:   true,
        isUnread: true,
        labelIds: ["SPAM", "UNREAD"],
        sourceAccountId: realAccountId,
      });
      insertedMsgIds.push(msgId);

      // Also insert into blocked_senders so not-spam has something to clean up
      await pool.query(
        `INSERT INTO blocked_senders (email, added_by) VALUES ($1, 4) ON CONFLICT DO NOTHING`,
        [testSenderEmail]);

      const before = await getMsg(pool, msgId);
      console.log(`  before: is_inbox=${before.is_inbox} is_spam=${before.is_spam} labels=${JSON.stringify(before.labels)}`);

      const r = await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(thread)}/not-spam`,
        { method: "POST", body: "{}" });
      const body = await r.json();
      console.log(`  not-spam response: ${r.status} ${JSON.stringify(body)}`);

      if (r.status === 200) ok("C5/C6: not-spam returns 200");
      else bad("C5/C6: not-spam returns 200", `got ${r.status}: ${JSON.stringify(body)}`);

      const after = await getMsg(pool, msgId);
      console.log(`  after:  is_inbox=${after.is_inbox} is_spam=${after.is_spam} labels=${JSON.stringify(after.labels)}`);

      // Derived columns
      if (after.is_spam === false)  ok("C5: is_spam=false after not-spam");
      else bad("C5: is_spam=false", `got ${after.is_spam}`);

      if (after.is_inbox === true)  ok("C5: is_inbox=true after not-spam");
      else bad("C5: is_inbox=true", `got ${after.is_inbox}`);

      // label_ids
      if (!after.labels.includes("SPAM"))  ok("C6: SPAM removed from label_ids");
      else bad("C6: SPAM removed",         `labels=${JSON.stringify(after.labels)}`);

      if (after.labels.includes("INBOX"))  ok("C6: INBOX added to label_ids");
      else bad("C6: INBOX added",          `labels=${JSON.stringify(after.labels)}`);
    }

    // ── C7: not-spam does NOT blanket-set is_unread=true on a read message ───
    console.log("\n── C7: not-spam preserves is_unread=false (read spam message) ──");
    {
      const thread = `thread-c7-${TAG}`;
      const msgId  = await insertMsg(pool, {
        msgId:    `msg-c7-${TAG}`,
        threadId: thread,
        fromEmail: testSenderEmail,
        isInbox:  false,
        isSpam:   true,
        isUnread: false,           // was read before being spammed
        labelIds: ["SPAM"],
        sourceAccountId: realAccountId,
      });
      insertedMsgIds.push(msgId);

      await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(thread)}/not-spam`,
        { method: "POST", body: "{}" });

      const after = await getMsg(pool, msgId);
      console.log(`  after: is_unread=${after.is_unread}`);

      if (after.is_unread === false) ok("C7: is_unread remains false on a read message after not-spam");
      else bad("C7: is_unread unchanged (was false)", `got ${after.is_unread}`);
    }

    // ── C8 + C9: not-spam removes from blocked_senders + adds to trusted ─────
    console.log("\n── C8 + C9: not-spam cleans blocked_senders + adds spam_trusted_senders ──");
    {
      const senderC8 = `bs-c8-${TAG}@test-domain.example.com`;
      const thread   = `thread-c8-${TAG}`;
      const msgId    = await insertMsg(pool, {
        msgId:    `msg-c8-${TAG}`,
        threadId: thread,
        fromEmail: senderC8,
        isInbox:  false,
        isSpam:   true,
        isUnread: true,
        labelIds: ["SPAM", "UNREAD"],
        sourceAccountId: realAccountId,
      });
      insertedMsgIds.push(msgId);

      // Ensure the sender is in blocked_senders before we trust
      await pool.query(
        `INSERT INTO blocked_senders (email, added_by) VALUES ($1, 4) ON CONFLICT DO NOTHING`,
        [senderC8]);

      const { rows: blockBefore } = await pool.query(
        `SELECT id FROM blocked_senders WHERE email=$1`, [senderC8]);
      if (blockBefore.length >= 1) ok("C8-pre: sender in blocked_senders before not-spam");
      else bad("C8-pre: sender in blocked_senders", `got ${blockBefore.length} rows`);

      await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(thread)}/not-spam`,
        { method: "POST", body: "{}" });

      // C8: blocked_senders row gone
      const { rows: blockAfter } = await pool.query(
        `SELECT id FROM blocked_senders WHERE email=$1`, [senderC8]);
      if (blockAfter.length === 0) ok("C8: sender removed from blocked_senders after not-spam");
      else bad("C8: sender removed from blocked_senders", `still ${blockAfter.length} row(s)`);

      // C9: spam_trusted_senders row present
      const { rows: trusted } = await pool.query(
        `SELECT id FROM spam_trusted_senders WHERE email=$1 LIMIT 1`, [senderC8]);
      if (trusted.length >= 1) ok("C9: sender inserted into spam_trusted_senders after not-spam");
      else bad("C9: sender in spam_trusted_senders", "no row found");
    }

    // ── C10: Round-trip — inbox → spam → inbox, is_unread preserved ──────────
    console.log("\n── C10: Round-trip (inbox → mark-spam → not-spam → inbox), is_unread preserved ──");
    {
      const thread = `thread-c10-${TAG}`;
      // Two messages: one read, one unread, both in same thread
      const msgReadId = await insertMsg(pool, {
        msgId:    `msg-c10-read-${TAG}`,
        threadId: thread,
        fromEmail: testSenderEmail,
        isInbox:  true,
        isSpam:   false,
        isUnread: false,
        labelIds: ["INBOX"],
        sourceAccountId: realAccountId,
      });
      const msgUnreadId = await insertMsg(pool, {
        msgId:    `msg-c10-unread-${TAG}`,
        threadId: thread,
        fromEmail: testSenderEmail,
        isInbox:  true,
        isSpam:   false,
        isUnread: true,
        labelIds: ["INBOX", "UNREAD"],
        sourceAccountId: realAccountId,
      });
      insertedMsgIds.push(msgReadId, msgUnreadId);

      const readBefore   = await getMsg(pool, msgReadId);
      const unreadBefore = await getMsg(pool, msgUnreadId);
      console.log(`  start: read msg is_unread=${readBefore.is_unread} | unread msg is_unread=${unreadBefore.is_unread}`);

      if (readBefore.is_inbox === true && readBefore.is_spam === false)
        ok("C10-start: read message starts in inbox, not spam");
      else bad("C10-start: read message starts in inbox", JSON.stringify(readBefore));

      // ── mark-spam ──
      await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(thread)}/mark-spam`,
        { method: "POST", body: "{}" });

      const readAfterSpam   = await getMsg(pool, msgReadId);
      const unreadAfterSpam = await getMsg(pool, msgUnreadId);
      console.log(`  after mark-spam: read is_inbox=${readAfterSpam.is_inbox} is_spam=${readAfterSpam.is_spam} is_unread=${readAfterSpam.is_unread}`);
      console.log(`  after mark-spam: unread is_inbox=${unreadAfterSpam.is_inbox} is_spam=${unreadAfterSpam.is_spam} is_unread=${unreadAfterSpam.is_unread}`);

      if (readAfterSpam.is_inbox === false && readAfterSpam.is_spam === true)
        ok("C10-spam: read message moved to spam, out of inbox");
      else bad("C10-spam: read message moved to spam", JSON.stringify(readAfterSpam));

      if (unreadAfterSpam.is_inbox === false && unreadAfterSpam.is_spam === true)
        ok("C10-spam: unread message moved to spam, out of inbox");
      else bad("C10-spam: unread message moved to spam", JSON.stringify(unreadAfterSpam));

      // is_unread preserved after mark-spam
      if (readAfterSpam.is_unread === false)
        ok("C10-spam: read message is_unread remains false after mark-spam");
      else bad("C10-spam: read message is_unread unchanged", `got ${readAfterSpam.is_unread}`);

      if (unreadAfterSpam.is_unread === true)
        ok("C10-spam: unread message is_unread remains true after mark-spam");
      else bad("C10-spam: unread message is_unread unchanged", `got ${unreadAfterSpam.is_unread}`);

      // ── not-spam (restore) ──
      await api(cookie,
        `/api/inbox/threads/${encodeURIComponent(thread)}/not-spam`,
        { method: "POST", body: "{}" });

      const readRestored   = await getMsg(pool, msgReadId);
      const unreadRestored = await getMsg(pool, msgUnreadId);
      console.log(`  after not-spam: read is_inbox=${readRestored.is_inbox} is_spam=${readRestored.is_spam} is_unread=${readRestored.is_unread}`);
      console.log(`  after not-spam: unread is_inbox=${unreadRestored.is_inbox} is_spam=${unreadRestored.is_spam} is_unread=${unreadRestored.is_unread}`);

      if (readRestored.is_inbox === true && readRestored.is_spam === false)
        ok("C10-restore: read message back in inbox, not spam");
      else bad("C10-restore: read message restored to inbox", JSON.stringify(readRestored));

      if (unreadRestored.is_inbox === true && unreadRestored.is_spam === false)
        ok("C10-restore: unread message back in inbox, not spam");
      else bad("C10-restore: unread message restored to inbox", JSON.stringify(unreadRestored));

      // is_unread preserved after not-spam
      if (readRestored.is_unread === false)
        ok("C10-restore: read message is_unread remains false after not-spam");
      else bad("C10-restore: read message is_unread unchanged", `got ${readRestored.is_unread}`);

      if (unreadRestored.is_unread === true)
        ok("C10-restore: unread message is_unread remains true after not-spam");
      else bad("C10-restore: unread message is_unread unchanged", `got ${unreadRestored.is_unread}`);
    }

  } catch (err) {
    console.error("FATAL:", err.message, err.stack?.split("\n")[1]);
    failed++;
  } finally {
    // Clean up all synthetic rows
    for (const id of insertedMsgIds) {
      await pool.query(`DELETE FROM email_messages WHERE id=$1`, [id]).catch(() => {});
    }
    await pool.query(
      `DELETE FROM blocked_senders WHERE email LIKE $1`, [`%-${TAG}@%`]).catch(() => {});
    await pool.query(
      `DELETE FROM spam_trusted_senders WHERE email LIKE $1`, [`%-${TAG}@%`]).catch(() => {});
    await pool.end();

    console.log(`\n${"─".repeat(60)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  }
}

main();
