import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, TrendingDown, Minus, ChevronRight, MoreHorizontal,
  CheckSquare, StickyNote, ExternalLink, ShieldOff, Info,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ScoredWidgetItem {
  id: number;
  name: string;
  score: number;
  band: string;
  label: string;
  confidence: number;
  confidenceLabel: string;
  reasons: string[];
  modelName: string;
  scoredAt?: string;
  delta: number | null;
  previousScore: number | null;
  previousBand: string | null;
  suggestedAction: string;
  link: string;
  amount?: number;
  arr?: number;
  total?: number;
  stage?: string;
  customerName?: string;
}

function bandColor(band: string): string {
  switch (band) {
    case "critical": return "text-red-400";
    case "high":     return "text-orange-400";
    case "medium":   return "text-amber-400";
    default:         return "text-blue-400";
  }
}

function bandBg(band: string): string {
  switch (band) {
    case "critical": return "bg-red-500/10 border-red-500/30";
    case "high":     return "bg-orange-500/10 border-orange-500/30";
    case "medium":   return "bg-amber-500/10 border-amber-500/30";
    default:         return "bg-blue-500/10 border-blue-500/30";
  }
}

function ScorePill({ score, band }: { score: number; band: string }) {
  return (
    <div className={`flex items-center justify-center rounded-full h-9 w-9 shrink-0 text-sm font-bold border ${bandBg(band)} ${bandColor(band)}`}
      data-testid="score-pill">
      {score}
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      data-testid="score-delta"
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1 py-0.5 rounded ${up ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"}`}>
      {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {up ? "+" : ""}{delta}
    </span>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.min(Math.max(confidence, 0), 100);
  const color = pct >= 70 ? "bg-emerald-400" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1" title={`Confidence: ${pct}%`}>
      <div className="h-1 w-10 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] text-muted-foreground">{pct}%</span>
    </div>
  );
}

function isHurting(reason: string): boolean {
  const lower = reason.toLowerCase();
  return (
    lower.includes("no ") || lower.includes("not ") || lower.includes("overdue") ||
    lower.includes("stale") || lower.includes("expired") || lower.includes("missing") ||
    lower.includes("blocked") || lower.includes("risk") || lower.includes("low health") ||
    lower.includes("unowned") || lower.includes("no owner") || lower.includes("no close") ||
    lower.includes("no contact") || lower.includes("no email") || lower.includes("no deal") ||
    lower.includes("no next step") || lower.includes("no activity") || lower.includes("inactive")
  );
}

function ExplainPopover({ item, accentColor }: { item: ScoredWidgetItem; accentColor: string }) {
  const helping = item.reasons.filter(r => !isHurting(r));
  const hurting = item.reasons.filter(r => isHurting(r));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          data-testid={`explain-btn-${item.id}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={e => e.stopPropagation()}>
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 text-sm" side="left" align="start">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm truncate max-w-[160px]">{item.name}</p>
            <Badge variant="outline" className={`text-[10px] ${bandColor(item.band)}`}>{item.label}</Badge>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Score: <span className={`font-bold ${bandColor(item.band)}`}>{item.score}/100</span></span>
            <span>·</span>
            <ConfidenceBar confidence={item.confidence} />
          </div>

          {item.delta !== null && item.delta !== 0 && (
            <p className={`text-xs font-medium ${item.delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
              {item.delta > 0 ? "↑" : "↓"} Score moved {item.delta > 0 ? "+" : ""}{item.delta} pts
              {item.previousBand && item.previousBand !== item.band
                ? ` (was ${item.previousBand})` : ""}
            </p>
          )}

          {helping.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide mb-1">Helping</p>
              <ul className="space-y-0.5">
                {helping.map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                    <span className="text-emerald-400 mt-0.5 shrink-0">+</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hurting.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-1">Hurting</p>
              <ul className="space-y-0.5">
                {hurting.map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                    <span className="text-red-400 mt-0.5 shrink-0">−</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-1 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground capitalize">
              Model: <span className="text-foreground">{item.modelName?.replace(/_/g, " ") ?? "—"}</span>
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QuickActions({ item, objectType }: { item: ScoredWidgetItem; objectType: string }) {
  const { toast } = useToast();

  const createTask = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tasks", {
      title: `Follow up: ${item.name}`,
      linkedObjectType: objectType,
      linkedObjectId: item.id,
      priority: item.band === "critical" ? "high" : item.band === "high" ? "high" : "medium",
      status: "pending",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task created", description: `Follow-up task for ${item.name}` });
    },
    onError: () => toast({ title: "Failed to create task", variant: "destructive" }),
  });

  const logNote = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notes", {
      content: `Score signal (${item.label}): ${item.suggestedAction}`,
      linkedObjectType: objectType,
      linkedObjectId: item.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      toast({ title: "Note logged", description: `Score note added to ${item.name}` });
    },
    onError: () => toast({ title: "Failed to log note", variant: "destructive" }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-testid={`quick-actions-${item.id}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={e => e.stopPropagation()}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          data-testid={`action-task-${item.id}`}
          onClick={e => { e.stopPropagation(); createTask.mutate(); }}>
          <CheckSquare className="h-3.5 w-3.5 mr-2 text-blue-400" />
          Create follow-up task
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid={`action-note-${item.id}`}
          onClick={e => { e.stopPropagation(); logNote.mutate(); }}>
          <StickyNote className="h-3.5 w-3.5 mr-2 text-amber-400" />
          Log score note
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={item.link}>
            <ExternalLink className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            Open record
          </Link>
        </DropdownMenuItem>
        {(item.band === "critical" || item.band === "high") && (
          <DropdownMenuItem
            data-testid={`action-ack-${item.id}`}
            onClick={e => {
              e.stopPropagation();
              toast({ title: "Risk acknowledged", description: `${item.name} marked as reviewed` });
            }}>
            <ShieldOff className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            Acknowledge risk
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function fmt$(n?: number | null): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

function ScoredRow({ item, objectType, accentColor }: {
  item: ScoredWidgetItem; objectType: string; accentColor: string;
}) {
  const sub = item.arr ? `ARR ${fmt$(item.arr)}` :
    item.amount ? fmt$(item.amount) :
    item.total ? fmt$(item.total) :
    item.stage ?? item.customerName ?? "";

  const topReason = item.reasons?.[0];

  return (
    <div
      data-testid={`score-row-${item.id}`}
      className="flex items-center gap-2 py-1.5 rounded hover:bg-muted/30 -mx-1 px-1 transition-colors group">
      <ScorePill score={item.score} band={item.band} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link href={item.link}>
            <span className="text-sm font-medium truncate max-w-[140px] hover:underline cursor-pointer">{item.name}</span>
          </Link>
          <DeltaBadge delta={item.delta} />
        </div>
        {topReason && (
          <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{topReason}</p>
        )}
        {sub && !topReason && (
          <p className="text-[11px] text-muted-foreground">{sub}</p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <ExplainPopover item={item} accentColor={accentColor} />
        <QuickActions item={item} objectType={objectType} />
      </div>
    </div>
  );
}

export function ScoreListWidget({
  title,
  icon: Icon,
  items,
  objectType,
  accentColor = "text-violet-400",
  link,
  compact,
  isLoading,
  emptyMessage = "No scored items",
}: {
  title: string;
  icon: React.ElementType;
  items: ScoredWidgetItem[];
  objectType: string;
  accentColor?: string;
  link?: string;
  compact?: boolean;
  isLoading?: boolean;
  emptyMessage?: string;
}) {
  return (
    <Card className="border border-border/50 bg-card/80" data-testid={`score-widget-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className={`${compact ? "pb-1 pt-3 px-4" : "pb-2 pt-4 px-4"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${accentColor}`} />
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
      <CardContent className={`${compact ? "px-4 pb-3 pt-0" : "px-4 pb-4 pt-0"}`}>
        {isLoading ? (
          <div className="space-y-2 mt-1">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 rounded" />)}
          </div>
        ) : items.length > 0 ? (
          <div className="space-y-0 mt-1" data-testid={`score-list-${title.toLowerCase().replace(/\s+/g, "-")}`}>
            {items.map(item => (
              <ScoredRow key={item.id} item={item} objectType={objectType} accentColor={accentColor} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}
