import { weatherIconFor } from "./weather-icons";
import type { WeatherDaily, WeatherUnits } from "./weather-types";

export function Weather7Day({
  daily, units, compact, max = 7,
}: { daily: WeatherDaily[]; units: WeatherUnits; compact?: boolean; max?: number }) {
  const tempUnit = units.temp === "F" ? "°" : "°";
  const items = daily.slice(0, max);
  if (!items.length) return null;
  // Range across the visible window — used to scale the temp bar.
  const minLow = Math.min(...items.map((d) => d.tempMin));
  const maxHigh = Math.max(...items.map((d) => d.tempMax));
  const span = Math.max(1, maxHigh - minLow);

  return (
    <div className="space-y-1" data-testid="weather-7day" role="list" aria-label="Seven day forecast">
      {items.map((d, i) => {
        const Icon = weatherIconFor(d.weatherCode, true);
        const lowPct = ((d.tempMin - minLow) / span) * 100;
        const highPct = ((d.tempMax - minLow) / span) * 100;
        return (
          <div
            key={d.date}
            role="listitem"
            className="flex items-center gap-2 text-xs"
            data-testid={`weather-day-${d.date}`}
          >
            <div className="w-10 text-muted-foreground">{labelFor(d.date, i)}</div>
            <Icon className="h-4 w-4 text-foreground/80 flex-shrink-0" aria-hidden />
            {!compact && (
              <div className="text-[10px] text-blue-500/80 dark:text-blue-300/80 tabular-nums w-8 text-right">
                {d.precipitationProbability > 0 ? `${d.precipitationProbability}%` : ""}
              </div>
            )}
            <div className="text-muted-foreground tabular-nums w-8 text-right">{Math.round(d.tempMin)}{tempUnit}</div>
            <div className="relative flex-1 h-1.5 rounded-full bg-border/50 overflow-hidden">
              <div
                className="absolute h-full bg-gradient-to-r from-sky-400 via-amber-300 to-orange-500 dark:from-sky-500 dark:via-amber-400 dark:to-orange-500 rounded-full"
                style={{ left: `${lowPct}%`, width: `${Math.max(2, highPct - lowPct)}%` }}
              />
            </div>
            <div className="font-semibold tabular-nums w-8 text-right">{Math.round(d.tempMax)}{tempUnit}</div>
          </div>
        );
      })}
    </div>
  );
}

function labelFor(iso: string, i: number): string {
  if (i === 0) return "Today";
  try {
    const d = new Date(iso + "T12:00:00");
    return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);
  } catch {
    return iso.slice(5);
  }
}
