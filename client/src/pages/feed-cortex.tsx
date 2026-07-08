import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import {
  Brain, Send, Globe, Clock, Sparkles, ExternalLink,
  CheckCircle2, AlertCircle, Loader2, CornerDownRight,
  Zap, ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Animated Brain SVG ──────────────────────────────────────────────────────

function CortexBrainVisual() {
  return (
    <>
      <style>{`
        @keyframes ring-breathe-1 {
          0%, 100% { opacity: 0.10; r: 165; }
          50%       { opacity: 0.30; r: 170; }
        }
        @keyframes ring-breathe-2 {
          0%, 100% { opacity: 0.18; r: 128; }
          50%       { opacity: 0.40; r: 134; }
        }
        @keyframes ring-breathe-3 {
          0%, 100% { opacity: 0.25; r: 95; }
          50%       { opacity: 0.55; r: 100; }
        }
        @keyframes orb-pulse {
          0%, 100% { r: 46; opacity: 0.9; }
          50%       { r: 52; opacity: 1.0; }
        }
        @keyframes node-glow {
          0%, 100% { opacity: 0.55; r: 5; }
          50%       { opacity: 1.0;  r: 7; }
        }
        @keyframes node-glow-2 {
          0%, 100% { opacity: 0.40; r: 4; }
          50%       { opacity: 0.90; r: 6; }
        }
        @keyframes arc-flash-1 {
          0%, 100% { opacity: 0.08; }
          30%, 70% { opacity: 0.45; }
        }
        @keyframes arc-flash-2 {
          0%, 100% { opacity: 0.05; }
          40%, 60% { opacity: 0.35; }
        }
        @keyframes arc-flash-3 {
          0%, 40%  { opacity: 0.04; }
          50%      { opacity: 0.55; }
          60%, 100%{ opacity: 0.04; }
        }
        @keyframes arc-flash-4 {
          0%, 70%  { opacity: 0.04; }
          75%      { opacity: 0.50; }
          80%, 100%{ opacity: 0.04; }
        }
        @keyframes scan-line {
          0%   { transform: translateY(-180px); opacity: 0; }
          10%  { opacity: 0.6; }
          90%  { opacity: 0.6; }
          100% { transform: translateY(180px); opacity: 0; }
        }
        .ring-1 { animation: ring-breathe-1 4s ease-in-out infinite; }
        .ring-2 { animation: ring-breathe-2 4s ease-in-out infinite 0.8s; }
        .ring-3 { animation: ring-breathe-3 4s ease-in-out infinite 1.6s; }
        .orb    { animation: orb-pulse 3s ease-in-out infinite; }
        .n-i    { animation: node-glow   2.4s ease-in-out infinite; }
        .n-o    { animation: node-glow-2 3.2s ease-in-out infinite; }
        .arc-a  { animation: arc-flash-1 3.0s ease-in-out infinite; }
        .arc-b  { animation: arc-flash-2 2.5s ease-in-out infinite 0.7s; }
        .arc-c  { animation: arc-flash-3 4.0s ease-in-out infinite 1.2s; }
        .arc-d  { animation: arc-flash-4 3.5s ease-in-out infinite 2.1s; }
        .arc-e  { animation: arc-flash-1 2.8s ease-in-out infinite 0.4s; }
        .arc-f  { animation: arc-flash-3 3.3s ease-in-out infinite 1.8s; }
        .scan   { animation: scan-line 6s linear infinite; }
      `}</style>

      <svg
        viewBox="0 0 400 400"
        width="320"
        height="320"
        aria-hidden="true"
        style={{ filter: "drop-shadow(0 0 24px rgba(20,184,166,0.35))" }}
      >
        <defs>
          <radialGradient id="orbGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#2dd4bf" stopOpacity="1" />
            <stop offset="60%"  stopColor="#0d9488" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#134e4a" stopOpacity="0.6" />
          </radialGradient>
          <radialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#14b8a6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="nodeGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#5eead4" stopOpacity="1" />
            <stop offset="100%" stopColor="#0d9488" stopOpacity="0.7" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id="brainClip">
            <circle cx="200" cy="200" r="175" />
          </clipPath>
        </defs>

        {/* Background ambient glow */}
        <circle cx="200" cy="200" r="175" fill="url(#glowGrad)" />

        {/* Outer ring */}
        <circle className="ring-1" cx="200" cy="200" r="165"
          fill="none" stroke="#14b8a6" strokeWidth="1" />

        {/* Middle ring */}
        <circle className="ring-2" cx="200" cy="200" r="128"
          fill="none" stroke="#2dd4bf" strokeWidth="1.5" />

        {/* Inner ring */}
        <circle className="ring-3" cx="200" cy="200" r="95"
          fill="none" stroke="#5eead4" strokeWidth="2" />

        {/* ── Outer-ring node connections (arc-d, arc-f) ── */}
        {/* horizontal cross */}
        <line className="arc-d" x1="55" y1="200" x2="345" y2="200" stroke="#14b8a6" strokeWidth="0.8" />
        <line className="arc-f" x1="200" y1="55" x2="200" y2="345" stroke="#14b8a6" strokeWidth="0.8" />
        {/* diagonals */}
        <line className="arc-b" x1="97" y1="97" x2="303" y2="303" stroke="#2dd4bf" strokeWidth="0.8" />
        <line className="arc-c" x1="303" y1="97" x2="97" y2="303" stroke="#2dd4bf" strokeWidth="0.8" />

        {/* ── Inner-ring spokes to outer nodes ── */}
        <line className="arc-a" x1="280" y1="200" x2="345" y2="200" stroke="#5eead4" strokeWidth="1.2" />
        <line className="arc-b" x1="240" y1="269" x2="303" y2="303" stroke="#5eead4" strokeWidth="1.2" />
        <line className="arc-c" x1="160" y1="269" x2="97"  y2="303" stroke="#5eead4" strokeWidth="1.2" />
        <line className="arc-d" x1="120" y1="200" x2="55"  y2="200" stroke="#5eead4" strokeWidth="1.2" />
        <line className="arc-e" x1="160" y1="131" x2="97"  y2="97"  stroke="#5eead4" strokeWidth="1.2" />
        <line className="arc-f" x1="240" y1="131" x2="303" y2="97"  stroke="#5eead4" strokeWidth="1.2" />
        <line className="arc-a" x1="200" y1="120" x2="200" y2="55"  stroke="#5eead4" strokeWidth="1.2" />
        <line className="arc-c" x1="200" y1="280" x2="200" y2="345" stroke="#5eead4" strokeWidth="1.2" />

        {/* ── Center-to-inner spokes ── */}
        <line className="arc-b" x1="200" y1="200" x2="280" y2="200" stroke="#0d9488" strokeWidth="1" />
        <line className="arc-d" x1="200" y1="200" x2="240" y2="269" stroke="#0d9488" strokeWidth="1" />
        <line className="arc-a" x1="200" y1="200" x2="160" y2="269" stroke="#0d9488" strokeWidth="1" />
        <line className="arc-e" x1="200" y1="200" x2="120" y2="200" stroke="#0d9488" strokeWidth="1" />
        <line className="arc-c" x1="200" y1="200" x2="160" y2="131" stroke="#0d9488" strokeWidth="1" />
        <line className="arc-f" x1="200" y1="200" x2="240" y2="131" stroke="#0d9488" strokeWidth="1" />

        {/* Scan line (optional subtle sweep) */}
        <rect className="scan" x="25" y="200" width="350" height="1.5"
          fill="url(#glowGrad)" clipPath="url(#brainClip)" />

        {/* ── Outer ring nodes (8) ── */}
        {[
          [345, 200], [303, 303], [200, 345], [97, 303],
          [55,  200], [97,  97],  [200, 55],  [303, 97],
        ].map(([cx, cy], i) => (
          <circle key={i} className="n-o" cx={cx} cy={cy} r="5"
            fill="url(#nodeGrad)" filter="url(#glow)"
            style={{ animationDelay: `${i * 0.4}s` }} />
        ))}

        {/* ── Inner ring nodes (6) ── */}
        {[
          [280, 200], [240, 269], [160, 269],
          [120, 200], [160, 131], [240, 131],
        ].map(([cx, cy], i) => (
          <circle key={i} className="n-i" cx={cx} cy={cy} r="6"
            fill="url(#nodeGrad)" filter="url(#glow)"
            style={{ animationDelay: `${i * 0.3}s` }} />
        ))}

        {/* Top/bottom nodes on inner ring */}
        <circle className="n-i" cx="200" cy="120" r="5.5" fill="url(#nodeGrad)" filter="url(#glow)" />
        <circle className="n-i" cx="200" cy="280" r="5.5" fill="url(#nodeGrad)" filter="url(#glow)" style={{ animationDelay: "1.2s" }} />

        {/* ── Central orb ── */}
        <circle className="orb" cx="200" cy="200" r="46" fill="url(#orbGrad)" />

        {/* VoltSafe "V" mark at center */}
        <path
          d="M 184 183 L 200 217 L 216 183"
          stroke="white" strokeWidth="3.5" strokeLinecap="round"
          strokeLinejoin="round" fill="none" opacity="0.92"
        />
        <text x="200" y="233" textAnchor="middle" fill="white"
          fontSize="8" fontFamily="monospace" letterSpacing="3" opacity="0.7">
          CORTEX
        </text>
      </svg>
    </>
  );
}

// ─── History item shape ───────────────────────────────────────────────────────

type HistoryRecord = {
  id: number;
  source_url: string;
  canonical_url: string;
  domain: string;
  title: string | null;
  intel_type: string;
  importance: string;
  ai_summary: string | null;
  created_at: string;
  created_by_name: string | null;
  created_by_email: string | null;
  use_in_ai_context: boolean;
};

// ─── Import importance badge color ───────────────────────────────────────────

function ImportanceBadge({ importance }: { importance: string }) {
  const colorMap: Record<string, string> = {
    "Critical":               "bg-red-900/50 text-red-300 border-red-700",
    "Board-Level / Strategic":"bg-purple-900/50 text-purple-300 border-purple-700",
    "High":                   "bg-orange-900/50 text-orange-300 border-orange-700",
    "Medium":                 "bg-teal-900/50 text-teal-300 border-teal-700",
    "Low":                    "bg-slate-800 text-slate-400 border-slate-600",
  };
  return (
    <Badge variant="outline" className={`text-xs ${colorMap[importance] ?? "bg-slate-800 text-slate-400 border-slate-600"}`}>
      {importance}
    </Badge>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FeedCortexPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [url, setUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch history ──
  const historyQuery = useQuery<{ records: HistoryRecord[] }>({
    queryKey: ["/api/cortex/url/history"],
  });

  const history = historyQuery.data?.records ?? [];
  const todayRecords = history.filter((r) => {
    const d = new Date(r.created_at);
    const today = new Date();
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  });

  // ── URL ingestion mutation ──
  const ingestMutation = useMutation({
    mutationFn: async (urlToSave: string) => {
      return apiRequest("POST", "/api/cortex/url", {
        url: urlToSave,
        category: "Web Resource",
        importance: "Medium",
        useInAiContext: true,
      });
    },
    onSuccess: () => {
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/url/history"] });
      toast({
        title: "Fed to Cortex",
        description: "Cortex has ingested this URL into its knowledge base.",
      });
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Failed to ingest URL";
      if (msg.includes("already been saved")) {
        toast({ title: "Already known", description: "Cortex already has this URL in its knowledge base." });
      } else {
        toast({ title: "Ingestion failed", description: msg, variant: "destructive" });
      }
    },
  });

  // ── Ask Cortex mutation ──
  const askMutation = useMutation({
    mutationFn: async (q: string) => {
      return apiRequest("POST", "/api/cortex/ask", { question: q });
    },
    onSuccess: (data: any) => {
      setAnswer(data?.answer ?? "No answer returned.");
    },
    onError: (err: any) => {
      toast({ title: "Ask failed", description: err?.message ?? "Could not reach Cortex.", variant: "destructive" });
    },
  });

  function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      toast({ title: "Invalid URL", description: "Must start with http:// or https://", variant: "destructive" });
      return;
    }
    ingestMutation.mutate(trimmed);
  }

  function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setAnswer(null);
    askMutation.mutate(q);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Hero section ── */}
      <div className="flex flex-col items-center pt-10 pb-6 px-4 gap-4">
        <div className="flex items-center gap-2 mb-1">
          <Brain className="w-5 h-5 text-teal-400" />
          <span className="text-xs tracking-[0.2em] text-teal-400 font-mono uppercase">
            VoltSafe Intelligence Layer
          </span>
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-center">
          Feed <span className="text-teal-400">CORTEX</span>
        </h1>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Teach Cortex what you know. Paste a URL — Cortex ingests, analyses, and
          synthesises it into actionable intelligence.
        </p>

        {/* Brain animation */}
        <div className="relative my-2">
          <CortexBrainVisual />
        </div>

        {/* ── URL ingestion input ── */}
        <Card className="w-full max-w-xl border-teal-800/40 bg-card/80 backdrop-blur shadow-xl">
          <CardContent className="pt-5 pb-5">
            <form onSubmit={handleIngest} className="flex gap-2">
              <div className="relative flex-1">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  data-testid="input-feed-cortex-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/article-or-page"
                  className="pl-9 bg-background border-border/60 focus:border-teal-500"
                  disabled={ingestMutation.isPending}
                />
              </div>
              <Button
                type="submit"
                data-testid="button-feed-cortex-submit"
                disabled={ingestMutation.isPending || !url.trim()}
                className="bg-teal-600 hover:bg-teal-500 text-white"
              >
                {ingestMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-1" />
                    Feed
                  </>
                )}
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground mt-2 pl-1">
              Cortex will summarise the content and add it to its knowledge base.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="max-w-5xl mx-auto px-4 pb-16 space-y-8">
        {/* ── What Cortex learned today ── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-teal-400" />
            <h2 className="text-sm font-semibold text-teal-400 tracking-wide uppercase">
              What Cortex learned today
            </h2>
            {todayRecords.length > 0 && (
              <Badge className="bg-teal-900/50 text-teal-300 border-teal-700 text-xs">
                {todayRecords.length} new
              </Badge>
            )}
          </div>

          {historyQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          ) : todayRecords.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/50 p-6 text-center">
              <Brain className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">
                Nothing ingested yet today. Feed Cortex a URL above to get started.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {todayRecords.map((r) => (
                <Card
                  key={r.id}
                  data-testid={`card-cortex-today-${r.id}`}
                  className="border-teal-800/30 bg-card/60 hover:bg-card transition-colors"
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-medium leading-snug line-clamp-2">
                        {r.title ?? r.domain ?? r.canonical_url}
                      </p>
                      <a
                        href={r.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-teal-400 flex-shrink-0 mt-0.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-2 font-mono">
                      {r.domain ?? r.canonical_url}
                    </p>
                    {r.ai_summary && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {r.ai_summary}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <ImportanceBadge importance={r.importance} />
                      {r.use_in_ai_context && (
                        <span className="flex items-center gap-1 text-[10px] text-teal-500">
                          <CheckCircle2 className="w-3 h-3" />
                          In AI context
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <Separator className="border-border/40" />

        {/* ── Two-column layout: History | Ask Cortex ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ── Ingestion history ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground/80 tracking-wide uppercase">
                Ingestion History
              </h2>
              {history.length > 0 && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {history.length} URLs
                </Badge>
              )}
            </div>

            {historyQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading history…
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/50 p-6 text-center">
                <p className="text-sm text-muted-foreground">No URLs ingested yet.</p>
              </div>
            ) : (
              <div
                className="space-y-2 overflow-y-auto"
                style={{ maxHeight: "480px" }}
                data-testid="list-cortex-history"
              >
                {history.map((r) => (
                  <div
                    key={r.id}
                    data-testid={`row-cortex-history-${r.id}`}
                    className="flex items-start gap-3 rounded-lg border border-border/40 bg-card/50 p-3 hover:bg-card transition-colors group"
                  >
                    <Globe className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-medium leading-snug line-clamp-1">
                          {r.title ?? r.domain ?? r.canonical_url}
                        </p>
                        <a
                          href={r.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-teal-400 flex-shrink-0"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                        {r.domain ?? r.canonical_url}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <ImportanceBadge importance={r.importance} />
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </span>
                        {r.created_by_name && (
                          <span className="text-[10px] text-muted-foreground">
                            · {r.created_by_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Ask Cortex ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-teal-400" />
              <h2 className="text-sm font-semibold text-foreground/80 tracking-wide uppercase">
                Ask Cortex
              </h2>
            </div>
            <Card className="border-teal-800/30 bg-card/60">
              <CardContent className="pt-5 pb-5 space-y-4">
                <form onSubmit={handleAsk} className="space-y-3">
                  <Textarea
                    ref={questionRef}
                    data-testid="textarea-cortex-ask"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="What do you know about marina EV charging regulations? What are the key trends in this space?"
                    className="min-h-[96px] bg-background border-border/60 focus:border-teal-500 resize-none text-sm"
                    disabled={askMutation.isPending}
                  />
                  <Button
                    type="submit"
                    data-testid="button-cortex-ask-submit"
                    disabled={askMutation.isPending || !question.trim()}
                    className="w-full bg-teal-700 hover:bg-teal-600 text-white"
                  >
                    {askMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Cortex is thinking…
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Ask Cortex
                      </>
                    )}
                  </Button>
                </form>

                {/* Answer */}
                {askMutation.isPending && (
                  <div className="flex items-center gap-2 text-teal-400 text-sm animate-pulse">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Synthesising from ingested knowledge…
                  </div>
                )}

                {answer && !askMutation.isPending && (
                  <div
                    data-testid="text-cortex-answer"
                    className="rounded-lg border border-teal-800/40 bg-teal-950/30 p-4"
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <CornerDownRight className="w-3.5 h-3.5 text-teal-400" />
                      <span className="text-xs font-mono text-teal-400 uppercase tracking-wider">
                        Cortex says
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                      {answer}
                    </p>
                  </div>
                )}

                {askMutation.isError && (
                  <div className="flex items-start gap-2 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>Failed to get answer. Check that URLs have been ingested first.</span>
                  </div>
                )}

                {!answer && !askMutation.isPending && !askMutation.isError && history.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Feed Cortex some URLs first — then ask anything about the ingested content.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-center gap-2 pt-2">
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            All ingested URLs are also visible in the{" "}
            <a href="/cortex/intel" className="text-teal-400 hover:underline">
              Cortex Intel Library
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
