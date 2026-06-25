/**
 * CRM Recent News Service
 *
 * Handles URL ingestion, article metadata extraction (with SSRF protection),
 * AI-powered summarisation (summary, strategic relevance, outreach angle,
 * key points, relevance score) and compact context assembly for AI email
 * generation.
 *
 * SSRF protection layers (defence-in-depth):
 *  L1 — Protocol allowlist: only http/https accepted
 *  L2 — Hostname regex blocklist: catches literal private IPs / hostnames
 *  L3 — DNS pre-resolution: resolves every hop's hostname; blocks if any
 *        returned IP is private, loopback, link-local, multicast or reserved
 *  L4 — Manual redirect following (max 3): re-runs L1–L3 on each Location
 *        header before following the hop
 *  L5 — Final URL re-check: the URL we actually read is verified again
 */

import dns from "dns/promises";
import net from "net";
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

// ─── Allowed entity types ──────────────────────────────────────────────────────

export const VALID_ENTITY_TYPES = new Set([
  "lead", "account", "contact", "partner",
  "marina", "utility", "port", "investor", "other",
]);

// ─── SSRF — L1/L2: protocol + hostname regex guard ────────────────────────────

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
  /^169\.254\.\d+\.\d+$/,  // link-local + AWS/GCP/Azure metadata service
];

export function isUrlSafe(url: string): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Invalid URL format" };
  }
  // L1 — protocol allowlist
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, reason: `Protocol '${parsed.protocol}' is not allowed; only http and https are permitted` };
  }
  // L2 — hostname regex (catches literal IPs and well-known private hostnames)
  const hostname = parsed.hostname;
  for (const re of PRIVATE_IP_RE) {
    if (re.test(hostname)) {
      return { ok: false, reason: "Private/internal hostnames and IPs are not allowed" };
    }
  }
  return { ok: true };
}

// ─── SSRF — L3: DNS pre-resolution IP check ───────────────────────────────────

/**
 * Returns true if the given IP address string (IPv4 or IPv6) falls in a
 * private, loopback, link-local, multicast, or reserved range.
 */
export function isIpPrivate(ip: string): boolean {
  // --- IPv4 ---
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b, c] = parts;
    if (a === 0)                                    return true;  // 0.0.0.0/8      this-network
    if (a === 10)                                   return true;  // 10.0.0.0/8     RFC-1918
    if (a === 100 && b >= 64 && b <= 127)           return true;  // 100.64.0.0/10  CGNAT (RFC-6598)
    if (a === 127)                                  return true;  // 127.0.0.0/8    loopback
    if (a === 169 && b === 254)                     return true;  // 169.254.0.0/16 link-local / metadata
    if (a === 172 && b >= 16 && b <= 31)            return true;  // 172.16.0.0/12  RFC-1918
    if (a === 192 && b === 0 && c === 0)            return true;  // 192.0.0.0/24   IETF protocol assignments
    if (a === 192 && b === 168)                     return true;  // 192.168.0.0/16 RFC-1918
    if (a === 198 && (b === 18 || b === 19))        return true;  // 198.18.0.0/15  benchmarking
    if (a === 198 && b === 51 && c === 100)         return true;  // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0 && c === 113)          return true;  // 203.0.113.0/24 TEST-NET-3
    if (a >= 224)                                   return true;  // 224.0.0.0/4    multicast + reserved
    return false;
  }
  // --- IPv6 ---
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (norm === "::" || norm === "::1")            return true;  // unspecified / loopback
    if (norm.startsWith("::ffff:"))                 return true;  // IPv4-mapped (check inner IPv4 below)
    if (norm.startsWith("fc") || norm.startsWith("fd")) return true;  // fc00::/7 ULA
    // fe80::/10 link-local covers fe80–febf
    const prefix16 = norm.replace(/:/g, "").slice(0, 4);
    const p = parseInt(prefix16, 16);
    if (p >= 0xfe80 && p <= 0xfebf)                return true;  // fe80::/10 link-local
    if (norm.startsWith("ff"))                      return true;  // ff00::/8  multicast
    return false;
  }
  return false;  // neither IPv4 nor IPv6 — allow (shouldn't happen)
}

/**
 * Resolve a hostname via DNS and confirm none of the returned addresses
 * are private/internal.  For literal IP addresses the regex guard (L2)
 * is the primary check; this function adds defence-in-depth.
 */
async function dnsCheckHostname(hostname: string): Promise<{ ok: boolean; reason?: string }> {
  // If it's already a literal IP, isIpPrivate is enough.
  if (net.isIP(hostname)) {
    return isIpPrivate(hostname)
      ? { ok: false, reason: `IP address ${hostname} is private/internal/reserved` }
      : { ok: true };
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true, family: 0 });
    for (const { address } of addresses) {
      if (isIpPrivate(address)) {
        return { ok: false, reason: `Hostname '${hostname}' resolves to private/internal IP (${address})` };
      }
    }
    if (addresses.length === 0) {
      return { ok: false, reason: `Hostname '${hostname}' did not resolve to any address` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: `DNS resolution failed for '${hostname}': ${err?.message || "unknown"}` };
  }
}

/**
 * Full SSRF check for a URL string: protocol allowlist (L1) + hostname regex
 * (L2) + DNS pre-resolution (L3).  Used on every hop of a redirect chain.
 */
async function fullSsrfCheck(url: string): Promise<{ ok: boolean; reason?: string }> {
  const syntaxCheck = isUrlSafe(url);  // L1 + L2
  if (!syntaxCheck.ok) return syntaxCheck;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, reason: "Invalid URL" }; }
  return dnsCheckHostname(parsed.hostname);  // L3
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

// ─── Article fetch (with full SSRF protection) ─────────────────────────────────

export interface ArticleMetadata {
  title: string | null;
  source: string | null;
  author: string | null;
  publishedAt: string | null;
  description: string | null;
  extractedText: string | null;
  fetchError: string | null;
}

const MAX_RESPONSE_BYTES = 2_000_000;  // 2 MB
const FETCH_TIMEOUT_MS   = 12_000;     // 12 s
const MAX_REDIRECTS      = 3;          // max hops we'll follow

const FETCH_HEADERS = {
  "User-Agent": "VoltSafeBot/1.0 (news article context extraction)",
  "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
};

export async function fetchArticleMetadata(url: string): Promise<ArticleMetadata> {
  const EMPTY: ArticleMetadata = { title: null, source: null, author: null, publishedAt: null, description: null, extractedText: null, fetchError: null };

  // ── L1 + L2: syntax + hostname regex check ───────────────────────────────
  const syntaxCheck = isUrlSafe(url);
  if (!syntaxCheck.ok) {
    return { ...EMPTY, fetchError: syntaxCheck.reason || "URL not allowed" };
  }

  // ── L3: DNS pre-resolution of the initial URL ─────────────────────────────
  try {
    const dnsCheck = await fullSsrfCheck(url);
    if (!dnsCheck.ok) {
      return { ...EMPTY, fetchError: dnsCheck.reason || "URL blocked by SSRF protection" };
    }
  } catch {
    return { ...EMPTY, fetchError: "DNS pre-check failed" };
  }

  // ── L4: Manual redirect following (max 3 hops, per-hop SSRF check) ────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let currentUrl = url;
    let res!: Response;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",   // we handle redirects ourselves
        headers: FETCH_HEADERS,
      });

      // Is this a redirect?
      if (res.status >= 300 && res.status < 400) {
        if (hop >= MAX_REDIRECTS) {
          return { ...EMPTY, fetchError: `Too many redirects (max ${MAX_REDIRECTS})` };
        }
        const location = res.headers.get("location");
        if (!location) {
          return { ...EMPTY, fetchError: "Redirect with no Location header" };
        }
        // Resolve relative Location against the current URL
        const nextUrl = new URL(location, currentUrl).toString();

        // L1 + L2 + L3 on each hop
        const hopCheck = await fullSsrfCheck(nextUrl);
        if (!hopCheck.ok) {
          return { ...EMPTY, fetchError: `Redirect blocked: ${hopCheck.reason}` };
        }

        currentUrl = nextUrl;
        continue;  // follow the hop
      }

      // Non-redirect — we're done navigating
      break;
    }

    // ── L5: Final URL re-check ─────────────────────────────────────────────
    // res.url on a manual-redirect fetch reflects the final URL we fetched
    if (res.url && res.url !== url) {
      const finalCheck = isUrlSafe(res.url);
      if (!finalCheck.ok) {
        return { ...EMPTY, fetchError: `Redirect to restricted URL blocked` };
      }
    }

    if (!res.ok) {
      return { ...EMPTY, fetchError: `HTTP ${res.status}` };
    }

    // ── Content-type guard ─────────────────────────────────────────────────
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { ...EMPTY, fetchError: "Not an HTML page" };
    }

    // ── Max response size ──────────────────────────────────────────────────
    const buffer = await res.arrayBuffer();
    const slice = buffer.byteLength > MAX_RESPONSE_BYTES ? buffer.slice(0, MAX_RESPONSE_BYTES) : buffer;
    const html = new TextDecoder().decode(slice);

    // ── Extract metadata — raw HTML is NEVER returned to clients ───────────
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
      // Stored for AI summarisation only. Never returned to clients, never used in email prompts.
      extractedText: extractPlainText(html) || null,
      fetchError:    null,
    };
  } catch (err: any) {
    const msg = err?.name === "AbortError"
      ? "Fetch timeout (12s)"
      : String(err?.message || "Unknown fetch error").slice(0, 200);
    return { ...EMPTY, fetchError: msg };
  } finally {
    clearTimeout(timer);
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
5 = High-priority strategic trigger — very strong sales or partnership signal

Domain context for scoring: shore power, smart marina pedestals, smart connectors, marina electrification, safety, leakage detection, energy management, ports, utilities, infrastructure upgrades, grants/funding, sustainability, compliance, customer pain signals.`;

export async function generateNewsAiSummary(
  url: string,
  title: string | null,
  source: string | null,
  description: string | null,
  extractedText: string | null,  // used ONLY for this summarisation step — never email prompts
  userNote: string | null,
  entityContext: string,
): Promise<NewsAiResult | null> {
  const openai = buildOpenAIClient();
  if (!openai) return null;

  const contentBlock = [
    title       ? `Title: ${title}`                                   : null,
    source      ? `Source: ${source}`                                 : null,
    description ? `Description: ${description}`                       : null,
    extractedText ? `Article text:\n${extractedText.slice(0, 4000)}` : null,
    userNote    ? `User note: ${userNote}`                            : null,
  ].filter(Boolean).join("\n\n");

  if (!contentBlock.trim()) return null;

  try {
    const resp = await openai.chat.completions.create({
      ...buildOpenAIModelParams(),
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user",   content: `CRM entity context: ${entityContext}\n\nArticle URL: ${url}\n\n${contentBlock}` },
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
      meta.extractedText,   // used here for AI summarisation only
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
    // extracted_text stored server-side only — never returned to clients or AI email prompts
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
  useInEmailContext: boolean;
  userNote: string | null;
  url: string;
}

// Priority ordering for email context:
// 1. use_in_email_context = TRUE (user-pinned)
// 2. ai_relevance_score DESC
// 3. published_at DESC (newer first)
// 4. added_at DESC
const EMAIL_CONTEXT_ORDER = `
  use_in_email_context DESC,
  ai_relevance_score DESC NULLS LAST,
  published_at DESC NULLS LAST,
  added_at DESC
`.trim();

export async function getRecentNewsContext(
  entityType: string,
  entityId: number,
  maxItems = 6,
  selectedIds?: number[],
): Promise<NewsContextItem[]> {
  try {
    if (!VALID_ENTITY_TYPES.has(entityType)) return [];
    const eid = Number(entityId);
    let where = `entity_type = '${entityType}' AND entity_id = ${eid} AND is_archived = FALSE AND ai_status = 'done' AND ai_summary IS NOT NULL`;
    if (selectedIds && selectedIds.length > 0) {
      where += ` AND id IN (${selectedIds.map(Number).join(",")})`;
    } else if (selectedIds !== undefined) {
      return [];
    }
    // NOTE: extracted_text is intentionally excluded from this SELECT
    const rows = (await db.execute(sql.raw(`
      SELECT id, title, source, published_at, ai_summary, strategic_relevance,
             suggested_outreach_angle, ai_relevance_score, use_in_email_context, user_note, url
      FROM crm_recent_news
      WHERE ${where}
      ORDER BY ${EMAIL_CONTEXT_ORDER}
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
      useInEmailContext:       Boolean(r.use_in_email_context),
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
    if (!VALID_ENTITY_TYPES.has(entityType)) return [];
    const eid = Number(entityId);
    // NOTE: extracted_text intentionally excluded — it is for server-side AI processing only
    const rows = (await db.execute(sql.raw(`
      SELECT id, title, source, published_at, ai_summary, strategic_relevance,
             suggested_outreach_angle, ai_relevance_score, use_in_email_context, user_note, url, added_at
      FROM crm_recent_news
      WHERE entity_type = '${entityType}' AND entity_id = ${eid}
        AND is_archived = FALSE AND ai_status = 'done' AND ai_summary IS NOT NULL
      ORDER BY ${EMAIL_CONTEXT_ORDER}
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
      useInEmailContext:       Boolean(r.use_in_email_context),
      userNote:               r.user_note ? String(r.user_note) : null,
      url:                    String(r.url || ""),
      addedAt:                String(r.added_at || ""),
    }));
  } catch {
    return [];
  }
}

/**
 * Build compressed Recent News context block for AI email prompts.
 *
 * HARD RULES:
 * - extracted_text is NEVER included (it is stored server-side for
 *   summarisation only and must never reach email generation prompts)
 * - raw article HTML is never included
 * - Full-detail treatment for first 3 items (sorted by pin → score → date)
 * - Items 4+ become compact one-line bullets
 * - Hard cap: 4 000 characters total (≈ 1 000 tokens); block is truncated
 *   at a safe word boundary if it exceeds this limit
 */

const MAX_CONTEXT_CHARS = 4_000;

export function buildNewsContextBlock(items: NewsContextItem[]): string {
  if (!items.length) return "";

  const DETAIL_LIMIT = 3;
  const detailed = items.slice(0, DETAIL_LIMIT);
  const bullets  = items.slice(DETAIL_LIMIT);

  const lines: string[] = [
    `=== RECENT NEWS CONTEXT ===`,
    `The following news articles are relevant to this lead/account and should inform the outreach angle, timing, and tone of the email.`,
    ``,
  ];

  // Full-detail items — only AI-distilled summary fields, never raw scraped content
  detailed.forEach((item, i) => {
    lines.push(`📰 [News ${i + 1}] ${item.title}`);
    if (item.source)      lines.push(`Source: ${item.source}${item.publishedAt ? ` | Published: ${item.publishedAt}` : ""}`);
    lines.push(`Relevance score: ${item.relevanceScore}/5`);
    lines.push(`Summary: ${item.summary}`);
    lines.push(`Why it matters to VoltSafe: ${item.strategicRelevance}`);
    lines.push(`Suggested outreach angle: ${item.suggestedOutreachAngle}`);
    if (item.userNote)    lines.push(`User context note: ${item.userNote}`);
    lines.push(``);
  });

  // Compact one-line bullets for lower-priority items
  if (bullets.length > 0) {
    lines.push(`Additional context (lower priority):`);
    bullets.forEach(item => {
      const meta = [item.source, item.publishedAt].filter(Boolean).join(", ");
      const snippet = item.summary.length > 120 ? item.summary.slice(0, 120) + "…" : item.summary;
      lines.push(`• ${item.title}${meta ? ` (${meta})` : ""} — ${snippet}`);
    });
    lines.push(``);
  }

  lines.push(`Use this news context to write a more timely, relevant, and specific email. Reference the most impactful news item naturally in the opener or reason section.`);

  const block = lines.join("\n");

  // ── Hard character budget ────────────────────────────────────────────────
  if (block.length <= MAX_CONTEXT_CHARS) return block;

  // Truncate safely at the last newline before the limit, never mid-HTML
  const cutoff = block.lastIndexOf("\n", MAX_CONTEXT_CHARS);
  return (cutoff > 0 ? block.slice(0, cutoff) : block.slice(0, MAX_CONTEXT_CHARS))
    + "\n[…news context truncated to stay within token budget]";
}
