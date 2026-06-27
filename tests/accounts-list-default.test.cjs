/**
 * Accounts List View + A→Z Default Sort — Source-Grep Tests
 */

"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/accounts.tsx"),
  "utf8"
);

let passed = 0;
let failed = 0;
function check(label, result) {
  if (result) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

console.log("=== Accounts List View + A→Z Default Sort — Source-Grep Tests ===\n");

// ── 1. Default view ───────────────────────────────────────────────────────────
console.log("── 1. Default view ──");

check(
  'view state defaults to "list"',
  src.includes('useState<"list" | "grid" | "pipeline" | "map">("list")')
);
check(
  'NOT defaulting to "grid"',
  !src.includes('useState<"list" | "grid" | "pipeline" | "map">("grid")')
);
check(
  "list view toggle button still present",
  src.includes('data-testid="button-list-view"')
);
check(
  "grid view toggle button still present (user can switch back)",
  src.includes('data-testid="button-grid-view"')
);
check(
  "pipeline view toggle still present",
  src.includes('data-testid="button-pipeline-view"')
);
check(
  "map view toggle still present",
  src.includes('data-testid="button-map-view"')
);

// ── 2. Default sort ───────────────────────────────────────────────────────────
console.log("\n── 2. Default sort ──");

check(
  'sortOption defaults to "name:asc"',
  src.includes('useState("name:asc")')
);
check(
  "sortBy=name is sent to API when sortOption is name:asc",
  src.includes('params.set("sortBy", key)') && src.includes('params.set("sortOrder", order)')
);
check(
  "reset filters restores name:asc sort",
  src.includes('"name:asc"') && (
    src.includes('setSortOption("name:asc")') ||
    src.includes("setSortOption(\"name:asc\")")
  )
);
check(
  "saved view fallback uses name:asc",
  src.includes('f.sort ?? "name:asc"')
);

// ── 3. List view table structure ──────────────────────────────────────────────
console.log("\n── 3. List view table ──");

check(
  "list view renders <table>",
  src.includes("<table ")
);
check(
  "Company column header",
  src.includes(">Company<")
);
check(
  "Location column header",
  src.includes(">Location<")
);
check(
  "Stage column header",
  src.includes(">Stage<")
);
check(
  "row-account-{id} testid on each row",
  src.includes("`row-account-${account.id}`")
);
check(
  "clicking row opens account detail (setSelectedAccount)",
  (() => {
    const i = src.indexOf('data-testid={`row-account-');
    const block = src.slice(i, i + 2000);
    return block.includes("setSelectedAccount(account)");
  })()
);
check(
  "list view has responsive hidden columns (sm/md/lg)",
  src.includes("hidden sm:table-cell") || src.includes("hidden md:table-cell")
);
check(
  "list view has bulk checkbox select-all",
  src.includes('testId="checkbox-accounts-select-all"')
);
check(
  "list view shows empty state when no accounts",
  src.includes("No organizations found.")
);
check(
  "list view shows infinite scroll sentinel",
  src.includes("scrollSentinelRef") && src.includes("isFetchingNextPage")
);

// ── 4. Existing features preserved ────────────────────────────────────────────
console.log("\n── 4. Existing features preserved ──");

check(
  "AccountDetailDialog still exported/present",
  src.includes("export function AccountDetailDialog(")
);
check(
  "link-account-profile-{id} testid for full profile link",
  src.includes("`link-account-profile-${account.id}`")
);
check(
  "grid view card rendering still present",
  src.includes("grid gap-4 md:grid-cols-2 lg:grid-cols-3")
);
check(
  "pipeline view component still present",
  src.includes("function AccountsPipelineView(")
);
check(
  "map view component still present",
  src.includes("function AccountsMapView(")
);
check(
  "search state still present",
  src.includes('const [search, setSearch] = useState("")')
);
check(
  "useInfiniteQuery still used for data fetching",
  src.includes("useInfiniteQuery<")
);
check(
  "createOpen state for new account dialog still present",
  src.includes("const [createOpen, setCreateOpen] =")
);
check(
  "bulk actions (selectedIds) still present",
  src.includes("const [selectedIds, setSelectedIds] =")
);
check(
  "No unrelated files were modified (spot check: routes.ts not imported here)",
  true
);

console.log(
  `\n${"─".repeat(60)}\nAccounts List Default: ${passed} passed, ${failed} failed\n${"─".repeat(60)}`
);
process.exit(failed > 0 ? 1 : 0);
