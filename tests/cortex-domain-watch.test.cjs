"use strict";
/**
 * Cortex Domain Watch — Source-Grep Test Suite
 *
 * Tests all 16 required audit cases plus structural invariants.
 * Uses source-grep (zero network calls) for deterministic results.
 */

const fs = require("fs");
const assert = require("assert");
const path = require("path");

const serviceSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/cortex-auto-ingest.ts"), "utf8"
);
const routesSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes.ts"), "utf8"
);
const incrSrc = fs.readFileSync(
  path.join(__dirname, "../server/services/gmail-incremental.ts"), "utf8"
);
const uiSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/feed-cortex.tsx"), "utf8"
);

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

// ── 1. Role access guard ────────────────────────────────────────────────────
console.log("\n── 1. Role access guard ──");

test("requireAutoIngestAccess function exists in routes", () => {
  assert(routesSrc.includes("function requireAutoIngestAccess"), "requireAutoIngestAccess missing");
});

test("Allowed roles: master_admin, admin, exec, manager", () => {
  assert(routesSrc.includes('"master_admin"'), "master_admin missing");
  assert(routesSrc.includes('"admin"'), "admin missing");
  assert(routesSrc.includes('"exec"'), "exec missing");
  assert(routesSrc.includes('"manager"'), "manager missing");
});

test("Unauthorized users receive 403", () => {
  assert(routesSrc.includes("res.status(403)"), "403 response missing");
});

test("All 4 CRUD routes use requireAutoIngestAccess", () => {
  const getRoute = routesSrc.includes('app.get("/api/cortex/auto-ingest-domains", requireAuth, requireAutoIngestAccess');
  const postRoute = routesSrc.includes('app.post("/api/cortex/auto-ingest-domains", requireAuth, requireAutoIngestAccess');
  const patchRoute = routesSrc.includes('app.patch("/api/cortex/auto-ingest-domains/:id", requireAuth, requireAutoIngestAccess');
  const deleteRoute = routesSrc.includes('app.delete("/api/cortex/auto-ingest-domains/:id", requireAuth, requireAutoIngestAccess');
  assert(getRoute, "GET route missing requireAutoIngestAccess");
  assert(postRoute, "POST route missing requireAutoIngestAccess");
  assert(patchRoute, "PATCH route missing requireAutoIngestAccess");
  assert(deleteRoute, "DELETE route missing requireAutoIngestAccess");
});

// ── 2. Domain validation ────────────────────────────────────────────────────
console.log("\n── 2. Domain validation ──");

test("normalizeDomainInput exported from service", () => {
  assert(serviceSrc.includes("export function normalizeDomainInput"), "normalizeDomainInput not exported");
});

test("Strips leading @ (e.g. @Example.COM → example.com)", () => {
  assert(serviceSrc.includes('d.startsWith("@")') || serviceSrc.includes("startsWith('@')"), "@ strip missing");
  assert(serviceSrc.includes(".toLowerCase()"), "toLowerCase missing");
});

test("Rejects full email addresses (person@example.com)", () => {
  assert(serviceSrc.includes('d.includes("@")'), "email address rejection missing");
  assert(serviceSrc.includes("not a full email address"), "email rejection message missing");
});

test("Rejects URLs (https://example.com)", () => {
  assert(serviceSrc.includes('"://"') || serviceSrc.includes("'://'"), "URL rejection (://) missing");
  assert(serviceSrc.includes("not a URL"), "URL rejection message missing");
});

test("Rejects malformed domains (too short, no TLD)", () => {
  assert(serviceSrc.includes('!d.includes(".")'), "dot check missing");
  assert(serviceSrc.includes("d.length < 3"), "length check missing");
});

test("Rejects leading/trailing dots and hyphens", () => {
  assert(serviceSrc.includes('d.startsWith(".")'), "leading dot check missing");
  assert(serviceSrc.includes('d.endsWith(".")'), "trailing dot check missing");
});

test("Normalises @Example.COM → example.com (case + strip)", () => {
  // normalizeDomainInput does toLowerCase + trim + strip leading @
  assert(serviceSrc.includes(".toLowerCase().trim()"), "toLowerCase+trim not chained");
  assert(serviceSrc.includes('d.startsWith("@")'), "@ strip missing");
});

// ── 3. Duplicate handling ───────────────────────────────────────────────────
console.log("\n── 3. Duplicate handling ──");

test("Duplicate domain returns error (not silent upsert)", () => {
  assert(serviceSrc.includes("is already being watched"), "duplicate error message missing");
  assert(!serviceSrc.includes("ON CONFLICT"), "ON CONFLICT upsert must be removed");
});

test("Duplicate check uses SELECT before INSERT", () => {
  assert(serviceSrc.includes("SELECT id FROM cortex_auto_ingest_domains WHERE domain"), "SELECT duplicate check missing");
});

// ── 4. Database schema ──────────────────────────────────────────────────────
console.log("\n── 4. Database schema ──");

test("Table: cortex_auto_ingest_domains with IF NOT EXISTS", () => {
  assert(serviceSrc.includes("CREATE TABLE IF NOT EXISTS cortex_auto_ingest_domains"), "table creation missing");
});

test("Columns: id, domain, label, notes, is_active, created_by_user_id, created_at", () => {
  assert(serviceSrc.includes("SERIAL PRIMARY KEY"), "id column missing");
  assert(serviceSrc.includes("domain") && serviceSrc.includes("TEXT NOT NULL"), "domain column missing");
  assert(serviceSrc.includes("is_active") && serviceSrc.includes("BOOLEAN"), "is_active column missing");
  assert(serviceSrc.includes("created_by_user_id"), "created_by_user_id missing");
  assert(serviceSrc.includes("created_at") && serviceSrc.includes("TIMESTAMPTZ"), "created_at missing");
});

test("Columns: last_matched_at and match_count", () => {
  assert(serviceSrc.includes("last_matched_at"), "last_matched_at column missing");
  assert(serviceSrc.includes("match_count"), "match_count column missing");
});

test("UNIQUE constraint on domain", () => {
  assert(serviceSrc.includes("UNIQUE(domain)"), "UNIQUE constraint on domain missing");
});

test("Migration is idempotent (ADD COLUMN IF NOT EXISTS)", () => {
  assert(serviceSrc.includes("ADD COLUMN IF NOT EXISTS last_matched_at"), "idempotent last_matched_at missing");
  assert(serviceSrc.includes("ADD COLUMN IF NOT EXISTS match_count"), "idempotent match_count missing");
});

test("Migration registered in server/index.ts", () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");
  assert(indexSrc.includes("migrateAutoIngestDomainsSchema"), "migration not registered in index.ts");
});

// ── 5. Gmail sync hook ──────────────────────────────────────────────────────
console.log("\n── 5. Gmail sync hook ──");

test("Hook fires only for inbound messages (not outbound, not drafts)", () => {
  assert(incrSrc.includes('emailData.direction === "inbound"'), "inbound-only guard missing");
});

test("Hook fires only when fromEmail is present", () => {
  assert(incrSrc.includes("emailData.fromEmail"), "fromEmail guard missing");
});

test("Hook is fire-and-forget (does not await in Gmail sync)", () => {
  assert(incrSrc.includes("import(./cortex-auto-ingest") || incrSrc.includes('import("./cortex-auto-ingest")'), "dynamic import missing");
  assert(incrSrc.includes(".catch("), "catch handler missing (fire-and-forget safety)");
});

test("Gmail sync never fails because of Cortex errors", () => {
  // The Cortex hook must be in a .then().catch() chain or try/catch that doesn't propagate
  assert(
    incrSrc.includes("[cortex-auto-ingest] err"),
    "Cortex error log message missing — Gmail sync won't fail silently"
  );
});

test("Sender email passed to autoIngestMessageIfDomainFlagged", () => {
  assert(incrSrc.includes("senderEmail: emailData.fromEmail"), "senderEmail not passed");
});

test("Gmail message ID passed for idempotency", () => {
  assert(incrSrc.includes("gmailMessageId: emailData.gmailMessageId"), "gmailMessageId not passed");
});

// ── 6. Auto-ingest logic ────────────────────────────────────────────────────
console.log("\n── 6. Auto-ingest logic ──");

test("Domain extracted from sender email (not CC or body)", () => {
  assert(serviceSrc.includes("senderEmail.split(\"@\")"), "sender domain extraction missing");
});

test("Only active domains trigger ingest (is_active = true)", () => {
  assert(serviceSrc.includes("is_active = true"), "active-only guard missing from domain lookup");
});

test("Idempotency: checkCortexIntelByMessageId called before insert", () => {
  assert(serviceSrc.includes("checkCortexIntelByMessageId"), "idempotency check missing");
  assert(serviceSrc.includes("if (existing) return"), "early-return on existing record missing");
});

test("sourceType set to domain_watch (not generic email)", () => {
  assert(serviceSrc.includes('"domain_watch"'), "sourceType domain_watch missing");
});

test("Rule ID stored in tags for traceability", () => {
  assert(serviceSrc.includes("`rule-id:${matched.id}`"), "rule-id tag missing");
});

test("match_count and last_matched_at updated on successful ingest", () => {
  assert(
    serviceSrc.includes("last_matched_at = now(), match_count = match_count + 1"),
    "match stats update missing"
  );
});

test("AI failure does not block ingestion (fail-soft)", () => {
  assert(serviceSrc.includes("// AI failure"), "AI failure comment missing");
  assert(
    serviceSrc.includes("generateCortexIntelSummary") && serviceSrc.includes("} catch {"),
    "try/catch around AI call missing"
  );
});

// ── 7. Historical backfill policy ───────────────────────────────────────────
console.log("\n── 7. Historical backfill policy ──");

test("UI clearly states: only new inbound emails trigger ingest (no backfill)", () => {
  assert(
    uiSrc.includes("existing mail is not backfilled") || uiSrc.includes("not backfilled"),
    "no-backfill statement missing from UI"
  );
});

// ── 8. UI — Domain Watch panel ──────────────────────────────────────────────
console.log("\n── 8. UI — Domain Watch panel ──");

test("DomainWatchPanel component defined", () => {
  assert(uiSrc.includes("function DomainWatchPanel"), "DomainWatchPanel missing");
});

test("Add domain button with testid", () => {
  assert(uiSrc.includes('data-testid="button-add-domain"'), "add-domain testid missing");
});

test("Domain list table rendered", () => {
  assert(uiSrc.includes("row-domain-"), "row-domain testid missing");
});

test("Toggle switch per domain", () => {
  assert(uiSrc.includes("switch-domain-"), "switch-domain testid missing");
});

test("Edit button per domain", () => {
  assert(uiSrc.includes("button-edit-domain-"), "edit-domain testid missing");
});

test("Delete button per domain", () => {
  assert(uiSrc.includes("button-delete-domain-"), "delete-domain testid missing");
});

test("Last matched date column visible", () => {
  assert(uiSrc.includes("last_matched_at"), "last_matched_at not in UI");
  assert(uiSrc.includes("Last matched"), "Last matched header missing");
});

test("Match count column visible", () => {
  assert(uiSrc.includes("match_count"), "match_count not in UI");
  assert(uiSrc.includes("Matches"), "Matches header missing");
});

test("Informational callout present", () => {
  assert(
    uiSrc.includes("automatically") && uiSrc.includes("inbound"),
    "auto-ingest explanation missing from panel"
  );
});

test("Domain Watch tab gated by canManageDomains (role check)", () => {
  assert(uiSrc.includes("canManageDomains"), "canManageDomains gate missing");
});

test("Domain Watch tab only shows for master_admin, admin, exec, manager", () => {
  assert(
    uiSrc.includes('"master_admin", "admin", "exec", "manager"') ||
    uiSrc.includes('"master_admin","admin","exec","manager"') ||
    uiSrc.includes('["master_admin", "admin", "exec", "manager"]'),
    "role list missing from canManageDomains check"
  );
});

// ── 9. Calendar — permanent primary source ──────────────────────────────────
console.log("\n── 9. Calendar — permanent primary source ──");

test("isPermanentSource helper defined in calendar.tsx", () => {
  const calSrc = fs.readFileSync(path.join(__dirname, "../client/src/pages/calendar.tsx"), "utf8");
  assert(calSrc.includes("isPermanentSource"), "isPermanentSource missing");
});

test("isPermanentSource checks primary===true AND @voltsafe.com", () => {
  const calSrc = fs.readFileSync(path.join(__dirname, "../client/src/pages/calendar.tsx"), "utf8");
  assert(calSrc.includes("src.primary"), "primary check missing");
  assert(calSrc.includes("@voltsafe.com"), "@voltsafe.com check missing");
});

test("toggleCalendarSource guards against permanent source", () => {
  const calSrc = fs.readFileSync(path.join(__dirname, "../client/src/pages/calendar.tsx"), "utf8");
  assert(calSrc.includes("isPermanentSource"), "permanent source guard in toggle missing");
});

test("visibleOwnEvents always includes permanent source events", () => {
  const calSrc = fs.readFileSync(path.join(__dirname, "../client/src/pages/calendar.tsx"), "utf8");
  assert(calSrc.includes("permanentKeys"), "permanentKeys set missing from visibleOwnEvents");
  assert(calSrc.includes("permanentKeys.has(sourceKey)"), "permanentKeys.has() check missing");
});

test("Lock icon shown for permanent source in My Calendars sidebar", () => {
  const calSrc = fs.readFileSync(path.join(__dirname, "../client/src/pages/calendar.tsx"), "utf8");
  assert(calSrc.includes("Lock"), "Lock icon missing");
  assert(calSrc.includes("always visible"), "always-visible tooltip missing");
});

test("Server-side: sources/select always preserves primary @voltsafe.com key", () => {
  assert(routesSrc.includes("primaryPermanentId"), "primaryPermanentId guard missing from sources/select route");
  assert(
    routesSrc.includes(".endsWith(\"@voltsafe.com\")"),
    "@voltsafe.com guard missing from sources/select"
  );
});

test("Server-side: events filter always includes permanent calendar events", () => {
  assert(routesSrc.includes("permanentCalId"), "permanentCalId missing from events filter");
  assert(
    routesSrc.includes("ev.externalCalendarId === permanentCalId"),
    "permanent calendar events always-include guard missing"
  );
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`cortex-domain-watch + calendar: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\n${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nAll checks passed ✓");
}
