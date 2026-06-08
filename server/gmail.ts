// Gmail integration via Google OAuth2 (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)
// All functions accept an optional accountId — when provided (shared mailbox access),
// the token for that specific account is used regardless of which user is calling.
import fs from "fs";
import path from "path";
import { getGmailClient } from "./gmail-oauth";

function decodeBase64(data: string) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function rfc2047EncodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return decodeBase64(part.body.data);
      }
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }
  return "";
}

function extractHtmlBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractHtmlBody(part);
      if (result) return result;
    }
  }
  return "";
}

function getHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

export async function listThreads(userId: number, query: string = "", maxResults: number = 30, accountId?: number) {
  const gmail = await getGmailClient(userId, accountId);
  const res = await gmail.users.threads.list({
    userId: "me",
    maxResults,
    q: query,
  });
  return res.data.threads || [];
}

export async function getThread(userId: number, threadId: string, accountId?: number) {
  const gmail = await getGmailClient(userId, accountId);
  const res = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });
  const thread = res.data;
  const messages = (thread.messages || []).map((msg) => {
    const headers = msg.payload?.headers || [];
    const htmlBody = extractHtmlBody(msg.payload);
    const textBody = extractBody(msg.payload);
    return {
      id: msg.id,
      threadId: msg.threadId,
      snippet: msg.snippet,
      internalDate: msg.internalDate,
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      cc: getHeader(headers, "Cc"),
      subject: getHeader(headers, "Subject"),
      date: getHeader(headers, "Date"),
      labelIds: msg.labelIds || [],
      body: htmlBody || textBody,
      isHtml: !!htmlBody,
    };
  });
  return { id: thread.id, historyId: thread.historyId, messages };
}

export async function getMessageSummaries(userId: number, maxResults: number = 50, query: string = "", pageToken?: string, accountId?: number) {
  const gmail = await getGmailClient(userId, accountId);
  const listRes = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: query,
    ...(pageToken ? { pageToken } : {}),
  });
  const messageIds = listRes.data.messages || [];
  const nextPageToken = listRes.data.nextPageToken || null;
  // Fetch message details in batches of 10 to stay within Gmail API rate limits
  // (firing all 50 simultaneously causes 429/rate-limit errors on subsequent pages)
  const BATCH = 10;
  const summaries: Awaited<ReturnType<typeof fetchOne>>[] = [];
  async function fetchOne(id: string) {
    const msg = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"],
    });
    const headers = msg.data.payload?.headers || [];
    return {
      id: msg.data.id,
      threadId: msg.data.threadId,
      snippet: msg.data.snippet,
      internalDate: msg.data.internalDate,
      labelIds: msg.data.labelIds || [],
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      subject: getHeader(headers, "Subject"),
      date: getHeader(headers, "Date"),
    };
  }
  for (let i = 0; i < messageIds.length; i += BATCH) {
    const chunk = messageIds.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map(({ id }) => fetchOne(id!)));
    summaries.push(...results);
  }
  return { summaries, nextPageToken };
}

export async function markMessageRead(userId: number, messageId: string, accountId?: number) {
  const gmail = await getGmailClient(userId, accountId);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

function mimeBase64(content: string): string {
  const b64 = Buffer.from(content, "utf-8").toString("base64");
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
}

export type MimeAttachment = { name: string; mimeType: string; data: Buffer };
export type CidImage = { cid: string; mimeType: string; data: Buffer; filename?: string };

// Map file extension to MIME type for CTA images.
function mimeTypeFromExt(ext: string): string {
  const m: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  return m[ext.toLowerCase()] ?? "image/png";
}

/**
 * Generic CID inline-image rule for all signature / CTA HTML.
 *
 * For every unique `<img src="…">` found inside the signature section:
 *   • Exactly ONE CID MIME part is generated (duplicates are deduplicated).
 *   • The part sits inside `multipart/related` — never under `multipart/mixed`.
 *   • The part carries `Content-Disposition: inline; filename="…"`.
 *   • The HTML `src="…"` is rewritten to `src="cid:<id>"`.
 *   • The surrounding `<a href>` tracking/demo link is preserved.
 *   • The part is NEVER added as a normal file attachment.
 *
 * Works for all image formats (PNG, JPG, JPEG, GIF, WebP), any number of CTA
 * assets, any user's signature, immediate send, and scheduled send.
 *
 * Resolution order for each `src` found in the signature section:
 *   1. `/assets/cta/<filename>` → read from `ctaAssetsDir` on disk (no HTTP).
 *   2. Any `https://` or `http://` URL → fetched server-side with a 10 s timeout.
 *   3. Anything else (data:, cid:, protocol-relative, relative without /assets/cta/)
 *      → skipped (left as-is).
 *
 * If no signature markers are present the function falls back to legacy behaviour:
 * only local `/assets/cta/` files are inlined, no external fetches are made.
 *
 * All matched `src="…"` attributes in the **full** `html` string are rewritten
 * to `src="cid:<id>"`. The returned `inlineImages` array is passed to
 * `buildMimeRaw` which places them inside `multipart/related`.
 */
export async function extractCtaInlineImages(
  html: string,
  ctaAssetsDir: string,
): Promise<{ html: string; inlineImages: CidImage[] }> {
  const seen = new Map<string, CidImage>(); // full src value → CidImage
  let cidIndex = 0;
  // CID base: short alphanumeric timestamp — no @, no slashes, no file extensions.
  const cidBase = Date.now().toString(36);

  // ── Identify scan scope ──────────────────────────────────────────────────
  // Prefer the signature section so we never accidentally inline body images.
  const sigMatch = /<!--vs-sig-start-->([\s\S]*?)<!--vs-sig-end-->/i.exec(html);

  if (sigMatch) {
    // ── New path: scan sig section, inline ALL images ──────────────────────
    const sigHtml = sigMatch[1];
    const srcRe = /\bsrc="([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = srcRe.exec(sigHtml)) !== null) {
      const src = m[1];
      if (!src || src.startsWith("cid:")) continue;

      // ── data: URI images — create CID parts directly from embedded base64 ──
      // Covers the case where cta_image_url was pre-resolved to a data URI at
      // signature build time (disk file available but UUID-named path was lost
      // after a production deploy wipe).
      if (src.startsWith("data:")) {
        if (seen.has(src)) continue;
        const dataMatch = src.match(/^data:(image\/[a-zA-Z+]+);base64,([A-Za-z0-9+/=\r\n]+)/);
        if (dataMatch) {
          const mimeType = dataMatch[1];
          const data = Buffer.from(dataMatch[2].replace(/[\r\n]/g, ""), "base64");
          const cid = `vsig${cidIndex++}${cidBase}`;
          const ext = mimeType.split("/")[1].split("+")[0].replace(/[^a-z]/gi, "") || "png";
          const fname = `sig-image-${cidIndex}.${ext}`;
          console.log(`[sig-cid] ✓ data:URI mimeType=${mimeType} bytes=${data.byteLength} cid=${cid}`);
          seen.set(src, { cid, mimeType: mimeType as any, data, filename: fname });
        } else {
          console.error(`[sig-cid] data:URI parse failed — not base64 or unrecognized MIME: "${src.slice(0, 80)}"`);
        }
        continue;
      }

      if (seen.has(src)) continue;

      const rawExt = src.split("?")[0].split("/").pop()?.split(".").pop() ?? "png";
      const mimeType = mimeTypeFromExt(rawExt.toLowerCase());
      let data: Buffer | null = null;

      // Fast path – local /assets/cta/ file (no HTTP).
      const ctaFileMatch = src.match(/\/assets\/cta\/([^"'?#\s]+)/);
      if (ctaFileMatch) {
        const fp = path.join(ctaAssetsDir, ctaFileMatch[1]);
        try { if (fs.existsSync(fp)) data = fs.readFileSync(fp); } catch { /* unreadable */ }
      }

      // Slow path – fetch any other HTTP/HTTPS URL (10 s timeout — matches inlineImagesAsBase64).
      if (!data && (src.startsWith("https://") || src.startsWith("http://"))) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 10000);
          const resp = await fetch(src, { signal: ctrl.signal });
          clearTimeout(timer);
          if (resp.ok) data = Buffer.from(await resp.arrayBuffer());
        } catch { /* timeout / network error — leave URL as-is */ }
      }

      if (!data) {
        console.error(`[sig-cid] FAILED to load signature image — src="${src}" ctaLocalMatch=${!!ctaFileMatch}`);
        continue;
      }
      // CID: purely alphanumeric, no @, no slashes, no file extensions.
      const cid = `vsig${cidIndex++}${cidBase}`;
      // Derive a clean filename for Content-Type name= and Content-Disposition filename= parameters.
      const fname = (() => {
        const ctaName = src.match(/\/assets\/cta\/([^"'?#\s/]+)$/);
        if (ctaName) return ctaName[1];
        try { return new URL(src).pathname.split("/").pop() || "inline-image.png"; } catch { /* */ }
        return "inline-image.png";
      })();
      console.log(`[sig-cid] ✓ src="${src.slice(0, 80)}" bytes=${data.byteLength} cid=${cid} type=${mimeType} fname=${fname} path=${ctaFileMatch ? "disk" : "fetch"}`);
      seen.set(src, { cid, mimeType, data, filename: fname });
    }
  } else {
    // ── Legacy fallback: no sig markers — only /assets/cta/ local files ───
    // Scan for src attributes whose value contains /assets/cta/ so we store
    // the FULL src value (relative or absolute) as the map key.  The rewrite
    // loop below then builds a regex from that same full src, guaranteeing a
    // match regardless of whether the URL is "/assets/cta/logo.png" or
    // "https://image-linker-xxx.replit.app/assets/cta/logo.png".
    const srcRe = /\bsrc="([^"]*\/assets\/cta\/[^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = srcRe.exec(html)) !== null) {
      const src = m[1]; // full src value, e.g. "/assets/cta/logo.png" or "https://…/assets/cta/logo.png"
      if (seen.has(src)) continue;
      const ctaMatch = src.match(/\/assets\/cta\/([^"'?#\s/]+)/);
      if (!ctaMatch) continue;
      const filename = ctaMatch[1]; // bare filename, e.g. "logo.png"
      const filePath = path.join(ctaAssetsDir, filename);
      try {
        if (!fs.existsSync(filePath)) {
          console.error(`[sig-cid] CTA file not found on disk — path="${filePath}" src="${src}"`);
          continue;
        }
        const data = fs.readFileSync(filePath);
        const ext = (filename.split(".").pop() ?? "png").toLowerCase();
        // Use just the bare filename (last segment) for MIME name= and Content-Disposition filename=.
        const fname = filename.split("/").pop() ?? filename;
        seen.set(src, {
          cid: `vsig${cidIndex++}${cidBase}`,
          mimeType: mimeTypeFromExt(ext),
          data,
          filename: fname,
        });
      } catch (e: any) {
        console.error(`[sig-cid] CTA file read error — path="${filePath}" error="${e?.message}"`);
      }
    }
  }

  if (seen.size === 0) return { html, inlineImages: [] };

  // ── Rewrite all matched src attributes in the full HTML ──────────────────
  let rewritten = html;
  for (const [src, cidImg] of seen.entries()) {
    const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match src="<exact-url>" anywhere in the HTML (both sig and body).
    const pat = new RegExp(`(\\bsrc=")${escapedSrc}(")`,"g");
    rewritten = rewritten.replace(pat, `$1cid:${cidImg.cid}$2`);
  }

  // ── Integrity check ──────────────────────────────────────────────────────
  // Every CID part we created must have a matching cid: reference in the HTML.
  // A mismatch means the rewrite failed (key/src mismatch) — the image will
  // appear as an orphaned attachment card instead of rendering inline.
  for (const [src, cidImg] of seen.entries()) {
    if (!rewritten.includes(`cid:${cidImg.cid}`)) {
      console.error(
        `[sig-cid] INTEGRITY FAIL: CID part created but no cid: reference in HTML — ` +
        `cid=${cidImg.cid} src="${src.slice(0, 120)}". ` +
        `Image will render as attachment card, not inline.`
      );
    }
  }

  // ── Neutralise <a href> attributes that still point to inlined image files ──
  // Apple Mail treats <a href="image.png"><img src="cid:x"> as two things: the
  // CID img (renders inline) AND the href file (shown as an attachment card).
  // This happens when destination_url in the CTA config equals the image_url, or
  // when tracking is disabled and the link was never replaced by wrapSignatureCtaLinks.
  // Fix: replace any href that points to an image-file URL we just inlined with
  // "#" so Apple Mail has no file URL to attach. If a proper destination URL was
  // set and tracking is enabled, wrapSignatureCtaLinks already replaced the href
  // with a /track/ redirect BEFORE this function runs — such hrefs are safe.
  const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|webp)(\?[^"]*)?$/i;
  for (const [src] of seen.entries()) {
    // Only strip hrefs that look like image file URLs.
    if (!IMAGE_EXT_RE.test(src.split("?")[0])) continue;
    const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hrefPat = new RegExp(`(\\bhref=")${escapedSrc}(")`,"g");
    if (hrefPat.test(rewritten)) {
      console.log(`[sig-cid] stripped image href="${src.slice(0, 80)}" → "#" (Apple Mail attachment prevention)`);
      hrefPat.lastIndex = 0;
      rewritten = rewritten.replace(hrefPat, `$1#$2`);
    }
  }

  return { html: rewritten, inlineImages: Array.from(seen.values()) };
}

function buildMimeRaw(
  from: string,
  to: string,
  subject: string,
  body: string,
  attachments: MimeAttachment[] = [],
  cc?: string,
  bcc?: string,
  icalContent?: string,
  inlineImages: CidImage[] = [],
): string {
  const R = "\r\n";
  const ts = Date.now();
  const plainText = body
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const extraHeaders: string[] = [];
  if (cc)  extraHeaders.push(`Cc: ${cc}`);
  if (bcc) extraHeaders.push(`Bcc: ${bcc}`);

  const needsInline  = inlineImages.length > 0;
  // iCal invite present → must use multipart/mixed so email clients show RSVP buttons.
  const needsMixed   = attachments.length > 0 || !!icalContent;

  const plainB64 = mimeBase64(plainText);
  const htmlB64  = mimeBase64(body);

  // ── Inline image MIME parts ─────────────────────────────────────────────
  // These parts are always children of multipart/related, never multipart/mixed.
  // RFC 2392: Content-ID links the part to the src="cid:…" reference in HTML.
  // Content-Disposition: inline; filename="…" tells Apple Mail the part is
  // inline-only and must NOT be surfaced as a download attachment card.
  // name= on Content-Type + filename= on Content-Disposition are both required
  // so that Apple Mail, Outlook, and Gmail all recognise the part as inline.
  const inlineParts = (bnd: string): string[] =>
    inlineImages.flatMap((img) => {
      const b64 = img.data.toString("base64").match(/.{1,76}/g)?.join(R) ?? "";
      const fname = img.filename ?? "inline-image.png";
      return [
        `--${bnd}`,
        `Content-Type: ${img.mimeType}; name="${fname}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-ID: <${img.cid}>`,
        `Content-Disposition: inline; filename="${fname}"`,
        ``,
        b64,
        ``,
      ];
    });

  // ── Attachment + iCal MIME parts ────────────────────────────────────────
  const attachmentParts = (bnd: string): string[] => {
    const parts: string[] = [];
    for (const att of attachments) {
      const b64 = att.data.toString("base64").match(/.{1,76}/g)?.join(R) ?? "";
      parts.push(
        `--${bnd}`, `Content-Type: ${att.mimeType}; name="${att.name}"`,
        `Content-Transfer-Encoding: base64`, `Content-Disposition: attachment; filename="${att.name}"`,
        ``, b64, ``
      );
    }
    if (icalContent) {
      const icalB64 = Buffer.from(icalContent, "utf-8").toString("base64").match(/.{1,76}/g)?.join(R) ?? "";
      parts.push(`--${bnd}`, `Content-Type: text/calendar; method=REQUEST; charset=UTF-8`,
        `Content-Transfer-Encoding: base64`, `Content-Disposition: inline`, ``, icalB64, ``);
      parts.push(`--${bnd}`, `Content-Type: application/ics; name="invite.ics"`,
        `Content-Transfer-Encoding: base64`, `Content-Disposition: attachment; filename="invite.ics"`,
        ``, icalB64, ``);
    }
    return parts;
  };

  // ── Correct RFC 2387 MIME structure ─────────────────────────────────────
  //
  //  Case A — no inline images, no attachments:
  //    multipart/alternative [altBnd]
  //      text/plain
  //      text/html
  //
  //  Case B — inline images, no attachments:
  //    multipart/related; type="text/html" [relBnd]  ← ROOT
  //      text/html                                   ← DIRECT first child (no alt wrapper)
  //      image/* (Content-ID: <cid>, Content-Disposition: inline; filename=)
  //      image/* …
  //
  //  Case C — inline images + attachments:
  //    multipart/mixed [mixBnd]
  //      multipart/related; type="text/html" [relBnd]  ← first child
  //        text/html                                   ← DIRECT first child (no alt wrapper)
  //        image/* (Content-ID: <cid>, Content-Disposition: inline; filename=)
  //      attachment …
  //
  //  CRITICAL: Cases B and C must NOT wrap text/html in multipart/alternative.
  //  Gmail's API canonicalizes related→[alternative→[plain,html],CID] into a flat
  //  multipart/mixed where CID parts become siblings of text/html (i.e. broken:
  //  images appear as separate attachment cards instead of rendering inline).
  //  The ONLY layout Gmail preserves is: related → [text/html DIRECT, CID parts].
  //  text/plain is intentionally omitted from Cases B and C.
  //
  //  Case D — attachments only, no inline images:
  //    multipart/mixed [mixBnd]
  //      multipart/alternative [altBnd]
  //        text/plain
  //        text/html
  //      attachment …

  const hdr = [
    `From: ${from}`,
    `To: ${to}`,
    ...extraHeaders,
    `Subject: ${rfc2047EncodeHeader(subject || "")}`,
    `MIME-Version: 1.0`,
  ];

  let lines: string[];

  if (!needsInline && !needsMixed) {
    // Case A
    const altBnd = `vs_alt_${ts}`;
    lines = [
      ...hdr,
      `Content-Type: multipart/alternative; boundary="${altBnd}"`,
      ``,
      `--${altBnd}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      plainB64,
      ``,
      `--${altBnd}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      htmlB64,
      ``,
      `--${altBnd}--`,
    ];
  } else if (needsInline && !needsMixed) {
    // Case B — multipart/related is the ROOT; text/html is the DIRECT first child.
    // NO multipart/alternative wrapper. NO text/plain part.
    // Gmail canonicalizes related→[alternative→[plain,html],CID] into a broken flat
    // multipart/mixed where CID parts become siblings of text/html (images appear as
    // separate attachment cards, not rendered inline). The only layout that survives
    // Gmail's canonicalization is: related → [text/html DIRECT, CID parts].
    const relBnd = `vs_rel_${ts}`;
    lines = [
      ...hdr,
      `Content-Type: multipart/related; boundary="${relBnd}"; type="text/html"`,
      ``,
      `--${relBnd}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      htmlB64,
      ``,
      ...inlineParts(relBnd),
      `--${relBnd}--`,
    ];
  } else if (needsInline && needsMixed) {
    // Case C — multipart/mixed wraps multipart/related; same no-alternative rule as B.
    //   multipart/mixed [mixBnd]
    //     multipart/related; type="text/html" [relBnd]
    //       text/html (direct — no alternative wrapper)
    //       image/* CID parts …
    //     real file attachments …
    const mixBnd = `vs_mix_${ts + 1}`;
    const relBnd = `vs_rel_${ts}`;
    lines = [
      ...hdr,
      `Content-Type: multipart/mixed; boundary="${mixBnd}"`,
      ``,
      `--${mixBnd}`,
      `Content-Type: multipart/related; boundary="${relBnd}"; type="text/html"`,
      ``,
      `--${relBnd}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      htmlB64,
      ``,
      ...inlineParts(relBnd),
      `--${relBnd}--`,
      ``,
      ...attachmentParts(mixBnd),
      `--${mixBnd}--`,
    ];
  } else {
    // Case D — attachments only, no inline images
    const mixBnd = `vs_mix_${ts + 2}`;
    const altBnd = `vs_alt_${ts}`;
    lines = [
      ...hdr,
      `Content-Type: multipart/mixed; boundary="${mixBnd}"`,
      ``,
      `--${mixBnd}`,
      `Content-Type: multipart/alternative; boundary="${altBnd}"`,
      ``,
      `--${altBnd}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      plainB64,
      ``,
      `--${altBnd}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      htmlB64,
      ``,
      `--${altBnd}--`,
      ``,
      ...attachmentParts(mixBnd),
      `--${mixBnd}--`,
    ];
  }

  return Buffer.from(lines.join(R))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Returns the raw decoded MIME string for diagnostics (not base64url encoded). */
export function buildMimeRawDebug(
  from: string, to: string, subject: string, body: string,
  attachments: MimeAttachment[] = [], cc?: string, bcc?: string,
  icalContent?: string, inlineImages: CidImage[] = [],
): string {
  const b64url = buildMimeRaw(from, to, subject, body, attachments, cc, bcc, icalContent, inlineImages);
  return Buffer.from(b64url.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

// ── Last-sent debug state (dev only) ────────────────────────────────────────
interface LastSentDebugState {
  timestamp: string;
  to: string;
  subject: string;
  from: string;
  inlineImageCount: number;
  mimeTree: string;
  rawMime: string;
}
let _lastSentDebugState: LastSentDebugState | null = null;
export function getLastSentDebugState(): LastSentDebugState | null { return _lastSentDebugState; }

export async function sendEmail(
  userId: number,
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  attachments: MimeAttachment[] = [],
  accountId?: number,
  cc?: string,
  bcc?: string,
  icalContent?: string,
  inlineImages: CidImage[] = [],
) {
  const gmail = await getGmailClient(userId, accountId);
  const profileRes = await gmail.users.getProfile({ userId: "me" });
  const from = profileRes.data.emailAddress!;

  // ── FINAL MANDATORY CID GATE ─────────────────────────────────────────────
  // This runs unconditionally for EVERY send path (immediate, scheduled,
  // reply, forward, draft-send).  Earlier pipeline stages may have produced a
  // converted HTML string that was then copied/reassembled into a different
  // variable before being passed here.  This gate takes the exact HTML that is
  // about to be serialised, runs extractCtaInlineImages one final time, merges
  // the resulting CID parts, then asserts the HTML is clean before continuing.
  {
    const _cidGateAssetsDir = path.resolve("uploads/cta-assets");
    // Count /assets/cta/ src= references BEFORE conversion (diagnostic only).
    const _assetSrcRe = /\/assets\/cta\//gi;
    const _htmlPreviewBefore = body.slice(0, 300);
    const _origAssetImgCount = (body.match(_assetSrcRe) ?? []).length;

    const _cidGate = await extractCtaInlineImages(body, _cidGateAssetsDir);
    body = _cidGate.html;

    // Merge new CID parts — deduplicate by cid so we never double-attach.
    const _existingCids = new Set(inlineImages.map(i => i.cid));
    for (const img of _cidGate.inlineImages) {
      if (!_existingCids.has(img.cid)) {
        inlineImages = [...inlineImages, img];
        _existingCids.add(img.cid);
      }
    }

    const _htmlPreviewAfter = body.slice(0, 300);
    const _leftoverAssetUrls = (body.match(/\/assets\/cta\/[^"'\s]*/gi) ?? []);
    const _leftoverHostUrls  = (body.match(/image-linker[^"'\s]*/gi) ?? []);
    const _contentIds         = inlineImages.map(i => i.cid);
    const _missingCidRefs     = _contentIds.filter(cid => !body.includes(`src="cid:${cid}"`));
    const _finalCidImgCount   = (body.match(/src="cid:/gi) ?? []).length;

    console.log("[FINAL-CID-GATE]", {
      originalAssetImgCount: _origAssetImgCount,
      finalCidImgCount: _finalCidImgCount,
      inlineImagesCount: inlineImages.length,
      leftoverAssetUrls: _leftoverAssetUrls,
      leftoverHostUrls: _leftoverHostUrls,
      contentIds: _contentIds,
      missingCidRefs: _missingCidRefs,
      htmlPreviewBefore: _htmlPreviewBefore,
      htmlPreviewAfter: _htmlPreviewAfter,
    });

    const _gateErrors: string[] = [];
    if (_leftoverAssetUrls.length > 0) {
      _gateErrors.push(`HTML still contains /assets/cta/ after final CID conversion: ${_leftoverAssetUrls.slice(0, 5).join(", ")}`);
    }
    if (_leftoverHostUrls.length > 0) {
      _gateErrors.push(`HTML still contains external CTA host URL after final CID conversion: ${_leftoverHostUrls.slice(0, 3).join(", ")}`);
    }
    if (_origAssetImgCount > 0 && inlineImages.length === 0) {
      _gateErrors.push(`Original HTML had ${_origAssetImgCount} CTA image src(s) but final inlineImages is empty — conversion produced no CID parts`);
    }
    if (_missingCidRefs.length > 0) {
      _gateErrors.push(`CID parts exist but have no matching src="cid:<id>" in final HTML: ${_missingCidRefs.join(", ")}`);
    }
    if (_gateErrors.length > 0) {
      throw new Error(`CID conversion failed before Gmail send:\n${_gateErrors.join("\n")}`);
    }
  }

  const raw = buildMimeRaw(from, to, subject, body, attachments, cc, bcc, icalContent, inlineImages);

  // ── Runtime MIME structure assertion (dev + prod) ─────────────────────
  // Always decode so this assertion fires in production too (logs error instead
  // of throwing). If CID images are present but the root MIME part is NOT
  // multipart/related, Gmail will canonicalize the message into a broken
  // multipart/mixed where CID parts become attachment cards instead of
  // rendering inline.  This assertion catches future buildMimeRaw regressions
  // before they reach the Gmail API.
  const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  if (inlineImages.length > 0) {
    const firstCt = decoded.split(/\r?\n/).find(l => l.startsWith("Content-Type:")) ?? "";
    const rootIsRelated = firstCt.includes("multipart/related");
    // Case C: mixed root is acceptable only when multipart/related is the FIRST child.
    const rootIsMixed = firstCt.includes("multipart/mixed");
    const relatedAsFirstChild = rootIsMixed && decoded.slice(0, 600).includes("multipart/related");
    if (!rootIsRelated && !relatedAsFirstChild) {
      const msg =
        `[MIME-ASSERT] ${inlineImages.length} CID image(s) present but root MIME is not ` +
        `multipart/related (firstCT="${firstCt}"). CID parts will render as attachment ` +
        `cards in Apple Mail / Outlook instead of inline images.`;
      if (process.env.NODE_ENV !== "production") {
        throw new Error(msg);
      } else {
        console.error(msg);
      }
    }
  }

  // ── MIME tree diagnostic + last-sent capture (dev only) ─────────────────
  if (process.env.NODE_ENV !== "production") {
    const tree = decoded.split(/\r?\n/)
      .filter(l => l.startsWith("Content-") || l.startsWith("--") || l.startsWith("MIME-Version"))
      .slice(0, 80).join("\n");
    console.log(`[mime-tree] Outgoing MIME (${inlineImages.length} inline img(s)):\n${tree}`);
    _lastSentDebugState = { timestamp: new Date().toISOString(), to, subject, from, inlineImageCount: inlineImages.length, mimeTree: tree, rawMime: decoded };
  }

  const params: any = { userId: "me", requestBody: { raw } };
  if (threadId) params.requestBody.threadId = threadId;
  const res = await gmail.users.messages.send(params);
  return res.data;
}

export async function saveDraft(
  userId: number,
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  draftId?: string,
  accountId?: number,
  cc?: string,
  bcc?: string,
) {
  const gmail = await getGmailClient(userId, accountId);
  const profileRes = await gmail.users.getProfile({ userId: "me" });
  const from = profileRes.data.emailAddress!;
  // Pass cc/bcc so they are written as proper MIME headers in the stored draft.
  const raw = buildMimeRaw(from, to, subject, body, [], cc, bcc);
  const message: any = { raw };
  if (threadId) message.threadId = threadId;
  if (draftId) {
    const res = await gmail.users.drafts.update({ userId: "me", id: draftId, requestBody: { message } });
    return res.data;
  } else {
    const res = await gmail.users.drafts.create({ userId: "me", requestBody: { message } });
    return res.data;
  }
}

export async function listDraftSummaries(userId: number, accountId?: number) {
  const gmail = await getGmailClient(userId, accountId);
  const listRes = await gmail.users.drafts.list({ userId: "me", maxResults: 100 });
  const drafts = listRes.data.drafts || [];
  if (!drafts.length) return [];
  const summaries = await Promise.all(
    drafts.map(async ({ id }) => {
      const d = await gmail.users.drafts.get({ userId: "me", id: id!, format: "metadata", metadataHeaders: ["To", "Subject", "Date"] } as any);
      const msg = d.data.message!;
      const headers: any[] = msg.payload?.headers || [];
      const getH = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
      return {
        id: d.data.id!,
        to: getH("To"),
        subject: getH("Subject"),
        date: getH("Date"),
        snippet: msg.snippet || "",
        internalDate: msg.internalDate || "",
      };
    })
  );
  return summaries;
}

export async function getDraftContent(userId: number, draftId: string, accountId?: number) {
  const gmail = await getGmailClient(userId, accountId);
  const d = await gmail.users.drafts.get({ userId: "me", id: draftId, format: "full" } as any);
  const msg = d.data.message!;
  const headers: any[] = msg.payload?.headers || [];
  const getH = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
  const htmlBody = extractHtmlBody(msg.payload);
  const textBody = extractBody(msg.payload);
  return {
    id: d.data.id!,
    to: getH("To"),
    cc: getH("Cc"),
    bcc: getH("Bcc"),
    subject: getH("Subject"),
    body: htmlBody || textBody,
    threadId: (msg as any).threadId as string | undefined,
  };
}

export async function deleteDraft(userId: number, draftId: string, accountId?: number) {
  const gmail = await getGmailClient(userId, accountId);
  await gmail.users.drafts.delete({ userId: "me", id: draftId });
}

export async function getProfile(userId: number, accountId?: number) {
  const gmail = await getGmailClient(userId, accountId);
  const res = await gmail.users.getProfile({ userId: "me" });
  return res.data;
}
