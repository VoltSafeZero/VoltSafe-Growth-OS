/**
 * Per-user column customization – shared between Leads and Accounts tables.
 *
 * Exports:
 *  • ColumnDef           – static column definition (key + label + required?)
 *  • ColumnPref          – runtime preference (key + visible)
 *  • useColumnPrefs      – hook: load/save prefs from API
 *  • ColumnCustomizerPopover – trigger button + popover panel
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, ChevronUp, ChevronDown, RotateCcw } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ColumnDef {
  key: string;
  label: string;
  /** If true the column can't be hidden (checkbox is disabled). */
  required?: boolean;
}

export interface ColumnPref {
  key: string;
  visible: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Merge saved prefs with the current default column list.
 * - Columns present in saved prefs retain their saved order and visibility.
 * - New columns (added to defaults after the user last saved) are appended as visible.
 * - Columns removed from defaults are dropped.
 */
function mergePrefs(saved: ColumnPref[], defaults: ColumnDef[]): ColumnPref[] {
  const savedMap = new Map(saved.map(p => [p.key, p]));
  const defaultKeys = new Set(defaults.map(d => d.key));

  // Start with saved order, filtered to only current defaults
  const merged: ColumnPref[] = saved
    .filter(p => defaultKeys.has(p.key))
    .map(p => ({ ...p }));

  // Append any new default columns not in the saved list
  for (const d of defaults) {
    if (!savedMap.has(d.key)) {
      merged.push({ key: d.key, visible: true });
    }
  }

  return merged;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useColumnPrefs(viewType: string, defaultColumns: ColumnDef[]) {
  const defaultPrefs: ColumnPref[] = defaultColumns.map(c => ({ key: c.key, visible: true }));

  const [prefs, setPrefs] = useState<ColumnPref[]>(defaultPrefs);
  const [initialized, setInitialized] = useState(false);

  const { data: apiData, isLoading } = useQuery({
    queryKey: ["/api/user-column-prefs", viewType],
    queryFn: async () => {
      const res = await fetch(`/api/user-column-prefs/${viewType}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ columnsJson: string | null } | null>;
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (isLoading || initialized) return;
    setInitialized(true);
    if (apiData?.columnsJson) {
      try {
        const saved: ColumnPref[] = JSON.parse(apiData.columnsJson);
        setPrefs(mergePrefs(saved, defaultColumns));
      } catch {
        // malformed JSON → keep defaults
      }
    }
  }, [apiData, isLoading, initialized, defaultColumns]);

  const saveMutation = useMutation({
    mutationFn: async (newPrefs: ColumnPref[]) => {
      await apiRequest("PUT", `/api/user-column-prefs/${viewType}`, {
        columnsJson: JSON.stringify(newPrefs),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-column-prefs", viewType] });
    },
  });

  const updateColumns = (newPrefs: ColumnPref[]) => {
    setPrefs(newPrefs);
    saveMutation.mutate(newPrefs);
  };

  const resetToDefault = () => updateColumns(defaultPrefs);

  return {
    columns: prefs,
    updateColumns,
    resetToDefault,
    isLoading: !initialized,
  };
}

// ── Popover component ─────────────────────────────────────────────────────────

interface ColumnCustomizerPopoverProps {
  defaultColumns: ColumnDef[];
  columns: ColumnPref[];
  onChange: (prefs: ColumnPref[]) => void;
  onReset: () => void;
}

export function ColumnCustomizerPopover({
  defaultColumns,
  columns,
  onChange,
  onReset,
}: ColumnCustomizerPopoverProps) {
  const [open, setOpen] = useState(false);

  const defMap = new Map(defaultColumns.map(d => [d.key, d]));

  const toggle = (key: string) => {
    onChange(columns.map(c => (c.key === key ? { ...c, visible: !c.visible } : c)));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...columns];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  };

  const moveDown = (index: number) => {
    if (index === columns.length - 1) return;
    const next = [...columns];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  };

  const visibleCount = columns.filter(c => c.visible).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-xs"
          data-testid="button-column-customizer"
          title="Customize columns"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Columns</span>
          {visibleCount < columns.length && (
            <span className="ml-0.5 rounded-full bg-primary/15 text-primary text-[10px] px-1.5 py-0.5 font-medium">
              {visibleCount}/{columns.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0 shadow-lg"
        align="end"
        data-testid="column-customizer-panel"
      >
        <div className="p-3 border-b border-border/50">
          <p className="text-sm font-medium">Customize columns</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Show, hide, and reorder columns.
          </p>
        </div>
        <ul className="py-1 max-h-80 overflow-y-auto">
          {columns.map((pref, idx) => {
            const def = defMap.get(pref.key);
            if (!def) return null;
            const isRequired = def.required;
            return (
              <li
                key={pref.key}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 group"
                data-testid={`col-pref-row-${pref.key}`}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={pref.visible}
                  disabled={!!isRequired}
                  onChange={() => !isRequired && toggle(pref.key)}
                  className="h-3.5 w-3.5 accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  data-testid={`col-pref-check-${pref.key}`}
                />
                {/* Label */}
                <span
                  className={`flex-1 text-xs ${pref.visible ? "text-foreground" : "text-muted-foreground"} ${isRequired ? "opacity-60" : ""}`}
                >
                  {def.label}
                  {isRequired && (
                    <span className="ml-1 text-[10px] text-muted-foreground">(required)</span>
                  )}
                </span>
                {/* Reorder arrows */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0}
                    className="p-0.5 rounded hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed"
                    data-testid={`col-pref-up-${pref.key}`}
                    title="Move up"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => moveDown(idx)}
                    disabled={idx === columns.length - 1}
                    className="p-0.5 rounded hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed"
                    data-testid={`col-pref-down-${pref.key}`}
                    title="Move down"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="p-2 border-t border-border/50">
          <button
            onClick={() => { onReset(); setOpen(false); }}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1.5 rounded hover:bg-muted/40"
            data-testid="button-reset-columns"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to default
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
