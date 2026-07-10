/**
 * cortex-ingestion.ts — Real content ingestion pipeline for "Save URL to Cortex".
 *
 * Fixes the root cause of Cortex hallucinating ingestion: the previous
 * pipeline only ever stored a title/domain/OG-description "metadata" record
 * and then claimed that content had been "learned". This service actually
 * fetches, extracts, chunks, and indexes real source content, and tracks
 * verifiable ingestion status end-to-end so Cortex can never claim to have
 * learned something it never actually stored.
 */

import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import dns from "dns/promises";

export type IngestionStatus =
  | "queued" | "fetching" | "extracting" | "transcribing" | "cleaning"
  | "chunking" | "indexing" | "verifying"
  | "ready" | "partial" | "failed" | "blocked" | "unsupported";

const MIN_USABLE_CHARS = 200; // below this, content is "metadata-only" and cannot be marked ready
const CHUNK_TARGET_CHARS = 1200;
const CHUNK_MIN_CHARS = 200;

// ── SSRF guard (mirrors server/services/link-preview.ts) ───────────────────
const PRIVATE_RANGES: RegExp[] = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./,
  /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/, /^fc00:/i, /^fe80:/i, /^::ffff:127\./i, /^::ffff:10\./i,
  /^::ffff:192\.168\./i, /^::ffff:172\.(1[6-9]|2\d|3[01])\./i,
];
function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some((r) => r.test(ip));
}
async function assertPublicHost(hostname: string): Promise<void> {
  const records = await dns.lookup(hostname, { all: true }).catch(() => []);
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new Error("SSRF_BLOCKED: resolves to a private IP");
  }
}

function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

// ── Logging ─────────────────────────────────────────────────────────────────

async function logStage(sourceId: number, stage: string, status: string, detail?: string) {
  try {
    await db.execute(sql.raw(`
      INSERT INTO cortex_ingestion_log (source_id, stage, status, detail)
      VALUES (${sourceId}, '${stage.replace(/'/g, "''")}', '${status.replace(/'/g, "''")}', ${detail ? `'${detail.replace(/'/g, "''").slice(0, 2000)}'` : "NULL"})
    `));
  } catch (e: any) {
    console.error("[cortex-ingestion] failed to write log row:", e.message);
  }
}

async function setStatus(sourceId: number, status: IngestionStatus, stage: string, extra?: Record<string, any>) {
  const setClauses = [
    `ingestion_status = '${status}'`,
    `ingestion_stage = '${stage.replace(/'/g, "''")}'`,
  ];
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) { setClauses.push(`${k} = NULL`); continue; }
      if (typeof v === "number") { setClauses.push(`${k} = ${v}`); continue; }
      if (typeof v === "boolean") { setClauses.push(`${k} = ${v}`); continue; }
      setClauses.push(`${k} = '${String(v).replace(/'/g, "''")}'`);
    }
  }
  await db.execute(sql.raw(`UPDATE cortex_email_intel SET ${setClauses.join(", ")} WHERE id = ${sourceId}`));
  await logStage(sourceId, stage, status);
}

// ── Extraction: HTML article ────────────────────────────────────────────────

async function extractHtmlArticle(url: string): Promise<{ text: string; title?: string; method: string }> {
  const parsed = new URL(url);
  await assertPublicHost(parsed.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal as any,
      redirect: "follow",
      headers: { "User-Agent": "VoltSafeBot/1.0 (+cortex-ingestion)" },
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    throw new Error(`UNSUPPORTED_CONTENT_TYPE: ${contentType || "unknown"}`);
  }
  const html = await res.text();

  // Prefer @mozilla/readability for real article extraction.
  try {
    const { JSDOM } = await import("jsdom");
    const { Readability } = await import("@mozilla/readability");
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document as any);
    const article = reader.parse();
    if (article?.textContent && article.textContent.trim().length >= MIN_USABLE_CHARS) {
      return { text: article.textContent.trim(), title: article.title || undefined, method: "readability" };
    }
  } catch (e: any) {
    console.warn("[cortex-ingestion] readability failed, falling back to cheerio:", e.message);
  }

  // Fallback: cheerio-based boilerplate stripping.
  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);
  $("script,style,nav,footer,header,noscript,iframe,svg,form,button,aside").remove();
  $("[class*='cookie'],[id*='cookie'],[class*='banner'],[class*='advert'],[class*='ad-']").remove();
  const title = $("title").first().text().trim() || undefined;
  const text = $("body").text().replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { text, title, method: "cheerio-fallback" };
}

// ── Extraction: YouTube transcript ──────────────────────────────────────────

function extractYouTubeId(url: string): string | null {
  return (
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ??
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ??
    null
  );
}

async function extractYouTubeTranscript(url: string): Promise<{ text: string; title?: string; method: string }> {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error("UNSUPPORTED: could not resolve YouTube video ID");

  // Title via oEmbed (lightweight, already used by fetch-metadata).
  let title: string | undefined;
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: AbortSignal.timeout(5000) });
    if (oembedRes.ok) title = (await oembedRes.json())?.title;
  } catch { /* non-fatal */ }

  const { YoutubeTranscript } = await import("youtube-transcript");
  let items: Array<{ text: string; offset: number }>;
  try {
    items = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (e: any) {
    throw new Error(`NO_CAPTIONS: ${e.message || "captions unavailable for this video"}`);
  }
  if (!items || items.length === 0) throw new Error("NO_CAPTIONS: empty transcript");

  const text = items.map((it) => {
    const mins = Math.floor(it.offset / 60000);
    const secs = Math.floor((it.offset % 60000) / 1000);
    const ts = `[${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}]`;
    return `${ts} ${it.text}`;
  }).join("\n");

  if (text.trim().length < MIN_USABLE_CHARS) throw new Error("NO_CAPTIONS: transcript too short to be usable");
  return { text, title, method: "youtube-transcript" };
}

// ── Extraction: PDF ──────────────────────────────────────────────────────────

async function extractPdf(url: string): Promise<{ text: string; title?: string; method: string }> {
  const parsed = new URL(url);
  await assertPublicHost(parsed.hostname);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal as any, redirect: "follow" });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buf);
  const text = (data.text || "").trim();
  if (text.length < MIN_USABLE_CHARS) {
    throw new Error("SCANNED_OR_UNREADABLE: no selectable text found in PDF (likely a scanned document)");
  }
  return { text: `[${data.numpages} pages]\n\n${text}`, method: "pdf-parse" };
}

// ── Restricted platforms (LinkedIn etc.) ────────────────────────────────────

const BLOCKED_AUTH_WALLED_HOSTS = /(^|\.)linkedin\.com$/i;

// ── Router ───────────────────────────────────────────────────────────────────

async function routeExtraction(url: string): Promise<{ text: string; title?: string; method: string; status: "ready" | "partial" | "blocked" | "unsupported"; failureReason?: string }> {
  const parsed = new URL(url);
  const isYouTube = /(^|\.)(youtube\.com|youtu\.be)$/i.test(parsed.hostname);
  const isPdf = /\.pdf(\?|$)/i.test(parsed.pathname);
  const isLinkedIn = BLOCKED_AUTH_WALLED_HOSTS.test(parsed.hostname);

  if (isLinkedIn) {
    return { text: "", method: "blocked", status: "blocked", failureReason: "LinkedIn requires authentication and blocks automated content extraction; only the submitted URL was recorded." };
  }

  if (isYouTube) {
    try {
      const r = await extractYouTubeTranscript(url);
      return { ...r, status: "ready" };
    } catch (e: any) {
      return { text: "", method: "youtube-transcript", status: "partial", failureReason: e.message || "Transcript unavailable" };
    }
  }

  if (isPdf) {
    try {
      const r = await extractPdf(url);
      return { ...r, status: "ready" };
    } catch (e: any) {
      return { text: "", method: "pdf-parse", status: "partial", failureReason: e.message || "PDF extraction failed" };
    }
  }

  try {
    const r = await extractHtmlArticle(url);
    if (r.text.length < MIN_USABLE_CHARS) {
      return { ...r, status: "partial", failureReason: `Only ${r.text.length} characters of usable text were found — likely a JS-rendered, paywalled, or bot-blocked page.` };
    }
    return { ...r, status: "ready" };
  } catch (e: any) {
    const reason = String(e.message || e);
    if (/SSRF_BLOCKED/.test(reason)) return { text: "", method: "http-fetch", status: "blocked", failureReason: "URL resolves to a private/internal address and cannot be fetched." };
    if (/UNSUPPORTED_CONTENT_TYPE/.test(reason)) return { text: "", method: "http-fetch", status: "unsupported", failureReason: reason };
    return { text: "", method: "http-fetch", status: "failed", failureReason: reason };
  }
}

// ── Chunking ─────────────────────────────────────────────────────────────────

export function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if (buf.length > 0 && buf.length + p.length + 2 > CHUNK_TARGET_CHARS) {
      chunks.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
    // Guard against a single enormous paragraph (e.g. transcript with no blank lines).
    while (buf.length > CHUNK_TARGET_CHARS * 2) {
      chunks.push(buf.slice(0, CHUNK_TARGET_CHARS).trim());
      buf = buf.slice(CHUNK_TARGET_CHARS);
    }
  }
  if (buf.trim().length > 0) chunks.push(buf.trim());
  return chunks.filter((c) => c.length >= CHUNK_MIN_CHARS || chunks.length === 1);
}

async function persistChunks(sourceId: number, chunks: string[]): Promise<number> {
  await db.execute(sql.raw(`DELETE FROM cortex_source_chunks WHERE source_id = ${sourceId}`));
  let indexed = 0;
  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i];
    const hash = contentHash(text);
    await db.execute(sql.raw(`
      INSERT INTO cortex_source_chunks (source_id, chunk_text, seq, char_count, content_hash, indexed)
      VALUES (${sourceId}, '${text.replace(/'/g, "''")}', ${i}, ${text.length}, '${hash}', true)
    `));
    indexed++;
  }
  return indexed;
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Runs the full ingestion pipeline for a single source. Safe to call multiple
 * times (retries): chunks are fully replaced, status/text are overwritten.
 */
export async function runIngestion(sourceId: number, url: string): Promise<void> {
  try {
    await setStatus(sourceId, "fetching", "fetch");
    const extraction = await routeExtraction(url);

    if (extraction.status === "blocked" || extraction.status === "unsupported" || extraction.status === "failed") {
      await setStatus(sourceId, extraction.status, "extract", {
        failure_reason: (extraction.failureReason || "Extraction failed").slice(0, 2000),
        retrieval_ready: false,
        extraction_method: extraction.method,
        fetch_completed_at: new Date().toISOString(),
      });
      return;
    }

    await setStatus(sourceId, "extracting", "extract", { extraction_method: extraction.method });

    const cleaned = extraction.text.replace(/\u0000/g, "").trim();

    if (extraction.status === "partial") {
      await setStatus(sourceId, "partial", "extract", {
        failure_reason: (extraction.failureReason || "Only partial content could be extracted").slice(0, 2000),
        extracted_text: cleaned.slice(0, 500_000),
        content_char_count: cleaned.length,
        content_hash: cleaned ? contentHash(cleaned) : null,
        retrieval_ready: false,
        fetch_completed_at: new Date().toISOString(),
      });
      return;
    }

    await setStatus(sourceId, "chunking", "chunk");
    const chunks = chunkText(cleaned);
    if (chunks.length === 0) {
      await setStatus(sourceId, "partial", "chunk", {
        failure_reason: "Content was extracted but produced no usable chunks.",
        extracted_text: cleaned.slice(0, 500_000),
        content_char_count: cleaned.length,
        retrieval_ready: false,
      });
      return;
    }

    await setStatus(sourceId, "indexing", "index");
    const indexedCount = await persistChunks(sourceId, chunks);

    await db.execute(sql.raw(`
      UPDATE cortex_email_intel SET
        extracted_text = '${cleaned.slice(0, 500_000).replace(/'/g, "''")}',
        content_char_count = ${cleaned.length},
        content_hash = '${contentHash(cleaned)}',
        chunk_count = ${chunks.length},
        indexed_chunk_count = ${indexedCount},
        extraction_method = '${extraction.method}',
        title = COALESCE(title, ${extraction.title ? `'${extraction.title.replace(/'/g, "''")}'` : "NULL"}),
        fetch_completed_at = NOW()
      WHERE id = ${sourceId}
    `));

    await setStatus(sourceId, "ready", "verify", { retrieval_ready: true });
  } catch (err: any) {
    console.error(`[cortex-ingestion] source ${sourceId} failed:`, err.message);
    await setStatus(sourceId, "failed", "unexpected_error", {
      failure_reason: String(err.message || err).slice(0, 2000),
      retrieval_ready: false,
    });
  }
}

/** Fire-and-forget wrapper — never lets an ingestion failure crash the request handler. */
export function queueIngestion(sourceId: number, url: string): void {
  db.execute(sql.raw(`UPDATE cortex_email_intel SET ingestion_status = 'queued', ingestion_stage = 'queued' WHERE id = ${sourceId}`))
    .then(() => logStage(sourceId, "queued", "queued"))
    .then(() => runIngestion(sourceId, url))
    .catch((e) => console.error("[cortex-ingestion] queueIngestion failed:", e.message));
}

/**
 * Startup recovery: find sources stuck mid-pipeline (e.g. app restarted while
 * fetching) and re-run them so ingestion is never silently abandoned.
 */
export async function recoverStuckIngestions(): Promise<void> {
  const stuck = await db.execute(sql.raw(`
    SELECT id, source_url FROM cortex_email_intel
    WHERE deleted_at IS NULL AND source_type = 'url'
      AND ingestion_status IN ('queued','fetching','extracting','transcribing','cleaning','chunking','indexing','verifying')
  `));
  const rows = (stuck as any).rows ?? [];
  for (const row of rows) {
    console.log(`[cortex-ingestion] recovering stuck source ${row.id}`);
    queueIngestion(row.id, row.source_url);
  }
}

/**
 * Master-admin backfill: reprocess every source that never got real content
 * (legacy metadata-only rows, failed, partial, unsupported). Idempotent —
 * safe to run repeatedly; each run fully replaces prior extraction results.
 */
export async function reprocessIncompleteSources(): Promise<{ queued: number; ids: number[] }> {
  const rows = await db.execute(sql.raw(`
    SELECT id, source_url FROM cortex_email_intel
    WHERE deleted_at IS NULL AND source_type = 'url'
      AND (retrieval_ready = false OR ingestion_status IN ('partial','failed','unsupported','blocked'))
  `));
  const list = (rows as any).rows ?? [];
  for (const row of list) {
    await db.execute(sql.raw(`UPDATE cortex_email_intel SET retry_count = retry_count + 1, last_retry_at = NOW() WHERE id = ${row.id}`));
    queueIngestion(row.id, row.source_url);
  }
  return { queued: list.length, ids: list.map((r: any) => r.id) };
}

// Natural-language questions ("What does X say about Y?") contain filler words
// that never appear verbatim in source content. plainto_tsquery/websearch_to_tsquery
// AND every remaining stemmed term together, so a 6-word question requires all 6
// stems to co-occur in one chunk — that almost never happens. We instead pull out
// the meaningful keywords and OR them together (to_tsquery with `|`), ranking by
// how many/well they match, so a chunk containing just the key nouns still surfaces.
const RETRIEVAL_STOPWORDS = new Set([
  "what", "does", "do", "did", "is", "are", "was", "were", "the", "a", "an", "of",
  "in", "on", "at", "to", "for", "and", "or", "say", "says", "said", "about",
  "tell", "me", "you", "your", "please", "can", "could", "would", "should",
  "this", "that", "these", "those", "it", "its", "with", "from", "how", "why",
  "when", "where", "who", "which", "article", "page", "source", "document",
  "content", "wikipedia", "cortex",
]);

function buildOrTsQuery(query: string): string | null {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !RETRIEVAL_STOPWORDS.has(w));
  const unique = Array.from(new Set(words)).slice(0, 12);
  if (unique.length === 0) return null;
  // Prefix-match each term (":*") so partial/stemmed variants still hit, OR'd together.
  return unique.map((w) => `${w.replace(/'/g, "''")}:*`).join(" | ");
}

/** Simple lexical (non-vector) retrieval: PostgreSQL full-text search over chunk text, scoped to ready sources. */
export async function retrieveChunksForQuery(query: string, opts: { limit?: number; sourceIds?: number[]; onlyToday?: boolean } = {}): Promise<any[]> {
  const limit = opts.limit ?? 8;
  const safeQuery = query.replace(/'/g, "''").slice(0, 500);
  const sourceFilter = opts.sourceIds && opts.sourceIds.length > 0
    ? `AND c.id IN (${opts.sourceIds.join(",")})`
    : "";
  const todayFilter = opts.onlyToday ? `AND c.created_at >= CURRENT_DATE` : "";

  const orQuery = buildOrTsQuery(query);
  // to_tsquery requires valid lexeme syntax; if keyword extraction yields nothing
  // usable, fall back to plainto_tsquery on the raw string (still AND-based, but
  // better than no query at all for single-word/short inputs).
  const tsqueryExpr = orQuery
    ? `to_tsquery('english', '${orQuery.replace(/'/g, "''")}')`
    : `plainto_tsquery('english', '${safeQuery}')`;

  const rows = await db.execute(sql.raw(`
    SELECT
      ch.id AS chunk_id, ch.chunk_text, ch.seq,
      c.id AS source_id, c.title, c.canonical_url, c.domain, c.intel_type, c.created_at,
      ts_rank(to_tsvector('english', ch.chunk_text), ${tsqueryExpr}) AS rank
    FROM cortex_source_chunks ch
    JOIN cortex_email_intel c ON c.id = ch.source_id
    WHERE c.deleted_at IS NULL AND c.retrieval_ready = true AND c.use_in_ai_context = true
      ${sourceFilter} ${todayFilter}
      AND to_tsvector('english', ch.chunk_text) @@ ${tsqueryExpr}
    ORDER BY rank DESC
    LIMIT ${limit}
  `));
  return (rows as any).rows ?? [];
}
