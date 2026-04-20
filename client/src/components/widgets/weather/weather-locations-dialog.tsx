import { useState, useRef, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, GripVertical, MapPin, Loader2, Star } from "lucide-react";
import { useWeatherGeocoding } from "./use-weather-geocoding";
import type { WeatherSavedLocation } from "./weather-types";

export function WeatherLocationsDialog({
  open, onOpenChange, locations, onChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locations: WeatherSavedLocation[];
  onChange: (next: WeatherSavedLocation[]) => void;
}) {
  const [query, setQuery] = useState("");
  const { results, isLoading, error } = useWeatherGeocoding(query);

  const dragId = useRef<string | null>(null);
  const overId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const addLocation = useCallback(
    (loc: WeatherSavedLocation) => {
      // De-dup by lat/lng (4 decimal places, ~11m precision).
      const key = (l: WeatherSavedLocation) =>
        `${l.latitude.toFixed(4)},${l.longitude.toFixed(4)}`;
      const existing = new Set(locations.map(key));
      if (existing.has(key(loc))) return;
      const next = [...locations, loc].slice(0, 10);
      onChange(next);
      setQuery("");
    },
    [locations, onChange],
  );

  const removeAt = useCallback((id: string) => {
    onChange(locations.filter((l) => l.id !== id));
  }, [locations, onChange]);

  const moveTo = useCallback((id: string, beforeId: string | null) => {
    const next = locations.filter((l) => l.id !== id);
    const moving = locations.find((l) => l.id === id);
    if (!moving) return;
    if (beforeId === null) {
      next.push(moving);
    } else {
      const idx = next.findIndex((l) => l.id === beforeId);
      if (idx === -1) next.push(moving);
      else next.splice(idx, 0, moving);
    }
    onChange(next);
  }, [locations, onChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-weather-locations">
        <DialogHeader>
          <DialogTitle>Weather locations</DialogTitle>
          <DialogDescription>
            Add up to 10 locations. Drag to reorder — first location is your default. The first entry also serves as the fallback when geolocation fails.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search city or place…"
              className="pl-8"
              aria-label="Search city or place"
              data-testid="input-weather-search"
            />
            {isLoading && (
              <Loader2 className="h-4 w-4 absolute right-2.5 top-2.5 text-muted-foreground animate-spin" aria-hidden />
            )}
          </div>

          {error && (
            <div className="text-xs text-destructive" role="alert">
              {error}
            </div>
          )}

          {query.trim().length >= 2 && (
            <div className="border border-border/50 rounded-md max-h-44 overflow-y-auto" role="listbox" aria-label="Search results">
              {results.length === 0 && !isLoading && (
                <div className="p-2 text-xs text-muted-foreground">No matches.</div>
              )}
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent/50 focus:bg-accent focus:outline-none text-xs"
                  onClick={() => addLocation(r)}
                  role="option"
                  aria-selected="false"
                  data-testid={`button-add-location-${r.id}`}
                >
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" aria-hidden />
                  <span className="truncate">{r.label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Saved ({locations.length}/10)
            </div>
            {locations.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">
                None yet. We'll use your detected location until you add one.
              </div>
            ) : (
              <ul className="space-y-1" role="list" aria-label="Saved locations">
                {locations.map((loc, i) => (
                  <li
                    key={loc.id}
                    draggable
                    onDragStart={(e) => {
                      dragId.current = loc.id;
                      setDragging(loc.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      overId.current = loc.id;
                    }}
                    onDragEnd={() => {
                      if (dragId.current && overId.current && dragId.current !== overId.current) {
                        moveTo(dragId.current, overId.current);
                      }
                      dragId.current = null;
                      overId.current = null;
                      setDragging(null);
                    }}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md border border-border/50 bg-background/40 text-xs ${dragging === loc.id ? "opacity-50" : ""}`}
                    data-testid={`row-saved-location-${loc.id}`}
                  >
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 cursor-grab" aria-hidden />
                    {i === 0 && <Star className="h-3 w-3 text-amber-400 flex-shrink-0" aria-hidden />}
                    <span className="truncate flex-1">{loc.label}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => removeAt(loc.id)}
                      aria-label={`Remove ${loc.label}`}
                      data-testid={`button-remove-location-${loc.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
