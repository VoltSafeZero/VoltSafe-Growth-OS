import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sparkles, RefreshCw, Mail, ChevronDown, ChevronUp,
  AlertTriangle, Users, Clock, TrendingUp, ArrowRight,
  CheckCircle2, Loader2, PenLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { setPendingCompose, type CrmReturnContext } from "@/lib/compose-handoff";
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

interface SelectedKeyPerson {
  name: string;
  email: string;
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
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState(true);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [selectedKeyPeople, setSelectedKeyPeople] = useState<SelectedKeyPerson[]>([]);

  // Read-only fetch — never auto-triggers generation on page open.
  // refetchInterval only activates when a real background job is running (status === 'generating').
  const { data: summary, isLoading } = useQuery<AiSummaryRow | null>({
    queryKey: ["/api/crm/ai-summary", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/crm/ai-summary/${entityType}/${entityId}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.json();
    },
    // Only poll when DB says a background job is actively running
    refetchInterval: (query) =>
      query.state.data?.status === "generating" ? 3000 : false,
    staleTime: 60_000,
  });

  // Manual regenerate only — never called automatically
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

  const s = summary;
  // Content requires at least one non-empty field in summaryJson — an empty {} does not count.
  const hasContent = !!(
    s?.summaryJson &&
    (s.status === "success" || s.status === "stale" || s.status === "generating" || s.status === "failed") &&
    (s.summaryJson.executiveSummary ||
      (s.summaryJson.keyPeople && s.summaryJson.keyPeople.length > 0) ||
      s.summaryJson.currentStatus ||
      (s.summaryJson.opportunitiesAndRisks && s.summaryJson.opportunitiesAndRisks.length > 0) ||
      (s.summaryJson.suggestedNextSteps && s.summaryJson.suggestedNextSteps.length > 0) ||
      (s.summaryJson.relevantHistory && s.summaryJson.relevantHistory.length > 0))
  );
  const json: AiSummaryJson = s?.summaryJson || {};

  // Active generation means the DB itself says 'generating' (a real background job)
  const isActivelyGenerating = s?.status === "generating";

  // ── Key People selection helpers ─────────────────────────────────────────
  function toggleKeyPerson(person: SelectedKeyPerson) {
    setSelectedKeyPeople(prev => {
      const exists = prev.some(p => p.email === person.email);
      if (exists) return prev.filter(p => p.email !== person.email);
      return [...prev, person];
    });
  }

  function getComposeRecipients() {
    return {
      to: selectedKeyPeople.length > 0 ? selectedKeyPeople[0].email : "",
      cc: selectedKeyPeople.length > 1
        ? selectedKeyPeople.slice(1).map(p => p.email).join(", ")
        : "",
    };
  }

  function buildCrmReturnContext(): CrmReturnContext {
    const pathMap: Record<EntityType, string> = {
      lead: `/opportunities?selected=${entityId}`,
      account: `/accounts?selected=${entityId}`,
      contact: `/contacts?selected=${entityId}`,
    };
    return {
      source: "crm",
      recordType: entityType,
      recordId: entityId,
      recordName: entityName,
      returnPath: pathMap[entityType],
    };
  }

  function handleComposeNewEmail() {
    const { to, cc } = getComposeRecipients();
    setPendingCompose({ to, cc, subject: "", body: "", crmReturnContext: buildCrmReturnContext() });
    setLocation("/gmail");
  }

  const { to: recipientTo, cc: recipientCc } = getComposeRecipients();

  const recipientHint = selectedKeyPeople.length === 0
    ? null
    : selectedKeyPeople.length === 1
      ? "1 recipient selected"
      : `${selectedKeyPeople.length} recipients: 1 To, ${selectedKeyPeople.length - 1} Cc`;

  return (
    <div className="border-t border-border/50 pt-4" data-testid="ai-summary-section">
      <Card className="border border-primary/20 bg-primary/3 overflow-hidden">
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <CardTitle className="text-sm font-semibold text-foreground">AI Summary</CardTitle>
              {/* Status badges — only based on real DB state, not local mutation state */}
              {isActivelyGenerating ? (
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
              {/* Regenerate button — always shown once a row exists (any status) */}
              {s !== null && s !== undefined && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] text-muted-foreground hover:text-foreground px-2"
                  onClick={() => generateMutation.mutate(true)}
                  disabled={generateMutation.isPending || isActivelyGenerating}
                  data-testid="button-regenerate-summary"
                >
                  <RefreshCw className={cn("h-3 w-3 mr-1", generateMutation.isPending && "animate-spin")} />
                  Regenerate
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
            {/* Loading skeleton while fetching saved summary */}
            {isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            )}

            {/* No summary exists yet — show static placeholder, no auto-generation */}
            {!isLoading && (s === null || s?.status === "pending") && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <Sparkles className="h-8 w-8 text-primary/40" />
                <div>
                  <p className="text-sm text-muted-foreground">No AI summary yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">
                    Summaries are generated overnight or when CRM data changes.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generateMutation.mutate(true)}
                  disabled={generateMutation.isPending}
                  data-testid="button-generate-summary"
                >
                  {generateMutation.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Queued…</>
                    : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate Now</>
                  }
                </Button>
              </div>
            )}

            {/* Real background job running (DB status = generating) — no content yet */}
            {!isLoading && isActivelyGenerating && !hasContent && (
              <div className="flex items-center gap-3 py-3 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <div className="text-sm">Generating AI summary — this takes a few seconds…</div>
              </div>
            )}

            {/* Failed state — no previous content */}
            {!isLoading && s?.status === "failed" && !hasContent && (
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

            {/* Summary content — shown whenever we have saved JSON, regardless of current status */}
            {!isLoading && hasContent && json && (
              <div className="space-y-3 text-sm">
                {/* Subtle banner when failed but old content exists */}
                {s?.status === "failed" && s.errorMessage && (
                  <div className="flex items-center gap-2 rounded-md bg-red-500/8 border border-red-500/20 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    <p className="text-[11px] text-red-400">Last update failed — showing previous summary</p>
                  </div>
                )}

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

                {/* Key People + Email action buttons */}
                <div data-testid="key-people-email-actions">
                  {json.keyPeople && json.keyPeople.length > 0 && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">Key People</p>
                    </div>
                  )}

                  <div className={cn(
                    "flex gap-3",
                    json.keyPeople && json.keyPeople.length > 0
                      ? "flex-col sm:flex-row sm:items-start"
                      : "justify-end"
                  )}>
                    {/* Checkbox list */}
                    {json.keyPeople && json.keyPeople.length > 0 && (
                      <div className="flex-1 space-y-1.5" data-testid="key-people-list">
                        {json.keyPeople.map((p, i) => {
                          const hasEmail = !!(p.email && p.email.trim());
                          const isSelected = selectedKeyPeople.some(s => s.email === p.email);
                          return (
                            <label
                              key={i}
                              className={cn(
                                "flex items-center gap-2 text-xs select-none",
                                hasEmail ? "cursor-pointer group" : "cursor-not-allowed opacity-50"
                              )}
                              title={!hasEmail ? "No email address available" : undefined}
                              data-testid={`key-person-row-${i}`}
                            >
                              <Checkbox
                                checked={isSelected}
                                disabled={!hasEmail}
                                onCheckedChange={() => {
                                  if (!hasEmail || !p.email) return;
                                  toggleKeyPerson({ name: p.name, email: p.email });
                                }}
                                className="h-3 w-3 rounded-[2px] border-muted-foreground/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary shrink-0"
                                aria-label={hasEmail ? `Select ${p.name} for email` : "No email address available"}
                                data-testid={`checkbox-key-person-${i}`}
                              />
                              <span className="font-medium text-foreground/90">{p.name}</span>
                              {p.title && <span className="text-muted-foreground">· {p.title}</span>}
                              {p.isDecisionMaker && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-primary/30 text-primary">DM</Badge>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Action buttons column */}
                    <div className="flex flex-col gap-1.5 sm:items-end shrink-0" data-testid="email-action-buttons">
                      {recipientHint && (
                        <p className="text-[10px] text-muted-foreground/60 sm:text-right" data-testid="text-recipient-hint">
                          {recipientHint}
                        </p>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px] px-2 border-border/50 hover:border-primary/40"
                        onClick={handleComposeNewEmail}
                        data-testid="button-compose-new-email-from-summary"
                      >
                        <PenLine className="h-3 w-3 mr-1" />Compose New Email
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] text-primary hover:text-primary/80 px-2"
                        onClick={() => setEmailModalOpen(true)}
                        data-testid="button-suggest-next-email"
                      >
                        <Mail className="h-3 w-3 mr-1" />Suggested Email
                      </Button>
                    </div>
                  </div>
                </div>

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

                {/* Relevant History */}
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
          initialTo={recipientTo || undefined}
          initialCc={recipientCc || undefined}
          onClose={() => setEmailModalOpen(false)}
          crmReturnContext={buildCrmReturnContext()}
        />
      )}
    </div>
  );
}
