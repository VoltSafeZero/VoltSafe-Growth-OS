import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Sale } from "@shared/schema";

export function RecentSales({ sales }: { sales: Sale[] }) {
  return (
    <Card className="col-span-4 lg:col-span-2 xl:col-span-1 border-border/50 shadow-sm bg-card/50 backdrop-blur-sm hover-elevate transition-all duration-300">
      <CardHeader>
        <CardTitle className="text-lg">Recent Sales</CardTitle>
        <CardDescription>
          You made {sales.length} sales this month.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {sales.map((sale) => (
            <div key={sale.id} className="flex items-center hover:bg-secondary/40 -mx-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer group">
              <Avatar className="h-10 w-10 border border-border/50 group-hover:border-primary/30 transition-colors">
                <AvatarImage src={sale.avatarUrl} alt={sale.name} />
                <AvatarFallback className="bg-primary/10 text-primary">{sale.name.substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="ml-4 space-y-1 overflow-hidden">
                <p className="text-sm font-medium leading-none truncate">{sale.name}</p>
                <p className="text-xs text-muted-foreground truncate">{sale.email}</p>
              </div>
              <div className="ml-auto font-medium text-sm">+{sale.amount}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function RecentSalesSkeleton() {
  return (
    <Card className="col-span-4 lg:col-span-2 xl:col-span-1 border-border/50 shadow-sm bg-card/50">
      <CardHeader>
        <div className="h-6 w-32 bg-muted animate-pulse rounded mb-2"></div>
        <div className="h-4 w-48 bg-muted animate-pulse rounded"></div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center">
              <div className="h-10 w-10 rounded-full bg-muted animate-pulse"></div>
              <div className="ml-4 space-y-2 flex-1">
                <div className="h-4 w-32 bg-muted animate-pulse rounded"></div>
                <div className="h-3 w-40 bg-muted animate-pulse rounded"></div>
              </div>
              <div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto"></div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
