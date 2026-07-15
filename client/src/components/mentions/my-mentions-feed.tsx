/**
 * my-mentions-feed.tsx
 *
 * Global "My Mentions" feed showing every place in the CMS where the current
 * user has been @mentioned. Sortable, filterable, with status actions.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AtSign, Check, Eye, MessageSquare, CheckCircle2, Clock, AlertCircle,
  ChevronRight, Filter, ArrowUpDown, Loader2, Bell, BellOff, X,
  Users, CheckSquare, Building2, Mail, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type MentionStatus = "unread" | "viewed" | "acknowledged" | "completed" | "dismissed";

type GlobalMention = {
  id: number;
  mentionedUserId: number;
  authorUserId: number;
  authorName: string;
  authorAvatarUrl?: string;
  entityType: string;
  entityId: number;
  moduleKey: string;
  moduleLabel: string;
  recordTitle?: string;
  sourcePreview?: string;
  requestedAction: string;
  status: MentionStatus;
  viewedAt?: string;
  acknowledgedAt?: string;
  completedAt?: string;
  dismissedAt?: string;
  completionNote?: string;
  deepLinkUrl?: string;
  isAllMention: boolean;
  createdAt: string;
};

// ── Module icons ─────────────────────────────────────────────────────────────

const MODULE_ICONS: Record<string, React.ElementType> = {
  currents: MessageSquare,
  tasks: CheckSquare,
  leads: Zap,
  accounts: Building2,
  contacts: Users,
  inbox: Mail,
  default: AtSign,
};

function ModuleIcon({ moduleKey, className }: { moduleKey: string; className?: string }) {
  const Icon = MODULE_ICONS[moduleKey] ?? MODULE_ICONS.default;
  return <Icon className={className} />;
}

// ── Status styles ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<MentionStatus, { label: string; cls: string; icon: React.ElementType }> = {
  unread:       { label: "Unread",       cls: "text-primary border-primary/30 bg-primary/10",          icon: Bell },
  viewed:       { label: "Viewed",       cls: "text-blue-400 border-blue-500/30 bg-blue-500/10",       icon: Eye },
  acknowledged: { label: "Acknowledged", cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", icon: Check },
  completed:    { label: "Completed",    cls: "text-green-400 border-green-500/30 bg-green-500/10",    icon: CheckCircle2 },
  dismissed:    { label: "Dismissed",    cls: "text-muted-foreground border-border/40 bg-muted/20",    icon: BellOff },
};

// ── Action type labels ────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  mention:   "Mentioned you",
  fyi:       "FYI",
  review:    "Please review",
  respond:   "Please respond",
  approve:   "Please approve",
  complete:  "Please complete",
  follow_up: "Please follow up",
};

// ── Format helpers ─────────────────────────────────────────────────────────────

function fmtAgo(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

// ── Mention Card ──────────────────────────────────────────────────────────────

function MentionCard({
  mention,
  onStatusChange,
  compact,
}: {
  mention: GlobalMention;
  onStatusChange: (id: number, status: MentionStatus, note?: string) => void;
  compact?: boolean;
}) {
  const style = STATUS_STYLE[mention.status];
  const StatusIcon = style.icon;
  const actionLabel = ACTION_LABELS[mention.requestedAction] ?? mention.requestedAction;
  const isUnread = mention.status === "unread";

  const content = (
    <Card
      className={cn(
        "border-border/50 transition-colors",
        isUnread && "border-l-2 border-l-primary",
        mention.status === "completed" && "opacity-60"
      )}
      data-testid={`mention-card-${mention.id}`}
    >
      <CardContent className={compact ? "p-3" : "p-4"}>
        <div className="flex items-start gap-3">
          {/* Module icon */}
          <div className="w-8 h-8 rounded-full bg-muted/40 flex items-center justify-center shrink-0 mt-0.5">
            <ModuleIcon moduleKey={mention.moduleKey} className="h-3.5 w-3.5 text-muted-foreground" />
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            {/* Header row */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium text-sm truncate block">{mention.authorName}</span>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                  <span>{mention.moduleLabel}</span>
                  {mention.recordTitle && (
                    <>
                      <ChevronRight className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate max-w-[200px]">{mention.recordTitle}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {mention.isAllMention && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-500/30 text-amber-400 bg-amber-500/10">
                    @all
                  </Badge>
                )}
                <Badge variant="outline" className={cn("text-[9px] h-4 px-1 border", style.cls)}>
                  <StatusIcon className="h-2.5 w-2.5 mr-0.5" />
                  {style.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{fmtAgo(mention.createdAt)}</span>
              </div>
            </div>

            {/* Action type */}
            <div className="text-[11px] font-medium text-primary/80">{actionLabel}</div>

            {/* Preview */}
            {mention.sourcePreview && (
              <p className="text-[12px] text-muted-foreground line-clamp-2 italic">
                "{mention.sourcePreview}"
              </p>
            )}

            {/* Completion note */}
            {mention.completionNote && (
              <p className="text-[11px] text-emerald-400 mt-1">✓ {mention.completionNote}</p>
            )}

            {/* Actions */}
            {mention.status !== "completed" && mention.status !== "dismissed" && (
              <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                {mention.status === "unread" && (
                  <Button
                    variant="outline" size="sm"
                    className="h-6 text-[11px] px-2 gap-1"
                    onClick={() => onStatusChange(mention.id, "acknowledged")}
                    data-testid={`mention-ack-${mention.id}`}
                  >
                    <Check className="h-3 w-3" /> Acknowledge
                  </Button>
                )}
                {mention.status !== "completed" && (
                  <Button
                    variant="outline" size="sm"
                    className="h-6 text-[11px] px-2 gap-1 border-green-500/30 text-green-400 hover:bg-green-500/10"
                    onClick={() => onStatusChange(mention.id, "completed")}
                    data-testid={`mention-complete-${mention.id}`}
                  >
                    <CheckCircle2 className="h-3 w-3" /> Done
                  </Button>
                )}
                <Button
                  variant="ghost" size="sm"
                  className="h-6 text-[11px] px-2 gap-1 text-muted-foreground"
                  onClick={() => onStatusChange(mention.id, "dismissed")}
                  data-testid={`mention-dismiss-${mention.id}`}
                >
                  <X className="h-3 w-3" /> Dismiss
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (mention.deepLinkUrl) {
    return (
      <Link href={mention.deepLinkUrl} data-testid={`mention-link-${mention.id}`}>
        {content}
      </Link>
    );
  }
  return content;
}

// ── My Mentions Feed ──────────────────────────────────────────────────────────

interface MyMentionsFeedProps {
  compact?: boolean;
  maxItems?: number;
  showFilters?: boolean;
}

export function MyMentionsFeed({
  compact = false,
  maxItems,
  showFilters = true,
}: MyMentionsFeedProps) {
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: mentions = [], isLoading, isFetching } = useQuery<GlobalMention[]>({
    queryKey: ["/api/mentions", { status: statusFilter, module: moduleFilter, sort: sortBy }],
    queryFn: () => {
      const p = new URLSearchParams();
      if (statusFilter !== "all") p.set("status", statusFilter);
      if (moduleFilter !== "all") p.set("module", moduleFilter);
      p.set("sort", sortBy);
      return fetch(`/api/mentions?${p}`, { credentials: "include" }).then(r => r.json());
    },
    staleTime: 30_000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: MentionStatus }) =>
      apiRequest("PATCH", `/api/mentions/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/mentions"] });
      qc.invalidateQueries({ queryKey: ["/api/mentions/unread-count"] });
    },
    onError: () => toast({ title: "Failed to update mention status", variant: "destructive" }),
  });

  function handleStatusChange(id: number, status: MentionStatus) {
    statusMutation.mutate({ id, status });
  }

  const displayed = maxItems ? mentions.slice(0, maxItems) : mentions;

  // Collect unique modules for filter
  const modules = Array.from(new Set(mentions.map(m => m.moduleKey)));

  return (
    <div className="space-y-3" data-testid="my-mentions-feed">
      {showFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-7 w-32 text-xs" data-testid="mentions-filter-status">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="viewed">Viewed</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          {modules.length > 1 && (
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="h-7 w-32 text-xs" data-testid="mentions-filter-module">
                <SelectValue placeholder="All modules" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modules</SelectItem>
                {modules.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="h-7 w-36 text-xs" data-testid="mentions-sort">
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="unread">Unread first</SelectItem>
              <SelectItem value="module">By module</SelectItem>
            </SelectContent>
          </Select>
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-lg bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground" data-testid="mentions-empty-state">
          <AtSign className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No mentions yet</p>
          <p className="text-xs mt-1">When someone @mentions you across VoltSafe, they'll appear here.</p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="mentions-list">
          {displayed.map(mention => (
            <MentionCard
              key={mention.id}
              mention={mention}
              onStatusChange={handleStatusChange}
              compact={compact}
            />
          ))}
          {maxItems && mentions.length > maxItems && (
            <Link href="/mentions">
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground h-7 gap-1">
                View all {mentions.length} mentions <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Unread count badge hook ────────────────────────────────────────────────────

export function useMentionsUnreadCount(): number {
  const { data } = useQuery<{ count: number }>({
    queryKey: ["/api/mentions/unread-count"],
    queryFn: () => fetch("/api/mentions/unread-count", { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return data?.count ?? 0;
}
