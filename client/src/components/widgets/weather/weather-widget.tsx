import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Cloud, RefreshCw, MapPin, Settings, GripVertical, AlertTriangle,
} from "lucide-react";
import { useWeatherPrefs } from "./use-weather-prefs";
import { useResolvedLocation, useWeatherForecast } from "./use-weather";
import { WeatherCurrentBlock } from "./weather-current";
import { WeatherHourlyStrip } from "./weather-hourly-strip";
import { Weather7Day } from "./weather-7day";
import { WeatherLocationsDialog } from "./weather-locations-dialog";
import { WeatherSkeleton } from "./weather-skeleton";
import { WeatherBackground, timeOfDayFor } from "./weather-bg";
import { conditionFor } from "./weather-icons";
import type { WeatherSavedLocation, WeatherTempUnit, WeatherWindUnit } from "./weather-types";

export type WeatherWidgetProps = {
  compact?: boolean;
  isDragging?: boolean;
  dragProps?: React.HTMLAttributes<HTMLDivElement>;
};

export function WeatherWidget({ compact, isDragging, dragProps }: WeatherWidgetProps) {
  const { prefs, isLoading: prefsLoading, update } = useWeatherPrefs();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const picked: WeatherSavedLocation | null = useMemo(() => {
    if (!pickedId) return prefs.locations[0] ?? null;
    return prefs.locations.find((l) => l.id === pickedId) ?? prefs.locations[0] ?? null;
  }, [pickedId, prefs.locations]);

  const fallback = prefs.defaultCityFallback ?? prefs.locations[0];
  const { resolved, source } = useResolvedLocation(picked, fallback);
  const forecast = useWeatherForecast(resolved, prefs.units);

  const onSetLocations = (next: WeatherSavedLocation[]) => {
    update((cur) => ({ ...cur, locations: next }));
    if (pickedId && !next.find((l) => l.id === pickedId)) setPickedId(null);
  };

  const onSetTempUnit = (v: WeatherTempUnit) => update((cur) => ({ ...cur, units: { ...cur.units, temp: v } }));
  const onSetWindUnit = (v: WeatherWindUnit) => update((cur) => ({ ...cur, units: { ...cur.units, wind: v } }));

  const condition = forecast.data ? conditionFor(forecast.data.current.weatherCode) : "cloudy";
  const todHour = (() => {
    if (!forecast.data) return new Date().getHours();
    try {
      return new Date(forecast.data.current.time).getHours();
    } catch {
      return new Date().getHours();
    }
  })();
  const tod = timeOfDayFor(todHour);

  return (
    <Card
      className={`relative overflow-hidden border border-border/50 bg-card/80 group/widget transition-all ${isDragging ? "opacity-40 scale-[0.98] ring-2 ring-primary/30" : ""}`}
      data-testid="widget-weather"
    >
      <WeatherBackground condition={condition} timeOfDay={tod} />

      <div
        {...dragProps}
        className="absolute top-3 right-3 opacity-0 group-hover/widget:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-all z-10 touch-none"
        data-testid="drag-handle-weather"
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </div>

      <CardHeader className={`${compact ? "pb-1 pt-3 px-4" : "pb-2 pt-4 px-4"} pr-10 relative z-[1]`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Cloud className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden />
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Weather</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => forecast.refetch()}
              disabled={forecast.isFetching}
              aria-label="Refresh weather"
              data-testid="button-refresh-weather"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${forecast.isFetching ? "animate-spin" : ""}`} aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setDialogOpen(true)}
              aria-label="Open weather settings"
              data-testid="button-open-weather-settings"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 relative z-[1] space-y-3">
        {/* Location switcher + unit toggles */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" aria-hidden />
            {prefs.locations.length > 0 ? (
              <Select
                value={picked?.id ?? prefs.locations[0]?.id ?? ""}
                onValueChange={(v) => setPickedId(v)}
              >
                <SelectTrigger
                  className="h-7 text-xs border-0 bg-transparent hover:bg-background/40 px-2 max-w-[180px]"
                  data-testid="select-weather-location"
                  aria-label="Select location"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {prefs.locations.map((l) => (
                    <SelectItem key={l.id} value={l.id} data-testid={`option-weather-location-${l.id}`}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground truncate" data-testid="text-weather-location">
                {resolved?.label ?? "Detecting…"}
                {source === "fallback" && " (fallback)"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 text-[10px]">
            <UnitToggle
              value={prefs.units.temp}
              options={[{ v: "F", l: "°F" }, { v: "C", l: "°C" }]}
              onChange={(v) => onSetTempUnit(v as WeatherTempUnit)}
              testId="toggle-weather-temp-unit"
            />
            <UnitToggle
              value={prefs.units.wind}
              options={[{ v: "mph", l: "mph" }, { v: "kph", l: "kph" }]}
              onChange={(v) => onSetWindUnit(v as WeatherWindUnit)}
              testId="toggle-weather-wind-unit"
            />
          </div>
        </div>

        {/* Body */}
        {prefsLoading || (!forecast.data && forecast.isLoading) ? (
          <WeatherSkeleton compact={compact} />
        ) : forecast.error ? (
          <div className="flex flex-col items-center justify-center text-center py-6 gap-2" role="alert">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            <div className="text-xs text-muted-foreground">Couldn't load forecast.</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => forecast.refetch()}
              data-testid="button-retry-weather"
            >
              Retry
            </Button>
          </div>
        ) : forecast.data ? (
          <>
            <WeatherCurrentBlock
              current={forecast.data.current}
              today={forecast.data.daily[0]}
              units={prefs.units}
              compact={compact}
            />
            {!compact && (
              <WeatherHourlyStrip
                hourly={forecast.data.hourly}
                units={prefs.units}
                timezone={forecast.data.timezone}
              />
            )}
            <Weather7Day
              daily={forecast.data.daily}
              units={prefs.units}
              compact={compact}
              max={compact ? 4 : 7}
            />
          </>
        ) : null}
      </CardContent>

      <WeatherLocationsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        locations={prefs.locations}
        onChange={onSetLocations}
      />
    </Card>
  );
}

function UnitToggle<T extends string>({
  value, options, onChange, testId,
}: {
  value: T;
  options: { v: T; l: string }[];
  onChange: (v: T) => void;
  testId: string;
}) {
  return (
    <div
      className="flex items-center rounded-md border border-border/50 bg-background/40 backdrop-blur-sm overflow-hidden"
      role="group"
      data-testid={testId}
    >
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`px-1.5 py-0.5 transition-colors ${active ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            aria-pressed={active}
            data-testid={`${testId}-${o.v}`}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

export default WeatherWidget;
