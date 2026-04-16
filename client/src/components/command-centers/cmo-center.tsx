import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, BarChart3, MapPin, TrendingUp, ChevronRight, Zap,
} from "lucide-react";

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

function WidgetCard({ title, icon: Icon, children, link, compact }: {
  title: string; icon: React.ElementType; children: React.ReactNode; link?: string; compact?: boolean;
}) {
  return (
    <Card className="border border-border/50 bg-card/80" data-testid={`widget-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className={`${compact ? "pb-1 pt-3 px-4" : "pb-2 pt-4 px-4"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-orange-400" />
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
          </div>
          {link && (
            <Link href={link}>
              <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                View all <ChevronRight className="h-3 w-3" />
              </button>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className={`${compact ? "px-4 pb-3 pt-0" : "px-4 pb-4 pt-0"}`}>{children}</CardContent>
    </Card>
  );
}

function SourceRow({ source, leads, pipeline, conversion }: {
  source: string; leads?: number; pipeline?: number; conversion?: number;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate capitalize">{source.replace(/_/g, " ")}</p>
      </div>
      {leads != null && <Badge variant="outline" className="text-[10px] shrink-0">{leads} leads</Badge>}
      {pipeline != null && <span className="text-xs text-emerald-400 shrink-0">{fmt$(pipeline)}</span>}
      {conversion != null && <span className="text-xs text-blue-400 shrink-0">{conversion}%</span>}
    </div>
  );
}

export function CMOCommandCenter({ visible, compact }: { visible: Record<string, boolean>; compact?: boolean }) {
  const sourceAttr  = useQuery<any>({ queryKey: ["/api/analytics/source-attribution/summary"] });
  const sourceBreak = useQuery<any>({ queryKey: ["/api/analytics/source-attribution"] });
  const geoWhite    = useQuery<any>({ queryKey: ["/api/analytics/geo/whitespace"] });
  const forecast    = useQuery<any>({ queryKey: ["/api/pipeline/forecast"] });

  if (sourceAttr.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2" data-testid="cmo-center-loading">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }

  const sa = sourceAttr.data;
  const sb = sourceBreak.data;
  const gw = geoWhite.data;
  const fd = forecast.data;
  const sources: any[] = sb?.sources ?? sb ?? [];

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="cmo-command-center">

      {visible.lead_volume && (
        <WidgetCard title="Lead Volume" icon={Users} link="/opportunities" compact={compact}>
          {sa ? (
            <div className="space-y-1 mt-1">
              <div className="flex gap-4">
                <div className="text-center">
                  <p className="text-xl font-bold text-orange-400">{sa.totalLeads ?? sa.total_leads ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Total Leads</p>
                </div>
                <div className="h-8 w-px bg-border/50" />
                <div className="text-center">
                  <p className="text-xl font-bold text-emerald-400">{sa.convertedLeads ?? sa.converted_leads ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Converted</p>
                </div>
                <div className="h-8 w-px bg-border/50" />
                <div className="text-center">
                  <p className="text-xl font-bold text-blue-400">{sa.conversionRate ?? sa.conversion_rate != null ? `${Math.round((sa.conversionRate ?? sa.conversion_rate) * 100)}%` : "—"}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Conv Rate</p>
                </div>
              </div>
              {sa.topSource && (
                <p className="text-xs text-muted-foreground mt-2">
                  Top channel: <span className="font-semibold capitalize text-foreground">{String(sa.topSource).replace(/_/g, " ")}</span>
                </p>
              )}
            </div>
          ) : <p className="text-sm text-muted-foreground mt-1">No lead data</p>}
        </WidgetCard>
      )}

      {visible.source_attribution && (
        <WidgetCard title="Source Attribution" icon={BarChart3} link="/analytics/source-attribution" compact={compact}>
          <div className="space-y-0 mt-1 divide-y divide-border/30">
            {sources.length > 0 ? sources.slice(0, 5).map((s: any, i: number) => (
              <SourceRow
                key={i}
                source={s.source ?? s.leadSource ?? "Unknown"}
                leads={s.leadCount ?? s.count}
                pipeline={s.totalPipelineValue ?? s.pipeline_value}
                conversion={s.conversionRate != null ? Math.round(s.conversionRate * 100) : undefined}
              />
            )) : <p className="text-sm text-muted-foreground">No attribution data</p>}
          </div>
        </WidgetCard>
      )}

      {visible.territory_whitespace && (
        <WidgetCard title="Territory Whitespace" icon={MapPin} link="/geography" compact={compact}>
          <div className="space-y-1.5 mt-1">
            {gw ? (
              Array.isArray(gw.regions ?? gw) && (gw.regions ?? gw).length > 0 ? (
                (gw.regions ?? gw).slice(0, 5).map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.region ?? r.name ?? r.territory ?? "Region"}</p>
                      {r.unlinkedLeads > 0 && (
                        <p className="text-xs text-muted-foreground">{r.unlinkedLeads} unlinked leads</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0 ml-2">
                      {r.accountCount ?? r.accounts ?? 0} accts
                    </Badge>
                  </div>
                ))
              ) : <p className="text-xs text-muted-foreground">No whitespace data available</p>
            ) : <p className="text-sm text-muted-foreground">No geo data</p>}
          </div>
        </WidgetCard>
      )}

      {visible.pipeline_by_source && (
        <WidgetCard title="Pipeline by Source" icon={TrendingUp} link="/pipeline" compact={compact}>
          <div className="space-y-0 mt-1 divide-y divide-border/30">
            {sources.length > 0 ? sources.filter((s: any) => (s.totalPipelineValue ?? s.pipeline_value) > 0).slice(0, 5).map((s: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5">
                <p className="text-sm font-medium capitalize truncate flex-1">{(s.source ?? s.leadSource ?? "Unknown").replace(/_/g, " ")}</p>
                <span className="text-sm font-bold text-emerald-400 shrink-0 ml-2">
                  {fmt$(s.totalPipelineValue ?? s.pipeline_value ?? 0)}
                </span>
              </div>
            )) : (
              fd?.summary?.totalValue ? (
                <div className="py-1.5">
                  <p className="text-sm text-muted-foreground">Total pipeline</p>
                  <p className="text-base font-bold text-emerald-400">{fmt$(fd.summary.totalValue)}</p>
                </div>
              ) : <p className="text-sm text-muted-foreground">No pipeline-by-source data</p>
            )}
          </div>
        </WidgetCard>
      )}

      {visible.conversion_by_source && (
        <WidgetCard title="Conversion by Source" icon={Zap} link="/analytics/source-attribution" compact={compact}>
          <div className="space-y-0 mt-1 divide-y divide-border/30">
            {sources.filter((s: any) => s.conversionRate != null).slice(0, 5).map((s: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5">
                <p className="text-sm font-medium capitalize truncate flex-1">{(s.source ?? "Unknown").replace(/_/g, " ")}</p>
                <span className={`text-sm font-bold shrink-0 ml-2 ${s.conversionRate >= 0.3 ? "text-emerald-400" : s.conversionRate >= 0.1 ? "text-amber-400" : "text-red-400"}`}>
                  {Math.round(s.conversionRate * 100)}%
                </span>
              </div>
            ))}
            {sources.filter((s: any) => s.conversionRate != null).length === 0 && (
              <p className="text-sm text-muted-foreground py-1">No conversion data by source</p>
            )}
          </div>
        </WidgetCard>
      )}
    </div>
  );
}
