/**
 * Phase 8B — DM Attachment Tests (audit pass)
 *
 * Source-grep tests that verify the DM composer attachment system is correctly
 * wired in current.tsx, that security guards are in place on the backend, and
 * that existing channel/record attachment paths are untouched.
 */

const fs = require("fs");
const path = require("path");

const CURRENT_TSX = path.join(__dirname, "../client/src/pages/current.tsx");
const ATTACHMENT_DISPLAY = path.join(
  __dirname,
  "../client/src/components/current/current-attachment-display.tsx"
);
const ROUTES = path.join(__dirname, "../server/routes.ts");

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
const routesSrc = readFile(ROUTES);

console.log("\n── Phase 8B DM Attachment Tests (audit pass) ─────────────────\n");

// ── 1. Imports ──────────────────────────────────────────────────────────────
console.log("1. Imports");
assertContains("uploadCurrentAttachments imported", src, "uploadCurrentAttachments");
assertContains("PendingFileChips imported", src, "PendingFileChips");
assertContains("CurrentAttachmentChips imported", src, "CurrentAttachmentChips");

// ── 2. DM attachment state ───────────────────────────────────────────────────
console.log("\n2. DM attachment state");
assertContains("dmPendingFiles state declared", src, /useState<File\[\]>\(\[\]\)/);
assertContains("dmFileInputRef declared", src, /dmFileInputRef\s*=\s*useRef<HTMLInputElement/);
assertContains("isDmUploading state declared", src, /isDmUploading.*useState.*false/);

// ── 3. DM composer paperclip button ─────────────────────────────────────────
console.log("\n3. DM composer paperclip");
assertContains("btn-attach-dm testid present", src, 'data-testid="btn-attach-dm"');
assertContains("dmFileInputRef click triggered on paperclip", src, "dmFileInputRef.current?.click()");
assertContains("Paperclip icon in DM composer", src, /<Paperclip[^/]*\/>/);

// ── 4. Hidden file input ──────────────────────────────────────────────────────
console.log("\n4. Hidden file input");
assertContains("dm-file-input testid present", src, 'data-testid="dm-file-input"');
assertContains(
  "file input is multiple",
  src,
  /multiple[\s\S]{0,200}data-testid="dm-file-input"|data-testid="dm-file-input"[\s\S]{0,200}multiple/
);
assertContains("file input appends to dmPendingFiles", src, "setDmPendingFiles((prev) => [...prev, ...files])");
assertContains("file input value reset after selection", src, /dm-file-input[\s\S]{0,300}e\.target\.value = ""/);

// ── 5. PendingFileChips rendered in DM composer ──────────────────────────────
console.log("\n5. Pending chips");
assertContains(
  "PendingFileChips rendered when dmPendingFiles.length > 0",
  src,
  /dmPendingFiles\.length > 0[\s\S]{0,300}PendingFileChips/
);
assertContains("onRemove wired to setDmPendingFiles filter", src, /setDmPendingFiles\(\(prev\) => prev\.filter/);

// ── 6. handleDmSend upload flow ───────────────────────────────────────────────
console.log("\n6. Upload flow");
assertContains("handleDmSend: body required guard", src, /!trimmed.*dmPostMutation\.isPending.*isDmUploading/);
assertContains("handleDmSend awaits dmPostMutation.mutateAsync", src, "await dmPostMutation.mutateAsync");
assertContains("files snapshot taken from dmPendingFiles", src, "[...dmPendingFiles]");
assertContains("setDmPendingFiles([]) called after snapshot", src, "setDmPendingFiles([]);");
assertContains("uploadCurrentAttachments called with newMsg.id", src, /uploadCurrentAttachments\(Number\(newMsg\.id\),\s*files\)/);
assertContains("isDmUploading set true before upload", src, "setIsDmUploading(true)");
assertContains("isDmUploading reset in finally block", src, /finally\s*\{[\s\S]{0,100}setIsDmUploading\(false\)/);
assertContains("DM messages query invalidated after send", src, /invalidateQueries.*current\/dms.*messages/);
assertContains("DM list query invalidated after send", src, /invalidateQueries.*current\/dms/);

// ── 7. Attachment-only behavior ───────────────────────────────────────────────
console.log("\n7. Attachment-only behavior");
assertContains(
  "send blocked when no body text (body required)",
  src,
  /!trimmed.*dmPostMutation\.isPending|!dmDraft\.trim\(\).*dmPostMutation/
);
assertNotContains(
  "no zero-width space hack for attachment-only",
  src,
  "\\u200b"
);

// ── 8. Failure toast ─────────────────────────────────────────────────────────
console.log("\n8. Failure handling");
assertContains("failure toast shown when result.failed.length > 0", src, /result\.failed\.length > 0[\s\S]{0,400}toast/);
assertContains("toast title contains 'failed'", src, /title.*failed/i);
assertContains("toast variant is destructive", src, 'variant: "destructive"');
assertContains("failed filenames listed in toast description", src, /result\.failed\.join/);

// ── 9. Send button state ─────────────────────────────────────────────────────
console.log("\n9. Send button state");
assertContains("dm-send-btn testid present", src, 'data-testid="dm-send-btn"');
assertContains(
  "send button disabled when isDmUploading",
  src,
  /isDmUploading[\s\S]{0,100}dm-send-btn|dm-send-btn[\s\S]{0,300}isDmUploading/
);
assertContains("send button shows spinner during upload", src, /isDmUploading[\s\S]{0,200}animate-spin/);

// ── 10. Attachment display on DM messages ─────────────────────────────────────
console.log("\n10. Attachment display");
assertContains(
  "CurrentAttachmentChips renders message.attachments in MessageRow",
  src,
  /CurrentAttachmentChips\s+attachments=\{message\.attachments/
);

// ── 11. uploadCurrentAttachments function ─────────────────────────────────────
console.log("\n11. Upload helper");
assertContains("sends objectType=current_message", attachSrc, 'fd.append("objectType", "current_message")');
assertContains("sends objectId=messageId", attachSrc, 'fd.append("objectId", String(messageId))');
assertContains("UploadResult has succeeded and failed", attachSrc, "succeeded: files.length - failed.length");
assertNotContains("no duplicate upload helper in current.tsx", src, /async function uploadCurrentAttachments/);

// ── 12. Channel Currents attachment paths untouched ───────────────────────────
console.log("\n12. Channel attachment paths (regression)");
assertContains("mainPendingFiles still used", src, "mainPendingFiles");
assertContains("mainFileInputRef still used", src, "mainFileInputRef");
assertContains("btn-attach-channel testid still present", src, 'data-testid="btn-attach-channel"');
assertContains("channel-file-input testid still present", src, 'data-testid="channel-file-input"');

// ── 13. Backend: /api/attachments allows current_message ─────────────────────
console.log("\n13. Backend: allowedTypes");
assertContains('/api/attachments allowedTypes includes "current_message"', routesSrc, '"current_message"');

// ── 14. Backend: DM GET route returns attachments ────────────────────────────
console.log("\n14. Backend: DM GET returns attachments");
assertContains(
  "DM messages GET route includes msg_attachments lateral join",
  routesSrc,
  /dms.*messages[\s\S]{0,2000}msg_attachments|msg_attachments[\s\S]{0,2000}dms/
);
assertContains(
  "DM GET: deleted messages have attachments redacted ([])",
  routesSrc,
  /deleted_at IS NOT NULL THEN '\[\]'::json[\s\S]{0,200}msg_attachments|CASE WHEN m\.deleted_at IS NOT NULL THEN '\[\]'::json/
);

// ── 15. Security: DM GET membership check ────────────────────────────────────
console.log("\n15. Security: DM GET membership guard");
assertContains(
  "DM GET: membership check on current_conversation_members",
  routesSrc,
  /dms\/:id\/messages[\s\S]{0,500}current_conversation_members[\s\S]{0,500}user_id = \$\{userId\}/
);

// ── 16. Security: POST /api/attachments DM ownership guard ───────────────────
console.log("\n16. Security: POST /api/attachments ownership guard");
assertContains(
  "DM ownership guard present for current_message upload",
  routesSrc,
  "Cannot attach files to another user's message"
);
assertContains(
  "guard queries current_messages for user_id",
  routesSrc,
  /SELECT user_id FROM current_messages WHERE id = \$\{Number\(objectId\)\}/
);
assertContains(
  "guard compares message user_id to uploading user",
  routesSrc,
  /Number\(msgRow\.user_id\) !== uploadUserId/
);
assertContains(
  "guard cleans up disk files on 403",
  routesSrc,
  /Cannot attach files to another user.*message[\s\S]{0,200}fs\.unlinkSync|fs\.unlinkSync[\s\S]{0,200}Cannot attach files/
);

// ── 17. Security: GET /api/attachments DM membership guard ───────────────────
console.log("\n17. Security: GET /api/attachments membership guard");
assertContains(
  "GET attachments: DM membership guard for current_message",
  routesSrc,
  /current_message[\s\S]{0,500}current_conversation_members[\s\S]{0,200}Not authorized/
);
assertContains(
  "GET attachments: looks up conversation_id from current_messages",
  routesSrc,
  /SELECT conversation_id[\w\s,]* FROM current_messages WHERE id = \$\{Number\(objectId\)\}/
);

// ── 18. Security: file download DM membership guard ──────────────────────────
console.log("\n18. Security: file download DM membership guard");
assertContains(
  "file download: DM membership guard on current_message attachments",
  routesSrc,
  /row\.object_type === ["']current_message["'][\s\S]{0,500}current_conversation_members/
);
assertContains(
  "file download: queries current_messages for conversation_id",
  routesSrc,
  /SELECT conversation_id FROM current_messages WHERE id = \$\{Number\(row\.object_id\)\}/
);
assertContains(
  "file download: returns opaque 404 on DM non-membership",
  routesSrc,
  /current_conversation_members[\s\S]{0,300}opaque404/
);

// ── 19. Enter/Shift+Enter behavior preserved ─────────────────────────────────
console.log("\n19. Keyboard behavior");
assertContains(
  "Enter key calls handleDmSend",
  src,
  /handleDmKeyDown[\s\S]{0,700}handleDmSend/
);
assertContains(
  "Shift+Enter does not call handleDmSend",
  src,
  /!e\.shiftKey[\s\S]{0,100}handleDmSend|handleDmSend[\s\S]{0,200}!e\.shiftKey/
);

// ── 20. Emoji picker and mention preserved ────────────────────────────────────
console.log("\n20. Emoji picker & @mention preserved");
assertContains("EmojiPickerPopover in DM composer", src, /EmojiPickerPopover[\s\S]{0,2000}dm-send-btn/);
assertContains("dmMention.open used in DM composer", src, "dmMention.open");

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passes} passed, ${failures} failed ────────────────────────────\n`);
if (failures > 0) process.exit(1);
