import { createContext, useContext } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimezonePayload = {
  timezone: string;
  timezoneOffsetMinutes: number;
  localTimestamp: string;
  localDate: string;
  localTime: string;
  localHour: number;
};

export type DayBucket = "early_morning" | "morning" | "afternoon" | "evening" | "night";

export type TimezoneContextValue = {
  timezone: string;
  offsetMinutes: number | null;
  detectedAt: string | null;
};

// ── Browser detection ─────────────────────────────────────────────────────────

/** Detect the user's current local timezone and time context from the browser. */
export function detectBrowserTimezone(): TimezonePayload {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();

  const localDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz,
  }).format(now);

  const localTime = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
  }).format(now);

  const hourStr = new Intl.DateTimeFormat("en-US", {
    hour: "numeric", hour12: false, timeZone: tz,
  }).format(now);
  const localHour = parseInt(hourStr, 10);

  return {
    timezone: tz,
    timezoneOffsetMinutes: offsetMinutes,
    localTimestamp: now.toISOString(),
    localDate,
    localTime,
    localHour,
  };
}

/** Describe the time of day as a bucket label for AI context. */
export function getDayBucket(hour: number): DayBucket {
  if (hour < 5)  return "night";
  if (hour < 9)  return "early_morning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 20) return "evening";
  return "night";
}

// ── Timezone-aware date utilities ─────────────────────────────────────────────

/** Format a Date as a YYYY-MM-DD string in the given IANA timezone. */
export function formatDateInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZone: timezone,
  }).format(date);
}

/**
 * Returns the date group label for a meeting note date using the user's
 * detected timezone. Fallback order: timezone arg → browser Intl → UTC.
 *
 * Groups: "Today" | "Yesterday" | "This Week" | "Month Year"
 */
export function getDateGroupLabelInTz(date: Date, timezone: string): string {
  const now = new Date();
  const todayStr     = formatDateInTz(now, timezone);
  const yesterdayStr = formatDateInTz(new Date(now.getTime() - 86_400_000), timezone);
  const dateStr      = formatDateInTz(date, timezone);

  if (dateStr === todayStr)     return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";

  const diffMs = now.getTime() - date.getTime();
  if (diffMs >= 0 && diffMs < 7 * 86_400_000) return "This Week";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "long", timeZone: timezone,
  }).format(date);
}

// ── React context ─────────────────────────────────────────────────────────────

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const TimezoneContext = createContext<TimezoneContextValue>({
  timezone: BROWSER_TZ,
  offsetMinutes: null,
  detectedAt: null,
});

/**
 * Returns the current timezone context.
 *
 * Fallback order:
 *   1. current_detected_timezone  (server-confirmed, refreshed on every login)
 *   2. browser Intl timezone       (always available as default)
 */
export function useTimezone(): TimezoneContextValue {
  return useContext(TimezoneContext);
}
