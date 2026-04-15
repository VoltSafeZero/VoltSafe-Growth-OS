import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  TrendingUp, Flame, AlertTriangle, CalendarDays, Handshake,
  Lightbulb, Building2, ChevronRight, Mail, UserPlus, Clock,
  CheckSquare, ArrowRight, Zap, Eye, Users, User, Star,
  Inbox, CalendarClock, BarChart3, Activity,
} from "lucide-react";
import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────
type Opp = {
  id: number; title: string; stage: string; amount?: number;
  accountName: string; ownerName: string; updatedAt?: string;
  estCloseDate?: string; daysSinceActivity?: number;
};
type TaskItem = {
  id: number; title: string; dueDate?: string; priority: string;
  status?: string; ownerUserId?: number;
};
type MeetingItem = {
  id: number; title: string; startTime: string; endTime?: string;
  location?: string; meetingUrl?: string; eventType?: string;
};
type ContactItem = {
  id: number; name: string; email?: string; accountName: string; createdAt?: string;
};
type EmailItem = {
  id: number; subject?: string; fromEmail?: string; sentAt?: string;
  direction?: string; snippet?: string;
};
type PartnerItem = {
  id: number; name: string; category: string;
  strategicImportance?: string; priorityLevel?: string; region?: string; updatedAt?: string;
};
type SuggestedAction = {
  type: string; text: string; link: string; priority: "high" | "medium" | "low";
};
type CommandCenterData = {
  userName: string; viewMode: "mine" | "team"; isAdmin: boolean;
  stats: {
    openOpportunities: number; hotDeals: number; overdueFollowUps: number;
    meetingsToday: number; activePartnerships: number;
    investorConversations: number; grantsGovt: number;
  };
  today: { meetings: MeetingItem[]; tasksDue: TaskItem[] };
  needsAttention: { overdueTasks: TaskItem[]; stalledDeals: Opp[]; noNextStep: Opp[] };
  pipelineMomentum: { topOpportunities: Opp[] };
  partnershipActivity: PartnerItem[];
  recentRelationshipActivity: { contacts: ContactItem[]; emails: EmailItem[] };
  suggestedActions: SuggestedAction[];
  intelligence: { upcomingMeetings: MeetingItem[]; inboxSignals: EmailItem[]; newContacts: ContactItem[] };
};

// ─── Constants ────────────────────────────────────────────────────────────────
const STAGE_LABEL: Record<string, string> = {
  inbound_new: "New", qualifying: "Qualifying", proposal: "Proposal",
  negotiation: "Negotiating", verbal_commit: "Verbal Commit",
  closed_won: "Won", closed_lost: "Lost",
};
const STAGE_COLOR: Record<string, string> = {
  verbal_commit: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  proposal: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  negotiation: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  qualifying: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  inbound_new: "bg-secondary/60 text-muted-foreground border-border/30",
};
const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-400", medium: "bg-amber-400", low: "bg-muted-foreground",
};
const ACTION_ICON: Record<string, React.ElementType> = {
  meeting: CalendarDays, task: CheckSquare, opportunity: TrendingUp,
  lead: UserPlus, email: Mail, deal: Flame,
};
const CATEGORY_LABEL: Record<string, string> = {
  strategic_industry: "Industry", government: "Govt / Grants",
  investor: "Investor", innovation_research: "Research", channel: "Channel",
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color, link, loading }: {
  label: string; value: number; icon: React.ElementType;
  color: string; link?: string; loading?: boolean;
}) {
  const inner = (
    <Card className={`border-border/50 hover:border-border transition-colors cursor-pointer ${link ? "hover:bg-muted/30" : ""}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          {loading ? (
            <Skeleton className="h-7 w-10 mb-1" />
          ) : (
            <div className="text-2xl font-bold leading-none">{value}</div>
          )}
          <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}

function SectionCard({ title, icon: Icon, count, children, linkTo, linkLabel, empty, emptyText }: {
  title: string; icon: React.ElementType; count?: number; children?: React.ReactNode;
  linkTo?: string; linkLabel?: string; empty?: boolean; emptyText?: string;
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
          {linkTo && (
            <Link href={linkTo}>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-foreground px-2 gap-1">
                {linkLabel ?? "View all"} <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {empty ? (
          <p className="text-xs text-muted-foreground py-3 text-center">{emptyText ?? "Nothing here"}</p>
        ) : children}
      </CardContent>
    </Card>
  );
}

function OppRow({ opp, showOwner }: { opp: Opp; showOwner?: boolean }) {
  return (
    <Link href={`/opportunities/${opp.id}`}>
      <div className="flex items-center gap-2 py-2 -mx-1 px-1 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{opp.title}</div>
          <div className="text-xs text-muted-foreground truncate">{opp.accountName}{showOwner && opp.ownerName !== "Unassigned" ? ` · ${opp.ownerName}` : ""}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {opp.stage && (
            <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${STAGE_COLOR[opp.stage] ?? "bg-secondary/60 text-muted-foreground"}`}>
              {STAGE_LABEL[opp.stage] ?? opp.stage}
            </Badge>
          )}
          {opp.amount != null && (
            <span className="text-xs font-medium text-foreground/70">${opp.amount.toLocaleString()}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

function TaskRow({ task }: { task: TaskItem }) {
  const overdue = task.dueDate && new Date(task.dueDate) < new Date();
  return (
    <div className="flex items-start gap-2 py-2 -mx-1 px-1 rounded-lg hover:bg-muted/40 transition-colors">
      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${PRIORITY_DOT[task.priority] ?? "bg-muted-foreground"}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm leading-snug">{task.title}</div>
        {task.dueDate && (
          <div className={`text-xs mt-0.5 ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
            {overdue ? "Overdue · " : "Due "}{format(new Date(task.dueDate), "MMM d")}
          </div>
        )}
      </div>
    </div>
  );
}

function MeetingRow({ meeting }: { meeting: MeetingItem }) {
  const start = new Date(meeting.startTime);
  const isPast = start < new Date();
  return (
    <Link href="/execution/calendar">
      <div className="flex items-center gap-2 py-2 -mx-1 px-1 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group">
        <div className="text-center flex-shrink-0 w-9">
          <div className="text-[10px] text-muted-foreground uppercase">{format(start, "EEE")}</div>
          <div className={`text-base font-bold leading-none ${isPast ? "text-muted-foreground" : ""}`}>{format(start, "d")}</div>
        </div>
        <Separator orientation="vertical" className="h-8" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{meeting.title}</div>
          <div className="text-xs text-muted-foreground">
            {format(start, "h:mm a")}{meeting.endTime ? ` – ${format(new Date(meeting.endTime), "h:mm a")}` : ""}
            {meeting.location ? ` · ${meeting.location}` : ""}
          </div>
        </div>
        {meeting.meetingUrl && (
          <a href={meeting.meetingUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            className="text-xs text-primary hover:underline flex-shrink-0">Join</a>
        )}
      </div>
    </Link>
  );
}

function EmailRow({ email }: { email: EmailItem }) {
  return (
    <Link href="/gmail">
      <div className="flex items-start gap-2 py-2 -mx-1 px-1 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group">
        <Mail className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{email.subject || "(no subject)"}</div>
          <div className="text-xs text-muted-foreground truncate">{email.fromEmail} · {email.sentAt ? formatDistanceToNow(new Date(email.sentAt), { addSuffix: true }) : ""}</div>
          {email.snippet && <div className="text-xs text-muted-foreground/60 truncate mt-0.5">{email.snippet}</div>}
        </div>
      </div>
    </Link>
  );
}

function ContactRow({ contact }: { contact: ContactItem }) {
  return (
    <Link href="/contacts">
      <div className="flex items-center gap-2 py-2 -mx-1 px-1 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group">
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] font-semibold text-primary">{(contact.name || "?")[0]?.toUpperCase()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium group-hover:text-primary transition-colors">{contact.name}</div>
          <div className="text-xs text-muted-foreground">{contact.accountName}</div>
        </div>
        {contact.createdAt && (
          <span className="text-xs text-muted-foreground flex-shrink-0">{formatDistanceToNow(new Date(contact.createdAt), { addSuffix: true })}</span>
        )}
      </div>
    </Link>
  );
}

function PartnerRow({ partner }: { partner: PartnerItem }) {
  return (
    <Link href="/strategy/partnerships">
      <div className="flex items-center gap-2 py-2 -mx-1 px-1 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group">
        <div className="w-7 h-7 rounded-full bg-violet-500/10 flex items-center justify-center flex-shrink-0">
          <Handshake className="h-3.5 w-3.5 text-violet-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{partner.name}</div>
          <div className="text-xs text-muted-foreground">{CATEGORY_LABEL[partner.category] ?? partner.category}{partner.region ? ` · ${partner.region}` : ""}</div>
        </div>
        {partner.priorityLevel && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 flex-shrink-0">{partner.priorityLevel}</Badge>
        )}
      </div>
    </Link>
  );
}

function SuggestedRow({ action }: { action: SuggestedAction }) {
  const Icon = ACTION_ICON[action.type] ?? Zap;
  return (
    <Link href={action.link}>
      <div className="flex items-start gap-2.5 py-2 -mx-1 px-1 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group">
        <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${
          action.priority === "high" ? "bg-red-500/15 text-red-400" :
          action.priority === "medium" ? "bg-amber-500/15 text-amber-400" :
          "bg-muted text-muted-foreground"
        }`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm group-hover:text-primary transition-colors leading-snug">{action.text}</div>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function CommandCenterSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-64 bg-muted rounded-lg" />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-[72px] bg-muted rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="h-40 bg-muted rounded-xl" />
          <div className="h-48 bg-muted rounded-xl" />
        </div>
        <div className="space-y-4">
          <div className="h-36 bg-muted rounded-xl" />
          <div className="h-36 bg-muted rounded-xl" />
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CommandCenter() {
  const [viewMode, setViewMode] = useState<"mine" | "team">("mine");

  const { data, isLoading, isError } = useQuery<CommandCenterData>({
    queryKey: ["/api/command-center", viewMode],
    queryFn: async () => {
      const res = await fetch(`/api/command-center?view=${viewMode}`);
      if (!res.ok) throw new Error("Failed to load command center");
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const today = new Date();
  const greeting = today.getHours() < 12 ? "Good morning" : today.getHours() < 17 ? "Good afternoon" : "Good evening";

  if (isLoading) return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      <CommandCenterSkeleton />
    </div>
  );

  if (isError || !data?.stats) return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto flex items-center justify-center min-h-[40vh]">
      <div className="text-center space-y-2">
        <AlertTriangle className="h-8 w-8 text-amber-400 mx-auto" />
        <p className="text-sm text-muted-foreground">Failed to load Command Center. Try refreshing.</p>
      </div>
    </div>
  );

  const { stats, today: todaySection, needsAttention, pipelineMomentum, partnershipActivity, recentRelationshipActivity, suggestedActions, intelligence } = data;

  const attentionCount = needsAttention.overdueTasks.length + needsAttention.stalledDeals.length + needsAttention.noNextStep.length;

  const statCards = [
    { label: "Open Opportunities", value: stats.openOpportunities, icon: TrendingUp, color: "bg-blue-500/10 text-blue-400", link: "/opportunities" },
    { label: "Hot Deals", value: stats.hotDeals, icon: Flame, color: "bg-orange-500/10 text-orange-400", link: "/pipeline" },
    { label: "Overdue Follow-ups", value: stats.overdueFollowUps, icon: AlertTriangle, color: stats.overdueFollowUps > 0 ? "bg-red-500/10 text-red-400" : "bg-muted text-muted-foreground", link: "/execution/team-workload" },
    { label: "Meetings Today", value: stats.meetingsToday, icon: CalendarDays, color: "bg-purple-500/10 text-purple-400", link: "/execution/calendar" },
    { label: "Partnerships", value: stats.activePartnerships, icon: Handshake, color: "bg-violet-500/10 text-violet-400", link: "/strategy/partnerships" },
    { label: "Investor Conversations", value: stats.investorConversations, icon: Star, color: "bg-amber-500/10 text-amber-400", link: "/strategy/partnerships" },
    { label: "Grants & Govt", value: stats.grantsGovt, icon: Building2, color: "bg-emerald-500/10 text-emerald-400", link: "/strategy/partnerships" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-command-center-greeting">
            {greeting}, {data.userName.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(today, "EEEE, MMMM d, yyyy")} · Growth OS Command Center
          </p>
        </div>
        {data.isAdmin && (
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1" data-testid="toggle-view-mode">
            <Button
              size="sm" variant={viewMode === "mine" ? "secondary" : "ghost"}
              className="h-7 gap-1.5 text-xs"
              onClick={() => setViewMode("mine")}
              data-testid="button-view-mine"
            >
              <User className="h-3.5 w-3.5" /> My View
            </Button>
            <Button
              size="sm" variant={viewMode === "team" ? "secondary" : "ghost"}
              className="h-7 gap-1.5 text-xs"
              onClick={() => setViewMode("team")}
              data-testid="button-view-team"
            >
              <Users className="h-3.5 w-3.5" /> Team View
            </Button>
          </div>
        )}
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {statCards.map((s) => (
          <StatCard key={s.label} {...s} loading={isLoading} />
        ))}
      </div>

      {/* ── Main Layout ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Left column — main content */}
        <div className="lg:col-span-2 space-y-4">

          {/* Today */}
          <SectionCard
            title="Today"
            icon={CalendarClock}
            count={todaySection.meetings.length + todaySection.tasksDue.length}
            linkTo="/execution/calendar"
            linkLabel="Calendar"
          >
            {todaySection.meetings.length === 0 && todaySection.tasksDue.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">Clear schedule — nothing due today.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                {todaySection.meetings.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 mt-1">Meetings ({todaySection.meetings.length})</p>
                    {todaySection.meetings.slice(0, 4).map(m => <MeetingRow key={m.id} meeting={m} />)}
                  </div>
                )}
                {todaySection.tasksDue.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 mt-1">Tasks Due ({todaySection.tasksDue.length})</p>
                    {todaySection.tasksDue.slice(0, 5).map(t => <TaskRow key={t.id} task={t} />)}
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* Needs Attention */}
          <SectionCard
            title="Needs Attention"
            icon={AlertTriangle}
            count={attentionCount}
            linkTo="/pipeline"
            linkLabel="Pipeline"
          >
            {attentionCount === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">All clear — nothing needs attention right now.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
                {needsAttention.overdueTasks.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 mt-1">Overdue Tasks</p>
                    {needsAttention.overdueTasks.slice(0, 4).map(t => <TaskRow key={t.id} task={t} />)}
                  </div>
                )}
                {needsAttention.stalledDeals.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 mt-1">Stalled Deals</p>
                    {needsAttention.stalledDeals.slice(0, 4).map(o => (
                      <Link href="/opportunities" key={o.id}>
                        <div className="flex items-start gap-2 py-2 -mx-1 px-1 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group">
                          <Clock className="h-3.5 w-3.5 mt-0.5 text-amber-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm truncate group-hover:text-primary transition-colors">{o.title}</div>
                            <div className="text-xs text-muted-foreground">{o.accountName} · {o.daysSinceActivity}d ago</div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                {needsAttention.noNextStep.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 mt-1">No Next Step</p>
                    {needsAttention.noNextStep.slice(0, 4).map(o => <OppRow key={o.id} opp={o} />)}
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* Pipeline Momentum */}
          <SectionCard
            title="Pipeline Momentum"
            icon={BarChart3}
            count={pipelineMomentum.topOpportunities.length}
            linkTo="/pipeline"
            linkLabel="Full pipeline"
          >
            {pipelineMomentum.topOpportunities.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No active opportunities. Start by adding one.</p>
            ) : (
              <div className="divide-y divide-border/30">
                {pipelineMomentum.topOpportunities.slice(0, 6).map(o => (
                  <OppRow key={o.id} opp={o} showOwner={viewMode === "team"} />
                ))}
              </div>
            )}
          </SectionCard>

          {/* Recent Relationship Activity */}
          <SectionCard
            title="Recent Relationship Activity"
            icon={Activity}
            linkTo="/contacts"
            linkLabel="Contacts"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              {recentRelationshipActivity.contacts.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 mt-1">New Contacts</p>
                  {recentRelationshipActivity.contacts.slice(0, 4).map(c => <ContactRow key={c.id} contact={c} />)}
                </div>
              )}
              {recentRelationshipActivity.emails.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 mt-1">Recent Emails</p>
                  {recentRelationshipActivity.emails.slice(0, 4).map(e => <EmailRow key={e.id} email={e} />)}
                </div>
              )}
              {recentRelationshipActivity.contacts.length === 0 && recentRelationshipActivity.emails.length === 0 && (
                <p className="text-xs text-muted-foreground py-3">No recent relationship activity.</p>
              )}
            </div>
          </SectionCard>

        </div>

        {/* Right column — intelligence & actions */}
        <div className="space-y-4">

          {/* Suggested Next Actions */}
          <SectionCard
            title="Suggested Actions"
            icon={Zap}
            count={suggestedActions.length}
            empty={suggestedActions.length === 0}
            emptyText="No urgent actions — you're on top of things."
          >
            {suggestedActions.slice(0, 6).map((a, i) => <SuggestedRow key={i} action={a} />)}
          </SectionCard>

          {/* Intelligence: Upcoming Meetings */}
          <SectionCard
            title="Upcoming Meetings"
            icon={CalendarDays}
            count={intelligence.upcomingMeetings.length}
            linkTo="/execution/calendar"
            empty={intelligence.upcomingMeetings.length === 0}
            emptyText="No upcoming meetings in the next 3 days."
          >
            {intelligence.upcomingMeetings.slice(0, 4).map(m => (
              <div key={m.id} className="flex items-start gap-2 py-2 -mx-1 px-1 rounded-lg hover:bg-muted/40 transition-colors">
                <div className="flex-shrink-0 text-center w-8">
                  <div className="text-[9px] text-muted-foreground uppercase">{format(new Date(m.startTime), "EEE")}</div>
                  <div className="text-sm font-bold leading-none">{format(new Date(m.startTime), "d")}</div>
                  <div className="text-[9px] text-muted-foreground">{format(new Date(m.startTime), "MMM")}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{m.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {isToday(new Date(m.startTime)) ? "Today" : isTomorrow(new Date(m.startTime)) ? "Tomorrow" : format(new Date(m.startTime), "EEE")}
                    {" · "}{format(new Date(m.startTime), "h:mm a")}
                  </div>
                </div>
              </div>
            ))}
          </SectionCard>

          {/* Intelligence: Inbox Signals */}
          <SectionCard
            title="Inbox Signals"
            icon={Inbox}
            count={intelligence.inboxSignals.length}
            linkTo="/gmail"
            linkLabel="Inbox"
            empty={intelligence.inboxSignals.length === 0}
            emptyText="No recent inbound email signals."
          >
            {intelligence.inboxSignals.slice(0, 4).map(e => <EmailRow key={e.id} email={e} />)}
          </SectionCard>

          {/* Partnership Activity */}
          <SectionCard
            title="Partnership Activity"
            icon={Handshake}
            count={partnershipActivity.length}
            linkTo="/strategy/partnerships"
            linkLabel="All partners"
            empty={partnershipActivity.length === 0}
            emptyText="No partnership records yet."
          >
            {partnershipActivity.slice(0, 5).map(p => <PartnerRow key={p.id} partner={p} />)}
          </SectionCard>

          {/* Intelligence: New Contacts */}
          {intelligence.newContacts.length > 0 && (
            <SectionCard
              title="New Contacts"
              icon={UserPlus}
              count={intelligence.newContacts.length}
              linkTo="/contacts"
            >
              {intelligence.newContacts.slice(0, 4).map(c => <ContactRow key={c.id} contact={c} />)}
            </SectionCard>
          )}

        </div>
      </div>
    </div>
  );
}
