import { MetricCard, MetricCardSkeleton } from "@/components/dashboard/metric-card";
import { OverviewChart, OverviewChartSkeleton } from "@/components/dashboard/overview-chart";
import { RecentSales, RecentSalesSkeleton } from "@/components/dashboard/recent-sales";
import { useMetrics, useChartData, useSales } from "@/hooks/use-dashboard";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export default function Dashboard() {
  const { data: metrics, isLoading: isLoadingMetrics } = useMetrics();
  const { data: chartData, isLoading: isLoadingChart } = useChartData();
  const { data: sales, isLoading: isLoadingSales } = useSales();

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8 pt-6 max-w-7xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Here's an overview of your business today.</p>
        </div>
        <Button className="hover-elevate active-elevate-2 bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30">
          <Download className="mr-2 h-4 w-4" />
          Download Report
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {isLoadingMetrics 
          ? [...Array(4)].map((_, i) => <MetricCardSkeleton key={i} />)
          : metrics?.map((metric) => <MetricCard key={metric.id} metric={metric} />)
        }
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
        {isLoadingChart 
          ? <OverviewChartSkeleton /> 
          : <OverviewChart data={chartData || []} />
        }
        
        {isLoadingSales 
          ? <RecentSalesSkeleton /> 
          : <RecentSales sales={sales || []} />
        }
      </div>
    </div>
  );
}
