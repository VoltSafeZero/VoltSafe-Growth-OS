import { useState, useRef, useCallback, useEffect } from "react";
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
  AlertCircle, Loader2, Zap, ChevronRight, Info,
  FileText, FolderOpen, Image, Mic, Play, Upload, X, Square,
  Circle, RotateCcw, Trash2, File, Volume2,
  Shield, Plus, ToggleLeft, ToggleRight, Pencil,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDistanceToNow, format } from "date-fns";

// ─────────────────────────────────────────────────────────────────────────────
// Animation CSS — cortex-breathe + card hover + mode card effects
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
  @keyframes ring-breathe-1 { 0%,100%{ opacity:0.10; } 50%{ opacity:0.32; } }
  @keyframes ring-breathe-2 { 0%,100%{ opacity:0.18; } 50%{ opacity:0.42; } }
  @keyframes ring-breathe-3 { 0%,100%{ opacity:0.25; } 50%{ opacity:0.58; } }
  @keyframes orb-pulse       { 0%,100%{ r:46; opacity:0.88; } 50%{ r:52; opacity:1.0; } }
  @keyframes node-glow       { 0%,100%{ opacity:0.50; r:5; } 50%{ opacity:1.0; r:7; } }
  @keyframes node-glow-2     { 0%,100%{ opacity:0.38; r:4; } 50%{ opacity:0.88; r:6; } }
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
  @keyframes mode-card-glow {
    0%,100% { box-shadow: 0 0 0px 0px rgba(20,184,166,0.0); }
    50%     { box-shadow: 0 0 18px 3px rgba(20,184,166,0.35); }
  }
  @keyframes mic-pulse {
    0%,100% { transform: scale(1); opacity: 1; }
    50%     { transform: scale(1.15); opacity: 0.85; }
  }
  @keyframes progress-shimmer {
    0%   { background-position: -200% center; }
    100% { background-position: 200% center; }
  }

  .cortex-breathe-svg { animation: cortex-breathe 4s ease-in-out infinite; }
  .cortex-breathe-btn { animation: cortex-btn-glow 4s ease-in-out infinite; }
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
  .mode-card-active { animation: mode-card-glow 2.5s ease-in-out infinite; }
  .mic-recording { animation: mic-pulse 1s ease-in-out infinite; }

  @media (prefers-reduced-motion: reduce) {
    .cortex-breathe-svg, .cortex-breathe-btn,
    .cortex-digesting .cortex-breathe-svg, .cortex-digesting .cortex-breathe-btn,
    .ring-1,.ring-2,.ring-3,.orb,.n-i,.n-o,
    .arc-a,.arc-b,.arc-c,.arc-d,.arc-e,.arc-f,.scan,
    .mode-card-active,.mic-recording { animation: none !important; }
  }
`;

// ─── Brain SVG ────────────────────────────────────────────────────────────────
function CortexBrainVisual() {
  return (
    <svg viewBox="0 0 400 400" width="220" height="220" aria-hidden="true">
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
      <rect className="scan" x="25" y="200" width="350" height="1.5" fill="url(#glowGrad)" clipPath="url(#brainClip)" />
      {([
        [345,200],[303,303],[200,345],[97,303],
        [55,200],[97,97],[200,55],[303,97],
      ] as [number,number][]).map(([cx,cy],i) => (
        <circle key={i} className="n-o" cx={cx} cy={cy} r="5" fill="url(#nodeGrad)" filter="url(#glow)" style={{ animationDelay: `${i*0.4}s` }} />
      ))}
      {([
        [280,200],[240,269],[160,269],
        [120,200],[160,131],[240,131],
      ] as [number,number][]).map(([cx,cy],i) => (
        <circle key={i} className="n-i" cx={cx} cy={cy} r="6" fill="url(#nodeGrad)" filter="url(#glow)" style={{ animationDelay: `${i*0.3}s` }} />
      ))}
      <circle className="n-i" cx="200" cy="120" r="5.5" fill="url(#nodeGrad)" filter="url(#glow)" />
      <circle className="n-i" cx="200" cy="280" r="5.5" fill="url(#nodeGrad)" filter="url(#glow)" style={{ animationDelay:"1.2s" }} />
      <circle className="orb" cx="200" cy="200" r="46" fill="url(#orbGrad)" />
      <path d="M 184 183 L 200 217 L 216 183" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.92" />
      <text x="200" y="233" textAnchor="middle" fill="white" fontSize="8" fontFamily="monospace" letterSpacing="3" opacity="0.7">CORTEX</text>
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type IngestionMode = "url" | "text" | "file" | "image" | "audio" | "voice";

type IngestionStatus =
  | "queued" | "fetching" | "extracting" | "transcribing" | "cleaning"
  | "chunking" | "indexing" | "verifying"
  | "ready" | "partial" | "failed" | "blocked" | "unsupported";

type HistoryRecord = {
  id: number;
  source_url: string | null;
  canonical_url: string | null;
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
  ingestion_status?: IngestionStatus;
  ingestion_stage?: string | null;
  failure_reason?: string | null;
  retry_count?: number;
  retrieval_ready?: boolean;
  extraction_method?: string | null;
  content_char_count?: number;
  chunk_count?: number;
  source_type: string;
  original_filename?: string | null;
  file_size_bytes?: number | null;
  file_mime_type?: string | null;
};

const IN_PROGRESS_STATUSES = new Set(["queued","fetching","extracting","transcribing","cleaning","chunking","indexing","verifying"]);

// ─── Source type icon/label ───────────────────────────────────────────────────

function sourceTypeIcon(sourceType: string, className = "w-4 h-4") {
  switch (sourceType) {
    case "url":    return <Globe className={className} />;
    case "text":   return <FileText className={className} />;
    case "file":   return <File className={className} />;
    case "image":  return <Image className={className} />;
    case "audio":  return <Volume2 className={className} />;
    case "voice":  return <Mic className={className} />;
    default:       return <Brain className={className} />;
  }
}

function sourceTypeLabel(sourceType: string) {
  switch (sourceType) {
    case "url":    return "Web Link";
    case "text":   return "Pasted Text";
    case "file":   return "Document";
    case "image":  return "Image";
    case "audio":  return "Audio / Video";
    case "voice":  return "Voice Note";
    default:       return sourceType;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Ingestion status badge ───────────────────────────────────────────────────

function IngestionStatusBadge({ record }: { record: HistoryRecord }) {
  const status = record.ingestion_status ?? "ready";
  if (IN_PROGRESS_STATUSES.has(status)) {
    const label = status === "queued" ? "Queued" : status === "transcribing" ? "Transcribing…" : status === "extracting" ? "Analyzing…" : "Processing…";
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-teal-600 dark:text-teal-400" data-testid={`badge-ingestion-status-${record.id}`}>
        <Loader2 className="w-3 h-3 animate-spin" />{label}
      </span>
    );
  }
  if (status === "ready") return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-teal-600 dark:text-teal-400" data-testid={`badge-ingestion-status-${record.id}`}>
      <CheckCircle2 className="w-3 h-3" />
      {record.chunk_count ? `${record.chunk_count} chunks ready` : "Content ready"}
    </span>
  );
  if (status === "partial") return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400" data-testid={`badge-ingestion-status-${record.id}`}>
      <AlertCircle className="w-3 h-3" />Partial extraction
    </span>
  );
  if (status === "blocked") return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-orange-600 dark:text-orange-400" data-testid={`badge-ingestion-status-${record.id}`}>
      <AlertCircle className="w-3 h-3" />Blocked
    </span>
  );
  if (status === "unsupported") return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground" data-testid={`badge-ingestion-status-${record.id}`}>
      <AlertCircle className="w-3 h-3" />Unsupported
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-destructive" data-testid={`badge-ingestion-status-${record.id}`}>
      <AlertCircle className="w-3 h-3" />Failed
    </span>
  );
}

function ImportanceBadge({ importance }: { importance: string }) {
  const map: Record<string, string> = {
    "Critical":               "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/50 dark:text-red-300 dark:border-red-700",
    "Board-Level / Strategic":"bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/50 dark:text-purple-300 dark:border-purple-700",
    "High":                   "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700",
    "Medium":                 "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/50 dark:text-teal-300 dark:border-teal-700",
    "Low":                    "bg-muted text-muted-foreground border-border",
  };
  return <Badge variant="outline" className={`text-xs font-medium ${map[importance] ?? "bg-muted text-muted-foreground border-border"}`}>{importance}</Badge>;
}

// ─── Extraction metrics text ──────────────────────────────────────────────────

function deriveBullets(r: HistoryRecord): string[] {
  if (r.ai_summary && r.ai_summary.length > 20) {
    return r.ai_summary.split(/[.\n]/).map(s => s.trim()).filter(s => s.length > 20);
  }
  const bullets: string[] = [];
  if (r.intel_type) bullets.push(`Category: ${r.intel_type}`);
  if (r.importance && r.importance !== "Medium") bullets.push(`Importance: ${r.importance}`);
  if (bullets.length === 0) bullets.push("Captured for Cortex AI context");
  return bullets;
}

function extractionSummary(r: HistoryRecord): string {
  const status = r.ingestion_status ?? "ready";
  if (IN_PROGRESS_STATUSES.has(status)) {
    if (status === "transcribing") return "Transcribing audio…";
    if (status === "extracting") return "Analyzing content…";
    return "Processing…";
  }
  if (status === "ready" && r.content_char_count && r.chunk_count) {
    const chars = r.content_char_count.toLocaleString();
    if (r.source_type === "audio" || r.source_type === "voice") return `Transcribed ${chars} characters across ${r.chunk_count} knowledge sections.`;
    if (r.source_type === "image") return `Extracted ${chars} characters of visual analysis across ${r.chunk_count} chunks.`;
    return `Extracted ${chars} characters across ${r.chunk_count} searchable knowledge chunks.`;
  }
  if (status === "partial") return r.failure_reason ?? "Partial extraction — limited content could be retrieved.";
  if (status === "blocked") return r.failure_reason ?? "Site prevents automated extraction.";
  if (status === "failed")  return r.failure_reason ?? "Extraction failed.";
  return "Captured for Cortex AI context.";
}

// ─── Cortex Status Dialog ─────────────────────────────────────────────────────

function cortexStatusMessage(history: HistoryRecord[], todayCount: number): string {
  if (todayCount >= 5) return "Cortex is well-fed today";
  if (todayCount >= 1) return "Cortex learned something new today";
  if (history.length >= 10) return "Cortex has a solid knowledge base";
  if (history.length >= 1) return "Cortex is hungry for more";
  return "Cortex is ready to learn";
}

function CortexStatusDialog({
  open, onClose, history, todayRecords,
}: { open: boolean; onClose: () => void; history: HistoryRecord[]; todayRecords: HistoryRecord[] }) {
  const aiContextCount = history.filter((r) => r.use_in_ai_context).length;
  const byType = history.reduce((acc: Record<string, number>, r) => {
    acc[r.source_type] = (acc[r.source_type] ?? 0) + 1; return acc;
  }, {});
  const domainFreq = history.filter(r => r.domain).reduce((acc: Record<string, number>, r) => {
    acc[r.domain!] = (acc[r.domain!] ?? 0) + 1; return acc;
  }, {});
  const topDomains = Object.entries(domainFreq).sort(([,a],[,b]) => b - a).slice(0, 5);
  const statusMsg = cortexStatusMessage(history, todayRecords.length);
  const mostRecent = history[0];
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="dialog-cortex-status">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Brain className="w-5 h-5 text-teal-500" />VoltSafe Cortex Status</DialogTitle>
          <DialogDescription>The company brain is learning from every approved source.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
              <span className="text-sm font-semibold text-teal-700 dark:text-teal-300">{statusMsg}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Total sources", value: history.length },
              { label: "Learned today", value: todayRecords.length },
              { label: "In AI context", value: aiContextCount },
              { label: "Source types", value: Object.keys(byType).length },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-border bg-card p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          {Object.keys(byType).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">By source type</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(byType).map(([type, count]) => (
                  <Badge key={type} variant="secondary" className="text-xs gap-1">
                    {sourceTypeIcon(type, "w-3 h-3")}
                    {sourceTypeLabel(type)} <span className="opacity-60">×{count}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {topDomains.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Top domains</p>
              <div className="space-y-1">
                {topDomains.map(([domain, count]) => (
                  <div key={domain} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono truncate">{domain}</span>
                    <span className="text-[10px] bg-muted rounded px-1.5 py-0.5">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {mostRecent && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground mb-0.5">Most recent ingestion</p>
              <p className="text-sm font-medium truncate">{mostRecent.title ?? mostRecent.domain ?? mostRecent.original_filename ?? "Untitled"}</p>
              <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(mostRecent.created_at), { addSuffix: true })}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── URL Detail Dialog (UrlDetailDialog) ─────────────────────────────────────

function UrlDetailDialog({ record, onClose }: { record: HistoryRecord | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [contentOpen, setContentOpen] = useState(false);

  const retryMutation = useMutation({
    mutationFn: async () => {
      if (record!.source_type === "url") {
        const res = await apiRequest("POST", `/api/cortex/url/${record!.id}/retry`);
        return res.json();
      }
      throw new Error("Retry not supported for this source type yet");
    },
    onSuccess: () => {
      toast({ title: "Re-extraction queued" });
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/url/history"] });
    },
    onError: (e: any) => toast({ title: "Retry failed", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/cortex/source/${record!.id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Source deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/url/history"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
  });

  const contentQuery = useQuery({
    queryKey: ["/api/cortex/url", record?.id, "content"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/cortex/url/${record!.id}/content`);
      return res.json();
    },
    enabled: contentOpen && !!record,
  });

  if (!record) return null;
  const status = record.ingestion_status ?? "ready";
  const canRetry = record.source_type === "url" && ["failed","partial","unsupported"].includes(status);
  const displayName = record.title ?? record.domain ?? record.original_filename ?? record.canonical_url ?? "Untitled";

  const whatCortexLearned = record ? deriveBullets(record) : [];

  return (
    <Dialog open={!!record} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-url-detail">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug pr-4 flex items-center gap-2">
            <span className="text-teal-500 flex-shrink-0">{sourceTypeIcon(record.source_type, "w-4 h-4")}</span>
            {displayName}
          </DialogTitle>
          {(record.domain || record.original_filename) && (
            <DialogDescription className="font-mono text-xs">
              {record.domain ?? record.original_filename}
              {record.file_size_bytes ? ` · ${formatFileSize(record.file_size_bytes)}` : ""}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-sm text-foreground/80 leading-relaxed">
            {extractionSummary(record)}
          </div>
          <Separator />
          <div>
            <p className="text-xs font-semibold text-teal-600 dark:text-teal-400 uppercase tracking-wide mb-2">Extraction status</p>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <IngestionStatusBadge record={record} />
              {canRetry && (
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                  disabled={retryMutation.isPending} onClick={() => retryMutation.mutate()}
                  data-testid={`button-retry-ingestion-${record.id}`}>
                  {retryMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  Retry
                </Button>
              )}
            </div>
            {record.failure_reason && (
              <p className="mt-1.5 text-xs text-muted-foreground border-l-2 border-destructive/40 pl-2">{record.failure_reason}</p>
            )}
            {record.extraction_method && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Method: {record.extraction_method}
                {typeof record.content_char_count === "number" && record.content_char_count > 0
                  ? ` · ${record.content_char_count.toLocaleString()} chars extracted`
                  : ""}
              </p>
            )}
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div><p className="text-xs text-muted-foreground">Type</p><p className="font-medium flex items-center gap-1">{sourceTypeIcon(record.source_type, "w-3.5 h-3.5 text-teal-500")}{sourceTypeLabel(record.source_type)}</p></div>
            <div><p className="text-xs text-muted-foreground">Importance</p><ImportanceBadge importance={record.importance} /></div>
            <div><p className="text-xs text-muted-foreground">Saved by</p><p className="font-medium">{record.created_by_name ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Saved at</p><p className="font-medium text-xs">{format(new Date(record.created_at), "MMM d, yyyy · h:mm a")}</p></div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">AI context</p>
              <span className="flex items-center gap-1 text-xs">
                {record.use_in_ai_context
                  ? <><CheckCircle2 className="w-3.5 h-3.5 text-teal-500" /><span className="text-teal-600 dark:text-teal-400">Active</span></>
                  : <><AlertCircle className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">Not active</span></>}
              </span>
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-2 flex-wrap">
            {record.source_url && (
              <Button size="sm" variant="outline" className="gap-1.5"
                onClick={() => window.open(record.source_url!, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="w-3.5 h-3.5" />Open Source
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5"
              onClick={() => window.open("/cortex/intel", "_self")}>
              <ExternalLink className="w-3.5 h-3.5" />View in Cortex Intel
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5"
              onClick={() => setContentOpen(true)} data-testid={`button-view-extracted-content-${record.id}`}>
              <Info className="w-3.5 h-3.5" />View content
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:bg-destructive/10"
              disabled={deleteMutation.isPending}
              onClick={() => { if (confirm("Delete this source from Cortex?")) deleteMutation.mutate(); }}>
              {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Delete
            </Button>
          </div>
        </div>
      </DialogContent>

      <Dialog open={contentOpen} onOpenChange={setContentOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-extracted-content">
          <DialogHeader>
            <DialogTitle>Extracted content</DialogTitle>
            <DialogDescription className="font-mono text-xs">{record.original_filename ?? record.domain ?? record.canonical_url}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto text-sm">
            {contentQuery.isLoading && <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</p>}
            {contentQuery.data?.record?.extracted_text ? (
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed" data-testid="text-extracted-content-body">{contentQuery.data.record.extracted_text}</pre>
            ) : (
              !contentQuery.isLoading && <p className="text-muted-foreground italic text-xs">No content extracted yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

// ─── Mode card definition ─────────────────────────────────────────────────────

const MODES: { id: IngestionMode; icon: React.ReactNode; label: string; desc: string; accept?: string }[] = [
  {
    id: "url",
    icon: <Globe className="w-6 h-6" />,
    label: "Add a Link",
    desc: "Webpage, article, YouTube video, PDF URL, or any public web address.",
  },
  {
    id: "text",
    icon: <FileText className="w-6 h-6" />,
    label: "Paste Text",
    desc: "Notes, research, meeting summaries, emails, ideas, or raw knowledge.",
  },
  {
    id: "file",
    icon: <FolderOpen className="w-6 h-6" />,
    label: "Upload Files",
    desc: "PDFs, Word docs, TXT, CSV, Markdown, and other documents.",
    accept: ".pdf,.docx,.doc,.txt,.csv,.md,.xlsx,.json",
  },
  {
    id: "image",
    icon: <Image className="w-6 h-6" />,
    label: "Add Images",
    desc: "Screenshots, diagrams, charts, whiteboards, or scanned documents.",
    accept: "image/png,image/jpeg,image/webp,image/gif",
  },
  {
    id: "audio",
    icon: <Play className="w-6 h-6" />,
    label: "Video & Audio",
    desc: "Recordings, interviews, webinars, and presentations — transcribed automatically.",
    accept: "audio/*,video/*",
  },
  {
    id: "voice",
    icon: <Mic className="w-6 h-6" />,
    label: "Speak to Cortex",
    desc: "Record a voice note and teach Cortex directly.",
  },
];

// ─── File upload item ─────────────────────────────────────────────────────────

type UploadItem = {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  recordId?: number;
};

// ─── Voice recorder ───────────────────────────────────────────────────────────

function VoiceComposer({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<"idle" | "recording" | "stopped" | "uploading" | "done">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [title, setTitle] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTimer() { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setPhase("stopped");
      };
      mr.start(200);
      mediaRecorderRef.current = mr;
      setElapsed(0);
      setPhase("recording");
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } catch (e: any) {
      toast({ title: "Microphone access denied", description: e.message, variant: "destructive" });
    }
  }

  function stopRecording() {
    clearTimer();
    mediaRecorderRef.current?.stop();
  }

  function resetRecording() {
    clearTimer();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioBlob(null);
    setElapsed(0);
    setPhase("idle");
  }

  async function submitVoice() {
    if (!audioBlob) return;
    setPhase("uploading");
    try {
      const ext = audioBlob.type.includes("webm") ? "webm" : "mp3";
      const filename = `voice-note-${Date.now()}.${ext}`;
      const formData = new FormData();
      formData.append("file", audioBlob, filename);
      formData.append("sourceTypeOverride", "voice");
      formData.append("title", title.trim() || `Voice note ${new Date().toLocaleString()}`);
      formData.append("category", "Audio & Video");
      const res = await fetch("/api/cortex/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
      setPhase("done");
      toast({ title: "Voice note fed to Cortex", description: "Transcribing now — check history in a moment." });
      setTimeout(() => { resetRecording(); onSuccess(); }, 1800);
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
      setPhase("stopped");
    }
  }

  useEffect(() => () => { clearTimer(); if (audioUrl) URL.revokeObjectURL(audioUrl); }, []);

  const fmtTime = (s: number) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  return (
    <div className="space-y-4">
      {phase === "done" ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <CheckCircle2 className="w-12 h-12 text-teal-500" />
          <p className="font-semibold text-foreground">Voice note submitted!</p>
          <p className="text-sm text-muted-foreground">Cortex is transcribing your recording…</p>
        </div>
      ) : phase === "uploading" ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="w-10 h-10 text-teal-500 animate-spin" />
          <p className="text-sm text-muted-foreground">Uploading voice note…</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center gap-4 py-6">
            {phase === "idle" && (
              <>
                <div className="w-20 h-20 rounded-full border-2 border-teal-400/30 bg-teal-500/10 flex items-center justify-center">
                  <Mic className="w-10 h-10 text-teal-500" />
                </div>
                <p className="text-sm text-muted-foreground">Press to start recording</p>
                <Button onClick={startRecording} className="bg-teal-600 hover:bg-teal-500 text-white gap-2 px-6" data-testid="button-voice-start">
                  <Mic className="w-4 h-4" />Start Recording
                </Button>
              </>
            )}
            {phase === "recording" && (
              <>
                <div className="w-20 h-20 rounded-full bg-red-500/10 border-2 border-red-400 flex items-center justify-center mic-recording">
                  <Circle className="w-8 h-8 text-red-500 fill-red-500" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="font-mono text-lg font-bold text-foreground">{fmtTime(elapsed)}</span>
                </div>
                <p className="text-sm text-muted-foreground">Recording… speak clearly</p>
                <Button onClick={stopRecording} variant="outline" className="gap-2 border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" data-testid="button-voice-stop">
                  <Square className="w-4 h-4 fill-current" />Stop Recording
                </Button>
              </>
            )}
            {phase === "stopped" && audioUrl && (
              <>
                <div className="w-full space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">Recording ready · {fmtTime(elapsed)}</p>
                    <Button variant="ghost" size="sm" onClick={resetRecording} className="gap-1 text-xs text-muted-foreground">
                      <RotateCcw className="w-3.5 h-3.5" />Re-record
                    </Button>
                  </div>
                  <audio src={audioUrl} controls className="w-full h-10 rounded" />
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Optional title for this voice note…"
                    className="text-sm"
                    data-testid="input-voice-title"
                  />
                </div>
                <Button onClick={submitVoice} className="w-full bg-teal-600 hover:bg-teal-500 text-white gap-2" data-testid="button-voice-submit">
                  <Zap className="w-4 h-4" />Feed Voice Note to Cortex
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── File drop zone / uploader ────────────────────────────────────────────────

function FileComposer({
  accept, mode, onSuccess,
}: { accept?: string; mode: IngestionMode; onSuccess: () => void }) {
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ACCEPT_LABEL: Record<IngestionMode, string> = {
    file:  "PDF, DOCX, TXT, CSV, Markdown, JSON",
    image: "PNG, JPG, WebP, GIF",
    audio: "MP3, WAV, MP4, MOV, WebM, M4A",
    url: "", text: "", voice: "",
  };

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    setItems(prev => [...prev, ...arr.map(f => ({ file: f, status: "pending" as const }))]);
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function uploadItem(idx: number, item: UploadItem) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, status: "uploading" } : it));
    try {
      const fd = new FormData();
      fd.append("file", item.file);
      if (mode === "image") fd.append("category", "Image & Visual");
      if (mode === "audio") fd.append("category", "Audio & Video");
      const res = await fetch("/api/cortex/upload", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
      const data = await res.json();
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, status: "done", recordId: data.record?.id } : it));
    } catch (e: any) {
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, status: "error", error: e.message } : it));
    }
  }

  async function uploadAll() {
    const pending = items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.status === "pending" || it.status === "error");
    await Promise.all(pending.map(({ it, idx }) => uploadItem(idx, it)));
    const allDone = items.every(it => it.status === "done" || it.status === "error");
    if (allDone && items.some(it => it.status === "done")) {
      toast({ title: `${items.filter(it => it.status === "done").length} source(s) fed to Cortex` });
      setTimeout(() => { setItems([]); onSuccess(); }, 1200);
    }
  }

  const pendingCount = items.filter(it => it.status === "pending" || it.status === "error").length;
  const uploadingCount = items.filter(it => it.status === "uploading").length;
  const doneCount = items.filter(it => it.status === "done").length;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          dragOver
            ? "border-teal-500 bg-teal-500/10 scale-[1.01]"
            : "border-border hover:border-teal-400 hover:bg-accent/30"
        }`}
        data-testid={`dropzone-${mode}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          data-testid={`input-file-${mode}`}
          onChange={(e) => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ""; } }}
        />
        <div className="flex flex-col items-center gap-2 pointer-events-none">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${dragOver ? "bg-teal-500/20" : "bg-muted"}`}>
            <Upload className={`w-6 h-6 ${dragOver ? "text-teal-500" : "text-muted-foreground"}`} />
          </div>
          <p className="font-medium text-foreground text-sm">{dragOver ? "Drop files here" : "Drop files or click to browse"}</p>
          <p className="text-xs text-muted-foreground">{ACCEPT_LABEL[mode]}</p>
          {mode === "audio" && <p className="text-xs text-muted-foreground">Up to 150 MB · Transcribed automatically via Whisper</p>}
          {mode === "image" && <p className="text-xs text-muted-foreground">Analyzed by AI vision · Text extracted automatically</p>}
          {mode === "file" && <p className="text-xs text-muted-foreground">Up to 150 MB · Multiple files supported</p>}
        </div>
      </div>

      {/* File list */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <div className="w-8 h-8 rounded flex items-center justify-center bg-muted flex-shrink-0">
                {item.status === "uploading" ? <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
                  : item.status === "done" ? <CheckCircle2 className="w-4 h-4 text-teal-500" />
                  : item.status === "error" ? <AlertCircle className="w-4 h-4 text-destructive" />
                  : sourceTypeIcon(mode === "image" ? "image" : mode === "audio" ? "audio" : "file", "w-4 h-4 text-muted-foreground")}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{item.file.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {formatFileSize(item.file.size)}
                  {item.status === "done" && " · Fed to Cortex"}
                  {item.status === "uploading" && " · Uploading…"}
                  {item.status === "error" && ` · Error: ${item.error}`}
                </p>
              </div>
              {item.status !== "uploading" && item.status !== "done" && (
                <button onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-foreground p-1 rounded">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            {uploadingCount === 0 && pendingCount > 0 && (
              <div className="cortex-breathe-btn rounded-md flex-1">
                <Button
                  className="w-full bg-teal-600 hover:bg-teal-500 text-white gap-2"
                  onClick={uploadAll}
                  data-testid={`button-upload-all-${mode}`}
                >
                  <Zap className="w-4 h-4" />
                  Feed {pendingCount} file{pendingCount > 1 ? "s" : ""} to Cortex
                </Button>
              </div>
            )}
            {uploadingCount > 0 && (
              <div className="flex-1 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
                Uploading {uploadingCount} file{uploadingCount > 1 ? "s" : ""}…
              </div>
            )}
            {doneCount > 0 && <p className="text-xs text-teal-600 dark:text-teal-400">{doneCount} done</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Domain Watch component ───────────────────────────────────────────────────

interface AutoIngestDomain {
  id: number;
  domain: string;
  label: string | null;
  notes: string | null;
  is_active: boolean;
  created_by_user_id: number;
  created_at: string;
  last_matched_at: string | null;
  match_count: number;
  creator_name?: string | null;
}

function DomainWatchPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AutoIngestDomain | null>(null);
  const [domain, setDomain] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");

  const domainsQuery = useQuery<{ domains: AutoIngestDomain[] }>({
    queryKey: ["/api/cortex/auto-ingest-domains"],
  });
  const domains = domainsQuery.data?.domains ?? [];

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/cortex/auto-ingest-domains", { domain: domain.trim(), label: label.trim() || undefined, notes: notes.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/auto-ingest-domains"] });
      toast({ title: "Domain added", description: `${domain} will now be auto-ingested into Cortex.` });
      setAddOpen(false);
      setDomain(""); setLabel(""); setNotes("");
    },
    onError: (err: any) => toast({ title: "Failed", description: err?.message ?? "Could not add domain", variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: (updates: { id: number; label?: string; notes?: string }) =>
      apiRequest("PATCH", `/api/cortex/auto-ingest-domains/${updates.id}`, { label: updates.label, notes: updates.notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/auto-ingest-domains"] });
      toast({ title: "Updated" });
      setEditTarget(null);
    },
    onError: (err: any) => toast({ title: "Failed", description: err?.message ?? "Could not update", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      apiRequest("PATCH", `/api/cortex/auto-ingest-domains/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cortex/auto-ingest-domains"] }),
    onError: (err: any) => toast({ title: "Failed", description: err?.message ?? "Could not toggle", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/cortex/auto-ingest-domains/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/auto-ingest-domains"] });
      toast({ title: "Domain removed" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err?.message ?? "Could not remove", variant: "destructive" }),
  });

  function openEdit(d: AutoIngestDomain) {
    setEditTarget(d);
    setLabel(d.label ?? "");
    setNotes(d.notes ?? "");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Domain Auto-Ingest</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every email received from a watched domain is automatically fed into Cortex.
          </p>
        </div>
        <Button
          onClick={() => { setAddOpen(true); setDomain(""); setLabel(""); setNotes(""); }}
          className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5"
          data-testid="button-add-domain"
        >
          <Plus className="w-4 h-4" /> Add Domain
        </Button>
      </div>

      {/* Domain list */}
      {domainsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading domains…
        </div>
      ) : domains.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-2">
          <Shield className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm font-medium text-foreground">No domains watched yet</p>
          <p className="text-xs text-muted-foreground">Add a domain and any email from it will be ingested automatically.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Domain</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Label / Notes</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Added by</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Added</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Last matched</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Matches</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Active</th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {domains.map((d) => (
                <tr key={d.id} className={`transition-colors hover:bg-accent/30 ${d.is_active ? "" : "opacity-50"}`} data-testid={`row-domain-${d.id}`}>
                  <td className="px-4 py-3 font-mono text-sm text-teal-600 dark:text-teal-400 font-semibold">
                    @{d.domain}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {d.label && <p className="text-xs font-medium text-foreground">{d.label}</p>}
                    {d.notes && <p className="text-xs text-muted-foreground line-clamp-1">{d.notes}</p>}
                    {!d.label && !d.notes && <span className="text-xs text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                    {d.creator_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                    {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                    {d.last_matched_at ? formatDistanceToNow(new Date(d.last_matched_at), { addSuffix: true }) : <span className="opacity-40">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                    {d.match_count > 0 ? <span className="font-medium text-teal-600 dark:text-teal-400">{d.match_count}</span> : <span className="opacity-40">0</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Switch
                      checked={d.is_active}
                      onCheckedChange={(v) => toggleMutation.mutate({ id: d.id, is_active: v })}
                      data-testid={`switch-domain-${d.id}`}
                      aria-label={`Toggle ${d.domain}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => openEdit(d)}
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        data-testid={`button-edit-domain-${d.id}`}
                        aria-label={`Edit ${d.domain}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(d.id)}
                        className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        data-testid={`button-delete-domain-${d.id}`}
                        aria-label={`Remove ${d.domain}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info callout */}
      <div className="rounded-lg border border-teal-200 dark:border-teal-800/50 bg-teal-50/40 dark:bg-teal-950/20 p-4 flex gap-3">
        <Info className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-teal-700 dark:text-teal-300 leading-relaxed">
          Auto-ingest runs as emails arrive. Cortex generates an AI summary and strategic relevance notes for each ingested email. Only new inbound emails trigger ingest — existing mail is not backfilled. Only one record is created per email even if the domain rule is applied multiple times.
        </p>
      </div>

      {/* Add domain dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Watch a Domain</DialogTitle>
            <DialogDescription>
              All future emails from this domain will be automatically ingested into Cortex.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="domain-input">Domain <span className="text-destructive">*</span></Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                <Input
                  id="domain-input"
                  className="pl-7"
                  placeholder="example.com"
                  value={domain}
                  onChange={e => setDomain(e.target.value)}
                  data-testid="input-domain"
                  onKeyDown={e => { if (e.key === "Enter" && domain.trim()) addMutation.mutate(); }}
                />
              </div>
              <p className="text-xs text-muted-foreground">Enter just the domain — e.g. wsj.com, pitchbook.com</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label-input">Label <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                id="label-input"
                placeholder="e.g. Wall Street Journal, IBI Editor"
                value={label}
                onChange={e => setLabel(e.target.value)}
                data-testid="input-domain-label"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes-input">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <textarea
                id="notes-input"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none h-20"
                placeholder="Why this domain matters to Cortex…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                data-testid="input-domain-notes"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                onClick={() => addMutation.mutate()}
                disabled={!domain.trim() || addMutation.isPending}
                className="bg-teal-600 hover:bg-teal-700 text-white"
                data-testid="button-confirm-add-domain"
              >
                {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                Watch Domain
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit domain dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit @{editTarget?.domain}</DialogTitle>
            <DialogDescription>Update the label or notes for this watched domain.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input placeholder="e.g. Wall Street Journal" value={label} onChange={e => setLabel(e.target.value)} data-testid="input-edit-label" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none h-20"
                placeholder="Why this domain matters…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                data-testid="input-edit-notes"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button
                onClick={() => editTarget && editMutation.mutate({ id: editTarget.id, label: label.trim() || undefined, notes: notes.trim() || undefined })}
                disabled={editMutation.isPending}
                className="bg-teal-600 hover:bg-teal-700 text-white"
                data-testid="button-confirm-edit-domain"
              >
                {editMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FeedCortexPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── State ──
  const [activeMode, setActiveMode] = useState<IngestionMode | null>(null);
  const [pageTab, setPageTab] = useState<"feed" | "domains">("feed");
  const [url, setUrl] = useState("");
  const [textBody, setTextBody] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<any[]>([]);
  const [answerNotReadyCount, setAnswerNotReadyCount] = useState(0);
  const [statusOpen, setStatusOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<HistoryRecord | null>(null);
  const [historyFilter, setHistoryFilter] = useState<string>("all");

  // ── Session (for role-gated Domain Watch tab) ──
  const sessionQuery = useQuery<{ user?: { globalRole?: string } }>({
    queryKey: ["/api/auth/me"],
  });
  const globalRole = sessionQuery.data?.user?.globalRole ?? "";
  const canManageDomains = ["master_admin", "admin", "exec", "manager"].includes(globalRole);

  // ── Fetch unified history ──
  const historyQuery = useQuery<{ records: HistoryRecord[] }>({
    queryKey: ["/api/cortex/history"],
  });
  const history = historyQuery.data?.records ?? [];
  const now = new Date();
  const todayRecords = history.filter((r) => {
    const d = new Date(r.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  });

  // ── Poll in-progress records ──
  const inProgressIds = history.filter(r => r.ingestion_status && IN_PROGRESS_STATUSES.has(r.ingestion_status)).map(r => r.id);
  useEffect(() => {
    if (inProgressIds.length === 0) return;
    const interval = setInterval(async () => {
      try {
        const updates = await Promise.all(
          inProgressIds.map(id => fetch(`/api/cortex/source/${id}/status`, { credentials: "include" }).then(r => r.json()))
        );
        const anyCompleted = updates.some(u => u.ingestion_status && !IN_PROGRESS_STATUSES.has(u.ingestion_status));
        if (anyCompleted) {
          queryClient.invalidateQueries({ queryKey: ["/api/cortex/history"] });
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [inProgressIds.join(",")]);

  // ── URL ingestion mutation ──
  const urlMutation = useMutation({
    mutationFn: async (urlToSave: string) =>
      apiRequest("POST", "/api/cortex/url", { url: urlToSave, category: "Web Resource", importance: "Medium", useInAiContext: true }),
    onSuccess: () => {
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/url/history"] });
      toast({ title: "Fed to Cortex", description: "Extracting content now…" });
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Failed";
      if (msg.includes("already been saved")) toast({ title: "Already known", description: "Cortex already has this URL." });
      else toast({ title: "Failed", description: msg, variant: "destructive" });
    },
  });

  // ── Text ingestion mutation ──
  const textMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/cortex/text", {
        title: textTitle.trim() || undefined,
        body: textBody.trim(),
        category: "Notes & Knowledge",
        importance: "Medium",
        useInAiContext: true,
      }),
    onSuccess: () => {
      setTextBody("");
      setTextTitle("");
      queryClient.invalidateQueries({ queryKey: ["/api/cortex/history"] });
      toast({ title: "Text fed to Cortex", description: "Chunking and indexing now…" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err?.message, variant: "destructive" }),
  });

  // ── Ask Cortex mutation ──
  const askMutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await apiRequest("POST", "/api/cortex/ask", { question: q });
      return res.json();
    },
    onSuccess: (data: any) => {
      setAnswer(data?.answer ?? data?.error ?? "No answer returned.");
      setAnswerSources(Array.isArray(data.sources) ? data.sources : []);
      setAnswerNotReadyCount(typeof data.notReadyCount === "number" ? data.notReadyCount : 0);
    },
    onError: (err: any) => {
      setAnswer(`Something went wrong: ${err?.message ?? "Unknown error"}`);
      setAnswerSources([]);
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
    urlMutation.mutate(trimmed);
  }

  function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setAnswer(null);
    askMutation.mutate(q);
  }

  const filteredHistory = historyFilter === "all" ? history : history.filter(r => r.source_type === historyFilter);
  const sourceTypes = Array.from(new Set(history.map(r => r.source_type)));

  const isDigesting = urlMutation.isPending || textMutation.isPending;

  function handleModeSuccess() {
    queryClient.invalidateQueries({ queryKey: ["/api/cortex/history"] });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <style>{ANIM_CSS}</style>

      <CortexStatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} history={history} todayRecords={todayRecords} />
      <UrlDetailDialog record={selectedRecord} onClose={() => setSelectedRecord(null)} />

      {/* ── Hero ── */}
      <div className={`flex flex-col items-center pt-8 pb-4 px-4 gap-3 ${isDigesting ? "cortex-digesting" : ""}`}>
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-teal-500" />
          <span className="text-xs tracking-[0.2em] text-teal-500 dark:text-teal-400 font-mono uppercase">VoltSafe Intelligence Layer</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-center">
          Feed <span className="text-teal-500 dark:text-teal-400">CORTEX</span>
        </h1>
        <p className="text-sm text-muted-foreground text-center max-w-lg">
          Teach Cortex anything. Add a link, paste text, upload a file, show it an image, or speak directly.
        </p>

        {/* ── Page tab switcher ── */}
        {canManageDomains && (
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setPageTab("feed")}
              data-testid="tab-feed-cortex"
              className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                pageTab === "feed"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Brain className="w-3.5 h-3.5" /> Feed Cortex
            </button>
            <button
              type="button"
              onClick={() => setPageTab("domains")}
              data-testid="tab-domain-watch"
              className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                pageTab === "domains"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Shield className="w-3.5 h-3.5" /> Domain Watch
            </button>
          </div>
        )}

        {/* Brain visual — only shown on Feed tab */}
        {pageTab === "feed" && (
          <button
            type="button"
            onClick={() => setStatusOpen(true)}
            aria-label="View Cortex status"
            data-testid="button-brain-status"
            className="cortex-breathe-svg relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 cursor-pointer group"
          >
            <CortexBrainVisual />
            <div className="absolute inset-0 flex items-end justify-center pb-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <span className="text-[10px] font-mono text-teal-300 tracking-wider bg-black/40 rounded px-2 py-0.5">VIEW STATUS</span>
            </div>
          </button>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="max-w-5xl mx-auto px-4 pb-16 space-y-8">

        {/* ── Domain Watch tab ── */}
        {pageTab === "domains" && <DomainWatchPanel />}

        {pageTab === "feed" && (<>
        {/* ── Six ingestion mode cards ── */}
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {MODES.map((m) => {
              const isActive = activeMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`button-mode-${m.id}`}
                  onClick={() => setActiveMode(isActive ? null : m.id)}
                  className={`relative text-left rounded-xl border p-4 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 group ${
                    isActive
                      ? "border-teal-500 bg-teal-500/10 dark:bg-teal-900/30 mode-card-active"
                      : "border-border bg-card hover:border-teal-400/60 hover:bg-accent/40 hover:-translate-y-0.5 hover:shadow-md"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 transition-colors ${
                    isActive ? "bg-teal-500 text-white" : "bg-muted text-teal-500 group-hover:bg-teal-500/10"
                  }`}>
                    {m.icon}
                  </div>
                  <p className={`text-sm font-semibold mb-1 ${isActive ? "text-teal-600 dark:text-teal-400" : "text-foreground"}`}>
                    {m.label}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
                  {isActive && (
                    <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-teal-500" />
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Mode composer (slides in below cards) ── */}
          {activeMode && (
            <div className="mt-3 rounded-xl border border-teal-500/30 bg-card shadow-lg overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-teal-500/5">
                <div className="flex items-center gap-2">
                  <span className="text-teal-500">{MODES.find(m => m.id === activeMode)?.icon}</span>
                  <span className="text-sm font-semibold text-foreground">{MODES.find(m => m.id === activeMode)?.label}</span>
                </div>
                <button onClick={() => setActiveMode(null)} className="text-muted-foreground hover:text-foreground p-1 rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5">
                {/* URL composer */}
                {activeMode === "url" && (
                  <div className="space-y-3">
                    <form onSubmit={handleIngest} className="flex gap-2">
                      <div className="relative flex-1">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          data-testid="input-feed-cortex-url"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder="https://example.com/article-or-page"
                          className="pl-9 bg-background"
                          disabled={urlMutation.isPending}
                          autoFocus
                        />
                      </div>
                      <div className={url.trim() ? "cortex-breathe-btn rounded-md" : ""}>
                        <Button
                          type="submit"
                          data-testid="button-feed-cortex-submit"
                          disabled={urlMutation.isPending || !url.trim()}
                          className="bg-teal-600 hover:bg-teal-500 text-white font-semibold px-5"
                        >
                          {urlMutation.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Feeding…</> : <><Zap className="w-4 h-4 mr-1.5" />Feed</>}
                        </Button>
                      </div>
                    </form>
                    <p className="text-xs text-muted-foreground pl-1">
                      Supports webpages, articles, YouTube, Vimeo, public PDFs, Google Docs, and more.
                    </p>
                  </div>
                )}

                {/* Text paste composer */}
                {activeMode === "text" && (
                  <div className="space-y-3">
                    <Input
                      value={textTitle}
                      onChange={(e) => setTextTitle(e.target.value)}
                      placeholder="Title (optional — auto-generated from content)"
                      className="text-sm bg-background"
                      data-testid="input-text-title"
                    />
                    <Textarea
                      value={textBody}
                      onChange={(e) => setTextBody(e.target.value)}
                      placeholder="Paste notes, research, meeting summaries, emails, ideas, or any knowledge you want Cortex to learn…"
                      className="min-h-[180px] bg-background text-sm resize-none"
                      data-testid="textarea-text-body"
                      autoFocus
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{textBody.length.toLocaleString()} characters</span>
                      <div className={textBody.trim().length >= 10 ? "cortex-breathe-btn rounded-md" : ""}>
                        <Button
                          onClick={() => textMutation.mutate()}
                          disabled={textMutation.isPending || textBody.trim().length < 10}
                          className="bg-teal-600 hover:bg-teal-500 text-white gap-2"
                          data-testid="button-text-submit"
                        >
                          {textMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Feeding…</> : <><Zap className="w-4 h-4" />Feed Text to Cortex</>}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* File upload composer */}
                {activeMode === "file" && (
                  <FileComposer accept={MODES.find(m => m.id === "file")?.accept} mode="file" onSuccess={handleModeSuccess} />
                )}

                {/* Image upload composer */}
                {activeMode === "image" && (
                  <FileComposer accept={MODES.find(m => m.id === "image")?.accept} mode="image" onSuccess={handleModeSuccess} />
                )}

                {/* Audio/video upload composer */}
                {activeMode === "audio" && (
                  <FileComposer accept={MODES.find(m => m.id === "audio")?.accept} mode="audio" onSuccess={handleModeSuccess} />
                )}

                {/* Voice recorder */}
                {activeMode === "voice" && (
                  <VoiceComposer onSuccess={handleModeSuccess} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── What Cortex Learned Today ── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-teal-500" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">What Cortex learned today</h2>
            {todayRecords.length > 0 && (
              <Badge className="bg-teal-600 hover:bg-teal-600 text-white text-xs px-2">{todayRecords.length} new</Badge>
            )}
          </div>

          {historyQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" />Loading…
            </div>
          ) : todayRecords.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-border p-8 text-center">
              <Brain className="w-9 h-9 text-teal-400/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">Cortex hasn't learned anything new today yet.</p>
              <p className="text-xs text-muted-foreground">Select an ingestion mode above to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {todayRecords.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  data-testid={`card-cortex-today-${r.id}`}
                  onClick={() => setSelectedRecord(r)}
                  className="text-left rounded-xl border border-teal-200 dark:border-teal-800/60 bg-teal-50/60 dark:bg-teal-950/20 hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 group p-4"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-teal-500 flex-shrink-0">{sourceTypeIcon(r.source_type, "w-4 h-4")}</span>
                      <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">
                        {r.title ?? r.original_filename ?? r.domain ?? r.canonical_url ?? "Untitled"}
                      </p>
                    </div>
                    {r.source_url && (
                      <a href={r.source_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-teal-500 flex-shrink-0 mt-0.5 p-1 -m-1 rounded">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                  {(() => {
                    const bullets = deriveBullets(r).slice(0, 3);
                    return bullets.length > 0 ? (
                      <ul data-testid={`bullets-today-${r.id}`} className="mb-3 space-y-0.5">
                        {bullets.map((b, i) => (
                          <li key={i} className="text-xs text-muted-foreground leading-relaxed line-clamp-1 flex items-start gap-1">
                            <span className="text-teal-500 mt-0.5 flex-shrink-0">·</span>{b}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground mb-3 leading-relaxed line-clamp-2">{extractionSummary(r)}</p>
                    );
                  })()}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="secondary" className="text-[10px] gap-1 py-0">
                        {sourceTypeIcon(r.source_type, "w-2.5 h-2.5")}{sourceTypeLabel(r.source_type)}
                      </Badge>
                      <IngestionStatusBadge record={r} />
                    </div>
                    <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                      Details <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* ── History + Ask Cortex ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* ── Ingestion History ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Ingestion History</h2>
              {history.length > 0 && (
                <Badge variant="outline" className="text-xs border-border text-muted-foreground">{history.length}</Badge>
              )}
            </div>

            {/* Filter tabs */}
            {sourceTypes.length > 1 && (
              <div className="flex items-center gap-1 mb-3 flex-wrap">
                {["all", ...sourceTypes].map(t => (
                  <button
                    key={t}
                    onClick={() => setHistoryFilter(t)}
                    className={`text-[10px] font-medium px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                      historyFilter === t
                        ? "bg-teal-500 text-white"
                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {t !== "all" && sourceTypeIcon(t, "w-3 h-3")}
                    {t === "all" ? "All" : sourceTypeLabel(t)}
                  </button>
                ))}
              </div>
            )}

            {historyQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
            ) : filteredHistory.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium text-foreground mb-1">No sources ingested yet.</p>
                <p className="text-xs text-muted-foreground">Use the mode cards above to start building Cortex's knowledge base.</p>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "480px" }} data-testid="list-cortex-history">
                {filteredHistory.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    data-testid={`row-cortex-history-${r.id}`}
                    onClick={() => setSelectedRecord(r)}
                    className="w-full text-left flex items-start gap-3 rounded-lg border border-border bg-card p-3 hover:border-teal-300 dark:hover:border-teal-700 hover:bg-accent/40 hover:shadow-sm transition-all cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  >
                    <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-teal-500">{sourceTypeIcon(r.source_type, "w-3.5 h-3.5")}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-semibold text-foreground leading-snug line-clamp-1">
                          {r.title ?? r.original_filename ?? r.domain ?? r.canonical_url ?? "Untitled"}
                        </p>
                        <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="secondary" className="text-[10px] py-0">{sourceTypeLabel(r.source_type)}</Badge>
                        <IngestionStatusBadge record={r} />
                        <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                        {r.created_by_name && <span className="text-[10px] text-muted-foreground">· {r.created_by_name}</span>}
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
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Ask Cortex</h2>
            </div>
            <Card className="border border-border shadow-sm bg-card">
              <CardContent className="pt-5 pb-5 space-y-4">
                <form onSubmit={handleAsk} className="space-y-3">
                  <Textarea
                    data-testid="textarea-cortex-ask"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="What do you know about marina EV charging regulations? What are the key trends in this space?"
                    className="min-h-[96px] bg-background resize-none text-sm"
                    disabled={askMutation.isPending}
                  />
                  <Button
                    type="submit"
                    data-testid="button-cortex-ask-submit"
                    disabled={askMutation.isPending || !question.trim()}
                    className="w-full bg-teal-700 hover:bg-teal-600 text-white font-semibold"
                  >
                    {askMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Cortex is thinking…</> : <><Send className="w-4 h-4 mr-2" />Ask Cortex</>}
                  </Button>
                </form>

                {askMutation.isPending && (
                  <div className="rounded-lg border border-teal-200 dark:border-teal-800/60 bg-teal-50/60 dark:bg-teal-950/20 p-4">
                    <div className="flex items-center gap-2 text-teal-600 dark:text-teal-400 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                      Searching knowledge base and composing answer…
                    </div>
                  </div>
                )}

                {answer && !askMutation.isPending && (
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3" data-testid="text-cortex-answer">
                    <p className="text-xs font-semibold text-teal-600 dark:text-teal-400 uppercase tracking-wide mb-1">Cortex says</p>
                    <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{answer}</p>
                    {answerNotReadyCount > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {answerNotReadyCount} source{answerNotReadyCount > 1 ? "s" : ""} still processing — answer may be incomplete.
                      </p>
                    )}
                    {answerSources.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Sources cited</p>
                        <div className="space-y-1">
                          {answerSources.filter(s => s.usedRealContent).map((s: any, i: number) => (
                            <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <CheckCircle2 className="w-3 h-3 text-teal-500 flex-shrink-0" />
                              <span className="truncate">{s.title ?? s.domain ?? s.url}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
        </>)}
      </div>
    </div>
  );
}
