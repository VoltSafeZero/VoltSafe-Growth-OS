// Renders a To/Cc recipient row as an expandable list of pretty chips.
// Replaces the old single-line truncated string render that hid attendees
// after the first ~3 addresses on wide threads.
//
// The actual address-list parser lives in `./parse-address-list` so it can
// be imported from Node-side unit tests without pulling in React/JSX.
import { useState, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { parseAddressList, type ParsedAddress } from "./parse-address-list";

export { parseAddressList };
export type { ParsedAddress };

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
