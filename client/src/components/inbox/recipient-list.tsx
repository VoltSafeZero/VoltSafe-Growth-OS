// Renders a To/Cc recipient row as an expandable list of pretty chips.
// Replaces the old single-line truncated string render that hid attendees
// after the first ~3 addresses on wide threads.
import { useState, useMemo } from "react";
import { ChevronDown } from "lucide-react";

export interface ParsedAddress {
  name: string | null;
  email: string;
}

/**
 * Split "Foo Bar <foo@x>, baz@y, \"Q, R\" <qr@z>" while respecting quoted
 * substrings (display names can legally contain commas).
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

interface RecipientListProps {
  label: string;                 // "To" / "Cc" / "Bcc"
  raw: string | null | undefined;
  /** Initial chips shown when collapsed; the rest hide behind "+N more". */
  collapsedCount?: number;
}

export function RecipientList({ label, raw, collapsedCount = 4 }: RecipientListProps) {
  const recipients = useMemo(() => parseAddressList(raw), [raw]);
  const [expanded, setExpanded] = useState(false);

  if (recipients.length === 0) return null;
  const showAll = expanded || recipients.length <= collapsedCount;
  const visible = showAll ? recipients : recipients.slice(0, collapsedCount);
  const hiddenCount = recipients.length - visible.length;
  const labelLower = label.toLowerCase();

  return (
    <span
      className="inline-flex items-baseline gap-1 flex-wrap"
      data-testid={`recipient-list-${labelLower}`}
    >
      <span className="text-muted-foreground/40 uppercase tracking-wider text-[9.5px] font-semibold">
        {label}
      </span>
      <span className="inline-flex flex-wrap items-baseline gap-1 text-foreground/75">
        {visible.map((r, i) => (
          <span
            key={`${r.email}-${i}`}
            className="inline-flex items-center rounded-md bg-muted/40 px-1.5 py-0.5 text-[10.5px] font-medium hover:bg-muted/65 transition-colors"
            title={r.name ? `${r.name} <${r.email}>` : r.email}
            data-testid={`chip-recipient-${labelLower}-${r.email}`}
          >
            <span className="truncate max-w-[200px]">{r.name || r.email}</span>
          </span>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 text-primary/85 px-1.5 py-0.5 text-[10.5px] font-medium hover:bg-primary/20 transition-colors"
            data-testid={`button-expand-${labelLower}`}
          >
            +{hiddenCount} more
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
        {expanded && recipients.length > collapsedCount && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="inline-flex items-center gap-0.5 rounded-md text-muted-foreground/60 hover:text-foreground px-1.5 py-0.5 text-[10.5px]"
            data-testid={`button-collapse-${labelLower}`}
          >
            Show less
          </button>
        )}
      </span>
    </span>
  );
}
