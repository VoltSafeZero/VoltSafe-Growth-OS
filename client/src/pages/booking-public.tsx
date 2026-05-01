import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays, Clock, Video, CheckCircle2, AlertCircle,
  ChevronLeft, ChevronRight, Loader2, User,
} from "lucide-react";
import { format, addDays, startOfDay, parseISO, isAfter, isBefore, addMinutes } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type AvailabilityWindow = { dow: number; start: string; end: string };

type BookingLinkInfo = {
  bookingLink: {
    name: string;
    description: string | null;
    slug: string;
    slotMinutes: number;
    bufferMinutes: number;
    advanceDays: number;
    minNoticeHours: number;
    timeZone: string;
    availability: AvailabilityWindow[];
    locationType: string;
    requireRecipientMatch: boolean;
  };
  recipientEmail: string;
  alreadyBooked: boolean;
  bookedAt: string | null;
};

type ConfirmResult = {
  calendarEventId: number;
  startTime: string;
  endTime: string;
  zoomJoinUrl: string | null;
  zoomMeetingId: string | null;
  zoomPassword: string | null;
  alreadyBooked: boolean;
};

// ─── Slot generator ───────────────────────────────────────────────────────────

function generateSlots(
  availability: AvailabilityWindow[],
  slotMinutes: number,
  bufferMinutes: number,
  advanceDays: number,
  minNoticeHours: number,
): Date[] {
  const slots: Date[] = [];
  const now = new Date();
  const minNoticeMs = minNoticeHours * 60 * 60 * 1000;
  const earliest = new Date(now.getTime() + minNoticeMs);

  for (let d = 0; d <= advanceDays; d++) {
    const day = addDays(startOfDay(now), d);
    const dow = day.getDay();
    const windows = availability.filter((w) => w.dow === dow);

    for (const window of windows) {
      const [startH, startM] = window.start.split(":").map(Number);
      const [endH, endM]     = window.end.split(":").map(Number);

      const windowStart = new Date(day);
      windowStart.setHours(startH, startM, 0, 0);

      const windowEnd = new Date(day);
      windowEnd.setHours(endH, endM, 0, 0);

      let cursor = new Date(windowStart);
      while (isBefore(addMinutes(cursor, slotMinutes), windowEnd) || cursor.getTime() + slotMinutes * 60_000 === windowEnd.getTime()) {
        const slotEnd = addMinutes(cursor, slotMinutes);
        if (isAfter(cursor, earliest) && !isBefore(slotEnd, windowEnd) === false) {
          slots.push(new Date(cursor));
        }
        cursor = addMinutes(cursor, slotMinutes + bufferMinutes);
        if (cursor >= windowEnd) break;
      }
    }
  }

  return slots;
}

// ─── Slot picker ──────────────────────────────────────────────────────────────

function SlotPicker({
  slots,
  slotMinutes,
  selected,
  onSelect,
}: {
  slots: Date[];
  slotMinutes: number;
  selected: Date | null;
  onSelect: (d: Date) => void;
}) {
  const [dayOffset, setDayOffset] = useState(0);
  const DAYS_PER_PAGE = 5;

  const grouped = useMemo(() => {
    const map = new Map<string, Date[]>();
    for (const slot of slots) {
      const key = format(slot, "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    }
    return Array.from(map.entries());
  }, [slots]);

  const page = grouped.slice(dayOffset, dayOffset + DAYS_PER_PAGE);

  if (slots.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        No available slots in the booking window. Please contact the organiser.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {dayOffset + 1}–{Math.min(dayOffset + DAYS_PER_PAGE, grouped.length)} of {grouped.length} days
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setDayOffset((o) => Math.max(0, o - DAYS_PER_PAGE))}
            disabled={dayOffset === 0}
            className="p-1 rounded hover:bg-secondary/60 disabled:opacity-30 transition-colors"
            data-testid="button-prev-days"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDayOffset((o) => Math.min(grouped.length - 1, o + DAYS_PER_PAGE))}
            disabled={dayOffset + DAYS_PER_PAGE >= grouped.length}
            className="p-1 rounded hover:bg-secondary/60 disabled:opacity-30 transition-colors"
            data-testid="button-next-days"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {page.map(([dateKey, daySlots]) => (
          <div key={dateKey} className="flex flex-col gap-1.5">
            <div className="text-center text-xs font-medium text-foreground py-1 border-b border-border/40">
              <div>{format(parseISO(dateKey), "EEE")}</div>
              <div className="text-muted-foreground">{format(parseISO(dateKey), "MMM d")}</div>
            </div>
            <div className="flex flex-col gap-1">
              {daySlots.map((slot) => {
                const isSelected = selected?.getTime() === slot.getTime();
                return (
                  <button
                    key={slot.toISOString()}
                    onClick={() => onSelect(slot)}
                    data-testid={`slot-${slot.toISOString()}`}
                    className={`text-xs py-1.5 px-2 rounded-md border transition-all text-center ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary font-medium"
                        : "border-border/50 hover:border-primary/50 hover:bg-primary/5"
                    }`}
                  >
                    {format(slot, "h:mm a")}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="mt-1 flex items-center gap-2 text-xs text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2" data-testid="text-selected-slot">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          {format(selected, "EEEE, MMMM d")} at {format(selected, "h:mm a")} — {slotMinutes} min
        </div>
      )}
    </div>
  );
}

// ─── Success state ────────────────────────────────────────────────────────────

function BookingSuccess({
  result,
  bookingName,
  recipientEmail,
}: {
  result: ConfirmResult;
  bookingName: string;
  recipientEmail: string;
}) {
  const startDate = new Date(result.startTime);
  const endDate   = new Date(result.endTime);

  return (
    <div className="flex flex-col items-center gap-6 py-8 text-center">
      <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-foreground" data-testid="heading-booking-confirmed">
          You're booked!
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          A calendar invitation will be sent to {recipientEmail}.
        </p>
      </div>

      <div className="w-full max-w-sm bg-card border border-border/60 rounded-xl p-4 flex flex-col gap-3 text-sm text-left">
        <div className="font-medium text-foreground">{bookingName}</div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarDays className="w-4 h-4 shrink-0" />
          <span>{format(startDate, "EEEE, MMMM d, yyyy")}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="w-4 h-4 shrink-0" />
          <span>
            {format(startDate, "h:mm a")} – {format(endDate, "h:mm a")}
          </span>
        </div>
        {result.zoomJoinUrl && (
          <a
            href={result.zoomJoinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[#2D8CFF] text-white rounded-lg px-4 py-2.5 font-medium hover:bg-[#2680f0] transition-colors mt-1"
            data-testid="link-zoom-join-confirmed"
          >
            <Video className="w-4 h-4 shrink-0" />
            Join Zoom Meeting
          </a>
        )}
        {result.zoomPassword && (
          <div className="text-xs text-muted-foreground">
            Passcode: <span className="font-mono font-medium text-foreground">{result.zoomPassword}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BookingPublicPage({ token }: { token: string }) {
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmResult | null>(null);

  const { data: info, isLoading, isError } = useQuery<BookingLinkInfo>({
    queryKey: ["/booking/public", token],
    queryFn: async () => {
      const r = await fetch(`/api/booking-links/public/${token}`);
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    retry: false,
    staleTime: 60_000,
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("No slot selected");
      const r = await fetch(`/api/booking-links/public/${token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotStart: selectedSlot.toISOString() }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: "Failed to confirm booking" }));
        throw new Error(err.message);
      }
      return r.json() as Promise<ConfirmResult>;
    },
    onSuccess: (result) => setConfirmed(result),
  });

  const slots = useMemo(() => {
    if (!info) return [];
    const { slotMinutes, bufferMinutes, advanceDays, minNoticeHours, availability } = info.bookingLink;
    return generateSlots(availability, slotMinutes, bufferMinutes, advanceDays, minNoticeHours);
  }, [info]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-4">
          <Skeleton className="h-8 w-64 mx-auto" />
          <Skeleton className="h-4 w-96 mx-auto" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !info) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-4">
        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
          <AlertCircle className="w-7 h-7 text-red-500" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Booking link not found</h1>
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          This link may have expired, been revoked, or is invalid. Please contact the meeting organiser for a new link.
        </p>
      </div>
    );
  }

  if (info.alreadyBooked && !confirmed) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-4">
        <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-amber-500" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Already booked</h1>
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          You've already booked a slot for <strong>{info.bookingLink.name}</strong>.
          {info.bookedAt && ` Booked on ${format(new Date(info.bookedAt), "MMMM d, yyyy")}.`}
        </p>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-xl">
          <BookingSuccess
            result={confirmed}
            bookingName={info.bookingLink.name}
            recipientEmail={info.recipientEmail}
          />
        </div>
      </div>
    );
  }

  const isZoom = info.bookingLink.locationType === "zoom";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-10 flex flex-col gap-8">

        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {isZoom && (
              <Badge variant="outline" className="gap-1.5 text-[#2D8CFF] border-[#2D8CFF]/30 bg-[#2D8CFF]/5">
                <Video className="w-3 h-3" /> Zoom
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="heading-booking-name">
            {info.bookingLink.name}
          </h1>
          {info.bookingLink.description && (
            <p className="text-sm text-muted-foreground">{info.bookingLink.description}</p>
          )}
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {info.bookingLink.slotMinutes} minutes
            </span>
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              For: {info.recipientEmail}
            </span>
          </div>
        </div>

        {/* Slot picker */}
        <div className="bg-card border border-border/60 rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CalendarDays className="w-4 h-4 text-primary" />
            Select a time
          </div>
          <SlotPicker
            slots={slots}
            slotMinutes={info.bookingLink.slotMinutes}
            selected={selectedSlot}
            onSelect={setSelectedSlot}
          />
        </div>

        {/* Confirm button */}
        {selectedSlot && (
          <div className="flex flex-col gap-3">
            {confirmMutation.isError && (
              <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5" data-testid="error-booking-confirm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {confirmMutation.error instanceof Error
                  ? confirmMutation.error.message
                  : "Failed to confirm booking. Please try again."}
              </div>
            )}
            <Button
              size="lg"
              className="w-full gap-2"
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
              data-testid="button-confirm-booking"
            >
              {confirmMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <CheckCircle2 className="w-4 h-4" />}
              Confirm booking — {format(selectedSlot, "MMM d 'at' h:mm a")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
