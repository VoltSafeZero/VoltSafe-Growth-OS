import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Locate, Loader2, Search } from "lucide-react";
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
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  const requestLocation = useCallback(() => {
    setLocating(true);
    setLocationError(null);
    if (!navigator.geolocation) {
      const saved = getSavedLocation();
      if (saved) {
        setUserLocation({ lat: saved.lat, lng: saved.lng });
        setLocating(false);
      } else {
        setLocationError("Geolocation not supported");
        setLocating(false);
      }
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        saveLocation(loc.lat, loc.lng, 11);
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
      if (!res.ok) {
        setSearching(false);
        return;
      }
      const data = await res.json();
      const loc = { lat: data.lat, lng: data.lng };
      setUserLocation(loc);
      saveLocation(loc.lat, loc.lng, 12);
      setLocationError(null);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([loc.lat, loc.lng], 12, { animate: true });
      }
    } catch {}
    setSearching(false);
  };

  const { data: nearbyLeads, isLoading, isError } = useQuery<NearbyLead[]>({
    queryKey: ["/api/leads/nearby", userLocation?.lat, userLocation?.lng, "50"],
    queryFn: async () => {
      if (!userLocation) return [];
      const res = await fetch(
        `/api/leads/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=50&limit=200`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch nearby leads");
      return res.json();
    },
    enabled: !!userLocation,
    retry: 1,
  });

  useEffect(() => {
    if (!mapRef.current || !userLocation) return;

    if (!mapInstanceRef.current) {
      const saved = getSavedLocation();
      const zoom = saved?.zoom || 11;
      mapInstanceRef.current = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([userLocation.lat, userLocation.lng], zoom);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);

      markersRef.current = L.layerGroup().addTo(mapInstanceRef.current);

      mapInstanceRef.current.on("moveend", () => {
        if (mapInstanceRef.current) {
          const c = mapInstanceRef.current.getCenter();
          saveLocation(c.lat, c.lng, mapInstanceRef.current.getZoom());
        }
      });
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
      userMarkerRef.current.bindPopup("<b>You are here</b>");
    }
  }, [userLocation]);

  useEffect(() => {
    return () => {
      if (markersRef.current) {
        markersRef.current.clearLayers();
        markersRef.current = null;
      }
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !markersRef.current || !userLocation || !nearbyLeads) return;
    markersRef.current.clearLayers();

    if (!nearbyLeads.length) return;

    const bounds = L.latLngBounds([[userLocation.lat, userLocation.lng]]);

    nearbyLeads.forEach((lead) => {
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
            const res = await fetch(`/api/leads/${lead.id}/geocode-address`, {
              method: "POST",
              credentials: "include",
            });
            if (res.ok) {
              const data = await res.json();
              finalAddr = data.address;
            }
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
      bounds.extend([lead.marina_lat, lead.marina_lng]);
    });

    if (nearbyLeads.length > 0) {
      mapInstanceRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
    }
  }, [nearbyLeads, userLocation]);

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
              {nearbyLeads && nearbyLeads.length > 0
                ? `${nearbyLeads.length} marinas within 50km — hover for name, click for directions`
                : "Marinas within 50km of your location"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {nearbyLeads && nearbyLeads.length > 0 && (
              <Badge variant="outline" className="text-xs">{nearbyLeads.length}</Badge>
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
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search address or city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-8 h-8 text-xs bg-secondary/30 border-border/50"
              data-testid="input-map-address-search"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            data-testid="button-map-search"
          >
            {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Go"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {locationError && !userLocation ? (
          <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-border/30 bg-muted/5">
            <MapPin className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium mb-1">Location Required</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs mb-3">{locationError}</p>
            <Button onClick={requestLocation} variant="outline" size="sm" data-testid="button-dashboard-retry-location">
              <Locate className="mr-1.5 h-3.5 w-3.5" /> Enable Location
            </Button>
          </div>
        ) : locating && !userLocation ? (
          <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-border/30 bg-muted/5">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <p className="text-sm text-muted-foreground">Finding your location...</p>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-border/30 bg-muted/5">
            <MapPin className="h-10 w-10 text-destructive/60 mb-3" />
            <p className="text-sm font-medium mb-1">Failed to load marinas</p>
            <p className="text-xs text-muted-foreground mb-3">Could not fetch nearby marina data.</p>
          </div>
        ) : (
          <div
            ref={mapRef}
            className="w-full rounded-xl border border-border/30 overflow-hidden z-0 h-[280px] sm:h-[360px] md:h-[420px]"
            data-testid="dashboard-map-container"
          />
        )}
      </CardContent>
    </Card>
  );
}