import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Bot, Sparkles, AlertTriangle, ChevronDown, ChevronRight,
  Copy, RefreshCcw, Send, MailOpen, ClipboardList, Loader2,
  Brain, Target, Users, FolderOpen, BarChart3, FileText, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

type CopilotMode =
  | "ask" | "strategy" | "follow_up" | "board_update"
  | "closing_plan" | "data_room" | "engagement" | "email_draft";

interface CopilotAction {
  action_type:   string;
  title:         string;
  description:   string;
  investor_id?:  number | null;
  priority:      "high" | "medium" | "low";
  reason:        string;
  source_signal: string;
}

interface DraftOutput {
  subject:        string;
  body:           string;
  tone:           string;
  target_contact: string;
  investor_id:    number | null;
  context_used:   string[];
  warnings:       string[];
}

interface CopilotResponse {
  answer:              string;
  context_used:        string[];
  recommended_actions: CopilotAction[];
  draft_output:        DraftOutput | null;
  warnings:            string[];
  generated_at:        string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MODES: { value: CopilotMode; label: string; icon: React.ElementType; description: string }[] = [
  { value: "ask",          label: "Ask",          icon: Brain,       description: "Answer a question from context" },
  { value: "strategy",     label: "Strategy",     icon: Target,      description: "Risks, opportunities, next actions" },
  { value: "follow_up",    label: "Follow-Up",    icon: Zap,         description: "Who needs follow-up and why" },
  { value: "board_update", label: "Board Update", icon: FileText,    description: "Board-safe capital summary" },
  { value: "closing_plan", label: "Close Plan",   icon: ClipboardList, description: "Investor-by-investor close plan" },
  { value: "data_room",    label: "Data Room",    icon: FolderOpen,  description: "Material gaps and portal activity" },
  { value: "engagement",   label: "Engagement",   icon: BarChart3,   description: "Interpret investor signals" },
  { value: "email_draft",  label: "Email Draft",  icon: MailOpen,    description: "Draft investor email (never sent)" },
];

const SUGGESTED_PROMPTS: { category: string; prompts: { label: string; question: string; mode: CopilotMode }[] }[] = [
  {
    category: "General",
    prompts: [
      { label: "What changed this week?",       question: "What changed in the round this week?",         mode: "ask" },
      { label: "Biggest risks right now",       question: "What are the biggest risks right now?",        mode: "strategy" },
      { label: "What should Trevor do today?",  question: "What should Trevor do today?",                 mode: "strategy" },
      { label: "What should Scott focus on?",   question: "What should Scott care about this week?",      mode: "ask" },
    ],
  },
  {
    category: "Investor",
    prompts: [
      { label: "Why hot or stale?",             question: "Why is this investor hot or stale?",               mode: "engagement" },
      { label: "Draft follow-up",               question: "Draft a follow-up to this investor.",              mode: "email_draft" },
      { label: "What is blocking commitment?",  question: "What is blocking this investor from committing?",  mode: "strategy" },
      { label: "Materials this investor saw",   question: "What materials has this investor seen?",           mode: "data_room" },
      { label: "What should the next step be?", question: "What should the next step be with this investor?", mode: "strategy" },
    ],
  },
  {
    category: "Round",
    prompts: [
      { label: "Hit minimum close",      question: "What needs to happen to hit minimum close?",   mode: "closing_plan" },
      { label: "Hit target close",       question: "What needs to happen to hit target close?",    mode: "closing_plan" },
      { label: "Who can lead?",          question: "Which investors can lead this round?",         mode: "strategy" },
      { label: "Top 5 closing risks",    question: "What are the top 5 closing risks?",            mode: "strategy" },
      { label: "7-day close plan",       question: "Build a 7-day close plan.",                    mode: "closing_plan" },
    ],
  },
  {
    category: "Data Room",
    prompts: [
      { label: "Missing key materials",       question: "Which investors are missing key materials?",    mode: "data_room" },
      { label: "What's driving engagement?",  question: "Which materials are driving engagement?",       mode: "data_room" },
      { label: "Portal views without reply",  question: "Who opened the portal but did not respond?",    mode: "data_room" },
      { label: "Overdue diligence",           question: "Which diligence requests are overdue?",         mode: "data_room" },
    ],
  },
  {
    category: "Reports",
    prompts: [
      { label: "Draft board update",    question: "Draft a board-ready capital update.",   mode: "board_update" },
      { label: "Draft CFO summary",     question: "Draft a CFO closing summary.",          mode: "board_update" },
      { label: "Draft this week's brief", question: "Draft this week's capital brief.",    mode: "ask" },
    ],
  },
];

const PRIORITY_COLORS = {
  high:   "bg-red-500/15 text-red-400 border-red-500/20",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  low:    "bg-slate-500/15 text-slate-400 border-slate-500/20",
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  follow_up:         "Follow Up",
  draft_email:       "Draft Email",
  send_material:     "Send Material",
  update_next_step:  "Update Next Step",
  schedule_meeting:  "Schedule Meeting",
  chase_docs:        "Chase Docs",
  confirm_allocation:"Confirm Allocation",
  update_commitment: "Update Commitment",
  create_task:       "Create Task",
  review_email_link: "Review Email Thread",
  update_data_room:  "Update Data Room",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CapitalCopilotPage() {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [mode, setMode]                       = useState<CopilotMode>("ask");
  const [question, setQuestion]               = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);
  const [selectedInvestorId, setSelectedInvestorId] = useState<number | null>(null);
  const [includeSensitive, setIncludeSensitive] = useState(true);
  const [response, setResponse]               = useState<CopilotResponse | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);

  // Load metadata (rounds + investors for selectors)
  const { data: metadata } = useQuery<{ rounds: any[]; investors: any[] }>({
    queryKey: ["/api/capital/copilot/metadata"],
  });

  const rounds    = metadata?.rounds    ?? [];
  const investors = metadata?.investors ?? [];

  // Query mutation
  const queryMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/capital/copilot/query", {
        question:         question.trim(),
        mode,
        round_id:         selectedRoundId ?? undefined,
        investor_id:      selectedInvestorId ?? undefined,
        include_sensitive: includeSensitive,
      });
    },
    onSuccess: (data: any) => {
      setResponse(data);
    },
    onError: () => {
      toast({ title: "Copilot error", description: "Failed to get a response. Try again.", variant: "destructive" });
    },
  });

  function handlePromptSelect(p: { label: string; question: string; mode: CopilotMode }) {
    setMode(p.mode);
    setQuestion(p.question);
    setShowSuggestions(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function handleSubmit() {
    if (!question.trim()) return;
    queryMutation.mutate();
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() =>
      toast({ title: `${label} copied to clipboard` })
    );
  }

  const selectedMode = MODES.find(m => m.value === mode)!;
  const ModeIcon = selectedMode.icon;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background" data-testid="capital-copilot-page">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">Capital AI Copilot</h1>
            <p className="text-xs text-muted-foreground">Fundraising intelligence — Trevor &amp; Scott only</p>
          </div>
        </div>
        <Badge variant="outline" className="text-xs shrink-0 border-primary/30 text-primary" data-testid="badge-restricted-audience">
          Confidential
        </Badge>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

          {/* ── Selectors row ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-3 items-end">
            {/* Round selector */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Round</Label>
              <Select
                value={selectedRoundId ? String(selectedRoundId) : "all"}
                onValueChange={v => setSelectedRoundId(v === "all" ? null : Number(v))}
              >
                <SelectTrigger className="h-8 w-48 text-xs" data-testid="copilot-round-selector">
                  <SelectValue placeholder="All rounds" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All rounds</SelectItem>
                  {rounds.map((r: any) => (
                    <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Investor selector */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Investor</Label>
              <Select
                value={selectedInvestorId ? String(selectedInvestorId) : "all"}
                onValueChange={v => setSelectedInvestorId(v === "all" ? null : Number(v))}
              >
                <SelectTrigger className="h-8 w-48 text-xs" data-testid="copilot-investor-selector">
                  <SelectValue placeholder="All investors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All investors</SelectItem>
                  {investors.map((inv: any) => (
                    <SelectItem key={inv.id} value={String(inv.id)}>{inv.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Include sensitive toggle */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Include Internal</Label>
              <div className="flex items-center gap-2 h-8">
                <Switch
                  checked={includeSensitive}
                  onCheckedChange={setIncludeSensitive}
                  data-testid="copilot-include-sensitive"
                />
                <span className="text-xs text-muted-foreground">
                  {includeSensitive ? "Full context" : "Board-safe"}
                </span>
              </div>
            </div>
          </div>

          {/* ── Mode selector ─────────────────────────────────────────────── */}
          <div data-testid="copilot-mode-selector">
            <Label className="text-xs text-muted-foreground mb-2 block">Mode</Label>
            <div className="flex flex-wrap gap-2">
              {MODES.map(m => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                      mode === m.value
                        ? "bg-primary/15 border-primary/40 text-primary font-medium"
                        : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
                    }`}
                    data-testid={`mode-btn-${m.value}`}
                  >
                    <Icon className="w-3 h-3" />
                    {m.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{selectedMode.description}</p>
          </div>

          {/* ── Suggested prompts ─────────────────────────────────────────── */}
          <div data-testid="copilot-suggested-prompts">
            <button
              onClick={() => setShowSuggestions(!showSuggestions)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              {showSuggestions ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Suggested prompts
            </button>
            {showSuggestions && (
              <div className="space-y-3">
                {SUGGESTED_PROMPTS.map(cat => (
                  <div key={cat.category}>
                    <p className="text-xs text-muted-foreground/60 mb-1.5">{cat.category}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {cat.prompts.map(p => (
                        <button
                          key={p.label}
                          onClick={() => handlePromptSelect(p)}
                          className="px-2.5 py-1 rounded-full border border-border/50 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
                          data-testid={`prompt-btn-${p.label.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Question input ────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Textarea
              ref={textareaRef}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder={`Ask the Capital Copilot anything about your fundraise…`}
              className="min-h-[100px] text-sm resize-none"
              data-testid="copilot-question-input"
              onKeyDown={e => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">⌘↵ to submit</span>
              <Button
                onClick={handleSubmit}
                disabled={!question.trim() || queryMutation.isPending}
                size="sm"
                className="gap-1.5"
                data-testid="btn-copilot-submit"
              >
                {queryMutation.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…</>
                  : <><Send className="w-3.5 h-3.5" /> Ask Copilot</>
                }
              </Button>
            </div>
          </div>

          {/* ── Response ─────────────────────────────────────────────────── */}
          {response && (
            <div className="space-y-4 pb-8" data-testid="copilot-response">

              {/* Answer card */}
              <Card className="border-primary/20 bg-primary/3">
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ModeIcon className="w-4 h-4 text-primary" />
                      <CardTitle className="text-sm font-medium">
                        {selectedMode.label} — {new Date(response.generated_at).toLocaleTimeString()}
                      </CardTitle>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => copyToClipboard(response.answer, "Answer")}
                      data-testid="btn-copy-answer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid="copilot-answer-text">
                    {response.answer}
                  </p>
                </CardContent>
              </Card>

              {/* Warnings */}
              {response.warnings.length > 0 && (
                <Card className="border-amber-500/20 bg-amber-500/5" data-testid="copilot-warnings">
                  <CardContent className="px-4 py-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      {response.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-amber-300">{w}</p>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Draft email output */}
              {response.draft_output && (
                <Card className="border-blue-500/20 bg-blue-500/5" data-testid="copilot-draft-output">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <MailOpen className="w-4 h-4 text-blue-400" />
                        <CardTitle className="text-sm font-medium text-blue-300">Draft Email — Do Not Send Without Review</CardTitle>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => copyToClipboard(
                          `Subject: ${response.draft_output!.subject}\n\n${response.draft_output!.body}`,
                          "Draft email"
                        )}
                        data-testid="btn-copy-draft"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Subject</p>
                      <p className="text-sm font-medium" data-testid="draft-subject">{response.draft_output.subject}</p>
                    </div>
                    <Separator />
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Body</p>
                      <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed" data-testid="draft-body">
                        {response.draft_output.body}
                      </pre>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Tone: {response.draft_output.tone}</span>
                      {response.draft_output.target_contact && (
                        <span>To: {response.draft_output.target_contact}</span>
                      )}
                    </div>
                    {response.draft_output.warnings?.length > 0 && (
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-300">{response.draft_output.warnings.join("; ")}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Recommended actions */}
              {response.recommended_actions.length > 0 && (
                <div data-testid="copilot-recommended-actions">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Recommended Actions ({response.recommended_actions.length})
                  </p>
                  <div className="space-y-2">
                    {response.recommended_actions.map((action, i) => (
                      <Card key={i} className="border-border/50" data-testid={`action-card-${i}`}>
                        <CardContent className="px-4 py-3 flex items-start gap-3">
                          <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[action.priority] ?? PRIORITY_COLORS.medium}`}>
                              {action.priority}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{action.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <Badge variant="outline" className="text-xs h-4 px-1.5">
                                {ACTION_TYPE_LABELS[action.action_type] ?? action.action_type}
                              </Badge>
                              {action.source_signal && (
                                <span className="text-xs text-muted-foreground/60">{action.source_signal}</span>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Context used */}
              {response.context_used.length > 0 && (
                <div data-testid="copilot-context-used">
                  <p className="text-xs text-muted-foreground mb-1.5">Sources used</p>
                  <div className="flex flex-wrap gap-1.5">
                    {response.context_used.map(src => (
                      <span key={src} className="text-xs px-2 py-0.5 rounded-full bg-muted/40 border border-border/50 text-muted-foreground">
                        {src}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* Empty state */}
          {!response && !queryMutation.isPending && (
            <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="copilot-empty-state">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6 text-primary/60" />
              </div>
              <p className="text-sm text-muted-foreground max-w-xs">
                Select a mode, choose a suggested prompt or write your own, and ask the Copilot.
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
