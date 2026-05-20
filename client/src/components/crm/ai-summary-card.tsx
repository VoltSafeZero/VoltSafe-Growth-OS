import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, RefreshCw, Mail, ChevronDown, ChevronUp,
  AlertTriangle, Users, Clock, TrendingUp, ArrowRight,
  CheckCircle2, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SuggestedNextEmailModal } from "./suggested-next-email-modal";

type EntityType = "lead" | "account" | "contact";

interface AiSummaryJson {
  executiveSummary?: string;
  keyPeople?: Array<{ name: string; role?: string; title?: string; email?: string; isDecisionMaker?: boolean }>;
  relevantHistory?: Array<{ event: string; date?: string; significance?: string }>;
  currentStatus?: string;
  opportunitiesAndRisks?: Array<{ type: "opportunity" | "risk"; description: string }>;
  suggestedNextSteps?: string[];
}

interface AiSummaryRow {
  id: number;
  entityType: EntityType;
  entityId: number;
  summaryJson: AiSummaryJson | null;
  summaryText: string | null;
  status: "pending" | "generating" | "success" | "failed" | "stale";
  generatedAt: string | null;
  staleAt: string | null;
  retryCount: number;
  errorMessage: string | null;
}

interface Props {
  entityType: EntityType;
  entityId: number;
  entityName?: string;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

export function AiSummaryCard({ entityType, entityId, entityName }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [emailModalOpen, setEmailModalOpen] = useState(false);

  const { data: summary, isLoading } = useQuery<AiSummaryRow | null>({
    queryKey: ["/api/crm/ai-summary", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/crm/ai-summary/${entityType}/${entityId}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: (data) =>
      data?.status === "generating" ? 3000 : false,
    staleTime: 60_000,
  });

  const generateMutation = useMutation({
    mutationFn: async (force = false) => {
      const res = await apiRequest("POST", `/api/crm/ai-summary/${entityType}/${entityId}/regenerate`, { force });
      if (!res.ok) throw new Error("Generation failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/ai-summary", entityType, entityId] });
    },
  });

  // Auto-trigger generation when no summary exists
  useEffect(() => {
    if (!isLoading && (summary === null || summary?.status === "pending")) {
      const timer = setTimeout(() => {
        generateMutation.mutate(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, summary?.status, summary]);

  const s = summary;
  const hasContent = s?.status === "success" || s?.status === "stale";
  const json: AiSummaryJson = s?.summaryJson || {};

  return (
    <div className="border-t border-border/50 pt-4" data-testid="ai-summary-section">
      <Card className="border border-primary/20 bg-primary/3 overflow-hidden">
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <CardTitle className="text-sm font-semibold text-foreground">AI Summary</CardTitle>
              {s?.status === "generating" || generateMutation.isPending ? (
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary animate-pulse">
                  <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />Generating…
                </Badge>
              ) : s?.status === "stale" ? (
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">Updating…</Badge>
              ) : s?.status === "failed" ? (
                <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-400">Failed</Badge>
              ) : s?.status === "success" ? (
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-1" />Fresh
                </Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              {(hasContent || s?.status === "failed") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] text-muted-foreground hover:text-foreground px-2"
                  onClick={() => generateMutation.mutate(true)}
                  disabled={generateMutation.isPending || s?.status === "generating"}
                  data-testid="button-regenerate-summary"
                >
                  <RefreshCw className={cn("h-3 w-3 mr-1", generateMutation.isPending && "animate-spin")} />
                  Regenerate
                </Button>
              )}
              {hasContent && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] text-primary hover:text-primary/80 px-2"
                  onClick={() => setEmailModalOpen(true)}
                  data-testid="button-suggest-next-email"
                >
                  <Mail className="h-3 w-3 mr-1" />Suggested Email
                </Button>
              )}
              <button
                onClick={() => setExpanded(v => !v)}
                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-toggle-ai-summary"
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="px-4 pb-4 pt-1 space-y-3">
            {/* Loading skeleton */}
            {isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            )}

            {/* Pending / auto-generating */}
            {!isLoading && (s === null || s?.status === "pending") && !generateMutation.isPending && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <Sparkles className="h-8 w-8 text-primary/40" />
                <div>
                  <p className="text-sm text-muted-foreground">No AI summary yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">Initialising…</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generateMutation.mutate(true)}
                  data-testid="button-generate-summary"
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate Summary
                </Button>
              </div>
            )}

            {/* Generating spinner */}
            {!isLoading && (generateMutation.isPending || s?.status === "generating") && (
              <div className="flex items-center gap-3 py-3 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <div className="text-sm">Generating AI summary — this takes a few seconds…</div>
              </div>
            )}

            {/* Failed state */}
            {!isLoading && s?.status === "failed" && !generateMutation.isPending && (
              <div className="flex items-start gap-2 rounded-md bg-red-500/8 border border-red-500/20 p-3">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-red-400">Summary generation failed</p>
                  {s.errorMessage && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{s.errorMessage}</p>
                  )}
                </div>
              </div>
            )}

            {/* Summary content */}
            {!isLoading && hasContent && !generateMutation.isPending && json && (
              <div className="space-y-3 text-sm">
                {/* Executive Summary */}
                {json.executiveSummary && (
                  <div>
                    <p className="text-foreground/90 text-sm leading-relaxed">{json.executiveSummary}</p>
                  </div>
                )}

                {/* Current Status */}
                {json.currentStatus && (
                  <div className="rounded-md bg-primary/5 border border-primary/10 px-3 py-2">
                    <p className="text-[11px] uppercase font-semibold tracking-wider text-primary/70 mb-1">Current Status</p>
                    <p className="text-xs text-foreground/80">{json.currentStatus}</p>
                  </div>
                )}

                {/* Key People */}
                {json.keyPeople && json.keyPeople.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">Key People</p>
                    </div>
                    <div className="space-y-1">
                      {json.keyPeople.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="font-medium text-foreground/90">{p.name}</span>
                          {p.title && <span className="text-muted-foreground">· {p.title}</span>}
                          {p.isDecisionMaker && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-primary/30 text-primary">DM</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Opportunities & Risks */}
                {json.opportunitiesAndRisks && json.opportunitiesAndRisks.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">Opportunities & Risks</p>
                    </div>
                    <div className="space-y-1">
                      {json.opportunitiesAndRisks.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <span className={cn(
                            "shrink-0 mt-0.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase",
                            item.type === "opportunity"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-amber-500/15 text-amber-400"
                          )}>
                            {item.type === "opportunity" ? "OPP" : "RISK"}
                          </span>
                          <span className="text-foreground/80">{item.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested Next Steps */}
                {json.suggestedNextSteps && json.suggestedNextSteps.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">Suggested Next Steps</p>
                    </div>
                    <div className="space-y-1">
                      {json.suggestedNextSteps.map((step, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                          <span className="text-primary shrink-0">→</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Relevant History (collapsed by default — show top 2) */}
                {json.relevantHistory && json.relevantHistory.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">Key History</p>
                    </div>
                    <div className="space-y-1">
                      {json.relevantHistory.slice(0, 4).map((h, i) => (
                        <div key={i} className="text-xs text-foreground/80">
                          {h.date && <span className="text-muted-foreground mr-1.5">{h.date}</span>}
                          <span>{h.event}</span>
                          {h.significance && <span className="text-muted-foreground"> — {h.significance}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer */}
                {s?.generatedAt && (
                  <div className="flex items-center justify-between pt-1 border-t border-border/30">
                    <p className="text-[10px] text-muted-foreground/60">
                      Generated from notes, emails, documents, contacts &amp; CRM activity
                    </p>
                    <p className="text-[10px] text-muted-foreground/50">{fmtDate(s.generatedAt)}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {emailModalOpen && (
        <SuggestedNextEmailModal
          entityType={entityType}
          entityId={entityId}
          entityName={entityName}
          onClose={() => setEmailModalOpen(false)}
        />
      )}
    </div>
  );
}
