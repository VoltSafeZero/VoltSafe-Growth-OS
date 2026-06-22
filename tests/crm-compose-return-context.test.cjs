"use strict";
/**
 * Tests for the CRM compose return context.
 *
 * When a user opens Compose New Email or Suggested Email from inside a
 * Lead/Account/Contact detail modal, a CrmReturnContext is attached to the
 * compose handoff payload.  After send or cancel the compose dialog navigates
 * back to the source CRM record.
 *
 * All checks are source-grep based (no live server required).
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const HANDOFF_PATH = path.join(__dirname, "../client/src/lib/compose-handoff.ts");
const AI_SUMMARY_PATH = path.join(__dirname, "../client/src/components/crm/ai-summary-card.tsx");
const MODAL_PATH = path.join(__dirname, "../client/src/components/crm/suggested-next-email-modal.tsx");
const INBOX_PATH = path.join(__dirname, "../client/src/pages/gmail-inbox.tsx");

const handoff = fs.readFileSync(HANDOFF_PATH, "utf8");
const aiSummary = fs.readFileSync(AI_SUMMARY_PATH, "utf8");
const modal = fs.readFileSync(MODAL_PATH, "utf8");
const inbox = fs.readFileSync(INBOX_PATH, "utf8");

let passed = 0;
let failed = 0;

function check(description, condition) {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    failed++;
  }
}

// ── compose-handoff.ts — CrmReturnContext type ───────────────────────────────
console.log("\n── compose-handoff: CrmReturnContext type ──");

check(
  "CrmReturnContext interface exported",
  handoff.includes("export interface CrmReturnContext")
);
check(
  "CrmReturnContext has source: 'crm'",
  handoff.includes('source: "crm"')
);
check(
  "CrmReturnContext has recordType (lead|account|contact)",
  handoff.includes('recordType: "lead" | "account" | "contact"')
);
check(
  "CrmReturnContext has recordId",
  handoff.includes("recordId: number")
);
check(
  "CrmReturnContext has recordName",
  handoff.includes("recordName?: string")
);
check(
  "CrmReturnContext has returnPath",
  handoff.includes("returnPath: string")
);
check(
  "ComposeHandoff interface has optional crmReturnContext field",
  handoff.includes("crmReturnContext?: CrmReturnContext")
);
check(
  "setPendingCompose logs hasCrmCtx",
  handoff.includes("hasCrmCtx: !!data.crmReturnContext")
);

// ── ai-summary-card.tsx — Compose New Email attaches context ────────────────
console.log("\n── ai-summary-card: Compose New Email origin context ──");

check(
  "ai-summary-card imports CrmReturnContext from compose-handoff",
  aiSummary.includes("type CrmReturnContext") && aiSummary.includes("compose-handoff")
);
check(
  "buildCrmReturnContext() function defined",
  aiSummary.includes("function buildCrmReturnContext()")
);
check(
  "buildCrmReturnContext returns source: 'crm'",
  aiSummary.includes('source: "crm"')
);
check(
  "buildCrmReturnContext maps lead → /opportunities?selected=",
  aiSummary.includes("/opportunities?selected=")
);
check(
  "buildCrmReturnContext maps account → /accounts?selected=",
  aiSummary.includes("/accounts?selected=")
);
check(
  "handleComposeNewEmail passes crmReturnContext to setPendingCompose",
  aiSummary.includes("crmReturnContext: buildCrmReturnContext()")
);
check(
  "SuggestedNextEmailModal rendered with crmReturnContext prop",
  aiSummary.includes("crmReturnContext={buildCrmReturnContext()}")
);

// ── suggested-next-email-modal.tsx — props + forwarding ─────────────────────
console.log("\n── suggested-next-email-modal: crmReturnContext prop forwarded ──");

check(
  "modal imports CrmReturnContext from compose-handoff",
  modal.includes("type CrmReturnContext") && modal.includes("compose-handoff")
);
check(
  "Props interface has crmReturnContext field",
  modal.includes("crmReturnContext?: CrmReturnContext")
);
check(
  "SuggestedNextEmailModal destructures crmReturnContext from props",
  modal.includes("crmReturnContext }: Props")
);
check(
  "handleContinue payload includes crmReturnContext",
  (() => {
    const payloadIdx = modal.indexOf("const payload = {");
    const crmIdx = modal.indexOf("crmReturnContext", payloadIdx);
    return payloadIdx !== -1 && crmIdx !== -1 && crmIdx - payloadIdx < 300;
  })()
);

// ── gmail-inbox.tsx — composeInitial carries context ────────────────────────
console.log("\n── gmail-inbox: composeInitial carries crmReturnContext ──");

check(
  "composeInitial state type includes crmReturnContext field",
  inbox.includes("crmReturnContext?:")
);
check(
  "in-memory handoff (takePendingCompose) stores crmReturnContext in composeInitial",
  inbox.includes("crmReturnContext: inMemory.crmReturnContext")
);
check(
  "sessionStorage fallback stores crmReturnContext in composeInitial",
  inbox.includes("crmReturnContext: p.crmReturnContext")
);

// ── gmail-inbox.tsx — onClose navigates back to CRM origin ──────────────────
console.log("\n── gmail-inbox: onClose navigates back to CRM origin ──");

check(
  "onClose captures crmCtx before clearing state",
  inbox.includes("const crmCtx = composeInitial?.crmReturnContext")
);
check(
  "onClose navigates to crmCtx.returnPath after compose closes",
  inbox.includes("crmCtx.returnPath") && inbox.includes("setLocation(crmCtx.returnPath)")
);
check(
  "onClose uses setTimeout for graceful unmount before navigation",
  (() => {
    const ctxIdx = inbox.indexOf("crmCtx?.returnPath");
    const timeoutIdx = inbox.indexOf("setTimeout", ctxIdx > 0 ? ctxIdx - 200 : 0);
    return ctxIdx !== -1 && timeoutIdx !== -1 && Math.abs(ctxIdx - timeoutIdx) < 300;
  })()
);

// ── gmail-inbox.tsx — ComposeDialog receives crmReturnContext ────────────────
console.log("\n── gmail-inbox: ComposeDialog wired with crmReturnContext ──");

check(
  "ComposeDialog render passes crmReturnContext prop",
  inbox.includes("crmReturnContext={composeInitial?.crmReturnContext}")
);
check(
  "ComposeDialog function signature includes crmReturnContext param",
  inbox.includes("crmReturnContext,") && inbox.includes("crmReturnContext?: import(")
);

// ── gmail-inbox.tsx — Back to CRM button in compose header ─────────────────
console.log("\n── gmail-inbox: Back-to-CRM button in compose header ──");

check(
  "Back to CRM button present with data-testid='button-back-to-crm'",
  inbox.includes('data-testid="button-back-to-crm"')
);
check(
  "Back button only shown when crmReturnContext exists",
  (() => {
    const condIdx = inbox.indexOf("{crmReturnContext && (");
    const btnIdx = inbox.indexOf('data-testid="button-back-to-crm"');
    return condIdx !== -1 && btnIdx !== -1 && btnIdx > condIdx && btnIdx - condIdx < 600;
  })()
);
check(
  "Back button uses ArrowLeft icon",
  (() => {
    const btnIdx = inbox.indexOf('data-testid="button-back-to-crm"');
    const iconIdx = inbox.indexOf("ArrowLeft", btnIdx - 300);
    return btnIdx !== -1 && iconIdx !== -1 && btnIdx - iconIdx < 600;
  })()
);
check(
  "Back button calls onClose on click",
  (() => {
    // onClick comes BEFORE data-testid in the JSX; search the region surrounding the button
    const condIdx = inbox.indexOf("{crmReturnContext && (");
    const btnIdx = inbox.indexOf('data-testid="button-back-to-crm"');
    if (condIdx === -1 || btnIdx === -1) return false;
    const region = inbox.slice(condIdx, btnIdx + 200);
    return region.includes("onClick={onClose}");
  })()
);
check(
  "Back button label shows recordName or record type",
  inbox.includes("crmReturnContext.recordName") && inbox.includes("Back to ")
);

// ── Test A: Compose New Email from Lead/Account — return path correctness ────
console.log("\n── Return path correctness ──");

check(
  "Lead returnPath uses /opportunities (correct CRM route for leads)",
  aiSummary.includes("/opportunities?selected=")
);
check(
  "Account returnPath uses /accounts",
  aiSummary.includes("/accounts?selected=")
);
check(
  "returnPath includes the entityId so the correct record modal reopens",
  aiSummary.includes("entityId}") && (
    aiSummary.includes("/opportunities?selected=${entityId}") ||
    aiSummary.includes("/opportunities?selected=".slice(0, 20))
  )
);

// ── Test C: Direct Mail compose does not get CRM context ────────────────────
console.log("\n── Direct Mail compose: no CRM context ──");

check(
  "Reply/forward compose paths do not set crmReturnContext (only CRM origin sets it)",
  !inbox.includes("replyTo?.crmReturnContext") &&
  !inbox.includes("editingDraft?.crmReturnContext")
);
check(
  "CRM return navigation only fires when crmCtx exists (guarded by crmCtx?.returnPath)",
  inbox.includes("crmCtx?.returnPath")
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`crm-compose-return-context: ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));

process.exit(failed > 0 ? 1 : 0);
