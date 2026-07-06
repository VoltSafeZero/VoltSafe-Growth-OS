import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  DollarSign, Target, TrendingUp, Clock, AlertTriangle,
  Users, FileText, Calendar, ChevronRight, Landmark, Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

function fmt(cents: number | null | undefined): string {
  if (!cents) return "—";
  const v = cents / 100;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function fmtAgo(d: string | null): string {
  if (!d) return "—";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days/7)}w ago`;
  return `${Math.floor(days/30)}mo ago`;
}

function priorityColor(p: string) {
  if (p === "High")   return "text-red-400";
  if (p === "Medium") return "text-amber-400";
  return "text-muted-foreground";
}

type DashData = {
  committedCents: number;
  softCircledCents: number;
  weightedFunderPipelineCents: number;
  weightedGrantPipelineCents: number;
  upcomingDeadlines: any[];
  nextFollowUps: any[];
  topPriorityFunders: any[];
  topPriorityGrants: any[];
  documentBlockers: any[];
  totalFunders: number;
  totalGrants: number;
  totalDocuments: number;
  pendingActivities: number;
};

function StatCard({ label, value, icon: Icon, sub, color = "text-foreground" }: {
  label: string; value: string; icon: React.ElementType; sub?: string; color?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 px-4 py-4">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <Icon className="w-4 h-4 text-muted-foreground/50" />
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function SectionCard({ title, icon: Icon, linkTo, linkLabel, children }: {
  title: string; icon: React.ElementType; linkTo?: string; linkLabel?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" /> {title}
        </h3>
        {linkTo && (
          <Link href={linkTo} className="text-xs text-primary hover:underline flex items-center gap-0.5">
            {linkLabel ?? "View all"} <ChevronRight className="w-3 h-3" />
          </Link>
        )}
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </div>
  );
}

export default function CapitalDashboard() {
  const { data, isLoading } = useQuery<DashData>({
    queryKey: ["/api/capital/dashboard"],
    queryFn: () => fetch("/api/capital/dashboard").then(r => r.json()),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  const empty = !data || (data.totalFunders === 0 && data.totalGrants === 0 && data.totalDocuments === 0);
  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        <Landmark className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">No capital records yet</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Add investors, grants, or documents to begin tracking funding. Start by adding investors in the Investors page or grant programs in Grants.
        </p>
        <div className="flex gap-3 mt-4">
          <Link href="/capital/investors" className="text-sm text-primary hover:underline">Add Investor →</Link>
          <Link href="/capital/grants"    className="text-sm text-primary hover:underline">Add Grant →</Link>
        </div>
      </div>
    );
  }

  const totalWeighted = (data.weightedFunderPipelineCents ?? 0) + (data.weightedGrantPipelineCents ?? 0);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-6 py-5 border-b border-border/40 shrink-0">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Landmark className="w-5 h-5 text-primary" /> Capital Command Center
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Funding pipeline, investors, and grant tracking</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Top stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Committed Capital"         value={fmt(data.committedCents)}                  icon={DollarSign}  color="text-emerald-400" />
          <StatCard label="Soft-Circled"              value={fmt(data.softCircledCents)}                icon={Target}      color="text-amber-400" />
          <StatCard label="Weighted Investor Pipeline" value={fmt(data.weightedFunderPipelineCents)}    icon={TrendingUp}  color="text-primary" />
          <StatCard label="Weighted Grant Pipeline"   value={fmt(data.weightedGrantPipelineCents)}      icon={Zap}         color="text-violet-400" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Weighted Pipeline"  value={fmt(totalWeighted)}              icon={TrendingUp}  sub="investors + grants" color="text-cyan-400" />
          <StatCard label="Active Investors"         value={String(data.totalFunders)}       icon={Users} />
          <StatCard label="Grant Programs"           value={String(data.totalGrants)}        icon={Landmark} />
          <StatCard label="Pending Activities"       value={String(data.pendingActivities)}  icon={Clock} color={data.pendingActivities > 0 ? "text-amber-400" : "text-foreground"} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top Priority Funders */}
          <SectionCard title="Top Priority Investors" icon={Users} linkTo="/capital/investors" linkLabel="All investors">
            {data.topPriorityFunders.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No high-priority investors yet.</p>
            ) : data.topPriorityFunders.map((f: any) => (
              <div key={f.id} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{f.funder_type} · {f.pipeline_stage}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-sm font-semibold text-foreground">{fmt(f.expected_amount_cents)}</p>
                  <p className={`text-xs ${priorityColor(f.priority)}`}>{f.priority}</p>
                </div>
              </div>
            ))}
          </SectionCard>

          {/* Upcoming Grant Deadlines */}
          <SectionCard title="Upcoming Grant Deadlines" icon={Calendar} linkTo="/capital/grants" linkLabel="All grants">
            {data.upcomingDeadlines.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No grant deadlines in the next 30 days.</p>
            ) : data.upcomingDeadlines.map((g: any) => (
              <div key={g.id} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{g.program_name}</p>
                  <p className="text-xs text-muted-foreground">{g.funding_body}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-xs font-semibold text-red-400">{fmtDate(g.deadline)}</p>
                  <p className="text-xs text-muted-foreground">{g.application_status}</p>
                </div>
              </div>
            ))}
          </SectionCard>

          {/* Next Follow-Ups */}
          <SectionCard title="Next Follow-Ups" icon={Clock} linkTo="/capital/investors">
            {data.nextFollowUps.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No upcoming follow-ups scheduled.</p>
            ) : data.nextFollowUps.map((f: any) => (
              <div key={f.id} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{f.pipeline_stage}</p>
                </div>
                <p className="text-xs text-amber-400 shrink-0 ml-3">{fmtDate(f.next_follow_up_at)}</p>
              </div>
            ))}
          </SectionCard>

          {/* Document Blockers */}
          <SectionCard title="Diligence / Document Blockers" icon={AlertTriangle} linkTo="/capital/documents">
            {data.documentBlockers.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No document blockers. All shared docs are ready.</p>
            ) : data.documentBlockers.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{d.document_name}</p>
                  <p className="text-xs text-muted-foreground">{d.document_type} · for {d.funder_name ?? "unknown"}</p>
                </div>
                <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/30 shrink-0 ml-3">
                  {d.status}
                </Badge>
              </div>
            ))}
          </SectionCard>

          {/* Top Priority Grants */}
          <SectionCard title="Top Priority Grants" icon={Landmark} linkTo="/capital/grants" linkLabel="All grants">
            {data.topPriorityGrants.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No active grant programs tracked yet.</p>
            ) : data.topPriorityGrants.map((g: any) => (
              <div key={g.id} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{g.program_name}</p>
                  <p className="text-xs text-muted-foreground">{g.funding_body} · {g.application_status}</p>
                </div>
                <p className="text-sm font-semibold text-primary shrink-0 ml-3">{fmt(g.expected_amount_cents)}</p>
              </div>
            ))}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
