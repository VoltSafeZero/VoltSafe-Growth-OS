import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import {
  Mic, ArrowLeft, CheckCircle2, Clock, AlertCircle, XCircle,
  CalendarClock, Mail, Hash, Upload, Loader2, FileText,
  ListChecks, MessageSquare, Sparkles, Send,
} from "lucide-react";

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
  participants: { id: number; name: string | null; email: string | null }[];
  links: { id: number; linkedObjectType: string; linkedObjectId: number }[];
};

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  scheduled_prompted: "Scheduled",
  recording:          "Recording",
  processing:         "Processing",
  done:               "Done",
  error:              "Error",
  cancelled:          "Cancelled",
};

const STATUS_CLASS: Record<string, string> = {
  scheduled_prompted: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  recording:          "bg-red-500/10 text-red-500 border-red-500/20",
  processing:         "bg-amber-500/10 text-amber-600 border-amber-500/20",
  done:               "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  error:              "bg-red-500/10 text-red-500 border-red-500/20",
  cancelled:          "bg-muted text-muted-foreground border-border",
};

const STATUS_ICON: Record<string, React.ElementType> = {
  scheduled_prompted: Clock,
  recording:          Mic,
  processing:         Loader2,
  done:               CheckCircle2,
  error:              AlertCircle,
  cancelled:          XCircle,
};

const SOURCE_LABEL: Record<string, string> = {
  calendar: "Calendar", mail: "Email", adhoc: "Ad-hoc", upload: "Upload",
};

const SOURCE_ICON: Record<string, React.ElementType> = {
  calendar: CalendarClock, mail: Mail, adhoc: Hash, upload: Upload,
};

const AI_STATUS_CLASS: Record<string, string> = {
  suggested: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  accepted:  "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected:  "bg-muted text-muted-foreground border-border",
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

// ─── CapturePanel ────────────────────────────────────────────────────────────

function CapturePanel({ note }: { note: MeetingNoteDetail }) {
  const isDone = ["done", "cancelled", "error"].includes(note.status);

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-border/60 bg-card">
      <div className="flex items-center gap-2">
        <Mic className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Capture</span>
      </div>

      {note.status === "recording" ? (
        <div className="flex items-center gap-2 text-red-500 text-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Recording…
        </div>
      ) : note.status === "processing" ? (
        <div className="flex items-center gap-2 text-amber-600 text-sm">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Processing transcript…
        </div>
      ) : null}

      {note.startedAt && (
        <p className="text-xs text-muted-foreground">
          Started {format(new Date(note.startedAt), "h:mm a")}
          {note.endedAt ? ` · Ended ${format(new Date(note.endedAt), "h:mm a")}` : ""}
          {note.durationSeconds ? ` · ${formatDuration(note.durationSeconds)}` : ""}
        </p>
      )}

      <div
        title="Recording coming in Phase B.4"
        className="w-full"
      >
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-2 opacity-50 cursor-not-allowed"
          disabled
          data-testid="button-start-recording"
        >
          <Mic className="w-3.5 h-3.5" />
          {isDone ? "Recording complete" : "Start Recording"}
        </Button>
      </div>

      {!isDone && (
        <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
          Audio capture coming in Phase B.4
        </p>
      )}

      {note.processingError && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-red-500/10 text-red-500 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {note.processingError}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MeetingNotesDetailPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const noteId = Number(params?.id);

  const { data: note, isLoading, isError } = useQuery<MeetingNoteDetail>({
    queryKey: ["/api/meeting-notes", noteId],
    queryFn: () => fetch(`/api/meeting-notes/${noteId}`).then((r) => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
    enabled: !!noteId,
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

            {note.platform && (
              <span className="text-muted-foreground capitalize">{note.platform}</span>
            )}

            {note.durationSeconds ? (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDuration(note.durationSeconds)}
              </span>
            ) : null}

            <span>{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}</span>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="flex gap-4 items-start">

          {/* Main tabs */}
          <div className="flex-1 min-w-0">
            <Tabs defaultValue="summary">
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
                <TabsTrigger value="action-items" className="text-xs gap-1.5" data-testid="tab-action-items">
                  <ListChecks className="w-3 h-3" /> Action Items
                  {note.actionItems.length > 0 && (
                    <span className="ml-0.5 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">
                      {note.actionItems.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="followup" className="text-xs gap-1.5" data-testid="tab-followup">
                  <Send className="w-3 h-3" /> Follow-up
                </TabsTrigger>
              </TabsList>

              {/* ── Summary ──────────────────────────────────────────────── */}
              <TabsContent value="summary" className="mt-3">
                {note.summaryText ? (
                  <div
                    className="text-sm text-foreground whitespace-pre-wrap leading-relaxed"
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
                        <Badge key={p.id} variant="secondary" className="text-xs" data-testid={`badge-participant-${p.id}`}>
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
                  <div className="flex flex-col gap-2" data-testid="list-action-items">
                    {note.actionItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card"
                        data-testid={`card-action-item-${item.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{item.title}</p>
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
                        </div>
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-[10px] ${AI_STATUS_CLASS[item.status] ?? ""}`}
                          data-testid={`status-action-item-${item.id}`}
                        >
                          {item.status.replace("_", " ")}
                        </Badge>
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
                  <div
                    className="text-sm whitespace-pre-wrap leading-relaxed p-3 rounded-lg bg-secondary/30 border border-border/50"
                    data-testid="text-followup-draft"
                  >
                    {note.followupDraftText}
                  </div>
                ) : (
                  <EmptyState icon={Send} message="No follow-up draft yet — one can be generated after processing." />
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Side capture panel */}
          <div className="w-56 shrink-0">
            <CapturePanel note={note} />
          </div>
        </div>
      </div>
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
