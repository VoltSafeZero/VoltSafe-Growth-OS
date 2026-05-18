#!/usr/bin/env node
/**
 * UI Source-Grep Test — Low-Confidence Association Toggle
 *
 * Verifies the structural invariants of the CRM association panel in
 * client/src/pages/gmail-inbox.tsx without requiring a live server.
 *
 * Pins:
 *   1. CONF_THRESHOLD constant is 50
 *   2. highConfCandidates and lowConfCandidates derivations exist
 *   3. showLowConf state is declared
 *   4. The toggle button carries data-testid="toggle-low-conf-candidates"
 *   5. Low-confidence items are rendered conditionally (showLowConf gate)
 *   6. High-confidence items map from highConfCandidates (not unconfirmedCandidates)
 *   7. Low-conf items carry data-testid prefix "crm-assoc-low-"
 *
 * Run with: node tests/ui-assoc-low-conf.test.js
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../client/src/pages/gmail-inbox.tsx"),
  "utf8"
);

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}
function fail(label, detail = "") {
  console.error(`  ✗ ${label}${detail ? `\n      → ${detail}` : ""}`);
  failed++;
}
function check(label, condition, detail = "") {
  condition ? ok(label) : fail(label, detail);
}

console.log("\n=== UI: Low-Confidence Association Toggle (source-grep) ===\n");

// 1. Confidence threshold constant
check(
  "CONF_THRESHOLD = 50 is declared",
  /const CONF_THRESHOLD\s*=\s*50/.test(SRC),
  "Expected: const CONF_THRESHOLD = 50"
);

// 2. highConfCandidates derived from unconfirmedCandidates filtered by threshold
check(
  "highConfCandidates filters unconfirmedCandidates at CONF_THRESHOLD",
  /highConfCandidates\s*=\s*unconfirmedCandidates\.filter/.test(SRC) &&
  /CONF_THRESHOLD/.test(SRC),
  "Expected: highConfCandidates = unconfirmedCandidates.filter(c => ... >= CONF_THRESHOLD)"
);

// 3. lowConfCandidates derived from unconfirmedCandidates
check(
  "lowConfCandidates filters unconfirmedCandidates at CONF_THRESHOLD",
  /lowConfCandidates\s*=\s*unconfirmedCandidates\.filter/.test(SRC),
  "Expected: lowConfCandidates = unconfirmedCandidates.filter(...)"
);

// 4. showLowConf state
check(
  "showLowConf state is declared with useState",
  /const\s+\[showLowConf,\s*setShowLowConf\]\s*=\s*useState\(false\)/.test(SRC),
  "Expected: const [showLowConf, setShowLowConf] = useState(false)"
);

// 5. Toggle button has the correct data-testid
check(
  'Toggle button has data-testid="toggle-low-conf-candidates"',
  /data-testid="toggle-low-conf-candidates"/.test(SRC),
  'Expected: data-testid="toggle-low-conf-candidates" on the toggle button'
);

// 6. Main unconfirmed render uses highConfCandidates (not unconfirmedCandidates)
check(
  "Primary candidate render maps over highConfCandidates",
  /highConfCandidates\.map\(cand =>/.test(SRC),
  "Expected: {highConfCandidates.map(cand => ...)} — not unconfirmedCandidates"
);

// Negative: unconfirmedCandidates.map should NOT appear (it was the old pattern)
check(
  "unconfirmedCandidates.map is NOT used for primary render",
  !/unconfirmedCandidates\.map\(cand =>/.test(SRC),
  "unconfirmedCandidates.map() should have been replaced by highConfCandidates.map()"
);

// 7. Low-conf items have correct data-testid prefix
check(
  'Low-confidence items carry data-testid="crm-assoc-low-{id}" prefix',
  /data-testid=\{`crm-assoc-low-\$\{cand\.id\}`\}/.test(SRC),
  'Expected: data-testid={`crm-assoc-low-${cand.id}`}'
);

// 8. Low-conf section is gated on showLowConf
check(
  "Low-confidence list is conditionally rendered on showLowConf",
  /showLowConf\s*&&\s*lowConfCandidates\.map/.test(SRC),
  "Expected: showLowConf && lowConfCandidates.map(...)"
);

// 9. lowConfCandidates.length > 0 guard around the toggle
check(
  "Toggle button is only rendered when lowConfCandidates.length > 0",
  /lowConfCandidates\.length\s*>\s*0/.test(SRC),
  "Expected: lowConfCandidates.length > 0 guard before the toggle"
);

// 10. setShowLowConf used as toggle (flip boolean)
check(
  "setShowLowConf is called as a flip toggle (v => !v)",
  /setShowLowConf\(v\s*=>\s*!v\)/.test(SRC),
  "Expected: setShowLowConf(v => !v)"
);

// 11. ~Label prefix for possible-match candidates (50–79%)
check(
  'Type label uses tilde prefix for possible matches (~${cfg.label})',
  /`~\$\{cfg\.label\}`/.test(SRC),
  "Expected: `~${cfg.label}` for isPossible candidates"
);

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
const total = passed + failed;
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`FAILED: ${failed} check(s)`);
  process.exit(1);
} else {
  console.log("All UI low-confidence checks passed.");
  process.exit(0);
}
