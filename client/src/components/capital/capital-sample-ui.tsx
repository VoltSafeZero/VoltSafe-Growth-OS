import { useState } from "react";
import { Info, X, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const DISMISS_KEY = "capital-sample-banner-dismissed";

/**
 * Dismissible banner shown at the top of Capital pages while the CFO
 * onboarding sample data (capital_cfo_onboarding_seed_v1) is present.
 * Dismissal is local to the browser (localStorage) — it does not delete
 * or hide the underlying sample rows, which stay labeled via `is_sample`.
 */
export function SampleDataBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  return (
    <div
      className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm"
      data-testid="banner-sample-data"
    >
      <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-amber-600 dark:text-amber-400">
          You're looking at sample data
        </p>
        <p className="text-muted-foreground text-xs mt-0.5">
          This Capital module includes demo investors, a demo round, and demo follow-ups so you can
          explore the workflow before adding real data. Sample rows are labeled and never counted in
          production reporting once you archive them — replace them with your own round when you're ready.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* ignore */
          }
          setDismissed(true);
        }}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss sample data banner"
        data-testid="button-dismiss-sample-banner"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Small "Sample" badge for individual rows/cards seeded by the CFO onboarding package. */
export function SampleBadge({ isSample }: { isSample?: boolean | null }) {
  if (!isSample) return null;
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 py-0 h-5 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
      data-testid="badge-sample"
    >
      Sample
    </Badge>
  );
}

/**
 * Centralized help copy for Capital module fields/metrics, so tooltip text
 * lives in one place instead of being scattered across pages.
 */
export const CAPITAL_HELP_COPY: Record<string, string> = {
  target_amount: "The total amount this round is trying to raise.",
  minimum_close_target: "The smallest amount that still lets you close the round and deploy funds.",
  committed_total: "Sum of investor commitments marked 'Committed' — money you can count on.",
  soft_circled_total: "Sum of investor interest marked 'Soft Circled' — verbal interest, not yet legally committed.",
  valuation_cap: "The maximum valuation used to convert this SAFE/note into equity in a future priced round.",
  discount_rate: "The discount this round's investors get versus the price paid by investors in the next priced round.",
  probability: "Our estimate of how likely this investor is to close, based on stage and engagement.",
  runway_months: "How many months of cash remain at the current burn rate before this round needs to close.",
  pipeline_stage: "Where this investor sits in the fundraising pipeline, from first outreach to closed.",
  engagement_score: "A rollup of recent investor activity — deck views, data room opens, replies — showing who's warm.",
  follow_up_due: "The date this follow-up needs action. Overdue follow-ups are flagged so nothing falls through the cracks.",
  data_room_folder: "A grouping of diligence materials (e.g. Financials, Legal) shared with investors during due diligence.",
  is_confidential: "Confidential materials require an explicit investor-portal share — they aren't included by default.",
  weekly_brief: "An auto-generated summary of this week's fundraising activity — new investors, engagement, and follow-ups.",
  board_update: "A formatted update for your board covering round progress, runway, and key risks.",
  cfo_closing_report: "A closing-focused report showing committed vs. target, remaining gap, and follow-ups blocking close.",
};

export function CapitalHelpTip({
  content,
  copyKey,
  className,
}: {
  content?: string;
  copyKey?: keyof typeof CAPITAL_HELP_COPY;
  className?: string;
}) {
  const text = content ?? (copyKey ? CAPITAL_HELP_COPY[copyKey] : undefined);
  if (!text) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={
              "inline-flex items-center justify-center text-muted-foreground/70 hover:text-muted-foreground cursor-help " +
              (className ?? "")
            }
            data-testid={`help-tip-${copyKey ?? "custom"}`}
          >
            <Info className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
