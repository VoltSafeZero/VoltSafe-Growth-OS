// Gmail integration via Google OAuth2 (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)
// All functions accept an optional accountId — when provided (shared mailbox access),
// the token for that specific account is used regardless of which user is calling.
import fs from "fs";
import path from "path";
import { getGmailClient } from "./gmail-oauth";
import { resolveCtaAsset, getCtaAssetHealth } from "./services/cta-asset-resolver";

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
  const extractImgSrcs = (h: string): string[] => {
    const srcs: string[] = [];
    // Handle both double- and single-quoted src attributes.
    const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(h)) !== null) srcs.push(mm[1]);
    return srcs;
  };
  console.log("[CTA-CID-LIVE-VERSION-2026-06-08-0435] extractCtaInlineImages called", {
    htmlLen: html?.length,
    imgSrcs: extractImgSrcs(html),
  });
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
    // Match both double- and single-quoted src attributes (case-insensitive SRC).
    // Single-quoted attrs arise from some WYSIWYG editors and HTML templates.
    const srcRe = /\bsrc=["']([^"']+)["']/gi;
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
      let mimeType = mimeTypeFromExt(rawExt.toLowerCase());
      let data: Buffer | null = null;

      // Resolve /assets/cta/ URLs via DB-backed 4-step chain (DB → disk → localhost → public_url).
      // Using the shared cta-asset-resolver service means the FINAL-CID-GATE inside sendEmail()
      // also resolves UUID-named assets that survive production disk wipes.
      const ctaFileMatch = src.match(/\/assets\/cta\/([^"'?#\s]+)/);
      if (ctaFileMatch) {
        const _ctaFilename = ctaFileMatch[1];
        console.log(`[CID-RESOLVE-FILENAME] src="${src.slice(0, 80)}" filename="${_ctaFilename}"`);
        // Pre-check: reject archived or byte-less assets before attempting resolution.
        const _ctaHealth = await getCtaAssetHealth(_ctaFilename);
        console.log("[CID-HEALTH-CHECK]", { filename: _ctaFilename, ..._ctaHealth });
        if (_ctaHealth.exists && _ctaHealth.is_archived) {
          throw new Error(
            `Signature references archived CTA asset: "${_ctaFilename}"` +
            `${_ctaHealth.original_name ? ` (${_ctaHealth.original_name})` : ""}. ` +
            `Re-upload or replace this image before sending.`,
          );
        }
        if (_ctaHealth.exists && !_ctaHealth.has_file_data) {
          throw new Error(
            `Signature references CTA asset with no image data: "${_ctaFilename}"` +
            `${_ctaHealth.original_name ? ` (${_ctaHealth.original_name})` : ""}. ` +
            `Re-upload or replace this image before sending.`,
          );
        }
        const _ctaResolved = await resolveCtaAsset(_ctaFilename);
        console.log("[CID-FORENSIC]", {
          src: src.slice(0, 100),
          filename: _ctaFilename,
          found: !!_ctaResolved,
          bytes: _ctaResolved?.data.byteLength ?? 0,
          source: _ctaResolved?.source,
          dbId: _ctaResolved?.dbId,
          dbFilename: _ctaResolved?.dbFilename,
          dbOriginalName: _ctaResolved?.dbOriginalName,
          dbPublicUrl: _ctaResolved?.dbPublicUrl?.slice(0, 80),
          claimedMime: _ctaResolved?.mimeType,
          sha256: _ctaResolved?.sha256,
          first32hex: _ctaResolved?.first32hex,
          magicOk: _ctaResolved?.magicOk,
          detectedMime: _ctaResolved?.detectedMime,
          width: _ctaResolved?.width,
          height: _ctaResolved?.height,
        });
        if (_ctaResolved) {
          if (!_ctaResolved.magicOk) {
            console.error(`[CID-MAGIC-REJECT] sig-path: bytes for "${_ctaFilename}" failed magic check ` +
              `claimedMime=${_ctaResolved.mimeType} detectedMime=${_ctaResolved.detectedMime} ` +
              `first32hex=${_ctaResolved.first32hex} sha256=${_ctaResolved.sha256} — image will NOT be inlined`);
          } else {
            data = _ctaResolved.data;
            mimeType = _ctaResolved.mimeType;
          }
        }
      }

      // Non-CTA HTTP/HTTPS URL — direct fetch with 10 s timeout (leave URL as-is on failure).
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
    // loop below then replaces that same full src, handling both quote styles
    // regardless of whether the URL is "/assets/cta/logo.png" or
    // "https://<any-host>/assets/cta/logo.png".
    const srcRe = /\bsrc=["']([^"']*\/assets\/cta\/[^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = srcRe.exec(html)) !== null) {
      const src = m[1]; // full src value, e.g. "/assets/cta/logo.png" or "https://…/assets/cta/logo.png"
      if (seen.has(src)) continue;
      const ctaMatch = src.match(/\/assets\/cta\/([^"'?#\s/]+)/);
      if (!ctaMatch) continue;
      const filename = ctaMatch[1]; // bare filename, e.g. "logo.png"
      const fname = filename.split("/").pop() ?? filename;
      // Pre-check: reject archived or byte-less assets before attempting resolution.
      const _legacyHealth = await getCtaAssetHealth(filename);
      console.log("[CID-HEALTH-CHECK-LEGACY]", { filename, ..._legacyHealth });
      if (_legacyHealth.exists && _legacyHealth.is_archived) {
        throw new Error(
          `Signature references archived CTA asset: "${filename}"` +
          `${_legacyHealth.original_name ? ` (${_legacyHealth.original_name})` : ""}. ` +
          `Re-upload or replace this image before sending.`,
        );
      }
      if (_legacyHealth.exists && !_legacyHealth.has_file_data) {
        throw new Error(
          `Signature references CTA asset with no image data: "${filename}"` +
          `${_legacyHealth.original_name ? ` (${_legacyHealth.original_name})` : ""}. ` +
          `Re-upload or replace this image before sending.`,
        );
      }
      const _legacyResolved = await resolveCtaAsset(filename);
      console.log("[CID-FORENSIC-LEGACY]", {
        src: src.slice(0, 100),
        filename,
        found: !!_legacyResolved,
        bytes: _legacyResolved?.data.byteLength ?? 0,
        source: _legacyResolved?.source,
        dbId: _legacyResolved?.dbId,
        dbFilename: _legacyResolved?.dbFilename,
        dbOriginalName: _legacyResolved?.dbOriginalName,
        claimedMime: _legacyResolved?.mimeType,
        sha256: _legacyResolved?.sha256,
        first32hex: _legacyResolved?.first32hex,
        magicOk: _legacyResolved?.magicOk,
        detectedMime: _legacyResolved?.detectedMime,
        width: _legacyResolved?.width,
        height: _legacyResolved?.height,
      });
      if (!_legacyResolved) {
        console.error(`[sig-cid] CTA asset unresolvable — filename="${filename}" src="${src}"`);
        continue;
      }
      if (!_legacyResolved.magicOk) {
        console.error(`[CID-MAGIC-REJECT] legacy-path: bytes for "${filename}" failed magic check ` +
          `claimedMime=${_legacyResolved.mimeType} detectedMime=${_legacyResolved.detectedMime} ` +
          `first32hex=${_legacyResolved.first32hex} sha256=${_legacyResolved.sha256} — image will NOT be inlined`);
        continue;
      }
      seen.set(src, {
        cid: `vsig${cidIndex++}${cidBase}`,
        mimeType: _legacyResolved.mimeType,
        data: _legacyResolved.data,
        filename: fname,
      });
    }
  }

  if (seen.size === 0) return { html, inlineImages: [] };

  // ── Rewrite all matched src attributes in the full HTML ──────────────────
  let rewritten = html;
  for (const [src, cidImg] of seen.entries()) {
    if (src.startsWith("data:")) {
      // data: URIs are kilobytes of base64 — building a RegExp from them is
      // both slow and throws "Invalid regular expression" in V8 when the
      // escaped string contains regex meta-sequences. Use literal split/join.
      // Handle both double- and single-quoted src attributes.
      rewritten = rewritten.split(`src="${src}"`).join(`src="cid:${cidImg.cid}"`);
      rewritten = rewritten.split(`src='${src}'`).join(`src="cid:${cidImg.cid}"`);
    } else {
      const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match src="..." or src='...' anywhere in the HTML (case-insensitive).
      // Normalises output to double quotes for consistency.
      const pat = new RegExp(`\\bsrc=["']${escapedSrc}["']`, "gi");
      rewritten = rewritten.replace(pat, `src="cid:${cidImg.cid}"`);
    }
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
    // Handle href="..." and href='...' (case-insensitive HREF).
    const hrefPat = new RegExp(`\\bhref=["']${escapedSrc}["']`, "gi");
    if (hrefPat.test(rewritten)) {
      console.log(`[sig-cid] stripped image href="${src.slice(0, 80)}" → "#" (Apple Mail attachment prevention)`);
      hrefPat.lastIndex = 0;
      rewritten = rewritten.replace(hrefPat, `href="#"`);
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
  // RFC 2392 §2: Content-ID alone is sufficient to reference a CID image.
  // Content-Disposition MUST be omitted entirely for CID parts — Apple Mail 16+
  // (macOS Ventura/Sonoma, iOS 17+) interprets Content-Disposition: inline as
  // "show this both inline AND as a downloadable attachment", producing a ghost
  // attachment card for every signature image. Confirmed fix: no Content-Disposition.
  // name= on Content-Type is kept for client compatibility (Gmail, Outlook).
  const inlineParts = (bnd: string): string[] =>
    inlineImages.flatMap((img) => {
      const b64 = img.data.toString("base64").match(/.{1,76}/g)?.join(R) ?? "";
      const fname = img.filename ?? "inline-image.png";
      return [
        `--${bnd}`,
        `Content-Type: ${img.mimeType}; name="${fname}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-ID: <${img.cid}>`,
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
  console.log("[LIVE-SEND] sendEmail entered", { subject, bodyLen: body?.length, inlineImagesIn: inlineImages?.length });

  // ── FINAL MANDATORY CID GATE ─────────────────────────────────────────────
  // This runs unconditionally for EVERY send path (immediate, scheduled,
  // reply, forward, draft-send).  Earlier pipeline stages may have produced a
  // converted HTML string that was then copied/reassembled into a different
  // variable before being passed here.  This gate takes the exact HTML that is
  // about to be serialised, runs extractCtaInlineImages one final time, merges
  // the resulting CID parts, then asserts the HTML is clean before continuing.
  {
    const _cidGateAssetsDir = path.resolve("uploads/cta-assets");

    // ── Helper: extract <img src="..."> values only ──────────────────────────
    // All gate assertions operate exclusively on IMG SRC attributes.
    // HREF attributes (tracking links, anchor wraps around CTA images, social
    // links) legitimately contain /assets/cta/ or image-linker URLs and must
    // NEVER trigger a gate failure.
    const _extractImgSrcs = (html: string): string[] => {
      const srcs: string[] = [];
      // Handle both double- and single-quoted src attributes (case-insensitive).
      const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) srcs.push(m[1]);
      return srcs;
    };

    const _htmlPreviewBefore = body.slice(0, 300);
    const _imgSrcsBefore = _extractImgSrcs(body);
    const _origAssetImgCount = _imgSrcsBefore.filter(s => s.includes("/assets/cta/")).length;

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

    // Verify every merged CID part has valid image magic bytes.
    for (const img of inlineImages) {
      const h = img.data.slice(0, 12);
      const first32hex = img.data.slice(0, 32).toString("hex");
      const isPng  = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47;
      const isJpeg = h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF;
      const isGif  = img.data.byteLength >= 6 && img.data.slice(0, 6).toString("ascii").startsWith("GIF8");
      const isWebp = img.data.byteLength >= 12 && h.slice(0, 4).toString("ascii") === "RIFF" && img.data.slice(8, 12).toString("ascii") === "WEBP";
      const detected = isPng ? "image/png" : isJpeg ? "image/jpeg" : isGif ? "image/gif" : isWebp ? "image/webp" : "unknown";
      const sha256 = require("crypto").createHash("sha256").update(img.data).digest("hex");
      console.log("[CID-GATE-VERIFY]", {
        cid: img.cid,
        filename: img.filename,
        claimedMime: img.mimeType,
        detectedMime: detected,
        magicOk: detected !== "unknown",
        sha256,
        first32hex,
        bytes: img.data.byteLength,
      });
      if (detected === "unknown") {
        console.error(`[CID-GATE-MAGIC-FAIL] CID part "${img.cid}" filename="${img.filename}" ` +
          `claimedMime=${img.mimeType} has INVALID magic bytes first32hex=${first32hex} sha256=${sha256} ` +
          `— this part will render as a broken image or phantom attachment in Apple Mail`);
      }
    }
    console.log("[FINAL-CID-GATE-RESULT]", {
      beforeImgSrcs: _imgSrcsBefore,
      afterImgSrcs: _extractImgSrcs(body),
      inlineImagesCount: inlineImages.length,
      cids: inlineImages.map(i => i.cid),
    });
    // Assertions use img src values ONLY — not raw body text.
    const _htmlPreviewAfter  = body.slice(0, 300);
    const _imgSrcsAfter      = _extractImgSrcs(body);
    const _leftoverAssetUrls = _imgSrcsAfter.filter(s => s.includes("/assets/cta/"));
    // Any external http(s) URL that still references /assets/cta/ is a failure.
    const _leftoverHostUrls  = _imgSrcsAfter.filter(s => /^https?:\/\//i.test(s) && s.includes("/assets/cta/"));
    const _contentIds        = inlineImages.map(i => i.cid);
    // Check both quote styles for cid: references in the final HTML.
    const _missingCidRefs    = _contentIds.filter(cid =>
      !body.includes(`src="cid:${cid}"`) && !body.includes(`src='cid:${cid}'`));
    const _finalCidImgCount  = _imgSrcsAfter.filter(s => s.startsWith("cid:")).length;

    console.log("[FINAL-CID-GATE]", {
      originalAssetImgCount: _origAssetImgCount,
      finalCidImgCount: _finalCidImgCount,
      inlineImagesCount: inlineImages.length,
      imgSrcsBefore: _imgSrcsBefore,
      imgSrcsAfter: _imgSrcsAfter,
      leftoverAssetImgSrcs: _leftoverAssetUrls,
      leftoverHostImgSrcs: _leftoverHostUrls,
      contentIds: _contentIds,
      missingCidRefs: _missingCidRefs,
      htmlPreviewBefore: _htmlPreviewBefore,
      htmlPreviewAfter: _htmlPreviewAfter,
    });

    const _gateErrors: string[] = [];
    if (_leftoverAssetUrls.length > 0) {
      _gateErrors.push(`IMG SRC still contains /assets/cta/ after final CID conversion: ${_leftoverAssetUrls.slice(0, 5).join(", ")}`);
    }
    if (_leftoverHostUrls.length > 0) {
      _gateErrors.push(`IMG SRC still contains external CTA host URL after final CID conversion: ${_leftoverHostUrls.slice(0, 3).join(", ")}`);
    }
    if (_origAssetImgCount > 0 && inlineImages.length === 0) {
      _gateErrors.push(`Original HTML had ${_origAssetImgCount} CTA img src(s) but final inlineImages is empty — conversion produced no CID parts`);
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
