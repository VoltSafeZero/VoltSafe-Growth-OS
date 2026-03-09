import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Clock, Video, MapPin, CheckCircle2, XCircle, Phone, Bell } from "lucide-react";
import { Link } from "wouter";
import type { CalendarEvent } from "@shared/schema";

const EVENT_TYPE_CONFIG: Record<string, { icon: typeof Calendar; label: string }> = {
  meeting: { icon: Video, label: "Meeting" },
  call: { icon: Phone, label: "Call" },
  task: { icon: CheckCircle2, label: "Task" },
  reminder: { icon: Bell, label: "Reminder" },
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  scheduled: "outline",
  completed: "secondary",
  cancelled: "destructive",
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function DashboardCalendar() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const { data: events, isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar/events", { start: startOfDay.toISOString(), end: endOfDay.toISOString() }],
    queryFn: async () => {
      const res = await fetch(
        `/api/calendar/events?start=${startOfDay.toISOString()}&end=${endOfDay.toISOString()}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch calendar events");
      return res.json();
    },
  });

  const todayEvents = (events || [])
    .filter((e) => {
      const start = new Date(e.startTime);
      return isToday(start) && e.status !== "cancelled";
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const upcoming = todayEvents.filter((e) => new Date(e.startTime).getTime() >= now.getTime());
  const past = todayEvents.filter((e) => new Date(e.startTime).getTime() < now.getTime());

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50" data-testid="card-dashboard-calendar">
        <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2 space-y-0">
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-dashboard-calendar">
      <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2 space-y-0">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          Today's Schedule
        </CardTitle>
        <div className="flex items-center gap-2">
          {todayEvents.length > 0 && (
            <Badge variant="outline" className="text-xs" data-testid="badge-event-count">
              {todayEvents.length}
            </Badge>
          )}
          <Link href="/calendar" className="text-xs text-primary hover:underline" data-testid="link-view-calendar">View all</Link>
        </div>
      </CardHeader>
      <CardContent>
        {todayEvents.length === 0 ? (
          <div className="text-center py-6" data-testid="text-no-events">
            <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">No events scheduled today</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {upcoming.length > 0 && (
              <>
                {upcoming.map((event) => (
                  <EventRow key={event.id} event={event} isUpcoming />
                ))}
              </>
            )}
            {past.length > 0 && (
              <>
                {upcoming.length > 0 && (
                  <div className="border-t border-border/50 my-2" />
                )}
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1">Earlier</p>
                {past.map((event) => (
                  <EventRow key={event.id} event={event} isUpcoming={false} />
                ))}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventRow({ event, isUpcoming }: { event: CalendarEvent; isUpcoming: boolean }) {
  const start = new Date(event.startTime);
  const end = event.endTime ? new Date(event.endTime) : null;
  const config = EVENT_TYPE_CONFIG[event.eventType] || EVENT_TYPE_CONFIG.meeting;
  const Icon = config.icon;
  const statusVariant = STATUS_VARIANT[event.status] || "outline";

  return (
    <Link
      href="/calendar"
      className={`flex items-start gap-3 p-2 rounded-md transition-colors hover:bg-secondary/30 cursor-pointer ${isUpcoming ? "" : "opacity-60"}`}
      data-testid={`calendar-event-${event.id}`}
    >
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate" data-testid={`text-event-title-${event.id}`}>
          {event.title}
        </p>
        <div className="flex items-center gap-2 flex-wrap mt-0.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {event.allDay
              ? "All day"
              : `${formatTime(start)}${end ? ` – ${formatTime(end)}` : ""}`}
          </span>
          {event.location && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              <span className="truncate max-w-[100px]">{event.location}</span>
            </span>
          )}
          {event.status === "completed" && (
            <Badge variant={statusVariant} className="text-[10px] px-1.5 py-0">
              <CheckCircle2 className="w-3 h-3 mr-0.5" />
              Done
            </Badge>
          )}
          {event.status === "cancelled" && (
            <Badge variant={statusVariant} className="text-[10px] px-1.5 py-0">
              <XCircle className="w-3 h-3 mr-0.5" />
              Cancelled
            </Badge>
          )}
        </div>
      </div>
    </Link>
  );
}
