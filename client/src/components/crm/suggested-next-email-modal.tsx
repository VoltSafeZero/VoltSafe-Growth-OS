import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Loader2, Mail, RefreshCw, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { setPendingCompose } from "@/lib/compose-handoff";

type EntityType = "lead" | "account" | "contact";

interface SuggestedEmail {
  to: string;
  cc: string;
  subject: string;
  body: string;
  reason: string;
  warning?: string;
  detectedContext?: string;
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

/** Shared sessionStorage key — kept as a secondary fallback for hard page reloads. */
export const PENDING_COMPOSE_KEY = "voltsafe:pendingCompose";

export function SuggestedNextEmailModal({ entityType, entityId, entityName, onClose }: Props) {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestedEmail | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ── Fetch suggestion on mount (useEffect, not useState) ──────────────────
  useEffect(() => {
    let mounted = true;
    console.log("[SuggestedNextEmailModal] fetching suggestion", { entityType, entityId });
    fetchSuggestedEmail(entityType, entityId)
      .then(data => {
        if (!mounted) return;
        console.log("[SuggestedNextEmailModal] suggestion loaded", { to: data.to, subject: data.subject, bodyLen: data.body?.length });
        setSuggestion(data);
        setLoading(false);
      })
      .catch(err => {
        if (!mounted) return;
        console.error("[SuggestedNextEmailModal] suggestion fetch failed", err);
        setError(err.message || "Failed");
        setLoading(false);
      });
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function handleContinue() {
    if (!suggestion) {
      console.warn("[SuggestedNextEmailModal] handleContinue called with no suggestion — abort");
      return;
    }
    console.log("[SuggestedNextEmailModal] handleContinue — start", { to: suggestion.to, subject: suggestion.subject, bodyLen: suggestion.body?.length });
    setIsSaving(true);

    const payload = {
      to: suggestion.to,
      cc: suggestion.cc,
      subject: suggestion.subject,
      body: suggestion.body,
    };

    // ── Primary path: create a real Gmail draft ─────────────────────────────
    try {
      console.log("[SuggestedNextEmailModal] POST /api/gmail/drafts — start");
      const res = await fetch("/api/gmail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ to: payload.to, subject: payload.subject, body: payload.body }),
      });
      console.log("[SuggestedNextEmailModal] POST /api/gmail/drafts — status", res.status);

      if (res.ok) {
        const draft = await res.json();
        console.log("[SuggestedNextEmailModal] draft created, id=", draft.id, "— navigating to /gmail?draft=...&compose=1");
        // Write module-level handoff AND sessionStorage so both inbox paths work.
        setPendingCompose(payload);
        try { sessionStorage.setItem(PENDING_COMPOSE_KEY, JSON.stringify(payload)); } catch { /* iframe may block storage */ }
        onClose();
        setLocation(`/gmail?draft=${draft.id}&compose=1`);
        return;
      }

      const errBody = await res.json().catch(() => ({}));
      console.warn("[SuggestedNextEmailModal] draft POST failed", res.status, errBody);
    } catch (fetchErr) {
      console.error("[SuggestedNextEmailModal] draft POST threw", fetchErr);
    }

    // ── Fallback: module-level handoff (works in all iframe/storage contexts) ─
    console.log("[SuggestedNextEmailModal] using compose-handoff fallback");
    setPendingCompose(payload);

    // Also write sessionStorage as a secondary fallback for hard page reloads.
    try { sessionStorage.setItem(PENDING_COMPOSE_KEY, JSON.stringify(payload)); } catch { /* iframe may block */ }

    setIsSaving(false);
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

              {/* Temporal context (deterministic, pre-LLM classification) */}
              {suggestion.detectedContext && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" />
                  {suggestion.detectedContext}
                </div>
              )}

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
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-cancel-suggested-email"
          >
            <X className="h-3.5 w-3.5 mr-1.5" />Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={loading || isSaving}
              data-testid="button-regenerate-suggested-email"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
              Regenerate
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleContinue}
              disabled={loading || !suggestion || !suggestion.body || isSaving}
              className="bg-primary hover:bg-primary/90"
              data-testid="button-continue-suggested-email"
            >
              {isSaving
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Opening…</>
                : <><Send className="h-3.5 w-3.5 mr-1.5" />Continue in Mail</>
              }
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
