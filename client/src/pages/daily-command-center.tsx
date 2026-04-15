import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle, CheckSquare, TrendingUp, Building2, Mail,
  ChevronRight, Clock, Zap, Inbox, CalendarDays, Users,
  ArrowRight, MailWarning, Calendar, Flame, ShieldAlert,
  Star, Timer, Activity, BellRing,
} from "lucide-react";
import { format, formatDistanceToNow, isToday, isTomorrow, differenceInDays } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────
type Severity = "high" | "medium" | "low";

type OverdueTask = {
  id: number; title: string; due_date: string; priority: string;
  status: string; linked_object_type?: string; linked_object_id?: number;
  linked_object_name?: string; days_overdue: number; severity: Severity; deepLink: string;
};
type SuggestedAction = {
  id: number; object_type: string; object_id: number; signal_type: string;
  severity: Severity; title: string; reason: string; suggested_action_type: string;
  suggested_action_label: string; priority: string; object_name?: string; deepLink: string;
};
type AccountAtRisk = {
  id: number; name: string; last_interaction_at?: string; priority: string;
  open_deal_count: number; open_deal_value: number; days_since_touch?: number;
  severity: Severity; deepLink: string;
};
type StaleOpp = {
  id: number; title: string; stage: string; amount?: number;
  account_name?: string; account_id?: number; days_stale: number;
  severity: Severity; deepLink: string;
};
type InboxFollowUp = {
  id: number; subject?: string; from_email?: string; from_name?: string;
  sent_at: string; snippet?: string; source_account_id?: number;
  account_name?: string; severity: Severity; deepLink: string;
};
type UnlinkedEmail = {
  id: number; subject?: string; from_email?: string; from_name?: string;
  sent_at: string; snippet?: string;
};
type WeekTask = {
  id: number; title: string; due_date: string; priority: string;
  status: string; linked_object_type?: string; linked_object_id?: number;
};
type WeekMeeting = {
  id: number; title: string; start_time: string; end_time?: string;
  location?: string; meeting_url?: string; event_type?: string;
};
type DailyCommandCenterData = {
  userName: string; viewMode: "mine" | "team"; isAdmin: boolean;
  sections: {
    overdueTasks: { count: number; items: OverdueTask[] };
    suggestedActions: { count: number; items: SuggestedAction[] };
    accountsAtRisk: { count: number; items: AccountAtRisk[] };
    staleOpportunities: { count: number; items: StaleOpp[] };
    inboxFollowUps: { count: number; items: InboxFollowUp[] };
    newUnlinkedEmails: { count: number; items: UnlinkedEmail[] };
    thisWeekPriorities: { count: number; tasks: WeekTask[]; meetings: WeekMeeting[] };
  };
  generatedAt: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SEV_BADGE: Record<Severity, string> = {
  high:   "bg-red-500/15 text-red-400 border-red-500/25",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  low:    "bg-blue-500/15 text-blue-400 border-blue-500/25",
};
const SEV_DOT: Record<Severity, string> = {
  high: "bg-red-400", medium: "bg-amber-400", low: "bg-blue-400",
};

const STAGE_LABEL: Record<string, string> = {
  inbound_new: "New", qualifying: "Qualifying", proposal: "Proposal",
  negotiation: "Negotiating", verbal_commit: "Verbal Commit",
  closed_won: "Won", closed_lost: "Lost",
};

function SevBadge({ s }: { s: Severity }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize ${SEV_BADGE[s]}`}>
      {s}
    </span>
  );
}

function fmtMoney(n?: number) {
  if (!n) return "—";
  return n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;
}

function greeting(name: string) {
  const h = new Date().getHours();
  const prefix = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${prefix}, ${name}`;
}

function SectionSkeleton() {
  return (
    <div className="space-y-2 mt-2">
      {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

// ─── Empty-State messages ─────────────────────────────────────────────────────
const EMPTY: Record<string, { icon: React.ElementType; msg: string }> = {
  overdueTasks:     { icon: CheckSquare, msg: "No overdue tasks — rare, beautiful, and suspicious." },
  suggestedActions: { icon: Zap,         msg: "No urgent signals detected. The CRM is content." },
  accountsAtRisk:   { icon: ShieldAlert, msg: "All accounts recently touched. Outstanding relationship hygiene." },
  staleOpps:        { icon: TrendingUp,  msg: "Every open deal had recent activity. Keep that momentum." },
  inboxFollowUps:   { icon: Mail,        msg: "Inbox follow-ups are clear. Responsiveness level: legendary." },
  unlinkedEmails:   { icon: MailWarning, msg: "No unlinked emails in your inbox. Tidy." },
  weekPriorities:   { icon: CalendarDays,msg: "Nothing on the calendar this week. A blank canvas or a cause for concern." },
};

function EmptyState({ type }: { type: keyof typeof EMPTY }) {
  const { icon: Icon, msg } = EMPTY[type];
  return (
    <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm px-1" data-testid={`empty-${type}`}>
      <Icon className="h-4 w-4 shrink-0 opacity-50" />
      <span className="italic">{msg}</span>
    </div>
  );
}

// ─── Section Wrapper ──────────────────────────────────────────────────────────
function Section({
  icon: Icon, title, count, viewAllLink, children, accent,
}: {
  icon: React.ElementType; title: string; count: number;
  viewAllLink?: string; children: React.ReactNode; accent?: string;
}) {
  return (
    <Card className={`border ${accent ?? "border-border/50"} bg-card/80`} data-testid={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
              {title}
            </CardTitle>
            {count > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold">
                {count}
              </span>
            )}
          </div>
          {viewAllLink && count > 0 && (
            <Link href={viewAllLink}>
              <button className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5" data-testid={`view-all-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                View all <ChevronRight className="h-3 w-3" />
              </button>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {children}
      </CardContent>
    </Card>
  );
}

// ─── Item Row ─────────────────────────────────────────────────────────────────
function ItemRow({
  link, severity, title, subtitle, rightLabel, action, testId,
}: {
  link: string; severity: Severity; title: string; subtitle?: string;
  rightLabel?: string; action?: string; testId?: string;
}) {
  return (
    <Link href={link}>
      <div
        className="flex items-start gap-2 py-2 px-2 -mx-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors group"
        data-testid={testId}
      >
        <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${SEV_DOT[severity]}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate leading-tight">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex flex-col items-end shrink-0 gap-1">
          {rightLabel && <span className="text-xs text-muted-foreground whitespace-nowrap">{rightLabel}</span>}
          {action && (
            <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
              {action} <ArrowRight className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Overdue Tasks Section ────────────────────────────────────────────────────
function OverdueTasksSection({ section }: { section: DailyCommandCenterData["sections"]["overdueTasks"] }) {
  if (section.count === 0) return <EmptyState type="overdueTasks" />;
  return (
    <div className="space-y-0 divide-y divide-border/30">
      {section.items.map(t => (
        <ItemRow
          key={t.id}
          link={t.deepLink}
          severity={t.severity}
          title={t.title}
          subtitle={t.linked_object_name
            ? `Linked to ${t.linked_object_type}: ${t.linked_object_name}`
            : undefined}
          rightLabel={`${Math.round(t.days_overdue)}d overdue`}
          action="Open task"
          testId={`task-overdue-${t.id}`}
        />
      ))}
    </div>
  );
}

// ─── Suggested Actions Section ────────────────────────────────────────────────
function SuggestedActionsSection({ section }: { section: DailyCommandCenterData["sections"]["suggestedActions"] }) {
  if (section.count === 0) return <EmptyState type="suggestedActions" />;
  return (
    <div className="space-y-0 divide-y divide-border/30">
      {section.items.map(s => (
        <Link key={s.id} href={s.deepLink}>
          <div
            className="flex items-start gap-2 py-2.5 px-2 -mx-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors group"
            data-testid={`suggestion-item-${s.id}`}
          >
            <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${SEV_DOT[s.severity]}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-medium text-foreground leading-tight">{s.title}</p>
                {s.object_name && (
                  <span className="text-xs text-muted-foreground">— {s.object_name}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.reason}</p>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1">
              <SevBadge s={s.severity} />
              <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                {s.suggested_action_label} <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── Accounts At Risk Section ─────────────────────────────────────────────────
function AccountsAtRiskSection({ section }: { section: DailyCommandCenterData["sections"]["accountsAtRisk"] }) {
  if (section.count === 0) return <EmptyState type="accountsAtRisk" />;
  return (
    <div className="space-y-0 divide-y divide-border/30">
      {section.items.map(a => {
        const touch = a.last_interaction_at
          ? `${Math.round(Number(a.days_since_touch))}d ago`
          : "Never touched";
        const deals = Number(a.open_deal_count);
        const value = Number(a.open_deal_value);
        return (
          <ItemRow
            key={a.id}
            link={a.deepLink}
            severity={a.severity}
            title={a.name}
            subtitle={deals > 0 ? `${deals} open deal${deals > 1 ? "s" : ""} · ${fmtMoney(value)} pipeline` : "No open deals"}
            rightLabel={`Last touch: ${touch}`}
            action="View account"
            testId={`account-risk-${a.id}`}
          />
        );
      })}
    </div>
  );
}

// ─── Stale Opportunities Section ──────────────────────────────────────────────
function StaleOppsSection({ section }: { section: DailyCommandCenterData["sections"]["staleOpportunities"] }) {
  if (section.count === 0) return <EmptyState type="staleOpps" />;
  return (
    <div className="space-y-0 divide-y divide-border/30">
      {section.items.map(o => (
        <ItemRow
          key={o.id}
          link={o.deepLink}
          severity={o.severity}
          title={o.title}
          subtitle={[o.account_name, STAGE_LABEL[o.stage] ?? o.stage].filter(Boolean).join(" · ")}
          rightLabel={`${Math.round(Number(o.days_stale))}d stale · ${fmtMoney(o.amount)}`}
          action="Review deal"
          testId={`opp-stale-${o.id}`}
        />
      ))}
    </div>
  );
}

// ─── Inbox Follow-Ups Section ─────────────────────────────────────────────────
function InboxFollowUpsSection({ section }: { section: DailyCommandCenterData["sections"]["inboxFollowUps"] }) {
  if (section.count === 0) return <EmptyState type="inboxFollowUps" />;
  return (
    <div className="space-y-0 divide-y divide-border/30">
      {section.items.map(e => {
        const sender = e.from_name ?? e.from_email ?? "Unknown sender";
        const when = e.sent_at ? formatDistanceToNow(new Date(e.sent_at), { addSuffix: true }) : "";
        return (
          <ItemRow
            key={e.id}
            link={e.deepLink}
            severity="high"
            title={e.subject ?? "(No subject)"}
            subtitle={`From: ${sender}${e.account_name ? ` · ${e.account_name}` : ""}`}
            rightLabel={when}
            action="Follow up"
            testId={`inbox-followup-${e.id}`}
          />
        );
      })}
    </div>
  );
}

// ─── New Unlinked Emails Section ──────────────────────────────────────────────
function UnlinkedEmailsSection({ section }: { section: DailyCommandCenterData["sections"]["newUnlinkedEmails"] }) {
  if (section.count === 0) return <EmptyState type="unlinkedEmails" />;
  return (
    <div className="space-y-0 divide-y divide-border/30">
      {section.items.map(e => {
        const sender = e.from_name ?? e.from_email ?? "Unknown";
        const when = e.sent_at ? formatDistanceToNow(new Date(e.sent_at), { addSuffix: true }) : "";
        return (
          <div key={e.id} className="flex items-start gap-2 py-2 px-2 -mx-2 rounded-md hover:bg-muted/40 transition-colors" data-testid={`unlinked-email-${e.id}`}>
            <div className="mt-1.5 h-2 w-2 rounded-full shrink-0 bg-muted-foreground/40" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate leading-tight">{e.subject ?? "(No subject)"}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">From: {sender}</p>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{when}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── This Week's Priorities Section ───────────────────────────────────────────
function WeekPrioritiesSection({ section }: { section: DailyCommandCenterData["sections"]["thisWeekPriorities"] }) {
  if (section.count === 0) return <EmptyState type="weekPriorities" />;
  const tasks: WeekTask[] = section.tasks ?? [];
  const meetings: WeekMeeting[] = section.meetings ?? [];
  return (
    <div className="space-y-3">
      {meetings.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 tracking-wide flex items-center gap-1">
            <Calendar className="h-3 w-3" /> Meetings
          </p>
          <div className="space-y-0 divide-y divide-border/30">
            {meetings.map(m => {
              const start = new Date(m.start_time);
              const label = isToday(start) ? `Today ${format(start, "h:mm a")}` :
                            isTomorrow(start) ? `Tomorrow ${format(start, "h:mm a")}` :
                            format(start, "EEE MMM d · h:mm a");
              return (
                <Link key={m.id} href={`/calendar`}>
                  <div className="flex items-center gap-2 py-2 px-2 -mx-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors" data-testid={`meeting-week-${m.id}`}>
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.title}</p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{label}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
      {tasks.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 tracking-wide flex items-center gap-1">
            <CheckSquare className="h-3 w-3" /> Tasks Due
          </p>
          <div className="space-y-0 divide-y divide-border/30">
            {tasks.map(t => {
              const due = new Date(t.due_date);
              const label = isToday(due) ? "Due today" :
                            isTomorrow(due) ? "Due tomorrow" :
                            `Due ${format(due, "EEE MMM d")}`;
              const link = t.linked_object_type && t.linked_object_id
                ? `/${t.linked_object_type}s/${t.linked_object_id}`
                : "/tasks";
              return (
                <Link key={t.id} href={link}>
                  <div className="flex items-center gap-2 py-2 px-2 -mx-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors" data-testid={`task-week-${t.id}`}>
                    <div className={`h-2 w-2 rounded-full shrink-0 ${t.priority === "high" ? "bg-red-400" : t.priority === "medium" ? "bg-amber-400" : "bg-blue-400"}`} />
                    <p className="flex-1 text-sm font-medium truncate">{t.title}</p>
                    <span className={`text-xs whitespace-nowrap ${isToday(due) ? "text-amber-400 font-semibold" : "text-muted-foreground"}`}>{label}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stat Pill ────────────────────────────────────────────────────────────────
function StatPill({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-2 px-3 bg-muted/30 rounded-lg border border-border/40 min-w-[72px]">
      <span className={`text-xl font-bold ${accent ?? "text-foreground"}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5 leading-none text-center">{label}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DailyCommandCenter() {
  const { data, isLoading, error } = useQuery<DailyCommandCenterData>({
    queryKey: ["/api/daily-command-center"],
    refetchInterval: 5 * 60 * 1000,
  });

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2" data-testid="daily-command-center-error">
        <AlertTriangle className="h-8 w-8" />
        <p className="text-sm">Failed to load command center data.</p>
      </div>
    );
  }

  const sections = data?.sections;

  // Urgency score for header strip
  const urgentCount = isLoading ? 0 :
    (sections?.overdueTasks.count ?? 0) +
    (sections?.inboxFollowUps.count ?? 0);

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6" data-testid="daily-command-center">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          {isLoading
            ? <Skeleton className="h-7 w-48 mb-1" />
            : <h1 className="text-xl font-bold text-foreground" data-testid="cc-greeting">{greeting(data?.userName ?? "there")}</h1>
          }
          <p className="text-sm text-muted-foreground mt-0.5">
            Here's what needs your attention today.
          </p>
        </div>
        {urgentCount > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg shrink-0" data-testid="cc-urgency-banner">
            <BellRing className="h-3.5 w-3.5 text-red-400" />
            <span className="text-xs font-semibold text-red-400 whitespace-nowrap">{urgentCount} urgent</span>
          </div>
        )}
      </div>

      {/* ── Stat Strip ─────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2" data-testid="cc-stat-strip">
          <StatPill label="Overdue" value={sections?.overdueTasks.count ?? 0} accent={sections?.overdueTasks.count ? "text-red-400" : undefined} />
          <StatPill label="Follow-ups" value={sections?.inboxFollowUps.count ?? 0} accent={sections?.inboxFollowUps.count ? "text-amber-400" : undefined} />
          <StatPill label="At Risk" value={sections?.accountsAtRisk.count ?? 0} accent={sections?.accountsAtRisk.count ? "text-orange-400" : undefined} />
          <StatPill label="Stale Deals" value={sections?.staleOpportunities.count ?? 0} />
          <StatPill label="Suggestions" value={sections?.suggestedActions.count ?? 0} accent={sections?.suggestedActions.count ? "text-primary" : undefined} />
          <StatPill label="This Week" value={sections?.thisWeekPriorities.count ?? 0} />
        </div>
      )}

      {/* ── Main Grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Left: primary attention sections (2/3 width) */}
        <div className="lg:col-span-2 flex flex-col gap-4">

          {/* Overdue Tasks */}
          <Section icon={AlertTriangle} title="Overdue Tasks" count={sections?.overdueTasks.count ?? 0} viewAllLink="/tasks" accent={sections?.overdueTasks.count ? "border-red-500/30" : undefined}>
            {isLoading ? <SectionSkeleton /> : <OverdueTasksSection section={sections!.overdueTasks} />}
          </Section>

          {/* Suggested Actions */}
          <Section icon={Zap} title="Suggested Actions" count={sections?.suggestedActions.count ?? 0} accent={sections?.suggestedActions.count ? "border-primary/20" : undefined}>
            {isLoading ? <SectionSkeleton /> : <SuggestedActionsSection section={sections!.suggestedActions} />}
          </Section>

          {/* Inbox Follow-Ups */}
          <Section icon={MailWarning} title="Inbox Follow-Ups Needed" count={sections?.inboxFollowUps.count ?? 0} viewAllLink="/inbox" accent={sections?.inboxFollowUps.count ? "border-amber-500/30" : undefined}>
            {isLoading ? <SectionSkeleton /> : <InboxFollowUpsSection section={sections!.inboxFollowUps} />}
          </Section>

          {/* Accounts At Risk */}
          <Section icon={ShieldAlert} title="Relationships At Risk" count={sections?.accountsAtRisk.count ?? 0} viewAllLink="/accounts" accent={sections?.accountsAtRisk.count ? "border-orange-500/20" : undefined}>
            {isLoading ? <SectionSkeleton /> : <AccountsAtRiskSection section={sections!.accountsAtRisk} />}
          </Section>

          {/* Stale Deals */}
          <Section icon={TrendingUp} title="Stale Deals" count={sections?.staleOpportunities.count ?? 0} viewAllLink="/pipeline" accent={sections?.staleOpportunities.count ? "border-blue-500/20" : undefined}>
            {isLoading ? <SectionSkeleton /> : <StaleOppsSection section={sections!.staleOpportunities} />}
          </Section>
        </div>

        {/* Right: sidebar sections (1/3 width) */}
        <div className="flex flex-col gap-4">

          {/* This Week's Priorities */}
          <Section icon={CalendarDays} title="This Week's Priorities" count={sections?.thisWeekPriorities.count ?? 0}>
            {isLoading ? <SectionSkeleton /> : <WeekPrioritiesSection section={sections!.thisWeekPriorities} />}
          </Section>

          {/* New / Unlinked Emails */}
          <Section icon={Inbox} title="New / Unlinked Emails" count={sections?.newUnlinkedEmails.count ?? 0} viewAllLink="/inbox">
            {isLoading ? <SectionSkeleton /> : <UnlinkedEmailsSection section={sections!.newUnlinkedEmails} />}
          </Section>

          {/* Quick Links */}
          <Card className="border-border/40 bg-card/60">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Activity className="h-3.5 w-3.5" /> Quick Links
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-1">
              {([
                ["/opportunities", TrendingUp, "Pipeline"],
                ["/accounts",     Building2,  "Accounts"],
                ["/contacts",     Users,      "Contacts"],
                ["/tasks",        CheckSquare,"Tasks"],
                ["/pipeline",     Flame,      "Pipeline Health"],
                ["/inbox",        Mail,       "Inbox"],
              ] as [string, React.ElementType, string][]).map(([href, Icon, label]) => (
                <Link key={href} href={href}>
                  <div className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors" data-testid={`quicklink-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{label}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      {data?.generatedAt && (
        <p className="text-xs text-muted-foreground/50 text-right" data-testid="cc-generated-at">
          Updated {formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })}
        </p>
      )}
    </div>
  );
}
