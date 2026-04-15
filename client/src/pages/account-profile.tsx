import { useState } from "react";
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
  MapPin, Globe, Clock, ExternalLink, Send, Plus, User, Anchor, Pin,
} from "lucide-react";
import { formatDistanceToNow, format, isPast } from "date-fns";
import { Link } from "wouter";
import { RecordSummaryBar } from "@/components/record-summary-bar";
import { SuggestedActionsCard } from "@/components/suggested-actions-card";

const STAGE_LABEL: Record<string, string> = {
  inbound_new: "New", qualified: "Qualified", discovery: "Discovery",
  proposal: "Proposal", negotiation: "Negotiation", closed_won: "Won", closed_lost: "Lost",
};
const STAGE_COLOR: Record<string, string> = {
  inbound_new: "bg-slate-500/15 text-slate-400",
  qualified: "bg-blue-500/15 text-blue-400",
  discovery: "bg-violet-500/15 text-violet-400",
  proposal: "bg-amber-500/15 text-amber-400",
  negotiation: "bg-orange-500/15 text-orange-400",
  closed_won: "bg-emerald-500/15 text-emerald-400",
  closed_lost: "bg-red-500/15 text-red-400",
};
const SEG_COLOR: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-400",
  B: "bg-blue-500/15 text-blue-400",
  C: "bg-amber-500/15 text-amber-400",
  D: "bg-red-500/15 text-red-400",
};

type ProfileData = {
  account: any;
  contacts: any[];
  opportunities: any[];
  emails: any[];
  meetings: any[];
  notes: any[];
  tasks: any[];
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

function NoteComposer({ accountId, onAdded }: { accountId: number; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notes", {
      content: text, linkedObjectType: "account", linkedObjectId: accountId,
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

export default function AccountProfilePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();

  const { data, isLoading, isError, refetch } = useQuery<ProfileData>({
    queryKey: ["/api/accounts", id, "profile"],
    queryFn: () => fetch(`/api/accounts/${id}/profile`).then(r => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
  });

  if (isLoading) return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-40" />)}
      </div>
    </div>
  );

  if (isError || !data) return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm text-muted-foreground">Could not load account profile.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );

  const { account, contacts, opportunities, emails, meetings, notes, tasks, suggestedAction } = data;
  const openTasks = tasks.filter((t: any) => t.status !== "done");
  const overdueTasks = openTasks.filter((t: any) => t.due_date && isPast(new Date(t.due_date)));
  const openOpps = opportunities.filter((o: any) => !["closed_won", "closed_lost"].includes(o.stage));
  const wonOpps = opportunities.filter((o: any) => o.stage === "closed_won");
  const totalPipeline = openOpps.reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5" data-testid="account-profile-page">
      {/* Back */}
      <Button variant="ghost" size="sm" onClick={() => navigate("/accounts")}
        className="gap-1.5 text-muted-foreground hover:text-foreground" data-testid="button-back">
        <ArrowLeft className="h-4 w-4" /> Accounts
      </Button>

      {/* Identity Card */}
      <Card className="border-border/50">
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-shrink-0">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Anchor className="h-8 w-8 text-primary" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-xl font-bold" data-testid="text-account-name">{account.name}</h1>
                {account.segment && (
                  <Badge className={`text-xs ${SEG_COLOR[account.segment] ?? "bg-secondary"}`}>
                    Tier {account.segment}
                  </Badge>
                )}
                {account.priority && (
                  <Badge variant="outline" className="text-xs capitalize">{account.priority}</Badge>
                )}
              </div>
              {account.org_type && <p className="text-sm text-muted-foreground capitalize">{account.org_type.replace(/_/g, " ")}</p>}
              <div className="flex flex-wrap gap-3 mt-3">
                {(account.city || account.state_province) && (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    {[account.city, account.state_province].filter(Boolean).join(", ")}
                  </span>
                )}
                {account.website && (
                  <a href={account.website.startsWith("http") ? account.website : `https://${account.website}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <Globe className="h-3.5 w-3.5 text-primary" /> {account.website}
                  </a>
                )}
                {account.slip_count && (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Anchor className="h-3.5 w-3.5 text-primary" /> {account.slip_count} slips
                  </span>
                )}
              </div>
              {/* KPIs */}
              <div className="flex flex-wrap gap-3 mt-4">
                {[
                  { label: "Contacts", value: contacts.length, color: "text-foreground" },
                  { label: "Open Deals", value: openOpps.length, color: "text-blue-400" },
                  { label: "Pipeline", value: totalPipeline > 0 ? `$${(totalPipeline / 1000).toFixed(0)}k` : "$0", color: "text-primary" },
                  { label: "Won", value: wonOpps.length, color: "text-emerald-400" },
                ].map(kpi => (
                  <div key={kpi.label} className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                    <p className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</p>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-shrink-0 flex flex-col gap-2 sm:items-end">
              {overdueTasks.length > 0 && (
                <Badge variant="destructive" className="text-xs">{overdueTasks.length} overdue</Badge>
              )}
              {account.next_action && (
                <div className="text-xs text-muted-foreground text-right max-w-[160px]">
                  <span className="text-primary font-medium">Next:</span> {account.next_action}
                </div>
              )}
            </div>
          </div>

          {/* Suggested Action */}
          <div className="mt-4 flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/20">
            <Zap className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-0.5">Suggested Next Action</p>
              <p className="text-sm text-foreground" data-testid="text-suggested-action">{suggestedAction}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Field Quick Actions — one-tap actions for field use */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="field-quick-actions">
        {account.website ? (
          <a
            href={account.website.startsWith("http") ? account.website : `https://${account.website}`}
            target="_blank" rel="noopener noreferrer"
            data-testid="button-quick-website"
            className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/40 border border-border/40 hover:bg-primary/10 hover:border-primary/30 active:scale-95 transition-all"
          >
            <Globe className="h-5 w-5 text-primary" />
            <span className="text-xs font-medium">Website</span>
          </a>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/20 border border-border/20 opacity-30 cursor-not-allowed">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Website</span>
          </div>
        )}
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
          onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "opportunity" } }))}
          data-testid="button-quick-deal"
          className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/40 border border-border/40 hover:bg-primary/10 hover:border-primary/30 active:scale-95 transition-all"
        >
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="text-xs font-medium">New Deal</span>
        </button>
      </div>

      {/* Record Summary Bar */}
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <RecordSummaryBar objectType="account" objectId={id} />
        </CardContent>
      </Card>

      {/* Suggested Next Actions */}
      <SuggestedActionsCard
        objectType="account"
        objectId={id}
        onOpenNoteComposer={() => {
          document.getElementById("account-notes-section")?.scrollIntoView({ behavior: "smooth" });
        }}
        onScrollToSection={(section) => {
          document.getElementById(`account-${section}-section`)?.scrollIntoView({ behavior: "smooth" });
        }}
      />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left */}
        <div className="lg:col-span-2 space-y-4">
          {/* Emails */}
          <SectionCard title="Recent Emails" icon={Mail} count={emails.length}>
            {emails.length === 0 ? <EmptyRow text="No emails synced for this account" /> : (
              <div className="space-y-0.5">
                {emails.map((e: any) => (
                  <div key={e.id} className="flex items-start gap-2.5 py-2 border-b border-border/30 last:border-0">
                    <div className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.direction === "inbound" ? "bg-blue-400" : "bg-emerald-400"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate" data-testid={`email-subject-${e.id}`}>{e.subject || "(no subject)"}</div>
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
            {meetings.length === 0 ? <EmptyRow text="No meetings linked to this account" /> : (
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
            action={<NoteComposer accountId={id} onAdded={() => refetch()} />}>
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
        </div>

        {/* Right */}
        <div className="space-y-4">
          {/* Contacts */}
          <SectionCard title="Contacts" icon={Users} count={contacts.length}>
            {contacts.length === 0 ? <EmptyRow text="No contacts on record" /> : (
              <div className="space-y-1.5">
                {contacts.map((c: any) => (
                  <Link key={c.id} href={`/contacts/${c.id}`}>
                    <div className="flex items-center gap-2.5 py-2 border-b border-border/20 last:border-0 cursor-pointer hover:bg-muted/20 -mx-1 px-1 rounded"
                      data-testid={`contact-link-${c.id}`}>
                      <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {(c.name || "?")[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.title || c.role_type || c.email || "—"}</p>
                      </div>
                      {c.is_primary && <Badge variant="outline" className="text-[10px] h-4 px-1 flex-shrink-0">Primary</Badge>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Opportunities */}
          <SectionCard title="Opportunities" icon={TrendingUp} count={opportunities.length}>
            {opportunities.length === 0 ? <EmptyRow text="No deals on record" /> : (
              <div className="space-y-2">
                {opportunities.map((o: any) => (
                  <Link key={o.id} href={`/opportunities/${o.id}`}>
                    <div className="p-2.5 rounded-lg border border-border/40 hover:border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      data-testid={`opp-link-${o.id}`}>
                      <div className="text-sm font-medium truncate">{o.title}</div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${STAGE_COLOR[o.stage] ?? ""}`}>
                          {STAGE_LABEL[o.stage] ?? o.stage}
                        </Badge>
                        {o.amount && <span className="text-xs text-muted-foreground">${Number(o.amount).toLocaleString()}</span>}
                      </div>
                      {o.owner_name && <p className="text-xs text-muted-foreground mt-1">{o.owner_name}</p>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
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
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
