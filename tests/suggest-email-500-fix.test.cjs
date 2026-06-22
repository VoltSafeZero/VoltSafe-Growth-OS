"use strict";
/**
 * Tests for the Suggested Next Email 500-error fix.
 *
 * Root cause: tokenLimit=2000 was too small → finish_reason=length → raw_chars=2
 * → "Model returned empty email body" → HTTP 500 with "Request failed: 500" shown.
 *
 * Fixes:
 *   1. tokenLimit bumped 2000 → 4000 in crm-ai-summary.ts
 *   2. fetchSuggestedEmail reads error body JSON before throwing
 *   3. Route returns 422 (not 500) for recoverable errors
 *   4. Error banner heading / helper text improved in modal
 *
 * All checks are source-grep based — no live server required.
 */

const fs   = require("fs");
const path = require("path");
const assert = require("assert");

const SERVICE_PATH = path.join(__dirname, "../server/services/crm-ai-summary.ts");
const ROUTES_PATH  = path.join(__dirname, "../server/routes.ts");
const MODAL_PATH   = path.join(__dirname, "../client/src/components/crm/suggested-next-email-modal.tsx");

const svc    = fs.readFileSync(SERVICE_PATH,  "utf8");
const routes = fs.readFileSync(ROUTES_PATH,   "utf8");
const modal  = fs.readFileSync(MODAL_PATH,    "utf8");

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

// ── Service: token limit ─────────────────────────────────────────────────────
console.log("\n── crm-ai-summary.ts: token limit ──");

check(
  "generateSuggestedNextEmail uses tokenLimit: 4000 (bumped from 2000)",
  svc.includes("tokenLimit: 4000")
);
check(
  "generateSuggestedNextEmail uses gpt-5-mini model",
  (() => {
    const idx = svc.indexOf("tokenLimit: 4000");
    const nearby = svc.slice(idx - 200, idx + 50);
    return nearby.includes("gpt-5-mini");
  })()
);
check(
  "tokenLimit: 2000 no longer used in generateSuggestedNextEmail",
  (() => {
    // The only remaining tokenLimit:2000 should be in the AI summary function (not suggest-next-email)
    const suggestIdx = svc.indexOf("generateSuggestedNextEmail");
    const limit2000Idx = svc.indexOf("tokenLimit: 2000", suggestIdx);
    // Should not appear AFTER the generateSuggestedNextEmail function starts
    return limit2000Idx === -1 || limit2000Idx < suggestIdx;
  })()
);

// ── Service: finish_reason=length logging ────────────────────────────────────
console.log("\n── crm-ai-summary.ts: finish_reason logging ──");

check(
  "finish_reason is logged for suggest-next-email calls",
  svc.includes("finish_reason=${finishReason} raw_chars=${raw.length}")
);
check(
  "empty body logs both warn and keys when finish_reason=length",
  svc.includes("empty body (finish_reason=${finishReason}) keys=")
);
check(
  "empty body throws with finish_reason in message",
  svc.includes("Model returned empty email body (finish_reason=")
);

// ── Route: recoverable 422 instead of generic 500 ────────────────────────────
console.log("\n── routes.ts: recoverable error handling ──");

check(
  "route defines recoverable flag based on known error patterns",
  routes.includes("recoverable") &&
  routes.includes("finish_reason|empty (email )?body|Invalid JSON|Please regenerate")
);
check(
  "route returns 422 for recoverable errors",
  routes.includes("res.status(recoverable ? 422 : 500)")
);
check(
  "route logs the error with entity context and recoverable flag",
  routes.includes("[suggest-next-email]") &&
  routes.includes("recoverable=${recoverable}")
);
check(
  "route includes recoverable field in response JSON",
  routes.includes("{ message: msg, recoverable }")
);

// ── Frontend: fetch reads error body before throwing ─────────────────────────
console.log("\n── suggested-next-email-modal: fetch error handling ──");

check(
  "fetchSuggestedEmail reads error body JSON on non-ok response",
  modal.includes("const errBody = await res.json()")
);
check(
  "fetchSuggestedEmail uses errBody.message if present",
  modal.includes("if (errBody?.message) msg = errBody.message")
);
check(
  "fetchSuggestedEmail still falls back to 'Request failed: N' if no body.message",
  modal.includes('`Request failed: ${res.status}`')
);
check(
  "fetch error body parse failure is silently swallowed (try/catch)",
  (() => {
    const errBodyIdx = modal.indexOf("const errBody = await res.json()");
    const catchIdx   = modal.indexOf("} catch { /* ignore parse errors */", errBodyIdx);
    return errBodyIdx !== -1 && catchIdx !== -1 && catchIdx - errBodyIdx < 200;
  })()
);

// ── Frontend: error banner UX ─────────────────────────────────────────────────
console.log("\n── suggested-next-email-modal: error banner UX ──");

check(
  "error banner has data-testid='suggest-email-error-banner'",
  modal.includes('data-testid="suggest-email-error-banner"')
);
check(
  "error banner heading says 'AI could not generate this email'",
  modal.includes("AI could not generate this email")
);
check(
  "error banner still shows the error message text from server",
  modal.includes("{error}") &&
  (() => {
    const bannerIdx = modal.indexOf('data-testid="suggest-email-error-banner"');
    const errIdx    = modal.indexOf("{error}", bannerIdx);
    return errIdx !== -1 && errIdx - bannerIdx < 400;
  })()
);
check(
  "error banner adds helper text 'You can write it manually below or try again.'",
  modal.includes("You can write it manually below or try again.")
);
check(
  "error banner helper text appears inside the error banner element",
  (() => {
    const bannerIdx = modal.indexOf('data-testid="suggest-email-error-banner"');
    const helperIdx = modal.indexOf("You can write it manually below or try again.", bannerIdx);
    return bannerIdx !== -1 && helperIdx !== -1 && helperIdx - bannerIdx < 700;
  })()
);

// ── Frontend: manual body remains usable after failure ────────────────────────
console.log("\n── suggested-next-email-modal: manual fallback after failure ──");

check(
  "manual body section shown when generationAttempted && !loading && !suggestion",
  modal.includes("generationAttempted && !loading && !suggestion")
);
check(
  "Continue in Mail disabled only when editedBody is empty",
  modal.includes("!editedBody.trim()")
);
check(
  "handleContinue works with no suggestion (user typed body manually)",
  modal.includes("Allow continue even if AI generation failed")
);
check(
  "Generate Email button remains available to retry after failure",
  modal.includes("Generate Email") &&
  modal.includes("Regenerate Email")
);

// ── Integration: CRM return context preserved through failure path ────────────
console.log("\n── CRM return context preserved through failure ──");

check(
  "crmReturnContext is passed into handleContinue payload even on failure",
  (() => {
    const payloadIdx = modal.indexOf("const payload = {");
    const crmIdx     = modal.indexOf("crmReturnContext", payloadIdx);
    return payloadIdx !== -1 && crmIdx !== -1 && crmIdx - payloadIdx < 400;
  })()
);
check(
  "error path does not clear crmReturnContext prop",
  (() => {
    // crmReturnContext is a prop — it is never set to null on error
    const setCrmNull = modal.includes("setCrmReturnContext(null)") ||
                       modal.includes("crmReturnContext = null");
    return !setCrmNull;
  })()
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`suggest-email-500-fix: ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));
process.exit(failed > 0 ? 1 : 0);
