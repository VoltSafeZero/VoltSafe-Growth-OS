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
} from "lucide-react";
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
      ? format(new Date(initialData.startTime), "HH:mm")
      : initialSlot?.hour !== undefined
        ? `${String(initialSlot.hour).padStart(2, "0")}:00`
        : format(new Date(), "HH:mm"),
    endDate: initialData?.endTime
      ? format(new Date(initialData.endTime), "yyyy-MM-dd")
      : defaultEnd
        ? format(defaultEnd, "yyyy-MM-dd")
        : "",
    endTime: initialData?.endTime
      ? format(new Date(initialData.endTime), "HH:mm")
      : defaultEnd
        ? format(defaultEnd, "HH:mm")
        : "",
    allDay: initialData?.allDay || false,
    location: initialData?.location || "",
    meetingUrl: initialData?.meetingUrl || "",
    color: initialData?.color || "",
    status: initialData?.status || "scheduled",
  });

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
    });
  };

  const set = (key: string, val: unknown) => setFormData((p) => ({ ...p, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? "Edit Event" : "New Event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input
              value={formData.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Event title"
              data-testid="input-event-title"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={formData.eventType} onValueChange={(v) => set("eventType", v)}>
                <SelectTrigger data-testid="select-event-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger data-testid="select-event-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
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
            <Label>All day</Label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={formData.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                data-testid="input-start-date"
              />
            </div>
            {!formData.allDay && (
              <div>
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                  data-testid="input-start-time"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>End Date</Label>
              <Input
                type="date"
                value={formData.endDate}
                onChange={(e) => set("endDate", e.target.value)}
                data-testid="input-end-date"
              />
            </div>
            {!formData.allDay && (
              <div>
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                  data-testid="input-end-time"
                />
              </div>
            )}
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Add details..."
              className="resize-none"
              data-testid="input-event-description"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Location</Label>
              <Input
                value={formData.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Location"
                data-testid="input-event-location"
              />
            </div>
            <div>
              <Label>Meeting URL</Label>
              <Input
                value={formData.meetingUrl}
                onChange={(e) => set("meetingUrl", e.target.value)}
                placeholder="https://..."
                data-testid="input-event-meeting-url"
              />
            </div>
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

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
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

        <div className="space-y-3 mt-2">
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span>
              {event.allDay
                ? format(startDate, "MMM d, yyyy")
                : `${format(startDate, "MMM d, yyyy h:mm a")}${endDate ? ` - ${format(endDate, "h:mm a")}` : ""}`}
            </span>
          </div>

          {event.location && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>{event.location}</span>
            </div>
          )}

          {event.meetingUrl && (
            <div className="flex items-center gap-2 text-sm">
              <Video className="h-4 w-4 text-muted-foreground" />
              <a
                href={event.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary truncate"
                data-testid="link-meeting-url"
              >
                Join Meeting
              </a>
            </div>
          )}

          {event.description && (
            <div className="border-t border-border/50 pt-3">
              <p className="text-sm text-muted-foreground">{event.description}</p>
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
