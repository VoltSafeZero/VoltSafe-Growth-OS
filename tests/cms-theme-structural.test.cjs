/**
 * CMS Structural Theme Regression Test
 *
 * Scans all client/src TSX/TS files for hardcoded dark structural classes that
 * should use semantic design tokens (bg-background, bg-card, bg-muted,
 * text-foreground, text-muted-foreground, border-border) instead.
 *
 * Every match must appear in ALLOWLIST with a documented reason.
 * Any unapproved match causes the test to fail — catching future regressions.
 *
 * Run: node tests/cms-theme-structural.test.cjs
 */

"use strict";

const fs   = require("fs");
const path = require("path");

let passed   = 0;
let failed   = 0;
const failures = [];

function ok(name, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failed++;
    const msg = detail ? `${name}\n    ${detail}` : name;
    failures.push(msg);
    console.error(`  FAIL: ${name}${detail ? "\n    " + detail : ""}`);
  }
}

// ─── Walk client/src recursively ─────────────────────────────────────────────
function walk(dir, exts) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some(x => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

const ROOT    = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "client", "src");
const files   = walk(SRC_DIR, [".tsx", ".ts"]);

// ─── Patterns to scan ────────────────────────────────────────────────────────
// These are hardcoded dark-surface Tailwind classes that force dark appearance
// regardless of the current theme.  All matches must be allowlisted below.
const PATTERNS = [
  // Dark-only backgrounds (no light-mode paired class) ─────────────────────
  { label: "bg-slate-950",     re: /\bbg-slate-950\b/ },
  { label: "bg-slate-900",     re: /\bbg-slate-900\b/ },
  { label: "bg-slate-800",     re: /\bbg-slate-800\b/ },
  { label: "bg-gray-950",      re: /\bbg-gray-950\b/  },
  { label: "bg-gray-900",      re: /\bbg-gray-900\b/  },
  { label: "bg-zinc-950",      re: /\bbg-zinc-950\b/  },
  { label: "bg-zinc-900",      re: /\bbg-zinc-900\b/  },
  // Hardcoded hex backgrounds ───────────────────────────────────────────────
  { label: "bg-[#0a0f1a]",     re: /bg-\[#0a0f1a\]/   },
  { label: "bg-[#050b14]",     re: /bg-\[#050b14\]/   },
  { label: "bg-[#020617]",     re: /bg-\[#020617\]/   },
  // Hardcoded dark borders ──────────────────────────────────────────────────
  { label: "border-slate-700", re: /\bborder-slate-700\b/ },
  { label: "border-slate-800", re: /\bborder-slate-800\b/ },
  // Hardcoded near-white text (implies a forced-dark background) ────────────
  { label: "text-slate-100",   re: /\btext-slate-100\b/ },
  { label: "text-slate-200",   re: /\btext-slate-200\b/ },
];

// ─── Allowlist ────────────────────────────────────────────────────────────────
// Each entry must match a file+pattern that the scanner will find.
// `fileSubstr` — unique substring of the relative file path
// `lineSubstr` — unique substring that appears on the matching line
// `reason`     — why this is intentional and must not be tokenized
const ALLOWLIST = [
  // ── Category 2: Semantic score-level color palette (score-badge.tsx) ─────
  // The "low" score tier uses slate as a deliberate neutral shade distinct
  // from bg-muted, so that all 5 tiers (critical → low) have visually distinct
  // named colors.
  {
    fileSubstr: "components/scores/score-badge.tsx",
    lineSubstr: "bg-slate-100 dark:bg-slate-800",
    reason: "Semantic 'low' score tier — bg-slate-800 is one of 5 named score-level color pairs",
  },
  {
    fileSubstr: "components/scores/score-badge.tsx",
    lineSubstr: "border-slate-200 dark:border-slate-700",
    reason: "Semantic 'low' score tier border — paired with the bg-slate-800 above",
  },

  // ── Category 2: Named task-label color swatches ───────────────────────────
  // 'slate' is one of ~10 named label colors (red, blue, green, slate, …).
  // These are user-visible label names, not structural surfaces.
  {
    fileSubstr: "components/tasks/task-detail-drawer.tsx",
    lineSubstr: "dark:bg-slate-800",
    reason: "Named 'slate' task-label swatch — one of many label color options, not structural chrome",
  },
  {
    fileSubstr: "hooks/use-task-columns.ts",
    lineSubstr: "dark:border-slate-700",
    reason: "Named 'slate' task-label border swatch — same label color system as task-detail-drawer",
  },

  // ── Category 4: Public standalone branded pages (outside the CMS shell) ──
  // These three pages render without the app shell; they use VoltSafe's brand
  // dark navy as the full-page background.  Tokenizing them to bg-background
  // would break the brand presentation on these public-facing URLs.
  {
    fileSubstr: "pages/unsubscribe.tsx",
    lineSubstr: "bg-[#0a0f1a]",
    reason: "Public unsubscribe page — intentional VoltSafe brand dark background, outside CMS shell",
  },
  {
    fileSubstr: "pages/preferences.tsx",
    lineSubstr: "bg-[#0a0f1a]",
    reason: "Public email-preferences page — same brand dark background as unsubscribe, outside CMS shell",
  },
  {
    fileSubstr: "pages/unsubscribe-compliance.tsx",
    lineSubstr: "bg-[#0a0f1a]",
    reason: "Public compliance-unsubscribe page — same brand dark background, outside CMS shell",
  },

  // ── Category 4 (cont.): Investor portal — public token-gated page ─────────
  // investor-portal.tsx renders without the CMS shell using a fixed dark navy
  // brand theme (slate-800/slate-700 palette).  These cannot use CSS theme
  // variables because the page is served publicly with no user session.
  {
    fileSubstr: "pages/investor-portal.tsx",
    lineSubstr: "border-b border-slate-800 bg-[#0c1d36]",
    reason: "Public investor portal header — fixed brand dark navy, outside CMS shell (no session)",
  },
  {
    fileSubstr: "pages/investor-portal.tsx",
    lineSubstr: "border border-slate-700/60 rounded-xl",
    reason: "Public investor portal material card border — fixed brand slate palette, outside CMS shell",
  },
  {
    fileSubstr: "pages/investor-portal.tsx",
    lineSubstr: "bg-slate-800/60 border border-slate-700/40",
    reason: "Public investor portal locked-doc indicator — fixed brand slate palette, outside CMS shell",
  },
  {
    fileSubstr: "pages/investor-portal.tsx",
    lineSubstr: "border-t border-slate-800",
    reason: "Public investor portal footer divider — fixed brand slate palette, outside CMS shell",
  },
];

// ─── Scan all files ───────────────────────────────────────────────────────────
console.log("\n[CMS Structural Theme Regression]\n");

const hits = []; // { relPath, lineNo, label, lineText }

for (const filePath of files) {
  const rel   = filePath.replace(ROOT + path.sep, "").replace(/\\/g, "/");
  const lines = fs.readFileSync(filePath, "utf8").split("\n");

  for (const { label, re } of PATTERNS) {
    lines.forEach((line, idx) => {
      if (re.test(line)) {
        hits.push({ relPath: rel, lineNo: idx + 1, label, lineText: line.trim() });
      }
    });
  }
}

// ─── Classify hits ───────────────────────────────────────────────────────────
const unapproved = hits.filter(h =>
  !ALLOWLIST.some(a =>
    h.relPath.includes(a.fileSubstr) && h.lineText.includes(a.lineSubstr)
  )
);

// ─── Report ───────────────────────────────────────────────────────────────────
console.log(`Scanned ${files.length} TSX/TS files`);
console.log(`Pattern matches: ${hits.length}  |  Allowlisted: ${hits.length - unapproved.length}  |  Unapproved: ${unapproved.length}`);

ok(
  "No unapproved hardcoded dark structural surfaces",
  unapproved.length === 0,
  unapproved.map(h =>
    `${h.relPath}:${h.lineNo}  [${h.label}]\n      ${h.lineText.slice(0, 120)}`
  ).join("\n    ")
);

// ─── Allowlist staleness check ────────────────────────────────────────────────
// Each allowlist entry must still match something — if a file was changed and
// the pattern removed the test should flag the stale allowlist entry.
console.log("\n[Allowlist coverage — each entry must still exist in its file]");

for (const entry of ALLOWLIST) {
  const stillPresent = hits.some(
    h => h.relPath.includes(entry.fileSubstr) && h.lineText.includes(entry.lineSubstr)
  );
  ok(
    `Allowlist: ${path.basename(entry.fileSubstr)} — "${entry.lineSubstr.slice(0, 55)}"`,
    stillPresent,
    stillPresent
      ? ""
      : "Pattern no longer found — remove or update this allowlist entry"
  );
}

// ─── Semantic token adoption — tokenized pages must use semantic tokens ───────
console.log("\n[Semantic token adoption — revenue-ops, executive-copilot, revenue-sim]");

const TOKENIZED = [
  {
    rel:   "client/src/pages/revenue-ops.tsx",
    checks: ["bg-card", "bg-background", "border-border", "hover:bg-muted/30"],
  },
  {
    rel:   "client/src/pages/executive-copilot.tsx",
    // executive-copilot has no table-row hover states — hover:bg-muted/30 not expected
    checks: ["bg-card", "bg-background", "border-border"],
  },
  {
    rel:   "client/src/pages/revenue-sim.tsx",
    checks: ["bg-card", "bg-background", "border-border", "hover:bg-muted/30"],
  },
];

for (const { rel, checks } of TOKENIZED) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  for (const token of checks) {
    ok(`${path.basename(rel)} uses ${token}`, src.includes(token));
  }
  // Structural dark surfaces must be gone from className attributes
  ok(
    `${path.basename(rel)} — no structural bg-zinc-900 in className`,
    !/className=[^"']*bg-zinc-900/.test(src)
  );
  ok(
    `${path.basename(rel)} — no structural bg-zinc-950 in className`,
    !/className=[^"']*bg-zinc-950/.test(src)
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  • ${f}`));
  process.exit(1);
} else {
  console.log("All checks passed ✓");
  process.exit(0);
}
