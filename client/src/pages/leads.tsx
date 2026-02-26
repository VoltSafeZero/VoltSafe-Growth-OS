import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, ArrowRightLeft, Trash2, Loader2,
  LayoutGrid, List, Download, MapPin, Building2, Phone, Mail, Anchor
} from "lucide-react";
import type { Lead } from "@shared/schema";

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
  "Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky",
  "Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi",
  "Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico",
  "New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania",
  "Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
];

const CA_PROVINCES = [
  "Alberta","British Columbia","Manitoba","New Brunswick","Newfoundland and Labrador",
  "Northwest Territories","Nova Scotia","Nunavut","Ontario","Prince Edward Island",
  "Quebec","Saskatchewan","Yukon",
];

const COUNTRIES = [
  { value: "CA", label: "Canada" },
  { value: "US", label: "United States" },
];

function getRegionsForCountry(country: string): string[] {
  if (country === "US") return US_STATES;
  if (country === "CA") return CA_PROVINCES;
  return [];
}

const PIPELINE_STAGES = [
  { value: "new", label: "New", color: "bg-slate-500/10 text-slate-400 border-slate-500/20", columnColor: "border-t-slate-500" },
  { value: "contacted", label: "Contacted", color: "bg-blue-500/10 text-blue-400 border-blue-500/20", columnColor: "border-t-blue-500" },
  { value: "meeting_scheduled", label: "Meeting Scheduled", color: "bg-purple-500/10 text-purple-400 border-purple-500/20", columnColor: "border-t-purple-500" },
  { value: "qualified", label: "Qualified", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20", columnColor: "border-t-cyan-500" },
  { value: "proposal_sent", label: "Proposal Sent", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", columnColor: "border-t-amber-500" },
  { value: "negotiation", label: "Negotiation", color: "bg-orange-500/10 text-orange-400 border-orange-500/20", columnColor: "border-t-orange-500" },
  { value: "converted", label: "Closed Won", color: "bg-green-500/10 text-green-400 border-green-500/20", columnColor: "border-t-green-500" },
  { value: "lost", label: "Closed Lost", color: "bg-red-500/10 text-red-400 border-red-500/20", columnColor: "border-t-red-500" },
];

const statusColors: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map(s => [s.value, s.color])
);

function getStageLabel(value: string) {
  return PIPELINE_STAGES.find(s => s.value === value)?.label || value;
}

export default function LeadsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [view, setView] = useState<"list" | "pipeline">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const { toast } = useToast();
  const scrollSentinelRef = useRef<HTMLDivElement>(null);

  const regionOptions = countryFilter !== "all" ? getRegionsForCountry(countryFilter) : [];

  const PAGE_SIZE = 100;

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<{ data: Lead[]; total: number; page: number; totalPages: number }>({
    queryKey: ["/api/leads", { search, status: statusFilter === "all" ? "" : statusFilter, country: countryFilter === "all" ? "" : countryFilter, state: stateFilter === "all" ? "" : stateFilter }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (countryFilter !== "all") params.set("country", countryFilter);
      if (stateFilter !== "all") params.set("state", stateFilter);
      params.set("page", String(pageParam));
      params.set("limit", String(PAGE_SIZE));
      const res = await fetch(`/api/leads?${params}`, { credentials: "include" });
      return res.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.totalPages) return lastPage.page + 1;
      return undefined;
    },
  });

  const allLeads = data?.pages.flatMap(p => p.data) || [];
  const totalCount = data?.pages[0]?.total || 0;

  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await apiRequest("POST", "/api/leads", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setCreateOpen(false);
      toast({ title: "Lead created" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/leads/${id}/convert`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setSelectedLead(null);
      toast({ title: "Lead converted to Account" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/leads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setSelectedLead(null);
      toast({ title: "Lead deleted" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PUT", `/api/leads/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Lead stage updated" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads/import-marinas");
      return res.json();
    },
    onSuccess: (data: { imported: number; message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/states"] });
      toast({ title: data.message });
    },
    onError: () => {
      toast({ title: "Import failed", variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Leads Pipeline</h1>
          <p className="text-muted-foreground mt-1">
            {totalCount > 0 ? `${totalCount.toLocaleString()} leads` : "Manage your sales pipeline"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending}
            data-testid="button-import-marinas"
          >
            <Download className="mr-2 h-4 w-4" />
            {importMutation.isPending ? "Importing..." : "Import Marinas"}
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground" data-testid="button-create-lead">
                <Plus className="mr-2 h-4 w-4" /> New Lead
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create New Lead</DialogTitle>
              </DialogHeader>
              <CreateLeadForm onSubmit={(data) => createMutation.mutate(data)} isPending={createMutation.isPending} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads by name, city, state..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="pl-10"
            data-testid="input-search-leads"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); }}>
          <SelectTrigger className="w-44" data-testid="select-status-filter">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {PIPELINE_STAGES.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={countryFilter} onValueChange={(v) => { setCountryFilter(v); setStateFilter("all"); }}>
          <SelectTrigger className="w-40" data-testid="select-country-filter">
            <SelectValue placeholder="Country" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Countries</SelectItem>
            {COUNTRIES.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stateFilter} onValueChange={(v) => { setStateFilter(v); }}>
          <SelectTrigger className="w-48" data-testid="select-state-filter">
            <SelectValue placeholder={countryFilter === "CA" ? "Province" : "State"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{countryFilter === "CA" ? "All Provinces" : countryFilter === "US" ? "All States" : "All Regions"}</SelectItem>
            {regionOptions.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center border border-border/50 rounded-lg overflow-hidden ml-auto">
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("list")}
            className="rounded-none"
            data-testid="button-list-view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "pipeline" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("pipeline")}
            className="rounded-none"
            data-testid="button-pipeline-view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : view === "pipeline" ? (
        <PipelineView
          leads={allLeads}
          onSelect={setSelectedLead}
          onUpdateStatus={(id, status) => updateStatusMutation.mutate({ id, status })}
        />
      ) : (
        <>
          <Card className="border-border/50">
            <CardContent className="p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Marina / Company</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Location</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Contact</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Slips</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Stage</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Source</th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allLeads.map((lead) => (
                    <tr key={lead.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedLead(lead)} data-testid={`row-lead-${lead.id}`}>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {lead.marinaId && <Anchor className="h-4 w-4 text-primary shrink-0" />}
                          <span className="font-medium">{lead.company}</span>
                        </div>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {lead.city && lead.state ? `${lead.city}, ${lead.state}` : lead.state || "—"}
                      </td>
                      <td className="p-4 text-sm">
                        <div>{lead.contactName}</div>
                        {lead.contactPhone && <div className="text-muted-foreground text-xs">{lead.contactPhone}</div>}
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{lead.slips || "—"}</td>
                      <td className="p-4">
                        <Badge variant="outline" className={statusColors[lead.status] || ""} data-testid={`badge-status-${lead.id}`}>
                          {getStageLabel(lead.status)}
                        </Badge>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{lead.source || "—"}</td>
                      <td className="p-4 text-right">
                        {lead.status !== "converted" && lead.status !== "lost" && (
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); convertMutation.mutate(lead.id); }} data-testid={`button-convert-${lead.id}`}>
                            <ArrowRightLeft className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {allLeads.length === 0 && (
                    <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No leads found. Click "Import Marinas" to populate your pipeline.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between py-2">
            <p className="text-sm text-muted-foreground">{allLeads.length.toLocaleString()} of {totalCount.toLocaleString()} leads loaded</p>
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading more...
              </div>
            )}
          </div>
          <div ref={scrollSentinelRef} className="h-4" />
        </>
      )}

      {selectedLead && (
        <LeadDetailDialog
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onConvert={() => convertMutation.mutate(selectedLead.id)}
          onDelete={() => deleteMutation.mutate(selectedLead.id)}
          onUpdateStatus={(status) => {
            updateStatusMutation.mutate({ id: selectedLead.id, status });
            setSelectedLead({ ...selectedLead, status });
          }}
          isConverting={convertMutation.isPending}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

function PipelineView({
  leads,
  onSelect,
  onUpdateStatus,
}: {
  leads: Lead[];
  onSelect: (lead: Lead) => void;
  onUpdateStatus: (id: number, status: string) => void;
}) {
  const stageGroups = PIPELINE_STAGES.map(stage => ({
    ...stage,
    leads: leads.filter(l => l.status === stage.value),
  }));

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {stageGroups.map(stage => (
        <div key={stage.value} className={`flex-shrink-0 w-72 border border-border/50 rounded-xl bg-card/50 border-t-2 ${stage.columnColor}`}>
          <div className="p-3 border-b border-border/30">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{stage.label}</h3>
              <Badge variant="outline" className="text-xs px-1.5 py-0">{stage.leads.length}</Badge>
            </div>
          </div>
          <div className="p-2 space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto">
            {stage.leads.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No leads</p>
            )}
            {stage.leads.slice(0, 50).map(lead => (
              <div
                key={lead.id}
                className="p-3 bg-background/80 border border-border/30 rounded-lg cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => onSelect(lead)}
                data-testid={`pipeline-card-${lead.id}`}
              >
                <div className="flex items-start gap-2 mb-1">
                  {lead.marinaId && <Anchor className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />}
                  <p className="text-sm font-medium leading-tight line-clamp-2">{lead.company}</p>
                </div>
                {(lead.city || lead.state) && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <MapPin className="h-3 w-3" />
                    {lead.city && lead.state ? `${lead.city}, ${lead.state}` : lead.state}
                  </p>
                )}
                {lead.slips && (
                  <p className="text-xs text-muted-foreground mt-0.5">{lead.slips} slips</p>
                )}
                {lead.contactPhone && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Phone className="h-3 w-3" />
                    {lead.contactPhone}
                  </p>
                )}
              </div>
            ))}
            {stage.leads.length > 50 && (
              <p className="text-xs text-muted-foreground text-center py-2">+{stage.leads.length - 50} more</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function LeadDetailDialog({
  lead,
  onClose,
  onConvert,
  onDelete,
  onUpdateStatus,
  isConverting,
  isDeleting,
}: {
  lead: Lead;
  onClose: () => void;
  onConvert: () => void;
  onDelete: () => void;
  onUpdateStatus: (status: string) => void;
  isConverting: boolean;
  isDeleting: boolean;
}) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {lead.marinaId && <Anchor className="h-5 w-5 text-primary" />}
            {lead.company}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Pipeline Stage</Label>
            <Select value={lead.status} onValueChange={onUpdateStatus}>
              <SelectTrigger data-testid="select-lead-stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {(lead.city || lead.state) && (
              <div>
                <Label className="text-xs text-muted-foreground">Location</Label>
                <p className="text-sm font-medium flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {[lead.city, lead.state, lead.country].filter(Boolean).join(", ")}
                </p>
                {lead.streetAddress && <p className="text-xs text-muted-foreground mt-0.5">{lead.streetAddress}</p>}
                {lead.zipCode && <p className="text-xs text-muted-foreground">{lead.zipCode}</p>}
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground">Contact</Label>
              <p className="text-sm font-medium">{lead.contactName}</p>
            </div>
            {lead.contactEmail && (
              <div>
                <Label className="text-xs text-muted-foreground">Email</Label>
                <p className="text-sm flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  {lead.contactEmail}
                </p>
              </div>
            )}
            {lead.contactPhone && (
              <div>
                <Label className="text-xs text-muted-foreground">Phone</Label>
                <p className="text-sm flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {lead.contactPhone}
                </p>
              </div>
            )}
            {lead.slips && (
              <div>
                <Label className="text-xs text-muted-foreground">Slips</Label>
                <p className="text-sm">{lead.slips}</p>
              </div>
            )}
            {lead.segment && (
              <div>
                <Label className="text-xs text-muted-foreground">Segment</Label>
                <p className="text-sm">{lead.segment}</p>
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground">Source</Label>
              <p className="text-sm">{lead.source || "—"}</p>
            </div>
            {lead.nextStep && (
              <div>
                <Label className="text-xs text-muted-foreground">Next Step</Label>
                <p className="text-sm">{lead.nextStep}</p>
              </div>
            )}
          </div>
          {lead.notes && (
            <div>
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <p className="text-sm">{lead.notes}</p>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-4 border-t border-border/50">
            {lead.status !== "converted" && lead.status !== "lost" && (
              <Button variant="outline" onClick={onConvert} disabled={isConverting} data-testid="button-convert-detail">
                <ArrowRightLeft className="mr-2 h-4 w-4" /> Convert to Account
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting} data-testid="button-delete-lead">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateLeadForm({ onSubmit, isPending }: { onSubmit: (data: Record<string, string>) => void; isPending: boolean }) {
  const [form, setForm] = useState({ company: "", contactName: "", contactEmail: "", contactPhone: "", source: "", notes: "", country: "", state: "", city: "" });

  const formRegions = form.country ? getRegionsForCountry(form.country) : [];

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div>
        <Label>Company / Marina Name *</Label>
        <Input value={form.company} onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))} required data-testid="input-company" />
      </div>
      <div>
        <Label>Contact Name *</Label>
        <Input value={form.contactName} onChange={(e) => setForm(f => ({ ...f, contactName: e.target.value }))} required data-testid="input-contact-name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Email</Label>
          <Input type="email" value={form.contactEmail} onChange={(e) => setForm(f => ({ ...f, contactEmail: e.target.value }))} data-testid="input-contact-email" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={form.contactPhone} onChange={(e) => setForm(f => ({ ...f, contactPhone: e.target.value }))} data-testid="input-contact-phone" />
        </div>
      </div>
      <div>
        <Label>Country</Label>
        <Select value={form.country || "none"} onValueChange={(v) => setForm(f => ({ ...f, country: v === "none" ? "" : v, state: "" }))}>
          <SelectTrigger data-testid="select-country">
            <SelectValue placeholder="Select country" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Select country</SelectItem>
            {COUNTRIES.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>City</Label>
          <Input value={form.city} onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))} data-testid="input-city" />
        </div>
        <div>
          <Label>{form.country === "CA" ? "Province / Territory" : "State"}</Label>
          {formRegions.length > 0 ? (
            <Select value={form.state || "none"} onValueChange={(v) => setForm(f => ({ ...f, state: v === "none" ? "" : v }))}>
              <SelectTrigger data-testid="select-state">
                <SelectValue placeholder={form.country === "CA" ? "Select province" : "Select state"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{form.country === "CA" ? "Select province" : "Select state"}</SelectItem>
                {formRegions.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={form.state} onChange={(e) => setForm(f => ({ ...f, state: e.target.value }))} placeholder="State / Province" data-testid="input-state" />
          )}
        </div>
      </div>
      <div>
        <Label>Source</Label>
        <Input value={form.source} onChange={(e) => setForm(f => ({ ...f, source: e.target.value }))} placeholder="e.g. Website, Referral, Trade Show" data-testid="input-source" />
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} data-testid="input-notes" />
      </div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-lead">
        {isPending ? "Creating..." : "Create Lead"}
      </Button>
    </form>
  );
}
