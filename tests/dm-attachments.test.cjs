/**
 * Phase 8B — DM Attachment Tests
 *
 * Source-grep tests that verify the DM composer attachment system is correctly
 * wired in current.tsx and that existing channel/record attachment paths are
 * untouched. No network calls needed.
 */

const fs = require("fs");
const path = require("path");

const CURRENT_TSX = path.join(__dirname, "../client/src/pages/current.tsx");
const ATTACHMENT_DISPLAY = path.join(
  __dirname,
  "../client/src/components/current/current-attachment-display.tsx"
);

function readFile(p) {
  return fs.readFileSync(p, "utf8");
}

let passes = 0;
let failures = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passes++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failures++;
  }
}

function assertContains(label, src, pattern) {
  const ok =
    pattern instanceof RegExp ? pattern.test(src) : src.includes(pattern);
  assert(label, ok);
}

function assertNotContains(label, src, pattern) {
  const ok =
    pattern instanceof RegExp ? !pattern.test(src) : !src.includes(pattern);
  assert(label, ok);
}

const src = readFile(CURRENT_TSX);
const attachSrc = readFile(ATTACHMENT_DISPLAY);

console.log("\n── Phase 8B DM Attachment Tests ──────────────────────────────\n");

// ── 1. Imports ──────────────────────────────────────────────────────────────
console.log("1. Imports");
assertContains(
  "uploadCurrentAttachments imported in current.tsx",
  src,
  "uploadCurrentAttachments"
);
assertContains(
  "PendingFileChips imported in current.tsx",
  src,
  "PendingFileChips"
);
assertContains(
  "CurrentAttachmentChips imported in current.tsx",
  src,
  "CurrentAttachmentChips"
);

// ── 2. DM attachment state ───────────────────────────────────────────────────
console.log("\n2. DM attachment state");
assertContains(
  "dmPendingFiles state declared",
  src,
  /useState<File\[\]>\(\[\]\)/
);
assertContains(
  "dmFileInputRef declared",
  src,
  /dmFileInputRef\s*=\s*useRef<HTMLInputElement/
);
assertContains(
  "isDmUploading state declared",
  src,
  /isDmUploading.*useState.*false/
);

// ── 3. DM composer paperclip button ─────────────────────────────────────────
console.log("\n3. DM composer paperclip");
assertContains(
  "btn-attach-dm testid present",
  src,
  'data-testid="btn-attach-dm"'
);
assertContains(
  "dmFileInputRef click triggered on paperclip",
  src,
  "dmFileInputRef.current?.click()"
);
assertContains(
  "Paperclip icon in DM composer",
  src,
  /<Paperclip[^/]*\/>/
);

// ── 4. Hidden file input ──────────────────────────────────────────────────────
console.log("\n4. Hidden file input");
assertContains(
  "dm-file-input testid present",
  src,
  'data-testid="dm-file-input"'
);
assertContains(
  "file input is multiple",
  src,
  /multiple[\s\S]{0,200}data-testid="dm-file-input"|data-testid="dm-file-input"[\s\S]{0,200}multiple/
);
assertContains(
  "file input adds to dmPendingFiles",
  src,
  "setDmPendingFiles((prev) => [...prev, ...files])"
);

// ── 5. PendingFileChips rendered in DM composer ──────────────────────────────
console.log("\n5. Pending chips");
assertContains(
  "PendingFileChips rendered when dmPendingFiles > 0",
  src,
  /dmPendingFiles\.length > 0[\s\S]{0,300}PendingFileChips/
);
assertContains(
  "onRemove wired to setDmPendingFiles filter",
  src,
  /setDmPendingFiles\(\(prev\) => prev\.filter/
);

// ── 6. handleDmSend upload flow ───────────────────────────────────────────────
console.log("\n6. Upload flow");
assertContains(
  "handleDmSend awaits dmPostMutation.mutateAsync",
  src,
  "await dmPostMutation.mutateAsync"
);
assertContains(
  "files snapshot taken from dmPendingFiles",
  src,
  "[...dmPendingFiles]"
);
assertContains(
  "setDmPendingFiles([]) called after snapshot",
  src,
  "setDmPendingFiles([]);"
);
assertContains(
  "uploadCurrentAttachments called with newMsg.id",
  src,
  /uploadCurrentAttachments\(Number\(newMsg\.id\),\s*files\)/
);
assertContains(
  "isDmUploading set true before upload",
  src,
  "setIsDmUploading(true)"
);
assertContains(
  "isDmUploading reset in finally block",
  src,
  /finally\s*\{[\s\S]{0,100}setIsDmUploading\(false\)/
);

// ── 7. Failure toast ─────────────────────────────────────────────────────────
console.log("\n7. Failure handling");
assertContains(
  "failure toast shown when result.failed.length > 0",
  src,
  /result\.failed\.length > 0[\s\S]{0,400}toast/
);
assertContains(
  "toast title contains 'failed'",
  src,
  /title.*failed/i
);
assertContains(
  "toast variant is destructive",
  src,
  'variant: "destructive"'
);

// ── 8. Send button state ─────────────────────────────────────────────────────
console.log("\n8. Send button state");
assertContains(
  "dm-send-btn testid present",
  src,
  'data-testid="dm-send-btn"'
);
assertContains(
  "send button disabled when isDmUploading",
  src,
  /isDmUploading[\s\S]{0,100}dm-send-btn|dm-send-btn[\s\S]{0,200}isDmUploading/
);
assertContains(
  "send button shows spinner during upload",
  src,
  /isDmUploading[\s\S]{0,200}animate-spin/
);

// ── 9. Attachment display on DM messages ──────────────────────────────────────
console.log("\n9. Attachment display");
assertContains(
  "CurrentAttachmentChips renders message.attachments in MessageRow",
  src,
  /CurrentAttachmentChips\s+attachments=\{message\.attachments/
);

// ── 10. uploadCurrentAttachments uses current_message objectType ──────────────
console.log("\n10. Upload route objectType");
assertContains(
  "uploadCurrentAttachments sends objectType=current_message",
  attachSrc,
  'fd.append("objectType", "current_message")'
);
assertContains(
  "uploadCurrentAttachments sends objectId=messageId",
  attachSrc,
  'fd.append("objectId", String(messageId))'
);

// ── 11. Query invalidation after DM send/upload ───────────────────────────────
console.log("\n11. Query invalidation");
assertContains(
  "invalidates dms messages queryKey",
  src,
  /invalidateQueries.*current\/dms.*messages/
);
assertContains(
  "invalidates dms list queryKey",
  src,
  /invalidateQueries.*current\/dms/
);

// ── 12. Channel Currents attachment paths untouched ───────────────────────────
console.log("\n12. Channel attachment paths");
assertContains(
  "mainPendingFiles still used in channel composer",
  src,
  "mainPendingFiles"
);
assertContains(
  "mainFileInputRef still used in channel composer",
  src,
  "mainFileInputRef"
);
assertContains(
  "btn-attach-channel testid still present",
  src,
  'data-testid="btn-attach-channel"'
);
assertContains(
  "channel-file-input testid still present",
  src,
  'data-testid="channel-file-input"'
);

// ── 13. /api/attachments allows current_message objectType ───────────────────
console.log("\n13. Backend allows current_message");
const ROUTES = path.join(__dirname, "../server/routes.ts");
const routesSrc = fs.readFileSync(ROUTES, "utf8");
assertContains(
  "/api/attachments allowedTypes includes current_message",
  routesSrc,
  '"current_message"'
);

// ── 14. DM message GET route includes attachments ────────────────────────────
console.log("\n14. DM GET route returns attachments");
assertContains(
  "DM message GET route includes msg_attachments lateral",
  routesSrc,
  /dms.*messages[\s\S]{0,2000}msg_attachments|msg_attachments[\s\S]{0,2000}dms/
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passes} passed, ${failures} failed ──────────────────────────\n`);
if (failures > 0) process.exit(1);
