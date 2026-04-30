// Pure TS module split out from recipient-list.tsx so the parser can be
// imported by Node-side unit tests without dragging React/JSX along.

export interface ParsedAddress {
  name: string | null;
  email: string;
}

/**
 * Split "Foo Bar <foo@x>, baz@y, \"Q, R\" <qr@z>" while respecting quoted
 * substrings (display names can legally contain commas).
 *
 * Returns an empty array for null/undefined/empty input. Lower-cases the
 * email side; preserves the display name verbatim minus surrounding
 * straight-double-quotes.
 */
export function parseAddressList(raw: string | null | undefined): ParsedAddress[] {
  if (!raw) return [];
  const out: ParsedAddress[] = [];
  let inQuotes = false;
  let buf = "";
  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      buf += ch;
      continue;
    }
    if (ch === "," && !inQuotes) {
      const piece = buf.trim();
      if (piece) out.push(parseSingle(piece));
      buf = "";
      continue;
    }
    buf += ch;
  }
  const last = buf.trim();
  if (last) out.push(parseSingle(last));
  return out;
}

function parseSingle(piece: string): ParsedAddress {
  // "Display Name" <email@host>  or  Display Name <email@host>
  const m = piece.match(/^(.*?)<([^>]+)>\s*$/);
  if (m) {
    let name = m[1].trim();
    if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).trim();
    return { name: name || null, email: m[2].trim().toLowerCase() };
  }
  return { name: null, email: piece.trim().toLowerCase() };
}
