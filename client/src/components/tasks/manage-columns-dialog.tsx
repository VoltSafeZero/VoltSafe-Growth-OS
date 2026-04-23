import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { GripVertical, Plus, Trash2, ArrowUp, ArrowDown, Lock } from "lucide-react";
import {
  COLUMN_COLOR_OPTIONS, columnSwatchClass, type TaskColumn, useTaskColumns,
} from "@/hooks/use-task-columns";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "column";
}

type Draft = TaskColumn & { _isNew?: boolean };

export function ManageColumnsDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const { columns } = useTaskColumns();
  const [draft, setDraft] = useState<Draft[]>([]);

  // Reset draft each time the dialog opens
  useEffect(() => {
    if (open) setDraft(columns.map(c => ({ ...c })));
  }, [open, columns]);

  const save = useMutation({
    mutationFn: async (cols: Draft[]) => {
      const payload = { columns: cols.map(({ _isNew, ...c }) => c) };
      return apiRequest("PUT", "/api/admin/task-columns", payload);
    },
    onSuccess: async (resp: any) => {
      let movedCount = 0;
      try {
        const json = await resp.json?.();
        movedCount = json?.movedTaskCount ?? 0;
      } catch { /* ignore */ }
      queryClient.invalidateQueries({ queryKey: ["/api/task-columns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
      toast({
        title: "Columns saved",
        description: movedCount > 0
          ? `Moved ${movedCount} task${movedCount === 1 ? "" : "s"} to Backlog.`
          : undefined,
      });
      onOpenChange(false);
    },
    onError: (err: any) => toast({
      title: "Couldn't save columns",
      description: err?.message || "Please try again.",
      variant: "destructive",
    }),
  });

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= draft.length) return;
    setDraft(prev => {
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };
  const add = () => {
    if (draft.length >= 12) {
      toast({ title: "Max 12 columns", variant: "destructive" });
      return;
    }
    setDraft(prev => [...prev, { value: `column_${prev.length + 1}`, label: "New column", color: "slate", _isNew: true }]);
  };
  const remove = (idx: number) => {
    const col = draft[idx];
    if (col.value === "backlog") {
      toast({ title: "Backlog can't be deleted", description: "It's the fallback column when others are removed.", variant: "destructive" });
      return;
    }
    setDraft(prev => prev.filter((_, i) => i !== idx));
  };
  const updateField = (idx: number, patch: Partial<Draft>) => {
    setDraft(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };
  const updateLabel = (idx: number, label: string) => {
    const col = draft[idx];
    // Auto-update slug only for new, never-saved columns
    if (col._isNew) {
      updateField(idx, { label, value: slugify(label) });
    } else {
      updateField(idx, { label });
    }
  };

  const removedExisting = columns
    .filter(c => !draft.some(d => d.value === c.value))
    .map(c => c.label);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-manage-columns">
        <DialogHeader>
          <DialogTitle>Manage task board columns</DialogTitle>
          <DialogDescription>
            These columns apply to everyone in your workspace. Deleting a column moves any tasks in it to Backlog.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {draft.map((c, i) => (
            <div
              key={`${c.value}-${i}`}
              className="flex items-center gap-2 p-2 rounded border border-border bg-card"
              data-testid={`row-column-${c.value}`}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className={`h-3 w-3 rounded-full shrink-0 ${columnSwatchClass(c.color)}`} aria-hidden />
              <Input
                value={c.label}
                onChange={(e) => updateLabel(i, e.target.value)}
                placeholder="Column name"
                className="h-8 flex-1 min-w-0"
                data-testid={`input-label-${c.value}`}
              />
              <select
                value={c.color}
                onChange={(e) => updateField(i, { color: e.target.value })}
                className="h-8 rounded border border-input bg-background px-2 text-xs"
                data-testid={`select-color-${c.value}`}
              >
                {COLUMN_COLOR_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)} disabled={i === 0} data-testid={`button-up-${c.value}`}>
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)} disabled={i === draft.length - 1} data-testid={`button-down-${c.value}`}>
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              {c.value === "backlog" ? (
                <span className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground" title="Backlog can't be deleted">
                  <Lock className="h-3.5 w-3.5" />
                </span>
              ) : (
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(i)} data-testid={`button-delete-${c.value}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" size="sm" onClick={add} data-testid="button-add-column">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add column
          </Button>
          <span className="text-xs text-muted-foreground">{draft.length} / 12</span>
        </div>

        {removedExisting.length > 0 && (
          <div className="text-xs rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-2 text-amber-900 dark:text-amber-200">
            On save, tasks in <strong>{removedExisting.join(", ")}</strong> will be moved to <strong>Backlog</strong>.
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-columns">Cancel</Button>
          <Button onClick={() => save.mutate(draft)} disabled={save.isPending} data-testid="button-save-columns">
            {save.isPending ? "Saving…" : "Save columns"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
