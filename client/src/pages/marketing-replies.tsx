import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  MessageSquare, CheckCircle, XCircle, Plus, RefreshCw, Filter, ChevronDown, ChevronRight,
  Sparkles, AlertTriangle, Calendar, Phone, Send, HelpCircle,
  TrendingUp, Users, Mail, Clock
} from "lucide-react";
import { Link } from "wouter";

type ReplyClassificationRecord = {
  id: number;
  campaign_id: number | null;
  campaign_email_id: number | null;
  campaign_recipient_id: number | null;
  contact_id: number | null;
  account_id: number | null;
  source_message_id: string | null;
  source_thread_id: string | null;
  reply_body_preview: string | null;
  classification: string;
  confidence: number;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  objection_type: string | null;
  recommended_action: string;
  recommended_task_title: string;
  recommended_task_body: string;
  assigned_to_user_id: number | null;
  task_id: number | null;
  status: string;
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  contact_name?: string | null;
  contact_email?: string | null;
  account_name?: string | null;
  campaign_name?: string | null;
  task_title?: string | null;
  task_status?: string | null;
};

const CLASSIFICATION_META: Record<string, { label: string; color: string; icon: typeof MessageSquare; actionable: boolean }> = {
  interested:           { label: "Interested",          color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30", icon: TrendingUp,     actionable: true },
  meeting_request:      { label: "Meeting Request",     color: "text-cyan-400 bg-cyan-500/15 border-cyan-500/30",         icon: Calendar,       actionable: true },
  pricing_question:     { label: "Pricing Question",    color: "text-blue-400 bg-blue-500/15 border-blue-500/30",         icon: Send,           actionable: true },
  technical_question:   { label: "Technical Question",  color: "text-violet-400 bg-violet-500/15 border-violet-500/30",   icon: HelpCircle,     actionable: true },
  procurement_question: { label: "Procurement",         color: "text-amber-400 bg-amber-500/15 border-amber-500/30",      icon: Users,          actionable: true },
  referral:             { label: "Referral",            color: "text-teal-400 bg-teal-500/15 border-teal-500/30",         icon: Users,          actionable: true },
  not_now:              { label: "Not Now",             color: "text-orange-400 bg-orange-500/15 border-orange-500/30",   icon: Clock,          actionable: true },
  objection:            { label: "Objection",           color: "text-yellow-400 bg-yellow-500/15 border-yellow-500/30",   icon: AlertTriangle,  actionable: true },
  wrong_person:         { label: "Wrong Person",        color: "text-slate-400 bg-slate-500/15 border-slate-500/30",      icon: Users,          actionable: true },
  unsubscribe:          { label: "Unsubscribe",         color: "text-rose-400 bg-rose-500/15 border-rose-500/30",         icon: XCircle,        actionable: false },
  negative:             { label: "Negative",            color: "text-red-400 bg-red-500/15 border-red-500/30",            icon: XCircle,        actionable: false },
  out_of_office:        { label: "Out of Office",       color: "text-slate-400 bg-slate-500/10 border-slate-500/20",      icon: Mail,           actionable: false },
  auto_reply:           { label: "Auto Reply",          color: "text-slate-400 bg-slate-500/10 border-slate-500/20",      icon: Mail,           actionable: false },
  unknown:              { label: "Unknown",             color: "text-muted-foreground bg-muted/20 border-border/30",      icon: HelpCircle,     actionable: false },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:      { label: "Pending Review", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  reviewed:     { label: "Reviewed",       color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  task_created: { label: "Task Created",   color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  ignored:      { label: "Ignored",        color: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
  dismissed:    { label: "Dismissed",      color: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
};

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? "text-emerald-400" : pct >= 65 ? "text-amber-400" : "text-slate-400";
  return <span className={`text-xs font-mono tabular-nums ${color}`}>{pct}%</span>;
}

function SentimentDot({ sentiment }: { sentiment: string }) {
  const colors: Record<string, string> = {
    positive: "bg-emerald-400",
    negative: "bg-rose-400",
    neutral: "bg-slate-400",
    unknown: "bg-muted-foreground/30",
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[sentiment] ?? "bg-muted-foreground/30"}`} title={sentiment} />
  );
}

function formatAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (d >= 1) return `${d}d ago`;
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return "Just now";
}

export default function MarketingRepliesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/marketing/replies/${id}/review`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/replies"] });
      toast({ title: "Marked as reviewed" });
    },
    onError: () => toast({ title: "Failed to mark reviewed", variant: "destructive" }),
  });

  const dismissMut = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/marketing/replies/${id}/dismiss`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/replies"] });
      toast({ title: "Dismissed" });
    },
    onError: () => toast({ title: "Failed to dismiss", variant: "destructive" }),
  });

  const createTaskMut = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/marketing/replies/${id}/create-task`, {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/replies"] });
      toast({ title: `Task created (#${data?.taskId ?? "?"})` });
    },
    onError: (err: any) => toast({ title: err?.message ?? "Failed to create task", variant: "destructive" }),
  });

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const pendingCount = (replies ?? []).filter(r => r.status === "pending").length;
  const actionableCount = (replies ?? []).filter(r => CLASSIFICATION_META[r.classification]?.actionable).length;

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold text-foreground">Reply Intelligence</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Campaign replies classified by intent — turn high-signal replies into CRM tasks.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-2"
            data-testid="button-refresh-replies"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Replies", value: replies?.length ?? 0, icon: MessageSquare, color: "text-primary" },
            { label: "Pending Review", value: pendingCount, icon: Clock, color: "text-amber-400" },
            { label: "Actionable", value: actionableCount, icon: TrendingUp, color: "text-emerald-400" },
            { label: "Tasks Created", value: (replies ?? []).filter(r => r.status === "task_created").length, icon: CheckCircle, color: "text-blue-400" },
          ].map(stat => (
            <Card key={stat.label} className="border-border/50">
              <CardContent className="p-3 flex items-center gap-3">
                <stat.icon className={`h-4 w-4 shrink-0 ${stat.color}`} />
                <div>
                  <p className="text-lg font-semibold text-foreground leading-none">{stat.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Gap notice */}
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 mb-5 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-amber-300 font-medium">Automatic reply ingestion not yet available</p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              Gmail sync is outbound-focused. Replies are classified when manually submitted via the API or a future Gmail-reply-matching integration.
              Use the classify endpoint (<code className="font-mono text-xs">POST /api/marketing/replies/classify</code>) to process known replies.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-5" data-testid="reply-filters">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            Filter:
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
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="rounded-lg border border-border/40 bg-card/50 p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-24 bg-muted/40 rounded" />
                  <div className="h-4 w-32 bg-muted/30 rounded" />
                  <div className="ml-auto h-4 w-16 bg-muted/30 rounded" />
                </div>
                <div className="mt-3 h-3 w-3/4 bg-muted/20 rounded" />
              </div>
            ))}
          </div>
        ) : !replies || replies.length === 0 ? (
          <div className="text-center py-20">
            <MessageSquare className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground font-medium">No reply classifications yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm mx-auto">
              Classified replies will appear here. Use{" "}
              <code className="font-mono">POST /api/marketing/replies/classify</code> to submit a reply for classification.
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
                <div
                  key={reply.id}
                  className="rounded-lg border border-border/40 bg-card/60 hover:bg-card/80 transition-colors"
                  data-testid={`reply-row-${reply.id}`}
                >
                  <div
                    className="flex items-start gap-3 p-4 cursor-pointer"
                    onClick={() => toggleExpand(reply.id)}
                  >
                    {/* Expand toggle */}
                    <div className="mt-0.5 shrink-0 text-muted-foreground/50">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>

                    {/* Classification badge */}
                    <div className="shrink-0 mt-0.5">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.color}`}>
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </span>
                    </div>

                    {/* Contact / account */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {reply.contact_name && (
                          <span className="text-sm font-medium text-foreground truncate">{reply.contact_name}</span>
                        )}
                        {reply.account_name && (
                          <span className="text-xs text-muted-foreground truncate">· {reply.account_name}</span>
                        )}
                      </div>
                      {reply.campaign_name && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">via {reply.campaign_name}</p>
                      )}
                    </div>

                    {/* Right side: confidence, sentiment, status, date */}
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

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0">
                      <Separator className="mb-3 opacity-30" />

                      {/* Preview */}
                      {reply.reply_body_preview && (
                        <div className="rounded bg-muted/20 border border-border/30 px-3 py-2 mb-3">
                          <p className="text-[11px] text-muted-foreground/70 font-mono leading-relaxed line-clamp-3">
                            "{reply.reply_body_preview}"
                          </p>
                        </div>
                      )}

                      {/* Recommended action */}
                      {reply.recommended_action && (
                        <div className="flex items-start gap-2 mb-3">
                          <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                          <div>
                            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">Recommended Action</p>
                            <p className="text-xs text-foreground">{reply.recommended_action}</p>
                          </div>
                        </div>
                      )}

                      {/* Task info (if created) */}
                      {reply.task_id && reply.task_title && (
                        <div className="flex items-center gap-2 mb-3 rounded bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5">
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <p className="text-xs text-emerald-400">Task created: {reply.task_title}</p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-wrap gap-2">
                        {canCreateTask && (
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1.5 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
                            variant="outline"
                            onClick={e => { e.stopPropagation(); createTaskMut.mutate(reply.id); }}
                            disabled={createTaskMut.isPending}
                            data-testid={`button-create-task-${reply.id}`}
                          >
                            <Plus className="h-3 w-3" />
                            Create Task
                          </Button>
                        )}
                        {canReview && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1.5"
                            onClick={e => { e.stopPropagation(); reviewMut.mutate(reply.id); }}
                            disabled={reviewMut.isPending}
                            data-testid={`button-review-${reply.id}`}
                          >
                            <CheckCircle className="h-3 w-3" />
                            Mark Reviewed
                          </Button>
                        )}
                        {canDismiss && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                            onClick={e => { e.stopPropagation(); dismissMut.mutate(reply.id); }}
                            disabled={dismissMut.isPending}
                            data-testid={`button-dismiss-${reply.id}`}
                          >
                            <XCircle className="h-3 w-3" />
                            Dismiss
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
    </div>
  );
}
