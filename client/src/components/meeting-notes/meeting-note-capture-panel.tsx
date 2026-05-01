/**
 * Phase B.4a — Capture Panel component.
 * Handles consent, MediaRecorder lifecycle, chunk upload state, and start/stop.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Mic,
  MicOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { format } from "date-fns";
import { useMeetingRecorder } from "./use-meeting-recorder";

type NoteCapture = {
  id: number;
  status: string;
  consentNoted: boolean;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  processingError: string | null;
};

function fmtSecs(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function MeetingNoteCapturePanel({
  note,
  onRefetch,
}: {
  note: NoteCapture;
  onRefetch: () => void;
}) {
  const { toast } = useToast();
  const [consent, setConsent] = useState(note.consentNoted);

  const isDone = ["done", "cancelled", "error"].includes(note.status);
  const isProcessing = note.status === "processing";

  const {
    isSupported,
    mimeType,
    micState,
    recorderState,
    elapsedSeconds,
    lastChunkAt,
    uploadErrors,
    startRecording,
    stopRecording,
  } = useMeetingRecorder();

  const isActivelyRecording = recorderState === "recording";
  const isStopping =
    recorderState === "stopping" || recorderState === "stopped";

  // ── Mutations ─────────────────────────────────────────────────────────────

  const consentMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/meeting-notes/${note.id}`, {
        consentNoted: true,
      }),
    onSuccess: () => setConsent(true),
    onError: () =>
      toast({ title: "Failed to record consent", variant: "destructive" }),
  });

  const startMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/meeting-notes/${note.id}/start`, {}),
    onSuccess: async () => {
      // MediaRecorder kicks off only after backend confirms status = recording
      await startRecording(note.id);
      await queryClient.invalidateQueries({
        queryKey: ["/api/meeting-notes", note.id],
      });
      onRefetch();
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not start recording",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  const stopMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/meeting-notes/${note.id}/stop`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/meeting-notes", note.id],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/meeting-notes"] });
      onRefetch();
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not stop recording",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleStart() {
    startMutation.mutate();
  }

  function handleStop() {
    stopRecording(note.id, () => stopMutation.mutate());
  }

  const canStart =
    isSupported &&
    !!mimeType &&
    consent &&
    !isDone &&
    !isProcessing &&
    recorderState === "idle" &&
    micState !== "denied" &&
    !startMutation.isPending;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-border/60 bg-card">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Mic className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Capture</span>
        {mimeType && isActivelyRecording && (
          <span className="ml-auto text-[10px] text-muted-foreground font-mono truncate">
            {mimeType.split(";")[0]}
          </span>
        )}
      </div>

      {/* ── Status indicators ── */}

      {/* Browser unsupported */}
      {!isSupported && (
        <div
          className="flex items-center gap-2 text-amber-600 text-xs"
          data-testid="status-browser-unsupported"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          MediaRecorder not supported in this browser
        </div>
      )}

      {/* Mic permission states */}
      {micState === "requesting" && (
        <div
          className="flex items-center gap-2 text-blue-500 text-xs"
          data-testid="status-mic-requesting"
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          Waiting for microphone permission…
        </div>
      )}
      {micState === "denied" && (
        <div
          className="flex items-center gap-2 text-red-500 text-xs"
          data-testid="status-mic-denied"
        >
          <MicOff className="w-3.5 h-3.5 shrink-0" />
          Mic access denied — allow it in browser settings
        </div>
      )}
      {micState === "error" && (
        <div
          className="flex items-center gap-2 text-red-500 text-xs"
          data-testid="status-mic-error"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Microphone error — check device settings
        </div>
      )}

      {/* Live recording timer */}
      {isActivelyRecording && (
        <div
          className="flex items-center gap-2 text-red-500 text-sm font-mono tabular-nums"
          data-testid="status-recording-timer"
        >
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          {fmtSecs(elapsedSeconds)}
        </div>
      )}

      {/* Stopping / flushing */}
      {isStopping && !stopMutation.isPending && (
        <div
          className="flex items-center gap-2 text-muted-foreground text-xs"
          data-testid="status-stopping"
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          Flushing final chunk…
        </div>
      )}

      {/* Processing state from note (post-stop) */}
      {isProcessing && !isActivelyRecording && !isStopping && (
        <div
          className="flex items-center gap-2 text-amber-600 text-sm"
          data-testid="status-processing"
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          Processing transcript…
        </div>
      )}

      {/* Last chunk upload timestamp */}
      {lastChunkAt && isActivelyRecording && (
        <div
          className="flex items-center gap-1.5 text-[11px] text-emerald-600"
          data-testid="status-last-chunk"
        >
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          Chunk {format(lastChunkAt, "h:mm:ss a")}
        </div>
      )}

      {/* Upload error warning */}
      {uploadErrors > 0 && (
        <div
          className="flex items-center gap-1.5 text-[11px] text-amber-600"
          data-testid="status-upload-errors"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          {uploadErrors} chunk{uploadErrors !== 1 ? "s" : ""} failed to upload
        </div>
      )}

      {/* ── Consent checkbox ── */}
      {!isDone && !consent && isSupported && (
        <label
          className="flex items-start gap-2 cursor-pointer select-none"
          data-testid="label-consent"
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              if (e.target.checked) consentMutation.mutate();
            }}
            className="mt-0.5 accent-primary"
            data-testid="checkbox-consent"
            disabled={consentMutation.isPending}
          />
          <span className="text-[11px] text-muted-foreground leading-relaxed">
            All participants have consented to being recorded.
          </span>
        </label>
      )}

      {/* Consent confirmed */}
      {consent && !isDone && isSupported && recorderState === "idle" && (
        <div
          className="flex items-center gap-1.5 text-[11px] text-emerald-600"
          data-testid="status-consent-ok"
        >
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          Consent recorded
        </div>
      )}

      {/* ── Start / Stop button ── */}
      {!isDone && isSupported && !isProcessing && (
        <>
          {isActivelyRecording || isStopping ? (
            <Button
              size="sm"
              variant="destructive"
              className="w-full gap-2"
              onClick={handleStop}
              disabled={isStopping || stopMutation.isPending}
              data-testid="button-stop-recording"
            >
              {isStopping || stopMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <span className="w-2 h-2 rounded bg-white shrink-0" />
              )}
              {isStopping || stopMutation.isPending
                ? "Stopping…"
                : "Stop Recording"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant={canStart ? "default" : "outline"}
              className="w-full gap-2"
              onClick={handleStart}
              disabled={!canStart || startMutation.isPending}
              data-testid="button-start-recording"
              title={
                !consent
                  ? "Check the consent box first"
                  : micState === "denied"
                    ? "Microphone access denied"
                    : !mimeType
                      ? "No supported audio format found"
                      : undefined
              }
            >
              {startMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Mic className="w-3.5 h-3.5" />
              )}
              Start Recording
            </Button>
          )}
        </>
      )}

      {/* ── Done state timestamps ── */}
      {isDone && note.startedAt && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="text-recording-times"
        >
          <Clock className="w-3 h-3 inline mr-1" />
          {format(new Date(note.startedAt), "h:mm a")}
          {note.endedAt
            ? ` – ${format(new Date(note.endedAt), "h:mm a")}`
            : ""}
          {note.durationSeconds
            ? ` · ${fmtSecs(note.durationSeconds)}`
            : ""}
        </p>
      )}

      {/* ── Processing error ── */}
      {note.processingError && (
        <div
          className="flex items-start gap-2 p-2 rounded-md bg-red-500/10 text-red-500 text-xs"
          data-testid="text-processing-error"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {note.processingError}
        </div>
      )}
    </div>
  );
}
