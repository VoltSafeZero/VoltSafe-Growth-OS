export type TravelMode = "air" | "car" | "rail" | "boat" | "bus" | "rideshare" | "walk";

export type TravelPurpose =
  | "tradeshow"
  | "sales"
  | "meetings"
  | "site_visit"
  | "training"
  | "conference"
  | "internal"
  | "personal"
  | "other";

export type TravelLeg = {
  id: string;
  mode: TravelMode;
  from?: string;
  to?: string;
  carrier?: string;
  reference?: string;
  departAt?: string;
  arriveAt?: string;
  notes?: string;
};

export type TravelTrip = {
  id: string;
  title: string;
  purpose: TravelPurpose;
  purposeOther?: string;
  destination: string;
  modes: TravelMode[];
  startDate: string;
  endDate: string;
  notes?: string;
  legs: TravelLeg[];
  published: boolean;
  createdAt: string;
  updatedAt: string;
};

const KEY = "voltsafe.travel.trips.v1";

function read(): TravelTrip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as TravelTrip[];
  } catch {
    return [];
  }
}

function write(trips: TravelTrip[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(trips));
  window.dispatchEvent(new CustomEvent("travel:trips-changed"));
}

export const TravelStorage = {
  list(): TravelTrip[] {
    return read().sort((a, b) => a.startDate.localeCompare(b.startDate));
  },
  get(id: string): TravelTrip | undefined {
    return read().find(t => t.id === id);
  },
  upsert(trip: TravelTrip): TravelTrip {
    const all = read();
    const idx = all.findIndex(t => t.id === trip.id);
    const now = new Date().toISOString();
    const next: TravelTrip = { ...trip, updatedAt: now };
    if (idx >= 0) all[idx] = next; else all.unshift({ ...next, createdAt: now });
    write(all);
    return next;
  },
  remove(id: string) {
    write(read().filter(t => t.id !== id));
  },
  setPublished(id: string, published: boolean) {
    const all = read();
    const idx = all.findIndex(t => t.id === id);
    if (idx < 0) return;
    all[idx] = { ...all[idx], published, updatedAt: new Date().toISOString() };
    write(all);
  },
};

export function newTripId() {
  return `trip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const PURPOSE_LABELS: Record<TravelPurpose, string> = {
  tradeshow: "Tradeshow",
  sales: "Sales",
  meetings: "Meetings",
  site_visit: "Site visit",
  training: "Training",
  conference: "Conference",
  internal: "Internal / team",
  personal: "Personal",
  other: "Other",
};

export const MODE_LABELS: Record<TravelMode, string> = {
  air: "Air",
  car: "Car",
  rail: "Rail",
  boat: "Boat / Ferry",
  bus: "Bus / Coach",
  rideshare: "Rideshare / Taxi",
  walk: "Walk",
};
