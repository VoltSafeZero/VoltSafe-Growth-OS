/**
 * ⚠️⚠️⚠️  TEMPORARY — DELETE AFTER BC MARINA ENRICHMENT IMPORT IS COMPLETE  ⚠️⚠️⚠️
 *
 * This file provides a single admin-gated endpoint that runs the BC marina
 * enrichment import logic from inside the production container, where
 * DATABASE_URL is already the production database.
 *
 * Endpoint:  POST /api/admin/run-bc-marina-enrichment
 * Auth:      session-based requireAuth + requireAdmin  (admin or master_admin)
 * Body:      { "mode": "dry-run" }
 *            { "mode": "apply", "confirm": "APPLY_BC_MARINA_ENRICHMENT_2026_05_22" }
 *
 * TODO: delete this file and its registration line in routes.ts when done.
 */

import type { Express } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { db, pool } from "./db";
import { sql } from "drizzle-orm";
import { leads } from "../shared/schema";
import * as fs from "fs";
import * as path from "path";

// ─── Constants ────────────────────────────────────────────────────────────────

const CSV_PATH = path.resolve(
  process.cwd(),
  "attached_assets/voltsafe_bc_marina_leads_address_focus_2026-05-21_1779390777512.csv"
);

// Exact confirm token required to unlock apply mode.
const APPLY_CONFIRM_TOKEN = "APPLY_BC_MARINA_ENRICHMENT_2026_05_22";

// ─── Hard-block list ─────────────────────────────────────────────────────────
// Rows that must NEVER be imported regardless of CSV content.
const HARD_BLOCK = new Set<string>([
  "test marina",
  "shelter bay marina (west kelowna)",
]);

// ─── Name / geo normalisation ─────────────────────────────────────────────────
const STOP = new Set([
  "marina","marinas","harbour","harbor","authority","yacht","club","rv","park",
  "resort","resorts","the","inc","ltd","limited","llc","co","company","wharf",
  "dock","boat","boats","boating","and","&","at","of","a","an","boatyard",
  "moorings","moorage","facilities","pier","jetty",
]);
function normName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[\u2018\u2019\u02bc\u2032'']/g, "")
    .replace(/[\u2013\u2014\u2010\u2011]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP.has(w))
    .join(" ")
    .trim();
}
function normCity(s: string | null | undefined): string {
  if (!s) return "";
  return s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function normProv(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.trim().toLowerCase().replace(/\./g, "");
  if (t === "bc" || t === "british columbia") return "british columbia";
  if (t === "on" || t === "ontario") return "ontario";
  if (t === "ab" || t === "alberta") return "alberta";
  if (t === "qc" || t === "quebec" || t === "québec") return "quebec";
  return t.replace(/[^a-z ]+/g, " ").trim();
}
function canonCountry(s: string | null | undefined): string {
  const t = (s ?? "").trim().toLowerCase().replace(/\./g, "");
  if (t === "ca" || t === "can" || t === "canada") return "Canada";
  if (t === "us" || t === "usa" || t === "united states") return "United States";
  return s?.trim() || "Canada";
}

// ─── Blank detection ──────────────────────────────────────────────────────────
const BLANKS = new Set(["", "-", "n/a", "na", "null", "none", "unknown", "0", "tbd", "tbc"]);
function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return BLANKS.has(String(v).trim().toLowerCase());
}
function emp(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}
function parseSlipsInt(v: string): number | null {
  const n = parseInt(v.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function sanitisePhone(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t || t === "-") return null;
  return t.replace(/\D/g, "").length >= 7 ? t : null;
}

// ─── Field maps ───────────────────────────────────────────────────────────────
type FieldDef = { csv: string; db: string; xform?: (v: string) => string | null };
const LEAD_FIELDS: FieldDef[] = [
  { csv: "Street Address", db: "street_address" },
  { csv: "City",           db: "city" },
  { csv: "State",          db: "state" },
  { csv: "Zip / Postal",   db: "zip_code" },
  { csv: "Country",        db: "country",          xform: canonCountry },
  { csv: "Contact Email",  db: "contact_email" },
  { csv: "Contact Phone",  db: "contact_phone",    xform: sanitisePhone },
  { csv: "Slips",          db: "slips" },
  { csv: "Industry",       db: "primary_industry" },
  { csv: "Relationship Type", db: "relationship_type" },
  { csv: "Conversion Target", db: "conversion_target" },
];
const ACCOUNT_FIELDS: FieldDef[] = [
  { csv: "Street Address", db: "street_address" },
  { csv: "City",           db: "city" },
  { csv: "State",          db: "state_province" },
  { csv: "Zip / Postal",   db: "postal_zip" },
  { csv: "Country",        db: "country",          xform: canonCountry },
];

// ─── Enrichment notes block ───────────────────────────────────────────────────
function enrichmentBlock(row: Record<string, string>, dateLabel: string): string | null {
  const parts: string[] = [];
  const add = (label: string, key: string) => {
    const v = (row[key] ?? "").trim();
    if (!isBlank(v) && v.toLowerCase() !== "no" && v.length > 1) parts.push(`${label}: ${v}`);
  };
  add("Power Service",      "Power Service Found");
  add("30A Shore Power",    "30A Shore Power");
  add("50A+ Shore Power",   "50A+ Shore Power");
  add("Fuel Dock",          "Fuel Dock");
  add("Pumpout",            "Pumpout");
  add("Transient Moorage",  "Transient Moorage");
  add("Moorage Notes",      "Marina Size / Moorage Notes");
  add("Source URL",         "Primary Source URL");
  add("Research Notes",     "Research Notes");
  add("QA Confidence",      "QA Confidence");
  add("Address Confidence", "Address Confidence");
  add("Address Research",   "Address Research Status");
  if (!parts.length) return null;
  return `--- Enrichment Import ${dateLabel} ---\n${parts.join("\n")}`;
}

// ─── Compute updates (blank-fill only) ───────────────────────────────────────
function computeUpdates(
  csvRow: Record<string, string>,
  dbRow: Record<string, any>,
  fields: FieldDef[]
): { updates: Record<string, string>; skipped: string[] } {
  const updates: Record<string, string> = {};
  const skipped: string[] = [];
  for (const { csv, db: col, xform } of fields) {
    const csvVal = emp(csvRow[csv]);
    if (csvVal === null || isBlank(csvVal)) continue;
    const dbVal = dbRow[col];
    if (!isBlank(dbVal)) {
      skipped.push(`${col}(db:${String(dbVal ?? "").slice(0, 35)})`);
      continue;
    }
    const final = xform ? xform(csvVal) : csvVal;
    if (final !== null) updates[col] = final;
  }
  return { updates, skipped };
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCsv(text: string): Record<string, string>[] {
  const cells: string[][] = [];
  let row: string[] = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { row.push(cur); cur = ""; }
      else if (c === '\n') { row.push(cur); cur = ""; cells.push(row); row = []; }
      else if (c === '\r') { /* skip */ }
      else cur += c;
    }
  }
  if (cur !== "" || row.length > 0) { row.push(cur); cells.push(row); }
  while (cells.length && cells[cells.length - 1].every((v) => v === "")) cells.pop();
  if (!cells.length) return [];
  const headers = cells[0].map((h) => h.trim());
  return cells.slice(1).map((cols) => {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => { r[h] = (cols[i] ?? "").trim(); });
    return r;
  });
}

// ─── CSV writer ───────────────────────────────────────────────────────────────
function csvEsc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(rows: Record<string, string>[], headers: string[], filePath: string) {
  const lines = [headers.map(csvEsc).join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEsc(r[h] ?? "")).join(","));
  fs.writeFileSync(filePath, lines.join("\r\n") + "\r\n", "utf8");
}

// ─── Core matching engine ─────────────────────────────────────────────────────
async function runEnrichmentEngine(dateLabel: string, stamp: string) {
  // Sanity check — confirm which database we are connected to
  const sanityRaw = await (db as any).execute(sql`
    SELECT current_database() AS db_name,
           inet_server_addr()::text AS host,
           inet_server_port() AS port
  `);
  const sr = Array.isArray(sanityRaw) ? sanityRaw[0] : (sanityRaw as any).rows?.[0];
  const dbName  = sr?.db_name ?? "unknown";
  const dbHost  = sr?.host    ?? "unknown";
  const dbPort  = sr?.port    ?? "unknown";

  // Load leads
  const rawLeads = (await (db as any).execute(sql`
    SELECT id, company, city, state, country,
           street_address, zip_code, contact_email, contact_phone,
           slips, notes, source, primary_industry,
           relationship_type, conversion_target
    FROM leads
    WHERE country ILIKE 'canada' OR country ILIKE 'ca'
       OR state ILIKE '%british columbia%' OR state ILIKE 'bc'
  `)) as any;
  const allLeads: any[] = Array.isArray(rawLeads) ? rawLeads : (rawLeads.rows ?? []);

  // Load accounts
  const rawAccts = (await (db as any).execute(sql`
    SELECT id, name, city, state_province, country,
           street_address, postal_zip, slip_count, notes, lead_source
    FROM accounts
    WHERE country ILIKE 'canada' OR country ILIKE 'ca'
       OR state_province ILIKE '%british columbia%' OR state_province ILIKE 'bc'
  `)) as any;
  const allAccts: any[] = Array.isArray(rawAccts) ? rawAccts : (rawAccts.rows ?? []);

  // Build lookup indexes
  function makeIndex<T>(items: T[], getName: (i: T) => string, getGeo: (i: T) => string) {
    const m = new Map<string, T[]>();
    for (const item of items) {
      const nn = normName(getName(item));
      if (!nn) continue;
      const key = `${nn}||${getGeo(item)}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(item);
    }
    return m;
  }
  const leadByProv = makeIndex(allLeads, (l: any) => l.company,       (l: any) => normProv(l.state));
  const leadByCity = makeIndex(allLeads, (l: any) => l.company,       (l: any) => normCity(l.city));
  const acctByProv = makeIndex(allAccts, (a: any) => a.name,          (a: any) => normProv(a.state_province));
  const acctByCity = makeIndex(allAccts, (a: any) => a.name,          (a: any) => normCity(a.city));

  function findLead(name: string, prov: string, city: string) {
    const nn = normName(name); if (!nn) return null;
    const np = normProv(prov), nc = normCity(city);
    const hits =
      leadByProv.get(`${nn}||${np}`) ||
      leadByCity.get(`${nn}||${nc}`) ||
      leadByProv.get(`${nn}||british columbia`) ||
      null;
    if (!hits?.length) return null;
    const reason = leadByProv.has(`${nn}||${np}`) ? "name+province" :
                   leadByCity.has(`${nn}||${nc}`)  ? "name+city"    : "name+BC";
    return { lead: hits[0], reason };
  }
  function findAcct(name: string, prov: string, city: string) {
    const nn = normName(name); if (!nn) return null;
    const np = normProv(prov), nc = normCity(city);
    const hits =
      acctByProv.get(`${nn}||${np}`) ||
      acctByCity.get(`${nn}||${nc}`) ||
      acctByProv.get(`${nn}||british columbia`) ||
      null;
    if (!hits?.length) return null;
    const reason = acctByProv.has(`${nn}||${np}`) ? "name+province" :
                   acctByCity.has(`${nn}||${nc}`)  ? "name+city"    : "name+BC";
    return { acct: hits[0], reason };
  }

  // Parse CSV
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found at: ${CSV_PATH}`);
  }
  const csvRows = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));

  // Build plan
  type Action = "UPDATE_LEAD" | "UPDATE_ACCOUNT" | "CONFLICT_REVIEW" | "CREATE_LEAD" | "SKIP";
  type PlanRow = {
    rowNum: number; csv: Record<string, string>;
    action: Action; leadId: number | null; acctId: number | null;
    matchReason: string; leadUpdates: Record<string, string>; leadSkipped: string[];
    acctUpdates: Record<string, string>; acctSkipped: string[];
    notesBlock: string | null; conflictNote: string;
    dbLeadNotes: string | null; dbAcctNotes: string | null;
  };

  const plan: PlanRow[] = [];
  const counts = { UPDATE_LEAD: 0, UPDATE_ACCOUNT: 0, CONFLICT_REVIEW: 0, CREATE_LEAD: 0, SKIP: 0 };
  const seenPairs = new Set<string>();

  for (let i = 0; i < csvRows.length; i++) {
    const csv = csvRows[i];
    const name = (csv["Company"] ?? "").trim();
    const prov = (csv["State"]   ?? "").trim();
    const city = (csv["City"]    ?? "").trim();

    if (!name) {
      plan.push({ rowNum: i + 1, csv, action: "SKIP", leadId: null, acctId: null,
        matchReason: "empty name", leadUpdates: {}, leadSkipped: [],
        acctUpdates: {}, acctSkipped: [], notesBlock: null,
        conflictNote: "empty company name", dbLeadNotes: null, dbAcctNotes: null });
      counts.SKIP++; continue;
    }
    if (HARD_BLOCK.has(name.toLowerCase())) {
      plan.push({ rowNum: i + 1, csv, action: "SKIP", leadId: null, acctId: null,
        matchReason: "hard-blocked", leadUpdates: {}, leadSkipped: [],
        acctUpdates: {}, acctSkipped: [], notesBlock: null,
        conflictNote: `HARD BLOCKED: "${name}"`,
        dbLeadNotes: null, dbAcctNotes: null });
      counts.SKIP++; continue;
    }

    const lm = findLead(name, prov, city);
    const am = findAcct(name, prov, city);
    const nb = enrichmentBlock(csv, dateLabel);
    let action: Action;
    let leadUpdates: Record<string, string> = {}, leadSkipped: string[] = [];
    let acctUpdates: Record<string, string> = {}, acctSkipped: string[] = [];
    let conflictNote = "";

    if (am && lm) {
      const pairKey = `${lm.lead.id}|${am.acct.id}`;
      if (seenPairs.has(pairKey)) {
        plan.push({ rowNum: i + 1, csv, action: "SKIP",
          leadId: lm.lead.id, acctId: am.acct.id, matchReason: lm.reason,
          leadUpdates: {}, leadSkipped: [], acctUpdates: {}, acctSkipped: [],
          notesBlock: null,
          conflictNote: `DUPLICATE PAIR: Lead #${lm.lead.id} + Account #${am.acct.id} already handled`,
          dbLeadNotes: lm.lead.notes ?? null, dbAcctNotes: am.acct.notes ?? null });
        counts.SKIP++; continue;
      }
      seenPairs.add(pairKey);
      action = "CONFLICT_REVIEW";
      ({ updates: acctUpdates, skipped: acctSkipped } = computeUpdates(csv, am.acct, ACCOUNT_FIELDS));
      conflictNote = `Lead #${lm.lead.id} also matches — review for merge`;
      counts.CONFLICT_REVIEW++;
    } else if (am) {
      action = "UPDATE_ACCOUNT";
      ({ updates: acctUpdates, skipped: acctSkipped } = computeUpdates(csv, am.acct, ACCOUNT_FIELDS));
      if (isBlank(am.acct.slip_count)) {
        const si = parseSlipsInt(csv["Slips"] ?? "");
        if (si !== null) acctUpdates["slip_count"] = String(si);
      } else if (!isBlank(csv["Slips"])) {
        acctSkipped.push(`slip_count(db:${am.acct.slip_count})`);
      }
      counts.UPDATE_ACCOUNT++;
    } else if (lm) {
      action = "UPDATE_LEAD";
      ({ updates: leadUpdates, skipped: leadSkipped } = computeUpdates(csv, lm.lead, LEAD_FIELDS));
      counts.UPDATE_LEAD++;
    } else {
      action = "CREATE_LEAD";
      counts.CREATE_LEAD++;
    }

    plan.push({
      rowNum: i + 1, csv, action,
      leadId:  lm ? lm.lead.id  : null,
      acctId:  am ? am.acct.id  : null,
      matchReason: lm?.reason ?? am?.reason ?? "none",
      leadUpdates, leadSkipped, acctUpdates, acctSkipped,
      notesBlock: nb, conflictNote,
      dbLeadNotes: lm?.lead.notes  ?? null,
      dbAcctNotes: am?.acct.notes  ?? null,
    });
  }

  const active = plan.filter((p) => p.action !== "SKIP");
  const withChanges = active.filter(
    (p) => Object.keys(p.leadUpdates).length + Object.keys(p.acctUpdates).length > 0
        || p.action === "CREATE_LEAD"
  );
  const noChanges = active.filter(
    (p) => Object.keys(p.leadUpdates).length + Object.keys(p.acctUpdates).length === 0
        && p.action !== "CREATE_LEAD"
  );

  // Write report CSV
  fs.mkdirSync(path.resolve(process.cwd(), "exports"), { recursive: true });
  const reportPath = path.resolve(process.cwd(), `exports/bc-enrichment-report-prod-${stamp}.csv`);
  const reportHeaders = [
    "row_num","csv_company","csv_city","csv_state",
    "action","match_type","lead_id","account_id",
    "match_reason","fields_updated","fields_skipped",
    "notes_appended","conflict_note",
  ];
  const reportRows = plan.map((p) => {
    const updL = Object.entries(p.leadUpdates).map(([k, v]) => `${k}=${String(v).slice(0, 50)}`).join(" | ");
    const updA = Object.entries(p.acctUpdates).map(([k, v]) => `${k}=${String(v).slice(0, 50)}`).join(" | ");
    return {
      row_num:        String(p.rowNum),
      csv_company:    p.csv["Company"] ?? "",
      csv_city:       p.csv["City"]    ?? "",
      csv_state:      p.csv["State"]   ?? "",
      action:         p.action,
      match_type:     p.action === "UPDATE_LEAD"     ? "Lead"
                    : p.action === "UPDATE_ACCOUNT"  ? "Account"
                    : p.action === "CONFLICT_REVIEW" ? "Both"
                    : p.action === "CREATE_LEAD"     ? "New Lead"
                    : "Skipped",
      lead_id:        p.leadId  ? String(p.leadId)  : "",
      account_id:     p.acctId  ? String(p.acctId)  : "",
      match_reason:   p.matchReason,
      fields_updated: [updL, updA].filter(Boolean).join(" | ") || "(none)",
      fields_skipped: p.leadSkipped.concat(p.acctSkipped).join(" | ") || "(none)",
      notes_appended: p.notesBlock ? "Yes" : "No",
      conflict_note:  p.conflictNote,
    };
  });
  writeCsv(reportRows, reportHeaders, reportPath);

  // Build first-10-active summary
  const first10 = active.slice(0, 10).map((p) => {
    const flds = Object.keys({ ...p.leadUpdates, ...p.acctUpdates });
    return {
      row_num:    p.rowNum,
      action:     p.action,
      company:    (p.csv["Company"] ?? "").slice(0, 60),
      lead_id:    p.leadId,
      account_id: p.acctId,
      fields:     flds,
      notes:      !!p.notesBlock,
    };
  });

  return {
    db: { name: dbName, host: dbHost, port: dbPort },
    csv_rows_parsed: csvRows.length,
    leads_loaded:    allLeads.length,
    accounts_loaded: allAccts.length,
    counts,
    active_with_field_updates: withChanges.length,
    active_no_field_changes:   noChanges.length,
    report_file: reportPath,
    report_rows: reportRows.length,
    first_10_active: first10,
    plan,  // full plan — used internally by apply
  };
}

// ─── Route registration ───────────────────────────────────────────────────────
// ⚠️ TODO: remove this entire function call from routes.ts after enrichment is done.
export function registerBcEnrichmentRoute(app: Express) {

  /**
   * POST /api/admin/run-bc-marina-enrichment
   * ⚠️ TEMPORARY — delete after BC marina enrichment is complete.
   *
   * Body:
   *   { "mode": "dry-run" }                                     — safe, read-only
   *   { "mode": "apply", "confirm": "<APPLY_CONFIRM_TOKEN>" }   — writes to DB
   *
   * Returns JSON with summary counts, first 10 active rows, report filename.
   */
  app.post(
    "/api/admin/run-bc-marina-enrichment",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const mode    = (req.body?.mode    ?? "dry-run") as string;
      const confirm = (req.body?.confirm ?? "")        as string;

      // ── Apply guard ──────────────────────────────────────────────────────────
      if (mode === "apply" && confirm !== APPLY_CONFIRM_TOKEN) {
        return res.status(400).json({
          error: "apply mode refused",
          reason: "Missing or incorrect confirm token. Send { mode: 'apply', confirm: '<token>' }.",
          required_token: APPLY_CONFIRM_TOKEN,
        });
      }
      if (mode !== "dry-run" && mode !== "apply") {
        return res.status(400).json({ error: `Unknown mode '${mode}'. Use 'dry-run' or 'apply'.` });
      }

      // ── Dry-run ──────────────────────────────────────────────────────────────
      if (mode === "dry-run") {
        try {
          const now   = new Date();
          const pad   = (n: number) => String(n).padStart(2, "0");
          const stamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
          const dateLabel = stamp.slice(0, 10);

          const result = await runEnrichmentEngine(dateLabel, stamp);
          const { plan, ...summary } = result;

          return res.json({
            mode: "dry-run",
            ...summary,
            note: "DRY RUN — no changes made. Review report_file, then re-run with mode:apply and confirm token.",
          });
        } catch (err: any) {
          console.error("[bc-enrichment] dry-run error:", err?.message ?? err);
          return res.status(500).json({ error: err?.message ?? "Internal error during dry-run" });
        }
      }

      // ── Apply — CREATE_LEAD rows only ────────────────────────────────────────
      //
      // Hard constraints (verified before every insert):
      //   ✗ No UPDATE_LEAD
      //   ✗ No UPDATE_ACCOUNT
      //   ✗ No CONFLICT_REVIEW resolution
      //   ✗ No lead-account merge
      //   ✓ Only action === "CREATE_LEAD" rows are touched
      //   ✓ All 16 inserts are wrapped in a single transaction (all-or-nothing)
      //   ✓ Safety-check: abort if plan does not produce exactly 16 CREATE_LEAD rows
      //
      try {
        const now   = new Date();
        const pad   = (n: number) => String(n).padStart(2, "0");
        const stamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
        const dateLabel = stamp.slice(0, 10);

        const result = await runEnrichmentEngine(dateLabel, stamp);
        const { plan, counts } = result;

        // ── Safety check 1: counts must match expected profile ────────────────
        if (counts.UPDATE_LEAD !== 0) {
          return res.status(500).json({ error: "safety abort", reason: `UPDATE_LEAD=${counts.UPDATE_LEAD} — expected 0. Refusing to apply.` });
        }
        if (counts.UPDATE_ACCOUNT !== 0) {
          return res.status(500).json({ error: "safety abort", reason: `UPDATE_ACCOUNT=${counts.UPDATE_ACCOUNT} — expected 0. Refusing to apply.` });
        }

        // ── Safety check 2: isolate exactly the CREATE_LEAD rows ─────────────
        const creates = plan.filter((p) => p.action === "CREATE_LEAD");
        if (creates.length !== 16) {
          return res.status(500).json({
            error: "safety abort",
            reason: `Expected exactly 16 CREATE_LEAD rows, got ${creates.length}. Plan may have changed — do not apply until dry-run is re-verified.`,
            found: creates.map((p) => p.csv["Company"]),
          });
        }

        // ── Insert all 16 new leads in a single atomic transaction ────────────
        const IMPORT_TAG = "bc_enrichment_import_2026_05_22";
        const created: Array<{ id: number; company: string; city: string; state: string; street_address: string | null; zip: string | null }> = [];

        await db.transaction(async (tx) => {
          for (const row of creates) {
            const c = row.csv;
            const company      = (c["Company"]      ?? "").trim();
            const contactName  = (c["Contact Name"] ?? "").trim() || "Marina Contact";
            const contactEmail = (c["Contact Email"] ?? "").trim() || null;
            const contactPhone = (c["Contact Phone"] ?? "").trim() || null;
            const streetAddress = (c["Street Address"] ?? "").trim() || null;
            const city          = (c["City"]          ?? "").trim() || null;
            const state         = (c["State"]         ?? "").trim() || null;
            const zipCode       = (c["Zip / Postal"]  ?? "").trim() || null;
            const slips         = (c["Slips"]         ?? "").trim() || null;
            const source        = (c["Source"]        ?? "").trim() || null;
            const notes         = (c["Notes"]         ?? "").trim() || null;

            const [lead] = await tx.insert(leads).values({
              company,
              contactName,
              contactEmail,
              contactPhone,
              streetAddress,
              city,
              state,
              zipCode,
              country:        "Canada",
              slips,
              source,
              notes,
              status:         "new",
              segment:        "Marina",
              primaryIndustry: "marine",
              tags:           IMPORT_TAG,
              campaignTag:    "bc_marina_enrichment_2026",
            }).returning();

            created.push({
              id:             lead.id,
              company:        lead.company,
              city:           lead.city   ?? "",
              state:          lead.state  ?? "",
              street_address: lead.streetAddress ?? null,
              zip:            lead.zipCode ?? null,
            });
          }
        });

        // ── Verification report ───────────────────────────────────────────────
        return res.json({
          mode:                    "apply",
          leads_created:           created.length,
          accounts_updated:        0,
          existing_leads_updated:  0,
          conflict_rows_modified:  0,
          skips_untouched:         plan.filter((p) => p.action === "SKIP").length,
          conflict_review_untouched: counts.CONFLICT_REVIEW,
          created_leads:           created,
          note: `APPLY COMPLETE — ${created.length} new BC marina leads inserted. Zero existing records were modified.`,
        });
      } catch (err: any) {
        console.error("[bc-enrichment] apply error:", err?.message ?? err);
        return res.status(500).json({ error: err?.message ?? "Internal error during apply" });
      }
    }
  );
}
