import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  StickyNote, Zap, Paperclip, Mail, Pin, Download, Shield, Link as LinkIcon,
  AlertTriangle, ChevronDown, ChevronUp, Unlink, Clock, Filter,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

type TimelineItemType = "note" | "activity" | "attachment" | "email";

type TimelineItem = {
  timeline_id: string;
  type: TimelineItemType;
  title: string;
  body: string | null;
  created_at: string;
  created_by: string | null;
  metadata: Record<string, any>;
};

type TimelineResponse = {
  items: TimelineItem[];
  total: number;
};

const TYPE_META: Record<TimelineItemType, {
  label: string;
  Icon: React.ElementType;
  iconColor: string;
  ringColor: string;
  bgColor: string;
}> = {
  note:       { label: "Note",       Icon: StickyNote,  iconColor: "text-amber-400",   ringColor: "ring-amber-400/30",  bgColor: "bg-amber-400/10" },
  activity:   { label: "Activity",   Icon: Zap,         iconColor: "text-blue-400",    ringColor: "ring-blue-400/30",   bgColor: "bg-blue-400/10" },
  attachment: { label: "File",       Icon: Paperclip,   iconColor: "text-violet-400",  ringColor: "ring-violet-400/30", bgColor: "bg-violet-400/10" },
  email:      { label: "Email",      Icon: Mail,        iconColor: "text-emerald-400", ringColor: "ring-emerald-400/30",bgColor: "bg-emerald-400/10" },
};

const FILTERS = [
  { key: "all",        label: "All" },
  { key: "email",      label: "Emails" },
  { key: "note",       label: "Notes" },
  { key: "activity",   label: "Activities" },
  { key: "attachment", label: "Files" },
] as const;

function formatTimelineDate(dateStr: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 1) return formatDistanceToNow(d, { addSuffix: true });
  if (diffDays < 7) return format(d, "EEE, h:mm a");
  if (diffDays < 365) return format(d, "MMM d");
  return format(d, "MMM d, yyyy");
}

function ConfidenceBadge({ score, isAuto, isUserConfirmed, reasons }: {
  score: number | null; isAuto: boolean | null; isUserConfirmed: boolean | null; reasons?: string | null;
}) {
  const [showReasons, setShowReasons] = useState(false);
  let reasonList: string[] = [];
  try { if (reasons) reasonList = JSON.parse(reasons); } catch { }

  const badge = !isAuto
    ? <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/30 gap-0.5 cursor-default"><LinkIcon className="h-2.5 w-2.5" /> Manual</Badge>
    : isUserConfirmed
    ? <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30 gap-0.5 cursor-default"><Shield className="h-2.5 w-2.5" /> Confirmed</Badge>
    : score !== null && score >= 75
    ? <Badge variant="outline" className="text-[10px] text-primary border-primary/30 gap-0.5 cursor-default"><Mail className="h-2.5 w-2.5" /> Auto-linked</Badge>
    : score !== null && score >= 50
    ? <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30 gap-0.5 cursor-default"><AlertTriangle className="h-2.5 w-2.5" /> Suggested</Badge>
    : null;

  if (!badge) return null;
  if (!reasonList.length) return badge;

  return (
    <div className="inline-flex flex-col gap-1">
      <button onClick={() => setShowReasons(s => !s)} className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity">
        {badge}
        {showReasons ? <ChevronUp className="h-2.5 w-2.5 text-muted-foreground" /> : <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />}
      </button>
      {showReasons && (
        <div className="text-[10px] text-muted-foreground bg-secondary/40 rounded px-2 py-1 max-w-[200px] space-y-0.5">
          {reasonList.map((r, i) => <p key={i}>{r}</p>)}
        </div>
      )}
    </div>
  );
}

function NoteCard({ item }: { item: TimelineItem }) {
  const meta = item.metadata;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
          {item.body}
        </p>
        {meta.isPinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
      </div>
    </div>
  );
}

function ActivityCard({ item }: { item: TimelineItem }) {
  const meta = item.metadata;
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium">{item.title}</p>
      {item.body && <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{item.body}</p>}
      {meta.outcome && (
        <Badge variant="outline" className="text-[10px] mt-1 capitalize">{meta.outcome}</Badge>
      )}
    </div>
  );
}

function AttachmentCard({ item }: { item: TimelineItem }) {
  const meta = item.metadata;
  return (
    <div className="min-w-0 flex items-center gap-2">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{item.title}</p>
        <p className="text-xs text-muted-foreground">{item.body}</p>
      </div>
      {meta.fileName && (
        <a
          href={`/api/attachments/file/${meta.fileName}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
          title="Download"
          data-testid={`download-attachment-${meta.attachmentId}`}
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

function EmailCard({ item, onUnlink }: { item: TimelineItem; onUnlink: (assocId: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const meta = item.metadata;
  const isInbound = meta.direction === "inbound";

  return (
    <div className="min-w-0 space-y-1.5">
      {/* Subject */}
      <button className="text-left w-full" onClick={() => setExpanded(s => !s)}>
        <p className="text-sm font-medium leading-snug">{item.title}</p>
      </button>

      {/* From/To */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">
          {isInbound
            ? <><span className="text-muted-foreground/60">From:</span> {meta.fromName || meta.fromEmail}</>
            : <><span className="text-muted-foreground/60">To:</span> {meta.toEmails}</>
          }
        </span>
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 py-0 ${isInbound ? "text-blue-400 border-blue-400/30" : "text-emerald-400 border-emerald-400/30"}`}
        >
          {isInbound ? "↙ Received" : "↗ Sent"}
        </Badge>
      </div>

      {/* Snippet */}
      {item.body && (
        <p className={`text-xs text-muted-foreground/70 ${expanded ? "" : "line-clamp-2"}`}>
          {item.body}
        </p>
      )}
      {item.body && item.body.length > 140 && (
        <button onClick={() => setExpanded(s => !s)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      {/* Badges + Unlink */}
      <div className="flex items-center gap-2 flex-wrap">
        <ConfidenceBadge
          score={meta.confidenceScore}
          isAuto={meta.isAuto}
          isUserConfirmed={meta.isUserConfirmed}
          reasons={meta.associationReasons}
        />
        {meta.associationId && (
          <button
            onClick={() => onUnlink(meta.associationId)}
            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-0.5"
            title="Unlink this email from the record"
            data-testid={`button-unlink-email-${meta.associationId}`}
          >
            <Unlink className="h-2.5 w-2.5" /> Unlink
          </button>
        )}
      </div>
    </div>
  );
}

function TimelineItemCard({ item, onUnlinkEmail }: { item: TimelineItem; onUnlinkEmail: (id: number) => void }) {
  const { Icon, iconColor, ringColor, bgColor } = TYPE_META[item.type] || TYPE_META.note;

  return (
    <div className="flex gap-3 group" data-testid={`timeline-item-${item.timeline_id}`}>
      {/* Icon column */}
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center ring-1 ${bgColor} ${ringColor}`}>
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        </div>
        <div className="flex-1 w-px bg-border/30 mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {TYPE_META[item.type]?.label}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
            {formatTimelineDate(item.created_at)}
          </span>
        </div>

        {item.type === "note"       && <NoteCard item={item} />}
        {item.type === "activity"   && <ActivityCard item={item} />}
        {item.type === "attachment" && <AttachmentCard item={item} />}
        {item.type === "email"      && <EmailCard item={item} onUnlink={onUnlinkEmail} />}

        {item.created_by && item.type !== "email" && (
          <p className="text-[10px] text-muted-foreground/60 mt-1.5">{item.created_by}</p>
        )}
      </div>
    </div>
  );
}

export function TimelineTab({ objectType, objectId }: { objectType: string; objectId: number }) {
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const queryKey = ["/api/timeline", objectType, objectId];

  const { data, isLoading } = useQuery<TimelineResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/timeline?objectType=${objectType}&objectId=${objectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load timeline");
      return res.json();
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (assocId: number) => {
      await apiRequest("DELETE", `/api/timeline/unlink-email/${assocId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/crm-emails", objectType, objectId] });
      toast({ title: "Email unlinked", description: "The email has been removed from this record's timeline." });
    },
    onError: () => toast({ title: "Failed to unlink email", variant: "destructive" }),
  });

  const allItems = data?.items ?? [];

  const filteredItems = activeFilter === "all"
    ? allItems
    : allItems.filter(i => i.type === activeFilter);

  const typeCounts = allItems.reduce((acc, i) => {
    acc[i.type] = (acc[i.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (isLoading) {
    return (
      <div className="space-y-4 py-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="w-7 h-7 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {FILTERS.map(f => {
          const count = f.key === "all" ? allItems.length : typeCounts[f.key] ?? 0;
          const isActive = activeFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all ${
                isActive
                  ? "bg-primary/10 border-primary/50 text-primary"
                  : "border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              }`}
              data-testid={`timeline-filter-${f.key}`}
            >
              {f.label}
              {count > 0 && (
                <span className={`text-[9px] font-semibold ${isActive ? "text-primary" : "text-muted-foreground/60"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Timeline items */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Clock className="w-10 h-10 text-muted-foreground/25 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {activeFilter === "all" ? "No activity yet" : `No ${activeFilter}s found`}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
            {activeFilter === "all"
              ? "Notes, activities, files and linked emails will appear here in chronological order."
              : activeFilter === "email"
              ? "Emails are linked automatically by domain or contact match, or manually from the Emails tab."
              : `Add ${activeFilter}s to this record and they'll appear here.`}
          </p>
        </div>
      ) : (
        <div>
          {filteredItems.map(item => (
            <TimelineItemCard
              key={item.timeline_id}
              item={item}
              onUnlinkEmail={id => unlinkMutation.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
