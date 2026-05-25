#!/usr/bin/env node
/**
 * tests/link-preview.test.js — Link preview regression test suite.
 *
 * Groups:
 *   A  source-grep: buildLinkPreviewCardHtml produces correct card structure
 *   B  source-grep: sanitizeEditorHtml preserves preview cards (extractPreviewBlocks)
 *   C  source-grep: handleBodyPaste detects bare URLs + calls triggerLinkPreview
 *   D  source-grep: SSRF protection present in server/services/link-preview.ts
 *   E  HTTP: /api/link-preview blocks localhost / private IPs (requires running server)
 *   F  HTTP: /api/link-preview rejects non-http protocols (requires running server)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

// ── Config ────────────────────────────────────────────────────────────────────

const BASE         = "http://localhost:5000";
const OWNER_EMAIL  = "trevor@voltsafe.com";
const OWNER_PWD    = "alberni1444";
const ORIGIN       = { Origin: BASE };

const CARD_PATH    = join(ROOT, "client/src/lib/link-preview-card.ts");
const FORMAT_PATH  = join(ROOT, "client/src/lib/email-format.ts");
const INBOX_PATH   = join(ROOT, "client/src/pages/gmail-inbox.tsx");
const SERVICE_PATH = join(ROOT, "server/services/link-preview.ts");

// ── Result tracking ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function bad(label, got = "") {
  console.log(`  ✗ ${label}${got ? `\n    got: ${got}` : ""}`);
  failed++;
}

function grep(src, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(src);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Login failed for ${email}: ${res.status} — ${body.slice(0, 120)}`);
  }
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(300);
  return cookie;
}

const authed = (cookie) => (url, opts = {}) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...ORIGIN,
      ...(opts.headers || {}),
    },
  });

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Link Preview Regression Test ===\n");

  // ── A: preview card HTML structure ─────────────────────────────────────────
  console.log("[A] client/src/lib/link-preview-card.ts — card HTML structure");

  let cardSrc;
  try {
    cardSrc = readFileSync(CARD_PATH, "utf8");
    ok("read link-preview-card.ts");
  } catch (e) {
    bad("read link-preview-card.ts", e.message);
    process.exit(1);
  }

  if (grep(cardSrc, /data-link-preview="\$\{safeUrl\}"/)) {
    ok("buildLinkPreviewCardHtml uses data-link-preview attribute (sanitizer anchor)");
  } else {
    bad(
      "buildLinkPreviewCardHtml uses data-link-preview attribute",
      "card won't be preserved by sanitizeEditorHtml",
    );
  }

  if (grep(cardSrc, /contenteditable="false"/)) {
    ok("card has contenteditable=false (non-editable island in composer)");
  } else {
    bad("card has contenteditable=false", "cursor can accidentally enter the card");
  }

  if (grep(cardSrc, /<table\b/) && grep(cardSrc, /style=/)) {
    ok("card uses <table> structure with inline styles (email client compatible)");
  } else {
    bad("card uses <table> with inline styles", "may not render correctly in email clients");
  }

  if (grep(cardSrc, /target="_blank"/) && grep(cardSrc, /rel="noopener noreferrer"/)) {
    ok("preview card anchor has target=_blank + rel=noopener noreferrer");
  } else {
    bad("preview card anchor has safe attributes", "link may open in-frame or miss noopener");
  }

  if (grep(cardSrc, /data-link-preview-loading=/)) {
    ok("buildLinkPreviewLoadingHtml uses data-link-preview-loading attribute");
  } else {
    bad("buildLinkPreviewLoadingHtml uses data-link-preview-loading", "can't find placeholder to replace");
  }

  if (grep(cardSrc, /function esc\b/) && grep(cardSrc, /replace.*&amp;/)) {
    ok("esc() HTML-escape helper present — metadata strings are escaped before insertion");
  } else {
    bad("esc() HTML-escape helper present", "XSS risk: metadata strings may be injected unescaped");
  }

  if (grep(cardSrc, /safeImageUrl/)) {
    ok("safeImageUrl() validates image URLs before inserting into <img src>");
  } else {
    bad("safeImageUrl() validates image URLs", "data: URIs or javascript: could reach <img>");
  }

  // ── B: sanitizeEditorHtml preserves preview blocks ─────────────────────────
  console.log("\n[B] client/src/lib/email-format.ts — sanitizeEditorHtml preserves preview cards");

  let formatSrc;
  try {
    formatSrc = readFileSync(FORMAT_PATH, "utf8");
    ok("read email-format.ts");
  } catch (e) {
    bad("read email-format.ts", e.message);
    process.exit(1);
  }

  if (grep(formatSrc, /extractPreviewBlocks/)) {
    ok("extractPreviewBlocks() helper present (balanced-tag extractor)");
  } else {
    bad("extractPreviewBlocks() helper present", "preview cards will be destroyed by sanitizeEditorHtml");
  }

  if (grep(formatSrc, /LPREVIEW/)) {
    ok("LPREVIEW sentinel token used (blocks protected during sanitisation)");
  } else {
    bad("LPREVIEW sentinel token used", "blocks may be mutated by intermediate sanitisation steps");
  }

  if (grep(formatSrc, /Pre-pass|extract.*preview|preview.*extract/i)) {
    ok("sanitizeEditorHtml documents the preview pre-pass");
  } else {
    bad("sanitizeEditorHtml documents the pre-pass", "future maintainers may remove it accidentally");
  }

  if (grep(formatSrc, /PREVIEW_TOKEN_RE|previewBlocks\.length/)) {
    ok("sanitizeEditorHtml re-inserts preview blocks after sanitisation");
  } else {
    bad("sanitizeEditorHtml re-inserts preview blocks", "cards will disappear when body is sanitised");
  }

  // The href check spans multiple lines — grep independently for the replace
  // call and for the https? protocol guard that lives inside it.
  if (grep(formatSrc, /block\.replace/) && grep(formatSrc, /https\?.*test.*safe|safe.*https\?/i)) {
    ok("hrefs in re-inserted preview blocks are checked (href replace + protocol guard)");
  } else if (grep(formatSrc, /block\.replace/) && grep(formatSrc, /href.*#|href="#"/)) {
    ok("hrefs in re-inserted preview blocks are sanitised (unsafe hrefs rewritten to #)");
  } else {
    bad("hrefs inside preview blocks are validated", "XSS risk in re-inserted block hrefs");
  }

  // ── C: composer paste handler detects URLs ──────────────────────────────────
  console.log("\n[C] client/src/pages/gmail-inbox.tsx — paste handler URL detection");

  let inboxSrc;
  try {
    inboxSrc = readFileSync(INBOX_PATH, "utf8");
    ok("read gmail-inbox.tsx");
  } catch (e) {
    bad("read gmail-inbox.tsx", e.message);
    process.exit(1);
  }

  if (grep(inboxSrc, /LINK_PREVIEW_URL_RE\s*=\s*\/\^https\?/)) {
    ok("LINK_PREVIEW_URL_RE pattern defined (bare URL detection regex)");
  } else {
    bad("LINK_PREVIEW_URL_RE pattern defined", "bare URL pastes won't trigger link preview");
  }

  if (grep(inboxSrc, /triggerLinkPreview/)) {
    ok("triggerLinkPreview function exists in ComposeDialog");
  } else {
    bad("triggerLinkPreview function exists", "no preview fetch will be triggered on URL paste");
  }

  if (grep(inboxSrc, /buildLinkPreviewLoadingHtml/)) {
    ok("buildLinkPreviewLoadingHtml called (loading placeholder inserted immediately)");
  } else {
    bad("buildLinkPreviewLoadingHtml called", "user sees nothing while preview loads");
  }

  if (grep(inboxSrc, /buildLinkPreviewCardHtml/)) {
    ok("buildLinkPreviewCardHtml called (card replaces loading placeholder)");
  } else {
    bad("buildLinkPreviewCardHtml called", "loading placeholder never replaced with card");
  }

  if (grep(inboxSrc, /data-link-preview-loading/)) {
    ok("loading placeholder located via data-link-preview-loading for replace/remove");
  } else {
    bad("loading placeholder found via data-link-preview-loading", "replace/remove logic may fail");
  }

  if (grep(inboxSrc, /\[data-link-preview\]/) || grep(inboxSrc, /data-link-preview\]/)) {
    ok("deduplication: existing data-link-preview elements checked before insert");
  } else {
    bad("deduplication check for data-link-preview", "pasting same URL twice shows duplicate cards");
  }

  if (grep(inboxSrc, /\/api\/link-preview\?url=/)) {
    ok("triggerLinkPreview fetches /api/link-preview?url=<encoded>");
  } else {
    bad("triggerLinkPreview fetches /api/link-preview", "no preview API call will be made");
  }

  if (grep(inboxSrc, /credentials.*include/)) {
    ok("link-preview fetch includes credentials (auth cookie forwarded)");
  } else {
    bad("link-preview fetch includes credentials", "fetch may 401 for authenticated route");
  }

  // ── D: SSRF protection in link-preview service ──────────────────────────────
  console.log("\n[D] server/services/link-preview.ts — SSRF protection");

  let serviceSrc;
  try {
    serviceSrc = readFileSync(SERVICE_PATH, "utf8");
    ok("read server/services/link-preview.ts");
  } catch (e) {
    bad("read server/services/link-preview.ts", e.message);
    process.exit(1);
  }

  if (grep(serviceSrc, /dns\.lookup|dns\/promises/)) {
    ok("DNS resolution used to check IPs before fetch (SSRF prevention)");
  } else {
    bad("DNS resolution before fetch", "SSRF via DNS rebinding is possible");
  }

  if (grep(serviceSrc, /isPrivateIp|PRIVATE_RANGES/)) {
    ok("isPrivateIp / PRIVATE_RANGES check present");
  } else {
    bad("isPrivateIp / PRIVATE_RANGES check", "private/internal IPs not blocked");
  }

  if (grep(serviceSrc, /127\\./) && grep(serviceSrc, /10\\./) && grep(serviceSrc, /192\\.168\\./)) {
    ok("loopback (127.x), RFC-1918 (10.x, 192.168.x) ranges covered");
  } else {
    bad("loopback and RFC-1918 ranges covered", "some private IP ranges may not be blocked");
  }

  // The 172.x regex is inside a JS regex literal; grep for the distinctive
  // 1[6-9] fragment that covers 172.16–172.19.
  if (grep(serviceSrc, /172/) && grep(serviceSrc, /1\[6-9\]/)) {
    ok("RFC-1918 172.16-31.x range covered (GCP/AWS internal subnets)");
  } else {
    bad("RFC-1918 172.16-31.x range covered", "GCP / AWS internal IPs may not be blocked");
  }

  if (grep(serviceSrc, /AbortController|5_000|5000/)) {
    ok("fetch timeout present (5 s AbortController guard)");
  } else {
    bad("fetch timeout present", "slow remote servers can hang the request queue");
  }

  if (grep(serviceSrc, /protocol !== "http:"/) || grep(serviceSrc, /http:.*https:/)) {
    ok("only http and https protocols accepted");
  } else {
    bad("only http/https accepted", "file:// or other protocols may reach the filesystem");
  }

  if (grep(serviceSrc, /text\/html/)) {
    ok("content-type check: only text/html bodies are parsed");
  } else {
    bad("content-type check", "binary responses may be partially parsed");
  }

  if (grep(serviceSrc, /524_288|512.*KB|slice.*524/)) {
    ok("body capped at 512 KB to prevent memory exhaustion on large pages");
  } else {
    bad("body size cap present", "a 100 MB HTML page could exhaust process memory");
  }

  // ── E: HTTP — private/localhost URLs blocked ────────────────────────────────
  console.log("\n[E] HTTP — /api/link-preview blocks private and localhost URLs");

  let ownerCookie;
  try {
    ownerCookie = await login(OWNER_EMAIL, OWNER_PWD);
  } catch (e) {
    bad("login as owner (required for HTTP groups E/F)", e.message);
    printSummary();
    process.exit(failed > 0 ? 1 : 0);
  }

  const asOwner = authed(ownerCookie);

  // E1: localhost SSRF
  {
    const res = await asOwner(
      "/api/link-preview?url=" + encodeURIComponent("http://localhost:5000/api/auth/me"),
    );
    if (res.status === 422 || res.status === 400) {
      ok("GET /api/link-preview?url=http://localhost:5000 → 400/422 (SSRF blocked)");
    } else {
      const body = await res.text().catch(() => "");
      bad(
        "GET /api/link-preview?url=http://localhost:5000 → 400/422",
        `got ${res.status}: ${body.slice(0, 80)}`,
      );
    }
  }

  // E2: loopback 127.0.0.1
  {
    const res = await asOwner("/api/link-preview?url=" + encodeURIComponent("http://127.0.0.1/"));
    if (res.status === 422 || res.status === 400) {
      ok("GET /api/link-preview?url=http://127.0.0.1 → 400/422 (loopback blocked)");
    } else {
      bad("GET /api/link-preview?url=http://127.0.0.1 → 400/422", `got ${res.status}`);
    }
  }

  // E3: RFC-1918 192.168.x.x
  {
    const res = await asOwner("/api/link-preview?url=" + encodeURIComponent("http://192.168.1.1/"));
    if (res.status === 422 || res.status === 400) {
      ok("GET /api/link-preview?url=http://192.168.1.1 → 400/422 (private IP blocked)");
    } else {
      bad("GET /api/link-preview?url=http://192.168.1.1 → 400/422", `got ${res.status}`);
    }
  }

  // E4: unauthenticated → 401/403
  {
    const res = await fetch(
      `${BASE}/api/link-preview?url=${encodeURIComponent("https://example.com")}`,
      { headers: { ...ORIGIN } },
    );
    if (res.status === 401 || res.status === 403) {
      ok("GET /api/link-preview without session → 401/403 (requireAuth enforced)");
    } else {
      bad("GET /api/link-preview without session → 401/403", `got ${res.status}`);
    }
  }

  // ── F: HTTP — invalid protocols rejected ────────────────────────────────────
  console.log("\n[F] HTTP — /api/link-preview rejects non-http/https protocols");

  // F1: file://
  {
    const res = await asOwner(
      "/api/link-preview?url=" + encodeURIComponent("file:///etc/passwd"),
    );
    if (res.status === 400 || res.status === 422) {
      ok("GET /api/link-preview?url=file:///etc/passwd → 400/422 (non-http blocked)");
    } else {
      bad("GET /api/link-preview?url=file:///etc/passwd → 400/422", `got ${res.status}`);
    }
  }

  // F2: javascript:
  {
    const res = await asOwner(
      "/api/link-preview?url=" + encodeURIComponent("javascript:alert(1)"),
    );
    if (res.status === 400 || res.status === 422) {
      ok("GET /api/link-preview?url=javascript:alert(1) → 400/422 (javascript: blocked)");
    } else {
      bad("GET /api/link-preview?url=javascript:alert(1) → 400/422", `got ${res.status}`);
    }
  }

  // F3: missing url param
  {
    const res = await asOwner("/api/link-preview");
    if (res.status === 400) {
      ok("GET /api/link-preview (no url param) → 400");
    } else {
      bad("GET /api/link-preview (no url param) → 400", `got ${res.status}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

function printSummary() {
  console.log("\n==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total\n`);
  if (failed > 0) {
    console.log("❌ Some tests FAILED");
  } else {
    console.log("✅ All tests PASSED");
  }
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
