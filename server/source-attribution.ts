/**
 * Source Attribution — deterministic normalization layer.
 * Maps raw freeform source strings → canonical buckets.
 * No AI — all rules are explicit and editable.
 */

// ── Canonical Buckets ─────────────────────────────────────────────────────────
export const SOURCE_BUCKETS = [
  "inbound_web",
  "referral",
  "partner",
  "event_conference",
  "outbound",
  "association",
  "field_prospecting",
  "investor_network",
  "other",
] as const;

export type SourceBucket = typeof SOURCE_BUCKETS[number];

export const BUCKET_LABELS: Record<SourceBucket, string> = {
  inbound_web:       "Inbound Web",
  referral:          "Referral",
  partner:           "Partner / Channel",
  event_conference:  "Event / Conference",
  outbound:          "Outbound",
  association:       "Association",
  field_prospecting: "Field / Walk-In",
  investor_network:  "Investor / Network",
  other:             "Other",
};

// ── Normalization Map ─────────────────────────────────────────────────────────
// Each entry: [pattern (lowercase substring or exact), bucket]
// First match wins — order matters.
const NORM_MAP: Array<[string, SourceBucket]> = [
  // Inbound web
  ["website",           "inbound_web"],
  ["web",               "inbound_web"],
  ["inbound",           "inbound_web"],
  ["contact form",      "inbound_web"],
  ["demo request",      "inbound_web"],
  ["demo",              "inbound_web"],
  ["seo",               "inbound_web"],
  ["sem",               "inbound_web"],
  ["google ads",        "inbound_web"],
  ["google",            "inbound_web"],
  ["web inquiry",       "inbound_web"],
  ["newsletter",        "inbound_web"],
  ["email campaign",    "inbound_web"],
  ["landing page",      "inbound_web"],
  ["organic",           "inbound_web"],
  ["social",            "inbound_web"],
  ["linkedin",          "inbound_web"],

  // Referral
  ["referral",          "referral"],
  ["referred",          "referral"],
  ["word of mouth",     "referral"],
  ["wom",               "referral"],
  ["customer referral", "referral"],
  ["broker referral",   "referral"],
  ["client referral",   "referral"],
  [" ref ",             "referral"],

  // Partner / Channel
  ["partner",           "partner"],
  ["channel partner",   "partner"],
  ["dealer",            "partner"],
  ["reseller",          "partner"],
  ["distributor",       "partner"],
  ["integration partner","partner"],
  ["distribution",      "partner"],
  ["oem",               "partner"],
  ["var ",              "partner"],

  // Event / Conference
  ["event",             "event_conference"],
  ["conference",        "event_conference"],
  ["trade show",        "event_conference"],
  ["tradeshow",         "event_conference"],
  ["expo",              "event_conference"],
  ["marina show",       "event_conference"],
  ["docks",             "event_conference"],
  ["imtec",             "event_conference"],
  ["metstrade",         "event_conference"],
  ["mets",              "event_conference"],
  ["sibs",              "event_conference"],
  ["boat show",         "event_conference"],
  ["boatshow",          "event_conference"],
  ["webinar",           "event_conference"],
  ["summit",            "event_conference"],
  ["seminar",           "event_conference"],

  // Outbound
  ["outbound",          "outbound"],
  ["cold call",         "outbound"],
  ["cold email",        "outbound"],
  ["cold outreach",     "outbound"],
  ["sdr",               "outbound"],
  ["prospecting",       "outbound"],
  ["sales dev",         "outbound"],
  ["outreach",          "outbound"],
  ["sequence",          "outbound"],
  ["cadence",           "outbound"],
  ["direct mail",       "outbound"],

  // Association
  ["association",       "association"],
  ["nmma",              "association"],
  ["cmba",              "association"],
  ["abi",               "association"],
  ["marina life",       "association"],
  ["trade assoc",       "association"],
  ["industry group",    "association"],
  ["chamber",           "association"],
  ["bia",               "association"],
  ["ymba",              "association"],

  // Field / Walk-in
  ["walk in",           "field_prospecting"],
  ["walk-in",           "field_prospecting"],
  ["walkin",            "field_prospecting"],
  ["marina visit",      "field_prospecting"],
  ["field visit",       "field_prospecting"],
  ["on-site",           "field_prospecting"],
  ["on site",           "field_prospecting"],
  ["field prospect",    "field_prospecting"],
  ["direct visit",      "field_prospecting"],
  ["prospected",        "field_prospecting"],

  // Investor / Network
  ["investor",          "investor_network"],
  ["vc ",               "investor_network"],
  ["angel",             "investor_network"],
  ["network intro",     "investor_network"],
  ["board intro",       "investor_network"],
  ["board member",      "investor_network"],
  ["advisor",           "investor_network"],
  ["intro",             "investor_network"],
];

/**
 * Normalize a raw source string to a canonical bucket.
 * Returns "other" if no match found.
 */
export function normalizeSource(raw: string | null | undefined): SourceBucket {
  if (!raw || raw.trim() === "") return "other";
  const lower = raw.toLowerCase().trim();
  for (const [pattern, bucket] of NORM_MAP) {
    if (lower.includes(pattern)) return bucket;
  }
  return "other";
}

/**
 * Normalize an array of raw sources (deduped).
 */
export function normalizeSourceList(sources: (string | null)[]): SourceBucket[] {
  const buckets = new Set<SourceBucket>();
  for (const s of sources) buckets.add(normalizeSource(s));
  return Array.from(buckets);
}

/**
 * Build SQL CASE expression for normalizing source column inline.
 * col = the SQL column reference (e.g. 'l.source', 'a.lead_source')
 */
export function buildNormalizeCaseExpr(col: string): string {
  // Build a CASE WHEN col ILIKE '%pattern%' THEN 'bucket' for each rule
  const whens = NORM_MAP.map(([p, b]) => `WHEN ${col} ILIKE '%${p.replace(/'/g, "''")}%' THEN '${b}'`);
  return `CASE ${whens.join(" ")} ELSE 'other' END`;
}
