import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import {
  Search, Plus, LayoutList, CalendarDays, GanttChartSquare,
  MapPin, Globe, Users, Mic2, Award, Building2, X,
  ExternalLink, Upload, FileText, Trash2, Download, Edit2, ChevronRight
} from "lucide-react";
import type { TradeshowEvent, Attachment } from "@shared/schema";

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  booked:        { label: "Booked",        color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", dot: "bg-emerald-400" },
  pending:       { label: "Pending",        color: "text-amber-400 border-amber-500/30 bg-amber-500/10",     dot: "bg-amber-400" },
  not_attending: { label: "Not Attending",  color: "text-slate-400 border-slate-500/30 bg-slate-500/10",     dot: "bg-slate-400" },
  tbd:           { label: "TBD",            color: "text-blue-400 border-blue-500/30 bg-blue-500/10",         dot: "bg-blue-400" },
};

const MONTHS_2026 = [
  { label: "Jan", monthIdx: 0, year: 2026 }, { label: "Feb", monthIdx: 1, year: 2026 },
  { label: "Mar", monthIdx: 2, year: 2026 }, { label: "Apr", monthIdx: 3, year: 2026 },
  { label: "May", monthIdx: 4, year: 2026 }, { label: "Jun", monthIdx: 5, year: 2026 },
  { label: "Jul", monthIdx: 6, year: 2026 }, { label: "Aug", monthIdx: 7, year: 2026 },
  { label: "Sep", monthIdx: 8, year: 2026 }, { label: "Oct", monthIdx: 9, year: 2026 },
  { label: "Nov", monthIdx: 10, year: 2026 }, { label: "Dec", monthIdx: 11, year: 2026 },
  { label: "Jan \'27", monthIdx: 0, year: 2027 }, { label: "Feb \'27", monthIdx: 1, year: 2027 },
];

const GANTT_START = new Date("2026-01-01T00:00:00Z");
const GANTT_END   = new Date("2027-03-01T00:00:00Z");
const GANTT_DAYS  = Math.round((GANTT_END.getTime() - GANTT_START.getTime()) / 86400000);

function ganttPct(date: Date | null | string): number {
  if (!date) return 0;
  const d = typeof date === "string" ? new Date(date) : date;
  return Math.max(0, Math.min(100, (d.getTime() - GANTT_START.getTime()) / 86400000 / GANTT_DAYS * 100));
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.tbd;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function EventFormSheet({
  open, onClose, event, onSaved
}: {
  open: boolean; onClose: () => void;
  event?: TradeshowEvent | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!event;

  const defaultValues = {
    showName: event?.showName ?? "",
    vsLeadName: event?.vsLeadName ?? "",
    vsAttendees: event?.vsAttendees ?? "",
    showDates: event?.showDates ?? "",
    startDate: event?.startDate ? new Date(event.startDate).toISOString().split("T")[0] : "",
    endDate: event?.endDate ? new Date(event.endDate).toISOString().split("T")[0] : "",
    year: event?.year ?? 2026,
    venue: event?.venue ?? "",
    city: event?.city ?? "",
    address: event?.address ?? "",
    bookedStatus: event?.bookedStatus ?? "pending",
    website: event?.website ?? "",
    audience: event?.audience ?? "",
    boothNumber: event?.boothNumber ?? "",
    boothSize: event?.boothSize ?? "",
    eventContact: event?.eventContact ?? "",
    eventEmail: event?.eventEmail ?? "",
    eventFee: event?.eventFee ?? "",
    showSupplier: event?.showSupplier ?? "",
    speakingEngagement: event?.speakingEngagement ?? "",
    awardsSubmission: event?.awardsSubmission ?? "",
    notes: event?.notes ?? "",
  };

  const [form, setForm] = useState(defaultValues);
  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload: Record<string, unknown> = { ...data };
      if (data.startDate) payload.startDate = new Date(data.startDate).toISOString();
      else payload.startDate = null;
      if (data.endDate) payload.endDate = new Date(data.endDate).toISOString();
      else payload.endDate = null;
      payload.year = Number(data.year);
      if (isEdit) {
        const res = await apiRequest("PUT", `/api/tradeshow-events/${event!.id}`, payload);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/tradeshow-events", payload);
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tradeshow-events"] });
      toast({ title: isEdit ? "Event updated" : "Event created" });
      onSaved();
      onClose();
    },
    onError: () => toast({ title: "Error", description: "Failed to save event", variant: "destructive" }),
  });

  const field = (label: string, key: string, type = "text", fullWidth = false) => (
    <div className={fullWidth ? "col-span-2" : ""}>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <Input
        type={type}
        value={String((form as any)[key] ?? "")}
        onChange={e => set(key, e.target.value)}
        className="bg-background/50 border-border/50 h-8 text-sm"
        data-testid={`input-${key}`}
      />
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto bg-background border-border/50">
        <SheetHeader className="pb-4">
          <SheetTitle>{isEdit ? "Edit Event" : "New Event"}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Show Name *</Label>
              <Input value={form.showName} onChange={e => set("showName", e.target.value)}
                className="bg-background/50 border-border/50 text-sm" data-testid="input-showName" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
              <Select value={form.bookedStatus} onValueChange={v => set("bookedStatus", v)}>
                <SelectTrigger className="bg-background/50 border-border/50 h-8 text-sm" data-testid="select-bookedStatus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Year</Label>
              <Select value={String(form.year)} onValueChange={v => set("year", Number(v))}>
                <SelectTrigger className="bg-background/50 border-border/50 h-8 text-sm" data-testid="select-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2025">2025</SelectItem>
                  <SelectItem value="2026">2026</SelectItem>
                  <SelectItem value="2027">2027</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {field("Show Dates (display)", "showDates")}
            {field("Start Date", "startDate", "date")}
            {field("End Date", "endDate", "date")}
            {field("Venue", "venue")}
            {field("City", "city")}
            {field("Address", "address", "text", true)}
            {field("VS Lead", "vsLeadName")}
            {field("VS Attendees", "vsAttendees")}
            {field("Booth #", "boothNumber")}
            {field("Booth Size", "boothSize")}
            {field("Event Contact", "eventContact")}
            {field("Event Email", "eventEmail", "email")}
            {field("Event Fee", "eventFee")}
            {field("Show Supplier", "showSupplier")}
            {field("Website", "website", "url", true)}
            {field("Speaking Engagement", "speakingEngagement", "text", true)}
            {field("Awards Submission", "awardsSubmission", "text", true)}
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Audience</Label>
              <Textarea value={form.audience} onChange={e => set("audience", e.target.value)}
                className="bg-background/50 border-border/50 text-sm min-h-[60px]" data-testid="textarea-audience" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Notes</Label>
              <Textarea value={form.notes} onChange={e => set("notes", e.target.value)}
                className="bg-background/50 border-border/50 text-sm min-h-[80px]" data-testid="textarea-notes" />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending || !form.showName}
              className="flex-1" data-testid="button-save-event">
              {mutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Event"}
            </Button>
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-event">Cancel</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AttachmentsPanel({ eventId }: { eventId: number }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const { data: attachments = [], isLoading } = useQuery<Attachment[]>({
    queryKey: ["/api/attachments", { objectType: "tradeshow_event", objectId: eventId }],
    queryFn: async () => {
      const res = await fetch(`/api/attachments?objectType=tradeshow_event&objectId=${eventId}`, { credentials: "include" });
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("objectType", "tradeshow_event");
      fd.append("objectId", String(eventId));
      const res = await fetch("/api/attachments/upload", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attachments", { objectType: "tradeshow_event", objectId: eventId }] });
      toast({ title: "File uploaded" });
    },
    onError: () => toast({ title: "Upload failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/attachments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attachments", { objectType: "tradeshow_event", objectId: eventId }] });
      toast({ title: "Attachment removed" });
    },
  });

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(f => uploadMutation.mutate(f));
  }, [uploadMutation]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
          dragging ? "border-primary/60 bg-primary/5" : "border-border/40 hover:border-border/70 hover:bg-muted/10"
        }`}
        data-testid="drop-zone-attachments"
      >
        <Upload className="w-5 h-5 mx-auto mb-1.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {uploadMutation.isPending ? "Uploading…" : "Drag & drop files here, or click to browse"}
        </p>
        <input ref={fileInputRef} type="file" multiple className="hidden"
          onChange={e => handleFiles(e.target.files)} data-testid="input-file-upload" />
      </div>

      {isLoading && <Skeleton className="h-10 w-full" />}

      {attachments.length > 0 && (
        <div className="space-y-1.5">
          {attachments.map((att) => (
            <div key={att.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/10 border border-border/30 group">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm flex-1 truncate">{att.title || att.fileName || "Attachment"}</span>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-6 w-6" asChild data-testid={`button-download-${att.id}`}>
                  <a href={`/api/attachments/file/${att.fileName}`} target="_blank" rel="noreferrer">
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={() => deleteMutation.mutate(att.id)} data-testid={`button-delete-att-${att.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && attachments.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">No documents attached yet</p>
      )}
    </div>
  );
}

function EventDetailSheet({
  event, open, onClose, onEdit
}: {
  event: TradeshowEvent | null; open: boolean;
  onClose: () => void; onEdit: () => void;
}) {
  const { toast } = useToast();
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/tradeshow-events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tradeshow-events"] });
      toast({ title: "Event deleted" });
      onClose();
    },
  });

  if (!event) return null;
  const row = (label: string, value: string | null | undefined, icon?: React.ReactNode) => {
    if (!value) return null;
    return (
      <div className="flex gap-2 text-sm">
        {icon && <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>}
        <div>
          <span className="text-muted-foreground text-xs block">{label}</span>
          <span className="text-foreground">{value}</span>
        </div>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto bg-background border-border/50">
        <SheetHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <SheetTitle className="text-base leading-snug">{event.showName}</SheetTitle>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <StatusBadge status={event.bookedStatus ?? "tbd"} />
                {event.year && <span className="text-xs text-muted-foreground">{event.year}</span>}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={onEdit} data-testid="button-edit-event">
                <Edit2 className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7 text-destructive hover:text-destructive border-destructive/30"
                onClick={() => { if (confirm("Delete this event?")) deleteMutation.mutate(event.id); }}
                data-testid="button-delete-event">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        <Separator className="my-3 bg-border/30" />

        <div className="space-y-3">
          {row("Dates", event.showDates, <CalendarDays className="w-3.5 h-3.5" />)}
          {row("Venue", event.venue, <Building2 className="w-3.5 h-3.5" />)}
          {row("City", event.city, <MapPin className="w-3.5 h-3.5" />)}
          {row("Address", event.address)}
          {event.website && (
            <div className="flex gap-2 text-sm">
              <Globe className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <span className="text-muted-foreground text-xs block">Website</span>
                <a href={event.website} target="_blank" rel="noreferrer"
                  className="text-primary hover:underline flex items-center gap-1 text-sm">
                  {event.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          <Separator className="bg-border/30" />

          {row("VS Lead", event.vsLeadName, <Users className="w-3.5 h-3.5" />)}
          {row("VS Attendees", event.vsAttendees)}
          {row("Booth #", event.boothNumber)}
          {row("Booth Size", event.boothSize)}
          {row("Show Supplier", event.showSupplier)}
          {row("Event Fee", event.eventFee)}
          {row("Event Contact", event.eventContact)}
          {row("Event Email", event.eventEmail)}
          {row("Speaking Engagement", event.speakingEngagement, <Mic2 className="w-3.5 h-3.5" />)}
          {row("Awards Submission", event.awardsSubmission, <Award className="w-3.5 h-3.5" />)}

          {event.audience && (
            <>
              <Separator className="bg-border/30" />
              <div>
                <span className="text-muted-foreground text-xs block mb-1">Audience</span>
                <p className="text-sm text-foreground leading-relaxed">{event.audience}</p>
              </div>
            </>
          )}

          {event.notes && (
            <>
              <Separator className="bg-border/30" />
              <div>
                <span className="text-muted-foreground text-xs block mb-1">Notes</span>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{event.notes}</p>
              </div>
            </>
          )}

          <Separator className="bg-border/30" />
          <div>
            <p className="text-sm font-medium mb-2">Documents</p>
            <AttachmentsPanel eventId={event.id} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ListView({ events, onSelect }: { events: TradeshowEvent[]; onSelect: (e: TradeshowEvent) => void }) {
  return (
    <div className="overflow-auto rounded-lg border border-border/40">
      <table className="w-full text-sm" data-testid="events-table">
        <thead>
          <tr className="border-b border-border/40 bg-muted/20">
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Show</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Dates</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">City / Venue</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Lead</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Booth</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Fee</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Speaking</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.id}
              className="border-b border-border/20 hover:bg-muted/10 cursor-pointer transition-colors"
              onClick={() => onSelect(ev)}
              data-testid={`row-event-${ev.id}`}
            >
              <td className="px-4 py-3">
                <span className="font-medium text-foreground leading-snug line-clamp-2 max-w-[220px] block">
                  {ev.showName}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{ev.showDates || "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">
                <span className="block truncate max-w-[180px]">{ev.city || "—"}</span>
                {ev.venue && <span className="block text-xs truncate max-w-[180px] mt-0.5 opacity-70">{ev.venue}</span>}
              </td>
              <td className="px-4 py-3"><StatusBadge status={ev.bookedStatus ?? "tbd"} /></td>
              <td className="px-4 py-3 text-muted-foreground">{ev.vsLeadName || "—"}</td>
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                {ev.boothNumber ? `#${ev.boothNumber}` : "—"}{ev.boothSize ? ` (${ev.boothSize})` : ""}
              </td>
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                {ev.eventFee ? <span className="text-xs">{ev.eventFee}</span> : "—"}
              </td>
              <td className="px-4 py-3">
                {ev.speakingEngagement && ev.speakingEngagement !== "NA" && ev.speakingEngagement !== "No"
                  ? <Mic2 className="w-3.5 h-3.5 text-purple-400" />
                  : <span className="text-muted-foreground/40">—</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length === 0 && (
        <div className="py-12 text-center text-muted-foreground text-sm">No events found</div>
      )}
    </div>
  );
}

function CalendarView({ events, onSelect }: { events: TradeshowEvent[]; onSelect: (e: TradeshowEvent) => void }) {
  const scheduled = events.filter(e => e.startDate);
  const unscheduled = events.filter(e => !e.startDate);

  const eventsForMonth = (monthIdx: number, year: number) => {
    return scheduled.filter(ev => {
      if (!ev.startDate) return false;
      const start = new Date(ev.startDate);
      const end = ev.endDate ? new Date(ev.endDate) : start;
      const mStart = new Date(year, monthIdx, 1);
      const mEnd = new Date(year, monthIdx + 1, 0);
      return start <= mEnd && end >= mStart;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {MONTHS_2026.map(({ label, monthIdx, year }) => {
          const monthEvents = eventsForMonth(monthIdx, year);
          return (
            <Card key={`${year}-${monthIdx}`}
              className={`border-border/40 bg-card/60 transition-colors ${monthEvents.length ? "" : "opacity-60"}`}>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-sm font-semibold text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-0 space-y-1 min-h-[48px]">
                {monthEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground/40 pt-1">No events</p>
                ) : (
                  monthEvents.map(ev => (
                    <button key={ev.id} onClick={() => onSelect(ev)}
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted/30 transition-colors flex items-center gap-1.5"
                      data-testid={`cal-event-${ev.id}`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_CONFIG[ev.bookedStatus ?? "tbd"]?.dot ?? "bg-muted"}`} />
                      <span className="truncate text-foreground/90">{ev.showName}</span>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {unscheduled.length > 0 && (
        <Card className="border-border/40 bg-card/60">
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">TBD / Unscheduled</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            <div className="flex flex-wrap gap-1.5">
              {unscheduled.map(ev => (
                <button key={ev.id} onClick={() => onSelect(ev)}
                  className="px-2 py-1 rounded text-xs hover:bg-muted/30 transition-colors flex items-center gap-1.5 border border-border/30"
                  data-testid={`cal-unscheduled-${ev.id}`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_CONFIG[ev.bookedStatus ?? "tbd"]?.dot ?? "bg-muted"}`} />
                  <span className="text-foreground/90">{ev.showName}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GanttView({ events, onSelect }: { events: TradeshowEvent[]; onSelect: (e: TradeshowEvent) => void }) {
  const scheduled = events.filter(e => e.startDate);
  const unscheduled = events.filter(e => !e.startDate);

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded-lg border border-border/40">
        <div className="min-w-[900px]">
          {/* Month header row */}
          <div className="flex border-b border-border/40 bg-muted/20">
            <div className="w-56 shrink-0 px-3 py-2 text-xs font-medium text-muted-foreground border-r border-border/30">
              Event
            </div>
            <div className="flex-1 relative flex">
              {MONTHS_2026.map(({ label }, i) => (
                <div key={i} className={`flex-1 px-1 py-2 text-xs text-muted-foreground text-center border-r border-border/20 last:border-r-0`}>
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Event rows */}
          {scheduled.map(ev => {
            const startPct = ganttPct(ev.startDate ? new Date(ev.startDate) : null);
            const endPct = ganttPct(ev.endDate ? new Date(ev.endDate) : (ev.startDate ? new Date(ev.startDate) : null));
            const widthPct = Math.max(0.4, endPct - startPct);
            const cfg = STATUS_CONFIG[ev.bookedStatus ?? "tbd"];
            return (
              <div key={ev.id} className="flex border-b border-border/20 hover:bg-muted/5 group"
                data-testid={`gantt-row-${ev.id}`}>
                <div className="w-56 shrink-0 px-3 py-2.5 border-r border-border/20">
                  <button onClick={() => onSelect(ev)}
                    className="text-left w-full flex items-center gap-1.5 hover:text-primary transition-colors"
                    data-testid={`gantt-event-${ev.id}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg?.dot ?? "bg-muted"}`} />
                    <span className="text-xs truncate">{ev.showName}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100" />
                  </button>
                </div>
                <div className="flex-1 relative py-2 px-0">
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {MONTHS_2026.map((_, i) => (
                      <div key={i} className="flex-1 border-r border-border/10 last:border-r-0" />
                    ))}
                  </div>
                  {/* Event bar */}
                  <div
                    className={`absolute top-2 bottom-2 rounded-sm opacity-80 hover:opacity-100 cursor-pointer transition-opacity ${cfg?.color ?? ""}`}
                    style={{ left: `${startPct}%`, width: `${widthPct}%`, minWidth: 4 }}
                    onClick={() => onSelect(ev)}
                    title={`${ev.showName} — ${ev.showDates}`}
                  />
                </div>
              </div>
            );
          })}

          {scheduled.length === 0 && (
            <div className="py-8 text-center text-muted-foreground text-sm">No scheduled events</div>
          )}
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="rounded-lg border border-border/30 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">TBD / Unscheduled ({unscheduled.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map(ev => (
              <button key={ev.id} onClick={() => onSelect(ev)}
                className="px-2 py-1 rounded text-xs border border-border/30 hover:bg-muted/20 transition-colors flex items-center gap-1.5"
                data-testid={`gantt-unscheduled-${ev.id}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_CONFIG[ev.bookedStatus ?? "tbd"]?.dot ?? "bg-muted"}`} />
                {ev.showName}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type ViewMode = "list" | "calendar" | "gantt";

const VIEW_BUTTONS: { mode: ViewMode; icon: typeof LayoutList; label: string }[] = [
  { mode: "list",     icon: LayoutList,       label: "List" },
  { mode: "calendar", icon: CalendarDays,      label: "Calendar" },
  { mode: "gantt",    icon: GanttChartSquare,  label: "Gantt" },
];

export default function TradeshowEventsPage() {
  const [view, setView] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [yearFilter, setYearFilter] = useState("2026");
  const [selectedEvent, setSelectedEvent] = useState<TradeshowEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<TradeshowEvent | null>(null);
  const { toast } = useToast();

  const { data: events = [], isLoading } = useQuery<TradeshowEvent[]>({
    queryKey: ["/api/tradeshow-events", { search, status: statusFilter, year: yearFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter && statusFilter !== "__all__") params.set("status", statusFilter);
      if (yearFilter && yearFilter !== "__all__") params.set("year", yearFilter);
      const res = await fetch(`/api/tradeshow-events?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const openDetail = (ev: TradeshowEvent) => {
    setSelectedEvent(ev);
    setDetailOpen(true);
  };

  const openEdit = (ev?: TradeshowEvent) => {
    setEditEvent(ev ?? selectedEvent);
    setFormOpen(true);
  };

  const statusCounts = Object.fromEntries(
    Object.keys(STATUS_CONFIG).map(k => [k, events.filter(e => e.bookedStatus === k).length])
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Events &amp; Tradeshows</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {events.length} event{events.length !== 1 ? "s" : ""}
            {" "}· {statusCounts.booked ?? 0} booked · {statusCounts.pending ?? 0} pending
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View switcher */}
          <div className="flex gap-0.5 bg-muted/30 rounded-lg p-0.5 border border-border/30">
            {VIEW_BUTTONS.map(({ mode, icon: Icon, label }) => (
              <button key={mode}
                onClick={() => setView(mode)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`button-view-${mode}`}>
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => { setEditEvent(null); setFormOpen(true); }} data-testid="button-new-event">
            <Plus className="w-3.5 h-3.5 mr-1" />
            New Event
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border/20 shrink-0 bg-muted/5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search events…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-7 text-xs bg-background/50 border-border/40"
            data-testid="input-search-events"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-7 text-xs w-36 bg-background/50 border-border/40" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="h-7 text-xs w-28 bg-background/50 border-border/40" data-testid="select-year-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Years</SelectItem>
            <SelectItem value="2025">2025</SelectItem>
            <SelectItem value="2026">2026</SelectItem>
            <SelectItem value="2027">2027</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-1.5 ml-1">
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <span key={k} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${v.color}`}>
              <span className={`w-1 h-1 rounded-full ${v.dot}`} />
              {statusCounts[k] ?? 0} {v.label}
            </span>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <>
            {view === "list" && <ListView events={events} onSelect={openDetail} />}
            {view === "calendar" && <CalendarView events={events} onSelect={openDetail} />}
            {view === "gantt" && <GanttView events={events} onSelect={openDetail} />}
          </>
        )}
      </div>

      {/* Detail sheet */}
      <EventDetailSheet
        event={selectedEvent}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onEdit={() => { setDetailOpen(false); openEdit(selectedEvent!); }}
      />

      {/* Create / Edit sheet */}
      <EventFormSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        event={editEvent}
        onSaved={() => setEditEvent(null)}
      />
    </div>
  );
}
