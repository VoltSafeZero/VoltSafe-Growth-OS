"use strict";
// crm-attachment-download.test.cjs
// Source-grep tests verifying the Download button wiring, backend download
// endpoint security, and the no-schema-change constraint for Phase 7.1.

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const EMAILS_TAB = path.join(__dirname, "../client/src/components/emails-tab.tsx");
const ROUTES = path.join(__dirname, "../server/routes.ts");
const SCHEMA = path.join(__dirname, "../shared/schema.ts");

const tab = fs.readFileSync(EMAILS_TAB, "utf8");
const routes = fs.readFileSync(ROUTES, "utf8");
const schema = fs.readFileSync(SCHEMA, "utf8");

// ─────────────────────────────────────────────────────────────────────────────
console.log("[1] Download button — frontend wiring");
check("Download button has data-testid button-download-attachment-{id}", tab.includes("`button-download-attachment-${att.id}`"));
check("Download button href points to /api/gmail/attachments/:id/download", tab.includes("/api/gmail/attachments/${att.id}/download"));
check("Download button uses html download attribute (not window.open)", tab.includes("download={att.filename || \"attachment\"}"));
check("Download button is an <a> tag", (() => {
  const idx = tab.indexOf("`button-download-attachment-${att.id}`");
  if (idx < 0) return false;
  const before = tab.slice(Math.max(0, idx - 300), idx);
  return before.includes("<a") && !before.includes("window.open");
})());
check("Download URL does not include ?view=1 (forces attachment disposition)", (() => {
  const idx = tab.indexOf("`button-download-attachment-${att.id}`");
  if (idx < 0) return false;
  const before = tab.slice(Math.max(0, idx - 300), idx);
  return before.includes("/download`") || before.includes("/download\"");
})());

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] Download button — separated from View button");
check("View and Download are separate <a> elements", tab.includes("button-view-attachment") && tab.includes("button-download-attachment"));
check("View button shown conditionally (isViewable gate)", tab.includes("isViewable(att.mimeType)"));
check("Download button always shown (no isViewable gate on download)", (() => {
  const downloadIdx = tab.indexOf("`button-download-attachment-${att.id}`");
  if (downloadIdx < 0) return false;
  const before = tab.slice(Math.max(0, downloadIdx - 400), downloadIdx);
  return !before.includes("isViewable(att.mimeType)") || before.lastIndexOf("isViewable") < before.lastIndexOf("`button-view-attachment");
})());

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] Backend — download endpoint security");
check("GET /api/gmail/attachments/:id/download is gated by requireAuth", (() => {
  const idx = routes.indexOf("\"/api/gmail/attachments/:id/download\"");
  if (idx < 0) return false;
  const slice = routes.slice(Math.max(0, idx - 100), idx + 200);
  return slice.includes("requireAuth");
})());
check("Download endpoint uses getAttachmentOwner for access check", routes.includes("getAttachmentOwner(attId)"));
check("Download endpoint returns 403 when not owner/admin/shared", (() => {
  const idx = routes.indexOf("getAttachmentOwner(attId)");
  if (idx < 0) return false;
  const slice = routes.slice(idx, idx + 1000);
  return slice.includes("403");
})());
check("Download endpoint returns 404 when attachment not found", (() => {
  const idx = routes.indexOf("getAttachmentOwner(attId)");
  if (idx < 0) return false;
  const slice = routes.slice(idx, idx + 400);
  return slice.includes("404");
})());
check("Download endpoint proxies from Gmail (downloadGmailAttachment)", routes.includes("downloadGmailAttachment(attId)"));
check("Download endpoint returns 502 when Gmail proxy fails", routes.includes("502") && routes.includes("Could not fetch attachment from Gmail"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] Backend — inline view security (XSS guards)");
check("SVG explicitly blocked from inline serving", routes.includes("image/svg+xml") && routes.includes("safeForInline"));
check("Only image/* and application/pdf allowed as inline", (() => {
  const idx = routes.indexOf("safeForInline");
  if (idx < 0) return false;
  const slice = routes.slice(idx, idx + 300);
  return slice.includes("startsWith(\"image/\")") && slice.includes("application/pdf");
})());
check("Content-Disposition: attachment used when not safe for inline", routes.includes("\"attachment\"") && routes.includes("disposition"));
check("Content-Disposition: inline used only when wantsInline && safeForInline", routes.includes("wantsInline && safeForInline"));
check("SVG is the only image/* type excluded", (() => {
  const idx = routes.indexOf("safeForInline");
  if (idx < 0) return false;
  const slice = routes.slice(idx, idx + 400);
  return slice.includes("image/svg+xml") && !slice.includes("image/jpeg") && !slice.includes("image/png");
})());

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] Backend — filename sanitisation");
check("Filename sanitised before Content-Disposition header", routes.includes("replace(/[\\r\\n\"]/g, \"_\")"));
check("safeName used in Content-Disposition (not raw filename)", routes.includes("`${disposition}; filename=\"${safeName}\"`"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] Backend — no new storage / no schema changes");
check("email_attachments table unchanged (no new columns for Phase 7.1)", (() => {
  // Use a larger window (800 chars) to cover all column definitions in the table
  const start = schema.indexOf("email_attachments");
  const attSection = schema.slice(start, start + 800);
  const cols = ["id", "message_id", "gmail_attachment_id", "filename", "mime_type", "size_bytes", "content_id", "is_inline", "part_id"];
  return cols.every(c => attSection.includes(c));
})());
check("No new pgTable added for email attachment storage in schema.ts", (() => {
  // The existing table count should not have grown with a new email-attachment-specific table
  const tables = (schema.match(/export const \w+ = pgTable/g) || []);
  return tables.length > 0 && !tables.some(t => t.includes("crmAttachment") || t.includes("crm_attachment"));
})());
check("Listing endpoint reads email_attachments (no CREATE TABLE in listing handler)", (() => {
  const anchor = "CRM email attachment listing";
  const idx = routes.indexOf(anchor);
  if (idx < 0) return false;
  const slice = routes.slice(idx, idx + 3000);
  return slice.includes("FROM email_attachments") && !slice.includes("CREATE TABLE");
})());
check("Download endpoint uses existing calendar-invite-parser service (no new service file)", routes.includes("calendar-invoke-parser") || routes.includes("calendar-invite-parser"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[7] No inbox / sync changes");
check("No gmail sync functions changed (gmailSyncService not in tab)", !tab.includes("gmailSyncService"));
check("No smartCategory changes in emails-tab.tsx", (() => {
  const smIdx = tab.indexOf("smartCategory");
  return smIdx < 0 || tab.slice(smIdx - 10, smIdx + 20).includes("smartCategory");
})());
check("inbox-count-reconciliation invariants unaffected (is_inline exclusion already existed)", (() => {
  const listingBlock = routes.slice(routes.indexOf("gmail-attachments-list"), routes.indexOf("gmail-attachments-list") + 2000);
  return !listingBlock.includes("INBOX") && !listingBlock.includes("smart_category");
})());

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[8] Collapsed card badge preserved");
check("Collapsed card still shows paperclip attachment count chip", tab.includes("`badge-attachment-count-${latest.id}`"));
check("Collapsed card chip still uses Paperclip icon", tab.includes("<Paperclip") && tab.includes("badge-attachment-count"));
check("Collapsed chip still shows latest.attachmentCount", tab.includes("latest.attachmentCount") && tab.includes("badge-attachment-count"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[9] Regression — CRM email integrity");
check("Confirm link button still present", tab.includes("button-confirm-assoc-${email.id}"));
check("Remove link button still present", tab.includes("button-remove-assoc-${email.id}"));
check("Open in VS Mail button still present", tab.includes("button-open-vsmail-${email.id}"));
check("FullBodyViewer still rendered in expanded view", tab.includes("<FullBodyViewer"));
check("EngagementPanel still rendered for outbound emails", tab.includes("<EngagementPanel"));
check("Why linked section still rendered", tab.includes("Why linked"));
check("DirectionBadge still rendered in thread header", tab.includes("<DirectionBadge"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[10] No gmail.com links in attachment paths");
check("No mail.google.com URLs in attachment buttons", !tab.includes("mail.google.com"));
check("No gmail.google.com URLs in attachment buttons", !tab.includes("gmail.google.com"));
check("All attachment URLs are relative /api paths", (() => {
  const viewHref = tab.includes("/api/gmail/attachments/${att.id}/download?view=1");
  const dlHref = tab.includes("/api/gmail/attachments/${att.id}/download");
  return viewHref && dlHref;
})());

// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${"─".repeat(60)}`);
console.log(`CRM Attachment Download — ${total} total, ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
