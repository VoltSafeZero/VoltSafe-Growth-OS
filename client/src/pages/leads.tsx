import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, ArrowRightLeft, Trash2, Loader2, Undo2,
  LayoutGrid, List, Download, MapPin, Building2, Phone, Mail, Anchor, Calendar, DollarSign, Map, ExternalLink,
  CheckCircle2, AlertCircle, Link2,
} from "lucide-react";
import { RecordSummaryBar } from "@/components/record-summary-bar";
import { SortableHeader, useSortState } from "@/components/ui/sortable-header";
import { lazy, Suspense } from "react";
const NearbyMarinasMap = lazy(() => import("@/components/nearby-marinas-map"));
import { ExportButton } from "@/components/ui/export-button";
import { CommentsFeed } from "@/components/comments-feed";
import { AttachmentsSection } from "@/components/attachments-section";
import { AssignUserSelect } from "@/components/assign-user-select";
import { CreateActionItem } from "@/components/create-action-item";
import type { Lead, Account } from "@shared/schema";
import { AccountDetailDialog } from "./accounts";
import { EmailsTab } from "@/components/emails-tab";

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

const MX_STATES = [
  "Baja California","Baja California Sur","Campeche","Chiapas","Colima",
  "Guerrero","Jalisco","Nayarit","Oaxaca","Quintana Roo","Sinaloa","Sonora",
  "Tabasco","Tamaulipas","Veracruz","Yucatan",
];

const COUNTRIES = [
  { value: "CA", label: "Canada" },
  { value: "MX", label: "Mexico" },
  { value: "US", label: "United States" },
];

function getRegionsForCountry(country: string): string[] {
  if (country === "US") return US_STATES;
  if (country === "CA") return CA_PROVINCES;
  if (country === "MX") return MX_STATES;
  return [];
}

const PIPELINE_STAGES = [
  { value: "new", label: "New", color: "bg-slate-500/10 text-slate-400 border-slate-500/20", columnColor: "border-t-slate-500" },
  { value: "contacted", label: "Contacted", color: "bg-blue-500/10 text-blue-400 border-blue-500/20", columnColor: "border-t-blue-500" },
  { value: "meeting_scheduled", label: "Meeting Scheduled", color: "bg-purple-500/10 text-purple-400 border-purple-500/20", columnColor: "border-t-purple-500" },
  { value: "qualified", label: "Qualified", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20", columnColor: "border-t-cyan-500" },
  { value: "proposal_sent", label: "Proposal Sent", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", columnColor: "border-t-amber-500" },
  { value: "negotiation", label: "Negotiation", color: "bg-orange-500/10 text-orange-400 border-orange-500/20", columnColor: "border-t-orange-500" },
  { value: "converted", label: "Promoted", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", columnColor: "border-t-emerald-500" },
  { value: "lost", label: "Closed Lost", color: "bg-red-500/10 text-red-400 border-red-500/20", columnColor: "border-t-red-500" },
];

const statusColors: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map(s => [s.value, s.color])
);

const ORG_TYPE_OPTIONS = [
  { value: "marina_prospect", label: "Marina Prospect" },
  { value: "marina_customer", label: "Marina Customer" },
  { value: "pilot_customer", label: "Pilot Customer" },
  { value: "enterprise_customer", label: "Enterprise Customer" },
  { value: "yacht_club", label: "Yacht Club" },
  { value: "dry_stack", label: "Dry Stack" },
  { value: "resort_marina", label: "Resort Marina" },
  { value: "commercial_marina", label: "Commercial Marina" },
  { value: "government_port", label: "Government / Port Authority" },
  { value: "oem_partner", label: "OEM Partner" },
  { value: "distributor", label: "Distributor / Channel Partner" },
  { value: "integration_partner", label: "Integration Partner" },
  { value: "industry_association", label: "Industry Association" },
  { value: "investor", label: "Investor / Stakeholder" },
  { value: "other", label: "Other" },
];

function getStageLabel(value: string) {
  return PIPELINE_STAGES.find(s => s.value === value)?.label || value;
}

export default function LeadsPage({ canEdit = true }: { canEdit?: boolean }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [view, setView] = useState<"list" | "pipeline" | "map">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<Account | null>(null);
  const [pendingOrgId, setPendingOrgId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: pendingOrgData } = useQuery<Account>({
    queryKey: ["/api/accounts", pendingOrgId],
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${pendingOrgId}`, { credentials: "include" });
      if (!res.ok) return null as unknown as Account;
      return res.json();
    },
    enabled: pendingOrgId !== null,
  });

  useEffect(() => {
    if (pendingOrgData && pendingOrgId !== null) {
      setSelectedOrg(pendingOrgData);
      setPendingOrgId(null);
    }
  }, [pendingOrgData, pendingOrgId]);

  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const { sort, handleSort } = useSortState("slips", "desc");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selectedId = params.get("selected");
    const statusParam = params.get("status");
    if (selectedId) {
      fetch(`/api/leads/${selectedId}`).then(r => r.ok ? r.json() : null).then(lead => {
        if (lead) setSelectedLead(lead);
      });
    }
    if (statusParam) {
      setStatusFilter(statusParam);
    }
    if (selectedId || statusParam) {
      window.history.replaceState({}, "", "/opportunities");
    }
  }, []);

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

  const allLeads = data?.pages.flatMap(p => p.data ?? []).filter(Boolean) || [];
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

  const [convertDialogLead, setConvertDialogLead] = useState<Lead | null>(null);

  const convertMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) => {
      const res = await apiRequest("POST", `/api/leads/${id}/convert`, payload);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      setConvertDialogLead(null);
      setSelectedLead(null);
      const parts: string[] = [];
      if (data?.action === "linked") parts.push(`Linked to: ${data?.account?.name ?? ""}`);
      else parts.push(`Created: ${data?.account?.name ?? ""}`);
      if (data?.contact) parts.push(`Contact: ${data.contact.name}`);
      if (data?.opportunity) parts.push(`Opp: ${data.opportunity.title}`);
      toast({ title: "Lead converted", description: parts.join(" · ") });
    },
    onError: (err: any) => toast({ title: "Conversion failed", description: err.message, variant: "destructive" }),
  });

  const unconvertMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/leads/${id}/unconvert`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setSelectedLead(null);
      toast({ title: "Lead unconverted", description: data?.description ?? "Lead status restored. Organization preserved." });
    },
    onError: (err: any) => toast({ title: "Unconvert failed", description: err.message, variant: "destructive" }),
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
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Opportunities</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {totalCount > 0 ? `${totalCount.toLocaleString()} leads` : "Manage your sales pipeline"}
              {(() => { const pv = allLeads.reduce((s, l) => s + (l.dealAmount || 0), 0); return pv > 0 ? ` · $${pv.toLocaleString()} pipeline` : ""; })()}
            </p>
          </div>
          <div className="flex items-center border border-border/50 rounded-xl overflow-hidden">
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="default"
              onClick={() => setView("list")}
              className="rounded-none px-3"
              data-testid="button-list-view"
            >
              <List className="h-5 w-5" />
            </Button>
            <Button
              variant={view === "pipeline" ? "secondary" : "ghost"}
              size="default"
              onClick={() => setView("pipeline")}
              className="rounded-none px-3"
              data-testid="button-pipeline-view"
            >
              <LayoutGrid className="h-5 w-5" />
            </Button>
            <Button
              variant={view === "map" ? "secondary" : "ghost"}
              size="default"
              onClick={() => setView("map")}
              className="rounded-none px-3"
              data-testid="button-map-view"
            >
              <Map className="h-5 w-5" />
            </Button>
          </div>
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
            {canEdit && (
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground" data-testid="button-create-lead">
                  <Plus className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">New Lead</span><span className="sm:hidden">New</span>
                </Button>
              </DialogTrigger>
            )}
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
        {view !== "map" && <>
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
        </>}
      </div>

      {view === "map" ? (
        <Suspense fallback={<div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
          <NearbyMarinasMap onSelectLead={(id) => {
            const lead = allLeads.find(l => l.id === id);
            if (lead) setSelectedLead(lead);
          }} />
        </Suspense>
      ) : isLoading ? (
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
                    <SortableHeader label="Deal $" sortKey="dealAmount" sort={sort} onSort={handleSort} className="hidden xl:table-cell" />
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
                      <td className="p-3 sm:p-4 text-sm hidden xl:table-cell">
                        {lead.dealAmount ? (
                          <span className="text-emerald-400 font-medium">${Number(lead.dealAmount).toLocaleString()}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 sm:p-4">
                        <Badge variant="outline" className={`text-xs ${statusColors[lead.status] || ""}`} data-testid={`badge-status-${lead.id}`}>
                          {getStageLabel(lead.status)}
                        </Badge>
                      </td>
                      <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden lg:table-cell">{lead.source || "—"}</td>
                      <td className="p-3 sm:p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/opportunities/${lead.id}`}>
                            <Button variant="ghost" size="sm" onClick={e => e.stopPropagation()} data-testid={`link-opp-profile-${lead.id}`} title="View full profile" className="h-8 px-2 text-xs text-muted-foreground hover:text-primary gap-1">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                          {canEdit && (lead.status === "converted" ? (
                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); unconvertMutation.mutate(lead.id); }} data-testid={`button-unconvert-${lead.id}`} title="Revert lead status (Organization preserved)">
                              <Undo2 className="h-4 w-4" />
                            </Button>
                          ) : lead.status !== "lost" ? (
                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConvertDialogLead(lead); }} data-testid={`button-convert-${lead.id}`} title="Promote to Organization">
                              <ArrowRightLeft className="h-4 w-4" />
                            </Button>
                          ) : null)}
                        </div>
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
          onConvert={() => setConvertDialogLead(selectedLead)}
          onUnconvert={() => unconvertMutation.mutate(selectedLead.id)}
          onDelete={() => deleteMutation.mutate(selectedLead.id)}
          onUpdateStatus={(status) => {
            updateStatusMutation.mutate({ id: selectedLead.id, status });
            setSelectedLead({ ...selectedLead, status });
          }}
          onOpenOrg={(orgId) => {
            setSelectedLead(null);
            setPendingOrgId(orgId);
          }}
          isConverting={convertMutation.isPending}
          isUnconverting={unconvertMutation.isPending}
          isDeleting={deleteMutation.isPending}
          canEdit={canEdit}
        />
      )}

      {selectedOrg && (
        <AccountDetailDialog
          account={selectedOrg}
          onClose={() => setSelectedOrg(null)}
          canEdit={canEdit}
          onOpenLead={(leadId) => {
            setSelectedOrg(null);
            fetch(`/api/leads/${leadId}`, { credentials: "include" })
              .then(r => r.ok ? r.json() : null)
              .then(lead => { if (lead) setSelectedLead(lead); });
          }}
        />
      )}

      <ConvertToOrgDialog
        lead={convertDialogLead}
        onClose={() => setConvertDialogLead(null)}
        onConvert={(payload) => convertMutation.mutate({ id: convertDialogLead!.id, payload })}
        isPending={convertMutation.isPending}
      />
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
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const dragLeadId = useRef<number | null>(null);
  const dragFromStage = useRef<string | null>(null);

  const stageGroups = PIPELINE_STAGES.map(stage => ({
    ...stage,
    leads: leads.filter(l => l.status === stage.value),
  }));

  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    dragLeadId.current = lead.id;
    dragFromStage.current = lead.status;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(lead.id));
  };

  const handleDragOver = (e: React.DragEvent, stageValue: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverStage !== stageValue) setDragOverStage(stageValue);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverStage(null);
    }
  };

  const handleDrop = (e: React.DragEvent, stageValue: string) => {
    e.preventDefault();
    setDragOverStage(null);
    if (dragLeadId.current !== null && dragFromStage.current !== stageValue) {
      onUpdateStatus(dragLeadId.current, stageValue);
    }
    dragLeadId.current = null;
    dragFromStage.current = null;
  };

  const handleDragEnd = () => {
    setDragOverStage(null);
    dragLeadId.current = null;
    dragFromStage.current = null;
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {stageGroups.map(stage => {
        const isOver = dragOverStage === stage.value;
        return (
          <div
            key={stage.value}
            className={`flex-shrink-0 w-[260px] sm:w-72 border rounded-xl bg-card/50 border-t-2 ${stage.columnColor} transition-all duration-150 ${
              isOver ? "border-primary/60 bg-primary/5 shadow-lg shadow-primary/10" : "border-border/50"
            }`}
            onDragOver={(e) => handleDragOver(e, stage.value)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, stage.value)}
          >
            <div className="p-3 border-b border-border/30">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{stage.label}</h3>
                <Badge variant="outline" className="text-xs px-1.5 py-0">{stage.leads.length}</Badge>
              </div>
              {(() => { const total = stage.leads.reduce((sum, l) => sum + (l.dealAmount || 0), 0); return total > 0 ? <p className="text-xs text-emerald-400 mt-1">${total.toLocaleString()}</p> : null; })()}
            </div>
            <div className="p-2 space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto">
              {isOver && stage.leads.length === 0 && (
                <div className="border-2 border-dashed border-primary/40 rounded-lg py-6 text-center text-xs text-primary/60">
                  Drop here
                </div>
              )}
              {!isOver && stage.leads.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No leads</p>
              )}
              {stage.leads.slice(0, 50).map(lead => (
                <div
                  key={lead.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, lead)}
                  onDragEnd={handleDragEnd}
                  className="p-3 bg-background/80 border border-border/30 rounded-lg cursor-grab active:cursor-grabbing active:opacity-50 active:scale-95 hover:border-primary/30 transition-all select-none"
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
                  {lead.dealAmount != null && lead.dealAmount > 0 && (
                    <p className="text-xs text-emerald-400 font-medium mt-0.5 flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      ${Number(lead.dealAmount).toLocaleString()}
                      {lead.dealProbability != null && <span className="text-muted-foreground font-normal">({lead.dealProbability}%)</span>}
                    </p>
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
              {isOver && stage.leads.length > 0 && (
                <div className="border-2 border-dashed border-primary/40 rounded-lg py-3 text-center text-xs text-primary/60">
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type ConvertMatch = {
  id: number; name: string; city: string | null; stateProvince: string | null;
  orgType: string | null; confidence: "high" | "medium"; reasons: string[];
};
type ContactMatch = {
  id: number; name: string; email: string | null;
  accountId: number | null; accountName: string | null;
  confidence: "high" | "medium"; reasons: string[];
};
type AccountMode = "new" | "link";
type ContactMode = "new" | "link" | "skip";

const OPP_STAGES = [
  { value: "inbound_new", label: "Inbound New" },
  { value: "discovery", label: "Discovery" },
  { value: "proposal_sent", label: "Proposal Sent" },
  { value: "negotiation", label: "Negotiation" },
  { value: "closed_won", label: "Closed Won" },
];

const STEPS = ["Dedupe", "Configure", "Review", "Confirm"];

function ConvertToOrgDialog({
  lead, onClose, onConvert, isPending,
}: {
  lead: Lead | null;
  onClose: () => void;
  onConvert: (payload: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [step, setStep] = useState(1);
  const [selectedAccountMatch, setSelectedAccountMatch] = useState<ConvertMatch | null>(null);
  const [selectedContactMatch, setSelectedContactMatch] = useState<ContactMatch | null>(null);
  const [accountMode, setAccountMode] = useState<AccountMode>("new");
  const [contactMode, setContactMode] = useState<ContactMode>("new");
  const [createOpp, setCreateOpp] = useState(false);
  // Field overrides
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("marina_prospect");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [oppTitle, setOppTitle] = useState("");
  const [oppAmount, setOppAmount] = useState("");
  const [oppStage, setOppStage] = useState("inbound_new");

  // Reset state when lead changes
  useEffect(() => {
    if (lead) {
      setStep(1);
      setSelectedAccountMatch(null);
      setSelectedContactMatch(null);
      setAccountMode("new");
      setContactMode(lead.contactName ? "new" : "skip");
      setCreateOpp(false);
      setOrgName(lead.company || "");
      setOrgType("marina_prospect");
      setContactName(lead.contactName || "");
      setContactEmail(lead.contactEmail || "");
      setContactPhone(lead.contactPhone || "");
      setOppTitle("");
      setOppAmount(lead.dealAmount ? String(lead.dealAmount) : "");
      setOppStage("inbound_new");
    }
  }, [lead?.id]);

  const checkQuery = useQuery<{ matches: ConvertMatch[]; contactMatches: ContactMatch[] }>({
    queryKey: ["/api/leads", lead?.id, "convert-check"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${lead!.id}/convert-check`, { credentials: "include" });
      if (!res.ok) throw new Error("Check failed");
      return res.json();
    },
    enabled: !!lead,
    staleTime: 0,
  });

  if (!lead) return null;
  const accountMatches = checkQuery.data?.matches ?? [];
  const contactMatches = checkQuery.data?.contactMatches ?? [];
  const isChecking = checkQuery.isLoading;
  const hasDedupeData = !isChecking;
  const hasMatches = accountMatches.length > 0 || contactMatches.length > 0;

  // Step 3 can be skipped if there's nothing to review
  const hasFieldsToReview = (accountMode === "new") || (contactMode === "new") || createOpp;

  function goToStep2() {
    setStep(2);
  }

  function goToStep3OrConfirm() {
    if (hasFieldsToReview) setStep(3);
    else setStep(4);
  }

  function handleConfirm() {
    const payload: Record<string, unknown> = {};

    if (accountMode === "link" && selectedAccountMatch) {
      payload.existingAccountId = selectedAccountMatch.id;
    } else {
      payload.fieldOverrides = {
        name: orgName || lead.company,
        orgType,
      };
      payload.orgType = orgType;
    }

    if (contactMode === "link" && selectedContactMatch) {
      payload.existingContactId = selectedContactMatch.id;
    } else if (contactMode === "skip") {
      payload.skipContact = true;
    } else {
      // new contact — pass field overrides
      payload.fieldOverrides = {
        ...(payload.fieldOverrides as object ?? {}),
        contactName: contactName || lead.contactName,
        contactEmail: contactEmail || lead.contactEmail,
        contactPhone: contactPhone || lead.contactPhone,
      };
    }

    if (createOpp) {
      payload.createOpportunity = true;
      payload.opportunityTitle = oppTitle || `${(payload.fieldOverrides as any)?.name || lead.company}`;
      if (oppAmount) payload.opportunityAmount = Number(oppAmount);
      payload.opportunityStage = oppStage;
    }

    onConvert(payload);
  }

  function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" }) {
    return (
      <Badge variant="outline" className={`text-[10px] px-1 py-0 shrink-0 ${confidence === "high" ? "text-amber-400 border-amber-500/30 bg-amber-500/10" : "text-blue-400 border-blue-500/30 bg-blue-500/10"}`}>
        {confidence === "high" ? "High match" : "Possible"}
      </Badge>
    );
  }

  return (
    <Dialog open={!!lead} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl" data-testid="dialog-convert-org">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />Convert Lead
          </DialogTitle>
          <DialogDescription>
            Converting <strong>{lead.company}</strong> into an Organization, Contact, and optional Opportunity.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-1">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const active = step === n;
            const done = step > n;
            return (
              <div key={label} className="flex items-center gap-1 flex-1">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${active ? "text-primary" : done ? "text-emerald-400" : "text-muted-foreground/50"}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${active ? "border-primary bg-primary/10 text-primary" : done ? "border-emerald-500 bg-emerald-500/10 text-emerald-400" : "border-muted-foreground/20"}`}>
                    {done ? "✓" : n}
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </div>
                {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border/40 mx-1" />}
              </div>
            );
          })}
        </div>

        {/* ── Step 1: Dedupe ─────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4" data-testid="convert-step-dedupe">
            {isChecking ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />Scanning for duplicates…
              </div>
            ) : !hasMatches ? (
              <div className="flex items-center gap-2 text-sm text-emerald-400 py-3 bg-emerald-500/5 rounded-lg px-3 border border-emerald-500/20">
                <CheckCircle2 className="h-4 w-4 shrink-0" />No duplicates found — safe to create new records.
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                  <span>Potential matches found. Click <strong>Use</strong> to link instead of creating new.</span>
                </p>

                {accountMatches.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Organization Matches</p>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {accountMatches.map(m => (
                        <div key={m.id} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${selectedAccountMatch?.id === m.id ? "border-primary/50 bg-primary/5" : "border-border/50 bg-secondary/20"}`} data-testid={`match-org-${m.id}`}>
                          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-medium truncate">{m.name}</span>
                              <ConfidenceBadge confidence={m.confidence} />
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {[m.city, m.stateProvince].filter(Boolean).join(", ")}
                              {m.reasons[0] ? ` · ${m.reasons[0]}` : ""}
                            </p>
                          </div>
                          <Button size="sm" variant={selectedAccountMatch?.id === m.id ? "default" : "outline"} className="shrink-0 gap-1 text-xs h-7 px-2.5"
                            onClick={() => { setSelectedAccountMatch(m); setAccountMode("link"); }}
                            data-testid={`button-link-org-${m.id}`}>
                            <Link2 className="h-3 w-3" />
                            {selectedAccountMatch?.id === m.id ? "Selected" : "Use"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {contactMatches.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Contact Matches</p>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                      {contactMatches.map(m => (
                        <div key={m.id} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${selectedContactMatch?.id === m.id ? "border-primary/50 bg-primary/5" : "border-border/50 bg-secondary/20"}`} data-testid={`match-contact-${m.id}`}>
                          <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-medium truncate">{m.name}</span>
                              <ConfidenceBadge confidence={m.confidence} />
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {m.email ?? ""}
                              {m.accountName ? ` · ${m.accountName}` : ""}
                            </p>
                          </div>
                          <Button size="sm" variant={selectedContactMatch?.id === m.id ? "default" : "outline"} className="shrink-0 gap-1 text-xs h-7 px-2.5"
                            onClick={() => { setSelectedContactMatch(m); setContactMode("link"); }}
                            data-testid={`button-link-contact-${m.id}`}>
                            <Link2 className="h-3 w-3" />
                            {selectedContactMatch?.id === m.id ? "Selected" : "Use"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between pt-2 border-t border-border/40">
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={goToStep2} disabled={!hasDedupeData} data-testid="button-convert-next-1">
                Continue →
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Configure modes ─────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-4" data-testid="convert-step-configure">
            {/* Account */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Organization</p>
              <div className="space-y-1.5">
                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${accountMode === "new" ? "border-primary/50 bg-primary/5" : "border-border/40 hover:bg-secondary/30"}`}
                  onClick={() => setAccountMode("new")} data-testid="radio-account-new">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${accountMode === "new" ? "border-primary" : "border-muted-foreground/40"}`}>
                    {accountMode === "new" && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">Create new Organization</p>
                    <p className="text-[11px] text-muted-foreground">from lead data for <strong>{lead.company}</strong></p>
                  </div>
                </label>
                {selectedAccountMatch && (
                  <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${accountMode === "link" ? "border-primary/50 bg-primary/5" : "border-border/40 hover:bg-secondary/30"}`}
                    onClick={() => setAccountMode("link")} data-testid="radio-account-link">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${accountMode === "link" ? "border-primary" : "border-muted-foreground/40"}`}>
                      {accountMode === "link" && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Link to existing: <span className="text-primary">{selectedAccountMatch.name}</span></p>
                      <p className="text-[11px] text-muted-foreground">No new organization will be created</p>
                    </div>
                  </label>
                )}
              </div>
            </div>

            {/* Contact */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact</p>
              <div className="space-y-1.5">
                {lead.contactName && (
                  <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${contactMode === "new" ? "border-primary/50 bg-primary/5" : "border-border/40 hover:bg-secondary/30"}`}
                    onClick={() => setContactMode("new")} data-testid="radio-contact-new">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${contactMode === "new" ? "border-primary" : "border-muted-foreground/40"}`}>
                      {contactMode === "new" && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">Create new Contact</p>
                      <p className="text-[11px] text-muted-foreground">{lead.contactName}{lead.contactEmail ? ` · ${lead.contactEmail}` : ""}</p>
                    </div>
                  </label>
                )}
                {selectedContactMatch && (
                  <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${contactMode === "link" ? "border-primary/50 bg-primary/5" : "border-border/40 hover:bg-secondary/30"}`}
                    onClick={() => setContactMode("link")} data-testid="radio-contact-link">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${contactMode === "link" ? "border-primary" : "border-muted-foreground/40"}`}>
                      {contactMode === "link" && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">Link to existing: <span className="text-primary">{selectedContactMatch.name}</span></p>
                      <p className="text-[11px] text-muted-foreground">{selectedContactMatch.email ?? ""}</p>
                    </div>
                  </label>
                )}
                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${contactMode === "skip" ? "border-primary/50 bg-primary/5" : "border-border/40 hover:bg-secondary/30"}`}
                  onClick={() => setContactMode("skip")} data-testid="radio-contact-skip">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${contactMode === "skip" ? "border-primary" : "border-muted-foreground/40"}`}>
                    {contactMode === "skip" && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">Skip contact</p>
                    <p className="text-[11px] text-muted-foreground">No contact record will be created or linked</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Opportunity */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Opportunity</p>
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${createOpp ? "border-primary/50 bg-primary/5" : "border-border/40 hover:bg-secondary/30"}`}
                onClick={() => setCreateOpp(v => !v)} data-testid="toggle-create-opportunity">
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${createOpp ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
                  {createOpp && <span className="text-[9px] text-primary-foreground font-bold">✓</span>}
                </div>
                <div>
                  <p className="text-sm font-medium">Create Opportunity</p>
                  <p className="text-[11px] text-muted-foreground">Start a deal record linked to this Organization</p>
                </div>
              </label>
            </div>

            <div className="flex justify-between pt-2 border-t border-border/40">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>← Back</Button>
              <Button size="sm" onClick={goToStep3OrConfirm} data-testid="button-convert-next-2">
                {hasFieldsToReview ? "Review Fields →" : "Preview →"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Field Review ────────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4" data-testid="convert-step-review">
            {accountMode === "new" && (
              <div className="space-y-3 p-3 rounded-lg border border-border/40 bg-secondary/10">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />New Organization
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder={lead.company} data-testid="input-org-name" />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Organization Type</Label>
                    <Select value={orgType} onValueChange={setOrgType}>
                      <SelectTrigger data-testid="select-convert-org-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ORG_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {contactMode === "new" && (
              <div className="space-y-3 p-3 rounded-lg border border-border/40 bg-secondary/10">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />New Contact
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder={lead.contactName || "Contact name"} data-testid="input-contact-name" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Email</Label>
                    <Input value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder={lead.contactEmail || "email@example.com"} type="email" data-testid="input-contact-email" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder={lead.contactPhone || "+1 (604) 555-0100"} data-testid="input-contact-phone" />
                  </div>
                </div>
              </div>
            )}

            {createOpp && (
              <div className="space-y-3 p-3 rounded-lg border border-border/40 bg-secondary/10">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" />New Opportunity
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Title</Label>
                    <Input value={oppTitle} onChange={e => setOppTitle(e.target.value)} placeholder={`${orgName || lead.company} — EV Charging`} data-testid="input-opp-title" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount ($)</Label>
                    <Input value={oppAmount} onChange={e => setOppAmount(e.target.value)} placeholder="0" type="number" data-testid="input-opp-amount" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Stage</Label>
                    <Select value={oppStage} onValueChange={setOppStage}>
                      <SelectTrigger data-testid="select-opp-stage"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {OPP_STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2 border-t border-border/40">
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}>← Back</Button>
              <Button size="sm" onClick={() => setStep(4)} data-testid="button-convert-next-3">Preview →</Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Confirm ─────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-4" data-testid="convert-step-confirm">
            <div className="rounded-lg border border-border/40 bg-secondary/10 divide-y divide-border/30">
              <div className="flex items-start gap-3 p-3">
                <Building2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Organization</p>
                  {accountMode === "link" && selectedAccountMatch ? (
                    <p className="text-sm font-medium">Link to <span className="text-primary">{selectedAccountMatch.name}</span></p>
                  ) : (
                    <p className="text-sm font-medium">Create <span className="text-primary">{orgName || lead.company}</span> <span className="text-xs text-muted-foreground">({ORG_TYPE_OPTIONS.find(o => o.value === orgType)?.label})</span></p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3 p-3">
                <Mail className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Contact</p>
                  {contactMode === "skip" ? (
                    <p className="text-sm font-medium text-muted-foreground">Skip — no contact</p>
                  ) : contactMode === "link" && selectedContactMatch ? (
                    <p className="text-sm font-medium">Link to <span className="text-primary">{selectedContactMatch.name}</span></p>
                  ) : (
                    <p className="text-sm font-medium">Create <span className="text-primary">{contactName || lead.contactName || "—"}</span></p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3 p-3">
                <DollarSign className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Opportunity</p>
                  {createOpp ? (
                    <p className="text-sm font-medium">Create <span className="text-primary">{oppTitle || `${orgName || lead.company}`}</span>
                      {oppAmount ? <span className="text-xs text-muted-foreground ml-1">(${Number(oppAmount).toLocaleString()})</span> : null}
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-muted-foreground">Skip — no opportunity</p>
                  )}
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Lead history, emails, and activities will be preserved with full traceability.
            </p>

            <div className="flex justify-between pt-2 border-t border-border/40">
              <Button variant="ghost" size="sm" onClick={() => setStep(hasFieldsToReview ? 3 : 2)}>← Back</Button>
              <Button onClick={handleConfirm} disabled={isPending} className="gap-2" data-testid="button-convert-confirm">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Convert Lead
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LeadDetailDialog({
  lead: initialLead,
  onClose,
  onConvert,
  onUnconvert,
  onDelete,
  onUpdateStatus,
  onOpenOrg,
  isConverting,
  isUnconverting,
  isDeleting,
  canEdit = true,
}: {
  lead: Lead;
  onClose: () => void;
  onConvert: () => void;
  onUnconvert: () => void;
  onDelete: () => void;
  onUpdateStatus: (status: string) => void;
  onOpenOrg?: (orgId: number) => void;
  isConverting: boolean;
  isUnconverting: boolean;
  isDeleting: boolean;
  canEdit?: boolean;
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

  const { data: linkedOrgData, isSuccess: linkedOrgResolved } = useQuery<{ account: { id: number; name: string; orgType: string | null } | null }>({
    queryKey: ["/api/leads", lead.id, "linked-org"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${lead.id}/linked-org`, { credentials: "include" });
      return res.json();
    },
    enabled: lead.status === "converted",
  });
  const linkedOrg = linkedOrgData?.account ?? null;
  const orgUnavailable = linkedOrgResolved && !linkedOrg;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] sm:max-h-[85vh] overflow-y-auto">
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

        <RecordSummaryBar objectType="lead" objectId={lead.id} compact />

        {editing ? (
          <EditLeadForm lead={lead} onSubmit={(d) => updateMutation.mutate(d)} onCancel={() => setEditing(false)} isPending={updateMutation.isPending} />
        ) : (
          <div className="space-y-4 mt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Pipeline Stage</Label>
              </div>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-edit-lead">
                  Edit Lead
                </Button>
              )}
            </div>

            <Select value={lead.status} onValueChange={onUpdateStatus} disabled={!canEdit}>
              <SelectTrigger data-testid="select-lead-stage" className="w-full" disabled={!canEdit}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {lead.status === "converted" && (
              <>
                {orgUnavailable ? (
                  <div className="rounded-lg border border-border/40 bg-muted/30 p-3 flex items-center gap-3" data-testid="banner-promoted-org-unavailable">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground font-medium">Promoted to Organization</p>
                      <p className="text-sm text-muted-foreground italic">Organization unavailable (may have been deleted)</p>
                    </div>
                  </div>
                ) : linkedOrg && onOpenOrg ? (
                  <button
                    onClick={() => onOpenOrg(linkedOrg.id)}
                    className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center gap-3 cursor-pointer transition-colors hover:bg-emerald-500/10 hover:border-emerald-500/50 active:bg-emerald-500/15 text-left"
                    data-testid="button-open-linked-org"
                  >
                    <Building2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-emerald-400 font-medium">Promoted to Organization</p>
                      <p className="text-sm font-semibold truncate">{linkedOrg.name}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px] px-1.5 text-emerald-400 border-emerald-500/30">
                        Org #{linkedOrg.id}
                      </Badge>
                      <ExternalLink className="h-3 w-3 text-emerald-400/60" />
                    </div>
                  </button>
                ) : (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center gap-3" data-testid="banner-promoted-org">
                    <Building2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-emerald-400 font-medium">Promoted to Organization</p>
                      {linkedOrg ? (
                        <p className="text-sm font-semibold truncate">{linkedOrg.name}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Loading linked organization…</p>
                      )}
                    </div>
                    {linkedOrg && (
                      <Badge variant="outline" className="text-[10px] px-1.5 shrink-0 text-emerald-400 border-emerald-500/30">
                        Org #{linkedOrg.id}
                      </Badge>
                    )}
                  </div>
                )}
              </>
            )}

            {(lead.streetAddress || lead.city || lead.state) && (() => {
              const addressParts = [lead.streetAddress, lead.city, lead.state, lead.zipCode, lead.country].filter(Boolean).join(", ");
              const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressParts)}`;
              return (
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-border/50 p-3 cursor-pointer transition-colors hover:border-primary/50 hover:bg-primary/5 active:bg-primary/10"
                  data-testid="link-lead-directions"
                >
                  <Label className="text-xs text-muted-foreground mb-1 block pointer-events-none">Location</Label>
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="text-sm flex-1">
                      {lead.streetAddress && <p className="font-medium">{lead.streetAddress}</p>}
                      <p className="text-muted-foreground">
                        {[lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ")}
                        {lead.country && <span className="ml-1">{lead.country === "CA" ? "Canada" : lead.country === "US" ? "USA" : lead.country}</span>}
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  </div>
                </a>
              );
            })()}

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

            {(lead.dealAmount || lead.dealProbability || lead.primaryValueDriver || lead.estimatedPedestalCount) && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <Label className="text-xs text-emerald-400 mb-2 block flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Deal Information
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {lead.dealAmount != null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Amount</p>
                      <p className="text-lg font-semibold text-emerald-400">${Number(lead.dealAmount).toLocaleString()}</p>
                    </div>
                  )}
                  {lead.dealProbability != null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Probability</p>
                      <p className="text-sm font-medium">{lead.dealProbability}%</p>
                    </div>
                  )}
                  {lead.primaryValueDriver && (
                    <div>
                      <p className="text-xs text-muted-foreground">Value Driver</p>
                      <p className="text-sm font-medium">{lead.primaryValueDriver}</p>
                    </div>
                  )}
                  {lead.estCloseDate && (
                    <div>
                      <p className="text-xs text-muted-foreground">Est. Close</p>
                      <p className="text-sm font-medium">{new Date(lead.estCloseDate).toLocaleDateString()}</p>
                    </div>
                  )}
                </div>
                {(lead.dealValueHardware || lead.dealValueSoftware || lead.dealValueServices) && (
                  <div className="grid grid-cols-3 gap-3 mt-2 pt-2 border-t border-emerald-500/10">
                    <div><p className="text-xs text-muted-foreground">Hardware</p><p className="text-sm font-medium">${Number(lead.dealValueHardware || 0).toLocaleString()}</p></div>
                    <div><p className="text-xs text-muted-foreground">Software</p><p className="text-sm font-medium">${Number(lead.dealValueSoftware || 0).toLocaleString()}</p></div>
                    <div><p className="text-xs text-muted-foreground">Services</p><p className="text-sm font-medium">${Number(lead.dealValueServices || 0).toLocaleString()}</p></div>
                  </div>
                )}
                {(lead.estimatedPedestalCount || lead.estimatedSlipsImpacted) && (
                  <div className="grid grid-cols-2 gap-3 mt-2 pt-2 border-t border-emerald-500/10">
                    {lead.estimatedPedestalCount && <div><p className="text-xs text-muted-foreground">Est. Pedestals</p><p className="text-sm font-medium">{lead.estimatedPedestalCount}</p></div>}
                    {lead.estimatedSlipsImpacted && <div><p className="text-xs text-muted-foreground">Est. Slips Impacted</p><p className="text-sm font-medium">{lead.estimatedSlipsImpacted}</p></div>}
                  </div>
                )}
              </div>
            )}

            {lead.competitors && (
              <div className="rounded-lg border border-border/50 p-3">
                <Label className="text-xs text-muted-foreground mb-1 block">Competitors</Label>
                <p className="text-sm">{lead.competitors}</p>
              </div>
            )}

            {lead.roiStory && (
              <div className="rounded-lg border border-border/50 p-3">
                <Label className="text-xs text-muted-foreground mb-1 block">ROI Story</Label>
                <p className="text-sm whitespace-pre-wrap">{lead.roiStory}</p>
              </div>
            )}

            {lead.closedWonNotes && (
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                <Label className="text-xs text-green-400 mb-1 block">Won Notes</Label>
                <p className="text-sm whitespace-pre-wrap">{lead.closedWonNotes}</p>
              </div>
            )}

            {lead.closedLostReason && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <Label className="text-xs text-red-400 mb-1 block">Lost Reason</Label>
                <p className="text-sm whitespace-pre-wrap">{lead.closedLostReason}</p>
              </div>
            )}

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
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-enrich-lead">
                    Enrich Lead
                  </Button>
                )}
              </div>
            )}

            <div className="rounded-lg border border-border/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-muted-foreground">Assigned To</Label>
                <CreateActionItem objectType="lead" objectId={lead.id} objectLabel={lead.company} />
              </div>
              <AssignUserSelect
                value={lead.ownerUserId}
                onValueChange={(userId) => updateMutation.mutate({ ownerUserId: userId })}
                testId="select-lead-owner"
              />
            </div>

            <div className="border-t border-border/50 pt-4">
              <AttachmentsSection objectType="lead" objectId={lead.id} />
            </div>

            <div className="border-t border-border/50 pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Emails</p>
              <EmailsTab objectType="lead" objectId={lead.id} />
            </div>

            <div className="border-t border-border/50 pt-4">
              <CommentsFeed objectType="lead" objectId={lead.id} />
            </div>

            <div className="flex gap-2 justify-end pt-4 border-t border-border/50">
              {canEdit && lead.status === "converted" ? (
                <Button variant="outline" onClick={onUnconvert} disabled={isUnconverting} data-testid="button-unconvert-detail" title="Revert lead status — Organization is preserved">
                  <Undo2 className="mr-2 h-4 w-4" /> Revert Lead Status
                </Button>
              ) : canEdit && lead.status !== "lost" ? (
                <Button variant="outline" onClick={onConvert} disabled={isConverting} data-testid="button-convert-detail">
                  <ArrowRightLeft className="mr-2 h-4 w-4" /> Promote to Organization
                </Button>
              ) : null}
              {canEdit && <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting} data-testid="button-delete-lead">
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>}
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
    dealAmount: lead.dealAmount != null ? String(lead.dealAmount) : "",
    dealProbability: lead.dealProbability != null ? String(lead.dealProbability) : "",
    dealValueHardware: lead.dealValueHardware != null ? String(lead.dealValueHardware) : "",
    dealValueSoftware: lead.dealValueSoftware != null ? String(lead.dealValueSoftware) : "",
    dealValueServices: lead.dealValueServices != null ? String(lead.dealValueServices) : "",
    primaryValueDriver: lead.primaryValueDriver || "",
    estimatedPedestalCount: lead.estimatedPedestalCount != null ? String(lead.estimatedPedestalCount) : "",
    estimatedSlipsImpacted: lead.estimatedSlipsImpacted != null ? String(lead.estimatedSlipsImpacted) : "",
    estCloseDate: lead.estCloseDate ? new Date(lead.estCloseDate).toISOString().split("T")[0] : "",
    competitors: lead.competitors || "",
    roiStory: lead.roiStory || "",
    closedLostReason: lead.closedLostReason || "",
    closedWonNotes: lead.closedWonNotes || "",
  });

  const formRegions = form.country ? getRegionsForCountry(form.country) : [];

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSubmit({
        ...form,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        estCloseDate: form.estCloseDate ? new Date(form.estCloseDate).toISOString() : null,
        contactName: form.contactName || "Marina Contact",
        dealAmount: form.dealAmount ? Number(form.dealAmount) : null,
        dealProbability: form.dealProbability ? Number(form.dealProbability) : null,
        dealValueHardware: form.dealValueHardware ? Number(form.dealValueHardware) : null,
        dealValueSoftware: form.dealValueSoftware ? Number(form.dealValueSoftware) : null,
        dealValueServices: form.dealValueServices ? Number(form.dealValueServices) : null,
        estimatedPedestalCount: form.estimatedPedestalCount ? Number(form.estimatedPedestalCount) : null,
        estimatedSlipsImpacted: form.estimatedSlipsImpacted ? Number(form.estimatedSlipsImpacted) : null,
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
          <div><Label className="text-xs">Due Date</Label><DatePicker value={form.dueDate} onChange={(v) => setForm(f => ({ ...f, dueDate: v }))} data-testid="input-edit-due-date" /></div>
        </div>
        <div className="mt-3"><Label className="text-xs">Tags</Label><Input value={form.tags} onChange={(e) => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="Comma-separated tags" data-testid="input-edit-tags" /></div>
        <div className="mt-3"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Meeting notes, observations, key details..." data-testid="input-edit-notes" /></div>
      </div>

      <div className="border-t border-border/50 pt-3">
        <Label className="text-xs text-emerald-400 mb-2 block flex items-center gap-1"><DollarSign className="h-3 w-3" /> Deal / Financial</Label>
        <div className="grid grid-cols-3 gap-3">
          <div><Label className="text-xs">Deal Amount ($)</Label><Input type="number" value={form.dealAmount} onChange={(e) => setForm(f => ({ ...f, dealAmount: e.target.value }))} placeholder="0" data-testid="input-edit-deal-amount" /></div>
          <div><Label className="text-xs">Probability (%)</Label><Input type="number" min="0" max="100" value={form.dealProbability} onChange={(e) => setForm(f => ({ ...f, dealProbability: e.target.value }))} placeholder="0-100" data-testid="input-edit-deal-probability" /></div>
          <div><Label className="text-xs">Est. Close Date</Label><DatePicker value={form.estCloseDate} onChange={(v) => setForm(f => ({ ...f, estCloseDate: v }))} data-testid="input-edit-est-close" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div><Label className="text-xs">Hardware ($)</Label><Input type="number" value={form.dealValueHardware} onChange={(e) => setForm(f => ({ ...f, dealValueHardware: e.target.value }))} placeholder="0" data-testid="input-edit-deal-hardware" /></div>
          <div><Label className="text-xs">Software ($)</Label><Input type="number" value={form.dealValueSoftware} onChange={(e) => setForm(f => ({ ...f, dealValueSoftware: e.target.value }))} placeholder="0" data-testid="input-edit-deal-software" /></div>
          <div><Label className="text-xs">Services ($)</Label><Input type="number" value={form.dealValueServices} onChange={(e) => setForm(f => ({ ...f, dealValueServices: e.target.value }))} placeholder="0" data-testid="input-edit-deal-services" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <Label className="text-xs">Primary Value Driver</Label>
            <Select value={form.primaryValueDriver || "none"} onValueChange={(v) => setForm(f => ({ ...f, primaryValueDriver: v === "none" ? "" : v }))}>
              <SelectTrigger data-testid="select-edit-value-driver"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select...</SelectItem>
                <SelectItem value="safety">Safety & Compliance</SelectItem>
                <SelectItem value="revenue">Revenue Generation</SelectItem>
                <SelectItem value="cost_savings">Cost Savings</SelectItem>
                <SelectItem value="modernization">Infrastructure Modernization</SelectItem>
                <SelectItem value="sustainability">Sustainability / Green</SelectItem>
                <SelectItem value="customer_experience">Customer Experience</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Est. Pedestals</Label><Input type="number" value={form.estimatedPedestalCount} onChange={(e) => setForm(f => ({ ...f, estimatedPedestalCount: e.target.value }))} data-testid="input-edit-pedestal-count" /></div>
            <div><Label className="text-xs">Est. Slips</Label><Input type="number" value={form.estimatedSlipsImpacted} onChange={(e) => setForm(f => ({ ...f, estimatedSlipsImpacted: e.target.value }))} data-testid="input-edit-slips-impacted" /></div>
          </div>
        </div>
        <div className="mt-3"><Label className="text-xs">Competitors</Label><Input value={form.competitors} onChange={(e) => setForm(f => ({ ...f, competitors: e.target.value }))} placeholder="Competing vendors or solutions" data-testid="input-edit-competitors" /></div>
        <div className="mt-3"><Label className="text-xs">ROI Story</Label><Textarea value={form.roiStory} onChange={(e) => setForm(f => ({ ...f, roiStory: e.target.value }))} rows={2} placeholder="How does VoltSafe create value for this marina?" data-testid="input-edit-roi-story" /></div>
        {lead.status === "converted" && (
          <div className="mt-3"><Label className="text-xs">Won Notes</Label><Textarea value={form.closedWonNotes} onChange={(e) => setForm(f => ({ ...f, closedWonNotes: e.target.value }))} rows={2} data-testid="input-edit-won-notes" /></div>
        )}
        {lead.status === "lost" && (
          <div className="mt-3"><Label className="text-xs">Lost Reason</Label><Textarea value={form.closedLostReason} onChange={(e) => setForm(f => ({ ...f, closedLostReason: e.target.value }))} rows={2} data-testid="input-edit-lost-reason" /></div>
        )}
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
          <Label>{form.country === "CA" ? "Province / Territory" : form.country === "MX" ? "State (Mexico)" : "State"}</Label>
          {formRegions.length > 0 ? (
            <Select value={form.state || "none"} onValueChange={(v) => setForm(f => ({ ...f, state: v === "none" ? "" : v }))}>
              <SelectTrigger data-testid="select-state">
                <SelectValue placeholder={form.country === "CA" ? "Select province" : form.country === "MX" ? "Select state" : "Select state"} />
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
