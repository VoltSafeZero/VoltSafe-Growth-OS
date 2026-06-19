import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, RefreshCw, Link, Shield, AlertTriangle,
  Loader2, Eye, MousePointerClick, Clock, Flame, Zap, BarChart2, Inbox,
  Paperclip, ChevronDown, ChevronUp, Users, ArrowDownLeft, ArrowUpRight,
} from "lucide-react";
import { Link as WouterLink, useLocation } from "wouter";
import { sanitizeRichText } from "@/lib/sanitize-html";
import { FollowUpInsightCard } from "@/components/follow-up-insight-card";

// ── Types ──────────────────────────────────────────────────────────────────────

type EmailWithAssociation = {
  id: number;
  gmailMessageId: string;
  gmailThreadId: string;
  sourceAccountId: number | null;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string | null;
  ccEmails: string | null;
  sentAt: string | null;
  direction: string | null;
  snippet: string | null;
  ignoredReason: string | null;
  isReply: boolean | null;
  signalLevel: "none" | "low" | "medium" | "high" | "hot" | "replied" | null;
  isHot: boolean;
  isReplied: boolean;
  engagementScore: number;
  attachmentCount: number;
  association?: {
    id: number;
    confidenceScore: number | null;
    associationReasonJson: string | null;
    isAuto: boolean | null;
    isUserConfirmed: boolean | null;
  };
};

type EmailThread = {
  threadId: string;
  messages: EmailWithAssociation[];
  latest: EmailWithAssociation;
  hasMultiple: boolean;
};

type EngagementStats = {
  tracked: boolean;
  trackingId: string | null;
  recipientEmail: string | null;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  firstOpenAt: string | null;
  lastOpenAt: string | null;
  score: number;
  signalLevel: "none" | "low" | "medium" | "high" | "hot";
  isHot: boolean;
  events: Array<{
    eventType: string;
    url: string | null;
    isBot: boolean;
    isDuplicate: boolean;
    occurredAt: string;
    metadata: Record<string, unknown> | null;
  }>;
};

// ── Date helpers ───────────────────────────────────────────────────────────────

function formatEmailDate(dateStr: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: "short" });
  if (diffDays < 365) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

// ── ConfidenceBadge ────────────────────────────────────────────────────────────

function ConfidenceBadge({ score, isAuto, isUserConfirmed }: {
  score: number | null; isAuto: boolean | null; isUserConfirmed: boolean | null;
}) {
  if (isUserConfirmed) {
    return <Badge variant="outline" className="text-xs text-green-400 border-green-500/30 gap-1"><Shield className="h-3 w-3" /> Confirmed</Badge>;
  }
  if (!isAuto) {
    return <Badge variant="outline" className="text-xs text-blue-400 border-blue-500/30 gap-1"><Link className="h-3 w-3" /> Manual</Badge>;
  }
  if (score !== null && score >= 75) {
    return <Badge variant="outline" className="text-xs text-primary border-primary/30 gap-1"><Mail className="h-3 w-3" /> Auto-linked</Badge>;
  }
  if (score !== null && score >= 50) {
    return <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30 gap-1"><AlertTriangle className="h-3 w-3" /> Suggested</Badge>;
  }
  return null;
}

// ── DirectionBadge ─────────────────────────────────────────────────────────────

function DirectionBadge({ isOutbound }: { isOutbound: boolean }) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 gap-0.5 flex-shrink-0 ${
        isOutbound
          ? "text-blue-400 border-blue-500/20 bg-blue-500/5"
          : "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
      }`}
      data-testid={`badge-direction-${isOutbound ? "outbound" : "inbound"}`}
    >
      {isOutbound
        ? <><ArrowUpRight className="h-2.5 w-2.5" />Outbound</>
        : <><ArrowDownLeft className="h-2.5 w-2.5" />Inbound</>
      }
    </Badge>
  );
}

// ── SignalBadge (inline row-level) ─────────────────────────────────────────────

const SIGNAL_CONFIG = {
  hot:     { label: "Hot",              color: "text-orange-400 border-orange-500/40 bg-orange-500/10", Icon: Flame },
  replied: { label: "Replied",          color: "text-violet-400 border-violet-500/30 bg-violet-500/8",  Icon: Zap },
  high:    { label: "Clicked",          color: "text-blue-400 border-blue-500/30 bg-blue-500/8",        Icon: MousePointerClick },
  medium:  { label: "Opened repeatedly", color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/8", Icon: Eye },
  low:     { label: "Opened",           color: "text-emerald-400/70 border-emerald-500/20",             Icon: Eye },
  none:    null,
} as const;

function SignalBadge({ level, isHot, isReplied }: { level: string | null; isHot: boolean; isReplied?: boolean }) {
  const key = (isReplied ? "replied" : isHot ? "hot" : (level ?? "none")) as keyof typeof SIGNAL_CONFIG;
  const cfg = SIGNAL_CONFIG[key] || null;
  if (!cfg) return null;
  const { label, color, Icon } = cfg;
  return (
    <Badge
      variant="outline"
      className={`text-xs py-0 gap-1 ${color}`}
      data-testid={`badge-signal-${key}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </Badge>
  );
}

// ── ScoreBar ───────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.round((score / 85) * 100));
  const color =
    score >= 75 ? "bg-orange-500" :
    score >= 36 ? "bg-blue-500"   :
    score >= 16 ? "bg-emerald-500" :
    score >= 1  ? "bg-emerald-400/60" : "bg-muted";
  return (
    <div className="flex items-center gap-2" data-testid="engagement-score-bar">
      <div className="flex-1 h-1.5 bg-secondary/40 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-6 text-right">{score}</span>
    </div>
  );
}

// ── EngagementPanel ────────────────────────────────────────────────────────────

function EngagementPanel({ gmailMessageId }: { gmailMessageId: string }) {
  const engQuery = useQuery<EngagementStats>({
    queryKey: ["/api/email-engagement/by-message", gmailMessageId],
    queryFn: async () => {
      const res = await fetch(
        `/api/email-engagement/by-message/${encodeURIComponent(gmailMessageId)}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30000,
  });

  if (engQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading engagement data…
      </div>
    );
  }

  const stats = engQuery.data;
  if (!stats) return null;

  if (!stats.tracked) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground/60 italic" data-testid="engagement-untracked">
        <Eye className="h-3 w-3 opacity-40" />
        Sent without tracking — no open data is being collected for this message.
      </div>
    );
  }
  if (stats.uniqueOpens === 0) {
    return (
      <div className="space-y-1" data-testid="engagement-tracked-noopens">
        <div className="flex items-center gap-2 text-xs text-emerald-400/80">
          <Eye className="h-3 w-3" />
          Tracked — not opened yet
          {stats.recipientEmail && (
            <span className="text-muted-foreground/60">· {stats.recipientEmail}</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/40">
          Opens register when the recipient's mail client loads the embedded image.
        </p>
      </div>
    );
  }

  const visibleEvents = stats.events.filter(e => !e.isBot);

  return (
    <div className="space-y-3" data-testid="engagement-panel">
      {stats.recipientEmail && (
        <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider" data-testid="engagement-recipient">
          Recipient: <span className="font-mono normal-case text-muted-foreground">{stats.recipientEmail}</span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {stats.isHot && (
          <div
            className="flex items-center gap-1 text-xs font-semibold text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded px-2 py-0.5"
            data-testid="engagement-hot-indicator"
          >
            <Flame className="h-3 w-3" /> Hot prospect
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="engagement-signal-level">
          <BarChart2 className="h-3 w-3" />
          <span className="capitalize font-medium">{stats.signalLevel}</span> signal
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Engagement score</p>
        <ScoreBar score={stats.score} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div
          className={`flex items-center gap-1.5 text-xs font-medium ${stats.uniqueOpens > 0 ? "text-emerald-400" : "text-muted-foreground/50"}`}
          data-testid="engagement-opens-count"
        >
          <Eye className="h-3.5 w-3.5" />
          {stats.uniqueOpens > 0 ? `Opened ${stats.uniqueOpens}×` : "Not opened"}
        </div>
        {stats.uniqueClicks > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-blue-400" data-testid="engagement-clicks-count">
            <MousePointerClick className="h-3.5 w-3.5" />
            {stats.uniqueClicks} click{stats.uniqueClicks !== 1 ? "s" : ""}
          </div>
        )}
        {stats.lastOpenAt && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="engagement-last-open">
            <Clock className="h-3 w-3" />
            Last seen {formatRelativeTime(stats.lastOpenAt)}
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/40 leading-tight">
        Opens = image loads (soft signal, not a guaranteed read). Same-source rapid loads are deduplicated.
      </p>

      {visibleEvents.length > 0 && (
        <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
          {visibleEvents.slice(0, 12).map((ev, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 text-[11px] ${ev.isDuplicate ? "opacity-40" : "text-muted-foreground"}`}
            >
              {ev.eventType === "open"
                ? <Eye className="h-3 w-3 text-emerald-400 shrink-0" />
                : <MousePointerClick className="h-3 w-3 text-blue-400 shrink-0" />}
              <span className="capitalize">{ev.eventType}</span>
              {ev.isDuplicate && <span className="text-muted-foreground/50 text-[10px]">(rapid repeat)</span>}
              {ev.url && !ev.isDuplicate && (
                <span className="truncate text-muted-foreground/60 max-w-[160px]">
                  {ev.url.replace(/^https?:\/\//, "")}
                </span>
              )}
              <span className="shrink-0 ml-auto">{formatRelativeTime(ev.occurredAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── FullBodyViewer ─────────────────────────────────────────────────────────────

type FullBodyData = {
  bodyHtml: string;
  bodyText: string;
  isHtml: boolean;
  source: string;
};

function FullBodyViewer({ gmailMessageId, snippet }: { gmailMessageId: string; snippet: string | null }) {
  const bodyQuery = useQuery<FullBodyData>({
    queryKey: ["/api/gmail/messages/full-body", gmailMessageId],
    queryFn: async () => {
      const res = await fetch(
        `/api/gmail/messages/${encodeURIComponent(gmailMessageId)}/full-body`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load body");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (bodyQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2" data-testid="email-body-loading">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading full email…
      </div>
    );
  }

  const data = bodyQuery.data;

  if (data?.bodyHtml) {
    const safe = sanitizeRichText(data.bodyHtml);
    return (
      <div
        className="max-h-96 overflow-y-auto rounded border border-border/30 bg-background/50 p-3 text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: safe }}
        data-testid="email-full-body-html"
      />
    );
  }

  if (data?.bodyText) {
    return (
      <pre
        className="max-h-96 overflow-y-auto text-xs text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed"
        data-testid="email-full-body-text"
      >
        {data.bodyText}
      </pre>
    );
  }

  if (snippet) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="email-full-body-snippet">{snippet}</p>
    );
  }

  return null;
}

// ── MessageRow — single message inside an expanded thread ───────────────────────

function MessageRow({
  email,
  isBodyOpen,
  onToggleBody,
  objectType,
  objectId,
  onConfirm,
  onRemove,
  confirmPending,
  removePending,
}: {
  email: EmailWithAssociation;
  isBodyOpen: boolean;
  onToggleBody: () => void;
  objectType: string;
  objectId: number;
  onConfirm: (emailId: number, assocId: number) => void;
  onRemove: (emailId: number, assocId: number) => void;
  confirmPending: boolean;
  removePending: boolean;
}) {
  const [, setLocation] = useLocation();
  const isOutbound = email.direction === "outbound";
  const reasons: string[] = email.association?.associationReasonJson
    ? JSON.parse(email.association.associationReasonJson)
    : [];

  return (
    <div
      className="border border-border/30 rounded-lg overflow-hidden bg-background/30"
      data-testid={`email-message-row-${email.id}`}
    >
      {/* Message header — always visible */}
      <button
        className="w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-muted/30 transition-colors"
        onClick={onToggleBody}
        data-testid={`button-toggle-message-${email.id}`}
      >
        <div className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOutbound ? "bg-blue-400" : "bg-primary"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-foreground/90 truncate">
              {isOutbound
                ? `You → ${email.toEmails ? email.toEmails.split(/[,;]/)[0].trim() : "recipient"}`
                : `${email.fromName || email.fromEmail || "Unknown"}`
              }
            </span>
            <span className="text-xs text-muted-foreground/50 flex-shrink-0 ml-auto">
              {formatEmailDate(email.sentAt)}
            </span>
          </div>
          {!isBodyOpen && email.snippet && (
            <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{email.snippet}</p>
          )}
        </div>
        {isBodyOpen
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
        }
      </button>

      {/* Message body — only when open */}
      {isBodyOpen && (
        <div className="border-t border-border/20 px-3 py-2.5 space-y-3 bg-muted/10">
          {/* Recipients */}
          <div className="space-y-0.5" data-testid={`recipients-block-${email.id}`}>
            <div className="flex gap-1.5 text-xs">
              <span className="text-muted-foreground/50 w-7 flex-shrink-0">From</span>
              <span className="text-foreground/80 truncate">
                {email.fromName ? `${email.fromName} <${email.fromEmail}>` : (email.fromEmail || "—")}
              </span>
            </div>
            {email.toEmails && (
              <div className="flex gap-1.5 text-xs" data-testid={`to-field-${email.id}`}>
                <span className="text-muted-foreground/50 w-7 flex-shrink-0">To</span>
                <span className="text-foreground/80 truncate">{email.toEmails}</span>
              </div>
            )}
            {email.ccEmails && (
              <div className="flex gap-1.5 text-xs" data-testid={`cc-field-${email.id}`}>
                <span className="text-muted-foreground/50 w-7 flex-shrink-0">CC</span>
                <span className="text-foreground/80 truncate">{email.ccEmails}</span>
              </div>
            )}
          </div>

          {/* Full body */}
          <FullBodyViewer gmailMessageId={email.gmailMessageId} snippet={email.snippet} />

          {/* Attachments badge */}
          {email.attachmentCount > 0 && (
            <div
              className="flex items-center gap-1.5 text-xs text-muted-foreground/70 bg-secondary/20 rounded px-2 py-1 w-fit"
              data-testid={`attachment-count-${email.id}`}
            >
              <Paperclip className="h-3 w-3" />
              {email.attachmentCount} attachment{email.attachmentCount !== 1 ? "s" : ""}
              <span className="text-muted-foreground/40 text-[10px]">· Open in VS Mail to download</span>
            </div>
          )}

          {/* Engagement (outbound only) */}
          {isOutbound && (
            <div className="rounded-lg border border-border/40 bg-secondary/10 px-3 py-2.5 space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="h-3 w-3" />Engagement
              </p>
              <EngagementPanel gmailMessageId={email.gmailMessageId} />
            </div>
          )}

          {/* Why linked */}
          {reasons.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Why linked</p>
              <ul className="space-y-0.5">
                {reasons.map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-primary/60 mt-0.5">·</span>{r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {email.ignoredReason && (
            <p className="text-xs text-amber-400 bg-amber-500/10 rounded px-2 py-1">
              Note: {email.ignoredReason}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap items-center pt-0.5">
            <button
              onClick={() => {
                const params = new URLSearchParams({ thread: email.gmailThreadId });
                if (email.sourceAccountId) params.set("account", String(email.sourceAccountId));
                setLocation(`/gmail?${params.toString()}`);
              }}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              data-testid={`button-open-vsmail-${email.id}`}
            >
              <Inbox className="h-3 w-3" /> Open in VS Mail
            </button>
            {email.association && !email.association.isUserConfirmed && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs px-2"
                onClick={() => onConfirm(email.id, email.association!.id)}
                disabled={confirmPending}
                data-testid={`button-confirm-assoc-${email.id}`}
              >
                Confirm link
              </Button>
            )}
            {email.association && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs px-2 text-muted-foreground hover:text-red-400"
                onClick={() => onRemove(email.id, email.association!.id)}
                disabled={removePending}
                data-testid={`button-remove-assoc-${email.id}`}
              >
                Remove link
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ThreadCard ─────────────────────────────────────────────────────────────────

function ThreadCard({
  thread,
  isExpanded,
  expandedMessageId,
  onToggleThread,
  onToggleMessage,
  objectType,
  objectId,
  onConfirm,
  onRemove,
  confirmPending,
  removePending,
}: {
  thread: EmailThread;
  isExpanded: boolean;
  expandedMessageId: number | null;
  onToggleThread: () => void;
  onToggleMessage: (id: number) => void;
  objectType: string;
  objectId: number;
  onConfirm: (emailId: number, assocId: number) => void;
  onRemove: (emailId: number, assocId: number) => void;
  confirmPending: boolean;
  removePending: boolean;
}) {
  const latest = thread.latest;
  const isOutbound = latest.direction === "outbound";
  const hasSignal = isOutbound && (latest.isReplied || (latest.signalLevel && latest.signalLevel !== "none"));

  return (
    <div
      className="border border-border/50 rounded-lg overflow-hidden hover:border-border transition-colors"
      data-testid={`thread-card-${thread.threadId}`}
    >
      {/* ── Thread collapsed header ── */}
      <button
        className="w-full text-left px-4 py-3 flex items-start gap-3"
        onClick={onToggleThread}
        data-testid={`button-toggle-thread-${thread.threadId}`}
      >
        <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${isOutbound ? "bg-blue-400" : "bg-primary"}`} />
        <div className="flex-1 min-w-0">
          {/* Subject row */}
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-sm font-medium truncate">
              {latest.subject || "(no subject)"}
            </span>
            {latest.isReply && (
              <Badge variant="outline" className="text-xs py-0 flex-shrink-0">Re:</Badge>
            )}
            {thread.hasMultiple && (
              <Badge
                variant="outline"
                className="text-xs py-0 gap-1 text-muted-foreground border-border/50 flex-shrink-0"
                data-testid={`badge-thread-count-${thread.threadId}`}
              >
                <Users className="h-2.5 w-2.5" />{thread.messages.length}
              </Badge>
            )}
            {isOutbound && !hasSignal && (
              <Badge variant="outline" className="text-xs py-0 gap-1 text-blue-400 border-blue-500/20 flex-shrink-0">
                <Eye className="h-2.5 w-2.5" />Tracked
              </Badge>
            )}
            {isOutbound && hasSignal && (
              <SignalBadge level={latest.signalLevel} isHot={latest.isHot} isReplied={latest.isReplied} />
            )}
            {latest.association && (
              <ConfidenceBadge
                score={latest.association.confidenceScore}
                isAuto={latest.association.isAuto}
                isUserConfirmed={latest.association.isUserConfirmed}
              />
            )}
          </div>

          {/* Sender / date / meta row */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="truncate">
              {isOutbound
                ? `Sent by you`
                : latest.fromName || latest.fromEmail || "Unknown"}
            </span>
            <span className="flex-shrink-0">·</span>
            <span className="flex-shrink-0">{formatEmailDate(latest.sentAt)}</span>
            {isOutbound && latest.engagementScore > 0 && (
              <>
                <span className="flex-shrink-0">·</span>
                <span className="flex items-center gap-0.5 flex-shrink-0 text-muted-foreground/70" data-testid={`text-score-${latest.id}`}>
                  <Zap className="h-2.5 w-2.5" />
                  {latest.engagementScore}pts
                </span>
              </>
            )}
            <DirectionBadge isOutbound={isOutbound} />
            {latest.attachmentCount > 0 && (
              <span
                className="flex items-center gap-0.5 text-muted-foreground/60 flex-shrink-0"
                data-testid={`badge-attachment-count-${latest.id}`}
              >
                <Paperclip className="h-2.5 w-2.5" />{latest.attachmentCount}
              </span>
            )}
          </div>

          {/* Snippet */}
          {latest.snippet && !isExpanded && (
            <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{latest.snippet}</p>
          )}
        </div>

        {/* Expand indicator */}
        <div className="flex-shrink-0 mt-0.5">
          {isExpanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground/50" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
          }
        </div>
      </button>

      {/* ── Thread expanded body ── */}
      {isExpanded && (
        <div className="border-t border-border/30 px-4 py-3 bg-muted/20 space-y-2.5">
          {/* Thread summary header when multiple messages */}
          {thread.hasMultiple && (
            <div
              className="flex items-center gap-2 text-xs text-muted-foreground/70 pb-1.5 border-b border-border/20"
              data-testid={`thread-summary-header-${thread.threadId}`}
            >
              <Users className="h-3.5 w-3.5" />
              <span className="font-medium">{thread.messages.length} messages</span>
              <span>·</span>
              <span>
                {formatEmailDate(thread.messages[thread.messages.length - 1].sentAt)}
                {" → "}
                {formatEmailDate(thread.messages[0].sentAt)}
              </span>
            </div>
          )}

          {/* Message rows (newest first) */}
          {thread.messages.map((msg) => (
            <MessageRow
              key={msg.id}
              email={msg}
              isBodyOpen={expandedMessageId === msg.id}
              onToggleBody={() => onToggleMessage(msg.id)}
              objectType={objectType}
              objectId={objectId}
              onConfirm={onConfirm}
              onRemove={onRemove}
              confirmPending={confirmPending}
              removePending={removePending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── EmailsTab ──────────────────────────────────────────────────────────────────

export function EmailsTab({ objectType, objectId }: { objectType: string; objectId: number }) {
  const { toast } = useToast();
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [expandedMessageId, setExpandedMessageId] = useState<number | null>(null);

  const emailsQuery = useQuery<EmailWithAssociation[]>({
    queryKey: ["/api/crm-emails", objectType, objectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/crm-emails?objectType=${objectType}&objectId=${objectId}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load emails");
      return res.json();
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (objectType === "account") {
        const res = await apiRequest("POST", `/api/accounts/${objectId}/reindex-emails`);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/gmail/sync?limit=50");
      return res.json();
    },
    onSuccess: (data) => {
      const reindexed = data.messagesReindexed != null
        ? `${data.messagesReindexed} message${data.messagesReindexed !== 1 ? "s" : ""} scanned`
        : `${data.newMessages ?? 0} new messages processed`;
      toast({ title: "Sync complete", description: reindexed });
      queryClient.invalidateQueries({ queryKey: ["/api/crm-emails", objectType, objectId] });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ emailId, assocId }: { emailId: number; assocId: number }) => {
      const res = await apiRequest("POST", `/api/email-messages/${emailId}/confirm`, { associationId: assocId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm-emails", objectType, objectId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({ emailId, assocId }: { emailId: number; assocId: number }) => {
      const res = await apiRequest("POST", `/api/email-messages/${emailId}/reassign`, {
        removeObjectType: objectType,
        removeObjectId: objectId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Association removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/crm-emails", objectType, objectId] });
    },
  });

  const emails = emailsQuery.data || [];

  // ── Thread grouping (client-side, no API change) ───────────────────────────
  const threads = useMemo<EmailThread[]>(() => {
    const map = new Map<string, EmailWithAssociation[]>();
    for (const email of emails) {
      const key = email.gmailThreadId || String(email.id);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(email);
    }
    return Array.from(map.entries())
      .map(([threadId, msgs]) => {
        const sorted = [...msgs].sort(
          (a, b) => (b.sentAt ? new Date(b.sentAt).getTime() : 0) - (a.sentAt ? new Date(a.sentAt).getTime() : 0)
        );
        return {
          threadId,
          messages: sorted,
          latest: sorted[0],
          hasMultiple: sorted.length > 1,
        };
      })
      .sort(
        (a, b) =>
          (b.latest.sentAt ? new Date(b.latest.sentAt).getTime() : 0) -
          (a.latest.sentAt ? new Date(a.latest.sentAt).getTime() : 0)
      );
  }, [emails]);

  function handleToggleThread(threadId: string) {
    if (expandedThreadId === threadId) {
      setExpandedThreadId(null);
      setExpandedMessageId(null);
    } else {
      setExpandedThreadId(threadId);
      // Auto-expand the latest message body
      const thread = threads.find(t => t.threadId === threadId);
      if (thread) setExpandedMessageId(thread.latest.id);
    }
  }

  function handleToggleMessage(msgId: number) {
    setExpandedMessageId(prev => (prev === msgId ? null : msgId));
  }

  const threadCount = threads.length;
  const msgCount = emails.length;
  const countLabel = threadCount === msgCount
    ? `${msgCount} email${msgCount !== 1 ? "s" : ""} linked`
    : `${threadCount} thread${threadCount !== 1 ? "s" : ""} · ${msgCount} email${msgCount !== 1 ? "s" : ""}`;

  return (
    <div className="space-y-3">
      <FollowUpInsightCard entityType={objectType} entityId={objectId} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" data-testid="text-email-count">
          {emails.length === 0 ? "No emails linked yet" : countLabel}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          data-testid="button-sync-emails"
          className="gap-2"
        >
          {syncMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync Gmail
        </Button>
      </div>

      {emailsQuery.isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="border border-border/50 rounded-lg p-3 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      )}

      {!emailsQuery.isLoading && emails.length === 0 && (
        <div className="border border-border/50 rounded-lg p-6 text-center">
          <Mail className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No emails linked to this record yet.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Click "Sync Gmail" to pull in recent emails and auto-match them.
          </p>
        </div>
      )}

      {threads.map((thread) => (
        <ThreadCard
          key={thread.threadId}
          thread={thread}
          isExpanded={expandedThreadId === thread.threadId}
          expandedMessageId={expandedThreadId === thread.threadId ? expandedMessageId : null}
          onToggleThread={() => handleToggleThread(thread.threadId)}
          onToggleMessage={handleToggleMessage}
          objectType={objectType}
          objectId={objectId}
          onConfirm={(emailId, assocId) => confirmMutation.mutate({ emailId, assocId })}
          onRemove={(emailId, assocId) => removeMutation.mutate({ emailId, assocId })}
          confirmPending={confirmMutation.isPending}
          removePending={removeMutation.isPending}
        />
      ))}
    </div>
  );
}
