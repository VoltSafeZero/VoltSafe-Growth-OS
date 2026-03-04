import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Locate, Loader2 } from "lucide-react";
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

function getDirectionsUrl(lat: number, lng: number, name: string) {
  const encoded = encodeURIComponent(name);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) {
    return `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encoded}`;
  }
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
      width: 24px; height: 24px; border-radius: 50%;
      background: ${color}; border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

function createUserIcon() {
  return L.divIcon({
    className: "user-marker",
    html: `<div style="
      width: 18px; height: 18px; border-radius: 50%;
      background: #2dd4bf; border: 3px solid white;
      box-shadow: 0 0 0 3px rgba(45,212,191,0.3), 0 2px 8px rgba(0,0,0,0.4);
      animation: pulse-ring 2s ease-out infinite;
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export default function DashboardMap() {
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  const requestLocation = useCallback(() => {
    setLocating(true);
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("Geolocation not supported");
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
          err.code === 1 ? "Location access denied. Enable location in browser settings."
          : "Could not get your location. Please try again."
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

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
      mapInstanceRef.current = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([userLocation.lat, userLocation.lng], 11);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);

      markersRef.current = L.layerGroup().addTo(mapInstanceRef.current);
    } else {
      mapInstanceRef.current.setView([userLocation.lat, userLocation.lng], 11);
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

      const addr = lead.marina_address || lead.street_address || [lead.city, lead.state].filter(Boolean).join(", ");
      const directionsUrl = getDirectionsUrl(lead.marina_lat, lead.marina_lng, lead.company);

      const popupEl = document.createElement("div");
      popupEl.style.cssText = "min-width: 180px; font-family: Inter, sans-serif;";

      const titleEl = document.createElement("div");
      titleEl.style.cssText = "font-weight: 600; font-size: 14px; margin-bottom: 4px;";
      titleEl.textContent = lead.company;
      popupEl.appendChild(titleEl);

      const distEl = document.createElement("div");
      distEl.style.cssText = "font-size: 12px; color: #94a3b8; margin-bottom: 6px;";
      distEl.textContent = `${formatDistance(lead.distance_km)} away`;
      popupEl.appendChild(distEl);

      if (addr) {
        const addrEl = document.createElement("div");
        addrEl.style.cssText = "font-size: 12px; color: #cbd5e1; margin-bottom: 4px;";
        addrEl.textContent = addr;
        popupEl.appendChild(addrEl);
      }

      if (lead.slips && lead.slips !== "-") {
        const slipsEl = document.createElement("div");
        slipsEl.style.cssText = "font-size: 12px; color: #cbd5e1; margin-bottom: 4px;";
        slipsEl.textContent = `${lead.slips} slips`;
        popupEl.appendChild(slipsEl);
      }

      if (lead.contact_phone) {
        const phoneEl = document.createElement("div");
        phoneEl.style.cssText = "font-size: 12px; color: #cbd5e1; margin-bottom: 4px;";
        phoneEl.textContent = lead.contact_phone;
        popupEl.appendChild(phoneEl);
      }

      const dirBtn = document.createElement("a");
      dirBtn.href = directionsUrl;
      dirBtn.target = "_blank";
      dirBtn.rel = "noopener";
      dirBtn.style.cssText = "display: flex; align-items: center; gap: 6px; margin-top: 8px; padding: 8px 14px; background: #2dd4bf; color: #0f172a; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600; justify-content: center;";
      dirBtn.textContent = "Drive Here";
      popupEl.appendChild(dirBtn);

      marker.bindPopup(popupEl, { maxWidth: 260 });
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
                ? `${nearbyLeads.length} marinas within 50km — tap a marker for directions`
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
      </CardHeader>
      <CardContent className="pt-0">
        {locationError ? (
          <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-border/30 bg-muted/5">
            <MapPin className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium mb-1">Location Required</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs mb-3">{locationError}</p>
            <Button onClick={requestLocation} variant="outline" size="sm" data-testid="button-dashboard-retry-location">
              <Locate className="mr-1.5 h-3.5 w-3.5" /> Enable Location
            </Button>
          </div>
        ) : locating || !userLocation ? (
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
            className="w-full rounded-xl border border-border/30 overflow-hidden z-0"
            style={{ height: "420px" }}
            data-testid="dashboard-map-container"
          />
        )}
      </CardContent>
    </Card>
  );
}