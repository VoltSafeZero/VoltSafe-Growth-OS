import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarDays, Clock, CheckSquare, AlertTriangle, TrendingUp,
  UserPlus, Activity, Zap, Video, MapPin, ArrowRight, Building2,
  Mail, ChevronRight, Star, Flame, RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow, isToday } from "date-fns";

type TodayData = {
  todaysMeetings: Array<{
    id: number; title: string; startTime: string; endTime?: string;
    eventType: string; location?: string; meetingUrl?: string;
    status: string; invitees?: string[];
  }>;
  tasksDueToday: Array<{ id: number; title: string; dueDate?: string; priority: string; accountId?: number }>;
  overdueTasks: Array<{ id: number; title: string; dueDate?: string; priority: string }>;
  newLeads: Array<{ id: number; company: string; contactName?: string; status: string; city?: string; state?: string; country: string; dealAmount?: number }>;
  hotOpportunities: Array<{ id: number; title: string; stage: string; amount?: number; accountName: string; updatedAt: string }>;
  recentActivity: Array<{ id: number; subject?: string; fromEmail?: string; sentAt?: string; direction?: string; snippet?: string }>;
  suggestedActions: Array<{ type: string; text: string; link: string; priority: "high" | "medium" | "low" }>;
  stats: { meetingsToday: number; tasksDueCount: number; overdueCount: number; newLeadsCount: number };
};

const STAGE_LABELS: Record<string, string> = {
  inbound_new: "New", qualifying: "Qualifying", proposal: "Proposal",
  negotiation: "Negotiating", verbal_commit: "Verbal Commit",
  closed_won: "Won", closed_lost: "Lost",
};

const STAGE_COLOR: Record<string, string> = {
  verbal_commit: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  proposal: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  negotiation: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  qualifying: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  inbound_new: "bg-secondary/60 text-muted-foreground",
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "text-red-400", medium: "text-amber-400", low: "text-muted-foreground",
};

const ACTION_ICON: Record<string, React.ElementType> = {
  meeting: CalendarDays, task: CheckSquare, opportunity: TrendingUp,
  lead: UserPlus, email: Mail, deal: Flame,
};

function SectionCard({ title, icon: Icon, count, children, linkTo, linkLabel }: {
  title: string; icon: React.ElementType; count?: number; children: React.ReactNode; linkTo?: string; linkLabel?: string;
}) {
  return (
    <Card className="border-border/50 h-full">
      <CardHeader className="pb-3 pt-4 px-4">
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
        {children}
      </CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground py-2 text-center">{text}</p>;
}

export default function TodayPage() {
  const { data, isLoading, isError, refetch } = useQuery<TodayData>({
    queryKey: ["/api/dashboard/today"],
    refetchInterval: 5 * 60_000,
  });

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const dateStr = format(now, "EEEE, MMMM d");

  if (isError) return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm text-muted-foreground">Failed to load today's data.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" /> Try again
      </Button>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto" data-testid="today-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-greeting">
            {greeting} ☀️
          </h1>
          <p className="text-muted-foreground mt-1">{dateStr} — here's your day at a glance</p>
        </div>
        {data && (
          <div className="flex items-center gap-3 flex-wrap">
            {[
              { label: "Meetings today", value: data.stats.meetingsToday, color: "text-primary" },
              { label: "Due today", value: data.stats.tasksDueCount, color: "text-blue-400" },
              { label: "Overdue", value: data.stats.overdueCount, color: data.stats.overdueCount > 0 ? "text-red-400" : "text-muted-foreground" },
              { label: "New leads", value: data.stats.newLeadsCount, color: "text-emerald-400" },
            ].map(s => (
              <div key={s.label} className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                <p className={`text-xl font-bold ${s.color}`} data-testid={`stat-${s.label.replace(/\s+/g, "-").toLowerCase()}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Suggested Actions */}
      {isLoading ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : data?.suggestedActions && data.suggestedActions.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="suggested-actions">
          {data.suggestedActions.slice(0, 4).map((action, i) => {
            const Icon = ACTION_ICON[action.type] ?? Zap;
            return (
              <Link key={i} href={action.link}>
                <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors hover:bg-secondary/40 ${action.priority === "high" ? "border-primary/30 bg-primary/5" : "border-border/40 bg-card"}`}
                  data-testid={`action-item-${i}`}>
                  <Icon className={`h-4 w-4 shrink-0 ${action.priority === "high" ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-sm flex-1">{action.text}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      ) : null}

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 space-y-4">

          {/* Today's Meetings */}
          <SectionCard title="Today's Meetings" icon={CalendarDays} count={data?.todaysMeetings.length} linkTo="/execution/calendar" linkLabel="Calendar">
            {isLoading ? <Skeleton className="h-24" /> :
              data?.todaysMeetings.length === 0 ? <EmptyState text="No meetings today — clear schedule!" /> :
                <div className="space-y-2">
                  {data?.todaysMeetings.map(m => {
                    const start = new Date(m.startTime);
                    const end = m.endTime ? new Date(m.endTime) : null;
                    const isNow = start <= now && end && end >= now;
                    const upcoming = start > now && start.getTime() - now.getTime() < 30 * 60 * 1000;
                    return (
                      <div key={m.id} className={`flex items-start gap-3 p-3 rounded-lg border ${isNow ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card"}`} data-testid={`meeting-${m.id}`}>
                        <div className="text-center min-w-[3rem]">
                          <p className={`text-sm font-bold ${isNow ? "text-primary" : ""}`}>{format(start, "h:mm")}</p>
                          <p className="text-xs text-muted-foreground">{format(start, "a")}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">{m.title}</p>
                            {isNow && <Badge className="text-[10px] px-1.5 bg-primary/20 text-primary border-primary/30">Now</Badge>}
                            {upcoming && <Badge className="text-[10px] px-1.5 bg-amber-500/15 text-amber-400 border-amber-500/25">Soon</Badge>}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                            <span><Clock className="inline h-3 w-3 mr-0.5" />{format(start, "h:mm")}–{end ? format(end, "h:mm a") : "?"}</span>
                            {m.location && <span><MapPin className="inline h-3 w-3 mr-0.5" />{m.location}</span>}
                          </div>
                        </div>
                        {m.meetingUrl && (
                          <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" data-testid={`join-meeting-${m.id}`}>
                              <Video className="h-3 w-3" /> Join
                            </Button>
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
            }
          </SectionCard>

          {/* Tasks Due Today + Overdue */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SectionCard title="Due Today" icon={CheckSquare} count={data?.tasksDueToday.length} linkTo="/execution/team-workload">
              {isLoading ? <Skeleton className="h-20" /> :
                data?.tasksDueToday.length === 0 ? <EmptyState text="No tasks due today" /> :
                  <div className="space-y-1.5">
                    {data?.tasksDueToday.map(t => (
                      <div key={t.id} className="flex items-center gap-2 py-1 text-sm" data-testid={`task-due-${t.id}`}>
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_COLOR[t.priority] || "bg-muted"}`} style={{ backgroundColor: "currentColor" }} />
                        <span className="truncate flex-1">{t.title}</span>
                      </div>
                    ))}
                  </div>
              }
            </SectionCard>

            <SectionCard title="Overdue" icon={AlertTriangle} count={data?.overdueTasks.length} linkTo="/execution/team-workload">
              {isLoading ? <Skeleton className="h-20" /> :
                data?.overdueTasks.length === 0 ? <EmptyState text="No overdue tasks — great!" /> :
                  <div className="space-y-1.5">
                    {data?.overdueTasks.map(t => (
                      <div key={t.id} className="flex items-center gap-2 py-1 text-sm" data-testid={`task-overdue-${t.id}`}>
                        <AlertTriangle className="h-3 w-3 text-red-400 shrink-0" />
                        <span className="truncate flex-1">{t.title}</span>
                        {t.dueDate && <span className="text-xs text-red-400 shrink-0">{format(new Date(t.dueDate), "MMM d")}</span>}
                      </div>
                    ))}
                  </div>
              }
            </SectionCard>
          </div>

          {/* Recent Activity */}
          <SectionCard title="Recent Email Activity" icon={Mail} linkTo="/gmail">
            {isLoading ? <Skeleton className="h-24" /> :
              data?.recentActivity.length === 0 ? <EmptyState text="No recent email activity" /> :
                <div className="space-y-2">
                  {data?.recentActivity.map(e => (
                    <div key={e.id} className="flex items-start gap-2.5 py-1.5 border-b border-border/30 last:border-0" data-testid={`activity-${e.id}`}>
                      <Mail className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${e.direction === "outbound" ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{e.subject || "(no subject)"}</p>
                        <p className="text-xs text-muted-foreground">{e.fromEmail} · {e.sentAt ? formatDistanceToNow(new Date(e.sentAt), { addSuffix: true }) : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </SectionCard>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-4">

          {/* Hot Opportunities */}
          <SectionCard title="Hot Opportunities" icon={Flame} count={data?.hotOpportunities.length} linkTo="/opportunities">
            {isLoading ? <Skeleton className="h-32" /> :
              data?.hotOpportunities.length === 0 ? <EmptyState text="No active opportunities assigned to you" /> :
                <div className="space-y-2">
                  {data?.hotOpportunities.map(o => (
                    <Link key={o.id} href={`/opportunities/${o.id}`}>
                      <div className="p-2.5 rounded-lg border border-border/40 bg-card hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer" data-testid={`opp-${o.id}`}>
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-sm font-medium truncate flex-1">{o.title}</p>
                          {o.amount && <span className="text-xs font-semibold text-emerald-400 shrink-0">${o.amount.toLocaleString()}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground truncate">{o.accountName}</span>
                          <Badge variant="outline" className={`text-[10px] px-1 ml-auto shrink-0 ${STAGE_COLOR[o.stage] ?? ""}`}>
                            {STAGE_LABELS[o.stage] ?? o.stage}
                          </Badge>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
            }
          </SectionCard>

          {/* New Leads This Week */}
          <SectionCard title="New Leads" icon={UserPlus} count={data?.newLeads.length} linkTo="/opportunities" linkLabel="All leads">
            {isLoading ? <Skeleton className="h-24" /> :
              data?.newLeads.length === 0 ? <EmptyState text="No new leads this week" /> :
                <div className="space-y-1.5">
                  {data?.newLeads.map(l => (
                    <div key={l.id} className="py-1.5 border-b border-border/30 last:border-0" data-testid={`lead-${l.id}`}>
                      <p className="text-sm font-medium truncate">{l.company}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        {l.contactName && <span>{l.contactName}</span>}
                        {(l.city || l.state) && <span className="before:content-['·'] before:mx-1">{[l.city, l.state].filter(Boolean).join(", ")}</span>}
                        {l.dealAmount && <span className="text-emerald-400 ml-auto">${l.dealAmount.toLocaleString()}</span>}
                      </div>
                    </div>
                  ))}
                </div>
            }
          </SectionCard>

        </div>
      </div>
    </div>
  );
}
