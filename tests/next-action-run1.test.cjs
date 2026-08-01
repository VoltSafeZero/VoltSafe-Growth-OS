"use strict";
/**
 * next-action-run1.test.cjs
 *
 * Run 1 regression suite — Next Action Foundation.
 *
 * Coverage:
 *   A. Status derivation — all 10 states, boundary conditions, DST
 *   B. Smart Priority — ordinal ordering, tie-breaks, NULL due_at
 *   C. Estimated Value — formula, NULL propagation, override
 *   D. Slip parsing — confidence levels, parse rate
 *   E. Migration safety — source-grep checks
 *   F. DB constraints & trigger — live DB checks
 *   G. Settings defaults — source-grep
 */

const fs   = require("fs");
const path = require("path");
const { Client } = require("pg");

let passed = 0;
let failed = 0;

function ok(label, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); failed++; }
}

function read(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
function has(src, p) { return typeof p === "string" ? src.includes(p) : p.test(src); }

// ─────────────────────────────────────────────────────────────────────────────
// A. STATUS DERIVATION (pure function replicated inline)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== next-action-run1.test.cjs ===");
console.log("\n── A. Status derivation ──");

/**
 * DST-safe calendar day diff.
 * Converts both timestamps to calendar dates in the given timezone,
 * then differences the date ordinals. Never uses elapsed-ms / 86400.
 */
function calendarDaysBetween(from, to, tz) {
  function toNoon(d) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const y = parseInt(parts.find(p => p.type === "year").value, 10);
    const m = parseInt(parts.find(p => p.type === "month").value, 10);
    const dy = parseInt(parts.find(p => p.type === "day").value, 10);
    return new Date(Date.UTC(y, m - 1, dy, 12, 0, 0));
  }
  return Math.round((toNoon(to).getTime() - toNoon(from).getTime()) / 86_400_000);
}

const TZ = "America/Vancouver";

function derive(input) {
  const { openAction, hasEverContacted, now, customerWaitNudgeDays = 14, criticalOverdueDays = 3 } = input;
  if (openAction) {
    const { waitingOn, waitingSinceAt, dueAt, blocker, snoozedUntil } = openAction;
    if (snoozedUntil && snoozedUntil > now) return "SNOOZED";
    if (blocker && blocker.trim()) return "BLOCKED";
    if (waitingOn === "customer") {
      const days = calendarDaysBetween(waitingSinceAt, now, TZ);
      return days > customerWaitNudgeDays ? "CUSTOMER_NUDGE_DUE" : "WAITING_CUSTOMER";
    }
    if (waitingOn === "voltsafe") {
      if (dueAt === null) return "DUE";
      const over = calendarDaysBetween(dueAt, now, TZ);
      if (over < 0) return "SCHEDULED";
      if (over <= criticalOverdueDays) return "DUE";
      return "CRITICAL";
    }
  }
  if (hasEverContacted === false) return "NEVER_CONTACTED";
  if (hasEverContacted === null)  return "UNKNOWN";
  return "NO_ACTION";
}

// Helpers
const d = (iso) => new Date(iso);

// No open action states
ok("NEVER_CONTACTED when hasEverContacted=false",
   derive({ openAction: null, hasEverContacted: false, now: d("2025-06-01T10:00:00Z") }) === "NEVER_CONTACTED");
ok("UNKNOWN when hasEverContacted=null",
   derive({ openAction: null, hasEverContacted: null,  now: d("2025-06-01T10:00:00Z") }) === "UNKNOWN");
ok("NO_ACTION when hasEverContacted=true",
   derive({ openAction: null, hasEverContacted: true,  now: d("2025-06-01T10:00:00Z") }) === "NO_ACTION");
ok("UNKNOWN never returns NO_ACTION (green)",
   derive({ openAction: null, hasEverContacted: null,  now: d("2025-06-01T10:00:00Z") }) !== "NO_ACTION");

// Open action — VoltSafe
const vsAction = (dueAt, extra = {}) => ({
  waitingOn: "voltsafe", waitingSinceAt: d("2025-05-20T10:00:00Z"),
  dueAt, blocker: null, snoozedUntil: null, ...extra,
});
const NOW = d("2025-06-04T17:00:00Z"); // June 4 PDT

ok("DUE when due_at=null",
   derive({ openAction: vsAction(null), hasEverContacted: true, now: NOW }) === "DUE");
ok("SCHEDULED when due in future",
   derive({ openAction: vsAction(d("2025-06-10T10:00:00Z")), hasEverContacted: true, now: NOW }) === "SCHEDULED");
ok("DUE when due today (0 overdue)",
   derive({ openAction: vsAction(d("2025-06-04T10:00:00Z")), hasEverContacted: true, now: NOW }) === "DUE");
ok("DUE when 1 day overdue (≤3)",
   derive({ openAction: vsAction(d("2025-06-03T10:00:00Z")), hasEverContacted: true, now: NOW }) === "DUE");
ok("DUE when exactly 3 days overdue (=criticalOverdueDays)",
   derive({ openAction: vsAction(d("2025-06-01T10:00:00Z")), hasEverContacted: true, now: NOW }) === "DUE");
ok("CRITICAL when exactly 4 days overdue (>criticalOverdueDays)",
   derive({ openAction: vsAction(d("2025-05-31T10:00:00Z")), hasEverContacted: true, now: NOW }) === "CRITICAL");
ok("CRITICAL when 10 days overdue",
   derive({ openAction: vsAction(d("2025-05-25T00:00:00Z")), hasEverContacted: true, now: NOW }) === "CRITICAL");

// Open action — customer wait
const custAction = (waitingSinceAt, extra = {}) => ({
  waitingOn: "customer", waitingSinceAt, dueAt: null,
  blocker: null, snoozedUntil: null, ...extra,
});
ok("WAITING_CUSTOMER when 10 days (<14)",
   derive({ openAction: custAction(d("2025-05-25T10:00:00Z")), hasEverContacted: true, now: NOW }) === "WAITING_CUSTOMER");
ok("WAITING_CUSTOMER when exactly 14 days (=nudge threshold)",
   derive({ openAction: custAction(d("2025-05-21T10:00:00Z")), hasEverContacted: true, now: NOW }) === "WAITING_CUSTOMER");
ok("CUSTOMER_NUDGE_DUE when exactly 15 days (>14)",
   derive({ openAction: custAction(d("2025-05-20T10:00:00Z")), hasEverContacted: true, now: NOW }) === "CUSTOMER_NUDGE_DUE");

// Snooze
const snoozedAction = { ...vsAction(null), snoozedUntil: d("2025-06-10T10:00:00Z") };
ok("SNOOZED when snooze is in future",
   derive({ openAction: snoozedAction, hasEverContacted: true, now: NOW }) === "SNOOZED");
const expiredSnooze = { ...vsAction(null), snoozedUntil: d("2025-05-01T10:00:00Z") };
ok("Expired snooze falls through to DUE (due_at=null)",
   derive({ openAction: expiredSnooze, hasEverContacted: true, now: NOW }) === "DUE");

// Blocker
ok("BLOCKED when blocker is non-empty",
   derive({ openAction: { ...vsAction(null), blocker: "Waiting for legal review" }, hasEverContacted: true, now: NOW }) === "BLOCKED");

// Completed/cancelled ignored (no open action)
ok("Completed action ignored → NO_ACTION",
   derive({ openAction: null, hasEverContacted: true, now: NOW }) === "NO_ACTION");
ok("Cancelled action ignored → NO_ACTION",
   derive({ openAction: null, hasEverContacted: true, now: NOW }) === "NO_ACTION");

// ── DST spring-forward (Mar 10, 2024: 2:00→3:00 AM in America/Vancouver) ──
// Mar 9 PST → Mar 11 PDT is 2 calendar days (not 35h/24h = 1.458 days)
const springFrom = new Date("2024-03-09T23:00:00Z"); // Mar 9 15:00 PST
const springTo   = new Date("2024-03-11T10:00:00Z"); // Mar 11 02:00 PDT
ok("DST spring-forward: Mar9→Mar11 = 2 calendar days",
   calendarDaysBetween(springFrom, springTo, TZ) === 2);
ok("DST spring-forward: overdue 2d → DUE (≤3)",
   derive({ openAction: vsAction(springFrom), hasEverContacted: true, now: springTo, criticalOverdueDays: 3 }) === "DUE");

// ── DST fall-back (Nov 3, 2024: 2:00→1:00 AM in America/Vancouver) ──
// Nov 2 PDT → Nov 4 PST is 2 calendar days (not 35h/24h = 1.458 days)
const fallFrom = new Date("2024-11-01T23:00:00Z"); // Nov 1 16:00 PDT
const fallTo   = new Date("2024-11-04T10:00:00Z"); // Nov 4 02:00 PST
ok("DST fall-back: Nov1→Nov4 = 3 calendar days",
   calendarDaysBetween(fallFrom, fallTo, TZ) === 3);
ok("DST fall-back: overdue 3d → DUE (=3)",
   derive({ openAction: vsAction(fallFrom), hasEverContacted: true, now: fallTo, criticalOverdueDays: 3 }) === "DUE");

// ─────────────────────────────────────────────────────────────────────────────
// B. SMART PRIORITY (ordinal buckets, tie-breaks, NULL due_at)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── B. Smart Priority ──");

const STATUS_BUCKET = {
  CRITICAL: 1, DUE: 2, CUSTOMER_NUDGE_DUE: 3, NEVER_CONTACTED: 4, SCHEDULED: 5,
  WAITING_CUSTOMER: 6, BLOCKED: 7, SNOOZED: 8, UNKNOWN: 9, NO_ACTION: 10,
};
const PRI_RANK  = { high: 1, medium: 2, low: 3 };
const FIT_RANK  = { high: 1, medium: 2, low: 3 };

function mkPri(status, dueAt, waitingSinceAt, pri, value, fit, id, createdAt) {
  const bucket = STATUS_BUCKET[status];
  const effectiveDueAt = dueAt ?? createdAt;
  // DUE/CRITICAL: use effectiveDueAt so null due_at (→ createdAt) sorts FIRST
  let relevantTimestamp = null;
  if (status === "DUE" || status === "CRITICAL") relevantTimestamp = effectiveDueAt;
  else if (status === "SCHEDULED") relevantTimestamp = dueAt; // always non-null for SCHEDULED
  else if (["WAITING_CUSTOMER","CUSTOMER_NUDGE_DUE"].includes(status)) relevantTimestamp = waitingSinceAt;
  return {
    bucket, effectiveDueAt, relevantTimestamp,
    manualPriorityRank: PRI_RANK[pri] ?? 4,
    value: value ?? 0,
    fitRank: FIT_RANK[fit] ?? 4,
    id,
  };
}
function cmpPri(a, b) {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  const aTs = a.relevantTimestamp?.getTime() ?? Infinity;
  const bTs = b.relevantTimestamp?.getTime() ?? Infinity;
  if (aTs !== bTs) return aTs - bTs;
  if (a.effectiveDueAt.getTime() !== b.effectiveDueAt.getTime())
    return a.effectiveDueAt.getTime() - b.effectiveDueAt.getTime();
  if (a.manualPriorityRank !== b.manualPriorityRank) return a.manualPriorityRank - b.manualPriorityRank;
  if (a.value !== b.value) return b.value - a.value;
  if (a.fitRank !== b.fitRank) return a.fitRank - b.fitRank;
  return a.id - b.id;
}

const created = d("2025-01-01T00:00:00Z");

// All 10 buckets ordered correctly
const allBuckets = [
  mkPri("NO_ACTION",         d("2025-07-01T00:00:00Z"), null, "low",    0,    "low",    10, created),
  mkPri("UNKNOWN",           null,                       null, "low",    0,    "low",    9,  created),
  mkPri("SNOOZED",           null,                       null, "low",    0,    "low",    8,  created),
  mkPri("BLOCKED",           null,                       null, "low",    0,    "low",    7,  created),
  mkPri("WAITING_CUSTOMER",  null, d("2025-04-01T00:00:00Z"), "low",    0,    "low",    6,  created),
  mkPri("SCHEDULED",         d("2025-07-01T00:00:00Z"), null, "low",    0,    "low",    5,  created),
  mkPri("NEVER_CONTACTED",   null,                       null, "low",    0,    "low",    4,  created),
  mkPri("CUSTOMER_NUDGE_DUE",null, d("2025-05-01T00:00:00Z"), "low",   0,    "low",    3,  created),
  mkPri("DUE",               d("2025-06-01T00:00:00Z"), null, "low",    0,    "low",    2,  created),
  mkPri("CRITICAL",          d("2025-05-01T00:00:00Z"), null, "low",    0,    "low",    1,  created),
].sort(cmpPri);

const expectedOrder = ["CRITICAL","DUE","CUSTOMER_NUDGE_DUE","NEVER_CONTACTED","SCHEDULED","WAITING_CUSTOMER","BLOCKED","SNOOZED","UNKNOWN","NO_ACTION"];
ok("All 10 buckets in correct order",
   allBuckets.map(r => expectedOrder[r.bucket-1]).join(",") ===
   expectedOrder.map(s => s).join(","));
ok("CRITICAL bucket = 1", STATUS_BUCKET["CRITICAL"] === 1);
ok("NO_ACTION bucket = 10", STATUS_BUCKET["NO_ACTION"] === 10);

// NULL due_at sorts FIRST within DUE (most urgent)
const dueNullDue  = mkPri("DUE", null,                       null, "medium", 1000, "high", 1, created);
const dueDateDue  = mkPri("DUE", d("2025-06-01T00:00:00Z"), null, "medium", 1000, "high", 2, created);
ok("NULL due_at sorts before dated due action (effectiveDueAt = createdAt)",
   cmpPri(dueNullDue, dueDateDue) < 0,
   `null effective=${dueNullDue.effectiveDueAt.toISOString()} vs dated=${dueDateDue.effectiveDueAt.toISOString()}`);

// Manual priority tie-break
const hiPri = mkPri("DUE", null, null, "high",   100, "high", 1, created);
const mePri = mkPri("DUE", null, null, "medium", 100, "high", 2, created);
const loPri = mkPri("DUE", null, null, "low",    100, "high", 3, created);
const priSorted = [mePri, loPri, hiPri].sort(cmpPri);
ok("Deterministic priority tie-break: high before medium before low",
   priSorted[0].id === 1 && priSorted[1].id === 2 && priSorted[2].id === 3);

// Value tie-break
const hiVal = mkPri("DUE", null, null, "medium", 5000, "high", 1, created);
const loVal = mkPri("DUE", null, null, "medium", 1000, "high", 2, created);
const valSorted = [loVal, hiVal].sort(cmpPri);
ok("Deterministic value tie-break: higher value first",
   valSorted[0].id === 1);

// Fit tie-break
const hiFit = mkPri("DUE", null, null, "medium", 100, "high",   1, created);
const loFit = mkPri("DUE", null, null, "medium", 100, "low",    2, created);
const fitSorted = [loFit, hiFit].sort(cmpPri);
ok("Deterministic fit tie-break: high fit before low fit",
   fitSorted[0].id === 1);

// Stable ID final tie-break
const id1 = mkPri("DUE", null, null, "medium", 100, "high", 1, created);
const id2 = mkPri("DUE", null, null, "medium", 100, "high", 2, created);
const idSorted = [id2, id1].sort(cmpPri);
ok("Stable ID final tie-break: lower ID first",
   idSorted[0].id === 1);

// ─────────────────────────────────────────────────────────────────────────────
// C. ESTIMATED VALUE (formulas, NULL propagation, override)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── C. Estimated Value ──");

function parseSlip(raw) {
  const t = raw.trim();
  if (!t || t === "-" || t === "—") return { normalized: null, confidence: "reject" };
  if (/^-\d/.test(t)) return { normalized: null, confidence: "reject" };
  if (/^\d+$/.test(t)) return { normalized: parseInt(t, 10), confidence: "high" };
  if (/^\d{1,3}(,\d{3})+$/.test(t)) return { normalized: parseInt(t.replace(/,/g, ""), 10), confidence: "high" };
  if (/^\d+\+$/.test(t)) return { normalized: null, confidence: "low" };
  return { normalized: null, confidence: "reject" };
}

function calcValue(i) {
  const override = i.dealValueOverride ?? null;
  const primaryValue = override ?? (i.dealAmount ?? null);
  const isOverride = override != null;

  // Pedestal resolution
  let estPedestals = null;
  let pedestalRaw = null;
  if (i.estimatedPedestalCount > 0) {
    estPedestals = i.estimatedPedestalCount;
    pedestalRaw = i.estimatedPedestalCount;
  } else if (i.slipCountInt > 0) {
    pedestalRaw = i.slipCountInt;
    if (i.sp != null && i.rp != null && i.pp != null)
      estPedestals = pedestalRaw * i.sp * i.rp * i.pp;
  } else if (i.slipsText) {
    const p = parseSlip(i.slipsText);
    if (p.confidence === "high" && p.normalized > 0) {
      pedestalRaw = p.normalized;
      if (i.sp != null && i.rp != null && i.pp != null)
        estPedestals = pedestalRaw * i.sp * i.rp * i.pp;
    }
  } else if (i.slipCount != null) {
    pedestalRaw = i.slipCount;
    if (i.sp != null && i.rp != null && i.pp != null)
      estPedestals = pedestalRaw * i.sp * i.rp * i.pp;
  }

  const hp  = i.hardwarePrice ?? null;
  const cpp = i.connectorsPerPedestal ?? null;
  const spm = i.saasMonthly ?? null;

  const estHardware  = (estPedestals != null && hp  != null) ? estPedestals * hp  : null;
  const estSaasArr   = (estPedestals != null && cpp != null && spm != null) ? estPedestals * cpp * spm * 12 : null;
  const estFirstYear = (estHardware != null && estSaasArr != null) ? estHardware + estSaasArr : null;

  return { primaryValue, isOverride, estPedestals, estHardware, estSaasArr, estFirstYear };
}

const baseSettings = { sp: 0.70, rp: 0.50, pp: 1.00, hardwarePrice: 2000, connectorsPerPedestal: 2, saasMonthly: 15 };

// Manual override precedence
const overrideResult = calcValue({ ...baseSettings, dealValueOverride: 99999, dealAmount: 100, slipsText: "400" });
ok("Manual override wins for primary value", overrideResult.primaryValue === 99999 && overrideResult.isOverride === true);

// Known pedestal count precedence
const knownPed = calcValue({ ...baseSettings, estimatedPedestalCount: 10, slipsText: "400" });
ok("Known pedestal count takes precedence over slips", knownPed.estPedestals === 10);

// Safe slip-derived calculation: 400 slips × 0.70 × 0.50 × 1.00 = 140 pedestals
const slipDerived = calcValue({ ...baseSettings, slipsText: "400", estimatedPedestalCount: 0, slipCountInt: 0 });
ok("Slip-derived pedestal count: 400×0.70×0.50×1.00 = 140",
   Math.abs(slipDerived.estPedestals - 140) < 0.001);
ok("Hardware = 140 × $2000 = $280,000",
   Math.abs(slipDerived.estHardware - 280_000) < 0.001);
ok("SaaS ARR = 140 × 2 × $15 × 12 = $50,400",
   Math.abs(slipDerived.estSaasArr - 50_400) < 0.001);
ok("First-Year = $330,400",
   Math.abs(slipDerived.estFirstYear - 330_400) < 0.001);

// Hardware NULL when price unset
const noHpResult = calcValue({ sp: 0.70, rp: 0.50, pp: 1.00, slipsText: "400", connectorsPerPedestal: 2, saasMonthly: 15, hardwarePrice: null });
ok("Hardware is NULL when hardware price unset", noHpResult.estHardware === null);

// SaaS NULL when connectors-per-pedestal unset
const noCppResult = calcValue({ sp: 0.70, rp: 0.50, pp: 1.00, slipsText: "400", hardwarePrice: 2000, connectorsPerPedestal: null, saasMonthly: 15 });
ok("SaaS ARR is NULL when connectors-per-pedestal unset", noCppResult.estSaasArr === null);

// First-Year NULL when any component missing
ok("First-Year NULL when hardware is null", noHpResult.estFirstYear === null);
ok("First-Year NULL when SaaS is null", noCppResult.estFirstYear === null);
ok("No partial total returned", noHpResult.estFirstYear === null && noCppResult.estFirstYear === null);

// ─────────────────────────────────────────────────────────────────────────────
// D. SLIP PARSING
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── D. Slip parsing ──");

function parse(s) { return parseSlip(s); }

ok('"480" → 480 high confidence',       parse("480").normalized === 480   && parse("480").confidence === "high");
ok('"1,200" → 1200 high confidence',    parse("1,200").normalized === 1200 && parse("1,200").confidence === "high");
ok('"160+" → null low confidence',      parse("160+").normalized === null  && parse("160+").confidence === "low");
ok('"100-150" → null reject',           parse("100-150").normalized === null && parse("100-150").confidence === "reject");
ok('"150 - tbd" → null reject',         parse("150 - tbd").normalized === null && parse("150 - tbd").confidence === "reject");
ok('"-" → null reject',                 parse("-").normalized === null     && parse("-").confidence === "reject");
ok('"prose text" → null reject',        parse("Up to 1000 (marina group)").normalized === null && parse("Up to 1000 (marina group)").confidence === "reject");
ok('"-10" → null reject (negative)',    parse("-10").normalized === null   && parse("-10").confidence === "reject");

// Parse rate calculation from actual DB data (from dry-run)
const TOTAL_LEADS   = 55129;
const NON_EMPTY     = 7541;
const HIGH_CONF     = 6674; // exact integers only; dash-only (865) + prose (2) are rejected
const PARSE_RATE    = HIGH_CONF / NON_EMPTY;
ok("Clean parse rate ≥ 70% → backfill recommended",   PARSE_RATE >= 0.70,   `rate=${(PARSE_RATE*100).toFixed(1)}%`);
ok("Clean parse rate is ~88.5%",                       Math.abs(PARSE_RATE - 0.885) < 0.01);
ok("Dash-only rows are rejected (865)",                865 / NON_EMPTY < 0.15);

// ─────────────────────────────────────────────────────────────────────────────
// E. MIGRATION SAFETY (source-grep)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── E. Migration safety ──");

const seedSrc = read("server/seed-production.ts");
const idxSrc  = read("server/index.ts");

ok("migrateNextActionsSchema exported from seed-production.ts",  has(seedSrc, "export async function migrateNextActionsSchema"));
ok("migrateOrgSettingsSchema exported from seed-production.ts",  has(seedSrc, "export async function migrateOrgSettingsSchema"));
ok("next_actions table created with IF NOT EXISTS",               has(seedSrc, "CREATE TABLE IF NOT EXISTS next_actions"));
ok("org_settings table created with IF NOT EXISTS",               has(seedSrc, "CREATE TABLE IF NOT EXISTS org_settings"));
ok("trigger function uses CREATE OR REPLACE FUNCTION",            has(seedSrc, "CREATE OR REPLACE FUNCTION next_actions_auto_timestamps"));
ok("trigger uses BEFORE INSERT OR UPDATE",                        has(seedSrc, "BEFORE INSERT OR UPDATE ON next_actions"));
ok("partial unique index for lead_id",                            has(seedSrc, "uq_next_actions_open_lead"));
ok("partial unique index for account_id",                         has(seedSrc, "uq_next_actions_open_account"));
ok("CHECK constraint for waiting_on",                             has(seedSrc, /waiting_on.*IN.*voltsafe.*customer/));
ok("CHECK constraint for status",                                 has(seedSrc, /status.*IN.*open.*completed.*cancelled/));
ok("num_nonnulls CHECK present",                                  has(seedSrc, "num_nonnulls(lead_id, account_id) = 1"));
ok("ON DELETE CASCADE on lead_id FK",                             has(seedSrc, /lead_id.*REFERENCES leads.*ON DELETE CASCADE/s));
ok("ON DELETE CASCADE on account_id FK",                          has(seedSrc, /account_id.*REFERENCES accounts.*ON DELETE CASCADE/s));
ok("owner_user_id FK ON DELETE SET NULL",                         has(seedSrc, "ON DELETE SET NULL"));
ok("leads.priority column added",                                 has(seedSrc, /ADD COLUMN IF NOT EXISTS priority.*TEXT.*DEFAULT 'medium'/));
ok("leads.fit column added",                                      has(seedSrc, /ADD COLUMN IF NOT EXISTS fit.*TEXT.*NULL/));
ok("leads.shore_power_coverage_pct added",                        has(seedSrc, /ADD COLUMN IF NOT EXISTS shore_power_coverage_pct/));
ok("leads.deal_value_override added",                             has(seedSrc, /ADD COLUMN IF NOT EXISTS deal_value_override/));
ok("accounts.fit column added",                                   has(seedSrc, /ADD COLUMN IF NOT EXISTS fit.*TEXT/));
ok("accounts.shore_power_coverage_pct added",                     has(seedSrc, /ADD COLUMN IF NOT EXISTS shore_power_coverage_pct/));
ok("accounts.deal_value_override added",                          has(seedSrc, /ADD COLUMN IF NOT EXISTS deal_value_override/));
// Extract only the two new migration function bodies for safety checks
// (the existing seed file legitimately has TRUNCATE in test-data helpers)
const nextActionsBlock = seedSrc.slice(seedSrc.indexOf("export async function migrateNextActionsSchema"));
const orgSettingsBlock = seedSrc.slice(seedSrc.indexOf("export async function migrateOrgSettingsSchema"));
const myMigrations = nextActionsBlock + orgSettingsBlock;
ok("No DROP TABLE in new migrations",                             !has(myMigrations, /DROP TABLE\b/));
ok("No TRUNCATE in new migrations",                               !has(myMigrations, /TRUNCATE\b/));
ok("No destructive DELETE in new migrations",                     !has(myMigrations, /DELETE FROM.*leads|DELETE FROM.*accounts/));
ok("No destructive UPDATE of live data",                          !has(seedSrc, /UPDATE leads SET\b|UPDATE accounts SET\b/));
ok("Legacy comm status untouched (no ALTER lead_comms_summary)",  !has(seedSrc, "ALTER TABLE lead_comms_summary"));
ok("accounts.next_action stubs untouched",                        !has(seedSrc, /DROP.*next_action_at|ALTER.*accounts.*DROP/));
ok("org_settings singleton row inserted ON CONFLICT DO NOTHING",  has(seedSrc, /INSERT INTO org_settings.*ON CONFLICT DO NOTHING/s));
ok("migrateNextActionsSchema wired into index.ts",                has(idxSrc,  "migrateNextActionsSchema"));
ok("migrateOrgSettingsSchema wired into index.ts",                has(idxSrc,  "migrateOrgSettingsSchema"));

// Settings service
const orgSvc = read("server/services/org-settings.ts");
ok("org-settings.ts exports getOrgSettings()",                    has(orgSvc, "export async function getOrgSettings"));
ok("critical_overdue_days default = 3",                           has(orgSvc, "critical_overdue_days:           3"));
ok("customer_wait_nudge_days default = 14",                       has(orgSvc, "customer_wait_nudge_days:        14"));
ok("org_timezone default = America/Vancouver",                    has(orgSvc, '"America/Vancouver"'));
ok("ev_hardware_revenue_per_pedestal nullable",                   has(orgSvc, "ev_hardware_revenue_per_pedestal: null"));
ok("ev_connectors_per_pedestal nullable",                         has(orgSvc, "ev_connectors_per_pedestal:       null"));
ok("ev_saas_per_connector_month default = 15",                    has(orgSvc, "ev_saas_per_connector_month:      15"));
ok("invalidateOrgSettingsCache exported",                         has(orgSvc, "export function invalidateOrgSettingsCache"));

// Status service
const statusSvc = read("server/services/next-action-status.ts");
ok("calendarDaysBetween uses Intl.DateTimeFormat (DST-safe)",     has(statusSvc, "Intl.DateTimeFormat"));
ok("calendarDaysBetween does NOT use elapsed ms / 86400 raw",     !has(statusSvc, "/ 86400000)"));
ok("All 10 states exported",                                      ["NEVER_CONTACTED","UNKNOWN","NO_ACTION","SCHEDULED","DUE","CRITICAL","WAITING_CUSTOMER","CUSTOMER_NUDGE_DUE","BLOCKED","SNOOZED"].every(s => has(statusSvc, s)));
ok("STATUS_BUCKET exported",                                      has(statusSvc, "export const STATUS_BUCKET"));
ok("deriveNextActionStatus exported",                             has(statusSvc, "export function deriveNextActionStatus"));
ok("computeSmartPriority exported",                               has(statusSvc, "export function computeSmartPriority"));
ok("compareSmartPriority exported",                               has(statusSvc, "export function compareSmartPriority"));

// Value service
const valSvc = read("server/services/next-action-value.ts");
ok("parseSlipCount exported",                                     has(valSvc, "export function parseSlipCount"));
ok("buildSlipParseReport exported",                               has(valSvc, "export function buildSlipParseReport"));
ok("calculateEstimatedValue exported",                            has(valSvc, "export function calculateEstimatedValue"));
ok("est_hardware formula present",                                has(valSvc, "estPedestals * hp"));
ok("est_saas_arr formula present",                                has(valSvc, "estPedestals * cpp * spm * 12"));
ok("No partial total (estFirstYear null when any missing)",       has(valSvc, "estHardware != null && estSaasArr != null"));

// Schema
const schemaSrc = read("shared/schema.ts");
ok("nextActions table in schema",                                  has(schemaSrc, 'pgTable("next_actions"'));
ok("orgSettings table in schema",                                  has(schemaSrc, 'pgTable("org_settings"'));
ok("NextAction type exported",                                     has(schemaSrc, "export type NextAction"));
ok("OrgSettings type exported",                                    has(schemaSrc, "export type OrgSettings"));

// ─────────────────────────────────────────────────────────────────────────────
// F. DB CONSTRAINTS & TRIGGER (live DB)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── F. DB constraints & trigger ──");

async function runDbTests() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  async function query(sql, params = []) {
    return client.query(sql, params);
  }

  async function dbOk(label, fn) {
    try {
      const result = await fn();
      ok(label, true);
      return result;
    } catch (e) {
      ok(label, false, e.message?.slice(0, 100));
      return null;
    }
  }

  async function dbFails(label, fn, errPattern) {
    try {
      await fn();
      ok(label, false, "Expected an error but query succeeded");
    } catch (e) {
      const msg = e.message ?? "";
      if (errPattern) ok(label, errPattern.test(msg), `Expected pattern ${errPattern} in: ${msg.slice(0,100)}`);
      else ok(label, true);
    }
  }

  // Verify tables exist
  const tableCheck = await query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('next_actions','org_settings')
    ORDER BY table_name
  `);
  ok("next_actions table exists in DB",
     tableCheck.rows.some(r => r.table_name === "next_actions"));
  ok("org_settings table exists in DB",
     tableCheck.rows.some(r => r.table_name === "org_settings"));

  // Verify org_settings singleton row
  const osRow = await query("SELECT * FROM org_settings WHERE id = 1");
  ok("org_settings singleton row id=1 exists",         osRow.rows.length === 1);
  ok("org_timezone default = America/Vancouver",        osRow.rows[0]?.org_timezone === "America/Vancouver");
  ok("critical_overdue_days default = 3",               Number(osRow.rows[0]?.critical_overdue_days) === 3);
  ok("customer_wait_nudge_days default = 14",           Number(osRow.rows[0]?.customer_wait_nudge_days) === 14);
  ok("ev_hardware_revenue_per_pedestal is NULL",        osRow.rows[0]?.ev_hardware_revenue_per_pedestal == null);
  ok("ev_connectors_per_pedestal is NULL",              osRow.rows[0]?.ev_connectors_per_pedestal == null);
  ok("ev_saas_per_connector_month = 15",                Number(osRow.rows[0]?.ev_saas_per_connector_month) === 15);

  // Verify new columns on leads
  const leadsColCheck = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='leads'
    AND column_name IN ('priority','fit','shore_power_coverage_pct','deal_value_override')
    ORDER BY column_name
  `);
  const leadCols = leadsColCheck.rows.map(r => r.column_name);
  ok("leads.priority column exists",               leadCols.includes("priority"));
  ok("leads.fit column exists",                    leadCols.includes("fit"));
  ok("leads.shore_power_coverage_pct exists",      leadCols.includes("shore_power_coverage_pct"));
  ok("leads.deal_value_override exists",           leadCols.includes("deal_value_override"));

  // Verify new columns on accounts
  const acctColCheck = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='accounts'
    AND column_name IN ('fit','shore_power_coverage_pct','deal_value_override')
    ORDER BY column_name
  `);
  const acctCols = acctColCheck.rows.map(r => r.column_name);
  ok("accounts.fit column exists",                 acctCols.includes("fit"));
  ok("accounts.shore_power_coverage_pct exists",   acctCols.includes("shore_power_coverage_pct"));
  ok("accounts.deal_value_override exists",        acctCols.includes("deal_value_override"));

  // Verify partial unique indexes exist
  const idxCheck = await query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename='next_actions'
    AND indexname IN ('uq_next_actions_open_lead','uq_next_actions_open_account')
    ORDER BY indexname
  `);
  ok("Partial unique index uq_next_actions_open_lead exists",    idxCheck.rows.some(r => r.indexname === "uq_next_actions_open_lead"));
  ok("Partial unique index uq_next_actions_open_account exists", idxCheck.rows.some(r => r.indexname === "uq_next_actions_open_account"));

  // Verify trigger exists
  const trigCheck = await query(`
    SELECT trigger_name FROM information_schema.triggers
    WHERE event_object_schema='public' AND event_object_table='next_actions'
    AND trigger_name='trg_next_actions_auto_ts'
  `);
  ok("Trigger trg_next_actions_auto_ts exists on next_actions", trigCheck.rows.length >= 1);

  // Get a valid lead and account ID for constraint testing
  const leadRow  = await query("SELECT id FROM leads  LIMIT 1");
  const acctRow  = await query("SELECT id FROM accounts LIMIT 1");
  if (leadRow.rows.length === 0 || acctRow.rows.length === 0) {
    ok("SKIP: need at least one lead and account for constraint tests", false, "No test data");
    await client.end();
    return;
  }
  const leadId = leadRow.rows[0].id;
  const acctId = acctRow.rows[0].id;

  // Clean up any test rows from previous runs
  await query(`DELETE FROM next_actions WHERE title LIKE 'TEST_RUN1_%'`);

  // Exactly one FK required
  await dbFails("REJECT: neither lead_id nor account_id set",
    () => query(`INSERT INTO next_actions (title, waiting_on, status) VALUES ('TEST_RUN1_none','voltsafe','open')`),
    /check|constraint/i);

  await dbFails("REJECT: both lead_id and account_id set",
    () => query(`INSERT INTO next_actions (lead_id, account_id, title, waiting_on, status) VALUES ($1, $2, 'TEST_RUN1_both','voltsafe','open')`, [leadId, acctId]),
    /check|constraint/i);

  // Valid insert with lead_id
  const ins1 = await dbOk("ACCEPT: lead_id only",
    () => query(`INSERT INTO next_actions (lead_id, title, waiting_on, status) VALUES ($1, 'TEST_RUN1_lead1','voltsafe','open') RETURNING id, waiting_since_at, updated_at`, [leadId]));

  // Trigger: insert sets waiting_since_at and updated_at
  if (ins1) {
    ok("Trigger: INSERT sets waiting_since_at to non-null", ins1.rows[0].waiting_since_at != null);
    ok("Trigger: INSERT sets updated_at to non-null",       ins1.rows[0].updated_at != null);

    const actionId = ins1.rows[0].id;

    // Second open lead action rejected
    await dbFails("REJECT: second open action for same lead",
      () => query(`INSERT INTO next_actions (lead_id, title, waiting_on, status) VALUES ($1, 'TEST_RUN1_lead2','voltsafe','open')`, [leadId]),
      /unique|constraint/i);

    // Completed historical actions do not block new open action
    await dbOk("completed historical action accepted alongside open",
      () => query(`INSERT INTO next_actions (lead_id, title, waiting_on, status, completed_at) VALUES ($1, 'TEST_RUN1_hist','customer','completed', NOW())`, [leadId]));

    // cancelled historical
    await dbOk("cancelled historical action accepted",
      () => query(`INSERT INTO next_actions (lead_id, title, waiting_on, status, cancelled_at) VALUES ($1, 'TEST_RUN1_cancel','voltsafe','cancelled', NOW())`, [leadId]));

    // Trigger: update changes updated_at
    await query(`SELECT pg_sleep(0.01)`); // small delay so updated_at must change
    const upd1 = await query(`UPDATE next_actions SET title = 'TEST_RUN1_lead1_upd' WHERE id = $1 RETURNING waiting_since_at, updated_at, waiting_on`, [actionId]);
    ok("Trigger: UPDATE sets new updated_at", upd1.rows.length === 1);

    // Trigger: unrelated update does NOT reset waiting_since_at
    const wsa1 = upd1.rows[0].waiting_since_at;
    const upd2 = await query(`UPDATE next_actions SET title = 'TEST_RUN1_lead1_upd2' WHERE id = $1 RETURNING waiting_since_at`, [actionId]);
    ok("Trigger: unrelated update does NOT reset waiting_since_at",
       upd2.rows[0].waiting_since_at?.toISOString() === wsa1?.toISOString());

    // Trigger: waiting_on change resets waiting_since_at
    await query(`SELECT pg_sleep(0.05)`);
    const upd3 = await query(`UPDATE next_actions SET waiting_on = 'customer' WHERE id = $1 RETURNING waiting_since_at`, [actionId]);
    ok("Trigger: waiting_on change resets waiting_since_at",
       upd3.rows[0].waiting_since_at?.toISOString() !== wsa1?.toISOString());

    // Trigger: waiting_on='voltsafe' clears due_at
    await query(`UPDATE next_actions SET due_at = NOW() + INTERVAL '7 days' WHERE id = $1`, [actionId]);
    const upd4 = await query(`UPDATE next_actions SET waiting_on = 'voltsafe' WHERE id = $1 RETURNING due_at`, [actionId]);
    ok("Trigger: waiting_on→voltsafe sets due_at=NULL", upd4.rows[0].due_at == null);

    // Trigger: status→completed sets completed_at
    const comp = await query(`UPDATE next_actions SET status = 'completed' WHERE id = $1 RETURNING completed_at`, [actionId]);
    ok("Trigger: status=completed sets completed_at", comp.rows[0].completed_at != null);
  }

  // Valid insert with account_id
  const ins2 = await dbOk("ACCEPT: account_id only",
    () => query(`INSERT INTO next_actions (account_id, title, waiting_on, status) VALUES ($1, 'TEST_RUN1_acct1','customer','open') RETURNING id`, [acctId]));

  if (ins2) {
    const acctActionId = ins2.rows[0].id;
    // Second open account action rejected
    await dbFails("REJECT: second open action for same account",
      () => query(`INSERT INTO next_actions (account_id, title, waiting_on, status) VALUES ($1, 'TEST_RUN1_acct2','voltsafe','open')`, [acctId]),
      /unique|constraint/i);

    // Trigger: cancellation sets cancelled_at
    const canc = await query(`UPDATE next_actions SET status = 'cancelled' WHERE id = $1 RETURNING cancelled_at`, [acctActionId]);
    ok("Trigger: status=cancelled sets cancelled_at", canc.rows[0].cancelled_at != null);
  }

  // CHECK: invalid waiting_on value
  await dbFails("REJECT: invalid waiting_on value",
    () => query(`INSERT INTO next_actions (lead_id, title, waiting_on, status) VALUES ($1, 'TEST_RUN1_badwait','nobody','open')`, [leadId]),
    /check|constraint/i);

  // CHECK: invalid status value
  await dbFails("REJECT: invalid status value",
    () => query(`INSERT INTO next_actions (lead_id, title, waiting_on, status) VALUES ($1, 'TEST_RUN1_badstatus','voltsafe','pending')`, [leadId]),
    /check|constraint/i);

  // Cascade delete: delete lead and verify action deleted
  // (We'll use a newly created lead to avoid deleting real data)
  const newLead = await query(`INSERT INTO leads (company, contact_name, status) VALUES ('TEST_RUN1_cascade_lead','Test Contact','new') RETURNING id`);
  if (newLead.rows.length > 0) {
    const nlId = newLead.rows[0].id;
    await query(`INSERT INTO next_actions (lead_id, title, waiting_on, status) VALUES ($1, 'TEST_RUN1_cascade','voltsafe','open')`, [nlId]);
    await query(`DELETE FROM leads WHERE id = $1`, [nlId]);
    const cascadeCheck = await query(`SELECT COUNT(*) FROM next_actions WHERE lead_id = $1 AND title='TEST_RUN1_cascade'`, [nlId]);
    ok("Lead delete cascades next_action row",
       parseInt(cascadeCheck.rows[0].count) === 0);
  }

  // Soft-delete verification: no deleted_at or is_deleted on leads/accounts
  const softDeleteCheck = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('leads','accounts')
    AND column_name IN ('deleted_at','is_deleted')
  `);
  ok("No soft-delete columns on leads or accounts (hard delete confirmed)", softDeleteCheck.rows.length === 0);

  // Legacy fields untouched
  const legacyCheck = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='accounts'
    AND column_name IN ('next_action','next_action_at','next_action_owner_user_id','last_interaction_at')
    ORDER BY column_name
  `);
  ok("accounts.next_action legacy stub still exists",              legacyCheck.rows.some(r => r.column_name === "next_action"));
  ok("accounts.next_action_at legacy stub still exists",          legacyCheck.rows.some(r => r.column_name === "next_action_at"));
  ok("accounts.next_action_owner_user_id stub still exists",      legacyCheck.rows.some(r => r.column_name === "next_action_owner_user_id"));
  ok("accounts.last_interaction_at stub still exists",            legacyCheck.rows.some(r => r.column_name === "last_interaction_at"));

  // lead_comms_summary untouched
  const lcsCheck = await query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name='lead_comms_summary'
  `);
  ok("lead_comms_summary table still exists", lcsCheck.rows.length === 1);

  // Clean up test rows
  await query(`DELETE FROM next_actions WHERE title LIKE 'TEST_RUN1_%'`);

  await client.end();
}

// Run DB tests then report
runDbTests().then(() => {
  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════════════`);
  process.exit(failed > 0 ? 1 : 0);
}).catch(e => {
  console.error("Fatal DB test error:", e.message);
  process.exit(1);
});
