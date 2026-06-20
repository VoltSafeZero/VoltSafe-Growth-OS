"use strict";
/**
 * local-first-mark-read.test.cjs
 *
 * Source-grep tests verifying the local-first mark-read architecture:
 *   B1  – single-message: local writes (mirror + is_unread=false) happen BEFORE markMessageRead
 *   B2  – single-message: route returns 200 even when Gmail throws (local write committed)
 *   B3  – single-message: route returns non-200 ONLY when the local DB write fails
 *   B4  – single-message: gmailSynced field present in 200 response
 *   B5  – bulk fan-out: is_unread=false written for ALL ids (not gated on succeededIds)
 *   B6  – bulk single-account: local writes happen before getGmailClient
 *   B7  – mark-all-inbox-read: local writes happen before getGmailClient / batchModify
 *   B8  – mark-spam/not-spam invariant: is_unread is NOT written in mark-spam/not-spam routes
 *   FE1 – frontend: resp.ok branch calls invalidateBadgeQueries + removeUnread re-patch
 *   FE2 – frontend: resp.ok branch does NOT rollback (no restoreUnread in ok branch)
 *   FE3 – frontend: gmailSynced:false path — 200 means no rollback (resp.ok is the gate)
 *   FE4 – frontend: non-ok branch calls restoreUnread (rollback) on all four stores
 *   FE5 – frontend: non-ok branch does NOT call invalidateBadgeQueries
 *   FE6 – frontend: rollback guards against duplicate UNREAD (includes check before push)
 *   REG1 – flip-back fix: setQueriesData re-patch still in resp.ok branch
 *   REG2 – flip-back fix: broad invalidateQueries(["/api/gmail/messages"]) still absent
 *   REG3 – mark-read-derived-columns: is_unread=false write present in single mark-read route
 *   REG4 – mark-spam/not-spam: is_unread absent from spam routes (constraint preserved)
 */

const fs = require("fs");
const path = require("path");

const ROUTES = path.join(__dirname, "../server/routes.ts");
const INBOX  = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");

const routesSrc = fs.readFileSync(ROUTES, "utf8");
const inboxSrc  = fs.readFileSync(INBOX,  "utf8");

let passed = 0;
let failed = 0;

function check(id, description, condition) {
  if (condition) {
    console.log(`  ✓ ${id}: ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${id}: ${description}`);
    failed++;
  }
}

// ── Locate the single mark-read route block ────────────────────────────────
// We work on the section between the route registration and the next app.post
const markReadStart = routesSrc.indexOf("app.post(\"/api/gmail/messages/:id/mark-read\"");
const markReadEnd   = routesSrc.indexOf("app.post(\"/api/gmail/messages/:id/toggle-star\"");
const markReadBlock = routesSrc.slice(markReadStart, markReadEnd);

// ── Locate the bulk fan-out block ─────────────────────────────────────────
// Anchor on the bulk-mark-read route registration first, then find the fan-out
// block within it — avoids false positives from earlier rawAcc==="all" occurrences.
const bulkMarkReadRouteStart = routesSrc.indexOf("app.post(\"/api/gmail/bulk-mark-read\"");
const fanOutStart = routesSrc.indexOf("rawAcc === \"all\"", bulkMarkReadRouteStart);
const singleAccStart = routesSrc.indexOf("── Single-account path", bulkMarkReadRouteStart);
const fanOutBlock = routesSrc.slice(fanOutStart, singleAccStart);

// ── Locate bulk single-account block ──────────────────────────────────────
const singleAccEnd = routesSrc.indexOf("// ── Mark ALL unread inbox messages");
const singleAccBlock = routesSrc.slice(singleAccStart, singleAccEnd);

// ── Locate mark-all-inbox-read block ─────────────────────────────────────
const markAllStart = routesSrc.indexOf("app.post(\"/api/gmail/mark-all-inbox-read\"");
const markAllEnd   = routesSrc.indexOf("app.post(\"/api/gmail/bulk-archive\"");
const markAllBlock = routesSrc.slice(markAllStart, markAllEnd);

// ── Locate handleSelectMessage .then() block ──────────────────────────────
const thenStart = inboxSrc.indexOf(".then((resp) => {");
const catchLine = inboxSrc.indexOf(".catch(() => {/* network error", thenStart);
const thenBlock = inboxSrc.slice(thenStart, catchLine + 60);

console.log("\n── B1-B4: Single mark-read route — local-first ordering ──");

// B1: mirror + is_unread write appear BEFORE markMessageRead in the block
check("B1a", "mirrorLabelChangeForMessages appears before markMessageRead in mark-read route", (() => {
  const mirrorIdx   = markReadBlock.indexOf("mirrorLabelChangeForMessages");
  const gmailIdx    = markReadBlock.indexOf("await markMessageRead(");
  return mirrorIdx > 0 && gmailIdx > 0 && mirrorIdx < gmailIdx;
})());

check("B1b", "is_unread=false UPDATE appears before markMessageRead in mark-read route", (() => {
  const isUnreadIdx = markReadBlock.indexOf("SET is_unread = false");
  const gmailIdx    = markReadBlock.indexOf("await markMessageRead(");
  return isUnreadIdx > 0 && gmailIdx > 0 && isUnreadIdx < gmailIdx;
})());

// B2: Gmail failure is caught non-fatally after local write — returns json not 503
check("B2", "Gmail failure path uses console.error and does not 503 (non-fatal after local write)", (() => {
  const gmailCatch = markReadBlock.indexOf("Gmail API failed (non-fatal, local write committed)");
  return gmailCatch > 0 && !markReadBlock.includes("res.status(503)");
})());

// B3: non-200 returned only when is_unread write fails
check("B3", "res.status(500) returned only on is_unread write FAILED", (() => {
  return markReadBlock.includes("is_unread write FAILED") &&
         markReadBlock.includes("res.status(500)") &&
         !markReadBlock.includes("res.status(503)");
})());

// B4: gmailSynced in 200 response
check("B4", "res.json({ success: true, gmailSynced }) present in mark-read route", (() => {
  return markReadBlock.includes("gmailSynced") &&
         markReadBlock.includes("success: true, gmailSynced");
})());

console.log("\n── B5: Bulk fan-out — local writes for ALL ids ──");

// B5: local write for `ids` (not succeededIds) in fan-out block
check("B5a", "fan-out loop writes mirror before getGmailClient", (() => {
  const mirrorIdx = fanOutBlock.indexOf("mirrorLabelChangeForMessages(ids,");
  const gmailIdx  = fanOutBlock.indexOf("await getGmailClient(userId, accountId)");
  return mirrorIdx > 0 && gmailIdx > 0 && mirrorIdx < gmailIdx;
})());

check("B5b", "fan-out is_unread write uses ids (all), not succeededIds", (() => {
  // the idList build should reference `ids`, not `succeededIds`
  return fanOutBlock.includes("is_unread = false WHERE gmail_message_id IN") &&
         !fanOutBlock.includes("succeededIds");
})());

console.log("\n── B6: Bulk single-account — local writes before getGmailClient ──");

check("B6a", "single-account mirror write before getGmailClient", (() => {
  const mirrorIdx = singleAccBlock.indexOf("mirrorLabelChangeForMessages(messageIds");
  const gmailIdx  = singleAccBlock.indexOf("await getGmailClient(resolved.userId");
  return mirrorIdx > 0 && gmailIdx > 0 && mirrorIdx < gmailIdx;
})());

check("B6b", "single-account outer catch logs 'local writes committed' (no 503)", (() => {
  return singleAccBlock.includes("local writes committed") &&
         !singleAccBlock.includes("res.status(503)");
})());

console.log("\n── B7: mark-all-inbox-read — local writes before batchModify ──");

check("B7a", "mark-all mirror write appears before getGmailClient", (() => {
  const mirrorIdx = markAllBlock.indexOf("mirrorLabelChangeForMessages(ids,");
  const gmailIdx  = markAllBlock.indexOf("await getGmailClient(resolved.userId");
  return mirrorIdx > 0 && gmailIdx > 0 && mirrorIdx < gmailIdx;
})());

check("B7b", "mark-all is_unread write appears before batchModify", (() => {
  const isUnreadIdx = markAllBlock.indexOf("SET is_unread = false WHERE gmail_message_id IN");
  const batchIdx    = markAllBlock.indexOf("batchModify({");
  return isUnreadIdx > 0 && batchIdx > 0 && isUnreadIdx < batchIdx;
})());

check("B7c", "mark-all outer catch logs 'local writes committed' (no 503)", (() => {
  return markAllBlock.includes("local writes committed") &&
         !markAllBlock.includes("res.status(503)");
})());

console.log("\n── B8: mark-spam invariant — is_unread untouched ──");

// Spam block: from the not-spam route registration through the end of mark-spam route.
// End boundary is the single mark-read route — avoids picking up is_unread writes
// from the mark-read routes that follow.
const spamStart = routesSrc.indexOf("app.post(\"/api/inbox/threads/:threadId/not-spam\"");
const spamEnd   = routesSrc.indexOf("app.post(\"/api/gmail/messages/:id/mark-read\"");
const spamBlock = routesSrc.slice(spamStart, spamEnd);

check("B8", "mark-spam/not-spam block contains zero is_unread writes", (() => {
  return !spamBlock.includes("SET is_unread");
})());

console.log("\n── FE1-FE6: Frontend handleSelectMessage .then() ──");

// FE1: resp.ok branch has invalidateBadgeQueries
check("FE1a", "resp.ok branch calls invalidateBadgeQueries()", (() => {
  const okIdx    = thenBlock.indexOf("if (resp.ok)");
  const elseIdx  = thenBlock.indexOf("} else {");
  const badgeIdx = thenBlock.indexOf("invalidateBadgeQueries()");
  return okIdx >= 0 && elseIdx > okIdx && badgeIdx > okIdx && badgeIdx < elseIdx;
})());

// FE1: resp.ok branch re-applies removeUnread patches
check("FE1b", "resp.ok branch re-applies removeUnread to inbox and sent caches", (() => {
  const okIdx   = thenBlock.indexOf("if (resp.ok)");
  const elseIdx = thenBlock.indexOf("} else {");
  const okBranch = thenBlock.slice(okIdx, elseIdx);
  return okBranch.includes("setQueriesData") && okBranch.includes("removeUnread");
})());

// FE2: resp.ok branch does NOT contain restoreUnread
check("FE2", "resp.ok branch does NOT call restoreUnread (no rollback on 200)", (() => {
  const okIdx   = thenBlock.indexOf("if (resp.ok)");
  const elseIdx = thenBlock.indexOf("} else {");
  const okBranch = thenBlock.slice(okIdx, elseIdx);
  return !okBranch.includes("restoreUnread");
})());

// FE3: gate is resp.ok — Gmail failure (gmailSynced:false) returns 200, so no rollback
check("FE3", "rollback gate is resp.ok (200), not gmailSynced — Gmail-only failure never rolls back", (() => {
  // The outer condition must be `if (resp.ok)` — no inner check on gmailSynced for rollback
  const elseBranch = thenBlock.slice(thenBlock.indexOf("} else {"));
  return thenBlock.includes("if (resp.ok)") && !elseBranch.includes("gmailSynced");
})());

// FE4: else branch calls restoreUnread on all four stores
check("FE4a", "non-ok branch applies restoreUnread to inbox cache", (() => {
  const elseIdx = thenBlock.indexOf("} else {");
  const elseBranch = thenBlock.slice(elseIdx);
  return elseBranch.includes("restoreUnread") && elseBranch.includes("\"inbox\"");
})());

check("FE4b", "non-ok branch applies restoreUnread to sent cache", (() => {
  const elseIdx = thenBlock.indexOf("} else {");
  const elseBranch = thenBlock.slice(elseIdx);
  return elseBranch.includes("restoreUnread") && elseBranch.includes("\"sent\"");
})());

check("FE4c", "non-ok branch updates setInboxExtra with restoreUnread", (() => {
  const elseIdx = thenBlock.indexOf("} else {");
  const elseBranch = thenBlock.slice(elseIdx);
  return elseBranch.includes("setInboxExtra");
})());

check("FE4d", "non-ok branch updates setSentExtra with restoreUnread", (() => {
  const elseIdx = thenBlock.indexOf("} else {");
  const elseBranch = thenBlock.slice(elseIdx);
  return elseBranch.includes("setSentExtra");
})());

// FE5: else branch does NOT call invalidateBadgeQueries
check("FE5", "non-ok branch does NOT call invalidateBadgeQueries (DB unchanged)", (() => {
  const elseIdx = thenBlock.indexOf("} else {");
  const elseBranch = thenBlock.slice(elseIdx);
  return !elseBranch.includes("invalidateBadgeQueries");
})());

// FE6: duplicate UNREAD guard — !m.labelIds.includes("UNREAD") before push
check("FE6", "rollback restoreUnread guards against duplicate UNREAD with !includes check", (() => {
  return thenBlock.includes("!m.labelIds.includes(\"UNREAD\")");
})());

console.log("\n── REG1-REG4: Regressions ──");

// REG1: setQueriesData re-patch still in resp.ok branch (flip-back fix preserved)
check("REG1", "setQueriesData removeUnread re-patch present in resp.ok branch (flip-back fix preserved)", (() => {
  const okIdx   = thenBlock.indexOf("if (resp.ok)");
  const elseIdx = thenBlock.indexOf("} else {");
  const okBranch = thenBlock.slice(okIdx, elseIdx);
  return okBranch.includes("setQueriesData") && okBranch.includes("removeUnread");
})());

// REG2: broad invalidateQueries on message list still absent
check("REG2", "broad invalidateQueries(['/api/gmail/messages']) absent from .then() block (flip-back fix intact)", (() => {
  return !thenBlock.includes("invalidateQueries({ queryKey: [\"/api/gmail/messages\"] })");
})());

// REG3: is_unread=false write still present in single mark-read route
check("REG3", "is_unread=false UPDATE present in single mark-read route", (() => {
  return markReadBlock.includes("SET is_unread = false WHERE gmail_message_id");
})());

// REG4: mark-spam is_unread invariant (Commit 1)
check("REG4", "mark-spam block contains no SET is_unread writes (Commit 1 invariant)", (() => {
  return !spamBlock.includes("SET is_unread");
})());

console.log("\n────────────────────────────────────────────────────────────");
console.log(`local-first-mark-read: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
console.log("────────────────────────────────────────────────────────────\n");

if (failed > 0) process.exit(1);
