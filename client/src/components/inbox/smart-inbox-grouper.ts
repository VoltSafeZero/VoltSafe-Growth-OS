/**
 * Smart Inbox grouper — Spark-style hierarchy for the Gmail mirror feed.
 *
 * Sections, in order:
 *   1. Priority      — STARRED messages (user-flagged), regardless of read state.
 *   2. Unread        — non-starred unread, grouped by category:
 *                        • People        (getEmailCategory === "people")
 *                        • Notifications (getEmailCategory === "updates")
 *                        • Newsletters   (getEmailCategory === "newsletters")
 *   3. Pinned        — threads the user has explicitly pinned (localStorage),
 *                      excluding anything already shown above. Read OR unread.
 *   4. Seen          — everything else, sorted newest-first.
 *
 * The grouper returns an interleaved `SmartItem[]` so the existing message-row
 * JSX in `gmail-inbox.tsx` can render unchanged — only headers are new rows.
 */

import { useCallback, useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type InboxViewMode = "classic" | "smart" | "unread-cards";

export type SmartCategory = "people" | "notifications" | "newsletters";

export type SmartSectionId =
  | "priority"
  | "unread-people"
  | "unread-notifications"
  | "unread-newsletters"
  | "pinned"
  | "seen";

export interface SmartHeaderItem {
  kind: "header";
  id: SmartSectionId;
  title: string;
  /**
   * Optional emoji-style glyph, rendered before the title in the section bar.
   * Concrete lucide icons stay in the page so this module has zero JSX deps.
   */
  glyph: "priority" | "people" | "notifications" | "newsletters" | "pinned" | "seen";
  count: number;
  /** Indent flag — true for the People/Notifications/Newsletters subsections. */
  isSubsection: boolean;
}

export interface SmartMessageItem<M> {
  kind: "msg";
  /** Which section this message belongs to — useful for row decoration. */
  section: SmartSectionId;
  msg: M;
}

export type SmartItem<M> = SmartHeaderItem | SmartMessageItem<M>;

/**
 * Minimal shape we need from a message to group it. Matches MessageSummary
 * in `gmail-inbox.tsx` (which has many more fields — we just don't need them).
 */
export interface GroupableMessage {
  id: string | number;
  threadId: string;
  labelIds: string[];
  internalDate?: string | number | null;
  date?: string | null;
}

/* ------------------------------------------------------------------ */
/* Label / category helpers — duplicated from gmail-inbox.tsx so this  */
/* module is self-contained and unit-testable in isolation.            */
/* ------------------------------------------------------------------ */

export function isUnreadMsg(labelIds: string[]): boolean {
  return labelIds.includes("UNREAD");
}

export function isStarredMsg(labelIds: string[]): boolean {
  return labelIds.includes("STARRED");
}

export function smartCategoryOf(labelIds: string[]): SmartCategory {
  if (labelIds.includes("CATEGORY_PROMOTIONS") || labelIds.includes("CATEGORY_FORUMS")) return "newsletters";
  if (labelIds.includes("CATEGORY_UPDATES") || labelIds.includes("CATEGORY_SOCIAL")) return "notifications";
  return "people";
}

/** Newest-first; falls back to date string when internalDate is missing. */
function sortNewestFirst<M extends GroupableMessage>(arr: M[]): M[] {
  return [...arr].sort((a, b) => {
    const ai = Number(a.internalDate ?? 0);
    const bi = Number(b.internalDate ?? 0);
    if (ai !== bi) return bi - ai;
    const ad = a.date ? Date.parse(a.date) : 0;
    const bd = b.date ? Date.parse(b.date) : 0;
    return (bd || 0) - (ad || 0);
  });
}

/* ------------------------------------------------------------------ */
/* Grouper                                                             */
/* ------------------------------------------------------------------ */

export interface GroupOptions {
  /** Set of threadIds the user has explicitly pinned. Optional. */
  pinnedThreadIds?: ReadonlySet<string>;
  /**
   * When set, this thread is kept in its unread bucket (People / Notifications /
   * Newsletters) even after its UNREAD label has been removed from the cache.
   * This lets the UI mark the email as visually read (bold off) while keeping
   * the row in its original list position until the user navigates away.
   */
  openThreadId?: string | null;
  /**
   * True only when the open thread was actually unread at the moment the user
   * clicked it. Prevents already-read emails from being pushed into the unread
   * bucket just because they happen to be selected.
   */
  openThreadWasUnread?: boolean;
}

/**
 * Pure function — same input always yields same output. No React, no side-effects.
 * Returns an empty array if `messages` is empty.
 */
export function groupSmartInbox<M extends GroupableMessage>(
  messages: readonly M[],
  options: GroupOptions = {},
): SmartItem<M>[] {
  if (!messages || messages.length === 0) return [];
  const pinned = options.pinnedThreadIds ?? new Set<string>();
  const openThreadId = options.openThreadId ?? null;
  const openThreadWasUnread = options.openThreadWasUnread ?? false;

  // Bucket pass — each message lands in exactly one bucket so headers can't
  // double-count and we never render the same row twice.
  const priority: M[] = [];
  const unreadPeople: M[] = [];
  const unreadNotifications: M[] = [];
  const unreadNewsletters: M[] = [];
  const pinnedRead: M[] = [];
  const seen: M[] = [];

  for (const m of messages) {
    const labels = m.labelIds || [];
    const starred = isStarredMsg(labels);
    const unread = isUnreadMsg(labels);
    const isPinned = pinned.has(m.threadId);
    // Only hold the thread in its unread bucket if it was ACTUALLY unread when
    // the user clicked it. Without this guard, clicking an already-read email
    // would push it up into the unread section.
    const isOpenAndJustRead =
      !unread && !starred && m.threadId === openThreadId && openThreadWasUnread;

    if (starred) {
      priority.push(m);
      continue;
    }
    if (unread || isOpenAndJustRead) {
      const cat = smartCategoryOf(labels);
      if (cat === "people") unreadPeople.push(m);
      else if (cat === "notifications") unreadNotifications.push(m);
      else unreadNewsletters.push(m);
      continue;
    }
    if (isPinned) {
      pinnedRead.push(m);
      continue;
    }
    seen.push(m);
  }

  // Within each bucket, newest first.
  const orderedPriority = sortNewestFirst(priority);
  const orderedPeople = sortNewestFirst(unreadPeople);
  const orderedNotifs = sortNewestFirst(unreadNotifications);
  const orderedNewsletters = sortNewestFirst(unreadNewsletters);
  const orderedPinned = sortNewestFirst(pinnedRead);
  const orderedSeen = sortNewestFirst(seen);

  const out: SmartItem<M>[] = [];

  if (orderedPriority.length > 0) {
    out.push({
      kind: "header",
      id: "priority",
      title: "Priority",
      glyph: "priority",
      count: orderedPriority.length,
      isSubsection: false,
    });
    for (const m of orderedPriority) out.push({ kind: "msg", section: "priority", msg: m });
  }

  // Sub-sections render only when populated. We don't emit a parent "Unread"
  // header — Spark doesn't either; the categories speak for themselves.
  if (orderedPeople.length > 0) {
    out.push({
      kind: "header",
      id: "unread-people",
      title: "People",
      glyph: "people",
      count: orderedPeople.length,
      isSubsection: true,
    });
    for (const m of orderedPeople) out.push({ kind: "msg", section: "unread-people", msg: m });
  }
  if (orderedNotifs.length > 0) {
    out.push({
      kind: "header",
      id: "unread-notifications",
      title: "Notifications",
      glyph: "notifications",
      count: orderedNotifs.length,
      isSubsection: true,
    });
    for (const m of orderedNotifs) out.push({ kind: "msg", section: "unread-notifications", msg: m });
  }
  if (orderedNewsletters.length > 0) {
    out.push({
      kind: "header",
      id: "unread-newsletters",
      title: "Newsletters",
      glyph: "newsletters",
      count: orderedNewsletters.length,
      isSubsection: true,
    });
    for (const m of orderedNewsletters) out.push({ kind: "msg", section: "unread-newsletters", msg: m });
  }

  if (orderedPinned.length > 0) {
    out.push({
      kind: "header",
      id: "pinned",
      title: "Pinned",
      glyph: "pinned",
      count: orderedPinned.length,
      isSubsection: false,
    });
    for (const m of orderedPinned) out.push({ kind: "msg", section: "pinned", msg: m });
  }

  if (orderedSeen.length > 0) {
    out.push({
      kind: "header",
      id: "seen",
      title: "Seen",
      glyph: "seen",
      count: orderedSeen.length,
      isSubsection: false,
    });
    for (const m of orderedSeen) out.push({ kind: "msg", section: "seen", msg: m });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Hooks — view-mode + pinned-threads (localStorage-backed)            */
/* ------------------------------------------------------------------ */

const VIEW_MODE_KEY = "inbox.viewMode";
const PINNED_KEY = "inbox.pinnedThreads";

function readViewMode(): InboxViewMode {
  if (typeof window === "undefined") return "classic";
  try {
    const v = window.localStorage.getItem(VIEW_MODE_KEY);
    return v === "smart" ? "smart" : v === "unread-cards" ? "unread-cards" : "classic";
  } catch {
    return "classic";
  }
}

function readPinned(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function useInboxViewMode(): [InboxViewMode, (next: InboxViewMode) => void] {
  const [mode, setMode] = useState<InboxViewMode>(() => readViewMode());
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore quota / private-mode failures */
    }
  }, [mode]);
  // Keep tabs in sync when the user toggles in another window.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === VIEW_MODE_KEY) setMode(readViewMode());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [mode, setMode];
}

export interface PinnedThreadsAPI {
  pinned: Set<string>;
  isPinned: (threadId: string) => boolean;
  togglePin: (threadId: string) => void;
}

export function usePinnedThreads(): PinnedThreadsAPI {
  const [pinned, setPinned] = useState<Set<string>>(() => readPinned());
  // Persist on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(PINNED_KEY, JSON.stringify(Array.from(pinned)));
    } catch {
      /* ignore */
    }
  }, [pinned]);
  // Cross-tab sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PINNED_KEY) setPinned(readPinned());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const isPinned = useCallback((threadId: string) => pinned.has(threadId), [pinned]);
  const togglePin = useCallback((threadId: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);
  return { pinned, isPinned, togglePin };
}
