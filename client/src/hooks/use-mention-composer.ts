/**
 * use-mention-composer.ts
 *
 * Standalone version of the CURRENTS mention detection + autocomplete hook.
 * Works with any <textarea> ref. Detects @ triggers, searches users,
 * and inserts structured tokens: @[Name](user:ID)
 *
 * Also supports @all — a virtual user that notifies the whole team.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

export type MentionUser = {
  id: number;          // 0 = @all virtual
  name: string;
  email?: string;
  avatarUrl?: string;
  department?: string;
  isAll?: boolean;
};

/** Detect an active @query at the cursor. Returns null when no trigger. */
function detectMentionTrigger(value: string, cursor: number): string | null {
  const before = value.slice(0, cursor);
  const m = before.match(/@([^\s@]*)$/);
  if (!m) return null;
  const query = m[1];
  if (query.length > 30) return null;
  return query;
}

/** Replace the @query with a structured token and return updated value + new cursor. */
export function insertMentionToken(
  value: string,
  cursor: number,
  user: MentionUser
): { newValue: string; newCursor: number } {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const m = before.match(/@([^\s@]*)$/);
  if (!m) return { newValue: value, newCursor: cursor };
  const atPos = before.length - m[0].length;
  const token = user.isAll
    ? `@[all](user:0) `
    : `@[${user.name}](user:${user.id}) `;
  return {
    newValue: value.slice(0, atPos) + token + after,
    newCursor: atPos + token.length,
  };
}

/** Extract all user IDs mentioned in a body (excludes @all = id 0). */
export function extractMentionedIds(body: string): number[] {
  const re = /@\[([^\]]+)\]\(user:(\d+)\)/g;
  const ids = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const uid = Number(m[2]);
    if (uid > 0) ids.add(uid);
  }
  return [...ids];
}

export function useMentionComposer(taRef: React.RefObject<HTMLTextAreaElement>) {
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionAnchorRect, setMentionAnchorRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const { data: rawUsers = [], isLoading: mentionLoading } = useQuery<MentionUser[]>({
    queryKey: ["/api/current/users", mentionQuery],
    queryFn: () =>
      fetch(`/api/current/users?q=${encodeURIComponent(mentionQuery)}`, {
        credentials: "include",
      }).then((r) => r.json()),
    enabled: mentionActive,
    staleTime: 10_000,
  });

  // Prepend virtual @all entry when query matches
  const mentionUsers: MentionUser[] = (() => {
    const q = mentionQuery.toLowerCase();
    const allEntry: MentionUser = { id: 0, name: "all", isAll: true };
    if (!mentionActive) return [];
    const showAll = !q || "all".startsWith(q) || "everyone".startsWith(q) || "team".startsWith(q);
    return showAll ? [allEntry, ...rawUsers] : rawUsers;
  })();

  const clampedIdx = Math.min(mentionIdx, Math.max(0, mentionUsers.length - 1));

  function onValueChange(value: string, cursorPos: number) {
    const q = detectMentionTrigger(value, cursorPos);
    if (q !== null) {
      setMentionQuery(q);
      setMentionIdx(0);
      if (!mentionActive && taRef.current) {
        const rect = taRef.current.getBoundingClientRect();
        setMentionAnchorRect({ top: rect.top, left: rect.left, width: rect.width });
        setMentionActive(true);
      }
    } else {
      if (mentionActive) setMentionActive(false);
    }
  }

  function insertMention(
    draft: string,
    setDraft: (v: string) => void,
    user: MentionUser
  ) {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? draft.length;
    const { newValue, newCursor } = insertMentionToken(draft, cursor, user);
    setDraft(newValue);
    setMentionActive(false);
    requestAnimationFrame(() => {
      ta.setSelectionRange(newCursor, newCursor);
      ta.focus();
    });
  }

  /** Returns true if the keydown was consumed by mention handling. */
  function handleMentionKeyDown(
    e: React.KeyboardEvent,
    draft: string,
    setDraft: (v: string) => void
  ): boolean {
    if (!mentionActive) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIdx((i) => Math.min(i + 1, mentionUsers.length - 1));
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIdx((i) => Math.max(i - 1, 0));
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const user = mentionUsers[clampedIdx];
      if (user) {
        e.preventDefault();
        insertMention(draft, setDraft, user);
        return true;
      }
    }
    if (e.key === "Escape") {
      setMentionActive(false);
      return true;
    }
    return false;
  }

  return {
    mentionActive,
    mentionAnchorRect,
    mentionUsers,
    mentionLoading,
    mentionIdx: clampedIdx,
    setMentionIdx,
    onValueChange,
    insertMention,
    handleMentionKeyDown,
    closeMention: () => setMentionActive(false),
  };
}
