import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { GripVertical, Plus, Trash2, ArrowUp, ArrowDown, Lock, Users, X, Eye, Pencil } from "lucide-react";
import {
  COLUMN_COLOR_OPTIONS, columnSwatchClass, type TaskColumn, type ColumnShare, useTaskColumns,
} from "@/hooks/use-task-columns";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "column";
}

const USER_COL_PREFIX_RE = /^u\d+_/;

type UnifiedDraft = TaskColumn & { _isNew?: boolean };

// ── Column Share Dialog ────────────────────────────────────────────────────
export function ColumnShareDialog({
  slug, label, shares, open, onOpenChange,
}: {
  slug: string;
  label: string;
  shares: ColumnShare[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("edit");

  const { data: allUsers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/users"],
    queryFn: () => fetch("/api/users", { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });

  const availableUsers = allUsers.filter(u => !shares.some(s => s.userId === u.id));

  useEffect(() => {
    if (open) { setSelectedUserId(""); setPermission("edit"); }
  }, [open]);

  const addShare = useMutation({
    mutationFn: ({ userId, perm }: { userId: number; perm: string }) =>
      apiRequest("POST", `/api/task-columns/${slug}/shares`, { userId, permission: perm }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-columns"] });
      setSelectedUserId("");
      toast({ title: "User added to column" });
    },
    onError: (e: any) => toast({ title: "Failed to add user", description: e?.message, variant: "destructive" }),
  });

  const removeShare = useMutation({
    mutationFn: (userId: number) =>
      apiRequest("DELETE", `/api/task-columns/${slug}/shares/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-columns"] });
      toast({ title: "User removed from column" });
    },
    onError: (e: any) => toast({ title: "Failed to remove user", description: e?.message, variant: "destructive" }),
  });

  const updateShare = useMutation({
    mutationFn: ({ userId, perm }: { userId: number; perm: string }) =>
      apiRequest("PATCH", `/api/task-columns/${slug}/shares/${userId}`, { permission: perm }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/task-columns"] }),
    onError: (e: any) => toast({ title: "Failed to update permission", description: e?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-column-share">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Share "{label}"
          </DialogTitle>
          <DialogDescription>
            {shares.length === 0
              ? "No explicit shares — all workspace members have full access. Add users below to set custom permissions."
              : `${shares.length} user${shares.length === 1 ? "" : "s"} with explicit permissions. Others retain default workspace access.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {shares.length === 0 && (
            <div className="text-xs text-muted-foreground italic text-center py-4 border border-dashed rounded-md">
              No users added yet
            </div>
          )}
          {shares.map(share => (
            <div
              key={share.userId}
              className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30"
              data-testid={`share-row-${share.userId}`}
            >
              <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-xs font-semibold">
                {share.userName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{share.userName}</p>
                <p className="text-[11px] text-muted-foreground">Added by {share.sharedByName}</p>
              </div>
              <Select
                value={share.permission}
                onValueChange={(p) => updateShare.mutate({ userId: share.userId, perm: p })}
              >
                <SelectTrigger className="h-7 w-28 text-xs" data-testid={`select-perm-${share.userId}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">
                    <span className="flex items-center gap-1.5"><Eye className="h-3 w-3" /> View only</span>
                  </SelectItem>
                  <SelectItem value="edit">
                    <span className="flex items-center gap-1.5"><Pencil className="h-3 w-3" /> Can edit</span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => removeShare.mutate(share.userId)}
                disabled={removeShare.isPending}
                data-testid={`button-remove-share-${share.userId}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        {availableUsers.length > 0 && (
          <div className="flex gap-2 items-center pt-3 border-t border-border">
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-share-user">
                <SelectValue placeholder="Add a person…" />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={permission} onValueChange={(p) => setPermission(p as "view" | "edit")}>
              <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-share-permission">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">
                  <span className="flex items-center gap-1.5"><Eye className="h-3 w-3" /> View only</span>
                </SelectItem>
                <SelectItem value="edit">
                  <span className="flex items-center gap-1.5"><Pencil className="h-3 w-3" /> Can edit</span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 text-xs shrink-0"
              onClick={() => {
                if (!selectedUserId) return;
                addShare.mutate({ userId: Number(selectedUserId), perm: permission });
              }}
              disabled={!selectedUserId || addShare.isPending}
              data-testid="button-add-share"
            >
              {addShare.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        )}
        {availableUsers.length === 0 && allUsers.length > 0 && (
          <p className="text-xs text-muted-foreground text-center pt-2 border-t">
            All team members have been added.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Manage Columns Dialog ─────────────────────────────────────────────────
export function ManageColumnsDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const { columns } = useTaskColumns();
  const [shareTarget, setShareTarget] = useState<{ slug: string; label: string; shares: ColumnShare[] } | null>(null);

  const { data: me } = useQuery<{ id: number }>({
    queryKey: ["/api/auth/me"],
    queryFn: () => fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });

  // Single unified list of ALL columns (system + own personal) in user-preferred order.
  // The order is persisted to localStorage under the same key the board reads.
  const [unified, setUnified] = useState<UnifiedDraft[]>([]);

  useEffect(() => {
    if (!open || !me?.id) return;

    // Columns this user should manage: system columns + their own personal columns
    const visible = columns.filter(c => c.isSystem || c.isOwn);

    // Load the user's saved order from localStorage (same key as task-board)
    let savedOrder: string[] = [];
    try {
      const raw = localStorage.getItem(`task-col-order-${me.id}`);
      if (raw) savedOrder = JSON.parse(raw);
    } catch { /* ignore */ }

    let ordered: TaskColumn[];
    if (savedOrder.length) {
      const result: TaskColumn[] = [];
      for (const val of savedOrder) {
        const col = visible.find(c => c.value === val);
        if (col) result.push(col);
      }
      // Append any columns not yet in the saved order (e.g. newly created ones)
      for (const col of visible) {
        if (!savedOrder.includes(col.value)) result.push(col);
      }
      ordered = result;
    } else {
      ordered = visible;
    }

    setUnified(ordered);
  }, [open, columns, me?.id]);

  // Move a column up or down in the unified list
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= unified.length) return;
    setUnified(prev => {
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const add = () => {
    const personalCount = unified.filter(c => !c.isSystem).length;
    if (personalCount >= 16) {
      toast({ title: "Max 16 personal columns", variant: "destructive" });
      return;
    }
    setUnified(prev => [...prev, {
      value: `col_${Date.now()}`,
      label: "New column",
      color: "slate",
      _isNew: true,
      isOwn: true,
      isSystem: false,
    } as UnifiedDraft]);
  };

  const remove = (idx: number) => {
    setUnified(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLabel = (idx: number, label: string) => {
    setUnified(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      if (c._isNew) return { ...c, label, value: slugify(label) };
      return { ...c, label };
    }));
  };

  const updateField = (idx: number, patch: Partial<UnifiedDraft>) => {
    setUnified(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };

  // Detect personal columns that the user removed (so we can warn about task migration)
  const originalPersonal = columns.filter(c => !c.isSystem && c.isOwn);
  const removedExisting = originalPersonal
    .filter(orig => {
      const bare = orig.value.replace(USER_COL_PREFIX_RE, "");
      return !unified.some(d => {
        if (d._isNew) return false;
        const dBare = d.value.replace(USER_COL_PREFIX_RE, "");
        return dBare === bare || d.value === orig.value;
      });
    })
    .map(c => c.label);

  const save = useMutation({
    mutationFn: async () => {
      if (!me?.id) return;

      // 1. Persist the full column order (system + personal) to localStorage.
      //    The board reads this same key — so the board immediately reflects
      //    the order the user chose here.
      const fullOrder = unified.map(c => c.value);
      try { localStorage.setItem(`task-col-order-${me.id}`, JSON.stringify(fullOrder)); } catch { /* ignore */ }

      // 2. Save personal column definitions to the server.
      const personalCols = unified
        .filter(c => !c.isSystem && (c.isOwn || c._isNew))
        .map(({ _isNew, shares, isSystem, isOwn, ownerId, ...c }) => ({
          ...c,
          value: c.value.replace(USER_COL_PREFIX_RE, ""),
        }));

      return apiRequest("PUT", "/api/task-columns/user", { columns: personalCols });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-columns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
      toast({ title: "Your columns saved" });
      onOpenChange(false);
    },
    onError: (err: any) => toast({
      title: "Couldn't save columns",
      description: err?.message || "Please try again.",
      variant: "destructive",
    }),
  });

  const personalCount = unified.filter(c => !c.isSystem).length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl" data-testid="dialog-manage-columns">
          <DialogHeader>
            <DialogTitle>Manage task board columns</DialogTitle>
            <DialogDescription>
              Use the arrows to reorder any column — permanent or personal. Your order is saved privately and doesn't affect other team members. Permanent columns are always visible to everyone; personal columns are private unless shared.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
            {unified.length === 0 && (
              <div className="text-xs text-muted-foreground italic text-center py-6">
                Loading columns…
              </div>
            )}
            {unified.map((c, i) => {
              const isSystem = !!c.isSystem;
              const isEditable = !isSystem && (!!c.isOwn || !!c._isNew);
              const fullSlug = me?.id && !isSystem && !c._isNew
                ? (c.value.startsWith(`u${me.id}_`) ? c.value : `u${me.id}_${c.value}`)
                : c.value;
              const existingDef = columns.find(col => col.value === fullSlug || col.value === c.value);
              const shareCount = (existingDef?.shares ?? []).length;

              return (
                <div
                  key={`${c.value}-${i}`}
                  className={`flex items-center gap-2 p-2 rounded border ${isSystem ? "border-border/60 bg-muted/30" : "border-border bg-card"}`}
                  data-testid={`row-column-${c.value}`}
                >
                  {/* Leading icon: lock for system, grip for personal */}
                  {isSystem ? (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  ) : (
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab" />
                  )}

                  {/* Color swatch */}
                  <span className={`h-3 w-3 rounded-full shrink-0 ${columnSwatchClass(c.color)}`} aria-hidden />

                  {/* Label — editable for own personal, read-only for system / shared */}
                  {isEditable ? (
                    <Input
                      value={c.label}
                      onChange={(e) => updateLabel(i, e.target.value)}
                      placeholder="Column name"
                      className="h-8 flex-1 min-w-0"
                      data-testid={`input-label-${c.value}`}
                    />
                  ) : (
                    <span className="flex-1 text-sm font-medium min-w-0 truncate">{c.label}</span>
                  )}

                  {/* Color picker for own personal columns */}
                  {isEditable && (
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
                  )}

                  {/* "permanent" badge for system columns */}
                  {isSystem && (
                    <span className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded shrink-0 hidden sm:inline">
                      permanent
                    </span>
                  )}

                  {/* Share button */}
                  {me?.id && !c._isNew && (
                    <Button
                      size="icon"
                      variant={shareCount > 0 ? "secondary" : "ghost"}
                      className="h-8 w-8 relative shrink-0"
                      title={`Share${shareCount > 0 ? ` (${shareCount} user${shareCount === 1 ? "" : "s"})` : ""}`}
                      onClick={() => setShareTarget({ slug: fullSlug, label: c.label, shares: existingDef?.shares ?? [] })}
                      data-testid={`button-share-${c.value}`}
                    >
                      <Users className="h-3.5 w-3.5" />
                      {shareCount > 0 && (
                        <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">
                          {shareCount}
                        </span>
                      )}
                    </Button>
                  )}

                  {/* Up / down — available for every column */}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    data-testid={`button-up-${c.value}`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => move(i, 1)}
                    disabled={i === unified.length - 1}
                    data-testid={`button-down-${c.value}`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>

                  {/* Delete — personal columns only */}
                  {!isSystem ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={() => remove(i)}
                      data-testid={`button-delete-${c.value}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    // Spacer so rows align regardless of column type
                    <div className="h-8 w-8 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={add} data-testid="button-add-column">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add column
            </Button>
            <span className="text-xs text-muted-foreground">
              {personalCount} personal {personalCount === 1 ? "column" : "columns"}
            </span>
          </div>

          {removedExisting.length > 0 && (
            <div className="text-xs rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-2 text-amber-900 dark:text-amber-200">
              On save, tasks in <strong>{removedExisting.join(", ")}</strong> will be moved to <strong>Backlog</strong>.
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-columns">
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-columns">
              {save.isPending ? "Saving…" : "Save columns"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {shareTarget && (
        <ColumnShareDialog
          slug={shareTarget.slug}
          label={shareTarget.label}
          shares={shareTarget.shares}
          open={!!shareTarget}
          onOpenChange={(v) => { if (!v) setShareTarget(null); }}
        />
      )}
    </>
  );
}
