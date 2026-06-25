import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarDays, MapPin, Clock, Briefcase, Users2, Plus, Edit2, Trash2,
  Building2, Home, Plane, Coffee, RefreshCw, ChevronLeft, ChevronRight,
  X, Save, Check, AlertCircle, User, Settings,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type WorkStatus = "in_office" | "remote" | "work_travel" | "day_off" | "sick" | "hybrid" | "flexible" | "not_updated";
type LocationType = "office" | "home" | "customer_site" | "marina_site" | "travel" | "other";
type AvailabilityStatus = "available" | "limited" | "deep_work" | "in_meetings" | "travel_day" | "unavailable";
type Visibility = "team" | "leadership" | "private";

interface ScheduleEntry {
  id: number | null;
  userId: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: WorkStatus;
  locationType: string | null;
  locationName: string | null;
  workFocus: string | null;
  availability: string | null;
  notes: string | null;
  visibility: string;
  isRecurringOverride: boolean;
  isDefault?: boolean;
}

interface TeamUser {
  id: number;
  name: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
}

interface TodayRow {
  user: TeamUser;
  date: string;
  entries: ScheduleEntry[];
  source: "entry" | "default" | "none";
}

interface ScheduleDefault {
  id: number;
  userId: number;
  dayOfWeek: number;
  defaultStatus: string;
  defaultStartTime: string | null;
  defaultEndTime: string | null;
  defaultLocationType: string | null;
  defaultLocationName: string | null;
  defaultAvailability: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<WorkStatus, { label: string; color: string; bg: string; icon: any }> = {
  in_office:    { label: "In Office",      color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",  icon: Building2 },
  remote:       { label: "Remote",         color: "text-blue-400",    bg: "bg-blue-500/15 border-blue-500/30 text-blue-300",           icon: Home },
  work_travel:  { label: "Travelling",     color: "text-purple-400",  bg: "bg-purple-500/15 border-purple-500/30 text-purple-300",     icon: Plane },
  day_off:      { label: "Day Off",        color: "text-slate-400",   bg: "bg-slate-500/15 border-slate-500/30 text-slate-300",        icon: Coffee },
  sick:         { label: "Sick / Personal",color: "text-red-400",     bg: "bg-red-500/15 border-red-500/30 text-red-300",             icon: AlertCircle },
  hybrid:       { label: "Hybrid",         color: "text-orange-400",  bg: "bg-orange-500/15 border-orange-500/30 text-orange-300",    icon: RefreshCw },
  flexible:     { label: "Flexible",       color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/30 text-amber-300",       icon: Clock },
  not_updated:  { label: "Not Updated",    color: "text-slate-500",   bg: "bg-slate-500/10 border-slate-600/30 text-slate-400",       icon: AlertCircle },
};

const LOCATION_TYPES: { value: LocationType; label: string }[] = [
  { value: "office",        label: "VoltSafe Office" },
  { value: "home",          label: "Home" },
  { value: "customer_site", label: "Customer Site" },
  { value: "marina_site",   label: "Marina Site" },
  { value: "travel",        label: "Travel" },
  { value: "other",         label: "Other" },
];

const AVAILABILITY_OPTIONS: { value: AvailabilityStatus; label: string }[] = [
  { value: "available",    label: "Available" },
  { value: "limited",      label: "Limited availability" },
  { value: "deep_work",    label: "Deep work (do not disturb)" },
  { value: "in_meetings",  label: "In meetings most of the day" },
  { value: "travel_day",   label: "Travel day" },
  { value: "unavailable",  label: "Unavailable" },
];

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getMondayOfWeek(offsetWeeks = 0): string {
  const d = new Date();
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff + offsetWeeks * 7);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = parseInt(h);
  const ampm = hr >= 12 ? "PM" : "AM";
  const h12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
  return `${h12}:${m} ${ampm}`;
}

function formatHours(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "";
  return [formatTime(start), formatTime(end)].filter(Boolean).join(" – ");
}

function formatDisplayDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function initials(name: string): string {
  return name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, isDefault }: { status: string; isDefault?: boolean }) {
  const cfg = STATUS_CONFIG[status as WorkStatus] ?? STATUS_CONFIG.not_updated;
  if (isDefault) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed text-xs font-medium opacity-75 ${cfg.bg}`}>
          {cfg.label}
        </span>
        <span className="text-[10px] text-slate-600 italic">recurring</span>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${cfg.bg}`}>
      {cfg.label}
    </span>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ user }: { user: TeamUser }) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full object-cover" />;
  }
  return (
    <div className="w-8 h-8 rounded-full bg-cyan-700/40 border border-cyan-600/30 flex items-center justify-center text-xs font-semibold text-cyan-300">
      {initials(user.name)}
    </div>
  );
}

// ── Entry Form Modal ──────────────────────────────────────────────────────────

interface EntryFormProps {
  open: boolean;
  onClose: () => void;
  userId: number;
  date: string;
  entry?: ScheduleEntry | null;
  isAdmin: boolean;
  myUserId: number;
  allUsers: TeamUser[];
}

function EntryFormModal({ open, onClose, userId, date, entry, isAdmin, myUserId, allUsers }: EntryFormProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showMore, setShowMore] = useState(!!entry?.id);

  const [form, setForm] = useState({
    userId: userId,
    date: date,
    status: entry?.status ?? "in_office",
    startTime: entry?.startTime ?? "09:00",
    endTime: entry?.endTime ?? "17:00",
    locationType: entry?.locationType ?? "office",
    locationName: entry?.locationName ?? "",
    workFocus: entry?.workFocus ?? "",
    availability: entry?.availability ?? "available",
    notes: entry?.notes ?? "",
    visibility: entry?.visibility ?? "team",
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/team-calendar/entries", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/team-calendar/today"] }); qc.invalidateQueries({ queryKey: ["/api/team-calendar/week"] }); qc.invalidateQueries({ queryKey: ["/api/team-calendar/my-entries"] }); toast({ title: "✓ Saved", description: "Your schedule is updated." }); onClose(); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/team-calendar/entries/${entry!.id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/team-calendar/today"] }); qc.invalidateQueries({ queryKey: ["/api/team-calendar/week"] }); qc.invalidateQueries({ queryKey: ["/api/team-calendar/my-entries"] }); toast({ title: "✓ Updated", description: "Your schedule is updated." }); onClose(); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    const payload = { ...form, locationName: form.locationName || null, workFocus: form.workFocus || null, notes: form.notes || null };
    if (entry?.id) updateMut.mutate(payload);
    else createMut.mutate(payload);
  };

  const isPending = createMut.isPending || updateMut.isPending;
  const isEditing = !!entry?.id;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-[#0f1623] border-slate-700/60 text-slate-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-slate-100">
            {isEditing ? "Edit schedule" : "Where are you working?"}
          </DialogTitle>
          {!isEditing && (
            <p className="text-xs text-slate-500 mt-0.5">Pick your status for {new Date(form.date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</p>
          )}
        </DialogHeader>
        <div className="space-y-4 py-2">
          {isAdmin && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-xs mb-1 block">Team member</Label>
                <Select value={String(form.userId)} onValueChange={v => setForm(f => ({ ...f, userId: Number(v) }))}>
                  <SelectTrigger className="bg-slate-800/60 border-slate-700 text-slate-100 h-9" data-testid="select-user">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0f1623] border-slate-700">
                    {allUsers.map(u => <SelectItem key={u.id} value={String(u.id)} className="text-slate-100">{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300 text-xs mb-1 block">Date</Label>
                <Input type="date" value={form.date} onChange={e => set("date", e.target.value)} className="bg-slate-800/60 border-slate-700 text-slate-100 h-9" data-testid="input-date" />
              </div>
            </div>
          )}
          {!isAdmin && (
            <div>
              <Label className="text-slate-300 text-xs mb-1 block">Date</Label>
              <Input type="date" value={form.date} onChange={e => set("date", e.target.value)} className="bg-slate-800/60 border-slate-700 text-slate-100 h-9" data-testid="input-date-user" />
            </div>
          )}

          {/* Status grid — always visible, the core of the form */}
          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(STATUS_CONFIG) as [WorkStatus, any][]).filter(([k]) => k !== "not_updated").map(([k, cfg]) => (
              <button key={k} type="button" data-testid={`status-btn-${k}`}
                onClick={() => set("status", k)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm text-left transition-all ${form.status === k ? `${cfg.bg} border-opacity-100 ring-1 ring-cyan-500/40` : "bg-slate-800/40 border-slate-700/50 text-slate-400 hover:bg-slate-800/80"}`}>
                <cfg.icon className="w-3.5 h-3.5 shrink-0" />
                {cfg.label}
              </button>
            ))}
          </div>

          {/* Collapsible details section */}
          {!showMore ? (
            <button type="button" onClick={() => setShowMore(true)}
              className="text-xs text-slate-500 hover:text-cyan-400 flex items-center gap-1 transition-colors"
              data-testid="btn-show-more-details">
              <Plus className="w-3 h-3" /> Add hours, location & notes
            </button>
          ) : (
            <div className="space-y-3 border-t border-slate-700/40 pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-300 text-xs mb-1 block">Start time</Label>
                  <Input type="time" value={form.startTime} onChange={e => set("startTime", e.target.value)} className="bg-slate-800/60 border-slate-700 text-slate-100 h-9" data-testid="input-start-time" />
                </div>
                <div>
                  <Label className="text-slate-300 text-xs mb-1 block">End time</Label>
                  <Input type="time" value={form.endTime} onChange={e => set("endTime", e.target.value)} className="bg-slate-800/60 border-slate-700 text-slate-100 h-9" data-testid="input-end-time" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-300 text-xs mb-1 block">Location</Label>
                  <Select value={form.locationType} onValueChange={v => set("locationType", v)}>
                    <SelectTrigger className="bg-slate-800/60 border-slate-700 text-slate-100 h-9" data-testid="select-location-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0f1623] border-slate-700">
                      {LOCATION_TYPES.map(l => <SelectItem key={l.value} value={l.value} className="text-slate-100">{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-slate-300 text-xs mb-1 block">Specific place</Label>
                  <Input value={form.locationName} onChange={e => set("locationName", e.target.value)} placeholder="e.g. VoltSafe HQ" className="bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 h-9" data-testid="input-location-name" />
                </div>
              </div>

              <div>
                <Label className="text-slate-300 text-xs mb-1 block">What are you working on? <span className="text-slate-600">(optional)</span></Label>
                <Input value={form.workFocus} onChange={e => set("workFocus", e.target.value)} placeholder="e.g. Investor calls, marina leads" className="bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 h-9" data-testid="input-focus" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-300 text-xs mb-1 block">How reachable?</Label>
                  <Select value={form.availability} onValueChange={v => set("availability", v)}>
                    <SelectTrigger className="bg-slate-800/60 border-slate-700 text-slate-100 h-9" data-testid="select-availability">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0f1623] border-slate-700">
                      {AVAILABILITY_OPTIONS.map(a => <SelectItem key={a.value} value={a.value} className="text-slate-100">{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-slate-300 text-xs mb-1 block">Visible to</Label>
                  <Select value={form.visibility} onValueChange={v => set("visibility", v)}>
                    <SelectTrigger className="bg-slate-800/60 border-slate-700 text-slate-100 h-9" data-testid="select-visibility">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0f1623] border-slate-700">
                      <SelectItem value="team" className="text-slate-100">Everyone on the team</SelectItem>
                      <SelectItem value="leadership" className="text-slate-100">Leadership only</SelectItem>
                      <SelectItem value="private" className="text-slate-100">Just me</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-slate-300 text-xs mb-1 block">Notes <span className="text-slate-600">(optional)</span></Label>
                <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Anything the team should know…" className="bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 resize-none h-16" data-testid="input-notes" />
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-slate-400 hover:text-slate-100" data-testid="btn-cancel-entry">Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending} className="bg-cyan-600 hover:bg-cyan-500 text-white" data-testid="btn-save-entry">
            {isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
            {isEditing ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Today Summary Card ────────────────────────────────────────────────────────

function TodaySummaryCard({ summary }: { summary: Record<string, number> }) {
  const items = [
    { key: "in_office",   label: "In Office",       color: "text-emerald-400", value: summary.in_office ?? 0 },
    { key: "remote",      label: "Remote",          color: "text-blue-400",    value: summary.remote ?? 0 },
    { key: "work_travel", label: "Travelling",      color: "text-purple-400",  value: summary.work_travel ?? 0 },
    { key: "day_off",     label: "Day Off",         color: "text-slate-400",   value: summary.day_off ?? 0 },
    { key: "sick",        label: "Sick/Personal",   color: "text-red-400",     value: summary.sick ?? 0 },
    { key: "hybrid",      label: "Hybrid/Flexible", color: "text-orange-400",  value: (summary.hybrid ?? 0) + (summary.flexible ?? 0) },
    { key: "not_updated", label: "Not Updated",     color: "text-slate-500",   value: summary.not_updated ?? 0 },
  ];
  return (
    <Card className="bg-slate-800/40 border-slate-700/50 mb-5" data-testid="today-summary-card">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-cyan-400" />
          Today at a glance
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="flex flex-wrap gap-4">
          {items.map(({ key, label, color, value }) => (
            <div key={key} className="flex items-center gap-1.5" data-testid={`summary-${key}`}>
              <span className={`text-xl font-bold ${color}`}>{value}</span>
              <span className="text-xs text-slate-500 leading-tight max-w-[56px]">{label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Today View ────────────────────────────────────────────────────────────────

function TodayView({ myUserId, isAdmin, onEdit }: { myUserId: number; isAdmin: boolean; onEdit: (userId: number, date: string, entry?: ScheduleEntry) => void }) {
  const [filter, setFilter] = useState({ person: "", status: "all", availability: "all", location: "" });

  const { data, isLoading } = useQuery<{ date: string; rows: TodayRow[]; summary: Record<string, number> }>({
    queryKey: ["/api/team-calendar/today"],
  });

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.filter(row => {
      if (filter.person && !row.user.name.toLowerCase().includes(filter.person.toLowerCase())) return false;
      const primaryStatus = row.entries[0]?.status ?? "not_updated";
      if (filter.status !== "all" && primaryStatus !== filter.status) return false;
      const avail = row.entries[0]?.availability;
      if (filter.availability !== "all" && avail !== filter.availability) return false;
      if (filter.location) {
        const loc = (row.entries[0]?.locationName ?? "").toLowerCase();
        if (!loc.includes(filter.location.toLowerCase())) return false;
      }
      return true;
    });
  }, [data, filter]);

  if (isLoading) return (
    <div className="space-y-3">
      {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full bg-slate-800/50" />)}
    </div>
  );

  return (
    <div>
      {data?.summary && <TodaySummaryCard summary={data.summary} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          placeholder="Filter by name…"
          value={filter.person}
          onChange={e => setFilter(f => ({ ...f, person: e.target.value }))}
          className="bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 h-8 text-sm w-40"
          data-testid="filter-person"
        />
        <Select value={filter.status} onValueChange={v => setFilter(f => ({ ...f, status: v }))}>
          <SelectTrigger className="bg-slate-800/60 border-slate-700 text-slate-100 h-8 text-sm w-36" data-testid="filter-status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent className="bg-[#0f1623] border-slate-700">
            <SelectItem value="all" className="text-slate-100">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k} className="text-slate-100">{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filter.availability} onValueChange={v => setFilter(f => ({ ...f, availability: v }))}>
          <SelectTrigger className="bg-slate-800/60 border-slate-700 text-slate-100 h-8 text-sm w-40" data-testid="filter-availability">
            <SelectValue placeholder="All availability" />
          </SelectTrigger>
          <SelectContent className="bg-[#0f1623] border-slate-700">
            <SelectItem value="all" className="text-slate-100">All Availability</SelectItem>
            {AVAILABILITY_OPTIONS.map(a => <SelectItem key={a.value} value={a.value} className="text-slate-100">{a.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by location…"
          value={filter.location}
          onChange={e => setFilter(f => ({ ...f, location: e.target.value }))}
          className="bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 h-8 text-sm w-40"
          data-testid="filter-location"
        />
        {(filter.person || filter.status !== "all" || filter.availability !== "all" || filter.location) && (
          <Button size="sm" variant="ghost" className="h-8 text-slate-500 hover:text-slate-200 text-xs px-2"
            onClick={() => setFilter({ person: "", status: "all", availability: "all", location: "" })}
            data-testid="btn-clear-filters">
            <X className="w-3 h-3 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* Team table */}
      <div className="overflow-x-auto rounded-xl border border-slate-700/50">
        <table className="w-full text-sm" data-testid="today-table">
          <thead>
            <tr className="border-b border-slate-700/50 bg-slate-800/40">
              <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Person</th>
              <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Location</th>
              <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Hours</th>
              <th className="hidden md:table-cell text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Focus</th>
              <th className="hidden lg:table-cell text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Reachable</th>
              <th className="hidden lg:table-cell text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Notes</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => {
              const primary = row.entries[0];
              const status: WorkStatus = (primary?.status as WorkStatus) ?? "not_updated";
              const canEdit = isAdmin || row.user.id === myUserId;
              return (
                <tr key={row.user.id} className="border-b border-slate-700/30 hover:bg-slate-800/30 transition-colors" data-testid={`today-row-${row.user.id}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar user={row.user} />
                      <div>
                        <div className="font-medium text-slate-100 text-sm">{row.user.name}</div>
                        {row.user.jobTitle && <div className="text-xs text-slate-500">{row.user.jobTitle}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={status} isDefault={row.source === "default"} />
                    {row.entries.length > 1 && (
                      <div className="mt-0.5">
                        {row.entries.slice(1).map((e, i) => <StatusBadge key={i} status={e.status} />)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{primary?.locationName || <span className="text-slate-600">—</span>}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">{formatHours(primary?.startTime, primary?.endTime) || <span className="text-slate-600">—</span>}</td>
                  <td className="hidden md:table-cell px-4 py-3 text-slate-300 text-xs max-w-[160px] truncate" title={primary?.workFocus ?? ""}>{primary?.workFocus || <span className="text-slate-600">—</span>}</td>
                  <td className="hidden lg:table-cell px-4 py-3 text-xs">
                    {primary?.availability ? (
                      <span className="text-slate-300 capitalize">{primary.availability.replace(/_/g, " ")}</span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-3 text-slate-400 text-xs max-w-[160px] truncate" title={primary?.notes ?? ""}>{primary?.notes || <span className="text-slate-600">—</span>}</td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-500 hover:text-cyan-400"
                        onClick={() => onEdit(row.user.id, row.date, primary ?? undefined)}
                        data-testid={`btn-edit-${row.user.id}`}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && data?.rows?.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center">
                <div className="text-slate-400 text-sm font-medium mb-1">No team members yet</div>
                <div className="text-slate-600 text-xs">Add some users to start tracking schedules</div>
              </td></tr>
            )}
            {filtered.length === 0 && (data?.rows?.length ?? 0) > 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center">
                <div className="text-slate-400 text-sm">No one matches those filters.</div>
                <button className="text-cyan-500 text-xs mt-1 hover:underline" onClick={() => setFilter({ person: "", status: "all", availability: "all", location: "" })}>Clear filters</button>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Week View ─────────────────────────────────────────────────────────────────

function WeekView({ myUserId, isAdmin, onEdit }: { myUserId: number; isAdmin: boolean; onEdit: (userId: number, date: string, entry?: ScheduleEntry) => void }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const monday = getMondayOfWeek(weekOffset);
  const weekDates = [0,1,2,3,4].map(i => addDays(monday, i));

  const { data, isLoading } = useQuery<{ users: TeamUser[]; dates: string[]; schedule: Record<string, { user: TeamUser; date: string; entries: ScheduleEntry[]; source: string }[]> }>({
    queryKey: ["/api/team-calendar/week", monday],
    queryFn: async () => {
      const res = await fetch(`/api/team-calendar/week?startDate=${monday}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  if (isLoading) return <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14 w-full bg-slate-800/50" />)}</div>;

  const allUsers = data?.users ?? [];
  if (!isLoading && allUsers.length === 0) return (
    <div className="text-center py-16 text-slate-500">
      <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm">No team members to show yet.</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button size="sm" variant="ghost" onClick={() => setWeekOffset(o => o - 1)} className="text-slate-400 hover:text-slate-100" data-testid="btn-prev-week">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-slate-300 text-sm font-medium">
          Week of {formatDisplayDate(monday)}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setWeekOffset(o => o + 1)} className="text-slate-400 hover:text-slate-100" data-testid="btn-next-week">
          <ChevronRight className="w-4 h-4" />
        </Button>
        {weekOffset !== 0 && (
          <Button size="sm" variant="ghost" onClick={() => setWeekOffset(0)} className="text-cyan-400 hover:text-cyan-300 text-xs" data-testid="btn-this-week">
            This Week
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700/50">
        <table className="w-full text-sm min-w-[700px]" data-testid="week-table">
          <thead>
            <tr className="border-b border-slate-700/50 bg-slate-800/40">
              <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium w-40">Team Member</th>
              {weekDates.map((d, i) => (
                <th key={d} className="text-left px-3 py-2.5 text-xs text-slate-400 font-medium">
                  <div>{DAYS_OF_WEEK[i]}</div>
                  <div className="text-slate-500 font-normal">{new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allUsers.map(user => {
              const userSchedule = data?.schedule?.[user.id] ?? [];
              return (
                <tr key={user.id} className="border-b border-slate-700/30 hover:bg-slate-800/20" data-testid={`week-row-${user.id}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar user={user} />
                      <span className="text-slate-200 text-xs font-medium">{user.name}</span>
                    </div>
                  </td>
                  {weekDates.map((date, di) => {
                    const dayData = userSchedule.find(s => s.date === date);
                    const entry = dayData?.entries?.[0];
                    const status: WorkStatus = (entry?.status as WorkStatus) ?? "not_updated";
                    const cfg = STATUS_CONFIG[status];
                    const canEdit = isAdmin || user.id === myUserId;
                    const isRecurring = dayData?.source === "default";
                    return (
                      <td key={date} className="px-2 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => canEdit && onEdit(user.id, date, entry ?? undefined)}
                          className={`w-full text-left rounded-lg px-2 py-1.5 transition-all min-h-[52px] ${
                            status === "not_updated"
                              ? "border border-slate-700/30 bg-slate-800/20 hover:bg-slate-800/50"
                              : isRecurring
                                ? `border border-dashed ${cfg.bg} opacity-65 hover:opacity-85`
                                : `border ${cfg.bg} hover:opacity-90`
                          } ${canEdit ? "cursor-pointer" : "cursor-default"}`}
                          data-testid={`week-cell-${user.id}-${di}`}
                        >
                          <div className="text-xs font-medium leading-tight mb-0.5">
                            {status === "not_updated" ? <span className="text-slate-600">—</span> : cfg.label}
                          </div>
                          {entry?.locationName && <div className="text-xs opacity-70 truncate">{entry.locationName}</div>}
                          {(entry?.startTime || entry?.endTime) && <div className="text-xs opacity-60">{formatHours(entry.startTime, entry.endTime)}</div>}
                        </button>
                        {dayData?.entries && dayData.entries.length > 1 && (
                          <div className="flex flex-col gap-0.5 mt-1">
                            {dayData.entries.slice(1).map((e, i) => {
                              const eCfg = STATUS_CONFIG[e.status as WorkStatus] ?? STATUS_CONFIG.not_updated;
                              return (
                                <button key={i} type="button" onClick={() => canEdit && onEdit(user.id, date, e)}
                                  className={`w-full text-left rounded px-2 py-1 border text-xs ${eCfg.bg} ${canEdit ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}>
                                  {eCfg.label}
                                  {(e.startTime || e.endTime) && <span className="opacity-60 ml-1">{formatHours(e.startTime, e.endTime)}</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── My Schedule View ──────────────────────────────────────────────────────────

function MyScheduleView({ myUserId }: { myUserId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [quickStatus, setQuickStatus] = useState<WorkStatus | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState<ScheduleEntry | null>(null);
  const [showDefaults, setShowDefaults] = useState(false);
  const [defaultForm, setDefaultForm] = useState<Record<number, Partial<ScheduleDefault>>>({});

  const today = todayISO();

  const { data, isLoading } = useQuery<{ entries: ScheduleEntry[]; defaults: ScheduleDefault[] }>({
    queryKey: ["/api/team-calendar/my-entries"],
  });

  const todayEntries = data?.entries?.filter(e => e.date === today) ?? [];
  const upcomingEntries = data?.entries?.filter(e => e.date > today) ?? [];
  const myDefaults = data?.defaults ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/team-calendar/entries/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/team-calendar/my-entries"] }); qc.invalidateQueries({ queryKey: ["/api/team-calendar/today"] }); qc.invalidateQueries({ queryKey: ["/api/team-calendar/week"] }); toast({ title: "Entry deleted" }); },
  });

  const defaultMut = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/team-calendar/defaults", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/team-calendar/my-entries"] }); toast({ title: "Default schedule saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteDefaultMut = useMutation({
    mutationFn: ({ userId, dayOfWeek }: { userId: number; dayOfWeek: number }) => apiRequest("DELETE", `/api/team-calendar/defaults/${userId}/${dayOfWeek}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/team-calendar/my-entries"] }); toast({ title: "Default removed" }); },
  });

  const handleQuickStatusClick = (status: WorkStatus) => {
    setQuickStatus(status);
    setShowForm(true);
    setEditEntry(null);
  };

  const quickButtons: { status: WorkStatus; label: string; icon: any; color: string }[] = [
    { status: "in_office",   label: "In Office",   icon: Building2,   color: "bg-emerald-600/20 border-emerald-600/40 text-emerald-300 hover:bg-emerald-600/30" },
    { status: "remote",      label: "Remote",      icon: Home,        color: "bg-blue-600/20 border-blue-600/40 text-blue-300 hover:bg-blue-600/30" },
    { status: "work_travel", label: "Travelling",  icon: Plane,       color: "bg-purple-600/20 border-purple-600/40 text-purple-300 hover:bg-purple-600/30" },
    { status: "day_off",     label: "Day Off",     icon: Coffee,      color: "bg-slate-600/20 border-slate-600/40 text-slate-300 hover:bg-slate-600/30" },
    { status: "hybrid",      label: "Hybrid",      icon: RefreshCw,   color: "bg-orange-600/20 border-orange-600/40 text-orange-300 hover:bg-orange-600/30" },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      {/* Quick update */}
      <Card className="bg-slate-800/40 border-slate-700/50" data-testid="quick-update-card">
        <CardHeader className="pb-3 pt-4 px-5">
          <CardTitle className="text-sm font-semibold text-slate-200">
            {todayEntries.length > 0 ? "Your status today" : "Where are you working today?"}
          </CardTitle>
          <p className="text-xs text-slate-500">{formatDisplayDate(today)}</p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {todayEntries.length > 0 && (
            <div className="space-y-2 mb-4">
              {todayEntries.map(e => (
                <div key={e.id} className="flex items-center justify-between bg-slate-700/30 rounded-lg px-3 py-2" data-testid={`my-today-entry-${e.id}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <StatusBadge status={e.status} />
                    {e.locationName && <span className="text-slate-300 text-xs">{e.locationName}</span>}
                    {(e.startTime || e.endTime) && <span className="text-slate-500 text-xs">{formatHours(e.startTime, e.endTime)}</span>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-500 hover:text-cyan-400" onClick={() => { setEditEntry(e); setShowForm(true); }} data-testid={`btn-edit-my-${e.id}`}>
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-500 hover:text-red-400" onClick={() => e.id && deleteMut.mutate(e.id)} data-testid={`btn-delete-my-${e.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500 mb-2.5">
            {todayEntries.length === 0 ? "Tap to log where you're working — takes just a few seconds." : "Add another time block if your day is split:"}
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {quickButtons.map(({ status, label, icon: Icon, color }) => (
              <button key={status} type="button" data-testid={`quick-btn-${status}`}
                onClick={() => handleQuickStatusClick(status)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-sm font-medium transition-all ${color}`}>
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="text-slate-400 hover:text-cyan-300 text-xs gap-1" onClick={() => { setEditEntry(null); setQuickStatus(null); setShowForm(true); }} data-testid="btn-add-entry">
            <Plus className="w-3.5 h-3.5" /> Add more details or a custom time block
          </Button>
        </CardContent>
      </Card>

      {/* Upcoming entries */}
      {upcomingEntries.length > 0 && (
        <Card className="bg-slate-800/40 border-slate-700/50" data-testid="upcoming-entries-card">
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold text-slate-200">Upcoming Schedule</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <div className="space-y-1.5">
              {upcomingEntries.slice(0, 14).map(e => (
                <div key={e.id} className="flex items-center justify-between py-1.5 border-b border-slate-700/30 last:border-0" data-testid={`upcoming-entry-${e.id}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 text-xs w-24 shrink-0">{formatDisplayDate(e.date)}</span>
                    <StatusBadge status={e.status} />
                    {e.locationName && <span className="text-slate-400 text-xs">{e.locationName}</span>}
                    {(e.startTime || e.endTime) && <span className="text-slate-500 text-xs">{formatHours(e.startTime, e.endTime)}</span>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-500 hover:text-cyan-400" onClick={() => { setEditEntry(e); setShowForm(true); }} data-testid={`btn-edit-upcoming-${e.id}`}>
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-500 hover:text-red-400" onClick={() => e.id && deleteMut.mutate(e.id)} data-testid={`btn-delete-upcoming-${e.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Default schedule */}
      <Card className="bg-slate-800/40 border-slate-700/50" data-testid="default-schedule-card">
        <CardHeader className="pb-2 pt-4 px-5 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold text-slate-200">My weekly pattern</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">Your usual schedule — shows automatically when you haven't logged for the day</p>
          </div>
          <Button size="sm" variant="ghost" className="text-slate-400 hover:text-cyan-300 h-7 gap-1 text-xs shrink-0" onClick={() => setShowDefaults(v => !v)} data-testid="btn-toggle-defaults">
            <Settings className="w-3.5 h-3.5" />
            {showDefaults ? "Done" : "Edit"}
          </Button>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          {myDefaults.length === 0 && !showDefaults ? (
            <div className="py-3 text-center">
              <p className="text-slate-500 text-sm mb-1">No weekly pattern set yet.</p>
              <p className="text-slate-600 text-xs">Set your usual days so the team always knows where you'll be, even if you forget to log.</p>
              <Button size="sm" variant="ghost" className="text-cyan-500 hover:text-cyan-300 text-xs gap-1 mt-2" onClick={() => setShowDefaults(true)} data-testid="btn-set-pattern">
                <Settings className="w-3 h-3" /> Set my pattern
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {DAYS_OF_WEEK.map((day, dow) => {
                const existing = myDefaults.find(d => d.dayOfWeek === dow);
                const formVal = defaultForm[dow];
                if (!showDefaults && !existing) return null;
                return (
                  <div key={dow} className="flex items-center gap-3 py-1.5 border-b border-slate-700/30 last:border-0" data-testid={`default-row-${dow}`}>
                    <span className="text-slate-400 text-xs w-20 shrink-0">{day}</span>
                    {showDefaults ? (
                      <div className="flex flex-wrap gap-2 flex-1 items-center">
                        <Select
                          value={formVal?.defaultStatus ?? existing?.defaultStatus ?? ""}
                          onValueChange={v => setDefaultForm(f => ({ ...f, [dow]: { ...f[dow], defaultStatus: v } }))}
                        >
                          <SelectTrigger className="bg-slate-800/60 border-slate-700 text-slate-100 h-7 text-xs w-32" data-testid={`default-status-${dow}`}>
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                          <SelectContent className="bg-[#0f1623] border-slate-700">
                            {Object.entries(STATUS_CONFIG).filter(([k]) => k !== "not_updated").map(([k, v]) => (
                              <SelectItem key={k} value={k} className="text-slate-100 text-xs">{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input type="time" placeholder="Start" className="bg-slate-800/60 border-slate-700 text-slate-100 h-7 text-xs w-24"
                          value={formVal?.defaultStartTime ?? existing?.defaultStartTime ?? ""}
                          onChange={e => setDefaultForm(f => ({ ...f, [dow]: { ...f[dow], defaultStartTime: e.target.value } }))}
                          data-testid={`default-start-${dow}`}
                        />
                        <Input type="time" placeholder="End" className="bg-slate-800/60 border-slate-700 text-slate-100 h-7 text-xs w-24"
                          value={formVal?.defaultEndTime ?? existing?.defaultEndTime ?? ""}
                          onChange={e => setDefaultForm(f => ({ ...f, [dow]: { ...f[dow], defaultEndTime: e.target.value } }))}
                          data-testid={`default-end-${dow}`}
                        />
                        <Input placeholder="Location" className="bg-slate-800/60 border-slate-700 text-slate-100 h-7 text-xs w-28"
                          value={formVal?.defaultLocationName ?? existing?.defaultLocationName ?? ""}
                          onChange={e => setDefaultForm(f => ({ ...f, [dow]: { ...f[dow], defaultLocationName: e.target.value } }))}
                          data-testid={`default-location-${dow}`}
                        />
                        <Button size="sm" className="h-7 bg-cyan-700/50 hover:bg-cyan-600/60 text-cyan-200 text-xs px-2 gap-1"
                          data-testid={`btn-save-default-${dow}`}
                          disabled={defaultMut.isPending}
                          onClick={() => {
                            const val = formVal ?? {};
                            const status = val.defaultStatus ?? existing?.defaultStatus;
                            if (!status) return toast({ title: "Select a status first", variant: "destructive" });
                            defaultMut.mutate({
                              dayOfWeek: dow,
                              defaultStatus: status,
                              defaultStartTime: val.defaultStartTime ?? existing?.defaultStartTime ?? null,
                              defaultEndTime: val.defaultEndTime ?? existing?.defaultEndTime ?? null,
                              defaultLocationType: val.defaultLocationType ?? existing?.defaultLocationType ?? null,
                              defaultLocationName: val.defaultLocationName ?? existing?.defaultLocationName ?? null,
                              defaultAvailability: val.defaultAvailability ?? existing?.defaultAvailability ?? null,
                            });
                          }}>
                          <Check className="w-3 h-3" /> Save
                        </Button>
                        {existing && (
                          <Button size="sm" variant="ghost" className="h-7 text-red-400/60 hover:text-red-400 text-xs px-1"
                            data-testid={`btn-delete-default-${dow}`}
                            onClick={() => deleteDefaultMut.mutate({ userId: myUserId, dayOfWeek: dow })}>
                            <X className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      existing ? (
                        <div className="flex items-center gap-2">
                          <StatusBadge status={existing.defaultStatus} />
                          {existing.defaultLocationName && <span className="text-slate-400 text-xs">{existing.defaultLocationName}</span>}
                          {(existing.defaultStartTime || existing.defaultEndTime) && (
                            <span className="text-slate-500 text-xs">{formatHours(existing.defaultStartTime, existing.defaultEndTime)}</span>
                          )}
                        </div>
                      ) : null
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {showForm && (
        <EntryFormModal
          open={showForm}
          onClose={() => { setShowForm(false); setEditEntry(null); setQuickStatus(null); }}
          userId={myUserId}
          date={today}
          entry={editEntry ?? (quickStatus ? { id: null, userId: myUserId, date: today, startTime: "09:00", endTime: "17:00", status: quickStatus, locationType: "office", locationName: "", workFocus: null, availability: "available", notes: null, visibility: "team", isRecurringOverride: false } as any : undefined)}
          isAdmin={false}
          myUserId={myUserId}
          allUsers={[]}
        />
      )}
    </div>
  );
}

// ── Person Detail Modal ───────────────────────────────────────────────────────

function PersonDetailModal({ user, open, onClose, isAdmin, myUserId, onEdit }: { user: TeamUser; open: boolean; onClose: () => void; isAdmin: boolean; myUserId: number; onEdit: (userId: number, date: string, entry?: ScheduleEntry) => void }) {
  const { data, isLoading } = useQuery<{ user: TeamUser; entries: ScheduleEntry[]; defaults: ScheduleDefault[] }>({
    queryKey: ["/api/team-calendar/user", user.id],
    queryFn: async () => {
      const res = await fetch(`/api/team-calendar/user/${user.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-[#0f1623] border-slate-700/60 text-slate-100 max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Avatar user={user} />
            <div>
              <div className="text-slate-100 font-semibold">{user.name}</div>
              {user.jobTitle && <div className="text-xs text-slate-400">{user.jobTitle}</div>}
            </div>
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2 py-4">{[1,2,3].map(i => <Skeleton key={i} className="h-12 bg-slate-800/50" />)}</div>
        ) : (
          <div className="space-y-5 py-2">
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Upcoming Schedule</h4>
              {(!data?.entries || data.entries.length === 0) ? (
                <p className="text-slate-500 text-sm">No upcoming entries.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.entries.slice(0, 10).map(e => (
                    <div key={e.id} className="flex items-center justify-between py-1.5 border-b border-slate-700/30 last:border-0" data-testid={`person-entry-${e.id}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-xs w-20 shrink-0">{formatDisplayDate(e.date)}</span>
                        <StatusBadge status={e.status} />
                        {e.locationName && <span className="text-slate-400 text-xs">{e.locationName}</span>}
                        {(e.startTime || e.endTime) && <span className="text-slate-500 text-xs">{formatHours(e.startTime, e.endTime)}</span>}
                      </div>
                      {(isAdmin || user.id === myUserId) && e.id && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-500 hover:text-cyan-400" onClick={() => { onClose(); onEdit(user.id, e.date, e); }} data-testid={`btn-edit-person-${e.id}`}>
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {data?.defaults && data.defaults.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Default Weekly Pattern</h4>
                <div className="space-y-1.5">
                  {data.defaults.map(d => (
                    <div key={d.id} className="flex items-center gap-3 py-1 border-b border-slate-700/20 last:border-0" data-testid={`person-default-${d.dayOfWeek}`}>
                      <span className="text-slate-400 text-xs w-20 shrink-0">{DAYS_OF_WEEK[d.dayOfWeek]}</span>
                      <StatusBadge status={d.defaultStatus} />
                      {d.defaultLocationName && <span className="text-slate-400 text-xs">{d.defaultLocationName}</span>}
                      {(d.defaultStartTime || d.defaultEndTime) && <span className="text-slate-500 text-xs">{formatHours(d.defaultStartTime, d.defaultEndTime)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(isAdmin || user.id === myUserId) && (
              <Button size="sm" className="bg-cyan-700/40 hover:bg-cyan-600/50 text-cyan-200 gap-1 text-xs" onClick={() => { onClose(); onEdit(user.id, todayISO()); }} data-testid="btn-add-entry-person">
                <Plus className="w-3.5 h-3.5" /> Add entry for {user.name.split(" ")[0]}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── People View ───────────────────────────────────────────────────────────────

function PeopleView({ myUserId, isAdmin, onEdit }: { myUserId: number; isAdmin: boolean; onEdit: (userId: number, date: string, entry?: ScheduleEntry) => void }) {
  const [selectedUser, setSelectedUser] = useState<TeamUser | null>(null);
  const [search, setSearch] = useState("");

  const { data: allUsers = [], isLoading } = useQuery<TeamUser[]>({
    queryKey: ["/api/team-calendar/users"],
  });

  const { data: todayData } = useQuery<{ date: string; rows: TodayRow[]; summary: Record<string, number> }>({
    queryKey: ["/api/team-calendar/today"],
  });

  const filtered = allUsers.filter(u => !search || u.name.toLowerCase().includes(search.toLowerCase()));

  const getUserStatus = (userId: number): WorkStatus => {
    const row = todayData?.rows?.find(r => r.user.id === userId);
    return (row?.entries?.[0]?.status as WorkStatus) ?? "not_updated";
  };

  return (
    <div>
      <div className="mb-4">
        <Input
          placeholder="Search people…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 h-8 text-sm w-56"
          data-testid="people-search"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-28 bg-slate-800/50 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3" data-testid="people-grid">
          {filtered.map(user => {
            const status = getUserStatus(user.id);
            const cfg = STATUS_CONFIG[status];
            return (
              <button key={user.id} type="button"
                onClick={() => setSelectedUser(user)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/60 hover:border-slate-600/60 transition-all text-center group"
                data-testid={`person-card-${user.id}`}>
                <Avatar user={user} />
                <div>
                  <div className="text-sm font-medium text-slate-200 group-hover:text-slate-100">{user.name}</div>
                  {user.jobTitle && <div className="text-xs text-slate-500 truncate max-w-[110px]">{user.jobTitle}</div>}
                </div>
                <StatusBadge status={status} />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-4 text-center text-slate-500 py-8 text-sm">No team members found</div>
          )}
        </div>
      )}

      {selectedUser && (
        <PersonDetailModal
          user={selectedUser}
          open={!!selectedUser}
          onClose={() => setSelectedUser(null)}
          isAdmin={isAdmin}
          myUserId={myUserId}
          onEdit={onEdit}
        />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TeamWorkCalendarPage() {
  const [activeTab, setActiveTab] = useState("today");
  const [entryModal, setEntryModal] = useState<{ open: boolean; userId: number; date: string; entry?: ScheduleEntry } | null>(null);

  const { data: meData } = useQuery<{ id: number; name: string; role: string; globalRole: string }>({
    queryKey: ["/api/auth/me"],
  });

  const myUserId = meData?.id ?? 0;
  const isAdmin = meData?.globalRole === "admin" || meData?.globalRole === "master_admin";

  const { data: allUsers = [] } = useQuery<TeamUser[]>({
    queryKey: ["/api/team-calendar/users"],
  });

  const handleEdit = useCallback((userId: number, date: string, entry?: ScheduleEntry) => {
    setEntryModal({ open: true, userId, date, entry });
  }, []);

  const today = todayISO();
  const dateLabel = new Date(today + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="min-h-screen bg-[#0a0f1a] px-4 sm:px-6 lg:px-8 py-6">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <CalendarDays className="w-5 h-5 text-cyan-400" />
          <h1 className="text-xl font-bold text-slate-100">Work Calendar</h1>
        </div>
        <p className="text-sm text-slate-400">{dateLabel} · Who's in, who's remote, who's off</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <TabsList className="bg-slate-800/60 border border-slate-700/50 h-9 p-1 gap-0.5">
            <TabsTrigger value="today" className="data-[state=active]:bg-cyan-700/40 data-[state=active]:text-cyan-200 text-slate-400 text-xs px-3 h-7" data-testid="tab-today">
              Today
            </TabsTrigger>
            <TabsTrigger value="week" className="data-[state=active]:bg-cyan-700/40 data-[state=active]:text-cyan-200 text-slate-400 text-xs px-3 h-7" data-testid="tab-week">
              Week
            </TabsTrigger>
            <TabsTrigger value="my-schedule" className="data-[state=active]:bg-cyan-700/40 data-[state=active]:text-cyan-200 text-slate-400 text-xs px-3 h-7" data-testid="tab-my-schedule">
              My Schedule
            </TabsTrigger>
            <TabsTrigger value="people" className="data-[state=active]:bg-cyan-700/40 data-[state=active]:text-cyan-200 text-slate-400 text-xs px-3 h-7" data-testid="tab-people">
              People
            </TabsTrigger>
          </TabsList>

          <Button
            size="sm"
            className="bg-cyan-700/40 hover:bg-cyan-600/50 border border-cyan-600/30 text-cyan-200 gap-1.5 text-xs h-8"
            onClick={() => setEntryModal({ open: true, userId: myUserId, date: today })}
            data-testid="btn-add-entry-header"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Entry
          </Button>
        </div>

        <TabsContent value="today" className="mt-0">
          <TodayView myUserId={myUserId} isAdmin={isAdmin} onEdit={handleEdit} />
        </TabsContent>

        <TabsContent value="week" className="mt-0">
          <WeekView myUserId={myUserId} isAdmin={isAdmin} onEdit={handleEdit} />
        </TabsContent>

        <TabsContent value="my-schedule" className="mt-0">
          <MyScheduleView myUserId={myUserId} />
        </TabsContent>

        <TabsContent value="people" className="mt-0">
          <PeopleView myUserId={myUserId} isAdmin={isAdmin} onEdit={handleEdit} />
        </TabsContent>
      </Tabs>

      {/* Global entry form modal */}
      {entryModal?.open && (
        <EntryFormModal
          open={entryModal.open}
          onClose={() => setEntryModal(null)}
          userId={entryModal.userId}
          date={entryModal.date}
          entry={entryModal.entry}
          isAdmin={isAdmin}
          myUserId={myUserId}
          allUsers={allUsers}
        />
      )}
    </div>
  );
}
