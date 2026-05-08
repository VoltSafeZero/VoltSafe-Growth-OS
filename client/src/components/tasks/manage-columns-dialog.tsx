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
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const { columns } = useTaskColumns();

  const { data: me } = useQuery<{ id: number }>({
    queryKey: ["/api/auth/me"],
    queryFn: () => fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });

  const systemCols = columns.filter(c => c.isSystem);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [shareTarget, setShareTarget] = useState<{ slug: string; label: string; shares: ColumnShare[] } | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(
        columns
          .filter(c => !c.isSystem && c.isOwn)
          .map(c => ({ ...c, value: c.value.replace(USER_COL_PREFIX_RE, "") }))
      );
    }
  }, [open, columns]);

  const save = useMutation({
    mutationFn: async (cols: Draft[]) => {
      const payload = {
        columns: cols.map(({ _isNew, shares, isSystem, isOwn, ownerId, ...c }) => c),
      };
      return apiRequest("PUT", "/api/task-columns/user", payload);
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
    if (draft.length >= 16) {
      toast({ title: "Max 16 personal columns", variant: "destructive" });
      return;
    }
    setDraft(prev => [...prev, { value: `col_${Date.now()}`, label: "New column", color: "slate", _isNew: true }]);
  };

  const remove = (idx: number) => {
    setDraft(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLabel = (idx: number, label: string) => {
    setDraft(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      if (c._isNew) return { ...c, label, value: slugify(label) };
      return { ...c, label };
    }));
  };

  const updateField = (idx: number, patch: Partial<Draft>) => {
    setDraft(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };

  const removedExisting = columns
    .filter(c => !c.isSystem && c.isOwn)
    .filter(c => {
      const bare = c.value.replace(USER_COL_PREFIX_RE, "");
      return !draft.some(d => d.value === bare);
    })
    .map(c => c.label);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl" data-testid="dialog-manage-columns">
          <DialogHeader>
            <DialogTitle>Manage task board columns</DialogTitle>
            <DialogDescription>
              The 5 permanent columns are shared with your whole team. Add personal columns below — they're private to you unless you share them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
            {/* System columns — locked */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <Lock className="h-3 w-3" /> Permanent columns (visible to all team members)
              </p>
              <div className="space-y-1.5">
                {systemCols.map(c => {
                  const shareCount = (c.shares ?? []).length;
                  return (
                    <div
                      key={c.value}
                      className="flex items-center gap-2 p-2 rounded border border-border bg-muted/30"
                      data-testid={`row-system-column-${c.value}`}
                    >
                      <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className={`h-3 w-3 rounded-full shrink-0 ${columnSwatchClass(c.color)}`} aria-hidden />
                      <span className="flex-1 text-sm font-medium min-w-0 truncate">{c.label}</span>
                      <Button
                        size="icon"
                        variant={shareCount > 0 ? "secondary" : "ghost"}
                        className="h-8 w-8 relative shrink-0"
                        title={`Share this column${shareCount > 0 ? ` (${shareCount} user${shareCount === 1 ? "" : "s"})` : ""}`}
                        onClick={() => setShareTarget({ slug: c.value, label: c.label, shares: c.shares ?? [] })}
                        data-testid={`button-share-${c.value}`}
                      >
                        <Users className="h-3.5 w-3.5" />
                        {shareCount > 0 && (
                          <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">
                            {shareCount}
                          </span>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* User's personal columns — editable */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                My personal columns (private unless shared)
              </p>
              <div className="space-y-1.5">
                {draft.length === 0 && (
                  <div className="text-xs text-muted-foreground italic text-center py-4 border border-dashed rounded-md">
                    No personal columns yet — add one below
                  </div>
                )}
                {draft.map((c, i) => {
                  const fullSlug = me?.id ? `u${me.id}_${c.value}` : c.value;
                  const existingDef = columns.find(col => col.value === fullSlug);
                  const shareCount = (existingDef?.shares ?? []).length;
                  return (
                    <div
                      key={`${c.value}-${i}`}
                      className="flex items-center gap-2 p-2 rounded border border-border bg-card"
                      data-testid={`row-column-${c.value}`}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab" />
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
                      {!c._isNew && me?.id && (
                        <Button
                          size="icon"
                          variant={shareCount > 0 ? "secondary" : "ghost"}
                          className="h-8 w-8 relative shrink-0"
                          title={`Share with teammates${shareCount > 0 ? ` (${shareCount})` : ""}`}
                          onClick={() => setShareTarget({
                            slug: fullSlug,
                            label: c.label,
                            shares: existingDef?.shares ?? [],
                          })}
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
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)} disabled={i === 0} data-testid={`button-up-${c.value}`}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)} disabled={i === draft.length - 1} data-testid={`button-down-${c.value}`}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(i)} data-testid={`button-delete-${c.value}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={add} data-testid="button-add-column">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add column
            </Button>
            <span className="text-xs text-muted-foreground">{draft.length} personal {draft.length === 1 ? "column" : "columns"}</span>
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
            <Button onClick={() => save.mutate(draft)} disabled={save.isPending} data-testid="button-save-columns">
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
