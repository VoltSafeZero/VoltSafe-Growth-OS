import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Mail, Phone, Building2, Users, Zap, CheckSquare,
  CalendarDays, TrendingUp, MessageSquare, AlertTriangle, RefreshCw,
  Clock, ExternalLink, Send, Plus, ChevronRight, DollarSign, Target, User, Pin,
  FileText, CheckCircle2, XCircle, MessagesSquare,
} from "lucide-react";
import { formatDistanceToNow, format, isPast } from "date-fns";
import { Link } from "wouter";
import { TimelineTab } from "@/components/timeline-tab";
import { RecordCurrentFeed } from "@/components/current/record-current-feed";
import { RecordSummaryBar } from "@/components/record-summary-bar";
import { ContactsPanel } from "@/components/contacts/contacts-panel";
import { SuggestedActionsCard } from "@/components/suggested-actions-card";

const STAGE_LABEL: Record<string, string> = {
  inbound_new: "New Lead", qualified: "Qualified", discovery: "Discovery",
  proposal: "Proposal", negotiation: "Negotiation", closed_won: "Won", closed_lost: "Lost",
};
const STAGE_COLOR: Record<string, string> = {
  inbound_new: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  qualified: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  discovery: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  proposal: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  negotiation: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  closed_won: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  closed_lost: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STAGE_ORDER = ["inbound_new", "qualified", "discovery", "proposal", "negotiation", "closed_won"];

type ProfileData = {
  opportunity: any;
  contacts: any[];
  emails: any[];
  meetings: any[];
  notes: any[];
  tasks: any[];
  stageHistory: any[];
  activities: any[];
  suggestedAction: string;
};

function SectionCard({ title, icon: Icon, count, children, action }: {
  title: string; icon: React.ElementType; count?: number; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            {count !== undefined && count > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs">{count}</Badge>
            )}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">{children}</CardContent>
    </Card>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground py-3 text-center italic">{text}</p>;
}

function NoteComposer({ oppId, onAdded }: { oppId: number; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notes", {
      content: text, linkedObjectType: "opportunity", linkedObjectId: oppId,
    }),
    onSuccess: () => { setText(""); setOpen(false); queryClient.invalidateQueries({ queryKey: ["/api/notes/all"] }); onAdded(); toast({ title: "Note saved" }); },
    onError: () => toast({ title: "Failed to save note", variant: "destructive" }),
  });
  if (!open) return (
    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground"
      onClick={() => setOpen(true)} data-testid="button-add-note">
      <Plus className="h-3 w-3" /> Add
    </Button>
  );
  return (
    <div className="mt-2 space-y-2">
      <Textarea value={text} onChange={e => setText(e.target.value)}
        placeholder="Write a note..." className="text-sm min-h-[80px] resize-none"
        data-testid="textarea-note" />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={!text.trim() || mutation.isPending}
          onClick={() => mutation.mutate()} className="gap-1.5" data-testid="button-save-note">
          <Send className="h-3 w-3" /> Save
        </Button>
      </div>
    </div>
  );
}

function StageBar({ currentStage, history }: { currentStage: string; history: any[] }) {
  const currentIdx = STAGE_ORDER.indexOf(currentStage);
  if (["closed_lost"].includes(currentStage)) return (
    <div className="flex items-center gap-2">
      <Badge className="bg-red-500/15 text-red-400 border-red-500/30 border">Closed Lost</Badge>
      {history.length > 0 && (
        <span className="text-xs text-muted-foreground">{history.length} stage change{history.length !== 1 ? "s" : ""}</span>
      )}
    </div>
  );
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STAGE_ORDER.filter(s => s !== "closed_lost").map((stage, i) => {
        const reached = STAGE_ORDER.indexOf(stage) <= currentIdx;
        const isCurrent = stage === currentStage;
        return (
          <div key={stage} className="flex items-center gap-1">
            <div className={`px-2 py-1 rounded text-[10px] font-medium transition-all
              ${isCurrent ? "bg-primary text-primary-foreground" : reached ? "bg-primary/20 text-primary" : "bg-secondary/50 text-muted-foreground"}`}>
              {STAGE_LABEL[stage]}
            </div>
            {i < STAGE_ORDER.filter(s => s !== "closed_lost").length - 1 && (
              <ChevronRight className="h-3 w-3 text-border flex-shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function OpportunityProfilePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const [currentInitMsg, setCurrentInitMsg] = useState<number | undefined>();
  const [currentInitThread, setCurrentInitThread] = useState<number | undefined>();
  const currentSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("tab") === "current") {
      const msgId = p.get("message");
      const threadId = p.get("thread");
      if (msgId) setCurrentInitMsg(Number(msgId));
      if (threadId) setCurrentInitThread(Number(threadId));
      setTimeout(() => currentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    }
  }, []);

  const { data, isLoading, isError, refetch } = useQuery<ProfileData>({
    queryKey: ["/api/opportunities", id, "profile"],
    queryFn: () => fetch(`/api/opportunities/${id}/profile`).then(r => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
  });

  const quoteSummaryQuery = useQuery<any>({
    queryKey: ["/api/opportunities", id, "quote-summary"],
    queryFn: () => fetch(`/api/opportunities/${id}/quote-summary`).then(r => r.ok ? r.json() : null),
    enabled: !!id,
  });

  if (isLoading) return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-40" />)}
      </div>
    </div>
  );

  if (isError || !data) return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm text-muted-foreground">Could not load opportunity profile.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );

  const { opportunity: opp, contacts, emails, meetings, notes, tasks, stageHistory, activities, suggestedAction } = data;
  const openTasks = tasks.filter((t: any) => t.status !== "done");
  const overdueTasks = openTasks.filter((t: any) => t.due_date && isPast(new Date(t.due_date)));
  const isClosed = ["closed_won", "closed_lost"].includes(opp.stage);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5" data-testid="opportunity-profile-page">
      {/* Back */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/opportunities")}
          className="gap-1.5 text-muted-foreground hover:text-foreground" data-testid="button-back">
          <ArrowLeft className="h-4 w-4" /> Leads
        </Button>
        <Link href="/opportunities">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="button-view-in-leads">
            <ExternalLink className="h-3.5 w-3.5" /> View in Leads list
          </Button>
        </Link>
      </div>

      {/* Deal Card */}
      <Card className="border-border/50">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4">
            {/* Title + meta */}
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h1 className="text-xl font-bold" data-testid="text-opp-title">{opp.title}</h1>
                  <Badge className={`text-xs border ${STAGE_COLOR[opp.stage] ?? ""}`}>
                    {STAGE_LABEL[opp.stage] ?? opp.stage}
                  </Badge>
                </div>
                {opp.account_name && (
                  <Link href={`/accounts/${opp.account_id}`}>
                    <div className="flex items-center gap-1 text-sm text-primary hover:underline cursor-pointer">
                      <Building2 className="h-3.5 w-3.5" /> {opp.account_name}
                    </div>
                  </Link>
                )}
                {opp.owner_name && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                    <User className="h-3.5 w-3.5" /> {opp.owner_name}
                  </div>
                )}
              </div>
              {/* KPIs */}
              <div className="flex gap-3 flex-shrink-0 flex-wrap">
                {opp.amount && (
                  <div className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                    <p className="text-lg font-bold text-primary" data-testid="text-opp-amount">${Number(opp.amount).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Deal value</p>
                  </div>
                )}
                {opp.est_close_date && (
                  <div className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                    <p className={`text-lg font-bold ${!isClosed && isPast(new Date(opp.est_close_date)) ? "text-red-400" : "text-foreground"}`}>
                      {format(new Date(opp.est_close_date), "MMM d")}
                    </p>
                    <p className="text-xs text-muted-foreground">Close date</p>
                  </div>
                )}
                {overdueTasks.length > 0 && (
                  <div className="text-center px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <p className="text-lg font-bold text-red-400">{overdueTasks.length}</p>
                    <p className="text-xs text-muted-foreground">Overdue</p>
                  </div>
                )}
              </div>
            </div>

            {/* Stage bar */}
            <StageBar currentStage={opp.stage} history={stageHistory} />

            {/* Next step */}
            {opp.next_step && (
              <div className="flex items-start gap-2 text-sm p-2.5 rounded-lg bg-secondary/30 border border-border/40">
                <Target className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-medium text-muted-foreground">Next step: </span>
                  <span>{opp.next_step}</span>
                  {opp.next_step_due_date && (
                    <span className={`ml-1.5 text-xs ${isPast(new Date(opp.next_step_due_date)) ? "text-red-400" : "text-muted-foreground"}`}>
                      · due {format(new Date(opp.next_step_due_date), "MMM d")}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Suggested Action */}
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <Zap className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-0.5">Suggested Next Action</p>
                <p className="text-sm text-foreground" data-testid="text-suggested-action">{suggestedAction}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Field Quick Actions — one-tap actions for field use */}
      <div className="grid grid-cols-3 gap-2" data-testid="field-quick-actions">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "note" } }))}
          data-testid="button-quick-note"
          className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/40 border border-border/40 hover:bg-primary/10 hover:border-primary/30 active:scale-95 transition-all"
        >
          <MessageSquare className="h-5 w-5 text-primary" />
          <span className="text-xs font-medium">Note</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "task" } }))}
          data-testid="button-quick-task"
          className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/40 border border-border/40 hover:bg-primary/10 hover:border-primary/30 active:scale-95 transition-all"
        >
          <CheckSquare className="h-5 w-5 text-primary" />
          <span className="text-xs font-medium">Task</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "meeting-note" } }))}
          data-testid="button-quick-log-call"
          className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/40 border border-border/40 hover:bg-primary/10 hover:border-primary/30 active:scale-95 transition-all"
        >
          <Phone className="h-5 w-5 text-primary" />
          <span className="text-xs font-medium">Log Call</span>
        </button>
      </div>

      {/* Record Summary Bar */}
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <RecordSummaryBar objectType="opportunity" objectId={id} />
        </CardContent>
      </Card>

      {/* Suggested Next Actions */}
      <SuggestedActionsCard
        objectType="opportunity"
        objectId={id}
        onScrollToSection={(section) => {
          document.getElementById(`opportunity-${section}-section`)?.scrollIntoView({ behavior: "smooth" });
        }}
      />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left */}
        <div className="lg:col-span-2 space-y-4">
          {/* Emails */}
          <SectionCard title="Related Emails" icon={Mail} count={emails.length}>
            {emails.length === 0 ? <EmptyRow text="No emails synced for this deal's account" /> : (
              <div className="space-y-0.5">
                {emails.map((e: any) => (
                  <div key={e.id} className="flex items-start gap-2.5 py-2 border-b border-border/30 last:border-0">
                    <div className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.direction === "inbound" ? "bg-blue-400" : "bg-emerald-400"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{e.subject || "(no subject)"}</div>
                      <div className="text-xs text-muted-foreground truncate">{e.from_name || e.from_email} · {e.sent_at ? formatDistanceToNow(new Date(e.sent_at), { addSuffix: true }) : "—"}</div>
                      {e.snippet && <div className="text-xs text-muted-foreground/60 truncate mt-0.5">{e.snippet}</div>}
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${e.direction === "inbound" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                      {e.direction === "inbound" ? "In" : "Out"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Meetings */}
          <SectionCard title="Meetings" icon={CalendarDays} count={meetings.length}>
            {meetings.length === 0 ? <EmptyRow text="No meetings linked to this opportunity" /> : (
              <div className="space-y-0.5">
                {meetings.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-2.5 py-2 border-b border-border/30 last:border-0">
                    <CalendarDays className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{m.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.start_time ? format(new Date(m.start_time), "MMM d, yyyy h:mm a") : "—"}
                        {m.location && ` · ${m.location}`}
                      </div>
                    </div>
                    {m.meeting_url && (
                      <a href={m.meeting_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Key Facts (pinned notes) */}
          {notes.some((n: any) => n.is_pinned) && (
            <SectionCard title="Key Facts" icon={Pin}>
              <div className="space-y-2">
                {notes.filter((n: any) => n.is_pinned).map((n: any) => (
                  <div key={n.id} className="rounded-lg border border-primary/25 bg-primary/8 p-3" data-testid={`key-fact-${n.id}`}>
                    <p className="text-sm whitespace-pre-wrap font-medium">{n.content}</p>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {n.author_name} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Notes */}
          <SectionCard title="Notes" icon={MessageSquare} count={notes.length}
            action={<NoteComposer oppId={id} onAdded={() => refetch()} />}>
            {notes.length === 0 ? <EmptyRow text="No notes yet — add one above" /> : (
              <div className="space-y-3">
                {notes.filter((n: any) => !n.is_pinned).length === 0
                  ? <EmptyRow text="All notes pinned as key facts above" />
                  : notes.filter((n: any) => !n.is_pinned).map((n: any) => (
                    <div key={n.id} className="rounded-lg bg-secondary/30 p-3">
                      <p className="text-sm whitespace-pre-wrap">{n.content}</p>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {n.author_name} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </SectionCard>

          {/* Stage history */}
          {stageHistory.length > 0 && (
            <SectionCard title="Stage History" icon={Clock} count={stageHistory.length}>
              <div className="space-y-1.5">
                {stageHistory.map((h: any, i: number) => (
                  <div key={i} className="flex items-center gap-2.5 py-1.5 border-b border-border/20 last:border-0">
                    <div className="text-xs text-muted-foreground w-24 flex-shrink-0">
                      {format(new Date(h.changed_at), "MMM d, yyyy")}
                    </div>
                    <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${STAGE_COLOR[h.from_stage] ?? ""}`}>
                      {STAGE_LABEL[h.from_stage] ?? h.from_stage}
                    </Badge>
                    <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${STAGE_COLOR[h.to_stage] ?? ""}`}>
                      {STAGE_LABEL[h.to_stage] ?? h.to_stage}
                    </Badge>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        {/* Right */}
        <div className="space-y-4">
          {/* Contacts */}
          <SectionCard title="Stakeholders" icon={Users} count={contacts.length}>
            <ContactsPanel entityType="opportunity" entityId={opp.id} emptyText="No contacts linked to this deal yet." />
          </SectionCard>

          {/* Tasks */}
          <SectionCard title="Tasks" icon={CheckSquare} count={openTasks.length}>
            {tasks.length === 0 ? <EmptyRow text="No tasks linked" /> : (
              <div className="space-y-1.5">
                {tasks.map((t: any) => {
                  const overdue = t.status !== "done" && t.due_date && isPast(new Date(t.due_date));
                  return (
                    <div key={t.id} className="flex items-start gap-2 py-1.5 border-b border-border/20 last:border-0"
                      data-testid={`task-row-${t.id}`}>
                      <div className={`w-3 h-3 rounded-full border mt-0.5 flex-shrink-0 ${t.status === "done" ? "bg-emerald-500 border-emerald-500" : overdue ? "border-red-400" : "border-border"}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm leading-tight ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
                        {t.due_date && (
                          <p className={`text-xs mt-0.5 ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
                            {overdue ? "Overdue · " : "Due "}{format(new Date(t.due_date), "MMM d")}
                          </p>
                        )}
                      </div>
                      {t.priority && t.priority !== "normal" && (
                        <Badge variant="outline" className={`text-[10px] h-4 px-1 flex-shrink-0 ${t.priority === "high" ? "text-red-400 border-red-400/30" : "text-amber-400 border-amber-400/30"}`}>
                          {t.priority}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Quote Summary */}
          {quoteSummaryQuery.data && (
            <SectionCard title="Quotes" icon={FileText} count={quoteSummaryQuery.data.quoteCount}>
              {quoteSummaryQuery.data.quoteCount === 0 ? (
                <EmptyRow text="No quotes linked to this deal" />
              ) : (
                <div className="space-y-2">
                  {quoteSummaryQuery.data.latestQuote && (
                    <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1.5" data-testid="quote-summary-latest">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{quoteSummaryQuery.data.latestQuote.title || `Quote #${quoteSummaryQuery.data.latestQuote.id}`}</span>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 flex-shrink-0 ${
                          quoteSummaryQuery.data.latestQuote.status === "accepted" ? "text-green-400 border-green-400/30" :
                          quoteSummaryQuery.data.latestQuote.status === "sent" ? "text-blue-400 border-blue-400/30" :
                          quoteSummaryQuery.data.latestQuote.status === "declined" ? "text-red-400 border-red-400/30" :
                          quoteSummaryQuery.data.latestQuote.status === "expired" ? "text-yellow-400 border-yellow-400/30" :
                          "text-muted-foreground border-border"
                        }`} data-testid="quote-summary-status">
                          {quoteSummaryQuery.data.latestQuote.status}
                        </Badge>
                      </div>
                      {quoteSummaryQuery.data.latestQuote.total && (
                        <div className="flex items-center gap-1 text-sm font-semibold text-primary">
                          <DollarSign className="h-3.5 w-3.5" />
                          {Number(quoteSummaryQuery.data.latestQuote.total).toLocaleString()}
                        </div>
                      )}
                      {quoteSummaryQuery.data.latestQuote.valid_until && (
                        <div className={`flex items-center gap-1 text-xs ${
                          isPast(new Date(quoteSummaryQuery.data.latestQuote.valid_until)) && !["accepted","archived"].includes(quoteSummaryQuery.data.latestQuote.status)
                            ? "text-red-400" : "text-muted-foreground"
                        }`}>
                          <Clock className="h-3 w-3" />
                          {isPast(new Date(quoteSummaryQuery.data.latestQuote.valid_until)) ? "Expired " : "Expires "}
                          {format(new Date(quoteSummaryQuery.data.latestQuote.valid_until), "MMM d, yyyy")}
                        </div>
                      )}
                      {quoteSummaryQuery.data.isStale && (
                        <div className="flex items-center gap-1 text-xs text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> Quote may need follow-up
                        </div>
                      )}
                    </div>
                  )}
                  {quoteSummaryQuery.data.quoteCount > 1 && (
                    <p className="text-xs text-muted-foreground text-center">+{quoteSummaryQuery.data.quoteCount - 1} more quote{quoteSummaryQuery.data.quoteCount > 2 ? "s" : ""}</p>
                  )}
                  <Link href={`/quotes?opportunityId=${id}`}>
                    <Button variant="outline" size="sm" className="w-full h-7 text-xs" data-testid="button-view-all-quotes">
                      <FileText className="h-3.5 w-3.5 mr-1" /> View All Quotes
                    </Button>
                  </Link>
                </div>
              )}
            </SectionCard>
          )}

          {/* Deal detail */}
          <Card className="border-border/50">
            <CardContent className="p-4 space-y-2.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Deal Details</p>
              {[
                { label: "Hardware", value: opp.value_hardware ? `$${Number(opp.value_hardware).toLocaleString()}` : null },
                { label: "Software", value: opp.value_software ? `$${Number(opp.value_software).toLocaleString()}` : null },
                { label: "Services", value: opp.value_services ? `$${Number(opp.value_services).toLocaleString()}` : null },
                { label: "Slip Count", value: opp.slip_count_int != null ? String(opp.slip_count_int) : (opp.estimated_slips_impacted ? String(opp.estimated_slips_impacted) : null) },
                { label: "Est. Pedestals", value: opp.estimated_pedestal_count ? String(opp.estimated_pedestal_count) : null },
                { label: "Forecast", value: opp.forecast_category },
              ].filter(d => d.value).map(d => (
                <div key={d.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="font-medium capitalize">{d.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Unified Timeline — full width */}
      <div className="mt-2">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 border-t border-border/30" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Unified Timeline</span>
          <div className="flex-1 border-t border-border/30" />
        </div>
        <TimelineTab objectType="opportunity" objectId={id} />
      </div>

      {/* Current Feed */}
      <div ref={currentSectionRef} id="opportunity-current-section" data-testid="opportunity-current-section">
        <div className="flex items-center gap-2 my-3">
          <div className="flex-1 border-t border-border/30" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
            <MessagesSquare className="h-3 w-3" /> CURRENTS
          </span>
          <div className="flex-1 border-t border-border/30" />
        </div>
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <div className="h-[420px] flex flex-col">
              <RecordCurrentFeed
                objectType="opportunity"
                objectId={id}
                initialMessageId={currentInitMsg}
                initialThreadId={currentInitThread}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
