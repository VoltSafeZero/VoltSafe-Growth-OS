/**
 * Phase B.4a/B.4b — audio chunk validation + disk persistence.
 * Chunks are appended to /tmp/voltsafe-meeting-notes/<noteId>/audio.webm.
 * Real transcription is triggered by meeting-notes-transcription.ts after /stop.
 */

import fs from "fs/promises";
import { createWriteStream, existsSync } from "fs";
import path from "path";
import type { Request } from "express";

const MAX_CHUNK_BYTES = 1 * 1024 * 1024; // 1 MB per chunk
export const AUDIO_TEMP_DIR = "/tmp/voltsafe-meeting-notes";

/** Temp directory for a given note */
export function audioNoteDir(noteId: number): string {
  return path.join(AUDIO_TEMP_DIR, String(noteId));
}

/** Path to the concatenated audio file for a note */
export function audioFilePath(noteId: number): string {
  return path.join(audioNoteDir(noteId), "audio.webm");
}

/** Remove the temp audio directory for a note (called after successful transcription) */
export async function cleanupAudioFile(noteId: number): Promise<void> {
  const dir = audioNoteDir(noteId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface ChunkValidationResult {
  ok: boolean;
  error?: string;
  httpStatus?: number;
}

/**
 * Validates an incoming audio chunk request before any body is consumed.
 * Checks note status, Content-Type, and Content-Length header (when present).
 */
export function validateAudioChunk(
  req: Request,
  noteStatus: string,
): ChunkValidationResult {
  if (noteStatus !== "recording") {
    return {
      ok: false,
      error: `Note is not recording (status: '${noteStatus}')`,
      httpStatus: 409,
    };
  }

  const ct = String(req.headers["content-type"] ?? "");
  if (!ct.startsWith("audio/")) {
    return {
      ok: false,
      error: "Content-Type must be audio/* (e.g. audio/webm, audio/ogg)",
      httpStatus: 415,
    };
  }

  const cl = parseInt(String(req.headers["content-length"] ?? "0"), 10);
  if (!isNaN(cl) && cl > MAX_CHUNK_BYTES) {
    return {
      ok: false,
      error: `Chunk exceeds 1 MB limit (Content-Length: ${cl} bytes)`,
      httpStatus: 413,
    };
  }

  return { ok: true };
}

// ── Chunk persistence ───────────────────────────────────────────────────────

/**
 * Reads the incoming request body and appends it to the note's audio file.
 * The file is created (or appended to) at:
 *   /tmp/voltsafe-meeting-notes/<noteId>/audio.webm
 *
 * Multiple sequential chunks from MediaRecorder are concatenated here.
 * WebM/Opus chunks from Chrome/Firefox can be naively concatenated into a
 * valid WebM stream, which is what this approach relies on.
 */
export async function storeChunk(
  noteId: number,
  sequenceNo: number,
  req: Request,
): Promise<{ sequenceNo: number; bytes: number }> {
  const dir = audioNoteDir(noteId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = audioFilePath(noteId);

  return new Promise<{ sequenceNo: number; bytes: number }>((resolve, reject) => {
    const chunkBuffers: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      chunkBuffers.push(chunk);
    });

    req.on("end", async () => {
      try {
        const data = Buffer.concat(chunkBuffers);
        const bytes = data.length;

        // Guard: individual chunk still must not exceed limit
        if (bytes > MAX_CHUNK_BYTES) {
          reject(
            Object.assign(
              new Error(`Chunk body exceeds 1 MB (actual ${bytes} bytes)`),
              { httpStatus: 413 },
            ),
          );
          return;
        }

        if (bytes > 0) {
          await fs.appendFile(filePath, data);
        }

        console.log(
          `[meeting-notes-audio] noteId=${noteId} seq=${sequenceNo} bytes=${bytes} → ${filePath}`,
        );
        resolve({ sequenceNo, bytes });
      } catch (e) {
        reject(e);
      }
    });

    req.on("error", reject);
  });
}

/**
 * Returns the current size of the audio file for a note, or 0 if it doesn't exist.
 */
export async function audioFileSize(noteId: number): Promise<number> {
  try {
    const s = await fs.stat(audioFilePath(noteId));
    return s.size;
  } catch {
    return 0;
  }
}
