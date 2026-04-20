import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";

export function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

export function RoleWidgetCard({
  title, icon: Icon, children, accent, link, compact,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  accent?: string;
  link?: string;
  compact?: boolean;
}) {
  return (
    <Card
      className="border border-border/50 bg-card/80 h-full flex flex-col"
      data-testid={`widget-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <CardHeader className={`${compact ? "pb-1 pt-3 px-4" : "pb-2 pt-4 px-4"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${accent ?? "text-violet-400"}`} />
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </CardTitle>
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
      <CardContent
        className={`${compact ? "px-4 pb-3 pt-0" : "px-4 pb-4 pt-0"} flex-1 min-h-0 overflow-y-auto`}
      >
        {children}
      </CardContent>
    </Card>
  );
}

export function RoleRow({
  title, sub, badge, link, color,
}: {
  title: string;
  sub?: string;
  badge?: string;
  link?: string;
  color?: string;
}) {
  const inner = (
    <div className="flex items-center gap-2 py-1.5 rounded hover:bg-muted/30 -mx-1 px-1 transition-colors cursor-pointer">
      <div className={`h-2 w-2 rounded-full shrink-0 ${color ?? "bg-violet-400"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
      {badge && (
        <Badge variant="outline" className="text-[10px] shrink-0">
          {badge}
        </Badge>
      )}
    </div>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}
