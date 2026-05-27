import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Car, MapPin, Clock, Calendar, ChevronRight, Navigation,
  Anchor, AlertCircle, Sparkles, ExternalLink,
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

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500", high: "bg-orange-400", medium: "bg-amber-400", low: "bg-blue-400",
};

function fmtTime(d: string): string {
  try {
    const dt = new Date(d);
    return dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

function parseSlips(s: string | null): number {
  if (!s) return 0;
  const m = String(s).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function StopRow({ task, index }: { task: TravelTask; index?: number }) {
  const slips = parseSlips(task.slips);
  const loc = [task.city, task.state].filter(Boolean).join(", ") || task.address || null;
  const mapsUrl = task.marina_lat && task.marina_lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${task.marina_lat},${task.marina_lng}&travelmode=driving`
    : null;
  const time = fmtTime(task.due_date);

  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-border/30 last:border-0">
      {index !== undefined && (
        <div className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
          {index + 1}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority] ?? "bg-muted-foreground/40"}`} />
          <a
            href={`/opportunities/${task.lead_id}`}
            target="_blank"
            rel="noopener"
            className="text-sm font-medium hover:underline truncate"
            data-testid={`travel-stop-link-${task.lead_id}`}
          >
            {task.company}
          </a>
          {slips > 0 && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5">
              <Anchor className="h-2.5 w-2.5" /> {slips}
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{task.title}</p>
        {loc && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
            <MapPin className="h-2.5 w-2.5 flex-shrink-0" /> {loc}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {time && <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{time}</span>}
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noopener" className="text-primary hover:text-primary/80">
            <Navigation className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

function TodayItineraryDialog({
  open,
  onOpenChange,
  tasks,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tasks: TravelTask[];
}) {
  const [plannerOpen, setPlannerOpen] = useState(false);
  const dateLabel = format(new Date(), "EEEE, MMMM d");

  const preselectedLeads = useMemo(() =>
    tasks
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
  [tasks]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto" data-testid="dialog-today-itinerary">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Car className="h-5 w-5 text-primary" /> Today's Itinerary
            </DialogTitle>
            <DialogDescription>{dateLabel} · {tasks.length} stop{tasks.length !== 1 ? "s" : ""} scheduled</DialogDescription>
          </DialogHeader>

          {tasks.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No marina visits scheduled for today.</p>
              <p className="text-xs mt-1">Create tasks linked to leads with today's date to see them here.</p>
            </div>
          ) : (
            <div className="space-y-0">
              {tasks.map((t, i) => (
                <StopRow key={t.task_id} task={t} index={i} />
              ))}
            </div>
          )}

          {preselectedLeads.length > 0 && (
            <div className="pt-3 border-t border-border/40 flex justify-between items-center">
              <p className="text-[11px] text-muted-foreground">{preselectedLeads.length} of {tasks.length} stops have map coordinates</p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => { onOpenChange(false); setTimeout(() => setPlannerOpen(true), 150); }}
                data-testid="button-open-day-planner-from-travel"
              >
                <Sparkles className="h-3.5 w-3.5" /> Route in Day Planner
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <MarinasDayPlannerDialog
        open={plannerOpen}
        onOpenChange={setPlannerOpen}
        userLocation={null}
        preselectedLeads={preselectedLeads}
      />
    </>
  );
}

export function MyTravelWidget() {
  const [todayOpen, setTodayOpen] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<MyDayData>({
    queryKey: ["/api/travel/my-day"],
    refetchInterval: 5 * 60 * 1000,
  });

  const today = data?.today ?? [];
  const upcoming = data?.upcoming ?? [];
  const totalUpcoming = upcoming.reduce((s, d) => s + d.tasks.length, 0);

  return (
    <>
      <Card className="border border-border/50 bg-card/80" data-testid="widget-my-travel">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Car className="h-4 w-4 text-primary" />
            My Travel
          </CardTitle>
        </CardHeader>

        <CardContent className="px-4 pb-4 space-y-3">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : error ? (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> Failed to load travel data
            </p>
          ) : (
            <>
              {/* ── Today ──────────────────────────────────────────────────────── */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Today</span>
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(), "MMM d")}
                  </span>
                </div>

                {today.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground italic py-1">No visits scheduled today</p>
                ) : (
                  <button
                    onClick={() => setTodayOpen(true)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all text-left group"
                    data-testid="button-open-today-itinerary"
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                      <Car className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-primary leading-tight">
                        {today.length} stop{today.length !== 1 ? "s" : ""} today
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {today.map(t => t.company).slice(0, 3).join(" · ")}
                        {today.length > 3 ? ` +${today.length - 3} more` : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-primary/60 group-hover:text-primary flex-shrink-0 transition-colors" />
                  </button>
                )}
              </div>

              {/* ── Upcoming ────────────────────────────────────────────────────── */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Upcoming</span>
                  {totalUpcoming > 0 && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">{totalUpcoming}</Badge>
                  )}
                </div>

                {upcoming.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground italic py-1">No upcoming visits in the next 14 days</p>
                ) : (
                  <div className="space-y-1">
                    {upcoming.map(day => (
                      <div key={day.date}>
                        <button
                          onClick={() => setExpandedDay(expandedDay === day.date ? null : day.date)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors text-left"
                          data-testid={`button-expand-day-${day.date}`}
                        >
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                          <span className="text-xs font-medium flex-1">{day.label}</span>
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                            {day.tasks.length}
                          </Badge>
                          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground/50 transition-transform ${expandedDay === day.date ? "rotate-90" : ""}`} />
                        </button>

                        {expandedDay === day.date && (
                          <div className="ml-5 pl-2 border-l border-border/40 mt-0.5 mb-1">
                            {day.tasks.map(t => {
                              const loc = [t.city, t.state].filter(Boolean).join(", ");
                              return (
                                <div key={t.task_id} className="flex items-start gap-1.5 py-1.5">
                                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${PRIORITY_DOT[t.priority] ?? "bg-muted-foreground/40"}`} />
                                  <div className="min-w-0 flex-1">
                                    <a
                                      href={`/opportunities/${t.lead_id}`}
                                      target="_blank"
                                      rel="noopener"
                                      className="text-xs font-medium hover:underline truncate block"
                                    >
                                      {t.company}
                                    </a>
                                    <p className="text-[11px] text-muted-foreground truncate">{t.title}</p>
                                    {loc && <p className="text-[11px] text-muted-foreground/70">{loc}</p>}
                                  </div>
                                  {t.marina_lat && t.marina_lng && (
                                    <a
                                      href={`https://www.google.com/maps/dir/?api=1&destination=${t.marina_lat},${t.marina_lng}&travelmode=driving`}
                                      target="_blank"
                                      rel="noopener"
                                      className="text-primary/60 hover:text-primary flex-shrink-0 mt-0.5"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Quick tip ───────────────────────────────────────────────────── */}
              {today.length === 0 && upcoming.length === 0 && (
                <p className="text-[11px] text-muted-foreground/70 text-center pt-1">
                  Link tasks to leads with a due date to see planned visits here.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <TodayItineraryDialog open={todayOpen} onOpenChange={setTodayOpen} tasks={today} />
    </>
  );
}
