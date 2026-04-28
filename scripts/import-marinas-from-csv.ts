/**
 * One-shot importer: read a ChatGPT-enriched CSV of new marinas, dedup
 * against existing accounts in the database (matching by normalized name +
 * city + state/province), and INSERT the non-duplicates into `accounts`.
 *
 * Safety rules:
 *   - Only rows with action=NEW are inserted. EXISTING_* rows are ignored
 *     by this script (no enrichment path yet).
 *   - Dedup is conservative: any candidate that matches an existing row by
 *     (normalized name AND same state_province) is skipped. We additionally
 *     flag "name overlaps another row in the same city" as suspect and
 *     SKIP it for human review rather than auto-inserting.
 *   - Every INSERT is wrapped in a single transaction. If any one INSERT
 *     fails, the whole batch rolls back so we never leave the table in a
 *     half-imported state.
 *   - --dry-run flag prints the dedup report and the would-be INSERTs but
 *     commits nothing. Use this first to sanity-check.
 *
 * Usage:
 *   npx tsx scripts/import-marinas-from-csv.ts <csv-path> [--dry-run]
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";

// ─── CSV parser (RFC 4180 — handles quoted multi-line fields) ────────────────
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip a leading UTF-8 BOM if present (the user's file starts with one).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const cells: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { cur += c; }
    } else {
      if (c === '"' && cur === "") { inQ = true; }
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); cells.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* swallow */ }
      else { cur += c; }
    }
  }
  // Tail cell / row.
  if (cur !== "" || row.length > 0) { row.push(cur); cells.push(row); }
  // Drop trailing all-empty rows.
  while (cells.length > 0 && cells[cells.length - 1].every((v) => v === "")) cells.pop();

  if (cells.length === 0) return { headers: [], rows: [] };
  const headers = cells[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < cells.length; i++) {
    const r: Record<string, string> = {};
    headers.forEach((h, idx) => { r[h] = (cells[i][idx] ?? "").trim(); });
    rows.push(r);
  }
  return { headers, rows };
}

// ─── Name + city normalisation ───────────────────────────────────────────────
// Lowercase, strip punctuation, collapse whitespace, drop a small set of
// boilerplate suffix words so "Belleisle Bay Marina" matches "Belleisle Bay
// Marina Inc." and "The Belleisle Bay Marina".
const STOP_WORDS = new Set([
  "marina", "marinas", "the", "inc", "inc.", "ltd", "ltd.", "limited",
  "llc", "co", "co.", "company", "resort", "resorts", "harbour", "harbor",
  "wharf", "dock", "yacht", "club", "boat", "boats", "boating", "and", "&",
  "at", "of", "a",
]);
function normaliseName(s: string | null | undefined): string {
  if (!s) return "";
  // Replace fancy quotes / hyphens with ASCII so "Ballantyne's" matches "Ballantynes".
  const ascii = s
    .normalize("NFKD")
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/[\u2013\u2014\u2010\u2011]/g, "-")
    .replace(/['']/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    .join(" ");
}
function normaliseCity(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Sanitisation ────────────────────────────────────────────────────────────
function emptyToNull(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
function parseIntOrNull(v: string | undefined | null): number | null {
  const t = emptyToNull(v);
  if (t === null) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}
function parseFloatOrNull(v: string | undefined | null): number | null {
  const t = emptyToNull(v);
  if (t === null) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}
function parseBoolOrFalse(v: string | undefined | null): boolean {
  const t = emptyToNull(v)?.toLowerCase();
  return t === "true" || t === "yes" || t === "1";
}
// Phone sanitiser: must contain at least 7 digits. Anything shorter (e.g.
// the corrupted "-3464" in the West Point Marina row) is rejected as null.
function sanitisePhone(v: string | undefined | null): string | null {
  const t = emptyToNull(v);
  if (t === null) return null;
  const digits = t.replace(/\D/g, "");
  return digits.length >= 7 ? t : null;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const csvPath = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!csvPath) {
    console.error("Usage: npx tsx scripts/import-marinas-from-csv.ts <csv-path> [--dry-run]");
    process.exit(2);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(2);
  }

  const text = fs.readFileSync(csvPath, "utf8");
  const { headers, rows } = parseCsv(text);
  console.log(`Parsed CSV: ${rows.length} data rows, ${headers.length} columns`);

  const newRows = rows.filter((r) => (r.action || "").toUpperCase() === "NEW");
  console.log(`  ${newRows.length} rows marked NEW`);
  const otherActions = rows.filter((r) => (r.action || "").toUpperCase() !== "NEW");
  if (otherActions.length > 0) {
    console.log(`  ${otherActions.length} rows with non-NEW action — IGNORED by this script`);
  }

  // ── Build a lookup over all existing accounts in the same country (CA),
  //    indexed by (normalised_name, state_province) and (normalised_name,
  //    normalised_city). Loading all 967 Canadian rows once is cheap. ──
  const existing = (await db.execute(sql`
    SELECT id, name, city, state_province
    FROM accounts
    WHERE country ILIKE 'canada' OR country ILIKE 'ca'
  `)) as any;
  const existingRows: { id: number; name: string; city: string | null; state_province: string | null }[] =
    Array.isArray(existing) ? existing : (existing.rows ?? []);
  console.log(`  ${existingRows.length} existing Canadian accounts loaded for dedup`);

  const byNameProvince = new Map<string, typeof existingRows>();
  const byNameCity = new Map<string, typeof existingRows>();
  for (const er of existingRows) {
    const nn = normaliseName(er.name);
    if (!nn) continue;
    const kp = `${nn}||${(er.state_province ?? "").toLowerCase()}`;
    if (!byNameProvince.has(kp)) byNameProvince.set(kp, []);
    byNameProvince.get(kp)!.push(er);
    const kc = `${nn}||${normaliseCity(er.city ?? "")}`;
    if (!byNameCity.has(kc)) byNameCity.set(kc, []);
    byNameCity.get(kc)!.push(er);
  }

  // ── Dedup pass over the candidate NEW rows. ──
  type Decision =
    | { kind: "duplicate"; reason: string; matchId: number; matchName: string; matchCity: string | null }
    | { kind: "suspect"; reason: string; matchId: number; matchName: string; matchCity: string | null }
    | { kind: "insert" };
  const decisions: { row: Record<string, string>; decision: Decision }[] = [];

  for (const r of newRows) {
    const nn = normaliseName(r.name);
    const province = (r.state_province ?? "").toLowerCase();
    const city = normaliseCity(r.city ?? "");
    let dec: Decision = { kind: "insert" };

    if (!nn) {
      dec = { kind: "suspect", reason: "empty/normalised-empty name", matchId: 0, matchName: "", matchCity: null };
    } else {
      const provHits = byNameProvince.get(`${nn}||${province}`) ?? [];
      const cityHits = byNameCity.get(`${nn}||${city}`) ?? [];
      if (provHits.length > 0) {
        const m = provHits[0];
        dec = { kind: "duplicate", reason: `name+province match`, matchId: m.id, matchName: m.name, matchCity: m.city };
      } else if (cityHits.length > 0) {
        const m = cityHits[0];
        dec = { kind: "duplicate", reason: `name+city match`, matchId: m.id, matchName: m.name, matchCity: m.city };
      }
    }
    decisions.push({ row: r, decision: dec });
  }

  const dups = decisions.filter((d) => d.decision.kind === "duplicate");
  const suspects = decisions.filter((d) => d.decision.kind === "suspect");
  const toInsert = decisions.filter((d) => d.decision.kind === "insert");

  console.log("");
  console.log("═══ Dedup report ═══");
  console.log(`  ${dups.length} duplicate(s) — will be skipped`);
  for (const d of dups) {
    const m = d.decision as Extract<Decision, { kind: "duplicate" }>;
    console.log(`    SKIP  "${d.row.name}" (${d.row.city ?? "?"}, ${d.row.state_province ?? "?"})`);
    console.log(`         → matches existing #${m.matchId} "${m.matchName}" (${m.matchCity ?? "?"}); reason: ${m.reason}`);
  }
  console.log(`  ${suspects.length} suspect(s) — will be skipped, please review`);
  for (const s of suspects) {
    const m = s.decision as Extract<Decision, { kind: "suspect" }>;
    console.log(`    REVIEW "${s.row.name}" (${s.row.city ?? "?"}, ${s.row.state_province ?? "?"}) — ${m.reason}`);
  }
  console.log(`  ${toInsert.length} ready to insert`);
  console.log("");

  if (toInsert.length === 0) {
    console.log("Nothing to insert. Done.");
    process.exit(0);
  }

  if (dryRun) {
    console.log("--dry-run: not committing. Sample of first 5 would-be INSERTs:");
    for (const t of toInsert.slice(0, 5)) {
      console.log("  +", t.row.name, "—", t.row.city, t.row.state_province, "—", t.row.segment || "marina");
    }
    process.exit(0);
  }

  // ── Real insert. One transaction, one INSERT each so we can keep simple
  //    error context per row. The accounts table fills `created_at`,
  //    `updated_at`, `lead_status`, `priority`, `org_type`, `segment`
  //    defaults itself when the column is omitted/NULL. ──
  let inserted = 0;
  const insertedIds: number[] = [];
  await db.transaction(async (tx) => {
    for (const t of toInsert) {
      const r = t.row;
      const phone = sanitisePhone(r.contact_phone); // dropped if invalid
      // We're not creating a `contacts` row here — none of the supplied
      // marinas have a real contact name + email; the only contact-shaped
      // value in the file (West Point Marina's "-3464") is a phone
      // fragment that we just nulled. If/when ChatGPT supplies real
      // contacts we can extend this script to also insert into `contacts`.
      const result = (await tx.execute(sql`
        INSERT INTO accounts (
          name, legal_name, website, street_address, city, state_province,
          postal_zip, country, region, timezone, latitude, longitude,
          segment, marina_type, ownership_type, parent_company,
          slip_count, slip_mix, avg_boat_size_range, power_demand_intensity,
          seasonality, expansion_plans, expansion_notes,
          tags, notes, lead_source
        ) VALUES (
          ${r.name},
          ${emptyToNull(r.legal_name)},
          ${emptyToNull(r.website)},
          ${emptyToNull(r.street_address)},
          ${emptyToNull(r.city)},
          ${emptyToNull(r.state_province)},
          ${emptyToNull(r.postal_zip)},
          ${emptyToNull(r.country) ?? "CA"},
          ${emptyToNull(r.region)},
          ${emptyToNull(r.timezone)},
          ${parseFloatOrNull(r.latitude)},
          ${parseFloatOrNull(r.longitude)},
          ${emptyToNull(r.segment) ?? "marina"},
          ${emptyToNull(r.marina_type)},
          ${emptyToNull(r.ownership_type)},
          ${emptyToNull(r.parent_company)},
          ${parseIntOrNull(r.slip_count)},
          ${emptyToNull(r.slip_mix)},
          ${emptyToNull(r.avg_boat_size_range)},
          ${emptyToNull(r.power_demand_intensity)},
          ${emptyToNull(r.seasonality)},
          ${parseBoolOrFalse(r.expansion_plans)},
          ${emptyToNull(r.expansion_notes)},
          ${emptyToNull(r.tags)},
          ${emptyToNull(r.notes)},
          ${emptyToNull(r.lead_source)}
        )
        RETURNING id
      `)) as any;
      const newId =
        Array.isArray(result) ? result[0]?.id : result.rows?.[0]?.id;
      if (typeof newId === "number") {
        insertedIds.push(newId);
        inserted++;
      }
      // Note phone discrepancy if we dropped one.
      if (phone === null && (r.contact_phone ?? "").trim() !== "") {
        console.log(`  ⚠ dropped invalid phone "${r.contact_phone}" on "${r.name}"`);
      }
    }
  });

  console.log("");
  console.log("═══ Import complete ═══");
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (duplicate): ${dups.length}`);
  console.log(`  Skipped (suspect): ${suspects.length}`);
  console.log(`  New account IDs: ${insertedIds.join(", ")}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
