import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

type Draft = TaskColumn & { _isNew?: boolean };

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
  open, onOpenChange, isAdmin = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isAdmin?: boolean;
}) {
  const { toast } = useToast();
  const { columns } = useTaskColumns();
  const [draft, setDraft] = useState<Draft[]>([]);
  const [shareSlug, setShareSlug] = useState<string | null>(null);

  useEffect(() => {
    if (open) setDraft(columns.map(c => ({ ...c })));
  }, [open, columns]);

  const save = useMutation({
    mutationFn: async (cols: Draft[]) => {
      const payload = { columns: cols.map(({ _isNew, shares, ...c }) => c) };
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
    if (col._isNew) {
      updateField(idx, { label, value: slugify(label) });
    } else {
      updateField(idx, { label });
    }
  };

  const removedExisting = columns
    .filter(c => !draft.some(d => d.value === c.value))
    .map(c => c.label);

  const shareCol = columns.find(c => c.value === shareSlug);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl" data-testid="dialog-manage-columns">
          <DialogHeader>
            <DialogTitle>Manage task board columns</DialogTitle>
            <DialogDescription>
              {isAdmin
                ? "Add, rename, reorder, or delete columns. You can also share any column with specific team members."
                : "View columns and manage who has access to each one."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {draft.map((c, i) => {
              const shareCount = (c.shares ?? []).length;
              return (
                <div
                  key={`${c.value}-${i}`}
                  className="flex items-center gap-2 p-2 rounded border border-border bg-card"
                  data-testid={`row-column-${c.value}`}
                >
                  {isAdmin && (
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className={`h-3 w-3 rounded-full shrink-0 ${columnSwatchClass(c.color)}`} aria-hidden />
                  {isAdmin ? (
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
                  {isAdmin && (
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

                  <Button
                    size="icon"
                    variant={shareCount > 0 ? "secondary" : "ghost"}
                    className="h-8 w-8 relative shrink-0"
                    title={`Manage sharing${shareCount > 0 ? ` (${shareCount} user${shareCount === 1 ? "" : "s"})` : ""}`}
                    onClick={() => setShareSlug(c.value)}
                    data-testid={`button-share-${c.value}`}
                  >
                    <Users className="h-3.5 w-3.5" />
                    {shareCount > 0 && (
                      <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">
                        {shareCount}
                      </span>
                    )}
                  </Button>

                  {isAdmin && (
                    <>
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
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {isAdmin && (
            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" size="sm" onClick={add} data-testid="button-add-column">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add column
              </Button>
              <span className="text-xs text-muted-foreground">{draft.length} / 12</span>
            </div>
          )}

          {isAdmin && removedExisting.length > 0 && (
            <div className="text-xs rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-2 text-amber-900 dark:text-amber-200">
              On save, tasks in <strong>{removedExisting.join(", ")}</strong> will be moved to <strong>Backlog</strong>.
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-columns">
              {isAdmin ? "Cancel" : "Close"}
            </Button>
            {isAdmin && (
              <Button onClick={() => save.mutate(draft)} disabled={save.isPending} data-testid="button-save-columns">
                {save.isPending ? "Saving…" : "Save columns"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {shareSlug && shareCol && (
        <ColumnShareDialog
          slug={shareSlug}
          label={shareCol.label}
          shares={shareCol.shares ?? []}
          open={!!shareSlug}
          onOpenChange={(v) => { if (!v) setShareSlug(null); }}
        />
      )}
    </>
  );
}
