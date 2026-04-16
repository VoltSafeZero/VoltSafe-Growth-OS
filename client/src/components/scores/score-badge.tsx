import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { InfoIcon } from "lucide-react";

export type ScoreBand = "low" | "medium" | "high" | "critical";

export interface ScoreData {
  score: number;
  band: ScoreBand;
  label: string;
  reasons: string[];
  scoredAt?: string;
}

const BAND_CONFIG: Record<ScoreBand, { bg: string; text: string; border: string; dot: string; pill: string }> = {
  low:      { bg: "bg-slate-100 dark:bg-slate-800",    text: "text-slate-500 dark:text-slate-400",    border: "border-slate-200 dark:border-slate-700",    dot: "bg-slate-400",    pill: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  medium:   { bg: "bg-amber-50 dark:bg-amber-950/30",  text: "text-amber-600 dark:text-amber-400",    border: "border-amber-200 dark:border-amber-800",    dot: "bg-amber-400",    pill: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  high:     { bg: "bg-orange-50 dark:bg-orange-950/30",text: "text-orange-600 dark:text-orange-400",  border: "border-orange-200 dark:border-orange-800",  dot: "bg-orange-500",   pill: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  critical: { bg: "bg-red-50 dark:bg-red-950/30",      text: "text-red-600 dark:text-red-500",        border: "border-red-200 dark:border-red-800",        dot: "bg-red-500",      pill: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

const BAND_LABEL: Record<ScoreBand, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

interface ScoreBadgeProps {
  score: ScoreData;
  variant?: "pill" | "compact" | "ring" | "inline";
  showReasons?: boolean;
  className?: string;
}

export function ScoreBadge({ score, variant = "pill", showReasons = true, className }: ScoreBadgeProps) {
  const cfg = BAND_CONFIG[score.band];

  const badge = (() => {
    if (variant === "compact") {
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded",
            cfg.pill,
            className
          )}
          data-testid={`score-badge-${score.label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full inline-block", cfg.dot)} />
          {score.score}
        </span>
      );
    }

    if (variant === "ring") {
      const radius = 16;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference - (score.score / 100) * circumference;
      const ringColor = { low: "#94a3b8", medium: "#f59e0b", high: "#f97316", critical: "#ef4444" }[score.band];
      return (
        <div className={cn("flex flex-col items-center gap-1", className)}
          data-testid={`score-ring-${score.label.toLowerCase().replace(/\s+/g, "-")}`}>
          <svg width="44" height="44" viewBox="0 0 44 44">
            <circle cx="22" cy="22" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="4" />
            <circle
              cx="22" cy="22" r={radius} fill="none"
              stroke={ringColor} strokeWidth="4"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 22 22)"
            />
            <text x="22" y="27" textAnchor="middle" fontSize="11" fontWeight="600" fill={ringColor}>{score.score}</text>
          </svg>
          <span className={cn("text-xs font-medium", cfg.text)}>{BAND_LABEL[score.band]}</span>
        </div>
      );
    }

    if (variant === "inline") {
      return (
        <span
          className={cn("inline-flex items-center gap-1.5 text-xs", className)}
          data-testid={`score-inline-${score.label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
          <span className={cfg.text}>{score.label}: <strong>{score.score}</strong></span>
          <span className={cn("text-xs px-1 rounded", cfg.pill)}>{BAND_LABEL[score.band]}</span>
        </span>
      );
    }

    return (
      <Badge
        variant="outline"
        className={cn(
          "text-xs font-medium gap-1 border cursor-default",
          cfg.bg, cfg.text, cfg.border,
          className
        )}
        data-testid={`score-badge-${score.label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span className={cn("w-1.5 h-1.5 rounded-full inline-block", cfg.dot)} />
        {BAND_LABEL[score.band]} · {score.score}
      </Badge>
    );
  })();

  if (!showReasons || score.reasons.length === 0) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-help">
            {badge}
            <InfoIcon className="w-3 h-3 text-muted-foreground/50 hidden group-hover:inline" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs p-3">
          <p className="font-semibold text-sm mb-2">{score.label} Score: {score.score}/100</p>
          <p className="text-xs text-muted-foreground mb-1.5">Score drivers:</p>
          <ul className="space-y-1">
            {score.reasons.map((r, i) => (
              <li key={i} className="text-xs flex items-start gap-1.5">
                <span className="text-muted-foreground mt-0.5">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
          {score.scoredAt && (
            <p className="text-xs text-muted-foreground/60 mt-2 border-t pt-1">
              Scored {new Date(score.scoredAt).toLocaleString()}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ScorePanel({ score, className }: { score: ScoreData; className?: string }) {
  const cfg = BAND_CONFIG[score.band];
  return (
    <div
      className={cn("rounded-lg border p-3 space-y-2", cfg.bg, cfg.border, className)}
      data-testid={`score-panel-${score.label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{score.label}</span>
        <div className="flex items-center gap-2">
          <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", cfg.pill)}>{BAND_LABEL[score.band]}</span>
          <span className={cn("text-lg font-bold tabular-nums", cfg.text)}>{score.score}<span className="text-xs font-normal text-muted-foreground">/100</span></span>
        </div>
      </div>
      <ul className="space-y-1 pt-1 border-t border-current/10">
        {score.reasons.map((r, i) => (
          <li key={i} className="text-xs flex items-start gap-1.5 text-muted-foreground">
            <span className="mt-0.5">•</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
