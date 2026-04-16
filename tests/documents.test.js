/**
 * Document Hub tests
 * Tests: upload, link, category filtering, record linkage, metadata update, deletion, permissions
 */
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import path from "path";

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";

// ── Auth helpers ─────────────────────────────────────────────────────────────

async function loginAs(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/connect\.sid=[^;]+/);
  return match ? match[0] : null;
}

async function authedFetch(cookie, path, opts = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Cookie: cookie },
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function ok(label) { console.log(`  ✅ ${label}`); passed++; results.push({ label, ok: true }); }
function fail(label, reason = "") { console.log(`  ❌ ${label}${reason ? ` — ${reason}` : ""}`); failed++; results.push({ label, ok: false, reason }); }

async function t(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (e) {
    fail(label, e.message);
  }
}

// ── Main test suite ──────────────────────────────────────────────────────────

async function run() {
  console.log("\n📄 Document Hub Tests\n");

  const trevorCookie = await loginAs("trevor@voltsafe.com", "alberni1444");
  if (!trevorCookie) { console.error("Login failed — aborting"); process.exit(1); }

  // ── 1. Unauthenticated access ────────────────────────────────────────────
  console.log("── Auth guard ──────────────────────────────────────────────");

  await t("GET /api/documents (unauthed) → 401", async () => {
    const r = await fetch(`${BASE}/api/documents`);
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
  });

  await t("POST /api/documents/link (unauthed) → 401", async () => {
    const r = await fetch(`${BASE}/api/documents/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", objectType: "general", objectId: 0 }),
    });
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
  });

  // ── 2. Link a URL document ────────────────────────────────────────────────
  console.log("\n── URL linking ─────────────────────────────────────────────");

  let linkDocId;
  await t("POST /api/documents/link — create URL link attached to account", async () => {
    const r = await authedFetch(trevorCookie, "/api/documents/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/cert-report.pdf",
        title: "CSA Cert Report",
        category: "certification",
        notes: "External certification report link",
        objectType: "account",
        objectId: 1,
      }),
    });
    if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
    const doc = await r.json();
    if (doc.source !== "link") throw new Error(`Expected source=link, got ${doc.source}`);
    if (doc.category !== "certification") throw new Error(`Expected category=certification, got ${doc.category}`);
    if (doc.url !== "https://example.com/cert-report.pdf") throw new Error("URL mismatch");
    linkDocId = doc.id;
  });

  await t("POST /api/documents/link — missing url → 400", async () => {
    const r = await authedFetch(trevorCookie, "/api/documents/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectType: "account", objectId: 1 }),
    });
    if (r.status !== 400) throw new Error(`Expected 400, got ${r.status}`);
  });

  await t("POST /api/documents/link — invalid objectType → 400", async () => {
    const r = await authedFetch(trevorCookie, "/api/documents/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", objectType: "fake_type", objectId: 1 }),
    });
    if (r.status !== 400) throw new Error(`Expected 400, got ${r.status}`);
  });

  // ── 3. File upload ────────────────────────────────────────────────────────
  console.log("\n── File upload ─────────────────────────────────────────────");

  let uploadDocId;
  await t("POST /api/attachments — upload file with category to project", async () => {
    const fd = new FormData();
    fd.append("file", Buffer.from("Fake PDF content"), { filename: "test-spec.pdf", contentType: "application/pdf" });
    fd.append("objectType", "project");
    fd.append("objectId", "1");
    fd.append("category", "drawing_spec");
    fd.append("title", "Test Spec Sheet");
    const r = await authedFetch(trevorCookie, "/api/attachments", {
      method: "POST",
      headers: fd.getHeaders(),
      body: fd,
    });
    if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
    const doc = await r.json();
    if (doc.source !== "upload") throw new Error(`Expected source=upload, got ${doc.source}`);
    if (doc.category !== "drawing_spec") throw new Error(`Expected category=drawing_spec, got ${doc.category}`);
    if (doc.title !== "Test Spec Sheet") throw new Error("Title mismatch");
    uploadDocId = doc.id;
  });

  await t("POST /api/attachments — upload to opportunity (broadened types)", async () => {
    const fd = new FormData();
    fd.append("file", Buffer.from("Quote document"), { filename: "quote.pdf", contentType: "application/pdf" });
    fd.append("objectType", "opportunity");
    fd.append("objectId", "1");
    fd.append("category", "quote_proposal");
    const r = await authedFetch(trevorCookie, "/api/attachments", {
      method: "POST",
      headers: fd.getHeaders(),
      body: fd,
    });
    if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
    const doc = await r.json();
    if (doc.category !== "quote_proposal") throw new Error("Category mismatch");
  });

  await t("POST /api/attachments — missing file → 400", async () => {
    const fd = new FormData();
    fd.append("objectType", "project");
    fd.append("objectId", "1");
    const r = await authedFetch(trevorCookie, "/api/attachments", {
      method: "POST",
      headers: fd.getHeaders(),
      body: fd,
    });
    if (r.status !== 400) throw new Error(`Expected 400, got ${r.status}`);
  });

  // ── 4. GET /api/documents (hub) ───────────────────────────────────────────
  console.log("\n── Document Hub listing ────────────────────────────────────");

  await t("GET /api/documents → 200 with documents array and total", async () => {
    const r = await authedFetch(trevorCookie, "/api/documents");
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const body = await r.json();
    if (!Array.isArray(body.documents)) throw new Error("Expected body.documents array");
    if (typeof body.total !== "number") throw new Error("Expected body.total number");
  });

  await t("GET /api/documents?category=certification → filters by category", async () => {
    const r = await authedFetch(trevorCookie, "/api/documents?category=certification");
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const body = await r.json();
    const nonCert = body.documents.filter(d => d.category !== "certification");
    if (nonCert.length > 0) throw new Error(`Found non-certification docs in filtered result: ${nonCert.map(d => d.category).join(", ")}`);
  });

  await t("GET /api/documents?objectType=project → filters by objectType", async () => {
    const r = await authedFetch(trevorCookie, "/api/documents?objectType=project");
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const body = await r.json();
    const nonProject = body.documents.filter(d => d.objectType !== "project");
    if (nonProject.length > 0) throw new Error(`Found non-project docs in filtered result`);
  });

  await t("GET /api/documents?search=Spec → search by title/name", async () => {
    const r = await authedFetch(trevorCookie, "/api/documents?search=Spec");
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const body = await r.json();
    if (!Array.isArray(body.documents)) throw new Error("Expected documents array");
  });

  await t("GET /api/documents?limit=2&offset=0 → respects pagination", async () => {
    const r = await authedFetch(trevorCookie, "/api/documents?limit=2&offset=0");
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const body = await r.json();
    if (body.documents.length > 2) throw new Error(`Expected at most 2 results, got ${body.documents.length}`);
  });

  // ── 5. Record-level attachment listing ───────────────────────────────────
  console.log("\n── Record attachment listing ────────────────────────────────");

  await t("GET /api/attachments?objectType=project&objectId=1 → lists docs for project", async () => {
    const r = await authedFetch(trevorCookie, "/api/attachments?objectType=project&objectId=1");
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const docs = await r.json();
    if (!Array.isArray(docs)) throw new Error("Expected array");
    const hasUploaded = docs.some(d => d.category === "drawing_spec");
    if (!hasUploaded) throw new Error("Expected to find the spec sheet uploaded earlier");
  });

  await t("GET /api/attachments?objectType=account&objectId=1 → includes linked URL doc", async () => {
    const r = await authedFetch(trevorCookie, "/api/attachments?objectType=account&objectId=1");
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const docs = await r.json();
    const linked = docs.find(d => d.id === linkDocId);
    if (!linked) throw new Error("Expected to find the URL link document");
    if (linked.source !== "link") throw new Error("Expected source=link");
  });

  // ── 6. Metadata update (PATCH) ────────────────────────────────────────────
  console.log("\n── Metadata update ─────────────────────────────────────────");

  await t("PATCH /api/attachments/:id — update category and notes", async () => {
    if (!linkDocId) throw new Error("linkDocId not set");
    const r = await authedFetch(trevorCookie, `/api/attachments/${linkDocId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "contract", notes: "Updated notes" }),
    });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const doc = await r.json();
    if (doc.category !== "contract") throw new Error("Category not updated");
    if (doc.notes !== "Updated notes") throw new Error("Notes not updated");
  });

  await t("PATCH /api/attachments/:id (unauthed) → 401", async () => {
    if (!linkDocId) throw new Error("linkDocId not set");
    const r = await fetch(`${BASE}/api/attachments/${linkDocId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "general" }),
    });
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
  });

  await t("PATCH /api/attachments/99999 → 404", async () => {
    const r = await authedFetch(trevorCookie, "/api/attachments/99999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "general" }),
    });
    if (r.status !== 404) throw new Error(`Expected 404, got ${r.status}`);
  });

  // ── 7. Deletion ───────────────────────────────────────────────────────────
  console.log("\n── Deletion ────────────────────────────────────────────────");

  await t("DELETE /api/attachments/:id — owner can delete", async () => {
    if (!linkDocId) throw new Error("linkDocId not set");
    const r = await authedFetch(trevorCookie, `/api/attachments/${linkDocId}`, { method: "DELETE" });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  await t("GET /api/documents?category=certification → link doc no longer appears", async () => {
    const r = await authedFetch(trevorCookie, "/api/documents?category=certification");
    const body = await r.json();
    const found = body.documents.some(d => d.id === linkDocId);
    if (found) throw new Error("Deleted doc still appears in hub");
  });

  // Clean up uploaded doc
  if (uploadDocId) {
    await authedFetch(trevorCookie, `/api/attachments/${uploadDocId}`, { method: "DELETE" });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n── Summary ──────────────────────────────────────────────────`);
  console.log(`  Total: ${passed + failed} | ✅ ${passed} passed | ❌ ${failed} failed\n`);

  if (failed > 0) {
    console.log("Failed tests:");
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.label}: ${r.reason}`));
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
