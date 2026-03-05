import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
      width: 44px; height: 44px; border-radius: 50%;
      background: radial-gradient(circle, #4ade80 0%, #22c55e 100%);
      border: 4px solid white;
      box-shadow: 0 0 0 6px rgba(34,197,94,0.3), 0 3px 10px rgba(0,0,0,0.4);
    "><div style="
      position: absolute; inset: -12px; border-radius: 50%;
      border: 2px solid rgba(34,197,94,0.4);
      animation: user-pulse 2s ease-out infinite;
    "></div></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
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

  const centerOnCoords = useCallback((lat: number, lng: number) => {
    saveLocation(lat, lng, 14);
    const map = mapInstanceRef.current;
    if (map) {
      map.invalidateSize();
      map.setView([lat, lng], 14, { animate: false });
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng([lat, lng]);
      } else {
        userMarkerRef.current = L.marker([lat, lng], {
          icon: createUserIcon(),
          zIndexOffset: 1000,
        }).addTo(map);
        userMarkerRef.current.bindPopup("<b>You are here</b>");
      }
    }
  }, []);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    let done = false;
    const finish = (lat?: number, lng?: number) => {
      if (done) return;
      done = true;
      setLocating(false);
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(fallbackTimer);
      if (lat !== undefined && lng !== undefined) {
        centerOnCoords(lat, lng);
      }
    };
    const watchId = navigator.geolocation.watchPosition(
      (pos) => finish(pos.coords.latitude, pos.coords.longitude),
      () => finish(),
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 }
    );
    const fallbackTimer = setTimeout(() => finish(), 6000);
  }, [centerOnCoords]);

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
        imperial: false,
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
            {marinas.length > 0 && (
              <Badge variant="outline" className="text-xs">{marinas.length}</Badge>
            )}
          </div>
        </div>
        <AddressAutocomplete
          onSelect={handleAddressSelect}
          className="mt-2"
          testId="input-map-address-search"
        />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="relative">
          <div
            ref={mapRef}
            className="w-full rounded-xl border border-border/30 overflow-hidden z-0 h-[300px] sm:h-[380px] md:h-[440px]"
            data-testid="dashboard-map-container"
          />
          <button
            onClick={requestLocation}
            className="absolute top-2 right-2 z-[1000] w-9 h-9 flex items-center justify-center rounded-lg bg-[hsl(222,47%,14%)] border border-[hsl(217,33%,25%)] text-[hsl(210,40%,90%)] shadow-lg cursor-pointer"
            title="Center on my location"
            data-testid="button-map-locate"
          >
            {locating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Locate className="h-4 w-4" />
            )}
          </button>
        </div>
        {closest5.length > 0 && (
          <div className="mt-3 space-y-1" data-testid="dashboard-closest-list">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1.5">Closest Marinas</p>
            {closest5.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-colors hover:bg-muted/40"
                onClick={() => {
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.setView([lead.marina_lat, lead.marina_lng], 15, { animate: true });
                  }
                }}
                data-testid={`dashboard-closest-${lead.id}`}
              >
                <p className="text-xs font-medium truncate min-w-0 flex-1">{lead.company}</p>
                <span className="text-[11px] text-muted-foreground ml-3 flex-shrink-0">{formatDistance(lead.distance_km)}</span>
              </div>
            ))}
          </div>
        )}
        {closest5.length === 0 && !loading && marinas.length === 0 && (
          <div className="text-center py-3 mt-2">
            <Anchor className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
            <p className="text-[11px] text-muted-foreground">No marinas in view</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}