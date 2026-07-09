/**
 * Daily Downloads — AI transcription + summarization.
 * Models: Whisper for transcription, GPT-4o-mini for summarization.
 */

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

const DAILY_AUDIO_DIR = "/tmp/voltsafe-daily-downloads";

export function dailyAudioDir(downloadId: number): string {
  return path.join(DAILY_AUDIO_DIR, String(downloadId));
}

export function dailyAudioFilePath(downloadId: number): string {
  return path.join(dailyAudioDir(downloadId), "audio.webm");
}

export async function cleanupDailyAudio(downloadId: number): Promise<void> {
  const dir = dailyAudioDir(downloadId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

export async function dailyAudioFileSize(downloadId: number): Promise<number> {
  try {
    const s = await fs.stat(dailyAudioFilePath(downloadId));
    return s.size;
  } catch {
    return 0;
  }
}

/**
 * Reads an incoming request body and appends it to the daily download's audio file.
 */
export async function storeDailyChunk(
  downloadId: number,
  req: import("express").Request,
): Promise<{ bytes: number }> {
  const dir = dailyAudioDir(downloadId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = dailyAudioFilePath(downloadId);

  return new Promise<{ bytes: number }>((resolve, reject) => {
    const bufs: Buffer[] = [];
    req.on("data", (chunk: Buffer) => bufs.push(chunk));
    req.on("end", async () => {
      try {
        const data = Buffer.concat(bufs);
        if (data.length > 0) await fs.appendFile(filePath, data);
        console.log(`[daily-downloads-audio] id=${downloadId} bytes=${data.length}`);
        resolve({ bytes: data.length });
      } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function getOpenAI(): OpenAI {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No OpenAI API key configured");
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

export async function processDailyDownload(downloadId: number): Promise<void> {
  try {
    await _processDailyDownload(downloadId);
  } catch (err) {
    console.error(`[daily-downloads] processId=${downloadId} unhandled:`, (err as Error).message);
    await db.execute(sql.raw(
      `UPDATE daily_downloads SET status='failed', updated_at=NOW() WHERE id=${downloadId}`
    )).catch(() => {});
  }
}

async function _processDailyDownload(downloadId: number): Promise<void> {
  const rows = await db.execute(sql.raw(
    `SELECT id, status, user_id FROM daily_downloads WHERE id=${downloadId}`
  ));
  const dl = (rows as any).rows?.[0] ?? (rows as any)[0];
  if (!dl) throw new Error(`Daily download ${downloadId} not found`);

  if (dl.status !== "processing") {
    console.log(`[daily-downloads] id=${downloadId} status="${dl.status}" — skipping (not processing)`);
    return;
  }

  const audioPath = dailyAudioFilePath(downloadId);
  const hasAudio = existsSync(audioPath);

  let transcript = "";

  if (hasAudio) {
    try {
      const openai = getOpenAI();
      const { createReadStream } = await import("fs");
      const audioStream = createReadStream(audioPath) as any;
      audioStream.path = audioPath;

      const resp = await openai.audio.transcriptions.create({
        model: "whisper-1",
        file: audioStream,
        response_format: "text",
      });
      transcript = typeof resp === "string" ? resp.trim() : (resp as any).text?.trim() ?? "";
      console.log(`[daily-downloads] id=${downloadId} transcribed ${transcript.length} chars`);
    } catch (err) {
      console.error(`[daily-downloads] id=${downloadId} transcription failed:`, (err as Error).message);
    }
  }

  if (!transcript) {
    await db.execute(sql.raw(
      `UPDATE daily_downloads SET status='failed', transcript='', updated_at=NOW() WHERE id=${downloadId}`
    ));
    return;
  }

  const openai = getOpenAI();
  const model = "gpt-4o-mini";

  const prompt = `You are a workplace AI assistant summarizing a person's daily voice journal. The person recorded a voice note about what they did today. Your job is to produce a structured JSON summary for their team.

Rules:
- Be concise. Plain language. No fluff.
- Extract only what was explicitly mentioned; do not invent anything.
- If something is unclear, omit it rather than guess.
- summary_bullets: 3–7 short bullet points covering key activities/decisions.
- wins: notable achievements or completions (max 3, can be empty array).
- blockers: things that are blocked or causing problems (max 3, can be empty array).
- follow_ups: actions or things to follow up on (max 3, can be empty array).

Respond ONLY with this JSON (no markdown, no extra text):
{
  "summary_bullets": ["bullet 1", "bullet 2"],
  "wins": ["win 1"],
  "blockers": ["blocker 1"],
  "follow_ups": ["follow_up 1"]
}

Voice transcript:
${transcript.slice(0, 8000)}`;

  let summaryBullets: string[] = [];
  let wins: string[] = [];
  let blockers: string[] = [];
  let followUps: string[] = [];

  try {
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.3,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw);
    summaryBullets = Array.isArray(parsed.summary_bullets) ? parsed.summary_bullets : [];
    wins = Array.isArray(parsed.wins) ? parsed.wins : [];
    blockers = Array.isArray(parsed.blockers) ? parsed.blockers : [];
    followUps = Array.isArray(parsed.follow_ups) ? parsed.follow_ups : [];
  } catch (err) {
    console.error(`[daily-downloads] id=${downloadId} AI summarization failed:`, (err as Error).message);
    summaryBullets = ["Summary generation failed — see transcript below."];
  }

  const bulletsLiteral = `ARRAY[${summaryBullets.map(b => `'${b.replace(/'/g, "''")}'`).join(",")}]`;
  const winsLiteral = `ARRAY[${wins.map(b => `'${b.replace(/'/g, "''")}'`).join(",")}]`;
  const blockersLiteral = `ARRAY[${blockers.map(b => `'${b.replace(/'/g, "''")}'`).join(",")}]`;
  const followUpsLiteral = `ARRAY[${followUps.map(b => `'${b.replace(/'/g, "''")}'`).join(",")}]`;
  const transcriptEscaped = transcript.replace(/'/g, "''");

  await db.execute(sql.raw(`
    UPDATE daily_downloads SET
      status='completed',
      transcript='${transcriptEscaped}',
      summary_bullets=${bulletsLiteral},
      wins=${winsLiteral},
      blockers=${blockersLiteral},
      follow_ups=${followUpsLiteral},
      updated_at=NOW()
    WHERE id=${downloadId}
  `));

  console.log(`[daily-downloads] id=${downloadId} completed`);
  await cleanupDailyAudio(downloadId).catch(() => {});
}
