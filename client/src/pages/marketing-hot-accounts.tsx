import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Flame, AlertTriangle, ChevronDown, ChevronUp, Zap, Target,
  Building2, Filter,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketingDrilldownSheet, type DrilldownConfig } from "@/components/marketing/marketing-drilldown-sheet";

const HEAT_LABELS = ["Hot", "Warm", "Nurture", "Low", "Cold"] as const;

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

export default function MarketingHotAccountsPage() {
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null);

  const { data: accounts = [], isLoading } = useQuery<HeatAccount[]>({
    queryKey: ["/api/marketing/account-heat", labelFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" });
      if (labelFilter !== "all") params.set("label", labelFilter);
      return fetch(`/api/marketing/account-heat?${params.toString()}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []);
    },
    staleTime: 60000,
  });

  const filtered = labelFilter === "all"
    ? accounts
    : accounts.filter(a => a.heatLabel === labelFilter);

  const hotCount  = accounts.filter(a => a.heatLabel === "Hot").length;
  const warmCount = accounts.filter(a => a.heatLabel === "Warm").length;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background" data-testid="hot-accounts-page">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border/50 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
          <Flame className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Hot Accounts</h1>
          <p className="text-xs text-muted-foreground">
            Marinas heating up from campaign engagement — prioritize these for sales follow-up
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hotCount > 0 && (
            <Badge className="bg-red-500/15 text-red-400 border border-red-500/30 text-xs">
              {hotCount} Hot
            </Badge>
          )}
          {warmCount > 0 && (
            <Badge className="bg-orange-500/15 text-orange-400 border border-orange-500/30 text-xs">
              {warmCount} Warm
            </Badge>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Summary score cards */}
        {!isLoading && accounts.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {(["all", ...HEAT_LABELS] as const).map(label => {
              const count = label === "all" ? accounts.length : accounts.filter(a => a.heatLabel === label).length;
              return (
                <button
                  key={label}
                  onClick={() => {
                    setLabelFilter(label);
                    setDrilldown({ metric: "hot_accounts_by_label", title: label === "all" ? "All Accounts" : `${label} Accounts`, extraParams: { label } });
                  }}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    labelFilter === label ? "border-primary bg-primary/10" : "border-border/40 bg-muted/10 hover:bg-muted/20"
                  }`}
                  data-testid={`heat-filter-${label}`}
                >
                  <div className="text-2xl font-bold text-foreground">{count}</div>
                  <div className="text-xs text-muted-foreground capitalize mt-0.5">{label === "all" ? "All accounts" : label}</div>
                </button>
              );
            })}
          </div>
        )}

        {isLoading && (
          <div className="space-y-3">
            {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        )}

        {!isLoading && accounts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Flame className="w-12 h-12 text-muted-foreground/20 mb-4" />
            <h2 className="text-base font-semibold text-foreground mb-1">No hot accounts yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Accounts heat up as contacts engage with your campaigns — opens, clicks, and replies all score heat.
              Launch a campaign to start seeing activity here.
            </p>
            <Link href="/marketing/campaigns">
              <span className="mt-4 text-sm text-primary hover:underline cursor-pointer">Go to Campaigns →</span>
            </Link>
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="rounded-xl border border-border/50 overflow-hidden" data-testid="hot-accounts-table">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[900px]">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    {["Account", "Heat", "Score", "Personas / Roles", "Last Engagement", "Compliance", "Recommended Action"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a, i) => (
                    <Fragment key={a.accountId}>
                      <tr
                        className={`border-b border-border/30 hover:bg-muted/10 cursor-pointer transition-colors ${i % 2 === 0 ? "" : "bg-muted/5"}`}
                        onClick={() => setExpanded(expanded === a.accountId ? null : a.accountId)}
                        data-testid={`hot-account-row-${a.accountId}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${heatDot(a.heatLabel)}`} />
                            <Link href={`/accounts/${a.accountId}?tab=marketing`} onClick={e => e.stopPropagation()}>
                              <span className="font-medium text-foreground hover:text-primary transition-colors">{a.accountName}</span>
                            </Link>
                          </div>
                          {a.marinaType && <div className="text-muted-foreground mt-0.5 pl-4">{a.marinaType}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${heatColor(a.heatLabel)}`}>
                            {a.heatLabel}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-foreground">{a.heatScore}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {a.engagedRoles.length > 0 ? a.engagedRoles.slice(0, 2).join(", ") : "—"}
                          {a.engagedRoles.length > 2 && <span className="text-muted-foreground/60"> +{a.engagedRoles.length - 2}</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{formatAgo(a.latestEngagementAt)}</td>
                        <td className="px-4 py-3">
                          {a.complianceRiskCount > 0 ? (
                            <span className="flex items-center gap-1 text-amber-400">
                              <AlertTriangle className="w-3 h-3" />{a.complianceRiskCount} risk{a.complianceRiskCount !== 1 ? "s" : ""}
                            </span>
                          ) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[220px]">
                          <div className="flex items-center gap-1">
                            <Zap className="w-3 h-3 text-primary shrink-0" />
                            <span className="truncate">{a.recommendedNextAction}</span>
                            <div className="ml-auto shrink-0">
                              {expanded === a.accountId
                                ? <ChevronUp className="w-3 h-3 text-muted-foreground/60" />
                                : <ChevronDown className="w-3 h-3 text-muted-foreground/60" />}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {expanded === a.accountId && (
                        <tr className="border-b border-border/20 bg-muted/5">
                          <td colSpan={7} className="px-4 py-4">
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
                                  { label: "Contacts engaged", value: a.engagedContactsCount },
                                ].map(s => (
                                  <div key={s.label} className="text-xs">
                                    <span className="text-muted-foreground">{s.label}: </span>
                                    <span className="font-medium text-foreground">{s.value}</span>
                                  </div>
                                ))}
                                <Link href={`/accounts/${a.accountId}?tab=marketing`}>
                                  <span className="text-xs text-primary hover:underline cursor-pointer">View full profile →</span>
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

        {!isLoading && filtered.length === 0 && accounts.length > 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No {labelFilter} accounts. <button onClick={() => setLabelFilter("all")} className="text-primary hover:underline">Show all</button>
          </div>
        )}
      </div>

      <MarketingDrilldownSheet config={drilldown} onClose={() => setDrilldown(null)} />
    </div>
  );
}
