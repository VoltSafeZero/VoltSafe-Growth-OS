import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Navigation, MapPin, Anchor, Search,
  Locate, Loader2
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

const STORAGE_KEY = "voltsafe-map-last-location";

function getSavedLocation(): { lat: number; lng: number; zoom: number } | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

function saveLocation(lat: number, lng: number, zoom: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lat, lng, zoom }));
  } catch {}
}

function getDirectionsUrl(lat: number, lng: number, address: string | null, name: string) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (address) {
    const encoded = encodeURIComponent(address);
    if (isIOS) return `maps://maps.apple.com/?daddr=${encoded}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
  }
  const encoded = encodeURIComponent(name);
  if (isIOS) return `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encoded}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
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

function boundsToRadius(map: L.Map): number {
  const bounds = map.getBounds();
  const center = bounds.getCenter();
  const ne = bounds.getNorthEast();
  const radiusKm = center.distanceTo(ne) / 1000;
  return Math.ceil(Math.min(radiusKm, 500));
}

function createMarkerIcon(status: string) {
  const color = STAGE_COLORS[status] || "#64748b";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: 12px; height: 12px; border-radius: 50%;
      background: ${color}; border: 2px solid white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -8],
  });
}

function createUserIcon() {
  return L.divIcon({
    className: "user-marker",
    html: `<div style="
      width: 14px; height: 14px; border-radius: 50%;
      background: #2dd4bf; border: 2px solid white;
      box-shadow: 0 0 0 3px rgba(45,212,191,0.3), 0 2px 6px rgba(0,0,0,0.3);
      animation: pulse-ring 2s ease-out infinite;
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export default function NearbyMarinasMap({ onSelectLead }: { onSelectLead?: (leadId: number) => void }) {
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [selectedLead, setSelectedLead] = useState<NearbyLead | null>(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [marinas, setMarinas] = useState<NearbyLead[]>([]);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchMarinas = useCallback(async (lat: number, lng: number, radiusKm: number) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/leads/nearby?lat=${lat}&lng=${lng}&radius=${radiusKm}&limit=500`,
        { credentials: "include", signal: controller.signal }
      );
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      if (!controller.signal.aborted) setMarinas(data);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const debouncedFetchFromBounds = useCallback(() => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => {
      if (!mapInstanceRef.current) return;
      const center = mapInstanceRef.current.getCenter();
      const radius = boundsToRadius(mapInstanceRef.current);
      saveLocation(center.lat, center.lng, mapInstanceRef.current.getZoom());
      fetchMarinas(center.lat, center.lng, radius);
    }, 400);
  }, [fetchMarinas]);

  const requestLocation = useCallback(() => {
    setLocating(true);
    setLocationError(null);
    if (!navigator.geolocation) {
      const saved = getSavedLocation();
      if (saved) {
        setUserLocation({ lat: saved.lat, lng: saved.lng });
        setLocating(false);
      } else {
        setLocationError("Geolocation is not supported by your browser");
        setLocating(false);
      }
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        saveLocation(loc.lat, loc.lng, 13);
        setLocating(false);
      },
      () => {
        const saved = getSavedLocation();
        if (saved) {
          setUserLocation({ lat: saved.lat, lng: saved.lng });
          setLocating(false);
        } else {
          setLocationError("Could not get your location. Search an address or enable location access.");
          setLocating(false);
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(searchQuery.trim())}`, { credentials: "include" });
      if (!res.ok) { setSearching(false); return; }
      const data = await res.json();
      const loc = { lat: data.lat, lng: data.lng };
      setUserLocation(loc);
      saveLocation(loc.lat, loc.lng, 13);
      setLocationError(null);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([loc.lat, loc.lng], 13, { animate: true });
      }
    } catch {}
    setSearching(false);
  };

  const filteredMarinas = marinas.filter(l => stageFilter === "all" || l.status === stageFilter);

  useEffect(() => {
    if (!mapRef.current || !userLocation) return;

    if (!mapInstanceRef.current) {
      const saved = getSavedLocation();
      const zoom = saved?.zoom || 13;
      mapInstanceRef.current = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([userLocation.lat, userLocation.lng], zoom);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);

      L.control.scale({
        position: "bottomleft",
        metric: true,
        imperial: true,
        maxWidth: 150,
      }).addTo(mapInstanceRef.current);

      markersRef.current = L.layerGroup().addTo(mapInstanceRef.current);

      mapInstanceRef.current.on("moveend", debouncedFetchFromBounds);

      const radius = boundsToRadius(mapInstanceRef.current);
      fetchMarinas(userLocation.lat, userLocation.lng, radius);
    } else {
      mapInstanceRef.current.setView([userLocation.lat, userLocation.lng], mapInstanceRef.current.getZoom());
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
  }, [userLocation, debouncedFetchFromBounds, fetchMarinas]);

  useEffect(() => {
    if (!mapInstanceRef.current || !markersRef.current) return;
    markersRef.current.clearLayers();

    if (!filteredMarinas.length) return;

    filteredMarinas.forEach((lead) => {
      const marker = L.marker([lead.marina_lat, lead.marina_lng], {
        icon: createMarkerIcon(lead.status),
      });

      marker.bindTooltip(lead.company, {
        direction: "top",
        offset: [0, -8],
        className: "marina-tooltip",
      });

      const addr = lead.marina_address || [lead.street_address, lead.city, lead.state].filter(Boolean).join(", ");

      const handleDirections = async () => {
        let finalAddr = addr;
        if (!finalAddr) {
          try {
            const res = await fetch(`/api/leads/${lead.id}/geocode-address`, { method: "POST", credentials: "include" });
            if (res.ok) { const data = await res.json(); finalAddr = data.address; }
          } catch {}
        }
        const url = getDirectionsUrl(lead.marina_lat, lead.marina_lng, finalAddr || null, lead.company);
        window.open(url, "_blank", "noopener");
      };

      const popupEl = document.createElement("div");
      popupEl.style.cssText = "min-width: 190px; font-family: Inter, sans-serif;";

      const titleEl = document.createElement("div");
      titleEl.style.cssText = "font-weight: 600; font-size: 13px; margin-bottom: 3px;";
      titleEl.textContent = lead.company;
      popupEl.appendChild(titleEl);

      const distEl = document.createElement("div");
      distEl.style.cssText = "font-size: 11px; color: #64748b; margin-bottom: 4px;";
      distEl.textContent = `${formatDistance(lead.distance_km)} (${formatMiles(lead.distance_km)}) away`;
      popupEl.appendChild(distEl);

      if (addr) {
        const addrEl = document.createElement("div");
        addrEl.style.cssText = "font-size: 11px; color: #475569; margin-bottom: 3px;";
        addrEl.textContent = addr;
        popupEl.appendChild(addrEl);
      }
      if (lead.contact_phone) {
        const phoneEl = document.createElement("div");
        phoneEl.style.cssText = "font-size: 11px; color: #475569;";
        phoneEl.textContent = lead.contact_phone;
        popupEl.appendChild(phoneEl);
      }
      if (lead.slips) {
        const slipsEl = document.createElement("div");
        slipsEl.style.cssText = "font-size: 11px; color: #475569;";
        slipsEl.textContent = `${lead.slips} slips`;
        popupEl.appendChild(slipsEl);
      }
      if (lead.deal_amount) {
        const dealEl = document.createElement("div");
        dealEl.style.cssText = "font-size: 11px; color: #059669; font-weight: 500;";
        dealEl.textContent = `$${Number(lead.deal_amount).toLocaleString()}`;
        popupEl.appendChild(dealEl);
      }

      const dirBtn = document.createElement("button");
      dirBtn.type = "button";
      dirBtn.setAttribute("data-testid", `button-popup-directions-${lead.id}`);
      dirBtn.style.cssText = "display: flex; align-items: center; gap: 5px; margin-top: 6px; padding: 6px 12px; background: #0d9488; color: white; border-radius: 6px; border: none; font-size: 12px; font-weight: 600; cursor: pointer; width: 100%; justify-content: center;";
      dirBtn.textContent = "Get Directions";
      dirBtn.addEventListener("click", handleDirections);
      popupEl.appendChild(dirBtn);

      marker.bindPopup(popupEl, { maxWidth: 260 });
      marker.addTo(markersRef.current!);
    });
  }, [filteredMarinas]);

  if (locationError && !userLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
          <MapPin className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Location Required</h3>
        <p className="text-sm text-muted-foreground text-center mb-4 max-w-md">{locationError}</p>
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search address or city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-8 h-9 text-sm"
              data-testid="input-leads-map-address-search-error"
            />
          </div>
          <Button onClick={handleSearch} variant="outline" size="sm" disabled={searching || !searchQuery.trim()} data-testid="button-leads-map-search-error">
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
          </Button>
        </div>
        <Button onClick={requestLocation} variant="outline" data-testid="button-retry-location">
          <Locate className="mr-2 h-4 w-4" /> Try Again
        </Button>
      </div>
    );
  }

  if (locating && !userLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-sm text-muted-foreground">Getting your location...</p>
      </div>
    );
  }

  const handleListDirections = async (lead: NearbyLead, e: React.MouseEvent) => {
    e.stopPropagation();
    const addr = lead.marina_address || [lead.street_address, lead.city, lead.state].filter(Boolean).join(", ");
    let finalAddr = addr;
    if (!finalAddr) {
      try {
        const res = await fetch(`/api/leads/${lead.id}/geocode-address`, { method: "POST", credentials: "include" });
        if (res.ok) { const data = await res.json(); finalAddr = data.address; }
      } catch {}
    }
    const url = getDirectionsUrl(lead.marina_lat, lead.marina_lng, finalAddr || null, lead.company);
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="flex flex-col h-[calc(100vh-220px)]">
      <div className="flex items-center gap-2 px-1 pb-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search address or city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-8 h-8 text-xs bg-secondary/30 border-border/50"
            data-testid="input-leads-map-address-search"
          />
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleSearch} disabled={searching || !searchQuery.trim()} data-testid="button-leads-map-search">
          {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Go"}
        </Button>
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
          <Locate className="mr-1 h-3 w-3" /> Refresh
        </Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!loading && filteredMarinas.length > 0 && (
          <Badge variant="outline" className="text-xs">{filteredMarinas.length} marinas in view</Badge>
        )}
      </div>

      <div className="flex flex-1 gap-3 min-h-0">
        <div ref={mapRef} className="flex-1 rounded-xl border border-border/50 overflow-hidden z-0" data-testid="map-container" />

        <div className="w-72 lg:w-80 flex-shrink-0 overflow-y-auto space-y-1.5 pr-1">
          {loading && marinas.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
          ) : filteredMarinas.length === 0 ? (
            <div className="text-center py-8">
              <Anchor className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No marinas in view</p>
              <p className="text-xs text-muted-foreground mt-1">Zoom out or pan to find more</p>
            </div>
          ) : (
            filteredMarinas.map((lead) => (
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
                    mapInstanceRef.current.setView([lead.marina_lat, lead.marina_lng], 15, { animate: true });
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
                  <button
                    onClick={(e) => handleListDirections(lead, e)}
                    className="shrink-0 p-1.5 rounded-md bg-primary/10 transition-colors hover-elevate"
                    data-testid={`directions-${lead.id}`}
                    title="Get Directions"
                  >
                    <Navigation className="h-4 w-4 text-primary" />
                  </button>
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