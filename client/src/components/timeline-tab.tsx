import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  StickyNote, Zap, Paperclip, Mail, Pin, Download, Shield, Link as LinkIcon,
  AlertTriangle, ChevronDown, ChevronUp, Unlink, Clock, Filter,
  CheckSquare, FileText, ArrowRight, Plus, X,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

type TimelineItemType = "note" | "activity" | "attachment" | "email" | "task" | "quote" | "stage_change";

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
  note:         { label: "Note",         Icon: StickyNote,   iconColor: "text-amber-400",    ringColor: "ring-amber-400/30",   bgColor: "bg-amber-400/10" },
  activity:     { label: "Activity",     Icon: Zap,          iconColor: "text-blue-400",     ringColor: "ring-blue-400/30",    bgColor: "bg-blue-400/10" },
  attachment:   { label: "File",         Icon: Paperclip,    iconColor: "text-violet-400",   ringColor: "ring-violet-400/30",  bgColor: "bg-violet-400/10" },
  email:        { label: "Email",        Icon: Mail,         iconColor: "text-emerald-400",  ringColor: "ring-emerald-400/30", bgColor: "bg-emerald-400/10" },
  task:         { label: "Task",         Icon: CheckSquare,  iconColor: "text-sky-400",      ringColor: "ring-sky-400/30",     bgColor: "bg-sky-400/10" },
  quote:        { label: "Quote",        Icon: FileText,     iconColor: "text-orange-400",   ringColor: "ring-orange-400/30",  bgColor: "bg-orange-400/10" },
  stage_change: { label: "Stage Change", Icon: ArrowRight,   iconColor: "text-purple-400",   ringColor: "ring-purple-400/30",  bgColor: "bg-purple-400/10" },
};

const FILTERS = [
  { key: "all",          label: "All" },
  { key: "email",        label: "Emails" },
  { key: "note",         label: "Notes" },
  { key: "activity",     label: "Activities" },
  { key: "task",         label: "Tasks" },
  { key: "quote",        label: "Quotes" },
  { key: "stage_change", label: "Stage Changes" },
  { key: "attachment",   label: "Files" },
] as const;

const PRIORITY_COLOR: Record<string, string> = {
  high:   "text-red-400 border-red-400/40",
  medium: "text-amber-400 border-amber-400/40",
  low:    "text-slate-400 border-slate-400/40",
};

const QUOTE_STATUS_COLOR: Record<string, string> = {
  draft:    "text-slate-400 border-slate-400/40",
  sent:     "text-blue-400 border-blue-400/40",
  accepted: "text-emerald-400 border-emerald-400/40",
  rejected: "text-red-400 border-red-400/40",
  expired:  "text-amber-400 border-amber-400/40",
};

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
    ? <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40 gap-0.5 cursor-default"><AlertTriangle className="h-2.5 w-2.5" /> Suggested</Badge>
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
      <button className="text-left w-full" onClick={() => setExpanded(s => !s)}>
        <p className="text-sm font-medium leading-snug">{item.title}</p>
      </button>

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

function TaskCard({ item }: { item: TimelineItem }) {
  const meta = item.metadata;
  const isComplete = meta.status === "done" || meta.status === "completed";
  const priorityColor = PRIORITY_COLOR[meta.priority] ?? PRIORITY_COLOR.medium;
  return (
    <div className="min-w-0">
      <p className={`text-sm font-medium leading-snug ${isComplete ? "line-through text-muted-foreground" : ""}`}>
        {item.title}
      </p>
      {item.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.body}</p>}
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <Badge variant="outline" className={`text-[10px] capitalize ${isComplete ? "text-emerald-400 border-emerald-400/40" : "text-muted-foreground"}`}>
          {isComplete ? "Completed" : meta.status ?? "pending"}
        </Badge>
        {meta.priority && (
          <Badge variant="outline" className={`text-[10px] capitalize ${priorityColor}`}>
            {meta.priority}
          </Badge>
        )}
        {meta.dueDate && !isComplete && (
          <span className="text-[10px] text-muted-foreground">
            Due {format(new Date(meta.dueDate), "MMM d")}
          </span>
        )}
        {meta.completedAt && (
          <span className="text-[10px] text-emerald-400">
            Done {formatTimelineDate(meta.completedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

function QuoteCard({ item }: { item: TimelineItem }) {
  const meta = item.metadata;
  const statusColor = QUOTE_STATUS_COLOR[meta.status] ?? "text-muted-foreground border-border/50";
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium">{item.title}</p>
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <Badge variant="outline" className={`text-[10px] capitalize ${statusColor}`}>
          {meta.status ?? "draft"}
        </Badge>
        {meta.total != null && (
          <span className="text-xs text-muted-foreground font-medium">
            ${Number(meta.total).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        )}
        {meta.sentAt && (
          <span className="text-[10px] text-muted-foreground">Sent {formatTimelineDate(meta.sentAt)}</span>
        )}
        {meta.acceptedAt && (
          <span className="text-[10px] text-emerald-400">Accepted {formatTimelineDate(meta.acceptedAt)}</span>
        )}
      </div>
    </div>
  );
}

function StageChangeCard({ item }: { item: TimelineItem }) {
  const meta = item.metadata;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        {meta.fromStage && (
          <Badge variant="outline" className="text-[10px] capitalize text-muted-foreground">
            {meta.fromStage.replace(/_/g, " ")}
          </Badge>
        )}
        {meta.fromStage && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
        <Badge variant="outline" className="text-[10px] capitalize text-purple-400 border-purple-400/40">
          {(meta.toStage ?? "").replace(/_/g, " ")}
        </Badge>
      </div>
    </div>
  );
}

function NoteComposer({ objectType, objectId, onAdded }: { objectType: string; objectId: number; onAdded: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await apiRequest("POST", "/api/notes", {
        content: text.trim(),
        linkedObjectType: objectType,
        linkedObjectId: objectId,
      });
      setText("");
      onAdded();
      toast({ title: "Note added" });
    } catch {
      toast({ title: "Failed to add note", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Add a note…"
        className="min-h-[72px] text-sm resize-none"
        data-testid="input-timeline-note"
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">⌘↵ to save</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setText("")} data-testid="button-timeline-note-cancel">
            <X className="h-3 w-3 mr-1" /> Cancel
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={save} disabled={!text.trim() || saving} data-testid="button-timeline-note-save">
            Save note
          </Button>
        </div>
      </div>
    </div>
  );
}

function TimelineItemCard({ item, onUnlinkEmail }: { item: TimelineItem; onUnlinkEmail: (id: number) => void }) {
  const meta = TYPE_META[item.type] ?? TYPE_META.note;
  const { Icon, iconColor, ringColor, bgColor } = meta;

  return (
    <div className="flex gap-3 group" data-testid={`timeline-item-${item.timeline_id}`}>
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center ring-1 ${bgColor} ${ringColor}`}>
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        </div>
        <div className="flex-1 w-px bg-border/30 mt-1" />
      </div>

      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {meta.label}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
            {formatTimelineDate(item.created_at)}
          </span>
        </div>

        {item.type === "note"         && <NoteCard item={item} />}
        {item.type === "activity"     && <ActivityCard item={item} />}
        {item.type === "attachment"   && <AttachmentCard item={item} />}
        {item.type === "email"        && <EmailCard item={item} onUnlink={onUnlinkEmail} />}
        {item.type === "task"         && <TaskCard item={item} />}
        {item.type === "quote"        && <QuoteCard item={item} />}
        {item.type === "stage_change" && <StageChangeCard item={item} />}

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
  const [showComposer, setShowComposer] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);

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

  const visibleItems = filteredItems.slice(0, visibleCount);

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
      {/* Composer shortcuts */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setShowComposer(s => !s)}
          data-testid="button-timeline-add-note"
        >
          <Plus className="h-3 w-3" />
          <StickyNote className="h-3 w-3 text-amber-400" />
          Note
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "task", linkedObjectType: objectType, linkedObjectId: objectId } }))}
          data-testid="button-timeline-add-task"
        >
          <Plus className="h-3 w-3" />
          <CheckSquare className="h-3 w-3 text-sky-400" />
          Task
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "activity", linkedObjectType: objectType, linkedObjectId: objectId } }))}
          data-testid="button-timeline-log-activity"
        >
          <Plus className="h-3 w-3" />
          <Zap className="h-3 w-3 text-blue-400" />
          Activity
        </Button>
      </div>

      {/* Inline note composer */}
      {showComposer && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <NoteComposer
            objectType={objectType}
            objectId={objectId}
            onAdded={() => {
              setShowComposer(false);
              queryClient.invalidateQueries({ queryKey });
            }}
          />
        </div>
      )}

      {/* Filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {FILTERS.map(f => {
          const count = f.key === "all" ? allItems.length : typeCounts[f.key] ?? 0;
          if (f.key !== "all" && count === 0) return null;
          const isActive = activeFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => { setActiveFilter(f.key); setVisibleCount(50); }}
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
            {activeFilter === "all" ? "No activity yet" : `No ${FILTERS.find(f => f.key === activeFilter)?.label.toLowerCase() ?? activeFilter} found`}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
            {activeFilter === "all"
              ? "Notes, tasks, emails, files and activities will appear here in chronological order."
              : activeFilter === "email"
              ? "Emails are linked automatically by domain or contact match, or manually from the Emails tab."
              : `Add ${activeFilter.replace("_", " ")}s to this record and they'll appear here.`}
          </p>
        </div>
      ) : (
        <div>
          {visibleItems.map(item => (
            <TimelineItemCard
              key={item.timeline_id}
              item={item}
              onUnlinkEmail={id => unlinkMutation.mutate(id)}
            />
          ))}
          {filteredItems.length > visibleCount && (
            <div className="flex justify-center pt-2 pb-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setVisibleCount(c => c + 50)}
                data-testid="button-timeline-load-more"
              >
                Load {Math.min(50, filteredItems.length - visibleCount)} more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
