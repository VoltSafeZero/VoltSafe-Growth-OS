// client/src/components/today/ceo-briefing.tsx
// CEO Cockpit Phase 7 — Daily Briefing, Weekly Review, Leadership Agenda, Team Briefings
// Admin-only. No auto-send. Draft routes return copyable text only. Never sends.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  FileText, Calendar, Users, Zap, Copy, Check, AlertTriangle,
  ChevronRight, Loader2, CheckCircle2, Clock, TrendingUp,
  BarChart2, Shield, Star, RefreshCw,
} from "lucide-react";

// ── Types (mirrored from service) ──────────────────────────────────────────────

type BriefingSeverity = "info" | "watch" | "urgent" | "critical";

interface BriefingItem {
  id: string;
  title: string;
  owner?: string | null;
  ownerId?: number | null;
  source?: string | null;
  dueDate?: string | null;
  ageHours?: number;
  ageDays?: number;
  severity?: BriefingSeverity;
  status?: string | null;
  link?: string;
  metadata?: Record<string, any>;
}

interface BriefingSection {
  title: string;
  severity: BriefingSeverity;
  items: BriefingItem[];
  empty_state: string;
  reason: string;
}

interface TopPriority {
  rank: number;
  title: string;
  reason: string;
  source: string;
  sourceId?: string | null;
  link?: string;
  actionId?: number | null;
}

interface DailyCeoBriefing {
  generated_at: string;
  date: string;
  sections: Record<string, BriefingSection>;
  top_priorities: TopPriority[];
}

interface WeeklyCeoReview {
  generated_at: string;
  start_date: string;
  end_date: string;
  action_summary: { completed: number; dismissed: number; snoozed: number; unresolved: number; items: BriefingItem[] };
  blockers_summary: { opened: number; resolved: number; still_open: number };
  tasks_summary: { completed: number; overdue: number; overdue_by_owner: { ownerName: string; count: number }[] };
  commitments_summary: { created: number; completed: number; missed: number };
  team_pulse: { blocked: number; quiet: number; needs_followup: number; total: number };
  opportunity_movement: { new_deals: number; stage_changes: number; total_pipeline: number; won_this_week: number; lost_this_week: number };
  top_wins: BriefingItem[];
  top_risks: BriefingItem[];
  leadership_agenda_preview: AgendaSection[];
}

interface TeamMemberBriefing {
  generated_at: string;
  member: { id: number; name: string; email: string; role: string };
  signal: { label: string; reason: string };
  active_tasks: number;
  overdue_tasks: number;
  blocked_tasks: number;
  commitments_open: number;
  commitments_overdue: number;
  open_actions: BriefingItem[];
  recent_wins: BriefingItem[];
  talking_points: string[];
  support_questions: string[];
  operational_status: string;
}

interface AgendaItem {
  title: string;
  owner: string | null;
  source: string;
  why_it_matters: string;
  suggested_prompt: string;
  linked_id?: string | null;
  linked_type?: string | null;
  priority: "must_discuss" | "if_time" | "fyi";
}

interface AgendaSection {
  key: string;
  title: string;
  items: AgendaItem[];
}

interface LeadershipMeetingAgenda {
  generated_at: string;
  sections: AgendaSection[];
  copy_text: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<BriefingSeverity, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/20",
  urgent: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  watch: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  info: "text-sky-400 bg-sky-500/10 border-sky-500/20",
};

const SEVERITY_DOT: Record<BriefingSeverity, string> = {
  critical: "bg-red-500",
  urgent: "bg-orange-500",
  watch: "bg-amber-400",
  info: "bg-sky-400",
};

const PRIORITY_BADGE: Record<string, string> = {
  must_discuss: "bg-red-500/20 text-red-300 border-red-500/30",
  if_time: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  fyi: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

const PRIORITY_LABEL: Record<string, string> = {
  must_discuss: "Must Discuss",
  if_time: "If Time",
  fyi: "FYI",
};

const TABS = [
  { key: "today", label: "Today", icon: Calendar },
  { key: "weekly", label: "Weekly Review", icon: BarChart2 },
  { key: "agenda", label: "Leadership Agenda", icon: FileText },
  { key: "team", label: "Team Briefings", icon: Users },
] as const;

type TabKey = typeof TABS[number]["key"];

// ── Small shared components ───────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: BriefingSeverity }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${SEVERITY_COLORS[severity]}`}>
      <span className={`w-1 h-1 rounded-full ${SEVERITY_DOT[severity]}`} />
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

function CopyButton({ getText, label = "Copy" }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-xs"
      data-testid="briefing-copy-btn"
      onClick={() => {
        navigator.clipboard.writeText(getText()).then(() => {
          setCopied(true);
          toast({ title: "Copied to clipboard" });
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {label}
    </Button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-xs text-muted-foreground py-2 italic">{message}</p>
  );
}

// ── BriefingSectionCard ───────────────────────────────────────────────────────

function BriefingSectionCard({ section }: { section: BriefingSection }) {
  const [open, setOpen] = useState(section.severity !== "info");
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${SEVERITY_COLORS[section.severity]}`}
         data-testid={`briefing-section-${section.title.toLowerCase().replace(/\s+/g, "-")}`}>
      <button
        className="w-full flex items-center justify-between"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <SeverityBadge severity={section.severity} />
          <span className="text-xs font-semibold">{section.title}</span>
          {section.items.length > 0 && (
            <span className="text-[10px] text-muted-foreground">({section.items.length})</span>
          )}
        </div>
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[10px] text-muted-foreground italic">{section.reason}</p>
          {section.items.length === 0 ? (
            <EmptyState message={section.empty_state} />
          ) : (
            section.items.map((item) => (
              <div key={item.id} className="flex items-start gap-2 py-1 border-t border-white/5">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[item.severity ?? section.severity]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium leading-snug truncate">{item.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {item.owner && <span>Owner: {item.owner} · </span>}
                    {item.ageDays != null && item.ageDays > 0 && <span>{item.ageDays}d ago · </span>}
                    {item.status && <span className="capitalize">{item.status}</span>}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab: Today ─────────────────────────────────────────────────────────────────

function TodayTab({ onQueueAction }: { onQueueAction?: (title: string, source: string) => void }) {
  const query = useQuery<DailyCeoBriefing>({
    queryKey: ["/api/today/ceo-briefing/daily"],
  });

  const briefingText = () => {
    if (!query.data) return "";
    const d = query.data;
    const lines = [`CEO DAILY BRIEFING — ${d.date}`, ""];
    d.top_priorities.forEach(p => {
      lines.push(`${p.rank}. ${p.title} (${p.reason})`);
    });
    return lines.join("\n");
  };

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="briefing-today-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-8" data-testid="briefing-today-error">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <p className="text-xs text-muted-foreground">Failed to load daily briefing.</p>
      </div>
    );
  }
  const data = query.data;
  if (!data) return null;

  const SECTION_ORDER = ["unresolved_actions", "new_blockers", "commitments_due_soon", "overdue_tasks", "stale_opportunities", "one_on_ones_today", "currents_hotspots", "ceo_owned_items", "capital_summary"];
  const urgentFirst = SECTION_ORDER.filter(k => data.sections[k]?.severity === "critical" || data.sections[k]?.severity === "urgent");
  const rest = SECTION_ORDER.filter(k => data.sections[k] && !urgentFirst.includes(k));
  const orderedKeys = [...urgentFirst, ...rest];

  return (
    <div className="space-y-4" data-testid="briefing-today-tab">
      {/* Top 5 priorities */}
      <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-3 space-y-2"
           data-testid="briefing-top-priorities">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-teal-400" />
            <span className="text-xs font-semibold text-teal-300">Top 5 CEO Priorities Today</span>
          </div>
          <CopyButton getText={briefingText} label="Copy briefing" />
        </div>
        {data.top_priorities.length === 0 ? (
          <EmptyState message="No priority actions in queue. Generate from CEO Cockpit to populate." />
        ) : (
          data.top_priorities.map((p) => (
            <div key={p.rank} className="flex items-start gap-2 py-1.5 border-t border-teal-500/10"
                 data-testid={`briefing-priority-${p.rank}`}>
              <span className="w-5 h-5 rounded-full bg-teal-500/20 text-teal-300 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {p.rank}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-snug">{p.title}</p>
                <p className="text-[10px] text-muted-foreground">{p.reason}</p>
              </div>
              {p.actionId && onQueueAction && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 flex-shrink-0"
                        data-testid={`briefing-create-action-${p.rank}`}
                        onClick={() => onQueueAction(p.title, p.source)}>
                  + Action
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Sections — urgent/critical first */}
      {orderedKeys.map(key => {
        const section = data.sections[key];
        if (!section) return null;
        return <BriefingSectionCard key={key} section={section} />;
      })}

      <p className="text-[10px] text-muted-foreground text-center">
        Generated {new Date(data.generated_at).toLocaleTimeString()} · Local DB only · No external calls
      </p>
    </div>
  );
}

// ── Tab: Weekly Review ─────────────────────────────────────────────────────────

function WeeklyTab() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const { toast } = useToast();

  const queryKey = ["/api/today/ceo-briefing/weekly", startDate, endDate];
  const query = useQuery<WeeklyCeoReview>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      return fetch(`/api/today/ceo-briefing/weekly?${params}`).then(r => r.json());
    },
  });

  const draftMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/today/ceo-briefing/weekly/draft", { start_date: startDate || undefined, end_date: endDate || undefined }),
    onSuccess: (data: any) => {
      setDraftText(data.draftText ?? "");
      setDraftOpen(true);
    },
    onError: () => toast({ title: "Failed to generate draft", variant: "destructive" }),
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="briefing-weekly-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const data = query.data;

  return (
    <div className="space-y-4" data-testid="briefing-weekly-tab">
      {/* Date range selector */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="briefing-date-range">
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-muted-foreground">From</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="h-7 rounded border border-border bg-background text-xs px-2"
            data-testid="briefing-start-date"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-muted-foreground">To</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="h-7 rounded border border-border bg-background text-xs px-2"
            data-testid="briefing-end-date"
          />
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="briefing-weekly-refresh"
                onClick={() => {}}>
          <RefreshCw className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" data-testid="briefing-weekly-draft-btn"
                onClick={() => draftMutation.mutate()} disabled={draftMutation.isPending}>
          <FileText className="h-3 w-3" />
          Copy weekly review
        </Button>
      </div>

      {!data ? (
        query.isError ? (
          <div className="flex flex-col items-center gap-2 py-8" data-testid="briefing-weekly-error">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <p className="text-xs text-muted-foreground">Failed to load weekly review.</p>
          </div>
        ) : null
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="briefing-weekly-summary-cards">
            <StatCard icon={CheckCircle2} label="Completed Actions" value={data.action_summary.completed} color="text-emerald-400" testId="briefing-stat-completed" />
            <StatCard icon={Shield} label="Unresolved Actions" value={data.action_summary.unresolved} color="text-red-400" testId="briefing-stat-unresolved" />
            <StatCard icon={Clock} label="Overdue Tasks" value={data.tasks_summary.overdue} color="text-orange-400" testId="briefing-stat-overdue" />
            <StatCard icon={Star} label="Wins" value={data.top_wins.length} color="text-amber-400" testId="briefing-stat-wins" />
          </div>

          {/* Opportunity movement */}
          <div className="rounded-lg border border-border p-3 space-y-2" data-testid="briefing-opp-movement">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-teal-400" />
              <span className="text-xs font-semibold">Opportunity Movement</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="New Deals" value={data.opportunity_movement.new_deals} />
              <MiniStat label="Won" value={data.opportunity_movement.won_this_week} />
              <MiniStat label="Lost" value={data.opportunity_movement.lost_this_week} />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Pipeline: ${Math.round(data.opportunity_movement.total_pipeline).toLocaleString()}
              · Stage changes: {data.opportunity_movement.stage_changes}
            </p>
          </div>

          {/* Overdue by owner */}
          {data.tasks_summary.overdue_by_owner.length > 0 && (
            <div className="rounded-lg border border-border p-3 space-y-1.5" data-testid="briefing-overdue-by-owner">
              <span className="text-xs font-semibold">Overdue Tasks by Owner</span>
              {data.tasks_summary.overdue_by_owner.map((o) => (
                <div key={o.ownerName} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{o.ownerName}</span>
                  <Badge variant="outline" className="text-orange-300 border-orange-500/30 text-[10px] h-4">
                    {o.count}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {/* Commitments */}
          <div className="rounded-lg border border-border p-3 space-y-1" data-testid="briefing-commitments-summary">
            <span className="text-xs font-semibold">Commitments</span>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>Created: <strong className="text-foreground">{data.commitments_summary.created}</strong></span>
              <span>Completed: <strong className="text-emerald-400">{data.commitments_summary.completed}</strong></span>
              <span>Missed: <strong className="text-red-400">{data.commitments_summary.missed}</strong></span>
            </div>
          </div>

          {/* Top wins */}
          {data.top_wins.length > 0 && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1" data-testid="briefing-top-wins">
              <div className="flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-300">Top Wins</span>
              </div>
              {data.top_wins.map((w) => (
                <p key={w.id} className="text-xs text-muted-foreground">✓ {w.title}</p>
              ))}
            </div>
          )}

          {/* Top risks */}
          {data.top_risks.length > 0 && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1" data-testid="briefing-top-risks">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                <span className="text-xs font-semibold text-red-300">Top Risks</span>
              </div>
              {data.top_risks.map((r) => (
                <p key={r.id} className="text-xs text-muted-foreground">⚠ {r.title}</p>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground text-center">
            {data.start_date} → {data.end_date} · Generated {new Date(data.generated_at).toLocaleTimeString()}
          </p>
        </>
      )}

      {/* Draft sheet — copyable text only, no auto-send */}
      <Sheet open={draftOpen} onOpenChange={setDraftOpen}>
        <SheetContent side="right" className="w-[520px] max-w-full" data-testid="briefing-weekly-draft-sheet">
          <SheetHeader>
            <SheetTitle className="text-sm">Weekly Review Draft</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <p className="text-[10px] text-muted-foreground italic">
              This is a copy-only draft. It will not be sent automatically.
            </p>
            <Textarea
              readOnly
              value={draftText}
              className="min-h-[400px] text-xs font-mono resize-none"
              data-testid="briefing-weekly-draft-text"
            />
            <div className="flex items-center justify-between">
              <CopyButton getText={() => draftText} label="Copy to Clipboard" />
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setDraftOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, testId }: {
  icon: any; label: string; value: number; color: string; testId: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-1" data-testid={testId}>
      <Icon className={`h-4 w-4 ${color}`} />
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-sm font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

// ── Tab: Leadership Agenda ─────────────────────────────────────────────────────

function AgendaTab() {
  const [draftOpen, setDraftOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery<LeadershipMeetingAgenda>({
    queryKey: ["/api/today/ceo-briefing/leadership-agenda"],
  });

  const draftMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/today/ceo-briefing/leadership-agenda/draft", {}),
    onSuccess: () => setDraftOpen(true),
    onError: () => toast({ title: "Failed to generate draft", variant: "destructive" }),
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="briefing-agenda-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const data = query.data;

  return (
    <div className="space-y-4" data-testid="briefing-agenda-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" data-testid="briefing-agenda-copy-btn"
                onClick={() => draftMutation.mutate()} disabled={draftMutation.isPending}>
          <FileText className="h-3 w-3" />
          Copy agenda
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" data-testid="briefing-agenda-refresh"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-briefing/leadership-agenda"] })}>
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {!data ? (
        query.isError ? (
          <div className="flex flex-col items-center gap-2 py-8" data-testid="briefing-agenda-error">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <p className="text-xs text-muted-foreground">Failed to load leadership agenda.</p>
          </div>
        ) : null
      ) : (
        <div className="space-y-3" data-testid="briefing-agenda-sections">
          {data.sections.filter(s => s.items.length > 0).map((section) => (
            <div key={section.key} className="rounded-lg border border-border p-3 space-y-2"
                 data-testid={`briefing-agenda-section-${section.key}`}>
              <h3 className="text-xs font-semibold">{section.title}</h3>
              {section.items.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 py-1.5 border-t border-border/50"
                     data-testid={`briefing-agenda-item-${section.key}-${idx}`}>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-start gap-2">
                      <p className="text-xs font-medium leading-snug flex-1">{item.title}</p>
                      <span className={`flex-shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_BADGE[item.priority]}`}>
                        {PRIORITY_LABEL[item.priority]}
                      </span>
                    </div>
                    {item.owner && (
                      <p className="text-[10px] text-muted-foreground">Owner: {item.owner}</p>
                    )}
                    <p className="text-[10px] text-sky-300/80 italic">{item.suggested_prompt}</p>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {data.sections.every(s => s.items.length === 0) && (
            <EmptyState message="No agenda items. Generate CEO Cockpit actions to populate." />
          )}
          <p className="text-[10px] text-muted-foreground text-center">
            Generated {new Date(data.generated_at).toLocaleTimeString()} · Local DB only
          </p>
        </div>
      )}

      {/* Draft sheet */}
      <Sheet open={draftOpen} onOpenChange={setDraftOpen}>
        <SheetContent side="right" className="w-[520px] max-w-full" data-testid="briefing-agenda-draft-sheet">
          <SheetHeader>
            <SheetTitle className="text-sm">Leadership Agenda Draft</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <p className="text-[10px] text-muted-foreground italic">
              This is a copy-only draft. It will not be sent automatically.
            </p>
            <Textarea
              readOnly
              value={data?.copy_text ?? ""}
              className="min-h-[400px] text-xs font-mono resize-none"
              data-testid="briefing-agenda-draft-text"
            />
            <div className="flex items-center justify-between">
              <CopyButton getText={() => data?.copy_text ?? ""} label="Copy to Clipboard" />
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setDraftOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Tab: Team Briefings ────────────────────────────────────────────────────────

function TeamTab() {
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const usersQuery = useQuery<{ users: { id: number; name: string; role: string }[] }>({
    queryKey: ["/api/admin/users"],
    select: (data: any) => ({
      users: (data.users ?? data ?? []).filter((u: any) =>
        !["admin", "master_admin"].includes(u.role) && u.isActive !== false
      ),
    }),
  });

  const briefingQuery = useQuery<TeamMemberBriefing>({
    queryKey: ["/api/today/ceo-briefing/team-member", selectedUserId],
    queryFn: () => fetch(`/api/today/ceo-briefing/team-member/${selectedUserId}`).then(r => r.json()),
    enabled: !!selectedUserId,
  });

  const STATUS_COLORS: Record<string, string> = {
    "Blocked": "text-red-400 bg-red-500/10",
    "Check-in needed": "text-orange-400 bg-orange-500/10",
    "Needs follow-up": "text-amber-400 bg-amber-500/10",
    "Quiet": "text-sky-400 bg-sky-500/10",
    "On track": "text-emerald-400 bg-emerald-500/10",
    "Momentum": "text-teal-400 bg-teal-500/10",
  };

  return (
    <div className="space-y-4" data-testid="briefing-team-tab">
      {/* Team member selector */}
      <div className="flex items-center gap-2" data-testid="briefing-member-selector">
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger className="h-8 text-xs w-52" data-testid="briefing-member-select">
            <SelectValue placeholder="Select team member…" />
          </SelectTrigger>
          <SelectContent>
            {(usersQuery.data?.users ?? []).map(u => (
              <SelectItem key={u.id} value={String(u.id)} data-testid={`briefing-member-option-${u.id}`}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedUserId && (
        <div className="text-xs text-muted-foreground py-4" data-testid="briefing-team-empty">
          Select a team member to view their briefing.
        </div>
      )}

      {briefingQuery.isLoading && (
        <div className="flex items-center justify-center py-8" data-testid="briefing-team-loading">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {briefingQuery.data && (() => {
        const b = briefingQuery.data;
        const statusColor = STATUS_COLORS[b.operational_status] ?? "text-slate-400 bg-slate-500/10";
        return (
          <div className="space-y-3" data-testid={`briefing-member-panel-${b.member.id}`}>
            {/* Member header */}
            <div className="rounded-lg border border-border p-3 space-y-1" data-testid="briefing-member-header">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold">{b.member.name}</p>
                  <p className="text-[10px] text-muted-foreground">{b.member.role}</p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColor}`}
                      data-testid="briefing-member-status">
                  {b.operational_status}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground italic">{b.signal.reason}</p>
            </div>

            {/* Task stats */}
            <div className="grid grid-cols-3 gap-2" data-testid="briefing-member-task-stats">
              <div className="rounded border border-border p-2 text-center">
                <p className="text-sm font-bold">{b.active_tasks}</p>
                <p className="text-[10px] text-muted-foreground">Active</p>
              </div>
              <div className="rounded border border-border p-2 text-center">
                <p className={`text-sm font-bold ${b.overdue_tasks > 0 ? "text-orange-400" : ""}`}>{b.overdue_tasks}</p>
                <p className="text-[10px] text-muted-foreground">Overdue</p>
              </div>
              <div className="rounded border border-border p-2 text-center">
                <p className={`text-sm font-bold ${b.blocked_tasks > 0 ? "text-red-400" : ""}`}>{b.blocked_tasks}</p>
                <p className="text-[10px] text-muted-foreground">Blocked</p>
              </div>
            </div>

            {/* Talking points */}
            <div className="rounded-lg border border-border p-3 space-y-1.5" data-testid="briefing-talking-points">
              <p className="text-xs font-semibold">Talking Points</p>
              {b.talking_points.map((tp, idx) => (
                <p key={idx} className="text-xs text-muted-foreground flex items-start gap-1.5" data-testid={`briefing-tp-${idx}`}>
                  <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  {tp}
                </p>
              ))}
            </div>

            {/* Support questions */}
            <div className="rounded-lg border border-border p-3 space-y-1.5" data-testid="briefing-support-questions">
              <p className="text-xs font-semibold">Support Questions</p>
              {b.support_questions.map((sq, idx) => (
                <p key={idx} className="text-xs text-muted-foreground flex items-start gap-1.5" data-testid={`briefing-sq-${idx}`}>
                  <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  {sq}
                </p>
              ))}
            </div>

            {/* Open actions */}
            {b.open_actions.length > 0 && (
              <div className="rounded-lg border border-border p-3 space-y-1.5" data-testid="briefing-member-actions">
                <p className="text-xs font-semibold">Open Actions in Queue</p>
                {b.open_actions.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs" data-testid={`briefing-action-${a.id}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[a.severity ?? "info"]}`} />
                    <span className="text-muted-foreground flex-1 truncate">{a.title}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Recent wins */}
            {b.recent_wins.length > 0 && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1" data-testid="briefing-member-wins">
                <p className="text-xs font-semibold text-emerald-300">Recent Wins</p>
                {b.recent_wins.map((w) => (
                  <p key={w.id} className="text-xs text-muted-foreground">✓ {w.title}</p>
                ))}
              </div>
            )}

            {/* Commitments */}
            <div className="rounded-lg border border-border p-3 space-y-1" data-testid="briefing-member-commitments">
              <p className="text-xs font-semibold">Commitments</p>
              <p className="text-xs text-muted-foreground">
                Open: <strong className="text-foreground">{b.commitments_open}</strong>
                {b.commitments_overdue > 0 && (
                  <span className="ml-2 text-amber-400">· Overdue: {b.commitments_overdue}</span>
                )}
              </p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── CeoBriefingPanel (main export) ────────────────────────────────────────────

export function CeoBriefingPanel() {
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const queryClient = useQueryClient();

  const handleCreateAction = (title: string, source: string) => {
    // Opens CEO action queue create flow — reuses Phase 6
    queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-actions"] });
  };

  return (
    <div className="rounded-xl border border-border bg-card space-y-3 p-4"
         data-testid="ceo-briefing-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-teal-400" />
          <span className="text-sm font-semibold">CEO Briefing</span>
          <Badge variant="outline" className="text-[10px] h-4 border-teal-500/30 text-teal-400">Phase 7</Badge>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1" role="tablist" data-testid="ceo-briefing-tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            data-testid={`briefing-tab-${key}`}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] font-medium transition-colors ${
              activeTab === key
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3 w-3" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "today" && <TodayTab onQueueAction={handleCreateAction} />}
        {activeTab === "weekly" && <WeeklyTab />}
        {activeTab === "agenda" && <AgendaTab />}
        {activeTab === "team" && <TeamTab />}
      </div>
    </div>
  );
}
