import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Flame, Thermometer, Clock, Wrench, DollarSign, Moon, Minus,
  Sparkles, Loader2, X, Copy, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type FollowUpCategory = "hot" | "warm" | "re-engage" | "technical" | "commercial" | "dormant" | "neutral";

interface EngagementSummary {
  entityType: string;
  entityId: number;
  category: FollowUpCategory;
  whyText: string;
  uniqueOpens: number;
  uniqueClicks: number;
  lastEmailAt: string | null;
  daysSinceLastEmail: number | null;
  ctaClicks: number;
  dismissed: boolean;
}

interface GeneratedFollowUp {
  subject: string;
  body: string;
  category: FollowUpCategory;
  voiceProfileUsed: string | null;
}

// ── Category display helpers ───────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<FollowUpCategory, {
  label: string;
  icon: React.ReactNode;
  badgeClass: string;
  cardClass: string;
}> = {
  hot: {
    label: "Hot — respond now",
    icon: <Flame className="h-3.5 w-3.5" />,
    badgeClass: "bg-orange-500/15 text-orange-400 border-orange-500/25",
    cardClass: "border-orange-500/25 bg-orange-500/5",
  },
  warm: {
    label: "Warm — follow up soon",
    icon: <Thermometer className="h-3.5 w-3.5" />,
    badgeClass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
    cardClass: "border-yellow-500/25 bg-yellow-500/5",
  },
  "re-engage": {
    label: "Re-engage",
    icon: <Clock className="h-3.5 w-3.5" />,
    badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    cardClass: "border-blue-500/25 bg-blue-500/5",
  },
  technical: {
    label: "Technical interest",
    icon: <Wrench className="h-3.5 w-3.5" />,
    badgeClass: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
    cardClass: "border-cyan-500/25 bg-cyan-500/5",
  },
  commercial: {
    label: "Commercial signal",
    icon: <DollarSign className="h-3.5 w-3.5" />,
    badgeClass: "bg-green-500/15 text-green-400 border-green-500/25",
    cardClass: "border-green-500/25 bg-green-500/5",
  },
  dormant: {
    label: "Dormant",
    icon: <Moon className="h-3.5 w-3.5" />,
    badgeClass: "bg-purple-500/15 text-purple-400 border-purple-500/25",
    cardClass: "border-purple-500/25 bg-purple-500/5",
  },
  neutral: {
    label: "Neutral",
    icon: <Minus className="h-3.5 w-3.5" />,
    badgeClass: "bg-muted/50 text-muted-foreground border-border/50",
    cardClass: "border-border/50 bg-muted/10",
  },
};

// ── Generated email preview dialog ───────────────────────────────────────────

function GeneratedEmailDialog({
  result,
  onClose,
}: {
  result: GeneratedFollowUp;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${result.subject}\n\n${result.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  const cfg = CATEGORY_CONFIG[result.category] ?? CATEGORY_CONFIG.neutral;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI-Generated Follow-Up
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn("flex items-center gap-1 text-xs", cfg.badgeClass)}>
              {cfg.icon}{cfg.label}
            </Badge>
            {result.voiceProfileUsed && (
              <span className="text-xs text-muted-foreground">Voice: {result.voiceProfileUsed}</span>
            )}
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wider">Subject</p>
              <p className="text-sm font-medium">{result.subject}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wider">Body</p>
              <Textarea
                readOnly
                value={result.body}
                className="min-h-[200px] text-sm resize-none bg-background"
                data-testid="textarea-generated-email-body"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            <Button
              size="sm"
              onClick={handleCopy}
              data-testid="button-copy-generated-email"
            >
              {copied
                ? <><Check className="h-3.5 w-3.5 mr-1.5" />Copied!</>
                : <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy email</>
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function FollowUpInsightCard({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: number;
}) {
  const { toast } = useToast();
  const [generatedEmail, setGeneratedEmail] = useState<GeneratedFollowUp | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const insightQuery = useQuery<EngagementSummary>({
    queryKey: ["/api/ai-follow-up/insights", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(
        `/api/ai-follow-up/insights?entityType=${entityType}&entityId=${entityId}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load insight");
      return res.json();
    },
    staleTime: 60_000,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-follow-up/generate", {
        entityType,
        entityId,
      });
      return res.json() as Promise<GeneratedFollowUp>;
    },
    onSuccess: (data) => {
      setGeneratedEmail(data);
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/ai-follow-up/dismiss", { entityType, entityId });
    },
    onSuccess: () => setDismissed(true),
    onError: (err: any) => toast({ title: "Dismiss failed", description: err.message, variant: "destructive" }),
  });

  if (dismissed || insightQuery.isLoading || insightQuery.isError) return null;

  const insight = insightQuery.data;
  if (!insight || insight.dismissed || insight.category === "neutral") return null;

  const cfg = CATEGORY_CONFIG[insight.category] ?? CATEGORY_CONFIG.neutral;

  return (
    <>
      <div
        className={cn("rounded-lg border px-4 py-3 space-y-2", cfg.cardClass)}
        data-testid={`follow-up-insight-${entityType}-${entityId}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn("flex items-center gap-1 text-xs shrink-0", cfg.badgeClass)}>
              {cfg.icon}{cfg.label}
            </Badge>
            <p className="text-xs text-muted-foreground">{insight.whyText}</p>
          </div>
          <button
            onClick={() => dismissMutation.mutate()}
            className="text-muted-foreground/50 hover:text-muted-foreground shrink-0 transition-colors"
            aria-label="Dismiss insight"
            data-testid={`button-dismiss-insight-${entityType}-${entityId}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70 flex-wrap">
          {insight.uniqueOpens > 0 && (
            <span>{insight.uniqueOpens} unique open{insight.uniqueOpens !== 1 ? "s" : ""}</span>
          )}
          {insight.uniqueClicks > 0 && (
            <span>{insight.uniqueClicks} link click{insight.uniqueClicks !== 1 ? "s" : ""}</span>
          )}
          {insight.ctaClicks > 0 && (
            <span>{insight.ctaClicks} CTA click{insight.ctaClicks !== 1 ? "s" : ""}</span>
          )}
          {insight.daysSinceLastEmail !== null && (
            <span>{insight.daysSinceLastEmail}d since last email</span>
          )}
        </div>

        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs gap-1.5 text-primary hover:bg-primary/10"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            data-testid={`button-generate-followup-${entityType}-${entityId}`}
          >
            {generateMutation.isPending
              ? <><Loader2 className="h-3 w-3 animate-spin" />Generating…</>
              : <><Sparkles className="h-3 w-3" />Generate follow-up</>
            }
          </Button>
        </div>
      </div>

      {generatedEmail && (
        <GeneratedEmailDialog
          result={generatedEmail}
          onClose={() => setGeneratedEmail(null)}
        />
      )}
    </>
  );
}
