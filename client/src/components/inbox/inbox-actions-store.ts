/**
 * Local-only state for the Spark-style reader actions that don't (yet)
 * have a server-side schema:
 *  - Set Aside  → a per-thread set of threadIds the user wants out of the
 *                 active inbox view but NOT archived in Gmail. Behaves like
 *                 Spark's "Set Aside" tray: hidden from inbox, surface-able
 *                 in a dedicated view.
 *  - Share      → a per-thread map of `threadId → number[]` of userIds the
 *                 user has shared the thread with. The actual collaboration
 *                 surface happens via tasks (existing
 *                 /api/inbox/create-task-from-thread); this store just lets
 *                 the reader chip remember "this thread is shared with…"
 *                 across tabs.
 *  - Format event → a tiny window-event bus the formatting toolbar uses to
 *                 talk to the compose dialog. The compose dialog subscribes
 *                 only while it's open. This is plain DOM events so we
 *                 don't have to thread refs through 6,000 lines of inbox
 *                 JSX.
 *
 * Anything that DOES have a real schema column (assigned owner, snoozed
 * until, workflow state, starred) is mutated server-side via the existing
 * routes — those are deliberately NOT proxied through this store.
 */

import { useCallback, useEffect, useState } from "react";

const SET_ASIDE_KEY = "inbox.setAside";
const SHARE_ACCESS_KEY = "inbox.shareAccess";

/** Read a JSON-encoded value from localStorage, swallowing all errors. */
function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded etc. — the feature degrades to in-memory only.
  }
}

// ─────────────────────────────────────────────────────────────────────
// Set Aside
// ─────────────────────────────────────────────────────────────────────

export interface SetAsideAPI {
  /** Set of threadIds currently set aside. */
  setAside: Set<string>;
  isSetAside: (threadId: string) => boolean;
  toggle: (threadId: string) => void;
  add: (threadId: string) => void;
  remove: (threadId: string) => void;
}

/**
 * Hook returning the user's "Set Aside" tray.
 *
 * Cross-tab sync: subscribes to the `storage` event so toggling in one tab
 * re-renders the others. Same pattern as `usePinnedThreads()` in
 * smart-inbox-grouper.ts.
 */
export function useSetAside(): SetAsideAPI {
  const [ids, setIds] = useState<Set<string>>(() => {
    const arr = readJSON<string[]>(SET_ASIDE_KEY, []);
    return new Set(arr);
  });

  // Keep multiple tabs / windows in sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SET_ASIDE_KEY) return;
      try {
        const arr = e.newValue ? (JSON.parse(e.newValue) as string[]) : [];
        setIds(new Set(arr));
      } catch {
        /* ignore malformed payloads */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((next: Set<string>) => {
    writeJSON(SET_ASIDE_KEY, Array.from(next));
    setIds(next);
  }, []);

  const isSetAside = useCallback((threadId: string) => ids.has(threadId), [ids]);

  const toggle = useCallback(
    (threadId: string) => {
      const next = new Set(ids);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      persist(next);
    },
    [ids, persist],
  );

  const add = useCallback(
    (threadId: string) => {
      if (ids.has(threadId)) return;
      const next = new Set(ids);
      next.add(threadId);
      persist(next);
    },
    [ids, persist],
  );

  const remove = useCallback(
    (threadId: string) => {
      if (!ids.has(threadId)) return;
      const next = new Set(ids);
      next.delete(threadId);
      persist(next);
    },
    [ids, persist],
  );

  return { setAside: ids, isSetAside, toggle, add, remove };
}

// ─────────────────────────────────────────────────────────────────────
// Share access (per-thread userId list)
// ─────────────────────────────────────────────────────────────────────

export type ShareAccessMap = Record<string, number[]>;

export interface ShareAccessAPI {
  shareAccess: ShareAccessMap;
  getSharedWith: (threadId: string) => number[];
  setSharedWith: (threadId: string, userIds: number[]) => void;
  addUser: (threadId: string, userId: number) => void;
  removeUser: (threadId: string, userId: number) => void;
}

export function useShareAccess(): ShareAccessAPI {
  const [map, setMap] = useState<ShareAccessMap>(() =>
    readJSON<ShareAccessMap>(SHARE_ACCESS_KEY, {}),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SHARE_ACCESS_KEY) return;
      try {
        const next = e.newValue ? (JSON.parse(e.newValue) as ShareAccessMap) : {};
        setMap(next);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((next: ShareAccessMap) => {
    writeJSON(SHARE_ACCESS_KEY, next);
    setMap(next);
  }, []);

  const getSharedWith = useCallback(
    (threadId: string) => map[threadId] ?? [],
    [map],
  );

  const setSharedWith = useCallback(
    (threadId: string, userIds: number[]) => {
      const next = { ...map };
      // Dedup + drop falsy.
      const uniq = Array.from(new Set(userIds.filter(Boolean)));
      if (uniq.length === 0) {
        delete next[threadId];
      } else {
        next[threadId] = uniq;
      }
      persist(next);
    },
    [map, persist],
  );

  const addUser = useCallback(
    (threadId: string, userId: number) => {
      const cur = new Set(map[threadId] ?? []);
      cur.add(userId);
      setSharedWith(threadId, Array.from(cur));
    },
    [map, setSharedWith],
  );

  const removeUser = useCallback(
    (threadId: string, userId: number) => {
      const cur = new Set(map[threadId] ?? []);
      cur.delete(userId);
      setSharedWith(threadId, Array.from(cur));
    },
    [map, setSharedWith],
  );

  return { shareAccess: map, getSharedWith, setSharedWith, addUser, removeUser };
}

// ─────────────────────────────────────────────────────────────────────
// Format-command bus
// ─────────────────────────────────────────────────────────────────────

export type FormatCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "ordered-list"
  | "bullet-list"
  | "link"
  | "clear";

export interface FormatEvent {
  cmd: FormatCommand;
  /** Optional value (e.g. URL for `link`). */
  value?: string;
}

const FORMAT_EVENT = "inbox:format";

export function dispatchFormat(cmd: FormatCommand, value?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<FormatEvent>(FORMAT_EVENT, { detail: { cmd, value } }),
  );
}

/**
 * Subscribe to format-bus events. The compose dialog uses this; nothing
 * else should. Returns a cleanup function via the standard useEffect
 * convention.
 */
export function useFormatBus(handler: (e: FormatEvent) => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onEvt = (e: Event) => {
      const ce = e as CustomEvent<FormatEvent>;
      if (ce?.detail) handler(ce.detail);
    };
    window.addEventListener(FORMAT_EVENT, onEvt as EventListener);
    return () =>
      window.removeEventListener(FORMAT_EVENT, onEvt as EventListener);
  }, [handler]);
}

/**
 * Apply a format command to a contenteditable editor div using
 * document.execCommand. This is the primary format handler for the rich-text
 * composer.
 *
 * @param div        The contenteditable div element
 * @param cmd        Format command to apply
 * @param value      Optional value (e.g. URL for `link` command)
 * @param savedRange Range saved before the link popover stole focus. When
 *                   provided it is restored before executing createLink so the
 *                   correct text is wrapped in the anchor.
 */
export function applyFormatToEditor(
  div: HTMLDivElement,
  cmd: FormatCommand,
  value?: string,
  savedRange?: Range | null,
): void {
  if (typeof document === "undefined") return;

  div.focus();

  // Restore a previously-saved selection (link flow: the popover stole focus)
  if (savedRange) {
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  switch (cmd) {
    case "bold":
      document.execCommand("bold", false);
      break;
    case "italic":
      document.execCommand("italic", false);
      break;
    case "underline":
      document.execCommand("underline", false);
      break;
    case "strikethrough":
      document.execCommand("strikeThrough", false);
      break;
    case "bullet-list":
      document.execCommand("insertUnorderedList", false);
      break;
    case "ordered-list":
      document.execCommand("insertOrderedList", false);
      break;
    case "link": {
      if (!value) return;
      document.execCommand("createLink", false, value);
      // Find the newly created <a> element and apply proper link attributes.
      // After createLink the selection is typically inside the new anchor.
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node: Node | null = sel.getRangeAt(0).startContainer;
        while (node && node !== div) {
          if ((node as Element).tagName === "A") {
            (node as Element).setAttribute("target", "_blank");
            (node as Element).setAttribute("rel", "noopener noreferrer");
            break;
          }
          node = node.parentNode;
        }
      }
      break;
    }
    case "clear":
      document.execCommand("removeFormat", false);
      document.execCommand("unlink", false);
      break;
  }
}

/**
 * @deprecated Use applyFormatToEditor for the rich-text contenteditable
 * composer. This function wraps selections with markdown markers and is kept
 * only for legacy compatibility (inbox-snippets plain-text editor).
 */
export function applyFormatToTextarea(
  textarea: HTMLTextAreaElement,
  cmd: FormatCommand,
  value?: string,
): { value: string; selectionStart: number; selectionEnd: number } {
  const text = textarea.value;
  const s = textarea.selectionStart ?? text.length;
  const e = textarea.selectionEnd ?? text.length;
  const selected = text.slice(s, e);

  const wrap = (left: string, right = left) => {
    const inner = selected || "text";
    const next = text.slice(0, s) + left + inner + right + text.slice(e);
    return {
      value: next,
      selectionStart: s + left.length,
      selectionEnd: s + left.length + inner.length,
    };
  };

  const linePrefix = (prefix: string) => {
    // For lists: prefix every line in the selection (or the current line if
    // empty selection) with the given prefix.
    const startLine = text.lastIndexOf("\n", s - 1) + 1;
    const endLine = (() => {
      const idx = text.indexOf("\n", e);
      return idx === -1 ? text.length : idx;
    })();
    const block = text.slice(startLine, endLine);
    const lines = block.split("\n");
    const isOrdered = prefix === "1. ";
    const newBlock = lines
      .map((l, i) => (isOrdered ? `${i + 1}. ${l}` : `${prefix}${l}`))
      .join("\n");
    const next = text.slice(0, startLine) + newBlock + text.slice(endLine);
    return {
      value: next,
      selectionStart: startLine,
      selectionEnd: startLine + newBlock.length,
    };
  };

  switch (cmd) {
    case "bold":
      return wrap("**");
    case "italic":
      return wrap("*");
    case "underline":
      // Markdown has no native underline; emit HTML-ish wrapper that
      // buildEmailHtml can pass through.
      return wrap("<u>", "</u>");
    case "strikethrough":
      return wrap("~~");
    case "bullet-list":
      return linePrefix("- ");
    case "ordered-list":
      return linePrefix("1. ");
    case "link": {
      const href = value || "https://";
      const label = selected || href;
      const next = text.slice(0, s) + `[${label}](${href})` + text.slice(e);
      return {
        value: next,
        selectionStart: s + 1,
        selectionEnd: s + 1 + label.length,
      };
    }
    case "clear": {
      // Strip common markdown markers from the selection.
      if (!selected) return { value: text, selectionStart: s, selectionEnd: e };
      const cleaned = selected
        .replace(/\*\*/g, "")
        .replace(/__/g, "")
        .replace(/~~/g, "")
        .replace(/`/g, "")
        .replace(/<\/?u>/g, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+\.\s+/gm, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      const next = text.slice(0, s) + cleaned + text.slice(e);
      return {
        value: next,
        selectionStart: s,
        selectionEnd: s + cleaned.length,
      };
    }
  }
}
