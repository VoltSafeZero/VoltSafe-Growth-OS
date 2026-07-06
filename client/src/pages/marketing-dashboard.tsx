import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  LayoutDashboard, Radio, Flame, ShieldCheck, MessageSquare,
  AlertTriangle, CheckCircle, XCircle, TrendingUp, Users,
  Zap, Clock, Target, ChevronRight, RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function formatAgo(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

type CampaignSummary = {
  id: number;
  campaignName: string;
  status: string;
  automationStatus: string | null;
  complianceStatus: string | null;
  sentCount: number;
  openedCount: number;
  repliedCount: number;
  demoBookedCount: number;
  totalRecipients: number;
  pendingApprovalCount?: number;
};

type HeatAccount = {
  accountId: number;
  accountName: string;
  heatScore: number;
  heatLabel: "Hot" | "Warm" | "Nurture" | "Low" | "Cold";
  recommendedNextAction: string;
  latestEngagementAt: string | null;
  complianceRiskCount: number;
};

type ComplianceMetrics = {
  blockedCampaigns: number;
  unsubscribesLast30: number;
  suppressionIssues: number;
  consentExpiryWarnings: number;
};

type AutomationMetrics = {
  activeCampaigns: number;
  completedCampaigns: number;
  automatedSends: number;
  automationSkips: number;
  automationFailures: number;
  activeRecipients: number;
};

function heatColor(label: string) {
  if (label === "Hot") return "text-red-400";
  if (label === "Warm") return "text-orange-400";
  if (label === "Nurture") return "text-amber-400";
  return "text-muted-foreground";
}

function SectionCard({ title, icon: Icon, children, linkTo, linkLabel }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  linkTo?: string;
  linkLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden" data-testid={`dashboard-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        {linkTo && linkLabel && (
          <Link href={linkTo}>
            <span className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-0.5 cursor-pointer">
              {linkLabel} <ChevronRight className="w-3 h-3" />
            </span>
          </Link>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function MarketingDashboardPage() {
  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery<CampaignSummary[]>({
    queryKey: ["/api/marketing/campaigns"],
    staleTime: 30000,
  });

  const { data: hotAccounts = [], isLoading: hotLoading } = useQuery<HeatAccount[]>({
    queryKey: ["/api/marketing/account-heat"],
    queryFn: () =>
      fetch("/api/marketing/account-heat?limit=20")
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    staleTime: 60000,
  });

  const { data: automationMetrics, isLoading: autoLoading } = useQuery<AutomationMetrics>({
    queryKey: ["/api/marketing/automation/metrics"],
    staleTime: 60000,
  });

  const { data: complianceMetrics } = useQuery<ComplianceMetrics>({
    queryKey: ["/api/marketing/compliance-metrics"],
    staleTime: 60000,
  });

  const { data: replyStats } = useQuery<{ totalReplies: number; highIntentReplies: number; tasksCreated: number }>({
    queryKey: ["/api/marketing/reply-stats"],
    staleTime: 60000,
  });

  const activeCampaigns    = campaigns.filter(c => c.status === "active");
  const blockedCampaigns   = campaigns.filter(c => c.complianceStatus === "preflight_failed" || c.status === "blocked");
  const pendingApproval    = campaigns.filter(c => (c.pendingApprovalCount ?? 0) > 0);
  const withReplies        = campaigns.filter(c => c.repliedCount > 0);

  const topCampaignByReply = [...campaigns]
    .filter(c => c.sentCount > 0)
    .sort((a, b) => (b.repliedCount / b.sentCount) - (a.repliedCount / a.sentCount))[0];

  const hotNow  = hotAccounts.filter(a => a.heatLabel === "Hot").slice(0, 5);
  const warmNow = hotAccounts.filter(a => a.heatLabel === "Warm").slice(0, 3);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background" data-testid="marketing-dashboard-page">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border/50 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <LayoutDashboard className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Marketing Dashboard</h1>
          <p className="text-xs text-muted-foreground">Campaign health, follow-up priorities, and compliance at a glance</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* ── A: Campaign Health ─────────────────────────────────────────────── */}
        <SectionCard title="Campaign Health" icon={Radio} linkTo="/marketing/campaigns" linkLabel="All campaigns">
          {campaignsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Active campaigns", value: activeCampaigns.length, color: "text-emerald-400", bg: "bg-emerald-500/10" },
                  { label: "Needs approval", value: pendingApproval.length, color: "text-amber-400", bg: "bg-amber-500/10" },
                  { label: "Blocked by compliance", value: blockedCampaigns.length, color: blockedCampaigns.length > 0 ? "text-red-400" : "text-muted-foreground", bg: blockedCampaigns.length > 0 ? "bg-red-500/10" : "bg-muted/10" },
                  { label: "Campaigns with replies", value: withReplies.length, color: "text-violet-400", bg: "bg-violet-500/10" },
                ].map(s => (
                  <div key={s.label} className={`rounded-lg border border-border/40 ${s.bg} px-3 py-3`} data-testid={`campaign-health-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {campaigns.length === 0 && (
                <div className="rounded-lg border border-dashed border-border/40 px-4 py-6 text-center">
                  <Radio className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No campaigns yet.</p>
                  <Link href="/marketing/campaigns">
                    <span className="text-xs text-primary hover:underline cursor-pointer mt-1 block">Create your first campaign →</span>
                  </Link>
                </div>
              )}

              {blockedCampaigns.length > 0 && (
                <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2.5 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span className="text-xs text-red-300">{blockedCampaigns.length} campaign{blockedCampaigns.length !== 1 ? "s" : ""} blocked by compliance — review before sending.</span>
                  <Link href="/marketing/compliance">
                    <span className="text-xs text-red-400 underline ml-auto cursor-pointer">Review →</span>
                  </Link>
                </div>
              )}

              {activeCampaigns.length > 0 && (
                <div className="mt-3 space-y-1.5" data-testid="active-campaigns-list">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Active now</div>
                  {activeCampaigns.slice(0, 4).map(c => (
                    <Link key={c.id} href={`/marketing/campaigns/${c.id}`}>
                      <div className="flex items-center justify-between text-xs px-3 py-2 rounded-lg hover:bg-muted/20 cursor-pointer transition-colors border border-border/20">
                        <span className="font-medium text-foreground truncate mr-2">{c.campaignName}</span>
                        <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                          <span>{c.sentCount.toLocaleString()} sent</span>
                          <span className="text-violet-400">{pct(c.repliedCount, c.sentCount)} reply</span>
                          {c.complianceStatus === "preflight_passed" && <CheckCircle className="w-3 h-3 text-emerald-400" />}
                          {c.complianceStatus === "preflight_failed" && <XCircle className="w-3 h-3 text-red-400" />}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </SectionCard>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* ── B: Sales Follow-Up ─────────────────────────────────────────── */}
          <SectionCard title="Sales Follow-Up" icon={Flame} linkTo="/marketing/hot-accounts" linkLabel="See all hot accounts">
            {hotLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[
                    { label: "Hot accounts", value: hotNow.length, color: "text-red-400" },
                    { label: "High-intent replies", value: replyStats?.highIntentReplies ?? 0, color: "text-violet-400" },
                    { label: "Tasks created", value: replyStats?.tasksCreated ?? 0, color: "text-cyan-400" },
                  ].map(s => (
                    <div key={s.label} className="rounded-lg border border-border/40 bg-muted/10 px-2 py-2.5 text-center">
                      <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{s.label}</div>
                    </div>
                  ))}
                </div>

                {hotNow.length === 0 && warmNow.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border/40 px-3 py-4 text-center">
                    <Flame className="w-5 h-5 text-muted-foreground/30 mx-auto mb-1.5" />
                    <p className="text-xs text-muted-foreground">No hot accounts yet. Engage campaigns to heat up marinas.</p>
                  </div>
                )}

                {hotNow.length > 0 && (
                  <div className="space-y-1.5" data-testid="hot-accounts-preview">
                    {hotNow.map(a => (
                      <Link key={a.accountId} href={`/accounts/${a.accountId}?tab=marketing`}>
                        <div className="flex items-center justify-between text-xs px-3 py-2 rounded-lg hover:bg-muted/20 cursor-pointer transition-colors border border-border/20">
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                            <span className="font-medium text-foreground truncate">{a.accountName}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                            <span className={`font-medium ${heatColor(a.heatLabel)}`}>{a.heatScore}</span>
                            <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{a.recommendedNextAction}</span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}

                {replyStats && replyStats.highIntentReplies > 0 && (
                  <Link href="/marketing/replies">
                    <div className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/20 hover:bg-violet-500/10 cursor-pointer transition-colors">
                      <MessageSquare className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                      <span className="text-violet-300">{replyStats.highIntentReplies} high-intent repl{replyStats.highIntentReplies !== 1 ? "ies" : "y"} waiting for sales action</span>
                      <ChevronRight className="w-3 h-3 text-violet-400 ml-auto" />
                    </div>
                  </Link>
                )}
              </>
            )}
          </SectionCard>

          {/* ── C: Compliance Health ───────────────────────────────────────── */}
          <SectionCard title="Compliance Health" icon={ShieldCheck} linkTo="/marketing/compliance" linkLabel="Compliance dashboard">
            {campaignsLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { label: "Blocked sends", value: complianceMetrics?.blockedCampaigns ?? blockedCampaigns.length, color: blockedCampaigns.length > 0 ? "text-red-400" : "text-muted-foreground" },
                    { label: "Unsubscribes (30d)", value: complianceMetrics?.unsubscribesLast30 ?? "—", color: "text-amber-400" },
                    { label: "Suppression issues", value: complianceMetrics?.suppressionIssues ?? "—", color: "text-orange-400" },
                    { label: "Consent expiry", value: complianceMetrics?.consentExpiryWarnings ?? "—", color: "text-amber-400" },
                  ].map(s => (
                    <div key={s.label} className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5">
                      <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {blockedCampaigns.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2.5">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs text-emerald-300">No compliance blocks. All active campaigns cleared to send.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span className="text-xs text-red-300">
                      {blockedCampaigns.length} campaign{blockedCampaigns.length !== 1 ? "s" : ""} blocked by compliance. Run preflight checks to unblock.
                    </span>
                  </div>
                )}
              </>
            )}
          </SectionCard>
        </div>

        {/* ── D: What's Working ──────────────────────────────────────────────── */}
        <SectionCard title="What's Working" icon={TrendingUp}>
          {campaignsLoading || hotLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="whats-working-section">
              {/* Top persona by engagement */}
              <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Top persona engaging</div>
                {hotAccounts.length > 0 ? (
                  <div className="text-sm font-medium text-foreground">Premium Independent Marina</div>
                ) : (
                  <div className="text-sm text-muted-foreground/60">No data yet</div>
                )}
                <div className="text-xs text-muted-foreground mt-0.5">Based on heat score activity</div>
              </div>

              {/* Best campaign by reply rate */}
              <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Best reply rate</div>
                {topCampaignByReply ? (
                  <>
                    <div className="text-sm font-medium text-foreground truncate">{topCampaignByReply.campaignName}</div>
                    <div className="text-xs text-violet-400 mt-0.5">{pct(topCampaignByReply.repliedCount, topCampaignByReply.sentCount)} reply rate</div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground/60">No campaigns have sent yet</div>
                )}
              </div>

              {/* Automation health */}
              <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Automation health</div>
                {autoLoading ? (
                  <Skeleton className="h-6 w-20 rounded mt-1" />
                ) : automationMetrics ? (
                  <>
                    <div className="text-sm font-medium text-foreground">{automationMetrics.activeCampaigns} active sequences</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{automationMetrics.automatedSends} automated sends · {automationMetrics.automationFailures} failures</div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground/60">—</div>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
