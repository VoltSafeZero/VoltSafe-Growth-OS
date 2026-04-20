import { useEffect, useRef, useState } from "react";
import type { WeatherGeocodeResult } from "./weather-types";

// Open-Meteo geocoding with 250ms debounce + AbortController so a slow earlier
// response can't overwrite a newer one in the dropdown.
export function useWeatherGeocoding(query: string) {
  const [results, setResults] = useState<WeatherGeocodeResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      // Cancel any in-flight request and clear stale results.
      abortRef.current?.abort();
      abortRef.current = null;
      setResults([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const t = setTimeout(() => {
      // Cancel previous request before starting a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.searchParams.set("name", trimmed);
      url.searchParams.set("count", "8");
      url.searchParams.set("language", "en");
      url.searchParams.set("format", "json");

      fetch(url.toString(), { signal: controller.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Geocoding failed: ${r.status}`);
          return r.json();
        })
        .then((data: any) => {
          if (controller.signal.aborted) return;
          const list: WeatherGeocodeResult[] = Array.isArray(data?.results)
            ? data.results.map((row: any) => ({
                id:
                  typeof crypto !== "undefined" && "randomUUID" in crypto
                    ? crypto.randomUUID()
                    : `${row.id ?? row.latitude}-${row.longitude}`,
                label: [row.name, row.admin1, row.country]
                  .filter(Boolean)
                  .join(", "),
                latitude: Number(row.latitude),
                longitude: Number(row.longitude),
                timezone: row.timezone,
                countryCode: row.country_code,
              }))
            : [];
          setResults(list);
          setIsLoading(false);
        })
        .catch((err) => {
          if (controller.signal.aborted || err?.name === "AbortError") return;
          setError(err?.message || "Search failed");
          setIsLoading(false);
        });
    }, 250);

    return () => {
      clearTimeout(t);
      // Also abort any in-flight request from this effect run so a stale
      // response from a previous query can't land after the user keeps typing.
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [query]);

  // Cancel any in-flight request on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { results, isLoading, error };
}
