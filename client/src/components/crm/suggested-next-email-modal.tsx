import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronUp, Loader2, Mail, Mic, RefreshCw, Send, Sliders, Sparkles, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { setPendingCompose, type CrmReturnContext } from "@/lib/compose-handoff";
import { plainTextToHtml } from "@/lib/email-format";
import {
  INTENT_MODIFIERS,
  groupModifiersByCategory,
  MAX_INTENT_MODIFIERS,
} from "@shared/intent-modifiers";

const LS_CALENDLY_KEY = "voltsafe:calendlyUrl";
const LS_VOICE_PROFILE_KEY = "voltsafe:voiceProfileId";
const LS_INFLUENCE_KEY = "voltsafe:wattsonInfluence";

type EntityType = "lead" | "account" | "contact";

const INFLUENCE_OPTIONS = [
  { value: 0,   label: "Natural Voice" },
  { value: 25,  label: "Light Polish" },
  { value: 50,  label: "Executive Polish" },
  { value: 75,  label: "CEO Wattson" },
  { value: 100, label: "Full CEO Wattson" },
] as const;

interface SuggestedEmail {
  to: string;
  cc: string;
  subject: string;
  body: string;
  reason: string;
  warning?: string;
  detectedContext?: string;
  voiceProfileId?: number;
  voiceProfileName?: string;
  ceoWattsonInfluenceLevel?: number;
  whyGenerated?: string[];
}

interface VoiceProfile {
  id: number;
  name: string;
  profileType: "global" | "user";
  isDefault: boolean;
}

interface AiSettings {
  defaultVoiceProfileId: number | null;
  ceoWattsonInfluenceLevel: number;
}

interface Props {
  entityType: EntityType;
  entityId: number;
  entityName?: string;
  onClose: () => void;
  /** Pre-selected TO recipient(s) from AI Summary Key People — overrides AI-generated recipient */
  initialTo?: string;
  /** Pre-selected CC recipient(s) from AI Summary Key People — overrides AI-generated CC */
  initialCc?: string;
  /** CRM origin — when present, compose dialog navigates back to the source record after send/cancel */
  crmReturnContext?: CrmReturnContext;
}

async function fetchSuggestedEmail(
  entityType: EntityType,
  entityId: number,
  voiceProfileId?: number | null,
  ceoWattsonInfluenceLevel?: number,
  intentModifierIds?: string[],
  userInputs?: string
): Promise<SuggestedEmail> {
  const body: Record<string, unknown> = {};
  if (voiceProfileId) body.voice_profile_id = voiceProfileId;
  if (ceoWattsonInfluenceLevel !== undefined) body.ceo_wattson_influence_level = ceoWattsonInfluenceLevel;
  if (intentModifierIds && intentModifierIds.length > 0) body.selectedIntentModifiers = intentModifierIds;
  if (userInputs?.trim()) body.userInputs = userInputs.trim();
  const res = await fetch(`/api/crm/ai-summary/${entityType}/${entityId}/suggest-next-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.message) msg = errBody.message;
    } catch { /* ignore parse errors */ }
    throw new Error(msg);
  }
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

const MODIFIER_CATEGORIES = groupModifiersByCategory(INTENT_MODIFIERS);
const CATEGORY_ORDER = [
  "Strategic Intent",
  "Relationship Intent",
  "Leadership Intent",
  "Persuasion Intent",
  "Communication Style",
  "Follow-Up Intent",
];

export function SuggestedNextEmailModal({ entityType, entityId, entityName, onClose, initialTo, initialCc, crmReturnContext }: Props) {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestedEmail | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [whyExpanded, setWhyExpanded] = useState(false);
  // Editable body — user can modify the AI-generated draft before sending
  const [editedBody, setEditedBody] = useState("");
  // Tracks whether the user has attempted generation at least once, so the manual
  // body textarea and Continue in Mail button remain visible after a failed attempt.
  const [generationAttempted, setGenerationAttempted] = useState(false);

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

  const { data: aiSettings } = useQuery<AiSettings>({
    queryKey: ["/api/ai/settings"],
  });

  // ── CEO Wattson influence level ───────────────────────────────────────────
  const [selectedInfluence, setSelectedInfluence] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(LS_INFLUENCE_KEY);
      return stored ? parseInt(stored) : 75;
    } catch { return 75; }
  });

  // Sync influence from user settings when loaded (localStorage takes precedence as session override)
  useEffect(() => {
    if (aiSettings?.ceoWattsonInfluenceLevel !== undefined) {
      const stored = (() => {
        try { return localStorage.getItem(LS_INFLUENCE_KEY); } catch { return null; }
      })();
      if (!stored) {
        setSelectedInfluence(aiSettings.ceoWattsonInfluenceLevel);
      }
    }
  }, [aiSettings?.ceoWattsonInfluenceLevel]);

  function handleInfluenceChange(val: string) {
    const level = parseInt(val);
    setSelectedInfluence(level);
    try { localStorage.setItem(LS_INFLUENCE_KEY, String(level)); } catch { /* storage blocked */ }
  }

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

  const influenceLabel = INFLUENCE_OPTIONS.find(o => o.value === selectedInfluence)?.label ?? "CEO Wattson";

  // ── Intent Modifiers ──────────────────────────────────────────────────────
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [modifiersExpanded, setModifiersExpanded] = useState(false);

  // ── User Inputs — per-generation freetext steering ───────────────────────
  const [userInputs, setUserInputs] = useState("");

  const atModifierLimit = selectedModifiers.length >= MAX_INTENT_MODIFIERS;

  function toggleModifier(id: string) {
    setSelectedModifiers(prev => {
      if (prev.includes(id)) return prev.filter(m => m !== id);
      if (prev.length >= MAX_INTENT_MODIFIERS) return prev;
      return [...prev, id];
    });
  }

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

  // ── Generate / Regenerate ─────────────────────────────────────────────────
  // No auto-fetch on mount — the user selects voice, influence, intent
  // modifiers, and user inputs first, then explicitly clicks Generate Email.
  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setSuggestion(null);
    setEditedBody("");
    setWhyExpanded(false);
    // Mark that at least one attempt has been made so the manual body textarea
    // and Continue in Mail button remain visible even if generation fails.
    setGenerationAttempted(true);
    try {
      const data = await fetchSuggestedEmail(entityType, entityId, effectiveVoiceId, selectedInfluence, selectedModifiers, userInputs);
      // Frontend guard: treat a blank body as a generation failure so the user
      // sees a real error instead of a blank-looking "successful" draft.
      if (!data.body?.trim()) {
        setError("Email body could not be generated. Please regenerate or write one manually.");
        return;
      }
      setSuggestion(data);
      setEditedBody(data.body);
    } catch (err: any) {
      setError(err.message || "Failed to generate");
    } finally {
      setLoading(false);
    }
  }

  async function handleContinue() {
    // Allow continue even if AI generation failed — user may have written the body manually.
    if (!editedBody.trim()) return;
    // If key people were pre-selected in the AI Summary card, use them as recipients;
    // otherwise fall back to the AI-generated suggestion (or empty when typing manually).
    const effectiveTo = (initialTo !== undefined && initialTo !== "") ? initialTo : (suggestion?.to ?? "");
    const effectiveCc = (initialTo !== undefined) ? (initialCc ?? "") : (suggestion?.cc ?? "");
    const effectiveSubject = suggestion?.subject ?? "Follow-up";
    console.log("[suggested-email-modal] handleContinue triggered", { to: effectiveTo, subject: effectiveSubject });
    setIsSaving(true);

    // Use editedBody (the user may have modified the AI draft); scheduling link appended at handoff
    const rawBody =
      includeLink && calendlyUrl.trim()
        ? insertSchedulingLink(editedBody, calendlyUrl.trim())
        : editedBody;

    // Convert plain-text paragraph breaks to HTML so the contentEditable
    // compose editor renders them correctly (plain \n\n becomes one space in innerHTML).
    const finalBody = plainTextToHtml(rawBody);

    const payload = {
      to: effectiveTo,
      cc: effectiveCc,
      subject: effectiveSubject,
      body: finalBody,
      // Forward CRM origin so the compose dialog can navigate back after send/cancel
      crmReturnContext,
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

        {/* User Inputs — optional freetext steering for this generation only */}
        <div className="py-3 border-b border-border/40 -mt-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-foreground/90">User Inputs</span>
            <span className="text-[10px] text-muted-foreground/60">optional</span>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Optional — add specific context or direction for this email only.
          </p>
          <textarea
            value={userInputs}
            onChange={(e) => setUserInputs(e.target.value)}
            placeholder="Tell the AI what to focus on, mention, avoid, or ask for in this email..."
            rows={3}
            maxLength={2000}
            className="w-full rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-sm text-foreground/90 placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-colors"
            data-testid="textarea-user-inputs"
          />
        </div>

        {/* Voice profile + influence + modifiers config area */}
        <div className="space-y-1.5 py-1.5 border-b border-border/40">
          {/* Voice profile selector */}
          {voiceProfiles.length > 0 && (
            <div className="flex items-center gap-2">
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

          {/* CEO Wattson influence selector */}
          <div className="flex items-center gap-2">
            <Sliders className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground shrink-0">Influence:</span>
            <Select
              value={String(selectedInfluence)}
              onValueChange={handleInfluenceChange}
            >
              <SelectTrigger
                className="h-7 text-xs border-none bg-transparent shadow-none focus:ring-0 focus:ring-offset-0 px-1 w-auto min-w-[160px]"
                data-testid="select-wattson-influence"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INFLUENCE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={String(opt.value)} data-testid={`influence-option-${opt.value}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loading && (
              <span className="text-[10px] text-muted-foreground/70 truncate">
                {influenceLabel}
              </span>
            )}
          </div>

          {/* Intent Modifiers — collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setModifiersExpanded(prev => !prev)}
              className="flex items-center gap-2 w-full group py-0.5"
              data-testid="button-toggle-intent-modifiers"
            >
              <Zap className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                Intent Modifiers
              </span>
              {selectedModifiers.length > 0 && (
                <span className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-primary/20 text-primary text-[10px] font-semibold" data-testid="badge-modifier-count">
                  {selectedModifiers.length}
                </span>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground/60">
                {modifiersExpanded ? "hide" : "optional"}
              </span>
              {modifiersExpanded
                ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
                : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              }
            </button>

            {modifiersExpanded && (
              <div className="mt-2 space-y-2" data-testid="panel-intent-modifiers">
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  Select up to {MAX_INTENT_MODIFIERS} ways to steer this email while preserving your saved voice.
                </p>

                {atModifierLimit && (
                  <p className="text-[10px] text-amber-400/90" data-testid="text-modifier-limit-warning">
                    Choose up to {MAX_INTENT_MODIFIERS} intent modifiers.
                  </p>
                )}

                <div className="space-y-2">
                  {CATEGORY_ORDER.filter(cat => MODIFIER_CATEGORIES[cat]).map(cat => (
                    <div key={cat}>
                      <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground/50 mb-1">
                        {cat}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {MODIFIER_CATEGORIES[cat].map(mod => {
                          const isChecked = selectedModifiers.includes(mod.id);
                          const isDisabled = !isChecked && atModifierLimit;
                          return (
                            <label
                              key={mod.id}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer select-none transition-colors",
                                isChecked
                                  ? "border-primary/50 bg-primary/10 text-primary"
                                  : isDisabled
                                    ? "border-border/30 text-muted-foreground/40 cursor-not-allowed"
                                    : "border-border/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                              )}
                              data-testid={`label-modifier-${mod.id}`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={isDisabled}
                                onChange={() => toggleModifier(mod.id)}
                                className="h-3 w-3 rounded border-border accent-primary cursor-pointer disabled:cursor-not-allowed"
                                data-testid={`checkbox-modifier-${mod.id}`}
                              />
                              {mod.label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {selectedModifiers.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/60 pt-0.5">
                    {suggestion
                      ? <>Click <strong>Regenerate Email</strong> to apply updated modifiers.</>
                      : <>Click <strong>Generate Email</strong> below to apply these modifiers.</>
                    }
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 mt-1">
          {/* Empty state — shown before first generation */}
          {!loading && !suggestion && !error && (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary/70" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground/80">Ready to generate</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Set your voice, influence, intent modifiers, and user inputs above, then click Generate Email.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleGenerate}
                className="bg-primary hover:bg-primary/90 mt-1"
                data-testid="button-generate-email-empty-state"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Generate Email{selectedModifiers.length > 0 ? ` (${selectedModifiers.length})` : ""}
              </Button>
            </div>
          )}

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
            <div className="flex items-start gap-2 rounded-md bg-red-500/8 border border-red-500/20 p-3" data-testid="suggest-email-error-banner">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">AI could not generate this email</p>
                <p className="text-xs text-muted-foreground mt-1">{error}</p>
                <p className="text-xs text-muted-foreground/70 mt-1.5">You can write it manually below or try again.</p>
              </div>
            </div>
          )}

          {/* Manual body entry — shown after a failed generation so the user can write manually */}
          {generationAttempted && !loading && !suggestion && (
            <div data-testid="manual-body-section">
              <p className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground mb-1.5">Body</p>
              <textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={10}
                placeholder="Write your email here…"
                className="w-full rounded-md border border-border/50 bg-muted/20 px-3 py-2.5 text-sm text-foreground/90 leading-relaxed resize-y overflow-y-auto focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-colors"
                data-testid="textarea-email-body"
              />
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

              {/* Active modifiers chip row */}
              {selectedModifiers.length > 0 && (
                <div className="flex flex-wrap gap-1" data-testid="section-active-modifiers">
                  {selectedModifiers.map(id => {
                    const mod = INTENT_MODIFIERS.find(m => m.id === id);
                    if (!mod) return null;
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary border border-primary/20"
                        data-testid={`chip-modifier-${id}`}
                      >
                        <Zap className="h-2.5 w-2.5" />
                        {mod.label}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Temporal context */}
              {suggestion.detectedContext && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" />
                  {suggestion.detectedContext}
                </div>
              )}

              {/* Fields — use pre-selected key people if provided, else AI suggestion */}
              {(() => {
                const displayTo = (initialTo !== undefined && initialTo !== "") ? initialTo : suggestion.to;
                const displayCc = initialTo !== undefined ? (initialCc ?? "") : (suggestion.cc ?? "");
                const recipientsOverridden = initialTo !== undefined && initialTo !== "";
                return (
                  <div className="space-y-2.5">
                    {recipientsOverridden && (
                      <p className="text-[10px] text-primary/70 flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/50 shrink-0" />
                        Recipients pre-filled from selected Key People
                      </p>
                    )}
                    <FieldRow label="To" value={displayTo} />
                    {displayCc && <FieldRow label="CC" value={displayCc} />}
                    <FieldRow label="Subject" value={suggestion.subject} />
                  </div>
                );
              })()}

              {/* Body — editable textarea so the user can refine the draft before sending */}
              <div>
                <p className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground mb-1.5">Body</p>
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={10}
                  disabled={loading}
                  className="w-full rounded-md border border-border/50 bg-muted/20 px-3 py-2.5 text-sm text-foreground/90 leading-relaxed resize-y overflow-y-auto focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-colors"
                  data-testid="textarea-email-body"
                />
              </div>

              {/* Why this draft was generated — expandable */}
              {suggestion.whyGenerated && suggestion.whyGenerated.length > 0 && (
                <div className="rounded-md border border-border/40 bg-muted/10 overflow-hidden">
                  <button
                    onClick={() => setWhyExpanded(prev => !prev)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/20 transition-colors"
                    data-testid="button-toggle-why-generated"
                  >
                    <span className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">
                      Why this draft
                    </span>
                    {whyExpanded
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </button>
                  {whyExpanded && (
                    <div className="px-3 pb-3 space-y-1" data-testid="section-why-generated">
                      {suggestion.whyGenerated.map((reason, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/50 shrink-0 mt-1.5" />
                          {reason}
                        </div>
                      ))}
                      <div className="pt-1 text-[10px] text-muted-foreground/60">
                        Influence level: {influenceLabel} ({selectedInfluence}%)
                      </div>
                    </div>
                  )}
                </div>
              )}

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
              {/* Generate / Regenerate — always visible; label adapts to whether a draft exists */}
              <Button
                type="button"
                variant={suggestion ? "outline" : "default"}
                size="sm"
                onClick={handleGenerate}
                disabled={loading || isSaving}
                className={cn(!suggestion && "bg-primary hover:bg-primary/90")}
                data-testid={suggestion ? "button-regenerate-suggested-email" : "button-generate-suggested-email"}
              >
                {loading
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating…</>
                  : suggestion
                    ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Regenerate Email{selectedModifiers.length > 0 ? ` (${selectedModifiers.length})` : ""}</>
                    : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate Email{selectedModifiers.length > 0 ? ` (${selectedModifiers.length})` : ""}</>
                }
              </Button>
              {/* Continue in Mail — visible once generation has been attempted;
                  enabled when editedBody is non-empty (AI-generated or manually written) */}
              {(suggestion || (generationAttempted && !loading)) && (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleContinue}
                  disabled={loading || !editedBody.trim() || isSaving || urlMissing}
                  className="bg-primary hover:bg-primary/90"
                  data-testid="button-continue-suggested-email"
                >
                  {isSaving
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Opening…</>
                    : <><Send className="h-3.5 w-3.5 mr-1.5" />Continue in Mail</>
                  }
                </Button>
              )}
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
