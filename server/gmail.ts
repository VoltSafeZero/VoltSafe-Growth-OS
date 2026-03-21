// Gmail integration via Google OAuth2 (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)
// Refresh token stored in system_settings DB table
import { getGmailClient } from "./gmail-oauth";

function decodeBase64(data: string) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
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

export async function listThreads(query: string = "", maxResults: number = 30) {
  const gmail = await getGmailClient();
  const res = await gmail.users.threads.list({
    userId: "me",
    maxResults,
    q: query,
  });
  return res.data.threads || [];
}

export async function getThread(threadId: string) {
  const gmail = await getGmailClient();
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

export async function getMessageSummaries(maxResults: number = 50, query: string = "") {
  const gmail = await getGmailClient();
  const listRes = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: query,
  });
  const messageIds = listRes.data.messages || [];
  const summaries = await Promise.all(
    messageIds.map(async ({ id }) => {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: id!,
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
    })
  );
  return summaries;
}

export async function sendEmail(to: string, subject: string, body: string, threadId?: string) {
  const gmail = await getGmailClient();
  const profileRes = await gmail.users.getProfile({ userId: "me" });
  const from = profileRes.data.emailAddress;

  const boundary = `boundary_${Date.now()}_voltsafe`;
  const plainText = body.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    plainText,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    body,
    "",
    `--${boundary}--`,
  ];

  const raw = Buffer.from(messageParts.join("\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const params: any = { userId: "me", requestBody: { raw } };
  if (threadId) params.requestBody.threadId = threadId;

  const res = await gmail.users.messages.send(params);
  return res.data;
}

export async function getProfile() {
  const gmail = await getGmailClient();
  const res = await gmail.users.getProfile({ userId: "me" });
  return res.data;
}
