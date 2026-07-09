import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import { useTimezone, getDateGroupLabelInTz } from "@/lib/timezone";
import {
  Mic, Plus, CalendarClock, Mail, Upload, Hash, AlertCircle,
  Loader2, Video, Phone, Users,
} from "lucide-react";
import { ToastAction } from "@/components/ui/toast";

type MeetingNoteSummary = {
  id: number;
  uuid: string;
  title: string | null;
  status: string;
  source: string;
  platform: string | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  calendarEventTitle: string | null;
  calendarEventStartTime: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  scheduled_prompted: "Scheduled",
  recording:          "Recording",
  processing:         "Processing",
  completed:          "Completed",
  done:               "Done",
  failed:             "Failed",
  error:              "Error",
  cancelled:          "Cancelled",
};

const STATUS_CLASS: Record<string, string> = {
  scheduled_prompted: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  recording:          "bg-red-500/10 text-red-500 border-red-500/20",
  processing:         "bg-amber-500/10 text-amber-600 border-amber-500/20",
  completed:          "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  done:               "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  failed:             "bg-red-500/10 text-red-500 border-red-500/20",
  error:              "bg-red-500/10 text-red-500 border-red-500/20",
  cancelled:          "bg-muted text-muted-foreground border-border",
};

const SOURCE_LABEL: Record<string, string> = {
  calendar: "Calendar",
  mail:     "Email",
  adhoc:    "Ad-hoc",
  upload:   "Upload",
};

const SOURCE_ICON: Record<string, React.ElementType> = {
  calendar: CalendarClock,
  mail:     Mail,
  adhoc:    Hash,
  upload:   Upload,
};

const PLATFORM_LABEL: Record<string, string> = {
  zoom:      "Zoom",
  teams:     "Teams",
  meet:      "Meet",
  phone:     "Phone",
  in_person: "In Person",
  other:     "Meeting",
};

function PlatformIcon({ platform }: { platform: string | null }) {
  if (!platform) return null;
  if (platform === "phone") return <Phone className="w-3 h-3 shrink-0" />;
  if (platform === "in_person") return <Users className="w-3 h-3 shrink-0" />;
  return <Video className="w-3 h-3 shrink-0" />;
}

function formatDuration(secs: number | null): string {
  if (!secs) return "";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function getDisplayDate(note: MeetingNoteSummary): Date {
  if (note.calendarEventStartTime) return new Date(note.calendarEventStartTime);
  return new Date(note.createdAt);
}

function groupNotes(notes: MeetingNoteSummary[], timezone: string): Array<{ label: string; items: MeetingNoteSummary[] }> {
  const order: string[] = [];
  const map = new Map<string, MeetingNoteSummary[]>();
  for (const note of notes) {
    const date = getDisplayDate(note);
    const label = getDateGroupLabelInTz(date, timezone);
    if (!map.has(label)) { order.push(label); map.set(label, []); }
    map.get(label)!.push(note);
  }
  return order.map((label) => ({ label, items: map.get(label)! }));
}

const PAGE_SIZE = 20;

export default function MeetingNotesList() {
  const { timezone } = useTimezone();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data: notes = [], isLoading, isError } = useQuery<MeetingNoteSummary[]>({
    queryKey: ["/api/meeting-notes"],
    refetchInterval: (query) => {
      const data = query.state.data as MeetingNoteSummary[] | undefined;
      return data?.some((n) => n.status === "processing" || n.status === "recording") ? 3000 : false;
    },
  });

  const prevNoteStatusesRef = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    const prev = prevNoteStatusesRef.current;
    notes.forEach((note) => {
      const prevStatus = prev.get(note.id);
      if (prevStatus === "processing" && note.status === "completed") {
        const noteId = note.id;
        const noteTitle = note.title || note.calendarEventTitle || "Meeting";
        toast({
          title: `"${noteTitle}" is ready`,
          description: "AI processing complete — open to review insights.",
          action: (
            <ToastAction altText="Open meeting note" onClick={() => navigate(`/meeting-notes/${noteId}`)}>
              Open
            </ToastAction>
          ),
        });
      }
      prev.set(note.id, note.status);
    });
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/meeting-notes", { source: "adhoc" }),
    onSuccess: async (res) => {
      const note = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/meeting-notes"] });
      navigate(`/meeting-notes/${note.id}`);
    },
    onError: () => {
      toast({ title: "Failed to create meeting note", variant: "destructive" });
    },
  });

  const visible = notes.slice(0, visibleCount);
  const hasMore = notes.length > visibleCount;
  const groups = groupNotes(visible, timezone);

  return (
    <div className="flex flex-col gap-4" data-testid="meeting-notes-list">
      {/* Section header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Mic className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold leading-tight" data-testid="heading-meeting-notes-section">
              Meetings & Recorder
            </h2>
            <p className="text-xs text-muted-foreground">Capture, transcribe and follow up on meetings</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          data-testid="button-new-meeting-note-calendar"
        >
          {createMutation.isPending
            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            : <Plus className="w-3.5 h-3.5 mr-1.5" />}
          New Meeting Note
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
          <AlertCircle className="w-4 h-4" />
          <span>Failed to load meeting notes</span>
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
            <Mic className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No meeting notes yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create your first note or start one from a calendar event.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            data-testid="button-new-meeting-note-empty-calendar"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Meeting Note
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(({ label, items }) => (
            <div key={label} className="flex flex-col gap-1">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide px-1 pb-0.5">
                {label}
              </p>
              <div className="flex flex-col gap-1">
                {items.map((note) => {
                  const SrcIcon = SOURCE_ICON[note.source] ?? Hash;
                  const isProcessing = note.status === "processing";
                  const isRecording = note.status === "recording";
                  const displayTitle = note.title
                    || note.calendarEventTitle
                    || (note.source === "calendar" ? "Calendar Meeting" : "Untitled Meeting");

                  const displayDate = getDisplayDate(note);
                  const subtitleParts: string[] = [];

                  if (note.source === "calendar" && note.calendarEventStartTime) {
                    subtitleParts.push(format(displayDate, "h:mm a"));
                  }
                  if (note.platform && PLATFORM_LABEL[note.platform]) {
                    subtitleParts.push(PLATFORM_LABEL[note.platform]);
                  } else {
                    subtitleParts.push(SOURCE_LABEL[note.source] ?? note.source);
                  }
                  if (note.durationSeconds) {
                    subtitleParts.push(formatDuration(note.durationSeconds));
                  }
                  if (!note.calendarEventStartTime) {
                    subtitleParts.push(formatDistanceToNow(new Date(note.createdAt), { addSuffix: true }));
                  }

                  return (
                    <button
                      key={note.id}
                      onClick={() => navigate(`/meeting-notes/${note.id}`)}
                      data-testid={`row-meeting-note-cal-${note.id}`}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border/50 bg-card hover:bg-secondary/40 hover:border-border transition-all text-left"
                    >
                      <div className="w-8 h-8 rounded-md bg-primary/8 flex items-center justify-center shrink-0">
                        {isRecording ? (
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                        ) : isProcessing ? (
                          <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                        ) : note.platform ? (
                          <PlatformIcon platform={note.platform} />
                        ) : (
                          <SrcIcon className="w-4 h-4 text-primary/70" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-sm font-medium truncate text-foreground">
                            {displayTitle}
                          </p>
                          {note.platform && (
                            <span
                              className={`text-[10px] shrink-0 font-medium ${
                                note.platform === "zoom"      ? "text-[#2D8CFF]" :
                                note.platform === "teams"     ? "text-[#6264A7]" :
                                note.platform === "meet"      ? "text-emerald-500" :
                                note.platform === "phone"     ? "text-orange-500" :
                                "text-muted-foreground"
                              }`}
                            >
                              {PLATFORM_LABEL[note.platform]}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {subtitleParts.join(" · ")}
                        </p>
                      </div>

                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${STATUS_CLASS[note.status] ?? "bg-muted text-muted-foreground"}`}
                      >
                        {STATUS_LABEL[note.status] ?? note.status}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8 gap-1.5"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                data-testid="button-load-more-notes-calendar"
              >
                <Plus className="w-3 h-3" />
                Load more ({notes.length - visibleCount} remaining)
              </Button>
            </div>
          )}

          {!hasMore && notes.length > PAGE_SIZE && (
            <p className="text-center text-xs text-muted-foreground py-2">
              Showing all {notes.length} notes
            </p>
          )}
        </div>
      )}
    </div>
  );
}
