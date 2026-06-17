/**
 * VoltSafe Canonical Inbox Policy — Phase 1 (policy corrected in Phase 2)
 *
 * Single source of truth for inbox membership and label derivation.
 * Subsequent phases will wire count endpoints, list queries, and the
 * client renderer to consume derived columns instead of raw label_ids.
 *
 * CRITICAL RULES:
 *   - This module NEVER mutates label_ids.
 *   - All output is derived read-time projections only.
 *   - Do not add business logic here (routing, backfill, sync). Labels only.
 *
 * SENT policy (Phase 2 correction):
 *   SENT-only messages are excluded from inbox because they carry no
 *   inbox-member label (INBOX / CATEGORY_*).  But SENT+INBOX and
 *   SENT+CATEGORY_* are inbox-visible — those are self-sent or BCC'd
 *   messages that Gmail stamped with both labels.  We do NOT add
 *   AND NOT SENT to the is_inbox predicate.
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

// Labels that always exclude a message from inbox, regardless of category tags.
// NOTE: SENT is intentionally absent. SENT-only messages are excluded naturally
// (they lack any inbox-member label). SENT+INBOX and SENT+CATEGORY_* stay visible.
export const VOLTSAFE_INBOX_EXCLUDE_LABELS = [
  "SPAM",
  "TRASH",
  "DRAFT",
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

// ── Drizzle-compatible shape (camelCase field names matching the ORM schema) ──
export type DrizzleEmailLabels = {
  isInbox:       boolean;
  isUnread:      boolean;
  isStarred:     boolean;
  isSpam:        boolean;
  isTrash:       boolean;
  isDraft:       boolean;
  isSent:        boolean;
  smartCategory: SmartCategory;
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
 * is_inbox logic:
 *   true  iff (INBOX OR CATEGORY_PERSONAL OR CATEGORY_UPDATES OR
 *              CATEGORY_PROMOTIONS OR CATEGORY_SOCIAL OR CATEGORY_FORUMS)
 *             AND NOT SPAM AND NOT TRASH AND NOT DRAFT
 *   SENT is intentionally excluded from the deny-list — see module header.
 *
 * smart_category mapping:
 *   CATEGORY_UPDATES    → "updates"
 *   CATEGORY_PROMOTIONS → "promotions"
 *   CATEGORY_SOCIAL     → "social"
 *   CATEGORY_FORUMS     → "forums"
 *   CATEGORY_PERSONAL   → "people"   (falls to else)
 *   (no CATEGORY_*)     → "people"   (falls to else)
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

  // SENT is NOT in the deny-list — SENT+INBOX and SENT+CATEGORY_* are inbox-visible.
  const is_inbox = hasInboxMember && !is_spam && !is_trash && !is_draft;

  let smart_category: SmartCategory = "people";
  if      (has("CATEGORY_UPDATES"))    smart_category = "updates";
  else if (has("CATEGORY_PROMOTIONS")) smart_category = "promotions";
  else if (has("CATEGORY_SOCIAL"))     smart_category = "social";
  else if (has("CATEGORY_FORUMS"))     smart_category = "forums";

  return { is_inbox, is_unread, is_starred, is_spam, is_trash, is_draft, is_sent, smart_category };
}

/**
 * Convert snake_case DerivedEmailLabels to the camelCase shape that Drizzle's
 * .values() / .set() accept for the email_messages table.
 *
 * Use at every write path that touches label_ids so derived columns stay in sync.
 *
 * @example
 *   await db.update(emailMessages)
 *     .set({ labelIds: newJson, updatedAt: new Date(), ...toDrizzleLabels(deriveEmailLabels(newJson)) })
 */
export function toDrizzleLabels(d: DerivedEmailLabels): DrizzleEmailLabels {
  return {
    isInbox:       d.is_inbox,
    isUnread:      d.is_unread,
    isStarred:     d.is_starred,
    isSpam:        d.is_spam,
    isTrash:       d.is_trash,
    isDraft:       d.is_draft,
    isSent:        d.is_sent,
    smartCategory: d.smart_category,
  };
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
