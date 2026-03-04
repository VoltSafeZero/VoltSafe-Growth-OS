import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, CalendarDays, MapPin, Trash2 } from "lucide-react";
import type { EcosystemEvent } from "@shared/schema";

const PARTICIPATION_TYPES = ["Attendee", "Sponsor", "Speaker", "Exhibitor"];

const participationColors: Record<string, string> = {
  Attendee: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Sponsor: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  Speaker: "bg-green-500/10 text-green-500 border-green-500/20",
  Exhibitor: "bg-orange-500/10 text-orange-500 border-orange-500/20",
};

export default function EcosystemEventsPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EcosystemEvent | null>(null);
  const { toast } = useToast();

  const { data: events, isLoading } = useQuery<EcosystemEvent[]>({
    queryKey: ["/api/ecosystem/events", { search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/ecosystem/events?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ecosystem/events", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/events"] });
      setCreateOpen(false);
      toast({ title: "Event created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/ecosystem/events/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/events"] });
      setSelected(null);
      toast({ title: "Event updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ecosystem/events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecosystem/events"] });
      setSelected(null);
      toast({ title: "Event deleted" });
    },
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Ecosystem Events</h1>
          <p className="text-muted-foreground mt-1 text-sm">Track industry events and VoltSafe participation.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground" data-testid="button-create-event">
              <Plus className="mr-2 h-4 w-4" /> New Event
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Event</DialogTitle></DialogHeader>
            <EventForm onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search events..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" data-testid="input-search-events" />
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {events?.map((event) => (
            <Card key={event.id} className="border-border/50 hover:border-primary/30 cursor-pointer transition-colors" onClick={() => setSelected(event)} data-testid={`card-event-${event.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <CalendarDays className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{event.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">{event.organizer || "No organizer"}</p>
                    </div>
                  </div>
                  {event.voltsafeParticipation && (
                    <Badge variant="outline" className={participationColors[event.voltsafeParticipation] || ""}>{event.voltsafeParticipation}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                  {event.eventDate && (
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {new Date(event.eventDate).toLocaleDateString()}
                    </span>
                  )}
                  {event.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {event.location}
                    </span>
                  )}
                </div>
                {event.industryCategory && (
                  <Badge variant="outline" className="mt-2">{event.industryCategory}</Badge>
                )}
              </CardContent>
            </Card>
          ))}
          {(!events || events.length === 0) && (
            <div className="col-span-full p-8 text-center text-muted-foreground">No events found</div>
          )}
        </div>
      )}

      {selected && (
        <Dialog open onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Event</DialogTitle></DialogHeader>
            <EventForm
              initial={selected}
              onSubmit={(d) => updateMutation.mutate({ id: selected.id, data: d })}
              isPending={updateMutation.isPending}
            />
            <div className="flex justify-end pt-2">
              <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(selected.id)} disabled={deleteMutation.isPending} data-testid="button-delete-event">
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function EventForm({ initial, onSubmit, isPending }: { initial?: EcosystemEvent; onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    organizer: initial?.organizer || "",
    location: initial?.location || "",
    eventDate: initial?.eventDate ? new Date(initial.eventDate).toISOString().split("T")[0] : "",
    industryCategory: initial?.industryCategory || "",
    voltsafeParticipation: initial?.voltsafeParticipation || "",
    keyContactsMet: initial?.keyContactsMet || "",
    notes: initial?.notes || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: form.name,
      organizer: form.organizer || null,
      location: form.location || null,
      eventDate: form.eventDate ? new Date(form.eventDate).toISOString() : null,
      industryCategory: form.industryCategory || null,
      voltsafeParticipation: form.voltsafeParticipation || null,
      keyContactsMet: form.keyContactsMet || null,
      notes: form.notes || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Event Name *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-event-name" />
      </div>
      <div>
        <Label>Organizer</Label>
        <Input value={form.organizer} onChange={(e) => setForm({ ...form, organizer: e.target.value })} data-testid="input-event-organizer" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Location</Label>
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="input-event-location" />
        </div>
        <div>
          <Label>Event Date</Label>
          <DatePicker value={form.eventDate} onChange={(v) => setForm({ ...form, eventDate: v })} data-testid="input-event-date" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Industry Category</Label>
          <Input value={form.industryCategory} onChange={(e) => setForm({ ...form, industryCategory: e.target.value })} data-testid="input-event-category" />
        </div>
        <div>
          <Label>VoltSafe Participation</Label>
          <Select value={form.voltsafeParticipation} onValueChange={(v) => setForm({ ...form, voltsafeParticipation: v })}>
            <SelectTrigger data-testid="select-event-participation"><SelectValue placeholder="Select role" /></SelectTrigger>
            <SelectContent>
              {PARTICIPATION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Key Contacts Met</Label>
        <Textarea value={form.keyContactsMet} onChange={(e) => setForm({ ...form, keyContactsMet: e.target.value })} data-testid="input-event-contacts" />
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-event-notes" />
      </div>
      <Button type="submit" disabled={isPending || !form.name} className="w-full" data-testid="button-submit-event">
        {isPending ? "Saving..." : initial ? "Update Event" : "Create Event"}
      </Button>
    </form>
  );
}
