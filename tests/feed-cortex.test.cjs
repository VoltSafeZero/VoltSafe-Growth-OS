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
check("CortexBrainVisual used in JSX (not misnamed)", page.includes("<CortexBrainVisual"));
check("no stale CortexBrainSvg reference",           !page.includes("CortexBrainSvg"));
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
check("ask uses buildOpenAIModelParams tokenLimit 600", routes.includes("tokenLimit: 600") || routes.includes("max_tokens: 600"));
check("ask slices question to 2000 chars",           routes.includes(".slice(0, 2000)"));

// ── Breathing animation — lockstep brain + button ─────────────────────────────

check("ANIM_CSS constant defined",                   page.includes("ANIM_CSS"));
check("cortex-breathe keyframe defined",             page.includes("cortex-breathe"));
check("cortex-btn-glow keyframe defined",            page.includes("cortex-btn-glow"));
check("brain wrapper uses cortex-breathe-svg class", page.includes("cortex-breathe-svg"));
check("button wrapper uses cortex-breathe-btn class",page.includes("cortex-breathe-btn"));
check("brain and button share same 4s duration",     (function() {
  const a = page.match(/cortex-breathe\s+4s/g) || [];
  const b = page.match(/cortex-btn-glow\s+4s/g) || [];
  return a.length >= 1 && b.length >= 1;
})());
check("reduced-motion media query disables animations", page.includes("prefers-reduced-motion: reduce"));
check("reduced-motion targets cortex-breathe-svg",   page.includes("prefers-reduced-motion") && page.includes("cortex-breathe-svg"));
check("reduced-motion targets cortex-breathe-btn",   page.includes("prefers-reduced-motion") && page.includes("cortex-breathe-btn"));
check("no layout shift: animation uses opacity/filter not scale/translate",
  page.includes("cortex-breathe") && !page.match(/cortex-breathe[^}]*scale|cortex-breathe[^}]*translate/));
check("digesting class speeds up animation while loading", page.includes("cortex-digesting"));
check("digesting state wired to ingestMutation.isPending",
  page.includes("cortex-digesting") && page.includes("isPending"));
check("animation works in light and dark: no hard-coded dark bg on animated wrapper",
  !page.match(/cortex-breathe-svg[^"]*bg-slate|cortex-breathe-btn[^"]*bg-slate/));

// ── Clickable brain → Cortex Status modal ─────────────────────────────────────

check("brain visual is a button element",            page.includes('data-testid="button-brain-status"'));
check("brain button has aria-label",                 page.includes('aria-label="View Cortex status"'));
check("brain button opens status modal",             page.includes("setStatusOpen(true)") || page.includes("setStatusOpen"));
check("CortexStatusDialog component defined",        page.includes("function CortexStatusDialog"));
check("CortexStatusDialog has data-testid",          page.includes('data-testid="dialog-cortex-status"'));
check("status dialog shows total URLs stat",         page.includes("URLs learned") || page.includes("history.length"));
check("status dialog shows today count stat",        page.includes("Learned today") || page.includes("todayRecords.length"));
check("status dialog shows AI context count",        page.includes("In AI context") || page.includes("use_in_ai_context"));
check("status dialog has cortexStatusMessage helper",page.includes("function cortexStatusMessage") || page.includes("cortexStatusMessage"));
check("status dialog shows top domains",             page.includes("Top domains") || page.includes("topDomains") || page.includes("domainFreq"));

// ── Clickable today cards + history rows → URL detail modal ──────────────────

check("UrlDetailDialog component defined",           page.includes("function UrlDetailDialog"));
check("UrlDetailDialog has data-testid",             page.includes('data-testid="dialog-url-detail"'));
check("URL detail modal shows learned bullets",      page.includes("What Cortex learned") || page.includes("deriveBullets"));
check("URL detail modal shows creator name",         page.includes("created_by_name") && page.includes("Saved by"));
check("URL detail modal shows timestamp",            page.includes("Saved at") || page.includes("format(new Date"));
check("URL detail modal shows AI context status",    page.includes("use_in_ai_context") && page.includes("AI context"));
check("URL detail modal has Open Source action",     page.includes("Open Source"));
check("URL detail modal has View in Cortex Intel action", page.includes("View in Cortex Intel"));
check("today cards are clickable (button/onClick)", (function() {
  const idx = page.indexOf("card-cortex-today-");
  const block = page.slice(Math.max(0, idx - 200), idx + 100);
  return block.includes("button") || block.includes("onClick");
})());
check("today cards open selectedRecord on click",    page.includes("setSelectedRecord(r)"));
check("today card external link does not navigate app", page.includes("e.stopPropagation()"));
check("history rows are clickable buttons",         (function() {
  const idx = page.indexOf("row-cortex-history-");
  const block = page.slice(Math.max(0, idx - 200), idx + 100);
  return block.includes("button") || block.includes("onClick");
})());
check("history rows have cursor-pointer affordance", page.includes("cursor-pointer"));
check("history rows show ChevronRight affordance",   page.includes("ChevronRight"));

// ── Point-form summaries ──────────────────────────────────────────────────────

check("deriveBullets function defined",              page.includes("function deriveBullets"));
check("deriveBullets uses ai_summary",               page.includes("ai_summary") && page.includes("deriveBullets"));
check("deriveBullets has metadata fallback",         page.includes("Captured for Cortex AI context") || page.includes("metadata fallback") || page.includes("intel_type"));
check("bullets rendered per today card",             page.includes("bullets-today-") || page.includes("bullets.map"));
check("bullets capped at 3",                         page.includes("slice(0, 3)"));

// ── Contrast / visual hierarchy ───────────────────────────────────────────────

check("section headings use font-bold",              page.includes("font-bold"));
check("today empty state has strong copy",           page.includes("Cortex hasn") || page.includes("hasn't learned") || page.includes("hasn\\'t learned"));
check("history empty state shows helpful copy",      page.includes("Paste a URL above") || page.includes("start building"));
check("today cards have hover border effect",        page.includes("hover:border-teal"));
check("history rows have hover border/bg effect",    page.includes("hover:border-teal") || page.includes("hover:bg-accent"));
check("dialog imports from ui/dialog",               page.includes('@/components/ui/dialog'));

// ── Backend: history includes notes + tags ────────────────────────────────────

check("history SELECT includes user_notes",          routes.includes("c.user_notes"));
check("history SELECT includes tags",                routes.includes("c.tags"));
check("HistoryRecord type has user_notes field",     page.includes("user_notes"));
check("HistoryRecord type has tags field",           page.includes("tags:") || page.includes("tags |"));

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\nFeed CORTEX tests: ${passed} passed, ${failed} failed\n`);
if (failures.length > 0) {
  console.error("Failed checks:\n" + failures.map(f => `  - ${f}`).join("\n"));
  process.exit(1);
} else {
  console.log("All checks passed.");
  process.exit(0);
}
