"use strict";
// ── Email Tools (Snippets & Templates) — Regression Tests ────────────────────
// Source-grep tests: verify structural invariants without a live server.
// All assertions inspect source files directly.

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

console.log("=== Email Tools (Snippets & Templates) — Regression Suite ===\n");

// ── 1. Database migration ─────────────────────────────────────────────────
console.log("── 1. DB migration (migration 0032) ────────────────────────────────────");
const routes = read("server/routes.ts");
ok("email_snippets CREATE TABLE IF NOT EXISTS", routes.includes("CREATE TABLE IF NOT EXISTS email_snippets"));
ok("migration 0032 comment", routes.includes("migration 0032"));
ok("owner_user_id REFERENCES users(id)", routes.includes("owner_user_id INTEGER REFERENCES users(id)"));
ok("snippet_type column", routes.includes("snippet_type TEXT NOT NULL DEFAULT"));
ok("sharing_scope column", routes.includes("sharing_scope TEXT NOT NULL DEFAULT"));
ok("is_starter column", routes.includes("is_starter BOOLEAN NOT NULL DEFAULT FALSE"));
ok("usage_count column", routes.includes("usage_count INTEGER NOT NULL DEFAULT 0"));
ok("is_archived column", routes.includes("is_archived BOOLEAN NOT NULL DEFAULT FALSE"));
ok("idx_email_snippets_owner index", routes.includes("idx_email_snippets_owner"));
ok("idx_email_snippets_scope index", routes.includes("idx_email_snippets_scope"));
ok("migration logged", routes.includes("[migration] email_snippets table ready."));

// ── 2. API routes ─────────────────────────────────────────────────────────
console.log("\n── 2. API routes ────────────────────────────────────────────────────────");
ok("GET /api/email-snippets registered", routes.includes('app.get("/api/email-snippets"'));
ok("POST /api/email-snippets registered", routes.includes('app.post("/api/email-snippets"'));
ok("PATCH /api/email-snippets/:id registered", routes.includes('app.patch("/api/email-snippets/:id"'));
ok("DELETE /api/email-snippets/:id registered", routes.includes('app.delete("/api/email-snippets/:id"'));
ok("POST /api/email-snippets/:id/use registered", routes.includes('app.post("/api/email-snippets/:id/use"'));
ok("POST /api/email-snippets/seed-defaults registered", routes.includes('app.post("/api/email-snippets/seed-defaults"'));
ok("seed-defaults requires admin", routes.includes('seed-defaults", requireAuth, requireAdmin'));

// ── 3. Permission model ───────────────────────────────────────────────────
console.log("\n── 3. Permission model ──────────────────────────────────────────────────");
ok("isSnippetAdmin helper defined", routes.includes("function isSnippetAdmin("));
ok("admin role check uses globalRole", routes.includes("EMAIL_SNIPPET_ADMIN_ROLES.has(user?.globalRole)"));
ok("master_admin in admin set", routes.includes('"master_admin"'));
ok("ceo in admin set", routes.includes('"ceo"'));
ok("ownership check on PATCH", routes.includes("Not your snippet"));
ok("ownership check on DELETE", routes.includes("owner_user_id !== userId"));
ok("archived items excluded from GET", routes.includes("is_archived = FALSE"));
ok("usage_count increment on /use", routes.includes("usage_count = usage_count + 1"));

// ── 4. Starter snippet seed data ──────────────────────────────────────────
console.log("\n── 4. Starter seed data ─────────────────────────────────────────────────");
ok("STARTER_SNIPPETS array defined", routes.includes("const STARTER_SNIPPETS = ["));
ok("Thanks for Reaching Out starter", routes.includes("Thanks for Reaching Out"));
ok("Cold Email starter template", routes.includes("Cold Email"));
ok("is_starter = TRUE on seed", routes.includes("is_starter = TRUE"));
ok("seed uses duplicate check", routes.includes("is_starter = TRUE LIMIT 1"));

// ── 5. Navigation ─────────────────────────────────────────────────────────
console.log("\n── 5. Navigation (sidebar + searchable) ─────────────────────────────────");
const nav = read("client/src/lib/nav-config.ts");
ok("marketing-email-tools nav entry", nav.includes('"marketing-email-tools"'));
ok("Email Tools label", nav.includes('"Email Tools"'));
ok("/marketing/email-tools route in nav", nav.includes('"/marketing/email-tools"'));
ok("StickyNote icon used", nav.includes("StickyNote"));
ok("Email Tools in SEARCHABLE entries", nav.includes('"Email Tools"') && nav.includes('"Canned Replies"'));
ok("Snippets alias in searchable", nav.includes('"Snippets"'));
ok("Snippets & Templates searchable entry", nav.includes('"Snippets & Templates"'));

// ── 6. App routing ────────────────────────────────────────────────────────
console.log("\n── 6. App routing ───────────────────────────────────────────────────────");
const app = read("client/src/App.tsx");
ok("EmailToolsPage lazy import", app.includes("EmailToolsPage"));
ok("email-tools lazy path", app.includes('"@/pages/email-tools"'));
ok("/marketing/email-tools route", app.includes('"/marketing/email-tools"'));
ok("email-tools route not behind crm guard", app.includes('wrap(<EmailToolsPage />)'));

// ── 7. Page component ─────────────────────────────────────────────────────
console.log("\n── 7. Page component (email-tools.tsx) ──────────────────────────────────");
const page = read("client/src/pages/email-tools.tsx");
ok("email-tools-heading testid", page.includes('data-testid="email-tools-heading"'));
ok("new-snippet-btn testid", page.includes('data-testid="new-snippet-btn"'));
ok("seed-defaults-btn testid", page.includes('data-testid="seed-defaults-btn"'));
ok("search-snippets testid", page.includes('data-testid="search-snippets"'));
ok("filter by type tabs (template literal pattern)", page.includes("filter-type-${t}"));
ok("filter by category", page.includes('data-testid="filter-category"'));
ok("filter by scope", page.includes('data-testid="filter-scope"'));
ok("snippet-count testid", page.includes('data-testid="snippet-count"'));
ok("snippet-card testid pattern", page.includes('data-testid={`snippet-card-${s.id}`}'));
ok("edit button per card", page.includes('data-testid={`edit-snippet-${s.id}`}'));
ok("delete button per card", page.includes('data-testid={`delete-snippet-${s.id}`}'));
ok("duplicate button per card", page.includes('data-testid={`duplicate-snippet-${s.id}`}'));
ok("confirm-delete testid", page.includes('data-testid="confirm-delete-snippet"'));
ok("save-snippet-btn testid", page.includes('data-testid="save-snippet-btn"'));
ok("uses /api/email-snippets query", page.includes('"/api/email-snippets"'));
ok("PATCH mutation on edit", page.includes('"PATCH"'));
ok("DELETE mutation on delete", page.includes('"DELETE"'));
ok("seed-defaults mutation", page.includes('"/api/email-snippets/seed-defaults"'));
ok("org vs private sharing scope selector", page.includes("Org-wide (everyone can use)"));
ok("empty state shows for zero snippets", page.includes("empty-state"));
ok("admin sees Load Starter Library", page.includes("Load Starter Library"));
ok("empty state new snippet btn", page.includes("empty-new-snippet-btn"));
ok("snippet type select", page.includes('data-testid="select-snippet-type"'));
ok("snippet category select", page.includes('data-testid="select-snippet-category"'));

// ── 8. Cortex knowledge — stale references removed ───────────────────────
console.log("\n── 8. Cortex knowledge base — stale refs removed ────────────────────────");
const kb = read("docs/ai-knowledge-base.json");
const kbRuntime = read("server/data/help-center/ai-knowledge-base.json");
ok("docs KB: /execution/communications removed", !kb.includes("/execution/communications"));
ok("docs KB: Go to Communications removed", !kb.includes("Go to Communications"));
ok("docs KB: Settings > Snippets removed", !kb.includes("Settings > Snippets"));
ok("docs KB: new snippet Q&A present", kb.includes("marketing/email-tools") || kb.includes("Email Tools"));
ok("runtime KB: /execution/communications removed", !kbRuntime.includes("/execution/communications"));
ok("runtime KB: Go to Communications removed", !kbRuntime.includes("Go to Communications"));
ok("runtime KB: Settings > Snippets removed", !kbRuntime.includes("Settings > Snippets"));
ok("runtime KB: new snippet Q&A present", kbRuntime.includes("marketing/email-tools") || kbRuntime.includes("Email Tools"));

// ── 9. Operations manual ──────────────────────────────────────────────────
console.log("\n── 9. Operations manual updates ─────────────────────────────────────────");
const manual = read("docs/operations-manual.md");
ok("Communications section updated to Marketing Campaigns", manual.includes("Marketing → Campaigns"));
ok("/marketing/campaigns route in manual", manual.includes("/marketing/campaigns"));
ok("Snippets & Templates section added", manual.includes("Snippets & Templates"));
ok("/marketing/email-tools route in manual", manual.includes("/marketing/email-tools"));
ok("Org-wide visibility explained", manual.includes("Org-wide"));
ok("/execution/communications removed from manual", !manual.includes("/execution/communications"));

// ── 10. Rebuild system ────────────────────────────────────────────────────
console.log("\n── 10. Knowledge rebuild system ─────────────────────────────────────────");
const refresh = read("server/services/help-center-refresh.ts");
ok("runStartupRefresh exported", refresh.includes("export async function runStartupRefresh"));
ok("startup refresh uses deployment-ID gate (not date)", refresh.includes("runDeploymentIdGatedRebuild"));
ok("startup refresh skips when same deployment already succeeded", refresh.includes("last_successfully_indexed_deployment_id === currentId"));
ok("startHelpCenterRefreshScheduler still exported", refresh.includes("export function startHelpCenterRefreshScheduler"));
const indexTs = read("server/index.ts");
ok("runStartupRefresh imported in index.ts", indexTs.includes("runStartupRefresh"));
ok("runStartupRefresh called on startup", indexTs.includes("runStartupRefresh()"));

// ── Results ───────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(60));
console.log(`Email Tools — Snippets & Templates`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log("All tests passed ✓");
}
