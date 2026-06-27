#!/usr/bin/env node
/**
 * Nav Drift Regression Test
 * Source-grep checks that prevent known nav drift bugs from returning.
 * Run with: node tests/nav-drift.test.cjs
 *
 * These checks verify the Phase 1 navigation cleanup (2026-06-27):
 *  1. Signals & Alerts no longer maps to Activity Feed route
 *  2. Meeting Briefs no longer maps to Today route
 *  3. Forecasting no longer maps to Pipeline route
 *  4. Reports and Rel. Intelligence are not both visible nav items (duplicate)
 *  5. Email Signatures and AI Voice Profiles are not stranded in Admin with adminOnly:false
 *  6. Channels group user-facing label is "Ecosystem"
 *  7. No nav item route appears twice in NAV_CONFIG (duplicate route guard)
 */

"use strict";

const fs = require("fs");
const path = require("path");

const NAV_FILE = path.join(__dirname, "../client/src/lib/nav-config.ts");
const src = fs.readFileSync(NAV_FILE, "utf8");

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

// ── 1. Wrong-route guards ──────────────────────────────────────────────────────
console.log("1. Wrong-page nav item drift fixes:");

// Signals & Alerts must NOT point at /intelligence/signals (activity feed mapping)
ok(
  'No nav item routes to /intelligence/signals',
  !src.includes('route: "/intelligence/signals"'),
  'Signals & Alerts was wired to ActivityFeedPage — must be removed or replaced with a real signals page'
);

// Meeting Briefs must NOT point at /intelligence/briefs (today mapping)
ok(
  'No nav item routes to /intelligence/briefs',
  !src.includes('route: "/intelligence/briefs"'),
  'Meeting Briefs was wired to TodayPage — must be removed or replaced with a real briefs page'
);

// Forecasting must NOT point at /execution/forecast (pipeline snapshot mapping)
ok(
  'No nav item routes to /execution/forecast',
  !src.includes('route: "/execution/forecast"'),
  'Forecasting was wired to PipelinePage — must be removed or replaced with a real forecast page'
);

// ── 2. Duplicate Reports/Rel.Intelligence check ───────────────────────────────
console.log("\n2. Duplicate nav item (Reports = Rel. Intelligence):");

// "Reports" pointing at /relationships must be gone (it duplicated RelationshipIntelligencePage)
ok(
  'No nav item routes to /relationships (duplicate Reports entry)',
  !src.includes('route: "/relationships"'),
  '"Reports" nav item duplicated Rel. Intelligence — /relationships entry must be removed from NAV_CONFIG'
);

// Rel. Intelligence canonical entry must still exist in More group
ok(
  'Rel. Intelligence canonical entry exists (/intelligence/rel-intelligence)',
  src.includes('route: "/intelligence/rel-intelligence"'),
  'The canonical Relationship Intelligence nav item must remain'
);

// ── 3. Admin section mismatch ─────────────────────────────────────────────────
console.log("\n3. adminOnly:false items stranded inside Admin section:");

// Email Signatures and AI Voice Profiles must NOT appear in Admin group with adminOnly:false
// The pattern to check: these specific routes should NOT appear right before/after admin-only items
// We check that neither route appears paired with "adminOnly: false" anywhere
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

// Both must now exist somewhere in nav (reachable by all users via Work group)
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

// Both must be in the Work section (between "work" id and the next section)
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

// ── 4. Channels → Ecosystem rename ───────────────────────────────────────────
console.log("\n4. Channels group label rename:");

// The channels section must show "Ecosystem" not "Channels"
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

// ── 5. Duplicate route guard ──────────────────────────────────────────────────
console.log("\n5. Duplicate routes in NAV_CONFIG:");

const routeMatches = [...src.matchAll(/route: "([^"]+)"/g)];
const routes = routeMatches.map(m => m[1]);
const routeCounts = {};
for (const r of routes) {
  routeCounts[r] = (routeCounts[r] || 0) + 1;
}
const duplicateRoutes = Object.entries(routeCounts)
  .filter(([r, count]) => count > 1)
  .map(([r]) => r);

ok(
  `No duplicate routes in NAV_CONFIG (found ${duplicateRoutes.length} duplicates)`,
  duplicateRoutes.length === 0,
  duplicateRoutes.length > 0
    ? `Duplicate routes: ${duplicateRoutes.join(", ")}`
    : ""
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
