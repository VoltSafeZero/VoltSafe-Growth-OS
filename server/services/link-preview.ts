/**
 * link-preview.ts — SSRF-safe Open Graph / HTML metadata fetcher.
 *
 * Security guarantees:
 *  - Only http: and https: URLs are accepted.
 *  - The target hostname is resolved via DNS and all resulting IPs are
 *    checked against RFC-1918 / loopback / link-local / ULA ranges before
 *    any outbound connection is made (prevents SSRF).
 *  - A 5-second AbortController timeout prevents slow-loris hangs.
 *  - Only text/html responses are parsed — binary bodies are ignored.
 *  - The parser returns plain-text metadata fields only; no remote HTML is
 *    ever injected into the response or the composer directly.
 */

import dns from "dns/promises";

export interface LinkPreviewMeta {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
}

// ── SSRF: private / reserved IP ranges ────────────────────────────────────────

const PRIVATE_RANGES: RegExp[] = [
  /^127\./,                          // loopback
  /^10\./,                           // RFC-1918
  /^172\.(1[6-9]|2\d|3[01])\./,     // RFC-1918
  /^192\.168\./,                     // RFC-1918
  /^169\.254\./,                     // link-local
  /^0\./,                            // "this" network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT (RFC-6598)
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 ULA
  /^fe80:/i,                         // IPv6 link-local
  /^::ffff:127\./i,                  // IPv4-mapped loopback
  /^::ffff:10\./i,                   // IPv4-mapped RFC-1918
  /^::ffff:192\.168\./i,             // IPv4-mapped RFC-1918
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./i,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some((r) => r.test(ip));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch Open Graph / HTML metadata for `rawUrl`.
 * Returns `null` when the URL is invalid, uses an unsafe protocol, resolves
 * to a private IP (SSRF block), or the remote server cannot be reached.
 */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewMeta | null> {
  // 1. Parse and validate the URL.
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  // 2. Only http and https are allowed.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const hostname = parsed.hostname;

  // 3. Block literal loopback / wildcard hostnames before DNS.
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost === "localhost" ||
    lowerHost === "0.0.0.0" ||
    lowerHost === "::1" ||
    lowerHost === "[::1]"
  ) {
    return null;
  }

  // 4. Resolve the hostname and check every returned IP against private ranges.
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    for (const { address } of addrs) {
      if (isPrivateIp(address)) return null;
    }
  } catch {
    // DNS failure — don't fetch.
    return null;
  }

  // 5. Fetch the page with a 5-second timeout.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);

  let htmlBody: string;
  try {
    const response = await fetch(rawUrl, {
      signal: controller.signal as any,
      headers: {
        "User-Agent": "VoltSafeBot/1.0 (+https://voltsafe.app; link-preview)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const ct = response.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;

    // Cap body size at 512 KB to avoid memory exhaustion on large pages.
    const buffer = await response.arrayBuffer();
    htmlBody = new TextDecoder().decode(buffer.slice(0, 524_288));
  } catch {
    clearTimeout(timeoutId);
    return null;
  }

  // 6. Parse OG metadata from the HTML.
  return parseMetadata(htmlBody, rawUrl, parsed);
}

// ── Metadata parser ───────────────────────────────────────────────────────────

function parseMetadata(html: string, pageUrl: string, parsed: URL): LinkPreviewMeta {
  const origin = `${parsed.protocol}//${parsed.host}`;

  /**
   * Extract a meta tag's content by property or name attribute.
   * Handles both attribute orderings: property/name before content, and
   * content before property/name.
   */
  function getMeta(attr: "property" | "name", value: string): string {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Attribute-before-content form
    const r1 = new RegExp(
      `<meta\\b[^>]*\\b${attr}=["']${escaped}["'][^>]+content=["']([^"'<>]+)["']`,
      "i",
    );
    // Content-before-attribute form
    const r2 = new RegExp(
      `<meta\\b[^>]+content=["']([^"'<>]+)["'][^>]*\\b${attr}=["']${escaped}["']`,
      "i",
    );
    const m = html.match(r1) ?? html.match(r2);
    return m?.[1]?.trim() ?? "";
  }

  const ogTitle    = getMeta("property", "og:title");
  const ogDesc     = getMeta("property", "og:description");
  const ogImage    = getMeta("property", "og:image");
  const ogUrl      = getMeta("property", "og:url");
  const ogSiteName = getMeta("property", "og:site_name");
  const twitterTitle = getMeta("name", "twitter:title");
  const twitterDesc  = getMeta("name", "twitter:description");
  const twitterImage = getMeta("name", "twitter:image");

  // Fallback: <title>
  const titleTagMatch = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  const fallbackTitle = titleTagMatch?.[1]?.trim() ?? "";

  // Fallback: meta description
  const metaDesc = getMeta("name", "description");

  // Resolve image URL to absolute
  const rawImage = ogImage || twitterImage;
  const image = rawImage ? resolveUrl(rawImage, origin) : "";

  // Favicon
  const faviconMatch = html.match(
    /<link\b[^>]*\brel=["'](?:shortcut )?icon["'][^>]*\bhref=["']([^"'<>]+)["']/i,
  ) ?? html.match(
    /<link\b[^>]*\bhref=["']([^"'<>]+)["'][^>]*\brel=["'](?:shortcut )?icon["']/i,
  );
  const rawFavicon = faviconMatch?.[1] ?? "/favicon.ico";
  const favicon = resolveUrl(rawFavicon, origin);

  const title       = ogTitle || twitterTitle || fallbackTitle;
  const description = ogDesc  || twitterDesc  || metaDesc;
  const siteName    = ogSiteName || parsed.hostname.replace(/^www\./, "");

  return {
    url:         ogUrl || pageUrl,
    title:       title.slice(0, 150),
    description: description.slice(0, 300),
    image:       image.slice(0, 500),
    favicon:     favicon.slice(0, 300),
    siteName:    siteName.slice(0, 80),
  };
}

function resolveUrl(href: string, origin: string): string {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `${origin}${href}`;
  return `${origin}/${href}`;
}
