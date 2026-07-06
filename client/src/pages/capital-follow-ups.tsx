import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Zap, AlertTriangle, Clock, Calendar, Users, TrendingUp,
  ChevronRight, Mail, Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { InvestorDetail, fmtMoney, type Investor } from "./capital-investors";
import { useQuery as useDetailQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type FollowUpInvestor = Investor & {
  intelligence: {
    score: number;
    tier: "Hot" | "Warm" | "Nurture" | "Low Priority" | "Do Not Contact";
    reasons: string[];
  };
  days_since_touch: number | null;
  next_step_overdue: boolean;
  contact_count: number;
};

function tierBadge(tier: string) {
  if (tier === "Hot")          return "bg-red-500/15 text-red-400 border-red-500/20";
  if (tier === "Warm")         return "bg-amber-500/15 text-amber-400 border-amber-500/20";
  if (tier === "Nurture")      return "bg-violet-500/15 text-violet-400 border-violet-500/20";
  if (tier === "Do Not Contact") return "bg-muted text-muted-foreground border-border/30";
  return "bg-muted text-muted-foreground border-border/30";
}

function tierDot(tier: string) {
  if (tier === "Hot")     return "bg-red-400";
  if (tier === "Warm")    return "bg-amber-400";
  if (tier === "Nurture") return "bg-violet-400";
  return "bg-muted-foreground/30";
}

function priorityBadge(p: string) {
  if (p === "Critical") return "bg-red-600/20 text-red-400";
  if (p === "High")     return "bg-red-500/15 text-red-400";
  if (p === "Medium")   return "bg-amber-500/15 text-amber-400";
  return "bg-muted text-muted-foreground";
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function daysSinceLabel(days: number | null): string {
  if (days === null) return "Never contacted";
  if (days === 0) return "Contacted today";
  if (days === 1) return "1 day ago";
  if (days <= 7) return `${days} days ago`;
  if (days <= 30) return `${days} days ago`;
  return `${days} days ago`;
}

function touchAgeColor(days: number | null): string {
  if (days === null)  return "text-red-400";
  if (days <= 7)      return "text-emerald-400";
  if (days <= 30)     return "text-foreground";
  if (days <= 60)     return "text-amber-400";
  return "text-red-400";
}

const TIER_ORDER: Record<string, number> = { "Hot": 0, "Warm": 1, "Nurture": 2, "Low Priority": 3, "Do Not Contact": 4 };

export default function CapitalFollowUps() {
  const { toast } = useToast();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [tierFilter, setTierFilter] = useState<string>("all");

  const { data: followUps = [], isLoading, isError, refetch } = useQuery<FollowUpInvestor[]>({
    queryKey: ["/api/capital/follow-ups"],
    queryFn: () => fetch("/api/capital/follow-ups", { credentials: "include" }).then(r => {
      if (!r.ok) throw new Error("Failed to load follow-up queue");
      return r.json();
    }),
  });

  const { data: detailData } = useDetailQuery<Investor>({
    queryKey: ["/api/capital/investors", detailId],
    queryFn: () => fetch(`/api/capital/investors/${detailId}`, { credentials: "include" }).then(r => r.json()),
    enabled: detailId != null,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/capital/investors/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/follow-ups"] });
      if (detailId) queryClient.invalidateQueries({ queryKey: ["/api/capital/investors", detailId] });
      toast({ title: "Investor updated" });
    },
  });

  const tiers = Array.from(new Set(followUps.map(f => f.intelligence.tier)));
  const sorted = [...followUps].sort((a, b) => {
    const ta = TIER_ORDER[a.intelligence.tier] ?? 5;
    const tb = TIER_ORDER[b.intelligence.tier] ?? 5;
    if (ta !== tb) return ta - tb;
    return (b.intelligence.score - a.intelligence.score);
  });
  const filtered = tierFilter === "all" ? sorted : sorted.filter(f => f.intelligence.tier === tierFilter);
  const hot   = sorted.filter(f => f.intelligence.tier === "Hot").length;
  const overdue = sorted.filter(f => f.next_step_overdue).length;
  const uncontacted = sorted.filter(f => f.days_since_touch === null).length;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/40 shrink-0">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" /> Follow-Up Queue
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Prioritised action list — scored by engagement, stage, and recency
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            {hot > 0 && (
              <span className="flex items-center gap-1 text-red-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                {hot} Hot
              </span>
            )}
            {overdue > 0 && (
              <span className="flex items-center gap-1 text-amber-400 font-medium">
                <AlertTriangle className="w-3 h-3" /> {overdue} overdue
              </span>
            )}
            {uncontacted > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Mail className="w-3 h-3" /> {uncontacted} never contacted
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tier filters */}
      <div className="px-6 py-2.5 border-b border-border/20 flex items-center gap-2 overflow-x-auto shrink-0">
        {["all", ...tiers].map(t => (
          <button
            key={t}
            onClick={() => setTierFilter(t)}
            data-testid={`filter-tier-${t.toLowerCase().replace(/\s+/g, "-")}`}
            className={`text-xs px-3 py-1 rounded-full border whitespace-nowrap transition-colors ${
              tierFilter === t
                ? "bg-primary/15 border-primary/30 text-primary font-medium"
                : "border-border/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "all" ? `All (${sorted.length})` : `${t} (${sorted.filter(f => f.intelligence.tier === t).length})`}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        )}
        {isError && (
          <div className="flex flex-col items-center justify-center h-48 text-center px-6">
            <AlertTriangle className="w-8 h-8 text-amber-400 mb-3" />
            <p className="text-sm font-medium text-foreground">Could not load follow-up queue</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => refetch()}>Retry</Button>
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center px-6">
            <Zap className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {tierFilter === "all" ? "No investors in the follow-up queue." : `No investors with tier "${tierFilter}".`}
            </p>
          </div>
        )}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="divide-y divide-border/15">
            {filtered.map((inv, idx) => (
              <div
                key={inv.id}
                className="px-6 py-4 hover:bg-muted/10 transition-colors cursor-pointer group"
                onClick={() => setDetailId(inv.id)}
                data-testid={`followup-row-${inv.id}`}
              >
                <div className="flex items-start gap-3">
                  {/* Rank + tier dot */}
                  <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                    <span className="text-xs text-muted-foreground/40 font-mono w-5 text-center">{idx + 1}</span>
                    <div className={`w-2 h-2 rounded-full ${tierDot(inv.intelligence.tier)}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{inv.name}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${tierBadge(inv.intelligence.tier)}`}
                          data-testid={`tier-badge-${inv.id}`}>
                          {inv.intelligence.tier}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${priorityBadge(inv.priority)}`}>
                          {inv.priority}
                        </span>
                        {inv.next_step_overdue && (
                          <span className="text-xs text-red-400 flex items-center gap-0.5">
                            <AlertTriangle className="w-3 h-3" /> Overdue
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                        <span className="font-bold text-foreground">{inv.intelligence.score}</span>
                        <span className="text-muted-foreground/50">/100</span>
                        <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> {inv.stage}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span className={touchAgeColor(inv.days_since_touch)}>
                          {daysSinceLabel(inv.days_since_touch)}
                        </span>
                      </span>
                      {inv.contact_count > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" /> {inv.contact_count} contact{Number(inv.contact_count) !== 1 ? "s" : ""}
                        </span>
                      )}
                      {inv.check_size_max && (
                        <span className="flex items-center gap-1">
                          <Activity className="w-3 h-3" /> {fmtMoney(inv.check_size_max)} max
                        </span>
                      )}
                      {inv.next_step_date && (
                        <span className={`flex items-center gap-1 ${inv.next_step_overdue ? "text-red-400" : ""}`}>
                          <Calendar className="w-3 h-3" /> {fmtDate(inv.next_step_date)}
                        </span>
                      )}
                    </div>

                    {/* Score reasons */}
                    {inv.intelligence.reasons.length > 0 && (
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {inv.intelligence.reasons.slice(0, 3).map((r, i) => (
                          <span key={i} className="text-xs text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded">
                            {r}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Next step */}
                    {inv.next_step && (
                      <p className="text-xs text-muted-foreground/70 mt-1 truncate">
                        → {inv.next_step}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Investor detail drawer */}
      <Sheet open={detailId != null} onOpenChange={v => !v && setDetailId(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" side="right">
          {detailData ? (
            <InvestorDetail
              investor={detailData}
              onEdit={() => setDetailId(null)}
              onStageChange={stage => {
                if (detailData) updateMut.mutate({ id: detailData.id, data: { stage } });
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-40">
              <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
