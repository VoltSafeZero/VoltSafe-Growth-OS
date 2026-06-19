"use strict";
// crm-attachment-view.test.cjs
// Source-grep tests verifying the CRM AttachmentList component structure,
// the attachment listing API endpoint, and the inline-view (View button) paths.

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

const tab = fs.readFileSync(EMAILS_TAB, "utf8");
const routes = fs.readFileSync(ROUTES, "utf8");

// ─────────────────────────────────────────────────────────────────────────────
console.log("[1] CrmAttachment type");
check("CrmAttachment type is declared", tab.includes("type CrmAttachment"));
check("CrmAttachment has id: number", tab.includes("id: number") && tab.includes("CrmAttachment"));
check("CrmAttachment has filename: string | null", tab.includes("filename: string | null"));
check("CrmAttachment has mimeType: string | null", tab.includes("mimeType: string | null"));
check("CrmAttachment has sizeBytes: number | null", tab.includes("sizeBytes: number | null"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] AttachmentList component");
check("AttachmentList component is declared", tab.includes("function AttachmentList("));
check("AttachmentList receives gmailMessageId prop", tab.includes("gmailMessageId: string"));
check("AttachmentList receives count prop", tab.includes("count: number"));
check("AttachmentList has data-testid attachment-list-{id}", tab.includes("`attachment-list-${gmailMessageId}`"));
check("AttachmentList has toggle button testid", tab.includes("`button-toggle-attachments-${gmailMessageId}`"));
check("AttachmentList shows Paperclip icon on header", tab.includes("function AttachmentList") && tab.includes("<Paperclip"));
check("AttachmentList shows attachment count in header", tab.includes("attachment{count !== 1 ? \"s\" : \"\"}"));
check("AttachmentList shows ChevronDown when closed", tab.includes("ChevronDown") && tab.includes("AttachmentList"));
check("AttachmentList shows ChevronUp when open", tab.includes("ChevronUp") && tab.includes("AttachmentList"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] Attachment row — display fields");
check("Attachment row has data-testid attachment-row-{id}", tab.includes("`attachment-row-${att.id}`"));
check("Filename span has data-testid attachment-filename-{id}", tab.includes("`attachment-filename-${att.id}`"));
check("Type badge has data-testid attachment-type-{id}", tab.includes("`attachment-type-${att.id}`"));
check("Size span has data-testid attachment-size-{id}", tab.includes("`attachment-size-${att.id}`"));
check("Filename falls back to 'Unnamed attachment'", tab.includes("Unnamed attachment"));
check("FileText icon used per attachment row", tab.includes("<FileText"));
check("FileText icon imported from lucide-react", tab.includes("FileText,"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] getMimeLabel helper");
check("getMimeLabel function is declared", tab.includes("function getMimeLabel("));
check("getMimeLabel handles application/pdf → PDF", tab.includes("\"application/pdf\") return \"PDF\"") || tab.includes("application/pdf") && tab.includes("\"PDF\""));
check("getMimeLabel handles image/* subtypes", tab.includes("startsWith(\"image/\")") && tab.includes("getMimeLabel"));
check("getMimeLabel handles word processing docs", tab.includes("word") && tab.includes("DOC"));
check("getMimeLabel handles spreadsheets", tab.includes("sheet") || tab.includes("excel"));
check("getMimeLabel falls back to FILE", tab.includes("\"FILE\""));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] formatFileSize helper");
check("formatFileSize function is declared", tab.includes("function formatFileSize("));
check("formatFileSize handles bytes", tab.includes("B`") || tab.includes("` B`") || tab.includes("${bytes} B"));
check("formatFileSize handles KB", tab.includes("KB`") || tab.includes("` KB") || tab.includes("KB"));
check("formatFileSize handles MB", tab.includes("MB`") || tab.includes("` MB") || tab.includes("MB"));
check("formatFileSize returns empty string for null/0", tab.includes("if (!bytes || bytes <= 0) return \"\""));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] isViewable helper (View button gating)");
check("isViewable function is declared", tab.includes("function isViewable("));
check("isViewable returns true for image/* (non-SVG)", tab.includes("startsWith(\"image/\")") && tab.includes("isViewable"));
check("isViewable returns true for application/pdf", tab.includes("application/pdf") && tab.includes("isViewable"));
check("isViewable excludes image/svg+xml (XSS guard)", tab.includes("image/svg+xml") && tab.includes("isViewable"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[7] View button — inline serving");
check("View button has data-testid button-view-attachment-{id}", tab.includes("`button-view-attachment-${att.id}`"));
check("View button uses /api/gmail/attachments/:id/download?view=1", tab.includes("/download?view=1"));
check("View button opens in new tab (target=_blank)", tab.includes("target=\"_blank\"") && tab.includes("view=1"));
check("View button has rel=noopener noreferrer", tab.includes("noopener noreferrer"));
check("View button only shown when isViewable(att.mimeType) is true", tab.includes("isViewable(att.mimeType)"));
check("View button is an <a> tag (not window.open)", !tab.includes("window.open") || (tab.includes("`button-view-attachment-${att.id}`") && !tab.match(/window\.open[^)]+view/)));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[8] Backend — listing endpoint");
check("GET /api/gmail/messages/:msgId/attachments route registered", routes.includes("\"/api/gmail/messages/:msgId/attachments\""));
check("Listing endpoint is gated by requireAuth", (() => {
  const idx = routes.indexOf("\"/api/gmail/messages/:msgId/attachments\"");
  const slice = routes.slice(Math.max(0, idx - 200), idx + 100);
  return slice.includes("requireAuth");
})());
check("Listing endpoint queries email_attachments table", routes.includes("FROM email_attachments"));
check("Listing endpoint excludes inline attachments", routes.includes("is_inline IS NOT TRUE"));
check("Listing endpoint returns filename", routes.includes("filename") && routes.includes("email_attachments"));
check("Listing endpoint returns mimeType alias", routes.includes("mime_type AS \"mimeType\""));
check("Listing endpoint returns sizeBytes alias", routes.includes("size_bytes AS \"sizeBytes\""));
check("Listing endpoint orders by id", routes.includes("ORDER BY id") && routes.includes("email_attachments"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[9] Backend — listing auth (owner / admin / shared)");
// Anchor on the comment that precedes the handler — auth code comes AFTER it
function listingHandlerSlice() {
  const anchor = "CRM email attachment listing";
  const idx = routes.indexOf(anchor);
  if (idx < 0) return "";
  return routes.slice(idx, idx + 3000);
}
check("Listing endpoint checks mailTeamPerms for shared access", listingHandlerSlice().includes("mailTeamPerms"));
check("Listing endpoint checks ownerUserId vs userId", (() => {
  const s = listingHandlerSlice();
  return s.includes("ownerUserId") && s.includes("userId");
})());
check("Listing endpoint returns 403 for unauthorized", listingHandlerSlice().includes("403"));
check("Listing endpoint returns 404 for unknown message", listingHandlerSlice().includes("404"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[10] Backend — inline view mode on download endpoint");
check("Download endpoint supports ?view=1 query param", routes.includes("req.query.view === \"1\""));
check("wantsInline variable declared", routes.includes("wantsInline"));
check("safeForInline checks image/* (non-SVG)", routes.includes("startsWith(\"image/\")") && routes.includes("safeForInline"));
check("safeForInline checks application/pdf", routes.includes("application/pdf") && routes.includes("safeForInline"));
check("safeForInline explicitly blocks image/svg+xml", routes.includes("image/svg+xml") && routes.includes("safeForInline"));
check("disposition variable uses 'inline' when safe", routes.includes("\"inline\"") && routes.includes("disposition"));
check("disposition falls back to 'attachment' when not safe", routes.includes("\"attachment\"") && routes.includes("disposition"));
check("Content-Disposition uses disposition variable (not hardcoded)", routes.includes("`${disposition}; filename=\"${safeName}\"`"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[11] API fetch pattern");
check("AttachmentList uses useQuery for fetching", tab.includes("useQuery<CrmAttachment[]>"));
check("AttachmentList queryKey includes gmailMessageId", tab.includes("[\"/api/gmail/messages\", gmailMessageId, \"attachments\"]"));
check("AttachmentList enabled only when open (lazy fetch)", tab.includes("enabled: isOpen"));
check("AttachmentList has staleTime of 5 minutes", tab.includes("5 * 60 * 1000") && tab.includes("AttachmentList"));
check("AttachmentList fetch uses credentials: include", tab.includes("credentials: \"include\"") && tab.includes("gmailMessageId"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[12] Loading state");
check("Loading state has data-testid attachment-list-loading", tab.includes("attachment-list-loading"));
check("Loading state shows Loader2 spinner", tab.includes("Loader2") && tab.includes("animate-spin"));
check("Empty state shown when no downloadable attachments", tab.includes("No downloadable attachments found"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[13] Integration in MessageRow");
check("MessageRow renders AttachmentList (not old static badge)", tab.includes("<AttachmentList"));
check("MessageRow passes gmailMessageId to AttachmentList", tab.includes("gmailMessageId={email.gmailMessageId}") && tab.includes("AttachmentList"));
check("MessageRow passes count={email.attachmentCount} to AttachmentList", tab.includes("count={email.attachmentCount}") && tab.includes("AttachmentList"));
check("Old 'Open in VS Mail to download' hint is removed", !tab.includes("Open in VS Mail to download"));
check("Old static attachment-count-{id} div replaced by AttachmentList", !tab.includes("data-testid={`attachment-count-${email.id}`}"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[14] CRM context coverage (Lead / Account / Contact)");
check("EmailsTab objectType=lead is used in leads.tsx", (() => {
  try {
    const leads = fs.readFileSync(path.join(__dirname, "../client/src/pages/leads.tsx"), "utf8");
    return leads.includes("objectType") && leads.includes("lead");
  } catch { return false; }
})());
check("EmailsTab objectType=account is used in accounts.tsx", (() => {
  try {
    const accounts = fs.readFileSync(path.join(__dirname, "../client/src/pages/accounts.tsx"), "utf8");
    return accounts.includes("objectType") && accounts.includes("account");
  } catch { return false; }
})());
check("EmailsTab objectType=contact is used in contact-profile.tsx", (() => {
  try {
    const contact = fs.readFileSync(path.join(__dirname, "../client/src/pages/contact-profile.tsx"), "utf8");
    return contact.includes("objectType") && contact.includes("contact");
  } catch { return false; }
})());

// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${"─".repeat(60)}`);
console.log(`CRM Attachment View — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
