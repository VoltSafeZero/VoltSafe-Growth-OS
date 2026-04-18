import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QuickLogModal } from "@/components/mobile/quick-log-modal";
import {
  MapPin, Navigation, Locate, Phone, StickyNote, ChevronLeft,
  AlertTriangle, RefreshCw, Building2, ExternalLink,
} from "lucide-react";

type NearbyLead = {
  id: number;
  company: string;
  contact_name: string;
  contact_phone: string | null;
  status: string;
  city: string | null;
  state: string | null;
  slips: string | null;
  distance_km: number;
  deal_amount: number | null;
  marina_address: string | null;
  street_address: string | null;
  marina_lat: number;
  marina_lng: number;
};

type GeoState =
  | { stage: "idle" }
  | { stage: "locating" }
  | { stage: "located"; lat: number; lng: number }
  | { stage: "error"; message: string };

const STATUS_COLOR: Record<string, string> = {
  new: "bg-secondary/50 text-muted-foreground",
  contacted: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  meeting_scheduled: "bg-purple-500/15 text-purple-400",
  qualified: "bg-cyan-500/15 text-cyan-400",
  proposal_sent: "bg-amber-500/15 text-amber-400",
  negotiation: "bg-orange-500/15 text-orange-400",
  converted: "bg-emerald-500/15 text-emerald-400",
  lost: "bg-red-500/15 text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", meeting_scheduled: "Meeting Set",
  qualified: "Qualified", proposal_sent: "Proposal Sent",
  negotiation: "Negotiating", converted: "Won", lost: "Lost",
};

function distanceLabel(km: number) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function directionsUrl(lat: number, lng: number, name: string) {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (isIOS) return `maps://?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(name)}`;
}

export default function FieldNearbyPage() {
  const [geo, setGeo] = useState<GeoState>({ stage: "idle" });
  const [leads, setLeads] = useState<NearbyLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [radius, setRadius] = useState(50);
  const [logTarget, setLogTarget] = useState<{ type: string; id: number; label: string } | null>(null);

  const locate = () => {
    if (!navigator.geolocation) {
      setGeo({ stage: "error", message: "Geolocation not supported on this device." });
      return;
    }
    setGeo({ stage: "locating" });
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGeo({ stage: "located", lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      err => {
        setGeo({ stage: "error", message: err.message || "Could not get your location." });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    if (geo.stage === "located") {
      fetchNearby(geo.lat, geo.lng);
    }
  }, [geo.stage, radius]);

  const fetchNearby = async (lat: number, lng: number) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/leads/nearby?lat=${lat}&lng=${lng}&radius=${radius}&limit=50`);
      if (r.ok) setLeads(await r.json());
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    if (geo.stage === "located") fetchNearby(geo.lat, geo.lng);
    else locate();
  };

  return (
    <div className="flex-1 w-full bg-background" data-testid="field-nearby-page">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/field">
            <button className="p-1.5 rounded-full text-muted-foreground hover:text-foreground" data-testid="button-nearby-back">
              <ChevronLeft className="w-5 h-5" />
            </button>
          </Link>
          <div className="flex-1">
            <h1 className="text-base font-bold">Nearby</h1>
            <p className="text-xs text-muted-foreground">
              {geo.stage === "located"
                ? `${leads.length} leads within ${radius} km`
                : "Leads, accounts and installs near you"}
            </p>
          </div>
          {geo.stage === "located" && (
            <button
              onClick={refresh}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground"
              data-testid="button-nearby-refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-5 space-y-5">

        {/* Radius filter */}
        {geo.stage === "located" && (
          <div className="flex items-center gap-2" data-testid="nearby-radius-filter">
            <span className="text-xs text-muted-foreground">Radius:</span>
            {[10, 25, 50, 100].map(r => (
              <button
                key={r}
                onClick={() => setRadius(r)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  radius === r
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/60 text-muted-foreground"
                }`}
                data-testid={`nearby-radius-${r}`}
              >
                {r} km
              </button>
            ))}
          </div>
        )}

        {/* Geo state UI */}
        {geo.stage === "idle" && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center" data-testid="nearby-cta">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <MapPin className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="text-base font-semibold">Find nearby leads</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                See leads and accounts within driving distance, sorted by proximity.
              </p>
            </div>
            <Button onClick={locate} className="gap-2 h-11 px-6" data-testid="button-locate-me">
              <Locate className="w-4 h-4" /> Use My Location
            </Button>
          </div>
        )}

        {geo.stage === "locating" && (
          <div className="flex flex-col items-center justify-center py-16 gap-3" data-testid="nearby-locating">
            <Locate className="w-8 h-8 text-primary animate-pulse" />
            <p className="text-sm text-muted-foreground">Getting your location…</p>
          </div>
        )}

        {geo.stage === "error" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center" data-testid="nearby-error">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <p className="text-sm text-muted-foreground">{geo.message}</p>
            <Button variant="outline" onClick={locate} className="gap-2" data-testid="button-retry-locate">
              <RefreshCw className="w-4 h-4" /> Try Again
            </Button>
          </div>
        )}

        {/* Results list */}
        {geo.stage === "located" && (
          <div data-testid="nearby-results">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-xl" />
                ))}
              </div>
            ) : leads.length === 0 ? (
              <div className="text-center py-12" data-testid="nearby-empty">
                <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No leads found within {radius} km.</p>
                <p className="text-xs text-muted-foreground mt-1">Try a larger radius.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {leads.map(lead => (
                  <div
                    key={lead.id}
                    className="bg-card border border-border/40 rounded-xl overflow-hidden"
                    data-testid={`nearby-lead-${lead.id}`}
                  >
                    <div className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold truncate">{lead.company}</p>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 shrink-0 ${STATUS_COLOR[lead.status] ?? ""}`}
                            >
                              {STATUS_LABEL[lead.status] ?? lead.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            {lead.contact_name && <span>{lead.contact_name}</span>}
                            {(lead.city || lead.state) && (
                              <span className="before:content-['·'] before:mx-1">
                                {[lead.city, lead.state].filter(Boolean).join(", ")}
                              </span>
                            )}
                            {lead.slips && (
                              <span className="before:content-['·'] before:mx-1">{lead.slips} slips</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Navigation className="w-3 h-3 text-primary" />
                          <span className="text-xs font-semibold text-primary">
                            {distanceLabel(lead.distance_km)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-3">
                        {lead.contact_phone && (
                          <a
                            href={`tel:${lead.contact_phone}`}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium"
                            data-testid={`nearby-call-${lead.id}`}
                          >
                            <Phone className="w-3 h-3" /> Call
                          </a>
                        )}
                        <a
                          href={directionsUrl(lead.marina_lat, lead.marina_lng, lead.company)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
                          data-testid={`nearby-directions-${lead.id}`}
                        >
                          <ExternalLink className="w-3 h-3" /> Directions
                        </a>
                        <button
                          onClick={() => setLogTarget({ type: "lead", id: lead.id, label: lead.company })}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/60 text-muted-foreground text-xs font-medium"
                          data-testid={`nearby-note-${lead.id}`}
                        >
                          <StickyNote className="w-3 h-3" /> Note
                        </button>
                        {lead.deal_amount && (
                          <span className="text-xs font-semibold text-emerald-400 ml-auto">
                            ${lead.deal_amount.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="h-24" />

      <QuickLogModal
        open={!!logTarget}
        onClose={() => setLogTarget(null)}
        linkedObjectType={logTarget?.type}
        linkedObjectId={logTarget?.id}
        linkedLabel={logTarget?.label}
      />
    </div>
  );
}
