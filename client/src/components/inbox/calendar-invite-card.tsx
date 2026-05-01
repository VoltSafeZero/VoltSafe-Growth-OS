// Spark/Superhuman-style rich calendar-invite block.
//
// Rendered ABOVE the email body whenever the message has a text/calendar
// attachment. Shows a compact date badge, event title, date/time range,
// optional Join meeting button, and an attendee strip with response indicators.
//
// Data is fetched lazily from /api/gmail/attachments/:id/calendar-invite.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  Clock,
  MapPin,
  Video,
  Users,
  Check,
  X,
  HelpCircle,
  Loader2,
  Repeat,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// Cap the visible attendee strip at 8 before collapsing to "+N more".
const ATTENDEE_COLLAPSED_COUNT = 8;

interface CalendarAttendee {
  name: string | null;
  email: string;
  role: string | null;
  partstat: string | null;
  rsvp: boolean;
}

interface CalendarEventDetails {
  uid: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  joinUrl: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
  organizer: { name: string | null; email: string | null } | null;
  attendees: CalendarAttendee[];
  status: string | null;
  sequence: number;
  method: string | null;
  rrule: string | null;
}

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Deterministic avatar gradient — same email always gets the same colour.
function avatarColor(email: string) {
  const palette = [
    "from-rose-500 to-rose-700",
    "from-amber-500 to-amber-700",
    "from-emerald-500 to-emerald-700",
    "from-cyan-500 to-cyan-700",
    "from-violet-500 to-violet-700",
    "from-fuchsia-500 to-fuchsia-700",
    "from-blue-500 to-blue-700",
    "from-indigo-500 to-indigo-700",
  ];
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function initialsOf(name: string | null, email: string) {
  const src = (name || email.split("@")[0] || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function looksLikeUrl(s: string) {
  return /^https?:\/\//i.test(s.trim());
}

interface CalendarInviteCardProps {
  attachmentId: number;
  messageKey?: string | number;
}

export function CalendarInviteCard({ attachmentId, messageKey }: CalendarInviteCardProps) {
  const { data, isLoading, isError } = useQuery<CalendarEventDetails>({
    queryKey: ["/api/gmail/attachments", attachmentId, "calendar-invite"],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const [attendeesExpanded, setAttendeesExpanded] = useState(false);

  const testKey = messageKey != null ? `${messageKey}` : `${attachmentId}`;

  if (isLoading) {
    return (
      <div
        className="my-2 mx-5 rounded-xl border border-primary/15 bg-primary/4 px-4 py-2.5 flex items-center gap-2 text-[11px] text-muted-foreground/70"
        data-testid={`card-calendar-invite-loading-${testKey}`}
      >
        <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
        Loading calendar invite…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="my-2 mx-5 rounded-lg border border-border/25 bg-muted/20 px-3 py-2 flex items-center gap-2 text-[10.5px] text-muted-foreground/55"
        data-testid={`card-calendar-invite-error-${testKey}`}
      >
        <AlertCircle className="h-3 w-3 flex-shrink-0 opacity-70" />
        Calendar invite couldn't be parsed — download the .ics from attachments below.
      </div>
    );
  }

  if (!data) return null;

  const start = data.start ? new Date(data.start) : null;
  const end = data.end ? new Date(data.end) : null;
  const sameDay = start && end && start.toDateString() === end.toDateString();
  const isCancelled = (data.status || "").toUpperCase() === "CANCELLED" || data.method === "CANCEL";
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const fmtFullDate = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div
      className={`my-2 mx-5 rounded-xl border overflow-hidden ${
        isCancelled
          ? "border-destructive/25 bg-destructive/4"
          : "border-border/50 bg-card/50"
      }`}
      data-testid={`card-calendar-invite-${testKey}`}
    >
      <div className="px-4 py-3 sm:px-5 flex items-start gap-3.5">
        {/* ── Compact date badge ── */}
        {start && (
          <div
            className="flex-shrink-0 w-11 rounded-lg overflow-hidden border border-border/35 bg-background text-center shadow-sm"
            aria-label={`${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}`}
          >
            <div className="bg-primary/10 text-primary text-[9px] font-bold uppercase tracking-wider py-0.5">
              {MONTHS_SHORT[start.getMonth()]}
            </div>
            <div className="py-1">
              <div
                className="text-[20px] font-bold leading-none tabular-nums text-foreground"
                data-testid={`text-invite-day-${testKey}`}
              >
                {start.getDate()}
              </div>
              <div className="text-[9px] text-muted-foreground/60 mt-0.5 font-medium">
                {DOW_SHORT[start.getDay()]}
              </div>
            </div>
          </div>
        )}

        {/* ── Title + meta ── */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* Type label row */}
          <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-wider font-semibold text-muted-foreground/60">
            <Calendar className="h-2.5 w-2.5 flex-shrink-0" aria-hidden="true" />
            <span className={isCancelled ? "text-destructive/70" : "text-primary/70"}>
              {isCancelled ? "Cancelled invitation" : "Calendar invitation"}
            </span>
            {data.rrule && (
              <span className="inline-flex items-center gap-0.5 normal-case tracking-normal text-muted-foreground/50 font-normal">
                <Repeat className="h-2.5 w-2.5" aria-hidden="true" /> Recurring
              </span>
            )}
          </div>

          {/* Event title */}
          <h3
            className={`text-[14.5px] font-semibold leading-snug tracking-tight ${
              isCancelled ? "line-through text-muted-foreground/60" : "text-foreground"
            }`}
            data-testid={`text-invite-summary-${testKey}`}
          >
            {data.summary}
          </h3>

          {/* Date / time */}
          {start && (
            <div className="flex items-start gap-1 text-[11.5px] text-foreground/75">
              <Clock className="h-3 w-3 text-muted-foreground/50 flex-shrink-0 mt-[1px]" aria-hidden="true" />
              <span data-testid={`text-invite-when-${testKey}`} className="leading-snug">
                {fmtFullDate(start)}
                {!data.allDay && (
                  <>
                    {" · "}
                    {fmtTime(start)}
                    {end && (sameDay ? ` – ${fmtTime(end)}` : ` – ${fmtFullDate(end)} ${fmtTime(end)}`)}
                    <span className="text-muted-foreground/45 text-[10.5px]"> {tz}</span>
                  </>
                )}
              </span>
            </div>
          )}

          {/* Location (separate from joinUrl) */}
          {data.location && data.location !== data.joinUrl && (
            <div className="flex items-start gap-1 text-[11.5px] text-foreground/75">
              <MapPin className="h-3 w-3 text-muted-foreground/50 flex-shrink-0 mt-[1px]" aria-hidden="true" />
              {looksLikeUrl(data.location) ? (
                <a
                  href={data.location}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 rounded"
                >
                  {data.location}
                </a>
              ) : (
                <span className="break-words leading-snug">{data.location}</span>
              )}
            </div>
          )}

          {/* Join / no-link area */}
          {data.joinUrl ? (
            <div className="pt-0.5">
              <Button
                asChild
                size="sm"
                className="h-6 px-2.5 gap-1 text-[11.5px] font-medium"
                data-testid={`button-join-meeting-${testKey}`}
                aria-label="Join meeting"
              >
                <a
                  href={data.joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <Video className="h-3 w-3" aria-hidden="true" />
                  Join meeting
                </a>
              </Button>
            </div>
          ) : (!data.location && !isCancelled) ? (
            <div
              className="flex items-center gap-1 text-[10.5px] text-muted-foreground/45 pt-0.5"
              data-testid={`text-invite-no-link-${testKey}`}
            >
              <MapPin className="h-2.5 w-2.5 opacity-50" aria-hidden="true" />
              No location or conference link
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Attendees strip ── */}
      {data.attendees.length > 0 && (() => {
        const counts = data.attendees.reduce(
          (acc, a) => {
            const k = (a.partstat || "").toUpperCase();
            if (k === "ACCEPTED") acc.accepted++;
            else if (k === "DECLINED") acc.declined++;
            else if (k === "TENTATIVE") acc.tentative++;
            else acc.pending++;
            return acc;
          },
          { accepted: 0, declined: 0, tentative: 0, pending: 0 },
        );
        const hasResponses = counts.accepted + counts.declined + counts.tentative > 0;
        const showAllAttendees = attendeesExpanded || data.attendees.length <= ATTENDEE_COLLAPSED_COUNT;
        const visibleAttendees = showAllAttendees
          ? data.attendees
          : data.attendees.slice(0, ATTENDEE_COLLAPSED_COUNT);
        const hiddenAttendeeCount = data.attendees.length - visibleAttendees.length;

        return (
          <div className="border-t border-border/25 bg-background/25 px-4 py-2.5 sm:px-5">
            {/* Summary header */}
            <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mb-1.5">
              <span className="inline-flex items-center gap-1 text-[9.5px] uppercase tracking-wider font-semibold text-muted-foreground/55">
                <Users className="h-2.5 w-2.5" aria-hidden="true" />
                <span data-testid={`text-attendee-count-${testKey}`}>
                  {data.attendees.length} attendee{data.attendees.length === 1 ? "" : "s"}
                </span>
              </span>
              {hasResponses && (
                <span
                  className="text-[10px] text-muted-foreground/50"
                  data-testid={`text-attendee-summary-${testKey}`}
                >
                  ·
                  {counts.accepted > 0 && <span className="ml-1 text-emerald-500/80">{counts.accepted} yes</span>}
                  {counts.declined > 0 && <span className="ml-1 text-rose-500/80">{counts.declined} no</span>}
                  {counts.tentative > 0 && <span className="ml-1 text-amber-500/80">{counts.tentative} maybe</span>}
                  {counts.pending > 0 && <span className="ml-1 text-muted-foreground/45">{counts.pending} pending</span>}
                </span>
              )}
              {data.organizer && (
                <span className="text-[10px] text-muted-foreground/40">
                  · organizer: {data.organizer.name || data.organizer.email}
                </span>
              )}
            </div>

            {/* Chip list */}
            <div className="flex flex-wrap gap-1">
              {visibleAttendees.map((a) => {
                const isOrganizer = !!data.organizer?.email && a.email === data.organizer.email;
                const partstat = (a.partstat || "").toUpperCase();
                const indicator =
                  partstat === "ACCEPTED"  ? <Check className="h-2.5 w-2.5 text-emerald-400 flex-shrink-0" aria-label="Accepted" /> :
                  partstat === "DECLINED"  ? <X className="h-2.5 w-2.5 text-rose-400 flex-shrink-0" aria-label="Declined" /> :
                  partstat === "TENTATIVE" ? <HelpCircle className="h-2.5 w-2.5 text-amber-400 flex-shrink-0" aria-label="Tentative" /> :
                  null;
                return (
                  <a
                    key={a.email}
                    href={`mailto:${a.email}`}
                    className="inline-flex items-center gap-1 rounded-full bg-card/70 border border-border/30 pl-0.5 pr-1.5 py-0.5 hover:border-primary/35 hover:bg-card/90 transition-colors no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                    title={
                      `${a.name || a.email}` +
                      (a.name && a.email !== a.name ? ` <${a.email}>` : "") +
                      (partstat ? ` · ${partstat}` : "")
                    }
                    data-testid={`chip-attendee-${testKey}-${a.email}`}
                    aria-label={`${a.name || a.email}${partstat ? `, ${partstat}` : ""}`}
                  >
                    <div
                      className={`h-3.5 w-3.5 rounded-full bg-gradient-to-br ${avatarColor(a.email)} text-[7px] font-bold text-white flex items-center justify-center select-none ring-1 ring-black/5`}
                      aria-hidden="true"
                    >
                      {initialsOf(a.name, a.email)}
                    </div>
                    <span className="text-[10.5px] font-medium text-foreground/80 max-w-[140px] truncate">
                      {a.name || a.email.split("@")[0]}
                    </span>
                    {isOrganizer && (
                      <span className="text-[8px] uppercase tracking-wider font-semibold text-primary/65 leading-none">
                        org
                      </span>
                    )}
                    {indicator}
                  </a>
                );
              })}

              {hiddenAttendeeCount > 0 && (
                <button
                  type="button"
                  onClick={() => setAttendeesExpanded(true)}
                  className="inline-flex items-center gap-0.5 rounded-full text-primary/70 hover:text-primary hover:bg-primary/8 transition-colors px-2 py-0.5 text-[10.5px] font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                  data-testid={`button-expand-attendees-${testKey}`}
                >
                  +{hiddenAttendeeCount} more
                  <ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              )}

              {attendeesExpanded && data.attendees.length > ATTENDEE_COLLAPSED_COUNT && (
                <button
                  type="button"
                  onClick={() => setAttendeesExpanded(false)}
                  className="inline-flex items-center gap-0.5 rounded-full text-muted-foreground/50 hover:text-foreground transition-colors px-2 py-0.5 text-[10.5px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                  data-testid={`button-collapse-attendees-${testKey}`}
                >
                  <ChevronUp className="h-2.5 w-2.5" aria-hidden="true" />
                  Show less
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
