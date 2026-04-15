/**
 * Certification Oversight Layer Tests — Phase 5
 * Tests: dashboard summary, cert filters, attachments, timeline events
 *
 * Run: node tests/oversight.test.js
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────
const BASE = "http://localhost:5000";
let cookieJar = "";

async function req(method, url, body, extraHeaders = {}) {
  const isForm = body instanceof FormData;
  const headers = { Cookie: cookieJar, ...extraHeaders };
  let bodyBuf;
  if (isForm) {
    Object.assign(headers, body.getHeaders());
    bodyBuf = await new Promise((res, rej) => {
      const chunks = [];
      body.pipe({ write: c => chunks.push(c), end: () => res(Buffer.concat(chunks)), on: () => {}, once: () => {} });
    });
    // simpler approach:
    bodyBuf = body;
  } else if (body) {
    headers["Content-Type"] = "application/json";
  }

  return new Promise((resolve, reject) => {
    const u = new URL(url, BASE);
    const options = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers,
    };
    const r = http.request(options, res => {
      const sc = res.headers["set-cookie"];
      if (sc) cookieJar = sc.map(c => c.split(";")[0]).join("; ");
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(raw); } catch { json = raw; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });
    r.on("error", reject);
    if (body instanceof FormData) {
      body.pipe(r);
    } else if (body) {
      r.write(JSON.stringify(body));
      r.end();
    } else {
      r.end();
    }
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${msg}\n`); }
  else { fail++; failures.push(msg); process.stdout.write(`  ✗ ${msg}\n`); }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
let testProjectId;
let testAttachmentId;

async function login() {
  const res = await req("POST", "/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
  assert(res.status === 200, "Login succeeds");
  assert(res.body?.id === 4 || res.body?.userId === 4, "Logged in as userId=4");
}

async function createCertProject() {
  const res = await req("POST", "/api/projects", {
    name: `Oversight Test Cert ${Date.now()}`,
    type: "certification",
    status: "active",
    description: "Oversight layer test project",
  });
  assert(res.status === 201 || res.status === 200, "Create certification project");
  testProjectId = res.body?.id;
  assert(typeof testProjectId === "number", `Project created with id=${testProjectId}`);
}

async function setupCertRecord() {
  const res = await req("POST", `/api/projects/${testProjectId}/certification`, {
    certificationStatus: "In Progress",
    certificationProgram: "UL",
    productName: "VoltSafe Dock Pro",
    overallRisk: "Medium",
    launchBlocker: false,
    retestRequired: false,
  });
  assert(res.status === 200, "Upsert certification record");
}

// ── Phase 1: Dashboard Summary ────────────────────────────────────────────────
async function testCertSummary() {
  console.log("\n── Phase 1: Cert Summary Dashboard ──────────────────────────");

  const res = await req("GET", "/api/projects/cert-summary");
  assert(res.status === 200, "GET /api/projects/cert-summary → 200");
  assert(typeof res.body === "object" && !Array.isArray(res.body), "Response is an object");

  const keys = ["total", "blocked", "at_risk", "on_track", "retest_required", "certified", "cert_expiring_90d", "failure_open", "next_due_items"];
  for (const k of keys) {
    assert(k in res.body, `Summary has key: ${k}`);
  }
  assert(typeof res.body.total === "number", "total is a number");
  assert(res.body.total >= 1, `total >= 1 (got ${res.body.total})`);
  assert(Array.isArray(res.body.next_due_items), "next_due_items is an array");
  assert(typeof res.body.blocked === "number", "blocked is a number");
  assert(typeof res.body.certified === "number", "certified is a number");
}

// ── Phase 2: Cert Filters ─────────────────────────────────────────────────────
async function testCertFilters() {
  console.log("\n── Phase 2: Cert Quick-Filters ──────────────────────────────");

  // No certFilter — should return all projects
  const all = await req("GET", "/api/projects");
  assert(all.status === 200, "GET /api/projects (no filter) → 200");
  assert(Array.isArray(all.body), "Returns array");

  // certFilter=blocked
  const blocked = await req("GET", "/api/projects?certFilter=blocked");
  assert(blocked.status === 200, "GET /api/projects?certFilter=blocked → 200");
  assert(Array.isArray(blocked.body), "certFilter=blocked returns array");
  for (const p of blocked.body) {
    assert(p.type === "certification", `certFilter=blocked: project type is certification (id=${p.id})`);
    assert(p.launch_blocker === true, `certFilter=blocked: launch_blocker=true (id=${p.id})`);
  }

  // certFilter=passed
  const passed = await req("GET", "/api/projects?certFilter=passed");
  assert(passed.status === 200, "GET /api/projects?certFilter=passed → 200");
  assert(Array.isArray(passed.body), "certFilter=passed returns array");

  // certFilter=retest
  const retest = await req("GET", "/api/projects?certFilter=retest");
  assert(retest.status === 200, "GET /api/projects?certFilter=retest → 200");

  // certFilter=due_30
  const due30 = await req("GET", "/api/projects?certFilter=due_30");
  assert(due30.status === 200, "GET /api/projects?certFilter=due_30 → 200");

  // certFilter=cert_expiring
  const expiring = await req("GET", "/api/projects?certFilter=cert_expiring");
  assert(expiring.status === 200, "GET /api/projects?certFilter=cert_expiring → 200");

  // certFilter=blocked with a blocked project — set blocker and re-check
  const setBlocker = await req("PUT", `/api/projects/${testProjectId}/certification`, {
    launchBlocker: true, blockerSummary: "Hardware redesign required",
  });
  assert(setBlocker.status === 200, "Set launch_blocker=true on test project");
  assert(setBlocker.body?.launch_blocker === true, "Cert record reflects launch_blocker=true");

  const blockedAfter = await req("GET", "/api/projects?certFilter=blocked");
  assert(Array.isArray(blockedAfter.body), "certFilter=blocked returns array after setting blocker");
  const foundProject = blockedAfter.body.find(p => p.id === testProjectId);
  assert(!!foundProject, `Test project appears in certFilter=blocked results`);

  // Clear the blocker
  await req("PUT", `/api/projects/${testProjectId}/certification`, { launchBlocker: false });
}

// ── Phase 3: Attachments ──────────────────────────────────────────────────────
async function testAttachments() {
  console.log("\n── Phase 3: Attachments ─────────────────────────────────────");

  // GET attachments (empty)
  const empty = await req("GET", `/api/projects/${testProjectId}/attachments`);
  assert(empty.status === 200, "GET attachments → 200");
  assert(Array.isArray(empty.body), "Returns array");

  // Create a test file to upload
  const tmpFile = path.join(__dirname, `test_upload_${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, "VoltSafe certification attachment test content");

  try {
    const fd = new FormData();
    fd.append("file", fs.createReadStream(tmpFile), { filename: "test-cert-doc.txt", contentType: "text/plain" });

    // POST attachment using form-data
    const uploadRes = await new Promise((resolve, reject) => {
      const headers = { ...fd.getHeaders(), Cookie: cookieJar };
      const u = new URL(`/api/projects/${testProjectId}/attachments`, BASE);
      const opts = { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers };
      const r = http.request(opts, res => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let json; try { json = JSON.parse(raw); } catch { json = raw; }
          resolve({ status: res.statusCode, body: json });
        });
      });
      r.on("error", reject);
      fd.pipe(r);
    });

    assert(uploadRes.status === 201, `POST attachment → 201 (got ${uploadRes.status})`);
    assert(typeof uploadRes.body?.id === "number", "Attachment created with numeric id");
    testAttachmentId = uploadRes.body?.id;

    const original = uploadRes.body?.original_name;
    assert(original === "test-cert-doc.txt", `original_name = "${original}"`);
    assert(uploadRes.body?.file_size > 0, "file_size > 0");
    assert(uploadRes.body?.mime_type === "text/plain", `mime_type = "${uploadRes.body?.mime_type}"`);
    assert(uploadRes.body?.project_id === testProjectId, "project_id matches");

    // GET attachments (should now have 1)
    const list = await req("GET", `/api/projects/${testProjectId}/attachments`);
    assert(list.status === 200, "GET attachments after upload → 200");
    assert(Array.isArray(list.body) && list.body.length >= 1, `Attachment list has ≥1 entries (got ${list.body?.length})`);
    const found = list.body.find(a => a.id === testAttachmentId);
    assert(!!found, "Uploaded attachment appears in list");

    // Download attachment
    const dlRes = await req("GET", `/api/projects/${testProjectId}/attachments/${testAttachmentId}/download`);
    assert(dlRes.status === 200, "Download attachment → 200");

    // DELETE attachment
    const delRes = await req("DELETE", `/api/projects/${testProjectId}/attachments/${testAttachmentId}`);
    assert(delRes.status === 200, "DELETE attachment → 200");
    assert(delRes.body?.ok === true, "Delete returns ok:true");

    // Confirm deleted
    const listAfter = await req("GET", `/api/projects/${testProjectId}/attachments`);
    const stillThere = (listAfter.body ?? []).find(a => a.id === testAttachmentId);
    assert(!stillThere, "Deleted attachment no longer in list");

    // DELETE non-existent → 404
    const del404 = await req("DELETE", `/api/projects/${testProjectId}/attachments/${testAttachmentId}`);
    assert(del404.status === 404, "DELETE non-existent attachment → 404");

  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

// ── Phase 4: Timeline Events ──────────────────────────────────────────────────
async function testTimeline() {
  console.log("\n── Phase 4: Timeline Events ─────────────────────────────────");

  // GET timeline (may or may not have events at this point)
  const tl = await req("GET", `/api/projects/${testProjectId}/timeline`);
  assert(tl.status === 200, "GET /api/projects/:id/timeline → 200");
  assert(Array.isArray(tl.body), "Timeline returns array");

  const countBefore = tl.body.length;

  // Trigger status_change event
  const statusChange = await req("PUT", `/api/projects/${testProjectId}/certification`, {
    certificationStatus: "Pre-Testing",
  });
  assert(statusChange.status === 200, "PUT cert status → 200 (triggers status_change event)");

  // Trigger launch_blocker_on event
  await req("PUT", `/api/projects/${testProjectId}/certification`, {
    launchBlocker: true, blockerSummary: "Timeline test blocker",
  });

  // Trigger launch_blocker_off event
  await req("PUT", `/api/projects/${testProjectId}/certification`, {
    launchBlocker: false,
  });

  // Trigger retest_required event
  await req("PUT", `/api/projects/${testProjectId}/certification`, {
    retestRequired: true,
  });

  // Small delay for DB writes
  await new Promise(r => setTimeout(r, 300));

  const tl2 = await req("GET", `/api/projects/${testProjectId}/timeline`);
  assert(tl2.status === 200, "GET timeline after events → 200");
  assert(Array.isArray(tl2.body), "Timeline still returns array");
  assert(tl2.body.length > countBefore, `Timeline grew: ${countBefore} → ${tl2.body.length}`);

  const types = tl2.body.map(e => e.event_type);
  assert(types.includes("status_change"), "Timeline has status_change event");
  assert(types.includes("launch_blocker_on"), "Timeline has launch_blocker_on event");
  assert(types.includes("launch_blocker_off"), "Timeline has launch_blocker_off event");
  assert(types.includes("retest_required"), "Timeline has retest_required event");

  // Validate event shape
  const ev = tl2.body[0];
  assert(typeof ev.id === "number", "Event has numeric id");
  assert(ev.project_id === testProjectId, "Event has correct project_id");
  assert(typeof ev.event_type === "string", "Event has event_type");
  assert(typeof ev.description === "string", "Event has description");
  assert(typeof ev.created_at === "string", "Event has created_at");

  // Milestone completion emits timeline event
  const milestones = await req("GET", `/api/projects/${testProjectId}/milestones`);
  if (Array.isArray(milestones.body) && milestones.body.length > 0) {
    const first = milestones.body[0];
    await req("PATCH", `/api/projects/${testProjectId}/milestones/${first.id}`, { status: "done" });
    await new Promise(r => setTimeout(r, 300));
    const tl3 = await req("GET", `/api/projects/${testProjectId}/timeline`);
    const milestoneDone = tl3.body.find(e => e.event_type === "milestone_done");
    assert(!!milestoneDone, "Milestone completion emits milestone_done timeline event");
    if (milestoneDone) {
      assert(typeof milestoneDone.description === "string" && milestoneDone.description.includes("Milestone"), `milestone_done description: "${milestoneDone.description}"`);
    }
  } else {
    assert(true, "No milestones to test milestone_done (skipped)");
  }

  // limit param
  const limited = await req("GET", `/api/projects/${testProjectId}/timeline?limit=2`);
  assert(limited.status === 200, "GET timeline?limit=2 → 200");
  assert(Array.isArray(limited.body) && limited.body.length <= 2, `Timeline limit=2 returns ≤2 events (got ${limited.body.length})`);

  // Timeline for non-existent project returns empty
  const tl404 = await req("GET", `/api/projects/999999/timeline`);
  assert(tl404.status === 200 && Array.isArray(tl404.body) && tl404.body.length === 0, "Timeline for non-existent project returns empty array");
}

// ── Cleanup ────────────────────────────────────────────────────────────────────
async function cleanup() {
  if (testProjectId) {
    await req("DELETE", `/api/projects/${testProjectId}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Certification Oversight Layer Tests (Phase 5) ===\n");
  try {
    await login();
    await createCertProject();
    await setupCertRecord();

    await testCertSummary();
    await testCertFilters();
    await testAttachments();
    await testTimeline();

    await cleanup();
  } catch (err) {
    console.error("\nFatal test error:", err);
    process.exitCode = 1;
  }

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (failures.length) {
    console.log("\nFailed assertions:");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

main();
