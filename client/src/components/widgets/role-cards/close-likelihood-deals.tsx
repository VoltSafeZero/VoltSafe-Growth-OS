import { Target } from "lucide-react";
import { useCommandCenterWidgets } from "@/hooks/use-scores";
import { ScoreListWidget } from "@/components/scores/score-widget";

export function CloseLikelihoodDealsWidget({ compact }: { compact?: boolean } = {}) {
  const { widgets, isLoading } = useCommandCenterWidgets(true);
  return (
    <ScoreListWidget
      title="Close-Likelihood Deals"
      icon={Target}
      items={widgets?.closeOpps ?? []}
      objectType="opportunity"
      accentColor="text-violet-400"
      link="/pipeline"
      compact={compact}
      isLoading={isLoading}
      emptyMessage="No open opportunities to score"
    />
  );
}
