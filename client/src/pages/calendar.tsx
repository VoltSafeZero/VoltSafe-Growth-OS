import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Loader2,
  Video,
  MapPin,
  Clock,
  Pencil,
  CalendarDays,
  X,
  Users,
  Bell,
  Eye,
  Repeat,
  Car,
  Globe,
} from "lucide-react";
import AddressAutocomplete from "@/components/address-autocomplete";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  setHours,
  getHours,
  getMinutes,
  parseISO,
} from "date-fns";
import type { CalendarEvent } from "@shared/schema";

type ViewMode = "month" | "week" | "day";

const EVENT_TYPES = ["meeting", "call", "task", "reminder"] as const;
const EVENT_STATUSES = ["scheduled", "completed", "cancelled"] as const;

const TIME_OPTIONS = (() => {
  const opts: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const value = `${hh}:${mm}`;
      const period = h < 12 ? "AM" : "PM";
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const label = `${displayH}:${mm} ${period}`;
      opts.push({ value, label });
    }
  }
  return opts;
})();

const TIMEZONE_OPTIONS = [
  "Eastern Time", "Central Time", "Mountain Time", "Pacific Time",
  "Alaska Time", "Hawaii Time", "Atlantic Time",
  "UTC", "GMT", "BST", "CET", "EET",
  "IST", "JST", "CST (China)", "AEST", "NZST",
];

const REPEAT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const TRAVEL_TIME_OPTIONS = [
  { value: "none", label: "None" },
  { value: "5min", label: "5 minutes" },
  { value: "15min", label: "15 minutes" },
  { value: "30min", label: "30 minutes" },
  { value: "1hr", label: "1 hour" },
  { value: "1.5hr", label: "1 hour 30 minutes" },
  { value: "2hr", label: "2 hours" },
];

const ALERT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "at_time", label: "At time of event" },
  { value: "1min", label: "1 minute before" },
  { value: "5min", label: "5 minutes before" },
  { value: "10min", label: "10 minutes before" },
  { value: "15min", label: "15 minutes before" },
  { value: "30min", label: "30 minutes before" },
  { value: "45min", label: "45 minutes before" },
  { value: "1hr", label: "1 hour before" },
  { value: "2hr", label: "2 hours before" },
  { value: "1day", label: "1 day before" },
  { value: "2day", label: "2 days before" },
];

const SHOW_AS_OPTIONS = [
  { value: "busy", label: "Busy" },
  { value: "free", label: "Free" },
];

const VISIBILITY_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
];

const COLOR_OPTIONS = [
  { value: "", label: "None" },
  { value: "blue", label: "Blue" },
  { value: "red", label: "Red" },
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
  { value: "purple", label: "Purple" },
  { value: "teal", label: "Teal" },
  { value: "pink", label: "Pink" },
];

const COLOR_DOT: Record<string, string> = {
  blue: "bg-blue-500",
  red: "bg-red-500",
  green: "bg-green-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  teal: "bg-teal-500",
  pink: "bg-pink-500",
};

function roundTo15(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const rounded = Math.round(m / 15) * 15;
  const finalM = rounded === 60 ? 0 : rounded;
  const finalH = rounded === 60 ? (h + 1) % 24 : h;
  return `${String(finalH).padStart(2, "0")}:${String(finalM).padStart(2, "0")}`;
}

function DatePickerField({ value, onChange, label, testId }: { value: string; onChange: (v: string) => void; label: string; testId: string }) {
  const [open, setOpen] = useState(false);
  const dateObj = value ? new Date(value + "T00:00:00") : undefined;
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm" data-testid={testId}>
            <CalendarDays className="mr-2 h-4 w-4 text-muted-foreground" />
            {value ? format(new Date(value + "T00:00:00"), "MMM d, yyyy") : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CalendarWidget
            mode="single"
            selected={dateObj}
            onSelect={(d) => { if (d) { onChange(format(d, "yyyy-MM-dd")); setOpen(false); } }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TimePickerField({ value, onChange, label, testId }: { value: string; onChange: (v: string) => void; label: string; testId: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-sm" data-testid={testId}>
          <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder="Select time" />
        </SelectTrigger>
        <SelectContent className="max-h-[240px]">
          {TIME_OPTIONS.map((t) => (
            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  meeting: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
  call: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/25",
  task: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/25",
  reminder: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25",
};

const EVENT_DOT_COLORS: Record<string, string> = {
  meeting: "bg-blue-500",
  call: "bg-green-500",
  task: "bg-orange-500",
  reminder: "bg-purple-500",
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatTime(date: Date) {
  return format(date, "h:mm a");
}

function getViewRange(currentDate: Date, view: ViewMode) {
  if (view === "month") {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    return {
      start: startOfWeek(monthStart),
      end: endOfWeek(monthEnd),
    };
  }
  if (view === "week") {
    return {
      start: startOfWeek(currentDate),
      end: endOfWeek(currentDate),
    };
  }
  return { start: currentDate, end: currentDate };
}

function useCalendarEvents(currentDate: Date, view: ViewMode) {
  const range = getViewRange(currentDate, view);
  const startStr = range.start.toISOString();
  const endStr = new Date(range.end.getTime() + 24 * 60 * 60 * 1000).toISOString();

  return useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar/events", startStr, endStr],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/events?start=${startStr}&end=${endStr}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
  });
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewMode>("month");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [clickedSlot, setClickedSlot] = useState<{ date: Date; hour?: number } | null>(null);
  const { toast } = useToast();

  const { data: events, isLoading } = useCalendarEvents(currentDate, view);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/calendar/events", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      setCreateOpen(false);
      setClickedSlot(null);
      toast({ title: "Event created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create event", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/calendar/events/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      setSelectedEvent(null);
      toast({ title: "Event updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/calendar/events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      setSelectedEvent(null);
      toast({ title: "Event deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  const navigate = (direction: "prev" | "next" | "today") => {
    if (direction === "today") {
      setCurrentDate(new Date());
      return;
    }
    const fn = direction === "prev"
      ? view === "month" ? subMonths : view === "week" ? subWeeks : subDays
      : view === "month" ? addMonths : view === "week" ? addWeeks : addDays;
    setCurrentDate((d) => fn(d, 1));
  };

  const headerTitle = useMemo(() => {
    if (view === "month") return format(currentDate, "MMMM yyyy");
    if (view === "week") {
      const ws = startOfWeek(currentDate);
      const we = endOfWeek(currentDate);
      if (ws.getMonth() === we.getMonth()) {
        return `${format(ws, "MMM d")} - ${format(we, "d, yyyy")}`;
      }
      return `${format(ws, "MMM d")} - ${format(we, "MMM d, yyyy")}`;
    }
    return format(currentDate, "EEEE, MMMM d, yyyy");
  }, [currentDate, view]);

  const handleSlotClick = (date: Date, hour?: number) => {
    setClickedSlot({ date, hour });
    setCreateOpen(true);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="calendar-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Calendar
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Schedule and manage your events.</p>
        </div>
        <Button onClick={() => { setClickedSlot(null); setCreateOpen(true); }} data-testid="button-create-event">
          <Plus className="mr-2 h-4 w-4" /> New Event
        </Button>
      </div>

      <Card className="border-border/50">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate("prev")}
                data-testid="button-nav-prev"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate("next")}
                data-testid="button-nav-next"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => navigate("today")}
                data-testid="button-nav-today"
              >
                Today
              </Button>
            </div>

            <h2 className="text-lg font-semibold" data-testid="text-calendar-title">
              {headerTitle}
            </h2>

            <div className="flex items-center gap-1">
              {(["month", "week", "day"] as ViewMode[]).map((v) => (
                <Button
                  key={v}
                  variant={view === v ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setView(v)}
                  data-testid={`button-view-${v}`}
                  className="capitalize"
                >
                  {v}
                </Button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-[500px]" />
          ) : view === "month" ? (
            <MonthView
              currentDate={currentDate}
              events={events || []}
              onSlotClick={handleSlotClick}
              onEventClick={setSelectedEvent}
              onDayClick={(d) => { setCurrentDate(d); setView("day"); }}
            />
          ) : view === "week" ? (
            <WeekView
              currentDate={currentDate}
              events={events || []}
              onSlotClick={handleSlotClick}
              onEventClick={setSelectedEvent}
            />
          ) : (
            <DayView
              currentDate={currentDate}
              events={events || []}
              onSlotClick={handleSlotClick}
              onEventClick={setSelectedEvent}
            />
          )}
        </CardContent>
      </Card>

      {createOpen && (
        <EventFormDialog
          open={createOpen}
          onClose={() => { setCreateOpen(false); setClickedSlot(null); }}
          onSubmit={(d) => createMutation.mutate(d)}
          isPending={createMutation.isPending}
          initialSlot={clickedSlot}
        />
      )}

      {selectedEvent && (
        <EventDetailDialog
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onUpdate={(data) => updateMutation.mutate({ id: selectedEvent.id, data })}
          onDelete={() => deleteMutation.mutate(selectedEvent.id)}
          isUpdating={updateMutation.isPending}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

function MonthView({
  currentDate,
  events,
  onSlotClick,
  onEventClick,
  onDayClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onSlotClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onDayClick: (date: Date) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {dayNames.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-t border-l border-border/50">
        {days.map((day) => {
          const dayEvents = events.filter((e) => {
            const eStart = new Date(e.startTime);
            return isSameDay(eStart, day);
          });
          const inMonth = isSameMonth(day, currentDate);
          const today = isToday(day);

          return (
            <div
              key={day.toISOString()}
              className={`border-r border-b border-border/50 min-h-[80px] sm:min-h-[100px] p-1 cursor-pointer transition-colors ${
                !inMonth ? "opacity-40" : ""
              }`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-event]")) return;
                onSlotClick(day);
              }}
              data-testid={`cell-day-${format(day, "yyyy-MM-dd")}`}
            >
              <button
                className={`text-xs sm:text-sm w-6 h-6 rounded-full flex items-center justify-center mb-0.5 ${
                  today
                    ? "bg-primary text-primary-foreground font-bold"
                    : "text-muted-foreground"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDayClick(day);
                }}
                data-testid={`button-day-${format(day, "d")}`}
              >
                {format(day, "d")}
              </button>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((ev) => (
                  <button
                    key={ev.id}
                    data-event
                    className={`w-full text-left text-[10px] sm:text-xs px-1 py-0.5 rounded truncate border ${
                      EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.meeting
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(ev);
                    }}
                    data-testid={`event-month-${ev.id}`}
                  >
                    {ev.title}
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <p className="text-[10px] text-muted-foreground px-1">
                    +{dayEvents.length - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  currentDate,
  events,
  onSlotClick,
  onEventClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onSlotClick: (date: Date, hour: number) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const weekStart = startOfWeek(currentDate);
  const weekDays = eachDayOfInterval({ start: weekStart, end: endOfWeek(currentDate) });

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border/50">
          <div className="p-2" />
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={`text-center p-2 border-l border-border/50 ${
                isToday(day) ? "bg-primary/5" : ""
              }`}
            >
              <div className="text-xs text-muted-foreground">{format(day, "EEE")}</div>
              <div
                className={`text-sm font-medium ${
                  isToday(day) ? "text-primary font-bold" : ""
                }`}
              >
                {format(day, "d")}
              </div>
            </div>
          ))}
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          {HOURS.map((hour) => (
            <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border/30">
              <div className="p-1 text-[10px] text-muted-foreground text-right pr-2 pt-1">
                {format(setHours(new Date(), hour), "h a")}
              </div>
              {weekDays.map((day) => {
                const hourEvents = events.filter((e) => {
                  const eStart = new Date(e.startTime);
                  return isSameDay(eStart, day) && getHours(eStart) === hour;
                });

                return (
                  <div
                    key={day.toISOString()}
                    className="border-l border-border/30 min-h-[48px] p-0.5 cursor-pointer"
                    onClick={() => onSlotClick(day, hour)}
                    data-testid={`slot-week-${format(day, "yyyy-MM-dd")}-${hour}`}
                  >
                    {hourEvents.map((ev) => (
                      <button
                        key={ev.id}
                        className={`w-full text-left text-[10px] px-1 py-0.5 rounded truncate border mb-0.5 ${
                          EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.meeting
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(ev);
                        }}
                        data-testid={`event-week-${ev.id}`}
                      >
                        {formatTime(new Date(ev.startTime))} {ev.title}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DayView({
  currentDate,
  events,
  onSlotClick,
  onEventClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onSlotClick: (date: Date, hour: number) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const dayEvents = events.filter((e) => isSameDay(new Date(e.startTime), currentDate));

  return (
    <div className="max-h-[600px] overflow-y-auto">
      {HOURS.map((hour) => {
        const hourEvents = dayEvents.filter((e) => getHours(new Date(e.startTime)) === hour);

        return (
          <div
            key={hour}
            className="grid grid-cols-[60px_1fr] border-b border-border/30 min-h-[56px] cursor-pointer"
            onClick={() => onSlotClick(currentDate, hour)}
            data-testid={`slot-day-${hour}`}
          >
            <div className="p-1 text-xs text-muted-foreground text-right pr-3 pt-1">
              {format(setHours(new Date(), hour), "h a")}
            </div>
            <div className="p-1 space-y-1">
              {hourEvents.map((ev) => (
                <button
                  key={ev.id}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded border ${
                    EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.meeting
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick(ev);
                  }}
                  data-testid={`event-day-${ev.id}`}
                >
                  <div className="font-medium">{ev.title}</div>
                  <div className="text-muted-foreground mt-0.5">
                    {formatTime(new Date(ev.startTime))}
                    {ev.endTime && ` - ${formatTime(new Date(ev.endTime))}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventFormDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  initialSlot,
  initialData,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
  initialSlot?: { date: Date; hour?: number } | null;
  initialData?: CalendarEvent;
}) {
  const defaultStart = initialSlot
    ? initialSlot.hour !== undefined
      ? setHours(initialSlot.date, initialSlot.hour)
      : initialSlot.date
    : new Date();

  const defaultEnd = initialSlot?.hour !== undefined
    ? setHours(initialSlot.date, initialSlot.hour + 1)
    : undefined;

  const [formData, setFormData] = useState({
    title: initialData?.title || "",
    description: initialData?.description || "",
    eventType: initialData?.eventType || "meeting",
    startDate: initialData ? format(new Date(initialData.startTime), "yyyy-MM-dd") : format(defaultStart, "yyyy-MM-dd"),
    startTime: initialData
      ? roundTo15(format(new Date(initialData.startTime), "HH:mm"))
      : initialSlot?.hour !== undefined
        ? `${String(initialSlot.hour).padStart(2, "0")}:00`
        : roundTo15(format(new Date(), "HH:mm")),
    endDate: initialData?.endTime
      ? format(new Date(initialData.endTime), "yyyy-MM-dd")
      : defaultEnd
        ? format(defaultEnd, "yyyy-MM-dd")
        : "",
    endTime: initialData?.endTime
      ? roundTo15(format(new Date(initialData.endTime), "HH:mm"))
      : defaultEnd
        ? format(defaultEnd, "HH:mm")
        : "",
    allDay: initialData?.allDay || false,
    location: initialData?.location || "",
    meetingUrl: initialData?.meetingUrl || "",
    color: initialData?.color || "",
    status: initialData?.status || "scheduled",
    timeZone: initialData?.timeZone || "Eastern Time",
    repeat: initialData?.repeat || "none",
    travelTime: initialData?.travelTime || "none",
    alert: initialData?.alert || "5min",
    secondAlert: initialData?.secondAlert || "none",
    showAs: initialData?.showAs || "busy",
    visibility: initialData?.visibility || "default",
  });

  const [invitees, setInvitees] = useState<string[]>(initialData?.invitees || []);
  const [inviteeInput, setInviteeInput] = useState("");

  const addInvitee = () => {
    const email = inviteeInput.trim().toLowerCase();
    if (email && email.includes("@") && !invitees.includes(email)) {
      setInvitees((prev) => [...prev, email]);
      setInviteeInput("");
    }
  };

  const removeInvitee = (email: string) => {
    setInvitees((prev) => prev.filter((e) => e !== email));
  };

  const handleSubmit = () => {
    if (!formData.title.trim()) return;
    const startTime = formData.allDay
      ? new Date(`${formData.startDate}T00:00:00`)
      : new Date(`${formData.startDate}T${formData.startTime}:00`);
    const endTime = formData.endDate
      ? formData.allDay
        ? new Date(`${formData.endDate}T23:59:59`)
        : new Date(`${formData.endDate}T${formData.endTime || "23:59"}:00`)
      : null;

    onSubmit({
      title: formData.title,
      description: formData.description || null,
      eventType: formData.eventType,
      startTime: startTime.toISOString(),
      endTime: endTime?.toISOString() || null,
      allDay: formData.allDay,
      location: formData.location || null,
      meetingUrl: formData.meetingUrl || null,
      color: formData.color || null,
      status: formData.status,
      invitees: invitees.length > 0 ? invitees : null,
      timeZone: formData.timeZone || null,
      repeat: formData.repeat,
      travelTime: formData.travelTime,
      alert: formData.alert,
      secondAlert: formData.secondAlert,
      showAs: formData.showAs,
      visibility: formData.visibility,
    });
  };

  const set = (key: string, val: unknown) => setFormData((p) => ({ ...p, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? "Edit Event" : "New Event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input
              value={formData.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Add Title"
              data-testid="input-event-title"
            />
          </div>

          <div>
            <Label className="flex items-center gap-1.5"><Video className="h-3.5 w-3.5" /> Zoom Meeting URL</Label>
            <Input
              value={formData.meetingUrl}
              onChange={(e) => set("meetingUrl", e.target.value)}
              placeholder="https://zoom.us/j/..."
              data-testid="input-event-meeting-url"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={formData.eventType} onValueChange={(v) => set("eventType", v)}>
                <SelectTrigger className="h-9" data-testid="select-event-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="h-9" data-testid="select-event-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={formData.allDay}
              onCheckedChange={(v) => set("allDay", v)}
              data-testid="switch-all-day"
            />
            <Label>all-day</Label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DatePickerField value={formData.startDate} onChange={(v) => set("startDate", v)} label="starts" testId="picker-start-date" />
            {!formData.allDay && (
              <TimePickerField value={formData.startTime} onChange={(v) => set("startTime", v)} label="" testId="picker-start-time" />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DatePickerField value={formData.endDate} onChange={(v) => set("endDate", v)} label="ends" testId="picker-end-date" />
            {!formData.allDay && (
              <TimePickerField value={formData.endTime} onChange={(v) => set("endTime", v)} label="" testId="picker-end-time" />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Globe className="h-3 w-3" /> time zone</Label>
              <Select value={formData.timeZone} onValueChange={(v) => set("timeZone", v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[240px]">
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">color</Label>
              <Select value={formData.color || "none"} onValueChange={(v) => set("color", v === "none" ? "" : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-color">
                  <div className="flex items-center gap-2">
                    {formData.color && <span className={`w-2.5 h-2.5 rounded-full ${COLOR_DOT[formData.color] || ""}`} />}
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {COLOR_OPTIONS.map((c) => (
                    <SelectItem key={c.value || "none"} value={c.value || "none"}>
                      <div className="flex items-center gap-2">
                        {c.value && <span className={`w-2.5 h-2.5 rounded-full ${COLOR_DOT[c.value] || ""}`} />}
                        {c.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Repeat className="h-3 w-3" /> repeat</Label>
              <Select value={formData.repeat} onValueChange={(v) => set("repeat", v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-repeat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEAT_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Car className="h-3 w-3" /> travel time</Label>
              <Select value={formData.travelTime} onValueChange={(v) => set("travelTime", v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-travel-time">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAVEL_TIME_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bell className="h-3 w-3" /> alert</Label>
              <Select value={formData.alert} onValueChange={(v) => set("alert", v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-alert">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[240px]">
                  {ALERT_OPTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bell className="h-3 w-3" /> second alert</Label>
              <Select value={formData.secondAlert} onValueChange={(v) => set("secondAlert", v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-second-alert">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[240px]">
                  {ALERT_OPTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">show as</Label>
              <Select value={formData.showAs} onValueChange={(v) => set("showAs", v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-show-as">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHOW_AS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Eye className="h-3 w-3" /> visibility</Label>
              <Select value={formData.visibility} onValueChange={(v) => set("visibility", v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Add details..."
              className="resize-none"
              rows={3}
              data-testid="input-event-description"
            />
          </div>

          <div>
            <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Location</Label>
            <AddressAutocomplete
              onSelect={(_lat, _lng, displayName) => set("location", displayName)}
              placeholder="Search for a location..."
              testId="input-event-location"
            />
            {formData.location && (
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{formData.location}</span>
                <button type="button" onClick={() => set("location", "")} className="ml-auto">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-border/50 pt-3">
            <Label className="flex items-center gap-1.5 mb-2"><Users className="h-3.5 w-3.5" /> Invitees</Label>
            <div className="flex gap-2">
              <Input
                value={inviteeInput}
                onChange={(e) => setInviteeInput(e.target.value)}
                placeholder="Add email address..."
                className="h-9 text-sm"
                data-testid="input-invitee-email"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addInvitee(); } }}
              />
              <Button type="button" variant="outline" size="sm" onClick={addInvitee} className="h-9 px-3" data-testid="button-add-invitee">
                Add
              </Button>
            </div>
            {invitees.length > 0 && (
              <div className="mt-2 space-y-1">
                {invitees.map((email) => (
                  <div key={email} className="flex items-center justify-between text-sm bg-secondary/30 rounded px-2.5 py-1.5" data-testid={`invitee-${email}`}>
                    <span className="truncate">{email}</span>
                    <button type="button" onClick={() => removeInvitee(email)} className="ml-2 shrink-0" data-testid={`button-remove-invitee-${email}`}>
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 mt-4">
          <Button variant="ghost" onClick={onClose} data-testid="button-cancel-event">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !formData.title.trim()} data-testid="button-save-event">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {initialData ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventDetailDialog({
  event,
  onClose,
  onUpdate,
  onDelete,
  isUpdating,
  isDeleting,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onUpdate: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  isUpdating: boolean;
  isDeleting: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EventFormDialog
        open
        onClose={() => setEditing(false)}
        onSubmit={(data) => {
          onUpdate(data);
          setEditing(false);
        }}
        isPending={isUpdating}
        initialData={event}
      />
    );
  }

  const startDate = new Date(event.startTime);
  const endDate = event.endTime ? new Date(event.endTime) : null;
  const statusColor =
    event.status === "completed"
      ? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/25"
      : event.status === "cancelled"
        ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25"
        : "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25";

  const alertLabel = ALERT_OPTIONS.find((a) => a.value === event.alert)?.label || event.alert || "None";
  const secondAlertLabel = ALERT_OPTIONS.find((a) => a.value === event.secondAlert)?.label || event.secondAlert || "None";
  const repeatLabel = REPEAT_OPTIONS.find((r) => r.value === event.repeat)?.label || event.repeat || "None";
  const travelLabel = TRAVEL_TIME_OPTIONS.find((t) => t.value === event.travelTime)?.label || event.travelTime || "None";
  const showAsLabel = SHOW_AS_OPTIONS.find((s) => s.value === event.showAs)?.label || event.showAs || "Busy";
  const visibilityLabel = VISIBILITY_OPTIONS.find((v) => v.value === event.visibility)?.label || event.visibility || "Default";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <DialogTitle className="text-xl" data-testid="text-event-title">
                {event.title}
              </DialogTitle>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant="outline" className={EVENT_TYPE_COLORS[event.eventType] || ""}>
                  {event.eventType}
                </Badge>
                <Badge variant="outline" className={statusColor}>
                  {event.status}
                </Badge>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-2.5 mt-2 text-sm">
          {event.meetingUrl && (
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-muted-foreground shrink-0" />
              <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer" className="text-primary truncate" data-testid="link-meeting-url">
                Zoom Meeting URL
              </a>
            </div>
          )}

          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>
              {event.allDay
                ? format(startDate, "MMM d, yyyy")
                : `${format(startDate, "MMM d, yyyy h:mm a")}${endDate ? ` - ${format(endDate, "h:mm a")}` : ""}`}
            </span>
          </div>

          {event.timeZone && (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{event.timeZone}</span>
            </div>
          )}

          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}

          <div className="border-t border-border/30 pt-2 mt-2 grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">repeat</span><span>{repeatLabel}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">travel time</span><span>{travelLabel}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">alert</span><span>{alertLabel}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">2nd alert</span><span>{secondAlertLabel}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">show as</span><span>{showAsLabel}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">visibility</span><span>{visibilityLabel}</span></div>
          </div>

          {event.invitees && event.invitees.length > 0 && (
            <div className="border-t border-border/30 pt-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                <Users className="h-3.5 w-3.5" /> Invitees
              </div>
              <div className="space-y-1">
                {event.invitees.map((email) => (
                  <div key={email} className="text-xs bg-secondary/30 rounded px-2 py-1" data-testid={`detail-invitee-${email}`}>
                    {email}
                  </div>
                ))}
              </div>
            </div>
          )}

          {event.description && (
            <div className="border-t border-border/30 pt-2">
              <p className="text-muted-foreground">{event.description}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 mt-4">
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={isDeleting}
            data-testid="button-delete-event"
          >
            {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Delete
          </Button>
          <Button size="sm" onClick={() => setEditing(true)} data-testid="button-edit-event">
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
