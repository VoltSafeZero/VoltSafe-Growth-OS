import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  WEATHER_DEFAULT_PREFS,
  weatherPrefsSchema,
  type WeatherPrefs,
} from "./weather-types";

type ProfileResponse = {
  id: number;
  permissions?: Record<string, any> | null;
};

// Reads prefs from /api/users/me/profile and persists weather changes via
// PATCH /api/users/me/layout. Two safety nets:
// 1. Server-stored prefs are validated with the shared Zod schema before use,
//    so legacy/malformed JSON can't poison the UI.
// 2. Mutations are serialized through a promise queue and computed against the
//    latest *pending* snapshot, so rapid sequential edits (e.g. flipping the
//    temp toggle then the wind toggle) can't clobber each other.
export function useWeatherPrefs() {
  const profileQuery = useQuery<ProfileResponse>({
    queryKey: ["/api/users/me/profile"],
  });

  const stored: WeatherPrefs | undefined = useMemo(() => {
    const raw = profileQuery.data?.permissions?.weather;
    if (!raw || typeof raw !== "object") return undefined;
    const parsed = weatherPrefsSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }, [profileQuery.data]);

  const prefs: WeatherPrefs = useMemo(
    () => stored ?? WEATHER_DEFAULT_PREFS,
    [stored],
  );

  // Optimistic local overlay so UI reflects unsynced edits.
  const [localOverlay, setLocalOverlay] = useState<WeatherPrefs | null>(null);
  const pendingRef = useRef<WeatherPrefs | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const inflightRef = useRef(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // When server data updates AND no edits are in flight, drop the overlay so
  // the next render reflects the source of truth.
  useEffect(() => {
    if (inflightRef.current === 0) {
      setLocalOverlay(null);
      pendingRef.current = null;
    }
  }, [stored]);

  const visible: WeatherPrefs = localOverlay ?? prefs;

  const update = useCallback(
    (mutator: (current: WeatherPrefs) => WeatherPrefs) => {
      const base = pendingRef.current ?? localOverlay ?? prefs;
      const next = mutator(base);
      pendingRef.current = next;
      setLocalOverlay(next);
      setError(null);
      inflightRef.current += 1;
      setIsSaving(true);
      queueRef.current = queueRef.current
        .catch(() => undefined)
        .then(() => apiRequest("PATCH", "/api/users/me/layout", { weather: next }))
        .then(
          () => { /* success */ },
          (err) => { setError(err); },
        )
        .finally(() => {
          inflightRef.current -= 1;
          if (inflightRef.current === 0) {
            setIsSaving(false);
            // Refetch — useEffect above will then drop the overlay.
            queryClient.invalidateQueries({ queryKey: ["/api/users/me/profile"] });
          }
        });
    },
    [prefs, localOverlay],
  );

  return {
    prefs: visible,
    isLoading: profileQuery.isLoading,
    isSaving,
    error,
    update,
  };
}
