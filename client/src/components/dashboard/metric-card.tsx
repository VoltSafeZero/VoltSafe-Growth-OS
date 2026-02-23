import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Users, CreditCard, Activity, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { Metric } from "@shared/schema";

const iconMap: Record<string, React.ElementType> = {
  "dollar-sign": DollarSign,
  users: Users,
  "credit-card": CreditCard,
  activity: Activity,
};

export function MetricCard({ metric }: { metric: Metric }) {
  const Icon = iconMap[metric.icon] || Activity;
  const isPositive = metric.change.startsWith("+");

  return (
    <Card className="hover-elevate border-border/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/50 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {metric.title}
        </CardTitle>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight mb-1">{metric.value}</div>
        <div className="flex items-center text-sm">
          <span className={`flex items-center font-medium ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
            {isPositive ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
            {metric.change}
          </span>
          <span className="text-muted-foreground ml-2 truncate">
            {metric.description}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricCardSkeleton() {
  return (
    <Card className="border-border/50 shadow-sm bg-card/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <div className="h-4 w-24 bg-muted animate-pulse rounded"></div>
        <div className="h-8 w-8 bg-muted animate-pulse rounded-lg"></div>
      </CardHeader>
      <CardContent>
        <div className="h-8 w-32 bg-muted animate-pulse rounded mb-2"></div>
        <div className="h-4 w-48 bg-muted animate-pulse rounded"></div>
      </CardContent>
    </Card>
  );
}
