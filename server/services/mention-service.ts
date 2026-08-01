/**
 * mention-service.ts — CMS-wide @mention extraction and persistence.
 *
 * Token format (shared with CURRENTS): @[Name](user:ID)
 * @all token:                           @[all](user:0)
 *
 * Call saveMentions() from any route that accepts user-generated text.
 * It parses tokens, expands @all, and upserts global_mention rows.
 *
 * Call refreshMentions() on edits: it dismisses stale mentions (users
 * whose tokens were removed) and upserts new ones.
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

/** Get all active user IDs (for @all expansion). Cached 60 s. */
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
 * The global_mentions table has a unique constraint on
 * (entity_type, entity_id, mentioned_user_id) so repeated calls are idempotent.
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

    // @all expansion is permitted ONLY for the Currents module.
    // For every other module (leads, notes, comments, tasks, etc.) the @all token
    // is silently ignored — it must never trigger a bulk notification outside Currents.
    const allowAllExpansion = opts.moduleKey === "currents";

    const mentionedUserIds = new Set<number>();
    for (const t of tokens) {
      if (t.isAll) {
        if (allowAllExpansion) {
          const ids = await getAllActiveUserIds();
          ids.forEach(id => mentionedUserIds.add(id));
        }
        // else: @all in a non-Currents field → silently skip (no broadcast)
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
        ON CONFLICT (entity_type, entity_id, mentioned_user_id)
        DO UPDATE SET
          source_preview   = EXCLUDED.source_preview,
          deep_link_url    = EXCLUDED.deep_link_url,
          record_title     = EXCLUDED.record_title,
          updated_at       = NOW()
        WHERE global_mentions.status IN ('unread', 'viewed')
      `);
    }
  } catch (e: any) {
    console.error("[mention-service] saveMentions error:", e?.message || e);
  }
}

/**
 * Re-parse and refresh global_mentions for an edited entity.
 *
 * - Dismisses existing unread mentions for users whose tokens were REMOVED.
 * - Upserts (or refreshes preview) for users still or newly mentioned.
 * - Does NOT duplicate notifications — the ON CONFLICT handles idempotency.
 */
export async function refreshMentions(opts: SaveMentionsOptions): Promise<void> {
  try {
    const tokens = parseMentionTokens(opts.body);

    // @all expansion is permitted ONLY for the Currents module (same rule as saveMentions).
    const allowAllExpansion = opts.moduleKey === "currents";

    // Compute new set of mentioned user IDs
    const newMentionedIds = new Set<number>();
    for (const t of tokens) {
      if (t.isAll) {
        if (allowAllExpansion) {
          const ids = await getAllActiveUserIds();
          ids.forEach(id => newMentionedIds.add(id));
        }
        // else: @all in a non-Currents edit → silently ignored
      } else if (t.userId > 0) {
        newMentionedIds.add(t.userId);
      }
    }
    newMentionedIds.delete(opts.authorId);

    const entityType = opts.entityType.replace(/'/g, "''").slice(0, 80);
    const entityId = Number(opts.entityId);

    if (entityId > 0) {
      if (newMentionedIds.size === 0) {
        // All mentions removed — dismiss all existing unread rows for this entity
        await db.execute(sql.raw(`
          UPDATE global_mentions SET status = 'dismissed', updated_at = NOW()
          WHERE entity_type = '${entityType}' AND entity_id = ${entityId}
            AND status IN ('unread', 'viewed')
        `));
      } else {
        // Dismiss mentions for users who were removed from the body
        const keepList = [...newMentionedIds].join(",");
        await db.execute(sql.raw(`
          UPDATE global_mentions SET status = 'dismissed', updated_at = NOW()
          WHERE entity_type = '${entityType}' AND entity_id = ${entityId}
            AND status IN ('unread', 'viewed')
            AND mentioned_user_id NOT IN (${keepList})
        `));
      }
    }

    // Upsert mentions for remaining / newly added users
    if (newMentionedIds.size > 0) {
      await saveMentions(opts);
    }
  } catch (e: any) {
    console.error("[mention-service] refreshMentions error:", e?.message || e);
  }
}
