// Spark-style rich calendar-invite block.
//
// Rendered ABOVE the email body whenever the message has a text/calendar
// attachment. Shows a date badge, event title, full date/time range with
// timezone, optional Join meeting button (Teams/Zoom/Meet/Webex/etc), and
// an attendee strip with response indicators.
//
// Data is fetched lazily from /api/gmail/attachments/:id/calendar-invite
// (the parent passes the attachment DB id, NOT the message id, so the same
// endpoint handles every kind of invite the inbox might encounter).
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
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

// Deterministic gradient picker so the same email always lands on the same
// avatar colour across renders / threads.
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

interface CalendarInviteCardProps {
  /** email_attachments.id of the .ics row */
  attachmentId: number;
  /** Helps us scope the test ids to a particular message */
  messageKey?: string | number;
}

export function CalendarInviteCard({ attachmentId, messageKey }: CalendarInviteCardProps) {
  const { data, isLoading, isError } = useQuery<CalendarEventDetails>({
    queryKey: ["/api/gmail/attachments", attachmentId, "calendar-invite"],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const testKey = messageKey != null ? `${messageKey}` : `${attachmentId}`;

  if (isLoading) {
    return (
      <div
        className="my-3 mx-5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground"
        data-testid={`card-calendar-invite-loading-${testKey}`}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading calendar invite…
      </div>
    );
  }
  if (isError || !data) return null;

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
      className={`my-3 mx-5 rounded-xl border overflow-hidden shadow-sm ${
        isCancelled
          ? "border-destructive/30 bg-destructive/5"
          : "border-primary/30 bg-gradient-to-br from-primary/8 via-primary/4 to-background"
      }`}
      data-testid={`card-calendar-invite-${testKey}`}
    >
      <div className="px-4 py-3 sm:px-5 sm:py-4 flex items-start gap-4">
        {/* Date badge */}
        {start && (
          <div className="flex-shrink-0 w-14 sm:w-16 rounded-lg overflow-hidden border border-border/40 bg-background shadow-sm text-center">
            <div className="bg-primary/15 text-primary text-[10px] font-bold uppercase tracking-wider py-1">
              {MONTHS_SHORT[start.getMonth()]}
            </div>
            <div className="py-1.5">
              <div className="text-2xl sm:text-3xl font-bold leading-none tabular-nums" data-testid={`text-invite-day-${testKey}`}>
                {start.getDate()}
              </div>
              <div className="text-[10px] text-muted-foreground/70 mt-0.5 font-medium">
                {DOW_SHORT[start.getDay()]}
              </div>
            </div>
          </div>
        )}
        {/* Title + meta */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold">
            <Calendar className="h-3 w-3 text-primary/80" />
            <span className="text-primary/85">
              {isCancelled ? "Cancelled invitation" : "Calendar invitation"}
            </span>
            {data.rrule && (
              <span className="inline-flex items-center gap-0.5 text-muted-foreground/65 normal-case tracking-normal">
                <Repeat className="h-3 w-3" /> Recurring
              </span>
            )}
          </div>
          <h3
            className={`text-base sm:text-lg font-semibold leading-tight tracking-tight ${
              isCancelled ? "line-through text-muted-foreground" : "text-foreground"
            }`}
            data-testid={`text-invite-summary-${testKey}`}
          >
            {data.summary}
          </h3>
          {start && (
            <div className="flex items-start gap-1.5 text-[12px] text-foreground/80">
              <Clock className="h-3.5 w-3.5 text-muted-foreground/65 flex-shrink-0 mt-0.5" />
              <span data-testid={`text-invite-when-${testKey}`}>
                {fmtFullDate(start)}
                {!data.allDay && (
                  <>
                    {" · "}
                    {fmtTime(start)}
                    {end && (sameDay ? ` – ${fmtTime(end)}` : ` – ${fmtFullDate(end)} ${fmtTime(end)}`)}
                    <span className="text-muted-foreground/55"> ({tz})</span>
                  </>
                )}
              </span>
            </div>
          )}
          {data.location && data.location !== data.joinUrl && (
            <div className="flex items-start gap-1.5 text-[12px] text-foreground/80">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground/65 flex-shrink-0 mt-0.5" />
              <span className="break-all">{data.location}</span>
            </div>
          )}
          {data.joinUrl && (
            <div className="pt-1">
              <Button
                asChild
                size="sm"
                className="gap-1.5 h-7 text-[12px] font-medium"
                data-testid={`button-join-meeting-${testKey}`}
              >
                <a href={data.joinUrl} target="_blank" rel="noopener noreferrer">
                  <Video className="h-3.5 w-3.5" />
                  Join meeting
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>
      {/* Attendees */}
      {data.attendees.length > 0 && (
        <div className="border-t border-border/30 bg-background/40 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/65 mb-2">
            <Users className="h-3 w-3" />
            <span data-testid={`text-attendee-count-${testKey}`}>
              {data.attendees.length} attendee{data.attendees.length === 1 ? "" : "s"}
            </span>
            {data.organizer && (
              <span className="normal-case tracking-normal text-muted-foreground/50 font-normal">
                · organizer {data.organizer.name || data.organizer.email}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.attendees.map((a) => {
              const isOrganizer =
                !!data.organizer?.email && a.email === data.organizer.email;
              const partstat = (a.partstat || "").toUpperCase();
              const indicator =
                partstat === "ACCEPTED"  ? <Check className="h-2.5 w-2.5 text-emerald-400" /> :
                partstat === "DECLINED"  ? <X className="h-2.5 w-2.5 text-rose-400" /> :
                partstat === "TENTATIVE" ? <HelpCircle className="h-2.5 w-2.5 text-amber-400" /> :
                null;
              return (
                <div
                  key={a.email}
                  className="inline-flex items-center gap-1.5 rounded-full bg-card/60 border border-border/30 pl-1 pr-2 py-0.5 hover:border-border/60 transition-colors"
                  title={
                    `${a.name || a.email}` +
                    (a.name && a.email !== a.name ? ` <${a.email}>` : "") +
                    (partstat ? ` · ${partstat}` : "")
                  }
                  data-testid={`chip-attendee-${a.email}`}
                >
                  <div
                    className={`h-4 w-4 rounded-full bg-gradient-to-br ${avatarColor(a.email)} text-[8px] font-bold text-white flex items-center justify-center select-none ring-1 ring-black/5`}
                  >
                    {initialsOf(a.name, a.email)}
                  </div>
                  <span className="text-[11px] font-medium text-foreground/85 max-w-[160px] truncate">
                    {a.name || a.email}
                  </span>
                  {isOrganizer && (
                    <span className="text-[8.5px] uppercase tracking-wider font-semibold text-primary/80">
                      org
                    </span>
                  )}
                  {indicator}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
