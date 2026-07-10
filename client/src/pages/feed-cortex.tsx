import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import {
  Brain, Send, Globe, Clock, Sparkles, ExternalLink, CheckCircle2,
  AlertCircle, Loader2, CornerDownRight, Zap, ChevronRight, Info,
  BarChart3, Tag, User, Calendar,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─────────────────────────────────────────────────────────────────────────────
// Shared animation CSS — cortex-breathe runs on both SVG wrapper and Feed btn
// at identical timing → perfect lockstep. Reduced-motion kills both.
// ─────────────────────────────────────────────────────────────────────────────
const ANIM_CSS = `
  @keyframes cortex-breathe {
    0%, 100% { opacity: 0.82; filter: drop-shadow(0 0 10px rgba(20,184,166,0.18)); }
    50%       { opacity: 1.00; filter: drop-shadow(0 0 36px rgba(20,184,166,0.70)); }
  }
  @keyframes cortex-btn-glow {
    0%, 100% { box-shadow: 0 0 0px  0px rgba(20,184,166,0.00); }
    50%       { box-shadow: 0 0 22px 4px rgba(20,184,166,0.55); }
  }
  @keyframes ring-breathe-1 {
    0%,100%{ opacity:0.10; } 50%{ opacity:0.32; }
  }
  @keyframes ring-breathe-2 {
    0%,100%{ opacity:0.18; } 50%{ opacity:0.42; }
  }
  @keyframes ring-breathe-3 {
    0%,100%{ opacity:0.25; } 50%{ opacity:0.58; }
  }
  @keyframes orb-pulse {
    0%,100%{ r:46; opacity:0.88; } 50%{ r:52; opacity:1.0; }
  }
  @keyframes node-glow {
    0%,100%{ opacity:0.50; r:5; } 50%{ opacity:1.0; r:7; }
  }
  @keyframes node-glow-2 {
    0%,100%{ opacity:0.38; r:4; } 50%{ opacity:0.88; r:6; }
  }
  @keyframes arc-flash-1 { 0%,100%{opacity:0.08;} 30%,70%{opacity:0.45;} }
  @keyframes arc-flash-2 { 0%,100%{opacity:0.05;} 40%,60%{opacity:0.35;} }
  @keyframes arc-flash-3 { 0%,40%{opacity:0.04;} 50%{opacity:0.52;} 60%,100%{opacity:0.04;} }
  @keyframes arc-flash-4 { 0%,70%{opacity:0.04;} 75%{opacity:0.48;} 80%,100%{opacity:0.04;} }
  @keyframes scan-line {
    0%  { transform:translateY(-180px); opacity:0; }
    10% { opacity:0.6; }
    90% { opacity:0.6; }
    100%{ transform:translateY(180px);  opacity:0; }
  }

  .cortex-breathe-svg { animation: cortex-breathe 4s ease-in-out infinite; }
  .cortex-breathe-btn { animation: cortex-btn-glow 4s ease-in-out infinite; }

  /* Digesting = faster pulse while ingest pending */
  .cortex-digesting .cortex-breathe-svg { animation-duration: 1.1s !important; }
  .cortex-digesting .cortex-breathe-btn { animation-duration: 1.1s !important; }

  .ring-1 { animation: ring-breathe-1 4s ease-in-out infinite; }
  .ring-2 { animation: ring-breathe-2 4s ease-in-out infinite 0.8s; }
  .ring-3 { animation: ring-breathe-3 4s ease-in-out infinite 1.6s; }
  .orb    { animation: orb-pulse 4s ease-in-out infinite; }
  .n-i    { animation: node-glow   2.4s ease-in-out infinite; }
  .n-o    { animation: node-glow-2 3.2s ease-in-out infinite; }
  .arc-a  { animation: arc-flash-1 3.0s ease-in-out infinite; }
  .arc-b  { animation: arc-flash-2 2.5s ease-in-out infinite 0.7s; }
  .arc-c  { animation: arc-flash-3 4.0s ease-in-out infinite 1.2s; }
  .arc-d  { animation: arc-flash-4 3.5s ease-in-out infinite 2.1s; }
  .arc-e  { animation: arc-flash-1 2.8s ease-in-out infinite 0.4s; }
  .arc-f  { animation: arc-flash-3 3.3s ease-in-out infinite 1.8s; }
  .scan   { animation: scan-line   6s  linear     infinite; }

  @media (prefers-reduced-motion: reduce) {
    .cortex-breathe-svg,
    .cortex-breathe-btn,
    .cortex-digesting .cortex-breathe-svg,
    .cortex-digesting .cortex-breathe-btn,
    .ring-1, .ring-2, .ring-3,
    .orb, .n-i, .n-o,
    .arc-a,.arc-b,.arc-c,.arc-d,.arc-e,.arc-f,
    .scan { animation: none !important; }
  }
`;

// ─── Brain SVG ────────────────────────────────────────────────────────────────

function CortexBrainVisual() {
  return (
    <svg
      viewBox="0 0 400 400"
      width="300"
      height="300"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="orbGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#2dd4bf" stopOpacity="1" />
          <stop offset="60%"  stopColor="#0d9488" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#134e4a" stopOpacity="0.6" />
        </radialGradient>
        <radialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#14b8a6" stopOpacity="0.22" />
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
        <clipPath id="brainClip"><circle cx="200" cy="200" r="175" /></clipPath>
      </defs>

      <circle cx="200" cy="200" r="175" fill="url(#glowGrad)" />
      <circle className="ring-1" cx="200" cy="200" r="165" fill="none" stroke="#14b8a6" strokeWidth="1" />
      <circle className="ring-2" cx="200" cy="200" r="128" fill="none" stroke="#2dd4bf" strokeWidth="1.5" />
      <circle className="ring-3" cx="200" cy="200" r="95"  fill="none" stroke="#5eead4" strokeWidth="2" />

      <line className="arc-d" x1="55"  y1="200" x2="345" y2="200" stroke="#14b8a6" strokeWidth="0.8" />
      <line className="arc-f" x1="200" y1="55"  x2="200" y2="345" stroke="#14b8a6" strokeWidth="0.8" />
      <line className="arc-b" x1="97"  y1="97"  x2="303" y2="303" stroke="#2dd4bf" strokeWidth="0.8" />
      <line className="arc-c" x1="303" y1="97"  x2="97"  y2="303" stroke="#2dd4bf" strokeWidth="0.8" />

      <line className="arc-a" x1="280" y1="200" x2="345" y2="200" stroke="#5eead4" strokeWidth="1.2" />
      <line className="arc-b" x1="240" y1="269" x2="303" y2="303" stroke="#5eead4" strokeWidth="1.2" />
      <line className="arc-c" x1="160" y1="269" x2="97"  y2="303" stroke="#5eead4" strokeWidth="1.2" />
      <line className="arc-d" x1="120" y1="200" x2="55"  y2="200" stroke="#5eead4" strokeWidth="1.2" />
      <line className="arc-e" x1="160" y1="131" x2="97"  y2="97"  stroke="#5eead4" strokeWidth="1.2" />
      <line className="arc-f" x1="240" y1="131" x2="303" y2="97"  stroke="#5eead4" strokeWidth="1.2" />
      <line className="arc-a" x1="200" y1="120" x2="200" y2="55"  stroke="#5eead4" strokeWidth="1.2" />
      <line className="arc-c" x1="200" y1="280" x2="200" y2="345" stroke="#5eead4" strokeWidth="1.2" />
      <line className="arc-b" x1="200" y1="200" x2="280" y2="200" stroke="#0d9488" strokeWidth="1" />
      <line className="arc-d" x1="200" y1="200" x2="240" y2="269" stroke="#0d9488" strokeWidth="1" />
      <line className="arc-a" x1="200" y1="200" x2="160" y2="269" stroke="#0d9488" strokeWidth="1" />
      <line className="arc-e" x1="200" y1="200" x2="120" y2="200" stroke="#0d9488" strokeWidth="1" />
      <line className="arc-c" x1="200" y1="200" x2="160" y2="131" stroke="#0d9488" strokeWidth="1" />
      <line className="arc-f" x1="200" y1="200" x2="240" y2="131" stroke="#0d9488" strokeWidth="1" />

      <rect className="scan" x="25" y="200" width="350" height="1.5"
        fill="url(#glowGrad)" clipPath="url(#brainClip)" />

      {([
        [345,200],[303,303],[200,345],[97,303],
        [55,200],[97,97],[200,55],[303,97],
      ] as [number,number][]).map(([cx,cy],i) => (
        <circle key={i} className="n-o" cx={cx} cy={cy} r="5"
          fill="url(#nodeGrad)" filter="url(#glow)"
          style={{ animationDelay: `${i*0.4}s` }} />
      ))}
      {([
        [280,200],[240,269],[160,269],
        [120,200],[160,131],[240,131],
      ] as [number,number][]).map(([cx,cy],i) => (
        <circle key={i} className="n-i" cx={cx} cy={cy} r="6"
          fill="url(#nodeGrad)" filter="url(#glow)"
          style={{ animationDelay: `${i*0.3}s` }} />
      ))}
      <circle className="n-i" cx="200" cy="120" r="5.5" fill="url(#nodeGrad)" filter="url(#glow)" />
      <circle className="n-i" cx="200" cy="280" r="5.5" fill="url(#nodeGrad)" filter="url(#glow)" style={{ animationDelay:"1.2s" }} />

      <circle className="orb" cx="200" cy="200" r="46" fill="url(#orbGrad)" />
      <path d="M 184 183 L 200 217 L 216 183"
        stroke="white" strokeWidth="3.5" strokeLinecap="round"
        strokeLinejoin="round" fill="none" opacity="0.92" />
      <text x="200" y="233" textAnchor="middle" fill="white"
        fontSize="8" fontFamily="monospace" letterSpacing="3" opacity="0.7">
        CORTEX
      </text>
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type HistoryRecord = {
  id: number;
  source_url: string;
  canonical_url: string;
  domain: string | null;
  title: string | null;
  intel_type: string;
  importance: string;
  ai_summary: string | null;
  user_notes: string | null;
  tags: string[] | null;
  created_at: string;
  created_by_name: string | null;
  created_by_email: string | null;
  use_in_ai_context: boolean;
};

// ─── Derive point-form bullets from a record ─────────────────────────────────

function deriveBullets(r: HistoryRecord): string[] {
  if (r.ai_summary && r.ai_summary.trim().length > 12) {
    const sentences = r.ai_summary
      .replace(/\n+/g, ". ")
      .split(/\.\s+/)
      .map((s) => s.replace(/^[•\-\*]\s*/, "").trim())
      .filter((s) => s.length > 8);
    if (sentences.length >= 2) {
      return sentences.slice(0, 3).map((s) => (s.length > 90 ? s.slice(0, 87) + "…" : s));
    }
    return [r.ai_summary.slice(0, 100)];
  }
  const bullets: string[] = [];
  if (r.title && r.title !== r.domain) bullets.push(r.title.slice(0, 80));
  if (r.intel_type) bullets.push(`Category: ${r.intel_type}`);
  bullets.push("Captured for Cortex AI context");
  return bullets.slice(0, 3);
}

// ─── Status message ───────────────────────────────────────────────────────────

function cortexStatusMessage(todayCount: number, total: number): string {
  if (todayCount >= 5) return "Cortex is well-fed today";
  if (todayCount >= 1) return "Cortex learned something new today";
  if (total >= 10)     return "Cortex has a solid knowledge base";
  if (total >= 1)      return "Cortex is hungry for more";
  return "Cortex is ready to learn";
}

// ─── Importance badge ─────────────────────────────────────────────────────────

function ImportanceBadge({ importance }: { importance: string }) {
  const map: Record<string, string> = {
    "Critical":               "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/50 dark:text-red-300 dark:border-red-700",
    "Board-Level / Strategic":"bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/50 dark:text-purple-300 dark:border-purple-700",
    "High":                   "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700",
    "Medium":                 "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/50 dark:text-teal-300 dark:border-teal-700",
    "Low":                    "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={`text-xs font-medium ${map[importance] ?? "bg-muted text-muted-foreground border-border"}`}>
      {importance}
    </Badge>
  );
}

// ─── Cortex Status Dialog (brain click) ──────────────────────────────────────

function CortexStatusDialog({
  open, onClose, history, todayRecords,
}: {
  open: boolean;
  onClose: () => void;
  history: HistoryRecord[];
  todayRecords: HistoryRecord[];
}) {
  const aiContextCount = history.filter((r) => r.use_in_ai_context).length;
  const domainFreq: Record<string, number> = {};
  history.forEach((r) => {
    const d = r.domain ?? "unknown";
    domainFreq[d] = (domainFreq[d] ?? 0) + 1;
  });
  const topDomains = Object.entries(domainFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const statusMsg = cortexStatusMessage(todayRecords.length, history.length);
  const mostRecent = history[0];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="dialog-cortex-status">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-teal-500" />
            VoltSafe Cortex Status
          </DialogTitle>
          <DialogDescription>
            The company brain is learning from every approved source.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status pill */}
          <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
              <span className="text-sm font-semibold text-teal-700 dark:text-teal-300">{statusMsg}</span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "URLs learned", value: history.length },
              { label: "Learned today", value: todayRecords.length },
              { label: "In AI context", value: aiContextCount },
              { label: "Unique domains", value: Object.keys(domainFreq).length },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-border bg-card p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Most recent */}
          {mostRecent && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground mb-0.5">Most recent ingestion</p>
              <p className="text-sm font-medium truncate">
                {mostRecent.title ?? mostRecent.domain ?? mostRecent.canonical_url}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(mostRecent.created_at), { addSuffix: true })}
              </p>
            </div>
          )}

          {/* Top domains */}
          {topDomains.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Top domains
              </p>
              <div className="flex flex-wrap gap-2">
                {topDomains.map(([domain, count]) => (
                  <Badge key={domain} variant="secondary" className="text-xs">
                    {domain} <span className="ml-1 opacity-60">×{count}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── URL Detail Dialog (card / row click) ────────────────────────────────────

function UrlDetailDialog({
  record, onClose,
}: {
  record: HistoryRecord | null;
  onClose: () => void;
}) {
  if (!record) return null;
  const bullets = deriveBullets(record);

  return (
    <Dialog open={!!record} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-url-detail">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug pr-4">
            {record.title ?? record.domain ?? record.canonical_url}
          </DialogTitle>
          {record.domain && (
            <DialogDescription className="font-mono text-xs">
              {record.domain}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* What Cortex learned */}
          <div>
            <p className="text-xs font-semibold text-teal-600 dark:text-teal-400 uppercase tracking-wide mb-2">
              What Cortex learned
            </p>
            <ul className="space-y-1.5">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-teal-500 mt-0.5 flex-shrink-0">•</span>
                  <span className="text-foreground/90">{b}</span>
                </li>
              ))}
            </ul>
            {record.user_notes && (
              <p className="mt-2 text-xs text-muted-foreground border-l-2 border-teal-400/40 pl-2">
                Note: {record.user_notes}
              </p>
            )}
          </div>

          <Separator />

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <p className="text-xs text-muted-foreground">Category</p>
              <p className="font-medium">{record.intel_type}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Importance</p>
              <ImportanceBadge importance={record.importance} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Saved by</p>
              <p className="font-medium">{record.created_by_name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Saved at</p>
              <p className="font-medium text-xs">
                {format(new Date(record.created_at), "MMM d, yyyy · h:mm a")}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">AI context</p>
              <span className="flex items-center gap-1 text-xs">
                {record.use_in_ai_context
                  ? <><CheckCircle2 className="w-3.5 h-3.5 text-teal-500" /><span className="text-teal-600 dark:text-teal-400">Active — used when asking Cortex questions</span></>
                  : <><AlertCircle className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">Not in AI context</span></>
                }
              </span>
            </div>
            {record.tags && record.tags.length > 0 && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {record.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => window.open(record.source_url, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Source
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => window.open("/cortex/intel", "_blank")}
            >
              <Brain className="w-3.5 h-3.5" />
              View in Cortex Intel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FeedCortexPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [url, setUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<HistoryRecord | null>(null);

  // ── Fetch history ──
  const historyQuery = useQuery<{ records: HistoryRecord[] }>({
    queryKey: ["/api/cortex/url/history"],
  });
  const history = historyQuery.data?.records ?? [];
  const todayRecords = history.filter((r) => {
    const d = new Date(r.created_at);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  });

  // ── URL ingestion mutation ──
  const ingestMutation = useMutation({
    mutationFn: async (urlToSave: string) =>
      apiRequest("POST", "/api/cortex/url", {
        url: urlToSave,
        category: "Web Resource",
        importance: "Medium",
        useInAiContext: true,
      }),
    onSuccess: () => {
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/url/history"] });
      toast({ title: "Fed to Cortex", description: "Cortex has ingested this URL into its knowledge base." });
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
      const res = await apiRequest("POST", "/api/cortex/ask", { question: q });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.answer) {
        setAnswer(data.answer);
      } else {
        setAnswer(data?.error ?? "Cortex didn't return an answer. Please try again.");
      }
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Could not reach Cortex.";
      setAnswer(`Something went wrong: ${msg}`);
      toast({ title: "Ask failed", description: msg, variant: "destructive" });
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

  const isDigesting = ingestMutation.isPending;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <style>{ANIM_CSS}</style>

      {/* ── Modals ── */}
      <CortexStatusDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        history={history}
        todayRecords={todayRecords}
      />
      <UrlDetailDialog
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
      />

      {/* ── Hero ── */}
      <div className={`flex flex-col items-center pt-10 pb-6 px-4 gap-4 ${isDigesting ? "cortex-digesting" : ""}`}>
        <div className="flex items-center gap-2 mb-1">
          <Brain className="w-4 h-4 text-teal-500" />
          <span className="text-xs tracking-[0.2em] text-teal-500 dark:text-teal-400 font-mono uppercase">
            VoltSafe Intelligence Layer
          </span>
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-center text-foreground">
          Feed <span className="text-teal-500 dark:text-teal-400">CORTEX</span>
        </h1>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Teach Cortex what you know. Paste a URL — Cortex ingests, analyses, and
          synthesises it into actionable intelligence.
        </p>

        {/* Brain visual — clickable, lockstep breathe animation */}
        <button
          type="button"
          onClick={() => setStatusOpen(true)}
          aria-label="View Cortex status"
          data-testid="button-brain-status"
          className="cortex-breathe-svg relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 cursor-pointer group"
          title="Click to view Cortex status"
        >
          <CortexBrainVisual />
          {/* Hover overlay hint */}
          <div className="absolute inset-0 flex items-end justify-center pb-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <span className="text-[10px] font-mono text-teal-300 tracking-wider bg-black/40 rounded px-2 py-0.5">
              VIEW STATUS
            </span>
          </div>
        </button>

        {/* ── URL ingestion card ── */}
        <Card className="w-full max-w-xl border border-border shadow-lg bg-card">
          <CardContent className="pt-5 pb-5">
            <form onSubmit={handleIngest} className="flex gap-2">
              <div className="relative flex-1">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  data-testid="input-feed-cortex-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/article-or-page"
                  className="pl-9 bg-background border-input focus:border-teal-500 focus:ring-teal-500/20"
                  disabled={ingestMutation.isPending}
                />
              </div>
              {/* Feed button — lockstep breathe animation via wrapper */}
              <div className={url.trim() ? "cortex-breathe-btn rounded-md" : ""}>
                <Button
                  type="submit"
                  data-testid="button-feed-cortex-submit"
                  disabled={ingestMutation.isPending || !url.trim()}
                  className="bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-semibold px-5"
                >
                  {ingestMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      Feeding…
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-1.5" />
                      Feed
                    </>
                  )}
                </Button>
              </div>
            </form>
            <p className="text-xs text-muted-foreground mt-2 pl-1">
              Cortex will summarise the content and add it to its knowledge base.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="max-w-5xl mx-auto px-4 pb-16 space-y-8">

        {/* ── What Cortex learned today ── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-teal-500" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">
              What Cortex learned today
            </h2>
            {todayRecords.length > 0 && (
              <Badge className="bg-teal-600 hover:bg-teal-600 text-white text-xs px-2">
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
            <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
              <Brain className="w-9 h-9 text-teal-400/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">
                Cortex hasn't learned anything new today yet.
              </p>
              <p className="text-xs text-muted-foreground">
                Feed it a useful URL above to get started.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {todayRecords.map((r) => {
                const bullets = deriveBullets(r);
                return (
                  <button
                    key={r.id}
                    type="button"
                    data-testid={`card-cortex-today-${r.id}`}
                    onClick={() => setSelectedRecord(r)}
                    className="text-left rounded-xl border border-teal-200 dark:border-teal-800/60 bg-teal-50/60 dark:bg-teal-950/20 hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 group p-4"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">
                        {r.title ?? r.domain ?? r.canonical_url}
                      </p>
                      <a
                        href={r.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-teal-500 flex-shrink-0 mt-0.5 p-1 -m-1 rounded"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono mb-2">
                      {r.domain ?? r.canonical_url}
                    </p>

                    {/* Ultra-brief point-form bullets */}
                    <ul className="space-y-1 mb-3" data-testid={`bullets-today-${r.id}`}>
                      {bullets.map((b, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-teal-500 dark:text-teal-400 text-[10px] mt-1 flex-shrink-0">•</span>
                          <span className="text-xs text-foreground/80 leading-relaxed">{b}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <ImportanceBadge importance={r.importance} />
                        {r.use_in_ai_context && (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                            <CheckCircle2 className="w-3 h-3" />
                            In AI context
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        View details <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Separator />

        {/* ── Two-column: History | Ask Cortex ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* ── Ingestion History ── */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">
                Ingestion History
              </h2>
              {history.length > 0 && (
                <Badge variant="outline" className="text-xs border-border text-muted-foreground">
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
              <div className="rounded-lg border-2 border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium text-foreground mb-1">No URLs ingested yet.</p>
                <p className="text-xs text-muted-foreground">Paste a URL above to start building Cortex's knowledge base.</p>
              </div>
            ) : (
              <div
                className="space-y-2 overflow-y-auto"
                style={{ maxHeight: "480px" }}
                data-testid="list-cortex-history"
              >
                {history.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    data-testid={`row-cortex-history-${r.id}`}
                    onClick={() => setSelectedRecord(r)}
                    className="w-full text-left flex items-start gap-3 rounded-lg border border-border bg-card p-3 hover:border-teal-300 dark:hover:border-teal-700 hover:bg-accent/40 hover:shadow-sm transition-all cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  >
                    <Globe className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-semibold text-foreground leading-snug line-clamp-1">
                          {r.title ?? r.domain ?? r.canonical_url}
                        </p>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <a
                            href={r.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-teal-500 p-0.5 rounded"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                        {r.domain ?? r.canonical_url}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
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
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Ask Cortex ── */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-4 h-4 text-teal-500" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">
                Ask Cortex
              </h2>
            </div>
            <Card className="border border-border shadow-sm bg-card">
              <CardContent className="pt-5 pb-5 space-y-4">
                <form onSubmit={handleAsk} className="space-y-3">
                  <Textarea
                    data-testid="textarea-cortex-ask"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="What do you know about marina EV charging regulations? What are the key trends in this space?"
                    className="min-h-[96px] bg-background border-input focus:border-teal-500 focus:ring-teal-500/20 resize-none text-sm"
                    disabled={askMutation.isPending}
                  />
                  <Button
                    type="submit"
                    data-testid="button-cortex-ask-submit"
                    disabled={askMutation.isPending || !question.trim()}
                    className="w-full bg-teal-700 hover:bg-teal-600 active:bg-teal-800 text-white font-semibold"
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

                {askMutation.isPending && (
                  <div className="flex items-center gap-2 text-teal-500 text-xs animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Synthesising from ingested knowledge…
                  </div>
                )}

                {answer && !askMutation.isPending && (
                  <div
                    data-testid="text-cortex-answer"
                    className="rounded-lg border border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 p-4"
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <CornerDownRight className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                      <span className="text-xs font-bold text-teal-700 dark:text-teal-300 uppercase tracking-wider">
                        Cortex says
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                      {answer}
                    </p>
                  </div>
                )}

                {askMutation.isError && (
                  <div className="flex items-start gap-2 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>Failed to get answer. Ensure URLs have been ingested first.</span>
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

        {/* Footer */}
        <div className="flex items-center justify-center gap-2 pt-2">
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            All ingested URLs are also visible in the{" "}
            <a href="/cortex/intel" className="text-teal-600 dark:text-teal-400 hover:underline font-medium">
              Cortex Intel Library
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
