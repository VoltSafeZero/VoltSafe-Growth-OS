import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, List, Columns3, AlertTriangle, Clock,
  Search, LifeBuoy, CheckCircle2, Timer, XCircle,
} from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import { NotesPanel } from "@/components/notes-panel";
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
  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selectedId = params.get("selected");
    if (selectedId) {
      fetch(`/api/tickets/${selectedId}`).then(r => r.ok ? r.json() : null).then(ticket => {
        if (ticket) setSelectedTicket(ticket);
      });
      window.history.replaceState({}, "", "/support/tickets");
    }
    const handleCreate = () => setCreateOpen(true);
    window.addEventListener("open-create-ticket", handleCreate);
    return () => window.removeEventListener("open-create-ticket", handleCreate);
  }, []);

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

  const allTickets = data?.data || [];

  const filtered = allTickets.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.subject.toLowerCase().includes(q) || t.requesterName.toLowerCase().includes(q);
    const matchSeverity = filterSeverity === "all" || t.severity === filterSeverity;
    return matchSearch && matchSeverity;
  });

  const open = filtered.filter(t => ["new","open","in_progress"].includes(t.status));
  const critical = filtered.filter(t => t.severity === "critical");
  const resolved = filtered.filter(t => t.status === "resolved");
  const closed = filtered.filter(t => t.status === "closed");

  const summaryCards = [
    { label: "Open", value: allTickets.filter(t => ["new","open","in_progress"].includes(t.status)).length, icon: LifeBuoy, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Critical", value: allTickets.filter(t => t.severity === "critical").length, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10" },
    { label: "In Progress", value: allTickets.filter(t => t.status === "in_progress").length, icon: Timer, color: "text-orange-400", bg: "bg-orange-500/10" },
    { label: "Resolved", value: allTickets.filter(t => t.status === "resolved").length, icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/10" },
  ];

  const groupedByStatus = STATUSES.map(s => ({
    ...s,
    items: filtered.filter(t => t.status === s.key),
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 py-5 border-b border-border/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Tickets</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Customer support requests and issue tracking</p>
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
                <Button className="bg-primary text-primary-foreground h-9" data-testid="button-create-ticket">
                  <Plus className="mr-2 h-4 w-4" />New Ticket
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Create Ticket</DialogTitle></DialogHeader>
                <CreateTicketForm onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {summaryCards.map(card => (
            <Card key={card.label} className="border-border/50 bg-card/50" data-testid={`card-ticket-summary-${card.label.toLowerCase()}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg ${card.bg} flex items-center justify-center shrink-0`}>
                  <card.icon className={`w-4 h-4 ${card.color}`} />
                </div>
                <div>
                  <div className="text-2xl font-bold">{card.value}</div>
                  <div className="text-xs text-muted-foreground">{card.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tickets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 bg-secondary/30 border-transparent focus-visible:border-primary/50"
              data-testid="input-search-tickets"
            />
          </div>
          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="w-36 h-9 bg-secondary/30 border-transparent" data-testid="select-filter-severity">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex gap-4 overflow-x-auto">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="min-w-[260px] h-[400px]" />)}
          </div>
        ) : viewMode === "board" ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {groupedByStatus.map(status => (
              <div key={status.key} className="min-w-[240px] sm:min-w-[260px] flex-shrink-0" data-testid={`column-${status.key}`}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className={`w-2 h-2 rounded-full ${status.color}`} />
                  <h3 className="text-sm font-semibold">{status.label}</h3>
                  <Badge variant="outline" className="ml-auto text-xs">{status.items.length}</Badge>
                </div>
                <div className="space-y-2">
                  {status.items.map(ticket => (
                    <Card key={ticket.id} className="border-border/50 hover:border-primary/30 cursor-pointer transition-colors" onClick={() => setSelectedTicket(ticket)} data-testid={`card-ticket-${ticket.id}`}>
                      <CardContent className="p-4">
                        <p className="font-medium text-sm mb-1 leading-snug">{ticket.subject}</p>
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
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left p-3 sm:p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ID</th>
                    <th className="text-left p-3 sm:p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subject</th>
                    <th className="text-left p-3 sm:p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Requester</th>
                    <th className="text-left p-3 sm:p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Category</th>
                    <th className="text-left p-3 sm:p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Severity</th>
                    <th className="text-left p-3 sm:p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="text-left p-3 sm:p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(ticket => (
                    <tr key={ticket.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => setSelectedTicket(ticket)} data-testid={`row-ticket-${ticket.id}`}>
                      <td className="p-3 sm:p-4 text-xs text-muted-foreground font-mono">#{ticket.id}</td>
                      <td className="p-3 sm:p-4">
                        <p className="font-medium text-sm truncate max-w-[200px] sm:max-w-none">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">{ticket.requesterName}</p>
                      </td>
                      <td className="p-3 sm:p-4 text-sm hidden sm:table-cell">{ticket.requesterName}</td>
                      <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden md:table-cell capitalize">{ticket.category}</td>
                      <td className="p-3 sm:p-4"><Badge variant="outline" className={`text-xs ${severityColors[ticket.severity] || ""}`}>{ticket.severity}</Badge></td>
                      <td className="p-3 sm:p-4"><Badge variant="outline" className={`text-xs ${statusBadgeColors[ticket.status] || ""}`}>{ticket.status.replace("_"," ")}</Badge></td>
                      <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden sm:table-cell">{new Date(ticket.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">No tickets found</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {selectedTicket && (
        <TicketDetailDialog
          ticket={selectedTicket}
          statuses={STATUSES}
          onUpdate={(d) => {
            updateMutation.mutate({ id: selectedTicket.id, ...d });
            setSelectedTicket({ ...selectedTicket, ...d } as Ticket);
          }}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </div>
  );
}

function TicketDetailDialog({ ticket, statuses, onUpdate, onClose }: {
  ticket: Ticket;
  statuses: typeof STATUSES;
  onUpdate: (d: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [resolution, setResolution] = useState(ticket.resolutionSummary || "");
  const [internalNotes, setInternalNotes] = useState(ticket.internalNotes || "");
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-muted-foreground">#{ticket.id}</span>
            <Badge variant="outline" className={severityColors[ticket.severity] || ""}>{ticket.severity}</Badge>
            <Badge variant="outline" className={statusBadgeColors[ticket.status] || ""}>{ticket.status.replace("_"," ")}</Badge>
          </div>
          <DialogTitle className="text-lg leading-snug mt-1">{ticket.subject}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
          <TabsList className="bg-secondary/40 border border-border/30 w-full justify-start h-9 p-0.5 gap-0.5">
            {["Overview","Notes","Resolution"].map(tab => (
              <TabsTrigger key={tab} value={tab.toLowerCase()} className="text-xs px-3 h-8 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Requester</p>
                <p className="text-sm font-medium mt-0.5">{ticket.requesterName}</p>
              </div>
              <div className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Category</p>
                <p className="text-sm font-medium mt-0.5 capitalize">{ticket.category}</p>
              </div>
              <div className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-sm font-medium mt-0.5">{new Date(ticket.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Updated</p>
                <p className="text-sm font-medium mt-0.5">{new Date(ticket.updatedAt).toLocaleDateString()}</p>
              </div>
            </div>

            {ticket.requesterEmail && (
              <div><Label className="text-xs text-muted-foreground">Email</Label><p className="text-sm mt-0.5">{ticket.requesterEmail}</p></div>
            )}

            {ticket.description && (
              <div><Label className="text-xs text-muted-foreground">Description</Label><p className="text-sm whitespace-pre-wrap mt-0.5 leading-relaxed">{ticket.description}</p></div>
            )}

            <div>
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={ticket.status} onValueChange={(v) => onUpdate({ status: v })}>
                <SelectTrigger className="mt-1.5" data-testid="select-ticket-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="notes" className="mt-4">
            <NotesPanel linkedObjectType="ticket" linkedObjectId={ticket.id} />
          </TabsContent>

          <TabsContent value="resolution" className="space-y-3 mt-4">
            <div>
              <Label className="text-xs text-muted-foreground">Resolution Summary</Label>
              <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={6} placeholder="Describe how this was resolved..." className="mt-1.5" data-testid="input-resolution" />
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="outline" onClick={() => onUpdate({ resolutionSummary: resolution })} data-testid="button-save-resolution">Save Resolution</Button>
                <Button size="sm" variant="outline" className="text-green-400 border-green-500/30 hover:bg-green-500/10" onClick={() => onUpdate({ status: "resolved", resolutionSummary: resolution })} data-testid="button-resolve-ticket">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Mark Resolved
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function CreateTicketForm({ onSubmit, isPending }: { onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({ subject: "", requesterName: "", requesterEmail: "", requesterPhone: "", category: "general", severity: "medium", description: "" });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div><Label>Subject *</Label><Input value={form.subject} onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))} required className="mt-1.5" data-testid="input-ticket-subject" /></div>
      <div><Label>Requester Name *</Label><Input value={form.requesterName} onChange={(e) => setForm(f => ({ ...f, requesterName: e.target.value }))} required className="mt-1.5" data-testid="input-requester-name" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Email</Label><Input type="email" value={form.requesterEmail} onChange={(e) => setForm(f => ({ ...f, requesterEmail: e.target.value }))} className="mt-1.5" data-testid="input-requester-email" /></div>
        <div><Label>Phone</Label><Input value={form.requesterPhone} onChange={(e) => setForm(f => ({ ...f, requesterPhone: e.target.value }))} className="mt-1.5" data-testid="input-requester-phone" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Category</Label>
          <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
            <SelectTrigger className="mt-1.5" data-testid="select-ticket-category"><SelectValue /></SelectTrigger>
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
            <SelectTrigger className="mt-1.5" data-testid="select-ticket-severity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={4} className="mt-1.5" data-testid="input-ticket-description" /></div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-ticket">{isPending ? "Creating..." : "Create Ticket"}</Button>
    </form>
  );
}
