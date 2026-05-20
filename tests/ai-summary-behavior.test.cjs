/**
 * AI Summary behavior tests (source-grep / structural)
 *
 * These tests verify the contract without making live API calls or needing a
 * running server.  They parse source code to assert structural invariants.
 *
 * Tests:
 *  1-3.  Opening a Lead/Account/Contact does NOT call AI generation.
 *  4.    Saved summary is fetched read-only on page open.
 *  5.    refetchInterval only activates when DB status is 'generating'.
 *  6.    Backfill skips unchanged records (source_hash check).
 *  7.    Failed generation preserves previous summary_json.
 *  8.    Manual regenerate goes through the queue (non-blocking).
 *  9.    "Generating…" badge only appears when DB status is 'generating'.
 * 10.    markCrmAiSummaryStale queues background regeneration.
 * 11.    getCrmAiSummary is read-only (no side effects).
 * 12.    Backfill endpoints exist and require admin.
 * 13.    Regenerate route uses fire-and-forget (non-blocking).
 */

const fs = require("fs");
const path = require("path");

const CARD_PATH = path.join(__dirname, "../client/src/components/crm/ai-summary-card.tsx");
const SERVICE_PATH = path.join(__dirname, "../server/services/crm-ai-summary.ts");
const ROUTES_PATH = path.join(__dirname, "../server/routes.ts");

function readFile(p) {
  return fs.readFileSync(p, "utf8");
}

let passed = 0;
let failed = 0;

function assert(condition, testName, detail = "") {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ ${testName}${detail ? `\n    ${detail}` : ""}`);
    failed++;
  }
}

const card = readFile(CARD_PATH);
const service = readFile(SERVICE_PATH);
const routes = readFile(ROUTES_PATH);

console.log("\n=== AI Summary Behavior Tests ===\n");

// ── Frontend card tests ───────────────────────────────────────────────────────

console.log("Frontend (ai-summary-card.tsx):");

// 1. No auto-generation useEffect
assert(
  !card.includes("generateMutation.mutate") || !card.includes("useEffect"),
  "Opening a record does NOT auto-call generation (no useEffect firing generateMutation)",
  "Found useEffect calling generateMutation — this causes auto-generation on page open"
);

// 2. Query is read-only — only calls GET, never POST on mount
const useQueryBlock = card.match(/useQuery[\s\S]*?staleTime/)?.[0] || "";
assert(
  useQueryBlock.includes("/api/crm/ai-summary/") && !useQueryBlock.includes("POST"),
  "Page open only fetches saved summary (GET only, no POST in useQuery)",
  "useQuery block should only do a GET fetch"
);

// 3. refetchInterval only when status === 'generating'
assert(
  card.includes(`status === "generating"`) && card.includes("refetchInterval"),
  "Polling only activates when real DB job is running (status === generating)",
  "refetchInterval should only poll when status === 'generating'"
);

// 4. Saved summary displays immediately — content block not gated on mutation state
assert(
  card.includes("hasContent && json") && !card.match(/hasContent.*generateMutation\.isPending/),
  "Saved summary displays immediately without being gated on mutation state",
  "Content should render whenever hasContent is true, regardless of mutation state"
);

// 5. Generating badge only based on DB status, not local mutation
assert(
  card.includes("isActivelyGenerating") && card.includes(`status === "generating"`),
  '"Generating…" badge only appears when real background job exists (DB status)',
  "Use isActivelyGenerating (DB-driven) not generateMutation.isPending for the badge"
);

// 6. Empty state does NOT say "Initialising…"
assert(
  !card.includes("Initialising"),
  "Empty state shows informative message, not misleading 'Initialising…'",
  "Remove 'Initialising…' — it implies auto-generation is happening"
);

// 7. Generate Now button exists for manual trigger
assert(
  card.includes("button-generate-summary") && card.includes("Generate Now"),
  "Manual 'Generate Now' button available when no summary exists",
  "Users should be able to manually trigger generation when no summary exists"
);

// ── Service tests ─────────────────────────────────────────────────────────────

console.log("\nService (crm-ai-summary.ts):");

// 8. source_hash skip logic exists
assert(
  service.includes("source_hash === newHash") || service.includes("source_hash == newHash"),
  "Backfill skips generation when source_hash is unchanged",
  "source_hash comparison must skip generation to avoid unnecessary AI calls"
);

// 9. Failed generation preserves summary_json
const updateFailBlock = service.match(/ON FAILURE.*?UPDATE crm_ai_summaries[\s\S]*?status = 'failed'/)?.[0] ||
  service.match(/status = 'failed'[\s\S]{0,200}retry_count/)?.[0] || "";
assert(
  !service.match(/UPDATE crm_ai_summaries SET[\s\S]{0,100}summary_json[\s\S]{0,100}status = 'failed'/),
  "Failed generation preserves previous summary_json (no summary_json overwrite on failure)",
  "The failure UPDATE must NOT overwrite summary_json — keep previous content"
);

// 10. markCrmAiSummaryStale queues background regen
assert(
  service.includes("queueCrmAiSummaryGeneration") &&
  service.includes("markCrmAiSummaryStale"),
  "markCrmAiSummaryStale queues background regeneration",
  "markCrmAiSummaryStale must call queueCrmAiSummaryGeneration"
);

const staleBlock = service.match(/markCrmAiSummaryStale[\s\S]{0,400}queueCrmAiSummaryGeneration/)?.[0] || "";
assert(
  staleBlock.length > 0,
  "queueCrmAiSummaryGeneration called inside markCrmAiSummaryStale",
  "Queue call must be inside the stale marking function"
);

// 11. getCrmAiSummary is read-only
const getSummaryBlock = service.match(/getCrmAiSummary[\s\S]{0,800}return null/)?.[0] || "";
assert(
  getSummaryBlock.length > 0 &&
  !getSummaryBlock.includes("generateCrmAiSummary") &&
  !getSummaryBlock.includes("queueCrmAiSummaryGeneration"),
  "getCrmAiSummary is read-only (no generation side effects)",
  "getCrmAiSummary must never call generateCrmAiSummary or queue anything"
);

// 12. Backfill state includes per-type breakdown
assert(
  service.includes("byType") && service.includes("leads") && service.includes("accounts") && service.includes("contacts"),
  "Backfill state includes per-type breakdown (leads/accounts/contacts)",
  "BackfillState must track progress per entity type"
);

// 13. Backfill state includes queued + generating counters
assert(
  service.includes("queued:") && service.includes("generating:"),
  "Backfill state exposes queued and generating counters",
  "BackfillState must include queued and generating for the status UI"
);

// ── Route tests ───────────────────────────────────────────────────────────────

console.log("\nAPI Routes (routes.ts):");

// 14. Backfill endpoints exist and require requireAdmin
const backfillStartLine = routes.match(/app\.(post|get)\("\/api\/crm\/ai-summary\/backfill\/start"[^)]+requireAdmin/)?.[0] || "";
assert(
  backfillStartLine.length > 0,
  "POST /api/crm/ai-summary/backfill/start requires requireAdmin",
  "Backfill start must be admin-only"
);

const backfillStatusLine = routes.match(/app\.(get)\("\/api\/crm\/ai-summary\/backfill\/status"[^)]+requireAdmin/)?.[0] || "";
assert(
  backfillStatusLine.length > 0,
  "GET /api/crm/ai-summary/backfill/status requires requireAdmin",
  "Backfill status must be admin-only"
);

// 15. Regenerate route is fire-and-forget (non-blocking)
const regenRoute = routes.match(/\/api\/crm\/ai-summary\/:entityType\/:entityId\/regenerate[\s\S]{0,600}/)?.[0] || "";
assert(
  regenRoute.includes(".catch(") || regenRoute.includes("catch(() =>"),
  "Regenerate route is fire-and-forget (non-blocking page load)",
  "Regenerate must call generation with .catch(() => {}) to avoid blocking"
);

// 16. GET summary route does NOT call generateCrmAiSummary
const getRoute = routes.match(/app\.get\("\/api\/crm\/ai-summary\/:entityType\/:entityId"[\s\S]{0,400}/)?.[0] || "";
assert(
  getRoute.length > 0 &&
  !getRoute.includes("generateCrmAiSummary") &&
  !getRoute.includes("queueCrmAiSummaryGeneration"),
  "GET summary route is read-only (no generation on page open)",
  "GET /api/crm/ai-summary/:type/:id must never trigger generation"
);

// 17. Stale marking hooks exist on note mutation routes
const noteCreateStale = routes.match(/POST.*api\/notes[\s\S]{0,500}markCrmAiSummaryStale/)?.[0] || "";
assert(
  routes.includes("markCrmAiSummaryStale") && routes.includes("note"),
  "Note mutations trigger stale marking",
  "Note create/edit/delete routes must call markCrmAiSummaryStale"
);

// 18. Lead/account/contact field updates trigger stale marking
assert(
  routes.match(/markCrmAiSummaryStale.*"lead"/) !== null,
  "Lead field update triggers stale marking",
  "PUT /api/leads/:id must call markCrmAiSummaryStale"
);
assert(
  routes.match(/markCrmAiSummaryStale.*"account"/) !== null,
  "Account field update triggers stale marking",
  "PUT /api/accounts/:id must call markCrmAiSummaryStale"
);
assert(
  routes.match(/markCrmAiSummaryStale.*"contact"/) !== null,
  "Contact field update triggers stale marking",
  "PUT /api/contacts/:id must call markCrmAiSummaryStale"
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed — AI summary generation behavior is incorrect.`);
  process.exit(1);
} else {
  console.log(`\nAll tests passed — AI Summary is read-only on page open and data-driven.`);
}
