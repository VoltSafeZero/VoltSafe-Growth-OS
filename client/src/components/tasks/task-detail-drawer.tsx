import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTaskColumns } from "@/hooks/use-task-columns";
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
  Paperclip, UploadCloud, Download, FileText, FileImage, FileVideo, File as FileIcon, Loader2,
  Users, Building2, UserCircle, ExternalLink, Repeat, Hash, Radio, ArrowRight,
} from "lucide-react";
import { format } from "date-fns";
import { DatePicker } from "@/components/ui/date-picker";

// ── Currents deep-link URL builder ───────────────────────────────────────────
function buildCurrentsUrl(sm: any): string | null {
  if (!sm) return null;
  const { sourceContext, messageId, channelSlug, objectType, objectId, threadRootId } = sm;
  if (sourceContext === "currents_channel") {
    if (!channelSlug || !messageId) return null;
    return `/current?channel=${channelSlug}&message=${messageId}${threadRootId ? `&thread=${threadRootId}` : ""}`;
  }
  if (sourceContext === "currents_record") {
    if (!objectType || !objectId || !messageId) return null;
    const msgPart = `&message=${messageId}`;
    const threadPart = threadRootId ? `&thread=${threadRootId}` : "";
    if (objectType === "lead") {
      return `/opportunities?selected=${objectId}&tab=current${msgPart}${threadPart}`;
    }
    const segMap: Record<string, string> = {
      account: "accounts", contact: "contacts", opportunity: "opportunities",
      project: "execution/projects", deployment: "deployments",
      install_workflow: "install-workflows", customer_success: "customer-success",
      partnership: "strategy/partnerships", quote: "quotes",
      tradeshow_event: "operations/events",
    };
    const seg = segMap[objectType] ?? objectType.replace(/_/g, "-") + "s";
    return `/${seg}/${objectId}?tab=current${msgPart}${threadPart}`;
  }
  return null;
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const RECURRENCE_OPTIONS = [
  { value: "none",      label: "None" },
  { value: "daily",     label: "Daily" },
  { value: "weekly",    label: "Weekly" },
  { value: "biweekly",  label: "Bi-weekly" },
  { value: "monthly",   label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly",    label: "Yearly" },
];

const PRIORITY_META: Record<string, { label: string; dot: string }> = {
  low:    { label: "Low",    dot: "bg-slate-400" },
  medium: { label: "Medium", dot: "bg-blue-400" },
  high:   { label: "High",   dot: "bg-amber-400" },
  urgent: { label: "Urgent", dot: "bg-red-500" },
};

type Props = {
  taskId: number | null;
  /** When true the Sheet opens in "new task" creation mode. After saving,
   *  onCreated is called with the new task id and the drawer transitions to
   *  the full detail view for that task. */
  createMode?: boolean;
  /** Pre-select a board column when opening in createMode (e.g. from a column footer). */
  defaultBoardColumn?: string;
  onCreated?: (taskId: number) => void;
  onOpenChange: (open: boolean) => void;
  onTaskChanged?: () => void;
};

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

export function TaskDetailDrawer({ taskId, createMode, defaultBoardColumn, onCreated, onOpenChange, onTaskChanged }: Props) {
  const open = taskId != null || !!createMode;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { columns: taskColumns } = useTaskColumns();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/tasks", taskId, "full"],
    queryFn: () => fetch(`/api/tasks/${taskId}/full`, { credentials: "include" }).then(r => r.json()),
    enabled: open && taskId != null,
  });

  const { data: comments = [] } = useQuery<any[]>({
    queryKey: ["/api/tasks", taskId, "comments"],
    queryFn: () => fetch(`/api/tasks/${taskId}/comments`, { credentials: "include" }).then(r => r.json()),
    enabled: open && taskId != null,
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

  // ── Attachments (polymorphic — objectType:"task") ────────────────────────
  const attachmentsKey = useMemo(
    () => ["/api/attachments", { objectType: "task", objectId: taskId }],
    [taskId],
  );
  const { data: attachments = [] } = useQuery<any[]>({
    queryKey: attachmentsKey,
    queryFn: () =>
      fetch(`/api/attachments?objectType=task&objectId=${taskId}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : []),
    enabled: open && taskId != null,
  });

  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    if (!taskId || !files || (files as any).length === 0) return;
    const list = Array.from(files as any) as File[];
    setUploading(true);
    let okCount = 0;
    let failCount = 0;
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("objectType", "task");
        fd.append("objectId", String(taskId));
        try {
          const res = await fetch("/api/attachments", {
            method: "POST",
            credentials: "include",
            body: fd,
          });
          if (!res.ok) {
            failCount++;
            const msg = await res.text().catch(() => "");
            toast({
              title: `Couldn't upload ${file.name}`,
              description: msg.slice(0, 200) || `HTTP ${res.status}`,
              variant: "destructive",
            });
          } else {
            okCount++;
          }
        } catch (e: any) {
          failCount++;
          toast({ title: `Couldn't upload ${file.name}`, description: e?.message || "Network error", variant: "destructive" });
        }
      }
    } finally {
      setUploading(false);
      qc.invalidateQueries({ queryKey: attachmentsKey });
      qc.invalidateQueries({ queryKey: ["/api/tasks", taskId, "full"] });
      if (okCount > 0) {
        toast({ title: okCount === 1 ? "Attachment uploaded" : `${okCount} attachments uploaded` });
      }
    }
  }, [taskId, toast, qc, attachmentsKey]);

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragCounter.current += 1;
    setDragActive(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) uploadFiles(files);
  };

  // Reset drag state when drawer closes/changes task.
  useEffect(() => {
    dragCounter.current = 0;
    setDragActive(false);
  }, [taskId, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto p-0"
        data-testid="drawer-task-detail"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="relative min-h-full">
        {/* ── Create-mode form (shown when no taskId exists yet) ─────────── */}
        {createMode && taskId == null ? (
          <NewTaskForm
            onCreated={(id) => { onTaskChanged?.(); onCreated?.(id); }}
            onCancel={() => onOpenChange(false)}
            defaultBoardColumn={defaultBoardColumn}
          />
        ) : null}
        {dragActive && t && (
          <div
            className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-4 border-dashed border-primary rounded-lg"
            data-testid="overlay-task-drop"
          >
            <div className="flex flex-col items-center gap-2 text-primary font-medium">
              <UploadCloud className="h-12 w-12" />
              <span>Drop files to attach to this task</span>
            </div>
          </div>
        )}
        {!(createMode && taskId == null) && ((isLoading || !t) ? (
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
              <RecurringButton task={t} onChanged={invalidate} />
              <ChecklistAddButton taskId={t.id} onChanged={invalidate} />
              <AssigneeButton task={t} users={users} onChanged={invalidate} />
              <ParticipantsButton task={t} watchers={data.watchers} users={users} onChanged={invalidate} />
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
                {data.watchers?.length > 0 && (
                  <Chip icon={<Users className="h-3.5 w-3.5" />} label="Shared with" value={data.watchers.map((w: any) => w.name).join(", ")} testId="chip-participants" />
                )}
                <Chip
                  icon={<MoveRight className="h-3.5 w-3.5" />}
                  label="Column"
                  value={taskColumns.find(c => c.value === t.board_column)?.label || "—"}
                  testId="chip-column"
                />
                <Chip
                  icon={<AlertTriangle className="h-3.5 w-3.5" />}
                  label="Priority"
                  value={t.priority || "medium"}
                  testId="chip-priority"
                />
                {t.recurrence_rule && t.recurrence_rule !== "none" && (
                  <Chip
                    icon={<Repeat className="h-3.5 w-3.5" />}
                    label="Repeats"
                    value={RECURRENCE_LABELS[t.recurrence_rule] || t.recurrence_rule}
                    testId="chip-recurrence"
                  />
                )}
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

              {/* Attachments */}
              <Section
                title={`Attachments${attachments.length ? ` (${attachments.length})` : ""}`}
                icon={<Paperclip className="h-4 w-4" />}
              >
                <AttachmentsBlock
                  attachments={attachments}
                  uploading={uploading}
                  onUpload={uploadFiles}
                  onDeleted={() => {
                    qc.invalidateQueries({ queryKey: attachmentsKey });
                    qc.invalidateQueries({ queryKey: ["/api/tasks", taskId, "full"] });
                  }}
                />
              </Section>

              {/* CRM Links */}
              <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs space-y-2.5">
                <p className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Link2 className="h-3.5 w-3.5" /> CRM Links
                </p>
                <div className="flex items-center gap-2 min-w-0">
                  <UserCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground shrink-0 w-[4.5rem]">Contact</span>
                  <CrmLinkCombobox
                    type="contact"
                    value={
                      (t.contact_id || (t.linked_object_type === "contact" && t.linked_object_id))
                        ? { id: Number(t.contact_id || t.linked_object_id), label: t.contact_name || `Contact #${t.contact_id || t.linked_object_id}` }
                        : null
                    }
                    onChange={async (v) => {
                      if (v) await patchTask.mutateAsync({ contactId: v.id });
                      else await patchTask.mutateAsync({ contactId: null });
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground shrink-0 w-[4.5rem]">Lead / Account</span>
                  <CrmLinkCombobox
                    type="account"
                    value={
                      t.account_id
                        ? { id: Number(t.account_id), label: t.account_name || `Account #${t.account_id}`, kind: "account" as const }
                        : t.linked_object_type === "lead" && t.linked_object_id
                          ? { id: Number(t.linked_object_id), label: t.lead_name || `Lead #${t.linked_object_id}`, kind: "lead" as const }
                          : null
                    }
                    onChange={async (v) => {
                      if (v?.kind === "lead") {
                        await patchTask.mutateAsync({ linkedObjectType: "lead", linkedObjectId: v.id, accountId: null });
                      } else if (v) {
                        // Linking an account: clear any stale lead link but leave contactId alone
                        await patchTask.mutateAsync({ accountId: v.id, linkedObjectType: null, linkedObjectId: null });
                      } else {
                        // Unlinking: clear lead/account fields only — contactId is independent
                        await patchTask.mutateAsync({ accountId: null, linkedObjectType: null, linkedObjectId: null });
                      }
                    }}
                  />
                  {t.account_id && (
                    <a
                      href={`/accounts/${t.account_id}`}
                      className="shrink-0 text-primary/60 hover:text-primary transition-colors"
                      title={`Open ${t.account_name || "organization"} detail page`}
                      data-testid="link-account-detail"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {t.linked_object_type === "lead" && t.linked_object_id && (
                    <a
                      href={`/leads/${t.linked_object_id}`}
                      className="shrink-0 text-primary/60 hover:text-primary transition-colors"
                      title={`Open ${t.lead_name || "lead"} detail page`}
                      data-testid="link-lead-detail"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                {t.linked_object_type && t.linked_object_type !== "contact" && t.linked_object_type !== "lead" && t.linked_object_id && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Link2 className="h-3 w-3" />
                    <span>Also linked to: <span className="font-medium text-foreground capitalize">{t.linked_object_type} #{t.linked_object_id}</span></span>
                  </div>
                )}
              </div>

              {/* Currents Source */}
              {t.source === "current_message" && t.source_meta && (() => {
                const sm = t.source_meta as any;
                // AI summary action item — show attribution; add a soft context link if available
                if (sm.summaryContext === "currents_summary") {
                  // Build a "soft" link: no specific message, just channel / record tab
                  let softUrl: string | null = null;
                  if (sm.channelSlug) {
                    softUrl = `/current?channel=${sm.channelSlug}${sm.threadRootId ? `&thread=${sm.threadRootId}` : ""}`;
                  } else if (sm.objectType && sm.objectId) {
                    const segMap: Record<string, string> = {
                      account: "accounts", contact: "contacts", opportunity: "opportunities",
                      project: "execution/projects", deployment: "deployments",
                      install_workflow: "install-workflows", customer_success: "customer-success",
                      partnership: "strategy/partnerships", quote: "quotes",
                      tradeshow_event: "operations/events",
                    };
                    if (sm.objectType === "lead") {
                      softUrl = `/opportunities?selected=${sm.objectId}&tab=current`;
                    } else {
                      const seg = segMap[sm.objectType] ?? (String(sm.objectType).replace(/_/g, "-") + "s");
                      softUrl = `/${seg}/${sm.objectId}?tab=current`;
                    }
                  }
                  const softLabel = sm.channelSlug
                    ? `#${sm.channelSlug}`
                    : sm.objectType
                      ? `${String(sm.objectType).replace(/_/g, " ")} · ${sm.objectId}`
                      : null;
                  return (
                    <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs space-y-1.5" data-testid="panel-currents-source">
                      <p className="flex items-center gap-1.5 font-medium text-primary/70">
                        <Radio className="h-3.5 w-3.5" /> Created from CURRENTS AI Summary
                      </p>
                      {softUrl && softLabel && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                            {sm.channelSlug
                              ? <Hash className="h-3 w-3 shrink-0" />
                              : <MessageSquare className="h-3 w-3 shrink-0" />}
                            <span className={`font-medium truncate${sm.channelSlug ? "" : " capitalize"}`}>{softLabel}</span>
                            {sm.threadRootId && (
                              <span className="text-muted-foreground/50 shrink-0">· thread</span>
                            )}
                          </div>
                          <a
                            href={softUrl}
                            className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-medium transition-colors shrink-0"
                            data-testid="link-view-in-currents"
                          >
                            View in CURRENTS <ArrowRight className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  );
                }
                const currentsUrl = buildCurrentsUrl(sm);
                if (!currentsUrl) return null;
                const isChannel = sm.sourceContext === "currents_channel";
                // Channel slugs stay lowercase; record objectType gets capitalised
                const sourceLabel = isChannel
                  ? `#${sm.channelSlug}`
                  : sm.objectType
                    ? `${String(sm.objectType).replace(/_/g, " ")} · ${sm.objectId}`
                    : "CURRENTS";
                return (
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs space-y-1.5" data-testid="panel-currents-source">
                    <p className="flex items-center gap-1.5 font-medium text-primary/70">
                      <Radio className="h-3.5 w-3.5" /> Created from CURRENTS
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                        {isChannel
                          ? <Hash className="h-3 w-3 shrink-0" />
                          : <MessageSquare className="h-3 w-3 shrink-0" />}
                        <span className={`font-medium truncate${isChannel ? "" : " capitalize"}`}>{sourceLabel}</span>
                        {sm.threadRootId && (
                          <span className="text-muted-foreground/50 shrink-0">· thread reply</span>
                        )}
                      </div>
                      <a
                        href={currentsUrl}
                        className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-medium transition-colors shrink-0"
                        data-testid="link-view-in-currents"
                      >
                        View in CURRENTS <ArrowRight className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                );
              })()}

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
        ))}
        </div>
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

function ActionPopover({ icon, label, children, testId, active }: { icon: React.ReactNode; label: string; children: (close: () => void) => React.ReactNode; testId?: string; active?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-8 gap-1.5 ${active ? "border-primary/60 text-primary bg-primary/5" : ""}`}
          data-testid={testId}
        >
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
  const [startVal, setStartVal] = useState(task.start_date ? String(task.start_date).slice(0, 10) : "");
  const [dueVal, setDueVal] = useState(task.due_date ? String(task.due_date).slice(0, 10) : "");
  const rangeInvalid = !!startVal && !!dueVal && startVal > dueVal;
  return (
    <ActionPopover icon={<CalendarIcon className="h-3.5 w-3.5" />} label="Dates" testId="button-action-dates">
      {(close) => (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Start date</label>
            <DatePicker value={startVal} onChange={setStartVal} placeholder="Pick a start date" data-testid="input-start-date" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">End date</label>
            <DatePicker value={dueVal} onChange={setDueVal} placeholder="Pick an end date" data-testid="input-due-date" />
          </div>
          {rangeInvalid && (
            <p className="text-xs text-destructive" data-testid="text-date-range-error">
              End date can't be before start date.
            </p>
          )}
          <div className="flex gap-1">
            <Button
              size="sm"
              className="flex-1"
              disabled={rangeInvalid}
              onClick={async () => {
                await apiRequest("PATCH", `/api/tasks/${task.id}`, {
                  startDate: startVal || null,
                  dueDate: dueVal || null,
                });
                onChanged(); close();
              }}
              data-testid="button-save-due-date"
            >Save</Button>
            <Button size="sm" variant="ghost" onClick={async () => {
              await apiRequest("PATCH", `/api/tasks/${task.id}`, { startDate: null, dueDate: null });
              setStartVal(""); setDueVal(""); onChanged(); close();
            }}>Clear</Button>
          </div>
        </div>
      )}
    </ActionPopover>
  );
}

function RecurringButton({ task, onChanged }: any) {
  const [rule, setRule] = useState(task.recurrence_rule || "none");
  const [endDate, setEndDate] = useState(
    task.recurrence_end_date ? String(task.recurrence_end_date).slice(0, 10) : ""
  );
  const hasRule = task.recurrence_rule && task.recurrence_rule !== "none";
  return (
    <ActionPopover
      icon={<Repeat className="h-3.5 w-3.5" />}
      label="Repeat"
      testId="button-action-recurring"
      active={!!hasRule}
    >
      {(close) => (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Repeat</label>
            <Select value={rule} onValueChange={setRule}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-recurrence-rule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRENCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {rule !== "none" && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">End date (optional)</label>
              <DatePicker value={endDate} onChange={setEndDate} placeholder="No end date" data-testid="input-recurrence-end" />
            </div>
          )}
          <div className="flex gap-1">
            <Button
              size="sm"
              className="flex-1"
              onClick={async () => {
                await apiRequest("PATCH", `/api/tasks/${task.id}`, {
                  recurrenceRule: rule,
                  recurrenceEndDate: endDate || null,
                });
                onChanged(); close();
              }}
              data-testid="button-save-recurrence"
            >Save</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                setRule("none"); setEndDate("");
                await apiRequest("PATCH", `/api/tasks/${task.id}`, {
                  recurrenceRule: "none",
                  recurrenceEndDate: null,
                });
                onChanged(); close();
              }}
              data-testid="button-clear-recurrence"
            >Clear</Button>
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

function ParticipantsButton({ task, watchers, users, onChanged }: any) {
  const watcherIds = new Set((watchers || []).map((w: any) => w.id));
  const available = (users || []).filter((u: any) => u.id !== task.owner_user_id && !watcherIds.has(u.id));
  return (
    <ActionPopover icon={<Users className="h-3.5 w-3.5" />} label={watchers?.length ? `Shared (${watchers.length})` : "Share"} testId="button-action-participants">
      {(close) => (
        <div className="space-y-3 min-w-[220px]">
          {watchers?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Shared with</div>
              <div className="space-y-1">
                {watchers.map((w: any) => (
                  <div key={w.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-muted">
                    <span>{w.name}</span>
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove"
                      onClick={async () => { await apiRequest("DELETE", `/api/tasks/${task.id}/watchers/${w.id}`, {}); onChanged(); }}
                      data-testid={`button-remove-participant-${w.id}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {available.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Add participant</div>
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {available.map((u: any) => (
                  <button
                    key={u.id}
                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted flex items-center gap-2"
                    onClick={async () => { await apiRequest("POST", `/api/tasks/${task.id}/watchers/${u.id}`, {}); onChanged(); }}
                    data-testid={`button-add-participant-${u.id}`}
                  >
                    <Users className="h-3 w-3 text-muted-foreground" />
                    {u.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {watchers?.length === 0 && available.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-2">No other users in org</div>
          )}
        </div>
      )}
    </ActionPopover>
  );
}

function MoveButton({ task, onChanged }: any) {
  const { columns: taskColumns } = useTaskColumns();
  return (
    <ActionPopover icon={<MoveRight className="h-3.5 w-3.5" />} label="Move" testId="button-action-move">
      {(close) => (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground mb-1">Move to column</div>
          {taskColumns.map(c => (
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

function ChecklistItemRow({ item: i, onChanged, toast }: { item: any; onChanged: () => void; toast: any }) {
  const [dateOpen, setDateOpen] = useState(false);
  const [startVal, setStartVal] = useState<Date | undefined>(i.start_date ? new Date(i.start_date) : undefined);
  const [dueVal, setDueVal] = useState<Date | undefined>(i.due_date ? new Date(i.due_date) : undefined);
  const [savingDates, setSavingDates] = useState(false);

  const saveDates = async () => {
    setSavingDates(true);
    try {
      await apiRequest("PATCH", `/api/task-checklist-items/${i.id}`, {
        start_date: startVal ? format(startVal, "yyyy-MM-dd") : null,
        due_date: dueVal ? format(dueVal, "yyyy-MM-dd") : null,
      });
      onChanged();
      setDateOpen(false);
    } catch (e: any) {
      toast({ title: "Couldn't save dates", description: e.message, variant: "destructive" });
    } finally {
      setSavingDates(false);
    }
  };

  const hasStartDate = !!i.start_date;
  const hasDueDate = !!i.due_date;
  const isOverdue = hasDueDate && !i.completed && new Date(i.due_date) < new Date();

  return (
    <li className="group py-0.5" data-testid={`checklist-item-${i.id}`}>
      <div className="flex items-start gap-2">
        <Checkbox
          checked={!!i.completed}
          data-testid={`checkbox-item-${i.id}`}
          className="mt-0.5 h-4 w-4 shrink-0"
          onCheckedChange={async (c) => {
            try {
              await apiRequest("PATCH", `/api/task-checklist-items/${i.id}`, { completed: !!c });
              onChanged();
            } catch (e: any) {
              toast({ title: "Couldn't update item", description: e.message, variant: "destructive" });
            }
          }}
        />
        <div className="flex-1 min-w-0">
          <span className={`text-sm leading-snug ${i.completed ? "line-through text-muted-foreground" : ""}`}>{i.content}</span>
          {(hasStartDate || hasDueDate) && (
            <div className="flex items-center gap-3 mt-0.5">
              {hasStartDate && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <CalendarIcon className="h-2.5 w-2.5" />
                  Start: {format(new Date(i.start_date), "MMM d")}
                </span>
              )}
              {hasDueDate && (
                <span className={`text-[10px] flex items-center gap-1 ${isOverdue ? "text-red-400 font-medium" : "text-muted-foreground"}`}>
                  <CalendarIcon className="h-2.5 w-2.5" />
                  Due: {format(new Date(i.due_date), "MMM d")}
                  {isOverdue && " · overdue"}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Popover open={dateOpen} onOpenChange={(open) => {
            setDateOpen(open);
            if (open) {
              setStartVal(i.start_date ? new Date(i.start_date) : undefined);
              setDueVal(i.due_date ? new Date(i.due_date) : undefined);
            }
          }}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`text-muted-foreground hover:text-foreground transition-colors ${hasStartDate || hasDueDate ? "text-primary" : ""}`}
                data-testid={`button-dates-item-${i.id}`}
                title="Set dates"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-4 space-y-3">
              <p className="text-xs font-semibold text-foreground">Item dates</p>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Start date <span className="opacity-60">(optional)</span></label>
                <DatePicker value={startVal} onChange={setStartVal} placeholder="Pick a start date" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Due date <span className="opacity-60">(optional)</span></label>
                <DatePicker value={dueVal} onChange={setDueVal} placeholder="Pick a due date" />
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="flex-1" onClick={saveDates} disabled={savingDates} data-testid={`button-save-dates-item-${i.id}`}>
                  {savingDates ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDateOpen(false)}>Cancel</Button>
              </div>
            </PopoverContent>
          </Popover>
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive transition-colors"
            onClick={async () => {
              try {
                await apiRequest("DELETE", `/api/task-checklist-items/${i.id}`);
                onChanged();
              } catch (e: any) {
                toast({ title: "Couldn't remove item", description: e.message, variant: "destructive" });
              }
            }}
            data-testid={`button-delete-item-${i.id}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

function ChecklistBlock({ checklist, onChanged }: any) {
  const [newItem, setNewItem] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const total = checklist.items.length;
  const done = checklist.items.filter((i: any) => i.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const addItem = async () => {
    const content = newItem.trim();
    if (!content) return;
    setSaving(true);
    try {
      await apiRequest("POST", `/api/task-checklists/${checklist.id}/items`, { content });
      setNewItem("");
      onChanged();
    } catch (e: any) {
      toast({ title: "Couldn't add item", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={checklist.title} icon={<ListChecks className="h-4 w-4" />}>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-10 tabular-nums">{pct}%</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <button
            type="button"
            className="text-xs hover:text-destructive ml-2"
            onClick={async () => {
              if (confirm("Delete this checklist?")) {
                try {
                  await apiRequest("DELETE", `/api/task-checklists/${checklist.id}`);
                  onChanged();
                } catch (e: any) {
                  toast({ title: "Couldn't delete checklist", description: e.message, variant: "destructive" });
                }
              }
            }}
            data-testid={`button-delete-checklist-${checklist.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {total === 0 ? (
          <p className="text-xs text-muted-foreground italic py-1">
            No items yet — type below and press Enter or click + to add one.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {checklist.items.map((i: any) => (
              <ChecklistItemRow key={i.id} item={i} onChanged={onChanged} toast={toast} />
            ))}
          </ul>
        )}

        <div className="flex gap-1">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addItem(); }
            }}
            placeholder="Add an item…"
            className="h-8 text-sm"
            data-testid={`input-new-item-${checklist.id}`}
          />
          <Button
            type="button"
            size="sm"
            disabled={!newItem.trim() || saving}
            onClick={addItem}
            data-testid={`button-add-item-${checklist.id}`}
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
    case "created": return "created this task";
    case "assigned": return `assigned to ${to || "—"}`;
    case "reassigned": return `reassigned from ${from || "—"} to ${to || "—"}`;
    default:
      if (action.startsWith("updated_")) {
        const field = action.slice(8).replace(/_/g, " ");
        if (from && to) return `changed ${field} from "${from}" to "${to}"`;
        if (to) return `changed ${field} to "${to}"`;
        if (from) return `cleared ${field} (was "${from}")`;
        return `changed ${field}`;
      }
      return action;
  }
}

// ── AttachmentsBlock ────────────────────────────────────────────────────────
function formatBytes(n?: number | null): string {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isImageMime(m?: string | null): boolean {
  return !!m && m.toLowerCase().startsWith("image/");
}
function isVideoMime(m?: string | null): boolean {
  return !!m && m.toLowerCase().startsWith("video/");
}

function AttachmentIcon({ mime }: { mime?: string | null }) {
  if (isImageMime(mime)) return <FileImage className="h-4 w-4 text-blue-500" />;
  if (isVideoMime(mime)) return <FileVideo className="h-4 w-4 text-purple-500" />;
  if (mime === "application/pdf") return <FileText className="h-4 w-4 text-red-500" />;
  if (mime?.includes("word") || mime?.includes("document")) return <FileText className="h-4 w-4 text-blue-600" />;
  if (mime?.includes("sheet") || mime?.includes("excel") || mime === "text/csv") return <FileText className="h-4 w-4 text-emerald-600" />;
  return <FileIcon className="h-4 w-4 text-muted-foreground" />;
}

function AttachmentsBlock({
  attachments,
  uploading,
  onUpload,
  onDeleted,
}: {
  attachments: any[];
  uploading: boolean;
  onUpload: (files: FileList | File[]) => void | Promise<void>;
  onDeleted: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [zoneActive, setZoneActive] = useState(false);
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const onZoneDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    setZoneActive(true);
  };
  const onZoneDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };
  const onZoneDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setZoneActive(false);
  };
  const onZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setZoneActive(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) onUpload(files);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Remove "${name}" from this task?`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/attachments/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        toast({
          title: "Couldn't delete attachment",
          description: msg.slice(0, 200) || `HTTP ${res.status}`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Attachment removed" });
        onDeleted();
      }
    } catch (e: any) {
      toast({ title: "Couldn't delete attachment", description: e?.message || "Network error", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-2">
      <div
        className={[
          "rounded-md border-2 border-dashed transition-colors px-3 py-3 text-xs flex items-center justify-between gap-3",
          zoneActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 bg-muted/20 hover:bg-muted/40",
          uploading ? "opacity-70" : "",
        ].join(" ")}
        onDragEnter={onZoneDragEnter}
        onDragOver={onZoneDragOver}
        onDragLeave={onZoneDragLeave}
        onDrop={onZoneDrop}
        data-testid="zone-task-attachments"
      >
        <div className="flex items-center gap-2 text-muted-foreground">
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UploadCloud className="h-4 w-4" />
          )}
          <span>
            {uploading
              ? "Uploading…"
              : "Drag files here, or"}
          </span>
          {!uploading && (
            <button
              type="button"
              className="text-primary hover:underline font-medium"
              onClick={() => inputRef.current?.click()}
              data-testid="button-task-attach-browse"
            >
              browse
            </button>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">Up to 50 MB · images, video, PDF, Office, CSV, ZIP</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) onUpload(files);
            if (inputRef.current) inputRef.current.value = "";
          }}
          data-testid="input-task-attach-file"
        />
      </div>

      {attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1">No attachments yet.</p>
      ) : (
        <ul className="space-y-1.5" data-testid="list-task-attachments">
          {attachments.map((a) => {
            const fileUrl = a.fileName ? `/api/attachments/file/${encodeURIComponent(a.fileName)}` : null;
            const showImage = isImageMime(a.mimeType) && fileUrl;
            const dt = a.createdAt ? fmtDateTime(a.createdAt) : null;
            return (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-md border bg-card px-2.5 py-2 hover-elevate"
                data-testid={`row-task-attachment-${a.id}`}
              >
                {showImage ? (
                  <a href={fileUrl!} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <img
                      src={fileUrl!}
                      alt={a.title || a.originalName || "attachment"}
                      className="h-12 w-12 object-cover rounded border"
                      data-testid={`img-task-attachment-${a.id}`}
                    />
                  </a>
                ) : (
                  <div className="h-12 w-12 rounded border bg-muted flex items-center justify-center shrink-0">
                    <AttachmentIcon mime={a.mimeType} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm truncate">
                    <span className="font-medium truncate" data-testid={`text-task-attachment-name-${a.id}`}>
                      {a.title || a.originalName || a.fileName || "Untitled"}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <span>{formatBytes(a.fileSize)}</span>
                    {a.uploadedByName && <><span>·</span><span>by {a.uploadedByName}</span></>}
                    {dt && <><span>·</span><span>{dt}</span></>}
                  </div>
                </div>
                {fileUrl && (
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground p-1.5 rounded hover-elevate"
                    title="Open / download"
                    data-testid={`link-task-attachment-download-${a.id}`}
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(a.id, a.title || a.originalName || a.fileName || "this file")}
                  disabled={deletingId === a.id}
                  className="text-muted-foreground hover:text-destructive p-1.5 rounded hover-elevate disabled:opacity-50"
                  title="Remove"
                  data-testid={`button-task-attachment-delete-${a.id}`}
                >
                  {deletingId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── CrmLinkCombobox ─────────────────────────────────────────────────────────
// Searchable dropdown for linking a task to a Contact or Lead / Account.
// Calls onChange(null) to clear, or onChange({ id, label, kind }) to set.

function CrmLinkCombobox({
  type,
  value,
  onChange,
  disabled,
}: {
  type: "contact" | "account";
  value: { id: number; label: string; kind?: "account" | "lead" } | null;
  onChange: (v: { id: number; label: string; kind?: "account" | "lead" } | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const contactQ = useQuery<any[]>({
    queryKey: ["/api/contacts", "task-link", debounced],
    queryFn: () =>
      fetch(`/api/contacts?search=${encodeURIComponent(debounced)}`, { credentials: "include" })
        .then((r) => r.json()),
    enabled: open && type === "contact",
    staleTime: 15000,
  });
  const accountQ = useQuery<any>({
    queryKey: ["/api/accounts", "task-link", debounced],
    queryFn: () =>
      fetch(`/api/accounts?search=${encodeURIComponent(debounced)}&limit=20&onlyPromoted=false`, { credentials: "include" })
        .then((r) => r.json()),
    enabled: open && type === "account",
    staleTime: 15000,
  });
  const leadsQ = useQuery<any>({
    queryKey: ["/api/leads", "task-link", debounced],
    queryFn: () =>
      fetch(`/api/leads?search=${encodeURIComponent(debounced)}&limit=20`, { credentials: "include" })
        .then((r) => r.json()),
    enabled: open && type === "account",
    staleTime: 15000,
  });

  const isFetching = type === "contact" ? contactQ.isFetching : (accountQ.isFetching || leadsQ.isFetching);

  const items: { id: number; label: string; sub?: string; kind?: "account" | "lead" }[] =
    type === "contact"
      ? (contactQ.data ?? []).map((c: any) => ({ id: c.id, label: c.name, sub: c.email }))
      : [
          ...(leadsQ.data?.data ?? []).map((l: any) => ({
            id: l.id,
            label: l.company || `Lead #${l.id}`,
            sub: "Lead" + (l.contact_name ? ` · ${l.contact_name}` : ""),
            kind: "lead" as const,
          })),
          ...(accountQ.data?.data ?? []).map((a: any) => ({
            id: a.id,
            label: a.name,
            sub: "Account" + (a.orgType ? ` · ${a.orgType.replace(/_/g, " ")}` : ""),
            kind: "account" as const,
          })),
        ];

  const placeholder = type === "contact" ? "Search contacts…" : "Search leads & accounts…";

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1 min-w-0 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
          disabled={disabled}
        >
          {value ? (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-background hover:bg-accent max-w-[160px]">
              <span className="flex-1 truncate font-medium">{value.label}</span>
              <span
                className="text-muted-foreground hover:text-foreground ml-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
              >
                <X className="h-3 w-3" />
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-primary hover:underline px-1 py-0.5 rounded">
              <Plus className="h-3 w-3" />
              {type === "contact" ? "Link contact" : "Link lead / account"}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <Input
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 mb-2 text-sm"
          autoFocus
        />
        {isFetching && (
          <div className="text-center py-2 text-xs text-muted-foreground flex items-center justify-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Searching…
          </div>
        )}
        <div className="max-h-52 overflow-y-auto space-y-0.5">
          {!isFetching && items.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              {debounced ? "No results found" : "Type to search…"}
            </p>
          )}
          {items.map((r) => (
            <button
              key={r.id}
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent"
              onClick={() => {
                onChange(r);
                setOpen(false);
                setSearch("");
              }}
            >
              <div className="font-medium truncate">{r.label}</div>
              {r.sub && <div className="text-xs text-muted-foreground truncate">{r.sub}</div>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── NewTaskForm ─────────────────────────────────────────────────────────────
// Displayed inside the Sheet when the drawer is opened in createMode.
// All key task fields are shown upfront — the user came to the Task Hub
// intentionally, so we give them the full creation form, not a quick capture.

function NewTaskForm({ onCreated, onCancel, defaultBoardColumn }: { onCreated: (id: number) => void; onCancel: () => void; defaultBoardColumn?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { columns: cols } = useTaskColumns();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [column, setColumn] = useState(defaultBoardColumn || "backlog");
  const [ownerUserId, setOwnerUserId] = useState<string>("me");
  const [linkedContact, setLinkedContact] = useState<{ id: number; label: string } | null>(null);
  const [linkedAccount, setLinkedAccount] = useState<{ id: number; label: string } | null>(null);
  const [recurrenceRule, setRecurrenceRule] = useState("none");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [isTeamTask, setIsTeamTask] = useState(false);

  const { data: me } = useQuery<{ id: number; name: string }>({ queryKey: ["/api/auth/me"] });
  const { data: users = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ["/api/users"] });

  const resolvedOwner = ownerUserId === "me" ? (me?.id ?? null) : Number(ownerUserId);

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tasks", {
        title: title.trim(),
        description: description.trim() || null,
        dueDate: dueDate || null,
        priority,
        status: "pending",
        boardColumn: column,
        ownerUserId: resolvedOwner,
        isTeamTask,
        ...(linkedContact ? { contactId: linkedContact.id } : {}),
        ...(linkedAccount?.kind === "lead"
          ? { linkedObjectType: "lead", linkedObjectId: linkedAccount.id, accountId: null }
          : linkedAccount
            ? { accountId: linkedAccount.id }
            : {}),
        recurrenceRule,
        ...(recurrenceRule !== "none" && recurrenceEndDate ? { recurrenceEndDate } : {}),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/tasks/board"] });
      qc.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
      toast({ title: "Task created" });
      onCreated(data.id);
    },
    onError: (e: any) => toast({ title: "Failed to create task", description: e.message, variant: "destructive" }),
  });

  const canSubmit = title.trim().length > 0 && !createMut.isPending;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Flag className="h-5 w-5 text-primary" />
          New Task
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Fill in as much detail as you need, then create the task.</p>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Task title <span className="text-destructive">*</span></label>
          <Input
            autoFocus
            placeholder="What needs to get done?"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && canSubmit) createMut.mutate(); }}
            className="text-base"
            data-testid="input-new-task-title"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Description</label>
          <Textarea
            placeholder="Add context, links, or acceptance criteria…"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            className="resize-none"
            data-testid="input-new-task-description"
          />
        </div>

        {/* Due date + Priority */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" /> Due date
            </label>
            <DatePicker value={dueDate} onChange={setDueDate} data-testid="input-new-task-due-date" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" /> Priority
            </label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="h-9" data-testid="select-new-task-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map(p => (
                  <SelectItem key={p} value={p}>
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${PRIORITY_META[p]?.dot}`} />
                      {PRIORITY_META[p]?.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Board column + Assignee */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <MoveRight className="h-3.5 w-3.5 text-muted-foreground" /> Board column
            </label>
            <Select value={column} onValueChange={setColumn}>
              <SelectTrigger className="h-9" data-testid="select-new-task-column">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cols.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" /> Assign to
            </label>
            <Select value={ownerUserId} onValueChange={setOwnerUserId}>
              <SelectTrigger className="h-9" data-testid="select-new-task-assignee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="me">Me ({me?.name ?? "…"})</SelectItem>
                {users.filter(u => u.id !== me?.id).map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Team Task */}
        <div className="flex items-center gap-2 rounded-md border p-3 bg-muted/20">
          <Checkbox
            id="new-task-team-task"
            checked={isTeamTask}
            onCheckedChange={(v) => setIsTeamTask(v === true)}
            data-testid="checkbox-new-task-team-task"
          />
          <label htmlFor="new-task-team-task" className="text-sm cursor-pointer select-none">
            <span className="font-medium">Team Task</span>
            <span className="block text-xs text-muted-foreground">
              Visible to everyone on the Team Tasks board, lands in the assignee's Backlog, and stays on the Team board no matter which column it's moved to.
            </span>
          </label>
        </div>

        {/* CRM Links */}
        <div className="space-y-2 pt-1">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" /> CRM Links
            <span className="text-muted-foreground font-normal text-xs">(optional)</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <UserCircle className="h-3 w-3" /> Contact
              </p>
              <div className="border rounded-md px-2 py-1.5 bg-background min-h-[34px] flex items-center">
                <CrmLinkCombobox
                  type="contact"
                  value={linkedContact}
                  onChange={setLinkedContact}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Building2 className="h-3 w-3" /> Lead / Account
              </p>
              <div className="border rounded-md px-2 py-1.5 bg-background min-h-[34px] flex items-center">
                <CrmLinkCombobox
                  type="account"
                  value={linkedAccount}
                  onChange={setLinkedAccount}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Recurrence */}
        <div className="space-y-2 pt-1">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <Repeat className="h-3.5 w-3.5 text-muted-foreground" /> Repeat
            <span className="text-muted-foreground font-normal text-xs">(optional)</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Select value={recurrenceRule} onValueChange={setRecurrenceRule}>
              <SelectTrigger className="h-9" data-testid="select-new-task-recurrence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRENCE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {recurrenceRule !== "none" && (
              <DatePicker
                value={recurrenceEndDate}
                onChange={setRecurrenceEndDate}
                placeholder="End date (optional)"
                data-testid="input-new-task-recurrence-end"
              />
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t flex items-center justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onCancel} data-testid="button-new-task-cancel">
          Cancel
        </Button>
        <Button
          size="sm"
          className="gap-1.5 min-w-[120px]"
          onClick={() => createMut.mutate()}
          disabled={!canSubmit}
          data-testid="button-new-task-create"
        >
          {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create Task
        </Button>
      </div>
    </div>
  );
}
