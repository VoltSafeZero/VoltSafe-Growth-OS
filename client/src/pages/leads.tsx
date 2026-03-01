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
  Plus, Search, ArrowRightLeft, Trash2, Loader2, Undo2,
  LayoutGrid, List, Download, MapPin, Building2, Phone, Mail, Anchor, Calendar
} from "lucide-react";
import { SortableHeader, useSortState } from "@/components/ui/sortable-header";
import { ExportButton } from "@/components/ui/export-button";
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
  const { sort, handleSort } = useSortState("slips", "desc");

  const regionOptions = countryFilter !== "all" ? getRegionsForCountry(countryFilter) : [];

  const PAGE_SIZE = 100;

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<{ data: Lead[]; total: number; page: number; totalPages: number }>({
    queryKey: ["/api/leads", { search, status: statusFilter === "all" ? "" : statusFilter, country: countryFilter === "all" ? "" : countryFilter, state: stateFilter === "all" ? "" : stateFilter, sortBy: sort.sortBy, sortOrder: sort.sortOrder }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (countryFilter !== "all") params.set("country", countryFilter);
      if (stateFilter !== "all") params.set("state", stateFilter);
      if (sort.sortBy) { params.set("sortBy", sort.sortBy); params.set("sortOrder", sort.sortOrder); }
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

  const unconvertMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/leads/${id}/unconvert`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setSelectedLead(null);
      toast({ title: "Lead reverted back to New and account removed" });
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
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Leads Pipeline</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {totalCount > 0 ? `${totalCount.toLocaleString()} leads` : "Manage your sales pipeline"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            endpoint={`/api/leads/export?${new URLSearchParams({
              ...(search ? { search } : {}),
              ...(statusFilter !== "all" ? { status: statusFilter } : {}),
              ...(countryFilter !== "all" ? { country: countryFilter } : {}),
              ...(stateFilter !== "all" ? { state: stateFilter } : {}),
            }).toString()}`}
            filename="leads_export.csv"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending}
            data-testid="button-import-marinas"
          >
            <Download className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">{importMutation.isPending ? "Importing..." : "Import Marinas"}</span>
            <span className="sm:hidden">{importMutation.isPending ? "..." : "Import"}</span>
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground" data-testid="button-create-lead">
                <Plus className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">New Lead</span><span className="sm:hidden">New</span>
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

      <div className="flex gap-2 sm:gap-3 flex-wrap items-center">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
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
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-44" data-testid="select-status-filter">
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
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-40" data-testid="select-country-filter">
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
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-48" data-testid="select-state-filter">
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
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <SortableHeader label="Marina / Company" sortKey="company" sort={sort} onSort={handleSort} />
                    <SortableHeader label="Location" sortKey="state" sort={sort} onSort={handleSort} />
                    <SortableHeader label="Contact" sortKey="contactName" sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                    <SortableHeader label="Slips" sortKey="slips" sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                    <SortableHeader label="Stage" sortKey="status" sort={sort} onSort={handleSort} />
                    <SortableHeader label="Source" sortKey="source" sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                    <th className="text-right p-3 sm:p-4 text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allLeads.map((lead) => (
                    <tr key={lead.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedLead(lead)} data-testid={`row-lead-${lead.id}`}>
                      <td className="p-3 sm:p-4">
                        <div className="flex items-center gap-2">
                          {lead.marinaId && <Anchor className="h-4 w-4 text-primary shrink-0" />}
                          <div className="min-w-0">
                            <span className="font-medium block truncate max-w-[180px] sm:max-w-none">{lead.company}</span>
                            <span className="text-xs text-muted-foreground md:hidden">
                              {lead.city && lead.state ? `${lead.city}, ${lead.state}` : lead.state || ""}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden sm:table-cell">
                        {lead.city && lead.state ? `${lead.city}, ${lead.state}` : lead.state || "—"}
                      </td>
                      <td className="p-3 sm:p-4 text-sm hidden md:table-cell">
                        <div>{lead.contactName}</div>
                        {lead.contactPhone && <div className="text-muted-foreground text-xs">{lead.contactPhone}</div>}
                      </td>
                      <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden lg:table-cell">{!lead.slips || lead.slips === "-" ? "Unknown" : lead.slips}</td>
                      <td className="p-3 sm:p-4">
                        <Badge variant="outline" className={`text-xs ${statusColors[lead.status] || ""}`} data-testid={`badge-status-${lead.id}`}>
                          {getStageLabel(lead.status)}
                        </Badge>
                      </td>
                      <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden lg:table-cell">{lead.source || "—"}</td>
                      <td className="p-3 sm:p-4 text-right">
                        {lead.status === "converted" ? (
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); unconvertMutation.mutate(lead.id); }} data-testid={`button-unconvert-${lead.id}`} title="Revert to New Lead">
                            <Undo2 className="h-4 w-4" />
                          </Button>
                        ) : lead.status !== "lost" ? (
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); convertMutation.mutate(lead.id); }} data-testid={`button-convert-${lead.id}`}>
                            <ArrowRightLeft className="h-4 w-4" />
                          </Button>
                        ) : null}
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
          onUnconvert={() => unconvertMutation.mutate(selectedLead.id)}
          onDelete={() => deleteMutation.mutate(selectedLead.id)}
          onUpdateStatus={(status) => {
            updateStatusMutation.mutate({ id: selectedLead.id, status });
            setSelectedLead({ ...selectedLead, status });
          }}
          isConverting={convertMutation.isPending}
          isUnconverting={unconvertMutation.isPending}
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
                {lead.slips && lead.slips !== "-" && (
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
  lead: initialLead,
  onClose,
  onConvert,
  onUnconvert,
  onDelete,
  onUpdateStatus,
  isConverting,
  isUnconverting,
  isDeleting,
}: {
  lead: Lead;
  onClose: () => void;
  onConvert: () => void;
  onUnconvert: () => void;
  onDelete: () => void;
  onUpdateStatus: (status: string) => void;
  isConverting: boolean;
  isUnconverting: boolean;
  isDeleting: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);

  const { data: freshLead } = useQuery<Lead>({
    queryKey: ["/api/leads", initialLead.id],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${initialLead.id}`, { credentials: "include" });
      return res.json();
    },
  });
  const lead = freshLead || initialLead;

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/leads/${lead.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setEditing(false);
      toast({ title: "Lead updated" });
    },
  });

  const stageInfo = PIPELINE_STAGES.find(s => s.value === lead.status);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Anchor className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl leading-tight">{lead.company}</DialogTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className={stageInfo?.color || ""}>{stageInfo?.label || lead.status}</Badge>
                {lead.source && <span className="text-xs text-muted-foreground">via {lead.source}</span>}
                <span className="text-xs text-muted-foreground">· Created {new Date(lead.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </DialogHeader>

        {editing ? (
          <EditLeadForm lead={lead} onSubmit={(d) => updateMutation.mutate(d)} onCancel={() => setEditing(false)} isPending={updateMutation.isPending} />
        ) : (
          <div className="space-y-4 mt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Pipeline Stage</Label>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-edit-lead">
                Edit Lead
              </Button>
            </div>

            <Select value={lead.status} onValueChange={onUpdateStatus}>
              <SelectTrigger data-testid="select-lead-stage" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(lead.streetAddress || lead.city || lead.state) && (
              <div className="rounded-lg border border-border/50 p-3" data-testid="lead-address">
                <Label className="text-xs text-muted-foreground mb-1 block">Location</Label>
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="text-sm">
                    {lead.streetAddress && <p className="font-medium">{lead.streetAddress}</p>}
                    <p className="text-muted-foreground">
                      {[lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ")}
                      {lead.country && <span className="ml-1">{lead.country === "CA" ? "Canada" : lead.country === "US" ? "USA" : lead.country}</span>}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border/50 p-3">
              <Label className="text-xs text-muted-foreground mb-2 block">Contact Information</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="text-sm font-medium">{lead.contactName === "Marina Contact" ? <span className="text-muted-foreground italic">Not set — click Edit to add</span> : lead.contactName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  {lead.contactEmail ? (
                    <p className="text-sm flex items-center gap-1"><Mail className="h-3 w-3 text-muted-foreground" />{lead.contactEmail}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Not set</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  {lead.contactPhone ? (
                    <p className="text-sm flex items-center gap-1"><Phone className="h-3 w-3 text-muted-foreground" />{lead.contactPhone}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Not set</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border/50 p-3">
                <p className="text-xs text-muted-foreground">Slips</p>
                <p className="text-lg font-semibold">{!lead.slips || lead.slips === "-" ? "—" : Number(lead.slips).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border/50 p-3">
                <p className="text-xs text-muted-foreground">Segment</p>
                <p className="text-sm font-medium">{lead.segment || "—"}</p>
              </div>
              <div className="rounded-lg border border-border/50 p-3">
                <p className="text-xs text-muted-foreground">Country</p>
                <p className="text-sm font-medium">{lead.country === "CA" ? "Canada" : lead.country === "US" ? "USA" : lead.country || "—"}</p>
              </div>
              <div className="rounded-lg border border-border/50 p-3">
                <p className="text-xs text-muted-foreground">Source</p>
                <p className="text-sm font-medium">{lead.source || "—"}</p>
              </div>
            </div>

            {(lead.nextStep || lead.dueDate) && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <Label className="text-xs text-primary mb-1 block flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Next Step
                </Label>
                <p className="text-sm font-medium">{lead.nextStep || "—"}</p>
                {lead.dueDate && (
                  <p className="text-xs text-muted-foreground mt-1">Due: {new Date(lead.dueDate).toLocaleDateString()}</p>
                )}
              </div>
            )}

            {lead.tags && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Tags</Label>
                <div className="flex gap-1 flex-wrap">
                  {lead.tags.split(",").map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{tag.trim()}</Badge>
                  ))}
                </div>
              </div>
            )}

            {lead.notes && (
              <div className="rounded-lg border border-border/50 p-3">
                <Label className="text-xs text-muted-foreground mb-1 block">Notes</Label>
                <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
              </div>
            )}

            {!lead.nextStep && !lead.notes && !lead.tags && (
              <div className="rounded-lg border border-dashed border-border/50 p-4 text-center">
                <p className="text-sm text-muted-foreground mb-2">This lead needs more detail — add a next step, notes, or contact info.</p>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-enrich-lead">
                  Enrich Lead
                </Button>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-4 border-t border-border/50">
              {lead.status === "converted" ? (
                <Button variant="outline" onClick={onUnconvert} disabled={isUnconverting} data-testid="button-unconvert-detail">
                  <Undo2 className="mr-2 h-4 w-4" /> Revert to New Lead
                </Button>
              ) : lead.status !== "lost" ? (
                <Button variant="outline" onClick={onConvert} disabled={isConverting} data-testid="button-convert-detail">
                  <ArrowRightLeft className="mr-2 h-4 w-4" /> Convert to Account
                </Button>
              ) : null}
              <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting} data-testid="button-delete-lead">
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditLeadForm({ lead, onSubmit, onCancel, isPending }: { lead: Lead; onSubmit: (data: Record<string, unknown>) => void; onCancel: () => void; isPending: boolean }) {
  const [form, setForm] = useState({
    company: lead.company || "",
    contactName: lead.contactName || "",
    contactEmail: lead.contactEmail || "",
    contactPhone: lead.contactPhone || "",
    source: lead.source || "",
    notes: lead.notes || "",
    tags: lead.tags || "",
    nextStep: lead.nextStep || "",
    dueDate: lead.dueDate ? new Date(lead.dueDate).toISOString().split("T")[0] : "",
    country: lead.country || "",
    state: lead.state || "",
    city: lead.city || "",
    streetAddress: lead.streetAddress || "",
    zipCode: lead.zipCode || "",
    slips: lead.slips || "",
    segment: lead.segment || "",
  });

  const formRegions = form.country ? getRegionsForCountry(form.country) : [];

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSubmit({
        ...form,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        contactName: form.contactName || "Marina Contact",
      });
    }} className="space-y-4 mt-2">
      <div>
        <Label className="text-xs">Company / Marina Name *</Label>
        <Input value={form.company} onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))} required data-testid="input-edit-company" />
      </div>

      <div className="border-t border-border/50 pt-3">
        <Label className="text-xs text-muted-foreground mb-2 block">Contact Information</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><Label className="text-xs">Contact Name</Label><Input value={form.contactName} onChange={(e) => setForm(f => ({ ...f, contactName: e.target.value }))} placeholder="Full name" data-testid="input-edit-contact-name" /></div>
          <div><Label className="text-xs">Email</Label><Input type="email" value={form.contactEmail} onChange={(e) => setForm(f => ({ ...f, contactEmail: e.target.value }))} data-testid="input-edit-contact-email" /></div>
          <div><Label className="text-xs">Phone</Label><Input value={form.contactPhone} onChange={(e) => setForm(f => ({ ...f, contactPhone: e.target.value }))} data-testid="input-edit-contact-phone" /></div>
        </div>
      </div>

      <div className="border-t border-border/50 pt-3">
        <Label className="text-xs text-muted-foreground mb-2 block">Location</Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label className="text-xs">Street Address</Label><Input value={form.streetAddress} onChange={(e) => setForm(f => ({ ...f, streetAddress: e.target.value }))} data-testid="input-edit-street" /></div>
          <div><Label className="text-xs">City</Label><Input value={form.city} onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))} data-testid="input-edit-city" /></div>
          <div>
            <Label className="text-xs">{form.country === "CA" ? "Province" : "State"}</Label>
            {formRegions.length > 0 ? (
              <Select value={form.state || "none"} onValueChange={(v) => setForm(f => ({ ...f, state: v === "none" ? "" : v }))}>
                <SelectTrigger data-testid="select-edit-state"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select...</SelectItem>
                  {formRegions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input value={form.state} onChange={(e) => setForm(f => ({ ...f, state: e.target.value }))} data-testid="input-edit-state" />
            )}
          </div>
          <div><Label className="text-xs">Zip / Postal</Label><Input value={form.zipCode} onChange={(e) => setForm(f => ({ ...f, zipCode: e.target.value }))} data-testid="input-edit-zip" /></div>
          <div>
            <Label className="text-xs">Country</Label>
            <Select value={form.country || "none"} onValueChange={(v) => setForm(f => ({ ...f, country: v === "none" ? "" : v }))}>
              <SelectTrigger data-testid="select-edit-country"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select...</SelectItem>
                {COUNTRIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="border-t border-border/50 pt-3">
        <Label className="text-xs text-muted-foreground mb-2 block">Marina Details</Label>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Slips</Label><Input value={form.slips} onChange={(e) => setForm(f => ({ ...f, slips: e.target.value }))} data-testid="input-edit-slips" /></div>
          <div><Label className="text-xs">Segment</Label><Input value={form.segment} onChange={(e) => setForm(f => ({ ...f, segment: e.target.value }))} data-testid="input-edit-segment" /></div>
          <div><Label className="text-xs">Source</Label><Input value={form.source} onChange={(e) => setForm(f => ({ ...f, source: e.target.value }))} data-testid="input-edit-source" /></div>
        </div>
      </div>

      <div className="border-t border-border/50 pt-3">
        <Label className="text-xs text-muted-foreground mb-2 block">Sales Tracking</Label>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Next Step</Label><Input value={form.nextStep} onChange={(e) => setForm(f => ({ ...f, nextStep: e.target.value }))} placeholder="e.g. Schedule intro call" data-testid="input-edit-next-step" /></div>
          <div><Label className="text-xs">Due Date</Label><Input type="date" value={form.dueDate} onChange={(e) => setForm(f => ({ ...f, dueDate: e.target.value }))} data-testid="input-edit-due-date" /></div>
        </div>
        <div className="mt-3"><Label className="text-xs">Tags</Label><Input value={form.tags} onChange={(e) => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="Comma-separated tags" data-testid="input-edit-tags" /></div>
        <div className="mt-3"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Meeting notes, observations, key details..." data-testid="input-edit-notes" /></div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={isPending} data-testid="button-save-lead">
          {isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
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
