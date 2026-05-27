import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Navigation, MapPin, Anchor,
  Locate, Loader2, ArrowUpDown
} from "lucide-react";
import AddressAutocomplete from "@/components/address-autocomplete";
import { MarinasDayPlannerDialog } from "@/components/marinas-day-planner-dialog";
import { Sparkles, SlidersHorizontal, List, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
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
  // Gray — fresh / unworked
  new: "#9ca3af",
  // Yellow — early outreach
  contacted: "#eab308",
  meeting_scheduled: "#eab308",
  // Blue — active opportunity
  qualified: "#3b82f6",
  proposal_sent: "#3b82f6",
  negotiation: "#3b82f6",
  // Green — won
  converted: "#22c55e",
  // Red — lost
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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const RADIUS_OPTIONS = [
  { value: "any", label: "Any distance" },
  { value: "5", label: "Within 5 km" },
  { value: "10", label: "Within 10 km" },
  { value: "25", label: "Within 25 km" },
  { value: "50", label: "Within 50 km" },
  { value: "100", label: "Within 100 km" },
  { value: "250", label: "Within 250 km" },
];

const SLIPS_OPTIONS = [
  { value: "any", label: "Any slips" },
  { value: "1", label: "1+ slips" },
  { value: "25", label: "25+ slips" },
  { value: "50", label: "50+ slips" },
  { value: "100", label: "100+ slips" },
  { value: "200", label: "200+ slips" },
  { value: "500", label: "500+ slips" },
  { value: "1000", label: "1000+ slips" },
];

const SORT_OPTIONS = [
  { value: "distance", label: "Sort: Distance" },
  { value: "name", label: "Sort: Name (A→Z)" },
  { value: "slips_desc", label: "Sort: Slips (high→low)" },
  { value: "slips_asc", label: "Sort: Slips (low→high)" },
  { value: "deal_desc", label: "Sort: Deal $ (high→low)" },
  { value: "stage", label: "Sort: Stage" },
];

function parseSlipsCount(s: string | null): number {
  if (!s) return 0;
  const m = String(s).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function boundsToRadius(map: L.Map): number {
  const bounds = map.getBounds();
  const center = bounds.getCenter();
  const ne = bounds.getNorthEast();
  const radiusKm = center.distanceTo(ne) / 1000;
  return Math.ceil(Math.min(radiusKm, 500));
}

function createMarkerIcon(status: string, selected = false) {
  const color = STAGE_COLORS[status] || "#64748b";
  if (selected) {
    return L.divIcon({
      className: "custom-marker selected",
      html: `<div style="
        position: relative; width: 22px; height: 22px;
      ">
        <div style="
          position: absolute; inset: 0; border-radius: 50%;
          background: ${color}; border: 3px solid #fbbf24;
          box-shadow: 0 0 0 2px rgba(251,191,36,0.35), 0 2px 8px rgba(0,0,0,0.4);
        "></div>
        <div style="
          position: absolute; top: -6px; right: -6px;
          width: 14px; height: 14px; border-radius: 50%;
          background: #fbbf24; color: #111827;
          font-size: 10px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          border: 2px solid white;
        ">✓</div>
      </div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -12],
    });
  }
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
      width: 11px; height: 11px; border-radius: 50%;
      background: radial-gradient(circle, #4ade80 0%, #22c55e 100%);
      border: 1.5px solid white;
      box-shadow: 0 0 0 2px rgba(34,197,94,0.3), 0 1px 4px rgba(0,0,0,0.4);
    "><div style="
      position: absolute; inset: -4px; border-radius: 50%;
      border: 1px solid rgba(34,197,94,0.4);
      animation: user-pulse 2s ease-out infinite;
    "></div></div>`,
    iconSize: [11, 11],
    iconAnchor: [6, 6],
  });
}

export default function NearbyMarinasMap({ onSelectLead }: { onSelectLead?: (leadId: number) => void }) {
  const initialLoc = getSavedLocation();
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({ lat: initialLoc.lat, lng: initialLoc.lng });
  const [locating, setLocating] = useState(false);
  const [selectedLead, setSelectedLead] = useState<NearbyLead | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [stageFilter, setStageFilter] = useState("all");
  const [radiusFilter, setRadiusFilter] = useState<string>("any");
  const [slipsFilter, setSlipsFilter] = useState<string>("any");
  const [sortBy, setSortBy] = useState<string>("distance");
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [marinas, setMarinas] = useState<NearbyLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
  const [preselectedForPlanner, setPreselectedForPlanner] = useState<NearbyLead[] | null>(null);
  const [pendingGeoCount, setPendingGeoCount] = useState<number>(0);
  const [geocodingActive, setGeocodingActive] = useState(false);
  const geocodeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const radiusCircleRef = useRef<L.Circle | null>(null);
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

  const centerOnCoords = useCallback((lat: number, lng: number, isUserGps = false) => {
    saveLocation(lat, lng, 14);
    if (isUserGps) setUserLocation({ lat, lng });
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
        userMarkerRef.current.bindPopup("<b>Your Location</b>");
      }
    }
  }, []);

  const requestLocation = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!navigator.geolocation) {
      const saved = getSavedLocation();
      centerOnCoords(saved.lat, saved.lng);
      return;
    }
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
      } else {
        const saved = getSavedLocation();
        map.invalidateSize();
        map.setView([saved.lat, saved.lng], 14, { animate: false });
      }
    };
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        finish(pos.coords.latitude, pos.coords.longitude);
      },
      () => finish(),
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 5000 }
    );
    const fallbackTimer = setTimeout(() => finish(), 4000);
  }, [centerOnCoords]);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  // ── Geocode missing leads on map mount ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/leads/geocode-missing-count", { credentials: "include" });
        if (!r.ok || cancelled) return;
        const { count } = await r.json();
        if (count > 0) {
          setPendingGeoCount(count);
          setGeocodingActive(true);
          // Fire-and-forget batch — server processes 1/s in background
          fetch("/api/leads/geocode-batch", { method: "POST", credentials: "include" }).catch(() => {});
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // While geocoding is active, refetch the map every 10 s and check the count
  useEffect(() => {
    if (!geocodingActive) return;
    geocodeIntervalRef.current = setInterval(async () => {
      debouncedFetchFromBounds();
      try {
        const r = await fetch("/api/leads/geocode-missing-count", { credentials: "include" });
        if (!r.ok) return;
        const { count } = await r.json();
        setPendingGeoCount(count);
        if (count === 0) {
          setGeocodingActive(false);
          if (geocodeIntervalRef.current) clearInterval(geocodeIntervalRef.current);
        } else {
          // Re-trigger batch only if one isn't already running server-side
          fetch("/api/leads/geocode-batch", { method: "POST", credentials: "include" })
            .then(r => r.json())
            .then(d => { if (d.started) console.log(`[geocode] re-triggered batch for ${d.count} remaining leads`); })
            .catch(() => {});
        }
      } catch { /* silent */ }
    }, 10000);
    return () => { if (geocodeIntervalRef.current) clearInterval(geocodeIntervalRef.current); };
  }, [geocodingActive, debouncedFetchFromBounds]);

  const handleAddressSelect = (lat: number, lng: number, _displayName: string) => {
    setMapCenter({ lat, lng });
    saveLocation(lat, lng, 13);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], 13, { animate: true });
    }
  };

  const radiusKm = radiusFilter === "any" ? null : Number(radiusFilter);
  const minSlips = slipsFilter === "any" ? 0 : Number(slipsFilter);
  const filteredMarinas = marinas
    .filter(l => {
      if (stageFilter !== "all" && l.status !== stageFilter) return false;
      if (radiusKm != null && userLocation) {
        const d = haversineKm(userLocation.lat, userLocation.lng, l.marina_lat, l.marina_lng);
        if (d > radiusKm) return false;
      }
      if (minSlips > 0 && parseSlipsCount(l.slips) < minSlips) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "name":
          return (a.company || "").localeCompare(b.company || "");
        case "slips_desc":
          return parseSlipsCount(b.slips) - parseSlipsCount(a.slips);
        case "slips_asc":
          return parseSlipsCount(a.slips) - parseSlipsCount(b.slips);
        case "deal_desc":
          return (Number(b.deal_amount) || 0) - (Number(a.deal_amount) || 0);
        case "stage":
          return (a.status || "").localeCompare(b.status || "");
        case "distance":
        default:
          return (a.distance_km || 0) - (b.distance_km || 0);
      }
    });

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
    const map = mapInstanceRef.current;
    if (!map) return;
    if (radiusCircleRef.current) {
      map.removeLayer(radiusCircleRef.current);
      radiusCircleRef.current = null;
    }
    if (radiusKm != null && userLocation) {
      const circle = L.circle([userLocation.lat, userLocation.lng], {
        radius: radiusKm * 1000,
        color: "#22c55e",
        weight: 1.5,
        opacity: 0.7,
        fillColor: "#22c55e",
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(map);
      radiusCircleRef.current = circle;
      try { map.fitBounds(circle.getBounds(), { padding: [24, 24], animate: true }); } catch {}
    }
  }, [radiusKm, userLocation]);

  useEffect(() => {
    if (!mapInstanceRef.current || !markersRef.current) return;
    markersRef.current.clearLayers();

    if (!filteredMarinas.length) return;

    filteredMarinas.forEach((lead) => {
      const isSelected = selectedLeadIds.has(lead.id);
      const marker = L.marker([lead.marina_lat, lead.marina_lng], {
        icon: createMarkerIcon(lead.status, isSelected),
      });

      marker.bindTooltip(lead.company, {
        direction: "top",
        offset: [0, -8],
        className: "marina-tooltip",
      });

      // In selection mode, taps toggle selection instead of opening the popup.
      if (selectionMode) {
        marker.on("click", (e) => {
          (e as any).originalEvent?.stopPropagation?.();
          setSelectedLeadIds(prev => {
            const next = new Set(prev);
            if (next.has(lead.id)) next.delete(lead.id); else next.add(lead.id);
            return next;
          });
        });
        marker.addTo(markersRef.current!);
        return;
      }

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

      // Marina name → opens the lead detail page (in-app navigation, no full reload)
      const titleEl = document.createElement("a");
      titleEl.href = `/opportunities/${lead.id}`;
      titleEl.setAttribute("data-testid", `link-popup-marina-${lead.id}`);
      titleEl.style.cssText = "display: block; font-weight: 600; font-size: 13px; margin-bottom: 3px; color: #0d9488; text-decoration: none; cursor: pointer;";
      titleEl.textContent = lead.company;
      titleEl.addEventListener("mouseenter", () => { titleEl.style.textDecoration = "underline"; });
      titleEl.addEventListener("mouseleave", () => { titleEl.style.textDecoration = "none"; });
      titleEl.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        marker.closePopup();
        navigate(`/opportunities/${lead.id}`);
      });
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
  }, [filteredMarinas, selectionMode, selectedLeadIds]);

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

  const renderListItem = (lead: NearbyLead) => (
    <div
      key={lead.id}
      className={`group p-3 rounded-xl border cursor-pointer transition-all ${
        selectedLead?.id === lead.id
          ? "border-primary/60 bg-gradient-to-br from-primary/10 to-primary/[0.02] shadow-sm shadow-primary/10"
          : "border-border/40 bg-card/40 hover:border-primary/30 hover:bg-card/70"
      }`}
      onClick={() => {
        setSelectedLead(lead);
        setMobileListOpen(false);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([lead.marina_lat, lead.marina_lng], 15, { animate: true });
        }
      }}
      data-testid={`nearby-lead-${lead.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate tracking-tight">{lead.company}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[11px] text-muted-foreground">{formatMiles(lead.distance_km)} away</span>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 font-medium"
              style={{ borderColor: STAGE_COLORS[lead.status] + "60", color: STAGE_COLORS[lead.status], backgroundColor: STAGE_COLORS[lead.status] + "10" }}
            >
              {STAGE_LABELS[lead.status] || lead.status}
            </Badge>
          </div>
        </div>
        <button
          onClick={(e) => handleListDirections(lead, e)}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-primary/10 text-primary transition-all hover:bg-primary/20 hover:scale-105 active:scale-95"
          data-testid={`directions-${lead.id}`}
          title="Get Directions"
        >
          <Navigation className="h-3.5 w-3.5" />
        </button>
      </div>
      {(lead.city || lead.state) && (
        <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1 truncate">
          <MapPin className="h-3 w-3 shrink-0" />
          {[lead.city, lead.state].filter(Boolean).join(", ")}
        </p>
      )}
      <div className="flex items-center gap-3 mt-1 flex-wrap">
        {lead.slips && lead.slips !== "-" && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Anchor className="h-3 w-3" /> {lead.slips} slips
          </span>
        )}
        {lead.deal_amount != null && lead.deal_amount > 0 && (
          <span className="text-[11px] text-emerald-400 font-semibold">
            ${Number(lead.deal_amount).toLocaleString()}
            {lead.deal_probability != null && <span className="text-muted-foreground font-normal ml-0.5">· {lead.deal_probability}%</span>}
          </span>
        )}
      </div>
    </div>
  );

  const filterControls = (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">Search</p>
        <AddressAutocomplete onSelect={handleAddressSelect} className="w-full" testId="input-leads-map-address-search" />
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">Stage</p>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-full h-9 text-sm" data-testid="select-stage-filter-mobile">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {Object.entries(STAGE_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">Radius</p>
        <Select value={radiusFilter} onValueChange={(v) => {
          setRadiusFilter(v);
          if (v !== "any" && !userLocation) requestLocation();
        }}>
          <SelectTrigger className="w-full h-9 text-sm" data-testid="select-radius-filter-mobile">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RADIUS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">Min slips</p>
        <Select value={slipsFilter} onValueChange={setSlipsFilter}>
          <SelectTrigger className="w-full h-9 text-sm" data-testid="select-slips-filter-mobile">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SLIPS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">Sort by</p>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-full h-9 text-sm" data-testid="select-sort-mobile">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <div className="relative flex flex-col h-[calc(100dvh-150px)] sm:h-[calc(100vh-220px)] -mx-3 sm:mx-0" data-testid="nearby-marinas-map">
      {/* Desktop top toolbar */}
      <div className="hidden sm:flex items-center gap-2 px-1 pb-3 flex-wrap">
        <AddressAutocomplete
          onSelect={handleAddressSelect}
          className="flex-1 min-w-[180px] max-w-xs"
          testId="input-leads-map-address-search-desktop"
        />
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
        <Select value={radiusFilter} onValueChange={(v) => {
          setRadiusFilter(v);
          if (v !== "any" && !userLocation) requestLocation();
        }}>
          <SelectTrigger className="w-[150px] h-8 text-xs" data-testid="select-radius-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RADIUS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={slipsFilter} onValueChange={setSlipsFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs" data-testid="select-slips-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SLIPS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="select-sort">
            <ArrowUpDown className="h-3 w-3 mr-1 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={requestLocation} disabled={locating} data-testid="button-refresh-location">
          {locating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Locate className="mr-1 h-3 w-3" />}
          My Location
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/10"
          onClick={() => {
            if (!userLocation) requestLocation();
            setSelectedLeadIds(new Set());
            setSelectionMode(true);
          }}
          data-testid="button-plan-day"
        >
          <Sparkles className="h-3 w-3" /> Plan My Travel Day
        </Button>
        {radiusKm != null && !userLocation && !locating && (
          <span className="text-xs text-amber-400">Tap "My Location" to enable radius</span>
        )}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!loading && filteredMarinas.length > 0 && (
          <Badge variant="outline" className="text-xs">{filteredMarinas.length} marinas in view</Badge>
        )}
        {geocodingActive && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400/90 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-0.5" data-testid="geocoding-status">
            <Loader2 className="h-3 w-3 animate-spin" />
            Geocoding {pendingGeoCount} lead{pendingGeoCount !== 1 ? "s" : ""} — pins will appear shortly
          </span>
        )}
      </div>

      <div className="flex flex-1 sm:gap-3 min-h-0 relative">
        {/* Map */}
        <div className="flex-1 relative min-w-0">
          <div
            ref={mapRef}
            className="absolute inset-0 sm:rounded-2xl sm:border sm:border-border/50 overflow-hidden z-0 sm:shadow-xl sm:shadow-black/20"
            data-testid="map-container"
          />

          {/* Mobile glass toolbar overlay */}
          <div className="sm:hidden absolute top-3 left-3 right-3 z-[500] flex items-center gap-2">
            <div className="flex-1 min-w-0 backdrop-blur-xl bg-background/75 border border-white/10 rounded-2xl shadow-lg shadow-black/30 px-1 py-1">
              <AddressAutocomplete onSelect={handleAddressSelect} className="w-full" testId="input-leads-map-address-search" />
            </div>
            <button
              onClick={() => setFiltersOpen(true)}
              className="relative w-11 h-11 flex items-center justify-center rounded-2xl backdrop-blur-xl bg-background/75 border border-white/10 shadow-lg shadow-black/30 active:scale-95 transition"
              data-testid="button-mobile-filters"
              aria-label="Filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {(stageFilter !== "all" || radiusFilter !== "any" || slipsFilter !== "any" || sortBy !== "distance") && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />
              )}
            </button>
          </div>

          {/* Right-side stacked floating buttons (both mobile and desktop) */}
          <div className="absolute top-20 sm:top-3 right-3 z-[500] flex flex-col gap-2">
            <button
              onClick={requestLocation}
              className="w-11 h-11 sm:w-9 sm:h-9 flex items-center justify-center rounded-2xl sm:rounded-xl backdrop-blur-xl bg-background/85 border border-white/10 text-foreground shadow-lg shadow-black/30 active:scale-95 transition"
              title="Center on my location"
              data-testid="button-map-locate-leads"
            >
              {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Locate className="h-4 w-4" />}
            </button>
          </div>

          {/* Bottom-right floating Plan my day (mobile only — desktop has it in toolbar) */}
          {!selectionMode && (
            <button
              onClick={() => {
                if (!userLocation) requestLocation();
                setSelectedLeadIds(new Set());
                setSelectionMode(true);
              }}
              className="sm:hidden absolute bottom-4 right-3 z-[500] flex items-center gap-1.5 px-4 h-11 rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground font-medium text-sm shadow-xl shadow-primary/30 active:scale-95 transition"
              data-testid="button-plan-day-mobile"
            >
              <Sparkles className="h-4 w-4" /> Plan My Travel Day
            </button>
          )}

          {/* Selection mode: top banner + bottom action bar */}
          {selectionMode && (
            <>
              <div className="absolute top-16 sm:top-3 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[600] backdrop-blur-xl bg-primary/95 text-primary-foreground rounded-2xl px-4 py-2.5 shadow-xl flex items-center gap-2 max-w-md" data-testid="banner-selection-mode">
                <Sparkles className="h-4 w-4 flex-shrink-0" />
                <p className="text-xs sm:text-sm font-medium flex-1 truncate">
                  Tap marinas on the map to add them to your route
                </p>
              </div>
              <div className="absolute bottom-4 left-3 right-3 z-[600] flex items-center gap-2 backdrop-blur-xl bg-background/95 border border-primary/30 rounded-2xl px-3 py-2.5 shadow-2xl">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" data-testid="text-selection-count">
                    {selectedLeadIds.size} {selectedLeadIds.size === 1 ? "marina" : "marinas"} selected
                  </p>
                  {selectedLeadIds.size === 0 && (
                    <p className="text-[11px] text-muted-foreground">Or skip to auto-pick by radius</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2 text-xs"
                  onClick={() => { setSelectionMode(false); setSelectedLeadIds(new Set()); }}
                  data-testid="button-cancel-selection"
                >
                  Cancel
                </Button>
                {selectedLeadIds.size === 0 ? (
                  <Button
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => {
                      setPreselectedForPlanner(null);
                      setSelectionMode(false);
                      setPlannerOpen(true);
                    }}
                    data-testid="button-skip-to-auto"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Auto-pick
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => {
                      // Look up against the full marinas set (not filtered) so filter
                      // changes after toggling can't drop a previously-picked marina.
                      const chosen = marinas.filter(m => selectedLeadIds.has(m.id));
                      if (!chosen.length) {
                        toast({ title: "Selected marinas are no longer in view", description: "Pan back or pick again.", variant: "destructive" });
                        return;
                      }
                      setPreselectedForPlanner(chosen);
                      setSelectionMode(false);
                      setPlannerOpen(true);
                    }}
                    data-testid="button-confirm-selection"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Plan with {selectedLeadIds.size}
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Bottom-left list opener pill (mobile only) */}
          <button
            onClick={() => setMobileListOpen(true)}
            className="sm:hidden absolute bottom-4 left-3 z-[500] flex items-center gap-1.5 px-3.5 h-11 rounded-full backdrop-blur-xl bg-background/85 border border-white/10 text-foreground text-sm font-medium shadow-xl shadow-black/30 active:scale-95 transition"
            data-testid="button-mobile-list"
          >
            <List className="h-4 w-4" />
            {loading ? "…" : filteredMarinas.length}
          </button>

          {/* Loading shimmer (mobile) */}
          {loading && (
            <div className="sm:hidden absolute top-20 left-1/2 -translate-x-1/2 z-[500] backdrop-blur-xl bg-background/85 border border-white/10 rounded-full px-3 py-1.5 text-[11px] flex items-center gap-1.5 shadow-lg">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading marinas…
            </div>
          )}

          {/* Empty state overlay */}
          {!loading && filteredMarinas.length === 0 && (
            <div className="sm:hidden absolute top-1/2 left-4 right-4 -translate-y-1/2 z-[400] text-center backdrop-blur-xl bg-background/80 border border-white/10 rounded-2xl p-5 shadow-xl pointer-events-none">
              {geocodingActive ? (
                <Loader2 className="h-7 w-7 text-amber-400 mx-auto mb-2 animate-spin" />
              ) : (
                <Anchor className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
              )}
              <p className="text-sm font-medium">No marinas in view</p>
              <p className="text-xs text-muted-foreground mt-1">
                {geocodingActive
                  ? `Geocoding ${pendingGeoCount} lead${pendingGeoCount !== 1 ? "s" : ""} — zoom out to see them once complete`
                  : "Zoom out or search an address"}
              </p>
            </div>
          )}
        </div>

        {/* Desktop side list */}
        <div className="hidden sm:flex flex-col w-72 lg:w-80 flex-shrink-0 overflow-y-auto space-y-1.5 pr-1">
          {loading && marinas.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
          ) : filteredMarinas.length === 0 ? (
            <div className="text-center py-12 px-4">
              {geocodingActive ? (
                <Loader2 className="h-8 w-8 text-amber-400 mx-auto mb-2 animate-spin" />
              ) : (
                <Anchor className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              )}
              <p className="text-sm text-muted-foreground">No marinas in view</p>
              <p className="text-xs text-muted-foreground mt-1">
                {geocodingActive
                  ? `Geocoding ${pendingGeoCount} lead${pendingGeoCount !== 1 ? "s" : ""}…`
                  : "Zoom out or search an address"}
              </p>
            </div>
          ) : (
            filteredMarinas.map(renderListItem)
          )}
        </div>
      </div>

      {/* Mobile filters sheet */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-sm p-5 sm:hidden">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" /> Filters
            </SheetTitle>
          </SheetHeader>
          {filterControls}
          <div className="mt-5 space-y-2">
            <Button
              onClick={() => { requestLocation(); }}
              variant="outline"
              className="w-full gap-2"
              disabled={locating}
              data-testid="button-mobile-locate"
            >
              {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Locate className="h-4 w-4" />}
              {userLocation ? "Re-center on me" : "Use my location"}
            </Button>
            <Button
              onClick={() => { setStageFilter("all"); setRadiusFilter("any"); }}
              variant="ghost"
              className="w-full text-xs text-muted-foreground"
            >
              Reset filters
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile bottom-sheet list */}
      <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
        <SheetContent side="bottom" className="h-[78vh] rounded-t-3xl p-0 sm:hidden flex flex-col">
          <div className="flex-shrink-0 px-4 pt-3 pb-2">
            <div className="mx-auto w-10 h-1 rounded-full bg-border/80 mb-3" />
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="text-base flex items-center gap-2">
                <Anchor className="h-4 w-4 text-primary" />
                {filteredMarinas.length} marinas
              </SheetTitle>
              <button
                onClick={() => setMobileListOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted/60 active:scale-95 transition"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-1.5">
            {loading && marinas.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
            ) : filteredMarinas.length === 0 ? (
              <div className="text-center py-12">
                <Anchor className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No marinas in view</p>
              </div>
            ) : (
              filteredMarinas.map(renderListItem)
            )}
          </div>
        </SheetContent>
      </Sheet>

      <MarinasDayPlannerDialog
        open={plannerOpen}
        onOpenChange={(o) => {
          setPlannerOpen(o);
          if (!o) {
            setPreselectedForPlanner(null);
            setSelectedLeadIds(new Set());
          }
        }}
        userLocation={userLocation}
        defaultStageFilter={stageFilter}
        preselectedLeads={preselectedForPlanner as any}
      />
    </div>
  );
}