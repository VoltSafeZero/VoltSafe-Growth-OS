import { weatherIconFor } from "./weather-icons";
import type { WeatherHourly, WeatherUnits } from "./weather-types";

export function WeatherHourlyStrip({
  hourly, units, timezone,
}: { hourly: WeatherHourly[]; units: WeatherUnits; timezone: string }) {
  const tempUnit = units.temp === "F" ? "°" : "°";
  return (
    <div
      className="overflow-x-auto scroll-smooth -mx-1 px-1 pb-1"
      style={{ scrollSnapType: "x proximity", WebkitOverflowScrolling: "touch" }}
      role="region"
      aria-label="Hourly forecast for the next 24 hours"
      data-testid="weather-hourly-strip"
    >
      <div className="flex gap-2 min-w-max">
        {hourly.map((h) => {
          const Icon = weatherIconFor(h.weatherCode, h.isDay);
          return (
            <div
              key={h.time}
              className="flex flex-col items-center gap-1 min-w-12 px-1.5 py-1 rounded-md hover:bg-background/50 transition-colors"
              style={{ scrollSnapAlign: "start" }}
              data-testid={`weather-hour-${h.time}`}
            >
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {formatHour(h.time, timezone)}
              </div>
              <Icon className="h-4 w-4 text-foreground/80" aria-hidden />
              <div className="text-xs font-semibold tabular-nums">
                {Math.round(h.temperature)}{tempUnit}
              </div>
              <div className="text-[10px] text-blue-500/80 dark:text-blue-300/80 tabular-nums">
                {h.precipitationProbability > 0 ? `${h.precipitationProbability}%` : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatHour(iso: string, timezone: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      hour12: true,
      timeZone: timezone,
    }).format(d);
  } catch {
    return iso.slice(11, 16);
  }
}
