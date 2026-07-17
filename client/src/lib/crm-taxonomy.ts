/**
 * CRM Taxonomy — single source of truth for all controlled-vocabulary dropdowns.
 *
 * Phase 1: Config + UI alignment only. No DB backfill performed here.
 * Phase 2 will wire these values into schema validation and data-write paths.
 *
 * Rules:
 *  - Leads, Accounts, and Contacts import from here — never define local copies.
 *  - Legacy values (closed_lost → lost, prospect → new) are handled by the
 *    normalizeLifecycleStage helper, not by removing old DB rows.
 *  - Do not delete ORG_TYPE_OPTIONS from pages that already persist those values;
 *    keep them as LEGACY_ORG_TYPE_OPTIONS until a migration moves data.
 */

// ─── Pipeline stages (shared: Leads + Accounts) ──────────────────────────────
// "converted" = a lead was promoted to an active Account.
// Label is "Promoted" in both contexts — matching the lifecycle transition system.

export const PIPELINE_STAGE_OPTIONS = [
  { value: "new",               label: "New",               color: "bg-slate-500/10 text-slate-400 border-slate-500/20",  columnColor: "border-t-slate-500" },
  { value: "contacted",         label: "Contacted",          color: "bg-blue-500/10 text-blue-400 border-blue-500/20",    columnColor: "border-t-blue-500" },
  { value: "meeting_scheduled", label: "Meeting Scheduled",  color: "bg-purple-500/10 text-purple-400 border-purple-500/20", columnColor: "border-t-purple-500" },
  { value: "qualified",         label: "Qualified",          color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",    columnColor: "border-t-cyan-500" },
  { value: "proposal_sent",     label: "Proposal Sent",      color: "bg-amber-500/10 text-amber-400 border-amber-500/20", columnColor: "border-t-amber-500" },
  { value: "negotiation",       label: "Negotiation",        color: "bg-orange-500/10 text-orange-400 border-orange-500/20", columnColor: "border-t-orange-500" },
  { value: "converted",         label: "Promoted",           color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", columnColor: "border-t-emerald-500" },
  { value: "lost",              label: "Closed Lost",        color: "bg-red-500/10 text-red-400 border-red-500/20",       columnColor: "border-t-red-500" },
  { value: "no_shore_power",    label: "No Shore Power",     color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",    columnColor: "border-t-zinc-500" },
] as const;

export type PipelineStageValue = typeof PIPELINE_STAGE_OPTIONS[number]["value"];

// ─── Primary industry (Leads) ─────────────────────────────────────────────────

export const PRIMARY_INDUSTRY_OPTIONS = [
  { value: "marine",                  label: "Marine" },
  { value: "utilities_grid",          label: "Utilities / Grid" },
  { value: "industrial",              label: "Industrial" },
  { value: "commercial_real_estate",  label: "Commercial Real Estate" },
  { value: "transportation",          label: "Transportation" },
  { value: "government",              label: "Government" },
  { value: "energy_infrastructure",   label: "Energy Infrastructure" },
  { value: "manufacturing",           label: "Manufacturing" },
  { value: "agnostic",                label: "Agnostic / Cross-Industry" },
  { value: "other",                   label: "Other" },
] as const;

// ─── Relationship type (Leads) ────────────────────────────────────────────────
// Expanded from the legacy 10-option list to the full canonical 14-option set.
// New values: customer, installer, distributor, association, media.
// Removed legacy: utility_infrastructure (was an alias; use distributor/installer instead).

export const RELATIONSHIP_TYPE_OPTIONS = [
  { value: "customer_prospect",    label: "Customer Prospect" },
  { value: "customer",             label: "Customer" },
  { value: "strategic_partner",    label: "Strategic Partner" },
  { value: "channel_partner",      label: "Channel Partner" },
  { value: "oem_manufacturer",     label: "OEM / Manufacturer" },
  { value: "installer",            label: "Installer" },
  { value: "distributor",          label: "Distributor" },
  { value: "government_regulatory",label: "Government / Regulatory" },
  { value: "association",          label: "Association" },
  { value: "investor",             label: "Investor" },
  { value: "vendor_supplier",      label: "Vendor / Supplier" },
  { value: "research_standards",   label: "Research / Standards" },
  { value: "media",                label: "Media" },
  { value: "other",                label: "Other" },
] as const;

// ─── Market segment (Accounts — replaces the conflicting ORG_TYPE_OPTIONS) ───
// Phase 1: defined here but not yet written to DB.
// Phase 2: the accounts `segment` column will adopt these canonical values.
//
// marina_parent_group = a parent corporation / operating group that owns and/or
//   operates multiple marina properties (e.g. Safe Harbor Marinas, Suntex,
//   MarineMax Marinas). Not an association — a commercial operating entity.

export const MARKET_SEGMENT_OPTIONS = [
  { value: "marina",              label: "Marina" },
  { value: "marina_parent_group", label: "Marina Parent Group" },
  { value: "yacht_club",          label: "Yacht Club" },
  { value: "dry_stack",           label: "Dry Stack" },
  { value: "port_harbor",         label: "Port / Harbor" },
  { value: "municipality",        label: "Municipality" },
  { value: "utility",             label: "Utility" },
  { value: "oem",                 label: "OEM" },
  { value: "distributor",         label: "Distributor" },
  { value: "installer",           label: "Installer" },
  { value: "manufacturer",        label: "Manufacturer" },
  { value: "association",         label: "Association" },
  { value: "research",            label: "Research" },
  { value: "investor",            label: "Investor" },
  { value: "media",               label: "Media" },
  { value: "other",               label: "Other" },
] as const;

// ─── Priority (Accounts) ──────────────────────────────────────────────────────

export const PRIORITY_OPTIONS = [
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
] as const;

// ─── Slip range (normalised keys — replaces free-text slip-range strings) ────
// Phase 1: defined here for future use in filter UI.
// Phase 2: the `segment` / dedicated slip-range column will adopt these values.

export const SLIP_RANGE_OPTIONS = [
  { value: "less_than_100", label: "Less than 100",  legacyLabel: "Less than 100" },
  { value: "100_to_300",    label: "100 – 300",       legacyLabel: "100 to 300" },
  { value: "300_to_500",    label: "300 – 500",       legacyLabel: "300 to 500" },
  { value: "500_to_700",    label: "500 – 700",       legacyLabel: "500 to 700" },
  { value: "700_to_900",    label: "700 – 900",       legacyLabel: "700 to 900" },
  { value: "more_than_900", label: "More than 900",   legacyLabel: "More than 900" },
] as const;

// ─── Helper functions ─────────────────────────────────────────────────────────

type TaxonomyType =
  | "pipeline_stage"
  | "primary_industry"
  | "relationship_type"
  | "market_segment"
  | "priority"
  | "slip_range";

const TAXONOMY_MAP: Record<TaxonomyType, ReadonlyArray<{ value: string; label: string }>> = {
  pipeline_stage:    PIPELINE_STAGE_OPTIONS,
  primary_industry:  PRIMARY_INDUSTRY_OPTIONS,
  relationship_type: RELATIONSHIP_TYPE_OPTIONS,
  market_segment:    MARKET_SEGMENT_OPTIONS,
  priority:          PRIORITY_OPTIONS,
  slip_range:        SLIP_RANGE_OPTIONS,
};

/** Resolve a human-readable label for any taxonomy value. Returns the raw value if unknown. */
export function getTaxonomyLabel(type: TaxonomyType, value: string | null | undefined): string {
  if (!value) return "—";
  const match = TAXONOMY_MAP[type]?.find(o => o.value === value);
  return match?.label ?? value;
}

/**
 * Normalise legacy pipeline-stage values to their canonical equivalents.
 * - "closed_lost"  → "lost"
 * - "prospect"     → "new"
 * - "archived"     → "archived" (display-only, not a live stage)
 * All other values pass through unchanged.
 */
export function normalizeLifecycleStage(value: string | null | undefined): string {
  if (!value) return "new";
  const map: Record<string, string> = {
    closed_lost: "lost",
    prospect:    "new",
  };
  return map[value] ?? value;
}

/** Returns true for values that exist in the DB but are not in the canonical stage list. */
export function isLegacyLifecycleStage(value: string | null | undefined): boolean {
  if (!value) return false;
  const canonical = new Set(PIPELINE_STAGE_OPTIONS.map(s => s.value));
  return !canonical.has(value);
}

/** Human-readable display for a legacy stage value (e.g. for read-only history views). */
export function getLegacyStageDisplay(value: string | null | undefined): string {
  if (!value) return "—";
  const legacyLabels: Record<string, string> = {
    closed_lost: "Closed Lost (legacy)",
    prospect:    "Prospect (legacy)",
    archived:    "Archived",
  };
  return legacyLabels[value] ?? getTaxonomyLabel("pipeline_stage", normalizeLifecycleStage(value));
}

// ─── Shared geo data (moved here from leads.tsx so Accounts can reuse) ───────

export const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
  "Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky",
  "Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi",
  "Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico",
  "New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania",
  "Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
];

export const CA_PROVINCES = [
  "Alberta","British Columbia","Manitoba","New Brunswick","Newfoundland and Labrador",
  "Northwest Territories","Nova Scotia","Nunavut","Ontario","Prince Edward Island",
  "Quebec","Saskatchewan","Yukon",
];

export function getRegionsForCountry(country: string): string[] {
  if (country === "US") return US_STATES;
  if (country === "CA") return CA_PROVINCES;
  return [];
}

// ─── Filter bar shared option sets ───────────────────────────────────────────
// Used by BOTH Leads and Accounts. Single source of truth — no local copies.

/**
 * Industry options for the filter bar (same values as PRIMARY_INDUSTRY_OPTIONS
 * but in spec-required order: Marine first, Agnostic/Cross-Industry second).
 */
export const FILTER_INDUSTRY_OPTIONS = [
  { value: "marine",                 label: "Marine" },
  { value: "agnostic",               label: "Agnostic / Cross-Industry" },
  { value: "utilities_grid",         label: "Utilities / Grid" },
  { value: "industrial",             label: "Industrial" },
  { value: "commercial_real_estate", label: "Commercial Real Estate" },
  { value: "transportation",         label: "Transportation" },
  { value: "government",             label: "Government" },
  { value: "energy_infrastructure",  label: "Energy Infrastructure" },
  { value: "manufacturing",          label: "Manufacturing" },
  { value: "other",                  label: "Other" },
] as const;

/**
 * Simplified 9-option segment list for the filter bar.
 * Values map to existing marketSegment DB entries from MARKET_SEGMENT_OPTIONS.
 * (Forms still use the full MARKET_SEGMENT_OPTIONS list.)
 */
export const FILTER_SEGMENT_OPTIONS = [
  { value: "marina",              label: "Marina" },
  { value: "marina_parent_group", label: "Corporation" },
  { value: "oem",                 label: "OEM" },
  { value: "distributor",         label: "Distributor" },
  { value: "installer",           label: "Partner" },
  { value: "utility",             label: "Utility" },
  { value: "municipality",        label: "Government" },
  { value: "port_harbor",         label: "Commercial Operator" },
  { value: "other",               label: "Other" },
] as const;

/**
 * Simplified relationship/org-type options for the filter bar.
 * Leads backend maps these to `relationshipType` values.
 * Accounts backend maps these to `orgType` value groups.
 */
export const FILTER_TYPE_OPTIONS = [
  { value: "prospect",  label: "Prospect" },
  { value: "customer",  label: "Customer" },
  { value: "partner",   label: "Partner" },
  { value: "vendor",    label: "Vendor" },
  { value: "investor",  label: "Investor" },
  { value: "strategic", label: "Strategic" },
  { value: "other",     label: "Other" },
] as const;

/** Country options for the filter bar. "OTHER" matches any non-CA/US country. */
export const FILTER_COUNTRY_OPTIONS = [
  { value: "CA",    label: "Canada" },
  { value: "US",    label: "United States" },
  { value: "OTHER", label: "Other / International" },
] as const;

/** Priority options for the filter bar (includes Unassigned for null/missing priority). */
export const FILTER_PRIORITY_OPTIONS = [
  { value: "high",       label: "High" },
  { value: "medium",     label: "Medium" },
  { value: "low",        label: "Low" },
  { value: "unassigned", label: "Unassigned" },
] as const;

/** Sort options shared between Leads and Accounts filter bars. */
export const FILTER_SORT_OPTIONS = [
  { value: "default",                   label: "Default" },
  { value: "name:asc",                  label: "A→Z" },
  { value: "name:desc",                 label: "Z→A" },
  { value: "dealAmount:desc",           label: "Deal $ High→Low" },
  { value: "dealAmount:asc",            label: "Deal $ Low→High" },
  { value: "createdAt:desc",            label: "Recently Added" },
  { value: "updatedAt:desc",            label: "Recently Updated" },
  { value: "last_comm_at:desc",         label: "Last Contact (newest)" },
  { value: "last_comm_at:asc",          label: "Last Contact (oldest)" },
  { value: "last_outgoing_at:desc",     label: "Last Outreach (newest)" },
  { value: "days_since_contact:desc",   label: "Longest Silence First" },
] as const;

// ─── Segment classification helpers ──────────────────────────────────────────

/** Marina types that represent an operating marina property (single location). */
const MARINA_OPERATING_SEGMENTS = new Set<string>(["marina", "yacht_club", "dry_stack", "port_harbor"]);

/** Returns true if the segment value represents a marina operating entity (not a group). */
export function isMarinaOperatingSegment(value: string | null | undefined): boolean {
  return !!value && MARINA_OPERATING_SEGMENTS.has(value);
}

/**
 * Returns true if the segment value represents a parent corporation or
 * operating group that owns multiple marina properties (e.g. Safe Harbor).
 * marina_parent_group is NOT an association — it is a commercial operating entity.
 */
export function isMarinaParentGroup(value: string | null | undefined): boolean {
  return value === "marina_parent_group";
}

/** Returns true if the segment value represents a channel/distribution partner. */
export function isPartnerSegment(value: string | null | undefined): boolean {
  const PARTNER_SEGMENTS = new Set<string>(["distributor", "installer", "oem", "manufacturer"]);
  return !!value && PARTNER_SEGMENTS.has(value);
}

/** Returns true if the segment value represents a non-commercial association body. */
export function isAssociationSegment(value: string | null | undefined): boolean {
  return value === "association";
}

// ─── Entity Type — canonical lead classification ──────────────────────────────

/**
 * Controlled vocabulary for the entity_type column on leads.
 * This is the single canonical source of truth for whether a lead represents
 * a marina entity. The anchor icon is based on isMarinaEntity(), not on
 * marina_id, source, or import status.
 */
export const ENTITY_TYPE_OPTIONS = [
  { value: "marina",         label: "Marina" },
  { value: "marina_group",   label: "Marina Group / Portfolio" },
  { value: "port_authority", label: "Port Authority" },
  { value: "municipality",   label: "Municipality" },
  { value: "partner",        label: "Partner" },
  { value: "vendor",         label: "Vendor" },
  { value: "other",          label: "Other" },
] as const;

/**
 * Entity types that represent a marina-class entity and should display
 * the teal anchor icon. Port authorities are included because they
 * manage dock/slip infrastructure.
 */
export const MARINA_ENTITY_TYPES = new Set<string>([
  "marina",
  "marina_group",
  "port_authority",
]);

/**
 * Returns true if the lead/record represents a marina-class entity and
 * should display the anchor icon.
 *
 * Priority: entityType field (new canonical) → marinaId fallback
 * (backward compat for imported records before migration 0034 backfill runs).
 *
 * Do NOT base this on: source, marina_id alone, name keywords, import status.
 */
export function isMarinaEntity(record: {
  entityType?: string | null;
  marinaId?: number | null;
}): boolean {
  if (record.entityType != null && record.entityType !== "") {
    return MARINA_ENTITY_TYPES.has(record.entityType);
  }
  // Backward compat: imported records have marinaId set by the marina_directory
  // import even before migration 0034 backfills entity_type.
  return !!record.marinaId;
}

// ─── Form field visibility helpers ───────────────────────────────────────────

/**
 * Relationship types that represent channel/supply-chain partners.
 * When set, individual marina operating detail fields are hidden in create/edit forms.
 */
export const PARTNER_RELATIONSHIP_TYPES = new Set<string>([
  "strategic_partner",
  "channel_partner",
  "oem_manufacturer",
  "installer",
  "distributor",
]);

/**
 * Market segments where individual marina operating detail fields
 * (slips, power demand, seasonality, etc.) are not applicable.
 */
export const NON_OPERATING_SEGMENTS = new Set<string>([
  "marina_parent_group",
  "association",
]);

/**
 * Returns true when marina operating detail fields should be shown in
 * create/edit forms (slip range, slip count, power demand, seasonality,
 * estimated pedestals, estimated slips impacted).
 *
 * Defaults to true for legacy/null records so existing data is always visible.
 */
export function shouldShowMarinaOps(
  primaryIndustry: string | null | undefined,
  relationshipType: string | null | undefined,
  marketSegment: string | null | undefined,
): boolean {
  if (primaryIndustry && primaryIndustry !== "marine") return false;
  if (relationshipType && PARTNER_RELATIONSHIP_TYPES.has(relationshipType)) return false;
  if (marketSegment && NON_OPERATING_SEGMENTS.has(marketSegment)) return false;
  return true;
}

// ─── Canonical field resolver helpers ────────────────────────────────────────
// One canonical value per business concept — use these everywhere instead of
// reading raw DB fields directly. Never mix slip count with pedestal estimates.

/**
 * Returns the best available slip count for a lead or account record.
 * Priority: slipCountInt (integer) → slipCount → slips (legacy text) → null.
 * Do NOT fall back to estimatedSlipsImpacted — that is a VoltSafe deployment
 * estimate, not a marina property.
 */
export function getCanonicalSlipCount(
  record: Record<string, any> | null | undefined,
): number | string | null {
  if (!record) return null;
  if (record.slipCountInt != null) return record.slipCountInt;
  if (record.slipCount   != null) return record.slipCount;
  if (record.slips && record.slips !== "-") return record.slips;
  return null;
}

/**
 * Returns the best available estimated pedestal count.
 * Priority: estimatedPedestalCount → estimated_pedestal_count → null.
 */
export function getCanonicalEstimatedPedestals(
  record: Record<string, any> | null | undefined,
): number | null {
  if (!record) return null;
  if (record.estimatedPedestalCount   != null) return record.estimatedPedestalCount;
  if (record.estimated_pedestal_count != null) return record.estimated_pedestal_count;
  return null;
}

/**
 * Returns the canonical market segment value.
 * Priority: marketSegment → market_segment → mapped legacy segment → null.
 */
export function getCanonicalMarketSegment(
  record: Record<string, any> | null | undefined,
): string | null {
  if (!record) return null;
  if (record.marketSegment)   return record.marketSegment;
  if (record.market_segment)  return record.market_segment;
  const LEGACY_MAP: Record<string, string> = {
    marina: "marina",
    corp:    "marina_parent_group",
    partner: "distributor",
    other:   "other",
  };
  if (record.segment && LEGACY_MAP[record.segment]) return LEGACY_MAP[record.segment];
  return null;
}

/**
 * Normalises a lead/account update payload so canonical fields are always
 * written and legacy aliases stay in sync as a compatibility shim.
 * Call this before dispatching a PUT /api/leads/:id or PUT /api/accounts/:id body.
 */
export function normalizeMarinaUpdatePayload(
  payload: Record<string, any>,
): Record<string, any> {
  const out = { ...payload };
  const canonicalSlips =
    out.slipCountInt != null ? out.slipCountInt
    : out.slipCount  != null ? out.slipCount
    : null;
  if (canonicalSlips != null && out.estimatedSlipsImpacted == null) {
    out.estimatedSlipsImpacted = canonicalSlips;
  }
  return out;
}
