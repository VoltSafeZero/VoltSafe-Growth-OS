import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Mail, RefreshCw, ExternalLink, Link, Shield, AlertTriangle, Loader2 } from "lucide-react";
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
              <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${email.direction === "outbound" ? "bg-blue-400" : "bg-primary"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-sm font-medium truncate">
                    {email.subject || "(no subject)"}
                  </span>
                  {email.isReply && <Badge variant="outline" className="text-xs py-0">Re:</Badge>}
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
                    {email.direction === "outbound"
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
