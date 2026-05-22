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

import { useCallback, useEffect, useRef, useState } from "react";

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
  /** Sender address (RFC 5322 "From" header). Used for automation detection. */
  from?: string | null;
}

/* ------------------------------------------------------------------ */
/* Classification helpers — exported so page components can import     */
/* them instead of duplicating classification logic inline.            */
/* ------------------------------------------------------------------ */

export function isUnreadMsg(labelIds: string[]): boolean {
  return labelIds.includes("UNREAD");
}

export function isStarredMsg(labelIds: string[]): boolean {
  return labelIds.includes("STARRED");
}

/**
 * Local-part prefixes that identify automated / system senders.
 * Matched case-insensitively against the full RFC 5322 "From" string, so
 * "Acme <noreply@acme.com>" is caught by "noreply@".
 *
 * To add a new automation pattern: append to this list. Prefer the most
 * specific local-part you can write without causing false positives on real
 * human addresses (e.g. "updates@" is safe; "info@" is borderline).
 */
export const AUTOMATION_SENDER_PREFIXES = [
  "noreply@",
  "no-reply@",
  "donotreply@",
  "do-not-reply@",
  "notifications@",
  "notification@",
  "updates@",
  "mailer@",
  "bounce@",
  "postmaster@",
  "support@",
  "alert@",
  "alerts@",
  "newsletter@",
  "newsletters@",
  "info@",
  "hello@",
  "team@",
] as const;

/**
 * Returns true when the from-address matches a known automation/bulk-send
 * prefix. Case-insensitive, works on full RFC 5322 "Name <addr>" strings.
 */
export function isAutomationSender(fromAddr: string | null | undefined): boolean {
  if (!fromAddr) return false;
  const lower = fromAddr.toLowerCase();
  return AUTOMATION_SENDER_PREFIXES.some((p) => lower.includes(p));
}

/**
 * Returns true when the message looks like direct human-to-human communication.
 *
 * A message is NOT People if Gmail has already assigned it an automation
 * category label (UPDATES, SOCIAL, PROMOTIONS, FORUMS) OR if the sender
 * address matches an automation prefix. Both checks are required because:
 * - Category labels are reliable but only present on synced Gmail messages.
 * - The sender heuristic catches unlabelled automated mail (e.g. self-hosted
 *   apps sending from noreply@theirdomain.com without Gmail category labels).
 */
export function classifyAsPeople(
  labelIds: string[],
  fromAddr?: string | null,
): boolean {
  // Gmail category labels take first priority — they're the most reliable signal.
  if (
    labelIds.includes("CATEGORY_PROMOTIONS") ||
    labelIds.includes("CATEGORY_FORUMS") ||
    labelIds.includes("CATEGORY_UPDATES") ||
    labelIds.includes("CATEGORY_SOCIAL")
  ) return false;
  // Fall back to sender-address heuristic for unlabelled automation mail.
  if (isAutomationSender(fromAddr)) return false;
  return true;
}

/**
 * Returns true for automated transactional/activity emails.
 *
 * Precedence: newsletters win over notifications. An unlabelled message from
 * an automation sender (e.g. noreply@github.com with no category label) lands
 * here rather than in People, which keeps People clean for actual humans.
 */
export function classifyAsNotification(
  labelIds: string[],
  fromAddr?: string | null,
): boolean {
  // Newsletter labels take priority — don't double-count as a notification.
  if (
    labelIds.includes("CATEGORY_PROMOTIONS") ||
    labelIds.includes("CATEGORY_FORUMS")
  ) return false;
  // Gmail's transactional / social categories are always notifications.
  if (
    labelIds.includes("CATEGORY_UPDATES") ||
    labelIds.includes("CATEGORY_SOCIAL")
  ) return true;
  // Unlabelled automation sender (no Gmail category assigned) → notification.
  if (isAutomationSender(fromAddr)) return true;
  return false;
}

/**
 * Returns true for promotional / newsletter email only.
 * Newsletter detection is label-only; sender address is not used here because
 * PROMOTIONS/FORUMS is already a reliable signal and broadening it risks
 * mis-classifying legitimate human email from marketing-adjacent domains.
 */
export function classifyAsNewsletter(
  labelIds: string[],
  _fromAddr?: string | null,
): boolean {
  return (
    labelIds.includes("CATEGORY_PROMOTIONS") ||
    labelIds.includes("CATEGORY_FORUMS")
  );
}

/**
 * Classify a message into one of three Smart Inbox categories.
 *
 * Precedence (first match wins): newsletters → notifications → people.
 * This ordering matters: a message from noreply@ with CATEGORY_PROMOTIONS
 * should be a newsletter, not a notification, even though it also matches the
 * automation-sender heuristic inside classifyAsNotification.
 */
export function smartCategoryOf(
  labelIds: string[],
  fromAddr?: string | null,
): SmartCategory {
  if (classifyAsNewsletter(labelIds, fromAddr)) return "newsletters";
  if (classifyAsNotification(labelIds, fromAddr)) return "notifications";
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
      const cat = smartCategoryOf(labels, m.from ?? undefined);
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

  // Smart Inbox shows only unread emails, grouped into three top-level categories.
  // Priority, Pinned, and Seen sections are intentionally omitted — the Pinned
  // sidebar tab and the flat list view already surface those.
  if (orderedPeople.length > 0) {
    out.push({
      kind: "header",
      id: "unread-people",
      title: "People",
      glyph: "people",
      count: orderedPeople.length,
      isSubsection: false,
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
      isSubsection: false,
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
      isSubsection: false,
    });
    for (const m of orderedNewsletters) out.push({ kind: "msg", section: "unread-newsletters", msg: m });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Hooks — view-mode + pinned-threads (localStorage-backed)            */
/* ------------------------------------------------------------------ */

const VIEW_MODE_KEY = "inbox.viewMode";
/** Namespace prefix — actual key is `${PINNED_KEY_PREFIX}.${accountKey}` */
const PINNED_KEY_PREFIX = "inbox.pinnedThreads";
/** Legacy global key (pre per-account) — migrated on first read for personal. */
const PINNED_KEY_LEGACY = "inbox.pinnedThreads";

function readViewMode(): InboxViewMode {
  if (typeof window === "undefined") return "classic";
  try {
    const v = window.localStorage.getItem(VIEW_MODE_KEY);
    return v === "smart" ? "smart" : v === "unread-cards" ? "unread-cards" : "classic";
  } catch {
    return "classic";
  }
}

function readPinned(storageKey: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    // One-time migration: promote the old global key into the new personal-scoped key.
    if (storageKey === `${PINNED_KEY_PREFIX}.personal`) {
      const legacy = window.localStorage.getItem(PINNED_KEY_LEGACY);
      if (legacy && !window.localStorage.getItem(storageKey)) {
        window.localStorage.setItem(storageKey, legacy);
        window.localStorage.removeItem(PINNED_KEY_LEGACY);
      }
    }
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((x): x is string => typeof x === "string"))
      : new Set();
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

/**
 * Manages the set of pinned thread IDs for a specific inbox/account.
 *
 * @param accountKey  Stable string identifying the account:
 *   - `"personal"` for the user's own inbox (default)
 *   - `"acct-<id>"` for a shared team inbox by numeric ID
 * Pinned state is persisted per-key in localStorage so switching accounts
 * shows the correct set. Changing `accountKey` between renders re-reads
 * storage for the new account immediately.
 */
export function usePinnedThreads(accountKey = "personal"): PinnedThreadsAPI {
  const storageKey = `${PINNED_KEY_PREFIX}.${accountKey}`;
  const [pinned, setPinned] = useState<Set<string>>(() => readPinned(storageKey));

  // Re-sync when the account key changes (e.g., user switches to a team inbox).
  const prevStorageKey = useRef(storageKey);
  useEffect(() => {
    if (prevStorageKey.current !== storageKey) {
      prevStorageKey.current = storageKey;
      setPinned(readPinned(storageKey));
    }
  });

  // Persist on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(pinned)));
    } catch {
      /* ignore quota / private-mode failures */
    }
  }, [pinned, storageKey]);

  // Cross-tab sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) setPinned(readPinned(storageKey));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

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
