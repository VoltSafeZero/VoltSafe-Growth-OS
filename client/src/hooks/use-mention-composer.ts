/**
 * use-mention-composer.ts
 *
 * Manages @mention detection, user autocomplete, and CLEAN TEXT insertion.
 *
 * KEY DESIGN RULE: The textarea ALWAYS shows clean human-readable text.
 *   - Typing @scott and clicking Scott → textarea shows "@Scott "
 *   - Raw token format  @[Scott](user:138)  is ONLY used for DB storage
 *
 * To convert:
 *   DB → editor:   tokensToCleanText(storedText)   (call before setState)
 *   editor → DB:   mentionRef.current.getTokenizedValue(cleanText)  (call before save)
 */

import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

export type MentionUser = {
  id: number;          // 0 = @all virtual
  name: string;
  email?: string;
  avatarUrl?: string;
  department?: string;
  isAll?: boolean;
};

/** Internal: tracks one @mention insertion in clean-text coordinate space. */
export type MentionEntry = {
  name: string;
  userId: number;
  isAll: boolean;
  atPos: number; // inclusive start of "@Name" in the clean textarea value
  end: number;   // exclusive end  of "@Name" in the clean textarea value
};

// ── Standalone pure utilities (import anywhere) ───────────────────────────────

/** Convert stored token format → clean display text for edit-mode textarea.
 *  "@[Scott](user:138) please review." → "@Scott please review."
 */
export function tokensToCleanText(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/@\[([^\]]+)\]\(user:\d+\)/g, "@$1");
}

/** Parse a stored token string → MentionEntry[] in clean-text coordinates.
 *  Used to pre-populate the mention registry when re-opening a saved field.
 */
export function parseTokensToEntries(tokenText: string | null | undefined): MentionEntry[] {
  if (!tokenText) return [];
  const re = /@\[([^\]]+)\]\(user:(\d+)\)/g;
  const entries: MentionEntry[] = [];
  let rawConsumed = 0;
  let cleanPos = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(tokenText)) !== null) {
    const plainBefore = tokenText.slice(rawConsumed, match.index);
    cleanPos += plainBefore.length;

    const name = match[1];
    const userId = Number(match[2]);
    entries.push({
      name,
      userId,
      isAll: userId === 0,
      atPos: cleanPos,
      end: cleanPos + `@${name}`.length,
    });

    cleanPos += `@${name}`.length;
    rawConsumed = match.index + match[0].length;
  }

  return entries;
}

/** Re-insert tokens into clean text using tracked MentionEntry positions.
 *  Processes positions in descending order so replacements don't shift later ones.
 */
export function serializeToTokens(cleanText: string, entries: MentionEntry[]): string {
  if (!entries.length) return cleanText;
  const sorted = [...entries].sort((a, b) => b.atPos - a.atPos);
  let result = cleanText;
  for (const entry of sorted) {
    if (entry.atPos < 0 || entry.end > result.length) continue;
    if (result.slice(entry.atPos, entry.end) !== `@${entry.name}`) continue;
    const token = entry.isAll
      ? `@[all](user:0)`
      : `@[${entry.name}](user:${entry.userId})`;
    result = result.slice(0, entry.atPos) + token + result.slice(entry.end);
  }
  return result;
}

/** Extract all user IDs mentioned in a stored token body (excludes @all = id 0).
 *  Works on the token format stored in the DB. */
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

/** Detect an active @query at the cursor. Returns null when no trigger. */
function detectMentionTrigger(value: string, cursor: number): string | null {
  const before = value.slice(0, cursor);
  const m = before.match(/@([^\s@]*)$/);
  if (!m) return null;
  const query = m[1];
  if (query.length > 30) return null;
  return query;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMentionComposer(taRef: React.RefObject<HTMLTextAreaElement>) {
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionAnchorRect, setMentionAnchorRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  /** Tracks every @mention inserted this session in clean-text coordinates. */
  const mentionEntriesRef = useRef<MentionEntry[]>([]);

  const { data: rawUsers = [], isLoading: mentionLoading } = useQuery<MentionUser[]>({
    queryKey: ["/api/current/users", mentionQuery],
    queryFn: () =>
      fetch(`/api/current/users?q=${encodeURIComponent(mentionQuery)}`, {
        credentials: "include",
      }).then((r) => r.json()),
    enabled: mentionActive,
    staleTime: 10_000,
  });

  // CMS-wide hook: @all is NEVER injected here.
  // @all is a CURRENTS-ONLY broadcast; non-Currents fields must never show it.
  // The Currents channel/thread composers use useCurrentUsers (use-current-users.ts)
  // with includeAll=true — that is the only permitted injection point.
  const mentionUsers: MentionUser[] = mentionActive ? rawUsers : [];

  const clampedIdx = Math.min(mentionIdx, Math.max(0, mentionUsers.length - 1));

  /** Update all tracked mention positions after the user edits text. */
  function updateEntryPositions(oldText: string, newText: string) {
    if (mentionEntriesRef.current.length === 0) return;

    // Find first diverging character
    let changeStart = 0;
    const minLen = Math.min(oldText.length, newText.length);
    while (changeStart < minLen && oldText[changeStart] === newText[changeStart]) {
      changeStart++;
    }

    const diff = newText.length - oldText.length;

    const updated = mentionEntriesRef.current
      .map((entry): MentionEntry | null => {
        if (entry.end <= changeStart) return entry;            // entirely before change — unchanged
        if (entry.atPos >= changeStart) {                      // entirely after change — shift
          return { ...entry, atPos: entry.atPos + diff, end: entry.end + diff };
        }
        return null;                                           // change was inside mention — invalidate
      })
      .filter((e): e is MentionEntry => e !== null)
      // Validate the mention text still matches its expected name at the tracked position
      .filter(e =>
        e.atPos >= 0 &&
        e.end <= newText.length &&
        newText.slice(e.atPos, e.end) === `@${e.name}`
      );

    mentionEntriesRef.current = updated;
  }

  /** Pre-populate the registry from a stored token string (call when entering edit mode). */
  function initFromTokenText(tokenText: string) {
    mentionEntriesRef.current = parseTokensToEntries(tokenText);
  }

  /** Serialise the clean-text editor value back to token format for DB storage. */
  function serializeForSave(cleanText: string): string {
    return serializeToTokens(cleanText, mentionEntriesRef.current);
  }

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
    const before = draft.slice(0, cursor);
    const m = before.match(/@([^\s@]*)$/);
    if (!m) return;

    const atPos = before.length - m[0].length;
    const displayName = user.isAll ? "all" : user.name;
    const displayText = `@${displayName} `;
    const newValue = draft.slice(0, atPos) + displayText + draft.slice(cursor);
    const newCursor = atPos + displayText.length;

    // Record mention in clean-text coordinates (end excludes trailing space)
    mentionEntriesRef.current = [
      ...mentionEntriesRef.current,
      {
        name: displayName,
        userId: user.id,
        isAll: !!user.isAll,
        atPos,
        end: atPos + `@${displayName}`.length,
      },
    ];

    setDraft(newValue);
    setMentionActive(false);
    requestAnimationFrame(() => {
      ta.setSelectionRange(newCursor, newCursor);
      ta.focus();
    });
  }

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
    updateEntryPositions,
    initFromTokenText,
    serializeForSave,
    closeMention: () => setMentionActive(false),
  };
}
