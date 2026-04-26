import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Anchor, MapPin, Sparkles, Map as MapIcon, ChevronRight, Loader2, Locate } from "lucide-react";
import { MarinasDayPlannerDialog } from "@/components/marinas-day-planner-dialog";

const STAGE_COLORS: Record<string, string> = {
  new: "#9ca3af",
  contacted: "#eab308",
  meeting_scheduled: "#eab308",
  qualified: "#3b82f6",
  proposal_sent: "#3b82f6",
  negotiation: "#3b82f6",
  converted: "#22c55e",
  lost: "#ef4444",
};

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  meeting_scheduled: "Meeting Scheduled",
  qualified: "Qualified",
  proposal_sent: "Proposal Sent",
  negotiation: "Negotiation",
  converted: "Closed Won",
  lost: "Closed Lost",
};

type NearbyLead = {
  id: number;
  company: string;
  status: string;
  city: string | null;
  state: string | null;
  slips: string | null;
  marina_lat: number;
  marina_lng: number;
  distance_km: number;
};

function parseSlips(s: string | null): number {
  if (!s) return 0;
  const m = String(s).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function formatDistance(km: number): string {
  if (km == null || !isFinite(km)) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

const STORAGE_KEY = "voltsafe.leadsMap.location.v1";
function getSavedLocation(): { lat: number; lng: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") {
      return { lat: parsed.lat, lng: parsed.lng };
    }
  } catch {}
  return null;
}

interface Props {
  /**
   * Called when "Plan My Travel Day" is clicked. When omitted, the widget
   * manages its own MarinasDayPlannerDialog so it can drop into the draggable
   * dashboard grid as a self-contained widget — same pattern Travel Calendar
   * uses (see TravelCalendarGridWidget). The map page still passes its own
   * handler to integrate with selection-mode planning.
   */
  onPlanDay?: (loc: { lat: number; lng: number } | null) => void;
}

/**
 * Compact "nearby leads" widget for Mission Control / role-command-center.
 * Shows the closest 5 marinas and quick actions to open the full map view or kick off the day planner.
 */
export function LeadsMissionControlWidget({ onPlanDay }: Props = {}) {
  const [, navigate] = useLocation();
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(() => getSavedLocation());
  const [locating, setLocating] = useState(false);
  const [leads, setLeads] = useState<NearbyLead[]>([]);
  const [loading, setLoading] = useState(false);
  // Self-contained day-planner dialog state — only used when no onPlanDay
  // callback was provided (i.e. when this widget is dropped into the
  // draggable grid instead of the legacy hard-coded slot in role-command-center).
  const [internalPlannerOpen, setInternalPlannerOpen] = useState(false);
  const [internalPlannerLoc, setInternalPlannerLoc] = useState<{ lat: number; lng: number } | null>(null);

  const handlePlanDayClick = () => {
    if (onPlanDay) {
      onPlanDay(location);
      return;
    }
    setInternalPlannerLoc(location);
    setInternalPlannerOpen(true);
  };

  // Try to grab a precise location once on mount (silent — falls back to saved location).
  useEffect(() => {
    if (location || !navigator.geolocation) return;
    setLocating(true);
    const timer = setTimeout(() => setLocating(false), 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(loc)); } catch {}
        setLocation(loc);
        setLocating(false);
      },
      () => { clearTimeout(timer); setLocating(false); },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 4000 }
    );
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch top-5 nearest leads whenever location resolves.
  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/leads/nearby?lat=${location.lat}&lng=${location.lng}&radius=500&limit=8`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((data: NearbyLead[]) => {
        if (cancelled) return;
        setLeads(Array.isArray(data) ? data.slice(0, 5) : []);
      })
      .catch(() => { if (!cancelled) setLeads([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [location]);

  return (
    <>
    <Card className="border border-border/50 bg-card/80" data-testid="widget-leads-mission-control">
      <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Anchor className="h-4 w-4 text-primary" />
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Leads Nearby
          </CardTitle>
          {!loading && leads.length > 0 && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{leads.length}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => navigate("/opportunities?view=map")}
            data-testid="button-leads-widget-map-view"
          >
            <MapIcon className="h-3 w-3" /> Map view
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1 border-primary/40 text-primary-foreground bg-gradient-to-br from-primary to-primary/80"
            onClick={handlePlanDayClick}
            data-testid="button-leads-widget-plan-day"
          >
            <Sparkles className="h-3 w-3" /> Plan My Travel Day
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {!location ? (
          <div className="text-center py-4">
            {locating ? (
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Finding your location…
              </p>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => {
                  if (!navigator.geolocation) return;
                  setLocating(true);
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(loc)); } catch {}
                      setLocation(loc);
                      setLocating(false);
                    },
                    () => setLocating(false),
                    { enableHighAccuracy: false, maximumAge: 60_000, timeout: 5000 }
                  );
                }}
                data-testid="button-leads-widget-locate"
              >
                <Locate className="h-3 w-3" /> Use my location to find nearby leads
              </Button>
            )}
          </div>
        ) : loading ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}
          </div>
        ) : leads.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            No marinas with map coordinates within reach.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {leads.map(lead => {
              const color = STAGE_COLORS[lead.status] || "#9ca3af";
              const slipCount = parseSlips(lead.slips);
              const place = [lead.city, lead.state].filter(Boolean).join(", ");
              return (
                <li key={lead.id}>
                  <button
                    className="w-full flex items-center gap-3 py-2 px-1 text-left hover-elevate active-elevate-2 rounded-md transition"
                    onClick={() => navigate(`/opportunities/${lead.id}`)}
                    data-testid={`button-leads-widget-row-${lead.id}`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-white/20"
                      style={{ background: color }}
                      title={STAGE_LABELS[lead.status] || lead.status}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate" data-testid={`text-leads-widget-company-${lead.id}`}>
                          {lead.company}
                        </p>
                        {slipCount > 0 && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5 flex-shrink-0">
                            <Anchor className="h-2.5 w-2.5" /> {slipCount}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                        <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                        <span className="truncate">{place || "—"}</span>
                        <span className="text-muted-foreground/60">·</span>
                        <span>{formatDistance(lead.distance_km)}</span>
                      </p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
    {/* Self-contained planner dialog — only mounts when no parent handler took
        over (i.e. when the widget runs inside the draggable grid). */}
    {!onPlanDay && (
      <MarinasDayPlannerDialog
        open={internalPlannerOpen}
        onOpenChange={setInternalPlannerOpen}
        userLocation={internalPlannerLoc}
      />
    )}
    </>
  );
}
