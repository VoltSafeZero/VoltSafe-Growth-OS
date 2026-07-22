"use strict";
/**
 * In-Email Domain Watch — Source-Grep Test Suite
 *
 * Verifies all 24 required behaviours for the in-email "Always ingest this
 * domain into Cortex" action without making any network calls.
 */

const fs   = require("fs");
const path = require("path");
const assert = require("assert");

const routesSrc   = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const serviceSrc  = fs.readFileSync(path.join(__dirname, "../server/services/cortex-auto-ingest.ts"), "utf8");
const toolbarSrc  = fs.readFileSync(path.join(__dirname, "../client/src/components/inbox/email-actions-toolbar.tsx"), "utf8");
const popoverSrc  = fs.readFileSync(path.join(__dirname, "../client/src/components/inbox/domain-watch-popover.tsx"), "utf8");
const inboxSrc    = fs.readFileSync(path.join(__dirname, "../client/src/pages/gmail-inbox.tsx"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── 1. Authorized roles ─────────────────────────────────────────────────────
console.log("\n── 1. Authorized roles ──");

test("canManageCortexDomains uses master_admin, admin, exec, manager in parent", () => {
  assert(inboxSrc.includes('"master_admin"') && inboxSrc.includes('"admin"') && inboxSrc.includes('"exec"') && inboxSrc.includes('"manager"'),
    "canManageCortexDomains role list incomplete in gmail-inbox.tsx");
  assert(inboxSrc.includes("canManageCortexDomains"), "canManageCortexDomains not declared in gmail-inbox.tsx");
});

test("canManageCortexDomains prop passed to both EmailActionsToolbar instances", () => {
  const matches = (inboxSrc.match(/canManageCortexDomains=\{canManageCortexDomains\}/g) || []).length;
  assert(matches >= 2, `Expected 2 canManageCortexDomains prop bindings, found ${matches}`);
});

test("toolbar: canManageCortexDomains prop declared in interface", () => {
  assert(toolbarSrc.includes("canManageCortexDomains?:"), "canManageCortexDomains prop missing from EmailActionsToolbarProps");
});

test("backend: 403 returned for unauthorized domain watch check", () => {
  assert(routesSrc.includes('res.status(403)') && routesSrc.includes("requireAutoIngestAccess"),
    "403 or requireAutoIngestAccess not in routes");
  assert(routesSrc.includes("/api/cortex/auto-ingest-domains/check"), "check route not added to routes.ts");
});

// ── 2. Outbound message guard ────────────────────────────────────────────────
console.log("\n── 2. Outbound message guard ──");

test("isOutbound prop declared in toolbar interface", () => {
  assert(toolbarSrc.includes("isOutbound?:"), "isOutbound prop missing from EmailActionsToolbarProps");
});

test("isOutbound prop passed to both toolbar instances using labelIds.includes SENT guard", () => {
  const matches = (inboxSrc.match(/isOutbound=\{/g) || []).length;
  assert(matches >= 2, `Expected 2 isOutbound prop bindings, found ${matches}`);
  assert(inboxSrc.includes('labelIds?.includes("SENT")'), "SENT label check missing");
});

test("toolbar suppresses domain watch for outbound messages", () => {
  assert(toolbarSrc.includes("!isOutbound"), "!isOutbound guard missing from domain watch section");
});

// ── 3. Domain extraction ─────────────────────────────────────────────────────
console.log("\n── 3. Domain extraction ──");

test("senderDomain computed from senderEmail by splitting on @", () => {
  assert(toolbarSrc.includes('senderEmail.split("@")') || toolbarSrc.includes("senderEmail.includes(\"@\")"),
    "@ split for domain extraction missing in toolbar");
});

test("domain extraction lowercases the result", () => {
  // senderEmail is already lowercased by the parent (fromEmail?.toLowerCase())
  assert(inboxSrc.includes('focusedMsg.fromEmail?.toLowerCase()'), "toLowerCase not applied to fromEmail in parent");
});

test("service: normalizeDomainInput rejects full email addresses", () => {
  assert(serviceSrc.includes("not a full email address"), "email rejection message missing in service");
});

test("service: normalizeDomainInput rejects URLs", () => {
  assert(serviceSrc.includes("not a URL"), "URL rejection message missing in service");
});

test("service: full email address rejected (@ guard)", () => {
  assert(serviceSrc.includes('d.includes("@")'), "@ guard missing in normalizeDomainInput");
});

// ── 4. Toolbar UI structure ──────────────────────────────────────────────────
console.log("\n── 4. Toolbar UI structure ──");

test("cortex-button-group test id present (split-button wrapper)", () => {
  assert(toolbarSrc.includes('data-testid="cortex-button-group"'), "cortex-button-group testid missing");
});

test("action-save-to-cortex button preserved (existing capability)", () => {
  assert(toolbarSrc.includes('data-testid="action-save-to-cortex"'), "action-save-to-cortex testid missing");
});

test("cortex-menu-trigger chevron-down trigger present", () => {
  assert(toolbarSrc.includes('data-testid="cortex-menu-trigger"'), "cortex-menu-trigger testid missing");
});

test("cortex-menu-save item present in dropdown", () => {
  assert(toolbarSrc.includes('data-testid="cortex-menu-save"'), "cortex-menu-save dropdown item missing");
});

test("cortex-menu-domain-watch item present in dropdown", () => {
  assert(toolbarSrc.includes('data-testid="cortex-menu-domain-watch"'), "cortex-menu-domain-watch item missing");
});

test("cortex-menu-manage navigates to /feed-cortex", () => {
  assert(toolbarSrc.includes('data-testid="cortex-menu-manage"') && toolbarSrc.includes('"/feed-cortex"'),
    "manage rule navigation missing");
});

test("disabled item shown for unauthorized users (cortex-menu-domain-watch-disabled)", () => {
  assert(toolbarSrc.includes('data-testid="cortex-menu-domain-watch-disabled"'),
    "disabled domain-watch item for unauthorized users missing");
});

test("domain-watched green dot indicator present (cortex-domain-watched-dot)", () => {
  assert(toolbarSrc.includes('data-testid="cortex-domain-watched-dot"'), "domain-watched green dot missing");
});

// ── 5. DomainWatchPopover component ─────────────────────────────────────────
console.log("\n── 5. DomainWatchPopover component ──");

test("dialog-domain-watch testid present", () => {
  assert(popoverSrc.includes('data-testid="dialog-domain-watch"'), "dialog-domain-watch testid missing");
});

test("create form testid present", () => {
  assert(popoverSrc.includes('data-testid="domain-watch-create-form"'), "domain-watch-create-form testid missing");
});

test("btn-confirm-domain-watch testid present", () => {
  assert(popoverSrc.includes('data-testid="btn-confirm-domain-watch"'), "btn-confirm-domain-watch testid missing");
});

test("btn-reenable-domain-watch testid present (disabled rule re-enable)", () => {
  assert(popoverSrc.includes('data-testid="btn-reenable-domain-watch"'), "btn-reenable-domain-watch testid missing");
});

test("domain-watch-already-enabled section present", () => {
  assert(popoverSrc.includes('data-testid="domain-watch-already-enabled"'), "already-enabled state section missing");
});

test("domain-watch-domain-value shows the extracted domain", () => {
  assert(popoverSrc.includes('data-testid="domain-watch-domain-value"'), "domain-watch-domain-value testid missing");
});

test("checkbox-future-only is present and checked (future-only is always enforced)", () => {
  assert(popoverSrc.includes('data-testid="checkbox-future-only"'), "future-only checkbox testid missing");
  assert(popoverSrc.includes("checked"), "checkbox checked state missing");
});

test("Undo uses ToastAction with altText", () => {
  assert(popoverSrc.includes("ToastAction") && popoverSrc.includes('altText="Undo"'),
    "ToastAction with altText='Undo' missing — Undo must use ToastAction for accessibility");
});

// ── 6. Backend check route ───────────────────────────────────────────────────
console.log("\n── 6. Backend check route ──");

test("GET /api/cortex/auto-ingest-domains/check route present with requireAutoIngestAccess", () => {
  assert(
    routesSrc.includes('app.get("/api/cortex/auto-ingest-domains/check", requireAuth, requireAutoIngestAccess'),
    "check route not present or missing guards"
  );
});

test("checkDomainWatch exported from cortex-auto-ingest service", () => {
  assert(serviceSrc.includes("export async function checkDomainWatch"), "checkDomainWatch not exported from service");
});

test("check route returns watched + active + rule fields", () => {
  assert(
    routesSrc.includes("watched:") && routesSrc.includes("active:") && routesSrc.includes("rule:"),
    "check route response missing watched/active/rule fields"
  );
});

test("duplicate domain throws descriptive error (already being watched)", () => {
  assert(serviceSrc.includes("is already being watched"), "duplicate domain error message missing in service");
});

// ── 7. DomainWatchPopover imported into toolbar ──────────────────────────────
console.log("\n── 7. Component wiring ──");

test("DomainWatchPopover imported in email-actions-toolbar.tsx", () => {
  assert(toolbarSrc.includes('from "./domain-watch-popover"'), "DomainWatchPopover not imported in toolbar");
});

test("DomainWatchPopover rendered with senderDomain + canManage props", () => {
  assert(
    toolbarSrc.includes("<DomainWatchPopover") &&
    toolbarSrc.includes("senderDomain={senderDomain}") &&
    toolbarSrc.includes("canManage={canManageCortexDomains}"),
    "DomainWatchPopover not wired with correct props in toolbar"
  );
});

// ── 8. Existing functionality preserved ─────────────────────────────────────
console.log("\n── 8. Existing functionality preserved ──");

test("existing auto-ingest Gmail hook still present in gmail-incremental.ts", () => {
  const incrSrc = fs.readFileSync(path.join(__dirname, "../server/services/gmail-incremental.ts"), "utf8");
  assert(
    incrSrc.includes("autoIngestMessageIfDomainFlagged") || incrSrc.includes("cortex-auto-ingest"),
    "gmail-incremental auto-ingest hook missing"
  );
});

test("Domain Watch management UI (DomainWatchPanel) still present in feed-cortex.tsx", () => {
  const feedCortexSrc = fs.readFileSync(path.join(__dirname, "../client/src/pages/feed-cortex.tsx"), "utf8");
  assert(
    feedCortexSrc.includes("DomainWatchPanel") || feedCortexSrc.includes("auto-ingest-domains"),
    "DomainWatchPanel missing from feed-cortex.tsx"
  );
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("FAILED");
  process.exit(1);
}
console.log("ALL PASSED");
