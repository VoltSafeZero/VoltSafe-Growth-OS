// client/src/components/today/ceo-action-queue.tsx
// CEO Cockpit Phase 6 — Action Queue, Follow-Up, and Accountability Trail
// Admin-only. No auto-send. No email. Draft = copy only.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Zap, Plus, Copy, Check, CheckCheck, X, Clock, ChevronDown,
  Loader2, AlertCircle, ListTodo, ExternalLink,
} from "lucide-react";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CeoAction {
  id: number;
  type: string;
  status: string;
  priority: string;
  source_section: string | null;
  source_type: string | null;
  source_id: string | null;
  assigned_to_user_id: number | null;
  assigned_to_name: string | null;
  created_by_user_id: number;
  title: string;
  body: string | null;
  suggested_message: string | null;
  due_at: string | null;
  snoozed_until: string | null;
  completed_at: string | null;
  dismissed_reason: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  ask_for_update: "Ask for Update",
  create_task: "Create Task",
  follow_up: "Follow Up",
  resolve_blocker: "Resolve Blocker",
  schedule_1on1: "Schedule 1:1",
  review_commitment: "Review Commitment",
};

const SECTION_LABELS: Record<string, string> = {
  team_pulse: "Team Pulse",
  blockers: "Blockers",
  silence_watch: "Silence Watch",
  commitments: "Commitments",
  one_on_ones: "1:1s",
  ceo_attention: "CEO Attention",
  communication_hotspots: "Hotspots",
};

const PRIORITY_STYLES: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-400",
  medium: "bg-amber-400",
  low: "bg-slate-400",
};

const STATUS_FILTERS = [
  { key: "open", label: "Open" },
  { key: "high_priority", label: "High Priority" },
  { key: "snoozed", label: "Snoozed" },
  { key: "completed", label: "Completed" },
  { key: "dismissed", label: "Dismissed" },
];

const SNOOZE_OPTIONS = [
  { label: "Tomorrow", hours: 24 },
  { label: "In 3 days", hours: 72 },
  { label: "Next week", hours: 168 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAgo(s: string | null | undefined): string {
  if (!s) return "";
  const h = Math.floor((Date.now() - new Date(s).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("en-CA", { month: "short", day: "numeric" }); } catch { return ""; }
}

// ── Queue Action Button (exported for use in sections) ─────────────────────

export interface QueueActionInput {
  type: string;
  priority?: string;
  source_section?: string;
  source_type?: string;
  source_id?: string;
  assigned_to_user_id?: number | null;
  title: string;
  body?: string;
  suggested_message?: string;
}

export function QueueActionButton({ label, data, testId, icon: Icon = Plus }: {
  label: string;
  data: QueueActionInput;
  testId?: string;
  icon?: React.ElementType;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/today/ceo-actions", data),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/today/ceo-actions"] });
      toast({ title: "Added to Action Queue" });
    },
    onError: (err: any) => {
      if (err?.message?.includes("duplicate") || err?.status === 409) {
        toast({ title: "Already in queue" });
      } else {
        toast({ title: "Failed to add to queue", variant: "destructive" });
      }
    },
  });

  return (
    <Button
      size="sm" variant="ghost"
      className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
      onClick={() => mut.mutate()}
      disabled={mut.isPending || mut.isSuccess}
      data-testid={testId ?? "queue-action-btn"}
    >
      {mut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : mut.isSuccess ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
      {mut.isSuccess ? "Queued" : label}
    </Button>
  );
}

// ── Update Draft Sheet ─────────────────────────────────────────────────────

function ActionDraftSheet({ action, isOpen, onClose }: {
  action: CeoAction;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const draftQuery = useQuery<{ draftText: string; dmConversationId: number | null; currentsLink: string | null }>({
    queryKey: ["/api/today/ceo-actions", action.id, "update-draft"],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/today/ceo-actions/${action.id}/update-draft`, {});
      return res;
    },
    enabled: isOpen,
    staleTime: 60000,
  });

  async function handleCopy() {
    const text = draftQuery.data?.draftText ?? action.suggested_message ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Draft copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed — select and copy manually", variant: "destructive" });
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-96 max-w-full" data-testid="action-draft-sheet">
        <SheetHeader>
          <SheetTitle className="text-sm">Update Draft — {action.title}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Review and copy. Nothing is sent automatically.
          </p>
          {draftQuery.isLoading ? (
            <div className="flex items-center gap-2 py-4"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-xs">Preparing…</span></div>
          ) : (
            <Textarea
              defaultValue={draftQuery.data?.draftText ?? action.suggested_message ?? ""}
              rows={5}
              className="text-xs resize-none"
              data-testid="action-draft-text"
            />
          )}
          <div className="flex gap-2">
            <Button onClick={handleCopy} size="sm" className="flex-1" data-testid="action-draft-copy-btn"
              disabled={draftQuery.isLoading}>
              {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? "Copied!" : "Copy to Clipboard"}
            </Button>
            {draftQuery.data?.currentsLink && (
              <Link href={draftQuery.data.currentsLink}>
                <Button size="sm" variant="outline" data-testid="action-draft-open-currents">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open DM
                </Button>
              </Link>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            This will not be sent automatically. Paste it manually in Currents.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Action Card ───────────────────────────────────────────────────────────────

function ActionCard({ action, onRefresh }: { action: CeoAction; onRefresh: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showDraft, setShowDraft] = useState(false);

  function makeMut(url: string, body: object = {}) {
    return useMutation({
      mutationFn: () => apiRequest("POST", url, body),
      onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["/api/today/ceo-actions"] }); onRefresh(); },
      onError: (e: any) => toast({ title: e?.message ?? "Failed", variant: "destructive" }),
    });
  }

  const completeMut = makeMut(`/api/today/ceo-actions/${action.id}/complete`);
  const dismissMut = makeMut(`/api/today/ceo-actions/${action.id}/dismiss`, { reason: "Manually dismissed" });
  const taskMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/today/ceo-actions/${action.id}/create-task`, {}),
    onSuccess: async (res: any) => {
      await qc.invalidateQueries({ queryKey: ["/api/today/ceo-actions"] });
      toast({ title: `Task #${res.taskId} created` });
      onRefresh();
    },
    onError: (e: any) => toast({ title: e?.message ?? "Failed to create task", variant: "destructive" }),
  });

  const isTerminal = action.status === "completed" || action.status === "dismissed";

  function snooze(hours: number) {
    const until = new Date(Date.now() + hours * 3600000).toISOString();
    apiRequest("POST", `/api/today/ceo-actions/${action.id}/snooze`, { snoozed_until: until })
      .then(() => { qc.invalidateQueries({ queryKey: ["/api/today/ceo-actions"] }); onRefresh(); })
      .catch((e: any) => toast({ title: e?.message ?? "Failed to snooze", variant: "destructive" }));
  }

  const alreadyHasTask = !!action.metadata?.created_task_id;

  return (
    <>
      <div
        className={`rounded-md border overflow-hidden transition-colors ${
          action.priority === "critical" ? "border-red-500/30 bg-red-500/5" :
          action.priority === "high" ? "border-orange-500/20 bg-card/30" :
          "border-border/30 bg-card/30"
        } ${isTerminal ? "opacity-50" : ""}`}
        data-testid={`action-card-${action.id}`}
      >
        <div className="px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 mt-1.5 ${PRIORITY_DOT[action.priority] ?? "bg-slate-400"}`} />
              <div className="min-w-0">
                <p className="text-xs font-medium leading-tight line-clamp-2">{action.title}</p>
                {action.body && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{action.body}</p>
                )}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className={`inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_STYLES[action.priority] ?? PRIORITY_STYLES.medium}`}
                    data-testid={`action-priority-${action.id}`}>
                    {action.priority}
                  </span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1 font-normal" data-testid={`action-type-${action.id}`}>
                    {TYPE_LABELS[action.type] ?? action.type}
                  </Badge>
                  {action.source_section && (
                    <Badge variant="secondary" className="text-[9px] h-4 px-1 font-normal" data-testid={`action-section-${action.id}`}>
                      {SECTION_LABELS[action.source_section] ?? action.source_section}
                    </Badge>
                  )}
                  {action.assigned_to_name && (
                    <span className="text-[10px] text-muted-foreground">{action.assigned_to_name}</span>
                  )}
                  {action.due_at && (
                    <span className="text-[10px] text-muted-foreground/70">due {fmtDate(action.due_at)}</span>
                  )}
                  {action.status === "snoozed" && action.snoozed_until && (
                    <span className="text-[10px] text-blue-400">snoozed until {fmtDate(action.snoozed_until)}</span>
                  )}
                  {action.status === "completed" && (
                    <span className="text-[10px] text-emerald-400">completed {fmtAgo(action.completed_at)}</span>
                  )}
                  {action.status === "dismissed" && action.dismissed_reason && (
                    <span className="text-[10px] text-muted-foreground/50">dismissed: {action.dismissed_reason}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground/40">{fmtAgo(action.created_at)}</span>
                </div>
              </div>
            </div>
          </div>

          {!isTerminal && (
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {(action.suggested_message || action.type === "ask_for_update" || action.type === "follow_up") && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
                  onClick={() => setShowDraft(true)}
                  data-testid={`action-copy-draft-${action.id}`}>
                  <Copy className="h-2.5 w-2.5" /> Copy Draft
                </Button>
              )}
              {!alreadyHasTask && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
                  onClick={() => taskMut.mutate()} disabled={taskMut.isPending}
                  data-testid={`action-create-task-${action.id}`}>
                  {taskMut.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ListTodo className="h-2.5 w-2.5" />}
                  {taskMut.isPending ? "Creating…" : "Create Task"}
                </Button>
              )}
              {alreadyHasTask && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-0.5 px-1">
                  <Check className="h-2.5 w-2.5" /> Task created
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" data-testid={`action-snooze-${action.id}`}>
                    <Clock className="h-2.5 w-2.5" /> Snooze <ChevronDown className="h-2 w-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="text-xs">
                  {SNOOZE_OPTIONS.map(opt => (
                    <DropdownMenuItem key={opt.hours} onClick={() => snooze(opt.hours)}
                      data-testid={`snooze-option-${opt.hours}`}>
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-emerald-400 hover:text-emerald-300"
                onClick={() => completeMut.mutate()} disabled={completeMut.isPending}
                data-testid={`action-complete-${action.id}`}>
                {completeMut.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCheck className="h-2.5 w-2.5" />}
                Complete
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground/60"
                onClick={() => dismissMut.mutate()} disabled={dismissMut.isPending}
                data-testid={`action-dismiss-${action.id}`}>
                {dismissMut.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <X className="h-2.5 w-2.5" />}
                Dismiss
              </Button>
            </div>
          )}
        </div>
      </div>

      {showDraft && (
        <ActionDraftSheet action={action} isOpen={showDraft} onClose={() => setShowDraft(false)} />
      )}
    </>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function CeoActionQueuePanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("open");

  const actionsQuery = useQuery<{ actions: CeoAction[] }>({
    queryKey: ["/api/today/ceo-actions", { status: statusFilter }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/today/ceo-actions?status=${statusFilter}`, undefined);
      return res;
    },
    staleTime: 30000,
  });

  const generateMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/today/ceo-actions/generate", {}),
    onSuccess: async (res: any) => {
      await qc.invalidateQueries({ queryKey: ["/api/today/ceo-actions"] });
      const { created, deduped } = res;
      if (created === 0) toast({ title: `No new actions — ${deduped} already in queue` });
      else toast({ title: `${created} action${created !== 1 ? "s" : ""} suggested${deduped ? ` (${deduped} already queued)` : ""}` });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Generation failed", variant: "destructive" }),
  });

  const actions = actionsQuery.data?.actions ?? [];
  const openCount = actions.filter(a => a.status === "queued" || a.status === "draft").length;

  function handleRefresh() {
    qc.invalidateQueries({ queryKey: ["/api/today/ceo-actions"] });
  }

  return (
    <div className="space-y-3" data-testid="ceo-action-queue-panel">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Action Queue</span>
          {openCount > 0 && (
            <Badge className="h-5 px-1.5 text-[10px]" data-testid="action-queue-open-count">{openCount} open</Badge>
          )}
        </div>
        <Button
          size="sm" variant="outline" className="h-7 text-xs gap-1.5"
          onClick={() => generateMut.mutate()} disabled={generateMut.isPending}
          data-testid="generate-actions-btn"
        >
          {generateMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          {generateMut.isPending ? "Generating…" : "Generate Suggested"}
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 flex-wrap" data-testid="action-filter-chips">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
              statusFilter === f.key
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-card/40 border-border/30 text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`filter-chip-${f.key}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Actions list */}
      {actionsQuery.isLoading && (
        <div className="flex justify-center py-6" data-testid="action-queue-loading">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {actionsQuery.isError && (
        <div className="py-4 text-center" data-testid="action-queue-error">
          <AlertCircle className="h-4 w-4 text-destructive mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">Failed to load action queue</p>
        </div>
      )}
      {actionsQuery.data && (
        <div className="space-y-2" data-testid="action-queue-list">
          {actions.length === 0 ? (
            <div className="text-center py-6" data-testid="action-queue-empty">
              <CheckCheck className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                {statusFilter === "open" ? "No open actions. Click Generate to suggest some." : `No ${statusFilter} actions.`}
              </p>
            </div>
          ) : (
            actions.map(action => (
              <ActionCard key={action.id} action={action} onRefresh={handleRefresh} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
