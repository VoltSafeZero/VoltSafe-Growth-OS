import { useState, useCallback } from "react";

const STORAGE_KEY = "vs_page_favorites";

export type PageFavorite = {
  label: string;
  url: string;
  section: string;
  createdAt: number;
  capitalOnly?: boolean;
  adminOnly?: boolean;
};

function readFavorites(): PageFavorite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFavorites(favs: PageFavorite[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
  } catch {
    // quota exceeded or private browsing — silently ignore
  }
}

// Returns only favorites the current user is allowed to see.
function filterFavorites(favs: PageFavorite[], isCapitalUser: boolean, isAdmin: boolean): PageFavorite[] {
  return favs.filter(f => {
    if (f.capitalOnly && !isCapitalUser) return false;
    if (f.adminOnly && !isAdmin) return false;
    return true;
  });
}

export function usePageFavorites(isCapitalUser = false, isAdmin = false) {
  const [favorites, setFavoritesState] = useState<PageFavorite[]>(() =>
    filterFavorites(readFavorites(), isCapitalUser, isAdmin)
  );

  const isFavorited = useCallback((url: string) =>
    favorites.some(f => f.url === url), [favorites]);

  const addFavorite = useCallback((entry: Omit<PageFavorite, "createdAt">) => {
    if (!isCapitalUser && entry.capitalOnly) return;
    if (!isAdmin && entry.adminOnly) return;
    const all = readFavorites();
    if (all.some(f => f.url === entry.url)) return;
    const next = [{ ...entry, createdAt: Date.now() }, ...all];
    writeFavorites(next);
    setFavoritesState(filterFavorites(next, isCapitalUser, isAdmin));
  }, [isCapitalUser, isAdmin]);

  const removeFavorite = useCallback((url: string) => {
    const next = readFavorites().filter(f => f.url !== url);
    writeFavorites(next);
    setFavoritesState(filterFavorites(next, isCapitalUser, isAdmin));
  }, [isCapitalUser, isAdmin]);

  const toggleFavorite = useCallback((entry: Omit<PageFavorite, "createdAt">) => {
    if (isFavorited(entry.url)) {
      removeFavorite(entry.url);
    } else {
      addFavorite(entry);
    }
  }, [isFavorited, addFavorite, removeFavorite]);

  return { favorites, isFavorited, addFavorite, removeFavorite, toggleFavorite };
}
