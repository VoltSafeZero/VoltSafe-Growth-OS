import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import {
  Mic, ArrowLeft, CheckCircle2, Clock, AlertCircle, XCircle,
  CalendarClock, Mail, Hash, Upload, Loader2, FileText,
  ListChecks, MessageSquare, Sparkles, Send, Plus,
  CheckCheck, X, Activity, Link2, Building2, User,
  Copy, RefreshCw, RotateCcw, Wand2, UserCheck, ExternalLink,
} from "lucide-react";
import { MeetingNoteCapturePanel } from "@/components/meeting-notes/meeting-note-capture-panel";
import { SiZoom } from "react-icons/si";

// ─── Types ───────────────────────────────────────────────────────────────────

type ActionItem = {
  id: number;
  meetingNoteId: number;
  title: string;
  description: string | null;
  ownerName: string | null;
  status: string;
  dueDate: string | null;
  sourceQuote: string | null;
  confidenceScore: string | null;
  createdTaskId: number | null;
};

type TranscriptChunk = {
  id: number;
  sequenceNo: number;
  speakerLabel: string | null;
  startMs: number | null;
  text: string;
  isFinal: boolean;
};

type MeetingNoteDetail = {
  id: number;
  uuid: string;
  title: string | null;
  status: string;
  source: string;
  platform: string | null;
  durationSeconds: number | null;
  summaryText: string | null;
  notesText: string | null;
  decisionsText: string | null;
  actionItemsText: string | null;
  followupDraftText: string | null;
  rawTranscriptText: string | null;
  cleanTranscriptText: string | null;
  consentNoted: boolean;
  startedAt: string | null;
  endedAt: string | null;
  calendarEventId: number | null;
  linkedObjectType: string | null;
  linkedObjectId: number | null;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
  chunks: TranscriptChunk[];
  actionItems: ActionItem[];
  participants: {
    id: number;
    name: string | null;
    email: string | null;
    contactId: number | null;
    isInternal: boolean;
    speakerLabel: string | null;
  }[];
  links: { id: number; linkedObjectType: string; linkedObjectId: number }[];
  suggestions: ParticipantSuggestion[];
};

type ParticipantSuggestion = {
  participantId: number;
  participantEmail: string;
  matchType: "email_exact" | "domain_account" | "none";
  match: {
    contactId: number;
    contactName: string;
    contactEmail: string | null;
    accountId: number;
    accountName: string;
  } | null;
};

type Account = { id: number; name: string; industry?: string | null };
type Contact = { id: number; name: string; email?: string | null; accountId?: number | null };
type Opportunity = { id: number; name: string; accountId?: number | null };

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  scheduled_prompted: "Scheduled",
  recording:          "Recording",
  processing:         "Processing",
  completed:          "Completed",
  failed:             "Failed",
  cancelled:          "Cancelled",
};

const STATUS_CLASS: Record<string, string> = {
  scheduled_prompted: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  recording:          "bg-red-500/10 text-red-500 border-red-500/20",
  processing:         "bg-amber-500/10 text-amber-600 border-amber-500/20",
  completed:          "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  failed:             "bg-red-500/10 text-red-500 border-red-500/20",
  cancelled:          "bg-muted text-muted-foreground border-border",
};

const STATUS_ICON: Record<string, React.ElementType> = {
  scheduled_prompted: Clock,
  recording:          Mic,
  processing:         Loader2,
  completed:          CheckCircle2,
  failed:             AlertCircle,
  cancelled:          XCircle,
};

const SOURCE_LABEL: Record<string, string> = {
  calendar: "Calendar", mail: "Email", adhoc: "Ad-hoc", upload: "Upload",
};

const SOURCE_ICON: Record<string, React.ElementType> = {
  calendar: CalendarClock, mail: Mail, adhoc: Hash, upload: Upload,
};

const AI_STATUS_CLASS: Record<string, string> = {
  suggested:    "bg-amber-500/10 text-amber-600 border-amber-500/20",
  accepted:     "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected:     "bg-muted text-muted-foreground border-border",
  task_created: "bg-primary/10 text-primary border-primary/20",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(secs: number | null): string {
  if (!secs) return "";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

function msToTimestamp(ms: number | null): string {
  if (!ms && ms !== 0) return "";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

// ─── EditableTitle ────────────────────────────────────────────────────────────

function EditableTitle({
  noteId, initial, onSave,
}: { noteId: number; initial: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(initial ?? "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setVal(initial ?? ""); }, [initial]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  function commit() {
    setEditing(false);
    if (val.trim() !== (initial ?? "")) onSave(val.trim() || "Untitled Meeting");
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setVal(initial ?? ""); } }}
        className="text-xl font-semibold bg-transparent border-b border-primary outline-none w-full min-w-0 py-0.5"
        data-testid="input-meeting-note-title"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-xl font-semibold text-left hover:text-primary transition-colors truncate max-w-full"
      data-testid="text-meeting-note-title-editable"
      title="Click to edit title"
    >
      {val || <span className="text-muted-foreground italic">Untitled Meeting</span>}
    </button>
  );
}

// ─── Compose Dialog ───────────────────────────────────────────────────────────

function FollowUpComposeDialog({
  open, onClose, defaultTo, defaultSubject, defaultBody,
}: {
  open: boolean;
  onClose: () => void;
  defaultTo: string;
  defaultSubject: string;
  defaultBody: string;
}) {
  const { toast } = useToast();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);

  useEffect(() => {
    if (open) { setTo(defaultTo); setSubject(defaultSubject); setBody(defaultBody); }
  }, [open, defaultTo, defaultSubject, defaultBody]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/gmail/send", {
        to,
        subject,
        body: body.replace(/\n/g, "<br>"),
        attachmentIds: [],
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || `Error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Follow-up sent" });
      onClose();
    },
    onError: (e: Error) => {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Send className="w-4 h-4" /> Send Follow-up Email
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 mt-1">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="h-8 text-sm"
              data-testid="input-followup-to"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Subject</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-8 text-sm"
              data-testid="input-followup-subject"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Body</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[180px] text-sm resize-none"
              data-testid="textarea-followup-body"
            />
          </div>
          <div className="flex justify-end gap-2 mt-1">
            <Button variant="outline" size="sm" onClick={onClose} data-testid="button-followup-cancel">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending || !to.trim() || !subject.trim()}
              data-testid="button-followup-send"
            >
              {sendMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
              Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── CRM Link Picker ──────────────────────────────────────────────────────────

type CrmObjectType = "account" | "contact" | "opportunity";

function CrmLinkPicker({
  noteId, currentType, currentId, onLinked,
}: {
  noteId: number;
  currentType: string | null;
  currentId: number | null;
  onLinked: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [objType, setObjType] = useState<CrmObjectType>("account");

  const accountsQuery = useQuery<Account[]>({
    queryKey: ["/api/accounts", "all"],
    staleTime: 60_000,
  });

  const contactsQuery = useQuery<Contact[]>({
    queryKey: ["/api/contacts", null],
    staleTime: 60_000,
  });

  const linkMutation = useMutation({
    mutationFn: async ({ type, id }: { type: CrmObjectType; id: number }) => {
      const res = await apiRequest("POST", `/api/meeting-notes/${noteId}/link-record`, {
        objectType: type,
        objectId: id,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Link failed");
      }
      // Also update the note's primary linked object
      await apiRequest("PATCH", `/api/meeting-notes/${noteId}`, {
        linkedObjectType: type,
        linkedObjectId: id,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Record linked" });
      setOpen(false);
      onLinked();
    },
    onError: (e: Error) => {
      toast({ title: "Link failed", description: e.message, variant: "destructive" });
    },
  });

  const accounts = accountsQuery.data ?? [];
  const contacts = (contactsQuery.data as any)?.contacts ?? contactsQuery.data ?? [];

  const currentLabel = (() => {
    if (!currentType || !currentId) return null;
    if (currentType === "account") {
      const a = accounts.find((x) => x.id === currentId);
      return a ? `${a.name} (Account)` : `Account #${currentId}`;
    }
    if (currentType === "contact") {
      const c = (contacts as Contact[]).find((x) => x.id === currentId);
      return c ? `${c.name} (Contact)` : `Contact #${currentId}`;
    }
    return `${currentType} #${currentId}`;
  })();

  return (
    <div className="flex flex-col gap-2">
      {currentLabel && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-500/10 rounded-md px-2 py-1.5" data-testid="text-linked-record">
          <Link2 className="w-3 h-3 shrink-0" />
          <span className="truncate">{currentLabel}</span>
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1.5" data-testid="button-link-record">
            <Link2 className="w-3 h-3" />
            {currentLabel ? "Change Link" : "Link to CRM Record"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="flex border-b border-border/50">
            {(["account", "contact"] as CrmObjectType[]).map((t) => (
              <button
                key={t}
                onClick={() => setObjType(t)}
                className={`flex-1 py-1.5 text-xs font-medium capitalize transition-colors ${
                  objType === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"
                }`}
                data-testid={`tab-link-${t}`}
              >
                {t === "account" ? <Building2 className="w-3 h-3 inline mr-1" /> : <User className="w-3 h-3 inline mr-1" />}
                {t}
              </button>
            ))}
          </div>
          <Command>
            <CommandInput placeholder={`Search ${objType}s…`} className="h-8 text-sm" />
            <CommandList className="max-h-52">
              <CommandEmpty>No {objType}s found</CommandEmpty>
              <CommandGroup>
                {objType === "account" && accounts.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={a.name}
                    onSelect={() => linkMutation.mutate({ type: "account", id: a.id })}
                    data-testid={`item-link-account-${a.id}`}
                  >
                    <Building2 className="w-3 h-3 mr-2 shrink-0 text-muted-foreground" />
                    {a.name}
                  </CommandItem>
                ))}
                {objType === "contact" && (contacts as Contact[]).map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    onSelect={() => linkMutation.mutate({ type: "contact", id: c.id })}
                    data-testid={`item-link-contact-${c.id}`}
                  >
                    <User className="w-3 h-3 mr-2 shrink-0 text-muted-foreground" />
                    {c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Suggested Links Panel ────────────────────────────────────────────────────

function SuggestedLinksPanel({
  noteId,
  suggestions,
  onConfirmed,
}: {
  noteId: number;
  suggestions: ParticipantSuggestion[];
  onConfirmed: () => void;
}) {
  const { toast } = useToast();
  const [confirmedIds, setConfirmedIds] = useState<Set<number>>(new Set());

  const pending = suggestions.filter(
    (s) => s.match !== null && !confirmedIds.has(s.participantId),
  );

  const confirmMutation = useMutation({
    mutationFn: async ({ participantId, contactId }: { participantId: number; contactId: number }) => {
      const r = await apiRequest(
        "PATCH",
        `/api/meeting-notes/${noteId}/participants/${participantId}`,
        { contactId },
      );
      if (!r.ok) throw new Error("Failed to link");
      return r.json();
    },
    onSuccess: (_data, { participantId }) => {
      setConfirmedIds((s) => new Set([...s, participantId]));
      onConfirmed();
      toast({ title: "Contact linked", description: "Participant linked to CRM contact." });
    },
    onError: () => toast({ title: "Link failed", variant: "destructive" }),
  });

  if (pending.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5"
      data-testid="panel-suggested-links"
    >
      <div className="flex items-center gap-1.5">
        <UserCheck className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
          Suggested Links
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {pending.map((s) => {
          if (!s.match) return null;
          const isPending = confirmMutation.isPending && confirmMutation.variables?.participantId === s.participantId;
          return (
            <div
              key={s.participantId}
              className="flex flex-col gap-1 p-2 rounded-md bg-background/60 border border-border/40"
              data-testid={`suggestion-${s.participantId}`}
            >
              <p className="text-xs text-muted-foreground truncate" title={s.participantEmail}>
                {s.participantEmail}
              </p>
              <div className="flex items-center gap-1">
                {s.matchType === "email_exact"
                  ? <UserCheck className="w-3 h-3 text-emerald-500 shrink-0" />
                  : <Building2 className="w-3 h-3 text-blue-400 shrink-0" />
                }
                <span className="text-xs font-medium text-foreground truncate flex-1" title={s.match.contactName}>
                  {s.match.contactName}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{s.match.accountName}</p>
              <Button
                size="sm"
                className="h-6 text-[10px] w-full gap-1 mt-0.5"
                onClick={() => confirmMutation.mutate({ participantId: s.participantId, contactId: s.match!.contactId })}
                disabled={isPending}
                data-testid={`button-confirm-link-${s.participantId}`}
              >
                {isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Link2 className="w-2.5 h-2.5" />}
                Link
              </Button>
            </div>
          );
        })}
      </div>

      {pending.length > 1 && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] w-full gap-1 border-amber-500/30"
          onClick={() => {
            pending.forEach((s) => {
              if (s.match && !confirmMutation.isPending) {
                confirmMutation.mutate({ participantId: s.participantId, contactId: s.match.contactId });
              }
            });
          }}
          disabled={confirmMutation.isPending}
          data-testid="button-confirm-all-links"
        >
          <CheckCheck className="w-2.5 h-2.5" />
          Link all ({pending.length})
        </Button>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MeetingNotesDetailPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const noteId = Number(params?.id);

  const [composeOpen, setComposeOpen] = useState(false);
  const [timelineAdded, setTimelineAdded] = useState(false);
  const [tasksCreated, setTasksCreated] = useState(false);
  const [activeTab, setActiveTab] = useState("summary");
  const [justCompleted, setJustCompleted] = useState(false);
  const [highlightedTabs, setHighlightedTabs] = useState<Set<string>>(new Set());

  const prevStatusRef = useRef<string | null>(null);

  const { data: note, isLoading, isError, refetch } = useQuery<MeetingNoteDetail>({
    queryKey: ["/api/meeting-notes", noteId],
    queryFn: () => fetch(`/api/meeting-notes/${noteId}`).then((r) => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
    enabled: !!noteId,
    // Poll every 2.5s while processing — stop once done or failed
    refetchInterval: (query) => {
      const status = (query.state.data as MeetingNoteDetail | undefined)?.status;
      return status === "processing" ? 2500 : false;
    },
  });

  // Fetch the linked calendar event to get its Zoom URL (only for Zoom notes)
  const { data: linkedCalEvent } = useQuery<{ meetingUrl?: string | null } | null>({
    queryKey: ["/api/calendar/events", note?.calendarEventId],
    queryFn: () =>
      fetch(`/api/calendar/events/${note!.calendarEventId}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    enabled: !!note?.calendarEventId && note?.platform === "zoom",
    staleTime: 60_000,
  });

  // Detect processing → completed transition: toast, tab highlights, summary switch
  useEffect(() => {
    if (!note) return;
    const prev = prevStatusRef.current;
    if (prev === "processing" && (note.status === "completed" || note.status === "failed")) {
      if (note.status === "completed") {
        setActiveTab("summary");
        setJustCompleted(true);
        setTimeout(() => setJustCompleted(false), 2500);

        // Fire summary toast with counts
        const actionCount = note.actionItems.length;
        const hasFollowup = !!note.followupDraftText;
        const parts: string[] = [];
        if (actionCount > 0) parts.push(`${actionCount} action${actionCount === 1 ? "" : "s"} ready`);
        if (hasFollowup) parts.push("follow-up draft ready");
        toast({
          title: "Meeting processed",
          description: parts.length > 0 ? parts.join(" · ") : "Summary and insights are ready",
        });

        // Highlight relevant tabs
        const toHighlight = new Set<string>();
        if (actionCount > 0) toHighlight.add("action-items");
        if (hasFollowup) toHighlight.add("followup");
        if (toHighlight.size > 0) setHighlightedTabs(toHighlight);
      }
    }
    prevStatusRef.current = note.status;
  }, [note?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retry / Regenerate mutation — POST /api/meeting-notes/:id/process
  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/meeting-notes/${noteId}/process`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to start analysis");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Analysis started — checking for results…" });
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-notes", noteId] });
    },
    onError: (e: Error) => toast({ title: "Retry failed", description: e.message, variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/meeting-notes/${noteId}`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/meeting-notes", noteId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/meeting-notes"] });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  // Action item status mutation
  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/meeting-notes/${noteId}/action-items/${itemId}`,
        { status },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Update failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-notes", noteId] });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  // Create tasks mutation
  const createTasksMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/meeting-notes/${noteId}/create-tasks`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed");
      }
      return res.json() as Promise<{ created: number; skipped: number }>;
    },
    onSuccess: (data) => {
      if (data.created > 0) {
        toast({ title: `${data.created} task${data.created === 1 ? "" : "s"} created` });
        setTasksCreated(true);
      } else {
        toast({ title: "No new tasks — accept items first" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-notes", noteId] });
    },
    onError: (e: Error) => toast({ title: "Task creation failed", description: e.message, variant: "destructive" }),
  });

  // Add to timeline mutation
  const timelineMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/meeting-notes/${noteId}/add-to-timeline`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed");
      }
      return res.json();
    },
    onSuccess: (data: { ok: boolean; activityId?: number; skipped?: boolean }) => {
      toast({
        title: data.skipped
          ? "Already on timeline — no duplicate added"
          : "Added to CRM timeline",
      });
      setTimelineAdded(true);
    },
    onError: (e: Error) => toast({ title: "Timeline failed", description: e.message, variant: "destructive" }),
  });

  // Local notes textarea state (debounce via blur)
  const [notesVal, setNotesVal] = useState<string>("");
  const notesSynced = useRef(false);
  useEffect(() => {
    if (note && !notesSynced.current) {
      setNotesVal(note.notesText ?? "");
      notesSynced.current = true;
    }
  }, [note]);

  function saveNotes() {
    if (!note) return;
    if (notesVal !== (note.notesText ?? "")) {
      patchMutation.mutate({ notesText: notesVal });
    }
  }

  function saveTitle(title: string) {
    patchMutation.mutate({ title });
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl mx-auto px-4 py-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !note) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <AlertCircle className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Meeting note not found</p>
        <Button size="sm" variant="outline" onClick={() => navigate("/meeting-notes")}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to list
        </Button>
      </div>
    );
  }

  const StatusIcon = STATUS_ICON[note.status] ?? Clock;
  const SrcIcon = SOURCE_ICON[note.source] ?? Hash;
  const zoomJoinUrl = linkedCalEvent?.meetingUrl ?? null;

  const acceptedCount = note.actionItems.filter((i) => i.status === "accepted").length;
  const taskCreatedCount = note.actionItems.filter((i) => i.status === "task_created").length;

  // Follow-up compose pre-fill
  const participantEmails = note.participants
    .filter((p) => p.email)
    .map((p) => p.email!)
    .join(", ");
  const composeSubject = `Follow-up: ${note.title || "Meeting"}`;
  const composeBody = note.followupDraftText ?? "";

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto bg-background">
      <div className="max-w-4xl w-full mx-auto px-4 py-5 flex flex-col gap-4">

        {/* Back link */}
        <button
          onClick={() => navigate("/meeting-notes")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
          data-testid="link-back-meeting-notes"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Meeting Notes
        </button>

        {/* Header row */}
        <div className="flex flex-col gap-2">
          <EditableTitle noteId={note.id} initial={note.title} onSave={saveTitle} />

          <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge
              variant="outline"
              className={`flex items-center gap-1 text-[10px] ${STATUS_CLASS[note.status] ?? ""}`}
              data-testid="status-badge"
            >
              <StatusIcon className="w-3 h-3" />
              {STATUS_LABEL[note.status] ?? note.status}
            </Badge>

            <span className="flex items-center gap-1 text-muted-foreground">
              <SrcIcon className="w-3 h-3" />
              {SOURCE_LABEL[note.source] ?? note.source}
            </span>

            {note.platform === "zoom" ? (
              <Badge
                variant="outline"
                className="flex items-center gap-1 text-[10px] font-medium text-[#2D8CFF] border-[#2D8CFF]/40 bg-[#2D8CFF]/10 px-1.5 py-0.5"
              >
                <SiZoom className="h-2.5 w-2.5 shrink-0" />
                Zoom
              </Badge>
            ) : note.platform ? (
              <span className="text-muted-foreground capitalize">{note.platform}</span>
            ) : null}
            {note.platform === "zoom" && zoomJoinUrl && (
              <a
                href={zoomJoinUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-zoom-join"
                className="inline-flex items-center gap-1 text-[10px] font-medium text-[#2D8CFF] hover:underline"
              >
                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                Join Zoom
              </a>
            )}

            {note.durationSeconds ? (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDuration(note.durationSeconds)}
              </span>
            ) : null}

            <span>{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}</span>

            {note.linkedObjectType && note.linkedObjectId && (
              <Badge variant="outline" className="flex items-center gap-1 text-[10px] text-sky-500 border-sky-500/20 bg-sky-500/10" data-testid="badge-linked-record">
                <Link2 className="w-3 h-3" />
                Linked: {note.linkedObjectType} #{note.linkedObjectId}
              </Badge>
            )}
          </div>
        </div>

        {/* Processing banner */}
        {note.status === "processing" && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20" data-testid="banner-processing">
            <Loader2 className="w-4 h-4 text-amber-600 animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Analyzing meeting…</p>
              <p className="text-xs text-amber-600/70">Transcribing and extracting insights. This usually takes under a minute.</p>
            </div>
          </div>
        )}

        {/* Failure banner */}
        {note.status === "failed" && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20" data-testid="banner-failed">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">Processing failed</p>
              {note.processingError && (
                <p className="text-xs text-red-500/80 mt-0.5 line-clamp-2">
                  {note.processingError.replace(/openai|api.key|sk-[a-zA-Z0-9]+/gi, "[redacted]")}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 h-7 text-xs border-red-500/30 text-red-600 hover:bg-red-500/10 gap-1.5"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              data-testid="button-retry-analysis"
            >
              {retryMutation.isPending
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <RotateCcw className="w-3 h-3" />}
              Retry Analysis
            </Button>
          </div>
        )}

        {/* Two-column layout */}
        <div className="flex gap-4 items-start">

          {/* Main tabs */}
          <div className="flex-1 min-w-0">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full justify-start h-9 gap-0.5 bg-muted/40 p-1" data-testid="tabs-meeting-note">
                <TabsTrigger value="summary" className="text-xs gap-1.5" data-testid="tab-summary">
                  <Sparkles className="w-3 h-3" /> Summary
                </TabsTrigger>
                <TabsTrigger value="transcript" className="text-xs gap-1.5" data-testid="tab-transcript">
                  <FileText className="w-3 h-3" /> Transcript
                </TabsTrigger>
                <TabsTrigger value="notes" className="text-xs gap-1.5" data-testid="tab-notes">
                  <MessageSquare className="w-3 h-3" /> Notes
                </TabsTrigger>
                <TabsTrigger
                  value="action-items"
                  className="text-xs gap-1.5"
                  data-testid="tab-action-items"
                  onClick={() => setHighlightedTabs((prev) => { const s = new Set(prev); s.delete("action-items"); return s; })}
                >
                  <ListChecks className="w-3 h-3" /> Action Items
                  {note.actionItems.length > 0 && (
                    <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold transition-colors ${
                      highlightedTabs.has("action-items")
                        ? "bg-primary text-primary-foreground animate-pulse"
                        : "bg-primary/10 text-primary"
                    }`}>
                      {note.actionItems.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="followup"
                  className="text-xs gap-1.5"
                  data-testid="tab-followup"
                  onClick={() => setHighlightedTabs((prev) => { const s = new Set(prev); s.delete("followup"); return s; })}
                >
                  <Send className="w-3 h-3" /> Follow-up
                  {highlightedTabs.has("followup") && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" data-testid="dot-followup-highlight" />
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── Summary ──────────────────────────────────────────────── */}
              <TabsContent value="summary" className="mt-3">
                {note.summaryText ? (
                  <div
                    className={`text-sm text-foreground whitespace-pre-wrap leading-relaxed transition-all duration-700 ${
                      justCompleted ? "animate-pulse bg-emerald-500/5 rounded-lg p-2 -m-2" : ""
                    }`}
                    data-testid="text-summary"
                  >
                    {note.summaryText}
                  </div>
                ) : (
                  <EmptyState icon={Sparkles} message="No summary yet — one will appear after processing." />
                )}

                {note.decisionsText && (
                  <div className="mt-4 pt-4 border-t border-border/40">
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Decisions</p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{note.decisionsText}</p>
                  </div>
                )}

                {note.participants.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/40">
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Participants</p>
                    <div className="flex flex-wrap gap-1.5">
                      {note.participants.map((p) => (
                        <Badge
                          key={p.id}
                          variant="secondary"
                          className={`text-xs gap-1 ${p.contactId ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : ""}`}
                          data-testid={`badge-participant-${p.id}`}
                        >
                          {p.contactId
                            ? <UserCheck className="w-2.5 h-2.5 shrink-0" />
                            : p.isInternal
                            ? <User className="w-2.5 h-2.5 shrink-0 text-muted-foreground" />
                            : null
                          }
                          {p.name || p.email || "Unknown"}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ── Transcript ───────────────────────────────────────────── */}
              <TabsContent value="transcript" className="mt-3">
                {note.chunks.length > 0 ? (
                  <div className="flex flex-col gap-2" data-testid="list-transcript-chunks">
                    {note.chunks.map((chunk) => (
                      <div
                        key={chunk.id}
                        className="flex gap-3 py-2 border-b border-border/30 last:border-0"
                        data-testid={`chunk-${chunk.id}`}
                      >
                        <span className="text-[10px] text-muted-foreground shrink-0 pt-0.5 w-10 text-right font-mono">
                          {msToTimestamp(chunk.startMs)}
                        </span>
                        <div className="flex-1 min-w-0">
                          {chunk.speakerLabel && (
                            <p className="text-[11px] font-semibold text-muted-foreground mb-0.5">{chunk.speakerLabel}</p>
                          )}
                          <p className="text-sm leading-relaxed">{chunk.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : note.rawTranscriptText ? (
                  <pre className="text-sm whitespace-pre-wrap leading-relaxed font-sans" data-testid="text-raw-transcript">
                    {note.rawTranscriptText}
                  </pre>
                ) : (
                  <EmptyState icon={FileText} message="No transcript yet — one will appear after recording and processing." />
                )}
              </TabsContent>

              {/* ── Notes ────────────────────────────────────────────────── */}
              <TabsContent value="notes" className="mt-3">
                <Textarea
                  value={notesVal}
                  onChange={(e) => setNotesVal(e.target.value)}
                  onBlur={saveNotes}
                  placeholder="Add your own notes here…"
                  className="min-h-[200px] text-sm resize-none"
                  data-testid="textarea-notes"
                />
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {patchMutation.isPending ? "Saving…" : "Saves automatically on blur"}
                </p>
              </TabsContent>

              {/* ── Action Items ─────────────────────────────────────────── */}
              <TabsContent value="action-items" className="mt-3">
                {note.actionItems.length > 0 ? (
                  <div className="flex flex-col gap-3" data-testid="list-action-items">
                    {/* Create Tasks bar */}
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/40">
                      <p className="text-xs text-muted-foreground">
                        {tasksCreated
                          ? `${taskCreatedCount} task${taskCreatedCount !== 1 ? "s" : ""} created from this note`
                          : acceptedCount > 0
                          ? `${acceptedCount} accepted · ${taskCreatedCount} task${taskCreatedCount !== 1 ? "s" : ""} created`
                          : "Accept items below to create CRM tasks"}
                      </p>
                      <Button
                        size="sm"
                        variant={tasksCreated ? "outline" : acceptedCount > 0 ? "default" : "outline"}
                        className={`h-7 text-xs gap-1.5 ${tasksCreated ? "border-emerald-500/40 text-emerald-600" : ""}`}
                        onClick={() => createTasksMutation.mutate()}
                        disabled={createTasksMutation.isPending || acceptedCount === 0 || tasksCreated}
                        data-testid="button-create-tasks"
                      >
                        {createTasksMutation.isPending
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : tasksCreated
                          ? <CheckCircle2 className="w-3 h-3" />
                          : <Plus className="w-3 h-3" />}
                        {tasksCreated ? "Tasks Created ✓" : `Create Tasks (${acceptedCount})`}
                      </Button>
                    </div>

                    {note.actionItems.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                          item.status === "rejected"
                            ? "border-border/30 opacity-50"
                            : item.status === "accepted" || item.status === "task_created"
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-border/50 bg-card"
                        }`}
                        data-testid={`card-action-item-${item.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-2 flex-wrap">
                            <p className="text-sm font-medium">{item.title}</p>
                            {item.status === "suggested" && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-500 bg-violet-500/10 border border-violet-500/20 rounded-full px-1.5 py-0.5 shrink-0 mt-0.5" data-testid={`badge-ai-suggested-${item.id}`}>
                                <Wand2 className="w-2.5 h-2.5" /> AI Suggested
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                          )}
                          {item.ownerName && (
                            <p className="text-xs text-muted-foreground mt-1">Owner: {item.ownerName}</p>
                          )}
                          {item.dueDate && (
                            <p className="text-xs text-muted-foreground">
                              Due {format(new Date(item.dueDate), "MMM d, yyyy")}
                            </p>
                          )}
                          {item.sourceQuote && (
                            <blockquote className="text-xs italic text-muted-foreground mt-1 pl-2 border-l-2 border-border">
                              "{item.sourceQuote}"
                            </blockquote>
                          )}
                          {item.createdTaskId && (
                            <p className="text-xs text-primary mt-1">Task #{item.createdTaskId} created</p>
                          )}
                        </div>

                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${AI_STATUS_CLASS[item.status] ?? ""}`}
                            data-testid={`status-action-item-${item.id}`}
                          >
                            {item.status.replace("_", " ")}
                          </Badge>

                          {item.status === "suggested" && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => updateItemMutation.mutate({ itemId: item.id, status: "accepted" })}
                                className="flex items-center gap-0.5 text-[10px] text-emerald-600 hover:bg-emerald-500/10 rounded px-1.5 py-0.5 transition-colors"
                                data-testid={`button-accept-${item.id}`}
                                title="Accept"
                              >
                                <CheckCheck className="w-3 h-3" /> Accept
                              </button>
                              <button
                                onClick={() => updateItemMutation.mutate({ itemId: item.id, status: "rejected" })}
                                className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:bg-muted/50 rounded px-1.5 py-0.5 transition-colors"
                                data-testid={`button-reject-${item.id}`}
                                title="Reject"
                              >
                                <X className="w-3 h-3" /> Reject
                              </button>
                            </div>
                          )}

                          {item.status === "accepted" && (
                            <button
                              onClick={() => updateItemMutation.mutate({ itemId: item.id, status: "suggested" })}
                              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                              data-testid={`button-undo-accept-${item.id}`}
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={ListChecks} message="No action items yet — they will be extracted after processing." />
                )}
              </TabsContent>

              {/* ── Follow-up ────────────────────────────────────────────── */}
              <TabsContent value="followup" className="mt-3">
                {note.followupDraftText ? (
                  <div className="flex flex-col gap-3">
                    <div
                      className="text-sm whitespace-pre-wrap leading-relaxed p-3 rounded-lg bg-secondary/30 border border-border/50"
                      data-testid="text-followup-draft"
                    >
                      {note.followupDraftText}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8 text-xs"
                          onClick={() => {
                            navigator.clipboard.writeText(note.followupDraftText ?? "").then(() =>
                              toast({ title: "Copied to clipboard" }),
                            );
                          }}
                          data-testid="button-copy-followup"
                        >
                          <Copy className="w-3.5 h-3.5" /> Copy
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8 text-xs"
                          onClick={() => retryMutation.mutate()}
                          disabled={retryMutation.isPending || note.status === "processing"}
                          data-testid="button-regenerate-draft"
                          title="Re-run AI to refresh the draft"
                        >
                          {retryMutation.isPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <RefreshCw className="w-3.5 h-3.5" />}
                          Regenerate
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5 h-8 text-xs"
                        onClick={() => setComposeOpen(true)}
                        data-testid="button-send-followup"
                      >
                        <Send className="w-3.5 h-3.5" /> Send Follow-up
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <EmptyState icon={Send} message="No follow-up draft yet — generate one below." />
                    <div className="flex justify-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8 text-xs"
                        onClick={() => retryMutation.mutate()}
                        disabled={retryMutation.isPending || note.status === "processing"}
                        data-testid="button-generate-draft"
                      >
                        {retryMutation.isPending
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Wand2 className="w-3.5 h-3.5" />}
                        Generate Draft
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Right column */}
          <div className="w-56 shrink-0 flex flex-col gap-3">
            {/* Capture panel */}
            <MeetingNoteCapturePanel note={note} onRefetch={refetch} />

            {/* Suggested Links */}
            <SuggestedLinksPanel
              noteId={noteId}
              suggestions={note.suggestions ?? []}
              onConfirmed={() => queryClient.invalidateQueries({ queryKey: ["/api/meeting-notes", noteId] })}
            />

            {/* Quick Actions — shown when note is completed and has results */}
            {note.status === "completed" && (note.actionItems.length > 0 || !!note.followupDraftText) && (
              <div
                className="flex flex-col gap-2 p-3 rounded-lg border border-primary/20 bg-primary/5"
                data-testid="panel-quick-actions"
              >
                <p className="text-xs font-semibold text-primary uppercase tracking-wide flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" /> Quick Actions
                </p>

                {note.actionItems.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className={`w-full h-7 text-xs gap-1.5 transition-colors ${
                      highlightedTabs.has("action-items")
                        ? "border-primary/40 text-primary bg-primary/5"
                        : ""
                    }`}
                    onClick={() => {
                      setActiveTab("action-items");
                      setHighlightedTabs((prev) => { const s = new Set(prev); s.delete("action-items"); return s; });
                    }}
                    data-testid="button-quick-create-tasks"
                  >
                    <ListChecks className="w-3 h-3" />
                    Create Tasks
                    {note.actionItems.length > 0 && (
                      <span className="ml-auto text-[10px] bg-primary/10 text-primary px-1.5 rounded-full">
                        {note.actionItems.length}
                      </span>
                    )}
                  </Button>
                )}

                {!!note.followupDraftText && (
                  <Button
                    size="sm"
                    variant="outline"
                    className={`w-full h-7 text-xs gap-1.5 transition-colors ${
                      highlightedTabs.has("followup")
                        ? "border-primary/40 text-primary bg-primary/5"
                        : ""
                    }`}
                    onClick={() => {
                      setComposeOpen(true);
                      setHighlightedTabs((prev) => { const s = new Set(prev); s.delete("followup"); return s; });
                    }}
                    data-testid="button-quick-send-followup"
                  >
                    <Send className="w-3 h-3" /> Send Follow-up
                  </Button>
                )}
              </div>
            )}

            {/* CRM actions */}
            <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/50 bg-card">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">CRM</p>

              {/* CRM Link Picker */}
              <CrmLinkPicker
                noteId={noteId}
                currentType={note.linkedObjectType}
                currentId={note.linkedObjectId}
                onLinked={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/meeting-notes", noteId] });
                }}
              />

              {/* Add to Timeline */}
              <Button
                variant="outline"
                size="sm"
                className={`w-full h-7 text-xs gap-1.5 ${timelineAdded ? "border-emerald-500/40 text-emerald-600" : ""}`}
                onClick={() => timelineMutation.mutate()}
                disabled={timelineMutation.isPending || timelineAdded || !note.linkedObjectType}
                data-testid="button-add-to-timeline"
                title={!note.linkedObjectType ? "Link to a CRM record first" : ""}
              >
                {timelineMutation.isPending
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : timelineAdded
                  ? <CheckCircle2 className="w-3 h-3" />
                  : <Activity className="w-3 h-3" />}
                {timelineAdded ? "Added to Timeline" : "Add to Timeline"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Follow-up compose dialog */}
      <FollowUpComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        defaultTo={participantEmails}
        defaultSubject={composeSubject}
        defaultBody={composeBody}
      />
    </div>
  );
}

// ─── EmptyState helper ────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center" data-testid="empty-state">
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
    </div>
  );
}
