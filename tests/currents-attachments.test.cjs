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

const recordFeedSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/components/current/record-current-feed.tsx"),
  "utf8"
);

const routesSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes.ts"),
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

// ── 13. Filename mojibake fix (upload-time UTF-8 re-decode) ──────────────────

console.log("\n13. Filename encoding fix (mojibake)");
assert(
  "fixMojibakeFilename helper defined in routes.ts",
  routesSrc.includes("function fixMojibakeFilename")
);
assert(
  "helper re-decodes latin1-mangled bytes back to utf8",
  routesSrc.includes('Buffer.from(name, "latin1").toString("utf8")')
);
assert(
  "helper guards against corrupting genuinely-invalid input (replacement char check)",
  routesSrc.includes("\\uFFFD")
);
assert(
  "POST /api/attachments applies the fix to file.originalname before persisting",
  routesSrc.includes("originalName: fixMojibakeFilename(file.originalname)")
);
// Behavioral check: verify the helper actually reverses the exact mojibake
// pattern from the bug report (macOS screenshot filename with U+202F).
(function testMojibakeRoundTrip() {
  console.log("\n13b. Mojibake round-trip (behavioral)");
  function fixMojibakeFilename(name) {
    if (!name) return name;
    try {
      const reDecoded = Buffer.from(name, "latin1").toString("utf8");
      if (reDecoded.includes("\uFFFD")) return name;
      return reDecoded;
    } catch {
      return name;
    }
  }
  const original = "Screenshot 2026-07-07 at 8.01.09\u202FPM.png";
  // Simulate what busboy/multer does: the browser sends UTF-8 bytes for the
  // filename header, but multer/busboy decodes those bytes as latin1.
  const mangled = Buffer.from(original, "utf8").toString("latin1");
  assert(
    "simulated mangled name matches the bug report's mojibake example",
    mangled.includes("\u00e2\u0080\u00af"),
    `got: ${mangled}`
  );
  const fixed = fixMojibakeFilename(mangled);
  assert(
    "fixMojibakeFilename recovers the original UTF-8 filename",
    fixed === original,
    `expected: ${original}, got: ${fixed}`
  );
  const ascii = "invoice.pdf";
  assert(
    "fixMojibakeFilename is a no-op for pure-ASCII names",
    fixMojibakeFilename(ascii) === ascii
  );
})();

// ── 14. Files-only send support across composers ─────────────────────────────

console.log("\n14. Files-only (no text) send support");
assert(
  "channel POST route accepts hasPendingAttachments and allows empty body",
  routesSrc.includes('if (!body && !hasPendingAttachments) return res.status(400).json({ message: "Message body is required" });')
);
assert(
  "thread reply POST route accepts hasPendingAttachments and allows empty body",
  routesSrc.includes('if (!body && !hasPendingAttachments) return res.status(400).json({ message: "Reply body is required" });')
);
assert(
  "record message POST route accepts hasPendingAttachments and allows empty body",
  (routesSrc.match(/if \(!body && !hasPendingAttachments\) return res\.status\(400\)\.json\(\{ message: "Message body is required" \}\);/g) || []).length >= 2
);
assert(
  "DM POST route already supported hasPendingAttachments (baseline, unchanged)",
  routesSrc.includes("if (!rawBody && !hasPendingAttachments) return res.status(400).json({ message: \"Message body is required\" });")
);
assert(
  "channel composer (handleSend) allows send when files are pending with empty draft",
  currentSrc.includes("const hasFiles = mainPendingFiles.length > 0;") &&
  currentSrc.includes("if ((!trimmed && !hasFiles) || postMutation.isPending || isMainUploading) return;")
);
assert(
  "channel postMutation forwards hasPendingAttachments to the server",
  currentSrc.includes("hasPendingAttachments: hasFiles })")
);
assert(
  "thread reply composer (handleReplySend) allows send when files are pending with empty draft",
  currentSrc.includes("const hasFiles = replyPendingFiles.length > 0;") &&
  currentSrc.includes("if ((!trimmed && !hasFiles) || postReplyMutation.isPending || isReplyUploading) return;")
);
assert(
  "reply send button is enabled when files are pending even with empty draft",
  currentSrc.includes("disabled={(!replyDraft.trim() && replyPendingFiles.length === 0) || postReplyMutation.isPending || isReplyUploading}")
);
assert(
  "record-current MessageComposer allows submit when files are pending with empty draft",
  recordFeedSrc.includes("if ((!trimmed && files.length === 0) || disabled) return;")
);
assert(
  "record-current send button enabled when files pending with empty draft",
  recordFeedSrc.includes("disabled={(!draft.trim() && pendingFiles.length === 0) || disabled}")
);
assert(
  "record-current reply mutation forwards hasPendingAttachments",
  recordFeedSrc.includes("hasPendingAttachments: files.length > 0 })")
);

// ── 15. Broken-image resilience (fallback to file card) ──────────────────────

console.log("\n15. Broken image render resilience");
assert(
  "ImageAttachmentPreview tracks a broken-image state",
  displaySrc.includes("const [broken, setBroken] = useState(false);")
);
assert(
  "img element has onError handler to flip broken state",
  displaySrc.includes("onError={() => setBroken(true)}")
);
assert(
  "broken image falls back to FileAttachmentCard, not raw text",
  displaySrc.includes("if (broken) {") &&
  displaySrc.includes("return <FileAttachmentCard att={att} />;")
);
assert(
  "useState imported in attachment display module",
  displaySrc.includes('import { useState } from "react";')
);

// ── 16. Upload failure surfaces an error (no silent plain-text fallback) ─────

console.log("\n16. Upload failure error surfacing");
assert(
  "uploadCurrentAttachments reports failed files by name",
  displaySrc.includes("failed.push(file.name)")
);
assert(
  "channel send surfaces upload failures via toast",
  currentSrc.includes('title: "Some files failed to upload"')
);
assert(
  "record-current send surfaces upload failures via toast",
  recordFeedSrc.includes('title: "Some files failed to upload"')
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`CURRENTS Attachments: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
