/**
 * Phase 8C — Attachment-Only DM Tests
 *
 * Source-grep tests verifying:
 * - Frontend allows send when files pending but no text
 * - hasPendingAttachments flag sent to backend
 * - Backend allows empty body only when hasPendingAttachments is true
 * - Backend rejects truly empty send (no body, no flag)
 * - Notification preview handles null body
 * - Sidebar preview handles null body
 * - Phase 8B security guards still intact
 * - No regressions in channel/record attachment paths
 */

const fs = require("fs");
const path = require("path");

const CURRENT_TSX = path.join(__dirname, "../client/src/pages/current.tsx");
const ROUTES = path.join(__dirname, "../server/routes.ts");

const src = fs.readFileSync(CURRENT_TSX, "utf8");
const routesSrc = fs.readFileSync(ROUTES, "utf8");

let passes = 0;
let failures = 0;

function assert(label, ok) {
  if (ok) { console.log(`  ✓ ${label}`); passes++; }
  else     { console.error(`  ✗ FAIL: ${label}`); failures++; }
}
function has(label, text, pattern) {
  assert(label, pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern));
}
function hasNot(label, text, pattern) {
  assert(label, pattern instanceof RegExp ? !pattern.test(text) : !text.includes(pattern));
}

console.log("\n── Phase 8C DM Attachment-Only Tests ────────────────────────\n");

// ── 1. Frontend guard allows attachment-only ──────────────────────────────────
console.log("1. Frontend send guard (attachment-only)");
has(
  "send guard allows send when hasFiles even without trimmed text",
  src,
  /!trimmed && !hasFiles.*dmPostMutation|dmPendingFiles\.length === 0.*dmPostMutation/
);
has(
  "hasFiles derived from dmPendingFiles.length > 0",
  src,
  /hasFiles.*dmPendingFiles\.length > 0|dmPendingFiles\.length > 0.*hasFiles/
);
has(
  "guard blocks send only when both no text AND no files",
  src,
  /!trimmed && !hasFiles|!dmDraft\.trim\(\) && dmPendingFiles\.length === 0/
);
hasNot(
  "guard no longer blocks on !trimmed alone",
  src,
  /if \(!trimmed \|\| dmPostMutation\.isPending/
);

// ── 2. hasPendingAttachments flag sent to backend ────────────────────────────
console.log("\n2. hasPendingAttachments flag");
has(
  "dmPostMutation mutationFn accepts hasPendingAttachments param",
  src,
  /hasPendingAttachments.*boolean|hasPendingAttachments: boolean/
);
has(
  "mutationFn sends hasPendingAttachments in request body",
  src,
  /apiRequest.*dms.*messages.*hasPendingAttachments/s.test ? /apiRequest[\s\S]{0,200}hasPendingAttachments/ : /hasPendingAttachments/
);
has(
  "handleDmSend passes hasPendingAttachments: hasFiles",
  src,
  /hasPendingAttachments:\s*hasFiles/
);

// ── 3. Send button state ──────────────────────────────────────────────────────
console.log("\n3. Send button enabled with files");
has(
  "send button disabled only when no text AND no pending files",
  src,
  /!dmDraft\.trim\(\) && dmPendingFiles\.length === 0/
);
has(
  "send button active class includes dmPendingFiles.length > 0",
  src,
  /dmPendingFiles\.length > 0[\s\S]{0,80}bg-primary|bg-primary[\s\S]{0,200}dmPendingFiles\.length > 0/
);

// ── 4. Placeholder updated ────────────────────────────────────────────────────
console.log("\n4. Placeholder");
has(
  "placeholder says 'Write a message or attach files'",
  src,
  "Write a message or attach files"
);
hasNot(
  "old context-dependent placeholder removed",
  src,
  /Message.*teammate.*optional/
);

// ── 5. Sidebar preview handles null/empty body ────────────────────────────────
console.log("\n5. Sidebar preview");
has(
  "sidebar shows Attachment fallback when body is null/empty",
  src,
  /dm\.lastMessage\.body[\s\S]{0,100}📎 Attachment|Attachment[\s\S]{0,100}dm\.lastMessage/
);

// ── 6. Backend: hasPendingAttachments in DM POST route ───────────────────────
console.log("\n6. Backend: hasPendingAttachments guard");
has(
  "backend reads hasPendingAttachments from req.body",
  routesSrc,
  "const hasPendingAttachments = req.body?.hasPendingAttachments === true"
);
has(
  "backend allows empty body when hasPendingAttachments is true",
  routesSrc,
  /!rawBody && !hasPendingAttachments/
);
has(
  "backend rejects truly empty send (no body, no flag)",
  routesSrc,
  "Message body is required"
);
has(
  "DM POST route uses rawBody + hasPendingAttachments (not old body guard)",
  routesSrc,
  /const rawBody = String[\s\S]{0,200}const hasPendingAttachments = req\.body\?\.hasPendingAttachments/
);

// ── 7. Backend: null body stored as NULL not empty string ─────────────────────
console.log("\n7. Backend: NULL body storage");
has(
  "bodyFragment uses NULL when rawBody is empty",
  routesSrc,
  /bodyFragment.*rawBody.*NULL|rawBody.*bodyFragment.*NULL/
);
has(
  "INSERT uses bodyFragment variable",
  routesSrc,
  /VALUES \(\$\{convId\}, \$\{userId\}, \$\{bodyFragment\}\)/
);

// ── 8. Backend: notification preview handles null body ────────────────────────
console.log("\n8. Backend: notification preview");
has(
  "preview uses 'Sent an attachment' when rawBody is empty",
  routesSrc,
  "'Sent an attachment'"
);
has(
  "preview is conditional on rawBody",
  routesSrc,
  /rawBody[\s\S]{0,100}Sent an attachment/
);

// ── 9. Empty message truly blocked ───────────────────────────────────────────
console.log("\n9. Empty message blocked");
has(
  "frontend blocks send with no text and no files",
  src,
  /!trimmed && !hasFiles|!dmDraft\.trim\(\) && dmPendingFiles\.length === 0/
);
has(
  "backend blocks send with no body and no hasPendingAttachments",
  routesSrc,
  /!rawBody && !hasPendingAttachments[\s\S]{0,100}Message body is required/
);

// ── 10. Upload flow still correct after send ──────────────────────────────────
console.log("\n10. Upload flow integrity");
has("files still snapshot and cleared", src, "setDmPendingFiles([]);");
has(
  "uploadCurrentAttachments still called with newMsg.id",
  src,
  /uploadCurrentAttachments\(Number\(newMsg\.id\)/
);
has(
  "isDmUploading still wraps upload",
  src,
  /setIsDmUploading\(true\)[\s\S]{0,800}setIsDmUploading\(false\)/
);

// ── 11. Phase 8B security guards still intact ──────────────────────────────────
console.log("\n11. Phase 8B security guards");
has(
  "POST attachments: DM ownership guard still present",
  routesSrc,
  "Cannot attach files to another user's message"
);
has(
  "GET attachments: DM membership guard still present",
  routesSrc,
  /SELECT conversation_id[\w\s,]* FROM current_messages WHERE id = \$\{Number\(objectId\)\}/
);
has(
  "file download: DM membership guard still present",
  routesSrc,
  /SELECT conversation_id[\w\s,]* FROM current_messages WHERE id = \$\{Number\(row\.object_id\)\}/
);
has(
  "DM GET messages: membership check still present",
  routesSrc,
  /dms\/:id\/messages[\s\S]{0,500}current_conversation_members[\s\S]{0,500}user_id = \$\{userId\}/
);

// ── 12. Display polish: null-body rendering ───────────────────────────────────
console.log("\n12. Display polish: null-body rendering");
has(
  "message.body guards the <p> wrapper (no empty paragraph for null body)",
  src,
  /message\.body &&[\s\S]{0,40}<p className/
);
has(
  "MessageActionBar accepts hasBody prop",
  src,
  "hasBody?: boolean"
);
has(
  "canEdit gated on hasBody !== false",
  src,
  /canEdit = isOwn && \(hasBody !== false\)/
);
has(
  "MessageRow passes hasBody={!!message.body} to MessageActionBar",
  src,
  "hasBody={!!message.body}"
);

// ── 13. No regressions in channel attachments ─────────────────────────────────
console.log("\n13. Channel attachment regression");
has("mainPendingFiles still present", src, "mainPendingFiles");
has("btn-attach-channel testid still present", src, 'data-testid="btn-attach-channel"');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passes} passed, ${failures} failed ────────────────────────────\n`);
if (failures > 0) process.exit(1);
