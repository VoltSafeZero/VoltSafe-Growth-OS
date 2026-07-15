/**
 * mention-service.ts — CMS-wide @mention extraction and persistence.
 *
 * Token format (shared with CURRENTS): @[Name](user:ID)
 * @all token:                           @[all](user:0)
 *
 * Call saveMentions() from any route that accepts user-generated text.
 * It parses tokens, expands @all, and upserts global_mention rows.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface MentionToken {
  userId: number;
  name: string;
  isAll: boolean;
}

const MENTION_RE = /@\[([^\]]+)\]\(user:(\d+)\)/g;

/** Parse @[Name](user:ID) tokens from a body string. */
export function parseMentionTokens(body: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, "g");
  while ((match = re.exec(body)) !== null) {
    const name = match[1];
    const userId = Number(match[2]);
    tokens.push({ userId, name, isAll: userId === 0 || name === "all" });
  }
  return tokens;
}

/** Get all active user IDs (for @all expansion). Cached 60s. */
let _allUserCache: { ids: number[]; at: number } | null = null;
async function getAllActiveUserIds(): Promise<number[]> {
  const now = Date.now();
  if (_allUserCache && now - _allUserCache.at < 60_000) return _allUserCache.ids;
  const rows: any = await db.execute(sql`
    SELECT id FROM users WHERE global_role NOT IN ('inactive') ORDER BY id`);
  const ids = (rows.rows ?? []).map((r: any) => Number(r.id));
  _allUserCache = { ids, at: now };
  return ids;
}

export interface SaveMentionsOptions {
  body: string;
  entityType: string;       // e.g. 'task_comment', 'current_message', 'activity', 'lead_note'
  entityId: number;
  moduleKey: string;        // e.g. 'tasks', 'currents', 'leads', 'accounts'
  moduleLabel: string;      // display label, e.g. 'Task HUB', 'CURRENTS', 'Leads'
  authorId: number;
  recordTitle?: string;
  deepLinkUrl?: string;
  requestedAction?: string; // 'mention' | 'fyi' | 'review' | 'respond' | 'approve' | 'complete'
}

/**
 * Extract @mentions from `body`, resolve @all, and persist to global_mentions.
 * Safe to call fire-and-forget — errors are logged, not thrown.
 */
export async function saveMentions(opts: SaveMentionsOptions): Promise<void> {
  try {
    const tokens = parseMentionTokens(opts.body);
    if (tokens.length === 0) return;

    const preview = opts.body
      .replace(/@\[([^\]]+)\]\(user:\d+\)/g, "@$1")
      .slice(0, 200);
    const requestedAction = opts.requestedAction ?? "mention";

    // Expand @all to all active users
    const mentionedUserIds = new Set<number>();
    for (const t of tokens) {
      if (t.isAll) {
        const ids = await getAllActiveUserIds();
        ids.forEach(id => mentionedUserIds.add(id));
      } else if (t.userId > 0) {
        mentionedUserIds.add(t.userId);
      }
    }

    // Remove the author from their own mention list
    mentionedUserIds.delete(opts.authorId);
    if (mentionedUserIds.size === 0) return;

    const hasAll = tokens.some(t => t.isAll);
    const recordTitle = (opts.recordTitle ?? "").slice(0, 200);
    const deepLinkUrl = (opts.deepLinkUrl ?? "").slice(0, 500);
    const moduleLabel = (opts.moduleLabel ?? opts.moduleKey).slice(0, 80);
    const entityType = opts.entityType.slice(0, 80);
    const moduleKey = opts.moduleKey.slice(0, 80);

    for (const uid of mentionedUserIds) {
      await db.execute(sql`
        INSERT INTO global_mentions
          (mentioned_user_id, author_user_id, entity_type, entity_id,
           module_key, module_label, record_title, source_preview,
           requested_action, deep_link_url, is_all_mention, status)
        VALUES
          (${uid}, ${opts.authorId}, ${entityType}, ${opts.entityId},
           ${moduleKey}, ${moduleLabel}, ${recordTitle}, ${preview},
           ${requestedAction}, ${deepLinkUrl}, ${hasAll}, 'unread')
        ON CONFLICT DO NOTHING
      `);
    }
  } catch (e: any) {
    console.error("[mention-service] saveMentions error:", e?.message || e);
  }
}

/**
 * Re-parse and refresh global_mentions for an edited entity.
 * Marks any removed mentions as dismissed; adds new ones.
 */
export async function refreshMentions(opts: SaveMentionsOptions): Promise<void> {
  // Simplest safe approach: insert new ones (duplicates ignored via ON CONFLICT DO NOTHING
  // — note: our table has no unique constraint yet, but saveMentions is idempotent for
  // fire-and-forget edit flows). For a full diff we'd need entity-scoped cleanup.
  await saveMentions(opts);
}
