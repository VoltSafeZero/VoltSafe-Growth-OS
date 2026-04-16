import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { SwipeActionCard } from "@/components/mobile/swipe-action-card";
import { QuickLogModal } from "@/components/mobile/quick-log-modal";
import {
  CheckSquare, AlertTriangle, Flame, UserPlus, Truck,
  FileText, MapPin, RefreshCw, Check, Clock, StickyNote,
  Phone, Mail, ChevronRight, Zap, Target,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

type TodayData = {
  overdueTasks: Array<{ id: number; title: string; dueDate?: string; priority: string }>;
  tasksDueToday: Array<{ id: number; title: string; dueDate?: string; priority: string }>;
  hotOpportunities: Array<{ id: number; title: string; stage: string; amount?: number; accountName: string }>;
  newLeads: Array<{ id: number; company: string; contactName?: string; status: string; city?: string; dealAmount?: number }>;
  stats: { meetingsToday: number; tasksDueCount: number; overdueCount: number; newLeadsCount: number };
};

type HotItem = {
  type: string; id: number; name: string; actionHint: string; link: string;
  score: { score: number; band: string; reasons: string[]; label: string };
};

type BlockedInstall = {
  id: number; title: string; account_name: string; install_status: string;
  blocked_batches: number; delayed_pos: number; target_completion_date: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  inbound_new: "New", qualifying: "Qualifying", proposal: "Proposal",
  negotiation: "Negotiating", verbal_commit: "Verbal Commit",
  closed_won: "Won", closed_lost: "Lost",
};

const BAND_COLOR: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/25",
  high: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  medium: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  low: "bg-secondary/50 text-muted-foreground",
};

const TYPE_ICON: Record<string, React.ElementType> = {
  lead: UserPlus, opportunity: Flame, quote: FileText, deployment: Truck, account: Target,
};

function SectionHeader({ icon: Icon, title, count, linkTo }: {
  icon: React.ElementType; title: string; count?: number; linkTo?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="text-xs font-medium bg-primary/15 text-primary px-1.5 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      {linkTo && (
        <Link href={linkTo}>
          <button className="text-xs text-muted-foreground flex items-center gap-0.5 hover:text-foreground" data-testid={`field-link-${title.toLowerCase().replace(/\s+/g, "-")}`}>
            All <ChevronRight className="w-3 h-3" />
          </button>
        </Link>
      )}
    </div>
  );
}

export default function FieldPage() {
  const { toast } = useToast();
  const [logTarget, setLogTarget] = useState<{ type: string; id: number; label: string } | null>(null);

  const today = useQuery<TodayData>({ queryKey: ["/api/dashboard/today"] });
  const hotList = useQuery<HotItem[]>({ queryKey: ["/api/scores/hot-list"], queryFn: () => fetch("/api/scores/hot-list?limit=10").then(r => r.json()) });
  const blocked = useQuery<BlockedInstall[]>({ queryKey: ["/api/procurement/blocked-installs"] });

  const completeTask = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/${id}/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today"] });
      toast({ title: "Task completed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const snoozeTask = useMutation({
    mutationFn: (id: number) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return apiRequest("PUT", `/api/tasks/${id}`, { dueDate: tomorrow.toISOString() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today"] });
      toast({ title: "Task snoozed to tomorrow" });
    },
  });

  const isLoading = today.isLoading;

  const overdueTasks = today.data?.overdueTasks ?? [];
  const dueTodayTasks = today.data?.tasksDueToday ?? [];
  const hotOpps = today.data?.hotOpportunities ?? [];
  const newLeads = today.data?.newLeads ?? [];
  const hotItems = hotList.data ?? [];
  const blockedInstalls = blocked.data ?? [];

  const totalActions = overdueTasks.length + dueTodayTasks.length + hotItems.length + blockedInstalls.length;

  return (
    <div className="min-h-screen bg-background" data-testid="field-page">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold tracking-tight">Field Mode</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {format(new Date(), "EEE, MMM d")} · {totalActions} items need attention
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/field/nearby">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
                data-testid="button-field-nearby"
              >
                <MapPin className="w-3.5 h-3.5" /> Nearby
              </button>
            </Link>
            <button
              onClick={() => { today.refetch(); hotList.refetch(); blocked.refetch(); }}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground"
              data-testid="button-field-refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="px-3 py-4 space-y-6">

        {/* Overdue Tasks */}
        {(isLoading || overdueTasks.length > 0) && (
          <section data-testid="field-section-overdue">
            <SectionHeader icon={AlertTriangle} title="Overdue" count={overdueTasks.length} linkTo="/execution/tasks" />
            {isLoading ? <Skeleton className="h-20 rounded-xl" /> : (
              <div className="space-y-2">
                {overdueTasks.map(task => (
                  <SwipeActionCard
                    key={task.id}
                    testId={`field-task-overdue-${task.id}`}
                    actions={[
                      { label: "Done", icon: Check, color: "bg-emerald-600", testId: `action-complete-${task.id}`, onClick: () => completeTask.mutate(task.id) },
                      { label: "Snooze", icon: Clock, color: "bg-amber-600", testId: `action-snooze-${task.id}`, onClick: () => snoozeTask.mutate(task.id) },
                      { label: "Note", icon: StickyNote, color: "bg-blue-600", testId: `action-note-task-${task.id}`, onClick: () => setLogTarget({ type: "task", id: task.id, label: task.title }) },
                    ]}
                  >
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        {task.dueDate && (
                          <p className="text-xs text-red-400 mt-0.5">
                            {formatDistanceToNow(new Date(task.dueDate), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground">← swipe</span>
                    </div>
                  </SwipeActionCard>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Due Today */}
        {(isLoading || dueTodayTasks.length > 0) && (
          <section data-testid="field-section-due-today">
            <SectionHeader icon={CheckSquare} title="Due Today" count={dueTodayTasks.length} linkTo="/execution/tasks" />
            {isLoading ? <Skeleton className="h-20 rounded-xl" /> : (
              <div className="space-y-2">
                {dueTodayTasks.map(task => (
                  <SwipeActionCard
                    key={task.id}
                    testId={`field-task-due-${task.id}`}
                    actions={[
                      { label: "Done", icon: Check, color: "bg-emerald-600", testId: `action-complete-due-${task.id}`, onClick: () => completeTask.mutate(task.id) },
                      { label: "Snooze", icon: Clock, color: "bg-amber-600", testId: `action-snooze-due-${task.id}`, onClick: () => snoozeTask.mutate(task.id) },
                      { label: "Note", icon: StickyNote, color: "bg-blue-600", testId: `action-note-due-${task.id}`, onClick: () => setLogTarget({ type: "task", id: task.id, label: task.title }) },
                    ]}
                  >
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <CheckSquare className="w-4 h-4 text-blue-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Due today</p>
                      </div>
                    </div>
                  </SwipeActionCard>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Hot List — Leads & Opportunities */}
        {(hotList.isLoading || hotItems.length > 0) && (
          <section data-testid="field-section-hot-list">
            <SectionHeader icon={Flame} title="Priority Hot List" count={hotItems.length} linkTo="/opportunities" />
            {hotList.isLoading ? <Skeleton className="h-32 rounded-xl" /> : (
              <div className="space-y-2">
                {hotItems.map(item => {
                  const Icon = TYPE_ICON[item.type] ?? Zap;
                  return (
                    <SwipeActionCard
                      key={`${item.type}-${item.id}`}
                      testId={`field-hot-${item.type}-${item.id}`}
                      actions={[
                        { label: "Note", icon: StickyNote, color: "bg-blue-600", testId: `action-note-hot-${item.id}`, onClick: () => setLogTarget({ type: item.type, id: item.id, label: item.name }) },
                        { label: "Call", icon: Phone, color: "bg-emerald-600", testId: `action-call-hot-${item.id}`, onClick: () => {} },
                        { label: "Email", icon: Mail, color: "bg-purple-600", testId: `action-email-hot-${item.id}`, onClick: () => {} },
                      ]}
                    >
                      <Link href={item.link}>
                        <div className="flex items-center gap-3 px-4 py-3.5">
                          <Icon className="w-4 h-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.actionHint}</p>
                          </div>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 shrink-0 ${BAND_COLOR[item.score.band] ?? ""}`}
                            data-testid={`field-score-${item.id}`}
                          >
                            {item.score.score}
                          </Badge>
                        </div>
                      </Link>
                    </SwipeActionCard>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Blocked Installs */}
        {(blocked.isLoading || blockedInstalls.length > 0) && (
          <section data-testid="field-section-blocked">
            <SectionHeader icon={Truck} title="Blocked Installs" count={blockedInstalls.length} linkTo="/install-workflows" />
            {blocked.isLoading ? <Skeleton className="h-20 rounded-xl" /> : (
              <div className="space-y-2">
                {blockedInstalls.slice(0, 5).map(install => (
                  <SwipeActionCard
                    key={install.id}
                    testId={`field-install-${install.id}`}
                    actions={[
                      { label: "Note", icon: StickyNote, color: "bg-blue-600", testId: `action-note-install-${install.id}`, onClick: () => setLogTarget({ type: "install_workflow", id: install.id, label: install.title }) },
                    ]}
                  >
                    <Link href="/install-workflows">
                      <div className="flex items-center gap-3 px-4 py-3.5">
                        <Truck className="w-4 h-4 text-amber-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{install.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {install.account_name}
                            {install.blocked_batches > 0 && ` · ${install.blocked_batches} batch${install.blocked_batches > 1 ? "es" : ""} blocked`}
                            {install.delayed_pos > 0 && ` · ${install.delayed_pos} PO delayed`}
                          </p>
                        </div>
                        {install.target_completion_date && (
                          <span className="text-[10px] text-amber-400 shrink-0">
                            {format(new Date(install.target_completion_date), "MMM d")}
                          </span>
                        )}
                      </div>
                    </Link>
                  </SwipeActionCard>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Hot Opportunities */}
        {!isLoading && hotOpps.length > 0 && (
          <section data-testid="field-section-opps">
            <SectionHeader icon={Target} title="Hot Opportunities" count={hotOpps.length} linkTo="/opportunities" />
            <div className="space-y-2">
              {hotOpps.map(opp => (
                <SwipeActionCard
                  key={opp.id}
                  testId={`field-opp-${opp.id}`}
                  actions={[
                    { label: "Note", icon: StickyNote, color: "bg-blue-600", testId: `action-note-opp-${opp.id}`, onClick: () => setLogTarget({ type: "opportunity", id: opp.id, label: opp.title }) },
                    { label: "Call", icon: Phone, color: "bg-emerald-600", testId: `action-call-opp-${opp.id}`, onClick: () => {} },
                    { label: "Email", icon: Mail, color: "bg-purple-600", testId: `action-email-opp-${opp.id}`, onClick: () => {} },
                  ]}
                >
                  <Link href={`/opportunities/${opp.id}`}>
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <Target className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{opp.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {opp.accountName} · {STAGE_LABEL[opp.stage] ?? opp.stage}
                        </p>
                      </div>
                      {opp.amount && (
                        <span className="text-xs font-semibold text-emerald-400 shrink-0">
                          ${opp.amount.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </Link>
                </SwipeActionCard>
              ))}
            </div>
          </section>
        )}

        {/* New Leads */}
        {!isLoading && newLeads.length > 0 && (
          <section data-testid="field-section-leads">
            <SectionHeader icon={UserPlus} title="Hot Leads" count={newLeads.length} linkTo="/opportunities" />
            <div className="space-y-2">
              {newLeads.slice(0, 5).map(lead => (
                <SwipeActionCard
                  key={lead.id}
                  testId={`field-lead-${lead.id}`}
                  actions={[
                    { label: "Note", icon: StickyNote, color: "bg-blue-600", testId: `action-note-lead-${lead.id}`, onClick: () => setLogTarget({ type: "lead", id: lead.id, label: lead.company }) },
                    { label: "Call", icon: Phone, color: "bg-emerald-600", testId: `action-call-lead-${lead.id}`, onClick: () => {} },
                    { label: "Email", icon: Mail, color: "bg-purple-600", testId: `action-email-lead-${lead.id}`, onClick: () => {} },
                  ]}
                >
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <UserPlus className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{lead.company}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {[lead.contactName, lead.city].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {lead.dealAmount && (
                      <span className="text-xs font-semibold text-emerald-400 shrink-0">
                        ${lead.dealAmount.toLocaleString()}
                      </span>
                    )}
                  </div>
                </SwipeActionCard>
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {!isLoading && totalActions === 0 && hotOpps.length === 0 && newLeads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center" data-testid="field-empty">
            <CheckSquare className="w-10 h-10 text-emerald-400" />
            <p className="text-base font-semibold">All clear!</p>
            <p className="text-sm text-muted-foreground max-w-xs">No overdue items or blocked installs. Check back after your next activity.</p>
          </div>
        )}

        <div className="h-4" />
      </div>

      <QuickLogModal
        open={!!logTarget}
        onClose={() => setLogTarget(null)}
        linkedObjectType={logTarget?.type}
        linkedObjectId={logTarget?.id}
        linkedLabel={logTarget?.label}
      />
    </div>
  );
}
