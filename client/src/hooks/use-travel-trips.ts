import { useEffect, useState } from "react";
import { TravelStorage, type TravelTrip } from "@/lib/travel-storage";

export function useTravelTrips() {
  const [trips, setTrips] = useState<TravelTrip[]>(() => TravelStorage.list());

  useEffect(() => {
    const refresh = () => setTrips(TravelStorage.list());
    window.addEventListener("travel:trips-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("travel:trips-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return trips;
}
