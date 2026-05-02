/**
 * Phase B.4b — OpenAI audio transcription for meeting notes.
 *
 * Flow:
 *   1. Read audio file from /tmp/voltsafe-meeting-notes/<id>/audio.webm
 *   2. Convert to WAV via ffmpeg if needed (handles WebM/Opus, MP4, OGG)
 *   3. Call OpenAI transcription API:
 *        - Try: gpt-4o-mini-transcribe with verbose_json (segments + timestamps)
 *        - Fallback: gpt-4o-mini-transcribe plain text
 *        - Fallback: whisper-1 with verbose_json
 *        - Fallback: whisper-1 plain text
 *   4. Store raw_transcript_text + transcript chunk rows in DB
 *   5. Note stays in "processing" status (AI summary wired in Phase B.5)
 *
 * Called asynchronously (fire-and-forget) from the /stop and /process routes.
 * Errors are stored in processing_error — they never crash the request.
 */

import OpenAI, { toFile } from "openai";
import fs from "fs/promises";
import { db } from "../db";
import { meetingNotes, meetingNoteTranscriptChunks } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  audioFilePath,
  audioNoteDir,
  cleanupAudioFile,
} from "./meeting-notes-audio";
import { ensureCompatibleFormat } from "../replit_integrations/audio/client";
import { processWithAI } from "./meeting-notes-ai";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB hard limit

// ── OpenAI client ─────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI | null {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY;

  if (!apiKey) return null;

  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// ── Segment shape returned by verbose_json ────────────────────────────────

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

// ── Core transcription logic ───────────────────────────────────────────────

/**
 * Attempt a single transcription call. Returns null on failure instead of throwing
 * so the caller can try the next fallback.
 */
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
      // Use `as any` to bypass SDK typings — the Replit AI integration proxy
      // passes verbose_json through for both whisper-1 and gpt-4o-mini-transcribe
      const response = await (client.audio.transcriptions.create as (opts: Record<string, unknown>) => Promise<VerboseTranscription>)({
        file,
        model,
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      });
      return response;
    } else {
      const response = await client.audio.transcriptions.create({
        file,
        model: model as Parameters<typeof client.audio.transcriptions.create>[0]["model"],
      });
      return { text: response.text };
    }
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    console.warn(
      `[transcription] ${model}${useVerbose ? " verbose_json" : ""} failed: ${msg}`,
    );
    return null;
  }
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

  // ── Pre-flight checks ────────────────────────────────────────────────────

  let fileStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    fileStat = await fs.stat(filePath);
  } catch {
    await markError(
      noteId,
      "Audio file not found — chunks may not have been received. " +
        "Ensure the recording completed before stopping.",
    );
    return;
  }

  if (fileStat.size === 0) {
    await markError(
      noteId,
      "Audio file is empty — no audio data was recorded.",
    );
    return;
  }

  if (fileStat.size > MAX_AUDIO_BYTES) {
    await markError(
      noteId,
      `Audio file too large: ${(fileStat.size / 1_000_000).toFixed(1)} MB ` +
        `exceeds the 25 MB limit. Long-audio chunk splitting is planned for Phase B.4c.`,
    );
    return;
  }

  // ── Convert audio ────────────────────────────────────────────────────────

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

  // ── Transcription with fallback chain ────────────────────────────────────
  //
  // Note: gpt-4o-mini-transcribe does NOT support verbose_json (only json/text).
  // 1. gpt-4o-mini-transcribe + plain text    (primary model, fast)
  // 2. whisper-1              + verbose_json  (segments + timestamps)
  // 3. whisper-1              + plain text    (last resort)

  let result: VerboseTranscription | null = null;

  const attempts: Array<{ model: string; verbose: boolean }> = [
    { model: "gpt-4o-mini-transcribe", verbose: false },
    { model: "whisper-1",              verbose: true },
    { model: "whisper-1",              verbose: false },
  ];

  for (const { model, verbose } of attempts) {
    result = await tryTranscribe(client, audioBuffer, format, model, verbose);
    if (result) {
      console.log(
        `[transcription] noteId=${noteId} succeeded — ` +
          `model=${model} verbose=${verbose} ` +
          `chars=${result.text.length} segments=${result.segments?.length ?? 0}`,
      );
      break;
    }
  }

  if (!result) {
    await markError(
      noteId,
      "All transcription attempts failed. " +
        "Check server logs for details from each fallback.",
    );
    return;
  }

  // ── Persist results ──────────────────────────────────────────────────────

  try {
    // Update note with raw transcript (keep status = "processing" for B.5 AI pipeline)
    await db
      .update(meetingNotes)
      .set({
        rawTranscriptText: result.text,
        processingError:   null,
        updatedAt:         new Date(),
      })
      .where(eq(meetingNotes.id, noteId));

    // Clear any previous transcript chunks
    await db
      .delete(meetingNoteTranscriptChunks)
      .where(eq(meetingNoteTranscriptChunks.meetingNoteId, noteId));

    // Insert new chunks
    const segments = result.segments;
    if (segments && segments.length > 0) {
      const rows = segments.map((seg, idx) => ({
        meetingNoteId: noteId,
        sequenceNo:    idx,
        speakerLabel:  null as string | null,
        startMs:       seg.start != null ? Math.round(seg.start * 1000) : null as number | null,
        endMs:         seg.end   != null ? Math.round(seg.end   * 1000) : null as number | null,
        text:          (seg.text ?? "").trim(),
        isFinal:       true,
      }));
      await db.insert(meetingNoteTranscriptChunks).values(rows);
    } else {
      // Plain text mode — single chunk
      await db.insert(meetingNoteTranscriptChunks).values([{
        meetingNoteId: noteId,
        sequenceNo:    0,
        speakerLabel:  null as string | null,
        startMs:       null as number | null,
        endMs:         null as number | null,
        text:          result.text.trim(),
        isFinal:       true,
      }]);
    }

    console.log(
      `[transcription] noteId=${noteId} persisted — ` +
        `chars=${result.text.length} chunks=${segments?.length ?? 1}`,
    );
  } catch (err: unknown) {
    await markError(noteId, `DB write failed: ${(err as Error).message}`);
    return;
  }

  // ── Cleanup audio file ───────────────────────────────────────────────────
  // Best-effort; leave the file on disk if cleanup fails (it's in /tmp anyway)
  await cleanupAudioFile(noteId);

  // ── Chain into AI processing (Phase B.5) ─────────────────────────────────
  // processWithAI reads rawTranscriptText from DB — handles empty string gracefully.
  await processWithAI(noteId);
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function markError(noteId: number, error: string): Promise<void> {
  console.error(`[transcription] noteId=${noteId} error: ${error}`);
  try {
    await db
      .update(meetingNotes)
      .set({ status: "failed", processingError: error, updatedAt: new Date() })
      .where(eq(meetingNotes.id, noteId));
  } catch (dbErr: unknown) {
    console.error(
      `[transcription] noteId=${noteId} failed to write processingError: ${(dbErr as Error).message}`,
    );
  }
}
