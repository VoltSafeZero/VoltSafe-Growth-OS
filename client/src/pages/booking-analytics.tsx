import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  TrendingUp, Trophy, AlertTriangle, Users, Mail, MousePointerClick,
  CheckCircle2, Clock, Target, DollarSign, FileText, Zap, Eye,
  Flame, ArrowRight, RefreshCw, Trash2, Award, Droplets, LayoutDashboard,
  PlusCircle, Copy, PenSquare, ExternalLink, Inbox,
} from "lucide-react";
import { Link as WLink } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type DraftTone = "short" | "warm" | "direct";
interface DraftResponse {
  subject: string;
  body: string;
  suggestedNextAction: string;
  context: { recipientEmail: string; bookingLinkName: string };
  meta: { kind: string; tone: DraftTone; sentEmail: false };
}

type LinkRow = {
  bookingLinkId: number; bookingLinkName: string;
  ownerUserId: number; ownerName: string | null;
  sent: number; opened: number; booked: number;
  openRate: number; bookingRate: number; underperforming: boolean;
};
type OwnerRow = {
  ownerUserId: number; ownerName: string | null;
  sent: number; opened: number; booked: number;
  openRate: number; bookingRate: number;
};
type SegmentRow = {
  segment: "contact" | "lead" | "orphan";
  sent: number; opened: number; booked: number;
  openRate: number; bookingRate: number;
};
type Timing = {
  sentToOpenedSec:   number | null; sentToOpenedSamples:   number;
  openedToBookedSec: number | null; openedToBookedSamples: number;
  sentToBookedSec:   number | null; sentToBookedSamples:   number;
};
type Leaderboard = {
  top: (LinkRow & { rank: number })[];
  underperforming: LinkRow[];
  minSent: number;
};
type RevenueSummary = {
  bookedMeetings: number; bookedAttributable: number; bookedOrphan: number;
  quotesGenerated: number; quotedValue: number;
  wonQuotes: number; wonValue: number;
  bookingToQuoteRate: number; quoteToWinRate: number;
  isAdmin: boolean;
};
type AttributionRow = {
  bookingLinkId: number; bookingLinkName: string;
  ownerUserId: number; ownerName: string | null;
  bookedMeetings: number; quotesGenerated: number; quotedValue: number;
  wonQuotes: number; wonValue: number;
  bookingToQuoteRate: number; quoteToWinRate: number;
};
type Attribution = {
  perLink: AttributionRow[];
  perOwner: Omit<AttributionRow, "bookingLinkId" | "bookingLinkName">[];
  topRevenueLinks: (AttributionRow & { rank: number })[];
  isAdmin: boolean;
};
type ActionListData = {
  bookedNoNextAction: {
    recipientId: number; recipientEmail: string;
    bookingLinkId: number; bookingLinkName: string;
    ownerUserId: number; ownerName: string | null;
    bookedAt: string;
    crm: { type: "contact" | "lead" | null; id: number | null; accountId: number | null };
  }[];
  openedNotBooked: {
    recipientId: number; recipientEmail: string;
    bookingLinkId: number; bookingLinkName: string;
    ownerUserId: number; ownerName: string | null;
    firstViewedAt: string; daysSinceOpen: number;
    crm: { type: "contact" | "lead" | null; id: number | null; accountId: number | null };
  }[];
  isAdmin: boolean;
};
const fmtMoney = (v: number) => `$${(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate  = (s: string) => new Date(s).toLocaleDateString();

type CardKind = "HOT_OPENED_NOT_BOOKED" | "BOOKED_NO_QUOTE" | "REUSE_LINK" | "REWRITE_LINK" | "REVENUE_WINNER" | "REVENUE_LEAK";
type Urgency = "high" | "medium" | "low";
interface CardItem {
  kind: CardKind; urgency: Urgency;
  title: string; subtitle: string; recommendation: string;
  recipientId?: number; bookingLinkId?: number; bookingLinkName?: string;
  ownerUserId?: number; ownerName?: string | null;
  daysSinceOpen?: number; bookedAt?: string;
  bookedMeetings?: number; bookingRate?: number;
  quotedValue?: number; wonValue?: number; quoteToWinRate?: number;
  crmType?: "contact" | "lead" | null;
  deepLink?: string;
}
type CommandCenterResponse = {
  isAdmin: boolean; generatedAt: string;
  buckets: Record<CardKind, CardItem[]>;
  counts: Record<CardKind, number>;
  totals: { highUrgency: number; mediumUrgency: number; lowUrgency: number };
};
// Phase K — Draft Approval Queue row.
type DraftQueueItem = {
  taskId: number; status: string; isReviewed: boolean;
  createdAt: string; createdByUserId: number | null;
  createdByName: string | null; createdByEmail: string | null;
  ownerUserId: number | null; ownerName: string | null;
  completedAt: string | null; completedByName: string | null;
  draftId: string | null; messageId: string | null; threadId: string | null;
  gmailAccountId: number | null; gmailAccountEmail: string | null;
  recipientEmail: string | null; subject: string | null; body: string | null;
  tone: string | null; isEdited: boolean;
  kind: string | null; recipientId: number | null;
  bookingLinkId: number | null; bookingLinkName: string | null;
};
const CARD_META: Record<CardKind, { label: string; badge: string; icon: any; color: string }> = {
  HOT_OPENED_NOT_BOOKED: { label: "Hot opens",        badge: "Hot",          icon: Flame,    color: "text-orange-500" },
  BOOKED_NO_QUOTE:       { label: "Needs a quote",    badge: "Needs Quote",  icon: FileText, color: "text-amber-500" },
  REUSE_LINK:            { label: "Reuse these",      badge: "Reuse Link",   icon: RefreshCw, color: "text-emerald-500" },
  REWRITE_LINK:          { label: "Rewrite these",    badge: "Rewrite Link", icon: Trash2,   color: "text-red-500" },
  REVENUE_WINNER:        { label: "Revenue winners",  badge: "Winner",       icon: Award,    color: "text-yellow-500" },
  REVENUE_LEAK:          { label: "Revenue leakage",  badge: "Revenue Leak", icon: Droplets, color: "text-rose-500" },
};
const URGENCY_VARIANT: Record<Urgency, "destructive" | "default" | "secondary"> =
  { high: "destructive", medium: "default", low: "secondary" };

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtDuration = (sec: number | null) => {
  if (sec == null) return "—";
  if (sec < 60)        return `${Math.round(sec)}s`;
  if (sec < 3600)      return `${Math.round(sec / 60)}m`;
  if (sec < 86400)     return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
};

function MetricCard({ icon: Icon, label, value, sub, testId }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub?: string; testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4 flex items-start gap-3">
        <Icon className="h-5 w-5 mt-0.5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className="text-2xl font-semibold mt-0.5">{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelBar({ label, value, max, testId }: {
  label: string; value: number; max: number; testId: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{value.toLocaleString()}</span>
      </div>
      <div className="h-3 bg-muted rounded overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Phase H — kinds eligible for the "Create follow-up task" one-click action
const TASK_ACTION_KINDS: ReadonlySet<CardKind> = new Set([
  "HOT_OPENED_NOT_BOOKED", "BOOKED_NO_QUOTE", "REVENUE_LEAK",
]);
const COPY_LINK_KINDS: ReadonlySet<CardKind> = new Set([
  "REUSE_LINK", "REVENUE_WINNER",
]);

function CommandCard({ kind, items, isAdmin }: {
  kind: CardKind; items: CardItem[]; isAdmin: boolean;
}) {
  const meta = CARD_META[kind];
  const Icon = meta.icon;
  const { toast } = useToast();
  const [actedKeys, setActedKeys] = useState<Set<string>>(new Set());
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftRecipient, setDraftRecipient] = useState<{ recipientId: number; bookingLinkId?: number } | null>(null);
  const [draftTone, setDraftTone] = useState<DraftTone>("warm");
  const [draftData, setDraftData] = useState<DraftResponse | null>(null);
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [gmailDraftId, setGmailDraftId] = useState<string | null>(null);
  const [gmailMessageId, setGmailMessageId] = useState<string | null>(null);

  const generateDraft = useMutation({
    mutationFn: async (vars: { kind: CardKind; recipientId: number; bookingLinkId?: number; tone: DraftTone }) => {
      const res = await apiRequest("POST",
        "/api/crm/booking-analytics/actions/generate-followup-draft",
        vars,
      );
      return (await res.json()) as DraftResponse;
    },
    onSuccess: (data) => {
      setDraftData(data);
      setEditedSubject(data.subject);
      setEditedBody(data.body);
      setGmailDraftId(null);
    },
    onError: (err: any) => {
      toast({ title: "Could not generate draft", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const createGmailDraft = useMutation({
    mutationFn: async () => {
      if (!draftRecipient) throw new Error("No recipient selected");
      const res = await apiRequest("POST",
        "/api/crm/booking-analytics/actions/create-gmail-draft",
        {
          kind, recipientId: draftRecipient.recipientId,
          bookingLinkId: draftRecipient.bookingLinkId,
          tone: draftTone,
          subject: editedSubject, body: editedBody,
        },
      );
      return (await res.json()) as { draftId: string; messageId: string | null; to: string; meta: { sentEmail: false } };
    },
    onSuccess: (data) => {
      setGmailDraftId(data.draftId);
      setGmailMessageId(data.messageId ?? null);
      // Refresh the approval queue so the new draft shows up immediately.
      queryClient.invalidateQueries({ queryKey: ["/api/crm/booking-analytics/draft-approval-queue"] });
      toast({ title: "Draft created in Gmail", description: `Saved to Drafts for ${data.to}` });
    },
    onError: (err: any) => {
      toast({
        title: "Could not create Gmail draft",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const openDraft = (recipientId: number, bookingLinkId?: number) => {
    setDraftRecipient({ recipientId, bookingLinkId });
    setDraftData(null);
    setDraftTone("warm");
    setEditedSubject("");
    setEditedBody("");
    setGmailDraftId(null);
    setGmailMessageId(null);
    setDraftOpen(true);
    generateDraft.mutate({ kind, recipientId, bookingLinkId, tone: "warm" });
  };
  const regenerateDraft = (tone: DraftTone) => {
    setDraftTone(tone);
    setGmailDraftId(null);
    setGmailMessageId(null);
    if (!draftRecipient) return;
    generateDraft.mutate({ kind, recipientId: draftRecipient.recipientId, bookingLinkId: draftRecipient.bookingLinkId, tone });
  };
  const copyText = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${label} copied` }); }
    catch { toast({ title: "Copy failed", description: "Clipboard unavailable", variant: "destructive" }); }
  };

  const createTask = useMutation({
    mutationFn: async (vars: { kind: CardKind; recipientId: number; bookingLinkId?: number }) => {
      return await apiRequest("POST",
        "/api/crm/booking-analytics/actions/create-followup-task",
        vars,
      );
    },
    onSuccess: (data: any, vars) => {
      const key = `${vars.recipientId}:${vars.kind}`;
      setActedKeys((s) => new Set(s).add(key));
      toast({
        title: data?.created ? "Follow-up task created" : "Follow-up task already pending",
        description: data?.created
          ? "It now appears in Tasks for the link owner."
          : "Existing pending task was returned (no duplicate created).",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/booking-analytics/command-center"] });
    },
    onError: (err: any) => {
      toast({
        title: "Could not create task",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const onCopy = async (bookingLinkId: number) => {
    const url = `${window.location.origin}/booking-links/${bookingLinkId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard unavailable", variant: "destructive" });
    }
  };

  return (
    <Card data-testid={`bucket-${kind.toLowerCase()}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${meta.color}`} />
          <h2 className="font-medium">{meta.label}</h2>
          <Badge variant="outline" data-testid={`count-${kind.toLowerCase()}`}>{items.length}</Badge>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Nothing here — clean slate.</p>
        ) : (
          <div className="space-y-2">
            {items.map((c, idx) => {
              const acted = c.recipientId != null && actedKeys.has(`${c.recipientId}:${kind}`);
              const showTaskBtn  = TASK_ACTION_KINDS.has(kind) && c.recipientId != null;
              const showDraftBtn = TASK_ACTION_KINDS.has(kind) && c.recipientId != null;
              const showCopyBtn  = COPY_LINK_KINDS.has(kind) && c.bookingLinkId != null;
              const innerRow = (
                <div className="border rounded p-2 hover-elevate"
                     data-testid={`card-${kind.toLowerCase()}-${idx}`}>
                  <div className="flex justify-between gap-2 items-start">
                    <div className="font-medium text-sm truncate flex-1">{c.title}</div>
                    <Badge variant={URGENCY_VARIANT[c.urgency]} className="whitespace-nowrap">{meta.badge}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{c.subtitle}</div>
                  <div className="text-xs mt-1 flex items-start gap-1">
                    <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                    <span>{c.recommendation}</span>
                  </div>
                </div>
              );
              const wrappedRow = c.deepLink
                ? <WLink href={c.deepLink} className="block">{innerRow}</WLink>
                : innerRow;
              return (
                <div key={idx} className="space-y-1">
                  {wrappedRow}
                  {(showTaskBtn || showCopyBtn || showDraftBtn) && (
                    <div className="flex flex-wrap gap-2 px-1">
                      {showDraftBtn && (
                        <Button
                          size="sm" variant="outline"
                          onClick={(e) => { e.stopPropagation(); openDraft(c.recipientId!, c.bookingLinkId); }}
                          data-testid={`button-draft-email-${kind.toLowerCase()}-${idx}`}
                        >
                          <PenSquare className="h-3 w-3 mr-1" />Draft email
                        </Button>
                      )}
                      {showTaskBtn && (
                        <Button
                          size="sm" variant="outline"
                          disabled={acted || createTask.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            createTask.mutate({
                              kind, recipientId: c.recipientId!, bookingLinkId: c.bookingLinkId,
                            });
                          }}
                          data-testid={`button-create-task-${kind.toLowerCase()}-${idx}`}
                        >
                          {acted
                            ? (<><CheckCircle2 className="h-3 w-3 mr-1" />Task created</>)
                            : (<><PlusCircle className="h-3 w-3 mr-1" />Create follow-up task</>)}
                        </Button>
                      )}
                      {showCopyBtn && (
                        <Button
                          size="sm" variant="outline"
                          onClick={(e) => { e.stopPropagation(); onCopy(c.bookingLinkId!); }}
                          data-testid={`button-copy-link-${kind.toLowerCase()}-${idx}`}
                        >
                          <Copy className="h-3 w-3 mr-1" />Copy link
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-draft-email">
          <DialogHeader>
            <DialogTitle>Follow-up email draft</DialogTitle>
            <DialogDescription>
              Generated from CRM context. Review, personalize, and send from your own email client — nothing is sent automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Tone</span>
              <Select value={draftTone} onValueChange={(v) => regenerateDraft(v as DraftTone)}>
                <SelectTrigger className="w-32 h-8" data-testid="select-draft-tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warm">Warm</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                  <SelectItem value="direct">Direct</SelectItem>
                </SelectContent>
              </Select>
              {generateDraft.isPending && <span className="text-xs text-muted-foreground">Generating…</span>}
            </div>

            {draftData ? (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs uppercase tracking-wide text-muted-foreground">Subject</label>
                    <Button size="sm" variant="ghost" onClick={() => copyText(editedSubject, "Subject")}
                            data-testid="button-copy-draft-subject">
                      <Copy className="h-3 w-3 mr-1" />Copy
                    </Button>
                  </div>
                  <Input
                    value={editedSubject}
                    onChange={(e) => { setEditedSubject(e.target.value); setGmailDraftId(null); setGmailMessageId(null); }}
                    className="text-sm"
                    data-testid="input-draft-subject"
                  />
                  <span className="hidden" data-testid="text-draft-subject">{editedSubject}</span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs uppercase tracking-wide text-muted-foreground">Body</label>
                    <Button size="sm" variant="ghost" onClick={() => copyText(editedBody, "Body")}
                            data-testid="button-copy-draft-body">
                      <Copy className="h-3 w-3 mr-1" />Copy
                    </Button>
                  </div>
                  <Textarea
                    value={editedBody}
                    onChange={(e) => { setEditedBody(e.target.value); setGmailDraftId(null); setGmailMessageId(null); }}
                    className="text-sm font-sans max-h-72 min-h-[10rem]"
                    data-testid="textarea-draft-body"
                  />
                  <span className="hidden" data-testid="text-draft-body">{editedBody}</span>
                </div>
                <div className="border-l-2 border-amber-400 pl-3 text-xs text-muted-foreground"
                     data-testid="text-draft-next-action">
                  <strong>Next action:</strong> {draftData.suggestedNextAction}
                </div>
              </>
            ) : (
              <Skeleton className="h-48" data-testid="skeleton-draft" />
            )}
          </div>

          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline"
                    onClick={() => copyText(`Subject: ${editedSubject}\n\n${editedBody}`, "Full draft")}
                    disabled={!draftData} data-testid="button-copy-draft-full">
              <Copy className="h-4 w-4 mr-1" />Copy full draft
            </Button>
            <Button
              variant={gmailDraftId ? "secondary" : "default"}
              onClick={() => createGmailDraft.mutate()}
              disabled={!draftData || createGmailDraft.isPending || gmailDraftId != null}
              data-testid="button-create-gmail-draft"
            >
              {gmailDraftId
                ? (<><CheckCircle2 className="h-4 w-4 mr-1" />Draft created in Gmail</>)
                : (<><Mail className="h-4 w-4 mr-1" />{createGmailDraft.isPending ? "Creating…" : "Create Gmail Draft"}</>)}
            </Button>
            {gmailDraftId && (
              <Button asChild variant="outline" data-testid="link-view-gmail-draft">
                <a
                  href={gmailMessageId
                    ? `https://mail.google.com/mail/u/0/#drafts/${gmailMessageId}`
                    : `https://mail.google.com/mail/u/0/#drafts`}
                  target="_blank" rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-1" />View created Gmail draft
                </a>
              </Button>
            )}
            <Button onClick={() => setDraftOpen(false)} data-testid="button-close-draft">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Phase K — Draft Approval Queue tab ────────────────────────────────────
function DraftQueueTab({ queueQ }: {
  queueQ: ReturnType<typeof useQuery<{ items: DraftQueueItem[]; isAdmin: boolean }>>;
}) {
  const { toast } = useToast();
  const items = queueQ.data?.items ?? [];
  const pending  = items.filter((i) => !i.isReviewed);
  const reviewed = items.filter((i) =>  i.isReviewed);

  const markReviewed = useMutation({
    mutationFn: async (taskId: number) => {
      const res = await apiRequest("POST",
        `/api/crm/booking-analytics/draft-approval-queue/${taskId}/mark-reviewed`,
        {},
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/booking-analytics/draft-approval-queue"] });
      toast({ title: "Marked reviewed" });
    },
    onError: (err: any) => {
      toast({ title: "Could not mark reviewed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const copyText = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${label} copied` }); }
    catch { toast({ title: "Copy failed", description: "Clipboard unavailable", variant: "destructive" }); }
  };

  const openInGmail = (item: DraftQueueItem) => item.messageId
    ? `https://mail.google.com/mail/u/0/#drafts/${item.messageId}`
    : `https://mail.google.com/mail/u/0/#drafts`;

  if (queueQ.isLoading) {
    return <Skeleton className="h-64" data-testid="skeleton-draft-queue" />;
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4" />
          <h2 className="font-medium" data-testid="text-draft-queue-title">Gmail Draft Approval Queue</h2>
          <Badge variant="outline" className="ml-auto" data-testid="badge-draft-queue-pending">
            {pending.length} pending
          </Badge>
          <Badge variant="secondary" data-testid="badge-draft-queue-reviewed">
            {reviewed.length} reviewed
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          These drafts are saved in Gmail Drafts — nothing has been sent. Open in Gmail to review and send manually.
        </p>

        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center" data-testid="text-draft-queue-empty">
            No drafts in your approval queue.
          </div>
        ) : (
          <div className="space-y-3">
            {[...pending, ...reviewed].map((item) => (
              <div
                key={item.taskId}
                className={`border rounded-md p-3 space-y-2 ${item.isReviewed ? "opacity-60 bg-muted/30" : ""}`}
                data-testid={`row-draft-queue-${item.taskId}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate" data-testid={`text-draft-recipient-${item.taskId}`}>
                        {item.recipientEmail ?? "(unknown)"}
                      </span>
                      {item.kind && (
                        <Badge variant="outline" className="text-[10px]" data-testid={`badge-draft-kind-${item.taskId}`}>
                          {item.kind}
                        </Badge>
                      )}
                      {item.isReviewed && (
                        <Badge variant="secondary" className="text-[10px]" data-testid={`badge-draft-reviewed-${item.taskId}`}>
                          reviewed
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm" data-testid={`text-draft-subject-${item.taskId}`}>
                      <strong>Subject:</strong> {item.subject ?? "(no subject)"}
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      {item.bookingLinkName && (
                        <span data-testid={`text-draft-link-${item.taskId}`}>
                          link: {item.bookingLinkName}
                        </span>
                      )}
                      {item.gmailAccountEmail && (
                        <span data-testid={`text-draft-mailbox-${item.taskId}`}>
                          mailbox: {item.gmailAccountEmail}
                        </span>
                      )}
                      {item.createdByName && (
                        <span data-testid={`text-draft-created-by-${item.taskId}`}>
                          by: {item.createdByName}
                        </span>
                      )}
                      <span data-testid={`text-draft-created-at-${item.taskId}`}>
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild variant="outline" size="sm" data-testid={`link-draft-open-gmail-${item.taskId}`}>
                    <a href={openInGmail(item)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 mr-1" />Open in Gmail
                    </a>
                  </Button>
                  <Button variant="outline" size="sm"
                          onClick={() => copyText(item.subject ?? "", "Subject")}
                          disabled={!item.subject}
                          data-testid={`button-draft-copy-subject-${item.taskId}`}>
                    <Copy className="h-3 w-3 mr-1" />Copy subject
                  </Button>
                  <Button variant="outline" size="sm"
                          onClick={() => copyText(item.body ?? "", "Body")}
                          disabled={!item.body}
                          data-testid={`button-draft-copy-body-${item.taskId}`}>
                    <Copy className="h-3 w-3 mr-1" />Copy body
                  </Button>
                  {!item.isReviewed && (
                    <Button variant="default" size="sm"
                            onClick={() => markReviewed.mutate(item.taskId)}
                            disabled={markReviewed.isPending}
                            data-testid={`button-draft-mark-reviewed-${item.taskId}`}>
                      <CheckCircle2 className="h-3 w-3 mr-1" />Mark reviewed
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function BookingAnalyticsPage() {
  const linksQ        = useQuery<{ rows: LinkRow[]; isAdmin: boolean }>({ queryKey: ["/api/crm/booking-analytics/links"] });
  const ownersQ       = useQuery<{ rows: OwnerRow[] }>({ queryKey: ["/api/crm/booking-analytics/owners"], enabled: !!linksQ.data?.isAdmin });
  const segmentsQ     = useQuery<{ rows: SegmentRow[] }>({ queryKey: ["/api/crm/booking-analytics/segments"] });
  const timingQ       = useQuery<Timing>({ queryKey: ["/api/crm/booking-analytics/timing"] });
  const leaderboardQ  = useQuery<Leaderboard>({ queryKey: ["/api/crm/booking-analytics/leaderboard"] });
  const revenueQ      = useQuery<RevenueSummary>({ queryKey: ["/api/crm/booking-analytics/revenue"] });
  const attributionQ  = useQuery<Attribution>({ queryKey: ["/api/crm/booking-analytics/attribution"] });
  const actionListQ   = useQuery<ActionListData>({ queryKey: ["/api/crm/booking-analytics/action-list"] });
  const commandQ      = useQuery<CommandCenterResponse>({ queryKey: ["/api/crm/booking-analytics/command-center"] });
  const draftQueueQ   = useQuery<{ items: DraftQueueItem[]; isAdmin: boolean }>({ queryKey: ["/api/crm/booking-analytics/draft-approval-queue"] });

  const totals = useMemo(() => {
    const rows = linksQ.data?.rows ?? [];
    return rows.reduce((a, r) => ({
      sent: a.sent + r.sent, opened: a.opened + r.opened, booked: a.booked + r.booked,
    }), { sent: 0, opened: 0, booked: 0 });
  }, [linksQ.data]);

  const overallOpenRate    = totals.sent > 0 ? totals.opened / totals.sent : 0;
  const overallBookingRate = totals.sent > 0 ? totals.booked / totals.sent : 0;

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-7xl">
      <div className="flex items-center gap-3">
        <TrendingUp className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Booking Conversion Intelligence</h1>
          <p className="text-sm text-muted-foreground">What links, messaging, and timing actually convert.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard icon={Mail}                label="Sent"         value={totals.sent.toLocaleString()}    testId="metric-sent" />
        <MetricCard icon={MousePointerClick}   label="Opened"       value={totals.opened.toLocaleString()}  testId="metric-opened" />
        <MetricCard icon={CheckCircle2}        label="Booked"       value={totals.booked.toLocaleString()}  testId="metric-booked" />
        <MetricCard icon={Target}              label="Open rate"    value={fmtPct(overallOpenRate)}         sub={`${totals.opened}/${totals.sent}`} testId="metric-open-rate" />
        <MetricCard icon={Trophy}              label="Booking rate" value={fmtPct(overallBookingRate)}      sub={`${totals.booked}/${totals.sent}`} testId="metric-booking-rate" />
      </div>

      <Tabs defaultValue="leaderboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="command"     data-testid="tab-command">Command Center</TabsTrigger>
          <TabsTrigger value="leaderboard" data-testid="tab-leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="funnel"      data-testid="tab-funnel">Funnel</TabsTrigger>
          <TabsTrigger value="timing"      data-testid="tab-timing">Time to convert</TabsTrigger>
          <TabsTrigger value="segments"    data-testid="tab-segments">CRM segment</TabsTrigger>
          <TabsTrigger value="revenue"     data-testid="tab-revenue">Revenue Attribution</TabsTrigger>
          <TabsTrigger value="draft-queue" data-testid="tab-draft-queue">
            Draft Queue
            {(draftQueueQ.data?.items?.filter(i => !i.isReviewed).length ?? 0) > 0 && (
              <Badge variant="secondary" className="ml-2" data-testid="badge-draft-queue-count">
                {draftQueueQ.data!.items.filter(i => !i.isReviewed).length}
              </Badge>
            )}
          </TabsTrigger>
          {linksQ.data?.isAdmin && <TabsTrigger value="owners" data-testid="tab-owners">By owner</TabsTrigger>}
        </TabsList>

        {/* Command Center */}
        <TabsContent value="command" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MetricCard icon={AlertTriangle} label="High urgency"   value={(commandQ.data?.totals.highUrgency   ?? 0).toLocaleString()} testId="metric-cc-high" />
            <MetricCard icon={Clock}         label="Medium urgency" value={(commandQ.data?.totals.mediumUrgency ?? 0).toLocaleString()} testId="metric-cc-medium" />
            <MetricCard icon={CheckCircle2}  label="Low urgency"    value={(commandQ.data?.totals.lowUrgency    ?? 0).toLocaleString()} testId="metric-cc-low" />
          </div>

          {commandQ.isLoading ? <Skeleton className="h-64" /> : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {(Object.keys(CARD_META) as CardKind[]).map((kind) => (
                <CommandCard key={kind}
                  kind={kind}
                  items={commandQ.data?.buckets[kind] ?? []}
                  isAdmin={!!commandQ.data?.isAdmin}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Leaderboard */}
        <TabsContent value="leaderboard" className="space-y-6">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                <h2 className="font-medium">Top converting links</h2>
                {leaderboardQ.data && (
                  <Badge variant="secondary" data-testid="badge-min-sent">≥ {leaderboardQ.data.minSent} sent</Badge>
                )}
              </div>
              {leaderboardQ.isLoading ? <Skeleton className="h-32" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground border-b">
                      <tr>
                        <th className="text-left py-2 px-2">#</th>
                        <th className="text-left py-2 px-2">Link</th>
                        {linksQ.data?.isAdmin && <th className="text-left py-2 px-2">Owner</th>}
                        <th className="text-right py-2 px-2">Sent</th>
                        <th className="text-right py-2 px-2">Opened</th>
                        <th className="text-right py-2 px-2">Booked</th>
                        <th className="text-right py-2 px-2">Open rate</th>
                        <th className="text-right py-2 px-2">Booking rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(leaderboardQ.data?.top ?? []).length === 0 && (
                        <tr><td colSpan={linksQ.data?.isAdmin ? 8 : 7} className="text-center text-muted-foreground py-6">
                          No links meet the minimum-sent threshold yet.
                        </td></tr>
                      )}
                      {(leaderboardQ.data?.top ?? []).map((r) => (
                        <tr key={r.bookingLinkId} className="border-b last:border-0" data-testid={`row-leaderboard-${r.bookingLinkId}`}>
                          <td className="py-2 px-2 font-medium">{r.rank}</td>
                          <td className="py-2 px-2">{r.bookingLinkName}</td>
                          {linksQ.data?.isAdmin && <td className="py-2 px-2 text-muted-foreground">{r.ownerName ?? "—"}</td>}
                          <td className="py-2 px-2 text-right tabular-nums">{r.sent}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.opened}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.booked}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtPct(r.openRate)}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-medium">{fmtPct(r.bookingRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h2 className="font-medium">Underperforming links</h2>
                <Badge variant="outline">≥5 sent · &lt;10% booking rate</Badge>
              </div>
              {leaderboardQ.isLoading ? <Skeleton className="h-20" /> : (
                (leaderboardQ.data?.underperforming ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">Nothing flagged. Nice work.</p>
                ) : (
                  <div className="space-y-2">
                    {(leaderboardQ.data?.underperforming ?? []).map((r) => (
                      <div key={r.bookingLinkId} className="flex items-center justify-between border rounded p-2"
                           data-testid={`row-underperforming-${r.bookingLinkId}`}>
                        <div>
                          <div className="font-medium text-sm">{r.bookingLinkName}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.ownerName ?? "—"} · {r.sent} sent · {r.opened} opened · {r.booked} booked
                          </div>
                        </div>
                        <Badge variant="destructive">{fmtPct(r.bookingRate)}</Badge>
                      </div>
                    ))}
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Funnel */}
        <TabsContent value="funnel">
          <Card>
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <h2 className="font-medium">Conversion funnel</h2>
              </div>
              {linksQ.isLoading ? <Skeleton className="h-40" /> : (
                <div className="space-y-4 max-w-2xl">
                  <FunnelBar label="Sent"   value={totals.sent}   max={totals.sent} testId="funnel-sent" />
                  <FunnelBar label="Opened" value={totals.opened} max={totals.sent} testId="funnel-opened" />
                  <FunnelBar label="Booked" value={totals.booked} max={totals.sent} testId="funnel-booked" />
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Sent → Opened</div>
                      <div className="text-lg font-semibold tabular-nums" data-testid="text-funnel-open-rate">{fmtPct(overallOpenRate)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Sent → Booked</div>
                      <div className="text-lg font-semibold tabular-nums" data-testid="text-funnel-booking-rate">{fmtPct(overallBookingRate)}</div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timing */}
        <TabsContent value="timing">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <h2 className="font-medium">Average time to convert</h2>
              </div>
              {timingQ.isLoading ? <Skeleton className="h-24" /> : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <MetricCard icon={Clock} label="Sent → Opened"  value={fmtDuration(timingQ.data?.sentToOpenedSec   ?? null)}
                    sub={`${timingQ.data?.sentToOpenedSamples   ?? 0} samples`} testId="timing-sent-to-opened" />
                  <MetricCard icon={Clock} label="Opened → Booked" value={fmtDuration(timingQ.data?.openedToBookedSec ?? null)}
                    sub={`${timingQ.data?.openedToBookedSamples ?? 0} samples`} testId="timing-opened-to-booked" />
                  <MetricCard icon={Clock} label="Sent → Booked"   value={fmtDuration(timingQ.data?.sentToBookedSec   ?? null)}
                    sub={`${timingQ.data?.sentToBookedSamples   ?? 0} samples`} testId="timing-sent-to-booked" />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Segments */}
        <TabsContent value="segments">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <h2 className="font-medium">Conversion by CRM segment</h2>
              </div>
              {segmentsQ.isLoading ? <Skeleton className="h-32" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground border-b">
                      <tr>
                        <th className="text-left py-2 px-2">Segment</th>
                        <th className="text-right py-2 px-2">Sent</th>
                        <th className="text-right py-2 px-2">Opened</th>
                        <th className="text-right py-2 px-2">Booked</th>
                        <th className="text-right py-2 px-2">Open rate</th>
                        <th className="text-right py-2 px-2">Booking rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(segmentsQ.data?.rows ?? []).map((r) => (
                        <tr key={r.segment} className="border-b last:border-0" data-testid={`row-segment-${r.segment}`}>
                          <td className="py-2 px-2 capitalize">{r.segment}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.sent}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.opened}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.booked}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtPct(r.openRate)}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-medium">{fmtPct(r.bookingRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Revenue Attribution */}
        <TabsContent value="revenue" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard icon={CheckCircle2} label="Booked meetings" value={(revenueQ.data?.bookedMeetings ?? 0).toLocaleString()}
              sub={revenueQ.data ? `${revenueQ.data.bookedAttributable} CRM-matched · ${revenueQ.data.bookedOrphan} orphan` : undefined}
              testId="metric-rev-booked" />
            <MetricCard icon={FileText} label="Quotes generated" value={(revenueQ.data?.quotesGenerated ?? 0).toLocaleString()}
              sub="created after booking" testId="metric-rev-quotes" />
            <MetricCard icon={DollarSign} label="Quoted value" value={fmtMoney(revenueQ.data?.quotedValue ?? 0)} testId="metric-rev-quoted-value" />
            <MetricCard icon={Trophy} label="Won value" value={fmtMoney(revenueQ.data?.wonValue ?? 0)}
              sub={revenueQ.data ? `${revenueQ.data.wonQuotes} accepted` : undefined} testId="metric-rev-won-value" />
            <MetricCard icon={Target} label="Booking → Quote" value={fmtPct(revenueQ.data?.bookingToQuoteRate ?? 0)}
              sub={revenueQ.data ? `Quote → Win: ${fmtPct(revenueQ.data.quoteToWinRate)}` : undefined}
              testId="metric-rev-rates" />
          </div>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                <h2 className="font-medium">Top revenue-producing booking links</h2>
              </div>
              {attributionQ.isLoading ? <Skeleton className="h-32" /> : (
                (attributionQ.data?.topRevenueLinks ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">No attributed revenue yet. Quotes created after a booking will appear here.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground border-b">
                        <tr>
                          <th className="text-left py-2 px-2">#</th>
                          <th className="text-left py-2 px-2">Link</th>
                          {attributionQ.data?.isAdmin && <th className="text-left py-2 px-2">Owner</th>}
                          <th className="text-right py-2 px-2">Booked</th>
                          <th className="text-right py-2 px-2">Quotes</th>
                          <th className="text-right py-2 px-2">Quoted $</th>
                          <th className="text-right py-2 px-2">Won $</th>
                          <th className="text-right py-2 px-2">Win rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(attributionQ.data?.topRevenueLinks ?? []).map((r) => (
                          <tr key={r.bookingLinkId} className="border-b last:border-0" data-testid={`row-rev-link-${r.bookingLinkId}`}>
                            <td className="py-2 px-2 font-medium">{r.rank}</td>
                            <td className="py-2 px-2">{r.bookingLinkName}</td>
                            {attributionQ.data?.isAdmin && <td className="py-2 px-2 text-muted-foreground">{r.ownerName ?? "—"}</td>}
                            <td className="py-2 px-2 text-right tabular-nums">{r.bookedMeetings}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{r.quotesGenerated}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtMoney(r.quotedValue)}</td>
                            <td className="py-2 px-2 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{fmtMoney(r.wonValue)}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtPct(r.quoteToWinRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <h2 className="font-medium">Booked — no next action</h2>
                  <Badge variant="outline" data-testid="badge-no-action-count">
                    {actionListQ.data?.bookedNoNextAction.length ?? 0}
                  </Badge>
                </div>
                {actionListQ.isLoading ? <Skeleton className="h-24" /> : (
                  (actionListQ.data?.bookedNoNextAction ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">Nothing stalled. Every booked meeting has a follow-up or a quote.</p>
                  ) : (
                    <div className="space-y-2">
                      {(actionListQ.data?.bookedNoNextAction ?? []).map((r) => (
                        <div key={r.recipientId} className="border rounded p-2"
                             data-testid={`row-no-action-${r.recipientId}`}>
                          <div className="flex justify-between gap-2">
                            <div className="font-medium text-sm truncate">{r.recipientEmail}</div>
                            <div className="text-xs text-muted-foreground whitespace-nowrap">booked {fmtDate(r.bookedAt)}</div>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {r.bookingLinkName}
                            {actionListQ.data?.isAdmin && r.ownerName && ` · ${r.ownerName}`}
                            {r.crm.type && ` · linked to ${r.crm.type}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-blue-500" />
                  <h2 className="font-medium">Opened — not booked</h2>
                  <Badge variant="outline" data-testid="badge-opened-count">
                    {actionListQ.data?.openedNotBooked.length ?? 0}
                  </Badge>
                </div>
                {actionListQ.isLoading ? <Skeleton className="h-24" /> : (
                  (actionListQ.data?.openedNotBooked ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">Everyone who opened has either booked or been actioned.</p>
                  ) : (
                    <div className="space-y-2">
                      {(actionListQ.data?.openedNotBooked ?? []).map((r) => (
                        <div key={r.recipientId} className="border rounded p-2"
                             data-testid={`row-opened-not-booked-${r.recipientId}`}>
                          <div className="flex justify-between gap-2">
                            <div className="font-medium text-sm truncate">{r.recipientEmail}</div>
                            <Badge variant={r.daysSinceOpen >= 2 ? "destructive" : "secondary"} className="whitespace-nowrap">
                              {r.daysSinceOpen}d ago
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {r.bookingLinkName}
                            {actionListQ.data?.isAdmin && r.ownerName && ` · ${r.ownerName}`}
                            {r.crm.type && ` · ${r.crm.type}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Draft Queue (Phase K) */}
        <TabsContent value="draft-queue" className="space-y-4">
          <DraftQueueTab queueQ={draftQueueQ} />
        </TabsContent>

        {/* Owners (admin) */}
        {linksQ.data?.isAdmin && (
          <TabsContent value="owners">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <h2 className="font-medium">Conversion by owner</h2>
                </div>
                {ownersQ.isLoading ? <Skeleton className="h-32" /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground border-b">
                        <tr>
                          <th className="text-left py-2 px-2">Owner</th>
                          <th className="text-right py-2 px-2">Sent</th>
                          <th className="text-right py-2 px-2">Opened</th>
                          <th className="text-right py-2 px-2">Booked</th>
                          <th className="text-right py-2 px-2">Open rate</th>
                          <th className="text-right py-2 px-2">Booking rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(ownersQ.data?.rows ?? []).map((r) => (
                          <tr key={r.ownerUserId} className="border-b last:border-0" data-testid={`row-owner-${r.ownerUserId}`}>
                            <td className="py-2 px-2">{r.ownerName ?? `User #${r.ownerUserId}`}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{r.sent}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{r.opened}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{r.booked}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtPct(r.openRate)}</td>
                            <td className="py-2 px-2 text-right tabular-nums font-medium">{fmtPct(r.bookingRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
