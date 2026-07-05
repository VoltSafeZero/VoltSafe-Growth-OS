import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BarChart3, TrendingUp, Mail, MousePointerClick, MessageSquare, Calendar,
  Users, Target, ArrowUp, ArrowDown, Minus, Flame, ThermometerSun,
  AlertTriangle, ChevronDown, ChevronUp, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

const PERSONA_ROWS = [
  { persona: "Premium Independent Marina", tier: 1 },
  { persona: "Marina Group / Multi-Site Operator", tier: 1 },
  { persona: "Resort / Destination Marina", tier: 1 },
  { persona: "Developer / New Build", tier: 1 },
  { persona: "Port Authority Marina", tier: 1 },
  { persona: "Municipal Marina", tier: 2 },
  { persona: "Yacht Club", tier: 2 },
  { persona: "Working Harbour / Commercial Marina", tier: 2 },
  { persona: "Mom & Pop Marina", tier: 3 },
];

const ROLE_ROWS = [
  { role: "Harbormaster", openRate: 53, replyRate: 14, demoRate: 6 },
  { role: "GM", openRate: 49, replyRate: 11, demoRate: 5 },
  { role: "Owner", openRate: 42, replyRate: 8, demoRate: 3 },
  { role: "Marine Electrician", openRate: 38, replyRate: 7, demoRate: 2 },
  { role: "Port Manager", openRate: 35, replyRate: 6, demoRate: 2 },
  { role: "Developer", openRate: 44, replyRate: 9, demoRate: 4 },
];

type CampaignSummary = {
  id: number;
  campaignName: string;
  status: string;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  repliedCount: number;
  demoBookedCount: number;
};

type HeatAccount = {
  accountId: number;
  accountName: string;
  marinaType: string | null;
  region: string | null;
  heatScore: number;
  heatLabel: "Hot" | "Warm" | "Nurture" | "Low" | "Cold";
  scoreReasons: string[];
  negativeReasons: string[];
  latestEngagementAt: string | null;
  engagedContactsCount: number;
  engagedRoles: string[];
  openCount: number;
  clickCount: number;
  replyCount: number;
  complianceRiskCount: number;
  recommendedNextAction: string;
};

const HEAT_LABELS = ["Hot", "Warm", "Nurture", "Low", "Cold"] as const;

function heatColor(label: string) {
  if (label === "Hot") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (label === "Warm") return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  if (label === "Nurture") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (label === "Low") return "bg-slate-500/15 text-slate-400 border-slate-500/30";
  return "bg-muted/30 text-muted-foreground border-border/50";
}

function heatDot(label: string) {
  if (label === "Hot") return "bg-red-400";
  if (label === "Warm") return "bg-orange-400";
  if (label === "Nurture") return "bg-amber-400";
  if (label === "Low") return "bg-slate-400";
  return "bg-muted-foreground/40";
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

// ── Hot Marina Accounts section ───────────────────────────────────────────────
function HotAccountsSection() {
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (labelFilter !== "all") params.set("label", labelFilter);
  params.set("limit", "30");

  const { data: accounts = [], isLoading, isError } = useQuery<HeatAccount[]>({
    queryKey: ["/api/marketing/account-heat", labelFilter],
    queryFn: () =>
      fetch(`/api/marketing/account-heat?${params.toString()}`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
        .catch(() => []),
  });

  return (
    <div data-testid="hot-accounts-section">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Flame className="w-4 h-4 text-red-400" /> Hot Marina Accounts
          {accounts.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({accounts.length})</span>
          )}
        </h2>
        <div className="flex gap-1">
          {["all", ...HEAT_LABELS].map(l => (
            <button
              key={l}
              onClick={() => setLabelFilter(l)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors border ${
                labelFilter === l
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground border-border/50 hover:text-foreground hover:border-border"
              }`}
              data-testid={`heat-filter-${l}`}
            >
              {l === "all" ? "All" : l}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-xl border border-border/40 bg-muted/20 px-6 py-10 text-center" data-testid="hot-accounts-empty">
          <ThermometerSun className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No account heat data yet</p>
          <p className="text-xs text-muted-foreground">
            Enroll contacts into a campaign and start sending to begin tracking account heat scores.
          </p>
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-border/40 bg-muted/20 px-6 py-8 text-center" data-testid="hot-accounts-error">
          <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Could not load account heat data. Please try refreshing.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  {["Account / Marina", "Persona", "Heat Score", "Engaged Contacts", "Top Role", "Latest Engagement", "Compliance", "Recommended Action"].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map((a, i) => (
                  <Fragment key={a.accountId}>
                    <tr
                      className={`border-b border-border/20 cursor-pointer hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                      onClick={() => setExpanded(expanded === a.accountId ? null : a.accountId)}
                      data-testid={`heat-row-${a.accountId}`}
                    >
                      <td className="px-4 py-3">
                        <Link href={`/accounts/${a.accountId}`} onClick={e => e.stopPropagation()}>
                          <span className="font-medium text-foreground hover:text-primary transition-colors">{a.accountName}</span>
                        </Link>
                        {a.region && <div className="text-xs text-muted-foreground">{a.region}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{a.marinaType ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-muted/40 flex items-center justify-center text-[10px] font-bold text-foreground">
                            {a.heatScore}
                          </div>
                          <Badge variant="outline" className={`text-[10px] h-5 px-1.5 border ${heatColor(a.heatLabel)}`}>
                            <div className={`w-1.5 h-1.5 rounded-full mr-1 ${heatDot(a.heatLabel)}`} />
                            {a.heatLabel}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className={`font-medium ${a.engagedContactsCount > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                          {a.engagedContactsCount}
                        </span>
                        {a.engagedContactsCount === 0 && <span className="text-muted-foreground"> / none</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{a.engagedRoles[0] ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatAgo(a.latestEngagementAt)}</td>
                      <td className="px-4 py-3 text-xs">
                        {a.complianceRiskCount > 0 ? (
                          <span className="flex items-center gap-1 text-amber-400">
                            <AlertTriangle className="w-3 h-3" />{a.complianceRiskCount} risk{a.complianceRiskCount !== 1 ? "s" : ""}
                          </span>
                        ) : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px]">
                        <div className="flex items-center gap-1">
                          <Zap className="w-3 h-3 text-primary shrink-0" />
                          <span className="truncate">{a.recommendedNextAction}</span>
                        </div>
                      </td>
                    </tr>
                    {expanded === a.accountId && (
                      <tr className="border-b border-border/20 bg-muted/5">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-4">
                            {a.scoreReasons.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-emerald-400 mb-1.5 uppercase tracking-wide">Why this account is heating up</div>
                                <ul className="space-y-1">
                                  {a.scoreReasons.map((r, ri) => (
                                    <li key={ri} className="text-xs text-muted-foreground flex items-center gap-1.5">
                                      <div className="w-1 h-1 rounded-full bg-emerald-400/60 shrink-0" />{r}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {a.negativeReasons.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-red-400 mb-1.5 uppercase tracking-wide">Risk signals</div>
                                <ul className="space-y-1">
                                  {a.negativeReasons.map((r, ri) => (
                                    <li key={ri} className="text-xs text-muted-foreground flex items-center gap-1.5">
                                      <div className="w-1 h-1 rounded-full bg-red-400/60 shrink-0" />{r}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div className="col-span-2 flex gap-6 pt-1 border-t border-border/20">
                              {[
                                { label: "Opens", value: a.openCount },
                                { label: "Clicks", value: a.clickCount },
                                { label: "Replies", value: a.replyCount },
                              ].map(s => (
                                <div key={s.label} className="text-xs">
                                  <span className="text-muted-foreground">{s.label}: </span>
                                  <span className="font-medium text-foreground">{s.value}</span>
                                </div>
                              ))}
                              <Link href={`/accounts/${a.accountId}?tab=marketing`}>
                                <span className="text-xs text-primary hover:underline">View full intelligence →</span>
                              </Link>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MarketingAnalyticsPage() {
  const { data: campaigns = [], isLoading } = useQuery<CampaignSummary[]>({
    queryKey: ["/api/marketing/campaigns"],
  });

  const active = campaigns.filter(c => c.status === "active" || c.status === "completed");
  const totalSent = active.reduce((a, c) => a + c.sentCount, 0);
  const totalOpened = active.reduce((a, c) => a + c.openedCount, 0);
  const totalClicked = active.reduce((a, c) => a + c.clickedCount, 0);
  const totalReplied = active.reduce((a, c) => a + c.repliedCount, 0);
  const totalDemos = active.reduce((a, c) => a + c.demoBookedCount, 0);

  const summaryCards = [
    { label: "Total Sent", value: totalSent.toLocaleString(), icon: Mail, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Open Rate", value: pct(totalOpened, totalSent), icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10", target: "40%+" },
    { label: "Click Rate", value: pct(totalClicked, totalSent), icon: MousePointerClick, color: "text-amber-400", bg: "bg-amber-500/10", target: "8%+" },
    { label: "Reply Rate", value: pct(totalReplied, totalSent), icon: MessageSquare, color: "text-violet-400", bg: "bg-violet-500/10", target: "3%+" },
    { label: "Demos Booked", value: totalDemos.toString(), icon: Calendar, color: "text-cyan-400", bg: "bg-cyan-500/10" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border/50 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Campaign Analytics</h1>
          <p className="text-xs text-muted-foreground">Performance across all campaigns, personas, and stakeholder roles</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading analytics…</div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {summaryCards.map(s => (
                <div key={s.label} className={`rounded-xl border border-border/50 bg-card/50 p-4 flex flex-col gap-2`}>
                  <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center`}>
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                  </div>
                  <div className={`text-2xl font-bold ${s.color}`}>{totalSent === 0 ? "—" : s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  {(s as any).target && (
                    <div className="text-xs text-muted-foreground/60">Target: {(s as any).target}</div>
                  )}
                </div>
              ))}
            </div>

            {/* Hot Marina Accounts */}
            <HotAccountsSection />

            {/* Campaign performance table */}
            {active.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3">Campaign Performance</h2>
                <div className="rounded-xl border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        {["Campaign", "Sent", "Open Rate", "Click Rate", "Reply Rate", "Demos"].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {active.map((c, i) => (
                        <tr key={c.id} className={`border-b border-border/30 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                          <td className="px-4 py-3 font-medium text-foreground text-sm">{c.campaignName}</td>
                          <td className="px-4 py-3 font-mono text-xs">{c.sentCount.toLocaleString()}</td>
                          <td className="px-4 py-3 font-mono text-xs">{pct(c.openedCount, c.sentCount)}</td>
                          <td className="px-4 py-3 font-mono text-xs">{pct(c.clickedCount, c.sentCount)}</td>
                          <td className="px-4 py-3 font-mono text-xs">{pct(c.repliedCount, c.sentCount)}</td>
                          <td className="px-4 py-3 font-mono text-xs">{c.demoBookedCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Automation Metrics */}
            <AutomationMetricsSection />

            {/* Role breakdown */}
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" /> Stakeholder Role Benchmarks
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                These are <strong>industry benchmark targets</strong>, not tracked campaign data. Real open/reply/demo rates will appear here once campaigns have sent volume.
              </p>
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30">
                      {["Role", "Open Rate", "Reply Rate", "Demo Rate"].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROLE_ROWS.map((r, i) => (
                      <tr key={r.role} className={`border-b border-border/30 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                        <td className="px-4 py-3 font-medium text-foreground text-sm">{r.role}</td>
                        <td className="px-4 py-3">
                          <RateBar value={r.openRate} max={60} color="bg-emerald-500" />
                        </td>
                        <td className="px-4 py-3">
                          <RateBar value={r.replyRate} max={20} color="bg-violet-500" />
                        </td>
                        <td className="px-4 py-3">
                          <RateBar value={r.demoRate} max={10} color="bg-cyan-500" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Marina Persona priority tiers */}
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" /> Marina Persona Priority Tiers
              </h2>
              <div className="space-y-2">
                {([1, 2, 3] as const).map(tier => {
                  const personas = PERSONA_ROWS.filter(p => p.tier === tier);
                  const tierLabel = tier === 1 ? "Tier 1 — Chase Now" : tier === 2 ? "Tier 2 — Nurture + Selectively Chase" : "Tier 3 — Do Not Spend Heavy Sales Time Yet";
                  const tierColor = tier === 1 ? "border-emerald-500/30 bg-emerald-500/5" : tier === 2 ? "border-amber-500/30 bg-amber-500/5" : "border-border/30 bg-muted/10";
                  const dotColor = tier === 1 ? "bg-emerald-400" : tier === 2 ? "bg-amber-400" : "bg-muted-foreground/40";
                  return (
                    <div key={tier} className={`rounded-xl border ${tierColor} px-4 py-3`}>
                      <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">{tierLabel}</div>
                      <div className="flex flex-wrap gap-2">
                        {personas.map(p => (
                          <div key={p.persona} className="flex items-center gap-1.5 text-xs text-foreground">
                            <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                            {p.persona}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Early Adopter Formula */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
              <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Early Adopter Formula</div>
              <div className="text-sm text-foreground">
                <span className="font-medium">High-value marina</span>
                <span className="text-muted-foreground"> + </span>
                <span className="font-medium">clear pain</span>
                <span className="text-muted-foreground"> + </span>
                <span className="font-medium">decision-maker access</span>
                <span className="text-muted-foreground"> + </span>
                <span className="font-medium">modernization mindset</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                VoltSafe should target marinas where safety, modernization, customer experience, metered billing, or infrastructure leadership already matter.
              </div>
            </div>

            {/* Success benchmarks */}
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3">BC Marinas Launch Benchmarks</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Open Rate Target", value: "40%+", met: totalSent > 0 && (totalOpened / totalSent) >= 0.4 },
                  { label: "Click Rate Target", value: "8%+", met: totalSent > 0 && (totalClicked / totalSent) >= 0.08 },
                  { label: "Reply Rate Target", value: "3%+", met: totalSent > 0 && (totalReplied / totalSent) >= 0.03 },
                  { label: "Demos / 100 contacts", value: "2–5", met: null },
                ].map(b => (
                  <div key={b.label} className="rounded-xl border border-border/50 bg-card/50 px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">{b.label}</div>
                      <div className="text-lg font-bold text-foreground">{b.value}</div>
                    </div>
                    {b.met !== null && totalSent > 0 && (
                      b.met
                        ? <ArrowUp className="w-4 h-4 text-emerald-400" />
                        : <ArrowDown className="w-4 h-4 text-red-400" />
                    )}
                    {b.met === null && <Minus className="w-4 h-4 text-muted-foreground/40" />}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AutomationMetricsSection() {
  const { data: metrics, isLoading } = useQuery<{
    activeCampaigns: number;
    completedCampaigns: number;
    automatedSends: number;
    automationSkips: number;
    automationFailures: number;
    activeRecipients: number;
    completedRecipients: number;
  }>({
    queryKey: ["/api/marketing/automation/metrics"],
    staleTime: 60000,
  });

  if (isLoading) return null;

  const m = metrics ?? {
    activeCampaigns: 0, completedCampaigns: 0, automatedSends: 0,
    automationSkips: 0, automationFailures: 0, activeRecipients: 0, completedRecipients: 0,
  };

  const hasAny = m.activeCampaigns > 0 || m.completedCampaigns > 0 || m.automatedSends > 0;

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
        <Zap className="w-4 h-4 text-primary" /> Drip Automation Summary
      </h2>
      {!hasAny ? (
        <p className="text-xs text-muted-foreground italic">
          No automated campaigns running yet. Start a drip sequence from any campaign detail page.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
          {[
            { label: "Active Campaigns", value: m.activeCampaigns, color: "text-emerald-400" },
            { label: "Completed Campaigns", value: m.completedCampaigns, color: "text-cyan-400" },
            { label: "Automated Sends", value: m.automatedSends, color: "text-primary" },
            { label: "Active Recipients", value: m.activeRecipients, color: "text-violet-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-border/50 bg-card/50 px-4 py-3">
              <div className={`text-xl font-bold ${value > 0 ? color : "text-muted-foreground/40"}`}>
                {value.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RateBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted/40 rounded-full h-1.5 overflow-hidden max-w-[80px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-8 text-right">{value}%</span>
    </div>
  );
}
