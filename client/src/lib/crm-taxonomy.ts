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
