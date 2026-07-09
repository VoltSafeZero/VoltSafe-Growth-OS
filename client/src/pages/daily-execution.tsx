import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UniversalDrilldownSheet, type UniversalDrilldownConfig } from "@/components/shared/universal-drilldown-sheet";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CheckCircle2, Clock, AlertTriangle, Bell, Users, Sparkles,
  Search, RefreshCw, ChevronRight, Building2, Zap, SlidersHorizontal,
  TrendingUp, Calendar, MoreHorizontal, CircleCheck, X,
  Mic, Square, Download, Loader2, ChevronDown, Globe, Lock,
} from "lucide-react";

interface ExecutionTask {
  id: number;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  reminder_count: number;
  escalation_level: number;
  source: string | null;
  source_label: string | null;
  account_id: number | null;
  linked_object_type: string | null;
  linked_object_id: number | null;
  owner_user_id: number | null;
  owner_name: string | null;
  account_name: string | null;
  days_overdue?: number;
}

interface TodayData {
  mustDoToday: ExecutionTask[];
  overdue: ExecutionTask[];
  newlyAssigned: ExecutionTask[];
  awaitingReply: ExecutionTask[];
  recentlyCompleted: ExecutionTask[];
  suggestionsReady: number;
  meta: {
    counts: {
      mustDoToday: number;
      overdue: number;
      newlyAssigned: number;
      awaitingReply: number;
      recentlyCompleted: number;
    };
  };
}

interface SummaryData {
  totalOpen: number;
  overdueCount: number;
  dueToday: number;
  completionRateLast7d: number;
  avgAgeOfOpenTasksDays: number;
  topBlockedOwners: { owner_name: string; overdue_count: number }[];
  topStaleLinkedRecords: { record_name: string; task_count: number }[];
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-400",
  low: "bg-slate-400",
};

function daysOverdueLabel(task: ExecutionTask): string | null {
  if (!task.due_date) return null;
  const days = Math.floor((Date.now() - new Date(task.due_date).getTime()) / 86_400_000);
  if (days <= 0) return null;
  return `${days}d overdue`;
}

function PriorityDot({ priority }: { priority: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1.5 ${PRIORITY_COLORS[priority] ?? "bg-slate-400"}`}
      title={priority}
    />
  );
}

function EscalationBadge({ level }: { level: number }) {
  if (!level) return null;
  return (
    <Badge variant="destructive" className="text-[10px] py-0 px-1.5 gap-0.5">
      <Zap className="w-2.5 h-2.5" /> L{level}
    </Badge>
  );
}

function ReminderBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground">
      <Bell className="w-2.5 h-2.5 mr-0.5" />{count}
    </Badge>
  );
}

function TaskRow({
  task,
  selected,
  onSelect,
  onComplete,
  onRemind,
  onSnooze,
  showOwner = false,
}: {
  task: ExecutionTask;
  selected: boolean;
  onSelect: (id: number, val: boolean) => void;
  onComplete: (id: number) => void;
  onRemind: (id: number) => void;
  onSnooze: (id: number, days: number) => void;
  showOwner?: boolean;
}) {
  const overdueLabel = daysOverdueLabel(task);

  return (
    <div
      data-testid={`task-row-${task.id}`}
      className={`flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/40 group transition-colors ${selected ? "bg-muted/60" : ""}`}
    >
      <Checkbox
        data-testid={`checkbox-task-${task.id}`}
        checked={selected}
        onCheckedChange={(v) => onSelect(task.id, Boolean(v))}
        className="mt-1"
      />

      <PriorityDot priority={task.priority} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{task.title}</span>
          {overdueLabel && (
            <Badge variant="destructive" className="text-[10px] py-0 px-1.5">{overdueLabel}</Badge>
          )}
          <EscalationBadge level={task.escalation_level} />
          <ReminderBadge count={task.reminder_count} />
          {task.source && task.source !== "manual" && (
            <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{task.source_label ?? task.source}</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
          {task.account_name && (
            <span className="flex items-center gap-0.5">
              <Building2 className="w-3 h-3" />
              {task.account_name}
            </span>
          )}
          {showOwner && task.owner_name && (
            <span className="flex items-center gap-0.5">
              <Users className="w-3 h-3" />
              {task.owner_name}
            </span>
          )}
          {task.due_date && (
            <span className="flex items-center gap-0.5">
              <Calendar className="w-3 h-3" />
              {new Date(task.due_date).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid={`btn-complete-${task.id}`}
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-green-500 hover:text-green-400"
                onClick={() => onComplete(task.id)}
              >
                <CircleCheck className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mark complete</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid={`btn-remind-${task.id}`}
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-yellow-500 hover:text-yellow-400"
                onClick={() => onRemind(task.id)}
              >
                <Bell className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Send reminder</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid={`btn-snooze-${task.id}`}
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-blue-400 hover:text-blue-300"
                onClick={() => onSnooze(task.id, 1)}
              >
                <Clock className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Snooze 1 day</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
  accent,
  defaultOpen = true,
}: {
  icon: React.ElementType;
  title: string;
  count: number;
  children: React.ReactNode;
  accent?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-xl border bg-card ${accent ?? ""}`}>
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
        data-testid={`section-toggle-${title.replace(/\s/g, "-").toLowerCase()}`}
      >
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium text-sm flex-1">{title}</span>
        <Badge variant="secondary" className="text-xs">{count}</Badge>
        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

type DailyDownload = {
  id: number;
  user_id: number;
  user_name: string;
  date: string;
  title: string | null;
  status: string;
  visibility: string;
  transcript: string | null;
  summary_bullets: string[] | null;
  wins: string[] | null;
  blockers: string[] | null;
  follow_ups: string[] | null;
  duration_seconds: number | null;
  chunk_count: number;
  created_at: string;
};

type DlUiState = "idle" | "requesting" | "recording" | "processing" | "done" | "failed";

function MyDailyDownload() {
  const { toast } = useToast();
  const [uiState, setUiState] = useState<DlUiState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: today, refetch: refetchToday } = useQuery<DailyDownload | null>({
    queryKey: ["/api/daily-downloads/today"],
    staleTime: 30_000,
    refetchInterval: uiState === "processing" ? 4000 : false,
  });

  const { data: recent = [] } = useQuery<DailyDownload[]>({
    queryKey: ["/api/daily-downloads/recent"],
    staleTime: 120_000,
  });

  useEffect(() => {
    if (!today) return;
    if (today.status === "completed" && uiState !== "done") {
      setUiState("done");
      queryClient.invalidateQueries({ queryKey: ["/api/daily-downloads/recent"] });
    } else if (today.status === "failed" && uiState !== "failed") {
      setUiState("failed");
    }
  }, [today?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/daily-downloads", { visibility: "team" }),
    onSuccess: async (res) => {
      const dl: DailyDownload = await res.json();
      await apiRequest("POST", `/api/daily-downloads/${dl.id}/start`);
      setActiveId(dl.id);
      await beginRecording(dl.id);
      refetchToday();
    },
    onError: () => toast({ title: "Failed to create daily download", variant: "destructive" }),
  });

  async function beginRecording(dlId: number) {
    setUiState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      mrRef.current = mr;
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

      mr.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          try {
            await fetch(`/api/daily-downloads/${dlId}/audio-chunk`, {
              method: "POST",
              headers: { "Content-Type": "audio/webm" },
              body: e.data,
            });
          } catch { /* non-fatal */ }
        }
      };

      mr.onstop = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach(t => t.stop());
        setUiState("processing");
        try {
          await apiRequest("POST", `/api/daily-downloads/${dlId}/stop`);
        } catch {
          setUiState("failed");
        }
        refetchToday();
      };

      mr.start(1500);
      setUiState("recording");
    } catch {
      setUiState("idle");
      toast({ title: "Microphone access required", description: "Allow mic access to record your daily download.", variant: "destructive" });
    }
  }

  function handleStart() {
    if (today && today.status === "completed") {
      createMutation.mutate();
      return;
    }
    if (today && (today.status === "draft" || today.status === "failed")) {
      setActiveId(today.id);
      apiRequest("POST", `/api/daily-downloads/${today.id}/start`)
        .then(() => beginRecording(today.id))
        .catch(() => toast({ title: "Could not start recording", variant: "destructive" }));
      return;
    }
    createMutation.mutate();
  }

  function handleStop() {
    if (mrRef.current && mrRef.current.state === "recording") {
      mrRef.current.stop();
    }
  }

  const dl = today;
  const serverStatus = dl?.status ?? "";
  const showProcessing = uiState === "processing" || serverStatus === "processing";
  const showDone = (uiState === "done" || serverStatus === "completed") && !!dl && !showProcessing;
  const showFailed = (uiState === "failed" || serverStatus === "failed") && !showProcessing;
  const showRecording = uiState === "recording";
  const showIdle = !showProcessing && !showDone && !showFailed && !showRecording && uiState !== "requesting";
  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="rounded-xl border bg-card overflow-hidden" data-testid="my-daily-download-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Download className="w-3.5 h-3.5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">My Daily Download</h3>
            <p className="text-[11px] text-muted-foreground">
              Record what you did today. VoltSafe turns it into a short team-readable summary.
            </p>
          </div>
        </div>
        {showDone && dl && (
          <Badge variant="outline" className={`text-[10px] shrink-0 ${dl.visibility === "team" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-muted text-muted-foreground"}`}>
            {dl.visibility === "team"
              ? <><Globe className="w-2.5 h-2.5 mr-1" />Visible to team</>
              : <><Lock className="w-2.5 h-2.5 mr-1" />Private</>}
          </Badge>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-4 space-y-4">
        {/* IDLE */}
        {showIdle && (
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <p className="text-sm text-muted-foreground flex-1">
              <span className="font-medium text-foreground">{todayLabel} — </span>
              No recording yet. Speak for 30–120 seconds about what you accomplished today.
            </p>
            <Button
              size="sm"
              onClick={handleStart}
              disabled={createMutation.isPending}
              data-testid="button-start-daily-download"
              className="shrink-0"
            >
              {createMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <Mic className="w-3.5 h-3.5 mr-1.5" />}
              Start Recording
            </Button>
          </div>
        )}

        {/* REQUESTING MIC */}
        {uiState === "requesting" && (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Requesting microphone access…</span>
          </div>
        )}

        {/* RECORDING */}
        {showRecording && (
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="flex items-center gap-2 flex-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="text-sm font-medium text-red-500">Recording</span>
              <span className="text-sm font-mono text-muted-foreground">
                {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
              </span>
              <span className="text-xs text-muted-foreground hidden sm:inline">Speak about what you did today.</span>
            </div>
            <Button size="sm" variant="destructive" onClick={handleStop} data-testid="button-stop-daily-download" className="shrink-0">
              <Square className="w-3 h-3 mr-1.5 fill-current" />
              Stop Recording
            </Button>
          </div>
        )}

        {/* PROCESSING */}
        {showProcessing && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
            <p className="text-sm font-medium">Generating your summary…</p>
            <p className="text-xs text-muted-foreground">Transcribing and extracting insights. Usually 30–90 seconds.</p>
          </div>
        )}

        {/* FAILED */}
        {showFailed && (
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="flex items-center gap-2 flex-1 text-sm">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span className="text-muted-foreground">Processing failed — please try recording again.</span>
            </div>
            <Button size="sm" variant="outline" onClick={handleStart} data-testid="button-retry-daily-download" className="shrink-0">
              <Mic className="w-3.5 h-3.5 mr-1.5" />
              Try Again
            </Button>
          </div>
        )}

        {/* DONE — show bullets + wins/blockers/follow-ups + transcript */}
        {showDone && dl && (
          <>
            {dl.summary_bullets && dl.summary_bullets.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Today's Summary</p>
                <ul className="space-y-1.5">
                  {dl.summary_bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-primary mt-0.5 shrink-0">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {((dl.wins?.length ?? 0) + (dl.blockers?.length ?? 0) + (dl.follow_ups?.length ?? 0)) > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(dl.wins?.length ?? 0) > 0 && (
                  <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/20 px-3 py-2">
                    <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide mb-1.5">Wins</p>
                    {dl.wins!.map((w, i) => <p key={i} className="text-xs leading-snug">{w}</p>)}
                  </div>
                )}
                {(dl.blockers?.length ?? 0) > 0 && (
                  <div className="rounded-lg bg-red-500/8 border border-red-500/20 px-3 py-2">
                    <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-1.5">Blockers</p>
                    {dl.blockers!.map((b, i) => <p key={i} className="text-xs leading-snug">{b}</p>)}
                  </div>
                )}
                {(dl.follow_ups?.length ?? 0) > 0 && (
                  <div className="rounded-lg bg-blue-500/8 border border-blue-500/20 px-3 py-2">
                    <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1.5">Follow-ups</p>
                    {dl.follow_ups!.map((f, i) => <p key={i} className="text-xs leading-snug">{f}</p>)}
                  </div>
                )}
              </div>
            )}

            {dl.transcript && (
              <div>
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowTranscript(s => !s)}
                  data-testid="button-toggle-transcript-daily"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTranscript ? "rotate-180" : ""}`} />
                  {showTranscript ? "Hide" : "Show"} full transcript
                </button>
                {showTranscript && (
                  <div className="mt-2 rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 max-h-40 overflow-y-auto">
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{dl.transcript}</p>
                  </div>
                )}
              </div>
            )}

            <div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleStart} data-testid="button-re-record-daily">
                <Mic className="w-3 h-3 mr-1" />
                Re-record today
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Team Downloads section */}
      {recent.length > 0 && (
        <div className="border-t border-border/50">
          <button
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowHistory(s => !s)}
            data-testid="button-toggle-team-downloads"
          >
            <Users className="w-3.5 h-3.5" />
            Team Downloads ({recent.length})
            <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${showHistory ? "rotate-180" : ""}`} />
          </button>
          {showHistory && (
            <div className="flex flex-col divide-y divide-border/30">
              {recent.map(r => (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3" data-testid={`team-download-${r.id}`}>
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 mt-0.5">
                    {(r.user_name || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{r.user_name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(r.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                    </div>
                    {r.summary_bullets && r.summary_bullets.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {r.summary_bullets[0]}{r.summary_bullets.length > 1 ? ` +${r.summary_bullets.length - 1} more` : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DailyExecutionPage() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [drilldownConfig, setDrilldownConfig] = useState<UniversalDrilldownConfig | null>(null);

  const { data: today, isLoading, refetch } = useQuery<TodayData>({
    queryKey: ["/api/execution/today"],
    staleTime: 60_000,
  });

  const { data: summary } = useQuery<SummaryData>({
    queryKey: ["/api/execution/summary"],
    staleTime: 60_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/execution/today"] });
    queryClient.invalidateQueries({ queryKey: ["/api/execution/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
  };

  const completeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/${id}/complete`),
    onSuccess: () => { invalidate(); toast({ title: "Task completed" }); },
    onError: () => toast({ title: "Failed to complete", variant: "destructive" }),
  });

  const remindMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/${id}/remind-now`),
    onSuccess: () => toast({ title: "Reminder sent" }),
    onError: () => toast({ title: "Failed to send reminder", variant: "destructive" }),
  });

  const snoozeMutation = useMutation({
    mutationFn: ({ id, days }: { id: number; days: number }) =>
      apiRequest("POST", `/api/tasks/${id}/snooze`, { preset: days === 1 ? "later_today" : "tomorrow_morning" }),
    onSuccess: () => { invalidate(); toast({ title: "Task snoozed" }); },
    onError: () => toast({ title: "Failed to snooze", variant: "destructive" }),
  });

  const bulkCompleteMutation = useMutation({
    mutationFn: (taskIds: number[]) => apiRequest("POST", "/api/tasks/bulk/complete", { taskIds }),
    onSuccess: () => {
      invalidate();
      setSelected(new Set());
      toast({ title: `${selected.size} task${selected.size > 1 ? "s" : ""} completed` });
    },
    onError: () => toast({ title: "Bulk complete failed", variant: "destructive" }),
  });

  const bulkSnoozeMutation = useMutation({
    mutationFn: ({ taskIds, days }: { taskIds: number[]; days: number }) =>
      apiRequest("POST", "/api/tasks/bulk/snooze", { taskIds, days }),
    onSuccess: () => {
      invalidate();
      setSelected(new Set());
      toast({ title: "Tasks snoozed" });
    },
    onError: () => toast({ title: "Bulk snooze failed", variant: "destructive" }),
  });

  const toggleSelect = (id: number, val: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      val ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const allTasks = useMemo(() => [
    ...(today?.mustDoToday ?? []),
    ...(today?.overdue ?? []),
    ...(today?.newlyAssigned ?? []),
    ...(today?.awaitingReply ?? []),
  ], [today]);

  const uniqueOwners = useMemo(() =>
    Array.from(new Set(allTasks.map((t) => t.owner_name).filter(Boolean))) as string[],
    [allTasks]
  );

  const filter = (tasks: ExecutionTask[]) =>
    tasks.filter((t) => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase()) &&
          !(t.account_name ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      if (ownerFilter !== "all" && t.owner_name !== ownerFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      return true;
    });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const mustDo = filter(today?.mustDoToday ?? []);
  const overdue = filter(today?.overdue ?? []);
  const newlyAssigned = filter(today?.newlyAssigned ?? []);
  const awaiting = filter(today?.awaitingReply ?? []);
  const completed = today?.recentlyCompleted ?? [];

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="page-title-daily-execution">
            Daily Execution
          </h1>
          <p className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            data-testid="btn-refresh-execution"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/automation/tasks">
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1" />
              Settings
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="summary-stats">
          {[
            { label: "Total Open",    value: summary.totalOpen,            icon: CheckCircle2, color: "text-muted-foreground", metric: "tasks_open" },
            { label: "Due Today",     value: summary.dueToday,             icon: Calendar,     color: "text-blue-400",         metric: "tasks_due_today" },
            { label: "Overdue",       value: summary.overdueCount,         icon: AlertTriangle, color: summary.overdueCount > 0 ? "text-red-400" : "text-muted-foreground", metric: "tasks_overdue" },
            { label: "7d Completion", value: `${summary.completionRateLast7d}%`, icon: TrendingUp, color: "text-green-400",   metric: "" },
          ].map(({ label, value, icon: Icon, color, metric }) => (
            <div
              key={label}
              className={`rounded-xl border bg-card p-3 ${metric ? "cursor-pointer hover:border-primary/40 hover:bg-card/80 transition-all" : ""}`}
              data-testid={`stat-${label.replace(/\s/g, "-").toLowerCase()}`}
              onClick={metric ? () => setDrilldownConfig({ metric }) : undefined}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <div className="text-xl font-bold">
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* My Daily Download */}
      <MyDailyDownload />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            data-testid="input-search-tasks"
            placeholder="Search tasks..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[120px] h-8 text-sm" data-testid="select-priority-filter">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        {uniqueOwners.length > 1 && (
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-[140px] h-8 text-sm" data-testid="select-owner-filter">
              <SelectValue placeholder="Owner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {uniqueOwners.map((o) => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Bulk Actions Bar */}
      {selected.size > 0 && (
        <div
          data-testid="bulk-actions-bar"
          className="flex items-center gap-2 p-2 bg-primary/10 border border-primary/30 rounded-lg text-sm"
        >
          <span className="text-primary font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button
              data-testid="btn-bulk-complete"
              size="sm"
              variant="outline"
              className="h-7 text-xs text-green-500 border-green-500/30 hover:bg-green-500/10"
              onClick={() => bulkCompleteMutation.mutate(Array.from(selected))}
              disabled={bulkCompleteMutation.isPending}
            >
              <CircleCheck className="w-3 h-3 mr-1" />
              Complete all
            </Button>
            <Button
              data-testid="btn-bulk-snooze"
              size="sm"
              variant="outline"
              className="h-7 text-xs text-blue-400 border-blue-400/30 hover:bg-blue-400/10"
              onClick={() => bulkSnoozeMutation.mutate({ taskIds: Array.from(selected), days: 1 })}
              disabled={bulkSnoozeMutation.isPending}
            >
              <Clock className="w-3 h-3 mr-1" />
              Snooze 1d
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setSelected(new Set())}
              data-testid="btn-clear-selection"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Must Do Today */}
      <Section
        icon={CheckCircle2}
        title="Must Do Today"
        count={mustDo.length}
        accent={mustDo.length > 0 ? "border-blue-500/20" : ""}
        defaultOpen
      >
        {mustDo.length === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-4 text-center">
            Nothing due today — nice work.
          </p>
        ) : (
          mustDo.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              selected={selected.has(t.id)}
              onSelect={toggleSelect}
              onComplete={(id) => completeMutation.mutate(id)}
              onRemind={(id) => remindMutation.mutate(id)}
              onSnooze={(id, days) => snoozeMutation.mutate({ id, days })}
            />
          ))
        )}
      </Section>

      {/* Overdue and Escalating */}
      <Section
        icon={AlertTriangle}
        title="Overdue & Escalating"
        count={overdue.length}
        accent={overdue.length > 0 ? "border-red-500/20" : ""}
        defaultOpen
      >
        {overdue.length === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-4 text-center">
            No overdue tasks.
          </p>
        ) : (
          overdue.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              selected={selected.has(t.id)}
              onSelect={toggleSelect}
              onComplete={(id) => completeMutation.mutate(id)}
              onRemind={(id) => remindMutation.mutate(id)}
              onSnooze={(id, days) => snoozeMutation.mutate({ id, days })}
            />
          ))
        )}
      </Section>

      {/* Awaiting Reply */}
      <Section
        icon={Clock}
        title="Awaiting Reply"
        count={awaiting.length}
        defaultOpen={false}
      >
        {awaiting.length === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-4 text-center">Nothing waiting on a reply.</p>
        ) : (
          awaiting.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              selected={selected.has(t.id)}
              onSelect={toggleSelect}
              onComplete={(id) => completeMutation.mutate(id)}
              onRemind={(id) => remindMutation.mutate(id)}
              onSnooze={(id, days) => snoozeMutation.mutate({ id, days })}
            />
          ))
        )}
      </Section>

      {/* Newly Assigned */}
      <Section
        icon={Bell}
        title="Newly Assigned (24h)"
        count={newlyAssigned.length}
        defaultOpen={newlyAssigned.length > 0}
      >
        {newlyAssigned.length === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-4 text-center">No new assignments in the last 24h.</p>
        ) : (
          newlyAssigned.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              selected={selected.has(t.id)}
              onSelect={toggleSelect}
              onComplete={(id) => completeMutation.mutate(id)}
              onRemind={(id) => remindMutation.mutate(id)}
              onSnooze={(id, days) => snoozeMutation.mutate({ id, days })}
            />
          ))
        )}
      </Section>

      {/* Suggestions */}
      {(today?.suggestionsReady ?? 0) > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-center gap-3" data-testid="suggestions-banner">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium text-primary">{today!.suggestionsReady} suggestions</span>
            <span className="text-muted-foreground"> needing review</span>
          </div>
          <Button variant="outline" size="sm" asChild className="h-7 text-xs">
            <Link href="/execution/tasks?view=suggestions">
              Review <ChevronRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      )}

      {/* Team At Risk */}
      {summary && summary.topBlockedOwners.length > 1 && (
        <Section icon={Users} title="Team At Risk" count={summary.topBlockedOwners.length} defaultOpen={false}>
          <div className="space-y-1 px-3 pb-2">
            {summary.topBlockedOwners.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1.5">
                <span>{r.owner_name}</span>
                <Badge variant="destructive" className="text-xs">{r.overdue_count} overdue</Badge>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Recently Completed */}
      <Section icon={CheckCircle2} title="Recently Completed" count={completed.length} defaultOpen={false}>
        {completed.length === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-4 text-center">Nothing completed yet today.</p>
        ) : (
          completed.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2 px-3 text-sm text-muted-foreground" data-testid={`completed-task-${t.id}`}>
              <CircleCheck className="w-4 h-4 text-green-500 shrink-0" />
              <span className="truncate">{t.title}</span>
              {t.account_name && <span className="text-xs ml-auto shrink-0">{t.account_name}</span>}
            </div>
          ))
        )}
      </Section>

      <UniversalDrilldownSheet
        config={drilldownConfig}
        onClose={() => setDrilldownConfig(null)}
        endpoint="/api/work/drilldown"
      />
    </div>
  );
}
