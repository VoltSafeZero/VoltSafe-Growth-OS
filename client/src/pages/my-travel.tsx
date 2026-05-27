import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Car, MapPin, Clock, Calendar, ChevronRight, Navigation,
  Anchor, AlertCircle, Sparkles, ExternalLink, ChevronDown, ChevronUp,
  Route, Plus,
} from "lucide-react";
import { format } from "date-fns";
import { MarinasDayPlannerDialog } from "@/components/marinas-day-planner-dialog";

type TravelTask = {
  task_id: number;
  title: string;
  due_date: string;
  priority: string;
  status: string;
  lead_id: number;
  company: string;
  city: string | null;
  state: string | null;
  slips: string | null;
  address: string | null;
  marina_lat: number | null;
  marina_lng: number | null;
};

type UpcomingDay = {
  date: string;
  label: string;
  tasks: TravelTask[];
};

type MyDayData = {
  today: TravelTask[];
  upcoming: UpcomingDay[];
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "text-red-400 bg-red-500/10 border-red-500/20",
  high:   "text-orange-400 bg-orange-500/10 border-orange-500/20",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  low:    "text-blue-400 bg-blue-500/10 border-blue-500/20",
};
const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500", high: "bg-orange-400", medium: "bg-amber-400", low: "bg-blue-400",
};

function fmtTime(d: string) {
  try { return new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}
function parseSlips(s: string | null) {
  const m = String(s ?? "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function StopCard({ task, index }: { task: TravelTask; index: number }) {
  const slips = parseSlips(task.slips);
  const loc = [task.city, task.state].filter(Boolean).join(", ") || task.address;
  const mapsUrl = task.marina_lat && task.marina_lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${task.marina_lat},${task.marina_lng}&travelmode=driving`
    : null;
  const time = fmtTime(task.due_date);

  return (
    <div
      className="flex items-start gap-4 p-4 rounded-xl border border-border/40 bg-card/60 hover:bg-card/80 transition-colors"
      data-testid={`travel-stop-${task.task_id}`}
    >
      <div className="w-8 h-8 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/opportunities/${task.lead_id}`}
            className="text-base font-semibold hover:underline text-foreground"
            data-testid={`travel-stop-link-${task.lead_id}`}
          >
            {task.company}
          </a>
          {slips > 0 && (
            <Badge variant="outline" className="text-[11px] gap-1 h-5">
              <Anchor className="h-2.5 w-2.5" /> {slips} slips
            </Badge>
          )}
          <Badge
            variant="outline"
            className={`text-[11px] h-5 capitalize ${PRIORITY_COLOR[task.priority] ?? ""}`}
          >
            {task.priority}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{task.title}</p>
        {loc && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 flex-shrink-0" /> {loc}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        {time && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> {time}
          </span>
        )}
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
            data-testid={`travel-maps-link-${task.task_id}`}
          >
            <Navigation className="h-3.5 w-3.5" /> Navigate
          </a>
        )}
        <a
          href={`/opportunities/${task.lead_id}`}
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" /> View lead
        </a>
      </div>
    </div>
  );
}

function UpcomingDayRow({ day }: { day: UpcomingDay }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/30 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
        data-testid={`travel-day-toggle-${day.date}`}
      >
        <Calendar className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
        <span className="font-medium flex-1">{day.label}</span>
        <Badge variant="secondary" className="text-xs">
          {day.tasks.length} stop{day.tasks.length !== 1 ? "s" : ""}
        </Badge>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground/50" /> : <ChevronDown className="h-4 w-4 text-muted-foreground/50" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 border-t border-border/20 pt-3">
          {day.tasks.map(t => {
            const loc = [t.city, t.state].filter(Boolean).join(", ");
            const mapsUrl = t.marina_lat && t.marina_lng
              ? `https://www.google.com/maps/dir/?api=1&destination=${t.marina_lat},${t.marina_lng}&travelmode=driving`
              : null;
            return (
              <div key={t.task_id} className="flex items-start gap-3 py-1.5">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${PRIORITY_DOT[t.priority] ?? "bg-muted-foreground/40"}`} />
                <div className="min-w-0 flex-1">
                  <a href={`/opportunities/${t.lead_id}`} className="text-sm font-medium hover:underline">
                    {t.company}
                  </a>
                  <p className="text-xs text-muted-foreground">{t.title}</p>
                  {loc && <p className="text-xs text-muted-foreground/70">{loc}</p>}
                </div>
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener" className="text-primary/60 hover:text-primary mt-1">
                    <Navigation className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MyTravelPage() {
  const [plannerOpen, setPlannerOpen] = useState(false);

  const { data, isLoading, error } = useQuery<MyDayData>({
    queryKey: ["/api/travel/my-day"],
    refetchInterval: 5 * 60 * 1000,
  });

  const today = data?.today ?? [];
  const upcoming = data?.upcoming ?? [];

  const preselectedLeads = useMemo(() =>
    today
      .filter(t => t.marina_lat && t.marina_lng)
      .map(t => ({
        id: t.lead_id,
        company: t.company,
        marina_lat: t.marina_lat!,
        marina_lng: t.marina_lng!,
        marina_address: t.address,
        street_address: null,
        city: t.city,
        state: t.state,
        slips: t.slips,
        status: "",
      })),
  [today]);

  const todayLabel = format(new Date(), "EEEE, MMMM d");
  const totalUpcoming = upcoming.reduce((s, d) => s + d.tasks.length, 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Car className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold">My Travel</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Marina visits scheduled via tasks linked to leads
            </p>
          </div>
          {preselectedLeads.length > 0 && (
            <Button
              onClick={() => setPlannerOpen(true)}
              className="gap-2 flex-shrink-0"
              data-testid="button-plan-route"
            >
              <Route className="h-4 w-4" /> Plan Today's Route
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive p-4 rounded-xl border border-destructive/20 bg-destructive/5">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <p>Failed to load travel data. Please refresh.</p>
          </div>
        ) : (
          <>
            {/* ── Today ──────────────────────────────────────────────── */}
            <section data-testid="section-today">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Today</h2>
                  <span className="text-sm text-muted-foreground">{todayLabel}</span>
                </div>
                {today.length > 0 && (
                  <Badge className="gap-1">
                    <Car className="h-3 w-3" /> {today.length} stop{today.length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>

              {today.length === 0 ? (
                <Card className="border-dashed border-border/50">
                  <CardContent className="py-10 text-center text-muted-foreground">
                    <Car className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium mb-1">No marina visits scheduled today</p>
                    <p className="text-sm mb-4 max-w-xs mx-auto">
                      To schedule a visit, create a task linked to a lead and set today as the due date.
                    </p>
                    <Button variant="outline" size="sm" asChild>
                      <a href="/opportunities">
                        <Plus className="h-3.5 w-3.5 mr-1.5" /> Browse Leads
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {today.map((t, i) => <StopCard key={t.task_id} task={t} index={i} />)}

                  <div className="flex items-center justify-between pt-2">
                    <p className="text-xs text-muted-foreground">
                      {preselectedLeads.length} of {today.length} stops have map coordinates
                    </p>
                    {preselectedLeads.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setPlannerOpen(true)}
                        data-testid="button-open-planner-bottom"
                      >
                        <Sparkles className="h-3.5 w-3.5" /> Route in Day Planner
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* ── Upcoming ───────────────────────────────────────────── */}
            <section data-testid="section-upcoming">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">Upcoming</h2>
                {totalUpcoming > 0 && (
                  <Badge variant="secondary">{totalUpcoming} visit{totalUpcoming !== 1 ? "s" : ""}</Badge>
                )}
              </div>

              {upcoming.length === 0 ? (
                <Card className="border-dashed border-border/50">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Calendar className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No visits in the next 14 days</p>
                    <p className="text-xs mt-1">
                      Create tasks linked to leads with future due dates to see them here.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {upcoming.map(day => <UpcomingDayRow key={day.date} day={day} />)}
                </div>
              )}
            </section>

            {/* ── How it works ───────────────────────────────────────── */}
            {today.length === 0 && upcoming.length === 0 && (
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-primary flex items-center gap-2">
                    <Sparkles className="h-4 w-4" /> How My Travel Works
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>1. Go to a lead in your pipeline (e.g. <a href="/opportunities" className="text-primary underline">Leads</a>).</p>
                  <p>2. Create a task linked to that lead and set a due date for the visit day.</p>
                  <p>3. That visit will appear here — today's stops can be routed in the Day Planner.</p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <MarinasDayPlannerDialog
        open={plannerOpen}
        onOpenChange={setPlannerOpen}
        userLocation={null}
        preselectedLeads={preselectedLeads}
      />
    </div>
  );
}
