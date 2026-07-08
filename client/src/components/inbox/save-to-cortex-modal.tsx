import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Brain,
  Sparkles,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Tag,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";

// ── Constants (mirror server/services/cortex-intel.ts) ─────────────────────

const INTEL_TYPES = [
  "Marine Industry Intel",
  "NMMA / Association News",
  "Marina Market Data",
  "Boating Consumer Trends",
  "Regulatory / Compliance",
  "Competitor / Partner Intel",
  "Grant / Funding Intel",
  "Customer Pain / Voice of Market",
  "Other",
] as const;

const IMPORTANCE_LEVELS = [
  "Low",
  "Medium",
  "High",
  "Board-Level / Strategic",
] as const;

const USE_FOR_OPTIONS = [
  "AI email writing",
  "Lead/account research",
  "Campaign context",
  "Investor/funding narrative",
  "Cortex knowledge base",
  "All of the above",
] as const;

const IMPORTANCE_COLORS: Record<string, string> = {
  "Low": "bg-muted/50 text-muted-foreground",
  "Medium": "bg-blue-500/15 text-blue-400",
  "High": "bg-amber-500/15 text-amber-400",
  "Board-Level / Strategic": "bg-purple-500/15 text-purple-400",
};

// ── Props ──────────────────────────────────────────────────────────────────

interface SaveToCortexModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: {
    id: string;
    threadId?: string;
    subject?: string | null;
    senderName?: string;
    senderEmail?: string;
    receivedAt?: string | null;
    body?: string;
    snippet?: string | null;
    sourceLabel?: string;
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export function SaveToCortexModal({ open, onOpenChange, email }: SaveToCortexModalProps) {
  const { toast } = useToast();

  // Form state
  const [intelType, setIntelType] = useState<string>("Marine Industry Intel");
  const [importance, setImportance] = useState<string>("Medium");
  const [useFor, setUseFor] = useState<string[]>(["Cortex knowledge base"]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [strategicRelevance, setStrategicRelevance] = useState("");
  const [extractedFacts, setExtractedFacts] = useState<string[]>([]);
  const [summaryGenerated, setSummaryGenerated] = useState(false);
  const [showSummary, setShowSummary] = useState(true);
  const [ingested, setIngested] = useState(false);
  const [existingRecord, setExistingRecord] = useState<any>(null);
  const [isUpdate, setIsUpdate] = useState(false);

  // Check if already saved
  const checkQuery = useQuery({
    queryKey: ["/api/cortex-intel/check", email.id],
    queryFn: () =>
      fetch(`/api/cortex-intel/check/${encodeURIComponent(email.id)}`, { credentials: "include" })
        .then((r) => r.json()),
    enabled: open && !!email.id,
  });

  useEffect(() => {
    if (checkQuery.data?.exists && checkQuery.data?.record) {
      const r = checkQuery.data.record;
      setExistingRecord(r);
      setIntelType(r.intel_type || "Marine Industry Intel");
      setImportance(r.importance || "Medium");
      setUseFor(Array.isArray(r.use_for) ? r.use_for : []);
      setTags(Array.isArray(r.tags) ? r.tags : []);
      setUserNotes(r.user_notes || "");
      setAiSummary(r.ai_summary || "");
      setStrategicRelevance(r.strategic_relevance || "");
      setSummaryGenerated(true);
      setIngested(true);
    }
  }, [checkQuery.data]);

  // Reset on open
  useEffect(() => {
    if (open && !checkQuery.data?.exists) {
      setIntelType("Marine Industry Intel");
      setImportance("Medium");
      setUseFor(["Cortex knowledge base"]);
      setTags([]);
      setTagInput("");
      setUserNotes("");
      setAiSummary("");
      setStrategicRelevance("");
      setExtractedFacts([]);
      setSummaryGenerated(false);
      setIngested(false);
      setExistingRecord(null);
      setIsUpdate(false);
    }
  }, [open]);

  // AI summary generation
  const summaryMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/cortex-intel/generate-summary", {
        subject: email.subject || "",
        senderName: email.senderName || "",
        senderEmail: email.senderEmail || "",
        receivedAt: email.receivedAt || "",
        body: email.body || "",
        snippet: email.snippet || "",
        sourceLabel: email.sourceLabel || email.senderName || "",
      }).then((r) => r.json()),
    onSuccess: (data) => {
      setAiSummary(data.aiSummary || "");
      setStrategicRelevance(data.strategicRelevance || "");
      setExtractedFacts(Array.isArray(data.extractedFacts) ? data.extractedFacts : []);
      if (data.suggestedTags?.length) setTags(data.suggestedTags);
      if (data.suggestedIntelType) setIntelType(data.suggestedIntelType);
      if (data.suggestedUseCases?.length) setUseFor(data.suggestedUseCases);
      setSummaryGenerated(true);
      setShowSummary(true);
    },
    onError: () => toast({ title: "Summary generation failed", variant: "destructive" }),
  });

  // Ingest to Cortex
  const ingestMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/cortex-intel", {
        mailMessageId: email.id,
        threadId: email.threadId,
        subject: email.subject,
        senderName: email.senderName,
        senderEmail: email.senderEmail,
        receivedAt: email.receivedAt,
        sourceLabel: email.sourceLabel || email.senderName,
        intelType,
        importance,
        useFor,
        tags,
        userNotes: userNotes || undefined,
        aiSummary: aiSummary || undefined,
        strategicRelevance: strategicRelevance || undefined,
        extractedFacts: extractedFacts.length ? extractedFacts : undefined,
      }).then((r) => r.json()),
    onSuccess: () => {
      setIngested(true);
      setIsUpdate(false);
      queryClient.invalidateQueries({ queryKey: ["/api/cortex-intel"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cortex-intel/check", email.id] });
      toast({
        title: "Saved to Cortex",
        description: `${intelType} · ${importance}`,
      });
    },
    onError: (err: any) => {
      if (err?.status === 409) {
        toast({ title: "Already saved", description: "This email is already in Cortex. Use 'Update' to modify it.", variant: "destructive" });
      } else {
        toast({ title: "Failed to save", variant: "destructive" });
      }
    },
  });

  // Update existing record
  const updateMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/cortex-intel/${existingRecord.id}`, {
        intelType,
        importance,
        useFor,
        tags,
        userNotes: userNotes || undefined,
        aiSummary: aiSummary || undefined,
        strategicRelevance: strategicRelevance || undefined,
        extractedFacts: extractedFacts.length ? extractedFacts : undefined,
      }).then((r) => r.json()),
    onSuccess: () => {
      setIsUpdate(false);
      queryClient.invalidateQueries({ queryKey: ["/api/cortex-intel"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cortex-intel/check", email.id] });
      toast({ title: "Cortex record updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  // Tag helpers
  const addTag = (value: string) => {
    const t = value.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };

  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const toggleUseFor = (option: string) => {
    if (option === "All of the above") {
      setUseFor(useFor.includes("All of the above") ? [] : ["All of the above"]);
      return;
    }
    setUseFor((prev) => {
      const next = prev.filter((x) => x !== "All of the above");
      return next.includes(option) ? next.filter((x) => x !== option) : [...next, option];
    });
  };

  const isBusy = summaryMutation.isPending || ingestMutation.isPending || updateMutation.isPending;

  const senderDisplay = email.senderName || email.senderEmail || "Unknown sender";
  const dateDisplay = email.receivedAt
    ? new Date(email.receivedAt).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto gap-0 p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
              <Brain className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold break-words [overflow-wrap:anywhere]">Save Email to Cortex</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5 whitespace-normal break-words [overflow-wrap:anywhere]">
                Flag this email as marine industry intelligence for Cortex to use in future emails, campaigns, and research.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-4 space-y-5">
          {/* Email preview */}
          <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground whitespace-normal break-words [overflow-wrap:anywhere]">
                  {email.subject || "(No subject)"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 whitespace-normal break-words [overflow-wrap:anywhere]">
                  {senderDisplay}{dateDisplay ? ` · ${dateDisplay}` : ""}
                </p>
              </div>
              {ingested && !isUpdate && (
                <Badge className="flex-shrink-0 text-[10px] bg-cyan-500/15 text-cyan-400 border-cyan-500/30 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  In Cortex
                </Badge>
              )}
            </div>
            {email.snippet && (
              <p className="text-xs text-muted-foreground/70 mt-2 line-clamp-2 whitespace-normal break-words [overflow-wrap:anywhere]">{email.snippet}</p>
            )}
          </div>

          {/* Already saved notice */}
          {ingested && !isUpdate && (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <CheckCircle2 className="h-4 w-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-cyan-400 whitespace-normal break-words [overflow-wrap:anywhere]">Already saved to Cortex</p>
                    <p className="text-xs text-muted-foreground mt-0.5 whitespace-normal break-words [overflow-wrap:anywhere]">
                      Saved as <span className="font-medium">{intelType}</span> · <span className={`font-medium`}>{importance}</span>
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 flex-shrink-0"
                  onClick={() => setIsUpdate(true)}
                >
                  Update
                </Button>
              </div>
            </div>
          )}

          {/* Classification */}
          {(!ingested || isUpdate) && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Intel Type</Label>
                  <Select value={intelType} onValueChange={setIntelType}>
                    <SelectTrigger className="h-8 text-xs" data-testid="intel-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTEL_TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Importance</Label>
                  <Select value={importance} onValueChange={setImportance}>
                    <SelectTrigger className="h-8 text-xs" data-testid="importance-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMPORTANCE_LEVELS.map((l) => (
                        <SelectItem key={l} value={l} className="text-xs">
                          <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${IMPORTANCE_COLORS[l]}`}>
                            {l}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Use For */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Use For</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {USE_FOR_OPTIONS.map((opt) => (
                    <label
                      key={opt}
                      className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                    >
                      <Checkbox
                        checked={useFor.includes(opt) || useFor.includes("All of the above")}
                        onCheckedChange={() => toggleUseFor(opt)}
                        data-testid={`use-for-${opt.replace(/\s+/g, "-").toLowerCase()}`}
                        className="h-3.5 w-3.5"
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Tags</Label>
                <div className="flex gap-1.5 flex-wrap mb-1.5">
                  {tags.map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="text-[10px] gap-1 pl-2 pr-1 h-5"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTag(t)}
                        className="hover:text-destructive transition-colors"
                        data-testid={`remove-tag-${t}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <Input
                    className="h-7 text-xs"
                    placeholder="Add tag and press Enter"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); }
                    }}
                    data-testid="tag-input"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => addTag(tagInput)}
                  >
                    <Tag className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Notes (optional)</Label>
                <Textarea
                  className="text-xs min-h-[60px] resize-none"
                  placeholder="Add any context or observations about why this is relevant..."
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  data-testid="user-notes-input"
                />
              </div>

              {/* AI Summary section */}
              <div className="rounded-lg border border-border/40 bg-muted/10">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium hover:bg-muted/20 transition-colors rounded-lg"
                  onClick={() => setShowSummary(!showSummary)}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                    AI Summary
                    {summaryGenerated && (
                      <Badge className="text-[10px] bg-cyan-500/15 text-cyan-400 border-cyan-500/20">Generated</Badge>
                    )}
                  </div>
                  {showSummary ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>

                {showSummary && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3">
                    {!summaryGenerated && (
                      <p className="text-xs text-muted-foreground">
                        Generate an AI summary with strategic context, key facts, and suggested classification for this email.
                      </p>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full h-7 text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 gap-1.5"
                      onClick={() => summaryMutation.mutate()}
                      disabled={isBusy}
                      data-testid="generate-summary-button"
                    >
                      {summaryMutation.isPending ? (
                        <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
                      ) : summaryGenerated ? (
                        <><RefreshCw className="h-3 w-3" /> Regenerate Summary</>
                      ) : (
                        <><Sparkles className="h-3 w-3" /> Generate Summary</>
                      )}
                    </Button>

                    {aiSummary && (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Summary</p>
                          <Textarea
                            className="text-xs min-h-[64px] resize-none bg-background/50"
                            value={aiSummary}
                            onChange={(e) => setAiSummary(e.target.value)}
                            data-testid="ai-summary-text"
                          />
                        </div>

                        {strategicRelevance && (
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">VoltSafe Relevance</p>
                            <Textarea
                              className="text-xs min-h-[48px] resize-none bg-background/50"
                              value={strategicRelevance}
                              onChange={(e) => setStrategicRelevance(e.target.value)}
                              data-testid="strategic-relevance-text"
                            />
                          </div>
                        )}

                        {extractedFacts.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Key Facts</p>
                            <ul className="space-y-1">
                              {extractedFacts.map((f, i) => (
                                <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                                  <span className="text-cyan-400 flex-shrink-0">›</span>
                                  <span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => onOpenChange(false)}
                  disabled={isBusy}
                >
                  Cancel
                </Button>
                {isUpdate ? (
                  <Button
                    size="sm"
                    className="text-xs bg-cyan-600 hover:bg-cyan-700 gap-1.5"
                    onClick={() => updateMutation.mutate()}
                    disabled={isBusy}
                    data-testid="update-cortex-button"
                  >
                    {updateMutation.isPending ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…</>
                    ) : (
                      <><Brain className="h-3.5 w-3.5" /> Update Cortex Record</>
                    )}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="text-xs bg-cyan-600 hover:bg-cyan-700 gap-1.5"
                    onClick={() => ingestMutation.mutate()}
                    disabled={isBusy || useFor.length === 0}
                    data-testid="ingest-cortex-button"
                  >
                    {ingestMutation.isPending ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Ingesting…</>
                    ) : (
                      <><Brain className="h-3.5 w-3.5" /> Ingest to Cortex</>
                    )}
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Success state — already ingested and not editing */}
          {ingested && !isUpdate && (
            <div className="space-y-3">
              {aiSummary && (
                <div className="rounded-lg bg-muted/20 px-4 py-3 space-y-2">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">AI Summary</p>
                  <p className="text-xs text-foreground/80">{aiSummary}</p>
                  {strategicRelevance && (
                    <>
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mt-2">VoltSafe Relevance</p>
                      <p className="text-xs text-foreground/80">{strategicRelevance}</p>
                    </>
                  )}
                </div>
              )}
              {tags.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
