import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { PAGE_NAV_INDEX } from "@/lib/nav-config";

const STORAGE_KEY = "vs_recent_pages";
const MAX_RECENTS = 12;

// Paths that should never be tracked (public/auth/utility routes)
const SKIP_PREFIXES = [
  "/login", "/logout", "/reset-password", "/forgot-password",
  "/investor-portal", "/field/nearby",
];

export type RecentPage = {
  label: string;
  url: string;
  section: string;
  visitedAt: number;
  capitalOnly?: boolean;
  adminOnly?: boolean;
};

function readRecents(): RecentPage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecents(recents: RecentPage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
  } catch {
    // ignore
  }
}

function filterRecents(recents: RecentPage[], isCapitalUser: boolean, isAdmin: boolean): RecentPage[] {
  return recents.filter(r => {
    if (r.capitalOnly && !isCapitalUser) return false;
    if (r.adminOnly && !isAdmin) return false;
    return true;
  });
}

function labelForPath(path: string): string {
  const match = PAGE_NAV_INDEX.find(p => p.url === path || path.startsWith(p.url + "/"));
  return match?.name ?? path;
}

function sectionForPath(path: string): string {
  const match = PAGE_NAV_INDEX.find(p => p.url === path || path.startsWith(p.url + "/"));
  return match?.section ?? "";
}

function isCapitalPath(path: string): boolean {
  return path.startsWith("/capital");
}

function isAdminPath(path: string): boolean {
  return path.startsWith("/admin") || path.startsWith("/settings");
}

function shouldSkip(path: string): boolean {
  if (path === "/" || path === "/today") return false;
  return SKIP_PREFIXES.some(p => path.startsWith(p));
}

export function useRecentPages(isCapitalUser = false, isAdmin = false) {
  const [recents, setRecentsState] = useState<RecentPage[]>(() =>
    filterRecents(readRecents(), isCapitalUser, isAdmin)
  );

  const trackVisit = useCallback((path: string) => {
    if (shouldSkip(path)) return;
    if (isCapitalPath(path) && !isCapitalUser) return;
    if (isAdminPath(path) && !isAdmin) return;

    const label = labelForPath(path);
    const section = sectionForPath(path);
    if (!label || label === path) return; // unknown route — don't track

    const entry: RecentPage = {
      label,
      url: path,
      section,
      visitedAt: Date.now(),
      capitalOnly: isCapitalPath(path) ? true : undefined,
      adminOnly: isAdminPath(path) ? true : undefined,
    };

    const all = readRecents().filter(r => r.url !== path);
    const next = [entry, ...all].slice(0, MAX_RECENTS);
    writeRecents(next);
    setRecentsState(filterRecents(next, isCapitalUser, isAdmin));
  }, [isCapitalUser, isAdmin]);

  return { recents, trackVisit };
}

// Lightweight hook to be called once at the app root — tracks location changes.
export function useRecentPagesTracker(isCapitalUser: boolean, isAdmin: boolean) {
  const [location] = useLocation();
  const { trackVisit } = useRecentPages(isCapitalUser, isAdmin);
  const prevLocation = useRef<string>("");

  useEffect(() => {
    if (location !== prevLocation.current) {
      prevLocation.current = location;
      trackVisit(location);
    }
  }, [location, trackVisit]);
}
