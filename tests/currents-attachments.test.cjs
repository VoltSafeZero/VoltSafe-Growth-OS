"use strict";
// Source-grep test — pins CURRENTS attachment display invariants
// Covers: CurrentAttachment interface, image/file chip display, file URL routing,
//         attach buttons in channel + DM compose, attachment chips in message rows,
//         Files tab rendering, attachment upload pipeline
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Load source files ─────────────────────────────────────────────────────────

const displaySrc = fs.readFileSync(
  path.join(__dirname, "../client/src/components/current/current-attachment-display.tsx"),
  "utf8"
);

const currentSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/current.tsx"),
  "utf8"
);

// ── 1. CurrentAttachment interface ───────────────────────────────────────────

console.log("\n1. CurrentAttachment interface");
assert(
  "CurrentAttachment interface exported",
  displaySrc.includes("export interface CurrentAttachment")
);
assert(
  "id field in interface",
  displaySrc.includes("id: number")
);
assert(
  "fileName field in interface",
  displaySrc.includes("fileName: string")
);
assert(
  "originalName field in interface",
  displaySrc.includes("originalName: string")
);
assert(
  "mimeType field in interface",
  displaySrc.includes("mimeType: string")
);
assert(
  "fileSize field in interface",
  displaySrc.includes("fileSize: number")
);

// ── 2. formatFileSize utility ────────────────────────────────────────────────

console.log("\n2. formatFileSize utility");
assert(
  "formatFileSize exported",
  displaySrc.includes("export function formatFileSize")
);
assert(
  "handles bytes < 1024",
  displaySrc.includes("< 1024") && displaySrc.includes("B`")
);
assert(
  "handles KB range",
  displaySrc.includes("KB`")
);
assert(
  "handles MB range",
  displaySrc.includes("MB`")
);

// ── 3. MIME type detection ────────────────────────────────────────────────────

console.log("\n3. MIME type icon/color detection");
assert(
  "image MIME handled",
  displaySrc.includes('mimeType.startsWith("image/")')
);
assert(
  "PDF MIME handled",
  displaySrc.includes('"application/pdf"')
);
assert(
  "video MIME handled",
  displaySrc.includes('mimeType.startsWith("video/")')
);
assert(
  "audio MIME handled",
  displaySrc.includes('mimeType.startsWith("audio/")')
);
assert(
  "spreadsheet MIME handled",
  displaySrc.includes('"excel"') || displaySrc.includes('"spreadsheet"')
);
assert(
  "zip/archive MIME handled",
  displaySrc.includes('"zip"')
);

// ── 4. File URL routing ───────────────────────────────────────────────────────

console.log("\n4. File URL routing");
assert(
  "fileUrl helper routes through /api/attachments/file/",
  displaySrc.includes("/api/attachments/file/")
);
assert(
  "file URL uses fileName (UUID-based, not originalName)",
  displaySrc.includes("fileUrl(att.fileName)")
);

// ── 5. Image attachment preview ──────────────────────────────────────────────

console.log("\n5. Image attachment preview");
assert(
  "ImageAttachmentPreview component defined",
  displaySrc.includes("function ImageAttachmentPreview")
);
assert(
  "image attachment testid present",
  displaySrc.includes('data-testid={`current-attachment-img-${att.id}`}')
);
assert(
  "image opens in new tab",
  displaySrc.includes('target="_blank"')
);
assert(
  "download link present on image",
  displaySrc.includes("Download")
);

// ── 6. File chip display ─────────────────────────────────────────────────────

console.log("\n6. File chip display");
assert(
  "file attachment testid present",
  displaySrc.includes('data-testid={`current-attachment-file-${att.id}`}')
);
assert(
  "originalName shown to user",
  displaySrc.includes("att.originalName")
);
assert(
  "file size shown",
  displaySrc.includes("formatFileSize(att.fileSize)")
);

// ── 7. CurrentAttachmentChips exported ───────────────────────────────────────

console.log("\n7. CurrentAttachmentChips component");
assert(
  "CurrentAttachmentChips exported from display module",
  displaySrc.includes("export function CurrentAttachmentChips") ||
  displaySrc.includes("export { CurrentAttachmentChips")
);
assert(
  "attachments prop accepted",
  displaySrc.includes("attachments: CurrentAttachment[]") ||
  displaySrc.includes("attachments:")
);

// ── 8. Attach buttons in channel and DM compose ──────────────────────────────

console.log("\n8. Attach buttons in compose areas");
assert(
  "btn-attach-channel testid present",
  currentSrc.includes('data-testid="btn-attach-channel"')
);
assert(
  "channel-file-input testid present",
  currentSrc.includes('data-testid="channel-file-input"')
);
assert(
  "btn-attach-dm testid present",
  currentSrc.includes('data-testid="btn-attach-dm"')
);
assert(
  "dm-file-input testid present",
  currentSrc.includes('data-testid="dm-file-input"')
);
assert(
  "btn-attach-reply testid present",
  currentSrc.includes('data-testid="btn-attach-reply"')
);
assert(
  "reply-file-input testid present",
  currentSrc.includes('data-testid="reply-file-input"')
);

// ── 9. CurrentAttachmentChips used in message rows ───────────────────────────

console.log("\n9. Attachment chips in message rows");
assert(
  "CurrentAttachmentChips rendered in channel messages",
  currentSrc.includes("CurrentAttachmentChips")
);
assert(
  "attachments prop passed to CurrentAttachmentChips",
  currentSrc.includes("attachments={message.attachments") ||
  currentSrc.includes("attachments={msg.attachments")
);

// ── 10. Files tab ─────────────────────────────────────────────────────────────

console.log("\n10. Files tab displays attachments");
assert(
  "Files tab filters messages with attachments",
  currentSrc.includes("m.attachments && m.attachments.length > 0") ||
  currentSrc.includes("msg.attachments && msg.attachments.length > 0")
);
assert(
  "FilesTabAttachments used for files tab display",
  currentSrc.includes("FilesTabAttachments")
);
assert(
  "Files tab handles empty state",
  currentSrc.includes("No files") ||
  currentSrc.includes("No attachments") ||
  currentSrc.includes("no files")
);

// ── 11. Attachment stored in message DB columns ───────────────────────────────

console.log("\n11. Attachment data in messages");
assert(
  "attachments field on message type in current.tsx",
  currentSrc.includes("attachments?: CurrentAttachment[]") ||
  currentSrc.includes("attachments?:")
);
assert(
  "CurrentAttachment type imported in current.tsx",
  currentSrc.includes("import type { CurrentAttachment }") ||
  currentSrc.includes("CurrentAttachment } from")
);

// ── 12. Upload pipeline ───────────────────────────────────────────────────────

console.log("\n12. Upload pipeline in current.tsx");
assert(
  "file upload API endpoint used",
  currentSrc.includes("/api/current/") && (
    currentSrc.includes("upload") || currentSrc.includes("Upload")
  )
);
assert(
  "msgsWithFiles pattern for Files tab",
  currentSrc.includes("msgsWithFiles") || currentSrc.includes("filter") && currentSrc.includes("attachments")
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`CURRENTS Attachments: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
