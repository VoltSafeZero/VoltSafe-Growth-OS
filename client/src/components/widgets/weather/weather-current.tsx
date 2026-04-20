import { useEffect, useRef, useState } from "react";
import { Droplets, Wind, Sun, CloudRain } from "lucide-react";
import { weatherIconFor, weatherLabelFor } from "./weather-icons";
import type { WeatherCurrent, WeatherDaily, WeatherUnits } from "./weather-types";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const fn = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, []);
  return reduced;
}

// Animated count to current value over ~400ms (skipped under reduced-motion).
function useAnimatedNumber(target: number, durationMs = 400) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(from + (target - from) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reduced]);

  return value;
}

export function WeatherCurrentBlock({
  current, today, units, compact,
}: {
  current: WeatherCurrent;
  today?: WeatherDaily;
  units: WeatherUnits;
  compact?: boolean;
}) {
  const Icon = weatherIconFor(current.weatherCode, current.isDay);
  const animTemp = useAnimatedNumber(current.temperature);
  const tempUnit = units.temp === "F" ? "°F" : "°C";
  const windUnit = units.wind === "mph" ? "mph" : "kph";
  // Hide UV at night — Open-Meteo still returns a value but it reads as stale.
  const uvDisplay = current.isDay ? current.uvIndex.toFixed(1) : "—";

  return (
    <div className="space-y-3" data-testid="weather-current">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-xs text-muted-foreground">{weatherLabelFor(current.weatherCode)}</div>
          <div
            className={`font-semibold tabular-nums leading-none ${compact ? "text-4xl" : "text-5xl"}`}
            aria-label={`Current temperature ${Math.round(current.temperature)} degrees ${units.temp === "F" ? "Fahrenheit" : "Celsius"}`}
            data-testid="text-weather-temperature"
          >
            {Math.round(animTemp)}<span className="text-lg align-top text-muted-foreground ml-0.5">{tempUnit}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Feels like {Math.round(current.apparentTemperature)}{tempUnit}
            {today && (
              <> · H {Math.round(today.tempMax)}° L {Math.round(today.tempMin)}°</>
            )}
          </div>
        </div>
        <Icon
          className={`text-foreground/80 ${compact ? "h-12 w-12" : "h-14 w-14"}`}
          aria-hidden
          data-testid="icon-weather-current"
        />
      </div>

      <div className="grid grid-cols-4 gap-2 text-xs">
        <Stat icon={Droplets} label="Humidity" value={`${Math.round(current.humidity)}%`} testId="stat-weather-humidity" />
        <Stat icon={Wind} label="Wind" value={`${Math.round(current.windSpeed)} ${windUnit}`} testId="stat-weather-wind" />
        <Stat icon={Sun} label="UV" value={uvDisplay} testId="stat-weather-uv" />
        <Stat icon={CloudRain} label="Precip" value={`${Math.round(today?.precipitationProbability ?? 0)}%`} testId="stat-weather-precip" />
      </div>
    </div>
  );
}

function Stat({
  icon: Icon, label, value, testId,
}: { icon: React.ElementType; label: string; value: string; testId: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-md border border-border/50 bg-background/40 backdrop-blur-sm py-1.5"
      data-testid={testId}
    >
      <Icon className="h-3 w-3 text-muted-foreground mb-0.5" aria-hidden />
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">{label}</div>
      <div className="text-xs font-semibold tabular-nums">{value}</div>
    </div>
  );
}
