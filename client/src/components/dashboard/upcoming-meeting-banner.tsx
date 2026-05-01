import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Video, Mic, X, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { format, differenceInSeconds, parseISO } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarEvent = {
  id: number;
  title: string;
  startTime: string | Date;
  endTime: string | Date;
  meetingUrl: string | null;
};

// ─── Session storage helpers ──────────────────────────────────────────────────

const STORAGE_KEY = "dismissed_meeting_alerts";

function getDismissed(): Set<number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

function addDismissed(id: number): void {
  const set = getDismissed();
  set.add(id);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {}
}

// ─── Countdown hook ───────────────────────────────────────────────────────────

function useCountdown(targetDate: Date | null): string {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!targetDate) return;

    const tick = () => {
      const secs = differenceInSeconds(targetDate, new Date());
      if (secs <= 0) {
        setLabel("starting now");
      } else if (secs < 60) {
        setLabel(`in ${secs}s`);
      } else {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        setLabel(`in ${m}m ${s > 0 ? `${s}s` : ""}`);
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return label;
}

// ─── Upcoming-meeting detection hook ─────────────────────────────────────────

const WINDOW_MINUTES  = 5;      // alert threshold: starts within N minutes
const POLL_INTERVAL_MS = 30_000; // re-check every 30 s

type AlertEvent = CalendarEvent & { startDate: Date };

function isZoomUrl(url: string | null): url is string {
  return !!url && /zoom\.us/i.test(url);
}

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : parseISO(v as string);
}

function useUpcomingMeetingAlert(debugMode: boolean): AlertEvent | null {
  const [alert, setAlert] = useState<AlertEvent | null>(null);
  const dismissedRef = useRef(getDismissed());

  // Keep dismissed ref in sync whenever sessionStorage changes externally
  const refreshDismissed = useCallback(() => {
    dismissedRef.current = getDismissed();
  }, []);

  const check = useCallback(async () => {
    refreshDismissed();

    if (debugMode) {
      // In debug mode inject a fake event for testing
      const fakeId = -1;
      if (dismissedRef.current.has(fakeId)) {
        setAlert(null);
        return;
      }
      const fakeSoon = new Date(Date.now() + 2 * 60 * 1000); // 2 min from now
      setAlert({
        id: fakeId,
        title: "Demo Zoom Meeting (test)",
        startTime: fakeSoon.toISOString(),
        endTime:   new Date(fakeSoon.getTime() + 30 * 60 * 1000).toISOString(),
        meetingUrl: "https://zoom.us/j/fake",
        startDate: fakeSoon,
      });
      return;
    }

    try {
      const now   = new Date();
      const end   = new Date(now.getTime() + WINDOW_MINUTES * 60 * 1000 + 60_000);
      const url   = `/api/calendar/events?start=${now.toISOString()}&end=${end.toISOString()}`;
      const r     = await fetch(url, { credentials: "include" });
      if (!r.ok) return;
      const events: CalendarEvent[] = await r.json();

      const cutoff = now.getTime() + WINDOW_MINUTES * 60 * 1000;

      const match = events.find((ev) => {
        if (!isZoomUrl(ev.meetingUrl)) return false;
        if (dismissedRef.current.has(ev.id)) return false;
        const start = toDate(ev.startTime).getTime();
        return start >= now.getTime() && start <= cutoff;
      });

      setAlert(match
        ? { ...match, startDate: toDate(match.startTime) }
        : null
      );
    } catch {
      // silent — don't interrupt the app on failure
    }
  }, [debugMode, refreshDismissed]);

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  return alert;
}

// ─── Banner component ─────────────────────────────────────────────────────────

export function UpcomingMeetingBanner() {
  const [, navigate]    = useLocation();
  const [hidden, setHidden] = useState(false);
  const debugMode       = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("test_meeting_banner");

  const alert = useUpcomingMeetingAlert(debugMode);

  // Reset hidden when a new alert appears (different event)
  const prevAlertId = useRef<number | null>(null);
  useEffect(() => {
    if (alert && alert.id !== prevAlertId.current) {
      setHidden(false);
      prevAlertId.current = alert.id;
    }
  }, [alert]);

  const countdown = useCountdown(alert?.startDate ?? null);

  const startMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const res = await apiRequest(
        "POST",
        `/api/calendar/events/${eventId}/create-meeting-note`,
        { platform: "zoom" },
      );
      return res.json();
    },
    onSuccess: async (note) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/calendar/events", alert?.id, "meeting-note"],
      });
      setHidden(true);
      navigate(`/meeting-notes/${note.id}`);
    },
  });

  const dismiss = () => {
    if (!alert) return;
    addDismissed(alert.id);
    setHidden(true);
  };

  if (!alert || hidden) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[100] w-[340px] max-w-[calc(100vw-2rem)]"
      data-testid="banner-upcoming-meeting"
    >
      {/* Animated slide-in */}
      <div className="animate-in slide-in-from-top-2 fade-in duration-300">
        <div className="bg-[#111827] border border-[#2D8CFF]/40 rounded-xl shadow-xl shadow-black/40 overflow-hidden">

          {/* Top accent stripe */}
          <div className="h-0.5 bg-gradient-to-r from-[#2D8CFF] to-cyan-400" />

          <div className="p-4 flex flex-col gap-3">
            {/* Header row */}
            <div className="flex items-start gap-3">
              <div className="mt-0.5 w-8 h-8 rounded-full bg-[#2D8CFF]/15 flex items-center justify-center shrink-0">
                <Video className="w-4 h-4 text-[#2D8CFF]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#2D8CFF] uppercase tracking-wide leading-none mb-1">
                  Meeting starting soon
                </p>
                <p
                  className="text-sm font-medium text-white truncate"
                  data-testid="text-meeting-title"
                >
                  {alert.title}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground" data-testid="text-meeting-countdown">
                    {format(alert.startDate, "h:mm a")} · {countdown}
                  </span>
                </div>
              </div>
              <button
                onClick={dismiss}
                className="text-muted-foreground hover:text-white transition-colors shrink-0"
                data-testid="button-dismiss-meeting-banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* CTA */}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 gap-1.5 bg-[#2D8CFF] hover:bg-[#2680f0] text-white border-0"
                onClick={() => startMutation.mutate(alert.id)}
                disabled={startMutation.isPending}
                data-testid="button-start-meeting-note"
              >
                {startMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Mic className="w-3.5 h-3.5" />
                }
                Start recording
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/10 text-muted-foreground hover:text-white hover:bg-white/5"
                onClick={dismiss}
                data-testid="button-dismiss-meeting-banner-alt"
              >
                Dismiss
              </Button>
            </div>

            {startMutation.isError && (
              <p className="text-xs text-red-400" data-testid="error-start-recording">
                Could not create meeting note — try again.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
