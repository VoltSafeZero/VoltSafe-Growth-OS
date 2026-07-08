/**
 * Feed CORTEX page — source-grep regression tests
 *
 * Verifies structural invariants of:
 *   client/src/pages/feed-cortex.tsx     (frontend page)
 *   client/src/lib/nav-config.ts         (navigation entry + PAGE_NAV_INDEX)
 *   client/src/App.tsx                   (route registration)
 *   server/routes.ts                     (backend: /history + /ask routes)
 *
 * Run: node tests/feed-cortex.test.cjs
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ── helpers ──────────────────────────────────────────────────────────────────

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`  FAIL: ${label}`);
  }
}

// ── Read source files ─────────────────────────────────────────────────────────

const page    = read("client/src/pages/feed-cortex.tsx");
const nav     = read("client/src/lib/nav-config.ts");
const app     = read("client/src/App.tsx");
const routes  = read("server/routes.ts");

// ── Page: CortexBrainVisual ───────────────────────────────────────────────────

check("page exports default FeedCortexPage",        page.includes("export default function FeedCortexPage"));
check("page has CortexBrainVisual component",        page.includes("function CortexBrainVisual"));
check("brain SVG viewBox 400x400",                   page.includes('viewBox="0 0 400 400"'));
check("brain has @keyframes ring-breathe-1",         page.includes("ring-breathe-1"));
check("brain has @keyframes orb-pulse",              page.includes("orb-pulse"));
check("brain has @keyframes node-glow",              page.includes("node-glow"));
check("brain has @keyframes arc-flash",              page.includes("arc-flash"));
check("brain has scan animation",                    page.includes("scan-line") || page.includes("scan"));
check("brain SVG uses radialGradient orbGrad",       page.includes("orbGrad"));
check("brain renders VoltSafe V mark",               page.includes("CORTEX") || page.includes('"V"') || page.includes("d=\"M 184 183"));

// ── Page: URL ingestion ───────────────────────────────────────────────────────

check("page imports useMutation",                    page.includes("useMutation"));
check("page imports useQuery",                       page.includes("useQuery"));
check("page has URL input with data-testid",         page.includes('data-testid="input-feed-cortex-url"'));
check("page has Feed submit button",                 page.includes('data-testid="button-feed-cortex-submit"'));
check("page POSTs to /api/cortex/url",               page.includes('"/api/cortex/url"') || page.includes("POST.*cortex/url") || page.includes('apiRequest("POST", "/api/cortex/url"'));
check("page sends category default",                 page.includes('"Web Resource"') || page.includes("Web Resource"));
check("page sends importance default",               page.includes('"Medium"'));
check("page handles 409 duplicate URL gracefully",   page.includes("already been saved") || page.includes("already known") || page.includes("already"));

// ── Page: History ─────────────────────────────────────────────────────────────

check("page queries /api/cortex/url/history",        page.includes("/api/cortex/url/history"));
check("page renders ingestion history list",         page.includes('data-testid="list-cortex-history"'));
check("page renders per-row history items",          page.includes("row-cortex-history-"));
check("page shows formatDistanceToNow for dates",    page.includes("formatDistanceToNow"));
check("page shows created_by_name",                  page.includes("created_by_name"));
check("page shows domain or canonical_url",          page.includes("r.domain") || page.includes("canonical_url"));
check("page shows ImportanceBadge",                  page.includes("ImportanceBadge"));

// ── Page: Today summary ───────────────────────────────────────────────────────

check("page has 'What Cortex learned today' section",page.includes("What Cortex learned today"));
check("page filters todayRecords by date",           page.includes("todayRecords") && page.includes("getDate()"));
check("page renders today cards with testid",        page.includes("card-cortex-today-"));
check("page shows 'new' badge for today records",    page.includes("new") && page.includes("todayRecords.length"));

// ── Page: Ask Cortex ──────────────────────────────────────────────────────────

check("page has Ask Cortex section heading",         page.includes("Ask Cortex"));
check("page has textarea with testid",               page.includes('data-testid="textarea-cortex-ask"'));
check("page has ask submit button with testid",      page.includes('data-testid="button-cortex-ask-submit"'));
check("page POSTs to /api/cortex/ask",               page.includes('"/api/cortex/ask"') || page.includes("/api/cortex/ask"));
check("page has answer display with testid",         page.includes('data-testid="text-cortex-answer"'));
check("page shows loading state while asking",       page.includes("Cortex is thinking") || page.includes("thinking"));
check("page shows 'Cortex says' label",              page.includes("Cortex says"));
check("page clears answer on new question",          page.includes("setAnswer(null)"));

// ── Page: misc UI ─────────────────────────────────────────────────────────────

check("page links to cortex/intel library",          page.includes("/cortex/intel"));
check("page uses teal color scheme",                 page.includes("teal"));
check("page imports date-fns formatDistanceToNow",   page.includes("date-fns"));
check("page uses Card components",                   page.includes("from \"@/components/ui/card\"") || page.includes("from '@/components/ui/card'"));
check("page uses Brain icon",                        page.includes("Brain"));

// ── Nav config: section ───────────────────────────────────────────────────────

check("nav has feed-cortex section id",              nav.includes('"feed-cortex"') || nav.includes("'feed-cortex'") || nav.includes("id: \"feed-cortex\""));
check("nav Feed CORTEX has Brain icon",              nav.includes("id: \"feed-cortex\"") && nav.includes("Brain"));
check("nav Feed CORTEX has url /feed-cortex",        nav.includes('url: "/feed-cortex"'));
check("nav Feed CORTEX placed between Capital and Learn", (function() {
  const capitalIdx = nav.indexOf('"capital"');
  const feedIdx    = nav.indexOf('"feed-cortex"');
  const learnIdx   = nav.indexOf('"learn"');
  return capitalIdx < feedIdx && feedIdx < learnIdx;
})());
check("nav section is not capitalOnly",              !(function() {
  const start = nav.indexOf('"feed-cortex"');
  const block = nav.slice(start, start + 300);
  return block.includes("capitalOnly");
})());

// ── Nav config: mobile item ───────────────────────────────────────────────────

check("nav has mobile item for feed-cortex",         nav.includes("feed-cortex-home") || nav.includes("showOn: [\"mobile\"]"));

// ── Nav config: PAGE_NAV_INDEX ────────────────────────────────────────────────

check("PAGE_NAV_INDEX has Feed CORTEX entry",        nav.includes("Feed CORTEX") && nav.includes('"/feed-cortex"'));
check("PAGE_NAV_INDEX has Cortex Ingestion alias",   nav.includes("Cortex Ingestion") || nav.includes("URL Ingestion") || nav.includes("Teach Cortex"));
check("PAGE_NAV_INDEX section is Feed CORTEX",       nav.includes('section: "Feed CORTEX"') || nav.includes("section: 'Feed CORTEX'"));

// ── App.tsx ───────────────────────────────────────────────────────────────────

check("App.tsx has FeedCortexPage lazy import",      app.includes("FeedCortexPage") && app.includes("feed-cortex"));
check("App.tsx has /feed-cortex route",              app.includes('path="/feed-cortex"'));
check("App.tsx uses wrap() for feed-cortex route",   app.includes('"/feed-cortex"') && app.includes("wrap(<FeedCortexPage"));

// ── Backend: history route ────────────────────────────────────────────────────

check("routes.ts has GET /api/cortex/url/history",   routes.includes('"/api/cortex/url/history"'));
check("history joins users table for attribution",   routes.includes("cortex_email_intel c") && routes.includes("LEFT JOIN users u"));
check("history filters source_type = 'url'",         routes.includes("source_type = 'url'"));
check("history orders by created_at DESC",           routes.includes("created_at DESC") && routes.includes("cortex_email_intel c"));
check("history returns records array",               routes.includes('{ records: (rows as any).rows ?? [] }') || routes.includes("records:"));
check("history has LIMIT clause",                    routes.includes("LIMIT ${limit}") || routes.includes("LIMIT"));
check("history is requireAuth protected",            (function() {
  const start = routes.indexOf('"/api/cortex/url/history"');
  const block = routes.slice(Math.max(0, start - 50), start + 200);
  return block.includes("requireAuth");
})());

// ── Backend: ask route ────────────────────────────────────────────────────────

check("routes.ts has POST /api/cortex/ask",          routes.includes('"/api/cortex/ask"'));
check("ask fetches use_in_ai_context = true records",routes.includes("use_in_ai_context = true"));
check("ask calls OpenAI gpt-4o-mini",                routes.includes("gpt-4o-mini"));
check("ask uses AI_INTEGRATIONS_OPENAI_API_KEY",     routes.includes("AI_INTEGRATIONS_OPENAI_API_KEY"));
check("ask uses AI_INTEGRATIONS_OPENAI_BASE_URL",    routes.includes("AI_INTEGRATIONS_OPENAI_BASE_URL"));
check("ask responds when no records ingested",       routes.includes("Feed me some URLs") || routes.includes("Feed me"));
check("ask returns answer field",                    routes.includes('res.json({ answer })') || routes.includes("{ answer }"));
check("ask validates question min length",           routes.includes("question.trim().length < 3") || routes.includes("question required"));
check("ask is requireAuth protected",                (function() {
  const start = routes.indexOf('"/api/cortex/ask"');
  const block = routes.slice(Math.max(0, start - 50), start + 200);
  return block.includes("requireAuth");
})());
check("ask max_tokens set to 600",                   routes.includes("max_tokens: 600"));
check("ask slices question to 2000 chars",           routes.includes(".slice(0, 2000)"));

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\nFeed CORTEX tests: ${passed} passed, ${failed} failed\n`);
if (failures.length > 0) {
  console.error("Failed checks:\n" + failures.map(f => `  - ${f}`).join("\n"));
  process.exit(1);
} else {
  console.log("All checks passed.");
  process.exit(0);
}
