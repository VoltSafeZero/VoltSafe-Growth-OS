/**
 * One-shot script: build a CSV of every account in the CMS for a given
 * country plus three example template rows, ready to hand to ChatGPT for
 * "find more marinas, fill empty fields on existing ones."
 *
 * Usage:
 *   npx tsx scripts/export-marinas-csv.ts --country=CA
 *   npx tsx scripts/export-marinas-csv.ts --country=US
 *
 * Why a tsx script and not the SQL-tool path:
 *   The SQL tool serialises results as comma-separated text. Marina notes
 *   sometimes contain newlines and commas — those break naive CSV-of-CSV
 *   parsing and produce phantom rows. Going through the real db client gives
 *   us proper JS objects with no double-encoding.
 *
 * Output: exports/{country_slug}_marinas_for_chatgpt.csv (RFC 4180-quoted).
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

// ─── Country configuration ───────────────────────────────────────────────────
type CountryCfg = {
  code: "CA" | "US";
  slug: string;
  label: string;
  // SQL filter applied as `WHERE ${this}` against the accounts table.
  countryFilter: ReturnType<typeof sql>;
  defaultLeadSource: string;
  exampleProvince: string;
  exampleCity: string;
  examplePostal: string;
  exampleTimezone: string;
  exampleLat: string;
  exampleLng: string;
  exampleTagsCsv: string;
  exampleEnrichPhone: string;
};

const COUNTRY_CFG: Record<"CA" | "US", CountryCfg> = {
  CA: {
    code: "CA",
    slug: "canadian",
    label: "Canada",
    countryFilter: sql`country ILIKE 'canada' OR country ILIKE 'ca'`,
    defaultLeadSource: "chatgpt_research_2026_canada",
    exampleProvince: "Ontario",
    exampleCity: "Kingston",
    examplePostal: "K7L 5H6",
    exampleTimezone: "America/Toronto",
    exampleLat: "44.2312",
    exampleLng: "-76.4860",
    exampleTagsCsv: "great-lakes,ontario,private",
    exampleEnrichPhone: "+1-902-555-9876",
  },
  US: {
    code: "US",
    slug: "usa",
    label: "United States",
    countryFilter: sql`country ILIKE 'usa' OR country ILIKE 'us' OR country ILIKE 'united states' OR country ILIKE 'united states of america'`,
    defaultLeadSource: "chatgpt_research_2026_usa",
    exampleProvince: "Florida",
    exampleCity: "Fort Lauderdale",
    examplePostal: "33301",
    exampleTimezone: "America/New_York",
    exampleLat: "26.1224",
    exampleLng: "-80.1373",
    exampleTagsCsv: "atlantic,florida,private,big-yacht",
    exampleEnrichPhone: "+1-757-555-9876",
  },
};

function parseCountryArg(): CountryCfg {
  const arg = process.argv.find((a) => a.startsWith("--country="));
  const raw = (arg?.split("=", 2)[1] ?? "CA").toUpperCase();
  if (raw !== "CA" && raw !== "US") {
    console.error(`Unsupported country: ${raw}. Use --country=CA or --country=US`);
    process.exit(2);
  }
  return COUNTRY_CFG[raw];
}

// ─── CSV escape (RFC 4180) ───────────────────────────────────────────────────
function csvEsc(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ─── Header set (33 columns) ─────────────────────────────────────────────────
// DELIBERATELY excludes every CRM-internal column (lead_status, priority,
// assigned_to_user_id, the entire revenue-architecture block, partner_*, etc.)
// so a researcher cannot accidentally clobber operator-only state when the
// CSV is re-imported.
const HEADERS = [
  "action",
  "cms_account_id",
  "name",
  "legal_name",
  "website",
  "street_address",
  "city",
  "state_province",
  "postal_zip",
  "country",
  "region",
  "timezone",
  "latitude",
  "longitude",
  "segment",
  "marina_type",
  "ownership_type",
  "parent_company",
  "slip_count",
  "slip_mix",
  "avg_boat_size_range",
  "power_demand_intensity",
  "seasonality",
  "expansion_plans",
  "expansion_notes",
  "contact_name",
  "contact_title",
  "contact_email",
  "contact_phone",
  "contact_linkedin",
  "tags",
  "notes",
  "lead_source",
];

function buildExampleRows(cfg: CountryCfg): string[][] {
  return [
    [
      "EXAMPLE_NEW",
      "",
      "Example New Marina Inc.",
      "Example New Marina Limited",
      "https://example-marina.com",
      "123 Harbour Drive",
      cfg.exampleCity,
      cfg.exampleProvince,
      cfg.examplePostal,
      cfg.code,
      "", // region — operator can fill or leave blank for ChatGPT to set
      cfg.exampleTimezone,
      cfg.exampleLat,
      cfg.exampleLng,
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
      "jane@example-marina.com",
      "+1-555-555-0123",
      "https://www.linkedin.com/in/example-jane-doe",
      cfg.exampleTagsCsv,
      `Family-owned since 1978. 180 wet slips, dry storage for ~60. Power: 30A on most slips, 50A on 12 transient slips. Source: marina website 2026-04-28.`,
      cfg.defaultLeadSource,
    ],
    [
      "EXAMPLE_ENRICH",
      "12345",
      "Existing Marina Name (DO NOT CHANGE NAME)",
      "",
      "https://newly-found-website.com",
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
      "bob@newly-found-website.com",
      cfg.exampleEnrichPhone,
      "",
      "",
      `ENRICHMENT 2026-04-28: filled website, slip_count=210, primary contact (dockmaster) from public marina site.`,
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
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const cfg = parseCountryArg();
  console.log(`Exporting ${cfg.label} (${cfg.code}) accounts…`);

  // Pull every matching account joined with its primary contact (or first
  // contact if no primary is flagged). LEFT JOIN so accounts with zero
  // contacts still appear with empty contact cells.
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
    WHERE ${cfg.countryFilter}
    ORDER BY a.state_province NULLS LAST, a.city NULLS LAST, a.name
  `);

  // drizzle's db.execute returns a result whose shape varies by driver — for
  // the neon-http driver it's `{ rows: [...] }`. Defensive unwrap so the
  // script works in either shape.
  const dataRows: Record<string, any>[] = Array.isArray(rows)
    ? (rows as any)
    : ((rows as any)?.rows ?? []);

  console.log(`Fetched ${dataRows.length} ${cfg.label} accounts`);

  const exampleRows = buildExampleRows(cfg);
  const out: string[] = [];
  out.push(HEADERS.map(csvEsc).join(","));
  for (const ex of exampleRows) {
    out.push(ex.map(csvEsc).join(","));
  }
  for (const r of dataRows) {
    out.push(
      [
        "EXISTING",
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

  const outPath = path.resolve(`exports/${cfg.slug}_marinas_for_chatgpt.csv`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out.join("\n") + "\n", "utf8");
  const sz = fs.statSync(outPath).size;
  console.log(`Wrote ${outPath}`);
  console.log(`  ${(sz / 1024).toFixed(1)} KB`);
  console.log(
    `  ${out.length} lines (1 header + ${exampleRows.length} examples + ${dataRows.length} existing marinas)`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
