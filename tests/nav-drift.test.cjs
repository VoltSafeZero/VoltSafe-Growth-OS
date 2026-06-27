#!/usr/bin/env node
/**
 * Nav Drift Regression Test
 * Source-grep checks that prevent known nav drift bugs from returning.
 * Run with: node tests/nav-drift.test.cjs
 *
 * Phase 1 checks (2026-06-27):
 *  1. Signals & Alerts no longer maps to Activity Feed route
 *  2. Meeting Briefs no longer maps to Today route
 *  3. Forecasting no longer maps to Pipeline route
 *  4. Reports and Rel. Intelligence are not both visible nav items (duplicate)
 *  5. Email Signatures and AI Voice Profiles are not stranded in Admin with adminOnly:false
 *  6. Channels group user-facing label is "Ecosystem"
 *  7. No nav item route appears twice in NAV_CONFIG
 *
 * Phase 2 checks (2026-06-27):
 *  8.  "Asset Library" label is gone → "Document Hub" replaces it
 *  9.  "Assets" label is gone → "Knowledge Assets" replaces it
 *  10. "Digest & Alerts" label is gone → "Digest Settings" replaces it
 *  11. "Rel. Intelligence" abbreviation is gone → "Relationship Intelligence" replaces it
 *  12. Routes for all renamed items are unchanged
 *  13. No duplicate nav routes (re-checked after Phase 2)
 */

"use strict";

const fs = require("fs");
const path = require("path");

const NAV_FILE = path.join(__dirname, "../client/src/lib/nav-config.ts");
const DOCS_FILE = path.join(__dirname, "../client/src/pages/documents.tsx");

const src = fs.readFileSync(NAV_FILE, "utf8");
const docsSrc = fs.readFileSync(DOCS_FILE, "utf8");

let passed = 0;
let failed = 0;

function ok(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

console.log("\nNav Drift Regression Tests\n");

// ── Phase 1: Wrong-route guards ───────────────────────────────────────────────
console.log("Phase 1 — Wrong-page nav item drift fixes:");

ok(
  'No nav item routes to /intelligence/signals',
  !src.includes('route: "/intelligence/signals"'),
  'Signals & Alerts was wired to ActivityFeedPage — must be removed or replaced with a real signals page'
);
ok(
  'No nav item routes to /intelligence/briefs',
  !src.includes('route: "/intelligence/briefs"'),
  'Meeting Briefs was wired to TodayPage — must be removed or replaced with a real briefs page'
);
ok(
  'No nav item routes to /execution/forecast',
  !src.includes('route: "/execution/forecast"'),
  'Forecasting was wired to PipelinePage — must be removed or replaced with a real forecast page'
);

// ── Phase 1: Duplicate Reports/Rel.Intelligence ───────────────────────────────
console.log("\nPhase 1 — Duplicate nav item (Reports = Rel. Intelligence):");

ok(
  'No nav item routes to /relationships (duplicate Reports entry)',
  !src.includes('route: "/relationships"'),
  '"Reports" nav item duplicated Rel. Intelligence — /relationships entry must be removed from NAV_CONFIG'
);
ok(
  'Relationship Intelligence canonical entry exists (/intelligence/rel-intelligence)',
  src.includes('route: "/intelligence/rel-intelligence"'),
  'The canonical Relationship Intelligence nav item must remain'
);

// ── Phase 1: Admin section mismatch ──────────────────────────────────────────
console.log("\nPhase 1 — adminOnly:false items stranded inside Admin section:");

ok(
  'Email Signatures is not marked adminOnly:false inside Admin group',
  !src.match(/id: "admin-signatures"[\s\S]{0,120}adminOnly: false/),
  '"admin-signatures" with adminOnly:false was hidden from non-admin users despite being a personal tool'
);
ok(
  'AI Voice Profiles is not marked adminOnly:false inside Admin group',
  !src.match(/id: "admin-voice-profiles"[\s\S]{0,120}adminOnly: false/),
  '"admin-voice-profiles" with adminOnly:false was hidden from non-admin users despite being a personal tool'
);
ok(
  'Email Signatures route (/settings/signatures) exists in nav',
  src.includes('route: "/settings/signatures"'),
  'Email Signatures must have a nav entry (moved to Work group)'
);
ok(
  'AI Voice Profiles route (/settings/voice-profiles) exists in nav',
  src.includes('route: "/settings/voice-profiles"'),
  'AI Voice Profiles must have a nav entry (moved to Work group)'
);

const workSectionMatch = src.match(/id: "work"[\s\S]*?(?=\n  \{[\s\n]*id: "pipeline")/);
const workSectionText = workSectionMatch ? workSectionMatch[0] : "";
ok(
  'Email Signatures is in Work group',
  workSectionText.includes('/settings/signatures'),
  'Email Signatures should be in the Work group, not Admin'
);
ok(
  'AI Voice Profiles is in Work group',
  workSectionText.includes('/settings/voice-profiles'),
  'AI Voice Profiles should be in the Work group, not Admin'
);

// ── Phase 1: Channels → Ecosystem ────────────────────────────────────────────
console.log("\nPhase 1 — Channels group label rename:");

const channelsSectionMatch = src.match(/id: "channels"[\s\S]{0,80}/);
const channelsSectionText = channelsSectionMatch ? channelsSectionMatch[0] : "";
ok(
  'Channels section label is "Ecosystem"',
  channelsSectionText.includes('label: "Ecosystem"'),
  'The Channels sidebar group should be labeled "Ecosystem" to avoid collision with CURRENTS messaging'
);
ok(
  'Channels section label is NOT "Channels"',
  !channelsSectionText.includes('label: "Channels"'),
  'The old "Channels" label conflicts with CURRENTS internal channel terminology'
);

// ── Phase 2: Label clarifications ────────────────────────────────────────────
console.log("\nPhase 2 — Label clarification renames:");

// Document Hub (was Asset Library)
ok(
  '"Asset Library" label is gone from nav',
  !src.includes('label: "Asset Library"'),
  '"Asset Library" was renamed to "Document Hub" to avoid confusion with knowledge/physical assets'
);
ok(
  '"Document Hub" label exists in nav',
  src.includes('label: "Document Hub"'),
  '"Document Hub" must appear as the nav label for /documents'
);
ok(
  'Document Hub route is /documents (unchanged)',
  src.includes('label: "Document Hub"') && src.includes('"Document Hub"') &&
    src.match(/label: "Document Hub"[\s\S]{0,50}route: "\/documents"/) !== null,
  'Route must not change — only the label'
);

// Knowledge Assets (was Assets)
ok(
  '"Assets" bare label is gone from nav',
  !src.match(/label: "Assets"[^a-zA-Z]/),
  '"Assets" was renamed to "Knowledge Assets" to distinguish from Document Hub'
);
ok(
  '"Knowledge Assets" label exists in nav',
  src.includes('label: "Knowledge Assets"'),
  '"Knowledge Assets" must appear as the nav label for /knowledge/assets'
);
ok(
  'Knowledge Assets route is /knowledge/assets (unchanged)',
  src.match(/label: "Knowledge Assets"[\s\S]{0,60}route: "\/knowledge\/assets"/) !== null,
  'Route must not change — only the label'
);

// Digest Settings (was Digest & Alerts)
ok(
  '"Digest & Alerts" label is gone from nav',
  !src.includes('label: "Digest & Alerts"'),
  '"Digest & Alerts" was renamed to "Digest Settings" to distinguish from live signals/alerts feeds'
);
ok(
  '"Digest Settings" label exists in nav',
  src.includes('label: "Digest Settings"'),
  '"Digest Settings" must appear as the nav label for /alerts-digest'
);
ok(
  'Digest Settings route is /alerts-digest (unchanged)',
  src.match(/label: "Digest Settings"[\s\S]{0,60}route: "\/alerts-digest"/) !== null,
  'Route must not change — only the label'
);

// Relationship Intelligence (was Rel. Intelligence)
ok(
  '"Rel. Intelligence" abbreviation is gone from nav',
  !src.includes('label: "Rel. Intelligence"'),
  '"Rel. Intelligence" was expanded to "Relationship Intelligence" for clarity'
);
ok(
  '"Relationship Intelligence" label exists in nav',
  src.includes('label: "Relationship Intelligence"'),
  '"Relationship Intelligence" must appear as the nav label for /intelligence/rel-intelligence'
);
ok(
  'Relationship Intelligence route is /intelligence/rel-intelligence (unchanged)',
  src.match(/label: "Relationship Intelligence"[\s\S]{0,80}route: "\/intelligence\/rel-intelligence"/) !== null,
  'Route must not change — only the label'
);

// ── Phase 2: Page title sync (documents.tsx) ──────────────────────────────────
console.log("\nPhase 2 — Page title sync:");

ok(
  'documents.tsx h1 shows "Document Hub" (not "Asset Library")',
  docsSrc.includes('>Document Hub<') && !docsSrc.includes('>Asset Library<'),
  'The documents.tsx page title should match the nav label "Document Hub"'
);

// ── Duplicate route guard (re-run after Phase 2) ──────────────────────────────
console.log("\nPhase 1+2 — Duplicate routes in NAV_CONFIG:");

const routeMatches = [...src.matchAll(/route: "([^"]+)"/g)];
const routes = routeMatches.map(m => m[1]);
const routeCounts = {};
for (const r of routes) {
  routeCounts[r] = (routeCounts[r] || 0) + 1;
}
const duplicateRoutes = Object.entries(routeCounts)
  .filter(([, count]) => count > 1)
  .map(([r]) => r);

ok(
  `No duplicate routes in NAV_CONFIG (found ${duplicateRoutes.length} duplicates)`,
  duplicateRoutes.length === 0,
  duplicateRoutes.length > 0 ? `Duplicate routes: ${duplicateRoutes.join(", ")}` : ""
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`\n✗ ${failed} nav drift check(s) failed — see above\n`);
  process.exit(1);
} else {
  console.log(`\n✓ All nav drift checks passed\n`);
}
