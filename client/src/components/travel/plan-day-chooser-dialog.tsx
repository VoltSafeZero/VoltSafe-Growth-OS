import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plane, Anchor, ChevronRight, Sparkles } from "lucide-react";
import { TravelPlannerDialog } from "./travel-planner-dialog";
import { MarinasDayPlannerDialog } from "@/components/marinas-day-planner-dialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Optional starting location handed to the marina day planner. */
  userLocation?: { lat: number; lng: number } | null;
}

/**
 * Plan My Travel Day chooser.
 *
 * Both surfaces that expose the "Plan My Travel Day" CTA (the Mission Control
 * header and the Leads Nearby widget footer) now open this single chooser so
 * the behaviour is identical no matter which button you click. The chooser
 * routes the user to one of the two existing planners:
 *
 *  • Multi-day trip       → TravelPlannerDialog (flights, hotels, ferries…)
 *  • Single-day visits    → MarinasDayPlannerDialog (route-optimised marina
 *                           visits for a fixed window today)
 *
 * Both downstream dialogs are mounted internally so the host page only needs
 * to track a single open/close pair.
 */
export function PlanDayChooserDialog({ open, onOpenChange, userLocation = null }: Props) {
  const [tripOpen, setTripOpen] = useState(false);
  const [marinaOpen, setMarinaOpen] = useState(false);

  const choose = (kind: "trip" | "marina") => {
    onOpenChange(false);
    if (kind === "trip") setTripOpen(true);
    else setMarinaOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" data-testid="dialog-plan-day-chooser">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Plan My Travel Day
            </DialogTitle>
            <DialogDescription>
              What kind of plan would you like to build?
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <button
              type="button"
              onClick={() => choose("trip")}
              className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-4 text-left hover-elevate active-elevate-2 transition"
              data-testid="button-plan-day-multi-day"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary flex-shrink-0">
                <Plane className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm" data-testid="text-plan-day-multi-day-title">
                  Multi-day trip
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Build a full itinerary with flights, hotels, ferries and legs spanning multiple days.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground mt-1.5 flex-shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => choose("marina")}
              className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-4 text-left hover-elevate active-elevate-2 transition"
              data-testid="button-plan-day-single-day"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary flex-shrink-0">
                <Anchor className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm" data-testid="text-plan-day-single-day-title">
                  Single-day visits
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Optimise a marina / sales-visit route for a set number of hours today.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground mt-1.5 flex-shrink-0" />
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <TravelPlannerDialog
        open={tripOpen}
        onOpenChange={setTripOpen}
        initialTripId={null}
      />
      <MarinasDayPlannerDialog
        open={marinaOpen}
        onOpenChange={setMarinaOpen}
        userLocation={userLocation}
      />
    </>
  );
}
