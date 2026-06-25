/**
 * CRM Recent News — smoke tests
 *
 * Source-grep tests: no network calls, no DB access.
 * Tests pin the security and correctness invariants in the service and routes.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const serviceSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/crm-recent-news.ts"), "utf8"
);
const routesSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes.ts"), "utf8"
);

// ── 1. SSRF guard exists and covers expected patterns ────────────────────────
test("1. isUrlSafe() exported from service", () => {
  assert.ok(serviceSrc.includes("export function isUrlSafe("), "isUrlSafe not exported");
});

test("2. SSRF guard blocks localhost", () => {
  assert.ok(serviceSrc.includes("/^localhost$/i"), "missing localhost guard");
});

test("3. SSRF guard blocks 127.x", () => {
  assert.ok(serviceSrc.includes("/^127\\.\\d+\\.\\d+\\.\\d+$/"), "missing 127.x guard");
});

test("4. SSRF guard blocks 10.x (RFC-1918)", () => {
  assert.ok(serviceSrc.includes("/^10\\.\\d+\\.\\d+\\.\\d+$/"), "missing 10.x guard");
});

test("5. SSRF guard blocks 172.16-31 (RFC-1918)", () => {
  assert.ok(serviceSrc.includes("/^172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+$/"), "missing 172.x guard");
});

test("6. SSRF guard blocks 192.168.x", () => {
  assert.ok(serviceSrc.includes("/^192\\.168\\.\\d+\\.\\d+$/"), "missing 192.168 guard");
});

test("7. SSRF guard blocks IPv6 loopback ::1", () => {
  assert.ok(serviceSrc.includes("/^::1$/"), "missing ::1 guard");
});

test("8. SSRF guard blocks link-local / metadata service 169.254.x", () => {
  assert.ok(serviceSrc.includes("/^169\\.254\\.\\d+\\.\\d+$/"), "missing 169.254 guard");
});

test("9. SSRF guard blocks 0.0.0.0", () => {
  assert.ok(serviceSrc.includes("/^0\\.0\\.0\\.0$/"), "missing 0.0.0.0 guard");
});

test("10. SSRF guard blocks fc00 (unique local IPv6)", () => {
  assert.ok(serviceSrc.includes("/^fc00:/i"), "missing fc00 guard");
});

test("11. SSRF guard blocks fe80 (link-local IPv6)", () => {
  assert.ok(serviceSrc.includes("/^fe80:/i"), "missing fe80 guard");
});

test("12. isUrlSafe only allows http/https protocols", () => {
  assert.ok(
    serviceSrc.includes('["http:", "https:"].includes(parsed.protocol)'),
    "protocol allowlist missing or changed"
  );
});

// ── 13. SSRF redirect protection ─────────────────────────────────────────────
test("13. fetchArticleMetadata checks res.url after redirect (SSRF redirect fix)", () => {
  assert.ok(
    serviceSrc.includes("Redirect to restricted URL blocked"),
    "Missing post-redirect SSRF check"
  );
});

test("14. fetchArticleMetadata calls isUrlSafe on the final URL", () => {
  assert.ok(
    serviceSrc.includes("isUrlSafe(res.url)"),
    "Final URL SSRF check not present"
  );
});

// ── 15. Entity-type whitelist ────────────────────────────────────────────────
test("15. VALID_ENTITY_TYPES set exported from service", () => {
  assert.ok(serviceSrc.includes("export const VALID_ENTITY_TYPES"), "VALID_ENTITY_TYPES not exported");
});

test("16. VALID_ENTITY_TYPES includes the 4 primary CRM types", () => {
  ["lead", "account", "contact", "partner"].forEach(t => {
    assert.ok(serviceSrc.includes(`"${t}"`), `Entity type "${t}" missing from VALID_ENTITY_TYPES block`);
  });
});

test("17. getRecentNewsContext uses VALID_ENTITY_TYPES guard", () => {
  assert.ok(
    serviceSrc.includes("VALID_ENTITY_TYPES.has(entityType)"),
    "getRecentNewsContext missing entity-type whitelist check"
  );
});

test("18. getNewsItemsForModal uses VALID_ENTITY_TYPES guard", () => {
  const fnIdx = serviceSrc.indexOf("export async function getNewsItemsForModal");
  const snippet = serviceSrc.slice(fnIdx, fnIdx + 300);
  assert.ok(snippet.includes("VALID_ENTITY_TYPES.has"), "getNewsItemsForModal missing entity-type guard");
});

// ── 19-21. use_in_email_context ───────────────────────────────────────────────
test("19. Migration adds use_in_email_context column", () => {
  assert.ok(
    routesSrc.includes("ADD COLUMN IF NOT EXISTS use_in_email_context"),
    "Missing ALTER TABLE ADD COLUMN IF NOT EXISTS use_in_email_context"
  );
});

test("20. use_in_email_context appears in EMAIL_CONTEXT_ORDER", () => {
  assert.ok(
    serviceSrc.includes("use_in_email_context DESC"),
    "use_in_email_context not in ORDER BY priority"
  );
});

test("21. getRecentNewsContext SELECT includes use_in_email_context column", () => {
  const fnIdx = serviceSrc.indexOf("export async function getRecentNewsContext");
  const snippet = serviceSrc.slice(fnIdx, fnIdx + 1200);
  assert.ok(snippet.includes("use_in_email_context"), "getRecentNewsContext SELECT missing use_in_email_context");
});

// ── 22-25. Missing indexes ────────────────────────────────────────────────────
test("22. Migration creates idx_crn_normalized_url", () => {
  assert.ok(routesSrc.includes("idx_crn_normalized_url"), "Missing idx_crn_normalized_url");
});

test("23. Migration creates idx_crn_published_at", () => {
  assert.ok(routesSrc.includes("idx_crn_published_at"), "Missing idx_crn_published_at");
});

test("24. Migration creates idx_crn_relevance_type", () => {
  assert.ok(routesSrc.includes("idx_crn_relevance_type"), "Missing idx_crn_relevance_type");
});

test("25. Migration creates idx_crn_use_in_email", () => {
  assert.ok(routesSrc.includes("idx_crn_use_in_email"), "Missing idx_crn_use_in_email");
});

// ── 26-27. Context compression (buildNewsContextBlock) ───────────────────────
test("26. buildNewsContextBlock limits full-detail items to first 3", () => {
  assert.ok(
    serviceSrc.includes("const DETAIL_LIMIT = 3"),
    "buildNewsContextBlock missing DETAIL_LIMIT = 3"
  );
});

test("27. buildNewsContextBlock renders compact one-line bullets for overflow items", () => {
  const fnIdx = serviceSrc.indexOf("export function buildNewsContextBlock");
  const snippet = serviceSrc.slice(fnIdx, fnIdx + 1400);
  assert.ok(
    snippet.includes("bullets.forEach"),
    "buildNewsContextBlock missing compact bullet rendering"
  );
});

// ── 28. extracted_text not in email prompt ────────────────────────────────────
test("28. buildNewsContextBlock does NOT reference extracted_text", () => {
  const fnIdx = serviceSrc.indexOf("export function buildNewsContextBlock");
  const snippet = serviceSrc.slice(fnIdx, fnIdx + 1200);
  assert.ok(
    !snippet.includes("extractedText") && !snippet.includes("extracted_text"),
    "buildNewsContextBlock must NOT include extracted_text in email prompts"
  );
});

// ── 29. Context ordering priority ─────────────────────────────────────────────
test("29. Email context order: use_in_email_context first, then score, published_at, added_at", () => {
  const orderIdx = serviceSrc.indexOf("EMAIL_CONTEXT_ORDER");
  const snippet = serviceSrc.slice(orderIdx, orderIdx + 300);
  assert.ok(snippet.includes("use_in_email_context DESC"), "use_in_email_context not first in order");
  assert.ok(snippet.includes("ai_relevance_score DESC"), "ai_relevance_score not in order");
  assert.ok(snippet.includes("published_at DESC"), "published_at not in order");
  assert.ok(snippet.includes("added_at DESC"), "added_at not in order");
});

// ── 30-32. Fetch safety ───────────────────────────────────────────────────────
test("30. Fetch timeout is enforced (AbortController)", () => {
  assert.ok(serviceSrc.includes("AbortController"), "No AbortController timeout in fetchArticleMetadata");
});

test("31. Max response size cap is enforced (2MB)", () => {
  assert.ok(
    serviceSrc.includes("MAX_RESPONSE_BYTES") || serviceSrc.includes("2_000_000"),
    "Max response size not enforced"
  );
});

test("32. Content-type guard: only html/xhtml accepted", () => {
  assert.ok(
    serviceSrc.includes("text/html") && serviceSrc.includes("Not an HTML page"),
    "Content-type guard missing"
  );
});

// ── 33-35. Audit logging ───────────────────────────────────────────────────────
test("33. POST /api/crm/recent-news logs audit activity", () => {
  const postIdx = routesSrc.indexOf("POST /api/crm/recent-news\n");
  const snippet = routesSrc.slice(postIdx, postIdx + 3500);
  assert.ok(
    snippet.includes("news_added") || snippet.includes("INSERT INTO activities"),
    "POST route missing audit log"
  );
});

test("34. PUT /api/crm/recent-news/:id logs audit activity", () => {
  const putIdx = routesSrc.indexOf("PUT /api/crm/recent-news/:id");
  const snippet = routesSrc.slice(putIdx, putIdx + 2000);
  assert.ok(
    snippet.includes("INSERT INTO activities") || snippet.includes("news_updated"),
    "PUT route missing audit log"
  );
});

test("35. DELETE /api/crm/recent-news/:id logs audit activity", () => {
  const delIdx = routesSrc.indexOf("DELETE /api/crm/recent-news/:id");
  const snippet = routesSrc.slice(delIdx, delIdx + 1500);
  assert.ok(
    snippet.includes("INSERT INTO activities") || snippet.includes("news_archived"),
    "DELETE route missing audit log"
  );
});

// ── 36. Duplicate handling ────────────────────────────────────────────────────
test("36. POST route returns 409 with clear message on duplicate URL", () => {
  const postIdx = routesSrc.indexOf("POST /api/crm/recent-news\n");
  const snippet = routesSrc.slice(postIdx, postIdx + 2000);
  assert.ok(
    snippet.includes("already attached to this record"),
    "Missing clear duplicate message"
  );
  assert.ok(
    snippet.includes("409"),
    "Duplicate should return HTTP 409"
  );
});

// ── 37. Auth required on every route ─────────────────────────────────────────
test("37. All Recent News routes require auth", () => {
  const section = routesSrc.indexOf("─── CRM Recent News ─");
  const snippet = routesSrc.slice(section, section + 5000);
  const routeDecls = snippet.match(/app\.(get|post|put|delete)\("/g) || [];
  const withAuth   = snippet.match(/app\.(get|post|put|delete)\("[^"]+",\s*requireAuth/g) || [];
  assert.ok(routeDecls.length > 0, "No route declarations found in Recent News section");
  assert.strictEqual(routeDecls.length, withAuth.length,
    `${routeDecls.length - withAuth.length} route(s) missing requireAuth`);
});

// ── 38. Ownership check on PUT ────────────────────────────────────────────────
test("38. PUT route checks ownership (user can only edit own items, admin bypasses)", () => {
  const putIdx = routesSrc.indexOf("PUT /api/crm/recent-news/:id");
  const snippet = routesSrc.slice(putIdx, putIdx + 1000);
  assert.ok(snippet.includes("added_by_user_id"), "PUT route missing ownership check");
  assert.ok(snippet.includes("isAdmin"), "PUT route missing admin bypass");
});

// ── 39. Ownership check on DELETE ────────────────────────────────────────────
test("39. DELETE route checks ownership (user can only delete own items, admin bypasses)", () => {
  const delIdx = routesSrc.indexOf("DELETE /api/crm/recent-news/:id");
  const snippet = routesSrc.slice(delIdx, delIdx + 800);
  assert.ok(snippet.includes("added_by_user_id"), "DELETE route missing ownership check");
  assert.ok(snippet.includes("isAdmin"), "DELETE route missing admin bypass");
});

// ── 40. normalizeUrl exported ─────────────────────────────────────────────────
test("40. normalizeUrl exported from service", () => {
  assert.ok(serviceSrc.includes("export function normalizeUrl("), "normalizeUrl not exported");
});

// ── 41. Raw HTML never sent to client (GET route maps fields) ─────────────────
test("41. GET route does not return extracted_text or raw HTML to client", () => {
  const getIdx = routesSrc.indexOf("GET /api/crm/recent-news?entityType");
  const snippet = routesSrc.slice(getIdx, getIdx + 1500);
  assert.ok(!snippet.includes("extractedText"), "GET route should NOT return extractedText to client");
  assert.ok(!snippet.includes("extracted_text"), "GET route should NOT return extracted_text to client");
});

// ── 42. use_in_email_context toggle route exists ──────────────────────────────
test("42. use-in-email-context toggle route exists", () => {
  assert.ok(
    routesSrc.includes("/api/crm/recent-news/:id/use-in-email-context"),
    "use-in-email-context toggle route missing"
  );
});

console.log("────────────────────────────────────────────────");
