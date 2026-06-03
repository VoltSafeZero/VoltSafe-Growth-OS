import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { ActionWidgetShell } from "@/components/command-centers/action-widgets";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, Flame, Eye, MousePointerClick, Video, MessageSquare,
  Reply, Clock, Ban,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { WidgetProps } from "@/components/command-centers/action-widgets";

// ── Types ─────────────────────────────────────────────────────────────────────

type NeedsReplyItem = {
  threadId: string;
  gmailThreadId: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  snippet: string;
  opensCount: number;
  clickCount: number;
  ctaClicks: number;
  videoClicks: number;
  engagementScore: number;
  intentLevel: string;
  lastEmailAt: string | null;
  lastEngagementAt: string | null;
  waitingDays: number;
  needsReply: boolean;
  routeTarget: string;
};

type SortKey = "highest_engagement" | "most_recent" | "longest_waiting" | "newest_email" | "highest_intent";

// ── Helpers ───────────────────────────────────────────────────────────────────

const INTENT_META: Record<string, { label: string; cls: string }> = {
  very_high_intent: { label: "Very High Intent", cls: "bg-red-500/15 text-red-400 border-red-500/25" },
  high_intent:      { label: "High Intent",      cls: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  interested:       { label: "Interested",        cls: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  none:             { label: "Tracked",           cls: "bg-secondary/60 text-muted-foreground" },
};

const INTENT_ORDER: Record<string, number> = {
  very_high_intent: 4, high_intent: 3, interested: 2, none: 1,
};

function intentMeta(level: string) {
  return INTENT_META[level] ?? INTENT_META.none;
}

function fmtEngaged(at: string | null) {
  if (!at) return null;
  try { return formatDistanceToNow(new Date(at), { addSuffix: true }); } catch { return null; }
}

function sortItems(items: NeedsReplyItem[], sort: SortKey): NeedsReplyItem[] {
  const copy = [...items];
  switch (sort) {
    case "highest_engagement":
      return copy.sort((a, b) => b.engagementScore - a.engagementScore);
    case "most_recent":
      return copy.sort((a, b) => {
        const ta = a.lastEngagementAt ? new Date(a.lastEngagementAt).getTime() : 0;
        const tb = b.lastEngagementAt ? new Date(b.lastEngagementAt).getTime() : 0;
        return tb - ta;
      });
    case "longest_waiting":
      return copy.sort((a, b) => b.waitingDays - a.waitingDays);
    case "newest_email":
      return copy.sort((a, b) => {
        const ta = a.lastEmailAt ? new Date(a.lastEmailAt).getTime() : 0;
        const tb = b.lastEmailAt ? new Date(b.lastEmailAt).getTime() : 0;
        return tb - ta;
      });
    case "highest_intent":
      return copy.sort((a, b) =>
        (INTENT_ORDER[b.intentLevel] ?? 1) - (INTENT_ORDER[a.intentLevel] ?? 1)
      );
    default:
      return copy;
  }
}

// ── Quick Action Buttons ──────────────────────────────────────────────────────

function QuickActions({ item, onDone }: { item: NeedsReplyItem; onDone: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/gmail/thread-record/${encodeURIComponent(item.gmailThreadId)}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/needs-reply-high-engagement"] });
      onDone();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleReply(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    navigate(`/gmail?thread=${encodeURIComponent(item.gmailThreadId)}&action=reply`);
  }

  function handleSnooze(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const snoozedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    patch.mutate({ snoozedUntil });
    toast({ title: "Snoozed 3 days", description: item.subject });
  }

  function handleNoReply(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    patch.mutate({ replyStatus: "no_reply_needed" });
    toast({ title: "Marked No Reply Needed", description: item.subject });
  }

  return (
    <div className="flex items-center gap-1 shrink-0" data-testid={`quick-actions-${item.gmailThreadId}`}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10"
              onClick={handleReply}
              data-testid={`btn-reply-${item.gmailThreadId}`}
            >
              <Reply className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Reply</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10"
              onClick={handleSnooze}
              disabled={patch.isPending}
              data-testid={`btn-snooze-${item.gmailThreadId}`}
            >
              <Clock className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Snooze 3 days</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-zinc-400 hover:bg-zinc-400/10"
              onClick={handleNoReply}
              disabled={patch.isPending}
              data-testid={`btn-no-reply-${item.gmailThreadId}`}
            >
              <Ban className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">No reply needed</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function NeedsReplyRow({ item }: { item: NeedsReplyItem }) {
  const [showActions, setShowActions] = useState(false);
  const intent = intentMeta(item.intentLevel);
  const engaged = fmtEngaged(item.lastEngagementAt);

  return (
    <div
      className="group relative py-2.5 px-2 -mx-2 rounded-md hover:bg-muted/40 transition-colors"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      data-testid={`needs-reply-row-${item.gmailThreadId}`}
    >
      <div className="flex items-start gap-2">
        {/* Flame icon for hot/very-high-intent threads */}
        {item.intentLevel === "very_high_intent"
          ? <Flame className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
          : <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        }

        <div className="flex-1 min-w-0">
          {/* Subject + sender */}
          <Link href={item.routeTarget} data-testid={`link-thread-${item.gmailThreadId}`}>
            <p className="text-sm font-medium text-foreground truncate hover:text-primary cursor-pointer">
              {item.subject}
            </p>
          </Link>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {item.senderName || item.senderEmail}
          </p>

          {/* Engagement pills */}
          <div className="flex flex-wrap items-center gap-1 mt-1.5" data-testid={`pills-${item.gmailThreadId}`}>
            {item.opensCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20"
                data-testid={`pill-opens-${item.gmailThreadId}`}>
                <Eye className="h-2.5 w-2.5" /> Opened {item.opensCount}×
              </span>
            )}
            {item.clickCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20"
                data-testid={`pill-clicks-${item.gmailThreadId}`}>
                <MousePointerClick className="h-2.5 w-2.5" /> {item.clickCount} Click{item.clickCount !== 1 ? "s" : ""}
              </span>
            )}
            {item.videoClicks > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20"
                data-testid={`pill-video-${item.gmailThreadId}`}>
                <Video className="h-2.5 w-2.5" /> Demo Viewed
              </span>
            )}
            {item.ctaClicks > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                data-testid={`pill-cta-${item.gmailThreadId}`}>
                <MessageSquare className="h-2.5 w-2.5" /> CTA Clicked
              </span>
            )}
            {/* Intent badge */}
            <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${intent.cls}`}
              data-testid={`badge-intent-${item.gmailThreadId}`}>
              {intent.label}
            </Badge>
          </div>

          {/* Meta: last engaged + waiting days */}
          <div className="flex items-center gap-2 mt-1" data-testid={`meta-${item.gmailThreadId}`}>
            {engaged && (
              <span className="text-[10px] text-muted-foreground">Last engaged {engaged}</span>
            )}
            {item.waitingDays > 0 && (
              <span className={`text-[10px] font-medium ${item.waitingDays >= 7 ? "text-red-400" : item.waitingDays >= 3 ? "text-amber-400" : "text-muted-foreground"}`}
                data-testid={`waiting-days-${item.gmailThreadId}`}>
                Waiting {item.waitingDays}d
              </span>
            )}
          </div>
        </div>

        {/* Quick actions (hover-revealed) */}
        <div className={`transition-opacity shrink-0 ${showActions ? "opacity-100" : "opacity-0"}`}>
          <QuickActions item={item} onDone={() => setShowActions(false)} />
        </div>
      </div>
    </div>
  );
}

// ── Main Widget ───────────────────────────────────────────────────────────────

export function NeedsReplyHighEngagementWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const [sort, setSort] = useState<SortKey>("highest_engagement");

  const { data, isLoading } = useQuery<{ items: NeedsReplyItem[] }>({
    queryKey: ["/api/dashboard/needs-reply-high-engagement"],
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const raw = data?.items ?? [];
  const sorted = sortItems(raw, sort);
  const count = raw.length;

  return (
    <ActionWidgetShell
      id="needs_reply_high_engagement"
      icon={Flame}
      title="Needs Reply — High Engagement"
      count={count}
      link="/gmail"
      compact={compact}
      isDragging={isDragging}
      dragProps={dragProps}
    >
      {/* Sort control */}
      {!isLoading && count > 0 && (
        <div className="mb-2" data-testid="sort-control-needs-reply">
          <Select value={sort} onValueChange={v => setSort(v as SortKey)}>
            <SelectTrigger className="h-7 text-xs w-full bg-secondary/40 border-border/50"
              data-testid="select-sort-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="highest_engagement" data-testid="sort-opt-highest-engagement">
                Highest Engagement
              </SelectItem>
              <SelectItem value="most_recent" data-testid="sort-opt-most-recent">
                Most Recent Engagement
              </SelectItem>
              <SelectItem value="longest_waiting" data-testid="sort-opt-longest-waiting">
                Longest Waiting
              </SelectItem>
              <SelectItem value="newest_email" data-testid="sort-opt-newest-email">
                Newest Email
              </SelectItem>
              <SelectItem value="highest_intent" data-testid="sort-opt-highest-intent">
                Highest Intent
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Count badge */}
      {!isLoading && count > 0 && (
        <p className="text-xs text-muted-foreground mb-2" data-testid="count-badge-needs-reply">
          <span className="font-semibold text-foreground">{count}</span> waiting
        </p>
      )}

      {isLoading && <Skeleton className="h-32" />}

      {!isLoading && count === 0 && (
        <div className="py-6 text-center" data-testid="empty-state-needs-reply">
          <p className="text-sm text-muted-foreground font-medium">No high-engagement replies waiting.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Inbox is behaving for once.</p>
        </div>
      )}

      {!isLoading && sorted.slice(0, 10).map(item => (
        <NeedsReplyRow key={item.gmailThreadId} item={item} />
      ))}
    </ActionWidgetShell>
  );
}
