/**
 * Smoke test for the app-wide BOLA sweep (Round 2).
 *
 * Covers:
 *   - /api/notes/:id/pin              — owner-or-admin write
 *   - /api/saved-views/:id PUT        — owner-or-shared-or-admin write
 *   - /api/tasks/:id PUT              — owner/creator-or-admin write + ownership-field stripping
 *   - /api/activities/export          — section-view gate by objectType
 *   - /api/tasks/export               — auto-scoped to caller when no filters
 *   - /api/install-workflows/* prefix — section gate (crm:view)
 *   - /api/procurement/* prefix       — section gate (crm:view)
 *
 * Re-uses the seeded low-perm fixture (lowperm@voltsafe.com).
 */
import * as http from "http";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";

interface Resp { status: number; body: any; cookies: string[]; raw: string; }

async function req(
  method: string, urlPath: string,
  opts: { cookie?: string; body?: any; headers?: Record<string, string> } = {},
): Promise<Resp> {
  const url = new URL(urlPath, BASE);
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  let bodyBuf: string | undefined;
  if (opts.body !== undefined) {
    bodyBuf = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(bodyBuf));
  }
  if (!headers["Origin"] && method !== "GET") headers["Origin"] = BASE;
  return await new Promise((resolve, reject) => {
    const r = http.request({
      method, hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: any = raw;
        try { body = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode || 0, body, cookies: (res.headers["set-cookie"] as string[]) || [], raw });
      });
    });
    r.on("error", reject);
    if (bodyBuf) r.write(bodyBuf);
    r.end();
  });
}

async function login(email: string, password: string): Promise<string> {
  const r = await req("POST", "/api/auth/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`login(${email}) → ${r.status}: ${r.raw}`);
  const c = (r.cookies.find((x) => x.startsWith("connect.sid=")) || "").split(";")[0];
  if (!c) throw new Error(`no session for ${email}`);
  return c;
}

const results: { label: string; ok: boolean; detail: string }[] = [];
const check = (label: string, ok: boolean, detail = "") => results.push({ label, ok, detail });

async function main() {
  console.log("\n=== BOLA sweep smoke test ===\n");

  const adminCookie = await login("trevor@voltsafe.com", "alberni1444");
  console.log("✓ admin login");

  const lowCookie = await login("lowperm@voltsafe.com", "lowperm1444");
  console.log("✓ low-perm login");

  // Clear must_change_password for the low-perm fixture (same as F-09 test).
  await req("POST", "/api/auth/change-password", {
    cookie: lowCookie,
    body: { currentPassword: "lowperm1444", newPassword: "lowperm1444" },
  });
  console.log("✓ cleared must_change_password");

  // ── Section gates: install-workflows + procurement ────────────────────────
  const iwAdmin = await req("GET", "/api/install-workflows", { cookie: adminCookie });
  const iwLow   = await req("GET", "/api/install-workflows", { cookie: lowCookie });
  check("install-workflows: admin allowed (200)", iwAdmin.status === 200, `status=${iwAdmin.status}`);
  check("install-workflows: low-perm blocked (403)", iwLow.status === 403, `status=${iwLow.status}`);

  const iwIdAdmin = await req("GET", "/api/install-workflows/1", { cookie: adminCookie });
  const iwIdLow   = await req("GET", "/api/install-workflows/1", { cookie: lowCookie });
  check("install-workflows/:id: low-perm blocked (403)", iwIdLow.status === 403, `status=${iwIdLow.status}`);
  check("install-workflows/:id: admin not 403", iwIdAdmin.status !== 403, `status=${iwIdAdmin.status}`);

  const poAdmin = await req("GET", "/api/procurement/purchase-orders", { cookie: adminCookie });
  const poLow   = await req("GET", "/api/procurement/purchase-orders", { cookie: lowCookie });
  check("procurement/purchase-orders: admin allowed (200)", poAdmin.status === 200, `status=${poAdmin.status}`);
  check("procurement/purchase-orders: low-perm blocked (403)", poLow.status === 403, `status=${poLow.status}`);

  const supLow = await req("GET", "/api/procurement/suppliers", { cookie: lowCookie });
  check("procurement/suppliers: low-perm blocked (403)", supLow.status === 403, `status=${supLow.status}`);

  // ── Notes pin: create as admin, low-perm cannot pin/unpin ─────────────────
  const noteCreate = await req("POST", "/api/notes", {
    cookie: adminCookie,
    body: { content: "BOLA sweep test note", objectType: "account", objectId: 1 },
  });
  if (noteCreate.status !== 201 && noteCreate.status !== 200) {
    console.log("⚠️  could not seed note (status=" + noteCreate.status + "), skipping pin test");
  } else {
    const noteId = noteCreate.body?.id;
    const pinLow = await req("PATCH", `/api/notes/${noteId}/pin`, { cookie: lowCookie });
    check("notes/:id/pin: low-perm blocked (403)", pinLow.status === 403, `status=${pinLow.status}`);
    const pinAdmin = await req("PATCH", `/api/notes/${noteId}/pin`, { cookie: adminCookie });
    check("notes/:id/pin: admin allowed (200)", pinAdmin.status === 200, `status=${pinAdmin.status}`);
    await req("DELETE", `/api/notes/${noteId}`, { cookie: adminCookie });
  }

  // ── Saved views: create as admin (private), low-perm cannot PUT ───────────
  const svCreate = await req("POST", "/api/saved-views", {
    cookie: adminCookie,
    body: { name: "BOLA test view", pageKey: "leads", isShared: false, isDefault: false },
  });
  if (svCreate.status === 201 || svCreate.status === 200) {
    const svId = svCreate.body?.id;
    const svLow = await req("PUT", `/api/saved-views/${svId}`, {
      cookie: lowCookie, body: { name: "hijacked" },
    });
    check("saved-views/:id PUT: low-perm blocked (403)", svLow.status === 403, `status=${svLow.status}`);
    const svBogus = await req("PUT", `/api/saved-views/9999999`, { cookie: lowCookie, body: { name: "x" } });
    check("saved-views/:id PUT: nonexistent → 404", svBogus.status === 404, `status=${svBogus.status}`);
    await req("DELETE", `/api/saved-views/${svId}`, { cookie: adminCookie });
  } else {
    console.log("⚠️  could not seed saved-view (status=" + svCreate.status + ")");
  }

  // ── Tasks PUT: low-perm cannot edit a task they don't own ─────────────────
  const taskCreate = await req("POST", "/api/tasks", {
    cookie: adminCookie,
    body: { title: "BOLA test task", linkedObjectType: "account", linkedObjectId: 1 },
  });
  if (taskCreate.status === 201 || taskCreate.status === 200) {
    const taskId = taskCreate.body?.id;
    const taskLow = await req("PUT", `/api/tasks/${taskId}`, {
      cookie: lowCookie, body: { title: "hijacked" },
    });
    check("tasks/:id PUT: low-perm blocked (403)", taskLow.status === 403, `status=${taskLow.status}`);
    const taskBogus = await req("PUT", `/api/tasks/9999999`, { cookie: lowCookie, body: { title: "x" } });
    check("tasks/:id PUT: nonexistent → 404", taskBogus.status === 404, `status=${taskBogus.status}`);
    await req("DELETE", `/api/tasks/${taskId}`, { cookie: adminCookie });
  } else {
    console.log("⚠️  could not seed task (status=" + taskCreate.status + ")");
  }

  // ── Exports: low-perm blocked when filtered by CRM object ────────────────
  const actExpLow = await req("GET", "/api/activities/export?objectType=account&objectId=1", { cookie: lowCookie });
  check("activities/export: low-perm blocked (403)", actExpLow.status === 403, `status=${actExpLow.status}`);

  const actExpAdmin = await req("GET", "/api/activities/export?objectType=account&objectId=1", { cookie: adminCookie });
  check("activities/export: admin allowed (200)", actExpAdmin.status === 200, `status=${actExpAdmin.status}`);

  const taskExpFilteredLow = await req("GET", "/api/tasks/export?linkedObjectType=account&linkedObjectId=1", { cookie: lowCookie });
  check("tasks/export: low-perm blocked when filtered by CRM (403)", taskExpFilteredLow.status === 403, `status=${taskExpFilteredLow.status}`);

  // Unfiltered export: should succeed but be auto-scoped to caller (no leak).
  // Seed a task as admin owned BY ADMIN, and verify low-perm export does NOT contain it.
  const adminTask = await req("POST", "/api/tasks", {
    cookie: adminCookie,
    body: { title: "ADMIN-ONLY-TASK-XYZ", linkedObjectType: "account", linkedObjectId: 1 },
  });
  const adminTaskId = (adminTask.status === 201 || adminTask.status === 200) ? adminTask.body?.id : null;
  const taskExpLow = await req("GET", "/api/tasks/export", { cookie: lowCookie });
  check("tasks/export: unfiltered low-perm returns 200 (scoped to self)", taskExpLow.status === 200, `status=${taskExpLow.status}`);
  // Data-isolation assertion (architect review): ensure the admin's task does not appear
  // in a low-perm caller's CSV body — i.e. the storage scope filter actually applies.
  const lowCsv = String(taskExpLow.raw || "");
  check("tasks/export: low-perm CSV excludes admin's task (real scope, not just status)",
    !lowCsv.includes("ADMIN-ONLY-TASK-XYZ"),
    `csv contains admin task? ${lowCsv.includes("ADMIN-ONLY-TASK-XYZ")}`);
  // Caller-supplied owner override is ignored for non-admins.
  const taskExpOverride = await req("GET", `/api/tasks/export?owner=1`, { cookie: lowCookie });
  const overrideCsv = String(taskExpOverride.raw || "");
  check("tasks/export: caller-supplied ?owner=1 cannot bypass self-scope (low-perm)",
    !overrideCsv.includes("ADMIN-ONLY-TASK-XYZ"),
    `csv contains admin task via override? ${overrideCsv.includes("ADMIN-ONLY-TASK-XYZ")}`);
  // Architect round-3: partial filter shape must NOT bypass scoping —
  // linkedObjectType without linkedObjectId now returns 400.
  const partial1 = await req("GET", "/api/tasks/export?linkedObjectType=account", { cookie: lowCookie });
  check("tasks/export: linkedObjectType without linkedObjectId → 400 (low-perm)", partial1.status === 400, `status=${partial1.status}`);
  const partial2 = await req("GET", "/api/tasks/export?linkedObjectType=account&linkedObjectId=notanumber", { cookie: lowCookie });
  check("tasks/export: invalid linkedObjectId → 400 (low-perm)", partial2.status === 400, `status=${partial2.status}`);
  // Even with the partial-filter bypass attempt + ?owner override, no leak occurs.
  const partial3 = await req("GET", "/api/tasks/export?linkedObjectType=account&owner=1", { cookie: lowCookie });
  const partial3Csv = String(partial3.raw || "");
  check("tasks/export: partial filter + owner override does not leak admin task",
    !partial3Csv.includes("ADMIN-ONLY-TASK-XYZ") && partial3.status !== 200 ? true : !partial3Csv.includes("ADMIN-ONLY-TASK-XYZ"),
    `status=${partial3.status} csv contains admin task? ${partial3Csv.includes("ADMIN-ONLY-TASK-XYZ")}`);
  if (adminTaskId) await req("DELETE", `/api/tasks/${adminTaskId}`, { cookie: adminCookie });

  // ── Round-3: cross-section export bypass (architect review #3) ────────────
  // A user with crm:view but without projects:view / quoting:view /
  // partnerships:view must NOT be able to export activities or tasks for those
  // objectTypes via the export endpoints.
  const xProj = await req("GET", "/api/activities/export?objectType=project&objectId=1", { cookie: lowCookie });
  check("activities/export: low-perm blocked on objectType=project (cross-section)", xProj.status === 403, `status=${xProj.status}`);
  const xQuote = await req("GET", "/api/activities/export?objectType=quote&objectId=1", { cookie: lowCookie });
  check("activities/export: low-perm blocked on objectType=quote (cross-section)", xQuote.status === 403, `status=${xQuote.status}`);
  const xPart = await req("GET", "/api/activities/export?objectType=partnership&objectId=1", { cookie: lowCookie });
  check("activities/export: low-perm blocked on objectType=partnership (cross-section)", xPart.status === 403, `status=${xPart.status}`);
  const xUnknown = await req("GET", "/api/activities/export?objectType=fictional&objectId=1", { cookie: lowCookie });
  check("activities/export: unknown objectType → 400 (fail closed)", xUnknown.status === 400, `status=${xUnknown.status}`);
  const xtProj = await req("GET", "/api/tasks/export?linkedObjectType=project&linkedObjectId=1", { cookie: lowCookie });
  check("tasks/export: low-perm blocked on linkedObjectType=project (cross-section)", xtProj.status === 403, `status=${xtProj.status}`);
  const xtUnknown = await req("GET", "/api/tasks/export?linkedObjectType=fictional&linkedObjectId=1", { cookie: lowCookie });
  check("tasks/export: unknown linkedObjectType → 400 (fail closed)", xtUnknown.status === 400, `status=${xtUnknown.status}`);
  // Positive control: admin can still export activities for any of these sections.
  const xProjAdmin = await req("GET", "/api/activities/export?objectType=project&objectId=1", { cookie: adminCookie });
  check("activities/export: admin allowed on objectType=project (positive control)", xProjAdmin.status === 200, `status=${xProjAdmin.status}`);

  // ── Round-3b: equivalent JSON read paths must enforce the same BOLA gates ──
  // /api/activities (JSON) — was previously un-gated; mirror /api/activities/export.
  const aJsonProj = await req("GET", "/api/activities?objectType=project&objectId=1", { cookie: lowCookie });
  check("/api/activities (JSON): low-perm blocked on objectType=project", aJsonProj.status === 403, `status=${aJsonProj.status}`);
  const aJsonUnknown = await req("GET", "/api/activities?objectType=fictional&objectId=1", { cookie: lowCookie });
  check("/api/activities (JSON): unknown objectType → 400 (fail closed)", aJsonUnknown.status === 400, `status=${aJsonUnknown.status}`);
  const aJsonUnauth = await req("GET", "/api/activities?objectType=account&objectId=1");
  check("/api/activities (JSON): unauth → 401", aJsonUnauth.status === 401, `status=${aJsonUnauth.status}`);
  const aJsonAdmin = await req("GET", "/api/activities?objectType=project&objectId=1", { cookie: adminCookie });
  check("/api/activities (JSON): admin allowed on objectType=project", aJsonAdmin.status === 200, `status=${aJsonAdmin.status}`);

  // /api/tasks (JSON) — was previously un-gated; mirror /api/tasks/export.
  const tJsonProj = await req("GET", "/api/tasks?linkedObjectType=project&linkedObjectId=1", { cookie: lowCookie });
  check("/api/tasks (JSON): low-perm blocked on linkedObjectType=project", tJsonProj.status === 403, `status=${tJsonProj.status}`);
  const tJsonUnknown = await req("GET", "/api/tasks?linkedObjectType=fictional&linkedObjectId=1", { cookie: lowCookie });
  check("/api/tasks (JSON): unknown linkedObjectType → 400 (fail closed)", tJsonUnknown.status === 400, `status=${tJsonUnknown.status}`);
  const tJsonPartial = await req("GET", "/api/tasks?linkedObjectType=account", { cookie: lowCookie });
  check("/api/tasks (JSON): partial filter → 400", tJsonPartial.status === 400, `status=${tJsonPartial.status}`);
  const tJsonUnauth = await req("GET", "/api/tasks");
  check("/api/tasks (JSON): unauth → 401", tJsonUnauth.status === 401, `status=${tJsonUnauth.status}`);
  // Self-scope: low-perm GET /api/tasks must not contain admin-owned task.
  const adminTask2 = await req("POST", "/api/tasks", {
    cookie: adminCookie,
    body: { title: "ADMIN-ONLY-JSON-TASK-XYZ", linkedObjectType: "account", linkedObjectId: 1 },
  });
  const adminTaskId2 = (adminTask2.status === 201 || adminTask2.status === 200) ? adminTask2.body?.id : null;
  const tJsonLow = await req("GET", "/api/tasks", { cookie: lowCookie });
  const tJsonLowBody = JSON.stringify(tJsonLow.body || []);
  check("/api/tasks (JSON): low-perm self-scope hides admin task",
    tJsonLow.status === 200 && !tJsonLowBody.includes("ADMIN-ONLY-JSON-TASK-XYZ"),
    `status=${tJsonLow.status} contains? ${tJsonLowBody.includes("ADMIN-ONLY-JSON-TASK-XYZ")}`);
  const tJsonOverride = await req("GET", "/api/tasks?ownerUserId=1", { cookie: lowCookie });
  const tJsonOverrideBody = JSON.stringify(tJsonOverride.body || []);
  check("/api/tasks (JSON): caller-supplied ownerUserId ignored for low-perm",
    !tJsonOverrideBody.includes("ADMIN-ONLY-JSON-TASK-XYZ"),
    `contains? ${tJsonOverrideBody.includes("ADMIN-ONLY-JSON-TASK-XYZ")}`);
  if (adminTaskId2) await req("DELETE", `/api/tasks/${adminTaskId2}`, { cookie: adminCookie });

  // ── Round-3c: tasks/hub team-view BOLA + create-route hardening ───────────
  // Re-seed an admin task so we can check the hub team-view scope.
  const adminHub = await req("POST", "/api/tasks", {
    cookie: adminCookie,
    body: { title: "ADMIN-ONLY-HUB-XYZ", linkedObjectType: "account", linkedObjectId: 1 },
  });
  const adminHubId = (adminHub.status === 201 || adminHub.status === 200) ? adminHub.body?.id : null;

  const hubTeamLow = await req("GET", "/api/tasks/hub?view=team", { cookie: lowCookie });
  const hubTeamLowBody = JSON.stringify(hubTeamLow.body || {});
  check("/api/tasks/hub?view=team: low-perm self-scoped (does not leak admin task)",
    hubTeamLow.status === 200 && !hubTeamLowBody.includes("ADMIN-ONLY-HUB-XYZ"),
    `status=${hubTeamLow.status} contains? ${hubTeamLowBody.includes("ADMIN-ONLY-HUB-XYZ")}`);
  const hubUnauth = await req("GET", "/api/tasks/hub?view=team");
  check("/api/tasks/hub: unauth → 401", hubUnauth.status === 401, `status=${hubUnauth.status}`);

  // POST /api/tasks: low-perm CANNOT create a task owned by another user.
  // Use no linkedObjectType to isolate the ownerUserId-spoof check from the
  // section gate (low-perm has no section permissions, so any linkedObjectType
  // would 403 first).
  const spoofTask = await req("POST", "/api/tasks", {
    cookie: lowCookie,
    body: { title: "SPOOF-TASK", ownerUserId: 1 },
  });
  check("POST /api/tasks: low-perm ownerUserId override is forced to self",
    (spoofTask.status === 201 || spoofTask.status === 200) && spoofTask.body?.ownerUserId !== 1,
    `status=${spoofTask.status} ownerUserId=${spoofTask.body?.ownerUserId}`);
  if (spoofTask.body?.id) await req("DELETE", `/api/tasks/${spoofTask.body.id}`, { cookie: adminCookie });

  // POST /api/tasks: low-perm CANNOT create a task linked to a section it cannot view.
  const xSection = await req("POST", "/api/tasks", {
    cookie: lowCookie,
    body: { title: "CROSS-SECTION", linkedObjectType: "project", linkedObjectId: 1 },
  });
  check("POST /api/tasks: low-perm cross-section create blocked (403)",
    xSection.status === 403,
    `status=${xSection.status}`);

  // POST /api/activities: low-perm cross-section blocked. Uses the actual
  // persisted schema field name (linkedObjectType) — the gate must catch this
  // path, not just the legacy objectType alias.
  const xActivity = await req("POST", "/api/activities", {
    cookie: lowCookie,
    body: { linkedObjectType: "project", linkedObjectId: 1, type: "note", summary: "x" },
  });
  check("POST /api/activities: low-perm cross-section create blocked via linkedObjectType (403)",
    xActivity.status === 403,
    `status=${xActivity.status}`);
  // Same for the legacy objectType alias — both must reach the gate.
  const xActivityAlias = await req("POST", "/api/activities", {
    cookie: lowCookie,
    body: { objectType: "project", objectId: 1, type: "note", summary: "x" },
  });
  check("POST /api/activities: low-perm cross-section create blocked via objectType alias (403)",
    xActivityAlias.status === 403,
    `status=${xActivityAlias.status}`);
  // Unknown linkedObjectType must fail closed.
  const xActivityUnk = await req("POST", "/api/activities", {
    cookie: lowCookie,
    body: { linkedObjectType: "fictional", linkedObjectId: 1, type: "note", summary: "x" },
  });
  check("POST /api/activities: unknown linkedObjectType → 400",
    xActivityUnk.status === 400,
    `status=${xActivityUnk.status}`);

  // POST /api/activities: unauth → 401.
  const xActUnauth = await req("POST", "/api/activities", {
    body: { objectType: "account", objectId: 1, type: "note", summary: "x" },
  });
  check("POST /api/activities: unauth → 401", xActUnauth.status === 401, `status=${xActUnauth.status}`);

  if (adminHubId) await req("DELETE", `/api/tasks/${adminHubId}`, { cookie: adminCookie });

  // ── Auth boundary checks ──────────────────────────────────────────────────
  const unauth1 = await req("GET", "/api/install-workflows");
  const unauth2 = await req("GET", "/api/procurement/purchase-orders");
  const unauth3 = await req("PUT", "/api/tasks/1", { body: { title: "x" } });
  check("install-workflows unauth: 401", unauth1.status === 401, `status=${unauth1.status}`);
  check("procurement unauth: 401", unauth2.status === 401, `status=${unauth2.status}`);
  check("tasks PUT unauth: 401", unauth3.status === 401, `status=${unauth3.status}`);

  // ── Report ───────────────────────────────────────────────────────────────
  console.log("\n--- Results ---");
  let pass = 0, fail = 0;
  for (const r of results) {
    console.log((r.ok ? "  ✅ " : "  ❌ ") + r.label + (r.detail ? `  (${r.detail})` : ""));
    if (r.ok) pass++; else fail++;
  }
  console.log(`\n=== ${pass} passed / ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
