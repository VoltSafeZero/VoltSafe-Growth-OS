"use strict";
/**
 * Comm Status Filter — regression tests
 *
 * Tests the operational-view model:
 *   - Filters are independent predicates, not a mutually-exclusive CASE enum
 *   - recently_contacted can overlap with voltSafe_owes_reply / waiting_for_lead
 *   - dormant includes never-contacted records (dormant ⊇ never_contacted)
 *   - no_response is an alias for waiting_for_lead
 *   - No Response is removed from the dropdown options
 */

const assert = require("assert");
const http = require("http");

// ─── Source-grep checks (run without a server) ───────────────────────────────

function grep(content, pattern, label) {
  const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  assert.ok(re.test(content), `FAIL [grep] ${label}\n  pattern: ${re}\n  (not found)`);
}

function noMatch(content, pattern, label) {
  const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  assert.ok(!re.test(content), `FAIL [no-match] ${label}\n  pattern: ${re}\n  (unexpectedly found)`);
}

const fs = require("fs");
const path = require("path");

const storageTs   = fs.readFileSync(path.join(__dirname, "../server/storage.ts"), "utf8");
const syncTs      = fs.readFileSync(path.join(__dirname, "../server/services/lead-comms-sync.ts"), "utf8");
const leadsTsx    = fs.readFileSync(path.join(__dirname, "../client/src/pages/leads.tsx"), "utf8");

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ── 1. storage.ts — filter predicates are independent EXISTS/NOT EXISTS ────────

console.log("\n[storage.ts] Filter predicate structure");

check("voltSafe_owes_reply uses EXISTS with last_incoming_at > last_outgoing_at", () => {
  grep(storageTs, /voltSafe_owes_reply[\s\S]{0,300}EXISTS[\s\S]{0,300}last_incoming_at.*>.*last_outgoing_at/, "voltSafe_owes_reply predicate");
});

check("waiting_for_lead uses EXISTS with last_outgoing_at >= last_incoming_at", () => {
  grep(storageTs, /waiting_for_lead[\s\S]{0,300}EXISTS[\s\S]{0,300}last_outgoing_at.*>=.*last_incoming_at/, "waiting_for_lead predicate");
});

check("recently_contacted uses EXISTS with last_comm_at >= NOW() - INTERVAL '30 days'", () => {
  grep(storageTs, /recently_contacted[\s\S]{0,300}EXISTS[\s\S]{0,300}last_comm_at.*>=.*NOW\(\).*30 days/, "recently_contacted predicate");
});

check("dormant uses NOT EXISTS with last_comm_at >= NOW() - INTERVAL '60 days'", () => {
  grep(storageTs, /dormant[\s\S]{0,300}NOT EXISTS[\s\S]{0,300}last_comm_at.*>=.*NOW\(\).*60 days/, "dormant predicate");
});

check("never_contacted uses NOT EXISTS with outgoing_count OR incoming_count", () => {
  grep(storageTs, /never_contacted[\s\S]{0,300}NOT EXISTS[\s\S]{0,300}outgoing_count.*OR.*incoming_count/, "never_contacted predicate");
});

check("no_response is an alias for waiting_for_lead (same branch)", () => {
  grep(storageTs, /no_response.*waiting_for_lead|waiting_for_lead.*no_response/, "no_response alias");
});

check("Filter section does NOT use COALESCE(SELECT CASE ... END) = pattern (old broken approach)", () => {
  noMatch(storageTs, /COALESCE\(\([\s\S]{0,30}SELECT CASE[\s\S]{0,300}END[\s\S]{0,30}\)[\s\S]{0,30}\) = /, "old CASE-enum filter removed");
});

check("dormant includes never-contacted via NOT EXISTS (no last_comm_at exclusion)", () => {
  // The dormant predicate should NOT include AND last_comm_at IS NOT NULL (which would exclude NULLs)
  // Verify dormant section uses NOT EXISTS that fires when no row in lcs or when date < 60 days
  grep(storageTs, /dormant[\s\S]{0,300}NOT EXISTS[\s\S]{0,300}lead_id.*=.*leads\.id/, "dormant NOT EXISTS scoped to lead");
});

// ── 2. lead-comms-sync.ts — dual data source ─────────────────────────────────

console.log("\n[lead-comms-sync.ts] UPSERT uses dual data sources");

check("UPSERT_SQL includes email_threads as second source", () => {
  grep(syncTs, /email_threads/, "email_threads in UPSERT");
});

check("UPSERT_SQL uses primary_lead_id from email_threads", () => {
  grep(syncTs, /primary_lead_id/, "primary_lead_id join");
});

check("UPSERT_SQL uses UNION to deduplicate across sources", () => {
  grep(syncTs, /UNION/, "UNION dedup");
});

check("UPSERT_SQL excludes spam messages", () => {
  grep(syncTs, /is_spam/, "is_spam exclusion");
});

check("UPSERT_SQL excludes trash messages", () => {
  grep(syncTs, /is_trash/, "is_trash exclusion");
});

check("rebuildAllLeadComms function exported", () => {
  grep(syncTs, /export async function rebuildAllLeadComms/, "rebuildAllLeadComms exported");
});

check("COMM_STATUS_CASE does NOT include no_response branch", () => {
  noMatch(syncTs, /no_response/, "no_response removed from COMM_STATUS_CASE");
});

// ── 3. leads.tsx — UI changes ─────────────────────────────────────────────────

console.log("\n[leads.tsx] UI changes");

check("No Response is NOT in COMM_STATUS_OPTIONS dropdown", () => {
  // The options array should not have { value: "no_response" ... }
  // Check the COMM_STATUS_OPTIONS array does not have no_response as a value
  const optionsMatch = leadsTsx.match(/const COMM_STATUS_OPTIONS[\s\S]{0,1500}as const/);
  assert.ok(optionsMatch, "COMM_STATUS_OPTIONS not found");
  noMatch(optionsMatch[0], /"no_response"[\s,\n]*label/, "no_response not in dropdown");
});

check("COMM_STATUS_OPTIONS contains voltSafe_owes_reply", () => {
  grep(leadsTsx, /"voltSafe_owes_reply"/, "voltSafe_owes_reply in options");
});

check("COMM_STATUS_OPTIONS contains waiting_for_lead", () => {
  grep(leadsTsx, /"waiting_for_lead"/, "waiting_for_lead in options");
});

check("COMM_STATUS_OPTIONS contains recently_contacted", () => {
  grep(leadsTsx, /"recently_contacted"/, "recently_contacted in options");
});

check("COMM_STATUS_OPTIONS contains dormant", () => {
  grep(leadsTsx, /"dormant"/, "dormant in options");
});

check("COMM_STATUS_OPTIONS contains never_contacted", () => {
  grep(leadsTsx, /"never_contacted"/, "never_contacted in options");
});

check("Dropdown items have tooltip descriptions", () => {
  grep(leadsTsx, /tooltip.*The lead contacted us most recently/, "VoltSafe Owes Reply tooltip");
});

check("Dormant tooltip mentions 60 days and never contacted", () => {
  grep(leadsTsx, /tooltip.*60\+.*days.*never contacted|tooltip.*never contacted.*60/, "dormant tooltip");
});

check("Empty state has contextual 'No leads match the current filters' message", () => {
  grep(leadsTsx, /No leads match the current filters/, "contextual empty state");
});

check("Empty state has Clear filters action", () => {
  grep(leadsTsx, /Clear filters/, "clear filters button");
});

check("Import Marinas message only shown when no filters active", () => {
  // Verify Import Marinas fallback is inside an else branch (conditional)
  grep(leadsTsx, /} else \([\s\S]{0,200}Import Marinas|: \([\s\S]{0,200}Import Marinas/, "Import Marinas is conditional");
});

check("COMM_STATUS_STYLE still includes no_response for backward compat", () => {
  grep(leadsTsx, /no_response.*Awaiting|Awaiting.*no_response/, "no_response backward compat style");
});

// ── 4. Operational view semantics — logic assertions ────────────────────────

console.log("\n[logic] Operational view semantics (pure assertions)");

// Simulate the predicate logic used in storage.ts
function commStatusMatch(filter, lcs) {
  // lcs = { last_incoming_at, last_outgoing_at, last_comm_at, outgoing_count, incoming_count }
  // Returns true if this lead matches the filter
  const now = new Date();
  const daysMs = (d) => d ? (now - new Date(d)) : Infinity;

  if (filter === "voltSafe_owes_reply") {
    return lcs.last_incoming_at !== null &&
      (lcs.last_outgoing_at === null || new Date(lcs.last_incoming_at) > new Date(lcs.last_outgoing_at));
  }
  if (filter === "waiting_for_lead" || filter === "no_response") {
    return lcs.last_outgoing_at !== null &&
      (lcs.last_incoming_at === null || new Date(lcs.last_outgoing_at) >= new Date(lcs.last_incoming_at));
  }
  if (filter === "recently_contacted") {
    return lcs.last_comm_at !== null && daysMs(lcs.last_comm_at) < 30 * 86400 * 1000;
  }
  if (filter === "dormant") {
    return lcs.last_comm_at === null || daysMs(lcs.last_comm_at) >= 60 * 86400 * 1000;
  }
  if (filter === "never_contacted") {
    return lcs.outgoing_count === 0 && lcs.incoming_count === 0;
  }
  return true;
}

const recent = new Date(Date.now() - 5 * 86400 * 1000).toISOString();   // 5 days ago
const old91  = new Date(Date.now() - 91 * 86400 * 1000).toISOString();  // 91 days ago

// Lead A: VoltSafe sent last, 5 days ago, lead has responded before
const leadA = { last_incoming_at: old91, last_outgoing_at: recent, last_comm_at: recent, outgoing_count: 3, incoming_count: 1 };

check("Lead A: matches waiting_for_lead (VoltSafe sent last)", () => {
  assert.ok(commStatusMatch("waiting_for_lead", leadA), "should match waiting_for_lead");
});
check("Lead A: matches recently_contacted (comm 5 days ago)", () => {
  assert.ok(commStatusMatch("recently_contacted", leadA), "should match recently_contacted");
});
check("Lead A: does NOT match voltSafe_owes_reply", () => {
  assert.ok(!commStatusMatch("voltSafe_owes_reply", leadA), "should not match voltSafe_owes_reply");
});
check("Lead A: does NOT match dormant", () => {
  assert.ok(!commStatusMatch("dormant", leadA), "should not match dormant");
});

// Lead B: Lead responded today, VoltSafe has not replied
const leadB_inbound = new Date(Date.now() - 2 * 3600 * 1000).toISOString(); // 2 hours ago
const leadB = { last_incoming_at: leadB_inbound, last_outgoing_at: recent, last_comm_at: leadB_inbound, outgoing_count: 1, incoming_count: 1 };

check("Lead B: matches voltSafe_owes_reply (inbound most recent)", () => {
  assert.ok(commStatusMatch("voltSafe_owes_reply", leadB), "should match voltSafe_owes_reply");
});
check("Lead B: matches recently_contacted (comm 2h ago)", () => {
  assert.ok(commStatusMatch("recently_contacted", leadB), "should match recently_contacted");
});
check("Lead B: does NOT match waiting_for_lead", () => {
  assert.ok(!commStatusMatch("waiting_for_lead", leadB), "should not match waiting_for_lead");
});
check("Lead B: does NOT match dormant", () => {
  assert.ok(!commStatusMatch("dormant", leadB), "should not match dormant");
});

// Lead C: Never contacted
const leadC = { last_incoming_at: null, last_outgoing_at: null, last_comm_at: null, outgoing_count: 0, incoming_count: 0 };

check("Lead C: matches dormant (never contacted ⊆ dormant)", () => {
  assert.ok(commStatusMatch("dormant", leadC), "never-contacted should match dormant");
});
check("Lead C: matches never_contacted", () => {
  assert.ok(commStatusMatch("never_contacted", leadC), "should match never_contacted");
});
check("Lead C: does NOT match recently_contacted", () => {
  assert.ok(!commStatusMatch("recently_contacted", leadC), "should not match recently_contacted");
});
check("Lead C: does NOT match voltSafe_owes_reply", () => {
  assert.ok(!commStatusMatch("voltSafe_owes_reply", leadC), "should not match voltSafe_owes_reply");
});

// Lead D: Dormant — last comm 91 days ago, outbound
const leadD = { last_incoming_at: null, last_outgoing_at: old91, last_comm_at: old91, outgoing_count: 2, incoming_count: 0 };

check("Lead D: matches dormant (91 days, no response)", () => {
  assert.ok(commStatusMatch("dormant", leadD), "should match dormant");
});
check("Lead D: matches waiting_for_lead (VoltSafe last even though old)", () => {
  assert.ok(commStatusMatch("waiting_for_lead", leadD), "should match waiting_for_lead");
});
check("Lead D: does NOT match recently_contacted", () => {
  assert.ok(!commStatusMatch("recently_contacted", leadD), "should not match recently_contacted");
});
check("Lead D: does NOT match never_contacted (has outgoing comms)", () => {
  assert.ok(!commStatusMatch("never_contacted", leadD), "should not match never_contacted");
});

// Lead E: no_response is an alias for waiting_for_lead
check("no_response alias: same result as waiting_for_lead for Lead A", () => {
  assert.strictEqual(commStatusMatch("no_response", leadA), commStatusMatch("waiting_for_lead", leadA), "alias parity");
});
check("no_response alias: same result as waiting_for_lead for Lead C", () => {
  assert.strictEqual(commStatusMatch("no_response", leadC), commStatusMatch("waiting_for_lead", leadC), "alias parity");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Comm Status Filter: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
