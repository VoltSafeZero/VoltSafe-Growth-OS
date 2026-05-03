#!/usr/bin/env node
/**
 * P1 Under-Gated Mutations — Commit #4 Regression Suite
 *
 * Verifies the remaining P1 mutation gates patched in commit #4:
 *
 *   support.edit (Jira):
 *     POST /api/jira/issues
 *     POST /api/jira/issues/:key/transitions
 *
 *   communications.edit (workspace email filters):
 *     POST   /api/email-filters
 *     DELETE /api/email-filters/:id
 *
 *   crm.edit (escalations):
 *     PATCH  /api/inbox/bulk-mark-done
 *     POST   /api/suggestions/:id/dismiss
 *     POST   /api/suggestions/:id/snooze
 *     POST   /api/tasks/suggestions/:id/dismiss
 *     POST   /api/tasks/suggestions/:id/snooze
 *
 *   In-handler ownership ACL on parent folder:
 *     POST   /api/mail-folders/:id/domains
 *     DELETE /api/mail-folders/:id/domains/:domainId
 *     DELETE /api/mail-folders/:id/emails/:emailId
 *
 * Phases:
 *   1. anonymous → 401
 *   2. viewer with VIEW perms only → 403 on every gated mutation
 *      and 403 on cross-owner mail-folder mutations (folder owned by another user)
 *   3. viewer with full edit perms → not 403 on the gated routes;
 *      cross-owner mail-folder mutations still 403 (in-handler check, not perms)
 *   4. admin → not 403 on cross-owner mail-folder mutations
 */

import bcrypt from "bcryptjs";
import pg from "pg";

const BASE = "http://localhost:5000";
const VIEWER_EMAIL = "viewer@voltsafe.com";
const VIEWER_PWD = "vstest_p1c4_!1";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";

let passed = 0;
let failed = 0;
const ok  = (l) => { console.log(`  \u2713 ${l}`); passed++; };
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

async function teardown(client, original, fixtureFolderId) {
  if (fixtureFolderId != null) {
    try { await client.query(`DELETE FROM mail_folder_domains WHERE folder_id = $1`, [fixtureFolderId]); } catch {}
    try { await client.query(`DELETE FROM email_folder_assignments WHERE folder_id = $1`, [fixtureFolderId]); } catch {}
    try { await client.query(`DELETE FROM mail_folders WHERE id = $1`, [fixtureFolderId]); } catch {}
  }
  if (!original) return;
  await client.query(
    `UPDATE users SET password = $1, permissions = $2 WHERE email = $3`,
    [original.password, original.permissions, VIEWER_EMAIL]);
}

async function createCrossOwnerFolder(client, viewerId) {
  // Create a mail_folders row owned by a *different* user (admin = trevor),
  // so the viewer hits the in-handler ACL.
  const admin = await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [ADMIN_EMAIL]);
  const ownerId = admin.rows[0]?.id;
  if (!ownerId || ownerId === viewerId) throw new Error("admin owner unavailable");
  const r = await client.query(
    `INSERT INTO mail_folders (owner_user_id, name, color, source_account_id)
     VALUES ($1, 'p1c4-crossowner', 'teal', NULL) RETURNING id`,
    [ownerId]);
  return r.rows[0].id;
}

async function pickIds(client) {
  const one = async (s) => (await client.query(s)).rows[0];
  return {
    suggestionId:     (await one(`SELECT id FROM suggestions ORDER BY id LIMIT 1`).catch(() => ({ rows: [{}] })))?.id ?? null,
    taskSuggestionId: (await one(`SELECT id FROM task_suggestions ORDER BY id LIMIT 1`).catch(() => ({ rows: [{}] })))?.id ?? null,
    threadId:         (await one(`SELECT gmail_thread_id FROM email_threads WHERE gmail_thread_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1`))?.gmail_thread_id ?? null,
  };
}

async function call(v, r) {
  return v(r.url, {
    method: r.method,
    headers: r.body == null ? {} : { "Content-Type": "application/json" },
    body: r.body == null ? undefined : JSON.stringify(r.body),
  });
}

const GATED_MUTATIONS = (ids) => [
  { method: "POST",   url: "/api/jira/issues",                            body: { projectKey: "TEST", summary: "p1c4" } },
  { method: "POST",   url: "/api/jira/issues/TEST-1/transitions",         body: { transitionId: "11" } },
  { method: "POST",   url: "/api/email-filters",                          body: { domain: "p1c4.example.com" } },
  { method: "DELETE", url: "/api/email-filters/999999",                   body: null },
  { method: "PATCH",  url: "/api/inbox/bulk-mark-done",                   body: { threadIds: [ids.threadId || "p1c4-thread"] } },
  ids.suggestionId != null
    ? { method: "POST", url: `/api/suggestions/${ids.suggestionId}/dismiss`, body: {} } : null,
  ids.suggestionId != null
    ? { method: "POST", url: `/api/suggestions/${ids.suggestionId}/snooze`,  body: { days: 3 } } : null,
  ids.taskSuggestionId != null
    ? { method: "POST", url: `/api/tasks/suggestions/${ids.taskSuggestionId}/dismiss`, body: {} } : null,
  ids.taskSuggestionId != null
    ? { method: "POST", url: `/api/tasks/suggestions/${ids.taskSuggestionId}/snooze`, body: { days: 3 } } : null,
].filter(Boolean);

const FOLDER_CROSS_OWNER_MUTATIONS = (folderId) => [
  { method: "POST",   url: `/api/mail-folders/${folderId}/domains`,             body: { domain: "p1c4-test.com" } },
  { method: "DELETE", url: `/api/mail-folders/${folderId}/domains/999999`,      body: null },
  { method: "DELETE", url: `/api/mail-folders/${folderId}/emails/999999`,       body: null },
];

async function run() {
  console.log("=== VoltSafe P1 Under-Gated Mutations — Commit #4 Regression ===\n");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let original = null;
  let crossFolderId = null;
  try {
    original = await setupViewer(client);
    crossFolderId = await createCrossOwnerFolder(client, original.id);
    const ids = await pickIds(client);
    console.log(`viewerId=${original.id}, crossFolderId=${crossFolderId}, ids=${JSON.stringify(ids)}\n`);

    const gated  = GATED_MUTATIONS(ids);
    const folder = FOLDER_CROSS_OWNER_MUTATIONS(crossFolderId);
    const all    = [...gated, ...folder];

    const adminCookie = await login(ADMIN_EMAIL, ADMIN_PWD);
    const a = authed(adminCookie);

    // ── Phase 1: anonymous → 401 ────────────────────────────────────────────
    console.log("── Phase 1: unauthenticated → 401 ──");
    for (const r of all) {
      const opts = {
        method: r.method,
        headers: { "Content-Type": "application/json", Origin: BASE },
        body: r.body == null ? undefined : JSON.stringify(r.body),
      };
      await expectStatus(`anon ${r.method} ${r.url}`, fetch(`${BASE}${r.url}`, opts), 401);
    }

    // ── Phase 2: viewer with view perms → 403 ───────────────────────────────
    console.log("\n── Phase 2: viewer all-modules = view → 403 ──");
    await setPerms(client, {
      crm: "view", quoting: "view", support: "view",
      partnerships: "view", communications: "view", team_workload: "view",
    });
    let viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    let v = authed(viewerCookie);

    for (const r of gated) {
      await expectStatus(`viewer(view) ${r.method} ${r.url}`, call(v, r), 403);
    }
    for (const r of folder) {
      // Viewer is not the folder owner and has no admin role → 403 from in-handler ACL.
      await expectStatus(`viewer(view, cross-owner) ${r.method} ${r.url}`, call(v, r), 403);
    }

    // ── Phase 3: viewer with edit perms → gated routes pass; cross-owner still 403 ──
    console.log("\n── Phase 3: viewer all-modules = edit → gated routes pass ──");
    await setPerms(client, {
      crm: "edit", quoting: "edit", support: "edit",
      partnerships: "edit", communications: "edit", team_workload: "edit",
    });
    viewerCookie = await login(VIEWER_EMAIL, VIEWER_PWD);
    v = authed(viewerCookie);

    for (const r of gated) {
      await expectNot403(`viewer(edit) ${r.method} ${r.url}`, call(v, r));
    }
    console.log("\n── Cross-owner mail-folder mutations — viewer still denied ──");
    for (const r of folder) {
      await expectStatus(`viewer(edit, cross-owner) ${r.method} ${r.url}`, call(v, r), 403);
    }

    // ── Phase 4: admin → not 403 on cross-owner mail-folder mutations ──────
    console.log("\n── Phase 4: master_admin → cross-owner mail-folder ACL passes ──");
    for (const r of folder) {
      await expectNot403(`admin ${r.method} ${r.url}`, call(a, r));
    }

  } catch (err) {
    bad(`runner crashed`, err?.message || String(err));
  } finally {
    await teardown(client, original, crossFolderId);
    await client.end();
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
