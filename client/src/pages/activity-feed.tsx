import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Activity, Mail, CalendarDays, CheckSquare, MessageSquare,
  AlertTriangle, RefreshCw, Search, Building2, User, TrendingUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type FeedItem = {
  feed_type: "note" | "email" | "meeting" | "task" | "activity";
  id: number;
  summary: string;
  actor: string;
  created_at: string;
  linked_object_type: string | null;
  linked_object_id: number | null;
  linked_object_name: string | null;
  extra: string | null;
};

const TYPE_CONFIG = {
  note: { label: "Note", icon: MessageSquare, color: "bg-blue-500/10 text-blue-400", badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  email: { label: "Email", icon: Mail, color: "bg-violet-500/10 text-violet-400", badgeClass: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  meeting: { label: "Meeting", icon: CalendarDays, color: "bg-emerald-500/10 text-emerald-400", badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  task: { label: "Task", icon: CheckSquare, color: "bg-amber-500/10 text-amber-400", badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  activity: { label: "Activity", icon: Activity, color: "bg-slate-500/10 text-slate-400", badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
};

const ENTITY_LINKS: Record<string, (id: number) => string> = {
  contact: (id) => `/contacts/${id}`,
  account: (id) => `/accounts/${id}`,
  opportunity: (id) => `/opportunities/${id}`,
};

function EntityLink({ type, id, name }: { type: string | null; id: number | null; name: string | null }) {
  if (!type || !id || !name) return null;
  const href = ENTITY_LINKS[type]?.(id);
  const Icon = type === "contact" ? User : type === "account" ? Building2 : TrendingUp;
  if (!href) return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" /> {name}
    </span>
  );
  return (
    <Link href={href}>
      <div className="flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
        <Icon className="h-3 w-3" /> {name}
      </div>
    </Link>
  );
}

export default function ActivityFeedPage() {
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data = [], isLoading, isError, refetch } = useQuery<FeedItem[]>({
    queryKey: ["/api/activity-feed"],
    queryFn: () => fetch("/api/activity-feed?limit=100").then(r => r.json()),
    refetchInterval: 2 * 60_000,
  });

  const filtered = data.filter(item => {
    if (filterType !== "all" && item.feed_type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return (item.summary?.toLowerCase().includes(q) ||
              item.actor?.toLowerCase().includes(q) ||
              item.linked_object_name?.toLowerCase().includes(q));
    }
    return true;
  });

  const counts = Object.keys(TYPE_CONFIG).reduce((acc, t) => {
    acc[t] = data.filter(i => i.feed_type === t).length;
    return acc;
  }, {} as Record<string, number>);

  if (isError) return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm text-muted-foreground">Failed to load activity feed.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" /> Try again
      </Button>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5" data-testid="activity-feed-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" /> Activity Feed
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">All notes, emails, meetings, and tasks across your CRM</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 self-start" data-testid="button-refresh-feed">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search activity..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9" data-testid="input-search-activity" />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <Button variant={filterType === "all" ? "secondary" : "ghost"} size="sm"
            onClick={() => setFilterType("all")} className="h-8 text-xs" data-testid="filter-all">
            All <span className="ml-1 text-muted-foreground">{data.length}</span>
          </Button>
          {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
            <Button key={type} variant={filterType === type ? "secondary" : "ghost"} size="sm"
              onClick={() => setFilterType(type)} className="h-8 text-xs gap-1" data-testid={`filter-${type}`}>
              <cfg.icon className="h-3 w-3" />
              {cfg.label}
              {counts[type] > 0 && <span className="ml-0.5 text-muted-foreground">{counts[type]}</span>}
            </Button>
          ))}
        </div>
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{search || filterType !== "all" ? "No matching activity" : "No activity recorded yet"}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((item, idx) => {
            const cfg = TYPE_CONFIG[item.feed_type] ?? TYPE_CONFIG.activity;
            const Icon = cfg.icon;
            return (
              <Card key={`${item.feed_type}-${item.id}-${idx}`} className="border-border/40 hover:border-border/70 transition-colors"
                data-testid={`feed-item-${item.feed_type}-${item.id}`}>
                <CardContent className="p-3 flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <p className="text-sm flex-1 min-w-0">
                        {item.feed_type === "email" ? (
                          <span className="font-medium">{item.summary || "(no subject)"}</span>
                        ) : (
                          <span className={item.feed_type === "note" ? "text-foreground/80" : "font-medium"}>
                            {item.summary}
                          </span>
                        )}
                      </p>
                      <Badge variant="outline" className={`text-[10px] h-5 px-1.5 flex-shrink-0 border ${cfg.badgeClass}`}>
                        {cfg.label}
                        {item.feed_type === "email" && item.extra && ` · ${item.extra}`}
                        {item.feed_type === "task" && item.extra && ` · ${item.extra}`}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {item.actor && (
                        <span className="text-xs text-muted-foreground">{item.actor}</span>
                      )}
                      <EntityLink type={item.linked_object_type} id={item.linked_object_id} name={item.linked_object_name} />
                      {item.created_at && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
