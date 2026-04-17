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
  // Multi-mailbox Phase 1: present when caller is in unified mode so the UI can
  // render an account badge per row. Always populated from email_messages.source_account_id.
  sourceAccountId?: number;
};

export type LocalThreadStub = { id: string; snippet: string; historyId: string };

export type LocalAttachment = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  isInline: boolean;
  contentId: string | null;
};

export type LocalThreadDetail = {
  id: string;
  historyId: string;
  messages: Array<{
    id: string; threadId: string; snippet: string; internalDate: string;
    from: string; to: string; cc: string; subject: string; date: string;
    labelIds: string[]; body: string; isHtml: boolean;
    attachments: LocalAttachment[];
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
// Phase 2E adds attachment filters: has:attachment, filename:foo, mime:application/pdf
function buildQClauses(q: string): { where: string[]; freeText: string } {
  const where: string[] = [];
  let rest = q || "";

  const inMatch = rest.match(/\bin:(\w+)/i);
  if (inMatch) {
    const label = inMatch[1].toUpperCase();
    rest = rest.replace(inMatch[0], "").trim();
    where.push(`(label_ids ILIKE '%"${safe(label)}"%' OR label_ids ILIKE '%${safe(label)}%')`);
  }

  // has:attachment / has:attachments
  const hasAttachMatch = rest.match(/\bhas:attachments?\b/i);
  if (hasAttachMatch) {
    rest = rest.replace(hasAttachMatch[0], "").trim();
    where.push(`EXISTS (SELECT 1 FROM email_attachments a WHERE a.message_id = email_messages.id AND a.is_inline = false)`);
  }

  // filename:foo  (quoted or unquoted; matches via trigram on filename)
  const fnMatch = rest.match(/\bfilename:(?:"([^"]+)"|(\S+))/i);
  if (fnMatch) {
    const term = (fnMatch[1] || fnMatch[2] || "").trim();
    rest = rest.replace(fnMatch[0], "").trim();
    if (term) {
      where.push(`EXISTS (SELECT 1 FROM email_attachments a WHERE a.message_id = email_messages.id AND lower(a.filename) LIKE '%${safe(term.toLowerCase())}%')`);
    }
  }

  // mime:application/pdf  or  mime:image  (substring match on mime_type)
  const mimeMatch = rest.match(/\bmime:(\S+)/i);
  if (mimeMatch) {
    const term = mimeMatch[1].trim();
    rest = rest.replace(mimeMatch[0], "").trim();
    if (term) {
      where.push(`EXISTS (SELECT 1 FROM email_attachments a WHERE a.message_id = email_messages.id AND lower(a.mime_type) LIKE '%${safe(term.toLowerCase())}%')`);
    }
  }

  // from:foo  (substring match on from_email or from_name)
  const fromMatch = rest.match(/\bfrom:(?:"([^"]+)"|(\S+))/i);
  if (fromMatch) {
    const term = (fromMatch[1] || fromMatch[2] || "").trim();
    rest = rest.replace(fromMatch[0], "").trim();
    if (term) {
      const t = safe(term.toLowerCase());
      where.push(`(lower(coalesce(from_email,'')) LIKE '%${t}%' OR lower(coalesce(from_name,'')) LIKE '%${t}%')`);
    }
  }

  // after:YYYY-MM-DD  /  before:YYYY-MM-DD
  const afterMatch = rest.match(/\bafter:(\d{4}-\d{2}-\d{2})/i);
  if (afterMatch) {
    rest = rest.replace(afterMatch[0], "").trim();
    where.push(`sent_at >= '${afterMatch[1]}'::date`);
  }
  const beforeMatch = rest.match(/\bbefore:(\d{4}-\d{2}-\d{2})/i);
  if (beforeMatch) {
    rest = rest.replace(beforeMatch[0], "").trim();
    where.push(`sent_at < '${beforeMatch[1]}'::date`);
  }

  return { where, freeText: rest.trim() };
}

// Multi-mailbox Phase 1: `accountIds` (plural) is the unified-inbox path used when the user
// selects "All Inboxes" — it filters via IN (...) across every account they can access.
// When neither `accountId` nor `accountIds` is set, the legacy "all of this user's own messages"
// behaviour is preserved exactly for backward compatibility.
type Resolved = { userId: number; accountId?: number; accountIds?: number[] };

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

  // Multi-mailbox Phase 1 fix: in unified mode, authorization comes from the IN(...) list
  // (already permission-vetted via getAccessibleAccountIds in resolveAccount). Hard-binding
  // owner_user_id to the caller would silently drop shared-mailbox rows owned by other users.
  const where: string[] = [];
  if (p.resolved.accountIds && p.resolved.accountIds.length > 0) {
    const ids = p.resolved.accountIds.map(n => Number(n)).filter(n => Number.isFinite(n));
    if (ids.length === 0) return { messages: [], nextPageToken: null, tookMs: 0 };
    where.push(`source_account_id IN (${ids.join(",")})`);
  } else if (p.resolved.accountId) {
    where.push(`source_account_id = ${Number(p.resolved.accountId)}`);
  } else {
    where.push(`owner_user_id = ${Number(p.resolved.userId)}`);
  }

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
      from_email, from_name, to_emails, subject, label_ids, source_account_id
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
      sourceAccountId: r.source_account_id != null ? Number(r.source_account_id) : undefined,
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

  // Same fix as listLocalMessages — accountIds path is its own authorization boundary.
  const where: string[] = [];
  if (p.resolved.accountIds && p.resolved.accountIds.length > 0) {
    const ids = p.resolved.accountIds.map(n => Number(n)).filter(n => Number.isFinite(n));
    if (ids.length === 0) return { threads: [], nextPageToken: null, tookMs: 0 };
    where.push(`source_account_id IN (${ids.join(",")})`);
  } else if (p.resolved.accountId) {
    where.push(`source_account_id = ${Number(p.resolved.accountId)}`);
  } else {
    where.push(`owner_user_id = ${Number(p.resolved.userId)}`);
  }
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
      id, gmail_message_id, gmail_thread_id, snippet, sent_at,
      from_email, from_name, to_emails, cc_emails, subject, label_ids, body_text, body_html
    FROM email_messages
    WHERE ${where.join(" AND ")}
    ORDER BY sent_at ASC NULLS LAST, id ASC
  `));
  const rows = ((rowsRes as any).rows ?? rowsRes) as any[];
  if (rows.length === 0) return null;

  // Pull attachment metadata for these message rows in one query
  const messageIds = rows.map(r => Number(r.id || r.message_pk)).filter(Boolean);
  let attachByMsg = new Map<number, LocalAttachment[]>();
  if (messageIds.length > 0) {
    const attachRes = await db.execute(sql.raw(`
      SELECT message_id, filename, mime_type, size_bytes, is_inline, content_id
      FROM email_attachments
      WHERE message_id IN (${messageIds.join(",")})
      ORDER BY id ASC
    `));
    const attachRows = ((attachRes as any).rows ?? attachRes) as any[];
    for (const a of attachRows) {
      const list = attachByMsg.get(Number(a.message_id)) || [];
      list.push({
        filename: a.filename || "(unnamed)",
        mimeType: a.mime_type || "application/octet-stream",
        sizeBytes: Number(a.size_bytes) || 0,
        isInline: !!a.is_inline,
        contentId: a.content_id || null,
      });
      attachByMsg.set(Number(a.message_id), list);
    }
  }

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
      body: r.body_html || r.body_text || r.snippet || "",
      isHtml: !!r.body_html,
      attachments: attachByMsg.get(Number(r.id)) || [],
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
