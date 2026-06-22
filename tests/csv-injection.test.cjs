/**
 * csv-injection.test.cjs
 *
 * Source-grep tests ensuring the CSV export helper neutralizes formula injection
 * (OWASP CSV injection mitigation) and that all export routes use toCsv/setCsvHeaders
 * from the shared helper (not a hand-rolled version).
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function bad(label, reason) {
  console.log(`  ✗ ${label} — ${reason}`);
  failed++;
}

const csvExportSrc = fs.readFileSync(
  path.join(__dirname, "../server/csv-export.ts"),
  "utf8"
);

const routesSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes.ts"),
  "utf8"
);

// ── 1. neutralizeFormula is defined ────────────────────────────────────────
console.log("\n── 1. neutralizeFormula helper ──");

if (/function neutralizeFormula/.test(csvExportSrc))
  ok("neutralizeFormula function is defined");
else
  bad("neutralizeFormula", "not found in csv-export.ts");

// Must guard dangerous leading characters
if (/\^.*[=].*\+.*-.*@/.test(csvExportSrc) || /\^.*[=+\-@]/.test(csvExportSrc))
  ok("neutralizeFormula guards =, +, -, @ characters");
else
  bad("neutralizeFormula guard coverage", "does not cover =, +, -, @ in character class");

// Must use a regex .test() call
if (/\.test\(str\)/.test(csvExportSrc))
  ok("neutralizeFormula uses regex .test(str) to check leading char");
else
  bad("neutralizeFormula", "no regex .test(str) detected");

// Must prefix with apostrophe '
if (/"'" \+ str/.test(csvExportSrc) || /'"\s*\+\s*str/.test(csvExportSrc) || /return "'" \+ str/.test(csvExportSrc))
  ok("neutralizeFormula prefixes dangerous cells with apostrophe '");
else
  bad("neutralizeFormula prefix", "apostrophe prefix not found");

// ── 2. neutralizeFormula is called inside escapeValue ──────────────────────
console.log("\n── 2. neutralizeFormula is called from escapeValue ──");

if (/function escapeValue[\s\S]{0,200}neutralizeFormula/.test(csvExportSrc))
  ok("escapeValue calls neutralizeFormula before quoting");
else
  bad("escapeValue integration", "neutralizeFormula not called inside escapeValue");

// ── 3. escapeValue still handles standard CSV quoting ──────────────────────
console.log("\n── 3. escapeValue still handles standard CSV quoting ──");

if (/includes\(","\)/.test(csvExportSrc))
  ok("escapeValue quotes cells containing commas");
else
  bad("comma quoting", "not found");

if (/includes\('"'\)/.test(csvExportSrc))
  ok("escapeValue quotes cells containing double-quotes");
else
  bad("double-quote quoting", "not found");

if (/includes\("\\n"\)/.test(csvExportSrc))
  ok("escapeValue quotes cells containing newlines");
else
  bad("newline quoting", "not found");

// ── 4. toCsv and setCsvHeaders are exported ────────────────────────────────
console.log("\n── 4. exports ──");

if (/export function toCsv/.test(csvExportSrc))
  ok("toCsv is exported");
else
  bad("toCsv export", "not found");

if (/export function setCsvHeaders/.test(csvExportSrc))
  ok("setCsvHeaders is exported");
else
  bad("setCsvHeaders export", "not found");

// ── 5. routes.ts uses shared helper ────────────────────────────────────────
console.log("\n── 5. routes.ts uses shared csv-export helper ──");

if (/from.*csv-export/.test(routesSrc) || /require.*csv-export/.test(routesSrc))
  ok("routes.ts imports from csv-export helper");
else
  bad("csv-export import", "routes.ts does not import csv-export helper");

if (/toCsv\(/.test(routesSrc))
  ok("routes.ts calls toCsv()");
else
  bad("toCsv usage", "not found in routes.ts");

if (/setCsvHeaders\(/.test(routesSrc))
  ok("routes.ts calls setCsvHeaders()");
else
  bad("setCsvHeaders usage", "not found in routes.ts");

// ── 6. No hand-rolled CSV builders in routes.ts ────────────────────────────
console.log("\n── 6. No hand-rolled CSV builders in export routes ──");

const handRolled = (routesSrc.match(/join\(['"`]\\r\\n['"`]\)/g) || []).length;
if (handRolled === 0)
  ok("routes.ts does not contain hand-rolled \\r\\n join (CSV building)");
else
  bad("hand-rolled CSV", `routes.ts contains ${handRolled} raw join('\\r\\n') call(s)`);

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
