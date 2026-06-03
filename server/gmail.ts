// Gmail integration via Google OAuth2 (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)
// All functions accept an optional accountId — when provided (shared mailbox access),
// the token for that specific account is used regardless of which user is calling.
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

type MimeAttachment = { name: string; mimeType: string; data: Buffer };

function buildMimeRaw(
  from: string,
  to: string,
  subject: string,
  body: string,
  attachments: MimeAttachment[] = [],
  cc?: string,
  bcc?: string,
  icalContent?: string,
): string {
  const R = "\r\n";
  const plainText = body
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const innerBoundary = `vs_alt_${Date.now()}`;
  const altPart = [
    `--${innerBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    mimeBase64(plainText),
    "",
    `--${innerBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    mimeBase64(body),
    "",
    `--${innerBoundary}--`,
  ].join(R);

  const extraHeaders: string[] = [];
  if (cc) extraHeaders.push(`Cc: ${cc}`);
  if (bcc) extraHeaders.push(`Bcc: ${bcc}`);

  // iCal invite present → must use multipart/mixed so email clients show RSVP buttons.
  // We embed it as an inline text/calendar part (triggers Gmail/Outlook RSVP UI) AND
  // as an application/ics attachment (for Apple Mail and other clients).
  const needsMixed = attachments.length > 0 || !!icalContent;

  let lines: string[];
  if (!needsMixed) {
    lines = [
      `From: ${from}`,
      `To: ${to}`,
      ...extraHeaders,
      `Subject: ${rfc2047EncodeHeader(subject || "")}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${innerBoundary}"`,
      "",
      altPart,
    ];
  } else {
    const outerBoundary = `vs_mix_${Date.now() + 1}`;
    const attachParts = attachments.map((att) => {
      const b64 = att.data.toString("base64").match(/.{1,76}/g)?.join(R) ?? "";
      return [
        `--${outerBoundary}`,
        `Content-Type: ${att.mimeType}; name="${att.name}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${att.name}"`,
        "",
        b64,
        "",
      ].join(R);
    });

    const icalParts: string[] = [];
    if (icalContent) {
      const icalB64 = Buffer.from(icalContent, "utf-8")
        .toString("base64")
        .match(/.{1,76}/g)
        ?.join(R) ?? "";
      // Inline text/calendar triggers RSVP in Gmail and Outlook.
      icalParts.push(
        [
          `--${outerBoundary}`,
          `Content-Type: text/calendar; method=REQUEST; charset=UTF-8`,
          "Content-Transfer-Encoding: base64",
          "Content-Disposition: inline",
          "",
          icalB64,
          "",
        ].join(R),
      );
      // .ics attachment for Apple Mail / older clients.
      icalParts.push(
        [
          `--${outerBoundary}`,
          `Content-Type: application/ics; name="invite.ics"`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="invite.ics"`,
          "",
          icalB64,
          "",
        ].join(R),
      );
    }

    lines = [
      `From: ${from}`,
      `To: ${to}`,
      ...extraHeaders,
      `Subject: ${rfc2047EncodeHeader(subject || "")}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${outerBoundary}"`,
      "",
      `--${outerBoundary}`,
      `Content-Type: multipart/alternative; boundary="${innerBoundary}"`,
      "",
      altPart,
      "",
      ...icalParts,
      ...attachParts,
      `--${outerBoundary}--`,
    ];
  }

  return Buffer.from(lines.join(R))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
) {
  const gmail = await getGmailClient(userId, accountId);
  const profileRes = await gmail.users.getProfile({ userId: "me" });
  const from = profileRes.data.emailAddress!;
  const raw = buildMimeRaw(from, to, subject, body, attachments, cc, bcc, icalContent);
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
