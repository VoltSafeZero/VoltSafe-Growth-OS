// Phase 2B — Local indexed search over email_messages.
// Adds non-destructive performance + full-text indexes; provides searchEmails().
// No Drizzle schema changes (avoids db:push complications with PG-specific tsvector/GIN).
import { db } from "../db";
import { sql } from "drizzle-orm";

const log = (...a: any[]) => console.log("[email-search]", ...a);

// ── 1. Index management ────────────────────────────────────────────────────
// All CREATE INDEX IF NOT EXISTS — idempotent + non-destructive. Safe to run on every boot.
const INDEX_DDL: { name: string; sql: string }[] = [
  // Composite hot-path: per-user inbox list, newest first
  { name: "idx_email_owner_sent", sql: `CREATE INDEX IF NOT EXISTS idx_email_owner_sent ON email_messages (owner_user_id, sent_at DESC NULLS LAST)` },
  // Composite hot-path: per-mailbox (account) list, newest first
  { name: "idx_email_account_sent", sql: `CREATE INDEX IF NOT EXISTS idx_email_account_sent ON email_messages (source_account_id, sent_at DESC NULLS LAST)` },
  // Thread grouping
  { name: "idx_email_thread", sql: `CREATE INDEX IF NOT EXISTS idx_email_thread ON email_messages (gmail_thread_id)` },
  // Filter by domain (e.g. sender domain rollups)
  { name: "idx_email_from_domain", sql: `CREATE INDEX IF NOT EXISTS idx_email_from_domain ON email_messages (from_domain)` },
  // Filter by direction (inbox/sent split)
  { name: "idx_email_direction_sent", sql: `CREATE INDEX IF NOT EXISTS idx_email_direction_sent ON email_messages (direction, sent_at DESC NULLS LAST)` },
  // Trigram index for fast ILIKE on participants (sender/recipient autocomplete-style filters)
  { name: "pg_trgm_extension", sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm` },
  { name: "idx_email_participants_trgm", sql: `CREATE INDEX IF NOT EXISTS idx_email_participants_trgm ON email_messages USING gin (lower(coalesce(all_participants,'')) gin_trgm_ops)` },
  { name: "idx_email_subject_trgm", sql: `CREATE INDEX IF NOT EXISTS idx_email_subject_trgm ON email_messages USING gin (lower(coalesce(subject,'')) gin_trgm_ops)` },
  // Phase 2E — attachment metadata indexes
  { name: "idx_email_attach_message", sql: `CREATE INDEX IF NOT EXISTS idx_email_attach_message ON email_attachments(message_id)` },
  { name: "idx_email_attach_mime", sql: `CREATE INDEX IF NOT EXISTS idx_email_attach_mime ON email_attachments(mime_type)` },
  { name: "idx_email_attach_filename_trgm", sql: `CREATE INDEX IF NOT EXISTS idx_email_attach_filename_trgm ON email_attachments USING gin (lower(coalesce(filename,'')) gin_trgm_ops)` },
  // Full-text search GIN index — expression-based on (subject + from + body + snippet).
  // No schema column needed; PostgreSQL maintains it automatically.
  {
    name: "idx_email_fts",
    sql: `CREATE INDEX IF NOT EXISTS idx_email_fts ON email_messages USING gin (
      to_tsvector('english',
        coalesce(subject, '') || ' ' ||
        coalesce(from_name, '') || ' ' ||
        coalesce(from_email, '') || ' ' ||
        coalesce(snippet, '') || ' ' ||
        coalesce(body_text, '')
      )
    )`,
  },
  // v2 FTS index that adds all_participants — this makes the GIN index usable for
  // searches that match cc/bcc recipients or thread participants by name or email.
  // The legacy idx_email_fts index omits all_participants; local-mailbox queries
  // already include it in the tsvector expression, so this new index unlocks the
  // index scan path instead of falling back to a seq scan every time.
  // Named _v2 so it can coexist with the old index (CREATE IF NOT EXISTS is
  // idempotent; the old index is harmless and will eventually be dropped manually).
  {
    name: "idx_email_fts_v2",
    sql: `CREATE INDEX IF NOT EXISTS idx_email_fts_v2 ON email_messages USING gin (
      to_tsvector('english',
        coalesce(subject, '') || ' ' ||
        coalesce(from_name, '') || ' ' ||
        coalesce(from_email, '') || ' ' ||
        coalesce(snippet, '') || ' ' ||
        coalesce(body_text, '') || ' ' ||
        coalesce(all_participants, '')
      )
    )`,
  },
];

let ensured = false;
export async function ensureSearchIndexes(): Promise<void> {
  if (ensured) return;
  for (const { name, sql: stmt } of INDEX_DDL) {
    try {
      const t0 = Date.now();
      await db.execute(sql.raw(stmt));
      log(`✓ ${name} (${Date.now() - t0}ms)`);
    } catch (e: any) {
      log(`✗ ${name} failed: ${e.message}`);
    }
  }
  ensured = true;
}

// ── 2. Search ──────────────────────────────────────────────────────────────
export type SearchParams = {
  ownerUserId?: number | null;        // restrict to one user's mailboxes
  accountId?: number | null;          // restrict to one source account
  q?: string;                         // free-text query (FTS + all_participants ILIKE for @ terms)
  from?: string;                      // sender substring (email or name) — case-insensitive
  to?: string;                        // recipient substring — case-insensitive
  participants?: string;              // any-participant substring (from OR to OR cc) — case-insensitive
  domain?: string;                    // exact from_domain match (lowercased)
  dateFrom?: string;                  // ISO date (>=)
  dateTo?: string;                    // ISO date (<=)
  label?: string;                     // single label_id substring match (label_ids stored as CSV/JSON text)
  direction?: "inbound" | "outbound" | string;
  limit?: number;                     // default 50, max 200
  offset?: number;                    // default 0
};

export type SearchHit = {
  id: number;
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string | null;
  sentAt: string | null;
  direction: string | null;
  snippet: string | null;          // headline-highlighted when q is given, else original
  labelIds: string | null;
  rank: number | null;             // null when no q
};

export type SearchResult = {
  rows: SearchHit[];
  total: number;
  tookMs: number;
  query: SearchParams;
};

const safe = (s: string) => s.replace(/'/g, "''");
const clampLimit = (n: any) => {
  const v = Math.min(Math.max(Number(n) || 50, 1), 200);
  return v;
};

export async function searchEmails(p: SearchParams): Promise<SearchResult> {
  const t0 = Date.now();
  const limit = clampLimit(p.limit);
  const offset = Math.max(Number(p.offset) || 0, 0);

  const where: string[] = [];
  if (p.ownerUserId != null) where.push(`owner_user_id = ${Number(p.ownerUserId)}`);
  if (p.accountId != null) where.push(`source_account_id = ${Number(p.accountId)}`);
  if (p.from) where.push(`(lower(coalesce(from_email,'')) LIKE '%${safe(p.from.toLowerCase())}%' OR lower(coalesce(from_name,'')) LIKE '%${safe(p.from.toLowerCase())}%')`);
  if (p.to) where.push(`lower(coalesce(to_emails,'')) LIKE '%${safe(p.to.toLowerCase())}%'`);
  if (p.participants) where.push(`lower(coalesce(all_participants,'')) LIKE '%${safe(p.participants.toLowerCase())}%'`);
  if (p.domain) where.push(`from_domain = '${safe(p.domain.toLowerCase())}'`);
  if (p.dateFrom) where.push(`sent_at >= '${safe(p.dateFrom)}'`);
  if (p.dateTo) where.push(`sent_at <= '${safe(p.dateTo)}'`);
  if (p.label) where.push(`coalesce(label_ids,'') ILIKE '%${safe(p.label)}%'`);
  if (p.direction) where.push(`direction = '${safe(p.direction)}'`);

  const q = (p.q || "").trim();
  let rankExpr = "NULL::real AS rank";
  let snippetExpr = "snippet";
  let orderBy = "sent_at DESC NULLS LAST, id DESC";
  if (q) {
    const qLit = `'${safe(q)}'`;
    // all_participants covers from + to + cc so recipient searches ("I emailed zach@…")
    // work even though to_emails isn't in the pre-built GIN index.
    const tsv = `to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(from_name,'') || ' ' || coalesce(from_email,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body_text,'') || ' ' || coalesce(all_participants,''))`;
    const tsq = `plainto_tsquery('english', ${qLit})`;
    const ftsCond = `${tsv} @@ ${tsq}`;
    // For email-address queries, the trigram index on all_participants gives a
    // fast exact substring match that FTS tokenisation can miss (e.g. the @
    // and domain suffix may not tokenise identically in tsvector vs tsquery).
    if (q.includes('@')) {
      const lc = safe(q.toLowerCase());
      where.push(`(${ftsCond} OR lower(coalesce(all_participants,'')) LIKE '%${lc}%')`);
    } else {
      where.push(ftsCond);
    }
    rankExpr = `ts_rank(${tsv}, ${tsq}) AS rank`;
    snippetExpr = `ts_headline('english', coalesce(body_text, snippet, ''), ${tsq}, 'StartSel=<<,StopSel=>>,MaxFragments=1,MaxWords=18,MinWords=6') AS snippet`;
    orderBy = "rank DESC, sent_at DESC NULLS LAST";
  } else {
    snippetExpr = "snippet";
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const baseQuery = `
    SELECT
      id, gmail_message_id AS "gmailMessageId", gmail_thread_id AS "gmailThreadId",
      subject, from_email AS "fromEmail", from_name AS "fromName", to_emails AS "toEmails",
      sent_at AS "sentAt", direction, label_ids AS "labelIds",
      ${snippetExpr.includes(" AS snippet") ? snippetExpr : snippetExpr + " AS snippet"},
      ${rankExpr}
    FROM email_messages
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `;
  const countQuery = `SELECT count(*)::int AS total FROM email_messages ${whereClause}`;

  const [rowsRes, countRes] = await Promise.all([
    db.execute(sql.raw(baseQuery)),
    db.execute(sql.raw(countQuery)),
  ]);
  const rows = ((rowsRes as any).rows ?? rowsRes) as SearchHit[];
  const totalRow = ((countRes as any).rows?.[0] ?? (countRes as any)[0]) as { total: number };
  const total = Number(totalRow?.total ?? 0);

  return { rows, total, tookMs: Date.now() - t0, query: p };
}
