import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plane, Car, Train, Ship, Bus, CarTaxiFront, Footprints, MapPin, Plus, Calendar as CalendarIcon, Pencil, EyeOff, Eye, Trash2 } from "lucide-react";
import { useTravelTrips } from "@/hooks/use-travel-trips";
import { TravelStorage, MODE_LABELS, PURPOSE_LABELS, type TravelMode } from "@/lib/travel-storage";
import { TravelPlannerDialog } from "./travel-planner-dialog";
import { useToast } from "@/hooks/use-toast";

const MODE_ICONS: Record<TravelMode, any> = {
  air: Plane, car: Car, rail: Train, boat: Ship, bus: Bus, rideshare: CarTaxiFront, walk: Footprints,
};

function fmtRange(start: string, end: string) {
  try {
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
    const sameDay = start === end;
    const m = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
    if (sameDay) return `${m(s)} ${s.getDate()}, ${s.getFullYear()}`;
    if (sameMonth) return `${m(s)} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
    return `${m(s)} ${s.getDate()} – ${m(e)} ${e.getDate()}, ${e.getFullYear()}`;
  } catch {
    return `${start} → ${end}`;
  }
}

function daysUntil(start: string): number | null {
  try {
    const s = new Date(start + "T00:00:00").getTime();
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((s - today.getTime()) / 86_400_000);
    return diff;
  } catch {
    return null;
  }
}

export function TravelCalendarWidget({ onOpenPlanner }: { onOpenPlanner?: (tripId?: string | null) => void } = {}) {
  const trips = useTravelTrips();
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const published = useMemo(() => trips.filter(t => t.published && t.endDate >= today), [trips, today]);
  const drafts = useMemo(() => trips.filter(t => !t.published), [trips]);

  const openPlanner = (tripId: string | null = null) => {
    if (onOpenPlanner) {
      onOpenPlanner(tripId);
    } else {
      setEditingId(tripId);
      setInternalOpen(true);
    }
  };

  return (
    <Card data-testid="widget-travel-calendar">
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-primary" />
          Travel Calendar
          {published.length > 0 && <Badge variant="outline" className="text-[10px]">{published.length}</Badge>}
        </CardTitle>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openPlanner(null)} data-testid="button-add-trip">
          <Plus className="h-3 w-3" /> New trip
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {published.length === 0 && drafts.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            <CalendarIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>No upcoming travel yet.</p>
            <Button variant="link" size="sm" className="mt-1" onClick={() => openPlanner(null)} data-testid="button-empty-add-trip">
              Plan your first trip
            </Button>
          </div>
        )}

        {published.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Upcoming</div>
            {published.map(trip => {
              const days = daysUntil(trip.startDate);
              const inProgress = trip.startDate <= today && trip.endDate >= today;
              return (
                <div
                  key={trip.id}
                  className="border border-border/60 rounded-lg p-3 bg-secondary/20 hover-elevate cursor-pointer"
                  onClick={() => openPlanner(trip.id)}
                  data-testid={`trip-card-${trip.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{trip.title}</span>
                        {inProgress && <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">In progress</Badge>}
                        {!inProgress && days !== null && days >= 0 && days <= 14 && (
                          <Badge variant="outline" className="text-[10px]">{days === 0 ? "today" : `in ${days}d`}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        <MapPin className="h-3 w-3" />
                        <span className="truncate">{trip.destination}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">{fmtRange(trip.startDate, trip.endDate)}</span>
                        <span className="text-[11px] text-muted-foreground">·</span>
                        <span className="text-[11px] text-muted-foreground">{trip.purpose === "other" ? (trip.purposeOther || "Other") : PURPOSE_LABELS[trip.purpose]}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {trip.modes.map(m => {
                          const Icon = MODE_ICONS[m];
                          return (
                            <span key={m} title={MODE_LABELS[m]} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-background border border-border/60">
                              <Icon className="h-2.5 w-2.5" />
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => { e.stopPropagation(); TravelStorage.setPublished(trip.id, false); toast({ title: "Unpublished", description: trip.title }); }}
                        data-testid={`button-unpublish-${trip.id}`}
                        title="Unpublish from calendar"
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openPlanner(trip.id); }} data-testid={`button-edit-trip-${trip.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {drafts.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Drafts</div>
            {drafts.map(trip => (
              <div
                key={trip.id}
                className="border border-dashed border-border/60 rounded-lg p-2.5 bg-background hover-elevate cursor-pointer"
                onClick={() => openPlanner(trip.id)}
                data-testid={`draft-card-${trip.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{trip.title || "Untitled draft"}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {trip.destination || "No destination"} · {fmtRange(trip.startDate, trip.endDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); TravelStorage.setPublished(trip.id, true); toast({ title: "Published", description: trip.title || "Draft" }); }}
                      data-testid={`button-publish-draft-${trip.id}`}
                      title="Publish to calendar"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); TravelStorage.remove(trip.id); }} data-testid={`button-delete-draft-${trip.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {!onOpenPlanner && (
        <TravelPlannerDialog open={internalOpen} onOpenChange={setInternalOpen} initialTripId={editingId} />
      )}
    </Card>
  );
}
