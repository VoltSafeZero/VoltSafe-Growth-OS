import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plane, Car, Train, Ship, Bus, CarTaxiFront, Footprints, Plus, Trash2, MapPin, Sparkles, Save, CheckCircle2, Eye, EyeOff, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  TravelStorage,
  newTripId,
  PURPOSE_LABELS,
  MODE_LABELS,
  type TravelTrip,
  type TravelMode,
  type TravelPurpose,
  type TravelLeg,
} from "@/lib/travel-storage";

const MODE_ICONS: Record<TravelMode, any> = {
  air: Plane,
  car: Car,
  rail: Train,
  boat: Ship,
  bus: Bus,
  rideshare: CarTaxiFront,
  walk: Footprints,
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialTripId?: string | null;
  defaultLocation?: { lat: number; lng: number } | null;
}

function emptyTrip(): TravelTrip {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: newTripId(),
    title: "",
    purpose: "sales",
    purposeOther: "",
    destination: "",
    modes: [],
    startDate: today,
    endDate: today,
    notes: "",
    legs: [],
    published: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function TravelPlannerDialog({ open, onOpenChange, initialTripId }: Props) {
  const { toast } = useToast();
  const [trip, setTrip] = useState<TravelTrip>(() => emptyTrip());
  const isEditing = !!initialTripId;

  useEffect(() => {
    if (!open) return;
    if (initialTripId) {
      const existing = TravelStorage.get(initialTripId);
      setTrip(existing ?? emptyTrip());
    } else {
      setTrip(emptyTrip());
    }
  }, [open, initialTripId]);

  const update = (patch: Partial<TravelTrip>) => setTrip(t => ({ ...t, ...patch }));

  const toggleMode = (m: TravelMode) => {
    setTrip(t => ({
      ...t,
      modes: t.modes.includes(m) ? t.modes.filter(x => x !== m) : [...t.modes, m],
    }));
  };

  const addLeg = () => {
    setTrip(t => ({
      ...t,
      legs: [
        ...t.legs,
        { id: `leg_${Date.now().toString(36)}`, mode: t.modes[0] ?? "air", from: "", to: "" },
      ],
    }));
  };
  const updateLeg = (id: string, patch: Partial<TravelLeg>) => {
    setTrip(t => ({ ...t, legs: t.legs.map(l => (l.id === id ? { ...l, ...patch } : l)) }));
  };
  const removeLeg = (id: string) => setTrip(t => ({ ...t, legs: t.legs.filter(l => l.id !== id) }));

  const titleAuto = useMemo(() => {
    if (trip.title.trim()) return trip.title.trim();
    if (trip.destination.trim()) {
      const purposeLabel = trip.purpose === "other" ? (trip.purposeOther || "Trip") : PURPOSE_LABELS[trip.purpose];
      return `${purposeLabel} — ${trip.destination.trim()}`;
    }
    return "";
  }, [trip.title, trip.destination, trip.purpose, trip.purposeOther]);

  const canSave = trip.destination.trim().length > 0 && trip.startDate && trip.endDate && trip.modes.length > 0;
  const datesValid = trip.startDate && trip.endDate && trip.startDate <= trip.endDate;

  const persist = (publish: boolean | "toggle") => {
    if (!canSave) {
      toast({ title: "Add destination, dates, and at least one mode", variant: "destructive" });
      return;
    }
    if (!datesValid) {
      toast({ title: "End date must be on or after start date", variant: "destructive" });
      return;
    }
    const finalPublished = publish === "toggle" ? !trip.published : publish;
    const next: TravelTrip = { ...trip, title: titleAuto, published: finalPublished };
    TravelStorage.upsert(next);
    toast({
      title: finalPublished ? "Published to Travel Calendar" : "Saved as draft",
      description: next.title,
    });
    onOpenChange(false);
  };

  const handleDelete = () => {
    if (!isEditing) return onOpenChange(false);
    TravelStorage.remove(trip.id);
    toast({ title: "Trip deleted" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-hidden flex flex-col p-0" data-testid="dialog-travel-planner">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {isEditing ? "Edit travel itinerary" : "Plan a trip"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Build the trip here. Publish when you're happy and it'll show up on your Travel Calendar.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-5 pb-4">
            {/* Purpose */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Purpose</Label>
                <Select value={trip.purpose} onValueChange={(v) => update({ purpose: v as TravelPurpose })}>
                  <SelectTrigger data-testid="select-trip-purpose"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PURPOSE_LABELS) as TravelPurpose[]).map(p => (
                      <SelectItem key={p} value={p}>{PURPOSE_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {trip.purpose === "other" && (
                <div>
                  <Label className="text-xs">Describe purpose</Label>
                  <Input value={trip.purposeOther ?? ""} onChange={e => update({ purposeOther: e.target.value })} placeholder="e.g. Industry summit" />
                </div>
              )}
            </div>

            {/* Destination */}
            <div>
              <Label className="text-xs">Destination *</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={trip.destination}
                  onChange={e => update({ destination: e.target.value })}
                  placeholder="City, venue, marina, or address"
                  className="pl-9"
                  data-testid="input-trip-destination"
                />
              </div>
            </div>

            {/* Title (optional override) */}
            <div>
              <Label className="text-xs">Trip title (optional — auto-generated if blank)</Label>
              <Input
                value={trip.title}
                onChange={e => update({ title: e.target.value })}
                placeholder={titleAuto || "e.g. METSTRADE Amsterdam"}
                data-testid="input-trip-title"
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Start date *</Label>
                <DatePicker value={trip.startDate} onChange={(v) => update({ startDate: v, endDate: trip.endDate < v ? v : trip.endDate })} data-testid="date-trip-start" />
              </div>
              <div>
                <Label className="text-xs">End date *</Label>
                <DatePicker value={trip.endDate} onChange={(v) => update({ endDate: v })} data-testid="date-trip-end" />
              </div>
            </div>

            {/* Modes */}
            <div>
              <Label className="text-xs mb-1.5 block">Modes of travel * (pick all that apply)</Label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(MODE_LABELS) as TravelMode[]).map(m => {
                  const Icon = MODE_ICONS[m];
                  const active = trip.modes.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMode(m)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary/30 border-border hover-elevate active-elevate-2"
                      }`}
                      data-testid={`chip-mode-${m}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {MODE_LABELS[m]}
                    </button>
                  );
                })}
              </div>
            </div>

            <Separator />

            {/* Legs (optional itinerary detail) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">Itinerary segments (optional)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLeg} className="h-7 text-xs gap-1" data-testid="button-add-leg">
                  <Plus className="h-3 w-3" /> Add leg
                </Button>
              </div>
              {trip.legs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Add specific legs (e.g. flight, train, drive) if you want detail. Otherwise the trip just spans your start–end dates.</p>
              ) : (
                <div className="space-y-2">
                  {trip.legs.map((leg, idx) => {
                    const Icon = MODE_ICONS[leg.mode];
                    return (
                      <div key={leg.id} className="border border-border/60 rounded-lg p-2.5 space-y-2 bg-secondary/20" data-testid={`leg-${idx}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-medium">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                            Leg {idx + 1}
                          </div>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeLeg(leg.id)} data-testid={`button-remove-leg-${idx}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2">
                          <Select value={leg.mode} onValueChange={(v) => updateLeg(leg.id, { mode: v as TravelMode })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(Object.keys(MODE_LABELS) as TravelMode[]).map(m => (
                                <SelectItem key={m} value={m}>{MODE_LABELS[m]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input className="h-8 text-xs" placeholder="Carrier (e.g. Air Canada)" value={leg.carrier ?? ""} onChange={e => updateLeg(leg.id, { carrier: e.target.value })} />
                          <Input className="h-8 text-xs" placeholder="From" value={leg.from ?? ""} onChange={e => updateLeg(leg.id, { from: e.target.value })} />
                          <Input className="h-8 text-xs" placeholder="To" value={leg.to ?? ""} onChange={e => updateLeg(leg.id, { to: e.target.value })} />
                          <Input className="h-8 text-xs" type="datetime-local" value={leg.departAt ?? ""} onChange={e => updateLeg(leg.id, { departAt: e.target.value })} />
                          <Input className="h-8 text-xs" type="datetime-local" value={leg.arriveAt ?? ""} onChange={e => updateLeg(leg.id, { arriveAt: e.target.value })} />
                          <Input className="h-8 text-xs sm:col-span-2" placeholder="Confirmation / reference (optional)" value={leg.reference ?? ""} onChange={e => updateLeg(leg.id, { reference: e.target.value })} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={3} value={trip.notes ?? ""} onChange={e => update({ notes: e.target.value })} placeholder="Hotel, who you're seeing, prep reminders…" />
            </div>

            {/* Status badge */}
            <div className="flex items-center gap-2 text-xs">
              {trip.published ? (
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Published to calendar
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">Draft — not on calendar yet</Badge>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="border-t border-border/60 px-6 py-3 flex flex-wrap items-center justify-between gap-2 bg-background/95">
          <div>
            {isEditing && (
              <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive" onClick={handleDelete} data-testid="button-delete-trip">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete trip
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid="button-cancel-trip">
              <X className="h-3.5 w-3.5 mr-1.5" /> Cancel
            </Button>
            <Button variant="outline" size="sm" onClick={() => persist(false)} disabled={!canSave} data-testid="button-save-draft">
              <Save className="h-3.5 w-3.5 mr-1.5" /> Save draft
            </Button>
            {trip.published ? (
              <Button size="sm" onClick={() => persist(false)} disabled={!canSave} className="bg-amber-500 hover:bg-amber-600 text-white" data-testid="button-unpublish-trip">
                <EyeOff className="h-3.5 w-3.5 mr-1.5" /> Unpublish
              </Button>
            ) : (
              <Button size="sm" onClick={() => persist(true)} disabled={!canSave} data-testid="button-publish-trip">
                <Eye className="h-3.5 w-3.5 mr-1.5" /> Publish to calendar
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
