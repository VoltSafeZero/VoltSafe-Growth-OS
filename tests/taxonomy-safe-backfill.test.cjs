/**
 * Taxonomy Safe Backfill — Phase 2C tests
 *
 *  1.  dry-run mode performs zero writes
 *  2.  --write mode only writes allowed mappings
 *  3.  non-null market_segment / slip_range are not overwritten
 *  4.  ambiguous values remain NULL after --write
 *  5.  row counts unchanged for all tables
 *  6.  legacy segment / org_type values unchanged
 *  7.  no illegal values written
 *  8.  idempotent: second --write run writes 0 rows
 *  9.  CRM taxonomy tests 32/32
 * 10.  lifecycle reversibility tests 40/40
 * 11.  taxonomy preview tests 46/46
 */

"use strict";

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RUN  = (args, opts = {}) =>
  execSync(`npx tsx scripts/taxonomy-safe-backfill.ts ${args} --json`, {
    cwd: ROOT,
    timeout: 60000,
    ...opts,
  }).toString();

let passed = 0;
let failed = 0;

function assert(label, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ─── Allowed value sets ───────────────────────────────────────────────────────

const ALLOWED_SLIP_RANGE = new Set([
  "less_than_100","100_to_300","300_to_500","500_to_700","700_to_900","more_than_900",
]);
const ALLOWED_MARKET_SEGMENT = new Set([
  "marina","marina_parent_group","yacht_club","association","port_harbor",
]);

async function run() {
  console.log("\nTaxonomy Safe Backfill Tests (Phase 2C)\n");

  // ── 1. Dry-run performs zero writes ────────────────────────────────────────
  console.log("1. Dry-run mode — zero writes");
  let dryRaw = "";
  let dryOk  = true;
  try { dryRaw = RUN(""); } catch (e) { dryRaw = e.stdout?.toString() || e.message; dryOk = false; }

  assert("Dry-run script exits cleanly", dryOk, dryRaw.slice(-300));

  let dry = null;
  try { dry = JSON.parse(dryRaw); } catch {}
  assert("Dry-run JSON is valid",                  dry !== null);
  assert("Dry-run mode = dry-run",                 dry?.mode === "dry-run");
  assert("Dry-run dryRun = true",                  dry?.dryRun === true);
  assert("Dry-run writesExecuted = 0",             dry?.writesExecuted === 0);
  assert("Dry-run rowCountsUnchanged = true",      dry?.rowCountsUnchanged === true);
  assert("Dry-run legacyFieldsUnchanged = true",   dry?.legacyFieldsUnchanged === true);
  assert("Dry-run reports > 0 totalWouldAffect",
    typeof dry?.totalWouldAffect === "number" && dry.totalWouldAffect > 0,
    `got ${dry?.totalWouldAffect}`);
  // All ops should be skipped
  const allSkipped = (dry?.operations ?? []).every(o => o.skipped === true);
  assert("Dry-run: all operations marked skipped", allSkipped);

  // ── 2. --write mode writes allowed mappings ─────────────────────────────
  console.log("\n2. Write mode — executes safe mappings");
  let writeRaw = "";
  let writeOk  = true;
  try { writeRaw = RUN("--write"); } catch (e) { writeRaw = e.stdout?.toString() || e.message; writeOk = false; }

  assert("Write script exits cleanly", writeOk, writeRaw.slice(-300));

  let wr = null;
  try { wr = JSON.parse(writeRaw); } catch {}
  assert("Write JSON is valid",                     wr !== null);
  assert("Write mode = write",                      wr?.mode === "write");
  assert("Write dryRun = false",                    wr?.dryRun === false);
  assert("Write writesExecuted > 0",                typeof wr?.writesExecuted === "number" && wr.writesExecuted > 0,
    `got ${wr?.writesExecuted}`);
  assert("Write rowCountsUnchanged = true",         wr?.rowCountsUnchanged === true);
  assert("Write legacyFieldsUnchanged = true",      wr?.legacyFieldsUnchanged === true);

  // Specific operation checks
  const ops = wr?.operations ?? [];
  const leadsSlip   = ops.find(o => o.name.includes("leads.slip_range"));
  const acctSlip    = ops.find(o => o.name.includes("accounts.slip_range"));
  const leadsMS     = ops.find(o => o.name.includes("leads.market_segment") && o.source.includes("segment"));
  const acctSegMS   = ops.find(o => o.name.includes("accounts.market_segment") && o.source.includes("segment"));
  const acctOrgMS   = ops.find(o => o.name.includes("accounts.market_segment") && o.source.includes("org_type"));

  assert("leads.slip_range operation present",           leadsSlip  !== undefined);
  assert("accounts.slip_range operation present",        acctSlip   !== undefined);
  assert("leads.market_segment operation present",       leadsMS    !== undefined);
  assert("accounts.market_segment←segment present",     acctSegMS  !== undefined);
  assert("accounts.market_segment←org_type present",    acctOrgMS  !== undefined);

  assert("leads.slip_range rows written >= 0",
    leadsSlip?.rowsAffected >= 0,  `got ${leadsSlip?.rowsAffected}`);
  assert("accounts.slip_range rows written >= 0",
    acctSlip?.rowsAffected >= 0,   `got ${acctSlip?.rowsAffected}`);
  assert("leads.market_segment rows written > 0",
    leadsMS?.rowsAffected > 0,    `got ${leadsMS?.rowsAffected}`);
  assert("accounts.market_segment←segment rows written > 0",
    acctSegMS?.rowsAffected > 0,  `got ${acctSegMS?.rowsAffected}`);

  // ── 3. No illegal values written ────────────────────────────────────────
  console.log("\n3. Only allowed values written");
  const illegal = wr?.illegalValues ?? {};
  assert("No illegal leads.market_segment values",    illegal.leads_market_segment?.length    === 0, JSON.stringify(illegal.leads_market_segment));
  assert("No illegal accounts.market_segment values", illegal.accounts_market_segment?.length === 0, JSON.stringify(illegal.accounts_market_segment));
  assert("No illegal leads.slip_range values",        illegal.leads_slip_range?.length        === 0, JSON.stringify(illegal.leads_slip_range));
  assert("No illegal accounts.slip_range values",     illegal.accounts_slip_range?.length     === 0, JSON.stringify(illegal.accounts_slip_range));

  // ── 4. Ambiguous values remain NULL ─────────────────────────────────────
  console.log("\n4. Ambiguous values remain NULL");
  const amb = wr?.ambiguousValuesStillNull ?? {};
  assert("government_dock accounts: market_segment still NULL",
    amb.accounts_govt_dock_ms_null > 0, `got ${amb.accounts_govt_dock_ms_null}`);
  assert("partner accounts: market_segment still NULL",
    amb.accounts_partner_ms_null > 0,   `got ${amb.accounts_partner_ms_null}`);
  assert("marina_prospect accounts: market_segment still NULL",
    amb.accounts_marina_prospect_ms_null > 0, `got ${amb.accounts_marina_prospect_ms_null}`);

  // ── 5. Row counts unchanged ──────────────────────────────────────────────
  console.log("\n5. All table row counts unchanged");
  const bc = wr?.beforeCounts ?? {};
  const ac = wr?.afterCounts  ?? {};
  const tables = ["leads","accounts","contacts","notes","activities","tasks","email_associations"];
  for (const t of tables) {
    assert(`${t} row count unchanged (${ac[t]})`, bc[t] === ac[t],
      `before=${bc[t]} after=${ac[t]}`);
  }

  // ── 6. Non-null values not overwritten (idempotency) ────────────────────
  console.log("\n6. Non-null values not overwritten — second --write is a no-op");
  let write2Raw = "";
  let write2Ok  = true;
  try { write2Raw = RUN("--write"); } catch (e) { write2Raw = e.stdout?.toString() || e.message; write2Ok = false; }

  assert("Second write exits cleanly", write2Ok, write2Raw.slice(-300));

  let wr2 = null;
  try { wr2 = JSON.parse(write2Raw); } catch {}
  assert("Second write: writesExecuted = 0 (all already set)",
    wr2?.writesExecuted === 0, `got ${wr2?.writesExecuted}`);
  assert("Second write: rowCountsUnchanged = true", wr2?.rowCountsUnchanged === true);

  // After both writes, rows written first time should equal total from first write
  const w2ops = wr2?.operations ?? [];
  const allZero = w2ops.every(o => o.rowsAffected === 0);
  assert("Second write: all operations write 0 rows (IS NULL guard)", allZero,
    w2ops.filter(o => o.rowsAffected > 0).map(o => `${o.name}:${o.rowsAffected}`).join(", "));

  // ── 7. Before/after verification via dry-run ─────────────────────────────
  console.log("\n7. Post-write dry-run shows 0 remaining safe mappings");
  let dry2Raw = "";
  let dry2Ok  = true;
  try { dry2Raw = RUN(""); } catch (e) { dry2Raw = e.stdout?.toString() || e.message; dry2Ok = false; }

  let dry2 = null;
  try { dry2 = JSON.parse(dry2Raw); } catch {}
  assert("Post-write dry-run: writesExecuted = 0",     dry2?.writesExecuted === 0);
  assert("Post-write dry-run: totalWouldAffect = 0",
    dry2?.totalWouldAffect === 0, `got ${dry2?.totalWouldAffect}`);

  // ── 8. CRM taxonomy tests ────────────────────────────────────────────────
  console.log("\n8. CRM taxonomy tests — 32/32");
  let taxOk  = false;
  let taxOut = "";
  try {
    taxOut = execSync("node tests/crm-taxonomy.test.cjs 2>&1", { cwd: ROOT, timeout: 90000 }).toString();
    taxOk  = taxOut.includes("32 passed, 0 failed");
  } catch (e) { taxOut = e.stdout?.toString() || e.message; }
  assert("CRM taxonomy tests: 32 passed, 0 failed", taxOk, taxOk ? "" : taxOut.slice(-300));

  // ── 9. Lifecycle reversibility tests ─────────────────────────────────────
  console.log("\n9. Lifecycle reversibility tests — 40/40");
  let lcOk  = false;
  let lcOut = "";
  try {
    lcOut = execSync("node tests/lifecycle-reversibility.test.cjs 2>&1", { cwd: ROOT, timeout: 90000 }).toString();
    lcOk  = lcOut.includes("40 passed, 0 failed");
  } catch (e) { lcOut = e.stdout?.toString() || e.message; }
  assert("Lifecycle reversibility: 40 passed, 0 failed", lcOk, lcOk ? "" : lcOut.slice(-300));

  // ── 10. Taxonomy preview tests ────────────────────────────────────────────
  console.log("\n10. Taxonomy preview tests — 46/46");
  let prevOk  = false;
  let prevOut = "";
  try {
    prevOut = execSync("node tests/taxonomy-backfill-preview.test.cjs 2>&1", { cwd: ROOT, timeout: 120000 }).toString();
    prevOk  = prevOut.includes("46 passed, 0 failed");
  } catch (e) { prevOut = e.stdout?.toString() || e.message; }
  assert("Taxonomy preview tests: 46 passed, 0 failed", prevOk, prevOk ? "" : prevOut.slice(-300));

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(57));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("─".repeat(57) + "\n");
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
