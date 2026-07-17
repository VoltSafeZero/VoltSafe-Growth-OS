"use strict";
/**
 * Regression suite for the "Recently Updated" activity-status filter.
 * Uses source-grep to verify the key structural invariants without
 * requiring a live server or DB connection.
 */

const fs = require("fs");
const path = require("path");

const STORAGE = fs.readFileSync(path.join(__dirname, "../server/storage.ts"), "utf8");
const LEADS_TSX = fs.readFileSync(path.join(__dirname, "../client/src/pages/leads.tsx"), "utf8");
const INDEX_TS = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");

let passed = 0;
let failed = 0;

function check(id, label, value) {
  if (value) {
    console.log(`  ✓ ${id}: ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${id}: ${label}`);
    failed++;
  }
}

// ── T001: Filter predicate exists ────────────────────────────────────────────
console.log('\n=== T001: recently_updated commStatus filter predicate ===');
check("T001a", "recently_updated case in commStatus filter",
  STORAGE.includes(`cs === "recently_updated"`));
check("T001b", "filter checks leads.updatedAt within 30 days",
  STORAGE.includes(`leads.updatedAt`) && STORAGE.includes(`INTERVAL '30 days'`));
check("T001c", "filter includes EXISTS on activities table",
  STORAGE.includes(`SELECT 1 FROM activities`) &&
  STORAGE.includes(`linked_object_type = 'lead'`) &&
  STORAGE.includes(`created_at >= NOW() - INTERVAL '30 days'`));
check("T001d", "filter includes EXISTS on notes table",
  STORAGE.includes(`SELECT 1 FROM notes`) &&
  STORAGE.includes(`updated_at >= NOW() - INTERVAL '30 days'`));
check("T001e", "filter includes EXISTS on comments table",
  STORAGE.includes(`SELECT 1 FROM comments`) &&
  STORAGE.includes(`object_type = 'lead'`));
check("T001f", "filter includes EXISTS on tasks table",
  STORAGE.includes(`SELECT 1 FROM tasks`) &&
  STORAGE.includes(`linked_object_type = 'lead'`));
check("T001g", "filter includes EXISTS on email_threads table",
  STORAGE.includes(`SELECT 1 FROM email_threads`) &&
  STORAGE.includes("primary_lead_id = ${leads.id}"));
check("T001h", "filter includes EXISTS on calendar_events table",
  STORAGE.includes(`SELECT 1 FROM calendar_events`));
check("T001i", "filter covers converted account activities (leads + accounts)",
  STORAGE.includes(`linked_object_type = 'account'`) &&
  STORAGE.includes(`leads.convertedAccountId`));

// ── T002: Auto-sort by lastMeaningfulActivityAt ───────────────────────────────
console.log('\n=== T002: Auto-sort when recently_updated is active ===');
check("T002a", "isRecentlyUpdated flag declared in storage.ts",
  STORAGE.includes(`isRecentlyUpdated`));
check("T002b", "GREATEST sort expression includes leads.updated_at",
  STORAGE.includes(`leads.updated_at`) && STORAGE.includes(`GREATEST(`));
check("T002c", "GREATEST sort covers activities, notes, comments, tasks, email_threads, calendar_events",
  STORAGE.includes(`FROM activities a WHERE a.linked_object_type = 'lead'`) &&
  STORAGE.includes(`FROM notes n WHERE n.linked_object_type = 'lead'`) &&
  STORAGE.includes(`FROM comments c WHERE c.object_type = 'lead'`) &&
  STORAGE.includes(`FROM tasks t WHERE t.linked_object_type = 'lead'`) &&
  STORAGE.includes(`FROM email_threads et WHERE et.primary_lead_id`) &&
  STORAGE.includes(`FROM calendar_events ce WHERE ce.linked_object_type = 'lead'`));
check("T002d", "sort is DESC NULLS LAST with company ASC tie-breaker",
  STORAGE.includes(`DESC NULLS LAST, leads.company ASC`));
check("T002e", "recently_updated sort branch checked before isSlipsSort in if-chain",
  STORAGE.indexOf(`if (isRecentlyUpdated)`) < STORAGE.indexOf(`else if (isSlipsSort)`));

// ── T003: Batch activity enrichment ───────────────────────────────────────────
console.log('\n=== T003: Batch lastMeaningfulActivity enrichment per page ===');
check("T003a", "activityMap declared for batch enrichment",
  STORAGE.includes(`activityMap`));
check("T003b", "UNION ALL covers all source tables in ranked_sources CTE",
  STORAGE.includes(`ranked_sources AS (`) &&
  STORAGE.includes(`UNION ALL`) &&
  STORAGE.includes(`lead_updated`));
check("T003c", "ROW_NUMBER window function used to pick most recent per lead",
  STORAGE.includes(`ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY ts DESC NULLS LAST)`));
check("T003d", "task_completed / task_updated differentiation in batch query",
  STORAGE.includes(`task_completed`) && STORAGE.includes(`task_updated`));
check("T003e", "email_received / email_sent differentiation in batch query",
  STORAGE.includes(`email_received`) && STORAGE.includes(`email_sent`));
check("T003f", "activityMap merged into enriched commSummary (lastActivityAt)",
  STORAGE.includes(`lastActivityAt`) && STORAGE.includes(`lastActivityType`) && STORAGE.includes(`lastActivitySub`));
check("T003g", "activityMap populated even when lcs (commSummary) is absent",
  (() => {
    // The fallback branch { commStatus: "never_contacted", lastActivityAt: ... } must exist
    const fallbackIdx = STORAGE.indexOf(`commStatus: "never_contacted"`);
    const afterFallback = STORAGE.slice(fallbackIdx, fallbackIdx + 200);
    return afterFallback.includes("lastActivityAt");
  })());

// ── T004: Frontend — COMM_STATUS_OPTIONS ──────────────────────────────────────
console.log('\n=== T004: Frontend COMM_STATUS_OPTIONS ===');
check("T004a", "recently_updated value in COMM_STATUS_OPTIONS",
  LEADS_TSX.includes(`value: "recently_updated"`));
check("T004b", "Recently Updated label in COMM_STATUS_OPTIONS",
  LEADS_TSX.includes(`label: "Recently Updated"`));
check("T004c", "recently_updated positioned after recently_contacted",
  LEADS_TSX.indexOf(`recently_contacted`) < LEADS_TSX.indexOf(`recently_updated`));
check("T004d", "recently_updated positioned before dormant",
  LEADS_TSX.indexOf(`recently_updated`) < LEADS_TSX.indexOf(`dormant`));
check("T004e", "All Comm Status renamed to All Activity Status",
  LEADS_TSX.includes(`All Activity Status`) && !LEADS_TSX.includes(`All Comm Status`));

// ── T005: Frontend — CommSummary type extended ────────────────────────────────
console.log('\n=== T005: Frontend CommSummary type ===');
check("T005a", "lastActivityAt in CommSummary type",
  LEADS_TSX.includes(`lastActivityAt?: string | null`));
check("T005b", "lastActivityType in CommSummary type",
  LEADS_TSX.includes(`lastActivityType?: string | null`));
check("T005c", "lastActivitySub in CommSummary type",
  LEADS_TSX.includes(`lastActivitySub?: string | null`));

// ── T006: Frontend — getActivityLabel helper ──────────────────────────────────
console.log('\n=== T006: Frontend getActivityLabel helper ===');
check("T006a", "getActivityLabel function defined",
  LEADS_TSX.includes(`function getActivityLabel(`));
check("T006b", "maps task_completed → Task completed",
  LEADS_TSX.includes(`task_completed`) && LEADS_TSX.includes(`Task completed`));
check("T006c", "maps email_received → Email received",
  LEADS_TSX.includes(`email_received`) && LEADS_TSX.includes(`Email received`));
check("T006d", "maps comment → Comment added",
  LEADS_TSX.includes(`Comment added`));
check("T006e", "maps note → Note updated",
  LEADS_TSX.includes(`Note updated`));
check("T006f", "maps lead_updated → Record updated",
  LEADS_TSX.includes(`Record updated`));

// ── T007: Frontend — column headers dynamic ────────────────────────────────────
console.log('\n=== T007: Frontend column header adapts to filter ===');
check("T007a", "Comm Status column shows Activity when recently_updated",
  LEADS_TSX.includes(`commStatusFilter === "recently_updated" ? "Activity" : "Comm Status"`));
check("T007b", "Last Contact column shows Last Activity when recently_updated",
  LEADS_TSX.includes(`commStatusFilter === "recently_updated" ? "Last Activity" : "Last Contact"`));

// ── T008: Frontend — row rendering shows activity data ────────────────────────
console.log('\n=== T008: Frontend row rendering for recently_updated ===');
check("T008a", "activity badge shown when commStatusFilter === recently_updated",
  LEADS_TSX.includes(`commStatusFilter === "recently_updated"`) &&
  LEADS_TSX.includes(`getActivityLabel(cs?.lastActivityType, cs?.lastActivitySub)`));
check("T008b", "lastActivityAt used to compute days since for Last Activity column",
  LEADS_TSX.includes(`lastActivityAt`) && LEADS_TSX.includes(`86_400_000`));
check("T008c", "regular comm status badge still shown for non-recently_updated filters",
  LEADS_TSX.includes(`COMM_STATUS_STYLE[status]`));

// ── T009: DB indexes ──────────────────────────────────────────────────────────
console.log('\n=== T009: Performance indexes created at startup ===');
check("T009a", "ensureRecentlyUpdatedIndexes function defined in index.ts",
  INDEX_TS.includes(`ensureRecentlyUpdatedIndexes`));
check("T009b", "idx_activities_lead_ts partial index created",
  INDEX_TS.includes(`idx_activities_lead_ts`));
check("T009c", "idx_notes_lead_ts partial index created",
  INDEX_TS.includes(`idx_notes_lead_ts`));
check("T009d", "idx_comments_lead_ts partial index created",
  INDEX_TS.includes(`idx_comments_lead_ts`));
check("T009e", "idx_tasks_lead_ts partial index created",
  INDEX_TS.includes(`idx_tasks_lead_ts`));
check("T009f", "idx_email_threads_primary_lead index created",
  INDEX_TS.includes(`idx_email_threads_primary_lead`));
check("T009g", "indexes use IF NOT EXISTS (idempotent on every startup)",
  INDEX_TS.includes(`IF NOT EXISTS`));

// ── T010: Backward compatibility ──────────────────────────────────────────────
console.log('\n=== T010: Backward compat — existing filters untouched ===');
check("T010a", "recently_contacted filter still present in storage.ts",
  STORAGE.includes(`cs === "recently_contacted"`));
check("T010b", "voltSafe_owes_reply filter still present",
  STORAGE.includes(`cs === "voltSafe_owes_reply"`));
check("T010c", "waiting_for_lead / no_response alias still present",
  STORAGE.includes(`cs === "waiting_for_lead" || cs === "no_response"`));
check("T010d", "dormant filter still present",
  STORAGE.includes(`cs === "dormant"`));
check("T010e", "never_contacted filter still present",
  STORAGE.includes(`cs === "never_contacted"`));
check("T010f", "recently_updated value not confused with recently_contacted (distinct check)",
  STORAGE.includes(`cs === "recently_updated"`) &&
  STORAGE.indexOf(`recently_updated`) !== STORAGE.indexOf(`recently_contacted`));

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(52)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
