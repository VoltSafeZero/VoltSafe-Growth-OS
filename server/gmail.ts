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
export type CidImage = { cid: string; mimeType: string; data: Buffer };

// Map file extension to MIME type for CTA images.
function mimeTypeFromExt(ext: string): string {
  const m: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  return m[ext.toLowerCase()] ?? "image/png";
}

/**
 * Inlines all images found inside the `<!--vs-sig-start-->…<!--vs-sig-end-->`
 * section of `html` as CID MIME parts so they render correctly in clients that
 * block remote images (Spark, Apple Mail, Outlook).
 *
 * Resolution order for each `src` found in the signature section:
 *   1. `/assets/cta/<filename>` → read directly from `ctaAssetsDir` (fast, no HTTP).
 *   2. Any `https://` or `http://` URL → fetched server-side with a 4-second timeout.
 *   3. Anything else (data:, cid:, relative paths without protocol) → skipped.
 *
 * If no signature markers are present the function falls back to legacy behaviour:
 * only `/assets/cta/` local files are inlined, no external fetches are made.
 *
 * All matching `src="…"` attributes in the **full** `html` string are then
 * rewritten to `src="cid:<id>"`.  The returned `inlineImages` array is passed
 * directly to `buildMimeRaw` which wraps them in `multipart/related`.
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
      if (!src || src.startsWith("cid:") || src.startsWith("data:")) continue;
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

      // Slow path – fetch any other HTTP/HTTPS URL (4 s timeout).
      if (!data && (src.startsWith("https://") || src.startsWith("http://"))) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 4000);
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
      seen.set(src, { cid: `vsig${cidIndex++}${cidBase}`, mimeType, data });
    }
  } else {
    // ── Legacy fallback: no sig markers — only /assets/cta/ local files ───
    const fnRe = /\/assets\/cta\/([^"'?#\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = fnRe.exec(html)) !== null) {
      const filename = m[1];
      if (seen.has(filename)) continue;
      const filePath = path.join(ctaAssetsDir, filename);
      try {
        if (!fs.existsSync(filePath)) {
          console.error(`[sig-cid] CTA file not found on disk — path="${filePath}" src="${filename}"`);
          continue;
        }
        const data = fs.readFileSync(filePath);
        const ext = filename.split(".").pop() ?? "png";
        seen.set(filename, { cid: `vsig${cidIndex++}${cidBase}`, mimeType: mimeTypeFromExt(ext), data });
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
  // text/html is the ROOT of multipart/related; images are its direct peers.
  const inlineParts = (bnd: string): string[] =>
    inlineImages.flatMap((img) => {
      const b64 = img.data.toString("base64").match(/.{1,76}/g)?.join(R) ?? "";
      return [
        `--${bnd}`,
        `Content-Type: ${img.mimeType}`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: inline`,
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
  //    multipart/alternative [altBnd]
  //      text/plain
  //      multipart/related [relBnd]   ← text/html is ROOT of related
  //        text/html
  //        image/* (Content-ID: <cid>)
  //
  //  Case C — inline images + attachments:
  //    multipart/mixed [mixBnd]
  //      multipart/alternative [altBnd]
  //        text/plain
  //        multipart/related [relBnd]
  //          text/html
  //          image/*
  //      attachment …
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
    // Case B — text/html is the direct root of multipart/related
    const altBnd = `vs_alt_${ts}`;
    const relBnd = `vs_rel_${ts + 1}`;
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
      `Content-Type: multipart/related; boundary="${relBnd}"`,
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
      `--${altBnd}--`,
    ];
  } else if (needsInline && needsMixed) {
    // Case C
    const mixBnd = `vs_mix_${ts + 2}`;
    const altBnd = `vs_alt_${ts}`;
    const relBnd = `vs_rel_${ts + 1}`;
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
      `Content-Type: multipart/related; boundary="${relBnd}"`,
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
      `--${altBnd}--`,
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
  const raw = buildMimeRaw(from, to, subject, body, attachments, cc, bcc, icalContent, inlineImages);

  // ── MIME tree diagnostic (dev only) ─────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const tree = decoded.split(/\r?\n/)
      .filter(l => l.startsWith("Content-") || l.startsWith("--") || l.startsWith("MIME-Version"))
      .slice(0, 60).join("\n");
    console.log(`[mime-tree] Outgoing MIME (${inlineImages.length} inline img(s)):\n${tree}`);
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
