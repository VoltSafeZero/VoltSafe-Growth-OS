"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function ok(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const inboxSrc  = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");

// ── 1. Backend — backfill endpoint registered ─────────────────────────────────
console.log("[1] Backend — backfill endpoint registered");
ok("POST /api/gmail/threads/:id/backfill route registered",
  routesSrc.includes('app.post("/api/gmail/threads/:id/backfill"'));
ok("Backfill endpoint requires auth",
  routesSrc.includes('app.post("/api/gmail/threads/:id/backfill", requireAuth'));
ok("Backfill endpoint accepts asAccountId query param",
  routesSrc.includes("asAccountId") &&
  routesSrc.includes('app.post("/api/gmail/threads/:id/backfill"'));
ok("Backfill endpoint uses resolveAccount",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes("resolveAccount");
  })());
ok("Backfill endpoint has orphan fallback (getUserGmailAccount)",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes("getUserGmailAccount");
  })());

// ── 2. Backend — Gmail fetch + upsert logic ────────────────────────────────────
console.log("\n[2] Backend — Gmail fetch + upsert logic");
ok("Backfill endpoint imports getGmailClient",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes("getGmailClient");
  })());
ok("Backfill endpoint imports upsertMessageById",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes("upsertMessageById");
  })());
ok("Backfill endpoint imports getLocalThread",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes("getLocalThread");
  })());
ok("Backfill uses gmail.users.threads.get with metadata format",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes("threads.get") && snippet.includes('"metadata"');
  })());
ok("Backfill loops over messages and calls upsertMessageById",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes("upsertMessageById") && snippet.includes("for (const msg of messages)");
  })());
ok("Backfill calls getLocalThread after upsert",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    const upsertPos = snippet.indexOf("upsertMessageById");
    const localPos  = snippet.indexOf("getLocalThread");
    return upsertPos !== -1 && localPos > upsertPos;
  })());
ok("Backfill returns 404 when thread still missing after upsert",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes("404") && snippet.includes("could not be indexed locally");
  })());
ok("Backfill returns 404 on Gmail 404 (thread deleted/moved)",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes("not found in Gmail");
  })());
ok("Backfill sets X-Mail-Source: backfilled header",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes('"X-Mail-Source"') && snippet.includes('"backfilled"');
  })());
ok("Backfill includes diagnostic log (no body)",
  (() => {
    const idx = routesSrc.indexOf('app.post("/api/gmail/threads/:id/backfill"');
    const snippet = routesSrc.slice(idx, idx + 4000);
    return snippet.includes("[crm-backfill]");
  })());

// ── 3. Backend — review queue includes gmailMessageId ─────────────────────────
console.log("\n[3] Backend — review queue includes gmailMessageId");
ok("Review queue latestMsg select includes gmailMessageId",
  (() => {
    const idx = routesSrc.indexOf('app.get("/api/gmail/review-queue"');
    const snippet = routesSrc.slice(idx, idx + 6000);
    return snippet.includes("gmailMessageId: emailMessages.gmailMessageId");
  })());
ok("hasBody and sourceAccountId are stripped but gmailMessageId is kept",
  (() => {
    const idx = routesSrc.indexOf('app.get("/api/gmail/review-queue"');
    const snippet = routesSrc.slice(idx, idx + 6000);
    return snippet.includes("hasBody: _hb") &&
           snippet.includes("sourceAccountId: _srcAcct") &&
           !snippet.includes("gmailMessageId: _");
  })());

// ── 4. Frontend — ReviewQueueItem type updated ────────────────────────────────
console.log("\n[4] Frontend — ReviewQueueItem type");
ok("ReviewQueueItem.latestMessage has gmailMessageId field",
  inboxSrc.includes("gmailMessageId: string | null;") &&
  (() => {
    const typeIdx = inboxSrc.indexOf("type ReviewQueueItem = {");
    const block = inboxSrc.slice(typeIdx, typeIdx + 600);
    return block.includes("gmailMessageId: string | null;");
  })());

// ── 5. Frontend — backfill tracking state/refs ───────────────────────────────
console.log("\n[5] Frontend — backfill tracking state");
ok("crmBackfillAttemptedRef declared as useRef<Set<string>>",
  inboxSrc.includes("const crmBackfillAttemptedRef = useRef<Set<string>>(new Set())"));
ok("crmBackfillingThreadId state declared",
  inboxSrc.includes("const [crmBackfillingThreadId, setCrmBackfillingThreadId] = useState<string | null>(null)"));
ok("crmBackfillFailedThreadId state declared",
  inboxSrc.includes("const [crmBackfillFailedThreadId, setCrmBackfillFailedThreadId] = useState<string | null>(null)"));

// ── 6. Frontend — auto-backfill effect ───────────────────────────────────────
// Anchor: "[crm-backfill] starting" lives inside the fetch call in the effect,
// far below the ref declaration. Use it so the snippet captures the whole effect.
console.log("\n[6] Frontend — auto-backfill effect");
function backfillEffectSnippet() {
  const idx = inboxSrc.indexOf('"[crm-backfill] starting"');
  return inboxSrc.slice(Math.max(0, idx - 1500), idx + 1500);
}
ok("Effect checks threadQuery.isError",
  backfillEffectSnippet().includes("threadQuery.isError"));
ok("Effect checks for 'not in local index' error message",
  backfillEffectSnippet().includes("not in local index"));
ok("Effect checks if thread is in review queue",
  backfillEffectSnippet().includes("reviewQueueQuery.data?.items?.find"));
ok("Effect guards against double-fire using ref",
  backfillEffectSnippet().includes("crmBackfillAttemptedRef.current.has(selectedThreadId)"));
ok("Effect calls POST /api/gmail/threads/:id/backfill",
  backfillEffectSnippet().includes("/backfill") && backfillEffectSnippet().includes('method: "POST"'));
ok("Effect includes backfillAccountId from review item",
  backfillEffectSnippet().includes("backfillAccountId") && backfillEffectSnippet().includes("gmailAccountId"));
ok("Effect calls threadQuery.refetch() on success",
  backfillEffectSnippet().includes("threadQuery.refetch()"));
ok("Effect sets crmBackfillFailedThreadId on fetch failure",
  backfillEffectSnippet().includes("setCrmBackfillFailedThreadId(selectedThreadId)"));

// ── 7. Frontend — header error display ───────────────────────────────────────
console.log("\n[7] Frontend — header error display (smart states)");
ok("Header shows 'Syncing from Gmail' when backfilling",
  inboxSrc.includes("Syncing from Gmail") &&
  inboxSrc.includes('data-testid="thread-load-syncing"'));
ok("Header shows 'Thread unavailable' when backfill failed",
  inboxSrc.includes("Thread unavailable"));
ok("Header still shows original Retry for non-review-queue errors",
  inboxSrc.includes('data-testid="button-retry-thread"'));

// ── 8. Frontend — body error card ─────────────────────────────────────────────
console.log("\n[8] Frontend — body error card");
ok("Body error card has data-testid thread-backfill-error",
  inboxSrc.includes('data-testid="thread-backfill-error"'));
ok("Body syncing spinner has data-testid thread-backfill-syncing",
  inboxSrc.includes('data-testid="thread-backfill-syncing"'));
ok("Body error card shows 'This email thread is no longer available'",
  inboxSrc.includes("This email thread is no longer available"));
ok("Retry sync button present with data-testid",
  inboxSrc.includes('data-testid="button-retry-backfill"'));
ok("Retry sync button resets crmBackfillAttemptedRef before retrying",
  (() => {
    const idx = inboxSrc.indexOf('data-testid="button-retry-backfill"');
    const snippet = inboxSrc.slice(idx, idx + 800);
    return snippet.includes("crmBackfillAttemptedRef.current.delete");
  })());
ok("Dismiss button present with data-testid",
  inboxSrc.includes('data-testid="button-dismiss-backfill"'));
ok("Dismiss calls bulkRejectMutation",
  (() => {
    const idx = inboxSrc.indexOf('data-testid="button-dismiss-backfill"');
    const snippet = inboxSrc.slice(idx, idx + 400);
    return snippet.includes("bulkRejectMutation.mutate");
  })());
ok("Open in Gmail link has data-testid",
  inboxSrc.includes('data-testid="link-open-in-gmail"'));
ok("Open in Gmail link opens in new tab",
  (() => {
    const idx = inboxSrc.indexOf('data-testid="link-open-in-gmail"');
    const snippet = inboxSrc.slice(idx, idx + 500);
    return snippet.includes('target="_blank"') && snippet.includes('rel="noopener noreferrer"');
  })());
ok("Open in Gmail uses gmailMessageId when available",
  (() => {
    const idx = inboxSrc.indexOf('data-testid="link-open-in-gmail"');
    const snippet = inboxSrc.slice(idx, idx + 500);
    return snippet.includes("gmailMessageId") && snippet.includes("rfc822msgid");
  })());
ok("Open in Gmail falls back to thread URL when gmailMessageId absent",
  (() => {
    // href uses ternary: gmailMessageId ? <msg-url> : gmailUrl
    // The gmailUrl variable is defined nearby and uses the #all/ thread path.
    const idx = inboxSrc.indexOf('data-testid="link-open-in-gmail"');
    const fwd = inboxSrc.slice(idx, idx + 500);
    const gmailUrlIdx = inboxSrc.indexOf('const gmailUrl = ');
    const varDef = inboxSrc.slice(gmailUrlIdx, gmailUrlIdx + 100);
    return fwd.includes(": gmailUrl}") && varDef.includes("#all/");
  })());

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`CRM Review Thread Backfill — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
