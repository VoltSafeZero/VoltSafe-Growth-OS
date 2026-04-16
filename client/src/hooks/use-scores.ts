import { useQuery } from "@tanstack/react-query";
import type { ScoreData } from "@/components/scores/score-badge";

interface ScoredItem extends ScoreData {
  id: number;
  name?: string;
}

function toMap(items: ScoredItem[]): Record<number, ScoreData> {
  const m: Record<number, ScoreData> = {};
  for (const item of items || []) m[item.id] = { score: item.score, band: item.band, label: item.label, reasons: item.reasons, scoredAt: item.scoredAt };
  return m;
}

export function useLeadScores(enabled = true) {
  const q = useQuery<ScoredItem[]>({
    queryKey: ["/api/scores/leads"],
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return { scoreMap: toMap(q.data ?? []), isLoading: q.isLoading };
}

export function useOpportunityScores(enabled = true) {
  const q = useQuery<ScoredItem[]>({
    queryKey: ["/api/scores/opportunities"],
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return { scoreMap: toMap(q.data ?? []), isLoading: q.isLoading };
}

export function useQuoteScores(enabled = true) {
  const q = useQuery<ScoredItem[]>({
    queryKey: ["/api/scores/quotes"],
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return { scoreMap: toMap(q.data ?? []), isLoading: q.isLoading };
}

export function useDeploymentRiskScores(enabled = true) {
  const q = useQuery<ScoredItem[]>({
    queryKey: ["/api/scores/deployments/risk"],
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return { scoreMap: toMap(q.data ?? []), isLoading: q.isLoading };
}

export function useChurnRiskScores(enabled = true) {
  const q = useQuery<ScoredItem[]>({
    queryKey: ["/api/scores/accounts/churn"],
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return { scoreMap: toMap(q.data ?? []), isLoading: q.isLoading };
}

export function useHotList(limit = 15) {
  return useQuery<(ScoredItem & { type: string; actionHint: string; link: string })[]>({
    queryKey: ["/api/scores/hot-list", limit],
    queryFn: () => fetch(`/api/scores/hot-list?limit=${limit}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export interface CommandCenterWidgets {
  hottestLeads: any[];
  closeOpps: any[];
  urgentQuotes: any[];
  deploymentRisks: any[];
  churnRisks: any[];
  expansionReady: any[];
}

export function useCommandCenterWidgets(enabled = true) {
  const q = useQuery<CommandCenterWidgets>({
    queryKey: ["/api/scores/command-center-widgets"],
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return {
    widgets: q.data,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
