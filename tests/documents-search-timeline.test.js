/**
 * Document Hub — Phase 5 (Search) & Phase 6 (Timeline) tests
 * Tests: global search returns documents, result shape, navigation context,
 *        activity events for upload/link/delete/category-change.
 */
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import path from "path";

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";

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

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function pass(label) { console.log(`  ✅ ${label}`); passed++; }
function fail(label, detail) { console.log(`  ❌ ${label}`); if (detail) console.log(`     ${detail}`); failed++; }

async function check(label, fn) {
  try { await fn(); pass(label); }
  catch (e) { fail(label, e.message); }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
let cookie;
let accountId;
let uploadedDocId;
let linkedDocId;

async function setup() {
  cookie = await loginAs("trevor@voltsafe.com", "alberni1444");
  if (!cookie) throw new Error("Login failed");

  // Grab a real account to link docs to
  const accsRes = await authedFetch(cookie, "/api/accounts?limit=1");
  const accs = await accsRes.json();
  accountId = (accs.data ?? accs)[0]?.id ?? 1;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function uploadPdf(opts = {}) {
  const tmpFile = path.join("/tmp", `test-doc-${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, "%PDF-1.4 test content for search " + (opts.searchToken ?? ""));
  const fd = new FormData();
  fd.append("file", fs.createReadStream(tmpFile), { filename: "test.pdf", contentType: "application/pdf" });
  fd.append("objectType", opts.objectType ?? "account");
  fd.append("objectId", String(opts.objectId ?? accountId));
  fd.append("category", opts.category ?? "general");
  if (opts.title) fd.append("title", opts.title);
  if (opts.notes) fd.append("notes", opts.notes);
  const res = await authedFetch(cookie, "/api/attachments", { method: "POST", body: fd, headers: fd.getHeaders() });
  fs.unlinkSync(tmpFile);
  return res;
}

async function linkUrl(opts = {}) {
  return authedFetch(cookie, "/api/documents/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      objectType: opts.objectType ?? "account",
      objectId: opts.objectId ?? accountId,
      url: opts.url ?? "https://example.com/spec.pdf",
      title: opts.title ?? "Spec Sheet",
      category: opts.category ?? "drawing_spec",
      notes: opts.notes ?? null,
    }),
  });
}

// ── Seed documents for search tests ──────────────────────────────────────────
async function seedSearchDocs() {
  // Upload with a unique, searchable title
  const upRes = await uploadPdf({ title: "UNIQSEARCH_ContractDoc", category: "contract", notes: "VoltSafe MSA agreement" });
  const upDoc = await upRes.json();
  uploadedDocId = upDoc.id;

  // Link with a unique URL title
  const lnRes = await linkUrl({ title: "UNIQSEARCH_LabReport", category: "lab_report", url: "https://labs.voltsafe.com/report-99" });
  const lnDoc = await lnRes.json();
  linkedDocId = lnDoc.id;
}

// ── Test sections ─────────────────────────────────────────────────────────────

async function runSearchTests() {
  console.log("\n── Phase 5 — Global Search ─────────────────────────────────────────────────");

  await check("GET /api/search?q=UNIQSEARCH → returns document results", async () => {
    const res = await authedFetch(cookie, "/api/search?q=UNIQSEARCH");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const { results } = await res.json();
    const docs = results.filter(r => r.type === "document");
    if (docs.length === 0) throw new Error("No document results returned");
  });

  await check("Document result has required shape: type, id, label, sub, sub2, linked_id", async () => {
    const res = await authedFetch(cookie, "/api/search?q=UNIQSEARCH_ContractDoc");
    const { results } = await res.json();
    const doc = results.find(r => r.type === "document");
    if (!doc) throw new Error("No document result found");
    if (doc.type !== "document") throw new Error(`type mismatch: ${doc.type}`);
    if (!doc.id) throw new Error("id missing");
    if (!doc.label) throw new Error("label missing");
    if (!doc.sub) throw new Error("sub (category) missing");
    if (!doc.linked_id) throw new Error("linked_id missing");
    if (!doc.linked_id.includes(":")) throw new Error(`linked_id should be objectType:objectId, got ${doc.linked_id}`);
  });

  await check("Document result sub = category (e.g. 'contract')", async () => {
    const res = await authedFetch(cookie, "/api/search?q=UNIQSEARCH_ContractDoc");
    const { results } = await res.json();
    const doc = results.find(r => r.type === "document" && r.label.includes("ContractDoc"));
    if (!doc) throw new Error("Contract doc not found");
    if (doc.sub !== "contract") throw new Error(`Expected sub='contract', got '${doc.sub}'`);
  });

  await check("Document sub2 contains linked object context (e.g., account name)", async () => {
    const res = await authedFetch(cookie, "/api/search?q=UNIQSEARCH_ContractDoc");
    const { results } = await res.json();
    const doc = results.find(r => r.type === "document" && r.label.includes("ContractDoc"));
    if (!doc) throw new Error("Doc not found");
    // sub2 should be "Account · <name>" or similar — non-null and non-empty
    if (!doc.sub2 || doc.sub2.trim() === "") throw new Error(`sub2 empty: '${doc.sub2}'`);
  });

  await check("Search by notes content returns document", async () => {
    const res = await authedFetch(cookie, "/api/search?q=VoltSafe+MSA");
    const { results } = await res.json();
    const doc = results.find(r => r.type === "document");
    if (!doc) throw new Error("No document found by notes content");
  });

  await check("Search by category name returns document", async () => {
    const res = await authedFetch(cookie, "/api/search?q=lab_report");
    const { results } = await res.json();
    const doc = results.find(r => r.type === "document");
    if (!doc) throw new Error("No document found by category search");
  });

  await check("Documents appear alongside CRM results without drowning them (cap ≤ 4)", async () => {
    const res = await authedFetch(cookie, "/api/search?q=UNIQSEARCH");
    const { results } = await res.json();
    const docs = results.filter(r => r.type === "document");
    if (docs.length > 4) throw new Error(`Too many document results: ${docs.length} (cap is 4)`);
  });

  await check("Short query (<2 chars) returns empty results", async () => {
    const res = await authedFetch(cookie, "/api/search?q=U");
    const { results } = await res.json();
    if (results.length !== 0) throw new Error(`Expected empty results, got ${results.length}`);
  });

  await check("Linked_id encodes objectType:objectId correctly", async () => {
    const res = await authedFetch(cookie, "/api/search?q=UNIQSEARCH_ContractDoc");
    const { results } = await res.json();
    const doc = results.find(r => r.type === "document");
    if (!doc) throw new Error("Doc not found");
    const [linkedType, linkedId] = (doc.linked_id || "").split(":");
    if (!linkedType) throw new Error("linkedType missing from linked_id");
    if (!linkedId || isNaN(Number(linkedId))) throw new Error(`linkedId not numeric: '${linkedId}'`);
  });

  await check("GET /api/search (unauthed) → 401", async () => {
    const res = await fetch(`${BASE}/api/search?q=test`);
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });
}

async function runTimelineTests() {
  console.log("\n── Phase 6 — Timeline / Audit ──────────────────────────────────────────────");

  await check("Upload with notable category (contract) appears in account timeline", async () => {
    // Upload contract doc
    const upRes = await uploadPdf({ title: "MSA-2025", category: "contract" });
    if (upRes.status !== 201) throw new Error(`Upload failed: ${upRes.status}`);
    const doc = await upRes.json();

    // Small delay for async activity insert
    await new Promise(r => setTimeout(r, 300));

    // Fetch timeline for account
    const tlRes = await authedFetch(cookie, `/api/timeline/account/${accountId}?limit=20`);
    if (tlRes.status !== 200) throw new Error(`Timeline fetch failed: ${tlRes.status}`);
    const tl = await tlRes.json();
    const items = tl.items ?? tl;

    // Should have either an attachment item (auto from UNION) or an activity for important doc
    const hasDoc = items.some(i =>
      (i.type === "attachment" && (i.title || "").includes("MSA-2025")) ||
      (i.type === "activity" && (i.title || i.subject || "").toLowerCase().includes("important document"))
    );
    if (!hasDoc) throw new Error("Contract upload not reflected in timeline");

    // Clean up
    await authedFetch(cookie, `/api/attachments/${doc.id}`, { method: "DELETE" });
  });

  await check("Linked URL document appears in account timeline (as attachment)", async () => {
    const lnRes = await linkUrl({ title: "TimelineTestLink", category: "drawing_spec", url: "https://timeline-test.example.com" });
    if (lnRes.status !== 201) throw new Error(`Link failed: ${lnRes.status}`);
    const doc = await lnRes.json();

    await new Promise(r => setTimeout(r, 200));

    const tlRes = await authedFetch(cookie, `/api/timeline/account/${accountId}?limit=20`);
    const tl = await tlRes.json();
    const items = tl.items ?? tl;

    const found = items.some(i => i.type === "attachment" && (i.title || "").includes("TimelineTestLink"));
    if (!found) throw new Error("Linked URL not in timeline");

    await authedFetch(cookie, `/api/attachments/${doc.id}`, { method: "DELETE" });
  });

  await check("Deleting a document logs removal activity on the linked record", async () => {
    // Create a temp doc
    const upRes = await uploadPdf({ title: "DeleteMeDoc", category: "general" });
    const doc = await upRes.json();

    // Delete it
    const delRes = await authedFetch(cookie, `/api/attachments/${doc.id}`, { method: "DELETE" });
    if (delRes.status !== 200) throw new Error(`Delete failed: ${delRes.status}`);

    await new Promise(r => setTimeout(r, 300));

    const tlRes = await authedFetch(cookie, `/api/timeline/account/${accountId}?limit=30`);
    const tl = await tlRes.json();
    const items = tl.items ?? tl;

    const found = items.some(i =>
      i.type === "activity" &&
      (i.title || i.subject || "").toLowerCase().includes("document removed")
    );
    if (!found) throw new Error("Deletion activity not found in timeline");
  });

  await check("PATCH category change logs activity on linked record timeline", async () => {
    // Create a temp doc with category general
    const upRes = await uploadPdf({ title: "CatChangeDoc", category: "general" });
    const doc = await upRes.json();

    // Change category to contract
    const patchRes = await authedFetch(cookie, `/api/attachments/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "contract" }),
    });
    if (patchRes.status !== 200) throw new Error(`PATCH failed: ${patchRes.status}`);

    await new Promise(r => setTimeout(r, 300));

    const tlRes = await authedFetch(cookie, `/api/timeline/account/${accountId}?limit=30`);
    const tl = await tlRes.json();
    const items = tl.items ?? tl;

    const found = items.some(i =>
      i.type === "activity" &&
      (i.title || i.subject || "").toLowerCase().includes("category")
    );
    if (!found) throw new Error("Category change activity not found in timeline");

    // Clean up
    await authedFetch(cookie, `/api/attachments/${doc.id}`, { method: "DELETE" });
  });

  await check("PATCH with same category does NOT emit duplicate activity", async () => {
    const upRes = await uploadPdf({ title: "NoDupeDoc", category: "contract" });
    const doc = await upRes.json();

    // Count activities before
    const tl1Res = await authedFetch(cookie, `/api/timeline/account/${accountId}?limit=50`);
    const tl1 = await tl1Res.json();
    const countBefore = (tl1.items ?? tl1).filter(i =>
      i.type === "activity" && (i.title || i.subject || "").toLowerCase().includes("category")
    ).length;

    // PATCH with same category
    await authedFetch(cookie, `/api/attachments/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "contract" }),
    });

    await new Promise(r => setTimeout(r, 300));

    const tl2Res = await authedFetch(cookie, `/api/timeline/account/${accountId}?limit=50`);
    const tl2 = await tl2Res.json();
    const countAfter = (tl2.items ?? tl2).filter(i =>
      i.type === "activity" && (i.title || i.subject || "").toLowerCase().includes("category")
    ).length;

    if (countAfter > countBefore) throw new Error("Spurious category-change activity emitted for same-category PATCH");

    await authedFetch(cookie, `/api/attachments/${doc.id}`, { method: "DELETE" });
  });

  await check("Timeline attachment body shows category + source (not raw mime type)", async () => {
    const lnRes = await linkUrl({ title: "BodyTestDoc", category: "contract", url: "https://bodytest.example.com" });
    const doc = await lnRes.json();

    await new Promise(r => setTimeout(r, 200));

    const tlRes = await authedFetch(cookie, `/api/timeline/account/${accountId}?limit=20`);
    const tl = await tlRes.json();
    const items = tl.items ?? tl;

    const item = items.find(i => i.type === "attachment" && (i.title || "").includes("BodyTestDoc"));
    if (!item) throw new Error("Attachment not found in timeline");
    // body should contain "external link" (not "text/uri-list")
    const body = item.body ?? "";
    if (body.includes("text/uri-list")) throw new Error(`Body still shows raw mime type: ${body}`);
    if (!body.toLowerCase().includes("link")) throw new Error(`Body should mention 'link': ${body}`);

    await authedFetch(cookie, `/api/attachments/${doc.id}`, { method: "DELETE" });
  });
}

async function runRegressionTests() {
  console.log("\n── Regression — Existing document hub tests still pass ─────────────────────");

  await check("GET /api/documents → 200 with documents array", async () => {
    const res = await authedFetch(cookie, "/api/documents?limit=5");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.documents)) throw new Error("documents array missing");
  });

  await check("GET /api/documents?category=contract → filter works", async () => {
    const res = await authedFetch(cookie, "/api/documents?category=contract&limit=5");
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.documents)) throw new Error("documents array missing");
  });

  await check("POST /api/documents/link with invalid objectType → 400", async () => {
    const res = await authedFetch(cookie, "/api/documents/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectType: "banana", objectId: 1, url: "https://test.com" }),
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  await check("PATCH /api/attachments/99999 → 404", async () => {
    const res = await authedFetch(cookie, "/api/attachments/99999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "contract" }),
    });
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
async function cleanup() {
  // Remove the seeded search docs
  if (uploadedDocId) await authedFetch(cookie, `/api/attachments/${uploadedDocId}`, { method: "DELETE" });
  if (linkedDocId) await authedFetch(cookie, `/api/attachments/${linkedDocId}`, { method: "DELETE" });
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("\n📄 Document Hub — Search & Timeline Tests\n");
try {
  await setup();
  await seedSearchDocs();
  // Give DB a moment after seeding
  await new Promise(r => setTimeout(r, 300));
  await runSearchTests();
  await runTimelineTests();
  await runRegressionTests();
} finally {
  await cleanup();
}

console.log("\n── Summary ──────────────────────────────────────────────────────────────────");
console.log(`  Total: ${passed + failed} | ✅ ${passed} passed | ❌ ${failed} failed`);
if (failed > 0) process.exit(1);
