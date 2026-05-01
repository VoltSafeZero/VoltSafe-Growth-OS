import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Mic, Plus, CalendarClock, Mail, Upload, Hash, AlertCircle } from "lucide-react";

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
};

const STATUS_LABEL: Record<string, string> = {
  scheduled_prompted: "Scheduled",
  recording: "Recording",
  processing: "Processing",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<string, string> = {
  scheduled_prompted: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  recording:          "bg-red-500/10 text-red-500 border-red-500/20",
  processing:         "bg-amber-500/10 text-amber-600 border-amber-500/20",
  done:               "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
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

function formatDuration(secs: number | null): string {
  if (!secs) return "";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

export default function MeetingNotesIndexPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: notes = [], isLoading, isError } = useQuery<MeetingNoteSummary[]>({
    queryKey: ["/api/meeting-notes"],
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/meeting-notes", { source: "adhoc", title: "New Meeting Note" }),
    onSuccess: async (res) => {
      const note = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/meeting-notes"] });
      navigate(`/meeting-notes/${note.id}`);
    },
    onError: () => {
      toast({ title: "Failed to create meeting note", variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto bg-background">
      <div className="max-w-3xl w-full mx-auto px-4 py-6 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Mic className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight" data-testid="heading-meeting-notes">
                Meeting Notes
              </h1>
              <p className="text-xs text-muted-foreground">Capture, transcribe and follow up on meetings</p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            data-testid="button-new-meeting-note"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
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
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
              <Mic className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No meeting notes yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Create your first note to start capturing meetings.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              data-testid="button-new-meeting-note-empty"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New Meeting Note
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {notes.map((note) => {
              const SrcIcon = SOURCE_ICON[note.source] ?? Hash;
              return (
                <button
                  key={note.id}
                  onClick={() => navigate(`/meeting-notes/${note.id}`)}
                  data-testid={`row-meeting-note-${note.id}`}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border/50 bg-card hover:bg-secondary/40 hover:border-border transition-all text-left"
                >
                  <div className="w-8 h-8 rounded-md bg-primary/8 flex items-center justify-center shrink-0">
                    <SrcIcon className="w-4 h-4 text-primary/70" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-medium truncate text-foreground"
                      data-testid={`text-meeting-note-title-${note.id}`}
                    >
                      {note.title || "Untitled Meeting"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {SOURCE_LABEL[note.source] ?? note.source}
                      {note.durationSeconds ? ` · ${formatDuration(note.durationSeconds)}` : ""}
                      {" · "}
                      {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
                    </p>
                  </div>

                  <Badge
                    variant="outline"
                    className={`text-[10px] shrink-0 ${STATUS_CLASS[note.status] ?? "bg-muted text-muted-foreground"}`}
                    data-testid={`status-meeting-note-${note.id}`}
                  >
                    {STATUS_LABEL[note.status] ?? note.status}
                  </Badge>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
