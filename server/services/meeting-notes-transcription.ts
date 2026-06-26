/**
 * Phase B.4c — OpenAI audio transcription with long-audio chunk splitting.
 *
 * Configurable limits (env vars):
 *   MEETING_AUDIO_MAX_MB  — hard ceiling on accepted audio size (default 500 MB)
 *   MEETING_AUDIO_CHUNK_MB — target size per transcription chunk (default 20 MB)
 *
 * Flow for small files (≤ CHUNK_MB):
 *   1. Read audio.webm → convert format via ffmpeg if needed
 *   2. Single OpenAI transcription call
 *   3. Persist transcript → run AI summary (Phase B.5)
 *
 * Flow for large files (CHUNK_MB < size ≤ MAX_MB):
 *   1. Use ffprobe to get duration, calculate segment time
 *   2. Split into N segments with ffmpeg -f segment -c copy
 *   3. Insert rows into meeting_note_audio_splits (status: pending)
 *   4. Transcribe each segment sequentially; update status per segment
 *   5. Merge transcripts in split_index order
 *   6. Persist merged transcript → run AI summary
 *
 * Retry / resume:
 *   On re-entry (e.g. "Retry Analysis"), existing splits with status='done' are
 *   skipped. Only pending/failed/transcribing splits are re-attempted.
 *   If the audio file is gone but all splits are done, merges and proceeds to AI.
 */

import OpenAI, { toFile } from "openai";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { db } from "../db";
import {
  meetingNotes,
  meetingNoteTranscriptChunks,
  meetingNoteAudioSplits,
} from "@shared/schema";
import { eq, asc } from "drizzle-orm";
import {
  audioFilePath,
  audioNoteDir,
  cleanupAudioFile,
} from "./meeting-notes-audio";
import { ensureCompatibleFormat } from "../replit_integrations/audio/client";
import { processWithAI } from "./meeting-notes-ai";

// ── Configurable limits ────────────────────────────────────────────────────

const MAX_AUDIO_MB    = parseInt(process.env.MEETING_AUDIO_MAX_MB   ?? "500", 10);
const CHUNK_MB        = parseInt(process.env.MEETING_AUDIO_CHUNK_MB ?? "20",  10);
const MAX_AUDIO_BYTES = MAX_AUDIO_MB * 1024 * 1024;
const CHUNK_BYTES     = CHUNK_MB     * 1024 * 1024;

// ── OpenAI client ──────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI | null {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// ── Transcript shape ───────────────────────────────────────────────────────

interface VerboseSegment {
  id?: number;
  start?: number;
  end?: number;
  text?: string;
}

interface VerboseTranscription {
  text: string;
  segments?: VerboseSegment[];
}

// ── Transcription helpers ─────────────────────────────────────────────────

const MIME_TYPES: Record<"wav" | "mp3" | "webm", string> = {
  wav:  "audio/wav",
  mp3:  "audio/mpeg",
  webm: "audio/webm",
};

async function tryTranscribe(
  client: OpenAI,
  audioBuffer: Buffer,
  format: "wav" | "mp3" | "webm",
  model: string,
  useVerbose: boolean,
): Promise<VerboseTranscription | null> {
  try {
    const mimeType = MIME_TYPES[format] ?? "audio/webm";
    const file = await toFile(audioBuffer, `audio.${format}`, { type: mimeType });

    if (useVerbose) {
      const resp = await client.audio.transcriptions.create({
        model,
        file,
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      } as Parameters<typeof client.audio.transcriptions.create>[0]);
      return resp as unknown as VerboseTranscription;
    } else {
      const text = await client.audio.transcriptions.create({
        model,
        file,
        response_format: "text",
      } as Parameters<typeof client.audio.transcriptions.create>[0]) as unknown as string;
      return { text: String(text) };
    }
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    console.warn(`[transcription] ${model}${useVerbose ? " verbose_json" : ""} failed: ${msg}`);
    return null;
  }
}

const TRANSCRIBE_ATTEMPTS: Array<{ model: string; verbose: boolean }> = [
  { model: "gpt-4o-mini-transcribe", verbose: false },
  { model: "whisper-1",              verbose: true  },
  { model: "whisper-1",              verbose: false },
];

async function transcribeBuffer(
  client: OpenAI,
  audioBuffer: Buffer,
  format: "wav" | "mp3" | "webm",
  label: string,
): Promise<VerboseTranscription | null> {
  for (const { model, verbose } of TRANSCRIBE_ATTEMPTS) {
    const result = await tryTranscribe(client, audioBuffer, format, model, verbose);
    if (result) {
      console.log(
        `[transcription] ${label} succeeded — ` +
        `model=${model} verbose=${verbose} chars=${result.text.length}`,
      );
      return result;
    }
  }
  return null;
}

// ── FFmpeg helpers ────────────────────────────────────────────────────────

function execAsync(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as Error & { stderr?: string };
        e.stderr = stderr;
        reject(e);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function getAudioDurationSeconds(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
    );
    const d = parseFloat(stdout.trim());
    if (!isNaN(d) && d > 0) return d;
  } catch {
    // fall through to estimate
  }
  return 0;
}

async function splitAudioFile(
  noteId: number,
  filePath: string,
  totalBytes: number,
): Promise<string[]> {
  const totalDuration = await getAudioDurationSeconds(filePath);

  let segmentSecs: number;
  if (totalDuration > 0) {
    const ratio = CHUNK_BYTES / totalBytes;
    segmentSecs = Math.floor(totalDuration * ratio * 0.9);
    segmentSecs = Math.max(segmentSecs, 30);
  } else {
    segmentSecs = 1200;
  }

  const splitsDir = path.join(audioNoteDir(noteId), "splits");
  await fs.mkdir(splitsDir, { recursive: true });

  const outputPattern = path.join(splitsDir, "split_%04d.webm");

  console.log(
    `[transcription] splitting noteId=${noteId} ` +
    `totalBytes=${totalBytes} duration=${totalDuration.toFixed(1)}s ` +
    `segmentSecs=${segmentSecs}`,
  );

  await execAsync(
    `ffmpeg -i "${filePath}" -f segment -segment_time ${segmentSecs} ` +
    `-c copy "${outputPattern}" -y -loglevel error`,
  );

  const files = (await fs.readdir(splitsDir))
    .filter((f) => f.startsWith("split_") && f.endsWith(".webm"))
    .sort();

  if (files.length === 0) throw new Error("ffmpeg produced no split files");

  console.log(`[transcription] noteId=${noteId} split into ${files.length} chunks`);
  return files.map((f) => path.join(splitsDir, f));
}

// ── DB helpers ────────────────────────────────────────────────────────────

async function updateStep(noteId: number, step: string): Promise<void> {
  try {
    await db
      .update(meetingNotes)
      .set({ processingStepText: step, updatedAt: new Date() })
      .where(eq(meetingNotes.id, noteId));
    console.log(`[transcription] noteId=${noteId} step: ${step}`);
  } catch {
    // Non-fatal; polling UI will still show last status
  }
}

async function markError(noteId: number, error: string): Promise<void> {
  console.error(`[transcription] noteId=${noteId} error: ${error}`);
  try {
    await db
      .update(meetingNotes)
      .set({
        status:             "failed",
        processingError:    error,
        processingStepText: null,
        updatedAt:          new Date(),
      })
      .where(eq(meetingNotes.id, noteId));
  } catch (dbErr: unknown) {
    console.error(
      `[transcription] noteId=${noteId} failed to write error: ${(dbErr as Error).message}`,
    );
  }
}

async function getExistingSplits(noteId: number) {
  return db
    .select()
    .from(meetingNoteAudioSplits)
    .where(eq(meetingNoteAudioSplits.meetingNoteId, noteId))
    .orderBy(asc(meetingNoteAudioSplits.splitIndex));
}

async function updateSplitStatus(
  splitId: number,
  status: string,
  transcriptText: string | null = null,
  errorMessage: string | null = null,
): Promise<void> {
  await db
    .update(meetingNoteAudioSplits)
    .set({ status, transcriptText, errorMessage, updatedAt: new Date() })
    .where(eq(meetingNoteAudioSplits.id, splitId));
}

// ── Persist transcript + chain AI ─────────────────────────────────────────

async function persistTranscriptAndRunAI(
  noteId: number,
  mergedText: string,
  verboseSegments: VerboseSegment[],
  partialWarning: string | null,
): Promise<void> {
  await db
    .update(meetingNotes)
    .set({ rawTranscriptText: mergedText, processingError: null, updatedAt: new Date() })
    .where(eq(meetingNotes.id, noteId));

  await db
    .delete(meetingNoteTranscriptChunks)
    .where(eq(meetingNoteTranscriptChunks.meetingNoteId, noteId));

  if (verboseSegments.length > 0) {
    await db.insert(meetingNoteTranscriptChunks).values(
      verboseSegments.map((seg, idx) => ({
        meetingNoteId: noteId,
        sequenceNo:    idx,
        speakerLabel:  null as string | null,
        startMs:       seg.start != null ? Math.round(seg.start * 1000) : (null as number | null),
        endMs:         seg.end   != null ? Math.round(seg.end   * 1000) : (null as number | null),
        text:          (seg.text ?? "").trim(),
        isFinal:       true,
      })),
    );
  } else if (mergedText.trim()) {
    await db.insert(meetingNoteTranscriptChunks).values([{
      meetingNoteId: noteId,
      sequenceNo:    0,
      speakerLabel:  null as string | null,
      startMs:       null as number | null,
      endMs:         null as number | null,
      text:          mergedText.trim(),
      isFinal:       true,
    }]);
  }

  console.log(`[transcription] noteId=${noteId} transcript persisted — chars=${mergedText.length}`);

  await cleanupAudioFile(noteId);

  await updateStep(noteId, "Generating summary…");
  await processWithAI(noteId);

  if (partialWarning) {
    try {
      await db
        .update(meetingNotes)
        .set({ processingError: partialWarning })
        .where(eq(meetingNotes.id, noteId));
    } catch { /* non-fatal */ }
  }
}

// ── Direct path: single-file transcription (no splitting needed) ──────────

async function transcribeDirect(
  noteId: number,
  filePath: string,
  client: OpenAI,
): Promise<void> {
  await updateStep(noteId, "Converting audio format…");

  let audioBuffer: Buffer;
  let format: "wav" | "mp3" | "webm";

  try {
    const raw = await fs.readFile(filePath);
    const converted = await ensureCompatibleFormat(raw);
    audioBuffer = converted.buffer;
    format = converted.format;
  } catch (err: unknown) {
    await markError(
      noteId,
      `Audio conversion failed: ${(err as Error).message}. ` +
      "Check that ffmpeg is available on the server.",
    );
    return;
  }

  await updateStep(noteId, "Transcribing audio…");

  const result = await transcribeBuffer(client, audioBuffer, format, `noteId=${noteId}`);
  if (!result) {
    await markError(noteId, "All transcription attempts failed. Check server logs for details.");
    return;
  }

  await updateStep(noteId, "Saving transcript…");
  await persistTranscriptAndRunAI(noteId, result.text, result.segments ?? [], null);
}

// ── Split path: ffmpeg split → per-chunk transcription → merge ────────────

async function transcribeWithSplits(
  noteId: number,
  filePath: string,
  totalBytes: number,
  client: OpenAI,
): Promise<void> {
  let existingSplits = await getExistingSplits(noteId);

  if (existingSplits.length === 0) {
    await updateStep(noteId, "Splitting audio into chunks…");

    let splitPaths: string[];
    try {
      splitPaths = await splitAudioFile(noteId, filePath, totalBytes);
    } catch (err: unknown) {
      await markError(
        noteId,
        `Audio splitting failed: ${(err as Error).message}. Check ffmpeg is installed.`,
      );
      return;
    }

    await db.insert(meetingNoteAudioSplits).values(
      splitPaths.map((p, i) => ({
        meetingNoteId: noteId,
        splitIndex:    i,
        filePath:      p,
        status:        "pending",
      })),
    );
    existingSplits = await getExistingSplits(noteId);
  }

  const totalSplits = existingSplits.length;

  for (const split of existingSplits) {
    if (split.status === "done") continue;

    await updateStep(
      noteId,
      `Transcribing chunk ${split.splitIndex + 1} of ${totalSplits}…`,
    );
    await updateSplitStatus(split.id, "transcribing");

    const splitPath = split.filePath;
    if (!splitPath) {
      await updateSplitStatus(split.id, "failed", null, "Split file path missing from DB");
      continue;
    }

    try {
      await fs.access(splitPath);
    } catch {
      await updateSplitStatus(
        split.id, "failed", null,
        "Split file no longer on disk — container may have been restarted",
      );
      continue;
    }

    try {
      const raw = await fs.readFile(splitPath);
      const { buffer: audioBuffer, format } = await ensureCompatibleFormat(raw);
      const result = await transcribeBuffer(
        client, audioBuffer, format,
        `noteId=${noteId} chunk=${split.splitIndex + 1}/${totalSplits}`,
      );
      if (!result) {
        await updateSplitStatus(
          split.id, "failed", null, "All transcription attempts failed for this chunk",
        );
      } else {
        await updateSplitStatus(split.id, "done", result.text, null);
      }
    } catch (err: unknown) {
      await updateSplitStatus(split.id, "failed", null, (err as Error).message);
    }
  }

  const finalSplits  = await getExistingSplits(noteId);
  const doneSplits   = finalSplits.filter((s) => s.status === "done");
  const failedSplits = finalSplits.filter((s) => s.status !== "done");

  if (doneSplits.length === 0) {
    await markError(
      noteId,
      `All ${totalSplits} audio chunk${totalSplits === 1 ? "" : "s"} failed to transcribe. ` +
      "Use Retry Analysis to attempt again, or re-record the meeting.",
    );
    return;
  }

  await updateStep(noteId, "Merging transcript…");

  const mergedText = finalSplits
    .filter((s) => s.transcriptText)
    .map((s) => s.transcriptText!)
    .join("\n\n");

  const partialWarning = failedSplits.length > 0
    ? `${failedSplits.length} of ${totalSplits} audio chunk${failedSplits.length === 1 ? "" : "s"} ` +
      "could not be transcribed — transcript may be incomplete. " +
      "Use Retry Analysis to re-attempt the failed chunks."
    : null;

  await updateStep(noteId, "Saving transcript…");
  await persistTranscriptAndRunAI(noteId, mergedText, [], partialWarning);
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Transcribe the audio file for a meeting note and persist results.
 * This function NEVER throws — all errors are stored in processing_error.
 */
export async function transcribeMeetingNote(noteId: number): Promise<void> {
  const client = buildOpenAIClient();
  if (!client) {
    await markError(
      noteId,
      "OpenAI API key not configured — transcription unavailable. " +
      "Set AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY to enable.",
    );
    return;
  }

  const filePath = audioFilePath(noteId);

  let fileStat: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    fileStat = await fs.stat(filePath);
  } catch {
    // Audio file missing — check for existing splits to enable recovery
    const existing = await getExistingSplits(noteId);
    if (existing.length > 0) {
      const doneSplits   = existing.filter((s) => s.status === "done");
      const failedSplits = existing.filter((s) => s.status !== "done");

      if (doneSplits.length > 0) {
        const allDone = failedSplits.length === 0;
        await updateStep(
          noteId,
          allDone
            ? "Merging transcript from completed chunks…"
            : "Merging available chunks (some failed)…",
        );
        const mergedText = doneSplits
          .map((s) => s.transcriptText!)
          .join("\n\n");
        const partialWarning = !allDone
          ? `${failedSplits.length} of ${existing.length} audio chunk${failedSplits.length === 1 ? "" : "s"} ` +
            "could not be recovered (audio file no longer available). Transcript may be incomplete."
          : null;
        await persistTranscriptAndRunAI(noteId, mergedText, [], partialWarning);
        return;
      }

      await markError(
        noteId,
        "Audio file no longer available and no chunks were successfully transcribed. " +
        "The recording cannot be recovered — please re-record the meeting.",
      );
      return;
    }

    await markError(
      noteId,
      "Audio file not found — the recording may not have been saved, " +
      "or the server was restarted between recording and processing. " +
      "Ensure the recording completes before stopping.",
    );
    return;
  }

  if (fileStat.size === 0) {
    await markError(noteId, "Audio file is empty — no audio data was recorded.");
    return;
  }

  if (fileStat.size > MAX_AUDIO_BYTES) {
    await markError(
      noteId,
      `Audio file too large: ${(fileStat.size / 1_000_000).toFixed(1)} MB exceeds the ` +
      `${MAX_AUDIO_MB} MB limit. Shorten the recording, or increase MEETING_AUDIO_MAX_MB.`,
    );
    return;
  }

  if (fileStat.size <= CHUNK_BYTES) {
    await transcribeDirect(noteId, filePath, client);
  } else {
    await transcribeWithSplits(noteId, filePath, fileStat.size, client);
  }
}
