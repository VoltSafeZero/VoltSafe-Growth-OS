import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CalendarDays, ListChecks, MessageSquare, Lock, User as UserIcon, Check,
  Search, Filter, Bookmark, BookmarkPlus, Save, Trash2, X, ChevronDown,
} from "lucide-react";
import { format, isToday, isPast } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const COLUMN_DEFS = [
  { value: "backlog", label: "Backlog", color: "border-slate-300 dark:border-slate-700" },
  { value: "todo", label: "To do", color: "border-blue-300 dark:border-blue-800" },
  { value: "in_progress", label: "In progress", color: "border-violet-300 dark:border-violet-800" },
  { value: "blocked", label: "Blocked", color: "border-amber-300 dark:border-amber-800" },
  { value: "done", label: "Done", color: "border-emerald-300 dark:border-emerald-800" },
] as const;

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-blue-400",
  low: "bg-slate-400",
};

const LABEL_BAR: Record<string, string> = {
  red: "bg-red-500", blue: "bg-blue-500", emerald: "bg-emerald-500",
  violet: "bg-violet-500", amber: "bg-amber-500", rose: "bg-rose-500",
  teal: "bg-teal-500", slate: "bg-slate-500",
};

type Filters = {
  search?: string;
  ownerId?: number | "me" | "unassigned" | null;
  labelIds?: number[];
  priority?: string | null;
};

type SavedView = {
  id: number;
  name: string;
  filters: Filters;
  isDefault: boolean;
};

type Props = {
  view: "my" | "team";
  onOpenTask: (id: number) => void;
};

export function TaskBoard({ view, onOpenTask }: Props) {
  const { toast } = useToast();
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [newViewDefault, setNewViewDefault] = useState(false);

  const { data: me } = useQuery<{ id: number }>({
    queryKey: ["/api/auth/me"],
    queryFn: () => fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()),
  });

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/tasks/board", view],
    queryFn: () => fetch(`/api/tasks/board?view=${view}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: users = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/users"],
    queryFn: () => fetch("/api/users", { credentials: "include" }).then(r => r.json()),
  });

  const { data: labels = [] } = useQuery<{ id: number; name: string; color: string }[]>({
    queryKey: ["/api/task-labels"],
    queryFn: () => fetch("/api/task-labels", { credentials: "include" }).then(r => r.json()),
  });

  const { data: savedViews = [] } = useQuery<SavedView[]>({
    queryKey: ["/api/task-board-views"],
    queryFn: () => fetch("/api/task-board-views", { credentials: "include" }).then(r => r.json()),
  });

  // On first load, apply default saved view if any
  useEffect(() => {
    if (activeViewId !== null) return;
    const def = savedViews.find(v => v.isDefault);
    if (def) {
      setActiveViewId(def.id);
      setFilters(def.filters || {});
    }
  }, [savedViews, activeViewId]);

  const grouped = data?.grouped || { backlog: [], todo: [], in_progress: [], blocked: [], done: [] };

  // Apply filters client-side
  const filteredGrouped = useMemo(() => {
    const out: Record<string, any[]> = { backlog: [], todo: [], in_progress: [], blocked: [], done: [] };
    const q = (filters.search || "").trim().toLowerCase();
    const labelSet = new Set(filters.labelIds || []);
    for (const col of Object.keys(grouped)) {
      out[col] = grouped[col].filter((t: any) => {
        if (q) {
          const hay = `${t.title || ""} ${t.description || ""} ${t.accountName || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (filters.ownerId === "me" && me?.id && t.ownerUserId !== me.id) return false;
        if (filters.ownerId === "unassigned" && t.ownerUserId != null) return false;
        if (typeof filters.ownerId === "number" && t.ownerUserId !== filters.ownerId) return false;
        if (filters.priority && t.priority !== filters.priority) return false;
        if (labelSet.size > 0) {
          const tlabels: number[] = (t.labels || []).map((l: any) => l.id);
          if (!tlabels.some(id => labelSet.has(id))) return false;
        }
        return true;
      });
    }
    return out;
  }, [grouped, filters, me]);

  const filterCount =
    (filters.search ? 1 : 0) +
    (filters.ownerId != null ? 1 : 0) +
    (filters.labelIds?.length ? 1 : 0) +
    (filters.priority ? 1 : 0);

  const activeView = savedViews.find(v => v.id === activeViewId);

  const handleDrop = async (col: string) => {
    if (draggingId == null) return;
    const id = draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    queryClient.setQueryData(["/api/tasks/board", view], (old: any) => {
      if (!old) return old;
      const next: any = { ...old, grouped: { ...old.grouped } };
      let moved: any = null;
      for (const c of Object.keys(next.grouped)) {
        const idx = next.grouped[c].findIndex((t: any) => t.id === id);
        if (idx >= 0) {
          moved = next.grouped[c][idx];
          next.grouped[c] = [...next.grouped[c].slice(0, idx), ...next.grouped[c].slice(idx + 1)];
        }
      }
      if (moved) {
        moved = { ...moved, boardColumn: col };
        next.grouped[col] = [moved, ...(next.grouped[col] || [])];
      }
      return next;
    });
    try {
      await apiRequest("PATCH", `/api/tasks/${id}/board`, { boardColumn: col, sortOrder: 0 });
    } catch (err: any) {
      toast({ title: "Move failed", description: err.message || "Try again", variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
    }
  };

  const saveViewMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/task-board-views", {
      name: newViewName.trim(),
      filters,
      isDefault: newViewDefault,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-board-views"] });
      toast({ title: "View saved", description: newViewName });
      setSaveOpen(false);
      setNewViewName("");
      setNewViewDefault(false);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteViewMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/task-board-views/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-board-views"] });
      toast({ title: "View deleted" });
      setActiveViewId(null);
    },
  });

  const setDefaultMut = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/task-board-views/${id}`, { isDefault: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-board-views"] });
      toast({ title: "Default view updated" });
    },
  });

  const applyView = (v: SavedView) => {
    setActiveViewId(v.id);
    setFilters(v.filters || {});
  };

  const clearFilters = () => {
    setFilters({});
    setActiveViewId(null);
  };

  const updateFilter = (patch: Partial<Filters>) => {
    setFilters(f => ({ ...f, ...patch }));
    setActiveViewId(null); // mark filters as dirty (no longer matching the saved view)
  };

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={filters.search || ""}
            onChange={(e) => updateFilter({ search: e.target.value })}
            placeholder="Search tasks…"
            className="pl-7 h-8 text-xs"
            data-testid="board-search"
          />
        </div>

        <Select
          value={filters.ownerId == null ? "all" : String(filters.ownerId)}
          onValueChange={(v) => updateFilter({
            ownerId: v === "all" ? null : v === "me" ? "me" : v === "unassigned" ? "unassigned" : Number(v),
          })}
        >
          <SelectTrigger className="h-8 text-xs w-[140px]" data-testid="board-filter-owner">
            <UserIcon className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Anyone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Anyone</SelectItem>
            <SelectItem value="me">Just me</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {users.map(u => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.priority || "all"}
          onValueChange={(v) => updateFilter({ priority: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-8 text-xs w-[120px]" data-testid="board-filter-priority">
            <SelectValue placeholder="Any priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any priority</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" data-testid="board-filter-labels">
              <Filter className="h-3 w-3" />
              Labels
              {filters.labelIds?.length ? <Badge className="h-4 px-1 text-[10px]">{filters.labelIds.length}</Badge> : null}
              <ChevronDown className="h-3 w-3 ml-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs">Filter by label</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {labels.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">No labels yet</div>}
            {labels.map(l => {
              const checked = (filters.labelIds || []).includes(l.id);
              return (
                <DropdownMenuItem
                  key={l.id}
                  onSelect={(e) => {
                    e.preventDefault();
                    const set = new Set(filters.labelIds || []);
                    checked ? set.delete(l.id) : set.add(l.id);
                    updateFilter({ labelIds: Array.from(set) });
                  }}
                  className="text-xs gap-2"
                >
                  <span className={`h-3 w-3 rounded ${LABEL_BAR[l.color] || LABEL_BAR.slate}`} />
                  <span className="flex-1">{l.name}</span>
                  {checked && <Check className="h-3 w-3" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {filterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={clearFilters} data-testid="board-clear-filters">
            <X className="h-3 w-3" /> Clear
          </Button>
        )}

        {/* Saved views */}
        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" data-testid="board-saved-views">
              <Bookmark className="h-3 w-3" />
              {activeView ? activeView.name : "Saved views"}
              <ChevronDown className="h-3 w-3 ml-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="text-xs">Your saved views</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {savedViews.length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">No saved views yet</div>
            )}
            {savedViews.map(v => (
              <div key={v.id} className="flex items-center px-1 group">
                <button
                  className={`flex-1 text-left px-2 py-1.5 text-xs rounded hover:bg-secondary ${activeViewId === v.id ? "font-semibold text-primary" : ""}`}
                  onClick={() => applyView(v)}
                  data-testid={`board-view-${v.id}`}
                >
                  {v.name}
                  {v.isDefault && <span className="ml-1 text-[10px] text-muted-foreground">(default)</span>}
                </button>
                {!v.isDefault && (
                  <button
                    className="opacity-0 group-hover:opacity-100 px-1 text-[10px] text-muted-foreground hover:text-primary"
                    onClick={() => setDefaultMut.mutate(v.id)}
                    title="Make default"
                  >
                    ★
                  </button>
                )}
                <button
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-500"
                  onClick={() => deleteViewMut.mutate(v.id)}
                  title="Delete"
                  data-testid={`board-view-delete-${v.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSaveOpen(true)} className="text-xs gap-2" data-testid="board-save-view">
              <BookmarkPlus className="h-3 w-3" />
              Save current filters as view
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMN_DEFS.map(c => (
            <div key={c.value} className="w-72 flex-shrink-0 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" data-testid="board-container">
          {COLUMN_DEFS.map(col => {
            const cards: any[] = filteredGrouped[col.value] || [];
            const isOver = dragOverCol === col.value;
            return (
              <div
                key={col.value}
                className={`w-72 flex-shrink-0 flex flex-col rounded-lg border-2 ${col.color} bg-muted/40 transition-colors ${isOver ? "bg-muted/80 ring-2 ring-primary" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.value); }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={() => handleDrop(col.value)}
                data-testid={`column-${col.value}`}
              >
                <div className="px-3 py-2 flex items-center justify-between border-b border-inherit">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{col.label}</div>
                  <Badge variant="secondary" className="h-5 text-xs">{cards.length}</Badge>
                </div>
                <div className="flex-1 p-2 space-y-2 max-h-[calc(100vh-340px)] overflow-y-auto">
                  {cards.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic text-center py-6">
                      {filterCount > 0 ? "No matches" : "Drop tasks here"}
                    </div>
                  ) : (
                    cards.map((t: any) => (
                      <BoardCard
                        key={t.id}
                        task={t}
                        onOpen={() => onOpenTask(t.id)}
                        onDragStart={() => setDraggingId(t.id)}
                        onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Save className="h-4 w-4" /> Save board view</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">View name</Label>
              <Input
                value={newViewName}
                onChange={e => setNewViewName(e.target.value)}
                placeholder="e.g. My urgent tasks this week"
                className="mt-1 h-8 text-xs"
                autoFocus
                data-testid="input-view-name"
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Checkbox id="default-view" checked={newViewDefault} onCheckedChange={(v) => setNewViewDefault(!!v)} />
              <Label htmlFor="default-view" className="cursor-pointer">Make this my default view</Label>
            </div>
            <div className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2">
              Saving filters: {filterCount === 0 ? "no filters (everything)" : (
                <span>
                  {filters.search && <span>search "{filters.search}" · </span>}
                  {filters.ownerId != null && <span>owner · </span>}
                  {filters.priority && <span>{filters.priority} priority · </span>}
                  {filters.labelIds?.length ? <span>{filters.labelIds.length} label(s)</span> : null}
                </span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!newViewName.trim() || saveViewMut.isPending} onClick={() => saveViewMut.mutate()} data-testid="button-save-view">
              {saveViewMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoardCard({ task, onOpen, onDragStart, onDragEnd }: any) {
  const isDone = task.status === "completed" || task.boardColumn === "done";
  const isBlocked = task.openDependencies > 0 && !isDone;
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const isOverdue = due && !isDone && isPast(due) && !isToday(due);
  const isDueToday = due && !isDone && isToday(due);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`group relative bg-card border rounded-md p-2.5 cursor-pointer hover:shadow-md transition-all space-y-1.5 ${isBlocked ? "ring-1 ring-amber-400/50" : ""} ${isDone ? "opacity-70" : ""}`}
      data-testid={`card-task-${task.id}`}
    >
      {task.labels?.length > 0 && (
        <div className="flex gap-1 mb-1.5">
          {task.labels.map((l: any) => (
            <div
              key={l.id}
              title={l.name}
              className={`h-1.5 w-8 rounded-full ${LABEL_BAR[l.color] || LABEL_BAR.slate}`}
            />
          ))}
        </div>
      )}

      <div className="flex items-start gap-1.5">
        <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority] || PRIORITY_DOT.medium}`} />
        <h4 className={`text-sm font-medium leading-snug flex-1 ${isDone ? "line-through" : ""}`} data-testid={`text-title-${task.id}`}>
          {task.title}
        </h4>
      </div>

      {(task.accountName || task.linkedObjectType) && (
        <div className="text-xs text-muted-foreground truncate">
          {task.accountName || `${task.linkedObjectType} #${task.linkedObjectId}`}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {isBlocked && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 font-medium" data-testid={`badge-blocked-${task.id}`}>
            <Lock className="h-3 w-3" /> {task.openDependencies}
          </span>
        )}
        {due && (
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${isOverdue ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" : isDueToday ? "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300" : "bg-muted"}`}
            data-testid={`badge-due-${task.id}`}
          >
            <CalendarDays className="h-3 w-3" /> {format(due, "MMM d")}
          </span>
        )}
        {task.checklistTotal > 0 && (
          <span className={`inline-flex items-center gap-1 ${task.checklistDone === task.checklistTotal ? "text-emerald-600" : ""}`}>
            <ListChecks className="h-3 w-3" /> {task.checklistDone}/{task.checklistTotal}
          </span>
        )}
        {task.commentsCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> {task.commentsCount}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-xs pt-1 border-t mt-1.5">
        <div className="flex items-center gap-1 text-muted-foreground min-w-0">
          <UserIcon className="h-3 w-3 flex-shrink-0" />
          <span className="truncate" title={`Assigned to ${task.ownerName || "—"}`}>
            {task.ownerName || <span className="italic">Unassigned</span>}
          </span>
        </div>
        {isDone && task.completedByName ? (
          <span className="inline-flex items-center gap-0.5 text-emerald-600" title={`Completed by ${task.completedByName}`}>
            <Check className="h-3 w-3" /> {task.completedByName.split(" ")[0]}
          </span>
        ) : task.creatorName && task.creatorName !== task.ownerName ? (
          <span className="text-muted-foreground/70 italic" title={`Created by ${task.creatorName}`}>
            by {task.creatorName.split(" ")[0]}
          </span>
        ) : null}
      </div>
    </div>
  );
}
