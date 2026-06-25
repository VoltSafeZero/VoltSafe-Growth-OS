/**
 * CRM Recent News Service
 *
 * Handles URL ingestion, article metadata extraction (with SSRF protection),
 * AI-powered summarisation (summary, strategic relevance, outreach angle,
 * key points, relevance score) and compact context assembly for AI email
 * generation.
 */

import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { buildOpenAIModelParams } from "./openai-compat";

// ─── OpenAI client ─────────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI | null {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// ─── SSRF guard ────────────────────────────────────────────────────────────────

const PRIVATE_IP_RE = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^0\.0\.0\.0$/,
  /^169\.254\.\d+\.\d+$/,
];

export function isUrlSafe(url: string): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Invalid URL format" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, reason: "Only http and https URLs are allowed" };
  }
  const hostname = parsed.hostname;
  for (const re of PRIVATE_IP_RE) {
    if (re.test(hostname)) {
      return { ok: false, reason: "Private/internal URLs are not allowed" };
    }
  }
  return { ok: true };
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hostname = u.hostname.toLowerCase();
    if (
      (u.protocol === "https:" && u.port === "443") ||
      (u.protocol === "http:" && u.port === "80")
    ) {
      u.port = "";
    }
    if (u.pathname.endsWith("/") && u.pathname.length > 1) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return url.trim();
  }
}

// ─── HTML metadata extraction ──────────────────────────────────────────────────

function extractOgTag(html: string, property: string): string | null {
  const a = html.match(
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i")
  );
  if (a) return a[1].trim();
  const b = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i")
  );
  return b ? b[1].trim() : null;
}

function extractMetaTag(html: string, name: string): string | null {
  const a = html.match(
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")
  );
  if (a) return a[1].trim();
  const b = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i")
  );
  return b ? b[1].trim() : null;
}

function extractHtmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractPlainText(html: string): string {
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 6000 ? text.slice(0, 6000) + "…" : text;
}

// ─── Article fetch ─────────────────────────────────────────────────────────────

export interface ArticleMetadata {
  title: string | null;
  source: string | null;
  author: string | null;
  publishedAt: string | null;
  description: string | null;
  extractedText: string | null;
  fetchError: string | null;
}

export async function fetchArticleMetadata(url: string): Promise<ArticleMetadata> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "VoltSafeBot/1.0 (news article context extraction)",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { title: null, source: null, author: null, publishedAt: null, description: null, extractedText: null, fetchError: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { title: null, source: null, author: null, publishedAt: null, description: null, extractedText: null, fetchError: "Not an HTML page" };
    }

    const buffer = await res.arrayBuffer();
    const slice = buffer.byteLength > 2_000_000 ? buffer.slice(0, 2_000_000) : buffer;
    const html = new TextDecoder().decode(slice);

    const ogTitle      = extractOgTag(html, "og:title");
    const twitterTitle = extractOgTag(html, "twitter:title");
    const ogSiteName   = extractOgTag(html, "og:site_name");
    const ogDesc       = extractOgTag(html, "og:description");
    const ogPub        = extractOgTag(html, "article:published_time")
                      || extractMetaTag(html, "article:published_time")
                      || extractMetaTag(html, "date")
                      || extractMetaTag(html, "pubdate");

    let source = ogSiteName;
    if (!source) {
      try { source = new URL(url).hostname.replace(/^www\./, ""); } catch { source = null; }
    }

    return {
      title:         (ogTitle || twitterTitle || extractHtmlTitle(html))?.slice(0, 500) ?? null,
      source:        source?.slice(0, 200) ?? null,
      author:        extractMetaTag(html, "author")?.slice(0, 200) ?? null,
      publishedAt:   ogPub?.slice(0, 100) ?? null,
      description:   (ogDesc || extractMetaTag(html, "description"))?.slice(0, 1000) ?? null,
      extractedText: extractPlainText(html) || null,
      fetchError:    null,
    };
  } catch (err: any) {
    const msg = err?.name === "AbortError"
      ? "Fetch timeout (12s)"
      : String(err?.message || "Unknown fetch error").slice(0, 200);
    return { title: null, source: null, author: null, publishedAt: null, description: null, extractedText: null, fetchError: msg };
  }
}

// ─── AI summary ────────────────────────────────────────────────────────────────

export interface NewsAiResult {
  summary: string;
  strategicRelevance: string;
  suggestedOutreachAngle: string;
  keyPoints: string[];
  relevanceScore: 1 | 2 | 3 | 4 | 5;
}

const AI_SYSTEM_PROMPT = `You are a strategic intelligence assistant for VoltSafe — a marina electrification company specialising in smart shore power, smart connectors, leakage detection, energy management, marina pedestal modernisation, and port/utility electrification.

Given a news article and CRM entity context, return ONLY valid JSON with this exact shape:
{
  "summary": "Plain-language 2-3 sentence summary of what happened.",
  "strategicRelevance": "Why this matters to VoltSafe — sales opportunity, funding signal, competitive context, market timing, or account strategy note.",
  "suggestedOutreachAngle": "One or two concise sentences usable verbatim in an email or call opener referencing this news.",
  "keyPoints": ["bullet 1", "bullet 2", "bullet 3"],
  "relevanceScore": 3
}

Relevance score scale:
1 = General background only
2 = Mildly relevant, worth knowing
3 = Useful context — could inform outreach timing or messaging
4 = Strong outreach trigger — timely reason to reach out now
5 = High-priority strategic trigger — very strong sales or partnership signal`;

export async function generateNewsAiSummary(
  url: string,
  title: string | null,
  source: string | null,
  description: string | null,
  extractedText: string | null,
  userNote: string | null,
  entityContext: string,
): Promise<NewsAiResult | null> {
  const openai = buildOpenAIClient();
  if (!openai) return null;

  const contentBlock = [
    title       ? `Title: ${title}`                               : null,
    source      ? `Source: ${source}`                             : null,
    description ? `Description: ${description}`                   : null,
    extractedText ? `Article text:\n${extractedText.slice(0, 4000)}` : null,
    userNote    ? `User note: ${userNote}`                        : null,
  ].filter(Boolean).join("\n\n");

  if (!contentBlock.trim()) return null;

  try {
    const resp = await openai.chat.completions.create({
      ...buildOpenAIModelParams(),
      messages: [
        { role: "system",  content: AI_SYSTEM_PROMPT },
        { role: "user",    content: `CRM entity context: ${entityContext}\n\nArticle URL: ${url}\n\n${contentBlock}` },
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
      temperature: 0.3,
    });

    const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}");
    const score = Math.min(5, Math.max(1, parseInt(String(parsed.relevanceScore)) || 3)) as 1 | 2 | 3 | 4 | 5;

    return {
      summary:                String(parsed.summary                || "").slice(0, 2000),
      strategicRelevance:     String(parsed.strategicRelevance     || "").slice(0, 2000),
      suggestedOutreachAngle: String(parsed.suggestedOutreachAngle || "").slice(0, 1000),
      keyPoints:              (Array.isArray(parsed.keyPoints) ? parsed.keyPoints : []).slice(0, 6).map((k: any) => String(k).slice(0, 300)),
      relevanceScore:         score,
    };
  } catch (err: any) {
    console.error("[crm-recent-news] AI summary error:", err?.message);
    return null;
  }
}

// ─── Entity context helper ─────────────────────────────────────────────────────

async function getEntityContext(entityType: string, entityId: number): Promise<string> {
  const eid = Number(entityId);
  try {
    if (entityType === "lead") {
      const rows = (await db.execute(sql.raw(`SELECT company_name, stage, industry, estimated_deal_value FROM leads WHERE id = ${eid}`))).rows as any[];
      const r = rows[0]; if (!r) return `Lead #${eid}`;
      return `Lead: ${r.company_name || "Unknown"}. Stage: ${r.stage || "Unknown"}. Industry: ${r.industry || "Unknown"}.`;
    }
    if (entityType === "account") {
      const rows = (await db.execute(sql.raw(`SELECT name, type, industry FROM accounts WHERE id = ${eid}`))).rows as any[];
      const r = rows[0]; if (!r) return `Account #${eid}`;
      return `Account: ${r.name || "Unknown"}. Type: ${r.type || "Unknown"}. Industry: ${r.industry || "Unknown"}.`;
    }
    if (entityType === "contact") {
      const rows = (await db.execute(sql.raw(`SELECT c.name, c.title, a.name as account_name FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = ${eid}`))).rows as any[];
      const r = rows[0]; if (!r) return `Contact #${eid}`;
      return `Contact: ${r.name || "Unknown"}. Title: ${r.title || "Unknown"}. Company: ${r.account_name || "Unknown"}.`;
    }
    if (entityType === "partner") {
      const rows = (await db.execute(sql.raw(`SELECT name, organization_type, region FROM partnerships WHERE id = ${eid}`))).rows as any[];
      const r = rows[0]; if (!r) return `Partner #${eid}`;
      return `Partner: ${r.name || "Unknown"}. Type: ${r.organization_type || "Unknown"}. Region: ${r.region || "Unknown"}.`;
    }
    if (entityType === "marina") {
      const rows = (await db.execute(sql.raw(`SELECT name, city, state FROM marinas WHERE id = ${eid}`))).rows as any[];
      const r = rows[0]; if (!r) return `Marina #${eid}`;
      return `Marina: ${r.name || "Unknown"}. Location: ${r.city || ""}, ${r.state || ""}.`;
    }
    return `${entityType} #${eid}`;
  } catch {
    return `${entityType} #${eid}`;
  }
}

// ─── Process a news item (fetch + AI) ─────────────────────────────────────────

export async function processNewsItem(newsId: number): Promise<void> {
  try {
    await db.execute(sql.raw(
      `UPDATE crm_recent_news SET ai_status = 'processing', last_processed_at = NOW(), processing_error = NULL WHERE id = ${newsId}`
    ));

    const rows = (await db.execute(sql.raw(`SELECT * FROM crm_recent_news WHERE id = ${newsId}`))).rows as any[];
    if (!rows[0]) return;
    const row = rows[0];
    const { url, user_note, entity_type, entity_id } = row;

    const [meta, entityContext] = await Promise.all([
      fetchArticleMetadata(url),
      getEntityContext(entity_type, Number(entity_id)),
    ]);

    const aiResult = await generateNewsAiSummary(
      url,
      meta.title || row.title,
      meta.source || row.source,
      meta.description,
      meta.extractedText,
      user_note,
      entityContext,
    );

    const esc = (s: string) => String(s || "").replace(/'/g, "''");

    const sets: string[] = [
      `ai_status = '${aiResult ? "done" : "failed"}'`,
      `last_processed_at = NOW()`,
    ];

    if (meta.fetchError) sets.push(`processing_error = '${esc(meta.fetchError)}'`);
    if (meta.title && !row.title) sets.push(`title = '${esc(meta.title)}'`);
    if (meta.source && !row.source) sets.push(`source = '${esc(meta.source)}'`);
    if (meta.author && !row.author) sets.push(`author = '${esc(meta.author)}'`);
    if (meta.publishedAt && !row.published_at) sets.push(`published_at = '${esc(meta.publishedAt)}'`);
    if (meta.description) sets.push(`raw_excerpt = '${esc(meta.description.slice(0, 2000))}'`);
    if (meta.extractedText) sets.push(`extracted_text = '${esc(meta.extractedText.slice(0, 10000))}'`);

    if (aiResult) {
      sets.push(`ai_summary = '${esc(aiResult.summary)}'`);
      sets.push(`strategic_relevance = '${esc(aiResult.strategicRelevance)}'`);
      sets.push(`suggested_outreach_angle = '${esc(aiResult.suggestedOutreachAngle)}'`);
      sets.push(`ai_key_points = '${esc(JSON.stringify(aiResult.keyPoints))}'::jsonb`);
      sets.push(`ai_relevance_score = ${aiResult.relevanceScore}`);
    }

    await db.execute(sql.raw(`UPDATE crm_recent_news SET ${sets.join(", ")} WHERE id = ${newsId}`));
    console.log(`[crm-recent-news] processed id=${newsId} ai=${aiResult ? "ok" : "failed"}`);
  } catch (err: any) {
    try {
      const errMsg = String(err?.message || "Unknown error").slice(0, 500).replace(/'/g, "''");
      await db.execute(sql.raw(
        `UPDATE crm_recent_news SET ai_status = 'failed', processing_error = '${errMsg}', last_processed_at = NOW() WHERE id = ${newsId}`
      ));
    } catch { /* ignore secondary failure */ }
    console.error("[crm-recent-news] processNewsItem error:", err?.message);
  }
}

// ─── Context for AI email generation ──────────────────────────────────────────

export interface NewsContextItem {
  id: number;
  title: string;
  source: string | null;
  publishedAt: string | null;
  summary: string;
  strategicRelevance: string;
  suggestedOutreachAngle: string;
  relevanceScore: number;
  userNote: string | null;
  url: string;
}

export async function getRecentNewsContext(
  entityType: string,
  entityId: number,
  maxItems = 3,
  selectedIds?: number[],
): Promise<NewsContextItem[]> {
  try {
    const eid = Number(entityId);
    const etype = entityType.replace(/'/g, "");
    let where = `entity_type = '${etype}' AND entity_id = ${eid} AND is_archived = FALSE AND ai_status = 'done' AND ai_summary IS NOT NULL`;
    if (selectedIds && selectedIds.length > 0) {
      where += ` AND id IN (${selectedIds.map(Number).join(",")})`;
    } else if (selectedIds !== undefined) {
      // Empty array explicitly provided = caller deselected everything
      return [];
    }
    const rows = (await db.execute(sql.raw(`
      SELECT id, title, source, published_at, ai_summary, strategic_relevance, suggested_outreach_angle, ai_relevance_score, user_note, url
      FROM crm_recent_news
      WHERE ${where}
      ORDER BY ai_relevance_score DESC NULLS LAST, added_at DESC
      LIMIT ${Math.min(10, maxItems)}
    `))).rows as any[];

    return rows.map((r: any) => ({
      id:                     Number(r.id),
      title:                  String(r.title || "Untitled article"),
      source:                 r.source  ? String(r.source)  : null,
      publishedAt:            r.published_at ? String(r.published_at) : null,
      summary:                String(r.ai_summary || ""),
      strategicRelevance:     String(r.strategic_relevance || ""),
      suggestedOutreachAngle: String(r.suggested_outreach_angle || ""),
      relevanceScore:         Number(r.ai_relevance_score || 3),
      userNote:               r.user_note ? String(r.user_note) : null,
      url:                    String(r.url || ""),
    }));
  } catch {
    return [];
  }
}

export async function getNewsItemsForModal(
  entityType: string,
  entityId: number,
): Promise<Array<NewsContextItem & { addedAt: string }>> {
  try {
    const eid = Number(entityId);
    const etype = entityType.replace(/'/g, "");
    const rows = (await db.execute(sql.raw(`
      SELECT id, title, source, published_at, ai_summary, strategic_relevance, suggested_outreach_angle, ai_relevance_score, user_note, url, added_at
      FROM crm_recent_news
      WHERE entity_type = '${etype}' AND entity_id = ${eid} AND is_archived = FALSE AND ai_status = 'done' AND ai_summary IS NOT NULL
      ORDER BY ai_relevance_score DESC NULLS LAST, added_at DESC
      LIMIT 20
    `))).rows as any[];

    return rows.map((r: any) => ({
      id:                     Number(r.id),
      title:                  String(r.title || "Untitled article"),
      source:                 r.source  ? String(r.source)  : null,
      publishedAt:            r.published_at ? String(r.published_at) : null,
      summary:                String(r.ai_summary || ""),
      strategicRelevance:     String(r.strategic_relevance || ""),
      suggestedOutreachAngle: String(r.suggested_outreach_angle || ""),
      relevanceScore:         Number(r.ai_relevance_score || 3),
      userNote:               r.user_note ? String(r.user_note) : null,
      url:                    String(r.url || ""),
      addedAt:                String(r.added_at || ""),
    }));
  } catch {
    return [];
  }
}

export function buildNewsContextBlock(items: NewsContextItem[]): string {
  if (!items.length) return "";
  const lines: string[] = [
    `=== RECENT NEWS CONTEXT ===`,
    `The following news articles are relevant to this lead/account and should inform the outreach angle, timing, and tone of the email.`,
    ``,
  ];
  items.forEach((item, i) => {
    lines.push(`📰 [News ${i + 1}] ${item.title}`);
    if (item.source) lines.push(`Source: ${item.source}${item.publishedAt ? ` | Published: ${item.publishedAt}` : ""}`);
    lines.push(`Summary: ${item.summary}`);
    lines.push(`Why it matters to VoltSafe: ${item.strategicRelevance}`);
    lines.push(`Suggested outreach angle: ${item.suggestedOutreachAngle}`);
    if (item.userNote) lines.push(`User context note: ${item.userNote}`);
    lines.push(`Relevance score: ${item.relevanceScore}/5`);
    lines.push(``);
  });
  lines.push(`Use this news context to write a more timely, relevant, and specific email. Reference the most impactful news item naturally in the opener or reason section.`);
  return lines.join("\n");
}
