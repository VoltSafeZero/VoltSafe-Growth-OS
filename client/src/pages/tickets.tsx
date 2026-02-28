import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, List, Columns3, AlertTriangle, Clock } from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import type { Ticket } from "@shared/schema";

const STATUSES = [
  { key: "new", label: "New", color: "bg-blue-500" },
  { key: "open", label: "Open", color: "bg-yellow-500" },
  { key: "in_progress", label: "In Progress", color: "bg-orange-500" },
  { key: "resolved", label: "Resolved", color: "bg-green-500" },
  { key: "closed", label: "Closed", color: "bg-gray-500" },
];

const severityColors: Record<string, string> = {
  low: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  critical: "bg-red-500/10 text-red-400 border-red-500/20",
};

const statusBadgeColors: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  open: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  in_progress: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  resolved: "bg-green-500/10 text-green-400 border-green-500/20",
  closed: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

export default function TicketsPage() {
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ data: Ticket[]; total: number }>({
    queryKey: ["/api/tickets"],
    queryFn: async () => {
      const res = await fetch("/api/tickets?limit=200");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (d: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/tickets", d);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setCreateOpen(false);
      toast({ title: "Ticket created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...d }: { id: number; [key: string]: unknown }) => {
      const res = await apiRequest("PUT", `/api/tickets/${id}`, d);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
    },
  });

  const groupedByStatus = STATUSES.map(s => ({
    ...s,
    items: data?.data?.filter(t => t.status === s.key) || [],
  }));

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Tickets</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage support tickets and customer requests.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex border border-border/50 rounded-lg overflow-hidden">
            <Button variant={viewMode === "board" ? "secondary" : "ghost"} size="sm" onClick={() => setViewMode("board")} data-testid="button-board-view">
              <Columns3 className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="sm" onClick={() => setViewMode("list")} data-testid="button-list-view">
              <List className="h-4 w-4" />
            </Button>
          </div>
          <ExportButton endpoint="/api/tickets/export" filename="tickets_export.csv" />
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground" data-testid="button-create-ticket">
                <Plus className="mr-2 h-4 w-4" /> New Ticket
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Create Ticket</DialogTitle></DialogHeader>
              <CreateTicketForm onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto">{[...Array(5)].map((_, i) => <Skeleton key={i} className="min-w-[260px] h-[400px]" />)}</div>
      ) : viewMode === "board" ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {groupedByStatus.map(status => (
            <div key={status.key} className="min-w-[260px] flex-shrink-0" data-testid={`column-${status.key}`}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`w-2 h-2 rounded-full ${status.color}`} />
                <h3 className="text-sm font-semibold">{status.label}</h3>
                <Badge variant="outline" className="ml-auto text-xs">{status.items.length}</Badge>
              </div>
              <div className="space-y-2">
                {status.items.map(ticket => (
                  <Card key={ticket.id} className="border-border/50 hover:border-primary/30 cursor-pointer transition-colors" onClick={() => setSelectedTicket(ticket)} data-testid={`card-ticket-${ticket.id}`}>
                    <CardContent className="p-4">
                      <p className="font-medium text-sm mb-1">{ticket.subject}</p>
                      <p className="text-xs text-muted-foreground mb-2">{ticket.requesterName}</p>
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className={`text-xs ${severityColors[ticket.severity] || ""}`}>
                          {ticket.severity === "critical" && <AlertTriangle className="h-3 w-3 mr-1" />}
                          {ticket.severity}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(ticket.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {status.items.length === 0 && (
                  <div className="border border-dashed border-border/50 rounded-lg p-6 text-center text-xs text-muted-foreground">
                    No tickets
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Subject</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Requester</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Category</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Severity</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody>
                {data?.data?.map(ticket => (
                  <tr key={ticket.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedTicket(ticket)} data-testid={`row-ticket-${ticket.id}`}>
                    <td className="p-4 font-medium">{ticket.subject}</td>
                    <td className="p-4 text-sm">{ticket.requesterName}</td>
                    <td className="p-4 text-sm text-muted-foreground">{ticket.category}</td>
                    <td className="p-4"><Badge variant="outline" className={severityColors[ticket.severity] || ""}>{ticket.severity}</Badge></td>
                    <td className="p-4"><Badge variant="outline" className={statusBadgeColors[ticket.status] || ""}>{ticket.status}</Badge></td>
                    <td className="p-4 text-sm text-muted-foreground">{new Date(ticket.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {selectedTicket && (
        <TicketDetailDialog ticket={selectedTicket} statuses={STATUSES} onUpdate={(d) => { updateMutation.mutate({ id: selectedTicket.id, ...d }); setSelectedTicket({ ...selectedTicket, ...d } as Ticket); }} onClose={() => setSelectedTicket(null)} />
      )}
    </div>
  );
}

function TicketDetailDialog({ ticket, statuses, onUpdate, onClose }: { ticket: Ticket; statuses: typeof STATUSES; onUpdate: (d: Record<string, unknown>) => void; onClose: () => void }) {
  const [resolution, setResolution] = useState(ticket.resolutionSummary || "");
  const [internalNotes, setInternalNotes] = useState(ticket.internalNotes || "");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ticket.subject}</DialogTitle>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className={severityColors[ticket.severity] || ""}>{ticket.severity}</Badge>
            <Badge variant="outline" className={statusBadgeColors[ticket.status] || ""}>{ticket.status}</Badge>
          </div>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-xs text-muted-foreground">Requester</Label><p className="text-sm font-medium">{ticket.requesterName}</p></div>
            <div><Label className="text-xs text-muted-foreground">Email</Label><p className="text-sm">{ticket.requesterEmail || "—"}</p></div>
            <div><Label className="text-xs text-muted-foreground">Phone</Label><p className="text-sm">{ticket.requesterPhone || "—"}</p></div>
            <div><Label className="text-xs text-muted-foreground">Category</Label><p className="text-sm">{ticket.category}</p></div>
          </div>

          {ticket.description && (
            <div><Label className="text-xs text-muted-foreground">Description</Label><p className="text-sm whitespace-pre-wrap">{ticket.description}</p></div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={ticket.status} onValueChange={(v) => onUpdate({ status: v })}>
              <SelectTrigger data-testid="select-ticket-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {statuses.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Internal Notes</Label>
            <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} data-testid="input-internal-notes" />
            <Button size="sm" variant="outline" className="mt-2" onClick={() => onUpdate({ internalNotes })} data-testid="button-save-notes">Save Notes</Button>
          </div>

          {(ticket.status === "resolved" || ticket.status === "closed") && (
            <div>
              <Label className="text-xs text-muted-foreground">Resolution Summary</Label>
              <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} placeholder="Describe how this was resolved..." data-testid="input-resolution" />
              <Button size="sm" variant="outline" className="mt-2" onClick={() => onUpdate({ resolutionSummary: resolution })} data-testid="button-save-resolution">Save Resolution</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateTicketForm({ onSubmit, isPending }: { onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({ subject: "", requesterName: "", requesterEmail: "", requesterPhone: "", category: "general", severity: "medium", description: "" });

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div><Label>Subject *</Label><Input value={form.subject} onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))} required data-testid="input-ticket-subject" /></div>
      <div><Label>Requester Name *</Label><Input value={form.requesterName} onChange={(e) => setForm(f => ({ ...f, requesterName: e.target.value }))} required data-testid="input-requester-name" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Email</Label><Input type="email" value={form.requesterEmail} onChange={(e) => setForm(f => ({ ...f, requesterEmail: e.target.value }))} data-testid="input-requester-email" /></div>
        <div><Label>Phone</Label><Input value={form.requesterPhone} onChange={(e) => setForm(f => ({ ...f, requesterPhone: e.target.value }))} data-testid="input-requester-phone" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Category</Label>
          <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
            <SelectTrigger data-testid="select-ticket-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
              <SelectItem value="installation">Installation</SelectItem>
              <SelectItem value="warranty">Warranty</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Severity</Label>
          <Select value={form.severity} onValueChange={(v) => setForm(f => ({ ...f, severity: v }))}>
            <SelectTrigger data-testid="select-ticket-severity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={4} data-testid="input-ticket-description" /></div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-ticket">{isPending ? "Creating..." : "Create Ticket"}</Button>
    </form>
  );
}
