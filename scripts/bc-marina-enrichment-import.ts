/**
 * BC Marina Enrichment Import
 *
 * NON-DESTRUCTIVE enrichment importer. Reads the enriched BC marina CSV,
 * matches rows against existing Leads and Accounts, and either reports
 * proposed changes (dry-run, default) or applies them (--apply).
 *
 * SAFETY CONTRACT:
 *   - Never overwrites a non-blank DB field with a blank CSV value.
 *   - Never overwrites a non-blank DB field — only fills nulls/blanks.
 *   - Notes are APPENDED with a datestamp — never replaced.
 *   - No Leads, Accounts, or Contacts are ever deleted.
 *   - New unmatched rows become Leads only (never Accounts).
 *   - Apply mode wraps all writes in a single DB transaction (pg native).
 *
 * Usage:
 *   npx tsx scripts/bc-marina-enrichment-import.ts                    # dry-run (dev DB)
 *   npx tsx scripts/bc-marina-enrichment-import.ts --prod             # dry-run (prod DB)
 *   npx tsx scripts/bc-marina-enrichment-import.ts --apply            # write to dev DB
 *   npx tsx scripts/bc-marina-enrichment-import.ts --prod --apply     # write to prod DB
 *   npx tsx scripts/bc-marina-enrichment-import.ts path/to/file.csv --apply
 *
 * Outputs:
 *   exports/bc-enrichment-report-{dev|prod}-YYYY-MM-DD-HHmm.csv  — audit log (always)
 *   exports/bc-enrichment-apply-{dev|prod}-YYYY-MM-DD-HHmm.json  — apply results (--apply only)
 *
 * IMPORTANT — dev vs prod:
 *   Dev and prod databases have the same BC marina data but at DIFFERENT account IDs
 *   because their auto-increment sequences diverged. A dry-run report generated
 *   against dev is NOT valid for production apply and vice versa.
 *   Always generate the dry-run and apply against the SAME database in one session.
 */

// ─── Prod-mode DB override — MUST precede all imports ────────────────────────
// tsx compiles static imports to CJS require() calls which are evaluated in
// source order, so setting DATABASE_URL here takes effect before server/db loads.
const PROD_MODE = process.argv.includes("--prod");
if (PROD_MODE) {
  const prodUrl = process.env.PROD_DATABASE_URL;
  if (!prodUrl) {
    console.error("ERROR: --prod requires PROD_DATABASE_URL to be set in the environment.");
    process.exit(1);
  }
  process.env.DATABASE_URL = prodUrl;
}

// ─── Hard-block list — rows that must NEVER be imported regardless of CSV ────
// Add entries as lowercase exact company names.
const HARD_BLOCK = new Set<string>([
  "test marina",                          // test/seed data in source spreadsheet
  "shelter bay marina (west kelowna)",    // already exists as lead #10952 in production
]);

// pg and drizzle are imported statically — they do NOT read DATABASE_URL at import
// time; only our pool creation inside main() does, which runs after PROD_MODE has
// already reassigned process.env.DATABASE_URL.  server/db is never imported.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

// ─── CLI args ─────────────────────────────────────────────────────────────────
const APPLY_MODE = process.argv.includes("--apply");
const DEFAULT_CSV = path.resolve(
  "attached_assets/voltsafe_bc_marina_leads_address_focus_2026-05-21_1779390777512.csv"
);
const CSV_ARG = process.argv
  .slice(2)
  .find((a) => !a.startsWith("--") && (a.endsWith(".csv") || a.endsWith(".CSV")));
const CSV_PATH = CSV_ARG ? path.resolve(CSV_ARG) : DEFAULT_CSV;

const NOW = new Date();
const STAMP = `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}-${pad(NOW.getDate())}-${pad(NOW.getHours())}${pad(NOW.getMinutes())}`;
const DATE_LABEL = STAMP.slice(0, 10);
const DB_ENV = PROD_MODE ? "prod" : "dev";
function pad(n: number) { return String(n).padStart(2, "0"); }
function dbHostLabel(): string {
  const url = process.env.DATABASE_URL ?? "";
  try { return new URL(url).hostname; } catch { return "unknown-host"; }
}

fs.mkdirSync("exports", { recursive: true });

// ─── CSV parser (RFC 4180 — handles quoted multiline fields) ─────────────────
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const cells: string[][] = [];
  let row: string[] = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"' && cur === "") inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); cells.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur !== "" || row.length > 0) { row.push(cur); cells.push(row); }
  while (cells.length && cells[cells.length - 1].every((v) => v === "")) cells.pop();
  if (!cells.length) return { headers: [], rows: [] };
  const headers = cells[0].map((h) => h.trim());
  const rows = cells.slice(1).map((c) => {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => { r[h] = (c[i] ?? "").trim(); });
    return r;
  });
  return { headers, rows };
}

// ─── CSV writer (RFC 4180) ────────────────────────────────────────────────────
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

// ─── Blank / placeholder detection ───────────────────────────────────────────
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

// ─── Enrichment notes block ───────────────────────────────────────────────────
function enrichmentBlock(row: Record<string, string>): string | null {
  const parts: string[] = [];
  const add = (label: string, key: string) => {
    const v = (row[key] ?? "").trim();
    if (!isBlank(v) && v.toLowerCase() !== "no" && v.length > 1) parts.push(`${label}: ${v}`);
  };
  add("Power Service",       "Power Service Found");
  add("30A Shore Power",     "30A Shore Power");
  add("50A+ Shore Power",    "50A+ Shore Power");
  add("Fuel Dock",           "Fuel Dock");
  add("Pumpout",             "Pumpout");
  add("Transient Moorage",   "Transient Moorage");
  add("Moorage Notes",       "Marina Size / Moorage Notes");
  add("Source URL",          "Primary Source URL");
  add("Research Notes",      "Research Notes");
  add("QA Confidence",       "QA Confidence");
  add("Address Confidence",  "Address Confidence");
  add("Address Research",    "Address Research Status");
  if (!parts.length) return null;
  return `--- Enrichment Import ${DATE_LABEL} ---\n${parts.join("\n")}`;
}

// ─── Field maps (CSV col → SQL column, only safe additive fields) ────────────
type FieldDef = { csv: string; db: string; xform?: (v: string) => string | null };
const LEAD_FIELDS: FieldDef[] = [
  { csv: "Street Address", db: "street_address" },
  { csv: "City",           db: "city" },
  { csv: "State",          db: "state" },
  { csv: "Zip / Postal",   db: "zip_code" },
  { csv: "Country",        db: "country",           xform: canonCountry },
  { csv: "Contact Email",  db: "contact_email" },
  { csv: "Contact Phone",  db: "contact_phone",     xform: sanitisePhone },
  { csv: "Slips",          db: "slips" },
  { csv: "Industry",       db: "primary_industry" },
  { csv: "Relationship Type",  db: "relationship_type" },
  { csv: "Conversion Target",  db: "conversion_target" },
];
const ACCOUNT_FIELDS: FieldDef[] = [
  { csv: "Street Address", db: "street_address" },
  { csv: "City",           db: "city" },
  { csv: "State",          db: "state_province" },
  { csv: "Zip / Postal",   db: "postal_zip" },
  { csv: "Country",        db: "country",       xform: canonCountry },
];

// ─── DB row types ─────────────────────────────────────────────────────────────
type DbLead = Record<string, any> & { id: number; company: string; notes: string | null };
type DbAcct = Record<string, any> & { id: number; name: string; notes: string | null };

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

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  BC Marina Enrichment Import");
  console.log(`  Mode: ${APPLY_MODE ? "★ APPLY (will write to DB)" : "DRY RUN (read-only)"}`);
  console.log(`  DB:   ${DB_ENV.toUpperCase()} — ${dbHostLabel()}`);
  console.log(`  CSV:  ${CSV_PATH}`);
  console.log("═══════════════════════════════════════════════");
  if (!PROD_MODE) {
    console.log("  ⚠  Running against DEV database. Account/Lead IDs in the report");
    console.log("     are DEV IDs only and CANNOT be used as a production pre-check.");
    console.log("     Run with --prod to generate a production-valid dry-run report.");
  }
  console.log("");

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`ERROR: CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  // ── Parse CSV ────────────────────────────────────────────────────────────────
  const { rows: csvRows } = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));
  console.log(`CSV rows parsed:  ${csvRows.length}`);

  // ── Create pool directly — server/db is intentionally never imported ────────────
  // DATABASE_URL has already been set to PROD_DATABASE_URL (if --prod) by the
  // PROD_MODE block at the very top of the file, before any module initialisation.
  // Creating the pool here ensures it uses the correct, already-overridden URL.
  const connStr = process.env.DATABASE_URL;
  if (!connStr) { console.error("ERROR: DATABASE_URL is not set."); process.exit(1); }
  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  });
  const db = drizzle(pool);

  // ── Startup sanity check — confirms which database we are actually connected to ─
  {
    const sanityRaw = await (db as any).execute(sql`
      SELECT current_database()    AS db_name,
             inet_server_addr()::text AS host,
             inet_server_port()       AS port
    `);
    const sr = Array.isArray(sanityRaw) ? sanityRaw[0] : (sanityRaw as any).rows?.[0];
    console.log(`  ✓ DB connection: ${sr?.db_name ?? "?"} @ ${sr?.host ?? "?"}:${sr?.port ?? "?"}`);

    const sampleRaw = await (db as any).execute(sql`
      SELECT id, name FROM accounts
      WHERE state_province ILIKE '%british columbia%'
      ORDER BY id
      LIMIT 5
    `);
    const sample: Array<{ id: number; name: string }> =
      Array.isArray(sampleRaw) ? sampleRaw : (sampleRaw as any).rows ?? [];
    console.log("  ✓ First 5 BC accounts in this database:");
    if (sample.length === 0) {
      console.log("       (none found — possible wrong database or no BC accounts)");
    } else {
      sample.forEach((r) => console.log(`       id=${r.id}  ${r.name}`));
    }
    console.log("");
  }

  // ── Load all BC/Canada leads ──────────────────────────────────────────────────
  const rawLeads = (await db.execute(sql`
    SELECT id, company, city, state, country,
           street_address, zip_code, contact_email, contact_phone,
           slips, notes, source, primary_industry,
           relationship_type, conversion_target
    FROM leads
    WHERE country ILIKE 'canada' OR country ILIKE 'ca'
       OR state ILIKE '%british columbia%' OR state ILIKE 'bc'
  `)) as any;
  const allLeads: DbLead[] = Array.isArray(rawLeads) ? rawLeads : (rawLeads.rows ?? []);
  console.log(`DB leads loaded:  ${allLeads.length}`);

  // ── Load all BC/Canada accounts ───────────────────────────────────────────────
  const rawAccts = (await db.execute(sql`
    SELECT id, name, city, state_province, country,
           street_address, postal_zip, slip_count, notes, lead_source
    FROM accounts
    WHERE country ILIKE 'canada' OR country ILIKE 'ca'
       OR state_province ILIKE '%british columbia%' OR state_province ILIKE 'bc'
  `)) as any;
  const allAccts: DbAcct[] = Array.isArray(rawAccts) ? rawAccts : (rawAccts.rows ?? []);
  console.log(`DB accounts loaded: ${allAccts.length}\n`);

  // ── Build lookup indexes ──────────────────────────────────────────────────────
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
  const leadByProv = makeIndex<DbLead>(allLeads, (l) => l.company, (l) => normProv(l.state));
  const leadByCity = makeIndex<DbLead>(allLeads, (l) => l.company, (l) => normCity(l.city));
  const acctByProv = makeIndex<DbAcct>(allAccts, (a) => a.name,    (a) => normProv(a.state_province));
  const acctByCity = makeIndex<DbAcct>(allAccts, (a) => a.name,    (a) => normCity(a.city));

  function findLead(name: string, prov: string, city: string) {
    const nn = normName(name);
    if (!nn) return null;
    const np = normProv(prov); const nc = normCity(city);
    const hits =
      leadByProv.get(`${nn}||${np}`) ||
      leadByCity.get(`${nn}||${nc}`) ||
      leadByProv.get(`${nn}||british columbia`) || // broader BC match
      null;
    if (!hits?.length) return null;
    const reason = leadByProv.has(`${nn}||${np}`) ? "name+province" :
                   leadByCity.has(`${nn}||${nc}`) ? "name+city" : "name+BC";
    return { lead: hits[0], reason };
  }
  function findAcct(name: string, prov: string, city: string) {
    const nn = normName(name);
    if (!nn) return null;
    const np = normProv(prov); const nc = normCity(city);
    const hits =
      acctByProv.get(`${nn}||${np}`) ||
      acctByCity.get(`${nn}||${nc}`) ||
      acctByProv.get(`${nn}||british columbia`) ||
      null;
    if (!hits?.length) return null;
    const reason = acctByProv.has(`${nn}||${np}`) ? "name+province" :
                   acctByCity.has(`${nn}||${nc}`) ? "name+city" : "name+BC";
    return { acct: hits[0], reason };
  }

  // ── Build plan ────────────────────────────────────────────────────────────────
  type Action = "UPDATE_LEAD" | "UPDATE_ACCOUNT" | "CONFLICT_REVIEW" | "CREATE_LEAD" | "SKIP";
  type PlanRow = {
    rowNum: number;
    csv: Record<string, string>;
    action: Action;
    leadId: number | null;
    acctId: number | null;
    matchReason: string;
    leadUpdates: Record<string, string>;
    leadSkipped: string[];
    acctUpdates: Record<string, string>;
    acctSkipped: string[];
    notesBlock: string | null;
    conflictNote: string;
    dbLeadNotes: string | null;
    dbAcctNotes: string | null;
  };

  const plan: PlanRow[] = [];
  const counts = { UPDATE_LEAD: 0, UPDATE_ACCOUNT: 0, CONFLICT_REVIEW: 0, CREATE_LEAD: 0, SKIP: 0 };
  // Tracks "leadId|acctId" pairs already committed to CONFLICT_REVIEW so that
  // duplicate CSV rows mapping to the same DB record are demoted to SKIP.
  const seenPairs = new Set<string>();

  for (let i = 0; i < csvRows.length; i++) {
    const csv = csvRows[i];
    const name  = (csv["Company"] ?? "").trim();
    const prov  = (csv["State"]   ?? "").trim();
    const city  = (csv["City"]    ?? "").trim();

    if (!name) {
      plan.push({ rowNum: i + 1, csv, action: "SKIP", leadId: null, acctId: null,
        matchReason: "empty name", leadUpdates: {}, leadSkipped: [],
        acctUpdates: {}, acctSkipped: [], notesBlock: null,
        conflictNote: "empty company name", dbLeadNotes: null, dbAcctNotes: null });
      counts.SKIP++;
      continue;
    }

    // ── Hard-block check ──────────────────────────────────────────────────────
    if (HARD_BLOCK.has(name.toLowerCase())) {
      plan.push({ rowNum: i + 1, csv, action: "SKIP", leadId: null, acctId: null,
        matchReason: "hard-blocked", leadUpdates: {}, leadSkipped: [],
        acctUpdates: {}, acctSkipped: [], notesBlock: null,
        conflictNote: `HARD BLOCKED: "${name}" is on the permanent exclusion list`,
        dbLeadNotes: null, dbAcctNotes: null });
      counts.SKIP++;
      continue;
    }

    const lm = findLead(name, prov, city);
    const am = findAcct(name, prov, city);
    const nb = enrichmentBlock(csv);

    let action: Action;
    let leadUpdates: Record<string, string> = {}, leadSkipped: string[] = [];
    let acctUpdates: Record<string, string> = {}, acctSkipped: string[] = [];
    let conflictNote = "";

    if (am && lm) {
      // ── Duplicate pair check ────────────────────────────────────────────────
      // If an earlier CSV row already claimed this exact (lead, account) pair,
      // skip this row to avoid double-appending notes.
      const pairKey = `${lm.lead.id}|${am.acct.id}`;
      if (seenPairs.has(pairKey)) {
        plan.push({ rowNum: i + 1, csv, action: "SKIP", leadId: lm.lead.id, acctId: am.acct.id,
          matchReason: lm.reason, leadUpdates: {}, leadSkipped: [],
          acctUpdates: {}, acctSkipped: [], notesBlock: null,
          conflictNote: `DUPLICATE PAIR: Lead #${lm.lead.id} + Account #${am.acct.id} already handled by an earlier CSV row — skipped to prevent double-write`,
          dbLeadNotes: lm.lead.notes ?? null, dbAcctNotes: am.acct.notes ?? null });
        counts.SKIP++;
        continue;
      }
      seenPairs.add(pairKey);
      action = "CONFLICT_REVIEW";
      ({ updates: acctUpdates, skipped: acctSkipped } = computeUpdates(csv, am.acct, ACCOUNT_FIELDS));
      conflictNote = `Lead #${lm.lead.id} also matches — review for merge`;
      counts.CONFLICT_REVIEW++;
    } else if (am) {
      action = "UPDATE_ACCOUNT";
      ({ updates: acctUpdates, skipped: acctSkipped } = computeUpdates(csv, am.acct, ACCOUNT_FIELDS));
      // slip_count: update if blank
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
      dbLeadNotes: lm?.lead.notes ?? null,
      dbAcctNotes: am?.acct.notes ?? null,
    });
  }

  // ── Print summary ─────────────────────────────────────────────────────────────
  console.log("═══ Plan Summary ═══════════════════════════════");
  console.log(`  UPDATE_LEAD:      ${counts.UPDATE_LEAD}  (fill blank fields on existing lead)`);
  console.log(`  UPDATE_ACCOUNT:   ${counts.UPDATE_ACCOUNT}  (fill blank fields on existing account)`);
  console.log(`  CONFLICT_REVIEW:  ${counts.CONFLICT_REVIEW}  (both Lead+Account matched — updating Account; check log)`);
  console.log(`  CREATE_LEAD:      ${counts.CREATE_LEAD}  (no match found — will create new lead)`);
  console.log(`  SKIP:             ${counts.SKIP}  (no company name)`);
  const active = plan.filter((p) => p.action !== "SKIP");
  const withChanges = active.filter(
    (p) => Object.keys(p.leadUpdates).length + Object.keys(p.acctUpdates).length > 0 || p.action === "CREATE_LEAD"
  );
  const noChanges = active.filter(
    (p) => Object.keys(p.leadUpdates).length + Object.keys(p.acctUpdates).length === 0 && p.action !== "CREATE_LEAD"
  );
  console.log(`  ── of active rows: ${withChanges.length} have field updates, ${noChanges.length} match but all fields already populated`);
  console.log("");

  // ── Write report CSV ──────────────────────────────────────────────────────────
  const reportHeaders = [
    "row_num","csv_company","csv_city","csv_state",
    "action","match_type","lead_id","account_id",
    "match_reason",
    "fields_updated","fields_skipped",
    "notes_appended","conflict_note",
  ];
  const reportRows = plan.map((p) => {
    const updL = Object.entries(p.leadUpdates).map(([k, v]) => `${k}=${String(v).slice(0, 50)}`).join(" | ");
    const updA = Object.entries(p.acctUpdates).map(([k, v]) => `${k}=${String(v).slice(0, 50)}`).join(" | ");
    const skipL = p.leadSkipped.join(" | ");
    const skipA = p.acctSkipped.join(" | ");
    return {
      row_num:        String(p.rowNum),
      csv_company:    p.csv["Company"] ?? "",
      csv_city:       p.csv["City"]    ?? "",
      csv_state:      p.csv["State"]   ?? "",
      action:         p.action,
      match_type:     p.action === "UPDATE_LEAD"         ? "Lead"
                    : p.action === "UPDATE_ACCOUNT"      ? "Account"
                    : p.action === "CONFLICT_REVIEW"     ? "Both"
                    : p.action === "CREATE_LEAD"         ? "New Lead"
                    : "Skipped",
      lead_id:        p.leadId  ? String(p.leadId)  : "",
      account_id:     p.acctId  ? String(p.acctId)  : "",
      match_reason:   p.matchReason,
      fields_updated: [updL, updA].filter(Boolean).join(" | ") || "(none)",
      fields_skipped: [skipL, skipA].filter(Boolean).join(" | ") || "(none)",
      notes_appended: p.notesBlock ? "Yes" : "No",
      conflict_note:  p.conflictNote,
    };
  });
  const reportPath = path.resolve(`exports/bc-enrichment-report-${DB_ENV}-${STAMP}.csv`);
  writeCsv(reportRows, reportHeaders, reportPath);
  console.log(`Report written:   ${reportPath}`);
  console.log(`                  ${reportRows.length} rows\n`);

  // ── Dry-run exit ──────────────────────────────────────────────────────────────
  if (!APPLY_MODE) {
    console.log("DRY RUN — no changes made to the database.");
    console.log("Review the report CSV, then re-run with --apply to commit.\n");
    console.log("Sample of first 10 active rows:");
    for (const p of plan.filter((p) => p.action !== "SKIP").slice(0, 10)) {
      const flds = Object.keys({ ...p.leadUpdates, ...p.acctUpdates });
      console.log(
        `  [${p.action.padEnd(16)}] "${(p.csv["Company"] ?? "").slice(0, 45).padEnd(45)}"` +
        (p.leadId  ? ` Lead#${p.leadId}`  : "") +
        (p.acctId  ? ` Acct#${p.acctId}` : "") +
        (flds.length ? ` | update: ${flds.join(", ")}` : " | (no new fields)") +
        (p.notesBlock ? " | +notes" : "")
      );
    }
    console.log("\nDone.");
    process.exit(0);
  }

  // ── APPLY MODE ────────────────────────────────────────────────────────────────
  console.log("APPLY mode — acquiring DB connection…");
  const client = await pool.connect();
  let applied = 0, created = 0;
  const applyLog: any[] = [];

  try {
    await client.query("BEGIN");

    for (const p of plan) {
      if (p.action === "SKIP") continue;

      // ── UPDATE LEAD ──────────────────────────────────────────────────────────
      if (p.action === "UPDATE_LEAD" && p.leadId !== null) {
        const updates = { ...p.leadUpdates };
        // Append enrichment notes (only if date marker not already present)
        if (p.notesBlock && !String(p.dbLeadNotes ?? "").includes(`Enrichment Import ${DATE_LABEL}`)) {
          const sep = p.dbLeadNotes?.trim() ? "\n\n" : "";
          updates["notes"] = (p.dbLeadNotes ?? "") + sep + p.notesBlock;
        }
        if (Object.keys(updates).length) {
          const cols = Object.keys(updates);
          const vals: any[] = Object.values(updates);
          const set = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
          await client.query(
            `UPDATE leads SET ${set}, updated_at = NOW() WHERE id = $${cols.length + 1}`,
            [...vals, p.leadId]
          );
          applyLog.push({ action: "UPDATE_LEAD", id: p.leadId, company: p.csv["Company"], fields: cols });
          applied++;
        }
      }

      // ── UPDATE ACCOUNT (or CONFLICT_REVIEW — account only) ──────────────────
      if ((p.action === "UPDATE_ACCOUNT" || p.action === "CONFLICT_REVIEW") && p.acctId !== null) {
        const updates = { ...p.acctUpdates };
        if (p.notesBlock && !String(p.dbAcctNotes ?? "").includes(`Enrichment Import ${DATE_LABEL}`)) {
          const sep = p.dbAcctNotes?.trim() ? "\n\n" : "";
          updates["notes"] = (p.dbAcctNotes ?? "") + sep + p.notesBlock;
        }
        if (Object.keys(updates).length) {
          const cols = Object.keys(updates);
          const vals: any[] = Object.values(updates);
          const set = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
          await client.query(
            `UPDATE accounts SET ${set}, updated_at = NOW() WHERE id = $${cols.length + 1}`,
            [...vals, p.acctId]
          );
          applyLog.push({ action: "UPDATE_ACCOUNT", id: p.acctId, company: p.csv["Company"], fields: cols });
          applied++;
        }
        if (p.action === "CONFLICT_REVIEW") {
          applyLog.push({ action: "CONFLICT_NOTED", leadId: p.leadId, acctId: p.acctId,
            company: p.csv["Company"], note: p.conflictNote });
        }
      }

      // ── CREATE LEAD ──────────────────────────────────────────────────────────
      if (p.action === "CREATE_LEAD") {
        const csv = p.csv;
        const notesAll = [emp(csv["Notes"]), p.notesBlock].filter(Boolean).join("\n\n");
        const phone = sanitisePhone(csv["Contact Phone"]);
        const slipsVal = isBlank(csv["Slips"]) ? null : emp(csv["Slips"]);
        const result = await client.query(
          `INSERT INTO leads (
            company, contact_name, contact_email, contact_phone,
            street_address, city, state, zip_code, country,
            slips, status, source, segment, primary_industry,
            relationship_type, conversion_target, notes,
            created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,
            $10,$11,$12,$13,$14,$15,$16,$17,
            NOW(),NOW()
          ) RETURNING id`,
          [
            csv["Company"]?.trim(),
            emp(csv["Contact Name"]) ?? "Marina Contact",
            emp(csv["Contact Email"]),
            phone,
            emp(csv["Street Address"]),
            emp(csv["City"]),
            emp(csv["State"]) ?? "British Columbia",
            emp(csv["Zip / Postal"]),
            canonCountry(csv["Country"]),
            slipsVal,
            "new",
            "csv_enrichment_import",
            emp(csv["Segment"])?.toLowerCase() ?? "marina",
            emp(csv["Industry"]) ?? "marine",
            emp(csv["Relationship Type"]) ?? "customer_prospect",
            emp(csv["Conversion Target"]),
            notesAll || null,
          ]
        );
        const newId = result.rows[0]?.id;
        applyLog.push({ action: "CREATE_LEAD", id: newId, company: csv["Company"] });
        created++;
      }
    }

    await client.query("COMMIT");
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("\nERROR — transaction rolled back:", err.message);
    process.exit(1);
  } finally {
    client.release();
  }

  // ── Write apply log ───────────────────────────────────────────────────────────
  const applyPath = path.resolve(`exports/bc-enrichment-apply-${DB_ENV}-${STAMP}.json`);
  fs.writeFileSync(applyPath, JSON.stringify({ stamp: STAMP, applied, created, log: applyLog }, null, 2), "utf8");

  console.log("\n═══ Apply Complete ══════════════════════════════");
  console.log(`  Records updated:  ${applied}`);
  console.log(`  Records created:  ${created}`);
  console.log(`  Apply log:        ${applyPath}`);
  console.log(`  Audit report:     ${reportPath}`);
  console.log("");
  process.exit(0);
}

main().catch((err) => { console.error("\nFATAL:", err?.message ?? err); process.exit(1); });
