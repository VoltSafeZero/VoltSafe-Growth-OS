import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  CheckCircle2, Circle, Clock, AlertTriangle, ChevronDown, ChevronRight,
  CalendarDays, Flag, User2, Link2, MoreHorizontal, Plus, Search,
  SlidersHorizontal, ListTodo, CheckSquare, Users, RefreshCcw, Bell, LayoutGrid,
  Building2, ArrowRight, Zap, Sparkles, ThumbsDown, Settings2, Trash2, RotateCcw,
} from "lucide-react";
import { BulkActionsBar, BulkCheckbox } from "@/components/bulk-actions-bar";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer";
import { Calendar } from "@/components/ui/calendar";

type HubTask = {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  reminderAt: string | null;
  snoozedUntil: string | null;
  linkedObjectType: string | null;
  linkedObjectId: number | null;
  accountId: number | null;
  aiSuggested: boolean;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  ownerUserId: number | null;
  ownerName: string | null;
  accountName: string | null;
};

type HubResponse = {
  tasks: HubTask[];
  groups: Record<string, HubTask[]>;
  counts: {
    my_count: number;
    team_count: number;
    today_count: number;
    overdue_count: number;
    upcoming_count: number;
    assigned_by_me_count: number;
  };
  view: string;
  groupBy: string;
  total: number;
};

type ViewTab = "board" | "my" | "team" | "today" | "overdue" | "upcoming" | "completed" | "suggestions" | "archived" | "assigned_by_me";
type GroupBy = "due_date" | "priority" | "linked_record" | "assignee";

const VIEW_LABELS: Record<ViewTab, string> = {
  board: "Board",
  my: "My Tasks",
  team: "Team Tasks",
  today: "Due Today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  completed: "Completed",
  suggestions: "Suggestions",
  archived: "Archived",
  assigned_by_me: "Delegated",
};

const VIEW_ICONS: Record<ViewTab, React.ElementType> = {
  board: LayoutGrid,
  my: ListTodo,
  team: Users,
  today: CalendarDays,
  overdue: AlertTriangle,
  upcoming: Clock,
  completed: CheckCircle2,
  suggestions: Sparkles,
  archived: Trash2,
  assigned_by_me: ArrowRight,
};

const GROUP_LABELS: Record<GroupBy, string> = {
  due_date: "Due Date",
  priority: "Priority",
  linked_record: "Linked Record",
  assignee: "Assignee",
};

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400 border-red-500/40 bg-red-500/10",
  medium: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  low: "text-slate-400 border-slate-500/40 bg-slate-500/10",
};
const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-slate-400",
};

const GROUP_ORDER: Record<string, number> = {
  Overdue: 0, Today: 1, Tomorrow: 2, "This week": 3, Later: 4, "No due date": 5,
  high: 0, medium: 1, low: 2,
};

function formatDate(d: string | null, compact = false): string {
  if (!d) return "—";
  const date = new Date(d);
  if (compact) {
    return date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}

function isOverdue(d: string | null): boolean {
  if (!d) return false;
  return new Date(d) < new Date();
}

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  const diff = new Date(d).getTime() - new Date().setHours(0,0,0,0);
  return Math.round(diff / 86400000);
}

const SNOOZE_PRESETS = [
  { label: "Later today", preset: "later_today" },
  { label: "Tomorrow morning", preset: "tomorrow_morning" },
  { label: "Next week", preset: "next_week" },
];

function SnoozeMenu({ taskId, onSnooze }: { taskId: number; onSnooze: (preset: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground" data-testid={`button-snooze-${taskId}`}>
          <Bell className="h-3 w-3" />
          Snooze
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {SNOOZE_PRESETS.map(p => (
          <DropdownMenuItem key={p.preset} onClick={() => onSnooze(p.preset)} className="text-xs">
            {p.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReassignMenu({ taskId, currentOwnerName, users, onReassign }: {
  taskId: number;
  currentOwnerName: string | null;
  users: { id: number; name: string }[];
  onReassign: (userId: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground" data-testid={`button-reassign-${taskId}`}>
          <User2 className="h-3 w-3" />
          {currentOwnerName ?? "Assign"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {users.map(u => (
          <DropdownMenuItem key={u.id} onClick={() => onReassign(u.id)} className="text-xs">
            {u.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DueDatePicker({ taskId, currentDate, onSave }: {
  taskId: number;
  currentDate: string | null;
  onSave: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dateVal = currentDate ? currentDate.split("T")[0] : "";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground" data-testid={`button-duedate-${taskId}`}>
          <CalendarDays className="h-3 w-3" />
          {currentDate ? formatDate(currentDate, true) : "Set date"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={dateVal ? new Date(dateVal + "T00:00:00") : undefined}
          onSelect={(d) => {
            if (d) {
              const yyyy = d.getFullYear();
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const dd = String(d.getDate()).padStart(2, "0");
              onSave(`${yyyy}-${mm}-${dd}`);
              setOpen(false);
            }
          }}
          initialFocus
          data-testid={`input-duedate-${taskId}`}
        />
      </PopoverContent>
    </Popover>
  );
}

function TaskRow({
  task,
  users,
  onComplete,
  onSnooze,
  onReassign,
  onDueDate,
  onNavigate,
  isSelected,
  onToggleSelect,
}: {
  task: HubTask;
  users: { id: number; name: string }[];
  onComplete: () => void;
  onSnooze: (preset: string) => void;
  onReassign: (userId: number) => void;
  onDueDate: (date: string) => void;
  onNavigate: (href: string) => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const overdue = isOverdue(task.dueDate) && task.status !== "done";
  const days = daysUntil(task.dueDate);
  const isDone = task.status === "done" || task.status === "completed";

  const linkedHref = task.linkedObjectType === "account" && task.linkedObjectId
    ? `/accounts/${task.linkedObjectId}`
    : task.linkedObjectType === "contact" && task.linkedObjectId
      ? `/contacts/${task.linkedObjectId}`
      : task.linkedObjectType === "opportunity" && task.linkedObjectId
        ? `/opportunities/${task.linkedObjectId}`
        : task.accountId
          ? `/accounts/${task.accountId}`
          : null;

  return (
    <div
      className={`group flex items-start gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors border-b border-border/20 last:border-0 ${isDone ? "opacity-50" : ""} ${overdue && !isDone ? "bg-red-950/10" : ""} ${isSelected ? "bg-primary/5" : ""}`}
      data-testid={`task-row-${task.id}`}
    >
      {/* Bulk checkbox */}
      {onToggleSelect && (
        <div className="mt-0.5 shrink-0" onClick={e => { e.stopPropagation(); onToggleSelect(); }}>
          <BulkCheckbox checked={!!isSelected} onChange={onToggleSelect} testId={`checkbox-task-${task.id}`} />
        </div>
      )}

      {/* Complete toggle */}
      <button
        onClick={onComplete}
        className={`mt-0.5 shrink-0 transition-colors ${isDone ? "text-primary" : "text-muted-foreground/40 hover:text-primary"}`}
        data-testid={`button-complete-${task.id}`}
      >
        {isDone ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <span className={`text-sm font-medium leading-tight ${isDone ? "line-through text-muted-foreground" : ""}`}>
            {task.title}
          </span>
          {task.aiSuggested && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 border-primary/30 text-primary/70">
              <Zap className="h-2.5 w-2.5 mr-0.5" />AI
            </Badge>
          )}
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap mt-1.5">
          {/* Priority dot */}
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] ?? "bg-muted"}`} />

          {/* Due date */}
          {task.dueDate && (
            <span className={`text-[11px] font-medium ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
              {overdue ? `${Math.abs(days ?? 0)}d overdue` : days === 0 ? "Today" : days === 1 ? "Tomorrow" : formatDate(task.dueDate, true)}
            </span>
          )}

          {/* Account link */}
          {(task.accountName || linkedHref) && (
            <button
              onClick={() => linkedHref && onNavigate(linkedHref)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
              data-testid={`link-record-${task.id}`}
            >
              <Building2 className="h-3 w-3" />
              {task.accountName ?? `${task.linkedObjectType} #${task.linkedObjectId}`}
              <ArrowRight className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}

          {/* Owner (team view) */}
          {task.ownerName && (
            <span className="text-[11px] text-muted-foreground/60">
              <User2 className="inline h-2.5 w-2.5 mr-0.5" />
              {task.ownerName}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
        {!isDone && (
          <>
            <SnoozeMenu taskId={task.id} onSnooze={onSnooze} />
            <ReassignMenu taskId={task.id} currentOwnerName={task.ownerName} users={users} onReassign={onReassign} />
            <DueDatePicker taskId={task.id} currentDate={task.dueDate} onSave={onDueDate} />
          </>
        )}
      </div>
    </div>
  );
}

function GroupSection({
  label,
  tasks,
  users,
  defaultOpen,
  onComplete,
  onSnooze,
  onReassign,
  onDueDate,
  onNavigate,
  selectedIds,
  onToggleSelect,
}: {
  label: string;
  tasks: HubTask[];
  users: { id: number; name: string }[];
  defaultOpen?: boolean;
  onComplete: (id: number) => void;
  onSnooze: (id: number, preset: string) => void;
  onReassign: (id: number, userId: number) => void;
  onDueDate: (id: number, date: string) => void;
  onNavigate: (href: string) => void;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const isOverdueGroup = label === "Overdue";

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-secondary/20 ${isOverdueGroup ? "text-red-400" : "text-muted-foreground"}`}
        data-testid={`group-header-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {isOverdueGroup && <AlertTriangle className="h-3 w-3" />}
        {label}
        <span className="ml-auto font-normal normal-case tracking-normal opacity-60">{tasks.length}</span>
      </button>
      {open && (
        <div>
          {tasks.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              users={users}
              onComplete={() => onComplete(t.id)}
              onSnooze={(preset) => onSnooze(t.id, preset)}
              onReassign={(userId) => onReassign(t.id, userId)}
              onDueDate={(date) => onDueDate(t.id, date)}
              onNavigate={onNavigate}
              isSelected={selectedIds?.has(t.id)}
              onToggleSelect={onToggleSelect ? () => onToggleSelect(t.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type GlobalSuggestion = {
  id: number;
  objectType: string;
  objectId: number;
  signalType: string;
  severity: "low" | "medium" | "high";
  title: string;
  reason: string;
  suggestedActionType: string;
  suggestedActionLabel: string;
  priority: "low" | "medium" | "high";
  suggestedDueDate: string | null;
  status: string;
  sourceLabel: string;
  confidence: number;
  suggestedAssigneeId: number | null;
  accountName: string | null;
  objectLabel: string | null;
};

const SEVERITY_BADGE: Record<string, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

const CONFIDENCE_COLOR = (c: number) =>
  c >= 80 ? "text-green-400" : c >= 60 ? "text-amber-400" : "text-muted-foreground";

function SuggestionCard({
  s,
  onAccept,
  onDismiss,
  onSnooze,
}: {
  s: GlobalSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
  onSnooze: (days: number) => void;
}) {
  const [, navigate] = useLocation();
  const linkedHref = s.objectType === "account" ? `/accounts/${s.objectId}`
    : s.objectType === "opportunity" ? `/opportunities/${s.objectId}`
    : s.objectType === "lead" ? `/leads/${s.objectId}`
    : s.objectType === "contact" ? `/contacts/${s.objectId}`
    : null;

  return (
    <div
      className="rounded-lg border border-border/40 bg-card/50 p-4 hover:border-border/70 transition-all"
      data-testid={`suggestion-card-${s.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <Sparkles className="h-4 w-4 text-primary/60" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Title + badges */}
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-sm font-semibold leading-tight">{s.title}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 h-4 font-medium ${SEVERITY_BADGE[s.severity]}`}
              data-testid={`badge-severity-${s.id}`}
            >
              {s.severity}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 border-primary/30 text-primary/70"
              data-testid={`badge-source-${s.id}`}
            >
              {s.sourceLabel}
            </Badge>
            <span
              className={`text-[10px] font-medium ${CONFIDENCE_COLOR(s.confidence)}`}
              data-testid={`text-confidence-${s.id}`}
            >
              {s.confidence}% confidence
            </span>
          </div>

          {/* Reason */}
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{s.reason}</p>

          {/* Linked record */}
          {(s.accountName || s.objectLabel) && (
            <div className="flex items-center gap-1 mt-2">
              <Building2 className="h-3 w-3 text-muted-foreground/60" />
              <button
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => linkedHref && navigate(linkedHref)}
                data-testid={`link-record-${s.id}`}
              >
                {s.objectLabel ?? s.accountName}
                {s.accountName && s.objectLabel && s.objectLabel !== s.accountName && (
                  <span className="text-muted-foreground/50"> · {s.accountName}</span>
                )}
              </button>
            </div>
          )}

          {/* Due date */}
          {s.suggestedDueDate && (
            <div className="flex items-center gap-1 mt-1">
              <CalendarDays className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-[11px] text-muted-foreground">
                Suggested due: {new Date(s.suggestedDueDate).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={onAccept}
              data-testid={`button-accept-${s.id}`}
            >
              <CheckCircle2 className="h-3 w-3" />
              Accept — create task
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1 border-border/50" data-testid={`button-snooze-sugg-${s.id}`}>
                  <Bell className="h-3 w-3" />
                  Snooze
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuItem className="text-xs" onClick={() => onSnooze(1)}>Later today</DropdownMenuItem>
                <DropdownMenuItem className="text-xs" onClick={() => onSnooze(1)}>Tomorrow</DropdownMenuItem>
                <DropdownMenuItem className="text-xs" onClick={() => onSnooze(7)}>Next week</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={onDismiss}
              data-testid={`button-dismiss-${s.id}`}
            >
              <ThumbsDown className="h-3 w-3" />
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ view }: { view: ViewTab }) {
  const messages: Record<ViewTab, { title: string; sub: string }> = {
    board: { title: "No tasks", sub: "Create a task to get started." },
    my: { title: "No open tasks", sub: "You're all caught up. Create a task to track follow-ups." },
    team: { title: "No team tasks", sub: "No open tasks across the team right now." },
    today: { title: "Nothing due today", sub: "Clear schedule — enjoy it while it lasts." },
    overdue: { title: "No overdue tasks", sub: "Great work staying on top of your task list!" },
    upcoming: { title: "Nothing coming up", sub: "No tasks due in the next 7 days." },
    completed: { title: "No completed tasks", sub: "Tasks you complete will appear here." },
    suggestions: { title: "No suggestions right now", sub: "All CRM records look healthy. Check back later." },
    archived: { title: "No archived tasks", sub: "Archived tasks will appear here." },
    assigned_by_me: { title: "No delegated tasks", sub: "Tasks you assign to other users will appear here so you can track their completion." },
  };
  const m = messages[view];
  const Icon = VIEW_ICONS[view];
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6" data-testid="empty-state">
      <div className="w-12 h-12 rounded-xl bg-muted/30 flex items-center justify-center mb-3">
        <Icon className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <p className="font-medium text-sm">{m.title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">{m.sub}</p>
    </div>
  );
}

export default function TasksHubPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewTab>("board");
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  // Allow any list-row component to request the drawer via a window event
  useEffect(() => {
    const handler = (e: any) => {
      const id = Number(e?.detail?.taskId);
      if (Number.isFinite(id)) setOpenTaskId(id);
    };
    window.addEventListener("open-task-drawer", handler as EventListener);
    return () => window.removeEventListener("open-task-drawer", handler as EventListener);
  }, []);
  const [groupBy, setGroupBy] = useState<GroupBy>("due_date");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const toggleSelect = (id: number) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT","TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const { data, isLoading } = useQuery<HubResponse>({
    queryKey: ["/api/tasks/hub", view, groupBy],
    queryFn: () =>
      fetch(`/api/tasks/hub?view=${view}&groupBy=${groupBy}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30_000,
    enabled: view !== "board" && view !== "suggestions" && view !== "archived",
  });

  const { data: usersData = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/users"],
    queryFn: () => fetch("/api/users", { credentials: "include" }).then(r => r.json()),
  });

  const { data: suggestionsData, isLoading: suggestionsLoading } = useQuery<{ suggestions: GlobalSuggestion[]; total: number }>({
    queryKey: ["/api/tasks/suggestions"],
    queryFn: () => fetch("/api/tasks/suggestions", { credentials: "include" }).then(r => r.json()),
    enabled: view === "suggestions",
    staleTime: 30_000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
  }, [queryClient]);

  const acceptSuggMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/suggestions/${id}/accept`),
    onSuccess: () => {
      toast({ description: "Task created from suggestion" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
    },
    onError: () => toast({ variant: "destructive", description: "Failed to accept suggestion" }),
  });

  const dismissSuggMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/suggestions/${id}/dismiss`),
    onSuccess: () => {
      toast({ description: "Suggestion dismissed for 7 days" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/suggestions"] });
    },
    onError: () => toast({ variant: "destructive", description: "Failed to dismiss suggestion" }),
  });

  const snoozeSuggMut = useMutation({
    mutationFn: ({ id, days }: { id: number; days: number }) =>
      apiRequest("POST", `/api/tasks/suggestions/${id}/snooze`, { days }),
    onSuccess: () => {
      toast({ description: "Suggestion snoozed" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/suggestions"] });
    },
    onError: () => toast({ variant: "destructive", description: "Failed to snooze suggestion" }),
  });

  const completeMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/${id}/complete`),
    onSuccess: () => { toast({ description: "Task completed" }); invalidate(); },
  });

  const reopenMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/${id}/reopen`),
    onSuccess: () => { toast({ description: "Task reopened" }); invalidate(); },
    onError: () => toast({ variant: "destructive", description: "Failed to reopen task" }),
  });

  const toggleComplete = (task: HubTask) => {
    const isDone = task.status === "done" || task.status === "completed";
    if (isDone) reopenMut.mutate(task.id);
    else completeMut.mutate(task.id);
  };

  const snoozeMut = useMutation({
    mutationFn: ({ id, preset }: { id: number; preset: string }) =>
      apiRequest("POST", `/api/tasks/${id}/snooze`, { preset }),
    onSuccess: () => { toast({ description: "Task snoozed" }); invalidate(); },
  });

  const reassignMut = useMutation({
    mutationFn: ({ id, ownerUserId }: { id: number; ownerUserId: number }) =>
      apiRequest("POST", `/api/tasks/${id}/reassign`, { ownerUserId }),
    onSuccess: () => { toast({ description: "Task reassigned" }); invalidate(); },
  });

  const dueDateMut = useMutation({
    mutationFn: ({ id, dueDate }: { id: number; dueDate: string }) =>
      apiRequest("PUT", `/api/tasks/${id}`, { dueDate: new Date(dueDate).toISOString() }),
    onSuccess: () => { toast({ description: "Due date updated" }); invalidate(); },
  });

  const bulkPriorityMut = useMutation({
    mutationFn: async (priority: string) => {
      const res = await apiRequest("POST", "/api/tasks/bulk/priority", { taskIds: Array.from(selectedIds), priority });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (d: any) => { setSelectedIds(new Set()); toast({ description: `Updated priority for ${d.updated} tasks` }); invalidate(); },
    onError: () => toast({ variant: "destructive", description: "Failed to update priority" }),
  });

  const openCapture = () => {
    setCreatingNew(true);
  };

  const counts = data?.counts;
  const allTasks = data?.tasks ?? [];

  // Apply search filter client-side
  const filtered = search
    ? allTasks.filter(t =>
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        (t.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (t.accountName ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : allTasks;

  // Re-group filtered tasks
  const groups = data?.groups ?? {};
  const filteredGroups: Record<string, HubTask[]> = {};
  if (search) {
    for (const t of filtered) {
      let key = "Results";
      filteredGroups[key] = filteredGroups[key] ?? [];
      filteredGroups[key].push(t);
    }
  } else {
    Object.assign(filteredGroups, groups);
  }

  const sortedGroupKeys = Object.keys(filteredGroups).sort((a, b) => {
    const oa = GROUP_ORDER[a] ?? 99;
    const ob = GROUP_ORDER[b] ?? 99;
    return oa !== ob ? oa - ob : a.localeCompare(b);
  });

  const viewTabs: ViewTab[] = ["board", "my", "assigned_by_me", "team", "today", "overdue", "upcoming", "completed", "suggestions", "archived"];

  const suggestionsList = suggestionsData?.suggestions ?? [];

  const getCountBadge = (v: ViewTab): number | null => {
    if (!counts) return null;
    if (v === "my") return counts.my_count || null;
    if (v === "team") return counts.team_count || null;
    if (v === "today") return counts.today_count || null;
    if (v === "overdue") return counts.overdue_count || null;
    if (v === "upcoming") return counts.upcoming_count || null;
    if (v === "suggestions") return suggestionsData?.total || null;
    if (v === "assigned_by_me") return counts.assigned_by_me_count || null;
    return null;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-4 md:px-6 pt-2 pb-2">
          <div className="flex items-center justify-between gap-3">
            {/* Title + search grouped together on the left */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-shrink-0">
                <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 leading-none">
                  <CheckSquare className="h-5 w-5 text-primary flex-shrink-0" />
                  Tasks Hub
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5 pl-7">Your execution queue</p>
              </div>
              <div className="relative hidden sm:block">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchRef}
                  placeholder='Search tasks  "/"'
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 w-52 text-xs bg-secondary/30 border-border/50"
                  data-testid="input-task-search"
                />
              </div>
            </div>
            {/* Action buttons on the right */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1 border-border/50" data-testid="button-group-by">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Group:</span> {GROUP_LABELS[groupBy]}
                    <ChevronDown className="h-3 w-3 ml-0.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(Object.keys(GROUP_LABELS) as GroupBy[]).map(g => (
                    <DropdownMenuItem key={g} onClick={() => setGroupBy(g)} className={`text-xs ${groupBy === g ? "text-primary font-medium" : ""}`}>
                      {GROUP_LABELS[g]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" className="h-8 text-xs gap-1" onClick={openCapture} data-testid="button-new-task">
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New Task</span>
              </Button>
            </div>
          </div>
        </div>

        {/* View tabs */}
        <div className="px-4 md:px-6 flex gap-0.5 overflow-x-auto pb-px scrollbar-hide">
          {viewTabs.map(v => {
            const Icon = VIEW_ICONS[v];
            const count = getCountBadge(v);
            const isActive = view === v;
            return (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                } ${v === "overdue" && !isActive && (count ?? 0) > 0 ? "text-red-400" : ""}`}
                data-testid={`tab-${v}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {VIEW_LABELS[v]}
                {count != null && count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${
                    v === "overdue" ? "bg-red-500/15 text-red-400" : "bg-primary/15 text-primary"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body — pb-24 on mobile ensures the last task row isn't hidden under the FAB */}
      <div className="flex-1 overflow-y-auto pb-36 md:pb-24">
        {view === "board" ? (
          <div className="p-4 md:p-6">
            <TaskBoard view="team" onOpenTask={(id) => setOpenTaskId(id)} />
          </div>
        ) : view === "archived" ? (
          <ArchivedList onOpenTask={(id) => setOpenTaskId(id)} />
        ) : view === "suggestions" ? (
          suggestionsLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-36 w-full rounded-lg" />
              ))}
            </div>
          ) : suggestionsList.length === 0 ? (
            <EmptyState view="suggestions" />
          ) : (
            <div className="p-4 md:p-6 space-y-3 max-w-3xl mx-auto pb-8">
              <p className="text-xs text-muted-foreground">
                {suggestionsList.length} suggestion{suggestionsList.length !== 1 ? "s" : ""} generated from CRM signals.
                Accepting a suggestion creates a real task.
              </p>
              {suggestionsList.map(s => (
                <SuggestionCard
                  key={s.id}
                  s={s}
                  onAccept={() => acceptSuggMut.mutate(s.id)}
                  onDismiss={() => dismissSuggMut.mutate(s.id)}
                  onSnooze={(days) => snoozeSuggMut.mutate({ id: s.id, days })}
                />
              ))}
              <div className="flex justify-end pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1 text-muted-foreground"
                  onClick={() => navigate("/automation/tasks")}
                  data-testid="button-configure-rules"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Configure rules
                </Button>
              </div>
            </div>
          )
        ) : isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="h-4 w-4 rounded-full mt-0.5" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState view={view} />
        ) : (
          <div className="pb-8">
            {selectedIds.size > 0 && (
              <div className="px-4 pt-3">
                <BulkActionsBar
                  selectedCount={selectedIds.size}
                  totalCount={filtered.length}
                  onSelectAll={() => setSelectedIds(new Set(filtered.map(t => t.id)))}
                  onClearSelection={() => setSelectedIds(new Set())}
                  entityLabel="task"
                  actions={[
                    {
                      key: "priority-high",
                      label: "Set High Priority",
                      icon: <Flag className="h-3.5 w-3.5 text-red-400" />,
                      testId: "button-bulk-tasks-priority-high",
                      confirmText: (count) => `Set ${count} task${count !== 1 ? "s" : ""} to high priority`,
                      requiresPermission: true,
                      isPending: bulkPriorityMut.isPending,
                      onClick: async () => { await bulkPriorityMut.mutateAsync("high"); },
                    },
                    {
                      key: "priority-medium",
                      label: "Set Medium Priority",
                      icon: <Flag className="h-3.5 w-3.5 text-amber-400" />,
                      testId: "button-bulk-tasks-priority-medium",
                      confirmText: (count) => `Set ${count} task${count !== 1 ? "s" : ""} to medium priority`,
                      requiresPermission: true,
                      isPending: bulkPriorityMut.isPending,
                      onClick: async () => { await bulkPriorityMut.mutateAsync("medium"); },
                    },
                    {
                      key: "priority-low",
                      label: "Set Low Priority",
                      icon: <Flag className="h-3.5 w-3.5 text-muted-foreground" />,
                      testId: "button-bulk-tasks-priority-low",
                      confirmText: (count) => `Set ${count} task${count !== 1 ? "s" : ""} to low priority`,
                      requiresPermission: true,
                      isPending: bulkPriorityMut.isPending,
                      onClick: async () => { await bulkPriorityMut.mutateAsync("low"); },
                    },
                  ]}
                />
              </div>
            )}
            {sortedGroupKeys.map((key, idx) => {
              const groupTasks = filteredGroups[key] ?? [];
              if (!groupTasks.length) return null;
              return (
                <GroupSection
                  key={key}
                  label={key}
                  tasks={groupTasks}
                  users={usersData}
                  defaultOpen={idx < 4}
                  onComplete={(id) => {
                    const task = groupTasks.find(t => t.id === id);
                    if (task) toggleComplete(task);
                    else completeMut.mutate(id);
                  }}
                  onSnooze={(id, preset) => snoozeMut.mutate({ id, preset })}
                  onReassign={(id, userId) => reassignMut.mutate({ id, ownerUserId: userId })}
                  onDueDate={(id, date) => dueDateMut.mutate({ id, dueDate: date })}
                  onNavigate={(href) => navigate(href)}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                />
              );
            })}
            <p className="text-[11px] text-muted-foreground text-center mt-4 mb-2 opacity-50">
              {filtered.length} task{filtered.length !== 1 ? "s" : ""} · Press <kbd className="px-1 py-0.5 rounded border border-border/50 text-[10px]">/</kbd> to search
            </p>
          </div>
        )}
      </div>

      <TaskDetailDrawer
        taskId={openTaskId}
        createMode={creatingNew}
        onCreated={(id) => { setCreatingNew(false); setOpenTaskId(id); }}
        onOpenChange={(o) => { if (!o) { setOpenTaskId(null); setCreatingNew(false); } }}
        onTaskChanged={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
        }}
      />
    </div>
  );
}

function ArchivedList({ onOpenTask }: { onOpenTask: (id: number) => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<any[]>({
    queryKey: ["/api/tasks/archived"],
    queryFn: () => fetch("/api/tasks/archived", { credentials: "include" }).then(r => r.json()),
  });
  const restore = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/tasks/${id}`, { archived: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
      toast({ title: "Task restored" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-2">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }
  const list = data || [];
  if (list.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        <Trash2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
        No archived tasks.
      </div>
    );
  }
  return (
    <div className="p-4 md:p-6 space-y-2 max-w-4xl mx-auto" data-testid="archived-list">
      <p className="text-xs text-muted-foreground mb-3">
        {list.length} archived task{list.length !== 1 ? "s" : ""}. Click a task to view details, or restore it to bring it back to the board.
      </p>
      {list.map((t: any) => (
        <div
          key={t.id}
          className="flex items-center gap-3 rounded-md border border-border/50 bg-card px-3 py-2 hover:bg-secondary/30 transition-colors"
          data-testid={`archived-task-${t.id}`}
        >
          <button onClick={() => onOpenTask(t.id)} className="flex-1 text-left min-w-0">
            <div className="text-sm font-medium truncate">{t.title}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {t.account_name && <>{t.account_name} · </>}
              {t.priority} · archived {t.archived_at ? new Date(t.archived_at).toLocaleDateString() : ""}
              {t.archived_by_name && <> by {t.archived_by_name}</>}
            </div>
          </button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => restore.mutate(t.id)}
            disabled={restore.isPending}
            data-testid={`button-restore-${t.id}`}
          >
            <RotateCcw className="h-3 w-3" /> Restore
          </Button>
        </div>
      ))}
    </div>
  );
}
