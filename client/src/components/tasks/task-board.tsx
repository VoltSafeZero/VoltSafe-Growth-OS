import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, ListChecks, MessageSquare, Lock, AlertTriangle, User as UserIcon, Check } from "lucide-react";
import { format, isToday, isPast } from "date-fns";

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
  red: "bg-red-500",
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  teal: "bg-teal-500",
  slate: "bg-slate-500",
};

type Props = {
  view: "my" | "team";
  onOpenTask: (id: number) => void;
};

export function TaskBoard({ view, onOpenTask }: Props) {
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/tasks/board", view],
    queryFn: () => fetch(`/api/tasks/board?view=${view}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
  });

  const grouped = data?.grouped || { backlog: [], todo: [], in_progress: [], blocked: [], done: [] };

  const handleDrop = async (col: string) => {
    if (draggingId == null) return;
    const id = draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    // Optimistic update
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
    } finally {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
    }
  };

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMN_DEFS.map(c => (
          <div key={c.value} className="w-72 flex-shrink-0 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4" data-testid="board-container">
      {COLUMN_DEFS.map(col => {
        const cards: any[] = grouped[col.value] || [];
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
            <div className="flex-1 p-2 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
              {cards.length === 0 ? (
                <div className="text-xs text-muted-foreground italic text-center py-6">Drop tasks here</div>
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
      {/* Label color bars */}
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

      {/* Title */}
      <div className="flex items-start gap-1.5">
        <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority] || PRIORITY_DOT.medium}`} />
        <h4 className={`text-sm font-medium leading-snug flex-1 ${isDone ? "line-through" : ""}`} data-testid={`text-title-${task.id}`}>
          {task.title}
        </h4>
      </div>

      {/* Linked context */}
      {(task.accountName || task.linkedObjectType) && (
        <div className="text-xs text-muted-foreground truncate">
          {task.accountName || `${task.linkedObjectType} #${task.linkedObjectId}`}
        </div>
      )}

      {/* Status badges row */}
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

      {/* People row */}
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
