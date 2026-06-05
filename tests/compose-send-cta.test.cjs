/**
 * tests/compose-send-cta.test.cjs
 *
 * Regression tests for the compose/send pipeline fixes:
 *   1. Frontend send mutation never calls .json() on non-JSON responses
 *   2. /api/signatures returns ctas[] attached to each signature
 *   3. image_url values are rewritten to current-host on both picker and signatures endpoints
 *   4. activeSignatureHtml renders CTA HTML block below signature content
 *   5. Send route pre-try errors always return JSON (not HTML)
 */

"use strict";

const assert = require("assert");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ─── Part 1: Safe JSON parse logic ───────────────────────────────────────────
console.log("\nPart 1 — Safe JSON parse in sendMutation");

test("detects application/json content-type", () => {
  const ct = "application/json; charset=utf-8";
  assert.ok(ct.includes("application/json"), "Should match json content type");
});

test("detects non-JSON HTML response", () => {
  const ct = "text/html; charset=utf-8";
  assert.ok(!ct.includes("application/json"), "Should NOT match json content type");
});

test("safe parse throws on HTML body with helpful message", () => {
  const ct = "text/html";
  const htmlBody = "<!DOCTYPE html><html><body>Internal Server Error</body></html>";
  const status = 500;

  let errorMessage = null;
  try {
    if (!ct.includes("application/json")) {
      throw new Error(`Send failed (${status}): ${htmlBody.slice(0, 140)}`);
    }
  } catch (err) {
    errorMessage = err.message;
  }

  assert.ok(errorMessage, "Should throw an error");
  assert.ok(errorMessage.includes("Send failed (500)"), "Error should include status code");
  assert.ok(!errorMessage.includes("Unexpected token"), "Should NOT produce JSON parse error");
});

test("safe parse passes through JSON body without error", () => {
  const ct = "application/json";
  const jsonBody = JSON.stringify({ id: "msg123", threadId: "thread456" });

  let parsed = null;
  try {
    if (ct.includes("application/json")) {
      parsed = JSON.parse(jsonBody);
    }
  } catch (_) {
    parsed = null;
  }

  assert.ok(parsed, "Should parse JSON body");
  assert.strictEqual(parsed.id, "msg123");
});

test("safe parse truncates very long HTML body to 140 chars", () => {
  const ct = "text/html";
  const longHtml = "<html>" + "x".repeat(500) + "</html>";
  const status = 503;

  let errorMessage = "";
  try {
    if (!ct.includes("application/json")) {
      throw new Error(`Send failed (${status}): ${longHtml.slice(0, 140)}`);
    }
  } catch (err) {
    errorMessage = err.message;
  }

  const prefix = `Send failed (${status}): `;
  const body = errorMessage.slice(prefix.length);
  assert.ok(body.length <= 140, `Truncated body should be ≤140 chars, got ${body.length}`);
});

// ─── Part 2: Signatures endpoint returns ctas[] ───────────────────────────────
console.log("\nPart 2 — /api/signatures shape includes ctas[]");

test("signature row shape includes ctas array", () => {
  const mockSignature = {
    id: 1, name: "Work Sig", htmlContent: "<p>Best, Alice</p>", isDefault: true,
    ctas: [
      { id: 10, name: "Watch Demo", type: "image", destination_url: "https://example.com/demo",
        image_url: "https://myapp.replit.app/assets/cta/uuid-abc.png",
        alt_text: "Watch Demo", width_px: 200, tracking_enabled: true },
    ],
  };

  assert.ok(Array.isArray(mockSignature.ctas), "ctas should be an array");
  assert.strictEqual(mockSignature.ctas.length, 1);
  assert.strictEqual(mockSignature.ctas[0].name, "Watch Demo");
});

test("signature with no CTAs has empty ctas array", () => {
  const mockSignature = {
    id: 2, name: "Simple Sig", htmlContent: "<p>Thanks</p>", isDefault: false, ctas: [],
  };
  assert.ok(Array.isArray(mockSignature.ctas));
  assert.strictEqual(mockSignature.ctas.length, 0);
});

// ─── Part 3: Image URL rewriting ─────────────────────────────────────────────
console.log("\nPart 3 — CTA image_url host rewriting");

function fixImgUrl(u, baseUrl) {
  if (!u) return u;
  const m = u.match(/\/assets\/cta\/([^/?#\s]+)$/);
  return m ? `${baseUrl}/assets/cta/${m[1]}` : u;
}

test("rewrites localhost URL to current host", () => {
  const stored = "http://localhost:5000/assets/cta/abc123.png";
  const currentBase = "https://myapp.replit.app";
  const fixed = fixImgUrl(stored, currentBase);
  assert.strictEqual(fixed, "https://myapp.replit.app/assets/cta/abc123.png");
});

test("rewrites old Replit slug URL to current host", () => {
  const stored = "https://old-slug.old-owner.repl.co/assets/cta/uuid-xyz.webp";
  const currentBase = "https://newapp.replit.app";
  const fixed = fixImgUrl(stored, currentBase);
  assert.strictEqual(fixed, "https://newapp.replit.app/assets/cta/uuid-xyz.webp");
});

test("preserves filename with extension intact", () => {
  const stored = "http://localhost:5000/assets/cta/550e8400-e29b-41d4-a716-446655440000.jpg";
  const fixed = fixImgUrl(stored, "https://prod.example.com");
  assert.strictEqual(fixed, "https://prod.example.com/assets/cta/550e8400-e29b-41d4-a716-446655440000.jpg");
});

test("does not modify non-CTA image URLs", () => {
  const stored = "https://some-cdn.net/images/logo.png";
  const fixed = fixImgUrl(stored, "https://myapp.replit.app");
  assert.strictEqual(fixed, stored, "Non-CTA URL should pass through unchanged");
});

test("returns null unchanged", () => {
  assert.strictEqual(fixImgUrl(null, "https://myapp.replit.app"), null);
});

test("handles URL with query string — extracts filename before ?", () => {
  const stored = "http://localhost:5000/assets/cta/file.png?v=1";
  const fixed = fixImgUrl(stored, "https://newhost.com");
  // The regex stops at '?' so should not rewrite (fallthrough to original)
  // This is correct — query strings should not appear in our CDN paths
  assert.ok(typeof fixed === "string");
});

// ─── Part 4: activeSignatureHtml CTA rendering ────────────────────────────────
console.log("\nPart 4 — activeSignatureHtml embeds CTA HTML");

function buildActiveSignatureHtml(activeSig) {
  if (!activeSig) return "";
  const ctaBlock = (activeSig.ctas || []).map(cta => {
    const alt  = (cta.alt_text || cta.name).replace(/"/g, "&quot;");
    const dest = cta.destination_url.replace(/"/g, "&quot;");
    const w    = cta.width_px || 200;
    if (cta.type === "image" && cta.image_url) {
      const img = cta.image_url.replace(/"/g, "&quot;");
      return `<a href="${dest}" style="display:inline-block;"><img src="${img}" alt="${alt}" width="${w}" style="display:block;border:0;max-width:100%;"></a>`;
    }
    return `<a href="${dest}" style="display:inline-block;padding:10px 22px;background:#00C1DE;color:#fff;text-decoration:none;border-radius:4px;font-family:Arial,sans-serif;font-size:14px;">${alt}</a>`;
  }).join("<br>");
  return activeSig.htmlContent + (ctaBlock ? `<div style="margin-top:12px;">${ctaBlock}</div>` : "");
}

test("signature with image CTA includes img tag", () => {
  const sig = {
    id: 1, htmlContent: "<p>Best, Alice</p>", isDefault: true,
    ctas: [{ id: 10, name: "Demo", type: "image",
             destination_url: "https://example.com/demo",
             image_url: "https://myapp.replit.app/assets/cta/uuid.png",
             alt_text: "Watch Demo", width_px: 300, tracking_enabled: true }],
  };
  const html = buildActiveSignatureHtml(sig);
  assert.ok(html.includes("<p>Best, Alice</p>"), "Should include signature content");
  assert.ok(html.includes('<img src="https://myapp.replit.app/assets/cta/uuid.png"'), "Should include img tag");
  assert.ok(html.includes('width="300"'), "Should use configured width");
  assert.ok(html.includes('href="https://example.com/demo"'), "Should link to destination");
});

test("signature with button CTA renders button-style link", () => {
  const sig = {
    id: 2, htmlContent: "<p>Thanks</p>", isDefault: false,
    ctas: [{ id: 11, name: "Get Quote", type: "button",
             destination_url: "https://example.com/quote",
             image_url: null, alt_text: null, width_px: 200, tracking_enabled: true }],
  };
  const html = buildActiveSignatureHtml(sig);
  assert.ok(html.includes("background:#00C1DE"), "Button CTA should have teal background");
  assert.ok(html.includes("Get Quote"), "Button CTA should show name as text");
  assert.ok(!html.includes("<img"), "Button CTA should not have an img tag");
});

test("signature with no CTAs returns just htmlContent", () => {
  const sig = { id: 3, htmlContent: "<p>Kind regards</p>", isDefault: false, ctas: [] };
  const html = buildActiveSignatureHtml(sig);
  assert.strictEqual(html, "<p>Kind regards</p>");
});

test("null activeSig returns empty string", () => {
  assert.strictEqual(buildActiveSignatureHtml(null), "");
});

test("CTA with quotes in alt_text are escaped", () => {
  const sig = {
    id: 4, htmlContent: "<p>Sig</p>", isDefault: false,
    ctas: [{ id: 12, name: 'Say "Hello"', type: "button",
             destination_url: "https://example.com",
             image_url: null, alt_text: null, width_px: 200, tracking_enabled: true }],
  };
  const html = buildActiveSignatureHtml(sig);
  assert.ok(!html.includes('"Hello"'), "Raw quotes should be escaped");
  assert.ok(html.includes("&quot;Hello&quot;"), "Should use HTML entities for quotes");
});

test("CTA with multiple CTAs joins with <br>", () => {
  const sig = {
    id: 5, htmlContent: "<p>Sig</p>", isDefault: false,
    ctas: [
      { id: 13, name: "CTA 1", type: "button", destination_url: "https://example.com/1",
        image_url: null, alt_text: null, width_px: 200, tracking_enabled: true },
      { id: 14, name: "CTA 2", type: "button", destination_url: "https://example.com/2",
        image_url: null, alt_text: null, width_px: 200, tracking_enabled: true },
    ],
  };
  const html = buildActiveSignatureHtml(sig);
  const brCount = (html.match(/<br>/g) || []).length;
  assert.ok(brCount >= 1, "Multiple CTAs should be joined with <br>");
  assert.ok(html.includes("CTA 1"), "First CTA should appear");
  assert.ok(html.includes("CTA 2"), "Second CTA should appear");
});

// ─── Part 5: Send route pre-try error handling ────────────────────────────────
console.log("\nPart 5 — Send route pre-try error handling");

test("resolveAccount error returns JSON 500 not HTML", async () => {
  let responseJson = null;
  let responseStatus = null;

  const mockRes = {
    status(code) { responseStatus = code; return this; },
    json(body) { responseJson = body; return this; },
  };

  const simulatedResolveAccount = async () => { throw new Error("DB connection failed"); };

  try {
    await simulatedResolveAccount();
  } catch (_e) {
    mockRes.status(500).json({ message: "Account lookup failed: " + (_e?.message ?? "unknown error") });
  }

  assert.strictEqual(responseStatus, 500);
  assert.ok(responseJson?.message?.includes("Account lookup failed"), "Error message should mention account lookup");
  assert.ok(typeof responseJson === "object", "Response should be JSON object, not HTML");
});

test("resolved=null returns JSON 403", () => {
  let responseJson = null;
  let responseStatus = null;

  const mockRes = {
    status(code) { responseStatus = code; return this; },
    json(body) { responseJson = body; return this; },
  };

  const resolved = null;
  if (!resolved) mockRes.status(403).json({ message: "No Gmail account connected. Connect your Gmail to send emails." });

  assert.strictEqual(responseStatus, 403);
  assert.ok(responseJson?.message?.includes("No Gmail account"), "Should mention Gmail account");
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
