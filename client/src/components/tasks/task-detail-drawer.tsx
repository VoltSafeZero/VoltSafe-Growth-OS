import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Tag, Calendar as CalendarIcon, ListChecks, User, Link2, MoveRight, AlertTriangle,
  Trash2, Plus, X, Check, MessageSquare, Activity, Lock, RotateCcw, ChevronDown, Flag,
} from "lucide-react";
import { format } from "date-fns";

const PRIORITY_META: Record<string, { label: string; dot: string }> = {
  low:    { label: "Low",    dot: "bg-slate-400" },
  medium: { label: "Medium", dot: "bg-blue-400" },
  high:   { label: "High",   dot: "bg-amber-400" },
  urgent: { label: "Urgent", dot: "bg-red-500" },
};

type Props = {
  taskId: number | null;
  onOpenChange: (open: boolean) => void;
  onTaskChanged?: () => void;
};

const COLUMN_OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"];

const LABEL_COLOR_CLASS: Record<string, string> = {
  red: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-300/50",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-300/50",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-300/50",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-violet-300/50",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-300/50",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-300/50",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border-teal-300/50",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300/50",
};

function labelClasses(color?: string) {
  return LABEL_COLOR_CLASS[color || "slate"] || LABEL_COLOR_CLASS.slate;
}

function fmtDate(v?: string | null) {
  if (!v) return null;
  try { return format(new Date(v), "MMM d, yyyy"); } catch { return null; }
}

function fmtDateTime(v?: string | null) {
  if (!v) return null;
  try { return format(new Date(v), "MMM d 'at' h:mma"); } catch { return null; }
}

export function TaskDetailDrawer({ taskId, onOpenChange, onTaskChanged }: Props) {
  const open = taskId != null;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/tasks", taskId, "full"],
    queryFn: () => fetch(`/api/tasks/${taskId}/full`, { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });

  const { data: comments = [] } = useQuery<any[]>({
    queryKey: ["/api/tasks", taskId, "comments"],
    queryFn: () => fetch(`/api/tasks/${taskId}/comments`, { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });

  const { data: allLabels = [] } = useQuery<any[]>({
    queryKey: ["/api/task-labels"],
    enabled: open,
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/tasks", taskId, "full"] });
    qc.invalidateQueries({ queryKey: ["/api/tasks/board"] });
    qc.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
    onTaskChanged?.();
  };

  const patchTask = useMutation({
    mutationFn: (patch: any) => apiRequest("PATCH", `/api/tasks/${taskId}`, patch),
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const completeTask = useMutation({
    mutationFn: (notes?: string) => apiRequest("POST", `/api/tasks/${taskId}/complete`, { notes }),
    onSuccess: () => { toast({ title: "Task completed" }); invalidate(); },
  });

  const reopenTask = useMutation({
    mutationFn: () => apiRequest("POST", `/api/tasks/${taskId}/reopen`),
    onSuccess: () => { toast({ title: "Task reopened" }); invalidate(); },
  });

  const t = data?.task;
  const isDone = t?.status === "completed" || t?.status === "done";
  const isBlocked = data?.isBlocked;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto p-0"
        data-testid="drawer-task-detail"
      >
        {isLoading || !t ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="p-6 pb-3 border-b">
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={isDone}
                  onCheckedChange={(c) => c ? completeTask.mutate(undefined) : reopenTask.mutate()}
                  className="mt-1.5 h-5 w-5"
                  disabled={isBlocked && !isDone}
                  data-testid="checkbox-task-complete"
                />
                <div className="flex-1 min-w-0">
                  <InlineTitle taskId={t.id} initial={t.title} onSaved={invalidate} />
                  <SheetDescription className="mt-1 text-xs">
                    Created by <span className="font-medium" data-testid="text-creator">{t.creator_name || "—"}</span>
                    {t.created_at && <> · {fmtDateTime(t.created_at)}</>}
                    {t.last_updated_by_name && t.updated_at !== t.created_at && (
                      <> · last edited by {t.last_updated_by_name}</>
                    )}
                  </SheetDescription>
                </div>
              </div>
              {isBlocked && !isDone && (
                <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                  <Lock className="h-3.5 w-3.5" />
                  Blocked — {data.dependencies.filter((d: any) => !d.completed_at).length} open dependency
                </div>
              )}
            </SheetHeader>

            {/* Action row (Trello-style) */}
            <div className="px-6 py-3 border-b flex flex-wrap gap-2">
              <LabelsButton task={t} taskLabels={data.labels} allLabels={allLabels} onChanged={invalidate} />
              <DueDateButton task={t} onChanged={invalidate} />
              <ChecklistAddButton taskId={t.id} onChanged={invalidate} />
              <AssigneeButton task={t} users={users} onChanged={invalidate} />
              <MoveButton task={t} onChanged={invalidate} />
              <PriorityButton task={t} onChanged={invalidate} />
              <DependenciesButton task={t} deps={data.dependencies} onChanged={invalidate} />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={async () => {
                  const archiving = !t.archived;
                  if (archiving && !confirm("Archive this task? It will be hidden from the board.")) return;
                  await patchTask.mutateAsync({ archived: archiving });
                  toast({ title: archiving ? "Task archived" : "Task restored" });
                  if (archiving) onOpenChange(false);
                }}
                data-testid="button-archive-task"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t.archived ? "Restore" : "Archive"}
              </Button>
            </div>
            {t.archived && (
              <div className="px-6 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                <Trash2 className="h-3.5 w-3.5" /> This task is archived and hidden from the board.
              </div>
            )}

            <div className="px-6 py-4 space-y-6">
              {/* Quick chips: assignee, due, completed-by */}
              <div className="flex flex-wrap gap-3 text-xs">
                <Chip icon={<User className="h-3.5 w-3.5" />} label="Assignee" value={t.owner_name || "Unassigned"} testId="chip-assignee" />
                {t.due_date && (
                  <Chip icon={<CalendarIcon className="h-3.5 w-3.5" />} label="Due" value={fmtDate(t.due_date) || "—"} testId="chip-due" />
                )}
                {isDone && t.completed_by_name && (
                  <Chip icon={<Check className="h-3.5 w-3.5" />} label="Completed by" value={`${t.completed_by_name} · ${fmtDate(t.completed_at) || ""}`} testId="chip-completed-by" />
                )}
                <Chip
                  icon={<MoveRight className="h-3.5 w-3.5" />}
                  label="Column"
                  value={COLUMN_OPTIONS.find(c => c.value === t.board_column)?.label || "—"}
                  testId="chip-column"
                />
                <Chip
                  icon={<AlertTriangle className="h-3.5 w-3.5" />}
                  label="Priority"
                  value={t.priority || "medium"}
                  testId="chip-priority"
                />
              </div>

              {/* Labels strip */}
              {data.labels.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.labels.map((l: any) => (
                    <span key={l.id} className={`px-2 py-0.5 text-xs font-medium rounded border ${labelClasses(l.color)}`}>
                      {l.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Description */}
              <DescriptionEditor taskId={t.id} initial={t.description} onSaved={invalidate} />

              {/* Linked context */}
              {(t.account_name || t.linked_object_type) && (
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs flex items-center gap-2">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Linked to:</span>
                  <span className="font-medium">
                    {t.account_name || `${t.linked_object_type} #${t.linked_object_id}`}
                  </span>
                </div>
              )}

              {/* Dependencies */}
              {data.dependencies.length > 0 && (
                <Section title="Dependencies" icon={<Lock className="h-4 w-4" />}>
                  <ul className="space-y-1.5">
                    {data.dependencies.map((d: any) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 text-sm rounded border px-2 py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {d.completed_at ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Lock className="h-3.5 w-3.5 text-amber-600" />}
                          <span className="truncate">{d.title}</span>
                        </div>
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={async () => {
                            await apiRequest("DELETE", `/api/tasks/${t.id}/dependencies/${d.id}`);
                            invalidate();
                          }}
                          data-testid={`button-remove-dep-${d.id}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {data.blocking?.length > 0 && (
                <Section title="Blocking" icon={<AlertTriangle className="h-4 w-4" />}>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {data.blocking.map((b: any) => (
                      <li key={b.id} className="truncate">→ {b.title}</li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Checklists */}
              {data.checklists.map((cl: any) => (
                <ChecklistBlock key={cl.id} checklist={cl} onChanged={invalidate} />
              ))}

              {/* Completion notes (when done) */}
              {isDone && (
                <Section title="Completion notes" icon={<Check className="h-4 w-4" />}>
                  <CompletionNotes taskId={t.id} initial={t.completion_notes} onSaved={invalidate} />
                </Section>
              )}

              {/* Comments */}
              <Section title={`Comments${comments.length ? ` (${comments.length})` : ""}`} icon={<MessageSquare className="h-4 w-4" />}>
                <CommentsBlock taskId={t.id} comments={comments} />
              </Section>

              {/* Activity */}
              <Section title="Activity" icon={<Activity className="h-4 w-4" />}>
                <ActivityList items={data.activity} />
              </Section>

              {/* Reopen footer */}
              {isDone && (
                <Button variant="outline" size="sm" onClick={() => reopenTask.mutate()} data-testid="button-reopen">
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reopen task
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">{icon} {title}</h3>
      {children}
    </div>
  );
}

function Chip({ icon, label, value, testId }: { icon: React.ReactNode; label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1" data-testid={testId}>
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function InlineTitle({ taskId, initial, onSaved }: { taskId: number; initial: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(initial);
  useEffect(() => setVal(initial), [initial, taskId]);
  if (editing) {
    return (
      <Input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={async () => {
          if (val.trim() && val !== initial) await apiRequest("PATCH", `/api/tasks/${taskId}`, { title: val.trim() });
          setEditing(false);
          onSaved();
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="text-lg font-semibold"
        data-testid="input-task-title"
      />
    );
  }
  return (
    <SheetTitle
      className="text-lg cursor-text hover:bg-muted/50 -mx-1 px-1 rounded"
      onClick={() => setEditing(true)}
      data-testid="text-task-title"
    >
      {val}
    </SheetTitle>
  );
}

function DescriptionEditor({ taskId, initial, onSaved }: { taskId: number; initial?: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(initial || "");
  useEffect(() => setVal(initial || ""), [initial, taskId]);

  if (!editing) {
    return (
      <Section title="Description" icon={<MessageSquare className="h-4 w-4" />}>
        <div
          className="text-sm whitespace-pre-wrap rounded-md border bg-muted/30 px-3 py-2 min-h-[60px] cursor-text hover:bg-muted/50"
          onClick={() => setEditing(true)}
          data-testid="text-description"
        >
          {val || <span className="text-muted-foreground">Add a more detailed description…</span>}
        </div>
      </Section>
    );
  }
  return (
    <Section title="Description" icon={<MessageSquare className="h-4 w-4" />}>
      <Textarea
        autoFocus
        rows={5}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        data-testid="input-description"
      />
      <div className="flex gap-2 mt-2">
        <Button size="sm" onClick={async () => {
          await apiRequest("PATCH", `/api/tasks/${taskId}`, { description: val });
          setEditing(false); onSaved();
        }} data-testid="button-save-description">Save</Button>
        <Button size="sm" variant="ghost" onClick={() => { setVal(initial || ""); setEditing(false); }}>Cancel</Button>
      </div>
    </Section>
  );
}

function CompletionNotes({ taskId, initial, onSaved }: { taskId: number; initial?: string | null; onSaved: () => void }) {
  const [val, setVal] = useState(initial || "");
  return (
    <div className="space-y-2">
      <Textarea
        rows={3}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="What was done? Outcome, links, follow-ups…"
        data-testid="input-completion-notes"
      />
      <Button size="sm" onClick={async () => {
        await apiRequest("PATCH", `/api/tasks/${taskId}`, { completionNotes: val });
        onSaved();
      }}>Save notes</Button>
    </div>
  );
}

function ActionPopover({ icon, label, children, testId }: { icon: React.ReactNode; label: string; children: (close: () => void) => React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" data-testid={testId}>
          {icon} {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

function LabelsButton({ task, taskLabels, allLabels, onChanged }: any) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("slate");
  const assigned = new Set(taskLabels.map((l: any) => l.id));
  return (
    <ActionPopover icon={<Tag className="h-3.5 w-3.5" />} label="Labels" testId="button-action-labels">
      {(close) => (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">Apply labels</div>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {allLabels.map((l: any) => {
              const on = assigned.has(l.id);
              return (
                <button
                  key={l.id}
                  className={`w-full flex items-center justify-between text-xs rounded border px-2 py-1.5 hover:bg-muted ${labelClasses(l.color)}`}
                  onClick={async () => {
                    if (on) await apiRequest("DELETE", `/api/tasks/${task.id}/labels/${l.id}`);
                    else await apiRequest("POST", `/api/tasks/${task.id}/labels/${l.id}`, {});
                    onChanged();
                  }}
                  data-testid={`button-toggle-label-${l.id}`}
                >
                  <span>{l.name}</span>
                  {on && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
          <Separator />
          <div className="text-xs font-semibold text-muted-foreground">Create new</div>
          <div className="flex gap-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Label name"
              className="h-8 text-xs"
              data-testid="input-new-label"
            />
            <Select value={newColor} onValueChange={setNewColor}>
              <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.keys(LABEL_COLOR_CLASS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="w-full h-8" disabled={!newName.trim()} onClick={async () => {
            const l = await apiRequest("POST", "/api/task-labels", { name: newName.trim(), color: newColor });
            const created = await l.json();
            await apiRequest("POST", `/api/tasks/${task.id}/labels/${created.id}`, {});
            queryClient.invalidateQueries({ queryKey: ["/api/task-labels"] });
            setNewName("");
            onChanged();
          }} data-testid="button-create-label">
            <Plus className="h-3.5 w-3.5 mr-1" /> Create & apply
          </Button>
        </div>
      )}
    </ActionPopover>
  );
}

function DueDateButton({ task, onChanged }: any) {
  const [val, setVal] = useState(task.due_date ? String(task.due_date).slice(0, 10) : "");
  return (
    <ActionPopover icon={<CalendarIcon className="h-3.5 w-3.5" />} label="Dates" testId="button-action-dates">
      {(close) => (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">Due date</label>
          <Input
            type="date"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            data-testid="input-due-date"
          />
          <div className="flex gap-1">
            <Button size="sm" className="flex-1" onClick={async () => {
              await apiRequest("PATCH", `/api/tasks/${task.id}`, { dueDate: val || null });
              onChanged(); close();
            }} data-testid="button-save-due-date">Save</Button>
            <Button size="sm" variant="ghost" onClick={async () => {
              await apiRequest("PATCH", `/api/tasks/${task.id}`, { dueDate: null });
              setVal(""); onChanged(); close();
            }}>Clear</Button>
          </div>
        </div>
      )}
    </ActionPopover>
  );
}

function ChecklistAddButton({ taskId, onChanged }: { taskId: number; onChanged: () => void }) {
  const [title, setTitle] = useState("Checklist");
  return (
    <ActionPopover icon={<ListChecks className="h-3.5 w-3.5" />} label="Checklist" testId="button-action-checklist">
      {(close) => (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">New checklist</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8" data-testid="input-checklist-title" />
          <Button size="sm" className="w-full" onClick={async () => {
            await apiRequest("POST", `/api/tasks/${taskId}/checklists`, { title: title.trim() || "Checklist" });
            onChanged(); close();
          }} data-testid="button-add-checklist">Add</Button>
        </div>
      )}
    </ActionPopover>
  );
}

function AssigneeButton({ task, users, onChanged }: any) {
  return (
    <ActionPopover icon={<User className="h-3.5 w-3.5" />} label="Assignee" testId="button-action-assignee">
      {(close) => (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          <button
            className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
            onClick={async () => { await apiRequest("PATCH", `/api/tasks/${task.id}`, { ownerUserId: null }); onChanged(); close(); }}
          >
            Unassign
          </button>
          {users.map((u: any) => (
            <button
              key={u.id}
              className={`w-full flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-muted ${task.owner_user_id === u.id ? "bg-muted" : ""}`}
              onClick={async () => { await apiRequest("PATCH", `/api/tasks/${task.id}`, { ownerUserId: u.id }); onChanged(); close(); }}
              data-testid={`button-assign-${u.id}`}
            >
              <span>{u.name}</span>
              {task.owner_user_id === u.id && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}
    </ActionPopover>
  );
}

function MoveButton({ task, onChanged }: any) {
  return (
    <ActionPopover icon={<MoveRight className="h-3.5 w-3.5" />} label="Move" testId="button-action-move">
      {(close) => (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground mb-1">Move to column</div>
          {COLUMN_OPTIONS.map(c => (
            <button
              key={c.value}
              className={`w-full flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-muted ${task.board_column === c.value ? "bg-muted font-medium" : ""}`}
              onClick={async () => {
                await apiRequest("PATCH", `/api/tasks/${task.id}/board`, { boardColumn: c.value, sortOrder: 0 });
                onChanged(); close();
              }}
              data-testid={`button-move-${c.value}`}
            >
              <span>{c.label}</span>
              {task.board_column === c.value && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}
    </ActionPopover>
  );
}

function PriorityButton({ task, onChanged }: any) {
  const current = PRIORITY_META[task.priority] ?? PRIORITY_META.medium;
  return (
    <ActionPopover
      icon={<Flag className="h-3.5 w-3.5" />}
      label={`Priority: ${current.label}`}
      testId="button-action-priority"
    >
      {(close) => (
        <div className="space-y-1 min-w-[180px]">
          <div className="text-xs font-semibold text-muted-foreground mb-1">Priority</div>
          {PRIORITY_OPTIONS.map(p => {
            const meta = PRIORITY_META[p];
            return (
              <button
                key={p}
                className={`w-full flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-muted ${task.priority === p ? "bg-muted font-medium" : ""}`}
                onClick={async () => { await apiRequest("PATCH", `/api/tasks/${task.id}`, { priority: p }); onChanged(); close(); }}
                data-testid={`button-priority-${p}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
                  {meta.label}
                </span>
                {task.priority === p && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </ActionPopover>
  );
}

function DependenciesButton({ task, deps, onChanged }: any) {
  const [q, setQ] = useState("");
  const { data: results = [] } = useQuery<any[]>({
    queryKey: ["/api/tasks/search", q, task.id],
    queryFn: () => fetch(`/api/tasks/search?q=${encodeURIComponent(q)}&exclude=${task.id}`, { credentials: "include" }).then(r => r.json()),
    enabled: q.length >= 2,
  });
  return (
    <ActionPopover icon={<Lock className="h-3.5 w-3.5" />} label="Dependencies" testId="button-action-deps">
      {(close) => (
        <div className="space-y-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks…"
            className="h-8"
            data-testid="input-search-deps"
          />
          <div className="max-h-56 overflow-y-auto space-y-1">
            {results.map((r: any) => (
              <button
                key={r.id}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted truncate"
                onClick={async () => {
                  try {
                    await apiRequest("POST", `/api/tasks/${task.id}/dependencies`, { dependsOnTaskId: r.id });
                    onChanged();
                  } catch (e: any) {
                    alert(e.message);
                  }
                }}
                data-testid={`button-add-dep-${r.id}`}
              >
                #{r.id} {r.title}
              </button>
            ))}
            {q.length >= 2 && results.length === 0 && (
              <div className="text-xs text-muted-foreground p-2">No matches.</div>
            )}
          </div>
        </div>
      )}
    </ActionPopover>
  );
}

function ChecklistBlock({ checklist, onChanged }: any) {
  const [newItem, setNewItem] = useState("");
  const total = checklist.items.length;
  const done = checklist.items.filter((i: any) => i.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <Section title={checklist.title} icon={<ListChecks className="h-4 w-4" />}>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-10 tabular-nums">{pct}%</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <button
            className="text-xs hover:text-destructive ml-2"
            onClick={async () => {
              if (confirm("Delete this checklist?")) {
                await apiRequest("DELETE", `/api/task-checklists/${checklist.id}`);
                onChanged();
              }
            }}
            data-testid={`button-delete-checklist-${checklist.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="space-y-1">
          {checklist.items.map((i: any) => (
            <li key={i.id} className="flex items-center gap-2 group" data-testid={`checklist-item-${i.id}`}>
              <Checkbox
                checked={i.completed}
                onCheckedChange={async (c) => {
                  await apiRequest("PATCH", `/api/task-checklist-items/${i.id}`, { completed: !!c });
                  onChanged();
                }}
              />
              <span className={`text-sm flex-1 ${i.completed ? "line-through text-muted-foreground" : ""}`}>{i.content}</span>
              <button
                className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-destructive"
                onClick={async () => {
                  await apiRequest("DELETE", `/api/task-checklist-items/${i.id}`);
                  onChanged();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-1">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && newItem.trim()) {
                await apiRequest("POST", `/api/task-checklists/${checklist.id}/items`, { content: newItem.trim() });
                setNewItem(""); onChanged();
              }
            }}
            placeholder="Add an item…"
            className="h-8 text-sm"
            data-testid={`input-new-item-${checklist.id}`}
          />
          <Button
            size="sm"
            disabled={!newItem.trim()}
            onClick={async () => {
              await apiRequest("POST", `/api/task-checklists/${checklist.id}/items`, { content: newItem.trim() });
              setNewItem(""); onChanged();
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Section>
  );
}

function CommentsBlock({ taskId, comments }: { taskId: number; comments: any[] }) {
  const [val, setVal] = useState("");
  const qc = useQueryClient();
  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {comments.map((c) => (
          <div key={c.id} className="rounded-md border bg-card px-3 py-2 text-sm" data-testid={`comment-${c.id}`}>
            <div className="text-xs text-muted-foreground mb-0.5">
              <span className="font-medium text-foreground">{c.authorName || "Someone"}</span> · {fmtDateTime(c.createdAt)}
            </div>
            <div className="whitespace-pre-wrap">{c.body}</div>
          </div>
        ))}
        {comments.length === 0 && <div className="text-xs text-muted-foreground italic">No comments yet.</div>}
      </div>
      <Textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        rows={2}
        placeholder="Write a comment…"
        data-testid="input-new-comment"
      />
      <Button
        size="sm"
        disabled={!val.trim()}
        onClick={async () => {
          await apiRequest("POST", `/api/tasks/${taskId}/comments`, { body: val.trim() });
          setVal("");
          qc.invalidateQueries({ queryKey: ["/api/tasks", taskId, "comments"] });
        }}
        data-testid="button-add-comment"
      >Post</Button>
    </div>
  );
}

function ActivityList({ items }: { items: any[] }) {
  if (!items?.length) return <div className="text-xs text-muted-foreground italic">No activity yet.</div>;
  return (
    <ol className="space-y-1.5 text-xs">
      {items.map((a) => (
        <li key={a.id} className="flex gap-2 text-muted-foreground" data-testid={`activity-${a.id}`}>
          <span className="text-foreground/70 tabular-nums">{fmtDateTime(a.created_at)}</span>
          <span>·</span>
          <span><span className="font-medium text-foreground">{a.user_name || "System"}</span> {humanizeActivity(a)}</span>
        </li>
      ))}
    </ol>
  );
}

function humanizeActivity(a: any): string {
  const action = a.action as string;
  const to = a.to_value;
  const from = a.from_value;
  switch (action) {
    case "moved": return `moved from "${from || "—"}" to "${to || "—"}"`;
    case "completed": return "marked complete";
    case "reopened": return "reopened";
    case "commented": return `commented: "${to}"`;
    case "label_added": return `added label "${to}"`;
    case "label_removed": return `removed label "${from}"`;
    case "dependency_added": return `added dependency on #${to}`;
    case "dependency_removed": return "removed a dependency";
    case "checklist_added": return `added checklist "${to}"`;
    case "checklist_removed": return `deleted checklist "${from}"`;
    case "checklist_item_added": return `added item "${to}"`;
    case "checklist_item_checked": return `checked off "${to}"`;
    case "checklist_item_unchecked": return `unchecked "${to}"`;
    case "watcher_added": return "added a watcher";
    case "watcher_removed": return "removed a watcher";
    default:
      if (action.startsWith("updated_")) {
        const field = action.slice(8).replace(/_/g, " ");
        return `changed ${field}${to ? ` to "${to}"` : ""}`;
      }
      return action;
  }
}
