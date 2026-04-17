// Phase 2C — Local mailbox reads (inbox list + threads list + thread detail)
// served from email_messages instead of live Gmail. Fully additive.
// Output shapes mirror the live Gmail routes so the frontend doesn't need changes.
import { db } from "../db";
import { sql } from "drizzle-orm";

export type LocalMessageSummary = {
  id: string;            // gmail_message_id
  threadId: string;      // gmail_thread_id
  snippet: string;
  internalDate: string;  // ms epoch as string (Gmail-shape)
  labelIds: string[];
  from: string;
  to: string;
  subject: string;
  date: string;          // RFC date string
};

export type LocalThreadStub = { id: string; snippet: string; historyId: string };

export type LocalThreadDetail = {
  id: string;
  historyId: string;
  messages: Array<{
    id: string; threadId: string; snippet: string; internalDate: string;
    from: string; to: string; cc: string; subject: string; date: string;
    labelIds: string[]; body: string; isHtml: boolean;
  }>;
};

const safe = (s: string) => s.replace(/'/g, "''");

function parseLabelIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { /* fall through */ }
  }
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

function parseToList(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  if (!s) return "";
  if (s.startsWith("[")) { try { const v = JSON.parse(s); if (Array.isArray(v)) return v.join(", "); } catch { /* */ } }
  return s;
}

function fmtFrom(name: string | null, email: string | null): string {
  if (name && email) return `${name} <${email}>`;
  return email || name || "";
}

// Translate the Gmail-style q filter into local DB clauses.
// Supports the small subset the inbox UI emits: "in:inbox", "in:sent", and free text.
function buildQClauses(q: string): { where: string[]; freeText: string } {
  const where: string[] = [];
  let rest = q || "";
  const inMatch = rest.match(/\bin:(\w+)/i);
  if (inMatch) {
    const label = inMatch[1].toUpperCase();
    rest = rest.replace(inMatch[0], "").trim();
    // INBOX/SENT/etc. are stored in label_ids (CSV or JSON-stringified array)
    where.push(`(label_ids ILIKE '%"${safe(label)}"%' OR label_ids ILIKE '%${safe(label)}%')`);
  }
  return { where, freeText: rest.trim() };
}

type Resolved = { userId: number; accountId?: number };

// ── Inbox / sent flat list ────────────────────────────────────────────────
export async function listLocalMessages(p: {
  resolved: Resolved;
  q?: string;
  limit?: number;
  pageToken?: string | null;
}): Promise<{ messages: LocalMessageSummary[]; nextPageToken: string | null; tookMs: number }> {
  const t0 = Date.now();
  const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 100);
  const offset = p.pageToken ? Math.max(parseInt(p.pageToken, 10) || 0, 0) : 0;

  const where: string[] = [`owner_user_id = ${Number(p.resolved.userId)}`];
  if (p.resolved.accountId) where.push(`source_account_id = ${Number(p.resolved.accountId)}`);

  const { where: qWhere, freeText } = buildQClauses(p.q || "");
  where.push(...qWhere);
  if (freeText) {
    const lit = `'${safe(freeText)}'`;
    const tsv = `to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(from_name,'') || ' ' || coalesce(from_email,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body_text,''))`;
    where.push(`${tsv} @@ plainto_tsquery('english', ${lit})`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const rowsRes = await db.execute(sql.raw(`
    SELECT
      gmail_message_id, gmail_thread_id, snippet, sent_at,
      from_email, from_name, to_emails, subject, label_ids
    FROM email_messages
    ${whereSql}
    ORDER BY sent_at DESC NULLS LAST, id DESC
    LIMIT ${limit + 1} OFFSET ${offset}
  `));
  const raw = ((rowsRes as any).rows ?? rowsRes) as any[];
  const hasMore = raw.length > limit;
  const slice = raw.slice(0, limit);

  const messages: LocalMessageSummary[] = slice.map(r => {
    const sentAt = r.sent_at ? new Date(r.sent_at) : null;
    return {
      id: r.gmail_message_id,
      threadId: r.gmail_thread_id,
      snippet: r.snippet || "",
      internalDate: sentAt ? String(sentAt.getTime()) : "0",
      labelIds: parseLabelIds(r.label_ids),
      from: fmtFrom(r.from_name, r.from_email),
      to: parseToList(r.to_emails),
      subject: r.subject || "",
      date: sentAt ? sentAt.toUTCString() : "",
    };
  });

  return {
    messages,
    nextPageToken: hasMore ? String(offset + limit) : null,
    tookMs: Date.now() - t0,
  };
}

// ── Threads list (one row per thread, newest message first) ────────────────
export async function listLocalThreads(p: {
  resolved: Resolved;
  q?: string;
  limit?: number;
  pageToken?: string | null;
}): Promise<{ threads: LocalThreadStub[]; nextPageToken: string | null; tookMs: number }> {
  const t0 = Date.now();
  const limit = Math.min(Math.max(Number(p.limit) || 30, 1), 100);
  const offset = p.pageToken ? Math.max(parseInt(p.pageToken, 10) || 0, 0) : 0;

  const where: string[] = [`owner_user_id = ${Number(p.resolved.userId)}`];
  if (p.resolved.accountId) where.push(`source_account_id = ${Number(p.resolved.accountId)}`);
  const { where: qWhere, freeText } = buildQClauses(p.q || "");
  where.push(...qWhere);
  if (freeText) {
    const lit = `'${safe(freeText)}'`;
    const tsv = `to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(from_name,'') || ' ' || coalesce(from_email,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body_text,''))`;
    where.push(`${tsv} @@ plainto_tsquery('english', ${lit})`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  // DISTINCT ON (gmail_thread_id) gives newest message per thread, then sort by sent_at.
  const rowsRes = await db.execute(sql.raw(`
    SELECT id, snippet
    FROM (
      SELECT DISTINCT ON (gmail_thread_id)
        gmail_thread_id AS id, snippet, sent_at
      FROM email_messages
      ${whereSql}
      ORDER BY gmail_thread_id, sent_at DESC NULLS LAST, id DESC
    ) t
    ORDER BY sent_at DESC NULLS LAST
    LIMIT ${limit + 1} OFFSET ${offset}
  `));
  const raw = ((rowsRes as any).rows ?? rowsRes) as any[];
  const hasMore = raw.length > limit;
  const slice = raw.slice(0, limit);

  const threads: LocalThreadStub[] = slice.map(r => ({
    id: r.id, snippet: r.snippet || "", historyId: "",
  }));
  return { threads, nextPageToken: hasMore ? String(offset + limit) : null, tookMs: Date.now() - t0 };
}

// ── Thread detail from local DB (returns null if no rows so caller can fallback) ───
export async function getLocalThread(p: { resolved: Resolved; threadId: string }): Promise<LocalThreadDetail | null> {
  const where: string[] = [
    `owner_user_id = ${Number(p.resolved.userId)}`,
    `gmail_thread_id = '${safe(p.threadId)}'`,
  ];
  if (p.resolved.accountId) where.push(`source_account_id = ${Number(p.resolved.accountId)}`);
  const rowsRes = await db.execute(sql.raw(`
    SELECT
      gmail_message_id, gmail_thread_id, snippet, sent_at,
      from_email, from_name, to_emails, cc_emails, subject, label_ids, body_text, body_html
    FROM email_messages
    WHERE ${where.join(" AND ")}
    ORDER BY sent_at ASC NULLS LAST, id ASC
  `));
  const rows = ((rowsRes as any).rows ?? rowsRes) as any[];
  if (rows.length === 0) return null;

  const messages = rows.map(r => {
    const sentAt = r.sent_at ? new Date(r.sent_at) : null;
    return {
      id: r.gmail_message_id,
      threadId: r.gmail_thread_id,
      snippet: r.snippet || "",
      internalDate: sentAt ? String(sentAt.getTime()) : "0",
      from: fmtFrom(r.from_name, r.from_email),
      to: parseToList(r.to_emails),
      cc: parseToList(r.cc_emails),
      subject: r.subject || "",
      date: sentAt ? sentAt.toUTCString() : "",
      labelIds: parseLabelIds(r.label_ids),
      // Prefer HTML when present (rich rendering), fall back to plain text, then snippet.
      body: r.body_html || r.body_text || r.snippet || "",
      isHtml: !!r.body_html,
    };
  });
  return { id: p.threadId, historyId: "", messages };
}

// ── Parity helper: compares counts/first-page between local and Gmail ──────
export async function parityCheckLocal(p: {
  resolved: Resolved;
  label: "INBOX" | "SENT";
  limit?: number;
}): Promise<{
  label: string;
  accountId: number | undefined;
  ownerUserId: number;
  localCount: number;
  localFirst: { id: string; subject: string; date: string }[];
  tookMs: number;
}> {
  const t0 = Date.now();
  const limit = Math.min(Math.max(Number(p.limit) || 25, 1), 100);
  const where: string[] = [
    `owner_user_id = ${Number(p.resolved.userId)}`,
    `(label_ids ILIKE '%"${p.label}"%' OR label_ids ILIKE '%${p.label}%')`,
  ];
  if (p.resolved.accountId) where.push(`source_account_id = ${Number(p.resolved.accountId)}`);
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const [countRes, rowsRes] = await Promise.all([
    db.execute(sql.raw(`SELECT count(*)::int AS c FROM email_messages ${whereSql}`)),
    db.execute(sql.raw(`
      SELECT gmail_message_id AS id, subject, sent_at
      FROM email_messages
      ${whereSql}
      ORDER BY sent_at DESC NULLS LAST, id DESC
      LIMIT ${limit}
    `)),
  ]);
  const countRow = ((countRes as any).rows?.[0] ?? (countRes as any)[0]) as { c: number };
  const rows = ((rowsRes as any).rows ?? rowsRes) as any[];
  return {
    label: p.label,
    accountId: p.resolved.accountId,
    ownerUserId: p.resolved.userId,
    localCount: Number(countRow?.c ?? 0),
    localFirst: rows.map(r => ({ id: r.id, subject: r.subject || "", date: r.sent_at ? new Date(r.sent_at).toISOString() : "" })),
    tookMs: Date.now() - t0,
  };
}
