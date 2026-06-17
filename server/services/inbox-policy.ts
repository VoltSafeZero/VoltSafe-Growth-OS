/**
 * VoltSafe Canonical Inbox Policy — Phase 1
 *
 * Single source of truth for inbox membership and label derivation.
 * Subsequent phases will wire count endpoints, list queries, and the
 * client renderer to consume derived columns instead of raw label_ids.
 *
 * CRITICAL RULES:
 *   - This module NEVER mutates label_ids.
 *   - All output is derived read-time projections only.
 *   - Do not add business logic here (routing, backfill, sync). Labels only.
 */

// ── Canonical policy flag ─────────────────────────────────────────────────────
//
// VoltSafe Mail is a CRM command centre, not a Gmail clone.
// Category labels are metadata tags, not destination folders.
// Every CATEGORY_* message is inbox-visible regardless of whether Gmail
// delivered it with the INBOX label.
export const INBOX_INCLUDES_CATEGORY_SKIP = true;

// ── Canonical inbox member categories ────────────────────────────────────────
export const VOLTSAFE_INBOX_CATEGORY_LABELS = [
  "INBOX",
  "CATEGORY_PERSONAL",
  "CATEGORY_UPDATES",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
] as const;

export const VOLTSAFE_INBOX_EXCLUDE_LABELS = [
  "SPAM",
  "TRASH",
  "DRAFT",
  "SENT",
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────
export type SmartCategory = "people" | "updates" | "promotions" | "social" | "forums";

export type DerivedEmailLabels = {
  is_inbox:       boolean;
  is_unread:      boolean;
  is_starred:     boolean;
  is_spam:        boolean;
  is_trash:       boolean;
  is_draft:       boolean;
  is_sent:        boolean;
  smart_category: SmartCategory;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a label_ids JSON array string into an uppercase string[].
 * Returns [] on null / malformed input. Never throws.
 */
export function parseLabelArray(labelIdsJson: string | null | undefined): string[] {
  if (!labelIdsJson) return [];
  try {
    const parsed = JSON.parse(labelIdsJson);
    if (Array.isArray(parsed)) {
      return parsed.map((l: unknown) => String(l).toUpperCase());
    }
  } catch {
    // malformed — fall through to empty
  }
  return [];
}

// ── Canonical derivation function ─────────────────────────────────────────────

/**
 * Derive all 8 label projection fields from a raw label_ids JSON string.
 *
 * This is the single canonical derivation function. Every code path that needs
 * boolean label facts must call this rather than re-implementing label parsing.
 *
 * Does NOT modify label_ids. Returns derived values only.
 *
 * smart_category mapping:
 *   CATEGORY_UPDATES    → "updates"
 *   CATEGORY_PROMOTIONS → "promotions"
 *   CATEGORY_SOCIAL     → "social"
 *   CATEGORY_FORUMS     → "forums"
 *   CATEGORY_PERSONAL   → "people"   (falls to else)
 *   (no CATEGORY_*)     → "people"   (falls to else)
 *
 * NOTE on SENT exclusion from is_inbox:
 *   Self-addressed emails arrive with both INBOX and SENT labels.
 *   The spec mandates AND NOT SENT for is_inbox. Those messages will have
 *   is_inbox=false in the derived column. Phase 3 (endpoint rewire) must
 *   decide whether to use is_inbox directly or add a self-sent carve-out.
 *   The existing buildQClauses("in:inbox") does NOT exclude SENT — that
 *   behavioural difference must be reconciled before Phase 3 goes live.
 */
export function deriveEmailLabels(labelIdsJson: string | null | undefined): DerivedEmailLabels {
  const labels = parseLabelArray(labelIdsJson);

  const has = (label: string): boolean => labels.includes(label);

  const is_spam    = has("SPAM");
  const is_trash   = has("TRASH");
  const is_draft   = has("DRAFT");
  const is_sent    = has("SENT");
  const is_unread  = has("UNREAD");
  const is_starred = has("STARRED");

  const hasInboxMember =
    has("INBOX") ||
    has("CATEGORY_PERSONAL") ||
    has("CATEGORY_UPDATES") ||
    has("CATEGORY_PROMOTIONS") ||
    has("CATEGORY_SOCIAL") ||
    has("CATEGORY_FORUMS");

  const is_inbox = hasInboxMember && !is_spam && !is_trash && !is_draft && !is_sent;

  let smart_category: SmartCategory = "people";
  if      (has("CATEGORY_UPDATES"))    smart_category = "updates";
  else if (has("CATEGORY_PROMOTIONS")) smart_category = "promotions";
  else if (has("CATEGORY_SOCIAL"))     smart_category = "social";
  else if (has("CATEGORY_FORUMS"))     smart_category = "forums";

  return { is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft, is_sent, smart_category };
}

// ── SQL predicate builders (for Phase 3 use) ──────────────────────────────────
//
// These produce the WHERE-fragment strings that implement the canonical policy
// using the derived columns. Phase 3 endpoints will call these instead of
// repeating label_ids LIKE patterns.

/** WHERE fragment: inbox-visible rows (uses derived column) */
export const SQL_IS_INBOX = `is_inbox = true`;

/** WHERE fragment: unread inbox rows */
export const SQL_IS_INBOX_UNREAD = `is_inbox = true AND is_unread = true`;

/** WHERE fragment for a specific smart_category inside the inbox */
export function sqlSmartCategory(category: SmartCategory): string {
  return `is_inbox = true AND smart_category = '${category}'`;
}
