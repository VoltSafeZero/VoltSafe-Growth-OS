import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CalendarDays, Loader2, Mail, Mic, RefreshCw, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { setPendingCompose } from "@/lib/compose-handoff";

const LS_CALENDLY_KEY = "voltsafe:calendlyUrl";
const LS_VOICE_PROFILE_KEY = "voltsafe:voiceProfileId";

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

interface VoiceProfile {
  id: number;
  name: string;
  profileType: "global" | "user";
  isDefault: boolean;
}

interface Props {
  entityType: EntityType;
  entityId: number;
  entityName?: string;
  onClose: () => void;
}

async function fetchSuggestedEmail(
  entityType: EntityType,
  entityId: number,
  voiceProfileId?: number | null
): Promise<SuggestedEmail> {
  const body: Record<string, unknown> = {};
  if (voiceProfileId) body.voice_profile_id = voiceProfileId;
  const res = await fetch(`/api/crm/ai-summary/${entityType}/${entityId}/suggest-next-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

/** Insert a scheduling link before the closing sign-off of the email body. */
function insertSchedulingLink(body: string, url: string): string {
  const signoffPattern = /^(best regards?|kind regards?|warm regards?|sincerely|thanks?(?:\s+again)?|cheers|regards?),?\s*$/im;
  const match = body.match(signoffPattern);
  const block = `\n📅 Schedule a call: ${url}\n\n`;

  if (match && match.index !== undefined) {
    const before = body.slice(0, match.index);
    const after = body.slice(match.index);
    return before.trimEnd() + "\n" + block + after;
  }

  return body.trimEnd() + "\n" + block;
}

/** Shared sessionStorage key — kept as a secondary fallback for hard page reloads. */
export const PENDING_COMPOSE_KEY = "voltsafe:pendingCompose";

export function SuggestedNextEmailModal({ entityType, entityId, entityName, onClose }: Props) {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestedEmail | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ── Voice profile selection ───────────────────────────────────────────────
  const [selectedVoiceId, setSelectedVoiceId] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem(LS_VOICE_PROFILE_KEY);
      return stored ? parseInt(stored) : null;
    } catch { return null; }
  });

  const { data: voiceProfiles = [] } = useQuery<VoiceProfile[]>({
    queryKey: ["/api/ai/voice-profiles"],
  });

  const { data: aiSettings } = useQuery<{ defaultVoiceProfileId: number | null }>({
    queryKey: ["/api/ai/settings"],
  });

  // Resolve the effective voice profile id: explicit selection > user default > global default
  const effectiveVoiceId = selectedVoiceId
    ?? aiSettings?.defaultVoiceProfileId
    ?? voiceProfiles.find(p => p.isDefault && p.profileType === "global")?.id
    ?? null;

  function handleVoiceChange(val: string) {
    const id = val === "default" ? null : parseInt(val);
    setSelectedVoiceId(id);
    try {
      if (id) localStorage.setItem(LS_VOICE_PROFILE_KEY, String(id));
      else localStorage.removeItem(LS_VOICE_PROFILE_KEY);
    } catch { /* storage blocked */ }
  }

  const selectedVoiceName = effectiveVoiceId
    ? voiceProfiles.find(p => p.id === effectiveVoiceId)?.name
    : null;

  // ── Scheduling link state ─────────────────────────────────────────────────
  const [includeLink, setIncludeLink] = useState(false);
  const [calendlyUrl, setCalendlyUrl] = useState(() => {
    try { return localStorage.getItem(LS_CALENDLY_KEY) ?? ""; } catch { return ""; }
  });
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      if (calendlyUrl.trim()) localStorage.setItem(LS_CALENDLY_KEY, calendlyUrl.trim());
    } catch { /* storage blocked */ }
  }, [calendlyUrl]);

  useEffect(() => {
    if (includeLink && !calendlyUrl.trim()) {
      setTimeout(() => urlInputRef.current?.focus(), 50);
    }
  }, [includeLink]);

  // ── Fetch suggestion on mount ─────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    setSuggestion(null);
    fetchSuggestedEmail(entityType, entityId, effectiveVoiceId)
      .then(data => {
        if (!mounted) return;
        setSuggestion(data);
        setLoading(false);
      })
      .catch(err => {
        if (!mounted) return;
        setError(err.message || "Failed");
        setLoading(false);
      });
    return () => { mounted = false; };
  // Re-fetch whenever the effective voice profile changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveVoiceId]);

  async function handleRegenerate() {
    setLoading(true);
    setError(null);
    setSuggestion(null);
    try {
      const data = await fetchSuggestedEmail(entityType, entityId, effectiveVoiceId);
      setSuggestion(data);
    } catch (err: any) {
      setError(err.message || "Failed to regenerate");
    } finally {
      setLoading(false);
    }
  }

  async function handleContinue() {
    if (!suggestion) return;
    setIsSaving(true);

    const finalBody =
      includeLink && calendlyUrl.trim()
        ? insertSchedulingLink(suggestion.body, calendlyUrl.trim())
        : suggestion.body;

    const payload = {
      to: suggestion.to,
      cc: suggestion.cc,
      subject: suggestion.subject,
      body: finalBody,
    };

    try {
      const res = await fetch("/api/gmail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ to: payload.to, subject: payload.subject, body: payload.body }),
      });

      if (res.ok) {
        const draft = await res.json();
        setPendingCompose(payload);
        try { sessionStorage.setItem(PENDING_COMPOSE_KEY, JSON.stringify(payload)); } catch { /* iframe may block storage */ }
        onClose();
        setLocation(`/gmail?draft=${draft.id}&compose=1`);
        return;
      }
    } catch { /* fall through to handoff */ }

    setPendingCompose(payload);
    try { sessionStorage.setItem(PENDING_COMPOSE_KEY, JSON.stringify(payload)); } catch { /* iframe may block */ }

    setIsSaving(false);
    onClose();
    setLocation("/gmail");
  }

  const urlMissing = includeLink && !calendlyUrl.trim();

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

        {/* Voice profile selector */}
        {voiceProfiles.length > 0 && (
          <div className="flex items-center gap-2 py-1.5 border-b border-border/40 -mt-1">
            <Mic className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground shrink-0">Voice:</span>
            <Select
              value={selectedVoiceId ? String(selectedVoiceId) : "default"}
              onValueChange={handleVoiceChange}
            >
              <SelectTrigger
                className="h-7 text-xs border-none bg-transparent shadow-none focus:ring-0 focus:ring-offset-0 px-1 w-auto min-w-[140px]"
                data-testid="select-voice-profile"
              >
                <SelectValue placeholder="Select voice…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default" data-testid="voice-option-default">
                  Default VoltSafe
                </SelectItem>
                {voiceProfiles.map(p => (
                  <SelectItem key={p.id} value={String(p.id)} data-testid={`voice-option-${p.id}`}>
                    {p.name}
                    {p.profileType === "global" && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">(built-in)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedVoiceName && !loading && (
              <span className="text-[10px] text-primary/70 truncate">
                Using {selectedVoiceName} voice
              </span>
            )}
          </div>
        )}

        <div className="space-y-4 mt-1">
          {loading && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Generating email suggestion{selectedVoiceName ? ` in ${selectedVoiceName} voice` : ""}…
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

              {/* Temporal context */}
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
                  {includeLink && calendlyUrl.trim()
                    ? insertSchedulingLink(suggestion.body, calendlyUrl.trim())
                    : suggestion.body}
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground/60 pt-1">
                This is a suggestion only. You can edit before sending. VoltSafe never sends emails automatically.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="pt-3 border-t border-border/50 mt-2 space-y-2.5">
          {/* Scheduling link row — visible when suggestion is loaded */}
          {!loading && suggestion && (
            <div className="flex items-center gap-2 flex-wrap">
              <label
                className="flex items-center gap-2 cursor-pointer select-none group"
                data-testid="label-include-scheduling-link"
              >
                <input
                  type="checkbox"
                  checked={includeLink}
                  onChange={(e) => setIncludeLink(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                  data-testid="checkbox-include-scheduling-link"
                />
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                  Include my scheduling link
                </span>
              </label>
              {includeLink && (
                <input
                  ref={urlInputRef}
                  type="url"
                  placeholder="Paste your Calendly URL…"
                  value={calendlyUrl}
                  onChange={(e) => setCalendlyUrl(e.target.value)}
                  className={cn(
                    "flex-1 min-w-[200px] h-7 px-2.5 rounded-md text-xs bg-secondary/40 border transition-colors outline-none",
                    urlMissing
                      ? "border-amber-500/50 placeholder:text-amber-500/60 focus:border-amber-400"
                      : "border-border/50 placeholder:text-muted-foreground/50 focus:border-primary/60"
                  )}
                  data-testid="input-calendly-url"
                />
              )}
              {urlMissing && (
                <span className="text-[10px] text-amber-400/80">Paste your link to enable</span>
              )}
            </div>
          )}

          {/* Button row */}
          <div className="flex items-center justify-between">
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
                disabled={loading || !suggestion || !suggestion.body || isSaving || urlMissing}
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
