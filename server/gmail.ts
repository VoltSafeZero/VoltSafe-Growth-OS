// Gmail integration via Replit Google Mail connector
// Connection: conn_google-mail_01KKWKTSCQ6RFM1F6CQWP7X529
import { google } from "googleapis";

let connectionSettings: any;

async function getAccessToken() {
  if (
    connectionSettings &&
    connectionSettings.settings.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
  ) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error("X-Replit-Token not found for repl/depl");
  }

  connectionSettings = await fetch(
    "https://" +
      hostname +
      "/api/v2/connection?include_secrets=true&connector_names=google-mail",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    }
  )
    .then((res) => res.json())
    .then((data) => data.items?.[0]);

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error("Gmail not connected");
  }
  return accessToken;
}

// WARNING: Never cache this client. Tokens expire.
export async function getUncachableGmailClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

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
  const gmail = await getUncachableGmailClient();
  const res = await gmail.users.threads.list({
    userId: "me",
    maxResults,
    q: query,
  });
  return res.data.threads || [];
}

export async function getThread(threadId: string) {
  const gmail = await getUncachableGmailClient();
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
  const gmail = await getUncachableGmailClient();
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
  const gmail = await getUncachableGmailClient();
  const profileRes = await gmail.users.getProfile({ userId: "me" });
  const from = profileRes.data.emailAddress;

  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    body,
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
  const gmail = await getUncachableGmailClient();
  const res = await gmail.users.getProfile({ userId: "me" });
  return res.data;
}
