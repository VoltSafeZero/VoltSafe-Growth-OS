import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, TrendingUp, Mail, MousePointerClick, MessageSquare, Calendar,
  Users, Target, ArrowUp, ArrowDown, Minus,
} from "lucide-react";

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
