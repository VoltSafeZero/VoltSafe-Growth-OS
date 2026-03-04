import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Locate, Loader2, Navigation, Anchor } from "lucide-react";
import AddressAutocomplete from "@/components/address-autocomplete";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type NearbyLead = {
  id: number;
  company: string;
  contact_phone: string | null;
  status: string;
  city: string | null;
  state: string | null;
  slips: string | null;
  street_address: string | null;
  marina_address: string | null;
  marina_lat: number;
  marina_lng: number;
  distance_km: number;
  deal_amount: number | null;
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
  meeting_scheduled: "Meeting",
  qualified: "Qualified",
  proposal_sent: "Proposal",
  negotiation: "Negotiation",
  converted: "Won",
  lost: "Lost",
};

const STORAGE_KEY = "voltsafe-map-last-location";
const DEFAULT_LOCATION = { lat: 43.55, lng: -79.58, zoom: 13 };

function getSavedLocation(): { lat: number; lng: number; zoom: number } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_LOCATION;
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

export default function DashboardMap() {
  const initialLoc = getSavedLocation();
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({ lat: initialLoc.lat, lng: initialLoc.lng });
  const [locating, setLocating] = useState(false);
  const [marinas, setMarinas] = useState<NearbyLead[]>([]);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initialZoomRef = useRef(initialLoc.zoom);

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
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMapCenter(loc);
        saveLocation(loc.lat, loc.lng, 13);
        setLocating(false);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([loc.lat, loc.lng], 13, { animate: true });
          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng([loc.lat, loc.lng]);
          } else {
            userMarkerRef.current = L.marker([loc.lat, loc.lng], {
              icon: createUserIcon(),
              zIndexOffset: 1000,
            }).addTo(mapInstanceRef.current);
            userMarkerRef.current.bindPopup("<b>You are here</b>");
          }
        }
      },
      () => { setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const handleAddressSelect = (lat: number, lng: number, _displayName: string) => {
    setMapCenter({ lat, lng });
    saveLocation(lat, lng, 13);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], 13, { animate: true });
    }
  };

  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([mapCenter.lat, mapCenter.lng], initialZoomRef.current);

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
      fetchMarinas(mapCenter.lat, mapCenter.lng, radius);
    }
  }, [mapCenter, debouncedFetchFromBounds, fetchMarinas]);

  useEffect(() => {
    return () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      if (abortRef.current) abortRef.current.abort();
      if (markersRef.current) { markersRef.current.clearLayers(); markersRef.current = null; }
      if (userMarkerRef.current) { userMarkerRef.current.remove(); userMarkerRef.current = null; }
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !markersRef.current) return;
    markersRef.current.clearLayers();

    if (!marinas.length) return;

    marinas.forEach((lead) => {
      const marker = L.marker([lead.marina_lat, lead.marina_lng], {
        icon: createMarkerIcon(lead.status),
      });

      marker.bindTooltip(lead.company, {
        direction: "top",
        offset: [0, -8],
        className: "marina-tooltip",
      });

      const addr = lead.marina_address || lead.street_address || [lead.city, lead.state].filter(Boolean).join(", ");

      const handleClick = async () => {
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
      popupEl.style.cssText = "min-width: 170px; font-family: Inter, sans-serif;";

      const titleEl = document.createElement("div");
      titleEl.style.cssText = "font-weight: 600; font-size: 13px; margin-bottom: 3px;";
      titleEl.textContent = lead.company;
      popupEl.appendChild(titleEl);

      const distEl = document.createElement("div");
      distEl.style.cssText = "font-size: 11px; color: #64748b; margin-bottom: 4px;";
      distEl.textContent = `${formatDistance(lead.distance_km)} away`;
      popupEl.appendChild(distEl);

      if (addr) {
        const addrEl = document.createElement("div");
        addrEl.style.cssText = "font-size: 11px; color: #475569; margin-bottom: 3px;";
        addrEl.textContent = addr;
        popupEl.appendChild(addrEl);
      }

      if (lead.slips && lead.slips !== "-") {
        const slipsEl = document.createElement("div");
        slipsEl.style.cssText = "font-size: 11px; color: #475569; margin-bottom: 3px;";
        slipsEl.textContent = `${lead.slips} slips`;
        popupEl.appendChild(slipsEl);
      }

      const dirBtn = document.createElement("button");
      dirBtn.type = "button";
      dirBtn.setAttribute("data-testid", `button-directions-${lead.id}`);
      dirBtn.style.cssText = "display: flex; align-items: center; gap: 5px; margin-top: 6px; padding: 6px 12px; background: #0d9488; color: white; border-radius: 6px; border: none; font-size: 12px; font-weight: 600; cursor: pointer; width: 100%; justify-content: center;";
      dirBtn.textContent = "Get Directions";
      dirBtn.addEventListener("click", handleClick);
      popupEl.appendChild(dirBtn);

      marker.bindPopup(popupEl, { maxWidth: 240 });
      marker.addTo(markersRef.current!);
    });
  }, [marinas]);

  const closest5 = marinas.slice(0, 5);

  const handleListDirections = async (lead: NearbyLead) => {
    const addr = lead.marina_address || lead.street_address || [lead.city, lead.state].filter(Boolean).join(", ");
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
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-dashboard-map">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Nearby Marinas
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {marinas.length > 0
                ? `${marinas.length} marinas in view — hover for name, click for directions`
                : "Search an address or pan the map to discover marinas"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {marinas.length > 0 && (
              <Badge variant="outline" className="text-xs">{marinas.length}</Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={requestLocation}
              disabled={locating}
              data-testid="button-dashboard-refresh-location"
            >
              {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Locate className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        <AddressAutocomplete
          onSelect={handleAddressSelect}
          className="mt-2"
          testId="input-map-address-search"
        />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <div
              ref={mapRef}
              className="w-full rounded-xl border border-border/30 overflow-hidden z-0 h-[280px] sm:h-[360px] md:h-[420px]"
              data-testid="dashboard-map-container"
            />
          </div>
          <div className="w-48 sm:w-56 flex-shrink-0 space-y-1.5 overflow-y-auto max-h-[280px] sm:max-h-[360px] md:max-h-[420px]" data-testid="dashboard-closest-list">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">Closest Marinas</p>
            {closest5.length === 0 && !loading && (
              <div className="text-center py-4">
                <Anchor className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
                <p className="text-[11px] text-muted-foreground">No marinas in view</p>
              </div>
            )}
            {closest5.map((lead) => (
              <div
                key={lead.id}
                className="p-2 rounded-lg border border-border/30 bg-card/50 cursor-pointer transition-all hover:border-primary/30"
                onClick={() => {
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.setView([lead.marina_lat, lead.marina_lng], 15, { animate: true });
                  }
                }}
                data-testid={`dashboard-closest-${lead.id}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{lead.company}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{formatDistance(lead.distance_km)}</span>
                      <span
                        className="w-2 h-2 rounded-full inline-block flex-shrink-0"
                        style={{ background: STAGE_COLORS[lead.status] || "#64748b" }}
                        title={STAGE_LABELS[lead.status] || lead.status}
                      />
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleListDirections(lead); }}
                    className="shrink-0 p-1 rounded-md bg-primary/10 transition-colors hover-elevate"
                    data-testid={`dashboard-directions-${lead.id}`}
                    title="Get Directions"
                  >
                    <Navigation className="h-3 w-3 text-primary" />
                  </button>
                </div>
                {(lead.city || lead.state) && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {[lead.city, lead.state].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}