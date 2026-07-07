// tests/marketing-drilldown-polish.test.cjs
// Phase 2 polish tests: export route, row detail, filter chips,
// count reconciliation, per-metric empty states, compliance actions,
// reply actions, hot-account actions, task creation, mark reviewed.

"use strict";
const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function contains(src, pattern) {
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

function grepCount(file, pattern) {
  try {
    const out = execSync(
      `grep -c "${pattern}" "${path.join(__dirname, "..", file)}"`,
      { encoding: "utf8" }
    ).trim();
    return Number(out);
  } catch { return 0; }
}

// ─────────────────────────────────────────────────────────────────────────────
// [1] Backend export route
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1] Backend export route — server/routes.ts");
{
  const src = readFile("server/routes.ts");

  assert(
    contains(src, "GET /api/marketing/drilldown/export"),
    "export route comment/registration exists"
  );
  assert(
    contains(src, '"/api/marketing/drilldown/export"'),
    'app.get("/api/marketing/drilldown/export") registered'
  );
  assert(
    contains(src, "requireAuth") && contains(src, 'requirePermission("crm", "view")'),
    "export route has requireAuth + requirePermission(crm, view)"
  );
  assert(
    contains(src, "EXPORT_CAP"),
    "EXPORT_CAP constant declared"
  );
  assert(
    contains(src, "EXPORT_CAP = 5000"),
    "EXPORT_CAP is 5000"
  );
  assert(
    contains(src, "setCsvHeaders") && contains(src, "toCsv"),
    "export route uses setCsvHeaders + toCsv helpers"
  );
  assert(
    contains(src, "Unknown metric"),
    "export route returns 400 for unknown metric"
  );

  // Contact WHERE map in export
  assert(
    contains(src, "CONTACT_WHERE"),
    "CONTACT_WHERE map declared in export route"
  );
  assert(
    contains(src, "unknown_jurisdiction") && contains(src, "jurisdiction_canada"),
    "CONTACT_WHERE covers unknown_jurisdiction + jurisdiction_canada"
  );
  assert(
    contains(src, "implied_expiring_30") && contains(src, "implied_expired"),
    "CONTACT_WHERE covers implied_expiring_30 + implied_expired"
  );
  assert(
    contains(src, "missing_consent_proof") && contains(src, "unknown_consent"),
    "CONTACT_WHERE covers missing_consent_proof + unknown_consent"
  );
  assert(
    contains(src, "unsubscribed") && contains(src, "suppressed") && contains(src, "quarantined"),
    "CONTACT_WHERE covers unsubscribed + suppressed + quarantined"
  );

  // Campaign export
  assert(
    contains(src, "CAMPAIGN_METRICS"),
    "CAMPAIGN_METRICS list declared in export route"
  );
  assert(
    contains(src, "campaigns_blocked") && contains(src, "avg_unsub_rate"),
    "Campaign export handles blocked + rate metrics"
  );

  // Reply export
  assert(
    contains(src, "REPLY_STATUS_WHERE"),
    "REPLY_STATUS_WHERE map declared in export route"
  );
  assert(
    contains(src, "replies_pending") && contains(src, "replies_task_created"),
    "Reply export handles pending + task_created metrics"
  );

  // Hot accounts export
  assert(
    contains(src, "hot_accounts_by_label") && contains(src, "marketing_hot_accounts_"),
    "Hot accounts export handled with correct filename prefix"
  );

  // CSV filename pattern
  assert(
    contains(src, "marketing_${metric}_${dateStr}"),
    "export filenames use metric + dateStr"
  );

  // LIMIT cap in export SQL
  assert(
    contains(src, "LIMIT ${EXPORT_CAP}"),
    "export SQL queries use LIMIT ${EXPORT_CAP}"
  );

  // drilldown-export error log
  assert(
    contains(src, "[drilldown-export]"),
    "export route has its own error log prefix"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] DrilldownConfig type — cardCount field
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] DrilldownConfig type");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(
    contains(src, "cardCount?: number"),
    "DrilldownConfig has optional cardCount field"
  );
  assert(
    contains(src, "cardCount"),
    "cardCount is used in the component"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] Export button in MarketingDrilldownSheet
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] Export CSV button");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(
    contains(src, 'data-testid="btn-drilldown-export"'),
    "btn-drilldown-export testid present"
  );
  assert(
    contains(src, "handleExport"),
    "handleExport function defined"
  );
  assert(
    contains(src, "window.location.href"),
    "export triggers browser download via window.location.href"
  );
  assert(
    contains(src, "/api/marketing/drilldown/export"),
    "export points to correct API endpoint"
  );
  assert(
    contains(src, "Download"),
    "Download icon imported and used"
  );
  assert(
    contains(src, "disabled={isLoading || total === 0}"),
    "export button disabled when no rows"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] Count reconciliation
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] Count reconciliation");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(
    contains(src, 'data-testid="drilldown-count-mismatch"'),
    "drilldown-count-mismatch testid present"
  );
  assert(
    contains(src, "countMismatch"),
    "countMismatch variable declared"
  );
  assert(
    contains(src, "cardCount !== undefined && cardCount !== total && total > 0"),
    "countMismatch logic: cardCount defined + differs + total > 0"
  );
  assert(
    contains(src, "Updated: {total.toLocaleString()}"),
    'count mismatch shows "Updated: X" label'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] Filter chips
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] Filter chips");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(
    contains(src, 'data-testid="drilldown-filter-chips"'),
    "drilldown-filter-chips testid present"
  );
  assert(
    contains(src, "FilterChips"),
    "FilterChips component defined"
  );
  assert(
    contains(src, "onClearSearch"),
    "FilterChips has onClearSearch prop for removable search chip"
  );
  assert(
    contains(src, "metric.replace(/_/g"),
    "metric chip uses human-readable label"
  );
  assert(
    contains(src, "Tag"),
    "Tag icon used in filter chips"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [6] Row detail panel
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] Row detail panel");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(
    contains(src, 'data-testid="drilldown-row-detail"'),
    "drilldown-row-detail testid present"
  );
  assert(
    contains(src, "RowDetailPanel"),
    "RowDetailPanel component defined"
  );
  assert(
    contains(src, 'data-testid="btn-detail-close"'),
    "btn-detail-close testid present"
  );
  assert(
    contains(src, "selectedRow"),
    "selectedRow state declared"
  );
  assert(
    contains(src, "handleRowClick"),
    "handleRowClick function defined"
  );
  assert(
    contains(src, "DetailField"),
    "DetailField helper component defined"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [7] Compliance remediation actions (contact metrics)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[7] Compliance remediation actions");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(
    contains(src, 'data-testid="btn-detail-open-contact"'),
    "btn-detail-open-contact testid in row detail panel"
  );
  assert(
    contains(src, "CONTACT_METRICS.has(metric) && row.id"),
    "open-contact button gated on CONTACT_METRICS + row.id"
  );
  assert(
    contains(src, 'href={`/contacts/${row.id}`}'),
    "open-contact links to /contacts/:id"
  );
  assert(
    contains(src, 'data-testid="btn-detail-open-campaign"'),
    "btn-detail-open-campaign testid in row detail panel"
  );
  assert(
    contains(src, '/marketing/campaigns/${row.id}'),
    "open-campaign links to /marketing/campaigns/:id"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [8] Hot account actions
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[8] Hot account actions");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(
    contains(src, 'data-testid="btn-detail-open-account"'),
    "btn-detail-open-account testid present"
  );
  assert(
    contains(src, "hot_accounts_by_label") && contains(src, 'href={`/accounts/${row.account_id}`}'),
    "hot account detail links to /accounts/:account_id"
  );
  assert(
    contains(src, "metric === \"hot_accounts_by_label\"") || contains(src, "metric === 'hot_accounts_by_label'"),
    "hot_accounts_by_label condition used in component"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [9] Reply actions
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[9] Reply actions");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(
    contains(src, 'data-testid="btn-detail-open-mail"'),
    "btn-detail-open-mail testid present"
  );
  assert(
    contains(src, "Open in VoltSafe Mail"),
    '"Open in VoltSafe Mail" label present'
  );
  assert(
    contains(src, "/gmail?search="),
    "open-in-mail links to gmail search"
  );
  assert(
    contains(src, 'data-testid="btn-detail-mark-reviewed"'),
    "btn-detail-mark-reviewed testid in row detail panel"
  );
  assert(
    contains(src, "Mark as Reviewed"),
    '"Mark as Reviewed" label present'
  );
  assert(
    contains(src, "markReviewedMutation"),
    "markReviewedMutation declared"
  );
  assert(
    contains(src, "/api/marketing/replies/${replyId}/review"),
    "markReviewed calls /api/marketing/replies/:id/review"
  );
  assert(
    contains(src, "btn-mark-reviewed-"),
    "btn-mark-reviewed- testid pattern in table row actions"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [10] Task creation
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[10] Task creation");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(
    contains(src, 'data-testid="btn-detail-create-task"'),
    "btn-detail-create-task testid in row detail panel"
  );
  assert(
    contains(src, "Create Follow-up Task"),
    '"Create Follow-up Task" label present'
  );
  assert(
    contains(src, "createTaskMutation"),
    "createTaskMutation declared"
  );
  assert(
    contains(src, "/api/tasks"),
    "task mutation calls /api/tasks"
  );
  assert(
    contains(src, "handleCreateTask"),
    "handleCreateTask function defined"
  );
  assert(
    contains(src, "btn-create-task-"),
    "btn-create-task- testid pattern in table row actions"
  );
  assert(
    contains(src, "apiRequest"),
    "apiRequest imported and used"
  );
  assert(
    contains(src, "useMutation"),
    "useMutation imported"
  );
  assert(
    contains(src, "useToast"),
    "useToast imported for feedback"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [11] Metric category sets
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[11] Metric category sets");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(contains(src, "CONTACT_METRICS"),   "CONTACT_METRICS set declared");
  assert(contains(src, "CAMPAIGN_METRICS"),  "CAMPAIGN_METRICS set declared");
  assert(contains(src, "REPLY_METRICS"),     "REPLY_METRICS set declared");

  assert(
    contains(src, "\"unknown_jurisdiction\"") && contains(src, "\"implied_expired\""),
    "CONTACT_METRICS includes key compliance entries"
  );
  assert(
    contains(src, "\"campaigns_blocked\"") && contains(src, "\"avg_unsub_rate\""),
    "CAMPAIGN_METRICS includes blocked + rate entries"
  );
  assert(
    contains(src, "\"replies_pending\"") && contains(src, "\"replies_task_created\""),
    "REPLY_METRICS includes pending + task_created entries"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [12] Per-metric empty states
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[12] Per-metric empty states");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(contains(src, "METRIC_EMPTY_STATES"), "METRIC_EMPTY_STATES map declared");

  const cases = [
    ["express_consent",    "No contacts currently have express consent"],
    ["campaigns_blocked",  "No campaigns are currently blocked"],
    ["spam_complaint_rate","No spam complaints found"],
    ["form_opt_in_rate",   "Form opt-in tracking is not yet configured"],
    ["implied_expired",    "No contacts with expired implied consent"],
    ["missing_consent_proof", "All Canadian express-consent contacts"],
    ["unknown_jurisdiction",  "All contacts have a jurisdiction on file"],
    ["unknown_consent",       "All contacts have a consent classification"],
    ["hot_accounts_by_label", "No engaged accounts found"],
  ];
  for (const [key, snippet] of cases) {
    assert(contains(src, snippet), `METRIC_EMPTY_STATES: ${key} has informative message`);
  }

  assert(
    contains(src, "METRIC_EMPTY_STATES[metric]"),
    "METRIC_EMPTY_STATES used as fallback in empty state render"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [13] Existing UI invariants preserved
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[13] Existing UI invariants preserved");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");

  assert(contains(src, 'data-testid="marketing-drilldown-sheet"'), "marketing-drilldown-sheet testid preserved");
  assert(contains(src, 'data-testid="drilldown-total"'),           "drilldown-total badge preserved");
  assert(contains(src, 'data-testid="btn-drilldown-refresh"'),     "btn-drilldown-refresh preserved");
  assert(contains(src, 'data-testid="btn-drilldown-close"'),       "btn-drilldown-close preserved");
  assert(contains(src, 'data-testid="input-drilldown-search"'),    "input-drilldown-search preserved");
  assert(contains(src, 'data-testid="drilldown-table"'),           "drilldown-table preserved");
  assert(contains(src, 'data-testid="drilldown-pagination"'),      "drilldown-pagination preserved");
  assert(contains(src, 'data-testid="btn-drilldown-prev"'),        "btn-drilldown-prev preserved");
  assert(contains(src, 'data-testid="btn-drilldown-next"'),        "btn-drilldown-next preserved");
  assert(contains(src, 'data-testid="drilldown-empty"'),           "drilldown-empty preserved");
  assert(contains(src, 'data-testid="drilldown-row-'),             "drilldown-row-{id} pattern preserved");
  assert(contains(src, "RefreshCw"),                               "RefreshCw icon preserved");
  assert(contains(src, "PAGE_SIZE"),                               "PAGE_SIZE constant preserved");
}

// ─────────────────────────────────────────────────────────────────────────────
// [14] Sheet max-w upgrade (now max-w-5xl)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[14] Sheet width upgrade");
{
  const src = readFile("client/src/components/marketing/marketing-drilldown-sheet.tsx");
  assert(
    contains(src, "max-w-5xl") || contains(src, "max-w-4xl"),
    "Sheet uses at least max-w-4xl to accommodate detail panel"
  );
  assert(
    contains(src, "flex-1 flex min-h-0 overflow-hidden"),
    "body area uses flex row for table + detail panel layout"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [15] Regression — existing marketing-drilldown tests still pass
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[15] Regression — existing marketing-drilldown.test.cjs");
{
  try {
    const output = execSync(
      "node tests/marketing-drilldown.test.cjs",
      { cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 30000 }
    );
    const m = output.match(/(\d+) passed.*?(\d+) failed/);
    if (m) {
      const p = Number(m[1]);
      const f = Number(m[2]);
      assert(f === 0,  `existing tests: 0 failures (got ${f})`);
      assert(p >= 155, `existing tests: ≥155 passing (got ${p})`);
    } else {
      assert(output.includes("PASSED") || output.includes("passed"), "existing tests report PASSED");
    }
  } catch (e: any) {
    assert(false, `existing marketing-drilldown.test.cjs threw: ${String(e).slice(0, 120)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`marketing-drilldown-polish: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailed checks:");
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log("ALL CHECKS PASSED ✓");
process.exit(0);
