import { useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Loader2, Mail, RefreshCw, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

type EntityType = "lead" | "account" | "contact";

interface SuggestedEmail {
  to: string;
  cc: string;
  subject: string;
  body: string;
  reason: string;
  warning?: string;
}

interface Props {
  entityType: EntityType;
  entityId: number;
  entityName?: string;
  onClose: () => void;
}

async function fetchSuggestedEmail(entityType: EntityType, entityId: number): Promise<SuggestedEmail> {
  const res = await fetch(`/api/crm/ai-summary/${entityType}/${entityId}/suggest-next-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export function SuggestedNextEmailModal({ entityType, entityId, entityName, onClose }: Props) {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestedEmail | null>(null);

  // Fetch on mount
  useState(() => {
    let mounted = true;
    fetchSuggestedEmail(entityType, entityId)
      .then(data => { if (mounted) { setSuggestion(data); setLoading(false); } })
      .catch(err => { if (mounted) { setError(err.message || "Failed"); setLoading(false); } });
    return () => { mounted = false; };
  });

  async function handleRegenerate() {
    setLoading(true);
    setError(null);
    setSuggestion(null);
    try {
      const data = await fetchSuggestedEmail(entityType, entityId);
      setSuggestion(data);
    } catch (err: any) {
      setError(err.message || "Failed to regenerate");
    } finally {
      setLoading(false);
    }
  }

  function handleContinue() {
    if (!suggestion) return;
    // Dispatch custom event so gmail-inbox can pick it up
    window.dispatchEvent(new CustomEvent("voltsafe:openCompose", {
      detail: {
        to: suggestion.to,
        cc: suggestion.cc,
        subject: suggestion.subject,
        body: suggestion.body,
      },
    }));
    onClose();
    setLocation("/gmail");
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-primary" />
            Suggested Next Email
            {entityName && <span className="font-normal text-muted-foreground">— {entityName}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {loading && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Generating email suggestion…
              </div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-2 rounded-md bg-red-500/8 border border-red-500/20 p-3">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">Failed to generate suggestion</p>
                <p className="text-xs text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          )}

          {!loading && suggestion && (
            <div className="space-y-3">
              {suggestion.warning && (
                <div className="flex items-start gap-2 rounded-md bg-amber-500/8 border border-amber-500/20 p-3">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">{suggestion.warning}</p>
                </div>
              )}

              {/* Reason */}
              <div className="rounded-md bg-primary/5 border border-primary/15 px-3 py-2.5">
                <p className="text-[11px] uppercase font-semibold tracking-wider text-primary/70 mb-1">Why this email</p>
                <p className="text-xs text-foreground/80">{suggestion.reason}</p>
              </div>

              {/* Fields */}
              <div className="space-y-2.5">
                <FieldRow label="To" value={suggestion.to} />
                {suggestion.cc && <FieldRow label="CC" value={suggestion.cc} />}
                <FieldRow label="Subject" value={suggestion.subject} />
              </div>

              {/* Body */}
              <div>
                <p className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground mb-1.5">Body</p>
                <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                  {suggestion.body}
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground/60 pt-1">
                This is a suggestion only. You can edit before sending. VoltSafe never sends emails automatically.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-border/50 mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-cancel-suggested-email"
          >
            <X className="h-3.5 w-3.5 mr-1.5" />Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={loading}
              data-testid="button-regenerate-suggested-email"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
              Regenerate
            </Button>
            <Button
              size="sm"
              onClick={handleContinue}
              disabled={loading || !suggestion || !suggestion.body}
              className="bg-primary hover:bg-primary/90"
              data-testid="button-continue-suggested-email"
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Continue in Mail
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground w-12 shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-foreground/90 flex-1 break-all">{value || <span className="text-muted-foreground italic">Not specified</span>}</span>
    </div>
  );
}
