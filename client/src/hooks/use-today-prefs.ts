// use-today-prefs.ts — per-user localStorage preferences for the Today page
// Storage key is scoped by userId so different users on the same browser never share prefs.
// Security: only IDs, types, timestamps, and booleans are stored — no sensitive text.

import { useState, useCallback, useMemo } from "react";

export type SnoozeEntry = {
  id: string;
  type: string;
  until: number; // Unix ms — expiry timestamp only
};

export type TodayPrefs = {
  sectionOrder: string[];       // ordered section IDs; empty = use default
  hiddenSections: string[];     // section IDs the user has hidden
  pinnedSections: string[];     // section IDs pinned (shown with indicator)
  compact: boolean;             // compact view reduces padding/spacing
  snoozedItems: SnoozeEntry[];  // snoozed priority action IDs with expiry
  sortBy: "severity" | "time" | "source";
};

const DEFAULTS: TodayPrefs = {
  sectionOrder: [],
  hiddenSections: [],
  pinnedSections: [],
  compact: false,
  snoozedItems: [],
  sortBy: "severity",
};

function storageKey(userId: number): string {
  return `vs_today_prefs_${userId}`;
}

function readPrefs(userId: number): TodayPrefs {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULTS };
    // Prune expired snooze entries on read
    const now = Date.now();
    const snoozedItems = Array.isArray(parsed.snoozedItems)
      ? parsed.snoozedItems.filter((s: any) =>
          s && typeof s.id === "string" && typeof s.until === "number" && s.until > now
        )
      : [];
    return {
      sectionOrder: Array.isArray(parsed.sectionOrder) ? parsed.sectionOrder : [],
      hiddenSections: Array.isArray(parsed.hiddenSections) ? parsed.hiddenSections : [],
      pinnedSections: Array.isArray(parsed.pinnedSections) ? parsed.pinnedSections : [],
      compact: typeof parsed.compact === "boolean" ? parsed.compact : false,
      snoozedItems,
      sortBy: ["severity", "time", "source"].includes(parsed.sortBy) ? parsed.sortBy : "severity",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writePrefs(userId: number, prefs: TodayPrefs): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    // quota exceeded or private browsing — silently ignore
  }
}

export function useTodayPrefs(userId: number | undefined) {
  const safeId = userId ?? 0;
  const [prefs, setPrefsState] = useState<TodayPrefs>(() =>
    safeId > 0 ? readPrefs(safeId) : { ...DEFAULTS }
  );

  const savePrefs = useCallback((next: TodayPrefs) => {
    if (safeId > 0) writePrefs(safeId, next);
    setPrefsState(next);
  }, [safeId]);

  const setSectionOrder = useCallback((order: string[]) => {
    savePrefs({ ...prefs, sectionOrder: order });
  }, [prefs, savePrefs]);

  const toggleSectionVisibility = useCallback((sectionId: string) => {
    const hidden = prefs.hiddenSections.includes(sectionId)
      ? prefs.hiddenSections.filter(s => s !== sectionId)
      : [...prefs.hiddenSections, sectionId];
    savePrefs({ ...prefs, hiddenSections: hidden });
  }, [prefs, savePrefs]);

  const togglePin = useCallback((sectionId: string) => {
    const pinned = prefs.pinnedSections.includes(sectionId)
      ? prefs.pinnedSections.filter(s => s !== sectionId)
      : [...prefs.pinnedSections, sectionId];
    savePrefs({ ...prefs, pinnedSections: pinned });
  }, [prefs, savePrefs]);

  const setCompact = useCallback((compact: boolean) => {
    savePrefs({ ...prefs, compact });
  }, [prefs, savePrefs]);

  const setSortBy = useCallback((sortBy: TodayPrefs["sortBy"]) => {
    savePrefs({ ...prefs, sortBy });
  }, [prefs, savePrefs]);

  // Snooze an item — stores only ID, type, and expiry timestamp (no sensitive text)
  const snoozeItem = useCallback((id: string, type: string, days: number) => {
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    const filtered = prefs.snoozedItems.filter(s => s.id !== id);
    savePrefs({ ...prefs, snoozedItems: [...filtered, { id, type, until }] });
  }, [prefs, savePrefs]);

  const unsnoozeItem = useCallback((id: string) => {
    savePrefs({ ...prefs, snoozedItems: prefs.snoozedItems.filter(s => s.id !== id) });
  }, [prefs, savePrefs]);

  const isSnoozed = useCallback((id: string): boolean => {
    const now = Date.now();
    return prefs.snoozedItems.some(s => s.id === id && s.until > now);
  }, [prefs.snoozedItems]);

  const resetPrefs = useCallback(() => {
    savePrefs({ ...DEFAULTS });
  }, [savePrefs]);

  const isCustomized = useMemo(() =>
    prefs.sectionOrder.length > 0 ||
    prefs.hiddenSections.length > 0 ||
    prefs.compact,
  [prefs]);

  return {
    prefs,
    setSectionOrder,
    toggleSectionVisibility,
    togglePin,
    setCompact,
    setSortBy,
    snoozeItem,
    unsnoozeItem,
    isSnoozed,
    resetPrefs,
    isCustomized,
  };
}
