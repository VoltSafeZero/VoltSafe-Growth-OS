#!/usr/bin/env node
/**
 * Save URL to Cortex — regression + structure test suite
 *
 * Covers:
 *  1. Backend service layer (constants, URL helpers, migration)
 *  2. Backend routes (/api/cortex/url*) — structural + live HTTP scenarios
 *  3. Frontend modal component structure
 *  4. Three entry-point wiring (Intel Library, Save Email modal, Quick Capture)
 *
 * Live scenarios require the server running at localhost:5000 and will
 * self-seed a fixture user via scripts/seed-test-users.ts.
 *
 * Run: node tests/cortex-url-save.test.cjs
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── 0. Seed fixture user for live HTTP scenarios ────────────────────────────

try {
  execSync("npx tsx scripts/seed-test-users.ts", { stdio: "inherit", timeout: 30_000 });
} catch (e) {
  console.error("Failed to seed test fixture users:", e.message);
  process.exit(1);
}

const BASE = "http://localhost:5000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(400);
  return cookie;
}

function authed(cookie) {
  return async (urlPath, opts = {}) => {
    const res = await fetch(`${BASE}${urlPath}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Origin: BASE,
        Cookie: cookie,
        ...(opts.headers || {}),
      },
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      // no body / non-JSON — leave json null
    }
    return { status: res.status, json };
  };
}

// ── 1. Service layer — server/services/cortex-intel.ts ─────────────────────

const svc = readFile("server/services/cortex-intel.ts");

console.log("\n[1] Service layer — cortex-intel.ts");

ok("exports SOURCE_TYPES constant including 'url'", svc.includes('export const SOURCE_TYPES = ["email", "url"') );
ok("exports URL_INTEL_CATEGORIES constant", svc.includes("export const URL_INTEL_CATEGORIES"));
ok("exports URL_IMPORTANCE_LEVELS constant", svc.includes("export const URL_IMPORTANCE_LEVELS"));
ok("exports canonicalizeUrl helper", svc.includes("export function canonicalizeUrl"));
ok("exports validatePublicUrl helper", svc.includes("export function validatePublicUrl"));
ok("exports checkCortexIntelByCanonicalUrl", svc.includes("export async function checkCortexIntelByCanonicalUrl"));
ok("exports getCortexIntelById", svc.includes("export async function getCortexIntelById"));
ok("exports createCortexIntelRecord accepts sourceType", svc.includes("sourceType?: string"));
ok("exports createCortexIntelRecord accepts canonicalUrl", svc.includes("canonicalUrl?: string"));
ok("exports createCortexIntelRecord accepts useInAiContext", svc.includes("useInAiContext?: boolean"));

ok("migration makes mail_message_id nullable", svc.includes("ALTER COLUMN mail_message_id DROP NOT NULL"));
ok("migration adds source_type column (default 'email')", svc.includes("ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'email'"));
ok("migration adds canonical_url column", svc.includes("ADD COLUMN IF NOT EXISTS canonical_url TEXT"));
ok("migration adds domain column", svc.includes("ADD COLUMN IF NOT EXISTS domain TEXT"));
ok("migration adds title column", svc.includes("ADD COLUMN IF NOT EXISTS title TEXT"));
ok("migration adds use_in_ai_context column (default true)", svc.includes("ADD COLUMN IF NOT EXISTS use_in_ai_context BOOLEAN NOT NULL DEFAULT true"));
ok("migration creates partial unique index on canonical_url (active rows only)",
  svc.includes("idx_cortex_intel_canonical_url_active") &&
  svc.includes("ON cortex_email_intel (canonical_url)") &&
  svc.includes("WHERE deleted_at IS NULL AND canonical_url IS NOT NULL"));
ok("migration re-creates message_id index accounting for NULL rows",
  svc.includes("WHERE deleted_at IS NULL AND mail_message_id IS NOT NULL"));

ok("canonicalizeUrl strips tracking params", svc.includes("TRACKING_PARAM_RE") && svc.includes("utm_"));
ok("canonicalizeUrl strips trailing slash", svc.includes(`replace(/\\/+$/, "")`));
ok("canonicalizeUrl lowercases host", svc.includes("parsed.hostname.toLowerCase()"));

ok("validatePublicUrl rejects non-http(s) protocols", svc.includes('parsed.protocol !== "http:" && parsed.protocol !== "https:"'));
ok("validatePublicUrl rejects private/localhost hosts", svc.includes("PRIVATE_HOST_RE"));
ok("PRIVATE_HOST_RE blocks localhost", /localhost/.test(svc));
ok("PRIVATE_HOST_RE blocks 127.x", svc.includes("127\\."));
ok("PRIVATE_HOST_RE blocks 192.168.x", svc.includes("192\\.168\\."));
ok("PRIVATE_HOST_RE blocks link-local 169.254.x", svc.includes("169\\.254\\."));

// ── 2. Backend routes — server/routes.ts ────────────────────────────────────

const routes = readFile("server/routes.ts");

console.log("\n[2] Backend routes — server/routes.ts");

ok("registers POST /api/cortex/url/fetch-metadata", routes.includes('app.post("/api/cortex/url/fetch-metadata", requireAuth'));
ok("registers GET /api/cortex/url/check", routes.includes('app.get("/api/cortex/url/check", requireAuth'));
ok("registers POST /api/cortex/url", routes.includes('app.post("/api/cortex/url", requireAuth'));
ok("registers PUT /api/cortex/url/:id", routes.includes('app.put("/api/cortex/url/:id", requireAuth'));

ok("fetch-metadata validates URL before fetching", routes.includes("validatePublicUrl(url)") && routes.includes("fetchLinkPreview"));
ok("check route validates URL before canonicalizing", routes.includes("canonicalizeUrl(url)") && routes.includes("checkCortexIntelByCanonicalUrl(canonicalUrl)"));

ok("POST /api/cortex/url requires url", routes.includes('if (!url || typeof url !== "string") return res.status(400).json({ error: "url required" })'));
ok("POST /api/cortex/url requires category", routes.includes('if (!category)   return res.status(400).json({ error: "category required" })'));
ok("POST /api/cortex/url requires importance", routes.includes('if (!importance) return res.status(400).json({ error: "importance required" })'));
ok("POST /api/cortex/url validates URL safety before insert", routes.includes("const validationError = validatePublicUrl(url)"));
ok("POST /api/cortex/url returns 409 on duplicate canonical URL", routes.includes('res.status(409).json({ error: "This URL has already been saved to Cortex", record: existing })'));
ok("POST /api/cortex/url sets sourceType: 'url' on create", routes.includes('sourceType: "url"'));
ok("POST /api/cortex/url passes useInAiContext through (defaults true unless explicitly false)", routes.includes("useInAiContext: useInAiContext !== false"));
ok("POST /api/cortex/url returns 201 with created record", routes.includes("res.status(201).json({ ok: true, record })"));

ok("PUT /api/cortex/url/:id validates numeric id", routes.includes('if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" })'));
ok("PUT /api/cortex/url/:id 404s when record missing", routes.includes('if (!existing) return res.status(404).json({ error: "Not found" })'));
ok("PUT /api/cortex/url/:id 400s when record is not source_type='url'", routes.includes('if (existing.source_type !== "url") return res.status(400).json({ error: "Not a URL record" })'));

// ── 3. Frontend — SaveUrlToCortexModal component ────────────────────────────

const modal = readFile("client/src/components/cortex/save-url-to-cortex-modal.tsx");

console.log("\n[3] Frontend — save-url-to-cortex-modal.tsx");

ok("exports SaveUrlToCortexModal component", modal.includes("export function SaveUrlToCortexModal"));
ok("accepts open/onOpenChange/initialUrl props", modal.includes("open, onOpenChange, initialUrl"));
ok("has URL input field", modal.includes('data-testid="url-input"'));
ok("has Title input field", modal.includes('data-testid="title-input"'));
ok("has Summary textarea", modal.includes('data-testid="summary-input"'));
ok("has Notes textarea", modal.includes('data-testid="notes-input"'));
ok("has Category select", modal.includes('data-testid="category-select"'));
ok("has Importance select", modal.includes('data-testid="importance-select"'));
ok("has Tags input", modal.includes('data-testid="tag-input"'));
ok("has useInAiContext checkbox", modal.includes('data-testid="use-in-ai-context-checkbox"'));
ok("has Save button", modal.includes('data-testid="save-url-button"'));
ok("category/importance options match backend URL_INTEL_CATEGORIES / URL_IMPORTANCE_LEVELS",
  modal.includes('"Marina / Port Lead"') &&
  modal.includes('"Competitor Intel"') &&
  modal.includes('"Funding / Grants"') &&
  modal.includes('"Critical"'));
ok("validates URL client-side before allowing save", modal.includes("function isLikelyValidUrl"));
ok("fetches metadata on URL blur for prefill", modal.includes("/api/cortex/url/fetch-metadata") && modal.includes("handleUrlBlur"));
ok("performs live duplicate check via GET /api/cortex/url/check", modal.includes('"/api/cortex/url/check"'));
ok("shows duplicate notice when an existing record is found", modal.includes('data-testid="duplicate-notice"'));
ok("blocks save while a duplicate is detected", modal.includes("!duplicateRecord"));
ok("posts to /api/cortex/url on save", modal.includes('apiRequest("POST", "/api/cortex/url"'));
ok("handles 409 duplicate error with a toast", modal.includes("err?.status === 409"));
ok("handles 400 validation error with a toast", modal.includes("err?.status === 400"));
ok("invalidates cortex-intel query cache on success", modal.includes('queryClient.invalidateQueries({ queryKey: ["/api/cortex-intel"] })'));
ok("shows a success state after saving", modal.includes("saved &&"));

// ── 4. Entry point 1 — Cortex Intel Library "Add URL" button ────────────────

const library = readFile("client/src/pages/cortex-intel-library.tsx");

console.log("\n[4] Entry point — Cortex Intel Library");

ok("imports SaveUrlToCortexModal", library.includes("SaveUrlToCortexModal"));
ok("has addUrlOpen state", library.includes("addUrlOpen"));
ok("renders SaveUrlToCortexModal in the tree", library.includes("<SaveUrlToCortexModal"));
ok("has an Add URL trigger button", /Add URL/.test(library));
ok("IMPORTANCE_LEVELS includes Critical (URL-sourced records)", library.includes('"Critical"'));

// ── 5. Entry point 2 — "Save URL instead" in Save Email to Cortex modal ─────

const saveEmailModal = readFile("client/src/components/inbox/save-to-cortex-modal.tsx");

console.log("\n[5] Entry point — Save Email to Cortex modal link");

ok("has a 'Save a URL instead' link/trigger", /Save a URL instead/.test(saveEmailModal));
ok("dispatches open-save-url-to-cortex event", saveEmailModal.includes("open-save-url-to-cortex"));

// ── 6. Entry point 3 — Quick Capture "Cortex URL" tab ───────────────────────

const quickCapture = readFile("client/src/components/quick-capture.tsx");

console.log("\n[6] Entry point — Quick Capture 'Cortex URL' tab");

ok("Quick Capture Tab type includes 'cortex-url'", quickCapture.includes('"cortex-url"'));
ok("TABS array includes a Cortex URL entry", quickCapture.includes('label: "Cortex URL"'));
ok("cortex-url tab click closes Quick Capture and dispatches the shared event", 
  quickCapture.includes('if (tab.id === "cortex-url")') &&
  quickCapture.includes("setOpen(false)") &&
  quickCapture.includes("open-save-url-to-cortex"));

// ── 7. Global listener + App mount ──────────────────────────────────────────

const globalListener = readFile("client/src/components/cortex/global-save-url-to-cortex.tsx");
const app = readFile("client/src/App.tsx");

console.log("\n[7] Global event listener + App mount");

ok("GlobalSaveUrlToCortex exports a component", globalListener.includes("export function GlobalSaveUrlToCortex"));
ok("GlobalSaveUrlToCortex listens for open-save-url-to-cortex", globalListener.includes('"open-save-url-to-cortex"'));
ok("GlobalSaveUrlToCortex renders SaveUrlToCortexModal", globalListener.includes("<SaveUrlToCortexModal"));
ok("App.tsx imports GlobalSaveUrlToCortex", app.includes("GlobalSaveUrlToCortex"));
ok("App.tsx mounts <GlobalSaveUrlToCortex />", app.includes("<GlobalSaveUrlToCortex />"));

// ── 8. Live HTTP scenarios ───────────────────────────────────────────────────

async function runLiveScenarios() {
  console.log("\n[8] Live HTTP scenarios (requires server running)");

  let cookie;
  try {
    cookie = await login("viewer@voltsafe.com", "testpass1234");
  } catch (e) {
    console.error(`  SKIP: live scenarios — could not log in (${e.message})`);
    failed++;
    failures.push("live scenarios — login failed");
    return;
  }
  const api = authed(cookie);
  const unique = Date.now();
  const testUrl = `https://example.com/marine-intel-test-${unique}?utm_source=test&ref=x`;

  // 8a. Unauthenticated requests are rejected
  {
    const res = await fetch(`${BASE}/api/cortex/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ url: testUrl, category: "Marine Industry Intel", importance: "Medium" }),
    });
    ok("POST /api/cortex/url rejects unauthenticated requests (401)", res.status === 401);
  }

  // 8b. Missing url -> 400
  {
    const { status, json } = await api("/api/cortex/url", {
      method: "POST",
      body: JSON.stringify({ category: "Marine Industry Intel", importance: "Medium" }),
    });
    ok("POST /api/cortex/url 400s when url is missing", status === 400 && /url required/i.test(json?.error || ""));
  }

  // 8c. Missing category -> 400
  {
    const { status, json } = await api("/api/cortex/url", {
      method: "POST",
      body: JSON.stringify({ url: testUrl, importance: "Medium" }),
    });
    ok("POST /api/cortex/url 400s when category is missing", status === 400 && /category required/i.test(json?.error || ""));
  }

  // 8d. Missing importance -> 400
  {
    const { status, json } = await api("/api/cortex/url", {
      method: "POST",
      body: JSON.stringify({ url: testUrl, category: "Marine Industry Intel" }),
    });
    ok("POST /api/cortex/url 400s when importance is missing", status === 400 && /importance required/i.test(json?.error || ""));
  }

  // 8e. Invalid URL -> 400
  {
    const { status, json } = await api("/api/cortex/url", {
      method: "POST",
      body: JSON.stringify({ url: "not-a-url", category: "Marine Industry Intel", importance: "Medium" }),
    });
    ok("POST /api/cortex/url 400s on invalid URL", status === 400 && /Invalid URL/i.test(json?.error || ""));
  }

  // 8f. Private/localhost URL -> 400
  {
    const { status, json } = await api("/api/cortex/url", {
      method: "POST",
      body: JSON.stringify({ url: "http://localhost:5000/secret", category: "Marine Industry Intel", importance: "Medium" }),
    });
    ok("POST /api/cortex/url 400s on private/localhost URL", status === 400 && /private/i.test(json?.error || ""));
  }

  // 8g. GET check — should not exist yet
  {
    const { status, json } = await api(`/api/cortex/url/check?url=${encodeURIComponent(testUrl)}`);
    ok("GET /api/cortex/url/check returns exists:false before creation", status === 200 && json?.exists === false);
  }

  // 8h. Successful create -> 201
  let createdId = null;
  {
    const { status, json } = await api("/api/cortex/url", {
      method: "POST",
      body: JSON.stringify({
        url: testUrl,
        title: "Test Marine Intel Article",
        summary: "A test summary of the article.",
        notes: "Test notes",
        category: "Marina / Port Lead",
        importance: "High",
        tags: ["test", "marine"],
        useInAiContext: true,
      }),
    });
    ok("POST /api/cortex/url creates a record (201)", status === 201 && json?.ok === true && !!json?.record?.id);
    ok("created record has source_type='url'", json?.record?.source_type === "url");
    ok("created record stores canonical_url with tracking params stripped", json?.record?.canonical_url && !json.record.canonical_url.includes("utm_source"));
    ok("created record stores domain", json?.record?.domain === "example.com");
    createdId = json?.record?.id ?? null;
  }

  // 8i. Duplicate create -> 409
  {
    const { status, json } = await api("/api/cortex/url", {
      method: "POST",
      body: JSON.stringify({
        url: testUrl.replace("utm_source=test&", ""), // same canonical URL, different tracking params
        category: "Marine Industry Intel",
        importance: "Medium",
      }),
    });
    ok("POST /api/cortex/url 409s on duplicate canonical URL", status === 409 && /already been saved/i.test(json?.error || ""));
  }

  // 8j. GET check — should now exist
  {
    const { status, json } = await api(`/api/cortex/url/check?url=${encodeURIComponent(testUrl)}`);
    ok("GET /api/cortex/url/check returns exists:true after creation", status === 200 && json?.exists === true && json?.record?.id === createdId);
  }

  // 8k. Update via PUT
  if (createdId) {
    const { status, json } = await api(`/api/cortex/url/${createdId}`, {
      method: "PUT",
      body: JSON.stringify({ title: "Updated Title", importance: "Critical" }),
    });
    ok("PUT /api/cortex/url/:id updates the record", status === 200 && json?.ok === true && json?.record?.title === "Updated Title" && json?.record?.importance === "Critical");
  } else {
    ok("PUT /api/cortex/url/:id updates the record", false);
  }

  // 8l. PUT on non-existent id -> 404
  {
    const { status } = await api("/api/cortex/url/999999999", {
      method: "PUT",
      body: JSON.stringify({ title: "x" }),
    });
    ok("PUT /api/cortex/url/:id 404s for a non-existent id", status === 404);
  }

  // 8m. PUT on a non-url source_type record -> 400 (creates a throwaway email-sourced record via /api/cortex-intel)
  {
    const { status: createStatus, json: createJson } = await api("/api/cortex-intel", {
      method: "POST",
      body: JSON.stringify({
        mailMessageId: `test-email-intel-${unique}`,
        intelType: "Marine Industry Intel",
        importance: "Low",
      }),
    });
    ok("POST /api/cortex-intel creates an email-sourced record for fixture setup", createStatus === 201 && !!createJson?.record?.id);
    const emailRecordId = createJson?.record?.id;
    if (emailRecordId) {
      const { status, json } = await api(`/api/cortex/url/${emailRecordId}`, {
        method: "PUT",
        body: JSON.stringify({ title: "should not apply" }),
      });
      ok("PUT /api/cortex/url/:id 400s when the record is not source_type='url'", status === 400 && /Not a URL record/i.test(json?.error || ""));
    } else {
      ok("PUT /api/cortex/url/:id 400s when the record is not source_type='url'", false);
    }
  }

  // 8n. fetch-metadata rejects private URLs
  {
    const { status, json } = await api("/api/cortex/url/fetch-metadata", {
      method: "POST",
      body: JSON.stringify({ url: "http://127.0.0.1/admin" }),
    });
    ok("POST /api/cortex/url/fetch-metadata 400s on private URL", status === 400 && /private/i.test(json?.error || ""));
  }
}

runLiveScenarios().then(() => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("All checks passed.");
    process.exit(0);
  }
}).catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
