/**
 * CRM Recent News — source-grep hardening tests
 *
 * No network calls, no DB access.
 * Pins the security and correctness invariants in the service and routes.
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

// ══════════════════════════════════════════════════════════════════════════════
// PART 1 — SSRF PROTECTION
// ══════════════════════════════════════════════════════════════════════════════

// ── Protocol allowlist ────────────────────────────────────────────────────────
test("1. isUrlSafe() exported from service", () => {
  assert.ok(serviceSrc.includes("export function isUrlSafe("), "isUrlSafe not exported");
});

test("2. isUrlSafe only allows http/https (protocol allowlist present)", () => {
  assert.ok(
    serviceSrc.includes('["http:", "https:"].includes(parsed.protocol)'),
    "protocol allowlist missing or changed"
  );
});

test("3. isUrlSafe returns a reason when protocol is blocked", () => {
  assert.ok(
    serviceSrc.includes("Protocol") && serviceSrc.includes("is not allowed"),
    "isUrlSafe missing protocol-blocked reason message"
  );
});

// ── Hostname regex blocklist (L2) ─────────────────────────────────────────────
test("4. SSRF guard blocks localhost", () => {
  assert.ok(serviceSrc.includes("/^localhost$/i"), "missing localhost guard");
});

test("5. SSRF guard blocks 127.x loopback", () => {
  assert.ok(serviceSrc.includes("/^127\\.\\d+\\.\\d+\\.\\d+$/"), "missing 127.x guard");
});

test("6. SSRF guard blocks 10.x (RFC-1918)", () => {
  assert.ok(serviceSrc.includes("/^10\\.\\d+\\.\\d+\\.\\d+$/"), "missing 10.x guard");
});

test("7. SSRF guard blocks 172.16-31 (RFC-1918)", () => {
  assert.ok(serviceSrc.includes("/^172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+$/"), "missing 172.x guard");
});

test("8. SSRF guard blocks 192.168.x (RFC-1918)", () => {
  assert.ok(serviceSrc.includes("/^192\\.168\\.\\d+\\.\\d+$/"), "missing 192.168 guard");
});

test("9. SSRF guard blocks ::1 (IPv6 loopback)", () => {
  assert.ok(serviceSrc.includes("/^::1$/"), "missing ::1 guard");
});

test("10. SSRF guard blocks 169.254.x (link-local / metadata service)", () => {
  assert.ok(serviceSrc.includes("/^169\\.254\\.\\d+\\.\\d+$/"), "missing 169.254 guard");
});

test("11. SSRF guard blocks 0.0.0.0", () => {
  assert.ok(serviceSrc.includes("/^0\\.0\\.0\\.0$/"), "missing 0.0.0.0 guard");
});

test("12. SSRF guard blocks fc00 (IPv6 ULA)", () => {
  assert.ok(serviceSrc.includes("/^fc00:/i"), "missing fc00::/7 guard");
});

test("13. SSRF guard blocks fe80 (IPv6 link-local)", () => {
  assert.ok(serviceSrc.includes("/^fe80:/i"), "missing fe80::/10 guard");
});

// ── DNS pre-resolution (L3) ───────────────────────────────────────────────────
test("14. Service imports dns/promises for DNS pre-resolution", () => {
  assert.ok(
    serviceSrc.includes('import dns from "dns/promises"') ||
    serviceSrc.includes("from \"dns/promises\"") ||
    serviceSrc.includes("from 'dns/promises'"),
    "Missing dns/promises import — DNS pre-resolution not implemented"
  );
});

test("15. Service imports net module for IP classification", () => {
  assert.ok(
    serviceSrc.includes('import net from "net"') ||
    serviceSrc.includes("from \"net\"") ||
    serviceSrc.includes("from 'net'"),
    "Missing net import — IP classification not possible"
  );
});

test("16. isIpPrivate() exported from service", () => {
  assert.ok(serviceSrc.includes("export function isIpPrivate("), "isIpPrivate not exported");
});

test("17. isIpPrivate covers IPv4 loopback 127.x", () => {
  assert.ok(serviceSrc.includes("a === 127"), "isIpPrivate missing 127.x loopback");
});

test("18. isIpPrivate covers 10.x RFC-1918", () => {
  assert.ok(serviceSrc.includes("a === 10"), "isIpPrivate missing 10.0.0.0/8");
});

test("19. isIpPrivate covers 172.16-31 RFC-1918", () => {
  assert.ok(serviceSrc.includes("b >= 16 && b <= 31"), "isIpPrivate missing 172.16.0.0/12");
});

test("20. isIpPrivate covers 192.168 RFC-1918", () => {
  assert.ok(serviceSrc.includes("b === 168"), "isIpPrivate missing 192.168.0.0/16");
});

test("21. isIpPrivate covers 169.254 link-local / metadata", () => {
  assert.ok(serviceSrc.includes("b === 254"), "isIpPrivate missing 169.254.0.0/16");
});

test("22. isIpPrivate covers multicast/reserved (a >= 224)", () => {
  assert.ok(serviceSrc.includes("a >= 224"), "isIpPrivate missing multicast/reserved ≥ 224");
});

test("23. isIpPrivate covers IPv6 loopback ::1", () => {
  assert.ok(serviceSrc.includes('"::1"'), "isIpPrivate missing IPv6 ::1");
});

test("24. isIpPrivate covers fc00::/7 ULA", () => {
  assert.ok(
    serviceSrc.includes('startsWith("fc")') || serviceSrc.includes("startsWith('fc')"),
    "isIpPrivate missing fc00::/7"
  );
});

test("25. isIpPrivate covers fe80::/10 link-local", () => {
  assert.ok(
    serviceSrc.includes("fe80") || serviceSrc.includes("fea") || serviceSrc.includes("0xfe80"),
    "isIpPrivate missing fe80::/10"
  );
});

test("26. DNS lookup called with all:true to get all addresses", () => {
  assert.ok(
    serviceSrc.includes("all: true"),
    "DNS lookup must use { all: true } to check every returned address"
  );
});

// ── Manual redirect control (L4) ─────────────────────────────────────────────
test("27. fetch uses redirect: manual (no automatic redirect following)", () => {
  assert.ok(
    serviceSrc.includes('redirect: "manual"') || serviceSrc.includes("redirect: 'manual'"),
    "fetch must use redirect: 'manual' to control per-hop SSRF checks"
  );
});

test("28. Redirect limit constant present (MAX_REDIRECTS)", () => {
  assert.ok(
    serviceSrc.includes("MAX_REDIRECTS"),
    "Missing MAX_REDIRECTS constant — redirect count not limited"
  );
});

test("29. MAX_REDIRECTS is 3 or fewer", () => {
  const m = serviceSrc.match(/MAX_REDIRECTS\s*=\s*(\d+)/);
  assert.ok(m, "MAX_REDIRECTS constant not found");
  assert.ok(Number(m[1]) <= 3, `MAX_REDIRECTS must be ≤ 3, got ${m[1]}`);
});

test("30. Per-hop SSRF check on redirect Location header", () => {
  assert.ok(
    serviceSrc.includes("Too many redirects") || serviceSrc.includes("hopCheck"),
    "Missing per-hop SSRF check in redirect loop"
  );
});

test("31. Redirect blocked message emitted when hop fails SSRF check", () => {
  assert.ok(
    serviceSrc.includes("Redirect blocked"),
    "Missing 'Redirect blocked' message for per-hop SSRF failure"
  );
});

// ── Final URL re-check (L5) ───────────────────────────────────────────────────
test("32. Final URL re-checked via isUrlSafe(res.url) (L5)", () => {
  assert.ok(
    serviceSrc.includes("isUrlSafe(res.url)"),
    "L5 final URL SSRF re-check missing"
  );
});

test("33. 'Redirect to restricted URL blocked' message present (L5)", () => {
  assert.ok(
    serviceSrc.includes("Redirect to restricted URL blocked"),
    "L5 missing block message"
  );
});

// ── Fetch safety properties ───────────────────────────────────────────────────
test("34. Fetch timeout enforced (AbortController)", () => {
  assert.ok(serviceSrc.includes("AbortController"), "No AbortController timeout");
});

test("35. FETCH_TIMEOUT_MS constant present", () => {
  assert.ok(serviceSrc.includes("FETCH_TIMEOUT_MS"), "Missing FETCH_TIMEOUT_MS constant");
});

test("36. Max response size cap enforced", () => {
  assert.ok(
    serviceSrc.includes("MAX_RESPONSE_BYTES") || serviceSrc.includes("2_000_000"),
    "Max response size not enforced"
  );
});

test("37. Content-type guard: only HTML accepted", () => {
  assert.ok(
    serviceSrc.includes("text/html") && serviceSrc.includes("Not an HTML page"),
    "Content-type guard missing"
  );
});

test("38. normalizeUrl() exported", () => {
  assert.ok(serviceSrc.includes("export function normalizeUrl("), "normalizeUrl not exported");
});

// ══════════════════════════════════════════════════════════════════════════════
// PART 2 — PROMPT COMPRESSION
// ══════════════════════════════════════════════════════════════════════════════

// ── extracted_text exclusion ──────────────────────────────────────────────────
test("39. buildNewsContextBlock does NOT reference extracted_text in its body", () => {
  const fnIdx = serviceSrc.indexOf("export function buildNewsContextBlock");
  assert.ok(fnIdx >= 0, "buildNewsContextBlock function not found");
  // Scan the function body (up to 2000 chars — well past the end of the function)
  const snippet = serviceSrc.slice(fnIdx, fnIdx + 2000);
  // Strip comments to avoid false positives from documentation
  const codeOnly = snippet.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    !codeOnly.includes("extractedText") && !codeOnly.includes("extracted_text"),
    "buildNewsContextBlock must NOT include extracted_text in email prompts"
  );
});

test("40. getRecentNewsContext SELECT does NOT include extracted_text", () => {
  const fnIdx = serviceSrc.indexOf("export async function getRecentNewsContext");
  assert.ok(fnIdx >= 0, "getRecentNewsContext not found");
  // Strip comments before checking — we allow documentation references
  const codeOnly = serviceSrc.slice(fnIdx, fnIdx + 1500)
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    !codeOnly.includes("extracted_text"),
    "getRecentNewsContext SELECT must NOT include extracted_text in actual SQL/code"
  );
});

test("41. getNewsItemsForModal SELECT does NOT include extracted_text", () => {
  const fnIdx = serviceSrc.indexOf("export async function getNewsItemsForModal");
  assert.ok(fnIdx >= 0, "getNewsItemsForModal not found");
  const codeOnly = serviceSrc.slice(fnIdx, fnIdx + 1500)
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    !codeOnly.includes("extracted_text"),
    "getNewsItemsForModal SELECT must NOT include extracted_text in actual SQL/code"
  );
});

test("42. GET /api/crm/recent-news route does NOT return extracted_text to client", () => {
  const getIdx = routesSrc.indexOf("GET /api/crm/recent-news?entityType");
  assert.ok(getIdx >= 0, "GET recent-news route comment not found");
  const snippet = routesSrc.slice(getIdx, getIdx + 1800);
  // Strip comments
  const codeOnly = snippet.replace(/\/\/[^\n]*/g, "");
  assert.ok(
    !codeOnly.includes("extractedText") && !codeOnly.includes("extracted_text"),
    "GET route must NOT return extracted_text to client"
  );
});

// ── Context compression ───────────────────────────────────────────────────────
test("43. buildNewsContextBlock limits full-detail items to first 3 (DETAIL_LIMIT)", () => {
  assert.ok(
    serviceSrc.includes("DETAIL_LIMIT = 3"),
    "buildNewsContextBlock missing DETAIL_LIMIT = 3"
  );
});

test("44. buildNewsContextBlock renders one-line bullets for lower-priority items", () => {
  const fnIdx = serviceSrc.indexOf("export function buildNewsContextBlock");
  const snippet = serviceSrc.slice(fnIdx, fnIdx + 1600);
  assert.ok(snippet.includes("bullets.forEach"), "Missing compact bullet rendering");
});

test("45. Hard character budget constant present (MAX_CONTEXT_CHARS)", () => {
  assert.ok(
    serviceSrc.includes("MAX_CONTEXT_CHARS"),
    "Missing MAX_CONTEXT_CHARS — no hard prompt budget"
  );
});

test("46. MAX_CONTEXT_CHARS is ≤ 5000 (reasonable token budget)", () => {
  const m = serviceSrc.match(/MAX_CONTEXT_CHARS\s*=\s*([\d_]+)/);
  assert.ok(m, "MAX_CONTEXT_CHARS not found");
  const val = Number(m[1].replace(/_/g, ""));
  assert.ok(val <= 5000, `MAX_CONTEXT_CHARS must be ≤ 5000, got ${val}`);
});

test("47. buildNewsContextBlock enforces the budget (truncation present)", () => {
  const fnIdx = serviceSrc.indexOf("export function buildNewsContextBlock");
  const snippet = serviceSrc.slice(fnIdx, fnIdx + 3000);
  assert.ok(
    snippet.includes("MAX_CONTEXT_CHARS") && snippet.includes("truncat"),
    "buildNewsContextBlock missing budget truncation logic"
  );
});

// ── Email context ordering ────────────────────────────────────────────────────
test("48. Email context order: use_in_email_context first", () => {
  assert.ok(serviceSrc.includes("use_in_email_context DESC"), "use_in_email_context not first in ORDER");
});

test("49. Email context order includes score, published_at, added_at", () => {
  const orderIdx = serviceSrc.indexOf("EMAIL_CONTEXT_ORDER");
  const snippet = serviceSrc.slice(orderIdx, orderIdx + 300);
  assert.ok(snippet.includes("ai_relevance_score DESC"), "ai_relevance_score missing from order");
  assert.ok(snippet.includes("published_at DESC"), "published_at missing from order");
  assert.ok(snippet.includes("added_at DESC"), "added_at missing from order");
});

test("50. use_in_email_context column in getRecentNewsContext SELECT", () => {
  const fnIdx = serviceSrc.indexOf("export async function getRecentNewsContext");
  const snippet = serviceSrc.slice(fnIdx, fnIdx + 1200);
  assert.ok(snippet.includes("use_in_email_context"), "getRecentNewsContext SELECT missing use_in_email_context");
});

// ── VALID_ENTITY_TYPES whitelist ──────────────────────────────────────────────
test("51. VALID_ENTITY_TYPES exported from service", () => {
  assert.ok(serviceSrc.includes("export const VALID_ENTITY_TYPES"), "VALID_ENTITY_TYPES not exported");
});

test("52. getRecentNewsContext uses VALID_ENTITY_TYPES guard", () => {
  assert.ok(serviceSrc.includes("VALID_ENTITY_TYPES.has(entityType)"), "getRecentNewsContext missing entity guard");
});

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE-LEVEL CHECKS
// ══════════════════════════════════════════════════════════════════════════════

test("53. All Recent News routes require auth", () => {
  const section = routesSrc.indexOf("─── CRM Recent News ─");
  assert.ok(section >= 0, "CRM Recent News section not found");
  const snippet = routesSrc.slice(section, section + 6000);
  const routeDecls = snippet.match(/app\.(get|post|put|delete)\("/g) || [];
  const withAuth   = snippet.match(/app\.(get|post|put|delete)\("[^"]+",\s*requireAuth/g) || [];
  assert.ok(routeDecls.length > 0, "No route declarations found in Recent News section");
  assert.strictEqual(routeDecls.length, withAuth.length,
    `${routeDecls.length - withAuth.length} route(s) missing requireAuth`);
});

test("54. POST route validates entity-type against whitelist", () => {
  const postIdx = routesSrc.indexOf("// POST /api/crm/recent-news\n");
  assert.ok(postIdx >= 0, "POST comment not found");
  const snippet = routesSrc.slice(postIdx, postIdx + 1000);
  assert.ok(snippet.includes("VALID_ENTITY_TYPES"), "POST route missing entity-type whitelist");
});

test("55. GET route validates entity-type against whitelist", () => {
  const getIdx = routesSrc.indexOf("GET /api/crm/recent-news?entityType");
  const snippet = routesSrc.slice(getIdx, getIdx + 800);
  assert.ok(snippet.includes("VALID_ENTITY_TYPES"), "GET route missing entity-type whitelist");
});

test("56. POST route returns 409 with clear duplicate message", () => {
  const postIdx = routesSrc.indexOf("// POST /api/crm/recent-news\n");
  const snippet = routesSrc.slice(postIdx, postIdx + 3500);
  assert.ok(snippet.includes("already attached to this record"), "Missing clear duplicate message");
  assert.ok(snippet.includes("409"), "Duplicate must return HTTP 409");
});

test("57. PUT route checks ownership", () => {
  const putIdx = routesSrc.indexOf("PUT /api/crm/recent-news/:id");
  const snippet = routesSrc.slice(putIdx, putIdx + 1000);
  assert.ok(snippet.includes("added_by_user_id"), "PUT route missing ownership check");
  assert.ok(snippet.includes("isAdmin"), "PUT route missing admin bypass");
});

test("58. DELETE route checks ownership", () => {
  const delIdx = routesSrc.indexOf("DELETE /api/crm/recent-news/:id");
  const snippet = routesSrc.slice(delIdx, delIdx + 800);
  assert.ok(snippet.includes("added_by_user_id"), "DELETE route missing ownership check");
  assert.ok(snippet.includes("isAdmin"), "DELETE route missing admin bypass");
});

test("59. PUT route logs audit activity", () => {
  const putIdx = routesSrc.indexOf("PUT /api/crm/recent-news/:id");
  const snippet = routesSrc.slice(putIdx, putIdx + 2000);
  assert.ok(snippet.includes("INSERT INTO activities"), "PUT route missing audit log");
});

test("60. DELETE route logs audit activity", () => {
  const delIdx = routesSrc.indexOf("DELETE /api/crm/recent-news/:id");
  const snippet = routesSrc.slice(delIdx, delIdx + 1500);
  assert.ok(snippet.includes("INSERT INTO activities"), "DELETE route missing audit log");
});

test("61. Refresh-summary route logs audit activity", () => {
  const rfIdx = routesSrc.indexOf("refresh-summary");
  const snippet = routesSrc.slice(rfIdx, rfIdx + 1500);
  assert.ok(snippet.includes("INSERT INTO activities"), "Refresh route missing audit log");
});

test("62. use-in-email-context toggle route exists with auth", () => {
  assert.ok(
    routesSrc.includes('"/api/crm/recent-news/:id/use-in-email-context", requireAuth'),
    "use-in-email-context toggle route missing or missing requireAuth"
  );
});

test("63. Migration adds use_in_email_context column (idempotent)", () => {
  assert.ok(
    routesSrc.includes("ADD COLUMN IF NOT EXISTS use_in_email_context"),
    "Missing idempotent ALTER TABLE for use_in_email_context"
  );
});

test("64. All 7 required indexes present in migration", () => {
  const required = [
    "idx_crn_entity", "idx_crn_score", "idx_crn_added",
    "idx_crn_normalized_url", "idx_crn_published_at",
    "idx_crn_relevance_type", "idx_crn_use_in_email",
  ];
  for (const idx of required) {
    assert.ok(routesSrc.includes(idx), `Missing migration index: ${idx}`);
  }
});

console.log("────────────────────────────────────────────────");
