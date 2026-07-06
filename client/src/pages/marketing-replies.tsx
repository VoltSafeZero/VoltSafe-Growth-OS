import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MarketingDrilldownSheet, type DrilldownConfig } from "@/components/marketing/marketing-drilldown-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  MessageSquare, CheckCircle, XCircle, Plus, RefreshCw, Filter, ChevronDown, ChevronRight,
  Sparkles, AlertTriangle, Calendar, Send, HelpCircle,
  TrendingUp, Users, Mail, Clock, Inbox, Zap
} from "lucide-react";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReplyClassificationRecord = {
  id: number;
  campaign_id: number | null;
  campaign_recipient_id: number | null;
  contact_id: number | null;
  account_id: number | null;
  source_message_id: string | null;
  source_thread_id: string | null;
  reply_body_preview: string | null;
  classification: string;
  confidence: number;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  recommended_action: string;
  recommended_task_title: string;
  task_id: number | null;
  status: string;
  ingestion_source: string | null;
  created_at: string;
  contact_name?: string | null;
  contact_email?: string | null;
  account_name?: string | null;
  campaign_name?: string | null;
  task_title?: string | null;
};

type UnmatchedReply = {
  id: number;
  from_email: string;
  subject: string | null;
  body_preview: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  in_reply_to: string | null;
  received_at: string | null;
  match_attempts: number;
  status: string;
  created_at: string;
};

// ── Meta ──────────────────────────────────────────────────────────────────────

const CLASSIFICATION_META: Record<string, { label: string; color: string; icon: typeof MessageSquare; actionable: boolean }> = {
  interested:           { label: "Interested",          color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30", icon: TrendingUp,  actionable: true },
  meeting_request:      { label: "Meeting Request",     color: "text-cyan-400 bg-cyan-500/15 border-cyan-500/30",         icon: Calendar,    actionable: true },
  pricing_question:     { label: "Pricing Question",    color: "text-blue-400 bg-blue-500/15 border-blue-500/30",         icon: Send,        actionable: true },
  technical_question:   { label: "Technical Question",  color: "text-violet-400 bg-violet-500/15 border-violet-500/30",   icon: HelpCircle,  actionable: true },
  procurement_question: { label: "Procurement",         color: "text-amber-400 bg-amber-500/15 border-amber-500/30",      icon: Users,       actionable: true },
  referral:             { label: "Referral",            color: "text-teal-400 bg-teal-500/15 border-teal-500/30",         icon: Users,       actionable: true },
  not_now:              { label: "Not Now",             color: "text-orange-400 bg-orange-500/15 border-orange-500/30",   icon: Clock,       actionable: true },
  objection:            { label: "Objection",           color: "text-yellow-400 bg-yellow-500/15 border-yellow-500/30",   icon: AlertTriangle, actionable: true },
  wrong_person:         { label: "Wrong Person",        color: "text-slate-400 bg-slate-500/15 border-slate-500/30",      icon: Users,       actionable: true },
  unsubscribe:          { label: "Unsubscribe",         color: "text-rose-400 bg-rose-500/15 border-rose-500/30",         icon: XCircle,     actionable: false },
  negative:             { label: "Negative",            color: "text-red-400 bg-red-500/15 border-red-500/30",            icon: XCircle,     actionable: false },
  out_of_office:        { label: "Out of Office",       color: "text-slate-400 bg-slate-500/10 border-slate-500/20",      icon: Mail,        actionable: false },
  auto_reply:           { label: "Auto Reply",          color: "text-slate-400 bg-slate-500/10 border-slate-500/20",      icon: Mail,        actionable: false },
  unknown:              { label: "Unknown",             color: "text-muted-foreground bg-muted/20 border-border/30",      icon: HelpCircle,  actionable: false },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:      { label: "Pending Review", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  reviewed:     { label: "Reviewed",       color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  task_created: { label: "Task Created",   color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  ignored:      { label: "Ignored",        color: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
  dismissed:    { label: "Dismissed",      color: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SourcePill({ source }: { source: string | null }) {
  if (source === "inbound_ingested") {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded border text-cyan-400 bg-cyan-500/10 border-cyan-500/20">
        <Zap className="h-2.5 w-2.5" />
        Auto-ingested
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded border text-slate-400 bg-slate-500/10 border-slate-500/20">
      Manual
    </span>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? "text-emerald-400" : pct >= 65 ? "text-amber-400" : "text-slate-400";
  return <span className={`text-xs font-mono tabular-nums ${color}`}>{pct}%</span>;
}

function SentimentDot({ sentiment }: { sentiment: string }) {
  const colors: Record<string, string> = {
    positive: "bg-emerald-400", negative: "bg-rose-400",
    neutral: "bg-slate-400",   unknown: "bg-muted-foreground/30",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[sentiment] ?? "bg-muted-foreground/30"}`} title={sentiment} />;
}

function formatAgo(ts: string | null) {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (d >= 1) return `${d}d ago`;
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return "Just now";
}

// ── Matched replies tab ───────────────────────────────────────────────────────

function MatchedRepliesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null);
  const [classification, setClassification] = useState("all");
  const [status, setStatus] = useState("all");
  const [sentiment, setSentiment] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const queryKey = ["/api/marketing/replies", { classification, status, sentiment }];

  const { data: replies, isLoading, refetch } = useQuery<ReplyClassificationRecord[]>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (classification !== "all") params.set("classification", classification);
      if (status !== "all") params.set("status", status);
      if (sentiment !== "all") params.set("sentiment", sentiment);
      params.set("limit", "200");
      return fetch(`/api/marketing/replies?${params}`).then(r => r.ok ? r.json() : []);
    },
    staleTime: 30000,
  });

  const reviewMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/marketing/replies/${id}/review`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/marketing/replies"] }); toast({ title: "Marked as reviewed" }); },
    onError: () => toast({ title: "Failed to mark reviewed", variant: "destructive" }),
  });

  const dismissMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/marketing/replies/${id}/dismiss`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/marketing/replies"] }); toast({ title: "Dismissed" }); },
    onError: () => toast({ title: "Failed to dismiss", variant: "destructive" }),
  });

  const createTaskMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/marketing/replies/${id}/create-task`, {}),
    onSuccess: (data: any) => { queryClient.invalidateQueries({ queryKey: ["/api/marketing/replies"] }); toast({ title: `Task created (#${data?.taskId ?? "?"})` }); },
    onError: (err: any) => toast({ title: err?.message ?? "Failed to create task", variant: "destructive" }),
  });

  const toggleExpand = (id: number) => {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const pendingCount = (replies ?? []).filter(r => r.status === "pending").length;
  const actionableCount = (replies ?? []).filter(r => CLASSIFICATION_META[r.classification]?.actionable).length;
  const autoIngestedCount = (replies ?? []).filter(r => r.ingestion_source === "inbound_ingested").length;

  return (
    <div>
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total", value: replies?.length ?? 0, icon: MessageSquare, color: "text-primary", metric: "replies_total" },
          { label: "Pending Review", value: pendingCount, icon: Clock, color: "text-amber-400", metric: "replies_pending" },
          { label: "Auto-Ingested", value: autoIngestedCount, icon: Zap, color: "text-cyan-400", metric: "replies_auto_ingested" },
          { label: "Tasks Created", value: (replies ?? []).filter(r => r.status === "task_created").length, icon: CheckCircle, color: "text-emerald-400", metric: "replies_task_created" },
        ].map(s => (
          <Card
            key={s.label}
            className="border-border/50 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all group"
            onClick={() => setDrilldown({ metric: s.metric, title: s.label })}
            data-testid={`reply-stat-${s.metric}`}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <s.icon className={`h-4 w-4 shrink-0 ${s.color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-lg font-semibold text-foreground leading-none">{s.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
              </div>
              <span className="text-[10px] text-primary/50 group-hover:text-primary/80 transition-colors shrink-0">→</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <MarketingDrilldownSheet config={drilldown} onClose={() => setDrilldown(null)} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4" data-testid="reply-filters">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />Filter:
        </div>
        <Select value={classification} onValueChange={setClassification}>
          <SelectTrigger className="w-44 h-8 text-xs" data-testid="select-classification-filter">
            <SelectValue placeholder="Classification" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classifications</SelectItem>
            {Object.entries(CLASSIFICATION_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sentiment} onValueChange={setSentiment}>
          <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-sentiment-filter">
            <SelectValue placeholder="Sentiment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sentiments</SelectItem>
            <SelectItem value="positive">Positive</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
            <SelectItem value="negative">Negative</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5 ml-auto" onClick={() => refetch()} data-testid="button-refresh-replies">
          <RefreshCw className="h-3.5 w-3.5" />Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border border-border/40 bg-card/50 p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-4 w-24 bg-muted/40 rounded" />
                <div className="h-4 w-32 bg-muted/30 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : !replies || replies.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground font-medium">No reply classifications yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm mx-auto">
            Inbound campaign replies will appear here automatically, or use{" "}
            <code className="font-mono">POST /api/marketing/replies/classify</code> manually.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {replies.map(reply => {
            const meta = CLASSIFICATION_META[reply.classification] ?? CLASSIFICATION_META.unknown;
            const statusMeta = STATUS_META[reply.status] ?? STATUS_META.pending;
            const isExpanded = expanded.has(reply.id);
            const Icon = meta.icon;
            const canCreateTask = meta.actionable && reply.status !== "task_created" && reply.status !== "dismissed" && !!reply.recommended_task_title;
            const canReview = reply.status === "pending";
            const canDismiss = reply.status !== "dismissed";

            return (
              <div key={reply.id} className="rounded-lg border border-border/40 bg-card/60 hover:bg-card/80 transition-colors" data-testid={`reply-row-${reply.id}`}>
                <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => toggleExpand(reply.id)}>
                  <div className="mt-0.5 shrink-0 text-muted-foreground/50">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </div>
                  <div className="shrink-0 mt-0.5">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.color}`}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {reply.contact_name && <span className="text-sm font-medium text-foreground truncate">{reply.contact_name}</span>}
                      {reply.account_name && <span className="text-xs text-muted-foreground truncate">· {reply.account_name}</span>}
                    </div>
                    {reply.campaign_name && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">via {reply.campaign_name}</p>
                    )}
                    <div className="mt-1">
                      <SourcePill source={reply.ingestion_source} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <SentimentDot sentiment={reply.sentiment} />
                    <ConfidencePill value={reply.confidence} />
                    <span className={`hidden sm:inline text-[10px] px-1.5 py-0.5 rounded border ${statusMeta.color}`}>
                      {statusMeta.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground/60 hidden md:inline">
                      {formatAgo(reply.created_at)}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-0">
                    <Separator className="mb-3 opacity-30" />
                    {reply.reply_body_preview && (
                      <div className="rounded bg-muted/20 border border-border/30 px-3 py-2 mb-3">
                        <p className="text-[11px] text-muted-foreground/70 font-mono leading-relaxed line-clamp-3">
                          "{reply.reply_body_preview}"
                        </p>
                      </div>
                    )}
                    {reply.recommended_action && (
                      <div className="flex items-start gap-2 mb-3">
                        <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                        <div>
                          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">Recommended Action</p>
                          <p className="text-xs text-foreground">{reply.recommended_action}</p>
                        </div>
                      </div>
                    )}
                    {reply.task_id && reply.task_title && (
                      <div className="flex items-center gap-2 mb-3 rounded bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5">
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <p className="text-xs text-emerald-400">Task: {reply.task_title}</p>
                      </div>
                    )}
                    {reply.branch_status && reply.branch_status !== "none" && (
                      <div className={`flex items-center gap-2 mb-3 rounded px-3 py-1.5 border ${
                        reply.branch_status.startsWith("stopped")
                          ? "bg-red-500/8 border-red-500/20"
                          : reply.branch_status === "sales_engaged"
                          ? "bg-cyan-500/8 border-cyan-500/20"
                          : "bg-muted/30 border-border/40"
                      }`} data-testid={`branch-status-${reply.id}`}>
                        <Zap className={`h-3.5 w-3.5 shrink-0 ${
                          reply.branch_status.startsWith("stopped") ? "text-red-400" :
                          reply.branch_status === "sales_engaged" ? "text-cyan-400" :
                          "text-muted-foreground"
                        }`} />
                        <span className={`text-xs font-medium ${
                          reply.branch_status.startsWith("stopped") ? "text-red-400" :
                          reply.branch_status === "sales_engaged" ? "text-cyan-400" :
                          "text-muted-foreground"
                        }`}>
                          Branch: {reply.branch_status.replace(/_/g, " ")}
                        </span>
                        {reply.branch_reason && (
                          <span className="text-[10px] text-muted-foreground/60 truncate ml-1">· {reply.branch_reason}</span>
                        )}
                      </div>
                    )}
                    {reply.source_message_id && (
                      <p className="text-[10px] text-muted-foreground/40 mb-2 font-mono">
                        msg: {reply.source_message_id.slice(0, 24)}…
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {canCreateTask && (
                        <Button size="sm" className="h-7 text-xs gap-1.5 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20" variant="outline"
                          onClick={e => { e.stopPropagation(); createTaskMut.mutate(reply.id); }} disabled={createTaskMut.isPending}
                          data-testid={`button-create-task-${reply.id}`}>
                          <Plus className="h-3 w-3" />Create Task
                        </Button>
                      )}
                      {canReview && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                          onClick={e => { e.stopPropagation(); reviewMut.mutate(reply.id); }} disabled={reviewMut.isPending}
                          data-testid={`button-review-${reply.id}`}>
                          <CheckCircle className="h-3 w-3" />Mark Reviewed
                        </Button>
                      )}
                      {canDismiss && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                          onClick={e => { e.stopPropagation(); dismissMut.mutate(reply.id); }} disabled={dismissMut.isPending}
                          data-testid={`button-dismiss-${reply.id}`}>
                          <XCircle className="h-3 w-3" />Dismiss
                        </Button>
                      )}
                      {reply.account_id && (
                        <Link href={`/accounts/${reply.account_id}`}>
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground">
                            View Account
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Unmatched replies tab ─────────────────────────────────────────────────────

function UnmatchedRepliesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: unmatched, isLoading, refetch } = useQuery<UnmatchedReply[]>({
    queryKey: ["/api/marketing/unmatched-replies"],
    queryFn: () => fetch("/api/marketing/unmatched-replies?limit=100").then(r => r.ok ? r.json() : []),
    staleTime: 30000,
  });

  const ignoreMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/marketing/unmatched-replies/${id}/ignore`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/unmatched-replies"] });
      toast({ title: "Marked as ignored" });
    },
    onError: () => toast({ title: "Failed to ignore", variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="rounded-lg border border-border/40 bg-card/50 p-4 animate-pulse h-16" />
      ))}
    </div>
  );

  if (!unmatched || unmatched.length === 0) return (
    <div className="text-center py-16">
      <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
      <p className="text-sm text-muted-foreground font-medium">No unmatched replies</p>
      <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm mx-auto">
        Inbound emails that can't be matched to a campaign recipient will appear here.
      </p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">
          {unmatched.length} unmatched {unmatched.length === 1 ? "reply" : "replies"} — these arrived but couldn't be matched to a campaign recipient.
        </p>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />Refresh
        </Button>
      </div>
      <div className="space-y-2">
        {unmatched.map(row => (
          <div key={row.id} className="rounded-lg border border-border/40 bg-card/60 px-4 py-3 flex items-start gap-3" data-testid={`unmatched-row-${row.id}`}>
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground truncate">{row.from_email}</span>
                <span className="text-[10px] text-muted-foreground/50 bg-muted/20 px-1.5 py-0.5 rounded">
                  {row.match_attempts} attempt{row.match_attempts !== 1 ? "s" : ""}
                </span>
              </div>
              {row.subject && <p className="text-xs text-muted-foreground truncate mt-0.5">{row.subject}</p>}
              {row.body_preview && (
                <p className="text-[11px] text-muted-foreground/50 truncate mt-0.5 font-mono">"{row.body_preview}"</p>
              )}
              {row.provider_thread_id && (
                <p className="text-[10px] text-muted-foreground/30 mt-0.5 font-mono">thread: {row.provider_thread_id.slice(0, 20)}…</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <span className="text-[11px] text-muted-foreground/60">{formatAgo(row.received_at)}</span>
              {row.status !== "ignored" && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground px-2"
                  onClick={() => ignoreMut.mutate(row.id)} disabled={ignoreMut.isPending}
                  data-testid={`button-ignore-unmatched-${row.id}`}>
                  <XCircle className="h-3 w-3" />Ignore
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MarketingRepliesPage() {
  const [tab, setTab] = useState<"matched" | "unmatched">("matched");

  const { data: unmatchedCount } = useQuery<number>({
    queryKey: ["/api/marketing/unmatched-replies", "count"],
    queryFn: () =>
      fetch("/api/marketing/unmatched-replies?limit=200")
        .then(r => r.ok ? r.json() : [])
        .then((rows: any[]) => rows.length),
    staleTime: 60000,
  });

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold text-foreground">Reply Intelligence</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Inbound campaign replies — classified by intent and linked to CRM actions.
            </p>
          </div>
        </div>

        {/* Ingestion status notice */}
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 mb-5 flex items-start gap-3">
          <Zap className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-cyan-300 font-medium">Automatic reply ingestion active (Phase 8)</p>
            <p className="text-xs text-cyan-400/70 mt-0.5">
              Gmail sync hooks now match new inbound replies to campaign recipients automatically via thread ID, In-Reply-To header, and subject fallback.
              Outbound campaign sends store provider IDs for matching. Unmatched replies are queued for retry.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-5 border-b border-border/40 pb-0">
          {[
            { id: "matched" as const, label: "Matched Replies", icon: MessageSquare, testid: "tab-matched" },
            { id: "unmatched" as const, label: "Unmatched Queue", icon: AlertTriangle, badge: unmatchedCount, testid: "tab-unmatched" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-testid={t.testid}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "matched" ? <MatchedRepliesTab /> : <UnmatchedRepliesTab />}
      </div>
    </div>
  );
}
