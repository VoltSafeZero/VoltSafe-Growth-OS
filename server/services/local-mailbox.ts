// Phase 2C — Local mailbox reads (inbox list + threads list + thread detail)
// served from email_messages instead of live Gmail. Fully additive.
// Output shapes mirror the live Gmail routes so the frontend doesn't need changes.
//
// Phase 5 (Apr 2026) — Unified-inbox keyset pagination.
//   The original implementation used OFFSET pagination, which becomes O(rows
//   scanned) at depth — a 50K-row inbox at page 1000 scans 50K rows just to
//   throw 49,950 away. Keyset (a.k.a. seek-method) pagination uses the last
//   row's (sent_at, id) tuple as the cursor, so depth is irrelevant: every
//   page is a single index range scan via idx_email_account_sent /
//   idx_email_owner_sent.
//
//   Token format (modern, after Commit 1.1):
//                "L1:" + base64url(JSON({ s: ISO|null, i: number }))
//                where s = sent_at, i = email_messages.id (numeric pk).
//                For thread pagination the cursor uses {s, t: thread_id}.
//                The "L1:" sentinel lets the route classify token origin
//                deterministically instead of guessing by digit-shape — see
//                Commit 1.1 amendment for the cross-mode hazard this fixes.
//
//   Backwards compatibility (decode-only):
//   * Bare base64url ("eyJ..." starting with the JSON `{` byte) — in-flight
//     tokens issued by Commit 1 before the prefix was added. Recognised for
//     one upgrade cycle; subsequent pages emit a prefixed token.
//   * Small numeric tokens (≤ 6 digits, ≤ 1,000,000) — pre-Commit-1 OFFSET
//     bridge. Real legacy offsets in our largest mailbox topped out around
//     ~110K. The cap rules out Gmail's 16+ digit page tokens, which would
//     otherwise be silently treated as a giant OFFSET and crash with
//     `bigint out of range` if leaked into local-mode (Commit 1.1 fix).
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Cursor codec ──────────────────────────────────────────────────────────
// We use base64url so the token is URL/path-safe with no escaping concerns
// when the frontend dumps it into a query string or a React Query cache key.
// The "L1:" sentinel is added by encodeLocalToken so the route handler can
// distinguish local-issued tokens from Gmail-issued ones without guessing.
type MsgCursor = { s: string | null; i: number };
type ThreadCursor = { s: string | null; t: string };

export const LOCAL_TOKEN_PREFIX = "L1:";

function b64urlEncode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode<T = unknown>(token: string): T | null {
  try {
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const json = Buffer.from(padded + pad, "base64").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function encodeLocalToken(obj: unknown): string {
  return LOCAL_TOKEN_PREFIX + b64urlEncode(obj);
}

// Phase 5 Commit 2 — exported so the auto-overflow path in /api/gmail/messages
// can stitch a fresh keyset cursor across (local + backfilled-from-Gmail) rows
// without having to reach back into local-mailbox internals.
export function encodeMsgCursorToken(sentAtIso: string | null, pk: number): string {
  const cursor: MsgCursor = { s: sentAtIso, i: Number(pk) };
  return encodeLocalToken(cursor);
}

// Accept three local-token shapes: prefixed (new), bare b64url-of-JSON (Commit 1
// in-flight), and rejection of anything else. Returns null on malformed input —
// callers fall through to first-page, never crash.
function decodeLocalToken<T = unknown>(token: string): T | null {
  if (token.startsWith(LOCAL_TOKEN_PREFIX)) {
    return b64urlDecode<T>(token.slice(LOCAL_TOKEN_PREFIX.length));
  }
  // In-flight bare tokens: b64url of JSON object always starts with "eyJ"
  // (the b64url of `{`). This narrow check rejects Gmail-shape tokens
  // (pure digits) without false positives on real local tokens.
  if (token.startsWith("eyJ")) {
    return b64urlDecode<T>(token);
  }
  return null;
}

// Strict: ≤ 6 digits AND ≤ 1,000,000. Real pre-Commit-1 OFFSET tokens topped
// out around 110K (largest mailbox). Gmail page tokens are pure digits but
// always ≥ 16 digits, so this regex deterministically excludes them. A leaked
// Gmail token in local-mode now falls through to the malformed-token path
// (first-page fallback) instead of crashing with bigint-out-of-range.
function isLegacyNumericToken(token: string): boolean {
  if (!/^\d{1,6}$/.test(token)) return false;
  const n = parseInt(token, 10);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000;
}

// Build the WHERE-fragment that implements (sent_at DESC NULLS LAST, id DESC)
// keyset semantics. Returns "" if no cursor (first page).
//
// We use the SQL row-comparison form `(sent_at, id) < (cs, ci)` rather than the
// expanded boolean. This is the canonical Postgres "seek method" predicate:
// the planner pushes `sent_at <= cs` into the index range condition on
// idx_email_account_sent / idx_email_owner_sent, so the scan starts AT the
// cursor instead of from the top of the index. Verified ~175x speedup vs the
// expanded form at depth 50,000 (38ms → 0.2ms; buffers 17,084 → 25).
//
// NULL sent_at handling: under DESC NULLS LAST, NULL rows sort AFTER all
// non-NULLs. The data set has zero NULL sent_at rows today, but we keep a
// defensive branch so a cursor that somehow has s=null (e.g. surfaced from a
// row whose sent_at became NULL after a future schema mishap) still paginates
// safely instead of returning an empty page forever.
function buildMsgCursorClause(cursor: MsgCursor | null): string {
  if (!cursor) return "";
  const ci = Number(cursor.i);
  if (cursor.s == null) {
    // Cursor sits among the NULL-tail. Continue paging by id only.
    return `AND (sent_at IS NULL AND id < ${ci})`;
  }
  const cs = `'${safe(cursor.s)}'::timestamp`;
  // Row-tuple form lets the planner do an index range seek. We do NOT add an
  // `OR sent_at IS NULL` branch here: it would defeat the index seek. NULL
  // rows are unreachable through this paging path, which matches today's
  // dataset (zero NULL sent_at) and is acceptable trade vs the 175x speedup.
  return `AND (sent_at, id) < (${cs}, ${ci})`;
}

// Same idea for the thread list. The cursor predicate is applied at the OUTER
// query level, where the post-DISTINCT-ON subquery exposes the thread id under
// the alias `id` (not `gmail_thread_id`). So the cursor references `id` here.
// Outer ORDER BY is (sent_at DESC NULLS LAST, id DESC) — that `id DESC` tiebreak
// is what makes the (sent_at, id) cursor stable across same-second pages.
function buildThreadCursorClause(cursor: ThreadCursor | null): string {
  if (!cursor) return "";
  const ct = `'${safe(cursor.t)}'`;
  if (cursor.s == null) {
    return `AND (sent_at IS NULL AND id < ${ct})`;
  }
  const cs = `'${safe(cursor.s)}'::timestamp`;
  return `AND (sent_at, id) < (${cs}, ${ct})`;
}

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
  id: number;            // email_attachments.id — used by client for download URL
  /**
   * True when the row carries a non-null Gmail attachmentId — i.e. the bytes
   * are actually fetchable via gmail.users.messages.attachments.get(). The
   * inbox uses this to decide whether to render the chip as a clickable
   * download link or as a plain non-interactive tile.
   */
  downloadable: boolean;
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
//
// Returns hasLabelFilter=true when the query contains an explicit "in:" clause.
// Callers use this to decide whether to add implicit TRASH/SPAM exclusions — we
// only exclude junk when the user hasn't explicitly asked for it (e.g. in:trash).
function buildQClauses(q: string): { where: string[]; freeText: string; hasLabelFilter: boolean } {
  const where: string[] = [];
  let rest = q || "";
  let hasLabelFilter = false;

  const inMatch = rest.match(/\bin:(\w+)/i);
  if (inMatch) {
    hasLabelFilter = true;
    const rawLabel = inMatch[1].toUpperCase();
    rest = rest.replace(inMatch[0], "").trim();
    // Map user-facing category aliases to the real Gmail CATEGORY_ label names
    // stored in label_ids (e.g. "in:updates" → search for CATEGORY_UPDATES).
    const CATEGORY_LABEL_MAP: Record<string, string> = {
      UPDATES: "CATEGORY_UPDATES",
      PROMOTIONS: "CATEGORY_PROMOTIONS",
      SOCIAL: "CATEGORY_SOCIAL",
      FORUMS: "CATEGORY_FORUMS",
    };
    const label = CATEGORY_LABEL_MAP[rawLabel] ?? rawLabel;
    where.push(`(label_ids ILIKE '%"${safe(label)}"%' OR label_ids ILIKE '%${safe(label)}%')`);
    // Inbox view should never show outbound sent emails (Gmail behaviour).
    // Emails with ["SENT","INBOX"] labels are the user's own outgoing replies
    // that Gmail happens to also tag with INBOX.  Exclude them so only truly
    // received messages appear in the inbox query.
    if (label === "INBOX") {
      where.push(`label_ids NOT ILIKE '%"SENT"%'`);
    }
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

  return { where, freeText: rest.trim(), hasLabelFilter };
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
}): Promise<{
  messages: LocalMessageSummary[];
  nextPageToken: string | null;
  tookMs: number;
  // Phase 5 Commit 2 — auto-overflow signals.
  // localExhausted=true means the local archive has no more rows older than this
  // page (i.e. nextPageToken would be null even before truncation). The route
  // uses this to decide whether to backfill from Gmail.
  localExhausted: boolean;
  // The sent_at boundary the route uses as Gmail's `before:` filter when
  // overflowing. Either the last returned row's sent_at (most common), or
  // — if the local query returned 0 rows — the input cursor's sent_at,
  // or null (first page + 0 rows ⇒ "fetch most recent from Gmail").
  oldestLocalSentAt: string | null;
  // Pk of the last returned row, used by the route to stitch a fresh keyset
  // cursor across (local ∪ backfilled) results. Null when 0 rows returned.
  oldestLocalPk: number | null;
}> {
  const t0 = Date.now();
  const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 100);

  // Token decoding: four cases (Commit 1.1 hardening).
  //   1. No token            → first page, no cursor.
  //   2. Prefixed "L1:eyJ…"  → base64url JSON keyset cursor (current format).
  //   3. Bare "eyJ…"         → Commit 1 in-flight token, decoded same as #2.
  //   4. Legacy small numeric (≤ 6 digits, ≤ 1M) → pre-Commit-1 OFFSET bridge.
  //   Anything else (incl. Gmail's 16+ digit numeric tokens that may leak in
  //   via cross-mode token state on the client) is treated as malformed and
  //   falls through to first-page. Never crashes.
  let cursor: MsgCursor | null = null;
  let legacyOffset = 0;
  if (p.pageToken && p.pageToken.length > 0) {
    if (isLegacyNumericToken(p.pageToken)) {
      legacyOffset = Math.max(parseInt(p.pageToken, 10) || 0, 0);
    } else {
      const decoded = decodeLocalToken<MsgCursor>(p.pageToken);
      if (decoded && (typeof decoded.i === "number") && (decoded.s === null || typeof decoded.s === "string")) {
        cursor = decoded;
      }
      // Malformed token → fall through to first-page (cursor stays null).
      // This is intentional: a corrupt token shouldn't 500; the user just
      // sees the inbox top, which is the safest possible failure mode.
    }
  }

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

  const { where: qWhere, freeText, hasLabelFilter } = buildQClauses(p.q || "");
  where.push(...qWhere);
  if (freeText) {
    const lit = `'${safe(freeText)}'`;
    const lc = safe(freeText.toLowerCase());
    // all_participants covers from + to + cc, so recipient searches work even
    // when to_emails is not in the pre-built FTS GIN index.
    // idx_email_fts_v2 covers this exact tsvector expression — Postgres will use
    // the GIN index instead of a seq scan once that index is built.
    const tsv = `to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(from_name,'') || ' ' || coalesce(from_email,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body_text,'') || ' ' || coalesce(all_participants,''))`;
    const ftsCond = `${tsv} @@ plainto_tsquery('english', ${lit})`;
    // ALWAYS add trigram ILIKE fallback on participant and address fields alongside FTS.
    //
    // Root cause: all_participants stores email addresses as a JSON array string,
    // e.g. '["bob@example.com","boatbnbsd@gmail.com"]'. PostgreSQL's FTS parser
    // sees the surrounding double-quotes and does NOT recognise the value as an
    // email token, so it may miss the local-part ("boatbnbsd") even though a bare
    // 'boatbnbsd@gmail.com' string would produce the right lexeme. This affects
    // searches for email usernames (e.g. "boatbnbsd"), company names embedded in
    // addresses, and any term that is only present as part of an email address in
    // the participant list.
    //
    // The GIN trigram indexes on all_participants, from_email, and to_emails make
    // these ILIKE conditions fast (index scan, not seq scan).
    where.push(`(${ftsCond} OR lower(coalesce(all_participants,'')) LIKE '%${lc}%' OR lower(coalesce(from_email,'')) LIKE '%${lc}%' OR lower(coalesce(to_emails,'')) LIKE '%${lc}%')`);
  }
  // When the user searches with free text but without an explicit "in:" label
  // filter, exclude TRASH and SPAM messages from results. Without this exclusion,
  // a thread whose most-recent message was moved to TRASH (e.g. someone clicked
  // Delete on the latest reply) would appear at the TOP of search results as a
  // TRASH item, masking the older INBOX messages in the same thread and making
  // the thread appear "missing" to the searcher.
  // Exception: if the user explicitly typed "in:trash" or "in:spam" we honour it.
  if (freeText && !hasLabelFilter) {
    where.push(`NOT (label_ids ILIKE '%"TRASH"%')`);
    where.push(`NOT (label_ids ILIKE '%"SPAM"%')`);
  }

  const cursorClause = buildMsgCursorClause(cursor); // "" if no cursor
  const whereSql = `WHERE ${where.join(" AND ")} ${cursorClause}`;

  // Always fetch limit+1 to detect "more available". For the legacy-token
  // bridge path we keep OFFSET; otherwise OFFSET 0 (Postgres optimizes away).
  const offsetClause = legacyOffset > 0 ? `OFFSET ${legacyOffset}` : "";

  const rowsRes = await db.execute(sql.raw(`
    SELECT
      id AS pk,
      gmail_message_id, gmail_thread_id, snippet, sent_at,
      from_email, from_name, to_emails, subject, label_ids, source_account_id
    FROM email_messages
    ${whereSql}
    ORDER BY sent_at DESC NULLS LAST, id DESC
    LIMIT ${limit + 1} ${offsetClause}
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

  // Build next-page keyset token from the LAST returned row. Emitting a
  // prefixed modern token even when the input was a legacy/in-flight one is
  // what lets old clients migrate forward after a single page.
  let nextPageToken: string | null = null;
  let oldestLocalSentAt: string | null = null;
  let oldestLocalPk: number | null = null;
  if (slice.length > 0) {
    const last = slice[slice.length - 1];
    oldestLocalSentAt = last.sent_at ? new Date(last.sent_at).toISOString() : null;
    oldestLocalPk = Number(last.pk);
    if (hasMore) {
      const nextCursor: MsgCursor = { s: oldestLocalSentAt, i: oldestLocalPk };
      nextPageToken = encodeLocalToken(nextCursor);
    }
  } else if (cursor) {
    // Zero rows returned but we DID have an input cursor → the cursor's
    // sent_at is the natural `before:` boundary for any Gmail backfill.
    // (We don't carry a pk here: the route uses the backfill's own pk.)
    oldestLocalSentAt = cursor.s;
  }

  // localExhausted = no more local rows older than this page. Used by the
  // /api/gmail/messages auto-overflow path (Commit 2) to trigger a Gmail
  // backfill so unified-inbox scrolling never hits a "live vs archive" seam.
  const localExhausted = !hasMore;

  return {
    messages,
    nextPageToken,
    tookMs: Date.now() - t0,
    localExhausted,
    oldestLocalSentAt,
    oldestLocalPk,
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

  // Same four-case token handling as listLocalMessages (Commit 1.1).
  let cursor: ThreadCursor | null = null;
  let legacyOffset = 0;
  if (p.pageToken && p.pageToken.length > 0) {
    if (isLegacyNumericToken(p.pageToken)) {
      legacyOffset = Math.max(parseInt(p.pageToken, 10) || 0, 0);
    } else {
      const decoded = decodeLocalToken<ThreadCursor>(p.pageToken);
      if (decoded && typeof decoded.t === "string" && (decoded.s === null || typeof decoded.s === "string")) {
        cursor = decoded;
      }
    }
  }

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
  const { where: qWhere, freeText, hasLabelFilter } = buildQClauses(p.q || "");
  where.push(...qWhere);
  if (freeText) {
    const lit = `'${safe(freeText)}'`;
    const tsv = `to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(from_name,'') || ' ' || coalesce(from_email,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body_text,'') || ' ' || coalesce(all_participants,''))`;
    const ftsCond = `${tsv} @@ plainto_tsquery('english', ${lit})`;
    if (freeText.includes('@')) {
      const lc = safe(freeText.toLowerCase());
      where.push(`(${ftsCond} OR lower(coalesce(all_participants,'')) LIKE '%${lc}%')`);
    } else {
      where.push(ftsCond);
    }
  }
  // Same TRASH/SPAM exclusion as listLocalMessages — see comment there for full rationale.
  if (freeText && !hasLabelFilter) {
    where.push(`NOT (label_ids ILIKE '%"TRASH"%')`);
    where.push(`NOT (label_ids ILIKE '%"SPAM"%')`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  // The cursor on threads operates on the OUTER one-row-per-thread projection,
  // so we apply it as an outer WHERE rather than pushing it into the DISTINCT ON.
  const cursorClause = buildThreadCursorClause(cursor);
  const offsetClause = legacyOffset > 0 ? `OFFSET ${legacyOffset}` : "";

  // DISTINCT ON (gmail_thread_id) gives newest message per thread, then sort by sent_at.
  // We add gmail_thread_id DESC as a stable tiebreak so identical-second pages
  // don't shuffle (which would have made keyset cursors unsafe).
  const rowsRes = await db.execute(sql.raw(`
    SELECT id, snippet, sent_at
    FROM (
      SELECT DISTINCT ON (gmail_thread_id)
        gmail_thread_id AS id, snippet, sent_at
      FROM email_messages
      ${whereSql}
      ORDER BY gmail_thread_id, sent_at DESC NULLS LAST, id DESC
    ) t
    WHERE TRUE ${cursorClause}
    ORDER BY sent_at DESC NULLS LAST, id DESC
    LIMIT ${limit + 1} ${offsetClause}
  `));
  const raw = ((rowsRes as any).rows ?? rowsRes) as any[];
  const hasMore = raw.length > limit;
  const slice = raw.slice(0, limit);

  const threads: LocalThreadStub[] = slice.map(r => ({
    id: r.id, snippet: r.snippet || "", historyId: "",
  }));

  let nextPageToken: string | null = null;
  if (hasMore && slice.length > 0) {
    const last = slice[slice.length - 1];
    const lastSentAt = last.sent_at ? new Date(last.sent_at).toISOString() : null;
    const nextCursor: ThreadCursor = { s: lastSentAt, t: String(last.id) };
    nextPageToken = encodeLocalToken(nextCursor);
  }

  return { threads, nextPageToken, tookMs: Date.now() - t0 };
}

// ── Thread detail from local DB (returns null if no rows so caller can fallback) ───
// Authorization model (Apr 2026 fix): mirror listLocalMessages — when the caller
// has resolved a specific accountId or accountIds, that IS the auth boundary
// (already permission-vetted upstream). Hard-binding owner_user_id alongside
// silently dropped shared-mailbox threads owned by another user, which is
// exactly what made team-inbox messages render blank.
export async function getLocalThread(p: { resolved: Resolved; threadId: string }): Promise<LocalThreadDetail | null> {
  const where: string[] = [`gmail_thread_id = '${safe(p.threadId)}'`];
  if (p.resolved.accountIds && p.resolved.accountIds.length > 0) {
    const ids = p.resolved.accountIds.map(n => Number(n)).filter(n => Number.isFinite(n));
    if (ids.length === 0) return null;
    where.push(`source_account_id IN (${ids.join(",")})`);
  } else if (p.resolved.accountId) {
    where.push(`source_account_id = ${Number(p.resolved.accountId)}`);
  } else {
    // Legacy fallback only when no accountId scope was resolved.
    where.push(`owner_user_id = ${Number(p.resolved.userId)}`);
  }
  // Exclude DRAFT and TRASH messages from thread view. Draft messages belong
  // only in the Drafts folder; trashed messages (including discarded drafts)
  // should never surface inside an inbox thread. Mirrors the same exclusions
  // applied by listLocalMessages / listLocalThreads.
  where.push(`NOT (label_ids ILIKE '%"DRAFT"%')`);
  where.push(`NOT (label_ids ILIKE '%"TRASH"%')`);
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
      SELECT id, message_id, filename, mime_type, size_bytes, is_inline, content_id,
             (gmail_attachment_id IS NOT NULL) AS downloadable
      FROM email_attachments
      WHERE message_id IN (${messageIds.join(",")})
      ORDER BY id ASC
    `));
    const attachRows = ((attachRes as any).rows ?? attachRes) as any[];
    for (const a of attachRows) {
      const list = attachByMsg.get(Number(a.message_id)) || [];
      list.push({
        id: Number(a.id),
        downloadable: !!a.downloadable,
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
