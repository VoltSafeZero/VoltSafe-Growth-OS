import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPlus, TrendingUp, LifeBuoy, FileText, AlertTriangle, Clock } from "lucide-react";
import { OverviewChart } from "@/components/dashboard/overview-chart";
import { RecentSales } from "@/components/dashboard/recent-sales";
import type { Activity, ChartData, Sale } from "@shared/schema";

type DashboardSummary = {
  totalLeads: number;
  activeDeals: number;
  openTickets: number;
  pendingQuotes: number;
  overdueTasks: number;
  recentActivities: Activity[];
};

export default function Dashboard() {
  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary"],
  });

  const { data: chartData, isLoading: chartLoading } = useQuery<ChartData[]>({
    queryKey: ["/api/chart-data"],
  });

  const { data: salesData, isLoading: salesLoading } = useQuery<Sale[]>({
    queryKey: ["/api/sales"],
  });

  const cards = [
    { title: "New Leads", value: summary?.totalLeads ?? 0, icon: UserPlus, description: "Leads awaiting follow-up", color: "text-blue-400" },
    { title: "Active Deals", value: summary?.activeDeals ?? 0, icon: TrendingUp, description: "In-progress opportunities", color: "text-green-400" },
    { title: "Open Tickets", value: summary?.openTickets ?? 0, icon: LifeBuoy, description: "Support tickets open", color: "text-orange-400" },
    { title: "Draft Quotes", value: summary?.pendingQuotes ?? 0, icon: FileText, description: "Quotes needing follow-up", color: "text-purple-400" },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6" data-testid="dashboard-page">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">VoltSafe Cortex operations overview.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryLoading ? (
          [...Array(4)].map((_, i) => (
            <Card key={i} className="border-border/50 bg-card/50">
              <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-16 mb-1" /><Skeleton className="h-3 w-32" /></CardContent>
            </Card>
          ))
        ) : (
          cards.map((card) => (
            <Card key={card.title} className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid={`card-metric-${card.title.toLowerCase().replace(/\s/g, '-')}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <card.icon className={`w-4 h-4 ${card.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight mb-1">{card.value}</div>
                <p className="text-xs text-muted-foreground">{card.description}</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {summary && summary.overdueTasks > 0 && (
        <Card className="border-orange-500/30 bg-orange-500/5" data-testid="card-overdue-tasks">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-orange-400" />
            <div>
              <p className="font-medium text-orange-400">{summary.overdueTasks} overdue task{summary.overdueTasks > 1 ? "s" : ""}</p>
              <p className="text-sm text-muted-foreground">Tasks past their due date need attention.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-7">
        <div className="lg:col-span-4">
          {chartLoading || !chartData ? (
            <Card className="border-border/50 bg-card/50">
              <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
              <CardContent><Skeleton className="h-[350px]" /></CardContent>
            </Card>
          ) : (
            <OverviewChart data={chartData} />
          )}
        </div>

        <div className="lg:col-span-3">
          {summary?.recentActivities && summary.recentActivities.length > 0 ? (
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {summary.recentActivities.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-3 p-2 rounded-lg" data-testid={`activity-${activity.id}`}>
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Clock className="w-3 h-3 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm">{activity.summary}</p>
                        <p className="text-xs text-muted-foreground">{new Date(activity.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : salesLoading || !salesData ? (
            <Card className="border-border/50 bg-card/50">
              <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
              <CardContent>
                <div className="space-y-6">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              </CardContent>
            </Card>
          ) : (
            <RecentSales sales={salesData} />
          )}
        </div>
      </div>
    </div>
  );
}
