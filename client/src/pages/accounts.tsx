import { useState, useRef, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ExpandableDialogContent } from "@/components/ui/expandable-dialog-content";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Building2, Users, Loader2, Phone, Mail, Trash2,
  ArrowUpDown, MapPin, Globe, Zap, Star, AlertTriangle, Calendar,
  Settings2, Wrench, Shield, Wifi, LinkIcon, List, LayoutGrid, Map, FolderPlus, ArrowRightLeft, ExternalLink,
  ChevronDown, ChevronRight, Clock, Bookmark, X as XIcon, UserCheck, ClipboardList,
  Briefcase, LifeBuoy, History as HistoryIcon, MessageSquare, FileText,
} from "lucide-react";
import type { SavedView } from "@shared/schema";
import { BulkActionsBar, BulkCheckbox } from "@/components/bulk-actions-bar";
import { ExportButton } from "@/components/ui/export-button";
import { NotesPanel } from "@/components/notes-panel";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { escapeHtml } from "@/lib/sanitize-html";
import { CommentsFeed } from "@/components/comments-feed";
import { AttachmentsSection } from "@/components/attachments-section";
import { AssignUserSelect } from "@/components/assign-user-select";
import { CreateActionItem } from "@/components/create-action-item";
import type { Account, Contact, Opportunity, Ticket, InfrastructureProfile, Lead } from "@shared/schema";
import { AiSummaryCard } from "@/components/crm/ai-summary-card";
import { EmailsTab } from "@/components/emails-tab";
import { TimelineTab } from "@/components/timeline-tab";
import StateProvinceSelect from "@/components/state-province-select";
import { ContactsPanel } from "@/components/contacts/contacts-panel";
import { PIPELINE_STAGE_OPTIONS, MARKET_SEGMENT_OPTIONS, SLIP_RANGE_OPTIONS, NON_OPERATING_SEGMENTS, FILTER_INDUSTRY_OPTIONS, FILTER_SEGMENT_OPTIONS, FILTER_TYPE_OPTIONS, FILTER_COUNTRY_OPTIONS, FILTER_PRIORITY_OPTIONS, FILTER_SORT_OPTIONS, getRegionsForCountry } from "@/lib/crm-taxonomy";

const segmentColors: Record<string, string> = {
  marina: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  corp: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  partner: "bg-green-500/10 text-green-500 border-green-500/20",
  other: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

const PIPELINE_STAGES = PIPELINE_STAGE_OPTIONS;

const statusColors: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map(s => [s.value, s.color])
);

function getStageLabel(value: string) {
  return PIPELINE_STAGES.find(s => s.value === value)?.label || value;
}

const priorityColors: Record<string, string> = {
  low: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  high: "bg-red-500/10 text-red-500 border-red-500/20",
};

const LEGACY_ORG_TYPE_OPTIONS = [
  { value: "marina_prospect", label: "Marina Prospect" },
  { value: "marina_customer", label: "Marina Customer" },
  { value: "pilot_site", label: "Pilot Site" },
  { value: "marina_group", label: "Marina Group" },
  { value: "port_harbor", label: "Port / Harbor" },
  { value: "government", label: "Government" },
  { value: "utility", label: "Utility" },
  { value: "distributor", label: "Distributor" },
  { value: "installer", label: "Installer" },
  { value: "manufacturer", label: "Manufacturer" },
  { value: "association", label: "Association" },
  { value: "research", label: "Research" },
  { value: "media", label: "Media" },
  { value: "investor", label: "Investor" },
  { value: "other", label: "Other" },
];

const MARINA_ORG_TYPES = new Set(["marina_prospect", "marina_customer", "pilot_site", "marina_group", "port_harbor"]);

const orgTypeColors: Record<string, string> = {
  marina_prospect: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  marina_customer: "bg-green-500/10 text-green-400 border-green-500/20",
  pilot_site: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  marina_group: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  port_harbor: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  government: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  utility: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  distributor: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  installer: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  manufacturer: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  association: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  research: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20",
  media: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  investor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  other: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

function getOrgTypeLabel(value: string | null | undefined) {
  return LEGACY_ORG_TYPE_OPTIONS.find(o => o.value === value)?.label || value || "—";
}

export default function AccountsPage({ canEdit = true }: { canEdit?: boolean }) {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState("__all__");
  const [marketSegmentFilter, setMarketSegmentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const regionOptions = countryFilter !== "all" ? getRegionsForCountry(countryFilter) : [];
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [view, setView] = useState<"list" | "pipeline" | "map">("list");
  const { toast } = useToast();
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const [sortOption, setSortOption] = useState("default");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const [saveViewIsShared, setSaveViewIsShared] = useState(false);
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const toggleSelect = (id: number) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selectedId = params.get("selected");
    if (selectedId) {
      fetch(`/api/accounts/${selectedId}`).then(r => r.ok ? r.json() : null).then(account => {
        if (account) setSelectedAccount(account);
      });
      window.history.replaceState({}, "", "/accounts");
    }
  }, []);

  const PAGE_SIZE = 100;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<{ data: Account[]; total: number; page: number; totalPages: number }>({
    queryKey: ["/api/accounts", { search, industry: industryFilter === "__all__" ? "" : industryFilter, marketSegment: marketSegmentFilter === "all" ? "" : marketSegmentFilter, type: typeFilter === "all" ? "" : typeFilter, country: countryFilter === "all" ? "" : countryFilter, state: regionFilter === "all" ? "" : regionFilter, priority: priorityFilter === "all" ? "" : priorityFilter, sort: sortOption }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (marketSegmentFilter !== "all") params.set("marketSegment", marketSegmentFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (countryFilter !== "all") params.set("country", countryFilter);
      if (regionFilter !== "all") params.set("state", regionFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      if (sortOption !== "default") { const [key, order] = sortOption.split(":"); params.set("sortBy", key); params.set("sortOrder", order); }
      params.set("page", String(pageParam));
      params.set("limit", String(PAGE_SIZE));
      const res = await fetch(`/api/accounts?${params}`, { credentials: "include" });
      return res.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });

  const allAccounts = data?.pages.flatMap(p => p.data ?? []).filter(Boolean) || [];
  const totalCount = data?.pages[0]?.total || 0;

  const { data: savedViews } = useQuery<SavedView[]>({
    queryKey: ["/api/saved-views", "accounts"],
    queryFn: async () => {
      const res = await fetch("/api/saved-views?pageKey=accounts", { credentials: "include" });
      return res.json();
    },
  });

  const currentFiltersJson = JSON.stringify({
    industry: industryFilter, marketSegment: marketSegmentFilter, type: typeFilter,
    country: countryFilter, state: regionFilter, priority: priorityFilter, sort: sortOption,
  });

  const isFiltered = industryFilter !== "__all__" || marketSegmentFilter !== "all" || typeFilter !== "all"
    || countryFilter !== "all" || regionFilter !== "all" || priorityFilter !== "all" || sortOption !== "default" || search !== "";

  const resetFilters = () => {
    setSearch("");
    setIndustryFilter("__all__");
    setMarketSegmentFilter("all");
    setTypeFilter("all");
    setCountryFilter("all");
    setRegionFilter("all");
    setPriorityFilter("all");
    setSortOption("default");
    setActiveViewId(null);
  };

  const activeViewFiltersJson = savedViews?.find(sv => sv.id === activeViewId)?.filtersJson ?? null;
  const activeViewDirty = activeViewId !== null && activeViewFiltersJson !== currentFiltersJson;

  const saveViewMutation = useMutation({
    mutationFn: async ({ name, isShared }: { name: string; isShared: boolean }) => {
      const res = await apiRequest("POST", "/api/saved-views", {
        name,
        pageKey: "accounts",
        filtersJson: currentFiltersJson,
        isShared,
      });
      return res.json();
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", "accounts"] });
      setSaveViewName("");
      setSaveViewOpen(false);
      setSaveViewIsShared(false);
      setActiveViewId(created?.id ?? null);
      toast({ title: "View saved", description: `"${created?.name}" is now available` });
    },
  });

  const updateViewMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PUT", `/api/saved-views/${id}`, { filtersJson: currentFiltersJson });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", "accounts"] });
      toast({ title: "View updated" });
    },
  });

  const deleteViewMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/saved-views/${id}`); },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", "accounts"] });
      if (activeViewId === id) setActiveViewId(null);
    },
  });

  const loadSavedView = (sv: SavedView) => {
    const f = sv.filtersJson ? JSON.parse(sv.filtersJson) : {};
    setIndustryFilter(f.industry ?? "__all__");
    setMarketSegmentFilter(f.marketSegment ?? "all");
    setTypeFilter(f.type ?? "all");
    setCountryFilter(f.country ?? "all");
    setRegionFilter(f.state ?? "all");
    setPriorityFilter(f.priority ?? "all");
    setSortOption(f.sort ?? "default");
    setActiveViewId(sv.id);
  };

  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage(); },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/accounts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setCreateOpen(false);
      toast({ title: "Account created" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, leadStatus }: { id: number; leadStatus: string }) => {
      const res = await apiRequest("PUT", `/api/accounts/${id}`, { leadStatus });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account stage updated" });
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async (ownerUserId: number) => {
      const res = await apiRequest("POST", "/api/accounts/bulk/assign", { accountIds: Array.from(selectedIds), ownerUserId });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (d) => { queryClient.invalidateQueries({ queryKey: ["/api/accounts"] }); setSelectedIds(new Set()); toast({ title: `Assigned ${d.updated} accounts` }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const bulkTaskMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounts/bulk/task", { accountIds: Array.from(selectedIds), title: "Follow up on account" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (d) => { setSelectedIds(new Set()); toast({ title: `Created ${d.created} tasks` }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/accounts/${id}`);
      if (!res.ok) throw new Error((await res.json()).message || "Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account deleted" });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const [deletingId, setDeletingId] = useState<number | null>(null);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Accounts</h1>
            <p className="text-muted-foreground mt-1 text-sm">Manage marina accounts and prospects.</p>
          </div>
          <div className="flex items-center border border-border/50 rounded-xl overflow-hidden">
            <Button variant={view === "list" ? "secondary" : "ghost"} size="default" onClick={() => setView("list")} className="rounded-none px-3" data-testid="button-list-view"><List className="h-5 w-5" /></Button>
            <Button variant={view === "pipeline" ? "secondary" : "ghost"} size="default" onClick={() => setView("pipeline")} className="rounded-none px-3" data-testid="button-pipeline-view"><LayoutGrid className="h-5 w-5" /></Button>
            <Button variant={view === "map" ? "secondary" : "ghost"} size="default" onClick={() => setView("map")} className="rounded-none px-3" data-testid="button-map-view"><Map className="h-5 w-5" /></Button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            endpoint={`/api/accounts/export?${new URLSearchParams({
              ...(search ? { search } : {}),
              ...(marketSegmentFilter !== "all" ? { marketSegment: marketSegmentFilter } : {}),
              ...(typeFilter !== "all" ? { type: typeFilter } : {}),
              ...(countryFilter !== "all" ? { country: countryFilter } : {}),
              ...(regionFilter !== "all" ? { state: regionFilter } : {}),
              ...(priorityFilter !== "all" ? { priority: priorityFilter } : {}),
            }).toString()}`}
            filename="accounts_export.csv"
          />
          {canEdit && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground" data-testid="button-create-account">
                  <Plus className="mr-2 h-4 w-4" /> New Account
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Create Account</DialogTitle></DialogHeader>
                <CreateAccountForm onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Search + Filters */}
      <div className="space-y-2">
        {/* Search row + mobile filter toggle */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search organizations..." value={search} onChange={(e) => { setSearch(e.target.value); }} className="pl-10" data-testid="input-search-accounts" />
          </div>
          <button
            onClick={() => setShowMobileFilters(v => !v)}
            data-testid="button-toggle-filters"
            className={`sm:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors min-h-[44px] ${showMobileFilters ? "bg-primary/10 border-primary/30 text-primary" : isFiltered ? "bg-secondary border-primary/40 text-foreground" : "bg-secondary/50 border-border/50 text-muted-foreground"}`}
          >
            <Settings2 className="h-4 w-4" />
            {isFiltered ? (
              <span className="text-xs font-bold text-primary">{[industryFilter !== "__all__" ? 1 : 0, marketSegmentFilter !== "all" ? 1 : 0, typeFilter !== "all" ? 1 : 0, countryFilter !== "all" ? 1 : 0, regionFilter !== "all" ? 1 : 0, priorityFilter !== "all" ? 1 : 0].reduce((a, b) => a + b, 0) + (sortOption !== "default" ? 1 : 0)}</span>
            ) : null}
          </button>
        </div>

        {/* Filter selects — always visible on sm+, toggled on mobile */}
        <div className={`${showMobileFilters ? "flex" : "hidden"} sm:flex gap-2 sm:gap-3 flex-wrap`}>
        {/* 1 — Industry */}
        <Select value={industryFilter} onValueChange={setIndustryFilter}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-44" data-testid="select-industry-filter">
            {industryFilter === "__all__" ? <span>Marine</span> : <SelectValue />}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Industries</SelectItem>
            {FILTER_INDUSTRY_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* 2 — Segment */}
        <Select value={marketSegmentFilter} onValueChange={(v) => { setMarketSegmentFilter(v); }}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-44" data-testid="select-market-segment-filter">
            {marketSegmentFilter === "all" ? <span>Marina</span> : <SelectValue />}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Segments</SelectItem>
            {FILTER_SEGMENT_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* 3 — Type */}
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); }}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-40" data-testid="select-type-filter">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {FILTER_TYPE_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* 4 — Country */}
        <Select value={countryFilter} onValueChange={(v) => { setCountryFilter(v); setRegionFilter("all"); }}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-40" data-testid="select-country-filter">
            <SelectValue placeholder="Country" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Countries</SelectItem>
            {FILTER_COUNTRY_OPTIONS.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* 5 — Region */}
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-48" data-testid="select-state-filter">
            <SelectValue placeholder={countryFilter === "CA" ? "Province" : "State / Region"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{countryFilter === "CA" ? "All Provinces" : countryFilter === "US" ? "All States" : "All Regions"}</SelectItem>
            {regionOptions.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* 6 — Priority */}
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-32" data-testid="select-priority-filter">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            {FILTER_PRIORITY_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* 7 — Sort */}
        <Select value={sortOption} onValueChange={setSortOption}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-44" data-testid="select-sort">
            <ArrowUpDown className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            {FILTER_SORT_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        </div>
      </div>

      {/* Saved Views Row */}
      <div className="flex items-center gap-2 flex-wrap min-h-[28px]">
        {savedViews?.map(sv => {
          const isActive = sv.id === activeViewId;
          return (
            <div
              key={sv.id}
              className={`flex items-center gap-1 border rounded-full pl-3 pr-2 py-1 text-xs group transition-all ${
                isActive
                  ? "bg-primary/10 border-primary/50 text-primary"
                  : "bg-secondary/50 border-border/50 hover:border-primary/40"
              }`}
            >
              <button
                onClick={() => loadSavedView(sv)}
                className={`font-medium transition-colors ${isActive ? "text-primary" : "hover:text-primary"}`}
                data-testid={`saved-view-${sv.id}`}
              >
                {sv.name}
                {sv.isShared && <span className="ml-1 text-[9px] opacity-60">shared</span>}
              </button>
              {isActive && activeViewDirty && (
                <button
                  onClick={() => updateViewMutation.mutate(sv.id)}
                  className="ml-0.5 text-primary/70 hover:text-primary text-[9px] font-semibold uppercase tracking-wide transition-colors border border-primary/30 rounded-full px-1.5 py-0.5"
                  title="Update this view with current filters"
                  data-testid={`update-view-${sv.id}`}
                >
                  update
                </button>
              )}
              <button
                onClick={() => deleteViewMutation.mutate(sv.id)}
                className={`ml-0.5 hover:text-destructive opacity-0 group-hover:opacity-100 transition-all ${isActive ? "text-primary/60" : "text-muted-foreground"}`}
                data-testid={`delete-view-${sv.id}`}
              >
                <XIcon className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        {/* Save view inline form */}
        {saveViewOpen ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Input
              value={saveViewName}
              onChange={e => setSaveViewName(e.target.value)}
              placeholder="View name..."
              className="h-7 text-xs w-36 rounded-full"
              onKeyDown={e => {
                if (e.key === "Enter" && saveViewName.trim()) saveViewMutation.mutate({ name: saveViewName.trim(), isShared: saveViewIsShared });
                if (e.key === "Escape") { setSaveViewOpen(false); setSaveViewName(""); setSaveViewIsShared(false); }
              }}
              autoFocus
              data-testid="input-save-view-name"
            />
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={saveViewIsShared}
                onChange={e => setSaveViewIsShared(e.target.checked)}
                className="h-3 w-3 accent-primary"
                data-testid="checkbox-save-view-shared"
              />
              Shared
            </label>
            <Button
              size="sm"
              className="h-7 text-xs px-3 rounded-full"
              disabled={!saveViewName.trim() || saveViewMutation.isPending}
              onClick={() => saveViewMutation.mutate({ name: saveViewName.trim(), isShared: saveViewIsShared })}
              data-testid="button-confirm-save-view"
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2 rounded-full"
              onClick={() => { setSaveViewOpen(false); setSaveViewName(""); setSaveViewIsShared(false); }}
            >
              <XIcon className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSaveViewOpen(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border/50 rounded-full px-3 py-1 hover:border-primary/50 transition-colors"
              data-testid="button-save-view"
            >
              <Bookmark className="h-3 w-3" />
              Save view
            </button>
            {isFiltered && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                title="Clear all filters"
                data-testid="button-reset-filters"
              >
                <XIcon className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>
        )}
      </div>

      {selectedIds.size > 0 && (
        <BulkActionsBar
          selectedCount={selectedIds.size}
          totalCount={allAccounts.length}
          onSelectAll={() => setSelectedIds(new Set(allAccounts.map(a => a.id)))}
          onClearSelection={() => setSelectedIds(new Set())}
          entityLabel="account"
          actions={[
            {
              key: "assign",
              label: "Assign Owner",
              icon: <UserCheck className="h-3.5 w-3.5" />,
              testId: "button-bulk-accounts-assign",
              confirmText: (count) => `Assign ${count} account${count !== 1 ? "s" : ""} to a new owner`,
              requiresPermission: true,
              isPending: bulkAssignMutation.isPending,
              onClick: async () => { await bulkAssignMutation.mutateAsync(4); },
            },
            {
              key: "task",
              label: "Create Task",
              icon: <ClipboardList className="h-3.5 w-3.5" />,
              testId: "button-bulk-accounts-task",
              confirmText: (count) => `Create follow-up tasks for ${count} account${count !== 1 ? "s" : ""}`,
              requiresPermission: true,
              isPending: bulkTaskMutation.isPending,
              onClick: async () => { await bulkTaskMutation.mutateAsync(); },
            },
          ]}
        />
      )}

      {view === "map" ? (
        <AccountsMapView accounts={allAccounts} onSelect={setSelectedAccount} />
      ) : view === "pipeline" ? (
        isLoading ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="flex-shrink-0 w-72 h-96" />)}
          </div>
        ) : (
          <AccountsPipelineView
            accounts={allAccounts}
            onSelect={setSelectedAccount}
            onUpdateStatus={(id, leadStatus) => updateStatusMutation.mutate({ id, leadStatus })}
          />
        )
      ) : (
        <>
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {allAccounts.map((account) => (
                <Card key={account.id} className={`border-border/50 hover:border-primary/30 cursor-pointer transition-colors ${selectedIds.has(account.id) ? "border-primary/50 bg-primary/5" : ""}`} data-testid={`card-account-${account.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex items-start gap-1.5 shrink-0">
                          <div className="pt-0.5" onClick={e => { e.stopPropagation(); toggleSelect(account.id); }}>
                            <BulkCheckbox checked={selectedIds.has(account.id)} onChange={() => toggleSelect(account.id)} testId={`checkbox-account-${account.id}`} />
                          </div>
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center" onClick={() => setSelectedAccount(account)}>
                            <Building2 className="w-5 h-5 text-primary" />
                          </div>
                        </div>
                        <div onClick={() => setSelectedAccount(account)}>
                          <CardTitle className="text-base">{account.name}</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {[account.city, account.stateProvince, account.country].filter(Boolean).join(", ") || account.region || "No location"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1" onClick={() => setSelectedAccount(account)}>
                        <Badge variant="outline" className={segmentColors[account.segment] || ""}>{account.segment}</Badge>
                        <Badge variant="outline" className={priorityColors[account.priority] || ""}>{account.priority}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <Badge variant="outline" className={statusColors[account.leadStatus] || ""}>{getStageLabel(account.leadStatus)}</Badge>
                      <div className="flex items-center gap-3">
                        {account.slipCount && <span>{account.slipCount} slips</span>}
                        {account.pilotCandidateScore && (
                          <span className="flex items-center gap-0.5">
                            <Star className="h-3 w-3 text-yellow-500" />
                            {account.pilotCandidateScore}/5
                          </span>
                        )}
                      </div>
                    </div>
                    {account.orgType && (
                      <div className="mt-2">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${orgTypeColors[account.orgType] || orgTypeColors.other}`} data-testid={`badge-org-type-${account.id}`}>{getOrgTypeLabel(account.orgType)}</Badge>
                      </div>
                    )}
                    {account.nextAction && (
                      <p className="text-xs text-muted-foreground mt-2 truncate">
                        Next: {account.nextAction}
                      </p>
                    )}
                    <div className="mt-3 pt-2 border-t border-border/30 flex items-center justify-between">
                      {canEdit && (
                        <div onClick={e => e.stopPropagation()}>
                          {deletingId === account.id ? (
                            <span className="flex items-center gap-1.5 text-xs">
                              <span className="text-red-400 font-medium">Delete?</span>
                              <button
                                onClick={() => { deleteAccountMutation.mutate(account.id); setDeletingId(null); }}
                                className="text-red-400 hover:text-red-300 underline"
                                data-testid={`button-confirm-delete-card-${account.id}`}
                              >Yes</button>
                              <button onClick={() => setDeletingId(null)} className="text-muted-foreground hover:text-foreground underline">No</button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setDeletingId(account.id)}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 transition-colors"
                              data-testid={`button-delete-card-${account.id}`}
                            >
                              <Trash2 className="h-3 w-3" /> Delete
                            </button>
                          )}
                        </div>
                      )}
                      <Link href={`/accounts/${account.id}`}>
                        <div onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer" data-testid={`link-account-profile-${account.id}`}>
                          View Profile <ChevronRight className="h-3 w-3" />
                        </div>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {allAccounts.length === 0 && !isLoading && (
                <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                  <Building2 className="w-12 h-12 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground font-medium">No organizations found</p>
                  <p className="text-muted-foreground/60 text-sm mt-1">
                    {isFiltered ? "Try adjusting your filters or " : "Add your first organization or "}
                    {isFiltered && (
                      <button onClick={resetFilters} className="underline hover:text-foreground transition-colors">clear filters</button>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-between py-2">
            <p className="text-sm text-muted-foreground">{allAccounts.length.toLocaleString()} of {totalCount.toLocaleString()} organizations loaded</p>
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading more...</div>
            )}
          </div>
          <div ref={scrollSentinelRef} className="h-4" />
        </>
      )}

      {selectedAccount && (
        <AccountDetailDialog
          account={selectedAccount}
          onClose={() => setSelectedAccount(null)}
          canEdit={canEdit}
          onOpenLead={(leadId) => {
            setSelectedAccount(null);
            setLocation(`/opportunities/${leadId}`);
          }}
        />
      )}
    </div>
  );
}

const ACCOUNTS_KANBAN_COLORS: Record<string, { columnColor: string; hoverColor: string }> = {
  new:               { columnColor: "border-t-slate-500",   hoverColor: "bg-slate-500/5 border-slate-500/30" },
  contacted:         { columnColor: "border-t-blue-500",    hoverColor: "bg-blue-500/5 border-blue-500/30" },
  meeting_scheduled: { columnColor: "border-t-purple-500",  hoverColor: "bg-purple-500/5 border-purple-500/30" },
  qualified:         { columnColor: "border-t-cyan-500",    hoverColor: "bg-cyan-500/5 border-cyan-500/30" },
  proposal_sent:     { columnColor: "border-t-amber-500",   hoverColor: "bg-amber-500/5 border-amber-500/30" },
  negotiation:       { columnColor: "border-t-orange-500",  hoverColor: "bg-orange-500/5 border-orange-500/30" },
  converted:         { columnColor: "border-t-emerald-500", hoverColor: "bg-emerald-500/5 border-emerald-500/30" },
  lost:              { columnColor: "border-t-red-500",     hoverColor: "bg-red-500/5 border-red-500/30" },
};

const ACCOUNTS_PIPELINE_STAGES = PIPELINE_STAGE_OPTIONS.map(s => ({
  ...s,
  ...(ACCOUNTS_KANBAN_COLORS[s.value] ?? { columnColor: "border-t-gray-500", hoverColor: "bg-gray-500/5 border-gray-500/30" }),
}));

function AccountsPipelineView({
  accounts,
  onSelect,
  onUpdateStatus,
}: {
  accounts: Account[];
  onSelect: (account: Account) => void;
  onUpdateStatus: (id: number, leadStatus: string) => void;
}) {
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const dragAccountId = useRef<number | null>(null);
  const dragFromStage = useRef<string | null>(null);

  const stageGroups = ACCOUNTS_PIPELINE_STAGES.map(stage => ({
    ...stage,
    accounts: accounts.filter(a => a.leadStatus === stage.value),
  }));

  const handleDragStart = (e: React.DragEvent, account: Account) => {
    dragAccountId.current = account.id;
    dragFromStage.current = account.leadStatus;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(account.id));
  };

  const handleDragOver = (e: React.DragEvent, stageValue: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverStage !== stageValue) setDragOverStage(stageValue);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null);
  };

  const handleDrop = (e: React.DragEvent, stageValue: string) => {
    e.preventDefault();
    setDragOverStage(null);
    if (dragAccountId.current !== null && dragFromStage.current !== stageValue) {
      onUpdateStatus(dragAccountId.current, stageValue);
    }
    dragAccountId.current = null;
    dragFromStage.current = null;
  };

  const handleDragEnd = () => {
    setDragOverStage(null);
    dragAccountId.current = null;
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
              isOver ? `${stage.hoverColor} shadow-lg` : "border-border/50"
            }`}
            onDragOver={(e) => handleDragOver(e, stage.value)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, stage.value)}
          >
            <div className="p-3 border-b border-border/30">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{stage.label}</h3>
                <Badge variant="outline" className="text-xs px-1.5 py-0">{stage.accounts.length}</Badge>
              </div>
            </div>
            <div className="p-2 space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto">
              {isOver && stage.accounts.length === 0 && (
                <div className="border-2 border-dashed border-primary/40 rounded-lg py-6 text-center text-xs text-primary/60">Drop here</div>
              )}
              {!isOver && stage.accounts.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No accounts</p>
              )}
              {stage.accounts.map(account => (
                <div
                  key={account.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, account)}
                  onDragEnd={handleDragEnd}
                  className="p-3 bg-background/80 border border-border/30 rounded-lg cursor-grab active:cursor-grabbing active:opacity-50 active:scale-95 hover:border-primary/30 transition-all select-none"
                  onClick={() => onSelect(account)}
                  data-testid={`pipeline-card-account-${account.id}`}
                >
                  <div className="flex items-start gap-2 mb-1">
                    <Building2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                    <p className="text-sm font-medium leading-tight line-clamp-2">{account.name}</p>
                  </div>
                  {(account.city || account.stateProvince) && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <MapPin className="h-3 w-3" />
                      {[account.city, account.stateProvince].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {account.slipCount && (
                    <p className="text-xs text-muted-foreground mt-0.5">{account.slipCount} slips</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <Badge variant="outline" className={`text-[10px] px-1 py-0 ${segmentColors[account.segment] || ""}`}>{account.segment}</Badge>
                    {account.orgType && (
                      <Badge variant="outline" className={`text-[10px] px-1 py-0 ${orgTypeColors[account.orgType] || orgTypeColors.other}`}>{getOrgTypeLabel(account.orgType)}</Badge>
                    )}
                    {account.pilotCandidateScore && (
                      <span className="text-xs text-yellow-400 flex items-center gap-0.5">
                        <Star className="h-3 w-3" />{account.pilotCandidateScore}/5
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {isOver && stage.accounts.length > 0 && (
                <div className="border-2 border-dashed border-primary/40 rounded-lg py-3 text-center text-xs text-primary/60">Drop here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AccountsMapView({ accounts, onSelect }: { accounts: Account[]; onSelect: (account: Account) => void }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<ReturnType<typeof L.map> | null>(null);
  const accountsWithCoords = accounts.filter(a => a.latitude != null && a.longitude != null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }

    const defaultIcon = L.icon({
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
    });

    const center: [number, number] = accountsWithCoords.length > 0
      ? [accountsWithCoords.reduce((s, a) => s + a.latitude!, 0) / accountsWithCoords.length,
         accountsWithCoords.reduce((s, a) => s + a.longitude!, 0) / accountsWithCoords.length]
      : [39.8283, -98.5795];

    const map = L.map(mapRef.current, { zoomControl: true }).setView(center, accountsWithCoords.length > 0 ? 5 : 4);
    mapInstanceRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(map);

    accountsWithCoords.forEach((account) => {
      const marker = L.marker([account.latitude!, account.longitude!], { icon: defaultIcon }).addTo(map);
      // SECURITY (F-06): account.name / city / stateProvince / country / leadStatus
      // are user-controlled CRM strings. They MUST be HTML-escaped before being
      // interpolated into a Leaflet popup's HTML string sink — otherwise a
      // stored `<img onerror=…>` in any of those fields fires for every viewer.
      const locationLine = [account.city, account.stateProvince, account.country].filter(Boolean).join(", ");
      const slipsLine = account.slipCount
        ? `<span style="font-size:11px">${escapeHtml(account.slipCount)} slips</span><br/>`
        : "";
      marker.bindPopup(`
        <div style="min-width:180px">
          <strong style="font-size:13px">${escapeHtml(account.name)}</strong><br/>
          <span style="font-size:11px;color:#888">${escapeHtml(locationLine)}</span><br/>
          ${slipsLine}
          <span style="font-size:11px;color:#10b981">${escapeHtml(getStageLabel(account.leadStatus))}</span>
        </div>
      `);
      marker.on("click", () => onSelect(account));
    });

    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; } };
  }, [accounts]);

  if (accountsWithCoords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <MapPin className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-muted-foreground">No accounts have location coordinates yet.</p>
        <p className="text-xs text-muted-foreground">Accounts converted from marina leads will appear on the map once coordinates are available.</p>
      </div>
    );
  }

  return (
    <div className="relative rounded-xl overflow-hidden border border-border/50" style={{ height: "calc(100vh - 260px)" }}>
      <div ref={mapRef} className="w-full h-full" />
      <div className="absolute bottom-3 left-3 bg-background/90 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs text-muted-foreground border border-border/50">
        {accountsWithCoords.length} account{accountsWithCoords.length !== 1 ? "s" : ""} on map
      </div>
    </div>
  );
}

function extractDomainFromWebsite(website: string | null | undefined): string {
  if (!website) return "";
  let d = website.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.split("/")[0];
  return d;
}

function CollapsibleSection({ title, icon: Icon, count, defaultOpen = true, testId, children }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number | string;
  defaultOpen?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border/50 bg-card/30" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-3 text-left hover-elevate active-elevate-2 rounded-lg"
        data-testid={testId ? `button-toggle-${testId}` : undefined}
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">{title}</span>
          {count !== undefined && count !== 0 && count !== "" && (
            <span className="text-xs text-muted-foreground">· {count}</span>
          )}
        </div>
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count?: number | string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-3.5 w-3.5 text-primary" />
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {count !== undefined && count !== "" && <span className="text-xs text-muted-foreground">· {count}</span>}
    </div>
  );
}

export function AccountDetailDialog({ account: initialAccount, onClose, canEdit = true, onOpenLead }: { account: Account; onClose: () => void; canEdit?: boolean; onOpenLead?: (leadId: number) => void }) {
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDemote, setConfirmDemote] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [folderDomainInput, setFolderDomainInput] = useState("");

  const { data: freshAccount } = useQuery<Account>({
    queryKey: ["/api/accounts", initialAccount.id],
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${initialAccount.id}`, { credentials: "include" });
      return res.json();
    },
  });
  const account = freshAccount || initialAccount;

  const { data: oppsData } = useQuery<{ data: Opportunity[] }>({
    queryKey: ["/api/opportunities", { accountId: account.id }],
    queryFn: async () => {
      const res = await fetch(`/api/opportunities?accountId=${account.id}`);
      return res.json();
    },
  });

  const { data: ticketsData } = useQuery<{ data: Ticket[] }>({
    queryKey: ["/api/tickets", { accountId: account.id }],
    queryFn: async () => {
      const res = await fetch(`/api/tickets?accountId=${account.id}`);
      return res.json();
    },
  });

  const { data: infraProfile } = useQuery<InfrastructureProfile | null>({
    queryKey: ["/api/accounts", account.id, "infrastructure"],
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${account.id}/infrastructure`, { credentials: "include" });
      return res.json();
    },
  });

  const updateAccountMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/accounts/${account.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setEditMode(false);
      toast({ title: "Account updated" });
    },
  });

  const updateInfraMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/accounts/${account.id}/infrastructure`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", account.id, "infrastructure"] });
      toast({ title: "Infrastructure profile saved" });
    },
  });

  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showRelinkUI, setShowRelinkUI] = useState(false);
  const [relinkSearch, setRelinkSearch] = useState("");
  const [relinkResults, setRelinkResults] = useState<any[]>([]);
  const [relinkSearching, setRelinkSearching] = useState(false);
  const hasSourceLead = Boolean((account as any).convertedFromLeadId);

  const { data: sourceLeadData, isLoading: sourceLeadLoading } = useQuery<{
    lead: Lead | null;
    history: Array<{ id: number; notes: string | null; migratedAt: string }>;
  }>({
    queryKey: ["/api/accounts", account.id, "source-lead"],
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${account.id}/source-lead`, { credentials: "include" });
      return res.json();
    },
    enabled: hasSourceLead,
  });
  const sourceLead = sourceLeadData?.lead ?? null;
  const conversionHistory = sourceLeadData?.history ?? [];

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/accounts/${account.id}`);
      if (!res.ok) throw new Error((await res.json()).message || "Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account deleted" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const demoteMutation = useMutation({
    mutationFn: async () => {
      const leadId = (account as any).convertedFromLeadId;
      if (!leadId) throw new Error("No source lead linked");
      const res = await apiRequest("POST", `/api/leads/${leadId}/unconvert`);
      if (!res.ok) throw new Error((await res.json()).message || "Demote failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Demoted to Lead", description: "The account has been removed from the Accounts list and the lead is active again." });
      onClose();
    },
    onError: (err: any) => toast({ title: "Demote failed", description: err.message, variant: "destructive" }),
  });

  const convertToLeadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/accounts/${account.id}/to-lead`);
      if (!res.ok) throw new Error((await res.json()).message || "Convert failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Converted to Lead", description: "A new lead has been created from this account. It's now hidden from the Accounts list." });
      onClose();
    },
    onError: (err: any) => toast({ title: "Convert failed", description: err.message, variant: "destructive" }),
  });

  const unlinkLeadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/accounts/${account.id}`, { convertedFromLeadId: null });
      if (!res.ok) throw new Error("Failed to unlink lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", account.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", account.id, "source-lead"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setShowRelinkUI(false);
      setRelinkSearch("");
      setRelinkResults([]);
      toast({ title: "Lead link removed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const linkLeadMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const res = await apiRequest("PUT", `/api/accounts/${account.id}`, { convertedFromLeadId: leadId });
      if (!res.ok) throw new Error("Failed to link lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", account.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", account.id, "source-lead"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setShowRelinkUI(false);
      setRelinkSearch("");
      setRelinkResults([]);
      toast({ title: "Lead linked" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  async function searchLeads(q: string) {
    if (!q.trim()) { setRelinkResults([]); return; }
    setRelinkSearching(true);
    try {
      const res = await fetch(`/api/leads?search=${encodeURIComponent(q)}&limit=8`, { credentials: "include" });
      const data = await res.json();
      setRelinkResults(data?.data ?? []);
    } catch { setRelinkResults([]); }
    finally { setRelinkSearching(false); }
  }


  const createFolderFromAccountMutation = useMutation({
    mutationFn: async ({ name, domains }: { name: string; domains: string[] }) => {
      const res = await apiRequest("POST", "/api/mail-folders/from-account", {
        accountId: account.id,
        name,
        domains,
      });
      return res.json();
    },
    onSuccess: (folder) => {
      setShowFolderDialog(false);
      toast({
        title: "Inbox folder created",
        description: `"${folder.name}" is ready in your Gmail inbox. Go to Gmail → Custom Folders to reprocess existing emails.`,
      });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function openFolderDialog() {
    setFolderName(account.name || "");
    const domain = extractDomainFromWebsite(account.website);
    setFolderDomainInput(domain);
    setShowFolderDialog(true);
  }

  return (
    <>
    <Dialog open onOpenChange={onClose}>
      <ExpandableDialogContent popupClassName="max-w-[95vw] sm:max-w-3xl w-full" contentClassName="overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-xl">{account.name}</DialogTitle>
                <Link href={`/accounts/${account.id}`}>
                  <button className="inline-flex items-center gap-1 text-xs rounded-md border border-primary/20 bg-primary/5 text-primary px-2 py-0.5 cursor-pointer transition-colors hover:bg-primary/10 hover:border-primary/40" data-testid="button-view-account-profile">
                    <ExternalLink className="h-3 w-3" /> Intelligence Profile
                  </button>
                </Link>
                {canEdit && !hasSourceLead && !confirmConvert && !confirmDemote && !confirmDelete && (
                  <button
                    onClick={() => setConfirmConvert(true)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-400 px-2 py-0.5 cursor-pointer transition-colors hover:bg-amber-500/20 hover:border-amber-500/50"
                    data-testid="button-convert-to-lead"
                  >
                    <ArrowRightLeft className="h-3 w-3" /> Convert to Lead
                  </button>
                )}
                {confirmConvert && (
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="text-amber-400 font-medium">Create a lead from this org? It will be hidden here until re-promoted.</span>
                    <button
                      onClick={() => convertToLeadMutation.mutate()}
                      disabled={convertToLeadMutation.isPending}
                      className="inline-flex items-center gap-1 text-xs rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-400 px-2 py-0.5 cursor-pointer transition-colors hover:bg-amber-500/25"
                      data-testid="button-confirm-convert"
                    >
                      {convertToLeadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, convert"}
                    </button>
                    <button
                      onClick={() => setConfirmConvert(false)}
                      className="inline-flex items-center gap-1 text-xs rounded-md border border-border/50 bg-secondary/50 px-2 py-0.5 cursor-pointer transition-colors hover:bg-secondary"
                    >
                      Cancel
                    </button>
                  </span>
                )}
                {canEdit && hasSourceLead && sourceLead?.status === "converted" && !confirmDemote && !confirmDelete && !confirmConvert && (
                  <button
                    onClick={() => setConfirmDemote(true)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-400 px-2 py-0.5 cursor-pointer transition-colors hover:bg-amber-500/20 hover:border-amber-500/50"
                    data-testid="button-demote-to-lead"
                  >
                    <ArrowRightLeft className="h-3 w-3" /> Demote to Lead
                  </button>
                )}
                {confirmDemote && (
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="text-amber-400 font-medium">Undo promotion? The org disappears from this list — the lead becomes active again.</span>
                    <button
                      onClick={() => demoteMutation.mutate()}
                      disabled={demoteMutation.isPending}
                      className="inline-flex items-center gap-1 text-xs rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-400 px-2 py-0.5 cursor-pointer transition-colors hover:bg-amber-500/25"
                      data-testid="button-confirm-demote"
                    >
                      {demoteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, demote"}
                    </button>
                    <button
                      onClick={() => setConfirmDemote(false)}
                      className="inline-flex items-center gap-1 text-xs rounded-md border border-border/50 bg-secondary/50 px-2 py-0.5 cursor-pointer transition-colors hover:bg-secondary"
                    >
                      Cancel
                    </button>
                  </span>
                )}
                {canEdit && !confirmDelete && !confirmDemote && (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-red-500/20 bg-red-500/5 text-red-400 px-2 py-0.5 cursor-pointer transition-colors hover:bg-red-500/15 hover:border-red-500/40"
                    data-testid="button-delete-org"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                )}
                {confirmDelete && (
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="text-red-400 font-medium">Delete "{account.name}"?</span>
                    <button
                      onClick={() => deleteAccountMutation.mutate()}
                      disabled={deleteAccountMutation.isPending}
                      className="inline-flex items-center gap-1 text-xs rounded-md border border-red-500/40 bg-red-500/15 text-red-400 px-2 py-0.5 cursor-pointer transition-colors hover:bg-red-500/25"
                      data-testid="button-confirm-delete-org"
                    >
                      {deleteAccountMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, delete"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="inline-flex items-center gap-1 text-xs rounded-md border border-border/50 bg-secondary/50 px-2 py-0.5 cursor-pointer transition-colors hover:bg-secondary"
                    >
                      Cancel
                    </button>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className={segmentColors[account.segment] || ""}>{account.segment}</Badge>
                <Badge variant="outline" className={statusColors[account.leadStatus] || ""}>{getStageLabel(account.leadStatus)}</Badge>
                <Badge variant="outline" className={priorityColors[account.priority] || ""}>{account.priority}</Badge>
                {account.orgType && <Badge variant="outline" className={orgTypeColors[account.orgType] || orgTypeColors.other} data-testid="badge-detail-org-type">{getOrgTypeLabel(account.orgType)}</Badge>}
                {(account as any).convertedFromLeadId && (
                  onOpenLead ? (
                    <button
                      onClick={() => onOpenLead((account as any).convertedFromLeadId)}
                      className="inline-flex items-center gap-1 text-xs rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 px-2 py-0.5 cursor-pointer transition-colors hover:bg-emerald-500/20 hover:border-emerald-500/40"
                      data-testid="button-open-source-lead"
                    >
                      <ArrowRightLeft className="h-3 w-3" />Promoted from Lead #{(account as any).convertedFromLeadId}
                    </button>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1" data-testid="badge-promoted-from-lead">
                      <ArrowRightLeft className="h-3 w-3" />Promoted from Lead #{(account as any).convertedFromLeadId}
                    </Badge>
                  )
                )}
                {account.betaTester && <Badge variant="outline" className="bg-cyan-500/10 text-cyan-500 border-cyan-500/20">Beta Tester</Badge>}
                {account.pilotCandidateScore && (
                  <span className="flex items-center gap-0.5 text-xs text-yellow-500">
                    <Star className="h-3 w-3" /> Pilot Score: {account.pilotCandidateScore}/5
                  </span>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="overview" data-testid="tab-overview" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" />
              <span className="truncate">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="people" data-testid="tab-people" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              <span className="truncate">
                <span className="hidden sm:inline">People &amp; Pipeline</span>
                <span className="sm:hidden">People</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="activity" data-testid="tab-activity" className="gap-1.5">
              <HistoryIcon className="h-3.5 w-3.5" />
              <span className="truncate">Activity</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            {editMode ? (
              <EditAccountForm account={account} onSubmit={(d) => updateAccountMutation.mutate(d)} onCancel={() => setEditMode(false)} isPending={updateAccountMutation.isPending} />
            ) : (
              <>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openFolderDialog}
                    className="text-teal-600 border-teal-500/30 hover:bg-teal-500/10"
                    data-testid="button-create-inbox-folder"
                  >
                    <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
                    Create Inbox Folder
                  </Button>
                  {canEdit && <Button variant="outline" size="sm" onClick={() => setEditMode(true)} data-testid="button-edit-account">Edit</Button>}
                </div>

                {(account.streetAddress || account.city || account.stateProvince) && (
                  <div className="rounded-lg border border-border/50 p-3" data-testid="account-address">
                    <Label className="text-xs text-muted-foreground mb-1 block">Address</Label>
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div className="text-sm">
                        {account.streetAddress && <p className="font-medium">{account.streetAddress}</p>}
                        <p className="text-muted-foreground">
                          {[account.city, account.stateProvince, account.postalZip].filter(Boolean).join(", ")}
                          {account.country && <span className="ml-1">{account.country === "CA" ? "Canada" : account.country === "US" ? "USA" : account.country}</span>}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <DetailField label="Account Type" value={getOrgTypeLabel(account.orgType)} />
                  <DetailField label="Legal Name" value={account.legalName} />
                  <DetailField label="Website" value={account.website} icon={<Globe className="h-3 w-3" />} />
                  <DetailField label="Marina Type" value={account.marinaType} />
                  <DetailField label="Ownership" value={account.ownershipType} />
                  <DetailField label="Parent Company" value={account.parentCompany} />
                  <DetailField label="Region" value={account.region} />
                  <DetailField label="Timezone" value={account.timezone} />
                  <DetailField label="Slip Count" value={account.slipCount?.toString()} />
                  <DetailField label="Slip Mix" value={account.slipMix} />
                  <DetailField label="Avg Boat Size" value={account.avgBoatSizeRange} />
                  <DetailField label="Power Demand" value={account.powerDemandIntensity} icon={<Zap className="h-3 w-3" />} />
                  <DetailField label="Seasonality" value={account.seasonality} />
                  <DetailField label="Lead Source" value={account.leadSource} />
                  <DetailField label="Tags" value={account.tags} />
                </div>

                {account.expansionPlans && (
                  <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                    <Label className="text-xs text-yellow-500 mb-1 block">Expansion Plans</Label>
                    <p className="text-sm">{account.expansionNotes || "Yes – details TBD"}</p>
                  </div>
                )}

                {account.redFlags && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                    <Label className="text-xs text-red-500 mb-1 block flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Red Flags</Label>
                    <p className="text-sm">{account.redFlags}</p>
                  </div>
                )}

                {account.nextAction && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <Label className="text-xs text-primary mb-1 block flex items-center gap-1"><Calendar className="h-3 w-3" /> Next Action</Label>
                    <p className="text-sm font-medium">{account.nextAction}</p>
                    {account.nextActionAt && (
                      <p className="text-xs text-muted-foreground mt-1">Due: {new Date(account.nextActionAt).toLocaleDateString()}</p>
                    )}
                  </div>
                )}

                {(account.notes || account.notesSummary) && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    <p className="text-sm">{account.notesSummary || account.notes}</p>
                  </div>
                )}

                <div className="rounded-lg border border-border/50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs text-muted-foreground">Assigned To</Label>
                    <CreateActionItem objectType="account" objectId={account.id} objectLabel={account.name} />
                  </div>
                  <AssignUserSelect
                    value={account.assignedToUserId}
                    onValueChange={(userId) => updateAccountMutation.mutate({ assignedToUserId: userId })}
                    testId="select-account-owner"
                  />
                </div>

                {(hasSourceLead || (canEdit && !hasSourceLead)) && (
                  <div className="border-t border-emerald-500/20 pt-4" data-testid="section-source-lead">
                    <div className="flex items-center gap-2 mb-3">
                      <button
                        onClick={() => setSourcePanelOpen(o => !o)}
                        className="flex items-center gap-2 flex-1 text-left"
                        data-testid="button-toggle-source-lead"
                      >
                        {sourcePanelOpen
                          ? <ChevronDown className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          : <ChevronRight className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                        <ArrowRightLeft className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Source Lead</span>
                        {hasSourceLead && <span className="text-xs text-muted-foreground">· Lead #{(account as any).convertedFromLeadId}</span>}
                        {!hasSourceLead && <span className="text-xs text-muted-foreground italic">· none linked</span>}
                      </button>
                      {canEdit && (
                        <div className="flex items-center gap-1 shrink-0">
                          {hasSourceLead && !showRelinkUI && (
                            <button
                              onClick={() => { setShowRelinkUI(true); setSourcePanelOpen(true); }}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
                              data-testid="button-change-lead-link"
                            >Change</button>
                          )}
                          {hasSourceLead && !showRelinkUI && (
                            <button
                              onClick={() => unlinkLeadMutation.mutate()}
                              disabled={unlinkLeadMutation.isPending}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/20 text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition-colors"
                              data-testid="button-unlink-lead"
                            >
                              {unlinkLeadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Unlink"}
                            </button>
                          )}
                          {(!hasSourceLead || showRelinkUI) && (
                            <button
                              onClick={() => { setShowRelinkUI(!showRelinkUI); setSourcePanelOpen(true); }}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-primary/20 text-primary hover:bg-primary/10 hover:border-primary/40 transition-colors"
                              data-testid="button-link-lead"
                            >{showRelinkUI ? "Cancel" : "Link to Lead"}</button>
                          )}
                        </div>
                      )}
                    </div>

                    {showRelinkUI && (
                      <div className="mb-3 p-3 rounded-lg border border-border/50 bg-secondary/10 space-y-2" data-testid="section-relink-lead">
                        <p className="text-xs text-muted-foreground font-medium">Search for a lead to link:</p>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <input
                            type="text"
                            value={relinkSearch}
                            onChange={e => { setRelinkSearch(e.target.value); searchLeads(e.target.value); }}
                            placeholder="Type marina or company name…"
                            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-border/50 bg-background/50 focus:outline-none focus:border-primary/50"
                            data-testid="input-relink-search"
                          />
                          {relinkSearching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        </div>
                        {relinkResults.length > 0 && (
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {relinkResults.map((lead: any) => (
                              <button
                                key={lead.id}
                                onClick={() => linkLeadMutation.mutate(lead.id)}
                                disabled={linkLeadMutation.isPending}
                                className="w-full text-left px-3 py-2 rounded-md hover:bg-primary/10 transition-colors flex items-center justify-between gap-2"
                                data-testid={`button-relink-lead-${lead.id}`}
                              >
                                <span className="text-sm font-medium truncate">{lead.company}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">#{lead.id} · {lead.status}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {relinkSearch.trim() && !relinkSearching && relinkResults.length === 0 && (
                          <p className="text-xs text-muted-foreground italic text-center py-1">No leads found</p>
                        )}
                      </div>
                    )}

                    {sourcePanelOpen && (
                      <>
                        {sourceLeadLoading ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading source lead…
                          </div>
                        ) : !hasSourceLead ? null : sourceLead ? (
                          <div className="space-y-3">
                            <div className="rounded-lg border border-border/50 bg-secondary/10 p-3 space-y-3" data-testid="card-source-lead">
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                                <div>
                                  <p className="text-xs text-muted-foreground">Company / Marina</p>
                                  <p className="font-medium">{sourceLead.company || "—"}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Stage at Promotion</p>
                                  <p className="font-medium capitalize">
                                    {conversionHistory[0]?.notes
                                      ? (() => { try { return JSON.parse(conversionHistory[0].notes).priorStatus?.replace(/_/g, " ") || sourceLead.status; } catch { return sourceLead.status; } })()
                                      : sourceLead.status?.replace(/_/g, " ")}
                                  </p>
                                </div>
                                {sourceLead.contactName && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Contact</p>
                                    <p className="font-medium">{sourceLead.contactName}</p>
                                  </div>
                                )}
                                {sourceLead.contactEmail && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Email</p>
                                    <a href={`mailto:${sourceLead.contactEmail}`} className="text-primary hover:underline text-sm break-all">{sourceLead.contactEmail}</a>
                                  </div>
                                )}
                                {sourceLead.contactPhone && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Phone</p>
                                    <p className="font-medium">{sourceLead.contactPhone}</p>
                                  </div>
                                )}
                                {(sourceLead.city || (sourceLead as any).state) && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Location</p>
                                    <p className="font-medium">{[(sourceLead as any).city, (sourceLead as any).state, sourceLead.country].filter(Boolean).join(", ")}</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-xs text-muted-foreground">Lead Created</p>
                                  <p className="font-medium">{new Date(sourceLead.createdAt).toLocaleDateString()}</p>
                                </div>
                                {sourceLead.source && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Source</p>
                                    <p className="font-medium">{sourceLead.source}</p>
                                  </div>
                                )}
                              </div>
                              {sourceLead.notes && (
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">Lead Notes (excerpt)</p>
                                  <p className="text-xs text-foreground/70 whitespace-pre-wrap line-clamp-4">
                                    {sourceLead.notes.slice(0, 300)}{sourceLead.notes.length > 300 ? "…" : ""}
                                  </p>
                                </div>
                              )}
                              {onOpenLead && (
                                <div className="pt-1 border-t border-border/30">
                                  <button
                                    onClick={() => onOpenLead(sourceLead.id)}
                                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                                    data-testid="button-view-full-lead"
                                  >
                                    <ArrowRightLeft className="h-3 w-3" />
                                    View full lead record →
                                  </button>
                                </div>
                              )}
                            </div>

                            {conversionHistory.length > 0 && (
                              <div>
                                <button
                                  onClick={() => setHistoryOpen(o => !o)}
                                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
                                  data-testid="button-toggle-conversion-history"
                                >
                                  {historyOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  <Clock className="h-3 w-3" />
                                  Conversion History ({conversionHistory.length} event{conversionHistory.length !== 1 ? "s" : ""})
                                </button>

                                {historyOpen && (
                                  <div className="space-y-2 pl-2 border-l-2 border-border/40 ml-1" data-testid="list-conversion-history">
                                    {conversionHistory.map((entry) => {
                                      let parsed: Record<string, string> = {};
                                      try { parsed = JSON.parse(entry.notes || "{}"); } catch {}
                                      const actionLabel = parsed.action === "created"
                                        ? "Promoted to new Account"
                                        : parsed.action === "linked"
                                          ? "Linked to existing Account"
                                          : "Conversion event";
                                      return (
                                        <div key={entry.id} className="text-xs" data-testid={`history-entry-${entry.id}`}>
                                          <div className="flex items-center gap-1.5">
                                            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${parsed.action === "created" ? "bg-emerald-400" : "bg-blue-400"}`} />
                                            <span className="font-medium">{actionLabel}</span>
                                          </div>
                                          <p className="text-muted-foreground pl-3 mt-0.5">
                                            {new Date(entry.migratedAt).toLocaleString()}
                                            {parsed.linkedAccountName ? ` · ${parsed.linkedAccountName}` : ""}
                                            {parsed.priorStatus ? ` · from "${parsed.priorStatus}"` : ""}
                                          </p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Source lead data unavailable (may have been deleted or unlinked).</p>
                        )}
                      </>
                    )}
                  </div>
                )}

                <CollapsibleSection title="Infrastructure profile" icon={Zap} defaultOpen={false} testId="section-infrastructure">
                  <InfrastructureProfileTab
                    profile={infraProfile}
                    onSave={(data) => updateInfraMutation.mutate(data)}
                    isPending={updateInfraMutation.isPending}
                    canEdit={canEdit}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="Note feed" icon={MessageSquare} defaultOpen={false} testId="section-note-feed">
                  <NotesPanel linkedObjectType="account" linkedObjectId={account.id} />
                </CollapsibleSection>

                <div className="border-t border-border/50 pt-4">
                  <AttachmentsSection objectType="account" objectId={account.id} />
                </div>

                <AiSummaryCard entityType="account" entityId={account.id} entityName={account.name} />

                <div className="border-t border-border/50 pt-4">
                  <CommentsFeed objectType="account" objectId={account.id} />
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="people" className="space-y-6 mt-4">
            <section>
              <SectionHeader icon={Users} title="Contacts" />
              <ContactsPanel entityType="account" entityId={account.id} canEdit={canEdit} emptyText="No contacts yet." />
            </section>

            <section>
              <SectionHeader icon={Briefcase} title="Deals" count={oppsData?.data?.length || 0} />
              <div className="space-y-2">
                {oppsData?.data?.map((opp) => (
                  <div key={opp.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50" data-testid={`row-opp-${opp.id}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{opp.title}</p>
                      <p className="text-xs text-muted-foreground">Stage: {opp.stage}</p>
                    </div>
                    <span className="text-sm font-medium shrink-0">${opp.valueTotal?.toLocaleString() || "0"}</span>
                  </div>
                ))}
                {(!oppsData?.data || oppsData.data.length === 0) && (
                  <p className="text-center text-sm text-muted-foreground py-4">No deals yet</p>
                )}
              </div>
            </section>

            <section>
              <SectionHeader icon={LifeBuoy} title="Tickets" count={ticketsData?.data?.length || 0} />
              <div className="space-y-2">
                {ticketsData?.data?.map((ticket) => (
                  <div key={ticket.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50" data-testid={`row-ticket-${ticket.id}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{ticket.subject}</p>
                      <p className="text-xs text-muted-foreground">{ticket.category} · {ticket.severity}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0">{ticket.status}</Badge>
                  </div>
                ))}
                {(!ticketsData?.data || ticketsData.data.length === 0) && (
                  <p className="text-center text-sm text-muted-foreground py-4">No tickets yet</p>
                )}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="activity" className="space-y-6 mt-4">
            <section>
              <SectionHeader icon={Mail} title="Emails" />
              <EmailsTab objectType="account" objectId={account.id} />
            </section>

            <section>
              <SectionHeader icon={HistoryIcon} title="Timeline" />
              <TimelineTab objectType="account" objectId={account.id} />
            </section>
          </TabsContent>
        </Tabs>
      </ExpandableDialogContent>
    </Dialog>

    {/* Create Inbox Folder from Account dialog */}
    <Dialog open={showFolderDialog} onOpenChange={(v) => !v && setShowFolderDialog(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-teal-400" />
            Create Inbox Folder from Account
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Create a Gmail folder for <strong>{account.name}</strong>. Emails from this account's domain will be automatically sorted here.
          </p>
          <div>
            <Label htmlFor="acct-folder-name" className="text-sm font-medium">Folder Name</Label>
            <Input
              id="acct-folder-name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              className="mt-1"
              data-testid="input-folder-name-from-account"
            />
          </div>
          <div>
            <Label htmlFor="acct-folder-domain" className="text-sm font-medium">Domain</Label>
            <p className="text-xs text-muted-foreground mb-1">Emails from this domain (and subdomains) will auto-sort into this folder.</p>
            <Input
              id="acct-folder-domain"
              value={folderDomainInput}
              onChange={(e) => setFolderDomainInput(e.target.value)}
              placeholder="e.g. nmma.org"
              className="mt-1 font-mono text-sm"
              data-testid="input-folder-domain-from-account"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setShowFolderDialog(false)} data-testid="button-cancel-folder-from-account">Cancel</Button>
            <Button
              disabled={!folderName.trim() || createFolderFromAccountMutation.isPending}
              onClick={() => {
                const domains = folderDomainInput.split(/[\n,]+/).map(d => d.trim()).filter(Boolean);
                createFolderFromAccountMutation.mutate({ name: folderName.trim(), domains });
              }}
              data-testid="button-confirm-folder-from-account"
            >
              {createFolderFromAccountMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Folder"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>
  );
}

function DetailField({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <p className="text-sm flex items-center gap-1">
        {icon}
        {value}
      </p>
    </div>
  );
}

function InfrastructureProfileTab({ profile, onSave, isPending, canEdit = true }: { profile: InfrastructureProfile | null | undefined; onSave: (data: Record<string, unknown>) => void; isPending: boolean; canEdit?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    existingPedestalBrands: "",
    pedestalAgeAvgYears: "",
    pedestalAgeOldestYears: "",
    powerPerSlip: "",
    pctSlips30a: "",
    pctSlips50a: "",
    voltageTypes: "",
    meteringToday: "",
    billingMethod: "",
    leakageDetection: "",
    breakerTripPain: "",
    knownFailureModes: "",
    recentIncidents: "",
    complianceJurisdiction: "",
    compliancePressure: "",
    complianceDeadline: "",
    inspectionNotes: "",
    marinaManagementSoftware: "",
    accountingSystem: "",
    paymentProvider: "",
    wifiMaturity: "",
    itContactName: "",
  });

  useEffect(() => {
    if (profile) {
      setForm({
        existingPedestalBrands: profile.existingPedestalBrands || "",
        pedestalAgeAvgYears: profile.pedestalAgeAvgYears?.toString() || "",
        pedestalAgeOldestYears: profile.pedestalAgeOldestYears?.toString() || "",
        powerPerSlip: profile.powerPerSlip || "",
        pctSlips30a: profile.pctSlips30a?.toString() || "",
        pctSlips50a: profile.pctSlips50a?.toString() || "",
        voltageTypes: profile.voltageTypes || "",
        meteringToday: profile.meteringToday || "",
        billingMethod: profile.billingMethod || "",
        leakageDetection: profile.leakageDetection || "",
        breakerTripPain: profile.breakerTripPain || "",
        knownFailureModes: profile.knownFailureModes || "",
        recentIncidents: profile.recentIncidents || "",
        complianceJurisdiction: profile.complianceJurisdiction || "",
        compliancePressure: profile.compliancePressure || "",
        complianceDeadline: profile.complianceDeadline || "",
        inspectionNotes: profile.inspectionNotes || "",
        marinaManagementSoftware: profile.marinaManagementSoftware || "",
        accountingSystem: profile.accountingSystem || "",
        paymentProvider: profile.paymentProvider || "",
        wifiMaturity: profile.wifiMaturity || "",
        itContactName: profile.itContactName || "",
      });
    }
  }, [profile]);

  const handleSave = () => {
    onSave({
      ...form,
      pedestalAgeAvgYears: form.pedestalAgeAvgYears ? Number(form.pedestalAgeAvgYears) : null,
      pedestalAgeOldestYears: form.pedestalAgeOldestYears ? Number(form.pedestalAgeOldestYears) : null,
      pctSlips30a: form.pctSlips30a ? Number(form.pctSlips30a) : null,
      pctSlips50a: form.pctSlips50a ? Number(form.pctSlips50a) : null,
    });
    setEditing(false);
  };

  const hasData = profile && Object.values(profile).some(v => v !== null && v !== "" && v !== undefined && v !== 0);

  if (!editing && !hasData) {
    return (
      <div className="text-center py-8 space-y-3">
        <Wrench className="h-10 w-10 mx-auto text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No infrastructure data yet</p>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-add-infra">
            <Plus className="mr-1 h-3 w-3" /> Add Infrastructure Profile
          </Button>
        )}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-3"><Zap className="h-4 w-4 text-primary" /> Pedestal & Power</h4>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Existing Pedestal Brands</Label><Input value={form.existingPedestalBrands} onChange={(e) => setForm(f => ({ ...f, existingPedestalBrands: e.target.value }))} data-testid="input-pedestal-brands" /></div>
            <div><Label className="text-xs">Avg Pedestal Age (years)</Label><Input type="number" value={form.pedestalAgeAvgYears} onChange={(e) => setForm(f => ({ ...f, pedestalAgeAvgYears: e.target.value }))} data-testid="input-pedestal-avg-age" /></div>
            <div><Label className="text-xs">Oldest Pedestal Age (years)</Label><Input type="number" value={form.pedestalAgeOldestYears} onChange={(e) => setForm(f => ({ ...f, pedestalAgeOldestYears: e.target.value }))} data-testid="input-pedestal-oldest-age" /></div>
            <div><Label className="text-xs">Power Per Slip</Label><Input value={form.powerPerSlip} onChange={(e) => setForm(f => ({ ...f, powerPerSlip: e.target.value }))} data-testid="input-power-per-slip" /></div>
            <div><Label className="text-xs">% Slips 30A</Label><Input type="number" value={form.pctSlips30a} onChange={(e) => setForm(f => ({ ...f, pctSlips30a: e.target.value }))} data-testid="input-pct-30a" /></div>
            <div><Label className="text-xs">% Slips 50A</Label><Input type="number" value={form.pctSlips50a} onChange={(e) => setForm(f => ({ ...f, pctSlips50a: e.target.value }))} data-testid="input-pct-50a" /></div>
            <div><Label className="text-xs">Voltage Types</Label><Input value={form.voltageTypes} onChange={(e) => setForm(f => ({ ...f, voltageTypes: e.target.value }))} data-testid="input-voltage-types" /></div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-3"><Settings2 className="h-4 w-4 text-primary" /> Metering & Billing</h4>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Metering Today</Label><Input value={form.meteringToday} onChange={(e) => setForm(f => ({ ...f, meteringToday: e.target.value }))} data-testid="input-metering" /></div>
            <div><Label className="text-xs">Billing Method</Label><Input value={form.billingMethod} onChange={(e) => setForm(f => ({ ...f, billingMethod: e.target.value }))} data-testid="input-billing" /></div>
            <div><Label className="text-xs">Leakage Detection</Label><Input value={form.leakageDetection} onChange={(e) => setForm(f => ({ ...f, leakageDetection: e.target.value }))} data-testid="input-leakage" /></div>
            <div><Label className="text-xs">Breaker Trip Pain</Label><Input value={form.breakerTripPain} onChange={(e) => setForm(f => ({ ...f, breakerTripPain: e.target.value }))} data-testid="input-breaker" /></div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-3"><AlertTriangle className="h-4 w-4 text-primary" /> Failures & Incidents</h4>
          <div className="grid grid-cols-1 gap-3">
            <div><Label className="text-xs">Known Failure Modes</Label><Textarea value={form.knownFailureModes} onChange={(e) => setForm(f => ({ ...f, knownFailureModes: e.target.value }))} rows={2} data-testid="input-failures" /></div>
            <div><Label className="text-xs">Recent Incidents</Label><Textarea value={form.recentIncidents} onChange={(e) => setForm(f => ({ ...f, recentIncidents: e.target.value }))} rows={2} data-testid="input-incidents" /></div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-3"><Shield className="h-4 w-4 text-primary" /> Compliance</h4>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Jurisdiction</Label><Input value={form.complianceJurisdiction} onChange={(e) => setForm(f => ({ ...f, complianceJurisdiction: e.target.value }))} data-testid="input-jurisdiction" /></div>
            <div><Label className="text-xs">Compliance Pressure</Label><Input value={form.compliancePressure} onChange={(e) => setForm(f => ({ ...f, compliancePressure: e.target.value }))} data-testid="input-pressure" /></div>
            <div><Label className="text-xs">Compliance Deadline</Label><Input value={form.complianceDeadline} onChange={(e) => setForm(f => ({ ...f, complianceDeadline: e.target.value }))} data-testid="input-deadline" /></div>
            <div><Label className="text-xs">Inspection Notes</Label><Input value={form.inspectionNotes} onChange={(e) => setForm(f => ({ ...f, inspectionNotes: e.target.value }))} data-testid="input-inspection" /></div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-3"><Wifi className="h-4 w-4 text-primary" /> IT & Systems</h4>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Marina Management Software</Label><Input value={form.marinaManagementSoftware} onChange={(e) => setForm(f => ({ ...f, marinaManagementSoftware: e.target.value }))} data-testid="input-mgmt-software" /></div>
            <div><Label className="text-xs">Accounting System</Label><Input value={form.accountingSystem} onChange={(e) => setForm(f => ({ ...f, accountingSystem: e.target.value }))} data-testid="input-accounting" /></div>
            <div><Label className="text-xs">Payment Provider</Label><Input value={form.paymentProvider} onChange={(e) => setForm(f => ({ ...f, paymentProvider: e.target.value }))} data-testid="input-payment" /></div>
            <div><Label className="text-xs">WiFi Maturity</Label><Input value={form.wifiMaturity} onChange={(e) => setForm(f => ({ ...f, wifiMaturity: e.target.value }))} data-testid="input-wifi" /></div>
            <div><Label className="text-xs">IT Contact Name</Label><Input value={form.itContactName} onChange={(e) => setForm(f => ({ ...f, itContactName: e.target.value }))} data-testid="input-it-contact" /></div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
          <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={isPending} data-testid="button-save-infra">
            {isPending ? "Saving..." : "Save Profile"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-edit-infra">Edit</Button>
        </div>
      )}

      {(profile?.existingPedestalBrands || profile?.powerPerSlip || profile?.voltageTypes) && (
        <div className="rounded-lg border border-border/50 p-3">
          <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><Zap className="h-3 w-3" /> Pedestal & Power</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <InfraField label="Pedestal Brands" value={profile?.existingPedestalBrands} />
            <InfraField label="Avg Age" value={profile?.pedestalAgeAvgYears ? `${profile.pedestalAgeAvgYears} yrs` : null} />
            <InfraField label="Oldest" value={profile?.pedestalAgeOldestYears ? `${profile.pedestalAgeOldestYears} yrs` : null} />
            <InfraField label="Power/Slip" value={profile?.powerPerSlip} />
            <InfraField label="30A Slips" value={profile?.pctSlips30a ? `${profile.pctSlips30a}%` : null} />
            <InfraField label="50A Slips" value={profile?.pctSlips50a ? `${profile.pctSlips50a}%` : null} />
            <InfraField label="Voltage Types" value={profile?.voltageTypes} />
          </div>
        </div>
      )}

      {(profile?.meteringToday || profile?.billingMethod || profile?.breakerTripPain) && (
        <div className="rounded-lg border border-border/50 p-3">
          <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><Settings2 className="h-3 w-3" /> Metering & Billing</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <InfraField label="Metering" value={profile?.meteringToday} />
            <InfraField label="Billing" value={profile?.billingMethod} />
            <InfraField label="Leakage Detection" value={profile?.leakageDetection} />
            <InfraField label="Breaker Trip Pain" value={profile?.breakerTripPain} />
          </div>
        </div>
      )}

      {(profile?.knownFailureModes || profile?.recentIncidents) && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <h4 className="text-xs font-medium text-red-400 mb-2 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Failures & Incidents</h4>
          <InfraField label="Known Failure Modes" value={profile?.knownFailureModes} />
          <InfraField label="Recent Incidents" value={profile?.recentIncidents} />
        </div>
      )}

      {(profile?.complianceJurisdiction || profile?.compliancePressure) && (
        <div className="rounded-lg border border-border/50 p-3">
          <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><Shield className="h-3 w-3" /> Compliance</h4>
          <div className="grid grid-cols-2 gap-3">
            <InfraField label="Jurisdiction" value={profile?.complianceJurisdiction} />
            <InfraField label="Pressure" value={profile?.compliancePressure} />
            <InfraField label="Deadline" value={profile?.complianceDeadline} />
            <InfraField label="Inspection Notes" value={profile?.inspectionNotes} />
          </div>
        </div>
      )}

      {(profile?.marinaManagementSoftware || profile?.accountingSystem || profile?.paymentProvider) && (
        <div className="rounded-lg border border-border/50 p-3">
          <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><Wifi className="h-3 w-3" /> IT & Systems</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <InfraField label="Marina Software" value={profile?.marinaManagementSoftware} />
            <InfraField label="Accounting" value={profile?.accountingSystem} />
            <InfraField label="Payment" value={profile?.paymentProvider} />
            <InfraField label="WiFi" value={profile?.wifiMaturity} />
            <InfraField label="IT Contact" value={profile?.itContactName} />
          </div>
        </div>
      )}
    </div>
  );
}

function InfraField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function EditAccountForm({ account, onSubmit, onCancel, isPending }: { account: Account; onSubmit: (data: Record<string, unknown>) => void; onCancel: () => void; isPending: boolean }) {
  const [form, setForm] = useState({
    name: account.name || "",
    legalName: account.legalName || "",
    website: account.website || "",
    orgType: account.orgType || "marina_prospect",
    segment: account.segment || "marina",
    marinaType: account.marinaType || "",
    ownershipType: account.ownershipType || "",
    parentCompany: account.parentCompany || "",
    streetAddress: account.streetAddress || "",
    city: account.city || "",
    stateProvince: account.stateProvince || "",
    postalZip: account.postalZip || "",
    country: account.country || "",
    region: account.region || "",
    timezone: account.timezone || "",
    slipCount: account.slipCount?.toString() || "",
    slipMix: account.slipMix || "",
    avgBoatSizeRange: account.avgBoatSizeRange || "",
    powerDemandIntensity: account.powerDemandIntensity || "",
    seasonality: account.seasonality || "",
    expansionPlans: account.expansionPlans || false,
    expansionNotes: account.expansionNotes || "",
    leadSource: account.leadSource || "",
    leadStatus: account.leadStatus || "new",
    priority: account.priority || "medium",
    betaTester: account.betaTester || false,
    pilotCandidateScore: account.pilotCandidateScore?.toString() || "",
    redFlags: account.redFlags || "",
    nextAction: account.nextAction || "",
    notes: account.notes || "",
    notesSummary: account.notesSummary || "",
    tags: account.tags || "",
    marketSegment: (account as any).marketSegment || "",
    slipRange: (account as any).slipRange || "",
  });

  const isMarinaType = MARINA_ORG_TYPES.has(form.orgType);
  const isMarinaOperating = isMarinaType && !NON_OPERATING_SEGMENTS.has(form.marketSegment);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSubmit({
        ...form,
        slipCount: form.slipCount ? Number(form.slipCount) : undefined,
        pilotCandidateScore: form.pilotCandidateScore ? Number(form.pilotCandidateScore) : undefined,
      });
    }} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Name *</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required data-testid="input-edit-name" /></div>
        <div><Label className="text-xs">Legal Name</Label><Input value={form.legalName} onChange={(e) => setForm(f => ({ ...f, legalName: e.target.value }))} data-testid="input-edit-legal-name" /></div>
        <div><Label className="text-xs">Website</Label><Input value={form.website} onChange={(e) => setForm(f => ({ ...f, website: e.target.value }))} data-testid="input-edit-website" /></div>
        <div>
          <Label className="text-xs">Account Type</Label>
          <Select value={form.orgType} onValueChange={(v) => setForm(f => ({ ...f, orgType: v }))}>
            <SelectTrigger data-testid="select-edit-org-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LEGACY_ORG_TYPE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Segment</Label>
          <Select value={form.segment} onValueChange={(v) => setForm(f => ({ ...f, segment: v }))}>
            <SelectTrigger data-testid="select-edit-segment"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="marina">Marina</SelectItem>
              <SelectItem value="corp">Corporation</SelectItem>
              <SelectItem value="partner">Partner</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Marina Type</Label><Input value={form.marinaType} onChange={(e) => setForm(f => ({ ...f, marinaType: e.target.value }))} placeholder="e.g. Full-service, Dry stack" data-testid="input-edit-marina-type" /></div>
        <div><Label className="text-xs">Ownership Type</Label><Input value={form.ownershipType} onChange={(e) => setForm(f => ({ ...f, ownershipType: e.target.value }))} placeholder="e.g. Private, Municipal" data-testid="input-edit-ownership" /></div>
        <div><Label className="text-xs">Parent Company</Label><Input value={form.parentCompany} onChange={(e) => setForm(f => ({ ...f, parentCompany: e.target.value }))} data-testid="input-edit-parent" /></div>
      </div>

      <div className="border-t border-border/50 pt-3">
        <Label className="text-xs text-muted-foreground mb-2 block">Location</Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label className="text-xs">Street Address</Label><Input value={form.streetAddress} onChange={(e) => setForm(f => ({ ...f, streetAddress: e.target.value }))} data-testid="input-edit-street" /></div>
          <div><Label className="text-xs">City</Label><Input value={form.city} onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))} data-testid="input-edit-city" /></div>
          <div>
            <Label className="text-xs">State/Province</Label>
            <StateProvinceSelect
              country={form.country}
              value={form.stateProvince}
              onChange={(v) => setForm(f => ({ ...f, stateProvince: v }))}
              data-testid="select-edit-state"
            />
          </div>
          <div><Label className="text-xs">Postal/Zip</Label><Input value={form.postalZip} onChange={(e) => setForm(f => ({ ...f, postalZip: e.target.value }))} data-testid="input-edit-postal" /></div>
          <div>
            <Label className="text-xs">Country</Label>
            <Select value={form.country} onValueChange={(v) => setForm(f => ({ ...f, country: v, stateProvince: "" }))}>
              <SelectTrigger data-testid="select-edit-country"><SelectValue placeholder="Select country" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="US">USA</SelectItem>
                <SelectItem value="CA">Canada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Region</Label><Input value={form.region} onChange={(e) => setForm(f => ({ ...f, region: e.target.value }))} data-testid="input-edit-region" /></div>
          <div><Label className="text-xs">Timezone</Label><Input value={form.timezone} onChange={(e) => setForm(f => ({ ...f, timezone: e.target.value }))} data-testid="input-edit-tz" /></div>
        </div>
      </div>

      {isMarinaType && (
        <div className="border-t border-border/50 pt-3">
          <Label className="text-xs text-muted-foreground mb-2 block">Marina Details</Label>
          <div className="grid grid-cols-2 gap-3">
            {isMarinaOperating && <div><Label className="text-xs">Slip Count</Label><Input type="number" value={form.slipCount} onChange={(e) => setForm(f => ({ ...f, slipCount: e.target.value }))} data-testid="input-edit-slips" /></div>}
            <div className={!isMarinaOperating ? "col-span-2" : ""}>
              <Label className="text-xs">Market Segment</Label>
              <Select value={form.marketSegment || "__none__"} onValueChange={(v) => setForm(f => ({ ...f, marketSegment: v === "__none__" ? "" : v }))}>
                <SelectTrigger data-testid="select-edit-market-segment"><SelectValue placeholder="Select segment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {MARKET_SEGMENT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {isMarinaOperating && <div>
              <Label className="text-xs">Slip Range</Label>
              <Select value={form.slipRange || "__none__"} onValueChange={(v) => setForm(f => ({ ...f, slipRange: v === "__none__" ? "" : v }))}>
                <SelectTrigger data-testid="select-edit-slip-range"><SelectValue placeholder="Select range" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {SLIP_RANGE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>}
            {isMarinaOperating && <div><Label className="text-xs">Slip Mix</Label><Input value={form.slipMix} onChange={(e) => setForm(f => ({ ...f, slipMix: e.target.value }))} placeholder="e.g. 60% wet, 40% dry" data-testid="input-edit-slip-mix" /></div>}
            {isMarinaOperating && <div><Label className="text-xs">Avg Boat Size Range</Label><Input value={form.avgBoatSizeRange} onChange={(e) => setForm(f => ({ ...f, avgBoatSizeRange: e.target.value }))} placeholder="e.g. 25-45 ft" data-testid="input-edit-boat-size" /></div>}
            {isMarinaOperating && <div><Label className="text-xs">Power Demand</Label><Input value={form.powerDemandIntensity} onChange={(e) => setForm(f => ({ ...f, powerDemandIntensity: e.target.value }))} placeholder="e.g. High, Medium, Low" data-testid="input-edit-power-demand" /></div>}
            {isMarinaOperating && <div><Label className="text-xs">Seasonality</Label><Input value={form.seasonality} onChange={(e) => setForm(f => ({ ...f, seasonality: e.target.value }))} placeholder="e.g. Year-round, Apr-Oct" data-testid="input-edit-seasonality" /></div>}
          </div>
          {isMarinaOperating && (
            <div className="flex items-center gap-4 mt-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.expansionPlans} onChange={(e) => setForm(f => ({ ...f, expansionPlans: e.target.checked }))} className="rounded" data-testid="input-edit-expansion" />
                Expansion Plans
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.betaTester} onChange={(e) => setForm(f => ({ ...f, betaTester: e.target.checked }))} className="rounded" data-testid="input-edit-beta" />
                Beta Tester
              </label>
            </div>
          )}
          {isMarinaOperating && form.expansionPlans && (
            <div className="mt-2"><Label className="text-xs">Expansion Notes</Label><Textarea value={form.expansionNotes} onChange={(e) => setForm(f => ({ ...f, expansionNotes: e.target.value }))} rows={2} data-testid="input-edit-expansion-notes" /></div>
          )}
        </div>
      )}

      <div className="border-t border-border/50 pt-3">
        <Label className="text-xs text-muted-foreground mb-2 block">Sales Info</Label>
        <div className="grid grid-cols-2 gap-3">
          {isMarinaType && (
            <div>
              <Label className="text-xs">Pipeline Stage</Label>
              <Select value={form.leadStatus} onValueChange={(v) => setForm(f => ({ ...f, leadStatus: v }))}>
                <SelectTrigger data-testid="select-edit-lead-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PIPELINE_STAGES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">Priority</Label>
            <Select value={form.priority} onValueChange={(v) => setForm(f => ({ ...f, priority: v }))}>
              <SelectTrigger data-testid="select-edit-priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Lead Source</Label><Input value={form.leadSource} onChange={(e) => setForm(f => ({ ...f, leadSource: e.target.value }))} data-testid="input-edit-lead-source" /></div>
          <div><Label className="text-xs">Pilot Candidate Score (1-5)</Label><Input type="number" min="1" max="5" value={form.pilotCandidateScore} onChange={(e) => setForm(f => ({ ...f, pilotCandidateScore: e.target.value }))} data-testid="input-edit-pilot-score" /></div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div><Label className="text-xs">Red Flags</Label><Textarea value={form.redFlags} onChange={(e) => setForm(f => ({ ...f, redFlags: e.target.value }))} rows={2} data-testid="input-edit-red-flags" /></div>
        <div><Label className="text-xs">Next Action</Label><Input value={form.nextAction} onChange={(e) => setForm(f => ({ ...f, nextAction: e.target.value }))} data-testid="input-edit-next-action" /></div>
        <div><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} data-testid="input-edit-notes" /></div>
        <div><Label className="text-xs">Tags</Label><Input value={form.tags} onChange={(e) => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="Comma-separated" data-testid="input-edit-tags" /></div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={isPending} data-testid="button-save-account">
          {isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}

function CreateAccountForm({ onSubmit, isPending }: { onSubmit: (data: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    name: "", orgType: "marina_prospect", segment: "marina",
    streetAddress: "", city: "", stateProvince: "", postalZip: "", country: "US",
    region: "", slipCount: "", notes: "", leadStatus: "new", priority: "medium",
    marketSegment: "", slipRange: "",
  });
  const isMarinaType = MARINA_ORG_TYPES.has(form.orgType);
  const isMarinaOperating = isMarinaType && !NON_OPERATING_SEGMENTS.has(form.marketSegment);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...form, slipCount: form.slipCount ? Number(form.slipCount) : undefined }); }} className="space-y-4">
      <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required data-testid="input-account-name" /></div>
      <div>
        <Label>Account Type</Label>
        <Select value={form.orgType} onValueChange={(v) => setForm(f => ({ ...f, orgType: v }))}>
          <SelectTrigger data-testid="select-account-org-type"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LEGACY_ORG_TYPE_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Segment</Label>
        <Select value={form.segment} onValueChange={(v) => setForm(f => ({ ...f, segment: v }))}>
          <SelectTrigger data-testid="select-account-segment"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="marina">Marina</SelectItem>
            <SelectItem value="corp">Corporation</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Street Address</Label><Input value={form.streetAddress} onChange={(e) => setForm(f => ({ ...f, streetAddress: e.target.value }))} data-testid="input-account-address" /></div>
        <div><Label>City</Label><Input value={form.city} onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))} data-testid="input-account-city" /></div>
        <div>
          <Label>State/Province</Label>
          <StateProvinceSelect
            country={form.country}
            value={form.stateProvince}
            onChange={(v) => setForm(f => ({ ...f, stateProvince: v }))}
            data-testid="select-account-state"
          />
        </div>
        <div><Label>Postal/Zip</Label><Input value={form.postalZip} onChange={(e) => setForm(f => ({ ...f, postalZip: e.target.value }))} data-testid="input-account-postal" /></div>
        <div>
          <Label>Country</Label>
          <Select value={form.country} onValueChange={(v) => setForm(f => ({ ...f, country: v, stateProvince: "" }))}>
            <SelectTrigger data-testid="select-account-country"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="US">USA</SelectItem>
              <SelectItem value="CA">Canada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Region</Label><Input value={form.region} onChange={(e) => setForm(f => ({ ...f, region: e.target.value }))} data-testid="input-account-region" /></div>
        {isMarinaOperating && (
          <div><Label>Slip Count</Label><Input type="number" value={form.slipCount} onChange={(e) => setForm(f => ({ ...f, slipCount: e.target.value }))} data-testid="input-slip-count" /></div>
        )}
      {isMarinaType && (
        <div className="grid grid-cols-2 gap-3">
          <div className={!isMarinaOperating ? "col-span-2" : ""}>
            <Label>Market Segment</Label>
            <Select value={form.marketSegment || "__none__"} onValueChange={(v) => setForm(f => ({ ...f, marketSegment: v === "__none__" ? "" : v }))}>
              <SelectTrigger data-testid="select-account-market-segment"><SelectValue placeholder="Select segment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {MARKET_SEGMENT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isMarinaOperating && <div>
            <Label>Slip Range</Label>
            <Select value={form.slipRange || "__none__"} onValueChange={(v) => setForm(f => ({ ...f, slipRange: v === "__none__" ? "" : v }))}>
              <SelectTrigger data-testid="select-account-slip-range"><SelectValue placeholder="Select range" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {SLIP_RANGE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>}
        </div>
      )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {isMarinaType && (
          <div>
            <Label>Pipeline Stage</Label>
            <Select value={form.leadStatus} onValueChange={(v) => setForm(f => ({ ...f, leadStatus: v }))}>
              <SelectTrigger data-testid="select-account-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>Priority</Label>
          <Select value={form.priority} onValueChange={(v) => setForm(f => ({ ...f, priority: v }))}>
            <SelectTrigger data-testid="select-account-priority"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} data-testid="input-account-notes" /></div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-account">{isPending ? "Creating..." : "Create Account"}</Button>
    </form>
  );
}

