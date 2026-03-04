import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Navigation, MapPin, Anchor, Phone, Mail, ExternalLink,
  Locate, Loader2, ChevronRight, DollarSign, X
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type NearbyLead = {
  id: number;
  company: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  status: string;
  city: string | null;
  state: string | null;
  country: string | null;
  slips: string | null;
  street_address: string | null;
  zip_code: string | null;
  marina_address: string | null;
  marina_lat: number;
  marina_lng: number;
  latitude: number | null;
  longitude: number | null;
  distance_km: number;
  deal_amount: number | null;
  deal_probability: number | null;
  primary_value_driver: string | null;
  notes: string | null;
  source: string | null;
  segment: string | null;
};

const STAGE_COLORS: Record<string, string> = {
  new: "#64748b",
  contacted: "#3b82f6",
  meeting_scheduled: "#a855f7",
  qualified: "#06b6d4",
  proposal_sent: "#f59e0b",
  negotiation: "#f97316",
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

function getDirectionsUrl(lat: number, lng: number, name: string) {
  const encoded = encodeURIComponent(name);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) {
    return `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encoded}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=&travelmode=driving`;
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

function formatMiles(km: number): string {
  const miles = km * 0.621371;
  if (miles < 0.1) return `${Math.round(miles * 5280)}ft`;
  if (miles < 10) return `${miles.toFixed(1)}mi`;
  return `${Math.round(miles)}mi`;
}

function createMarkerIcon(status: string) {
  const color = STAGE_COLORS[status] || "#64748b";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: 28px; height: 28px; border-radius: 50%;
      background: ${color}; border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
    "><svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function createUserIcon() {
  return L.divIcon({
    className: "user-marker",
    html: `<div style="
      width: 20px; height: 20px; border-radius: 50%;
      background: #2dd4bf; border: 3px solid white;
      box-shadow: 0 0 0 3px rgba(45,212,191,0.3), 0 2px 8px rgba(0,0,0,0.4);
      animation: pulse-ring 2s ease-out infinite;
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export default function NearbyMarinasMap({ onSelectLead }: { onSelectLead?: (leadId: number) => void }) {
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [radius, setRadius] = useState("50");
  const [selectedLead, setSelectedLead] = useState<NearbyLead | null>(null);
  const [stageFilter, setStageFilter] = useState("all");
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  const requestLocation = useCallback(() => {
    setLocating(true);
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by your browser");
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setLocationError(
          err.code === 1 ? "Location access denied. Please enable location in your browser settings."
          : err.code === 2 ? "Location unavailable. Please try again."
          : "Location request timed out. Please try again."
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const { data: nearbyLeads, isLoading } = useQuery<NearbyLead[]>({
    queryKey: ["/api/leads/nearby", userLocation?.lat, userLocation?.lng, radius],
    queryFn: async () => {
      if (!userLocation) return [];
      const res = await fetch(
        `/api/leads/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=${radius}&limit=300`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch nearby leads");
      return res.json();
    },
    enabled: !!userLocation,
  });

  const filteredLeads = nearbyLeads?.filter(l => stageFilter === "all" || l.status === stageFilter) || [];

  useEffect(() => {
    if (!mapRef.current || !userLocation) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([userLocation.lat, userLocation.lng], 10);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);

      markersRef.current = L.layerGroup().addTo(mapInstanceRef.current);
    } else {
      mapInstanceRef.current.setView([userLocation.lat, userLocation.lng], 10);
    }

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
    } else {
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
        icon: createUserIcon(),
        zIndexOffset: 1000,
      }).addTo(mapInstanceRef.current);
      userMarkerRef.current.bindPopup("<b>Your Location</b>");
    }

    return () => {};
  }, [userLocation]);

  useEffect(() => {
    if (!mapInstanceRef.current || !markersRef.current || !userLocation) return;
    markersRef.current.clearLayers();

    if (!filteredLeads.length) return;

    const bounds = L.latLngBounds([[userLocation.lat, userLocation.lng]]);

    filteredLeads.forEach((lead) => {
      const marker = L.marker([lead.marina_lat, lead.marina_lng], {
        icon: createMarkerIcon(lead.status),
      });

      const addr = lead.marina_address || [lead.street_address, lead.city, lead.state].filter(Boolean).join(", ");
      const directionsUrl = getDirectionsUrl(lead.marina_lat, lead.marina_lng, lead.company);

      const popupEl = document.createElement("div");
      popupEl.style.cssText = "min-width: 200px; font-family: Inter, sans-serif;";

      const titleEl = document.createElement("div");
      titleEl.style.cssText = "font-weight: 600; font-size: 14px; margin-bottom: 4px;";
      titleEl.textContent = lead.company;
      popupEl.appendChild(titleEl);

      const distEl = document.createElement("div");
      distEl.style.cssText = "font-size: 12px; color: #94a3b8; margin-bottom: 6px;";
      distEl.textContent = `${formatDistance(lead.distance_km)} (${formatMiles(lead.distance_km)}) away`;
      popupEl.appendChild(distEl);

      if (addr) {
        const addrEl = document.createElement("div");
        addrEl.style.cssText = "font-size: 12px; color: #cbd5e1; margin-bottom: 4px;";
        addrEl.textContent = addr;
        popupEl.appendChild(addrEl);
      }
      if (lead.contact_phone) {
        const phoneEl = document.createElement("div");
        phoneEl.style.cssText = "font-size: 12px; color: #cbd5e1;";
        phoneEl.textContent = lead.contact_phone;
        popupEl.appendChild(phoneEl);
      }
      if (lead.slips) {
        const slipsEl = document.createElement("div");
        slipsEl.style.cssText = "font-size: 12px; color: #cbd5e1;";
        slipsEl.textContent = `${lead.slips} slips`;
        popupEl.appendChild(slipsEl);
      }
      if (lead.deal_amount) {
        const dealEl = document.createElement("div");
        dealEl.style.cssText = "font-size: 12px; color: #34d399; font-weight: 500;";
        dealEl.textContent = `$${Number(lead.deal_amount).toLocaleString()}`;
        popupEl.appendChild(dealEl);
      }

      const dirLink = document.createElement("a");
      dirLink.href = directionsUrl;
      dirLink.target = "_blank";
      dirLink.rel = "noopener";
      dirLink.style.cssText = "display: inline-block; margin-top: 8px; padding: 6px 12px; background: #2dd4bf; color: #0f172a; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 600;";
      dirLink.textContent = "Get Directions";
      popupEl.appendChild(dirLink);

      marker.bindPopup(popupEl, { maxWidth: 280 });

      marker.addTo(markersRef.current!);
      bounds.extend([lead.marina_lat, lead.marina_lng]);
    });

    mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [filteredLeads, userLocation]);

  if (locationError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
          <MapPin className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Location Required</h3>
        <p className="text-sm text-muted-foreground text-center mb-4 max-w-md">{locationError}</p>
        <Button onClick={requestLocation} variant="outline" data-testid="button-retry-location">
          <Locate className="mr-2 h-4 w-4" /> Try Again
        </Button>
      </div>
    );
  }

  if (locating || !userLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-sm text-muted-foreground">Getting your location...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-220px)]">
      <div className="flex items-center gap-2 px-1 pb-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Locate className="h-4 w-4 text-primary" />
          <span>{userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}</span>
        </div>
        <Select value={radius} onValueChange={setRadius}>
          <SelectTrigger className="w-[130px] h-8 text-xs" data-testid="select-radius">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">Within 10 km</SelectItem>
            <SelectItem value="25">Within 25 km</SelectItem>
            <SelectItem value="50">Within 50 km</SelectItem>
            <SelectItem value="100">Within 100 km</SelectItem>
            <SelectItem value="250">Within 250 km</SelectItem>
            <SelectItem value="500">Within 500 km</SelectItem>
          </SelectContent>
        </Select>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-stage-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {Object.entries(STAGE_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={requestLocation} data-testid="button-refresh-location">
          <Locate className="mr-1 h-3 w-3" /> Refresh Location
        </Button>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!isLoading && filteredLeads.length > 0 && (
          <Badge variant="outline" className="text-xs">{filteredLeads.length} marinas nearby</Badge>
        )}
      </div>

      <div className="flex flex-1 gap-3 min-h-0">
        <div ref={mapRef} className="flex-1 rounded-xl border border-border/50 overflow-hidden z-0" data-testid="map-container" />

        <div className="w-72 lg:w-80 flex-shrink-0 overflow-y-auto space-y-1.5 pr-1">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-8">
              <Anchor className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No marinas found within {radius} km</p>
              <p className="text-xs text-muted-foreground mt-1">Try increasing the search radius</p>
            </div>
          ) : (
            filteredLeads.map((lead) => (
              <div
                key={lead.id}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedLead?.id === lead.id
                    ? "border-primary/50 bg-primary/5"
                    : "border-border/30 bg-card/50 hover:border-primary/30"
                }`}
                onClick={() => {
                  setSelectedLead(lead);
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.setView([lead.marina_lat, lead.marina_lng], 14, { animate: true });
                  }
                }}
                data-testid={`nearby-lead-${lead.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{lead.company}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{formatMiles(lead.distance_km)} away</span>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1 py-0"
                        style={{ borderColor: STAGE_COLORS[lead.status] + "40", color: STAGE_COLORS[lead.status] }}
                      >
                        {STAGE_LABELS[lead.status] || lead.status}
                      </Badge>
                    </div>
                  </div>
                  <a
                    href={getDirectionsUrl(lead.marina_lat, lead.marina_lng, lead.company)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 p-1.5 rounded-md bg-primary/10 transition-colors hover-elevate"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`directions-${lead.id}`}
                    title="Get Directions"
                  >
                    <Navigation className="h-4 w-4 text-primary" />
                  </a>
                </div>
                {(lead.city || lead.state) && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {[lead.city, lead.state].filter(Boolean).join(", ")}
                  </p>
                )}
                {lead.slips && lead.slips !== "-" && (
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Anchor className="h-3 w-3 shrink-0" /> {lead.slips} slips
                  </p>
                )}
                {lead.deal_amount != null && lead.deal_amount > 0 && (
                  <p className="text-xs text-emerald-400 font-medium mt-0.5">
                    ${Number(lead.deal_amount).toLocaleString()}
                    {lead.deal_probability != null && <span className="text-muted-foreground font-normal"> ({lead.deal_probability}%)</span>}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}