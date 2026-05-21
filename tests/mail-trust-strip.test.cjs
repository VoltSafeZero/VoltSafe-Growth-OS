"use strict";
/**
 * Mail Trust Strip — Regression Tests
 * Source-grep tests confirming component structure, state rendering, and wiring.
 * No live API calls needed — all assertions are structural.
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ─── T1: Component file exists ────────────────────────────────────────────────
function testComponentExists() {
  console.log("\n── T1: Component file exists ──");
  const stripPath = path.join(__dirname, "../client/src/components/inbox/mail-trust-strip.tsx");
  assert(fs.existsSync(stripPath), "mail-trust-strip.tsx exists");

  const src = fs.readFileSync(stripPath, "utf8");
  assert(src.includes("MailTrustStrip"), "exports MailTrustStrip");
  assert(src.includes("TrustEvent"), "exports TrustEvent type");
  assert(src.includes('data-testid="mail-trust-strip"'), "root has data-testid=mail-trust-strip");
  assert(src.includes('data-testid="trust-dot"'), "status dot has data-testid=trust-dot");
  assert(src.includes('data-testid="trust-label"'), "label has data-testid=trust-label");
  assert(src.includes('data-testid="trust-reconnect-link"'), "reconnect link has data-testid");
  assert(src.includes('data-testid="trust-spinner"'), "spinner has data-testid=trust-spinner");
}

// ─── T2: Healthy connected state ──────────────────────────────────────────────
function testHealthyState() {
  console.log("\n── T2: Healthy connected state renders ──");
  const src = fs.readFileSync(
    path.join(__dirname, "../client/src/components/inbox/mail-trust-strip.tsx"),
    "utf8"
  );
  assert(src.includes("Connected to Gmail"), "renders 'Connected to Gmail' label");
  assert(src.includes("bg-emerald-400"), "uses emerald dot for healthy state");
  assert(src.includes("formatDistanceToNow"), "formats last sync time with date-fns");
  assert(
    src.includes("lastSyncAt") && src.includes('label = lastSyncAt ?'),
    "conditionally appends sync time to connected label"
  );
}

// ─── T3: Reconnect state ──────────────────────────────────────────────────────
function testReconnectState() {
  console.log("\n── T3: Reconnect state renders ──");
  const src = fs.readFileSync(
    path.join(__dirname, "../client/src/components/inbox/mail-trust-strip.tsx"),
    "utf8"
  );
  assert(src.includes("Gmail reconnect required"), "renders 'Gmail reconnect required' label");
  assert(src.includes("showReconnect = true"), "sets showReconnect flag for expired/revoked auth");
  assert(
    src.includes('"expired"') && src.includes('"revoked"'),
    "handles both expired and revoked authStatus"
  );
  assert(src.includes('href="/api/auth/gmail/connect"'), "reconnect link points to oauth connect endpoint");
  assert(src.includes('{showReconnect && ('), "reconnect link conditionally rendered");
}

// ─── T4: Sending state ────────────────────────────────────────────────────────
function testSendingState() {
  console.log("\n── T4: Sending state renders ──");
  const src = fs.readFileSync(
    path.join(__dirname, "../client/src/components/inbox/mail-trust-strip.tsx"),
    "utf8"
  );
  assert(src.includes('"sending"'), "handles sending trust event type");
  assert(src.includes('label = "Sending\u2026"'), "renders 'Sending…' label");
  assert(src.includes("showSpinner = true"), "shows spinner during sending");
  assert(src.includes("Loader2"), "uses Loader2 icon for spinner");
  assert(src.includes("animate-spin"), "spinner has animate-spin class");
}

// ─── T5: Draft saved state ────────────────────────────────────────────────────
function testDraftSavedState() {
  console.log("\n── T5: Draft saved state renders ──");
  const src = fs.readFileSync(
    path.join(__dirname, "../client/src/components/inbox/mail-trust-strip.tsx"),
    "utf8"
  );
  assert(src.includes('"draft-saving"'), "handles draft-saving trust event type");
  assert(src.includes('"draft-saved"'), "handles draft-saved trust event type");
  assert(src.includes('label = "Saving draft\u2026"'), "renders 'Saving draft…' during autosave");
  assert(src.includes('label = "Draft saved"'), "renders 'Draft saved' after success");
}

// ─── T6: Send failed — saved as draft state ───────────────────────────────────
function testSendFailedDraftSavedState() {
  console.log("\n── T6: Send failed — saved as draft state renders ──");
  const src = fs.readFileSync(
    path.join(__dirname, "../client/src/components/inbox/mail-trust-strip.tsx"),
    "utf8"
  );
  assert(src.includes('"send-failed-draft-saved"'), "handles send-failed-draft-saved event type");
  assert(
    src.includes("Send failed \u2014 saved as draft"),
    "renders 'Send failed — saved as draft' label"
  );
  assert(src.includes("bg-amber-400"), "uses amber dot for send-failed-draft-saved (not full red)");
}

// ─── T7: Trust event wiring in ComposeDialog ─────────────────────────────────
function testComposeDialogWiring() {
  console.log("\n── T7: Trust event wiring in ComposeDialog ──");
  const inboxSrc = fs.readFileSync(
    path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"),
    "utf8"
  );

  assert(
    inboxSrc.includes('onTrustEvent?: (event: TrustEvent) => void;'),
    "ComposeDialog props interface has onTrustEvent"
  );
  assert(
    inboxSrc.includes('onTrustEvent?.({ type: "sending"'),
    "sendMutation fires sending event at mutationFn start"
  );
  assert(
    inboxSrc.includes('onTrustEvent?.({ type: "sent"'),
    "sendMutation fires sent event on success"
  );
  assert(
    inboxSrc.includes('onTrustEvent?.({ type: "send-failed-draft-saved"'),
    "sendMutation fires send-failed-draft-saved on C2 error branch"
  );
  assert(
    inboxSrc.includes('onTrustEvent?.({ type: "send-failed"'),
    "sendMutation fires send-failed on plain error branch"
  );
  assert(
    inboxSrc.includes('onTrustEvent?.({ type: "draft-saving"'),
    "draftMutation fires draft-saving event at mutationFn start"
  );
  assert(
    inboxSrc.includes('onTrustEvent?.({ type: "draft-saved"'),
    "draftMutation fires draft-saved event on success"
  );
}

// ─── T8: GmailInboxPage wires state + renders strip ──────────────────────────
function testInboxPageIntegration() {
  console.log("\n── T8: GmailInboxPage integration ──");
  const inboxSrc = fs.readFileSync(
    path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"),
    "utf8"
  );

  assert(
    inboxSrc.includes("import { MailTrustStrip") && inboxSrc.includes("mail-trust-strip"),
    "gmail-inbox.tsx imports MailTrustStrip"
  );
  assert(
    inboxSrc.includes('import { MailTrustStrip, type TrustEvent }'),
    "also imports TrustEvent type"
  );
  assert(
    inboxSrc.includes("const [trustEvent, setTrustEvent]"),
    "GmailInboxPage has trustEvent state"
  );
  assert(
    inboxSrc.includes("const handleTrustEvent"),
    "GmailInboxPage has handleTrustEvent callback"
  );
  assert(
    inboxSrc.includes("trustEventTimerRef"),
    "uses ref for auto-clear timer (no memory leak)"
  );
  assert(
    inboxSrc.includes("onTrustEvent={handleTrustEvent}"),
    "passes handleTrustEvent to ComposeDialog render"
  );
  assert(
    inboxSrc.includes("<MailTrustStrip"),
    "renders MailTrustStrip in sidebar"
  );
  assert(
    inboxSrc.includes("healthById.get(connectedAccount?.id ?? 0)?.status"),
    "passes health status from accountsHealthQuery to strip"
  );
  assert(
    inboxSrc.includes("scheduledQuery.data?.some(e => e.status === \"failed\")"),
    "passes hasFailedScheduled derived from scheduledQuery"
  );
}

// ─── T9a: Loading state stability ────────────────────────────────────────────
function testLoadingState() {
  console.log("\n── T9a: Loading state stability ──");
  const src = fs.readFileSync(
    path.join(__dirname, "../client/src/components/inbox/mail-trust-strip.tsx"),
    "utf8"
  );
  assert(src.includes("isLoading?: boolean"), "strip accepts optional isLoading prop");
  assert(src.includes("if (isLoading)"), "isLoading is the highest-priority branch (no reconnect flash)");
  assert(src.includes('"Checking\u2026"'), "shows 'Checking…' during load (not 'Gmail reconnect required')");
  assert(src.includes("text-muted-foreground/40"), "uses faded label color during loading state");

  const inboxSrc = fs.readFileSync(
    path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"),
    "utf8"
  );
  assert(
    inboxSrc.includes("isLoading={accountsQuery.isLoading}"),
    "GmailInboxPage passes accountsQuery.isLoading to strip"
  );
}

// ─── T9: Auto-clear timers for transient events ───────────────────────────────
function testAutoClearTimers() {
  console.log("\n── T9: Transient event auto-clear timers ──");
  const inboxSrc = fs.readFileSync(
    path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"),
    "utf8"
  );
  assert(inboxSrc.includes("3000"), "sent event clears after 3s");
  assert(inboxSrc.includes("2500"), "draft-saved event clears after 2.5s");
  assert(inboxSrc.includes("6000"), "failure events clear after 6s");
  assert(
    inboxSrc.includes("clearTimeout(trustEventTimerRef.current)"),
    "clears previous timer before setting new one (no stale timers)"
  );
}

// ─── T10: No unrelated mail behaviour changed ─────────────────────────────────
function testUnrelatedBehaviourUnchanged() {
  console.log("\n── T10: Unrelated mail behaviour unchanged ──");
  const inboxSrc = fs.readFileSync(
    path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"),
    "utf8"
  );
  // Idempotency key unchanged (C1)
  assert(
    inboxSrc.includes("idempotencyKey: idempotencyKeyRef.current"),
    "C1: idempotency key still passed in send payload"
  );
  // Draft fallback logic unchanged (C2)
  assert(
    inboxSrc.includes("err.draftSaved && err.draftId"),
    "C2: draft fallback branch still checks err.draftSaved"
  );
  assert(
    inboxSrc.includes("Send failed \u2014 saved as draft"),
    "C2: existing toast title unchanged"
  );
  // accountsHealthQuery still wired
  assert(
    inboxSrc.includes("/api/gmail/accounts/health"),
    "accountsHealthQuery still fetches /api/gmail/accounts/health"
  );
  // connectedAccount resolution unchanged
  assert(
    inboxSrc.includes("const connectedAccount ="),
    "connectedAccount derivation unchanged"
  );
  // Existing account footer reconnect button unchanged
  assert(
    inboxSrc.includes('data-testid="button-reconnect-account-footer"'),
    "existing sidebar reconnect button testid unchanged"
  );
  assert(
    inboxSrc.includes('data-testid="text-connected-email"'),
    "existing connected email display testid unchanged"
  );
}

// ─── Run all tests ─────────────────────────────────────────────────────────────
(async () => {
  console.log("VoltSafe Mail Trust Strip — Regression Tests\n");

  testComponentExists();
  testHealthyState();
  testReconnectState();
  testSendingState();
  testDraftSavedState();
  testSendFailedDraftSavedState();
  testComposeDialogWiring();
  testInboxPageIntegration();
  testLoadingState();
  testAutoClearTimers();
  testUnrelatedBehaviourUnchanged();

  console.log(`\n${"─".repeat(52)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
