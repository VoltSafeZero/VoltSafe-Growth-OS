import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UniversalDrilldownSheet, type UniversalDrilldownConfig } from "@/components/shared/universal-drilldown-sheet";
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
  Eye, MousePointerClick,
} from "lucide-react";
import { BulkActionsBar, BulkCheckbox } from "@/components/bulk-actions-bar";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskFloatingNav, type FloatingTabKey } from "@/components/tasks/task-floating-nav";
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer";
import { Calendar } from "@/components/ui/calendar";
import { ChevronLeft, ChevronRight, CalendarDays as CalendarDaysIcon } from "lucide-react";

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
  leadName?: string | null;
  recurrenceRule?: string | null;
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

type TrackingSignal = { icon: "eye" | "click"; label: string } | null;
function parseTrackingSignal(title: string): { cleanTitle: string; signal: TrackingSignal } {
  const noReply = title.match(/^(.*?)\s*—\s*opened but no reply for (\d+) days?:\s*(.*)$/i);
  if (noReply) return { cleanTitle: `${noReply[1].trim()}: ${noReply[3].trim()}`, signal: { icon: "eye", label: `${noReply[2]}d` } };
  const multi = title.match(/^(.*?)\s*—\s*opened multiple times:\s*(.*)$/i);
  if (multi) return { cleanTitle: `${multi[1].trim()}: ${multi[2].trim()}`, signal: { icon: "eye", label: "×" } };
  const linkClick = title.match(/^(.*?)\s*—\s*link clicked in:\s*(.*)$/i);
  if (linkClick) return { cleanTitle: `${linkClick[1].trim()}: ${linkClick[2].trim()}`, signal: { icon: "click", label: "" } };
  const pricingClick = title.match(/^(High priority:.*?link clicked)\s*—\s*(.*)$/i);
  if (pricingClick) return { cleanTitle: `${pricingClick[1].trim()}: ${pricingClick[2].trim()}`, signal: { icon: "click", label: "" } };
  return { cleanTitle: title, signal: null };
}

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
  readOnly,
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
  readOnly?: boolean;
}) {
  const overdue = isOverdue(task.dueDate) && task.status !== "done";
  const days = daysUntil(task.dueDate);
  const isDone = task.status === "done" || task.status === "completed";
  const { cleanTitle, signal } = parseTrackingSignal(task.title);

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
            {cleanTitle}
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

          {/* Account / Lead link */}
          {(task.accountName || task.leadName || linkedHref) && (
            <button
              onClick={() => linkedHref && onNavigate(linkedHref)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
              data-testid={`link-record-${task.id}`}
            >
              <Building2 className="h-3 w-3" />
              {task.accountName ?? task.leadName ?? `${task.linkedObjectType} #${task.linkedObjectId}`}
              <ArrowRight className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}

          {/* Recurring indicator */}
          {task.recurrenceRule && task.recurrenceRule !== "none" && (
            <span className="flex items-center gap-0.5 text-[11px] text-primary/70" title={`Repeats ${task.recurrenceRule}`}>
              <RotateCcw className="h-3 w-3" />
            </span>
          )}

          {/* Owner + tracking signal badge */}
          {task.ownerName && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <User2 className="h-2.5 w-2.5" />
              {task.ownerName}
              {signal && (
                <span
                  className="inline-flex items-center gap-0.5 px-1 py-0 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20"
                  title={signal.icon === "eye" ? "Email opened" : "Link clicked"}
                >
                  {signal.icon === "eye"
                    ? <Eye className="h-2.5 w-2.5" />
                    : <MousePointerClick className="h-2.5 w-2.5" />}
                  {signal.label && <span className="text-[10px] font-medium">{signal.label}</span>}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      {!readOnly && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
          {!isDone && (
            <>
              <SnoozeMenu taskId={task.id} onSnooze={onSnooze} />
              <ReassignMenu taskId={task.id} currentOwnerName={task.ownerName} users={users} onReassign={onReassign} />
              <DueDatePicker taskId={task.id} currentDate={task.dueDate} onSave={onDueDate} />
            </>
          )}
        </div>
      )}
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
  readOnly,
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
  readOnly?: boolean;
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
              readOnly={readOnly}
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

type HubAccessEntry = {
  id: number;
  targetUserId: number;
  targetUserName: string;
  permissionLevel: "view" | "edit";
};

export default function TasksHubPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewTab>("board");
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [defaultBoardColumn, setDefaultBoardColumn] = useState<string | undefined>(undefined);
  const [viewingUserId, setViewingUserId] = useState<number | null>(null);
  const [drilldownConfig, setDrilldownConfig] = useState<UniversalDrilldownConfig | null>(null);
  const [boardScope, setBoardScope] = useState<"my" | "team" | "user">("my");
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Allow any list-row component to request the drawer via a window event
  useEffect(() => {
    const handler = (e: any) => {
      const id = Number(e?.detail?.taskId);
      if (Number.isFinite(id)) setOpenTaskId(id);
    };
    window.addEventListener("open-task-drawer", handler as EventListener);
    return () => window.removeEventListener("open-task-drawer", handler as EventListener);
  }, []);

  // Header quick-create "New Task" fires this event after navigating here
  useEffect(() => {
    const handler = () => setCreatingNew(true);
    window.addEventListener("open-create-task", handler);
    return () => window.removeEventListener("open-create-task", handler);
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
    queryKey: ["/api/tasks/hub", view, groupBy, viewingUserId],
    queryFn: () => {
      const params = new URLSearchParams({ view, groupBy });
      if (viewingUserId) params.set("viewingUserId", String(viewingUserId));
      return fetch(`/api/tasks/hub?${params}`, { credentials: "include" }).then(r => r.json());
    },
    refetchInterval: 30_000,
    enabled: view !== "board" && view !== "suggestions" && view !== "archived",
  });

  const calendarView = boardScope === "team" ? "team" : "my";
  const { data: calendarData, isLoading: calendarLoading } = useQuery<HubResponse>({
    queryKey: ["/api/tasks/hub", "calendar", calendarView, viewingUserId],
    queryFn: () => {
      const params = new URLSearchParams({ view: calendarView, groupBy: "due_date" });
      if (viewingUserId) params.set("viewingUserId", String(viewingUserId));
      return fetch(`/api/tasks/hub?${params}`, { credentials: "include" }).then(r => r.json());
    },
    enabled: calendarOpen,
    staleTime: 30_000,
  });

  const { data: usersData = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/users"],
    queryFn: () => fetch("/api/users", { credentials: "include" }).then(r => r.json()),
  });

  const { data: me } = useQuery<{ id: number; name: string; globalRole: string }>({
    queryKey: ["/api/auth/me"],
    queryFn: () => fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: myAccess = [] } = useQuery<HubAccessEntry[]>({
    queryKey: ["/api/tasks/hub-access/my-access"],
    queryFn: () => fetch("/api/tasks/hub-access/my-access", { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  const isAdmin = me?.globalRole === "master_admin" || me?.globalRole === "admin";
  const canShowSwitcher = isAdmin || myAccess.length > 0;

  // Users the current user is permitted to view/edit boards for (passed to TaskBoard)
  const permittedUsers = isAdmin
    ? usersData.filter(u => u.id !== me?.id).map(u => ({ id: u.id, name: u.name }))
    : myAccess.map(a => ({ id: a.targetUserId, name: a.targetUserName }));
  const viewingPermission: "view" | "edit" = viewingUserId
    ? (isAdmin ? "edit" : (myAccess.find(a => a.targetUserId === viewingUserId)?.permissionLevel ?? "view"))
    : "edit";
  const isViewOnly = viewingUserId !== null && viewingPermission === "view";
  const viewingUserName = viewingUserId
    ? (myAccess.find(a => a.targetUserId === viewingUserId)?.targetUserName
        ?? usersData.find(u => u.id === viewingUserId)?.name
        ?? "User")
    : null;

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
              {canShowSwitcher && view !== "board" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={viewingUserId ? "secondary" : "outline"}
                      size="sm"
                      className={`h-8 text-xs gap-1 border-border/50 ${viewingUserId ? "ring-1 ring-primary/30" : ""}`}
                      data-testid="button-user-switcher"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline max-w-[90px] truncate">
                        {viewingUserId ? viewingUserName : "My Tasks"}
                      </span>
                      <ChevronDown className="h-3 w-3 ml-0.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem
                      onClick={() => setViewingUserId(null)}
                      className={`text-xs ${!viewingUserId ? "text-primary font-medium" : ""}`}
                      data-testid="option-my-tasks"
                    >
                      <User2 className="h-3.5 w-3.5 mr-2" />
                      My Tasks
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {isAdmin
                      ? usersData.filter(u => u.id !== me?.id).map(u => (
                          <DropdownMenuItem
                            key={u.id}
                            onClick={() => setViewingUserId(u.id)}
                            className={`text-xs ${viewingUserId === u.id ? "text-primary font-medium" : ""}`}
                            data-testid={`option-user-${u.id}`}
                          >
                            <User2 className="h-3.5 w-3.5 mr-2" />
                            {u.name}
                          </DropdownMenuItem>
                        ))
                      : myAccess.map(a => (
                          <DropdownMenuItem
                            key={a.targetUserId}
                            onClick={() => setViewingUserId(a.targetUserId)}
                            className={`text-xs ${viewingUserId === a.targetUserId ? "text-primary font-medium" : ""}`}
                            data-testid={`option-user-${a.targetUserId}`}
                          >
                            <User2 className="h-3.5 w-3.5 mr-2" />
                            <span className="flex-1 truncate">{a.targetUserName}</span>
                            {a.permissionLevel === "view" && (
                              <span className="text-[10px] text-muted-foreground opacity-60">view</span>
                            )}
                          </DropdownMenuItem>
                        ))
                    }
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
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
              <Button size="sm" className="h-8 text-xs gap-1" onClick={openCapture} disabled={isViewOnly} data-testid="button-new-task">
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New Task</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Drilldown stats chips */}
        {counts && (
          <div className="px-4 md:px-6 flex items-center gap-2 pb-1 flex-wrap">
            {[
              { label: "My Tasks", value: counts.my_count, metric: "tasks_open", color: "text-primary" },
              { label: "Due Today", value: counts.today_count, metric: "tasks_due_today", color: "text-blue-400" },
              { label: "Overdue", value: counts.overdue_count, metric: "tasks_overdue", color: counts.overdue_count > 0 ? "text-red-400" : "text-muted-foreground" },
            ].filter(c => (c.value ?? 0) > 0).map(chip => (
              <button
                key={chip.label}
                onClick={() => setDrilldownConfig({ metric: chip.metric })}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/50 bg-secondary/30 hover:border-primary/40 hover:bg-secondary/60 transition-all text-xs font-medium"
                data-testid={`chip-tasks-${chip.label.toLowerCase().replace(" ","-")}`}
              >
                <span className="text-muted-foreground">{chip.label}</span>
                <span className={`font-bold ${chip.color}`}>{chip.value}</span>
              </button>
            ))}
          </div>
        )}

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
                {count != null && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center cursor-pointer hover:opacity-70 ${
                      v === "overdue" ? "bg-red-500/15 text-red-400" : "bg-primary/15 text-primary"
                    }`}
                    onClick={e => {
                      e.stopPropagation();
                      const metricMap: Partial<Record<ViewTab, string>> = {
                        overdue:  "tasks_overdue",
                        today:    "tasks_due_today",
                        upcoming: "tasks_due_this_week",
                        my:       "tasks_open",
                      };
                      const metric = metricMap[v];
                      if (metric) setDrilldownConfig({ metric, title: VIEW_LABELS[v] });
                    }}
                    data-testid={`drilldown-count-${v}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Context banner: shown when viewing another user's tasks */}
      {viewingUserId && viewingUserName && (
        <div className={`px-4 md:px-6 py-1.5 flex items-center gap-2 text-xs border-b ${
          isViewOnly
            ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
            : "bg-primary/5 border-primary/10 text-primary"
        }`} data-testid="banner-viewing-user">
          <Eye className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Viewing <strong>{viewingUserName}</strong>'s Tasks Hub
            {isViewOnly && <span className="ml-1 opacity-70">— view only</span>}
          </span>
          <button
            onClick={() => setViewingUserId(null)}
            className="ml-auto text-inherit hover:underline opacity-70 hover:opacity-100 transition-opacity"
            data-testid="button-exit-view"
          >
            Exit
          </button>
        </div>
      )}

      {/* Body — pb-24 on mobile ensures the last task row isn't hidden under the FAB */}
      <div className="flex-1 overflow-y-auto pb-36 lg:pb-24">
        {calendarOpen ? (
          <TaskCalendarView
            tasks={calendarData?.tasks ?? []}
            isLoading={calendarLoading}
            onOpenTask={(id) => setOpenTaskId(id)}
          />
        ) : view === "board" ? (
          <div className="p-4 md:p-6">
            <TaskBoard
              view={boardScope === "team" ? "team" : "my"}
              onOpenTask={(id) => setOpenTaskId(id)}
              onAddTask={(colValue) => { setDefaultBoardColumn(colValue); setCreatingNew(true); }}
              viewingUserId={viewingUserId}
              permittedUsers={permittedUsers}
              onViewUser={(id) => { setViewingUserId(id); setBoardScope(id ? "user" : "my"); }}
            />
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
                  readOnly={isViewOnly}
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
        defaultBoardColumn={defaultBoardColumn}
        onCreated={(id) => { setCreatingNew(false); setDefaultBoardColumn(undefined); setOpenTaskId(id); }}
        onOpenChange={(o) => { if (!o) { setOpenTaskId(null); setCreatingNew(false); setDefaultBoardColumn(undefined); } }}
        onTaskChanged={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
        }}
      />

      <UniversalDrilldownSheet
        config={drilldownConfig}
        onClose={() => setDrilldownConfig(null)}
        endpoint="/api/work/drilldown"
      />

      <TaskFloatingNav
        activeKey={
          calendarOpen ? "calendar" :
          view === "overdue" ? "urgentOverdue" :
          view === "completed" ? "recentlyCompleted" :
          (view as FloatingTabKey)
        }
        onSelect={(key) => {
          if (key === "calendar") { setCalendarOpen(true); return; }
          setCalendarOpen(false);
          if (key === "urgentOverdue") setView("overdue");
          else if (key === "recentlyCompleted") setView("completed");
          else setView(key as ViewTab);
        }}
        viewingUserId={viewingUserId}
        viewingUserName={viewingUserName}
        permittedUsers={permittedUsers}
        boardScope={boardScope}
        onSelectBoard={(userId, scope) => {
          setCalendarOpen(false);
          setBoardScope(scope);
          setViewingUserId(userId);
          setView("board");
        }}
      />
    </div>
  );
}

function TaskCalendarView({ tasks, isLoading, onOpenTask }: { tasks: HubTask[]; isLoading: boolean; onOpenTask: (id: number) => void }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });

  const byDay = useMemo(() => {
    const map = new Map<string, HubTask[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const key = new Date(t.dueDate).toDateString();
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [tasks]);

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const firstDayOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startOffset = firstDayOfMonth.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const today = new Date();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarDaysIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold" data-testid="calendar-month-label">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-7 w-7" data-testid="button-calendar-prev"
            onClick={() => setCursor(c => { const n = new Date(c); n.setMonth(n.getMonth() - 1); return n; })}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" data-testid="button-calendar-today"
            onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setCursor(d); }}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" data-testid="button-calendar-next"
            onClick={() => setCursor(c => { const n = new Date(c); n.setMonth(n.getMonth() + 1); return n; })}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-7 gap-1.5">
          {[...Array(35)].map((_, i) => <Skeleton key={i} className="h-24 rounded-md" />)}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
            <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground pb-1">{d}</div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={`empty-${i}`} className="rounded-md border border-transparent min-h-[6rem]" />;
            const key = date.toDateString();
            const dayTasks = byDay.get(key) ?? [];
            const isToday = date.toDateString() === today.toDateString();
            const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
            return (
              <div
                key={key}
                className={`rounded-md border p-1.5 min-h-[6rem] flex flex-col gap-1 ${isToday ? "border-primary ring-1 ring-primary/40" : "border-border/50"}`}
                data-testid={`calendar-day-${date.toISOString().slice(0,10)}`}
              >
                <span className={`text-[11px] ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>{date.getDate()}</span>
                <div className="flex-1 overflow-y-auto space-y-0.5">
                  {dayTasks.slice(0, 3).map(t => (
                    <button
                      key={t.id}
                      onClick={() => onOpenTask(t.id)}
                      className={`w-full text-left text-[10px] px-1 py-0.5 rounded truncate transition-colors ${
                        t.status === "done" || t.status === "completed"
                          ? "bg-muted text-muted-foreground line-through"
                          : isPast
                            ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                            : "bg-primary/10 text-primary hover:bg-primary/20"
                      }`}
                      data-testid={`calendar-task-${t.id}`}
                      title={t.title}
                    >
                      {t.title}
                    </button>
                  ))}
                  {dayTasks.length > 3 && (
                    <span className="text-[10px] text-muted-foreground pl-1">+{dayTasks.length - 3} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
