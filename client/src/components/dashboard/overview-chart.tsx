import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { ChartData } from "@shared/schema";

export function OverviewChart({ data }: { data: ChartData[] }) {
  return (
    <Card className="col-span-4 lg:col-span-3 border-border/50 shadow-sm bg-card/50 backdrop-blur-sm flex flex-col hover-elevate transition-all duration-300">
      <CardHeader>
        <CardTitle className="text-lg">Overview</CardTitle>
        <CardDescription>Monthly revenue breakdown for the current year</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 min-h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis 
              dataKey="month" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              dy={10}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              tickFormatter={(value) => `$${value}`}
            />
            <Tooltip 
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
              contentStyle={{ 
                backgroundColor: 'hsl(var(--popover))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
              }}
              itemStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
              labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
              formatter={(value: number) => [`$${value}`, 'Revenue']}
            />
            <Bar 
              dataKey="revenue" 
              fill="hsl(var(--primary))" 
              radius={[4, 4, 0, 0]} 
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function OverviewChartSkeleton() {
  return (
    <Card className="col-span-4 lg:col-span-3 border-border/50 shadow-sm bg-card/50">
      <CardHeader>
        <div className="h-6 w-32 bg-muted animate-pulse rounded mb-2"></div>
        <div className="h-4 w-64 bg-muted animate-pulse rounded"></div>
      </CardHeader>
      <CardContent className="min-h-[350px] flex items-end justify-between gap-2 pt-10">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="w-full bg-muted animate-pulse rounded-t-md" style={{ height: `${Math.random() * 60 + 20}%` }}></div>
        ))}
      </CardContent>
    </Card>
  );
}
