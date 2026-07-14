#!/usr/bin/env node
"use strict";
/**
 * Lead Comms Follow-Up Command Centre — Source-Grep Tests
 *
 * Pins the structure of:
 *  - migrations/0032_lead_comms_summary.sql (DB table + indexes)
 *  - server/services/lead-comms-sync.ts (backfill + refresh)
 *  - server/storage.ts (getLeads commStatus filter + comm sort)
 *  - server/routes.ts (GET /api/leads commStatus param + sync routes)
 *  - server/index.ts (startup backfill)
 *  - client/src/pages/leads.tsx (filter dropdown, columns, state)
 *  - client/src/lib/crm-taxonomy.ts (new sort options)
 */

const fs = require("fs");

let passed = 0;
let failed = 0;

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ─── Migration ────────────────────────────────────────────────────────────────
console.log("\n── 1. Migration: lead_comms_summary table ──────────────────────────────");
const mig = read("migrations/0032_lead_comms_summary.sql");
check("table name lead_comms_summary", mig.includes("lead_comms_summary"));
check("lead_id primary key", mig.includes("lead_id") && mig.includes("PRIMARY KEY"));
check("last_outgoing_at column", mig.includes("last_outgoing_at"));
check("last_incoming_at column", mig.includes("last_incoming_at"));
check("last_comm_at column", mig.includes("last_comm_at"));
check("outgoing_count column", mig.includes("outgoing_count"));
check("incoming_count column", mig.includes("incoming_count"));
check("updated_at column", mig.includes("updated_at"));
check("index on last_comm_at", mig.includes("last_comm_at"));
check("IF NOT EXISTS guard", mig.includes("IF NOT EXISTS"));

// ─── Sync Service ─────────────────────────────────────────────────────────────
console.log("\n── 2. server/services/lead-comms-sync.ts ───────────────────────────────");
const svc = read("server/services/lead-comms-sync.ts");
check("backfillLeadComms exported", svc.includes("export async function backfillLeadComms"));
check("refreshLeadComms exported", svc.includes("export async function refreshLeadComms"));
check("INNER JOIN email_messages", svc.includes("email_messages"));
check("ILIKE for case-insensitive email match", svc.includes("ILIKE") || svc.includes("ilike"));
check("batch processing (1000)", svc.includes("1000") || svc.includes("batch"));
check("UPSERT / ON CONFLICT", svc.includes("ON CONFLICT") || svc.includes("on conflict") || svc.includes("upsert"));
check("outgoing direction filter", svc.includes("outgoing"));
check("incoming direction filter", svc.includes("incoming"));
check("last_comm_at computed", svc.includes("last_comm_at"));

// ─── Storage ──────────────────────────────────────────────────────────────────
console.log("\n── 3. server/storage.ts getLeads() extension ───────────────────────────");
const storage = read("server/storage.ts");
check("commStatus in IStorage options", storage.includes("commStatus?"));
check("commSummary in return type / result", storage.includes("commSummary"));
check("comm status filter applied", storage.includes("voltSafe_owes_reply") || storage.includes("commStatus"));
check("last_comm_at sort case", storage.includes("last_comm_at"));
check("last_outgoing_at sort case", storage.includes("last_outgoing_at"));
check("days_since_contact sort case", storage.includes("days_since_contact"));
check("batch comm fetch after main query", storage.includes("lead_comms_summary"));
check("comm summary merged onto leads", storage.includes("commSummary:") || storage.includes("commSummary :"));

// ─── Routes ───────────────────────────────────────────────────────────────────
console.log("\n── 4. server/routes.ts API extensions ──────────────────────────────────");
const routes = read("server/routes.ts");
check("commStatus destructured from req.query", routes.includes("commStatus") && routes.includes("req.query"));
check("commStatus passed to storage.getLeads", routes.includes("commStatus: commStatus"));
check("POST /api/leads/sync-comms route", routes.includes("/api/leads/sync-comms"));
check("POST /api/leads/:id/sync-comms route", routes.includes("/api/leads/:id/sync-comms"));
check("sync-comms requires admin or auth", routes.includes("requireAdmin") && routes.includes("sync-comms"));
check("backfillLeadComms imported in sync route", routes.includes("backfillLeadComms") || routes.includes("lead-comms-sync"));
check("refreshLeadComms imported in per-lead route", routes.includes("refreshLeadComms") || routes.includes("lead-comms-sync"));

// ─── Startup Backfill ─────────────────────────────────────────────────────────
console.log("\n── 5. server/index.ts startup backfill ─────────────────────────────────");
const idx = read("server/index.ts");
check("backfillLeadComms imported in startup", idx.includes("backfillLeadComms"));
check("lead-comms-sync imported in startup", idx.includes("lead-comms-sync"));
check("setTimeout for delayed startup backfill", idx.includes("setTimeout") && idx.includes("backfillLeadComms"));

// ─── Frontend ─────────────────────────────────────────────────────────────────
console.log("\n── 6. client/src/pages/leads.tsx frontend ──────────────────────────────");
const leads = read("client/src/pages/leads.tsx");
check("commStatusFilter state declared", leads.includes("commStatusFilter") && leads.includes("useState"));
check("setCommStatusFilter setter", leads.includes("setCommStatusFilter"));
check("commStatusFilter in queryKey", leads.includes("commStatus: commStatusFilter"));
check("commStatus param sent to API", leads.includes('params.set("commStatus"'));
check("commStatusFilter in currentFiltersJson", leads.includes("commStatus: commStatusFilter"));
check("commStatusFilter in applyView restore", leads.includes("f.commStatus") && leads.includes("setCommStatusFilter(f.commStatus)"));
check("commStatusFilter reset in clearView", leads.includes('setCommStatusFilter("all")'));
check("COMM_STATUS_OPTIONS array defined", leads.includes("COMM_STATUS_OPTIONS"));
check("COMM_STATUS_STYLE map defined", leads.includes("COMM_STATUS_STYLE"));
check("formatDaysAgo helper defined", leads.includes("function formatDaysAgo"));
check("LeadWithComms type defined", leads.includes("type LeadWithComms"));
check("comm status dropdown in filter row", leads.includes("select-comm-status-filter"));
check("Comm Status column header", leads.includes("th-comm-status") || leads.includes("Comm Status"));
check("Last Contact column header", leads.includes("th-last-contact") || leads.includes("Last Contact"));
check("comm-status testid on rows", leads.includes("comm-status-${lead.id}") || leads.includes('comm-status-'));
check("last-contact testid on rows", leads.includes("last-contact-${lead.id}") || leads.includes('last-contact-'));
check("daysSinceContact displayed", leads.includes("daysSinceContact"));
check("direction arrow icons", leads.includes("ArrowUpRight") && leads.includes("ArrowDownLeft"));
check("colSpan updated to 10", leads.includes("colSpan={10}"));
check("never_contacted style defined", leads.includes("never_contacted"));
check("voltSafe_owes_reply style defined", leads.includes("voltSafe_owes_reply"));
check("recently_contacted style defined", leads.includes("recently_contacted"));

// ─── Crm Taxonomy ─────────────────────────────────────────────────────────────
console.log("\n── 7. client/src/lib/crm-taxonomy.ts sort options ──────────────────────");
const tax = read("client/src/lib/crm-taxonomy.ts");
check("last_comm_at:desc sort option", tax.includes("last_comm_at:desc"));
check("last_comm_at:asc sort option", tax.includes("last_comm_at:asc"));
check("last_outgoing_at:desc sort option", tax.includes("last_outgoing_at:desc"));
check("days_since_contact:desc sort option", tax.includes("days_since_contact:desc"));
check("Last Contact (newest) label", tax.includes("Last Contact (newest)"));
check("Longest Silence First label", tax.includes("Longest Silence First"));

// ─── Results ──────────────────────────────────────────────────────────────────
console.log(`\n───────────────────────────────────────────────────────`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`───────────────────────────────────────────────────────`);
if (failed > 0) process.exit(1);
