/**
 * Phase B.2 stub — audio chunk validation and stub storage.
 * Real transcription (Whisper / streaming) is deferred to Phase B.4.
 */

import type { Request } from "express";

const MAX_CHUNK_BYTES = 1 * 1024 * 1024; // 1 MB

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

/**
 * Stub: drains the request body without persisting audio data.
 * Returns the sequence number and byte count for logging.
 *
 * Phase B.4 will replace this with real storage (temp file → Whisper).
 */
export async function storeChunkStub(
  noteId: number,
  sequenceNo: number,
  req: Request,
): Promise<{ sequenceNo: number; bytes: number }> {
  const bytes = await new Promise<number>((resolve) => {
    let total = 0;
    req.on("data", (chunk: Buffer) => { total += chunk.length; });
    req.on("end",  () => resolve(total));
    req.on("error", () => resolve(0));
  });

  console.log(
    `[meeting-notes-audio] stub: noteId=${noteId} seq=${sequenceNo} bytes=${bytes} (discarded — Phase B.4 pending)`,
  );
  return { sequenceNo, bytes };
}
