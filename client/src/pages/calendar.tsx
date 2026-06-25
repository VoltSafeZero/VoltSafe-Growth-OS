import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
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
  RefreshCw,
  Settings2,
  Building2,
  Mail,
  TrendingUp,
  Zap,
  UserPlus,
  CheckCheck,
  CheckSquare,
  ExternalLink,
  ArrowRight,
  ClipboardList,
  CalendarPlus,
  ChevronDown,
  CircleCheck,
  AlertTriangle,
  Sparkles,
  Bot,
  Mic,
  GripVertical,
  CalendarCheck,
} from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
  formatDistanceToNow,
  startOfDay,
  endOfDay,
} from "date-fns";
import type { CalendarEvent } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";

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

const TEAM_OVERLAY_COLORS = [
  { bg: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25", dot: "bg-rose-500", cb: "accent-rose-500" },
  { bg: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25", dot: "bg-cyan-500", cb: "accent-cyan-500" },
  { bg: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25", dot: "bg-amber-500", cb: "accent-amber-500" },
  { bg: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/25", dot: "bg-violet-500", cb: "accent-violet-500" },
  { bg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25", dot: "bg-emerald-500", cb: "accent-emerald-500" },
];

type TeamMember = { id: number; name: string; email: string; globalRole: string };

type DisplayEvent = CalendarEvent & {
  _team?: { name: string; colorBg: string };
};

type BusyBlock = { start: string; end: string };
type TeamMemberAvailability = {
  userId: number;
  name: string;
  email: string;
  status: "available" | "not_connected" | "reconnect_required" | "unavailable";
  busyBlocks: BusyBlock[];
};
type TeamAvailabilityResponse = { date: string; users: TeamMemberAvailability[] };

// Suggested opening window
type OpenWindow = { start: Date; end: Date };

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
  // Day view: always start at midnight so morning events are never missed
  return { start: startOfDay(currentDate), end: endOfDay(currentDate) };
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

function useTeamCalendarEvents(currentDate: Date, view: ViewMode, enabledIds: number[]) {
  const range = getViewRange(currentDate, view);
  const startStr = range.start.toISOString();
  const endStr = new Date(range.end.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const idsStr = [...enabledIds].sort().join(",");

  return useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar/events/team", startStr, endStr, idsStr],
    queryFn: async () => {
      if (enabledIds.length === 0) return [];
      const res = await fetch(`/api/calendar/events/team?start=${startStr}&end=${endStr}&userIds=${idsStr}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: enabledIds.length > 0,
  });
}

function useTeamAvailability(date: Date, enabledIds: number[], view: ViewMode) {
  const dateStr = format(date, "yyyy-MM-dd");
  const idsStr = [...enabledIds].sort().join(",");
  return useQuery<TeamAvailabilityResponse>({
    queryKey: ["/api/calendar/team-availability", dateStr, idsStr],
    queryFn: async () => {
      if (enabledIds.length === 0) return { date: dateStr, users: [] };
      const res = await fetch(`/api/calendar/team-availability?date=${dateStr}&userIds=${idsStr}`, { credentials: "include" });
      if (!res.ok) return { date: dateStr, users: [] };
      return res.json();
    },
    enabled: view === "day" && enabledIds.length > 0,
    staleTime: 5 * 60_000,
  });
}

// Compute suggested open windows for the day, given own events + teammates' busy blocks.
// Workday 8am–6pm, minimum 30-minute slot, returns top 3.
function computeSuggestedOpenings(
  date: Date,
  ownEvents: CalendarEvent[],
  teamAvail: TeamMemberAvailability[]
): OpenWindow[] {
  const WORKDAY_START = 8;
  const WORKDAY_END = 18;
  const SLOT_MINUTES = 30;

  // Collect all blocked ranges for this day
  const blocked: { start: Date; end: Date }[] = [];

  const dayEvents = ownEvents.filter(e => isSameDay(new Date(e.startTime), date));
  for (const ev of dayEvents) {
    const s = new Date(ev.startTime);
    const e = ev.endTime ? new Date(ev.endTime) : new Date(s.getTime() + 30 * 60_000);
    blocked.push({ start: s, end: e });
  }

  for (const member of teamAvail) {
    if (member.status !== "available") continue;
    for (const b of member.busyBlocks) {
      blocked.push({ start: new Date(b.start), end: new Date(b.end) });
    }
  }

  const workStart = new Date(date);
  workStart.setHours(WORKDAY_START, 0, 0, 0);
  const workEnd = new Date(date);
  workEnd.setHours(WORKDAY_END, 0, 0, 0);

  const windows: OpenWindow[] = [];
  let cursor = workStart.getTime();

  while (cursor + SLOT_MINUTES * 60_000 <= workEnd.getTime()) {
    const slotEnd = cursor + SLOT_MINUTES * 60_000;
    const overlaps = blocked.some(b => b.start.getTime() < slotEnd && b.end.getTime() > cursor);
    if (!overlaps) {
      // Extend this window as long as possible
      let extEnd = slotEnd;
      while (extEnd + SLOT_MINUTES * 60_000 <= workEnd.getTime()) {
        const nextEnd = extEnd + SLOT_MINUTES * 60_000;
        const nextOverlaps = blocked.some(b => b.start.getTime() < nextEnd && b.end.getTime() > extEnd);
        if (nextOverlaps) break;
        extEnd = nextEnd;
      }
      windows.push({ start: new Date(cursor), end: new Date(extEnd) });
      cursor = extEnd;
    } else {
      cursor += SLOT_MINUTES * 60_000;
    }
  }

  return windows.slice(0, 3);
}

// ── Event classification helper (Phase 6) ─────────────────────────────────────
const INTERNAL_DOMAIN = "voltsafe.com";
const GENERIC_DOMAINS_SET = new Set([
  "gmail.com","googlemail.com","outlook.com","hotmail.com","yahoo.com",
  "icloud.com","me.com","mac.com","live.com","msn.com","protonmail.com","aol.com","ymail.com",
]);

type EventClassification = {
  isInternal: boolean;
  isExternal: boolean;
  hasBusinessDomain: boolean;
  needsPrep: boolean;
  isFocusBlock: boolean;
  isAllDay: boolean;
  externalCount: number;
};

function classifyCalendarEvent(event: DisplayEvent): EventClassification {
  const attendees: Array<{ email?: string; self?: boolean }> = Array.isArray(event.attendeeDetails)
    ? (event.attendeeDetails as any[])
    : (event.invitees || []).map((e: string) => ({ email: e }));

  const external = attendees.filter(a => {
    const em = (a.email || "").toLowerCase().trim();
    const domain = em.split("@")[1] || "";
    return !a.self && em.includes("@") && domain !== INTERNAL_DOMAIN;
  });

  const hasBusinessDomain = external.some(a => {
    const domain = (a.email || "").toLowerCase().split("@")[1] || "";
    return !GENERIC_DOMAINS_SET.has(domain);
  });

  const isFocusBlock = /^focus:/i.test(event.title || "");
  const isAllDay = !!event.allDay;
  const isExternal = external.length > 0;
  const isInternal = !isExternal;

  const now = new Date();
  const startTime = new Date(event.startTime);
  const upcoming = startTime > now;
  const needsPrep = isExternal && upcoming && !isFocusBlock && event.status !== "cancelled";

  return { isInternal, isExternal, hasBusinessDomain, needsPrep, isFocusBlock, isAllDay, externalCount: external.length };
}

// ── Workday Agenda panel (Phase 1) ────────────────────────────────────────────
function WorkdayAgendaPanel({
  events,
  tasks,
  onEventClick,
}: {
  events: DisplayEvent[];
  tasks: any[];
  onEventClick: (ev: DisplayEvent) => void;
}) {
  const today = new Date();

  const todayEvents = events.filter(e =>
    isSameDay(new Date(e.startTime), today) &&
    !e._team &&
    e.status !== "cancelled"
  );

  const nextMeeting = todayEvents
    .filter(e => !e.allDay && new Date(e.startTime) > today)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0] ?? null;

  const needsPrepEvents = todayEvents
    .filter(e => classifyCalendarEvent(e).needsPrep)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 3);

  const followupsDue = tasks
    .filter(t => {
      if (!t.dueDate) return false;
      const due = new Date(t.dueDate);
      const startOfTomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      return due < startOfTomorrow;
    })
    .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 3);

  const focusWindows = computeSuggestedOpenings(
    today,
    events.filter(e => !e._team),
    []
  ).slice(0, 2);

  const hasContent = nextMeeting || needsPrepEvents.length > 0 || followupsDue.length > 0 || focusWindows.length > 0;
  if (!hasContent) return null;

  return (
    <Card className="border-border/50 w-52 shrink-0" data-testid="workday-agenda-panel">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <CalendarCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Today's Agenda</span>
        </div>
        <div className="space-y-3">
          {nextMeeting && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Next Meeting</p>
              <button
                className="w-full text-left rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2 hover:bg-primary/10 transition-colors"
                onClick={() => onEventClick(nextMeeting)}
                data-testid="agenda-next-meeting"
              >
                <p className="text-xs font-medium truncate text-foreground">{nextMeeting.title}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{formatTime(new Date(nextMeeting.startTime))}</p>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {nextMeeting.meetingUrl && <Video className="h-3 w-3 text-blue-400 shrink-0" />}
                  {(() => {
                    const cls = classifyCalendarEvent(nextMeeting);
                    return cls.externalCount > 0 ? (
                      <span className="text-[9px] px-1 rounded bg-foreground/10 border border-border/40">{cls.externalCount} ext</span>
                    ) : null;
                  })()}
                </div>
              </button>
            </div>
          )}

          {needsPrepEvents.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Needs Prep</p>
              <div className="space-y-1">
                {needsPrepEvents.map(ev => (
                  <button
                    key={ev.id}
                    className="w-full text-left rounded border border-border/40 bg-secondary/20 px-2 py-1.5 hover:bg-secondary/40 transition-colors"
                    onClick={() => onEventClick(ev)}
                    data-testid={`agenda-prep-${ev.id}`}
                  >
                    <p className="text-xs font-medium truncate">{ev.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{formatTime(new Date(ev.startTime))}</span>
                      {ev.meetingUrl && <Video className="h-3 w-3 text-blue-400 shrink-0" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {followupsDue.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Follow-ups Due</p>
              <div className="space-y-1">
                {followupsDue.map((t: any) => {
                  const due = new Date(t.dueDate);
                  const overdue = due < today && !isToday(due);
                  return (
                    <Link key={t.id} href="/tasks">
                      <div
                        className="rounded border border-border/40 bg-secondary/20 px-2 py-1.5 hover:bg-secondary/40 transition-colors cursor-pointer"
                        data-testid={`agenda-followup-${t.id}`}
                      >
                        <p className="text-xs font-medium truncate">{t.title}</p>
                        <p className={`text-[10px] ${overdue ? "text-red-400" : "text-amber-400"}`}>
                          {overdue ? "Overdue" : "Due today"}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {focusWindows.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Open Windows</p>
              <div className="space-y-1">
                {focusWindows.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded bg-primary/5 border border-primary/15"
                    data-testid={`agenda-window-${i}`}
                  >
                    <Zap className="h-3 w-3 text-primary shrink-0" />
                    <span>{format(w.start, "h:mm")}–{format(w.end, "h:mm a")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type CalendarPageProps = {
  permissions?: { calendar_team?: number[]; [k: string]: unknown };
  currentUserId?: number;
  isAdmin?: boolean;
};

export default function CalendarPage({ permissions, currentUserId, isAdmin }: CalendarPageProps = {}) {
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    if (d) {
      try {
        const parsed = parseISO(d);
        if (!isNaN(parsed.getTime())) return startOfDay(parsed);
      } catch {}
    }
    return new Date();
  });
  const [view, setView] = useState<ViewMode>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("date") ? "day" : "day";
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [clickedSlot, setClickedSlot] = useState<{ date: Date; hour?: number } | null>(null);
  const [rescheduleRequest, setRescheduleRequest] = useState<{
    event: DisplayEvent;
    newStartTime: Date;
    newEndTime: Date | null;
  } | null>(null);
  const [enabledOverlays, setEnabledOverlays] = useState<Set<number>>(new Set());
  // Phase 1/2/3: task scheduling state
  const [scheduledTaskIds, setScheduledTaskIds] = useState<Set<number>>(() => new Set());
  const [confirmSchedule, setConfirmSchedule] = useState<{ taskId: number; task: any; window: OpenWindow } | null>(null);
  const [popoverOpenTaskId, setPopoverOpenTaskId] = useState<number | null>(null);
  const { toast } = useToast();

  const [syncingAll, setSyncingAll] = useState(false);
  const calendarTeamIds: number[] = permissions?.calendar_team ?? [];
  const showOverlayPanel = isAdmin || calendarTeamIds.length > 0;

  // Calendar integrations — for sync status badge
  const { data: calIntegrations = [] } = useQuery<{
    id: number;
    provider: string;
    displayName: string | null;
    lastSyncedAt: string | null;
    syncError: string | null;
  }[]>({
    queryKey: ["/api/calendar/integrations"],
    refetchInterval: 60_000,
  });

  // Calendar sources — which Google calendars to show
  const { data: sourcesData, refetch: refetchSources } = useQuery<{
    sources: { id: string; name: string; color: string | null; accessRole: string; primary: boolean }[];
    selectedIds: string[] | null;
    connectionId: number;
  }>({
    queryKey: ["/api/calendar/sources"],
    staleTime: 5 * 60_000,
  });

  const sourceSelectionMutation = useMutation({
    mutationFn: async ({ connectionId, selectedIds }: { connectionId: number; selectedIds: string[] | null }) => {
      const res = await apiRequest("POST", "/api/calendar/sources/select", { connectionId, selectedIds });
      return res.json();
    },
    onSuccess: () => {
      refetchSources();
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
    },
  });

  const toggleCalendarSource = (sourceId: string) => {
    if (!sourcesData) return;
    const all = sourcesData.sources.map(s => s.id);
    const current = sourcesData.selectedIds ?? all;
    const next = current.includes(sourceId)
      ? current.filter(id => id !== sourceId)
      : [...current, sourceId];
    sourceSelectionMutation.mutate({ connectionId: sourcesData.connectionId, selectedIds: next.length === all.length ? null : next });
  };

  const lastSyncTime = calIntegrations
    .map((c) => (c.lastSyncedAt ? new Date(c.lastSyncedAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);

  const syncNowAll = async () => {
    if (calIntegrations.length === 0) return;
    setSyncingAll(true);
    try {
      await Promise.all(
        calIntegrations.map((c) =>
          fetch(`/api/calendar/integrations/${c.id}/sync`, {
            method: "POST",
            credentials: "include",
          })
        )
      );
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      toast({ title: "Sync complete", description: "All calendars synced." });
    } catch {
      toast({ title: "Sync failed", description: "One or more calendars could not sync.", variant: "destructive" });
    } finally {
      setSyncingAll(false);
    }
  };

  const teamMembersQuery = useQuery<TeamMember[]>({
    queryKey: ["/api/admin/team-members"],
    queryFn: async () => {
      const res = await fetch("/api/admin/team-members", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showOverlayPanel,
  });

  const permittedMembers: (TeamMember & { colorIdx: number })[] = (teamMembersQuery.data ?? [])
    .filter((m) => m.id !== currentUserId && (isAdmin || calendarTeamIds.includes(m.id)))
    .map((m, i) => ({ ...m, colorIdx: i % TEAM_OVERLAY_COLORS.length }));

  const enabledIdsList = [...enabledOverlays].filter((id) => permittedMembers.some((m) => m.id === id));
  const { data: teamEvents } = useTeamCalendarEvents(currentDate, view, enabledIdsList);
  const { data: availability, isLoading: availLoading } = useTeamAvailability(currentDate, enabledIdsList, view);

  const { data: ownEvents, isLoading } = useCalendarEvents(currentDate, view);

  // Pending tasks due within the next 7 days (for Tasks to Schedule panel)
  const { data: pendingTasks } = useQuery<any[]>({
    queryKey: ["/api/tasks", "pending", "calendar"],
    queryFn: async () => {
      const res = await fetch("/api/tasks?status=pending", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  // Build busy block overlays for DayView (privacy-safe: no event titles)
  const teamBusyOverlays = useMemo(() => {
    if (!availability) return [];
    return availability.users
      .filter(u => u.status === "available" && u.busyBlocks.length > 0)
      .map(u => {
        const member = permittedMembers.find(m => m.id === u.userId);
        return { ...u, colorIdx: member?.colorIdx ?? 0 };
      });
  }, [availability, permittedMembers]);

  // Suggested openings (only in day view with teammates selected)
  const suggestedOpenings = useMemo(() => {
    if (view !== "day" || enabledIdsList.length === 0 || !availability) return [];
    return computeSuggestedOpenings(currentDate, ownEvents ?? [], availability.users);
  }, [view, enabledIdsList, availability, currentDate, ownEvents]);

  // Tasks due within 7 days or overdue (for Tasks to Schedule panel)
  const dueTasks = useMemo(() => {
    if (!pendingTasks) return [];
    const now = Date.now();
    const sevenDays = now + 7 * 24 * 60 * 60_000;
    return pendingTasks
      .filter((t: any) => t.dueDate && new Date(t.dueDate).getTime() <= sevenDays)
      .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, 5);
  }, [pendingTasks]);

  const allEvents: DisplayEvent[] = [
    ...(ownEvents ?? []),
    ...(teamEvents ?? []).map((ev) => {
      const member = permittedMembers.find((m) => m.id === ev.userId);
      return {
        ...ev,
        _team: member
          ? { name: member.name, colorBg: TEAM_OVERLAY_COLORS[member.colorIdx].bg }
          : undefined,
      } as DisplayEvent;
    }),
  ];

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

  // Phase 1/3/4: dedicated focus-block scheduler with confirmation + duplicate prevention
  const scheduleFocusMutation = useMutation({
    mutationFn: async ({ task, window: w }: { task: any; window: OpenWindow }) => {
      const descParts = [
        `Focus block for: ${task.title}`,
        task.id ? `Task ID: ${task.id}` : null,
        task.dueDate ? `Original due: ${format(new Date(task.dueDate), "MMM d, yyyy")}` : null,
        task.linkedObjectType && task.linkedObjectId
          ? `Linked: ${task.linkedObjectType} #${task.linkedObjectId}`
          : null,
        `Created from VoltSafe CMS`,
      ].filter(Boolean).join("\n");
      const res = await apiRequest("POST", "/api/calendar/events", {
        title: `Focus: ${task.title}`,
        startTime: w.start.toISOString(),
        endTime: w.end.toISOString(),
        eventType: "task",
        status: "scheduled",
        description: descParts,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Failed to create focus block");
      }
      return res.json();
    },
    onSuccess: (_, { task }) => {
      setScheduledTaskIds(prev => new Set([...prev, task.id]));
      setConfirmSchedule(null);
      setPopoverOpenTaskId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      toast({ title: "Focus block created", description: `"Focus: ${task.title}" added to your calendar.` });
    },
    onError: (err: Error) => {
      toast({ title: "Could not create focus block", description: err.message, variant: "destructive" });
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

  const rescheduleMutation = useMutation({
    mutationFn: async ({
      id, startTime, endTime, notify, prevStartTime, prevEndTime,
    }: {
      id: number; startTime: Date; endTime: Date | null;
      notify: boolean; prevStartTime: Date; prevEndTime: Date | null;
    }) => {
      await apiRequest("PUT", `/api/calendar/events/${id}`, {
        startTime: startTime.toISOString(),
        endTime: endTime?.toISOString() ?? null,
      });
      if (notify) {
        await apiRequest("POST", `/api/calendar/events/${id}/notify-reschedule`, {
          previousStartTime: prevStartTime.toISOString(),
          previousEndTime: prevEndTime?.toISOString() ?? null,
        });
      }
    },
    onSuccess: (_, { notify }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      setRescheduleRequest(null);
      toast({
        title: notify ? "Event moved & attendees notified" : "Event moved",
        description: notify ? "Reschedule notifications sent to all attendees." : undefined,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to reschedule", description: err.message, variant: "destructive" });
    },
  });

  const handleReschedule = useCallback((event: DisplayEvent, newStartTime: Date, newEndTime: Date | null) => {
    if (event._team) return;
    setRescheduleRequest({ event, newStartTime, newEndTime });
  }, []);

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

  const toggleOverlay = (id: number) => {
    setEnabledOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {calIntegrations.length > 0 && (
            <div className="flex items-center gap-2">
              {lastSyncTime > 0 && (
                <span className="text-xs text-muted-foreground hidden sm:inline" data-testid="text-last-sync-all">
                  Synced {formatDistanceToNow(lastSyncTime, { addSuffix: true })}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={syncNowAll}
                disabled={syncingAll}
                className="h-8 text-xs gap-1.5"
                data-testid="button-sync-now"
              >
                {syncingAll ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Sync
              </Button>
            </div>
          )}
          <Link href="/settings">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Calendar Settings"
              data-testid="button-calendar-settings"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </Link>
          <Button onClick={() => { setClickedSlot(null); setCreateOpen(true); }} data-testid="button-create-event">
            <Plus className="mr-2 h-4 w-4" /> New Event
          </Button>
        </div>
      </div>

      <MetricsBar />

      {/* Sync error / reconnect banner */}
      {calIntegrations.some(c => c.syncError) && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="font-medium text-destructive">Calendar sync issue — </span>
            <span className="text-muted-foreground">
              {calIntegrations.find(c => c.syncError)?.syncError}
            </span>
          </div>
          <Link href="/settings">
            <Button variant="outline" size="sm" className="h-7 text-xs shrink-0">
              Reconnect
            </Button>
          </Link>
        </div>
      )}

      {/* No calendar connected info banner */}
      {calIntegrations.length === 0 && !isLoading && (
        <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm" data-testid="no-calendar-banner">
          <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="font-medium">No calendar connected — </span>
            <span className="text-muted-foreground">Connect Google Calendar in Settings to see your events here.</span>
          </div>
          <Link href="/settings">
            <Button variant="outline" size="sm" className="h-7 text-xs shrink-0">
              Connect
            </Button>
          </Link>
        </div>
      )}

      <div className={(showOverlayPanel && permittedMembers.length > 0) || (sourcesData && sourcesData.sources.length > 0) || dueTasks.length > 0 || isToday(currentDate) ? "flex gap-4 items-start" : undefined}>
        <Card className="border-border/50 flex-1 min-w-0">
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
                events={allEvents}
                onSlotClick={handleSlotClick}
                onEventClick={(ev) => { if (!ev._team) setSelectedEvent(ev); }}
                onDayClick={(d) => { setCurrentDate(d); setView("day"); }}
              />
            ) : view === "week" ? (
              <WeekView
                currentDate={currentDate}
                events={allEvents}
                onSlotClick={handleSlotClick}
                onEventClick={(ev) => { if (!ev._team) setSelectedEvent(ev); }}
                onReschedule={handleReschedule}
              />
            ) : (
              <DayView
                currentDate={currentDate}
                events={allEvents}
                onSlotClick={handleSlotClick}
                onEventClick={(ev) => { if (!ev._team) setSelectedEvent(ev); }}
                onReschedule={handleReschedule}
                busyOverlays={teamBusyOverlays}
                availLoading={availLoading && enabledIdsList.length > 0}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          {/* Workday Agenda — always shown for today (Phase 1) */}
          {isToday(currentDate) && (
            <WorkdayAgendaPanel
              events={ownEvents ?? []}
              tasks={pendingTasks ?? []}
              onEventClick={(ev) => setSelectedEvent(ev)}
            />
          )}

          {/* My Calendars — sources selector */}
          {sourcesData && sourcesData.sources.length > 0 && (
            <Card className="border-border/50 w-52 shrink-0" data-testid="my-calendars-panel">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-3">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">My Calendars</span>
                </div>
                <div className="space-y-2">
                  {sourcesData.sources.map((src) => {
                    const allIds = sourcesData.sources.map(s => s.id);
                    const current = sourcesData.selectedIds ?? allIds;
                    const checked = current.includes(src.id);
                    return (
                      <label
                        key={src.id}
                        className="flex items-center gap-2 cursor-pointer group"
                        data-testid={`source-cal-${src.id}`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleCalendarSource(src.id)}
                          data-testid={`checkbox-source-${src.id}`}
                        />
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: src.color || "#14b8a6" }}
                        />
                        <span className="text-xs truncate group-hover:text-foreground text-muted-foreground transition-colors" title={src.name}>
                          {src.name}
                          {src.primary && <span className="ml-1 opacity-50">(primary)</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Team Calendars — overlay */}
          {showOverlayPanel && permittedMembers.length > 0 && (
            <Card className="border-border/50 w-52 shrink-0" data-testid="team-overlay-panel">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Team Calendars</span>
                </div>
                <div className="space-y-2">
                  {permittedMembers.map((member) => {
                    const colors = TEAM_OVERLAY_COLORS[member.colorIdx];
                    const checked = enabledOverlays.has(member.id);
                    const memberAvail = availability?.users.find(u => u.userId === member.id);
                    const connStatus = checked && memberAvail ? memberAvail.status : null;
                    return (
                      <div key={member.id} className="space-y-0.5">
                        <label
                          className="flex items-center gap-2 cursor-pointer group"
                          data-testid={`overlay-member-${member.id}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleOverlay(member.id)}
                            data-testid={`checkbox-overlay-${member.id}`}
                          />
                          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${colors.dot}`} />
                          <span className="text-xs truncate group-hover:text-foreground text-muted-foreground transition-colors">
                            {member.name}
                          </span>
                        </label>
                        {connStatus && connStatus !== "available" && (
                          <p className="text-[10px] pl-7 text-amber-400/80" data-testid={`overlay-status-${member.id}`}>
                            {connStatus === "not_connected" ? "No calendar connected" :
                             connStatus === "reconnect_required" ? "Reconnect needed" :
                             "Unavailable"}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {enabledOverlays.size > 0 && (
                  <button
                    className="mt-3 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setEnabledOverlays(new Set())}
                    data-testid="button-clear-overlays"
                  >
                    Clear all
                  </button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Suggested Openings */}
          {view === "day" && enabledIdsList.length > 0 && (
            <Card className="border-border/50 w-52 shrink-0" data-testid="suggested-openings-panel">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Suggested Openings</span>
                </div>
                {availLoading ? (
                  <div className="space-y-1.5">
                    <div className="h-4 bg-muted/40 rounded animate-pulse" />
                    <div className="h-4 bg-muted/40 rounded animate-pulse w-3/4" />
                  </div>
                ) : suggestedOpenings.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="no-openings-text">
                    No shared openings found today.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {suggestedOpenings.map((w, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-primary/8 border border-primary/15"
                        data-testid={`opening-slot-${i}`}
                      >
                        <Zap className="h-3 w-3 text-primary shrink-0" />
                        <span className="font-medium text-foreground">
                          {format(w.start, "h:mm")}–{format(w.end, "h:mm a")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Tasks to Schedule (Phase 1/2/3/4) */}
          {dueTasks.length > 0 && (() => {
            // Phase 2: check if any calendar is connected
            const hasCalendarConnected = calIntegrations.length > 0 || (sourcesData && sourcesData.sources.length > 0);
            // Compute windows once outside the map (perf fix)
            const todayWindows = computeSuggestedOpenings(new Date(), ownEvents ?? [], []);
            return (
              <Card className="border-border/50 w-52 shrink-0" data-testid="tasks-to-schedule-panel">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Tasks Due Soon</span>
                  </div>
                  <div className="space-y-2">
                    {dueTasks.map((task: any) => {
                      const due = new Date(task.dueDate);
                      const overdue = due < new Date() && !isToday(due);
                      const dueToday = isToday(due);
                      const alreadyScheduled = scheduledTaskIds.has(task.id);
                      const isConfirming = confirmSchedule?.taskId === task.id;
                      const isPopoverOpen = popoverOpenTaskId === task.id;

                      return (
                        <div key={task.id} className="space-y-1" data-testid={`due-task-${task.id}`}>
                          <p className="text-xs font-medium truncate" title={task.title}>{task.title}</p>
                          <div className="flex items-center justify-between gap-1">
                            <p className={`text-[10px] ${overdue ? "text-red-400" : dueToday ? "text-amber-400" : "text-muted-foreground"}`}>
                              {overdue ? "Overdue · " : dueToday ? "Due today · " : "Due "}
                              {format(due, "MMM d")}
                            </p>
                            {/* Phase 3: show "Scheduled" once done */}
                            {alreadyScheduled ? (
                              <span className="text-[10px] text-green-500 flex items-center gap-0.5 shrink-0" data-testid={`scheduled-badge-${task.id}`}>
                                <CheckCheck className="h-3 w-3" /> Scheduled
                              </span>
                            ) : !hasCalendarConnected ? (
                              /* Phase 2: soften when no calendar connected */
                              <span className="text-[10px] text-muted-foreground/50 shrink-0" title="Connect a calendar to enable scheduling">
                                Schedule
                              </span>
                            ) : todayWindows.length > 0 ? (
                              /* Phase 1: two-step confirmation popover */
                              <Popover
                                open={isPopoverOpen}
                                onOpenChange={(o) => {
                                  setPopoverOpenTaskId(o ? task.id : null);
                                  if (!o) setConfirmSchedule(null);
                                }}
                              >
                                <PopoverTrigger asChild>
                                  <button
                                    className="text-[10px] text-primary hover:underline shrink-0"
                                    data-testid={`button-schedule-task-${task.id}`}
                                  >
                                    Schedule
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-56 p-2" side="left" align="start">
                                  {isConfirming && confirmSchedule ? (
                                    /* Step 2: Confirm */
                                    <div className="space-y-2.5" data-testid="schedule-confirm-step">
                                      <div className="flex items-center gap-1.5">
                                        <CalendarCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                                        <p className="text-xs font-medium">Confirm Focus Block</p>
                                      </div>
                                      <div className="rounded bg-secondary/30 border border-border/40 p-2 space-y-0.5">
                                        <p className="text-xs font-medium truncate">Focus: {task.title}</p>
                                        <p className="text-[10px] text-muted-foreground">{format(confirmSchedule.window.start, "EEE, MMM d")}</p>
                                        <p className="text-[11px] text-foreground font-medium">
                                          {format(confirmSchedule.window.start, "h:mm")}–{format(confirmSchedule.window.end, "h:mm a")}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground">
                                          {Math.round((confirmSchedule.window.end.getTime() - confirmSchedule.window.start.getTime()) / 60_000)} min focus block
                                        </p>
                                      </div>
                                      <div className="flex gap-1.5">
                                        <Button
                                          size="sm" variant="ghost"
                                          className="flex-1 h-7 text-xs"
                                          onClick={() => setConfirmSchedule(null)}
                                          data-testid="button-schedule-back"
                                        >
                                          ← Back
                                        </Button>
                                        <Button
                                          size="sm"
                                          className="flex-1 h-7 text-xs gap-1"
                                          onClick={() => scheduleFocusMutation.mutate({ task, window: confirmSchedule.window })}
                                          disabled={scheduleFocusMutation.isPending}
                                          data-testid="button-schedule-confirm"
                                        >
                                          {scheduleFocusMutation.isPending
                                            ? <Loader2 className="h-3 w-3 animate-spin" />
                                            : <CircleCheck className="h-3 w-3" />}
                                          Create
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    /* Step 1: Pick window */
                                    <>
                                      <p className="text-xs font-medium mb-1.5">Pick a time window</p>
                                      <p className="text-[10px] text-muted-foreground mb-2 truncate">for: {task.title}</p>
                                      <div className="space-y-1">
                                        {todayWindows.map((w, i) => (
                                          <Button
                                            key={i}
                                            variant="outline" size="sm"
                                            className="w-full h-7 text-[11px] justify-start gap-1.5"
                                            data-testid={`button-schedule-window-${i}`}
                                            onClick={() => setConfirmSchedule({ taskId: task.id, task, window: w })}
                                          >
                                            <Zap className="h-3 w-3 text-primary shrink-0" />
                                            {format(w.start, "h:mm")}–{format(w.end, "h:mm a")}
                                          </Button>
                                        ))}
                                      </div>
                                      <p className="text-[10px] text-muted-foreground mt-2 text-center">Select a window to continue</p>
                                    </>
                                  )}
                                </PopoverContent>
                              </Popover>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Phase 2: reconnect nudge */}
                  {!hasCalendarConnected && (
                    <div className="mt-2 pt-2 border-t border-border/30">
                      <p className="text-[10px] text-muted-foreground text-center leading-tight">
                        <Link href="/settings"><span className="text-primary hover:underline cursor-pointer">Connect a calendar</span></Link> to enable task scheduling.
                      </p>
                    </div>
                  )}
                  <Link href="/tasks">
                    <Button variant="ghost" size="sm" className="w-full mt-3 h-7 text-xs text-muted-foreground" data-testid="button-view-all-tasks">
                      View all tasks
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      </div>

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

      <RescheduleConfirmDialog
        request={rescheduleRequest}
        onCancel={() => setRescheduleRequest(null)}
        onConfirm={(notify) => {
          if (!rescheduleRequest) return;
          rescheduleMutation.mutate({
            id: rescheduleRequest.event.id,
            startTime: rescheduleRequest.newStartTime,
            endTime: rescheduleRequest.newEndTime,
            notify,
            prevStartTime: new Date(rescheduleRequest.event.startTime),
            prevEndTime: rescheduleRequest.event.endTime ? new Date(rescheduleRequest.event.endTime) : null,
          });
        }}
        isPending={rescheduleMutation.isPending}
      />
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
  events: DisplayEvent[];
  onSlotClick: (date: Date) => void;
  onEventClick: (event: DisplayEvent) => void;
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
                    key={`${ev.id}-${ev._team?.name ?? "own"}`}
                    data-event
                    className={`w-full text-left text-[10px] sm:text-xs px-1 py-0.5 rounded truncate border ${
                      ev._team?.colorBg || EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.meeting
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(ev);
                    }}
                    data-testid={`event-month-${ev.id}`}
                  >
                    {ev._team ? `${ev._team.name.split(" ")[0]}: ` : ""}{ev.title}
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
  onReschedule,
}: {
  currentDate: Date;
  events: DisplayEvent[];
  onSlotClick: (date: Date, hour: number) => void;
  onEventClick: (event: DisplayEvent) => void;
  onReschedule?: (event: DisplayEvent, newStart: Date, newEnd: Date | null) => void;
}) {
  const weekStart = startOfWeek(currentDate);
  const weekDays = eachDayOfInterval({ start: weekStart, end: endOfWeek(currentDate) });
  const dragRef = useRef<DisplayEvent | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{ day: string; hour: number } | null>(null);

  const handleDrop = useCallback((day: Date, hour: number) => {
    const ev = dragRef.current;
    if (!ev || !onReschedule) return;
    const orig = new Date(ev.startTime);
    if (isSameDay(orig, day) && getHours(orig) === hour) return;
    const newStart = new Date(day);
    newStart.setHours(hour, orig.getMinutes(), 0, 0);
    let newEnd: Date | null = null;
    if (ev.endTime) {
      const duration = new Date(ev.endTime).getTime() - orig.getTime();
      newEnd = new Date(newStart.getTime() + duration);
    }
    onReschedule(ev, newStart, newEnd);
    dragRef.current = null;
    setDragOverSlot(null);
  }, [onReschedule]);

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
                const slotKey = format(day, "yyyy-MM-dd");
                const isDropTarget = dragOverSlot?.day === slotKey && dragOverSlot?.hour === hour;

                return (
                  <div
                    key={day.toISOString()}
                    className={`border-l border-border/30 min-h-[48px] p-0.5 cursor-pointer overflow-hidden min-w-0 transition-colors ${
                      isDropTarget ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""
                    }`}
                    onClick={() => onSlotClick(day, hour)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverSlot({ day: slotKey, hour }); }}
                    onDragLeave={() => setDragOverSlot(null)}
                    onDrop={(e) => { e.preventDefault(); handleDrop(day, hour); }}
                    data-testid={`slot-week-${format(day, "yyyy-MM-dd")}-${hour}`}
                  >
                    {hourEvents.map((ev) => (
                      <button
                        key={`${ev.id}-${ev._team?.name ?? "own"}`}
                        draggable={!ev._team}
                        className={`w-full min-w-0 text-left text-[10px] px-1 py-0.5 rounded border mb-0.5 block truncate transition-opacity ${
                          ev._team?.colorBg || EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.meeting
                        } ${!ev._team ? "cursor-grab active:cursor-grabbing" : ""}`}
                        onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                        onDragStart={(e) => {
                          dragRef.current = ev;
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(ev.id));
                        }}
                        onDragEnd={() => { dragRef.current = null; setDragOverSlot(null); }}
                        data-testid={`event-week-${ev.id}`}
                        title={`${formatTime(new Date(ev.startTime))} ${ev.title}${!ev._team ? " · Drag to reschedule" : ""}`}
                      >
                        {ev._team ? `${ev._team.name.split(" ")[0]}: ` : ""}{formatTime(new Date(ev.startTime))} {ev.title}
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
  onReschedule,
  busyOverlays = [],
  availLoading = false,
}: {
  currentDate: Date;
  events: DisplayEvent[];
  onSlotClick: (date: Date, hour: number) => void;
  onEventClick: (event: DisplayEvent) => void;
  onReschedule?: (event: DisplayEvent, newStart: Date, newEnd: Date | null) => void;
  busyOverlays?: (TeamMemberAvailability & { colorIdx: number })[];
  availLoading?: boolean;
}) {
  const dayEvents = events.filter((e) => isSameDay(new Date(e.startTime), currentDate));
  const allDayEvents = dayEvents.filter(e => e.allDay);
  const timedDayEvents = dayEvents.filter(e => !e.allDay);
  const dragRef = useRef<DisplayEvent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragOverHour, setDragOverHour] = useState<number | null>(null);

  // Auto-scroll to current working hour on mount / date change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = new Date();
    const targetHour = isSameDay(now, currentDate) ? Math.max(7, Math.min(getHours(now), 20)) : 8;
    el.scrollTop = (targetHour - 1) * 56;
  }, [currentDate]);

  // Pre-index busy blocks per hour for fast lookup
  const busyByHour = useMemo(() => {
    const map = new Map<number, (TeamMemberAvailability & { colorIdx: number })[]>();
    for (const member of busyOverlays) {
      for (const block of member.busyBlocks) {
        const blockStart = new Date(block.start);
        const blockEnd = new Date(block.end);
        for (let h = getHours(blockStart); h <= Math.min(getHours(blockEnd), 23); h++) {
          const slotStart = h * 60 * 60_000 + Math.floor(blockStart.getTime() / (24 * 60 * 60_000)) * 24 * 60 * 60_000;
          const slotEnd = (h + 1) * 60 * 60_000 + Math.floor(blockStart.getTime() / (24 * 60 * 60_000)) * 24 * 60 * 60_000;
          if (blockStart.getTime() < slotEnd && blockEnd.getTime() > slotStart) {
            if (!map.has(h)) map.set(h, []);
            const arr = map.get(h)!;
            if (!arr.find(m => m.userId === member.userId)) arr.push(member);
          }
        }
      }
    }
    return map;
  }, [busyOverlays]);

  const handleDrop = useCallback((hour: number) => {
    const ev = dragRef.current;
    if (!ev || !onReschedule) return;
    const orig = new Date(ev.startTime);
    if (isSameDay(orig, currentDate) && getHours(orig) === hour) return;
    const newStart = new Date(currentDate);
    newStart.setHours(hour, orig.getMinutes(), 0, 0);
    let newEnd: Date | null = null;
    if (ev.endTime) {
      const duration = new Date(ev.endTime).getTime() - orig.getTime();
      newEnd = new Date(newStart.getTime() + duration);
    }
    onReschedule(ev, newStart, newEnd);
    dragRef.current = null;
    setDragOverHour(null);
  }, [onReschedule, currentDate]);

  return (
    <div className="max-h-[600px] overflow-y-auto" ref={scrollRef}>
      {/* All-day event band */}
      {allDayEvents.length > 0 && (
        <div className="sticky top-0 z-10 border-b border-border/40 bg-background/95 backdrop-blur-sm px-2 py-1.5" data-testid="allday-band">
          <div className="grid grid-cols-[60px_1fr] items-start">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide pt-1 text-right pr-3">All day</div>
            <div className="flex flex-wrap gap-1">
              {allDayEvents.map(ev => (
                <button
                  key={ev.id}
                  className={`text-xs px-2 py-0.5 rounded border font-medium truncate max-w-[200px] ${ev._team?.colorBg || EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.meeting}`}
                  onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                  data-testid={`event-allday-${ev.id}`}
                  title={ev.title}
                >
                  {ev._team && <span className="opacity-70 mr-1">{ev._team.name.split(" ")[0]}:</span>}
                  {ev.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Loading shimmer when fetching availability */}
      {availLoading && (
        <div className="h-1 w-full bg-primary/20 animate-pulse rounded-full mb-1" data-testid="avail-loading-bar" />
      )}
      {HOURS.map((hour) => {
        const hourEvents = timedDayEvents.filter((e) => getHours(new Date(e.startTime)) === hour);
        const isDropTarget = dragOverHour === hour;
        const busyMembers = busyByHour.get(hour) ?? [];

        return (
          <div
            key={hour}
            className={`grid grid-cols-[60px_1fr] border-b border-border/30 min-h-[56px] cursor-pointer transition-colors ${
              isDropTarget ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""
            }`}
            onClick={() => onSlotClick(currentDate, hour)}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverHour(hour); }}
            onDragLeave={() => setDragOverHour(null)}
            onDrop={(e) => { e.preventDefault(); handleDrop(hour); }}
            data-testid={`slot-day-${hour}`}
          >
            <div className="p-1 text-xs text-muted-foreground text-right pr-3 pt-1">
              {format(setHours(new Date(), hour), "h a")}
            </div>
            <div className="p-1 space-y-1">
              {/* Privacy-safe teammate busy strips — no event titles */}
              {busyMembers.map((m) => {
                const dotColors = TEAM_OVERLAY_COLORS[m.colorIdx];
                return (
                  <div
                    key={`busy-${m.userId}-${hour}`}
                    className={`w-full text-xs px-2 py-1 rounded border opacity-70 select-none ${dotColors.bg}`}
                    data-testid={`busy-block-${m.userId}-${hour}`}
                    title={`${m.name} is busy`}
                  >
                    <span className="font-medium">{m.name.split(" ")[0]}</span>
                    <span className="ml-1 opacity-70">· Busy</span>
                  </div>
                );
              })}
              {hourEvents.map((ev) => (
                <button
                  key={`${ev.id}-${ev._team?.name ?? "own"}`}
                  draggable={!ev._team}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded border ${
                    ev._team?.colorBg || EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.meeting
                  } ${!ev._team ? "cursor-grab active:cursor-grabbing" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                  onDragStart={(e) => {
                    dragRef.current = ev;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(ev.id));
                  }}
                  onDragEnd={() => { dragRef.current = null; setDragOverHour(null); }}
                  data-testid={`event-day-${ev.id}`}
                  title={!ev._team ? "Drag to reschedule" : undefined}
                >
                  <div className="font-medium flex items-center gap-1 min-w-0">
                    {!ev._team && <GripVertical className="h-3 w-3 opacity-40 shrink-0" />}
                    <span className="truncate">{ev._team && <span className="opacity-70">{ev._team.name.split(" ")[0]}: </span>}{ev.title}</span>
                    {!ev._team && ev.meetingUrl && <Video className="h-3 w-3 shrink-0 text-blue-400 ml-auto" title="Meeting link" />}
                  </div>
                  <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap text-[11px]">
                    <span>
                      {formatTime(new Date(ev.startTime))}
                      {ev.endTime && ` – ${formatTime(new Date(ev.endTime))}`}
                    </span>
                    {!ev._team && ev.calendarName && (
                      <span className="opacity-60">· {ev.calendarName}</span>
                    )}
                    {!ev._team && (() => {
                      const cls = classifyCalendarEvent(ev);
                      return (
                        <>
                          {cls.externalCount > 0 && (
                            <span className="px-1 py-0 rounded bg-foreground/10 border border-border/50 text-[10px]">
                              {cls.externalCount} ext
                            </span>
                          )}
                          {cls.hasBusinessDomain && (
                            <span className="px-1 py-0 rounded bg-primary/15 border border-primary/25 text-[10px] text-primary font-medium">
                              CRM
                            </span>
                          )}
                        </>
                      );
                    })()}
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

function RescheduleConfirmDialog({
  request,
  onCancel,
  onConfirm,
  isPending,
}: {
  request: { event: DisplayEvent; newStartTime: Date; newEndTime: Date | null } | null;
  onCancel: () => void;
  onConfirm: (notify: boolean) => void;
  isPending: boolean;
}) {
  if (!request) return null;
  const { event, newStartTime, newEndTime } = request;
  const oldStart = new Date(event.startTime);
  const oldEnd = event.endTime ? new Date(event.endTime) : null;
  const hasInvitees = (event.invitees?.length ?? 0) > 0;

  const fmtSlot = (start: Date, end: Date | null) =>
    `${format(start, "EEE, MMM d")} · ${formatTime(start)}${end ? ` – ${formatTime(end)}` : ""}`;

  return (
    <Dialog open={!!request} onOpenChange={() => { if (!isPending) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-primary" />
            Reschedule Event
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-sm font-semibold truncate">{event.title}</p>
          <div className="space-y-2.5 text-sm rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="flex items-start gap-3">
              <span className="text-muted-foreground w-10 shrink-0 text-xs pt-0.5 uppercase tracking-wide">From</span>
              <span className="line-through text-muted-foreground">{fmtSlot(oldStart, oldEnd)}</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-muted-foreground w-10 shrink-0 text-xs pt-0.5 uppercase tracking-wide">To</span>
              <span className="font-medium">{fmtSlot(newStartTime, newEndTime)}</span>
            </div>
          </div>
          {hasInvitees && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2 flex items-center gap-2">
              <Users className="h-3.5 w-3.5 shrink-0" />
              {event.invitees!.length} attendee{event.invitees!.length !== 1 ? "s" : ""} will receive a reschedule notification if you choose "Move &amp; Notify".
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-1 flex-wrap sm:flex-nowrap">
          <Button variant="ghost" onClick={onCancel} disabled={isPending} className="sm:mr-auto">
            Cancel
          </Button>
          <Button variant="outline" onClick={() => onConfirm(false)} disabled={isPending} data-testid="button-reschedule-move">
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Move
          </Button>
          {hasInvitees && (
            <Button onClick={() => onConfirm(true)} disabled={isPending} data-testid="button-reschedule-move-notify">
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Move &amp; Notify
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  // Personal Zoom room URL stored on the user's device — lets us one-click
  // insert the user's own meeting URL without round-tripping through the
  // backend (no schema/API changes required).
  const [personalRoomUrl, setPersonalRoomUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("voltsafe.zoom.personalRoomUrl");
  });

  const setMeetingUrlFromZoom = (url: string) => setFormData((p) => ({ ...p, meetingUrl: url }));

  const handleUseMyZoomRoom = () => {
    if (personalRoomUrl) {
      setMeetingUrlFromZoom(personalRoomUrl);
      return;
    }
    const entered = window.prompt(
      "Paste your Personal Zoom Room URL (e.g. https://zoom.us/j/1234567890).\n\nIt will be saved on this device for one-click reuse."
    );
    if (entered && /^https?:\/\//i.test(entered.trim())) {
      const url = entered.trim();
      window.localStorage.setItem("voltsafe.zoom.personalRoomUrl", url);
      setPersonalRoomUrl(url);
      setMeetingUrlFromZoom(url);
    }
  };

  const handleChangeMyZoomRoom = () => {
    const entered = window.prompt(
      "Update your Personal Zoom Room URL (leave empty and press OK to clear it):",
      personalRoomUrl || ""
    );
    if (entered === null) return;
    const trimmed = entered.trim();
    if (trimmed === "") {
      window.localStorage.removeItem("voltsafe.zoom.personalRoomUrl");
      setPersonalRoomUrl(null);
      return;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      window.localStorage.setItem("voltsafe.zoom.personalRoomUrl", trimmed);
      setPersonalRoomUrl(trimmed);
    }
  };

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
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => window.open("https://zoom.us/start/videomeeting", "_blank", "noopener,noreferrer")}
                title="Opens Zoom in a new tab so you can start a fresh meeting and copy its link back into the field above."
                data-testid="button-zoom-new-meeting"
              >
                <Plus className="h-3 w-3" /> New Zoom meeting
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleUseMyZoomRoom}
                title={
                  personalRoomUrl
                    ? `One-click insert ${personalRoomUrl}`
                    : "Save your Personal Zoom Room URL once, then one-click insert it on every future meeting."
                }
                data-testid="button-zoom-use-personal-room"
              >
                <Repeat className="h-3 w-3" /> {personalRoomUrl ? "Use my Zoom room" : "Set my Zoom room"}
              </Button>
              {personalRoomUrl && (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground/60 hover:text-foreground hover:underline underline-offset-2"
                  onClick={handleChangeMyZoomRoom}
                  data-testid="button-zoom-change-personal-room"
                >
                  Change saved room
                </button>
              )}
              {formData.meetingUrl && /^https?:\/\//i.test(formData.meetingUrl) && (
                <a
                  href={formData.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  data-testid="link-zoom-test-open"
                >
                  <ExternalLink className="h-3 w-3" /> Open
                </a>
              )}
            </div>
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

// ─── CRM Context types ────────────────────────────────────────────────────────

type CRMContext = {
  matchedContacts: Array<{ id: number; name: string; title?: string | null; email?: string | null; accountId: number; confidence: "high"; reason: string; matchedOn: "attendee_email" }>;
  matchedLeads: Array<{ id: number; name: string; company: string; email?: string | null; status: string; confidence: "high" | "medium"; reason: string; matchedOn: "attendee_email" | "attendee_domain" }>;
  unmatchedEmails: string[];
  matchedAccounts: Array<{ id: number; name: string; segment?: string | null; leadStatus?: string | null; city?: string | null; website?: string | null; confidence: "high" | "medium"; reason: string; matchedOn: "attendee_email" | "attendee_domain" }>;
  openOpportunities: Array<{ id: number; title: string; stage: string; amount?: number | null; accountId: number }>;
  recentEmails: Array<{ id: number; subject?: string | null; fromEmail?: string | null; sentAt?: string | null; direction?: string | null; snippet?: string | null }>;
  openTasks: Array<{ id: number; title: string; dueDate?: string | null; priority?: string | null }>;
  recommendedAction: { text: string; opportunityId?: number; opportunityTitle?: string; accountId?: number; accountName?: string; suggestCreate?: boolean; stage?: string } | null;
};

type CalendarMetrics = {
  meetingsThisWeek: number; completedThisWeek: number; meetingsThisMonth: number;
  upcomingCount: number; overdueTasks: number; dormantAccounts: number;
  eventsByType: { eventType: string; count: number }[];
};

// ─── CRM Context Tab ─────────────────────────────────────────────────────────

function CreateContactInlineForm({ email, accountId, accountName, onCreated }: {
  email: string; accountId?: number; accountName?: string; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(() => {
    const local = email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return local;
  });
  const [title, setTitle] = useState("");
  const [newAccountName, setNewAccountName] = useState(accountName || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      let finalAccountId = accountId;
      if (!finalAccountId) {
        const accRes = await apiRequest("POST", "/api/accounts", {
          name: newAccountName || email.split("@")[1],
          segment: "marina",
          leadStatus: "new",
          priority: "medium",
        });
        finalAccountId = accRes.id;
      }
      await apiRequest("POST", "/api/contacts", {
        accountId: finalAccountId,
        name: name.trim(),
        email: email.toLowerCase(),
        title: title || null,
      });
      toast({ title: "Contact created", description: `${name} added to CRM.` });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      onCreated();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 p-3 bg-secondary/20 rounded-lg border border-border/40">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Name *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} className="h-7 text-xs" data-testid="input-new-contact-name" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Dockmaster" className="h-7 text-xs" data-testid="input-new-contact-title" />
        </div>
      </div>
      {!accountId && (
        <div className="space-y-1">
          <Label className="text-xs">Account</Label>
          <Input value={newAccountName} onChange={e => setNewAccountName(e.target.value)} placeholder="Company / marina name" className="h-7 text-xs" data-testid="input-new-contact-org" />
        </div>
      )}
      {accountId && (
        <p className="text-xs text-muted-foreground">Will be added to: <span className="font-medium text-foreground">{accountName}</span></p>
      )}
      <Button size="sm" className="h-7 text-xs w-full" onClick={handleSave} disabled={saving} data-testid="button-save-new-contact">
        {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <UserPlus className="mr-1.5 h-3 w-3" />}
        Save Contact
      </Button>
    </div>
  );
}

const STAGE_LABELS: Record<string, string> = {
  inbound_new: "New", qualifying: "Qualifying", proposal: "Proposal",
  negotiation: "Negotiating", verbal_commit: "Verbal Commit",
  closed_won: "Won", closed_lost: "Lost",
};

function CRMContextTab({ eventId, crmCtx, isLoading }: { eventId: number; crmCtx?: CRMContext; isLoading: boolean }) {
  const [showCreateFor, setShowCreateFor] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (isLoading) {
    return (
      <div className="py-8 flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Looking up attendees…</span>
      </div>
    );
  }

  if (!crmCtx) return null;

  const { matchedContacts, matchedLeads = [], unmatchedEmails, matchedAccounts, openOpportunities, recentEmails, openTasks, recommendedAction } = crmCtx;
  const hasAny = matchedContacts.length + matchedLeads.length + matchedAccounts.length + openOpportunities.length + unmatchedEmails.length > 0;

  if (!hasAny && !recommendedAction) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No attendees matched to CRM records.
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Recommended action */}
      {recommendedAction && (
        <div className="flex items-start gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-0.5">Recommended Next Action</p>
            <p className="text-sm">{recommendedAction.text}</p>
            {recommendedAction.opportunityTitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{recommendedAction.opportunityTitle} · {STAGE_LABELS[recommendedAction.stage || ""] || recommendedAction.stage}</p>
            )}
          </div>
        </div>
      )}

      {/* Matched contacts */}
      {matchedContacts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Contacts in CRM ({matchedContacts.length})
          </p>
          {matchedContacts.map(c => (
            <a key={c.id} href={`/contacts`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/40 bg-card hover:bg-secondary/30 transition-colors group" data-testid={`crm-contact-${c.id}`}>
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {c.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.name}</p>
                {c.title && <p className="text-xs text-muted-foreground truncate">{c.title}</p>}
                <p className="text-xs text-muted-foreground truncate">{c.reason}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Badge variant="outline" className="text-[9px] h-4 px-1 bg-emerald-500/10 text-emerald-400 border-emerald-400/20">High</Badge>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Matched leads */}
      {matchedLeads.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> Leads in CRM ({matchedLeads.length})
          </p>
          {matchedLeads.map(l => (
            <a key={l.id} href={`/leads`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/40 bg-card hover:bg-secondary/30 transition-colors group" data-testid={`crm-lead-${l.id}`}>
              <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center text-xs font-bold text-amber-400 shrink-0">
                {l.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{l.name}</p>
                <p className="text-xs text-muted-foreground truncate">{l.company} · {l.status}</p>
                <p className="text-xs text-muted-foreground/70 truncate">{l.reason}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Badge variant="outline" className={`text-[9px] h-4 px-1 ${l.confidence === "high" ? "bg-emerald-500/10 text-emerald-400 border-emerald-400/20" : "bg-amber-500/10 text-amber-400 border-amber-400/20"}`}>
                  {l.confidence === "high" ? "High" : "Med"}
                </Badge>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Matched accounts */}
      {matchedAccounts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Accounts ({matchedAccounts.length})
          </p>
          {matchedAccounts.map(a => (
            <a key={a.id} href={`/accounts`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/40 bg-card hover:bg-secondary/30 transition-colors group" data-testid={`crm-account-${a.id}`}>
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{a.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {a.segment} {a.city ? `· ${a.city}` : ""}
                  {a.leadStatus ? ` · ${a.leadStatus}` : ""}
                </p>
                <p className="text-xs text-muted-foreground/70 truncate">{a.reason}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Badge variant="outline" className={`text-[9px] h-4 px-1 ${a.confidence === "high" ? "bg-emerald-500/10 text-emerald-400 border-emerald-400/20" : "bg-amber-500/10 text-amber-400 border-amber-400/20"}`}>
                  {a.confidence === "high" ? "High" : "Med"}
                </Badge>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Open opportunities */}
      {openOpportunities.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> Open Deals ({openOpportunities.length})
          </p>
          {openOpportunities.map(o => (
            <div key={o.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/40 bg-card" data-testid={`crm-opp-${o.id}`}>
              <TrendingUp className="h-4 w-4 text-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{o.title}</p>
                <p className="text-xs text-muted-foreground">{STAGE_LABELS[o.stage] || o.stage}{o.amount ? ` · $${o.amount.toLocaleString()}` : ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Open tasks */}
      {openTasks.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" /> Open Tasks ({openTasks.length})
          </p>
          {openTasks.map(t => (
            <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/40 bg-card text-xs" data-testid={`crm-task-${t.id}`}>
              <ClipboardList className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{t.title}</span>
              {t.dueDate && <span className="text-muted-foreground shrink-0">{format(new Date(t.dueDate), "MMM d")}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Recent emails */}
      {recentEmails.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Recent Emails ({recentEmails.length})
          </p>
          {recentEmails.map(e => (
            <div key={e.id} className="px-3 py-1.5 rounded-lg border border-border/40 bg-card" data-testid={`crm-email-${e.id}`}>
              <p className="font-medium truncate text-xs">{e.subject || "(no subject)"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {e.direction === "outbound" ? "Sent" : "Received"}
                {e.sentAt ? ` · ${format(new Date(e.sentAt), "MMM d, yyyy")}` : ""}
              </p>
              {e.snippet && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 italic">{e.snippet}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Unknown attendees — suggest creating contacts */}
      {unmatchedEmails.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <UserPlus className="h-3.5 w-3.5" /> Unknown Attendees ({unmatchedEmails.length})
          </p>
          {unmatchedEmails.map(email => {
            const domain = email.split("@")[1] || "";
            const matchedAcc = matchedAccounts.find(a => a.website?.includes(domain));
            return (
              <div key={email} className="rounded-lg border border-dashed border-border/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{email}</p>
                    {matchedAcc && <p className="text-xs text-muted-foreground">Possible org: {matchedAcc.name}</p>}
                  </div>
                  {showCreateFor !== email ? (
                    <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => setShowCreateFor(email)} data-testid={`button-add-contact-${email}`}>
                      <UserPlus className="mr-1 h-3 w-3" /> Add to CRM
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0" onClick={() => setShowCreateFor(null)}>
                      Cancel
                    </Button>
                  )}
                </div>
                {showCreateFor === email && (
                  <CreateContactInlineForm
                    key={refreshKey}
                    email={email}
                    accountId={matchedAcc?.id}
                    accountName={matchedAcc?.name}
                    onCreated={() => { setShowCreateFor(null); setRefreshKey(k => k + 1); queryClient.invalidateQueries({ queryKey: ["/api/calendar/events", eventId, "crm-context"] }); }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Post-Meeting Workflow Tab ────────────────────────────────────────────────

function PostMeetingTab({ event, opportunities, onDone }: {
  event: CalendarEvent;
  opportunities: Array<{ id: number; title: string; stage: string }>;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [markCompleted, setMarkCompleted] = useState(false);
  const [createTask, setCreateTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [selectedOppId, setSelectedOppId] = useState<number | undefined>(opportunities[0]?.id);
  const [nextStage, setNextStage] = useState("");

  const STAGE_OPTIONS = [
    { value: "qualifying", label: "Qualifying" },
    { value: "proposal", label: "Proposal" },
    { value: "negotiation", label: "Negotiation" },
    { value: "verbal_commit", label: "Verbal Commit" },
    { value: "closed_won", label: "Closed Won" },
    { value: "closed_lost", label: "Closed Lost" },
  ];

  const postMeetingMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/calendar/events/${event.id}/post-meeting`, {
      notes: notes.trim() || undefined,
      markCompleted,
      createTask,
      taskTitle: createTask ? taskTitle : undefined,
      taskDueDate: createTask && taskDueDate ? taskDueDate : undefined,
      opportunityId: nextStage && selectedOppId ? selectedOppId : undefined,
      nextStage: nextStage || undefined,
    }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      const parts: string[] = [];
      if (data.eventUpdated) parts.push("event updated");
      if (data.task) parts.push("task created");
      if (data.opportunityUpdated) parts.push("pipeline advanced");
      toast({ title: "Post-meeting complete", description: parts.join(", ") || "Workflow applied." });
      onDone();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const hasAction = notes.trim() || markCompleted || (createTask && taskTitle.trim()) || (nextStage && selectedOppId);

  return (
    <div className="space-y-4 text-sm">
      {/* Meeting notes */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <ClipboardList className="h-3.5 w-3.5" /> Meeting Notes
        </Label>
        <Textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Key takeaways, decisions made, action items discussed…"
          rows={3}
          className="text-sm resize-none"
          data-testid="textarea-meeting-notes"
        />
      </div>

      <Separator />

      {/* Mark completed */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CircleCheck className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">Mark event as completed</span>
        </div>
        <Switch checked={markCompleted} onCheckedChange={setMarkCompleted} data-testid="switch-mark-completed" />
      </div>

      <Separator />

      {/* Create follow-up task */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Create follow-up task</span>
          </div>
          <Switch checked={createTask} onCheckedChange={setCreateTask} data-testid="switch-create-task" />
        </div>
        {createTask && (
          <div className="space-y-2 pl-6">
            <Input
              value={taskTitle}
              onChange={e => setTaskTitle(e.target.value)}
              placeholder="e.g. Send proposal to marina"
              className="h-8 text-sm"
              data-testid="input-task-title"
            />
            <DatePickerField
              value={taskDueDate}
              onChange={setTaskDueDate}
              label=""
              testId="input-task-due-date"
            />
          </div>
        )}
      </div>

      {/* Move pipeline stage */}
      {opportunities.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Advance pipeline stage</span>
            </div>
            <div className="pl-6 space-y-2">
              {opportunities.length > 1 && (
                <Select value={String(selectedOppId)} onValueChange={v => setSelectedOppId(Number(v))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-opportunity">
                    <SelectValue placeholder="Select deal" />
                  </SelectTrigger>
                  <SelectContent>
                    {opportunities.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {opportunities.length === 1 && (
                <p className="text-xs text-muted-foreground">{opportunities[0].title} · currently {STAGE_LABELS[opportunities[0].stage] || opportunities[0].stage}</p>
              )}
              <Select value={nextStage} onValueChange={setNextStage}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-next-stage">
                  <SelectValue placeholder="Move to stage…" />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.value === opportunities.find(o => o.id === selectedOppId)?.stage ? `${s.label} (current)` : s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </>
      )}

      <Button
        className="w-full"
        onClick={() => postMeetingMutation.mutate()}
        disabled={!hasAction || postMeetingMutation.isPending}
        data-testid="button-submit-post-meeting"
      >
        {postMeetingMutation.isPending ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
        ) : (
          <><CheckCheck className="mr-2 h-4 w-4" /> Apply Workflow</>
        )}
      </Button>
    </div>
  );
}

// ─── Calendar Metrics Bar ─────────────────────────────────────────────────────

function MetricsBar() {
  const { data: metrics } = useQuery<CalendarMetrics>({
    queryKey: ["/api/calendar/metrics"],
    refetchInterval: 5 * 60_000,
  });

  if (!metrics) return null;

  const stats = [
    { label: "This week", value: metrics.meetingsThisWeek, sub: `${metrics.completedThisWeek} completed`, icon: CalendarDays, color: "text-primary" },
    { label: "Upcoming", value: metrics.upcomingCount, sub: "events scheduled", icon: CalendarPlus, color: "text-blue-500" },
    { label: "This month", value: metrics.meetingsThisMonth, sub: "total events", icon: TrendingUp, color: "text-emerald-500" },
    { label: "Overdue tasks", value: metrics.overdueTasks, sub: "need attention", icon: AlertTriangle, color: metrics.overdueTasks > 0 ? "text-amber-500" : "text-muted-foreground" },
    { label: "Dormant accounts", value: metrics.dormantAccounts, sub: "no activity 30d", icon: Building2, color: metrics.dormantAccounts > 0 ? "text-red-400" : "text-muted-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="metrics-bar">
      {stats.map(({ label, value, sub, icon: Icon, color }) => (
        <div key={label} className="flex items-center gap-2.5 bg-card border border-border/50 rounded-xl px-3 py-2.5">
          <div className={`${color} shrink-0`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold leading-none" data-testid={`metric-${label.replace(/\s+/g, "-").toLowerCase()}`}>{value}</p>
            <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── AI Briefing Tab ──────────────────────────────────────────────────────────

function BriefingTab({ eventId }: { eventId: number }) {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", `/api/calendar/events/${eventId}/briefing`);
      const data = await res.json();
      setBriefing(data.briefing ?? data.summary ?? JSON.stringify(data));
    } catch (e: any) {
      setError(e.message ?? "Failed to generate briefing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!briefing && !loading && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">AI Meeting Briefing</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Generate an AI-powered briefing with CRM context, talking points, and preparation notes for this meeting.
            </p>
          </div>
          <Button size="sm" onClick={generate} data-testid="button-generate-briefing">
            <Bot className="h-4 w-4 mr-2" /> Generate Briefing
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Preparing your briefing…</p>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {error}
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={generate}>Retry</Button>
        </div>
      )}

      {briefing && !loading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              AI-generated briefing
            </div>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={generate} data-testid="button-regenerate-briefing">
              <RefreshCw className="h-3 w-3 mr-1" /> Regenerate
            </Button>
          </div>
          <div className="rounded-lg bg-secondary/30 border border-border/40 p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {briefing}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Zoom URL extractor ───────────────────────────────────────────────────────

type MeetingProvider = "zoom" | "teams" | "meet" | "phone" | "other" | null;

/** Detects meeting provider from meetingUrl, location, and description fields. */
function detectMeetingProvider(event: {
  meetingUrl?: string | null;
  location?: string | null;
  description?: string | null;
}): { provider: MeetingProvider; joinUrl: string | null } {
  const { meetingUrl, location, description } = event;
  const sources = [meetingUrl, location, description].filter(Boolean) as string[];

  for (const src of sources) {
    if (/zoom\.us\//i.test(src)) {
      const m = src.match(/https?:\/\/[a-z0-9.-]*zoom\.us\/[^\s"'<>)]+/i);
      return { provider: "zoom", joinUrl: m ? m[0] : (meetingUrl ?? null) };
    }
    if (/teams\.microsoft\.com|teams\.live\.com/i.test(src)) {
      const m = src.match(/https?:\/\/teams\.[a-z.]+\/[^\s"'<>)]+/i);
      return { provider: "teams", joinUrl: m ? m[0] : (meetingUrl ?? null) };
    }
    if (/meet\.google\.com/i.test(src)) {
      const m = src.match(/https?:\/\/meet\.google\.com\/[^\s"'<>)]+/i);
      return { provider: "meet", joinUrl: m ? m[0] : (meetingUrl ?? null) };
    }
  }

  if (meetingUrl && /^https?:\/\//i.test(meetingUrl)) {
    return { provider: "other", joinUrl: meetingUrl };
  }
  return { provider: null, joinUrl: null };
}

// ─── Meeting Note Action (compact hook inside event detail) ─────────────────

type MeetingNoteRef = { id: number; title: string | null; status: string } | null;

function MeetingNoteAction({ event }: { event: CalendarEvent }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { provider } = detectMeetingProvider(event);

  const { data: note, isLoading } = useQuery<MeetingNoteRef>({
    queryKey: ["/api/calendar/events", event.id, "meeting-note"],
    queryFn: async () => {
      const r = await fetch(`/api/calendar/events/${event.id}/meeting-note`, { credentials: "include" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as MeetingNoteRef | undefined;
      return data && (data.status === "recording" || data.status === "processing") ? 5000 : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest(
      "POST",
      `/api/calendar/events/${event.id}/create-meeting-note`,
      {},
    ),
    onSuccess: async (res) => {
      const created = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/calendar/events", event.id, "meeting-note"] });
      navigate(`/meeting-notes/${created.id}`);
    },
    onError: () => toast({ title: "Could not create meeting note", variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="h-8 w-full bg-muted/40 rounded animate-pulse" />;
  }

  // ── Existing note — show status-aware UI ───────────────────────────────────
  if (note) {
    if (note.status === "recording") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-2 border-red-500/40 text-red-500 hover:bg-red-500/10 animate-pulse"
          onClick={() => navigate(`/meeting-notes/${note.id}`)}
          data-testid="button-view-meeting-note-recording"
        >
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          Recording in progress · Open
        </Button>
      );
    }

    if (note.status === "processing") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-2 border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
          onClick={() => navigate(`/meeting-notes/${note.id}`)}
          data-testid="button-view-meeting-note-processing"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          Processing transcript…
        </Button>
      );
    }

    if (note.status === "completed" || note.status === "done") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-2 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
          onClick={() => navigate(`/meeting-notes/${note.id}`)}
          data-testid="button-view-meeting-note"
        >
          <CheckCheck className="h-3.5 w-3.5 shrink-0" />
          View Meeting Notes
        </Button>
      );
    }

    if (note.status === "failed") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-2 border-red-500/30 text-red-600 hover:bg-red-500/10"
          onClick={() => navigate(`/meeting-notes/${note.id}`)}
          data-testid="button-view-meeting-note-failed"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          View Note (Processing Error)
        </Button>
      );
    }

    if (note.status === "cancelled") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-2"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          data-testid="button-restart-meeting-note"
        >
          {createMutation.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            : <Mic className="h-3.5 w-3.5 shrink-0" />}
          Create New Meeting Note
        </Button>
      );
    }

    // scheduled_prompted → show "Start Recording Now" prominently
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 px-0.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 animate-pulse" />
          <span className="text-xs text-blue-500 font-medium">Meeting note ready</span>
          {provider && (
            <span className="ml-auto text-[10px] text-muted-foreground capitalize">{provider}</span>
          )}
        </div>
        <Button
          size="sm"
          className="w-full gap-2"
          onClick={() => navigate(`/meeting-notes/${note.id}`)}
          data-testid="button-start-meeting-note"
        >
          <Mic className="h-3.5 w-3.5 shrink-0" />
          Start Recording Now
        </Button>
      </div>
    );
  }

  // ── No note yet — offer to create one ─────────────────────────────────────
  const isZoom = provider === "zoom";
  return (
    <Button
      size="sm"
      variant={isZoom ? "default" : "outline"}
      className={`w-full gap-2 ${isZoom ? "bg-[#2D8CFF] hover:bg-[#2680f0] text-white border-0" : ""}`}
      onClick={() => createMutation.mutate()}
      disabled={createMutation.isPending}
      data-testid="button-create-meeting-note"
    >
      {createMutation.isPending
        ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        : <Mic className="h-3.5 w-3.5 shrink-0" />
      }
      {provider ? "Start Meeting Notes" : "Create Meeting Note"}
    </Button>
  );
}

// ─── Event Detail Dialog (tabbed) ────────────────────────────────────────────

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
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [followUpTitle, setFollowUpTitle] = useState(() => `Follow up: ${event.title}`);
  const [followUpDue, setFollowUpDue] = useState<"today" | "tomorrow">("tomorrow");
  const { toast } = useToast();

  const now = new Date();
  const endTime = event.endTime ? new Date(event.endTime) : new Date(event.startTime);
  const isPast = endTime < now;

  // Add Zoom meeting to this event (creates via Zoom API + stores joinUrl)
  const addZoomMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/calendar/events/${event.id}/add-zoom`, {}),
    onSuccess: async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Could not add Zoom meeting", description: (err as any).message, variant: "destructive" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      toast({ title: "Zoom meeting added", description: "Join link is now on this event." });
    },
    onError: () => toast({ title: "Network error — please try again", variant: "destructive" }),
  });

  // Send invite emails to all invitees
  const sendInvitesMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/calendar/events/${event.id}/send-invites`, {}),
    onSuccess: async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Could not send invites", description: (err as any).message, variant: "destructive" });
        return;
      }
      const data = await res.json();
      toast({ title: `Invite${data.sent !== 1 ? "s" : ""} sent`, description: `${data.sent} of ${data.total} recipient${data.total !== 1 ? "s" : ""} emailed.` });
    },
    onError: () => toast({ title: "Network error — please try again", variant: "destructive" }),
  });

  const { data: crmCtx, isLoading: crmLoading } = useQuery<CRMContext>({
    queryKey: ["/api/calendar/events", event.id, "crm-context"],
    queryFn: () => fetch(`/api/calendar/events/${event.id}/crm-context`, { credentials: "include" }).then(r => r.json()),
    enabled: !!event.id,
  });

  const crmCount = crmCtx
    ? crmCtx.matchedContacts.length + (crmCtx.matchedLeads?.length ?? 0) + crmCtx.matchedAccounts.length + crmCtx.openOpportunities.length
    : 0;

  // Follow-up task creation
  const createFollowUpMutation = useMutation({
    mutationFn: async () => {
      const baseDate = followUpDue === "today" ? new Date() : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const dueDate = baseDate.toISOString().split("T")[0];
      const res = await apiRequest("POST", "/api/tasks", {
        title: followUpTitle.trim() || `Follow up: ${event.title}`,
        status: "pending",
        priority: "medium",
        dueDate,
        notes: `Created from calendar event on ${format(new Date(event.startTime), "MMM d, yyyy")}`,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Follow-up task created", description: `"${followUpTitle.trim() || `Follow up: ${event.title}`}" added to your tasks.` });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setShowFollowUpForm(false);
    },
    onError: () => toast({ title: "Could not create task", variant: "destructive" }),
  });

  if (editing) {
    return (
      <EventFormDialog
        open
        onClose={() => setEditing(false)}
        onSubmit={(data) => { onUpdate(data); setEditing(false); }}
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
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden p-0">
        {/* Fixed header */}
        <div className="px-6 pt-6 pb-3 border-b border-border/50 shrink-0">
          <DialogHeader>
            <DialogTitle className="text-xl pr-6" data-testid="text-event-title">
              {event.title}
            </DialogTitle>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className={EVENT_TYPE_COLORS[event.eventType] || ""}>
                {event.eventType}
              </Badge>
              <Badge variant="outline" className={statusColor}>
                {event.status}
              </Badge>
              {isPast && (
                <Badge variant="outline" className="text-xs bg-secondary/30">
                  Past event
                </Badge>
              )}
            </div>
          </DialogHeader>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="details" className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="mx-6 mt-3 mb-0 shrink-0 w-auto justify-start bg-secondary/40 h-8">
            <TabsTrigger value="details" className="text-xs h-6 px-3" data-testid="tab-details">
              Details
            </TabsTrigger>
            <TabsTrigger value="crm" className="text-xs h-6 px-3" data-testid="tab-crm">
              Relationships{crmCount > 0 ? ` (${crmCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="briefing" className="text-xs h-6 px-3" data-testid="tab-briefing">
              <Sparkles className="h-3 w-3 mr-1" />Prep
            </TabsTrigger>
            {isPast && (
              <TabsTrigger value="post-meeting" className="text-xs h-6 px-3" data-testid="tab-post-meeting">
                Post-Meeting
              </TabsTrigger>
            )}
          </TabsList>

          {/* Details tab */}
          <TabsContent value="details" className="flex-1 overflow-y-auto px-6 pb-4 mt-3">
            <div className="space-y-2.5 text-sm">
              {event.meetingUrl ? (() => {
                const { provider: mp, joinUrl: mUrl } = detectMeetingProvider(event);
                if (mp === "zoom") {
                  return (
                    <a
                      href={mUrl ?? event.meetingUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full bg-[#2D8CFF] hover:bg-[#2680f0] text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
                      data-testid="link-join-zoom"
                    >
                      <Video className="h-4 w-4 shrink-0" />
                      Join Zoom Meeting
                    </a>
                  );
                }
                if (mp === "teams") {
                  return (
                    <a
                      href={mUrl ?? event.meetingUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full bg-[#6264A7] hover:bg-[#5456a0] text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
                      data-testid="link-join-teams"
                    >
                      <Video className="h-4 w-4 shrink-0" />
                      Join Teams Meeting
                    </a>
                  );
                }
                if (mp === "meet") {
                  return (
                    <a
                      href={mUrl ?? event.meetingUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
                      data-testid="link-join-meet"
                    >
                      <Video className="h-4 w-4 shrink-0" />
                      Join Google Meet
                    </a>
                  );
                }
                return (
                  <div className="flex items-center gap-2">
                    <Video className="h-4 w-4 text-muted-foreground shrink-0" />
                    <a href={mUrl ?? event.meetingUrl!} target="_blank" rel="noopener noreferrer" className="text-primary truncate" data-testid="link-meeting-url">
                      Join Meeting
                    </a>
                  </div>
                );
              })() : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2 border-[#2D8CFF]/40 text-[#2D8CFF] hover:bg-[#2D8CFF]/10"
                  onClick={() => addZoomMutation.mutate()}
                  disabled={addZoomMutation.isPending}
                  data-testid="button-add-zoom"
                >
                  {addZoomMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    : <Video className="h-3.5 w-3.5 shrink-0" />}
                  Add Zoom Meeting
                </Button>
              )}
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>
                  {event.allDay
                    ? format(startDate, "MMM d, yyyy")
                    : `${format(startDate, "MMM d, yyyy h:mm a")}${endDate ? ` – ${format(endDate, "h:mm a")}` : ""}`}
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
              {/* Source calendar */}
              {event.calendarName && (
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Source: <span className="text-foreground">{event.calendarName}</span></span>
                </div>
              )}

              {/* Rich attendees — use attendeeDetails when available, fall back to invitees array */}
              {(() => {
                const details = Array.isArray((event as any).attendeeDetails)
                  ? (event as any).attendeeDetails as Array<{ email: string; name?: string; responseStatus?: string; organizer?: boolean; self?: boolean }>
                  : null;
                const hasAttendees = (details && details.length > 0) || (event.invitees && event.invitees.length > 0);
                if (!hasAttendees) return null;

                const attendees = details ?? (event.invitees || []).map((e: string) => ({ email: e }));
                const INTERNAL_DOMAIN = "voltsafe.com";
                const statusColors: Record<string, string> = {
                  accepted: "text-green-500",
                  declined: "text-red-500",
                  tentative: "text-amber-500",
                  needsAction: "text-muted-foreground",
                };
                const statusLabels: Record<string, string> = {
                  accepted: "Accepted",
                  declined: "Declined",
                  tentative: "Tentative",
                  needsAction: "Awaiting",
                };

                return (
                  <div className="border-t border-border/30 pt-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                      <Users className="h-3.5 w-3.5" /> Attendees ({attendees.length})
                    </div>
                    <div className="space-y-1.5">
                      {attendees.map((att: any, i: number) => {
                        const email = (att.email || "").toLowerCase();
                        const isInternal = email.endsWith("@" + INTERNAL_DOMAIN);
                        const name = att.name || email.split("@")[0];
                        const status = att.responseStatus;
                        const isOrganizer = att.organizer;
                        const isSelf = att.self;
                        return (
                          <div
                            key={`${email}-${i}`}
                            className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-secondary/20"
                            data-testid={`detail-attendee-${email}`}
                          >
                            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                              {name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{name}{isSelf ? " (you)" : ""}{isOrganizer ? " · Organizer" : ""}</p>
                              <p className="text-muted-foreground truncate">{email}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {isInternal && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 bg-blue-500/10 text-blue-400 border-blue-400/20">
                                  Internal
                                </Badge>
                              )}
                              {status && (
                                <span className={`text-[10px] font-medium ${statusColors[status] ?? "text-muted-foreground"}`}>
                                  {statusLabels[status] ?? status}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {event.description && (
                <div className="border-t border-border/30 pt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                  <p className="text-muted-foreground whitespace-pre-wrap text-xs line-clamp-6">{event.description}</p>
                </div>
              )}
            </div>
            {/* Footer actions inside scroll */}
            <div className="mt-5 pt-4 border-t border-border/30 flex flex-col gap-2">
              <MeetingNoteAction event={event} />

              {/* Phase 3 — confirm-then-create follow-up */}
              {!showFollowUpForm && !createFollowUpMutation.isSuccess && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => setShowFollowUpForm(true)}
                  data-testid="button-create-followup-task"
                >
                  <ClipboardList className="h-3.5 w-3.5 shrink-0" />
                  Create Follow-Up Task
                </Button>
              )}
              {createFollowUpMutation.isSuccess && (
                <Button size="sm" variant="outline" className="w-full gap-2" disabled data-testid="button-create-followup-task">
                  <CheckCheck className="h-3.5 w-3.5 shrink-0 text-green-500" /> Task created
                </Button>
              )}
              {showFollowUpForm && !createFollowUpMutation.isSuccess && (
                <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 space-y-2.5" data-testid="followup-confirm-form">
                  <p className="text-xs font-medium text-foreground">Create Follow-Up Task</p>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Title</label>
                    <Input
                      value={followUpTitle}
                      onChange={e => setFollowUpTitle(e.target.value)}
                      className="h-7 text-xs"
                      data-testid="input-followup-title"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Due</label>
                    <div className="flex gap-1.5">
                      {(["today", "tomorrow"] as const).map(opt => (
                        <button
                          key={opt}
                          className={`flex-1 text-[11px] rounded border px-2 py-1 capitalize transition-colors ${followUpDue === opt ? "bg-primary text-primary-foreground border-primary" : "border-border/50 text-muted-foreground hover:border-primary/40"}`}
                          onClick={() => setFollowUpDue(opt)}
                          data-testid={`button-followup-due-${opt}`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 h-7 text-xs"
                      onClick={() => setShowFollowUpForm(false)}
                      data-testid="button-followup-cancel"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 h-7 text-xs gap-1.5"
                      onClick={() => createFollowUpMutation.mutate()}
                      disabled={createFollowUpMutation.isPending || !followUpTitle.trim()}
                      data-testid="button-followup-confirm"
                    >
                      {createFollowUpMutation.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <CircleCheck className="h-3 w-3" />}
                      Confirm
                    </Button>
                  </div>
                </div>
              )}
              {event.invitees && event.invitees.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => sendInvitesMutation.mutate()}
                  disabled={sendInvitesMutation.isPending || sendInvitesMutation.isSuccess}
                  data-testid="button-send-invites"
                >
                  {sendInvitesMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    : sendInvitesMutation.isSuccess
                      ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-green-500" />
                      : <Mail className="h-3.5 w-3.5 shrink-0" />}
                  {sendInvitesMutation.isSuccess
                    ? "Invites sent"
                    : `Send Invite${event.invitees.length !== 1 ? "s" : ""} (${event.invitees.length})`}
                </Button>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting} data-testid="button-delete-event">
                  {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Delete
                </Button>
                <Button size="sm" onClick={() => setEditing(true)} data-testid="button-edit-event">
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* CRM tab */}
          <TabsContent value="crm" className="flex-1 overflow-y-auto px-6 pb-6 mt-3">
            <CRMContextTab eventId={event.id} crmCtx={crmCtx} isLoading={crmLoading} />
          </TabsContent>

          {/* Prep tab — structured summary + AI briefing */}
          <TabsContent value="briefing" className="flex-1 overflow-y-auto px-6 pb-6 mt-3 space-y-4">
            {/* Phase 6: non-AI structured prep summary from existing data */}
            {(() => {
              const cls = classifyCalendarEvent(event as unknown as DisplayEvent);
              const externalAttendees = Array.isArray(event.attendeeDetails)
                ? (event.attendeeDetails as any[]).filter(a => !a.self && (a.email || "").includes("@") && !(a.email || "").toLowerCase().endsWith("@voltsafe.com"))
                : [];
              const hasAnyContext = cls.isExternal || crmCount > 0;
              if (!hasAnyContext && !cls.needsPrep) return null;
              return (
                <div className="rounded-lg border border-border/40 bg-secondary/20 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary shrink-0" />
                    <p className="text-sm font-medium">Prep Summary</p>
                    <span className="text-[10px] text-muted-foreground ml-auto">from your CRM</span>
                  </div>

                  {/* Why this matters */}
                  {crmCount > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Why this matters</p>
                      <div className="text-xs text-foreground space-y-0.5">
                        {crmCtx?.openOpportunities && crmCtx.openOpportunities.length > 0 && (
                          <p>• {crmCtx.openOpportunities.length} open opportunit{crmCtx.openOpportunities.length === 1 ? "y" : "ies"} linked to attendees.</p>
                        )}
                        {crmCtx?.matchedAccounts && crmCtx.matchedAccounts.length > 0 && (
                          <p>• Attendees from {crmCtx.matchedAccounts.map((a: any) => a.name || a.companyName).filter(Boolean).slice(0, 2).join(", ")}.</p>
                        )}
                        {crmCtx?.matchedLeads && crmCtx.matchedLeads.length > 0 && (
                          <p>• {crmCtx.matchedLeads.length} active lead{crmCtx.matchedLeads.length === 1 ? "" : "s"} in pipeline.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* External attendees */}
                  {externalAttendees.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">External Attendees</p>
                      <div className="space-y-0.5">
                        {externalAttendees.slice(0, 5).map((a: any, i: number) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                              <span className="text-[8px] text-primary font-bold">{(a.displayName || a.email || "?")[0].toUpperCase()}</span>
                            </div>
                            <span className="text-xs text-foreground truncate">{a.displayName || a.email}</span>
                            {a.email && a.displayName && <span className="text-[10px] text-muted-foreground truncate">{a.email}</span>}
                            {cls.hasBusinessDomain && <span className="text-[9px] px-1 rounded bg-primary/10 border border-primary/20 text-primary">CRM</span>}
                          </div>
                        ))}
                        {externalAttendees.length > 5 && (
                          <p className="text-[10px] text-muted-foreground">+{externalAttendees.length - 5} more</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* No context honest state */}
                  {crmCount === 0 && externalAttendees.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No CRM context found for this event's attendees.</p>
                  )}
                </div>
              );
            })()}

            <BriefingTab eventId={event.id} />
          </TabsContent>

          {/* Post-Meeting tab */}
          {isPast && (
            <TabsContent value="post-meeting" className="flex-1 overflow-y-auto px-6 pb-6 mt-3">
              <PostMeetingTab
                event={event}
                opportunities={crmCtx?.openOpportunities ?? []}
                onDone={onClose}
              />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
