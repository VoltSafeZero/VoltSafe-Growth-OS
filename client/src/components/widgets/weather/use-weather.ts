import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  HARDCODED_FALLBACK_CITY,
  type WeatherForecast,
  type WeatherSavedLocation,
  type WeatherUnits,
} from "./weather-types";

// Resolves the active location: explicit `picked` if set; else tries browser
// geolocation, then IP geolocation (ipapi.co — keyless), then prefs fallback,
// then a hardcoded city. State machine reports the last resolution step taken.
export function useResolvedLocation(
  picked: WeatherSavedLocation | null,
  prefsFallback?: WeatherSavedLocation,
) {
  const [resolved, setResolved] = useState<WeatherSavedLocation | null>(picked);
  const [source, setSource] = useState<"picked" | "browser" | "ip" | "fallback" | null>(
    picked ? "picked" : null,
  );

  useEffect(() => {
    if (picked) {
      setResolved(picked);
      setSource("picked");
      return;
    }

    let cancelled = false;
    const fallback = prefsFallback ?? HARDCODED_FALLBACK_CITY;

    const finishWithFallback = () => {
      if (cancelled) return;
      setResolved(fallback);
      setSource("fallback");
    };

    const tryIp = async () => {
      try {
        const r = await fetch("https://ipapi.co/json/");
        if (!r.ok) throw new Error(`ip geo ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        const lat = Number(j?.latitude);
        const lng = Number(j?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setResolved({
            id: "ip-resolved",
            label: [j.city, j.region, j.country_name].filter(Boolean).join(", ") || "Current location",
            latitude: lat,
            longitude: lng,
            timezone: j.timezone,
            countryCode: j.country_code,
          });
          setSource("ip");
          return;
        }
        finishWithFallback();
      } catch {
        finishWithFallback();
      }
    };

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setResolved({
            id: "browser-resolved",
            label: "Current location",
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          setSource("browser");
        },
        () => { void tryIp(); },
        { timeout: 8000, maximumAge: 5 * 60 * 1000 },
      );
    } else {
      void tryIp();
    }

    return () => { cancelled = true; };
  }, [picked, prefsFallback]);

  return { resolved, source };
}

// Open-Meteo forecast fetch via React Query. Cached 15min, refetched on focus
// and on a 15min interval while the widget is mounted.
export function useWeatherForecast(
  loc: WeatherSavedLocation | null,
  units: WeatherUnits,
) {
  const params = useMemo(() => {
    if (!loc) return null;
    const u = new URL("https://api.open-meteo.com/v1/forecast");
    u.searchParams.set("latitude", String(loc.latitude));
    u.searchParams.set("longitude", String(loc.longitude));
    u.searchParams.set(
      "current",
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day,uv_index",
    );
    u.searchParams.set(
      "hourly",
      "temperature_2m,precipitation_probability,weather_code,is_day",
    );
    u.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,uv_index_max",
    );
    u.searchParams.set("timezone", "auto");
    u.searchParams.set("forecast_days", "7");
    u.searchParams.set("temperature_unit", units.temp === "F" ? "fahrenheit" : "celsius");
    u.searchParams.set("wind_speed_unit", units.wind === "mph" ? "mph" : "kmh");
    return u.toString();
  }, [loc, units.temp, units.wind]);

  const query = useQuery<WeatherForecast>({
    queryKey: [
      "open-meteo-forecast",
      loc?.latitude,
      loc?.longitude,
      units.temp,
      units.wind,
    ],
    enabled: !!params,
    staleTime: 15 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const r = await fetch(params!);
      if (!r.ok) throw new Error(`Forecast failed: ${r.status}`);
      const j = await r.json();
      const cur = j.current ?? {};
      const hourlyTimes: string[] = j.hourly?.time ?? [];
      const startIdx = (() => {
        // Align hourly strip to "next 24h" starting from the current hour.
        const nowIso = (cur.time as string | undefined) ?? "";
        const idx = hourlyTimes.indexOf(nowIso);
        return idx >= 0 ? idx : 0;
      })();
      const sliceN = (arr: any[]) => arr.slice(startIdx, startIdx + 24);
      const hourly = sliceN(hourlyTimes).map((t: string, i: number) => ({
        time: t,
        temperature: Number(sliceN(j.hourly?.temperature_2m ?? [])[i] ?? 0),
        precipitationProbability: Number(sliceN(j.hourly?.precipitation_probability ?? [])[i] ?? 0),
        weatherCode: Number(sliceN(j.hourly?.weather_code ?? [])[i] ?? 0),
        isDay: Number(sliceN(j.hourly?.is_day ?? [])[i] ?? 0) === 1,
      }));
      const daily = (j.daily?.time ?? []).map((t: string, i: number) => ({
        date: t,
        tempMax: Number(j.daily.temperature_2m_max?.[i] ?? 0),
        tempMin: Number(j.daily.temperature_2m_min?.[i] ?? 0),
        weatherCode: Number(j.daily.weather_code?.[i] ?? 0),
        precipitationProbability: Number(j.daily.precipitation_probability_max?.[i] ?? 0),
        uvIndexMax: Number(j.daily.uv_index_max?.[i] ?? 0),
      }));
      return {
        timezone: j.timezone ?? "UTC",
        fetchedAt: Date.now(),
        current: {
          temperature: Number(cur.temperature_2m ?? 0),
          apparentTemperature: Number(cur.apparent_temperature ?? 0),
          humidity: Number(cur.relative_humidity_2m ?? 0),
          precipitation: Number(cur.precipitation ?? 0),
          weatherCode: Number(cur.weather_code ?? 0),
          windSpeed: Number(cur.wind_speed_10m ?? 0),
          windDirection: Number(cur.wind_direction_10m ?? 0),
          isDay: Number(cur.is_day ?? 1) === 1,
          uvIndex: Number(cur.uv_index ?? 0),
          time: String(cur.time ?? ""),
        },
        hourly,
        daily,
      } as WeatherForecast;
    },
  });

  return query;
}
