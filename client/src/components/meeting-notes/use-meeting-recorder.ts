/**
 * Phase B.4a — browser MediaRecorder hook.
 * Handles mic permission, timesliced chunk upload, retry queue, and timer.
 * No Whisper / transcription yet (Phase B.4b+).
 */

import { useRef, useState, useCallback, useEffect } from "react";

// MIME type preference: most compatible first
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // Some browsers throw on unrecognised types — ignore
    }
  }
  return null;
}

export type MicPermState =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "error";

export type RecorderState = "idle" | "recording" | "stopping" | "stopped";

export interface MeetingRecorderReturn {
  isSupported: boolean;
  mimeType: string | null;
  micState: MicPermState;
  recorderState: RecorderState;
  elapsedSeconds: number;
  lastChunkAt: Date | null;
  uploadErrors: number;
  startRecording: (noteId: number) => Promise<void>;
  stopRecording: (noteId: number, onStopped: () => void) => void;
}

interface ChunkJob {
  noteId: number;
  sequenceNo: number;
  blob: Blob;
  mimeType: string;
  retries: number;
}

export function useMeetingRecorder(): MeetingRecorderReturn {
  const isSupported = typeof MediaRecorder !== "undefined";
  // Computed once — stable across renders
  const mimeType = pickMimeType();

  const [micState, setMicState] = useState<MicPermState>("idle");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastChunkAt, setLastChunkAt] = useState<Date | null>(null);
  const [uploadErrors, setUploadErrors] = useState(0);

  // Refs so event-handler closures always see the latest values
  const recorderStateRef = useRef<RecorderState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkSeqRef = useRef(0);
  const uploadQueueRef = useRef<ChunkJob[]>([]);
  const uploadingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const onStoppedRef = useRef<(() => void) | null>(null);

  // Keep ref in sync so onstop closures read the right state
  function setRS(s: RecorderState) {
    recorderStateRef.current = s;
    setRecorderState(s);
  }

  // Clean up mic tracks on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const startRecording = useCallback(
    async (noteId: number) => {
      if (!isSupported || !mimeType) return;
      if (recorderStateRef.current === "recording") return; // prevent double-start

      chunkSeqRef.current = 0;
      uploadQueueRef.current = [];
      uploadingRef.current = false;
      setUploadErrors(0);
      setLastChunkAt(null);
      setMicState("requesting");

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        setMicState("granted");
      } catch (err: unknown) {
        const name = (err as { name?: string })?.name ?? "";
        const isDenied =
          name === "NotAllowedError" || name === "PermissionDeniedError";
        setMicState(isDenied ? "denied" : "error");
        return;
      }

      streamRef.current = stream;

      // ── Chunk upload helpers (close over noteId / mimeType / stream) ──────

      async function uploadChunk(job: ChunkJob): Promise<boolean> {
        try {
          const res = await fetch(
            `/api/meeting-notes/${job.noteId}/audio-chunk`,
            {
              method: "POST",
              headers: {
                "Content-Type": job.mimeType,
                "X-Sequence-No": String(job.sequenceNo),
              },
              body: job.blob,
              credentials: "include",
            },
          );
          return res.status === 202;
        } catch {
          return false;
        }
      }

      async function drainQueue() {
        if (uploadingRef.current) return;
        uploadingRef.current = true;
        while (uploadQueueRef.current.length > 0) {
          const job = uploadQueueRef.current[0];
          const ok = await uploadChunk(job);
          if (ok) {
            uploadQueueRef.current.shift();
            setLastChunkAt(new Date());
          } else if (job.retries < 1) {
            // One retry — leave at front of queue
            job.retries++;
          } else {
            // Give up — drop and record error
            uploadQueueRef.current.shift();
            setUploadErrors((n) => n + 1);
          }
        }
        uploadingRef.current = false;
      }

      function enqueueChunk(blob: Blob) {
        uploadQueueRef.current.push({
          noteId,
          sequenceNo: chunkSeqRef.current++,
          blob,
          mimeType: mimeType!,
          retries: 0,
        });
        drainQueue();
      }

      // ── MediaRecorder setup ───────────────────────────────────────────────

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          enqueueChunk(e.data);
        }
      };

      recorder.onstop = async () => {
        // Stop tracks and clear refs
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setRS("stopped");
        // Drain any final chunks before calling the stop callback
        await drainQueue();
        onStoppedRef.current?.();
        onStoppedRef.current = null;
      };

      // Start with 3-second timeslices
      recorder.start(3000);
      setRS("recording");
      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        if (startTimeRef.current !== null) {
          setElapsedSeconds(
            Math.floor((Date.now() - startTimeRef.current) / 1000),
          );
        }
      }, 1000);
    },
    [isSupported, mimeType],
  );

  const stopRecording = useCallback(
    (_noteId: number, onStopped: () => void) => {
      if (recorderStateRef.current !== "recording") return;
      if (!mediaRecorderRef.current) return;

      onStoppedRef.current = onStopped;
      setRS("stopping");

      try {
        mediaRecorderRef.current.requestData(); // flush final partial chunk
        mediaRecorderRef.current.stop();
      } catch {
        // Recorder may have already stopped — onstop will still fire
      }
    },
    [],
  );

  return {
    isSupported,
    mimeType,
    micState,
    recorderState,
    elapsedSeconds,
    lastChunkAt,
    uploadErrors,
    startRecording,
    stopRecording,
  };
}
