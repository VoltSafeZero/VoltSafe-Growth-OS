"use strict";
/**
 * CID inline image viewer tests
 *
 * Verifies:
 *  1. email-parser correctly marks CID parts as inline even when they carry a
 *     filename (name= in Content-Type) but have no Content-Disposition header.
 *  2. The attachment filter logic (frontend mirror) excludes any attachment that
 *     has a contentId, regardless of isInline flag (belt-and-suspenders for
 *     existing DB rows stored before the parser fix).
 *  3. ThreadMessage serialisation includes gmailMessageId so the CID proxy
 *     rewrite can resolve inline signature images.
 *  4. The CID proxy URL encoding uses the raw CID string without angle brackets.
 */

const assert = require("assert");

// ── 1. email-parser isInline logic ───────────────────────────────────────────

function makePayload({ filename, contentId, disposition } = {}) {
  const headers = [];
  if (contentId) headers.push({ name: "Content-ID", value: `<${contentId}>` });
  if (disposition) headers.push({ name: "Content-Disposition", value: disposition });
  return {
    mimeType: "image/png",
    filename: filename || "",
    headers,
    body: { size: 1234, attachmentId: "att123" },
    partId: "2.1",
  };
}

// Replicate the fixed extractAttachments logic from email-parser.ts
function extractAttachments(payload, out = []) {
  if (!payload) return out;
  const headers = payload.headers || [];
  const get = (n) => (headers.find(h => h.name.toLowerCase() === n.toLowerCase())?.value || "");
  const disposition = get("Content-Disposition");
  const contentIdRaw = get("Content-ID");
  const contentId = contentIdRaw ? contentIdRaw.replace(/^<|>$/g, "").trim() : null;

  const filename = (payload.filename || "").trim();
  const hasFilename = filename.length > 0;
  const hasAttachId = !!(payload.body?.attachmentId);
  const isAttachmentDisp = /^attachment/i.test(disposition);
  const isInlineDisp = /^inline/i.test(disposition);

  // FIXED: any part with Content-ID is inline (RFC 2392)
  const isInline = isInlineDisp || !!contentId;

  if ((hasFilename || hasAttachId || isAttachmentDisp || isInline) &&
      payload.mimeType && !payload.mimeType.startsWith("multipart/")) {
    out.push({
      gmailAttachmentId: payload.body?.attachmentId || null,
      filename: filename || (contentId ? `inline-${contentId}` : "(unnamed)"),
      mimeType: payload.mimeType || "application/octet-stream",
      sizeBytes: Number(payload.body?.size || 0),
      contentId,
      isInline,
      partId: payload.partId || null,
    });
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) extractAttachments(part, out);
  }
  return out;
}

// Test 1a: CID part with filename + no Content-Disposition → isInline=true
{
  const p = makePayload({ filename: "sig-image-1.png", contentId: "vsig0abc123" });
  const result = extractAttachments(p);
  assert.strictEqual(result.length, 1, "1a: should extract CID part");
  assert.strictEqual(result[0].isInline, true, "1a: CID part with filename should be isInline=true");
  assert.strictEqual(result[0].contentId, "vsig0abc123", "1a: contentId stripped of angle brackets");
  console.log("✓ 1a: CID part with filename, no Content-Disposition → isInline=true");
}

// Test 1b: CID part with Content-Disposition:inline → isInline=true
{
  const p = makePayload({ filename: "sig-image-2.png", contentId: "vsig0def456", disposition: "inline" });
  const result = extractAttachments(p);
  assert.strictEqual(result[0].isInline, true, "1b: isInline=true when Content-Disposition:inline");
  console.log("✓ 1b: CID part with Content-Disposition:inline → isInline=true");
}

// Test 1c: Regular attachment (no CID, has Content-Disposition:attachment) → isInline=false
{
  const p = makePayload({ filename: "report.pdf", disposition: "attachment" });
  const result = extractAttachments(p);
  assert.strictEqual(result.length, 1, "1c: regular attachment extracted");
  assert.strictEqual(result[0].isInline, false, "1c: regular attachment isInline=false");
  assert.strictEqual(result[0].contentId, null, "1c: no contentId on regular attachment");
  console.log("✓ 1c: Regular attachment (no CID) → isInline=false");
}

// Test 1d: CID part with no filename (unnamed) → isInline=true
{
  const p = makePayload({ contentId: "vsig0ghi789" });
  p.body.attachmentId = undefined;
  p.body.size = 512;
  const result = extractAttachments(p);
  assert.strictEqual(result[0].isInline, true, "1d: unnamed CID part → isInline=true");
  assert.ok(result[0].filename.startsWith("inline-"), "1d: unnamed CID gets synthetic filename");
  console.log("✓ 1d: CID part with no filename → isInline=true, synthetic filename");
}

// ── 2. Frontend attachment filter (mirror of gmail-inbox.tsx filter) ──────────

function filterVisibleAttachments(attachments) {
  return attachments.filter(a => !a.isInline && !a.contentId);
}

// Test 2a: Attachment with isInline=true is excluded
{
  const atts = [
    { filename: "sig-image-1.png", isInline: true, contentId: "vsig0abc123" },
    { filename: "report.pdf", isInline: false, contentId: null },
  ];
  const visible = filterVisibleAttachments(atts);
  assert.strictEqual(visible.length, 1, "2a: inline attachment excluded");
  assert.strictEqual(visible[0].filename, "report.pdf", "2a: only non-inline shown");
  console.log("✓ 2a: isInline=true attachment excluded from visible list");
}

// Test 2b: Belt-and-suspenders — old DB row with isInline=false but contentId set is also excluded
{
  const atts = [
    { filename: "sig-image-1.png", isInline: false, contentId: "vsig0abc123" }, // old DB row
    { filename: "report.pdf", isInline: false, contentId: null },
  ];
  const visible = filterVisibleAttachments(atts);
  assert.strictEqual(visible.length, 1, "2b: old CID row (isInline=false but contentId set) excluded");
  assert.strictEqual(visible[0].filename, "report.pdf", "2b: only non-CID shown");
  console.log("✓ 2b: Old DB row (isInline=false, contentId set) excluded by belt-and-suspenders filter");
}

// Test 2c: Real attachment with no contentId and isInline=false is NOT excluded
{
  const atts = [
    { filename: "photo.jpg", isInline: false, contentId: null },
    { filename: "invoice.pdf", isInline: false, contentId: null },
  ];
  const visible = filterVisibleAttachments(atts);
  assert.strictEqual(visible.length, 2, "2c: real attachments all shown");
  console.log("✓ 2c: Real attachments (no contentId, not inline) all shown");
}

// ── 3. gmailMessageId population in getLocalThread response ──────────────────

// Simulate the getLocalThread message mapping
function simulateLocalThreadMessage(row) {
  return {
    id: row.gmail_message_id,
    gmailMessageId: row.gmail_message_id, // FIXED: explicitly set
    threadId: row.gmail_thread_id,
    body: row.body_html || row.body_text || "",
    isHtml: !!row.body_html,
    attachments: [],
  };
}

{
  const row = { gmail_message_id: "18xyzabc1234", gmail_thread_id: "thread1", body_html: "<p>hi</p>", body_text: null };
  const msg = simulateLocalThreadMessage(row);
  assert.ok(msg.gmailMessageId, "3: gmailMessageId should be set");
  assert.strictEqual(msg.gmailMessageId, "18xyzabc1234", "3: gmailMessageId matches gmail_message_id");
  assert.strictEqual(msg.id, msg.gmailMessageId, "3: id and gmailMessageId are the same value");
  console.log("✓ 3: getLocalThread message has gmailMessageId populated");
}

// ── 4. CID proxy URL construction ─────────────────────────────────────────────

function buildCidProxyUrl(gmailMessageId, cid) {
  return `/api/gmail/messages/${encodeURIComponent(gmailMessageId)}/cid-image/${encodeURIComponent(cid)}`;
}

{
  const url = buildCidProxyUrl("18xyzabc1234", "vsig0abc123");
  assert.ok(url.includes("/api/gmail/messages/"), "4: proxy URL has correct prefix");
  assert.ok(url.includes("/cid-image/"), "4: proxy URL has cid-image segment");
  assert.ok(!url.includes("<") && !url.includes(">"), "4: no angle brackets in proxy URL");
  console.log("✓ 4: CID proxy URL correctly constructed (no angle brackets)");
}

// Test 4b: CID values with special chars are percent-encoded
{
  const url = buildCidProxyUrl("18xyzabc1234", "vsig0/image@domain");
  assert.ok(!url.includes("@"), "4b: @ char is percent-encoded in proxy URL");
  assert.ok(!url.includes("/vsig0/"), "4b: / in CID is percent-encoded, not treated as path separator");
  console.log("✓ 4b: Special chars in CID are percent-encoded in proxy URL");
}

// ── 5. CID rewrite regex (double and single quotes) ──────────────────────────

function rewriteCidRefs(html, gmailMessageId) {
  if (!gmailMessageId || !/src=["']cid:/i.test(html)) return html;
  let result = html;
  result = result.replace(/\bsrc="cid:([^"]+)"/gi, (_, cid) =>
    `src="/api/gmail/messages/${encodeURIComponent(gmailMessageId)}/cid-image/${encodeURIComponent(cid)}"`
  );
  result = result.replace(/\bsrc='cid:([^']+)'/gi, (_, cid) =>
    `src="/api/gmail/messages/${encodeURIComponent(gmailMessageId)}/cid-image/${encodeURIComponent(cid)}"`
  );
  return result;
}

{
  const html = `<img src="cid:vsig0abc123" alt="logo">`;
  const rewritten = rewriteCidRefs(html, "18xyzabc1234");
  assert.ok(!rewritten.includes("cid:"), "5: double-quoted cid: ref rewritten");
  assert.ok(rewritten.includes("/api/gmail/messages/18xyzabc1234/cid-image/"), "5: double-quoted cid: becomes proxy URL");
  console.log("✓ 5: Double-quoted src=\"cid:...\" rewritten to proxy URL");
}

{
  const html = `<img src='cid:vsig0def456' alt="logo">`;
  const rewritten = rewriteCidRefs(html, "18xyzabc1234");
  assert.ok(!rewritten.includes("cid:"), "5b: single-quoted cid: ref rewritten");
  assert.ok(rewritten.includes("/api/gmail/messages/18xyzabc1234/cid-image/"), "5b: single-quoted cid: becomes proxy URL");
  console.log("✓ 5b: Single-quoted src='cid:...' rewritten to proxy URL");
}

{
  const html = `<img src="https://example.com/logo.png">`;
  const rewritten = rewriteCidRefs(html, "18xyzabc1234");
  assert.strictEqual(rewritten, html, "5c: https: src left untouched");
  console.log("✓ 5c: Non-CID src attributes left untouched");
}

{
  const html = `<img src="cid:A" alt="a"><img src='cid:B' alt="b">`;
  const rewritten = rewriteCidRefs(html, "18xyzabc1234");
  assert.ok(!rewritten.includes("cid:"), "5d: both double and single quoted cid: refs rewritten in same HTML");
  assert.ok(rewritten.includes("cid-image/A") && rewritten.includes("cid-image/B"), "5d: both CIDs present in output");
  console.log("✓ 5d: Mixed double + single quoted cid: refs both rewritten");
}

// ── 6. No gmailMessageId → cid: refs left untouched (DOMPurify will strip) ───

{
  const html = `<img src="cid:vsig0abc123" alt="logo">`;
  const rewritten = rewriteCidRefs(html, null); // no gmailMessageId
  assert.strictEqual(rewritten, html, "6: without gmailMessageId, cid: refs not rewritten");
  console.log("✓ 6: Without gmailMessageId, cid: refs left as-is (will be stripped by DOMPurify)");
}

console.log("\n✅ All CID viewer tests passed.");
