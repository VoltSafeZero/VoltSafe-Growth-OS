import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Mail, RefreshCw, ExternalLink, Link, Shield, AlertTriangle, Loader2, Eye, MousePointerClick, Clock } from "lucide-react";
import { Link as WouterLink } from "wouter";

type EmailWithAssociation = {
  id: number;
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  sentAt: string | null;
  direction: string | null;
  snippet: string | null;
  ignoredReason: string | null;
  isReply: boolean | null;
  association?: {
    id: number;
    confidenceScore: number | null;
    associationReasonJson: string | null;
    isAuto: boolean | null;
    isUserConfirmed: boolean | null;
  };
};

type EngagementStats = {
  trackingId: string | null;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  firstOpenAt: string | null;
  lastOpenAt: string | null;
  events: Array<{ eventType: string; url: string | null; isBot: boolean; occurredAt: string }>;
};

function formatEmailDate(dateStr: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
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
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function ConfidenceBadge({ score, isAuto, isUserConfirmed }: { score: number | null; isAuto: boolean | null; isUserConfirmed: boolean | null }) {
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

function EngagementPanel({ gmailMessageId }: { gmailMessageId: string }) {
  const engQuery = useQuery<EngagementStats>({
    queryKey: ["/api/email-engagement/by-message", gmailMessageId],
    queryFn: async () => {
      const res = await fetch(`/api/email-engagement/by-message/${encodeURIComponent(gmailMessageId)}`, { credentials: "include" });
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
  if (!stats || !stats.trackingId) {
    return (
      <p className="text-xs text-muted-foreground/50 italic">No tracking data — email sent without tracking or tracking not yet recorded.</p>
    );
  }

  const realEvents = stats.events.filter(e => !e.isBot);
  const openEvents = realEvents.filter(e => e.eventType === "open");
  const clickEvents = realEvents.filter(e => e.eventType === "click");

  return (
    <div className="space-y-2.5" data-testid="engagement-panel">
      {/* Summary row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`flex items-center gap-1.5 text-xs font-medium ${stats.uniqueOpens > 0 ? "text-emerald-400" : "text-muted-foreground/50"}`}
          data-testid="engagement-opens-count">
          <Eye className="h-3.5 w-3.5" />
          {stats.uniqueOpens > 0 ? `${stats.uniqueOpens} open${stats.uniqueOpens !== 1 ? "s" : ""}` : "Not opened"}
        </div>
        {stats.uniqueClicks > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-blue-400" data-testid="engagement-clicks-count">
            <MousePointerClick className="h-3.5 w-3.5" />
            {stats.uniqueClicks} click{stats.uniqueClicks !== 1 ? "s" : ""}
          </div>
        )}
        {stats.firstOpenAt && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            First opened {formatRelativeTime(stats.firstOpenAt)}
          </div>
        )}
      </div>

      {/* Event timeline */}
      {realEvents.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {realEvents.slice(0, 10).map((ev, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {ev.eventType === "open"
                ? <Eye className="h-3 w-3 text-emerald-400 shrink-0" />
                : <MousePointerClick className="h-3 w-3 text-blue-400 shrink-0" />}
              <span className="capitalize">{ev.eventType}</span>
              {ev.url && <span className="truncate text-muted-foreground/60 max-w-[180px]">{ev.url.replace(/^https?:\/\//, "")}</span>}
              <span className="shrink-0 ml-auto">{formatRelativeTime(ev.occurredAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmailsTab({ objectType, objectId }: { objectType: string; objectId: number }) {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const emailsQuery = useQuery<EmailWithAssociation[]>({
    queryKey: ["/api/crm-emails", objectType, objectId],
    queryFn: async () => {
      const res = await fetch(`/api/crm-emails?objectType=${objectType}&objectId=${objectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load emails");
      return res.json();
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/gmail/sync?limit=50");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Sync complete`, description: `${data.newMessages} new messages processed` });
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
    mutationFn: async ({ emailId, assocId, assocObjectType, assocObjectId }: { emailId: number; assocId: number; assocObjectType: string; assocObjectId: number }) => {
      const res = await apiRequest("POST", `/api/email-messages/${emailId}/reassign`, {
        removeObjectType: assocObjectType,
        removeObjectId: assocObjectId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Association removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/crm-emails", objectType, objectId] });
    },
  });

  const emails = emailsQuery.data || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {emails.length === 0 ? "No emails linked yet" : `${emails.length} email${emails.length !== 1 ? "s" : ""} linked`}
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
          <p className="text-xs text-muted-foreground/60 mt-1">Click "Sync Gmail" to pull in recent emails and auto-match them.</p>
        </div>
      )}

      {emails.map((email) => {
        const isExpanded = expandedId === email.id;
        const reasons: string[] = email.association?.associationReasonJson
          ? JSON.parse(email.association.associationReasonJson)
          : [];
        const isOutbound = email.direction === "outbound";

        return (
          <div
            key={email.id}
            className="border border-border/50 rounded-lg overflow-hidden hover:border-border transition-colors"
            data-testid={`email-item-${email.id}`}
          >
            <button
              className="w-full text-left px-4 py-3 flex items-start gap-3"
              onClick={() => setExpandedId(isExpanded ? null : email.id)}
            >
              <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${isOutbound ? "bg-blue-400" : "bg-primary"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-sm font-medium truncate">
                    {email.subject || "(no subject)"}
                  </span>
                  {email.isReply && <Badge variant="outline" className="text-xs py-0">Re:</Badge>}
                  {isOutbound && (
                    <Badge variant="outline" className="text-xs py-0 gap-1 text-blue-400 border-blue-500/20">
                      <Eye className="h-2.5 w-2.5" />Tracked
                    </Badge>
                  )}
                  {email.association && (
                    <ConfidenceBadge
                      score={email.association.confidenceScore}
                      isAuto={email.association.isAuto}
                      isUserConfirmed={email.association.isUserConfirmed}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {isOutbound
                      ? `Sent by you`
                      : email.fromName || email.fromEmail || "Unknown"}
                  </span>
                  <span className="flex-shrink-0">·</span>
                  <span className="flex-shrink-0">{formatEmailDate(email.sentAt)}</span>
                </div>
                {email.snippet && !isExpanded && (
                  <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{email.snippet}</p>
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-border/30 px-4 py-3 bg-muted/20 space-y-3">
                {email.snippet && (
                  <p className="text-sm text-muted-foreground">{email.snippet}</p>
                )}
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>From: <span className="text-foreground">{email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}</span></span>
                </div>

                {/* ── Engagement panel (outbound only) ─────────────────── */}
                {isOutbound && (
                  <div className="rounded-lg border border-border/40 bg-secondary/10 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Eye className="h-3 w-3" />Engagement
                    </p>
                    <EngagementPanel gmailMessageId={email.gmailMessageId} />
                  </div>
                )}

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
                  <p className="text-xs text-amber-400 bg-amber-500/10 rounded px-2 py-1">Note: {email.ignoredReason}</p>
                )}

                <div className="flex gap-2 flex-wrap">
                  <a
                    href={`https://mail.google.com/mail/u/0/#inbox/${email.gmailThreadId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    data-testid={`link-open-gmail-${email.id}`}
                  >
                    <ExternalLink className="h-3 w-3" /> Open in Gmail
                  </a>
                  {email.association && !email.association.isUserConfirmed && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2"
                      onClick={() => confirmMutation.mutate({ emailId: email.id, assocId: email.association!.id })}
                      disabled={confirmMutation.isPending}
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
                      onClick={() => removeMutation.mutate({
                        emailId: email.id,
                        assocId: email.association!.id,
                        assocObjectType: objectType,
                        assocObjectId: objectId,
                      })}
                      disabled={removeMutation.isPending}
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
      })}
    </div>
  );
}
