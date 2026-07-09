// Shared CC/BCC/To recipient normalization helper.
//
// Root cause this fixes: naive `str.split(",")` on a raw address-list string
// breaks whenever a display name itself contains a comma (e.g. `"Doe, Jane"
// <jane@x.com>`), producing malformed fragments with unbalanced angle
// brackets. Those fragments are then joined back into a `Cc:`/`Bcc:` MIME
// header, which Gmail's API rejects with "Invalid Cc header". This module
// extracts bare email addresses with a bracket-aware regex instead of a
// naive split, so display names (with or without embedded commas) never
// corrupt the address list.
//
// Used by both the compose/reply-all client code and the server send route
// so behavior (dedupe, trim, sender-stripping, validation) stays identical
// on both sides.

const EMAIL_RE = /<([^<>"\s]+@[^<>"\s]+)>|([\w!#$%&'*+\-/=?^_`{|}~.]+@[\w-]+(?:\.[\w-]+)+)/g;

/** Extracts bare, lowercased email addresses from a free-form address-list
 *  string (handles "Name <a@b.com>, c@d.com, \"Doe, J.\" <e@f.com>" safely —
 *  the regex looks for `@` tokens rather than splitting on commas). */
export function extractEmailAddresses(input: string | null | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(input)) !== null) {
    const addr = (m[1] || m[2] || "").trim().toLowerCase();
    if (addr && !seen.has(addr)) {
      seen.add(addr);
      out.push(addr);
    }
  }
  return out;
}

const BASIC_EMAIL_RE = /^[\w!#$%&'*+\-/=?^_`{|}~.]+@[\w-]+(?:\.[\w-]+)+$/;

export interface NormalizeRecipientsResult {
  /** Deduped, trimmed, validated, lowercased addresses — safe to join into a header. */
  addresses: string[];
  /** Any input entries that failed validation — never silently dropped, surface these. */
  invalid: string[];
}

/**
 * Normalizes a list of raw recipient strings for a single header (To/Cc/Bcc):
 *  - trims whitespace
 *  - extracts a bare address (tolerates "Name <a@b.com>" plus-style input)
 *  - lowercases + dedupes
 *  - strips the sender's own address (relevant for reply-all Cc lists)
 *  - never emits malformed addresses; anything that isn't a valid email is
 *    returned in `invalid` instead of being coerced/silently dropped from
 *    the header — callers must surface this to the user as an error.
 */
export function normalizeRecipients(
  rawEntries: Array<string | null | undefined>,
  opts: { excludeEmail?: string | null } = {},
): NormalizeRecipientsResult {
  const exclude = opts.excludeEmail ? opts.excludeEmail.trim().toLowerCase() : null;
  const seen = new Set<string>();
  const addresses: string[] = [];
  const invalid: string[] = [];

  for (const raw of rawEntries) {
    if (raw == null) continue;
    const trimmed = String(raw).trim();
    if (!trimmed) continue;

    // If the entry already contains an angle-bracket address, extract it;
    // otherwise treat the trimmed entry itself as the candidate address.
    const bracketMatch = trimmed.match(/<([^<>"\s]+@[^<>"\s]+)>/);
    const candidate = (bracketMatch ? bracketMatch[1] : trimmed).trim().toLowerCase();

    if (!BASIC_EMAIL_RE.test(candidate)) {
      invalid.push(trimmed);
      continue;
    }
    if (exclude && candidate === exclude) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    addresses.push(candidate);
  }

  return { addresses, invalid };
}

/** Normalizes a comma-joined address-list string (e.g. from a `to`/`cc` message
 *  field) the SAFE way — via `extractEmailAddresses`, not `split(",")` — then
 *  runs it through `normalizeRecipients` for dedupe/exclude/validation. */
export function normalizeRecipientListString(
  input: string | null | undefined,
  opts: { excludeEmail?: string | null } = {},
): NormalizeRecipientsResult {
  return normalizeRecipients(extractEmailAddresses(input), opts);
}
