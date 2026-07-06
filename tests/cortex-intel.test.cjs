/**
 * Cortex Intel Library — regression + structure test suite
 *
 * Covers: saved-state visibility, duplicate/upsert prevention, library page,
 * AI relevance retrieval, prompt format, source discipline, permissions,
 * route coverage, and UI component structure.
 *
 * Run: node tests/cortex-intel.test.cjs
 */

"use strict";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── 1. Service: cortex-intel.ts ────────────────────────────────────────────

const svc = readFile("server/services/cortex-intel.ts");

console.log("\n[1] Service — cortex-intel.ts");

ok("exports INTEL_TYPES constant", svc.includes("export const INTEL_TYPES"));
ok("exports IMPORTANCE_LEVELS constant", svc.includes("export const IMPORTANCE_LEVELS"));
ok("exports USE_FOR_OPTIONS constant", svc.includes("export const USE_FOR_OPTIONS"));

ok("migration creates cortex_email_intel table", svc.includes("CREATE TABLE IF NOT EXISTS cortex_email_intel"));
ok("migration creates partial unique index on mail_message_id", svc.includes("CREATE UNIQUE INDEX IF NOT EXISTS") && svc.includes("idx_cortex_intel_message_id_active") && svc.includes("WHERE deleted_at IS NULL"));

ok("exports checkCortexIntelByMessageId", svc.includes("export async function checkCortexIntelByMessageId"));
ok("exports getCortexIntelById", svc.includes("export async function getCortexIntelById"));
ok("exports listCortexIntelRecords", svc.includes("export async function listCortexIntelRecords"));
ok("exports createCortexIntelRecord", svc.includes("export async function createCortexIntelRecord"));
ok("exports upsertCortexIntelRecord", svc.includes("export async function upsertCortexIntelRecord"));
ok("exports updateCortexIntelRecord", svc.includes("export async function updateCortexIntelRecord"));
ok("exports deleteCortexIntelRecord", svc.includes("export async function deleteCortexIntelRecord"));

ok("listCortexIntelRecords accepts useFor filter", svc.includes("useFor?: string"));
ok("listCortexIntelRecords accepts tags filter", svc.includes("tags?: string[]"));
ok("listCortexIntelRecords accepts senderEmail filter", svc.includes("senderEmail?: string"));
ok("listCortexIntelRecords accepts dateFrom filter", svc.includes("dateFrom?: string"));
ok("listCortexIntelRecords accepts dateTo filter", svc.includes("dateTo?: string"));
ok("listCortexIntelRecords accepts savedByUserId filter", svc.includes("savedByUserId?: number"));

ok("upsert handles existing record (update path)", svc.includes("const existing = await checkCortexIntelByMessageId") && svc.includes("created: false"));
ok("upsert handles soft-deleted record (restore path)", svc.includes("deleted_at IS NOT NULL") && svc.includes("deleted_at = NULL"));
ok("upsert returns created:true for new records", svc.includes("created: true"));

ok("deleteCortexIntelRecord does soft delete (sets deleted_at)", svc.includes("SET deleted_at = NOW()") && svc.includes("RETURNING id"));

ok("getCortexIntelForPrompt accepts recipientName param", svc.includes("recipientName?:"));
ok("getCortexIntelForPrompt accepts accountName param", svc.includes("accountName?:"));
ok("getCortexIntelForPrompt accepts topicHints param", svc.includes("topicHints?:"));
ok("getCortexIntelForPrompt accepts useForPurpose param", svc.includes("useForPurpose?:"));
ok("getCortexIntelForPrompt implements JS-side relevance scoring (impWeight)", svc.includes("impWeight"));
ok("getCortexIntelForPrompt implements tag overlap scoring", svc.includes("score += 3") && svc.includes("recTags"));
ok("getCortexIntelForPrompt implements recency scoring", svc.includes("ageDays") && svc.includes("score += 3"));
ok("getCortexIntelForPrompt fetches broader pool for scoring (LIMIT 50)", svc.includes("LIMIT 50"));
ok("getCortexIntelForPrompt uses new structured CORTEX INDUSTRY INTEL format", svc.includes("CORTEX INDUSTRY INTEL:"));
ok("getCortexIntelForPrompt emits Source: line", svc.includes("- Source:"));
ok("getCortexIntelForPrompt emits Fact: line", svc.includes("- Fact:"));
ok("getCortexIntelForPrompt emits Strategic relevance: line", svc.includes("- Strategic relevance:"));
ok("getCortexIntelForPrompt emits Suggested usage angle: line", svc.includes("- Suggested usage angle:"));
ok("getCortexIntelForPrompt includes source discipline instruction (do not invent)", svc.includes("do not force") || svc.includes("Do not invent") || svc.includes("do NOT force"));
ok("generateCortexIntelSummary instructs AI to preserve statistics exactly", svc.includes("preserve them exactly") || svc.includes("verbatim or very close"));
ok("generateCortexIntelSummary instructs AI not to invent facts", svc.includes("Do not invent") || svc.includes("Only extract facts that are clearly stated"));

// ── 2. Routes: server/routes.ts ────────────────────────────────────────────

const routes = readFile("server/routes.ts");

console.log("\n[2] Routes — server/routes.ts");

ok("GET /api/cortex-intel exists", routes.includes('app.get("/api/cortex-intel"'));
ok("GET /api/cortex-intel/check/:mailMessageId exists", routes.includes('app.get("/api/cortex-intel/check/:mailMessageId"'));
ok("GET /api/cortex-intel/:id exists", routes.includes('app.get("/api/cortex-intel/:id"'));
ok("POST /api/cortex-intel/generate-summary exists", routes.includes('app.post("/api/cortex-intel/generate-summary"'));
ok("POST /api/cortex-intel uses upsert (not create+409)", routes.includes("upsertCortexIntelRecord") && !routes.match(/status\(409\)[^;]{0,80}Already ingested/));
ok("PUT /api/cortex-intel/:id exists", routes.includes('app.put("/api/cortex-intel/:id"'));
ok("DELETE /api/cortex-intel/:id exists", routes.includes('app.delete("/api/cortex-intel/:id"'));
ok("DELETE route checks owner or admin before deleting", routes.includes("created_by_user_id !== userId") && routes.includes("403"));
ok("GET list route accepts useFor filter param", routes.includes("useFor: useFor"));
ok("GET list route accepts senderEmail filter param", routes.includes("senderEmail: senderEmail"));
ok("GET list route accepts dateFrom filter param", routes.includes("dateFrom: dateFrom"));
ok("GET list route accepts tags filter param", routes.includes("parsedTags"));
ok("All cortex routes use requireAuth", (() => {
  const cortexSection = routes.slice(routes.indexOf("// GET /api/cortex-intel"), routes.indexOf("// ── Awaiting-reply"));
  const routeDecls = cortexSection.match(/app\.(get|post|put|delete)\("/g) || [];
  const authDecls = cortexSection.match(/requireAuth/g) || [];
  return authDecls.length >= routeDecls.length;
})());

// ── 3. AI generation context injection ────────────────────────────────────

const aiGen = readFile("server/services/crm-ai-summary.ts");

console.log("\n[3] AI generation — crm-ai-summary.ts");

ok("AI generation imports getCortexIntelForPrompt", aiGen.includes("getCortexIntelForPrompt"));
ok("AI generation passes recipientName context", aiGen.includes("recipientName:"));
ok("AI generation passes accountName context", aiGen.includes("accountName:"));
ok("AI generation passes topicHints context", aiGen.includes("topicHints:"));
ok("AI generation passes useForPurpose: AI email writing", aiGen.includes('"AI email writing"'));

// ── 4. Library page — cortex-intel-library.tsx ────────────────────────────

const libPage = readFile("client/src/pages/cortex-intel-library.tsx");

console.log("\n[4] Library page — cortex-intel-library.tsx");

ok("Library page exports default component", libPage.includes("export default function CortexIntelLibrary"));
ok("Library page uses search input", libPage.includes('data-testid="intel-search-input"'));
ok("Library page has intel-type filter", libPage.includes('data-testid="filter-intel-type"'));
ok("Library page has importance filter", libPage.includes('data-testid="filter-importance"'));
ok("Library page has use-for filter", libPage.includes('data-testid="filter-use-for"'));
ok("Library page has sender email filter", libPage.includes('data-testid="filter-sender"'));
ok("Library page has date-from filter", libPage.includes('data-testid="filter-date-from"'));
ok("Library page has date-to filter", libPage.includes('data-testid="filter-date-to"'));
ok("Library page has toggle filters button", libPage.includes('data-testid="btn-toggle-filters"'));
ok("Library page renders intel rows with test id", libPage.includes('data-testid={`intel-row-${r.id}`}'));
ok("Library page shows delete button in detail sheet", libPage.includes('data-testid="btn-delete-intel"'));
ok("Library page shows edit button in detail sheet", libPage.includes('data-testid="btn-edit-intel"'));
ok("Library page has pagination previous button", libPage.includes('data-testid="btn-prev-page"'));
ok("Library page has pagination next button", libPage.includes('data-testid="btn-next-page"'));
ok("Library page uses SaveToCortexModal for editing", libPage.includes("SaveToCortexModal"));
ok("Library page passes correct query key", libPage.includes('"/api/cortex-intel"'));
ok("Library page constructs query params for all filters", libPage.includes("qParams.toString()"));
ok("Library page shows empty state when no records", libPage.includes("No Cortex intel saved yet") || libPage.includes("No records match"));
ok("Library page shows loading skeletons", libPage.includes("Skeleton"));
ok("Library page has importance-colored dots per record", libPage.includes("bg-purple-400") && libPage.includes("bg-amber-400") && libPage.includes("bg-blue-400"));

// ── 5. Nav config ─────────────────────────────────────────────────────────

const nav = readFile("client/src/lib/nav-config.ts");

console.log("\n[5] Navigation — nav-config.ts");

ok("Nav includes cortex-intel-library entry", nav.includes("cortex-intel-library"));
ok("Nav entry has route /cortex/intel", nav.includes('"/cortex/intel"'));
ok("Nav entry is in Insights section (near copilot)", (() => {
  const copilotIdx = nav.indexOf('"copilot"');
  const cortexIdx = nav.indexOf('"cortex-intel-library"');
  return cortexIdx > 0 && Math.abs(cortexIdx - copilotIdx) < 400;
})());

// ── 6. App.tsx — route registration ───────────────────────────────────────

const app = readFile("client/src/App.tsx");

console.log("\n[6] App.tsx — route registration");

ok("App.tsx has CortexIntelLibraryPage lazy import", app.includes("CortexIntelLibraryPage"));
ok("App.tsx has /cortex/intel route", app.includes('"/cortex/intel"') && app.includes("CortexIntelLibraryPage"));

// ── 7. Saved-state indicator — email-actions-toolbar.tsx ──────────────────

const toolbar = readFile("client/src/components/inbox/email-actions-toolbar.tsx");

console.log("\n[7] Email toolbar — saved-state indicator");

ok("Toolbar queries cortex check for focused message", toolbar.includes("/api/cortex-intel/check") && toolbar.includes("focusedMessage?.id"));
ok("Toolbar exposes isSavedToCortex state", toolbar.includes("isSavedToCortex"));
ok("Cortex button shows 'In Cortex' label when saved", toolbar.includes("In Cortex"));
ok("Cortex button shows teal saved-dot indicator when saved", toolbar.includes('data-testid="cortex-saved-dot"'));
ok("Cortex button tooltip changes text based on saved state", toolbar.includes("click to edit") || toolbar.includes("Saved to Cortex"));
ok("Cortex button gets highlighted bg when saved", toolbar.includes("bg-cyan-500/10") && toolbar.includes("isSavedToCortex"));

// ── 8. Save-to-cortex modal — duplicate-free POST behaviour ───────────────

const modal = readFile("client/src/components/inbox/save-to-cortex-modal.tsx");

console.log("\n[8] SaveToCortexModal — duplicate prevention");

ok("Modal POSTs to /api/cortex-intel", modal.includes('apiRequest("POST", "/api/cortex-intel"'));
ok("Modal has check query for existing record", modal.includes("/api/cortex-intel/check"));
ok("Modal pre-fills form from existing record when already saved", modal.includes("setExistingRecord") && modal.includes("setIntelType"));
ok("Modal shows 'Already saved to Cortex' notice", modal.includes("Already saved to Cortex"));
ok("Modal has Update path for existing record", modal.includes("updateMutation") && modal.includes("PUT"));
ok("Modal invalidates cortex-intel query on success", modal.includes('invalidateQueries({ queryKey: ["/api/cortex-intel"] })'));

// ── Results ────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);

if (failures.length > 0) {
  console.error("\nFailed checks:");
  failures.forEach(f => console.error(`  • ${f}`));
  process.exit(1);
}

console.log("\n✓ All Cortex Intel checks passed");
process.exit(0);
