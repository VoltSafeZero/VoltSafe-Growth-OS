import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Calendar as CalendarIcon, MapPin, Users as UsersIcon, Video,
  Plus, RefreshCw, ChevronRight, CalendarPlus,
} from "lucide-react";
import { SiGooglecalendar, SiApple } from "react-icons/si";
import { format, isSameDay, addDays, startOfDay, endOfDay, differenceInMinutes } from "date-fns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ActionWidgetShell, type WidgetProps } from "@/components/command-centers/action-widgets";

// ── Types (mirror the API; keep loose to avoid coupling to schema) ────────────
type CalendarIntegration = {
  id: number;
  provider: string;            // "google" | "caldav" | "apple" | ...
  displayName: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  isActive?: boolean;
  syncEnabled?: boolean;
};

type CalendarEventLite = {
  id: number;
  title: string;
  description?: string | null;
  startTime: string;
  endTime: string;
  location?: string | null;
  meetingUrl?: string | null;
  attendees?: string[] | null;
  source?: string | null;       // "google" | "caldav" | "manual"
  isAllDay?: boolean;
};

// ── My Calendar — premium personal-calendar widget ────────────────────────────
//
// Replaces the old "Today's Meetings" widget. Differences:
//   • Pulls live events from the user's connected calendars (Google + CalDAV)
//     via /api/calendar/events instead of the read-only daily-command-center
//     aggregate. New events appear within one poll cycle.
//   • Shows a 7-day mini week-strip with event-density dots so the user can
//     glance at the week without leaving the dashboard.
//   • Inline "Connect calendar" empty-state — every user can hook up their own
//     Google or Apple/CalDAV calendar without leaving Today.
//   • Gracefully handles all-day events, video links, locations, attendee
//     counts, and "in N min / live now" badges.
//
// The widget keeps the public id `todays_meetings` so existing user layouts
// and visibility prefs continue to work without a migration.
export function MyCalendarWidget({ compact, isDragging, dragProps }: WidgetProps) {
  const { toast } = useToast();
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  // 7-day window starting today. Computed each render — same calendar day
  // produces the same ISO strings, so the react-query key is stable and we
  // don't refetch on every render. When the clock rolls past midnight the
  // strings change, the query key changes, and the next 60s poll naturally
  // picks up the new window. This avoids stale ranges in long-lived tabs.
  const startToday = startOfDay(new Date());
  const endWeek = endOfDay(addDays(startToday, 6));
  const range = {
    start: startToday,
    end: endWeek,
    startISO: startToday.toISOString(),
    endISO: endWeek.toISOString(),
  };

  const integrationsQuery = useQuery<CalendarIntegration[]>({
    queryKey: ["/api/calendar/integrations"],
    queryFn: async () => {
      const res = await fetch("/api/calendar/integrations", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
  });

  const eventsQuery = useQuery<CalendarEventLite[]>({
    queryKey: ["/api/calendar/events", range.startISO, range.endISO],
    queryFn: async () => {
      const params = new URLSearchParams({ start: range.startISO, end: range.endISO });
      const res = await fetch(`/api/calendar/events?${params}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    // Premium-client cadence: 60s poll while tab is foregrounded so newly
    // added meetings show up promptly without spamming the API.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const integrations = integrationsQuery.data ?? [];
  // Only treat *active* integrations as "connected" — a disconnected/disabled
  // row should drop the user back into the connect-calendar empty state.
  const activeIntegrations = integrations.filter((c) => c.isActive !== false);
  const hasIntegration = activeIntegrations.length > 0;
  const events = eventsQuery.data ?? [];
  const isLoading = integrationsQuery.isLoading || eventsQuery.isLoading;

  // Bucket events by day for the week strip + today/tomorrow lists.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEventLite[]>();
    for (const ev of events) {
      try {
        const key = format(new Date(ev.startTime), "yyyy-MM-dd");
        const arr = map.get(key) ?? [];
        arr.push(ev);
        map.set(key, arr);
      } catch { /* skip malformed */ }
    }
    // Sort each day's events by start time
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }
    return map;
  }, [events]);

  const today = startOfDay(new Date());
  const todayKey = format(today, "yyyy-MM-dd");
  const todayEvents = byDay.get(todayKey) ?? [];
  const tomorrowKey = format(addDays(today, 1), "yyyy-MM-dd");
  const tomorrowEvents = byDay.get(tomorrowKey) ?? [];

  // Trigger Google OAuth in the same window. The settings page does the same
  // (the auth-url endpoint already encodes the post-callback redirect).
  const connectGoogle = async () => {
    if (connectingGoogle) return; // belt-and-suspenders against rapid double clicks
    setConnectingGoogle(true);
    try {
      const res = await fetch("/api/calendar/integrations/google/auth-url", { credentials: "include" });
      if (!res.ok) throw new Error("Could not start Google sign-in");
      const { url } = await res.json();
      if (!url) throw new Error("Missing authorization URL");
      window.location.href = url;
    } catch (err: any) {
      setConnectingGoogle(false);
      toast({
        title: "Couldn't connect Google Calendar",
        description: err?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    }
  };

  // ── Empty state: no calendar connected yet ──────────────────────────────────
  if (!isLoading && !hasIntegration) {
    return (
      <ActionWidgetShell
        id="todays_meetings"
        icon={CalendarIcon}
        title="My Calendar"
        link="/settings"
        compact={compact}
        isDragging={isDragging}
        dragProps={dragProps}
      >
        <div className="flex flex-col items-center text-center py-3 px-2 gap-3" data-testid="my-calendar-empty">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <CalendarPlus className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Add your calendar</p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[260px]">
              See today's meetings here and let the CRM auto-link prep notes to the right contacts.
            </p>
          </div>
          <div className="w-full space-y-2 pt-1">
            <Button
              size="sm"
              className="w-full justify-center gap-2 h-9"
              onClick={connectGoogle}
              disabled={connectingGoogle}
              data-testid="button-connect-google-calendar"
            >
              {connectingGoogle ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SiGooglecalendar className="h-3.5 w-3.5" />
              )}
              {connectingGoogle ? "Opening Google…" : "Connect Google Calendar"}
            </Button>
            <Link href="/settings">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-center gap-2 h-9"
                data-testid="button-connect-apple-calendar"
              >
                <SiApple className="h-3.5 w-3.5" />
                Connect Apple / iCloud
              </Button>
            </Link>
          </div>
        </div>
      </ActionWidgetShell>
    );
  }

  // ── Connected: show 7-day strip + today's events + tomorrow preview ─────────
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const visibleToday = todayEvents.slice(0, 4);
  const overflowToday = Math.max(0, todayEvents.length - visibleToday.length);
  const visibleTomorrow = tomorrowEvents.slice(0, 2);
  const syncError = activeIntegrations.find((c) => c.syncError)?.syncError ?? null;

  return (
    <ActionWidgetShell
      id="todays_meetings"
      icon={CalendarIcon}
      title="My Calendar"
      count={todayEvents.length}
      link="/execution/calendar"
      compact={compact}
      isDragging={isDragging}
      dragProps={dragProps}
    >
      {isLoading && (
        <div className="space-y-2" data-testid="my-calendar-loading">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!isLoading && (
        <div className="space-y-3" data-testid="my-calendar-connected">
          {/* Week-strip */}
          <div className="grid grid-cols-7 gap-1" data-testid="calendar-week-strip">
            {weekDays.map((d) => {
              const key = format(d, "yyyy-MM-dd");
              const dayEvents = byDay.get(key) ?? [];
              const isCurrent = isSameDay(d, today);
              return (
                <Link key={key} href={`/execution/calendar?date=${key}`} className="block">
                  <div
                    className={`flex flex-col items-center rounded-md py-1.5 cursor-pointer transition-colors ${
                      isCurrent
                        ? "bg-primary/15 ring-1 ring-primary/40 hover:bg-primary/20"
                        : "hover:bg-muted/60"
                    }`}
                    data-testid={`week-strip-${key}`}
                    title={format(d, "EEEE, MMMM d")}
                  >
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 leading-none">
                      {format(d, "EEEEE")}
                    </span>
                    <span className={`text-sm font-semibold leading-tight ${isCurrent ? "text-primary" : "text-foreground"}`}>
                      {format(d, "d")}
                    </span>
                    <div className="flex items-center justify-center gap-0.5 h-1.5 mt-0.5">
                      {dayEvents.slice(0, 3).map((_, i) => (
                        <span
                          key={i}
                          className={`h-1 w-1 rounded-full ${isCurrent ? "bg-primary" : "bg-muted-foreground/50"}`}
                        />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className={`h-1 w-1.5 rounded-full ${isCurrent ? "bg-primary" : "bg-muted-foreground/50"}`} />
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Sync error banner (rare, but worth surfacing) */}
          {syncError && (
            <div className="text-[11px] text-amber-500 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5" data-testid="calendar-sync-error">
              Sync issue: {syncError}. <Link href="/settings"><span className="underline">Fix in Settings</span></Link>
            </div>
          )}

          {/* Today's events */}
          {todayEvents.length === 0 ? (
            <div className="text-center py-3 px-2" data-testid="calendar-no-meetings-today">
              <p className="text-sm text-muted-foreground">
                No meetings today — clear schedule.
              </p>
              {tomorrowEvents.length > 0 && (
                <p className="text-xs text-muted-foreground/70 mt-1">
                  {tomorrowEvents.length} {tomorrowEvents.length === 1 ? "event" : "events"} tomorrow
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Today · {format(today, "EEE, MMM d")}
                </p>
              </div>
              {visibleToday.map((ev) => (
                <CalendarEventRow key={ev.id} event={ev} />
              ))}
              {overflowToday > 0 && (
                <Link href="/execution/calendar">
                  <button
                    className="text-xs text-primary hover:underline w-full text-left pl-2 mt-1"
                    data-testid="button-more-today"
                  >
                    + {overflowToday} more today
                  </button>
                </Link>
              )}
            </div>
          )}

          {/* Tomorrow preview */}
          {visibleTomorrow.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-border/40">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium pt-2">
                Tomorrow · {format(addDays(today, 1), "EEE, MMM d")}
              </p>
              {visibleTomorrow.map((ev) => (
                <CalendarEventRow key={ev.id} event={ev} muted />
              ))}
            </div>
          )}

          {/* Footer link */}
          <div className="flex items-center justify-between pt-1 border-t border-border/40">
            <Link href="/execution/calendar">
              <button className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5" data-testid="link-open-calendar">
                Open full calendar <ChevronRight className="h-3 w-3" />
              </button>
            </Link>
            <Link href="/execution/calendar?create=1">
              <button className="text-xs text-primary hover:underline inline-flex items-center gap-1" data-testid="button-add-event">
                <Plus className="h-3 w-3" /> Event
              </button>
            </Link>
          </div>
        </div>
      )}
    </ActionWidgetShell>
  );
}

// ── Single event row ──────────────────────────────────────────────────────────
function CalendarEventRow({ event, muted }: { event: CalendarEventLite; muted?: boolean }) {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const now = new Date();
  const minsToStart = differenceInMinutes(start, now);
  const isLive = start <= now && end >= now;
  const isPast = end < now;
  const isAllDay = !!event.isAllDay;

  const timeLabel = isAllDay
    ? "All day"
    : `${format(start, "h:mm a")}`;

  // Status pill: "Now" / "in 12m" / "in 2h" / past => no pill
  let statusPill: { label: string; cls: string } | null = null;
  if (isLive) {
    statusPill = { label: "Now", cls: "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 ring-1 ring-emerald-500/30" };
  } else if (!isPast && minsToStart <= 60) {
    statusPill = { label: `in ${minsToStart}m`, cls: "bg-primary/15 text-primary ring-1 ring-primary/30" };
  } else if (!isPast && minsToStart <= 240 && minsToStart > 60) {
    statusPill = { label: `in ${Math.round(minsToStart / 60)}h`, cls: "bg-muted text-muted-foreground ring-1 ring-border" };
  }

  // Subtitle: location, conferencing, or attendee count — pick the strongest signal
  const meetingUrl = event.meetingUrl ?? extractMeetingUrl(event.description ?? "");
  const subtitleParts: { icon: any; text: string }[] = [];
  if (event.location) subtitleParts.push({ icon: MapPin, text: event.location });
  else if (meetingUrl) subtitleParts.push({ icon: Video, text: prettyMeetingHost(meetingUrl) });
  else if (event.attendees && event.attendees.length > 1) {
    subtitleParts.push({ icon: UsersIcon, text: `${event.attendees.length} attendees` });
  }

  return (
    <div
      className={`flex items-start gap-2 py-1.5 px-2 -mx-2 rounded-md hover:bg-muted/40 transition-colors ${
        isPast ? "opacity-60" : ""
      } ${muted ? "opacity-80" : ""}`}
      data-testid={`calendar-event-${event.id}`}
    >
      <div className="flex flex-col items-end shrink-0 w-14 pt-0.5">
        <span className={`text-xs font-medium leading-tight ${isLive ? "text-emerald-500 dark:text-emerald-400" : "text-foreground"}`}>
          {timeLabel}
        </span>
        {!isAllDay && (
          <span className="text-[10px] text-muted-foreground leading-tight">
            {format(end, "h:mm a")}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium text-foreground truncate" title={event.title}>
            {event.title || "(no title)"}
          </p>
          {statusPill && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${statusPill.cls}`}>
              {statusPill.label}
            </span>
          )}
        </div>
        {subtitleParts.length > 0 && (() => {
          const SubIcon = subtitleParts[0].icon;
          return (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5 min-w-0">
              <SubIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">{subtitleParts[0].text}</span>
            </div>
          );
        })()}
      </div>
      {meetingUrl && !isPast && (
        <a
          href={meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary transition-colors"
          title="Join meeting"
          data-testid={`button-join-${event.id}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Video className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

// Loose URL detector for descriptions that paste in a Zoom/Meet/Teams link.
const MEETING_URL_RE = /https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com|gotomeeting\.com|whereby\.com|tldv\.io|around\.co)\S*/i;
function extractMeetingUrl(text: string): string | null {
  const m = text.match(MEETING_URL_RE);
  return m ? m[0] : null;
}
function prettyMeetingHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("zoom.us")) return "Zoom";
    if (host.includes("meet.google.com")) return "Google Meet";
    if (host.includes("teams.microsoft.com")) return "Teams";
    if (host.includes("webex.com")) return "Webex";
    if (host.includes("whereby.com")) return "Whereby";
    return host;
  } catch {
    return "Video call";
  }
}
