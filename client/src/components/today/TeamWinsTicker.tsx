import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Zap, ChevronLeft, ChevronRight, Trophy, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ─────────────────────────────────────────────────────────────────────

type TeamWin = {
  id: string;
  userName: string;
  userInitials: string;
  department: string | null;
  winType: string;
  shortDescription: string;
  completedAt: string;
  sourceModule: string;
};

type TeamWinsResponse = {
  wins: TeamWin[];
  totalCount: number;
  lastUpdatedAt: string;
  nextRefreshAt: string;
  cached: boolean;
};

// ── Module badge colour map ───────────────────────────────────────────────────

const MODULE_COLORS: Record<string, string> = {
  CRM:      "text-emerald-400 border-emerald-500/30 bg-emerald-500/8",
  Tasks:    "text-blue-400 border-blue-500/30 bg-blue-500/8",
  Projects: "text-violet-400 border-violet-500/30 bg-violet-500/8",
  Support:  "text-amber-400 border-amber-500/30 bg-amber-500/8",
};

const WIN_TYPE_ICON: Record<string, string> = {
  "Closed Deal":      "🏆",
  "Verbal Commit":    "🤝",
  "Lead Converted":   "⚡",
  "Lead Qualified":   "✅",
  "Task Completed":   "✓",
  "Milestone Hit":    "🎯",
};

function moduleBadgeClass(mod: string): string {
  return MODULE_COLORS[mod] ?? "text-muted-foreground border-border/40 bg-muted/20";
}

// ── Avatar chip ───────────────────────────────────────────────────────────────

function Avatar({ initials, name }: { initials: string; name: string }) {
  const hue = (name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) * 37) % 360;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-[11px] font-bold w-7 h-7 shrink-0 select-none"
      style={{ background: `hsl(${hue} 55% 28%)`, color: `hsl(${hue} 75% 75%)`, border: `1px solid hsl(${hue} 55% 40% / 0.4)` }}
      title={name}
    >
      {initials}
    </span>
  );
}

// ── Animated win card (cross-fade + slide) ────────────────────────────────────

function WinCard({ win, visible }: { win: TeamWin; visible: boolean }) {
  const relTime = (() => {
    try { return formatDistanceToNow(new Date(win.completedAt), { addSuffix: true }); }
    catch { return "recently"; }
  })();

  return (
    <div
      className="absolute inset-0 flex items-center gap-3 px-4 transition-all duration-500"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(18px)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {/* Avatar */}
      <Avatar initials={win.userInitials} name={win.userName} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground leading-tight truncate">
            {win.userName}
          </span>
          {win.department && (
            <span className="text-[10px] text-muted-foreground/60 leading-none">
              {win.department}
            </span>
          )}
          <span className="text-[11px] font-medium text-primary/80 leading-none">
            {WIN_TYPE_ICON[win.winType] ?? "✓"} {win.winType}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground leading-snug mt-0.5 truncate" title={win.shortDescription}>
          {win.shortDescription}
        </p>
      </div>

      {/* Right meta */}
      <div className="flex items-center gap-2 shrink-0">
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 py-0 font-medium ${moduleBadgeClass(win.sourceModule)}`}
        >
          {win.sourceModule}
        </Badge>
        <span className="text-[11px] text-muted-foreground/50 whitespace-nowrap hidden sm:block">
          {relTime}
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TeamWinsTicker() {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Compute TTL-aware stale time: respect the cache schedule from the server
  const { data, isLoading, isError, refetch, isFetching } = useQuery<TeamWinsResponse>({
    queryKey: ["/api/today/team-wins"],
    queryFn: async () => {
      const res = await fetch("/api/today/team-wins", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load team wins");
      return res.json();
    },
    staleTime: 25 * 60 * 1000,   // 25-min client stale (server cache is 30/60-min)
    refetchInterval: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const wins = data?.wins ?? [];

  // ── Advance ticker ────────────────────────────────────────────────────────
  const advance = useCallback((dir: 1 | -1 = 1) => {
    setIdx(i => {
      if (wins.length === 0) return 0;
      return (i + dir + wins.length) % wins.length;
    });
  }, [wins.length]);

  // Auto-rotation
  useEffect(() => {
    if (paused || wins.length <= 1) return;
    timerRef.current = setInterval(() => advance(1), 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [paused, wins.length, advance]);

  // Clamp idx if wins array shrinks
  useEffect(() => {
    if (wins.length > 0 && idx >= wins.length) setIdx(0);
  }, [wins.length, idx]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col h-full justify-center gap-2 p-4" data-testid="team-wins-loading">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-4 w-14 rounded" />
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="flex items-center justify-center gap-3 h-full p-4 text-muted-foreground/60" data-testid="team-wins-error">
        <Trophy className="h-4 w-4 shrink-0" />
        <span className="text-xs">Couldn't load team wins.</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] gap-1" onClick={() => refetch()}>
          <RefreshCw className="h-3 w-3" /> Retry
        </Button>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (wins.length === 0) {
    return (
      <div className="flex items-center gap-3 h-full px-4 py-3" data-testid="team-wins-empty">
        <div className="h-8 w-8 rounded-full bg-primary/8 border border-primary/20 flex items-center justify-center shrink-0">
          <Zap className="h-4 w-4 text-primary/60" />
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground/70">
            No team wins logged yet today
          </p>
          <p className="text-[11px] text-muted-foreground/40 mt-0.5">
            Time to put points on the board.
          </p>
        </div>
      </div>
    );
  }

  const win = wins[idx];

  return (
    <div
      className="flex items-center gap-2 h-full px-1 select-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-testid="team-wins-ticker"
    >
      {/* Label */}
      <div className="shrink-0 flex flex-col items-center justify-center gap-0.5 pl-3 pr-2 border-r border-border/40 h-full">
        <Zap className="h-3.5 w-3.5 text-primary" />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-primary/70 whitespace-nowrap leading-none">
          Team<br />Wins
        </span>
      </div>

      {/* Animated card area */}
      <div className="relative flex-1 h-full overflow-hidden">
        {wins.map((w, i) => (
          <WinCard key={w.id} win={w} visible={i === idx} />
        ))}
      </div>

      {/* Navigation */}
      <div className="shrink-0 flex flex-col items-center gap-1 pr-2">
        {/* Dots (max 8 shown) */}
        {wins.length > 1 && (
          <div className="flex items-center gap-[3px] mb-1">
            {wins.slice(0, Math.min(wins.length, 8)).map((_, i) => (
              <button
                key={i}
                onClick={() => { setIdx(i); }}
                className={`rounded-full transition-all duration-200 ${
                  i === (idx % Math.min(wins.length, 8))
                    ? "w-2.5 h-1.5 bg-primary"
                    : "w-1.5 h-1.5 bg-muted-foreground/25 hover:bg-muted-foreground/50"
                }`}
                aria-label={`Go to win ${i + 1}`}
                data-testid={`team-wins-dot-${i}`}
              />
            ))}
            {wins.length > 8 && (
              <span className="text-[9px] text-muted-foreground/40 ml-0.5">+{wins.length - 8}</span>
            )}
          </div>
        )}
        {/* Prev/Next */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => { advance(-1); }}
            className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label="Previous win"
            data-testid="team-wins-prev"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { advance(1); }}
            className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label="Next win"
            data-testid="team-wins-next"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Count + refresh */}
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted-foreground/35 tabular-nums">
            {idx + 1}/{wins.length}
          </span>
          {isFetching && <RefreshCw className="h-2.5 w-2.5 text-muted-foreground/30 animate-spin" />}
        </div>
      </div>
    </div>
  );
}

// ── Widget wrapper (matches ActionWidgetShell pattern for the grid) ────────────

export function TeamWinsTickerWidget() {
  return (
    <div
      className="h-full w-full rounded-xl border bg-card overflow-hidden flex flex-col"
      data-testid="widget-team-wins"
    >
      {/* Header bar with accent gradient */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1.5 border-b border-border/50 shrink-0">
        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Recent Momentum
        </span>
        <span className="text-[10px] text-muted-foreground/35 ml-auto hidden sm:block">
          What the team has knocked out recently
        </span>
      </div>
      {/* Ticker area */}
      <div className="flex-1 min-h-0">
        <TeamWinsTicker />
      </div>
    </div>
  );
}
