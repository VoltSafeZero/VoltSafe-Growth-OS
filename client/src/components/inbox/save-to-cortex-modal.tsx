import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
  Building2,
  Lightbulb,
  Users,
  Zap,
  TrendingUp,
  FileText,
  FlaskConical,
  ArrowRight,
  BookOpen,
  Activity,
  Link2,
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

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  Negative: "text-red-400 bg-red-500/10 border-red-500/20",
  Neutral: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  Mixed: "text-amber-400 bg-amber-500/10 border-amber-500/20",
};

const PIPELINE_STEPS = [
  { label: "Email stored", icon: FileText },
  { label: "Text extracted", icon: Activity },
  { label: "Entities identified", icon: Lightbulb },
  { label: "Knowledge indexed", icon: BookOpen },
  { label: "Search ready", icon: Link2 },
  { label: "AI active", icon: Zap },
];

const USE_FOR_ICONS: Record<string, typeof Brain> = {
  "AI email writing": Brain,
  "Lead/account research": Users,
  "Campaign context": TrendingUp,
  "Investor/funding narrative": Activity,
  "Cortex knowledge base": BookOpen,
  "All of the above": Sparkles,
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

interface ExtractedEntities {
  orgs: string[];
  topics: string[];
  people: string[];
  sentiment: string;
  confidence: number;
}

// ── Component ──────────────────────────────────────────────────────────────

export function SaveToCortexModal({ open, onOpenChange, email }: SaveToCortexModalProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

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
  const [extractedEntities, setExtractedEntities] = useState<ExtractedEntities | null>(null);
  const [summaryGenerated, setSummaryGenerated] = useState(false);
  const [showSummary, setShowSummary] = useState(true);
  const [ingested, setIngested] = useState(false);
  const [existingRecord, setExistingRecord] = useState<any>(null);
  const [isUpdate, setIsUpdate] = useState(false);
  const [showAllFacts, setShowAllFacts] = useState(false);

  // Check if already saved
  const checkQuery = useQuery({
    queryKey: ["/api/cortex-intel/check", email.id],
    queryFn: () =>
      fetch(`/api/cortex-intel/check/${encodeURIComponent(email.id)}`, { credentials: "include" })
        .then((r) => r.json()),
    enabled: open && !!email.id,
  });

  // Related intelligence (only when ingested)
  const relatedQuery = useQuery({
    queryKey: ["/api/cortex-intel/related", existingRecord?.id],
    queryFn: () =>
      fetch(`/api/cortex-intel/${existingRecord.id}/related`, { credentials: "include" })
        .then((r) => r.json()),
    enabled: ingested && !isUpdate && !!existingRecord?.id,
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
      // Parse extracted_facts — v2 structured object or legacy array
      const ef = r.extracted_facts;
      if (ef && typeof ef === "object" && !Array.isArray(ef) && ef._v === 2) {
        setExtractedFacts(Array.isArray(ef.facts) ? ef.facts : []);
        setExtractedEntities({
          orgs: Array.isArray(ef.orgs) ? ef.orgs : [],
          topics: Array.isArray(ef.topics) ? ef.topics : [],
          people: Array.isArray(ef.people) ? ef.people : [],
          sentiment: ef.sentiment || "Neutral",
          confidence: ef.confidence || 0,
        });
      } else if (Array.isArray(ef)) {
        setExtractedFacts(ef);
        setExtractedEntities(null);
      }
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
      setExtractedEntities(null);
      setSummaryGenerated(false);
      setIngested(false);
      setExistingRecord(null);
      setIsUpdate(false);
      setShowAllFacts(false);
    }
  }, [open]);

  // Helper to compose the structured extracted_facts payload
  const buildExtractedFactsPayload = () => {
    if (!extractedFacts.length && !extractedEntities) return undefined;
    if (extractedEntities) {
      return {
        _v: 2,
        facts: extractedFacts,
        orgs: extractedEntities.orgs,
        topics: extractedEntities.topics,
        people: extractedEntities.people,
        sentiment: extractedEntities.sentiment,
        confidence: extractedEntities.confidence,
      };
    }
    return extractedFacts.length ? extractedFacts : undefined;
  };

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
      const facts = Array.isArray(data.extractedFacts) ? data.extractedFacts : [];
      setExtractedFacts(facts);
      if (data.suggestedTags?.length) setTags(data.suggestedTags);
      if (data.suggestedIntelType) setIntelType(data.suggestedIntelType);
      if (data.suggestedUseCases?.length) setUseFor(data.suggestedUseCases);
      setSummaryGenerated(true);
      setShowSummary(true);
      setExtractedEntities({
        orgs: Array.isArray(data.extractedOrgs) ? data.extractedOrgs : [],
        topics: Array.isArray(data.extractedTopics) ? data.extractedTopics : [],
        people: Array.isArray(data.extractedPeople) ? data.extractedPeople : [],
        sentiment: data.sentiment || "Neutral",
        confidence: typeof data.confidence === "number" ? data.confidence : 0,
      });
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
        extractedFacts: buildExtractedFactsPayload(),
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
        extractedFacts: buildExtractedFactsPayload(),
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

  const hasEntities =
    extractedEntities &&
    (extractedEntities.orgs.length > 0 ||
      extractedEntities.topics.length > 0 ||
      extractedEntities.people.length > 0);

  const displayedFacts = showAllFacts ? extractedFacts : extractedFacts.slice(0, 3);
  const relatedRecords: any[] = Array.isArray(relatedQuery.data) ? relatedQuery.data : [];

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
              <DialogTitle className="text-base font-semibold break-words [overflow-wrap:anywhere]">
                {ingested && !isUpdate ? "Cortex Intelligence Record" : "Save Email to Cortex"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5 whitespace-normal break-words [overflow-wrap:anywhere]">
                {ingested && !isUpdate
                  ? "This email has been processed and indexed as structured intelligence."
                  : "Flag this email as marine industry intelligence for Cortex to use in future emails, campaigns, and research."}
              </DialogDescription>
            </div>
          </div>
          {!ingested && (
            <button
              type="button"
              className="text-xs text-cyan-400 hover:underline mt-2 self-start"
              onClick={() => {
                onOpenChange(false);
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent("open-save-url-to-cortex"));
                }, 50);
              }}
              data-testid="button-save-url-instead"
            >
              Save a URL instead →
            </button>
          )}
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

          {/* ── INTELLIGENCE VIEW (ingested, not editing) ────────────────────── */}
          {ingested && !isUpdate && (
            <div className="space-y-4">

              {/* Pipeline steps */}
              <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-3">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mb-3">Ingestion Pipeline</p>
                <div className="grid grid-cols-3 gap-y-2 gap-x-3 sm:grid-cols-6 sm:gap-y-0">
                  {PIPELINE_STEPS.map((step, i) => {
                    const Icon = step.icon;
                    const done = i < 3
                      ? true
                      : i === 2
                        ? !!extractedEntities
                        : true;
                    return (
                      <div key={step.label} className="flex flex-col items-center gap-1 text-center">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${done ? "bg-emerald-500/15" : "bg-muted/40"}`}>
                          <Icon className={`h-3.5 w-3.5 ${done ? "text-emerald-400" : "text-muted-foreground/40"}`} />
                        </div>
                        <span className={`text-[9px] leading-tight ${done ? "text-emerald-400" : "text-muted-foreground/40"}`}>
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Intel classification chips */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <Badge className="text-[10px] bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                  {intelType}
                </Badge>
                <Badge className={`text-[10px] border ${IMPORTANCE_COLORS[importance] || "bg-muted/50 text-muted-foreground"}`}>
                  {importance}
                </Badge>
                {tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px] gap-1">
                    <Tag className="h-2.5 w-2.5" />
                    {t}
                  </Badge>
                ))}
              </div>

              {/* Extracted entities */}
              {hasEntities ? (
                <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">What Cortex Learned</p>
                    {extractedEntities && extractedEntities.confidence > 0 && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {extractedEntities.confidence}% confidence
                      </span>
                    )}
                  </div>

                  {extractedEntities && extractedEntities.orgs.length > 0 && (
                    <div className="flex items-start gap-2 min-w-0">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground/60 mt-0.5 flex-shrink-0" />
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {extractedEntities.orgs.map((org) => (
                          <span key={org} className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            {org}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {extractedEntities && extractedEntities.topics.length > 0 && (
                    <div className="flex items-start gap-2 min-w-0">
                      <Lightbulb className="h-3.5 w-3.5 text-muted-foreground/60 mt-0.5 flex-shrink-0" />
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {extractedEntities.topics.map((topic) => (
                          <span key={topic} className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] bg-violet-500/10 text-violet-400 border border-violet-500/20">
                            {topic}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {extractedEntities && extractedEntities.people.length > 0 && (
                    <div className="flex items-start gap-2 min-w-0">
                      <Users className="h-3.5 w-3.5 text-muted-foreground/60 mt-0.5 flex-shrink-0" />
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {extractedEntities.people.map((person) => (
                          <span key={person} className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            {person}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {extractedEntities && extractedEntities.sentiment && (
                    <div className="flex items-center gap-2">
                      <Activity className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] border ${SENTIMENT_COLORS[extractedEntities.sentiment] || SENTIMENT_COLORS.Neutral}`}>
                        {extractedEntities.sentiment} signal
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border/30 px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Entity extraction not yet run</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">Analyze to extract organizations, topics, and people</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 gap-1.5 flex-shrink-0"
                    onClick={() => summaryMutation.mutate()}
                    disabled={summaryMutation.isPending}
                    data-testid="analyze-entities-button"
                  >
                    {summaryMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    Analyze
                  </Button>
                </div>
              )}

              {/* AI Summary */}
              {aiSummary && (
                <div className="rounded-lg bg-muted/20 border border-border/30 px-4 py-3 space-y-2">
                  <button
                    className="flex items-center justify-between w-full text-left gap-2"
                    onClick={() => setShowSummary((v) => !v)}
                  >
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">AI Summary</p>
                    {showSummary ? (
                      <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/60" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                    )}
                  </button>
                  {showSummary && (
                    <>
                      <p className="text-xs text-foreground/80 leading-relaxed">{aiSummary}</p>
                      {strategicRelevance && (
                        <>
                          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mt-2">VoltSafe Relevance</p>
                          <p className="text-xs text-foreground/70 leading-relaxed">{strategicRelevance}</p>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Key facts */}
              {extractedFacts.length > 0 && (
                <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-3 space-y-2">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
                    Key Facts{" "}
                    <span className="text-muted-foreground/50 normal-case font-normal">
                      ({extractedFacts.length})
                    </span>
                  </p>
                  <ul className="space-y-1.5">
                    {displayedFacts.map((fact, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-500/60 flex-shrink-0" />
                        <span className="leading-relaxed">{fact}</span>
                      </li>
                    ))}
                  </ul>
                  {extractedFacts.length > 3 && (
                    <button
                      className="text-[10px] text-cyan-400 hover:underline"
                      onClick={() => setShowAllFacts((v) => !v)}
                    >
                      {showAllFacts ? "Show fewer" : `Show all ${extractedFacts.length} facts`}
                    </button>
                  )}
                </div>
              )}

              {/* Related intelligence */}
              {(relatedQuery.isLoading || relatedRecords.length > 0) && (
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
                    Related Intelligence
                  </p>
                  {relatedQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading related records…
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {relatedRecords.map((r: any) => (
                        <div
                          key={r.id}
                          className="rounded-lg border border-border/30 bg-muted/10 px-3 py-2 flex items-start justify-between gap-2 min-w-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-foreground/80 truncate">{r.subject || "(No subject)"}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {r.intel_type}
                              {r.sender_name ? ` · ${r.sender_name}` : ""}
                            </p>
                          </div>
                          <Badge className={`text-[10px] flex-shrink-0 border ${IMPORTANCE_COLORS[r.importance] || "bg-muted/50 text-muted-foreground"}`}>
                            {r.importance}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Active uses */}
              {useFor.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">Cortex Will Use This For</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(useFor.includes("All of the above") ? USE_FOR_OPTIONS.slice(0, -1) : useFor).map((u) => {
                      const Icon = USE_FOR_ICONS[u] || Brain;
                      return (
                        <span key={u} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] bg-cyan-500/8 text-cyan-400 border border-cyan-500/20">
                          <Icon className="h-2.5 w-2.5" />
                          {u}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action footer */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 gap-1.5"
                  onClick={() => {
                    onOpenChange(false);
                    navigate("/executive-copilot");
                  }}
                  data-testid="test-cortex-button"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  Test Cortex
                  <ArrowRight className="h-3 w-3" />
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setIsUpdate(true)}
                    data-testid="update-record-button"
                  >
                    Update Record
                  </Button>
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
            </div>
          )}

          {/* ── FORM VIEW (not ingested, or editing) ─────────────────────────── */}
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
                <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 bg-muted/40 text-muted-foreground"
                    >
                      {t}
                      <button type="button" onClick={() => removeTag(t)} className="hover:text-foreground">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    className="h-7 text-xs"
                    placeholder="Add tag and press Enter…"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                        e.preventDefault();
                        addTag(tagInput);
                      }
                    }}
                    data-testid="tag-input"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => addTag(tagInput)}
                    disabled={!tagInput.trim()}
                    data-testid="add-tag-button"
                  >
                    <Tag className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* User notes */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Your Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea
                  className="text-xs min-h-[60px] resize-none"
                  placeholder="Add context, caveats, or why this matters…"
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  data-testid="user-notes-textarea"
                />
              </div>

              {/* AI Summary */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium">AI Summary</Label>
                    {summaryGenerated && (
                      <Badge variant="secondary" className="text-[10px] gap-1">
                        <Sparkles className="h-2.5 w-2.5" />
                        Generated
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {summaryGenerated && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setShowSummary((v) => !v)}
                      >
                        {showSummary ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-2 gap-1"
                      onClick={() => summaryMutation.mutate()}
                      disabled={summaryMutation.isPending}
                      data-testid="generate-summary-button"
                    >
                      {summaryMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      {summaryGenerated ? "Regenerate" : "Generate"}
                    </Button>
                  </div>
                </div>

                {summaryMutation.isPending && (
                  <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Analyzing email…
                  </div>
                )}

                {summaryGenerated && showSummary && (
                  <div className="rounded-lg bg-muted/20 px-4 py-3 space-y-2">
                    {aiSummary && (
                      <>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Summary</p>
                        <Textarea
                          className="text-xs min-h-[80px] resize-none bg-transparent border-0 p-0 focus-visible:ring-0"
                          value={aiSummary}
                          onChange={(e) => setAiSummary(e.target.value)}
                          data-testid="ai-summary-textarea"
                        />
                      </>
                    )}
                    {strategicRelevance && (
                      <>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mt-2">VoltSafe Relevance</p>
                        <Textarea
                          className="text-xs min-h-[60px] resize-none bg-transparent border-0 p-0 focus-visible:ring-0"
                          value={strategicRelevance}
                          onChange={(e) => setStrategicRelevance(e.target.value)}
                        />
                      </>
                    )}
                    {extractedFacts.length > 0 && (
                      <>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mt-2">
                          Key Facts ({extractedFacts.length})
                        </p>
                        <ul className="space-y-1">
                          {extractedFacts.map((fact, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-500/60 flex-shrink-0" />
                              {fact}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {extractedEntities && hasEntities && (
                      <>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mt-2">Entities Extracted</p>
                        <div className="space-y-1.5">
                          {extractedEntities.orgs.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Building2 className="h-3 w-3 text-muted-foreground/60" />
                              {extractedEntities.orgs.map((org) => (
                                <span key={org} className="text-[10px] rounded px-1.5 py-0.5 bg-blue-500/10 text-blue-400">{org}</span>
                              ))}
                            </div>
                          )}
                          {extractedEntities.topics.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Lightbulb className="h-3 w-3 text-muted-foreground/60" />
                              {extractedEntities.topics.map((topic) => (
                                <span key={topic} className="text-[10px] rounded px-1.5 py-0.5 bg-violet-500/10 text-violet-400">{topic}</span>
                              ))}
                            </div>
                          )}
                          {extractedEntities.sentiment && (
                            <div className="flex items-center gap-1.5">
                              <Activity className="h-3 w-3 text-muted-foreground/60" />
                              <span className={`text-[10px] rounded px-1.5 py-0.5 border ${SENTIMENT_COLORS[extractedEntities.sentiment] || SENTIMENT_COLORS.Neutral}`}>
                                {extractedEntities.sentiment}
                              </span>
                              {extractedEntities.confidence > 0 && (
                                <span className="text-[10px] text-muted-foreground/50">{extractedEntities.confidence}% confidence</span>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {!summaryGenerated && !summaryMutation.isPending && (
                  <p className="text-xs text-muted-foreground/60">
                    Generate an AI summary to extract key facts, entities, and strategic relevance.
                  </p>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <div>
                  {isUpdate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={() => setIsUpdate(false)}
                      disabled={isBusy}
                    >
                      Cancel
                    </Button>
                  )}
                  {!isUpdate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => onOpenChange(false)}
                      disabled={isBusy}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
