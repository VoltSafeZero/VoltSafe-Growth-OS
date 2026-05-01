// Renders a To/Cc/Bcc recipient row as an expandable list of neat chips.
// Designed to match Spark/Superhuman header density — compact, readable, calm.
//
// The address-list parser lives in `./parse-address-list` so it can be
// imported from Node-side unit tests without pulling in React/JSX.
import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { parseAddressList, type ParsedAddress } from "./parse-address-list";

export { parseAddressList };
export type { ParsedAddress };

interface RecipientListProps {
  label: string;                  // "To" / "Cc" / "Bcc"
  raw: string | null | undefined;
  /** Initial chips shown when collapsed; rest hide behind "+N more". */
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
      {/* Field label — "To" / "Cc" */}
      <span
        className="text-muted-foreground/35 uppercase tracking-wider text-[9px] font-semibold flex-shrink-0"
        aria-label={`${label} field`}
      >
        {label}
      </span>

      <span className="inline-flex flex-wrap items-baseline gap-1">
        {visible.map((r, i) => (
          <span
            key={`${r.email}-${i}`}
            className="inline-flex items-center rounded-md bg-muted/35 ring-1 ring-border/20 px-1.5 py-px text-[10px] font-medium text-foreground/75 hover:bg-muted/55 hover:ring-border/40 transition-colors cursor-default select-text"
            title={r.name ? `${r.name} <${r.email}>` : r.email}
            data-testid={`chip-recipient-${labelLower}-${r.email}`}
          >
            <span className="truncate max-w-[160px]">{r.name || r.email}</span>
          </span>
        ))}

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground/55 hover:text-foreground/80 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded px-0.5"
            data-testid={`button-expand-${labelLower}`}
            aria-label={`Show ${hiddenCount} more ${labelLower} recipients`}
          >
            +{hiddenCount}
            <ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
          </button>
        )}

        {expanded && recipients.length > collapsedCount && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/45 hover:text-foreground/70 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded px-0.5"
            data-testid={`button-collapse-${labelLower}`}
            aria-label={`Collapse ${labelLower} recipients`}
          >
            <ChevronUp className="h-2.5 w-2.5" aria-hidden="true" />
            less
          </button>
        )}
      </span>
    </span>
  );
}
