#!/usr/bin/env node
/**
 * P1 Under-Gated Mutations — Commit #5 Regression Suite
 *
 * Verifies the remaining P1 mutation gates patched in commit #5:
 *
 *   Thread-association mailbox ACL (owner / admin / mail_team[acctId].edit):
 *     POST /api/gmail/thread-associations/confirm
 *     POST /api/gmail/thread-associations/reject
 *     POST /api/gmail/thread-associations/bulk-confirm
 *     POST /api/gmail/thread-associations/bulk-reject
 *     POST /api/gmail/thread-associations/manual
 *     POST /api/gmail/thread-associations/replace
 *     POST /api/gmail/thread-associations/:threadId/refresh
 *
 *   crm.edit (workspace-shared CRM mutations):
 *     POST   /api/notes
 *     POST   /api/tags
 *     POST   /api/record-tags
 *     DELETE /api/record-tags
 *
 *   admin-only (workspace-shared cleanup state):
 *     POST   /api/data-quality/ignore
 *
 *   attachmentSectionFor(objectType) edit gate:
 *     POST   /api/attachments  (multipart)
 *
 * Phases:
 *   1. anonymous → 401
 *   2. viewer with VIEW perms only → 403 on every gated mutation
 *   3. viewer with full edit perms → not 403 on crm/section gated routes;
 *      thread-assoc routes still 403 (cross-mailbox); data-quality/ignore still 403 (admin)
 *   4. admin → not 403 on data-quality/ignore + thread-assoc routes
 */

import bcrypt from "bcryptjs";
import pg from "pg";

const BASE = "http://localhost:5000";
const VIEWER_EMAIL = "viewer@voltsafe.com";
const VIEWER_PWD = "vstest_p1c5_!1";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";

let passed = 0;
let failed = 0;
const ok = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(350);
  return cookie;
}

const authed = (cookie) => async (url, opts = {}) => fetch(`${BASE}${url}`, {
  ...opts,
  headers: { Cookie: cookie, Origin: BASE, ...(opts.headers || {}) },
});

async function expectStatus(label, p, ...statuses) {
  const res = await p;
  if (statuses.includes(res.status)) {
    ok(`${label} \u2192 ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    bad(`${label} \u2192 expected ${statuses.join("|")}, got ${res.status}`, body.slice(0, 160));
  }
}

async function expectNot403(label, p) {
  const res = await p;
  if (res.status === 403) {
    const body = await res.text().catch(() => "");
    bad(label, `expected NOT 403, got 403: ${body.slice(0, 160)}`);
  } else {
    ok(`${label} \u2192 ${res.status} (ACL passed)`);
  }
}

async function setPerms(client, perms) {
  await client.query(`UPDATE users SET permissions = $1::jsonb WHERE email = $2`,
    [JSON.stringify(perms), VIEWER_EMAIL]);
}

async function setupViewer(client) {
  const snap = await client.query(
    `SELECT id, password, permissions FROM users WHERE email = $1 LIMIT 1`,
    [VIEWER_EMAIL]);
  if (snap.rowCount === 0) throw new Error(`Viewer ${VIEWER_EMAIL} not found`);
  const original = {
    id: snap.rows[0].id, password: snap.rows[0].password, permissions: snap.rows[0].permissions,
  };
  const hash = await bcrypt.hash(VIEWER_PWD, 10);
  await client.query(
    `UPDATE users SET password = $1, status = 'active', must_change_password = false WHERE email = $2`,
    [hash, VIEWER_EMAIL]);
  return original;
}

async function teardown(client, original, fixtureAssocIds, fixtureMsgId) {
  for (const id of fixtureAssocIds) {
    try { await client.query(`DELETE FROM email_associations WHERE id = $1`, [id]); } catch {}
    try { await client.query(`DELETE FROM association_feedback WHERE original_object_id = $1 AND original_object_type = 'lead'`, [id]); } catch {}
  }
  if (!original) return;
  await client.query(
    `UPDATE users SET password = $1, permissions = $2 WHERE email = $3`,
    [original.password, original.permissions, VIEWER_EMAIL]);
}

async function pickFixtures(client) {
  // Pick a real existing email_message owned by admin (source_account_id=1
  // is trevor's mailbox). Viewer has no mail_team[1].edit.
  const msg = (await client.query(
    `SELECT id, gmail_thread_id FROM email_messages
     WHERE source_account_id = 1 AND owner_user_id = 4 AND gmail_thread_id IS NOT NULL
     ORDER BY id LIMIT 1`)).rows[0];
  if (!msg) throw new Error("No fixture email_message found in account 1");
  // Insert two scratch associations on this message — one for confirm/reject,
  // one for bulk + replace. Marked as auto so they look engine-generated.
  const a1 = (await client.query(
    `INSERT INTO email_associations (email_message_id, object_type, object_id, object_name,
       confidence_score, association_reason_json, is_auto, is_user_confirmed)
     VALUES ($1, 'lead', 1, 'p1c5-fixture-1', 50, '["fixture"]', true, false)
     RETURNING id`, [msg.id])).rows[0].id;
  const a2 = (await client.query(
    `INSERT INTO email_associations (email_message_id, object_type, object_id, object_name,
       confidence_score, association_reason_json, is_auto, is_user_confirmed)
     VALUES ($1, 'lead', 1, 'p1c5-fixture-2', 50, '["fixture"]', true, false)
     RETURNING id`, [msg.id])).rows[0].id;
  return { msgId: msg.id, threadId: msg.gmail_thread_id, assoc1: a1, assoc2: a2 };
}

const THREAD_ASSOC_MUTATIONS = (f) => [
  { method: "POST", url: "/api/gmail/thread-associations/confirm",
    body: { associationId: f.assoc1, threadId: f.threadId } },
  { method: "POST", url: "/api/gmail/thread-associations/reject",
    body: { associationId: f.assoc2, threadId: f.threadId } },
  { method: "POST", url: "/api/gmail/thread-associations/manual",
    body: { threadId: f.threadId, objectType: "contact", objectId: 28, objectName: "x" } },
  { method: "POST", url: "/api/gmail/thread-associations/replace",
    body: { oldAssociationId: f.assoc1, threadId: f.threadId,
            objectType: "account", objectId: 17, objectName: "y" } },
  { method: "POST", url: `/api/gmail/thread-associations/${encodeURIComponent(f.threadId)}/refresh`,
    body: {} },
];
// bulk routes always return 200 with per-item skipped[] — they don't 403 the
// whole request. Tested separately below.

const CRM_EDIT_MUTATIONS = () => [
  { method: "POST",   url: "/api/notes",
    body: { linkedObjectType: "account", linkedObjectId: 10, content: "p1c5" } },
  { method: "POST",   url: "/api/tags",
    body: { name: "p1c5-tag-zzz", category: "general", color: "blue" } },
  { method: "POST",   url: "/api/record-tags",
    body: { tagId: 1, recordType: "account", recordId: 10 } },
  { method: "DELETE", url: "/api/record-tags?tagId=999999&recordType=account&recordId=10",
    body: null },
];

const ADMIN_ONLY_MUTATIONS = () => [
  { method: "POST", url: "/api/data-quality/ignore",
    body: { objectType: "account", objectId: 999999, issueType: "duplicate", note: "p1c5" } },
];

// Build a multipart body for POST /api/attachments
function multipartAttachment(objectType, objectId) {
  const boundary = "----p1c5-" + Date.now();
  const CRLF = "\r\n";
  const filePart =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="objectType"${CRLF}${CRLF}${objectType}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="objectId"${CRLF}${CRLF}${objectId}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="p1c5.txt"${CRLF}` +
    `Content-Type: text/plain${CRLF}${CRLF}p1c5 fixture${CRLF}` +
    `--${boundary}--${CRLF}`;
  return { headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body: filePart };
}

async function callJson(v, r) {
  return v(r.url, {
    method: r.method,
    headers: r.body == null ? {} : { "Content-Type": "application/json" },
    body: r.body == null ? undefined : JSON.stringify(r.body),
  });
}

async function callAttachment(v, objectType, objectId) {
  const m = multipartAttachment(objectType, objectId);
  return v("/api/attachments", { method: "POST", headers: m.headers, body: m.body });
}

async function expectBulkSkipped(label, p) {
  const res = await p;
  if (res.status !== 200) {
    const body = await res.text().catch(() => "");
    bad(`${label} (bulk)`, `expected 200 with skipped[], got ${res.status}: ${body.slice(0, 160)}`);
    return;
  }
  const j = await res.json().catch(() => ({}));
  const skip = j.skipped || [];
  const acted = (j.confirmed || j.rejected || []).length;
  if (acted === 0 && skip.length > 0) {
    ok(`${label} (bulk) \u2192 200 skipped=${skip.length} acted=0`);
  } else {
    bad(`${label} (bulk)`, `expected 0 acted + skipped>0; got acted=${acted} skipped=${skip.length}`);
  }
}

async function expectBulkAccepted(label, p) {
  const res = await p;
  if (res.status !== 200) {
    const body = await res.text().catch(() => "");
    bad(`${label} (bulk admin)`, `expected 200, got ${res.status}: ${body.slice(0, 160)}`);
    return;
  }
  const j = await res.json().catch(() => ({}));
  const acted = (j.confirmed || j.rejected || []).length;
  ok(`${label} (bulk admin) \u2192 200 acted=${acted}`);
}

async function run() {
  console.log("=== VoltSafe P1 Under-Gated Mutations — Commit #5 Regression ===\n");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let original = null;
  let fixtures = null;
  try {
    original = await setupViewer(client);
    fixtures = await pickFixtures(client);
    console.log(`viewerId=${original.id}, msg=${fixtures.msgId}, thread=${fixtures.threadId}, assoc1=${fixtures.assoc1}, assoc2=${fixtures.assoc2}\n`);

    const threadMuts = THREAD_ASSOC_MUTATIONS(fixtures);
    const crmMuts    = CRM_EDIT_MUTATIONS();
    const adminMuts  = ADMIN_ONLY_MUTATIONS();
    const allJson    = [...threadMuts, ...crmMuts, ...adminMuts];

    const adminCookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const a = authed(adminCookie);

    // ── Phase 1: anonymous → 401 ────────────────────────────────────────────
    console.log("── Phase 1: unauthenticated → 401 ──");
    for (const r of allJson) {
      const opts = {
        method: r.method,
        headers: { "Content-Type": "application/json", Origin: BASE },
        body: r.body == null ? undefined : JSON.stringify(r.body),
      };
      await expectStatus(`anon ${r.method} ${r.url}`, fetch(`${BASE}${r.url}`, opts), 401);
    }
    // bulk + attachments anon
    for (const url of [
      "/api/gmail/thread-associations/bulk-confirm",
      "/api/gmail/thread-associations/bulk-reject",
    ]) {
      await expectStatus(`anon POST ${url}`, fetch(`${BASE}${url}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: BASE },
        body: JSON.stringify({ items: [{ associationId: fixtures.assoc1, threadId: fixtures.threadId }] }),
      }), 401);
    }
    {
      const m = multipartAttachment("account", 10);
      await expectStatus(`anon POST /api/attachments`, fetch(`${BASE}/api/attachments`, {
        method: "POST", headers: { ...m.headers, Origin: BASE }, body: m.body,
      }), 401);
    }

    // ── Phase 2: viewer with view-only perms → 403 on all gated routes ─────
    console.log("\n── Phase 2: viewer all-modules = view → 403 ──");
    await setPerms(client, {
      crm: "view", quoting: "view", support: "view",
      partnerships: "view", communications: "view", team_workload: "view",
    });
    let viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    let v = authed(viewerCookie);

    for (const r of threadMuts) {
      await expectStatus(`viewer(view) ${r.method} ${r.url}`, callJson(v, r), 403);
    }
    for (const r of crmMuts) {
      await expectStatus(`viewer(view) ${r.method} ${r.url}`, callJson(v, r), 403);
    }
    for (const r of adminMuts) {
      await expectStatus(`viewer(view) ${r.method} ${r.url}`, callJson(v, r), 403);
    }
    await expectStatus(`viewer(view) POST /api/attachments`, callAttachment(v, "account", 10), 403);

    // bulk routes return 200 with everything skipped (per-item ACL skip)
    await expectBulkSkipped(`viewer(view) bulk-confirm`,
      v("/api/gmail/thread-associations/bulk-confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ associationId: fixtures.assoc1, threadId: fixtures.threadId }] }),
      }));
    await expectBulkSkipped(`viewer(view) bulk-reject`,
      v("/api/gmail/thread-associations/bulk-reject", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ associationId: fixtures.assoc2, threadId: fixtures.threadId }] }),
      }));

    // ── Phase 3: viewer with edit perms → CRM/section pass; thread+admin still 403 ──
    console.log("\n── Phase 3: viewer all-modules = edit → CRM gates pass; thread-assoc + admin still 403 ──");
    await setPerms(client, {
      crm: "edit", quoting: "edit", support: "edit",
      partnerships: "edit", communications: "edit", team_workload: "edit",
    });
    viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    v = authed(viewerCookie);

    for (const r of crmMuts) {
      await expectNot403(`viewer(edit) ${r.method} ${r.url}`, callJson(v, r));
    }
    await expectNot403(`viewer(edit) POST /api/attachments`, callAttachment(v, "account", 10));

    console.log("\n── Cross-mailbox thread-assoc — viewer still denied (no mail_team[1].edit) ──");
    for (const r of threadMuts) {
      await expectStatus(`viewer(edit, no-mail-team) ${r.method} ${r.url}`, callJson(v, r), 403);
    }
    await expectBulkSkipped(`viewer(edit, no-mail-team) bulk-confirm`,
      v("/api/gmail/thread-associations/bulk-confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ associationId: fixtures.assoc1, threadId: fixtures.threadId }] }),
      }));
    await expectBulkSkipped(`viewer(edit, no-mail-team) bulk-reject`,
      v("/api/gmail/thread-associations/bulk-reject", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ associationId: fixtures.assoc2, threadId: fixtures.threadId }] }),
      }));

    console.log("\n── Admin-only data-quality/ignore — viewer still denied ──");
    for (const r of adminMuts) {
      await expectStatus(`viewer(edit) ${r.method} ${r.url}`, callJson(v, r), 403);
    }

    // ── Phase 4: admin → not 403 on thread-assoc + admin-only ──────────────
    console.log("\n── Phase 4: master_admin → thread-assoc + admin-only gates pass ──");
    for (const r of threadMuts) {
      await expectNot403(`admin ${r.method} ${r.url}`, callJson(a, r));
    }
    for (const r of adminMuts) {
      await expectNot403(`admin ${r.method} ${r.url}`, callJson(a, r));
    }
    // Bulk routes — we deleted assoc1 via /confirm and assoc2 via /reject for
    // the single-item admin runs above, so re-issuing bulk on those ids will
    // now skip with reason="Not found". That still proves the admin path
    // reached the per-item ACL (no 401/403 short-circuit). Inspect status only.
    {
      const r = await a("/api/gmail/thread-associations/bulk-confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ associationId: fixtures.assoc1, threadId: fixtures.threadId }] }),
      });
      if (r.status === 200) ok("admin bulk-confirm \u2192 200 (ACL passed)");
      else { const t = await r.text().catch(()=>""); bad("admin bulk-confirm", `${r.status}: ${t.slice(0,160)}`); }
    }
    {
      const r = await a("/api/gmail/thread-associations/bulk-reject", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ associationId: fixtures.assoc2, threadId: fixtures.threadId }] }),
      });
      if (r.status === 200) ok("admin bulk-reject \u2192 200 (ACL passed)");
      else { const t = await r.text().catch(()=>""); bad("admin bulk-reject", `${r.status}: ${t.slice(0,160)}`); }
    }

  } catch (err) {
    bad(`runner crashed`, err?.message || String(err));
  } finally {
    await teardown(client, original, [fixtures?.assoc1, fixtures?.assoc2].filter(Boolean), fixtures?.msgId);
    await client.end();
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
