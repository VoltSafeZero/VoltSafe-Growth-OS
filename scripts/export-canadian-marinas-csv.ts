/**
 * One-shot script: build a CSV of every Canadian account in the CMS plus
 * three example template rows, ready to hand to ChatGPT for "find more
 * Canadian marinas, fill empty fields on existing ones."
 *
 * Why a tsx script and not the SQL-tool path:
 *   The SQL tool serialises results as comma-separated text. Marina notes
 *   sometimes contain newlines and commas — those break naive CSV-of-CSV
 *   parsing and produce phantom rows. Going through the real db client gives
 *   us proper JS objects with no double-encoding.
 *
 * Output: exports/canadian_marinas_for_chatgpt.csv (RFC 4180-quoted).
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

// RFC 4180: any field containing , " CR or LF must be wrapped in double
// quotes, with embedded " escaped as "".
function csvEsc(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Final column order shown to ChatGPT. We DELIBERATELY exclude every
// CRM-internal column (lead_status, priority, assigned_to_user_id, the entire
// revenue-architecture block, expansion booleans we treat operator-only,
// etc.) so a researcher cannot accidentally clobber operator-only state when
// the CSV is re-imported.
const HEADERS = [
  "action",                 // EXISTING_KEEP | EXISTING_ENRICH | NEW (ChatGPT sets this)
  "cms_account_id",         // BLANK for new rows; PRESERVE EXACTLY for existing
  "name",
  "legal_name",
  "website",
  "street_address",
  "city",
  "state_province",
  "postal_zip",
  "country",                // always "CA"
  "region",                 // Atlantic | Central | Prairie | Pacific | Northern
  "timezone",               // IANA tz, e.g. America/Toronto
  "latitude",
  "longitude",
  "segment",                // marina | yacht_club | dry_stack | boat_club | mooring_field | etc.
  "marina_type",            // private | public | municipal | private_club | resort | non_profit | etc.
  "ownership_type",         // owner_operated | family | corporate | non_profit | municipal | etc.
  "parent_company",         // chain operator if any (Suntex, Safe Harbor, D'Arcy Marine Group, etc.)
  "slip_count",             // integer
  "slip_mix",               // free-form, e.g. "70% transient, 30% seasonal"
  "avg_boat_size_range",    // free-form, e.g. "20-45 ft"
  "power_demand_intensity", // low | medium | high
  "seasonality",            // free-form, e.g. "May-October"
  "expansion_plans",        // true | false (only set if you see public evidence)
  "expansion_notes",
  "contact_name",
  "contact_title",
  "contact_email",
  "contact_phone",
  "contact_linkedin",
  "tags",                   // comma-separated (inside the cell — the cell will be CSV-quoted)
  "notes",                  // free-form research notes; ALWAYS include date + source
  "lead_source",            // default for NEW rows: "chatgpt_research_2026_canada"
];

// Three example rows at the top. They show the exact shape ChatGPT must emit
// for each of the three actions. Operator deletes them before importing.
const EXAMPLE_ROWS: string[][] = [
  [
    "EXAMPLE_NEW",
    "",
    "Example New Marina Inc.",
    "Example New Marina Limited",
    "https://example-marina.ca",
    "123 Harbour Drive",
    "Kingston",
    "Ontario",
    "K7L 5H6",
    "CA",
    "Central",
    "America/Toronto",
    "44.2312",
    "-76.4860",
    "marina",
    "private",
    "family",
    "",
    "180",
    "60% seasonal, 40% transient",
    "20-45 ft",
    "medium",
    "May-October",
    "false",
    "",
    "Jane Doe",
    "General Manager",
    "jane@example-marina.ca",
    "+1-613-555-0123",
    "https://www.linkedin.com/in/example-jane-doe",
    "great-lakes,ontario,private",
    "Family-owned since 1978. 180 wet slips, dry storage for ~60. Power: 30A on most slips, 50A on 12 transient slips. Source: marina website 2026-04-28.",
    "chatgpt_research_2026_canada",
  ],
  [
    "EXAMPLE_ENRICH",
    "12345",
    "Existing Marina Name (DO NOT CHANGE NAME)",
    "",
    "https://newly-found-website.ca",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "210",
    "",
    "",
    "",
    "",
    "",
    "",
    "Bob Smith",
    "Dockmaster",
    "bob@newly-found-website.ca",
    "+1-902-555-9876",
    "",
    "",
    "ENRICHMENT 2026-04-28: filled website, slip_count=210, primary contact (dockmaster) from public marina site.",
    "",
  ],
  [
    "EXAMPLE_KEEP",
    "67890",
    "Existing Marina With No New Info Found",
    "", "", "", "", "", "", "", "", "", "", "",
    "", "", "", "", "", "", "", "", "", "", "",
    "", "", "", "", "",
    "", "", "",
  ],
];

async function main() {
  // Pull every Canadian account joined with its primary contact (or the
  // first contact if no primary is flagged). LEFT JOIN so accounts with
  // zero contacts still appear with empty contact cells.
  const rows = await db.execute(sql`
    WITH primary_contact AS (
      SELECT DISTINCT ON (account_id)
        account_id,
        name        AS contact_name,
        title       AS contact_title,
        email       AS contact_email,
        phone       AS contact_phone,
        linkedin_url AS contact_linkedin
      FROM contacts
      ORDER BY account_id, COALESCE(is_primary, FALSE) DESC, id ASC
    )
    SELECT
      a.id              AS cms_account_id,
      a.name,
      a.legal_name,
      a.website,
      a.street_address,
      a.city,
      a.state_province,
      a.postal_zip,
      a.country,
      a.region,
      a.timezone,
      a.latitude,
      a.longitude,
      a.segment,
      a.marina_type,
      a.ownership_type,
      a.parent_company,
      a.slip_count,
      a.slip_mix,
      a.avg_boat_size_range,
      a.power_demand_intensity,
      a.seasonality,
      a.expansion_plans,
      a.expansion_notes,
      pc.contact_name,
      pc.contact_title,
      pc.contact_email,
      pc.contact_phone,
      pc.contact_linkedin,
      a.tags,
      a.notes,
      a.lead_source
    FROM accounts a
    LEFT JOIN primary_contact pc ON pc.account_id = a.id
    WHERE a.country ILIKE 'canada' OR a.country ILIKE 'ca'
    ORDER BY a.state_province NULLS LAST, a.city NULLS LAST, a.name
  `);

  // drizzle's db.execute returns a result object whose shape varies by
  // driver — for the neon-http driver used here it's `{ rows: [...] }`.
  // Defensive unwrap so the script works in either shape.
  const dataRows: Record<string, any>[] = Array.isArray(rows)
    ? (rows as any)
    : ((rows as any)?.rows ?? []);

  console.log(`Fetched ${dataRows.length} Canadian accounts`);

  const out: string[] = [];
  out.push(HEADERS.map(csvEsc).join(","));
  for (const ex of EXAMPLE_ROWS) {
    out.push(ex.map(csvEsc).join(","));
  }
  for (const r of dataRows) {
    out.push(
      [
        "EXISTING", // action — ChatGPT will rewrite to EXISTING_ENRICH or EXISTING_KEEP
        r.cms_account_id,
        r.name,
        r.legal_name,
        r.website,
        r.street_address,
        r.city,
        r.state_province,
        r.postal_zip,
        r.country,
        r.region,
        r.timezone,
        r.latitude,
        r.longitude,
        r.segment,
        r.marina_type,
        r.ownership_type,
        r.parent_company,
        r.slip_count,
        r.slip_mix,
        r.avg_boat_size_range,
        r.power_demand_intensity,
        r.seasonality,
        r.expansion_plans,
        r.expansion_notes,
        r.contact_name,
        r.contact_title,
        r.contact_email,
        r.contact_phone,
        r.contact_linkedin,
        r.tags,
        r.notes,
        r.lead_source,
      ]
        .map(csvEsc)
        .join(","),
    );
  }

  const outPath = path.resolve("exports/canadian_marinas_for_chatgpt.csv");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out.join("\n") + "\n", "utf8");
  const sz = fs.statSync(outPath).size;
  console.log(`Wrote ${outPath}`);
  console.log(`  ${(sz / 1024).toFixed(1)} KB`);
  console.log(
    `  ${out.length} lines (1 header + ${EXAMPLE_ROWS.length} examples + ${dataRows.length} existing marinas)`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
