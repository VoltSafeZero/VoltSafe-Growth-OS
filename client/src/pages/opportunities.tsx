import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ExpandableDialogContent } from "@/components/ui/expandable-dialog-content";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, List, Columns3, DollarSign, AlertTriangle, Clock, CalendarClock,
  ArrowRight, CheckCircle2, XCircle, Target, ShieldAlert, Zap, MessageSquare,
  ExternalLink, UserCheck, Shuffle, ClipboardList,
} from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import { NotesPanel } from "@/components/notes-panel";
import { TimelineTab } from "@/components/timeline-tab";
import { ScoreBadge } from "@/components/scores/score-badge";
import { useOpportunityScores } from "@/hooks/use-scores";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { BulkActionsBar, BulkCheckbox } from "@/components/bulk-actions-bar";
import { AssignUserSelect } from "@/components/assign-user-select";
import type { Opportunity, Account, SavedView } from "@shared/schema";

const DEAL_STAGES = [
  { key: "inbound_new", label: "Inbound New", color: "bg-slate-500", badgeColor: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
  { key: "attempting_contact", label: "Attempting Contact", color: "bg-blue-500", badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { key: "connected", label: "Connected", color: "bg-indigo-500", badgeColor: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
  { key: "qualified", label: "Qualified", color: "bg-cyan-500", badgeColor: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  { key: "solution_fit", label: "Solution Fit", color: "bg-teal-500", badgeColor: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
  { key: "proposal_sent", label: "Proposal Sent", color: "bg-amber-500", badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { key: "negotiation", label: "Negotiation", color: "bg-orange-500", badgeColor: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { key: "commit", label: "Commit", color: "bg-purple-500", badgeColor: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  { key: "closed_won", label: "Closed Won", color: "bg-green-500", badgeColor: "bg-green-500/10 text-green-400 border-green-500/20" },
  { key: "closed_lost", label: "Closed Lost", color: "bg-red-500", badgeColor: "bg-red-500/10 text-red-400 border-red-500/20" },
  { key: "nurture", label: "Nurture", color: "bg-gray-500", badgeColor: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
];

const RISK_FLAG_OPTIONS = [
  { value: "procurement_slow", label: "Procurement slow" },
  { value: "board_approval", label: "Board approval required" },
  { value: "electrician_dependency", label: "Electrician dependency" },
  { value: "budget_cycle", label: "Budget cycle" },
  { value: "incumbent_lock_in", label: "Incumbent contract lock-in" },
];

const FORECAST_CATEGORIES = [
  { value: "omitted", label: "Omitted" },
  { value: "pipeline", label: "Pipeline" },
  { value: "best_case", label: "Best Case" },
  { value: "commit", label: "Commit" },
  { value: "closed", label: "Closed" },
];

const VALUE_DRIVERS = [
  { value: "safety", label: "Safety" },
  { value: "opex_reduction", label: "Opex Reduction" },
  { value: "revenue_enablement", label: "Revenue Enablement" },
  { value: "ux", label: "User Experience" },
  { value: "liability_reduction", label: "Liability Reduction" },
];

function getStageLabel(key: string) {
  return DEAL_STAGES.find(s => s.key === key)?.label || key;
}

function getStageBadgeColor(key: string) {
  return DEAL_STAGES.find(s => s.key === key)?.badgeColor || "";
}

function parseRiskFlags(flags: string | null): string[] {
  if (!flags) return [];
  try { return JSON.parse(flags); } catch { return flags.split(",").map(s => s.trim()).filter(Boolean); }
}

function getRiskFlagLabel(value: string) {
  return RISK_FLAG_OPTIONS.find(r => r.value === value)?.label || value;
}

function daysAgo(dateStr: string | Date | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function isOverdue(dateStr: string | Date | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function formatDate(dateStr: string | Date | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function DealSignals({ deal }: { deal: Opportunity }) {
  const risks = parseRiskFlags(deal.riskFlags);
  const nextStepOverdue = deal.nextStepDueDate ? isOverdue(deal.nextStepDueDate) : false;
  const lastActivityDays = daysAgo(deal.lastActivityDate);
  const isStale = lastActivityDays !== null && lastActivityDays > 14;

  return (
    <div className="space-y-2">
      <div className={`flex items-start gap-2 rounded-lg p-2 text-xs ${deal.nextStep ? (nextStepOverdue ? "bg-red-500/10 border border-red-500/20" : "bg-primary/5 border border-primary/10") : "bg-yellow-500/10 border border-yellow-500/20"}`}>
        <ArrowRight className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${nextStepOverdue ? "text-red-400" : deal.nextStep ? "text-primary" : "text-yellow-400"}`} />
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${nextStepOverdue ? "text-red-400" : ""}`}>
            {deal.nextStep || "No next step set"}
          </p>
          {deal.nextStepDueDate && (
            <p className={`text-[11px] mt-0.5 ${nextStepOverdue ? "text-red-400 font-semibold" : "text-muted-foreground"}`}>
              {nextStepOverdue ? "OVERDUE — " : "Due "}
              {formatDate(deal.nextStepDueDate)}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground px-1">
        <span className={`flex items-center gap-1 ${isStale ? "text-amber-400 font-medium" : ""}`}>
          <Clock className="h-3 w-3" />
          {deal.lastActivityDate
            ? `${lastActivityDays}d ago`
            : "No activity"
          }
          {isStale && " — Stale"}
        </span>
      </div>

      {risks.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {risks.slice(0, 3).map(flag => (
            <span key={flag} className="inline-flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5">
              <AlertTriangle className="h-2.5 w-2.5" />
              {getRiskFlagLabel(flag)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpportunitiesPage({ canEdit = true }: { canEdit?: boolean }) {
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Opportunity | null>(null);
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("");
  const [bulkStageValue, setBulkStageValue] = useState("");
  const [bulkAssignValue, setBulkAssignValue] = useState<number | null>(null);

  const { scoreMap: oppScores } = useOpportunityScores();

  const { data, isLoading } = useQuery<{ data: Opportunity[]; total: number }>({
    queryKey: ["/api/opportunities"],
    queryFn: async () => {
      const res = await fetch("/api/opportunities?limit=500", { credentials: "include" });
      return res.json();
    },
  });

  const { data: accountsData } = useQuery<{ data: Account[] }>({
    queryKey: ["/api/accounts", "all"],
    queryFn: async () => {
      const res = await fetch("/api/accounts?limit=500", { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/opportunities", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      setCreateOpen(false);
      toast({ title: "Deal created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/opportunities/${id}`, data);
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      if (selectedDeal) setSelectedDeal(result);
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async (ownerUserId: number) => {
      const res = await apiRequest("POST", "/api/opportunities/bulk/assign", { opportunityIds: Array.from(selectedIds), ownerUserId });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (d) => { queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] }); setSelectedIds(new Set()); toast({ title: `Assigned ${d.updated} deals` }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const bulkStageMutation = useMutation({
    mutationFn: async (stage: string) => {
      const res = await apiRequest("POST", "/api/opportunities/bulk/stage", { opportunityIds: Array.from(selectedIds), stage });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (d) => { queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] }); setSelectedIds(new Set()); toast({ title: `Updated ${d.updated} deals` }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const bulkTaskMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/opportunities/bulk/task", { opportunityIds: Array.from(selectedIds), title: "Follow up on deal" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (d) => { setSelectedIds(new Set()); toast({ title: `Created ${d.created} tasks` }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const currentFiltersJson = useMemo(() => JSON.stringify({ stageFilter }), [stageFilter]);

  const applyView = (sv: SavedView) => {
    setActiveViewId(sv.id);
    if (sv.filtersJson) {
      try {
        const f = JSON.parse(sv.filtersJson);
        if (f.stageFilter !== undefined) setStageFilter(f.stageFilter);
      } catch {}
    }
  };

  const clearView = () => { setActiveViewId(null); setStageFilter(""); };

  const toggleSelect = (id: number) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const accountMap = new Map(accountsData?.data?.map(a => [a.id, a.name]) || []);

  const activeStages = DEAL_STAGES.filter(s => s.key !== "closed_won" && s.key !== "closed_lost" && s.key !== "nurture");

  const groupedByStage = activeStages.map(stage => ({
    ...stage,
    items: data?.data?.filter(o => o.stage === stage.key) || [],
  }));

  const closedDeals = data?.data?.filter(o => o.stage === "closed_won" || o.stage === "closed_lost" || o.stage === "nurture") || [];

  const pipelineTotal = data?.data?.filter(o => !["closed_won", "closed_lost", "nurture"].includes(o.stage)).reduce((sum, d) => sum + (d.amount || d.valueTotal || 0), 0) || 0;
  const stalledCount = data?.data?.filter(d => d.isStalled).length || 0;
  const overdueCount = data?.data?.filter(d => d.nextStepDueDate && isOverdue(d.nextStepDueDate) && !["closed_won", "closed_lost"].includes(d.stage)).length || 0;

  const allDeals = data?.data ?? [];
  const filteredDeals = stageFilter ? allDeals.filter(d => d.stage === stageFilter) : allDeals;
  const isAllSelected = filteredDeals.length > 0 && filteredDeals.every(d => selectedIds.has(d.id));

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Deals Pipeline</h1>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-1">
            <span className="text-muted-foreground text-sm">{data?.total || 0} deals</span>
            <span className="text-sm font-medium text-primary flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" />{pipelineTotal.toLocaleString()} pipeline
            </span>
            {stalledCount > 0 && (
              <span className="text-sm text-amber-400 flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" />{stalledCount} stalled
              </span>
            )}
            {overdueCount > 0 && (
              <span className="text-sm text-red-400 flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />{overdueCount} overdue
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex border border-border/50 rounded-lg overflow-hidden">
            <Button variant={viewMode === "kanban" ? "secondary" : "ghost"} size="sm" onClick={() => setViewMode("kanban")} data-testid="button-kanban-view">
              <Columns3 className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="sm" onClick={() => setViewMode("list")} data-testid="button-list-view">
              <List className="h-4 w-4" />
            </Button>
          </div>
          <ExportButton endpoint="/api/opportunities/export" filename="opportunities_export.csv" />
          {canEdit && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground" data-testid="button-create-deal">
                  <Plus className="mr-2 h-4 w-4" /> New Deal
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Create Deal</DialogTitle></DialogHeader>
                <CreateDealForm accounts={accountsData?.data || []} onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Saved views bar */}
      <SavedViewsBar
        pageKey="opportunities"
        activeViewId={activeViewId}
        currentFiltersJson={currentFiltersJson}
        onApply={applyView}
        onClear={clearView}
        className="px-0"
      />

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <BulkActionsBar
          selectedCount={selectedIds.size}
          totalCount={filteredDeals.length}
          onSelectAll={() => setSelectedIds(new Set(filteredDeals.map(d => d.id)))}
          onClearSelection={() => setSelectedIds(new Set())}
          entityLabel="deal"
          actions={[
            {
              key: "assign",
              label: "Assign Owner",
              icon: <UserCheck className="h-3.5 w-3.5" />,
              testId: "button-bulk-deals-assign",
              confirmText: (count) => `Assign ${count} deal${count !== 1 ? "s" : ""} to a new owner`,
              requiresPermission: canEdit,
              isPending: bulkAssignMutation.isPending,
              onClick: async () => { if (bulkAssignValue) await bulkAssignMutation.mutateAsync(bulkAssignValue); },
            },
            {
              key: "stage",
              label: "Change Stage",
              icon: <Shuffle className="h-3.5 w-3.5" />,
              testId: "button-bulk-deals-stage",
              confirmText: (count) => `Move ${count} deal${count !== 1 ? "s" : ""} to a new stage`,
              requiresPermission: canEdit,
              isPending: bulkStageMutation.isPending,
              onClick: async () => { if (bulkStageValue) await bulkStageMutation.mutateAsync(bulkStageValue); },
            },
            {
              key: "task",
              label: "Create Task",
              icon: <ClipboardList className="h-3.5 w-3.5" />,
              testId: "button-bulk-deals-task",
              confirmText: (count) => `Create a follow-up task for ${count} deal${count !== 1 ? "s" : ""}`,
              requiresPermission: canEdit,
              isPending: bulkTaskMutation.isPending,
              onClick: async () => { await bulkTaskMutation.mutateAsync(); },
            },
          ]}
        />
      )}

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto">{[...Array(6)].map((_, i) => <Skeleton key={i} className="min-w-[300px] h-[400px]" />)}</div>
      ) : viewMode === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {groupedByStage.map(stage => (
            <div key={stage.key} className="min-w-[300px] max-w-[300px] flex-shrink-0" data-testid={`column-${stage.key}`}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
                <h3 className="text-sm font-semibold">{stage.label}</h3>
                <Badge variant="outline" className="ml-auto text-xs px-1.5">{stage.items.length}</Badge>
              </div>
              <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
                {stage.items.map(deal => (
                  <Card key={deal.id} className={`border-border/50 hover:border-primary/30 cursor-pointer transition-colors ${selectedIds.has(deal.id) ? "border-primary/50 bg-primary/5" : ""}`} data-testid={`card-deal-${deal.id}`}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <div onClick={e => { e.stopPropagation(); toggleSelect(deal.id); }} className="mt-0.5 shrink-0">
                            <BulkCheckbox checked={selectedIds.has(deal.id)} onChange={() => toggleSelect(deal.id)} testId={`checkbox-deal-${deal.id}`} />
                          </div>
                          <div className="min-w-0" onClick={() => setSelectedDeal(deal)}>
                            <p className="font-medium text-sm leading-tight truncate">{deal.title}</p>
                            <p className="text-xs text-muted-foreground truncate">{accountMap.get(deal.accountId) || "Unknown"}</p>
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-primary whitespace-nowrap flex items-center gap-0.5 cursor-pointer" onClick={() => setSelectedDeal(deal)}>
                          <DollarSign className="h-3 w-3" />
                          {(deal.amount || deal.valueTotal || 0).toLocaleString()}
                        </span>
                      </div>
                      <div onClick={() => setSelectedDeal(deal)}><DealSignals deal={deal} /></div>
                      {oppScores[deal.id] && (
                        <div onClick={() => setSelectedDeal(deal)}>
                          <ScoreBadge score={oppScores[deal.id]} variant="compact" data-testid={`score-opp-close-${deal.id}`} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {stage.items.length === 0 && (
                  <div className="border border-dashed border-border/50 rounded-lg p-6 text-center text-xs text-muted-foreground">
                    No deals
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
                  <th className="p-3 w-8">
                    <BulkCheckbox
                      checked={isAllSelected}
                      onChange={() => isAllSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(filteredDeals.map(d => d.id)))}
                      testId="checkbox-deals-select-all"
                    />
                  </th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Deal</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Account</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Stage</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Amount</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Next Step</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Due</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Last Activity</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Risks</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map(deal => {
                  const risks = parseRiskFlags(deal.riskFlags);
                  const nextOverdue = deal.nextStepDueDate ? isOverdue(deal.nextStepDueDate) : false;
                  const actDays = daysAgo(deal.lastActivityDate);
                  const stale = actDays !== null && actDays > 14;
                  return (
                    <tr key={deal.id} className={`border-b border-border/30 hover:bg-muted/30 cursor-pointer ${selectedIds.has(deal.id) ? "bg-primary/5" : ""}`} data-testid={`row-deal-${deal.id}`}>
                      <td className="p-3" onClick={e => { e.stopPropagation(); toggleSelect(deal.id); }}>
                        <BulkCheckbox checked={selectedIds.has(deal.id)} onChange={() => toggleSelect(deal.id)} testId={`checkbox-deal-${deal.id}`} />
                      </td>
                      <td className="p-3" onClick={() => setSelectedDeal(deal)}>
                        <p className="font-medium text-sm">{deal.title}</p>
                        {deal.forecastCategory && deal.forecastCategory !== "pipeline" && (
                          <span className="text-[10px] text-muted-foreground uppercase">{deal.forecastCategory}</span>
                        )}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground" onClick={() => setSelectedDeal(deal)}>{accountMap.get(deal.accountId) || "—"}</td>
                      <td className="p-3" onClick={() => setSelectedDeal(deal)}><Badge variant="outline" className={`text-[11px] ${getStageBadgeColor(deal.stage)}`}>{getStageLabel(deal.stage)}</Badge></td>
                      <td className="p-3 text-sm font-medium" onClick={() => setSelectedDeal(deal)}>${(deal.amount || deal.valueTotal || 0).toLocaleString()}</td>
                      <td className="p-3" onClick={() => setSelectedDeal(deal)}>
                        <p className={`text-xs max-w-[160px] truncate ${!deal.nextStep ? "text-yellow-400 italic" : ""}`}>
                          {deal.nextStep || "Not set"}
                        </p>
                      </td>
                      <td className="p-3" onClick={() => setSelectedDeal(deal)}>
                        <span className={`text-xs ${nextOverdue ? "text-red-400 font-semibold" : "text-muted-foreground"}`}>
                          {nextOverdue && "⚠ "}{formatDate(deal.nextStepDueDate)}
                        </span>
                      </td>
                      <td className="p-3" onClick={() => setSelectedDeal(deal)}>
                        <span className={`text-xs ${stale ? "text-amber-400 font-medium" : "text-muted-foreground"}`}>
                          {deal.lastActivityDate ? `${actDays}d ago` : "None"}
                        </span>
                      </td>
                      <td className="p-3" onClick={() => setSelectedDeal(deal)}>
                        <div className="flex gap-1">
                          {risks.slice(0, 2).map(f => (
                            <span key={f} className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded px-1.5 py-0.5">
                              {getRiskFlagLabel(f).split(" ")[0]}
                            </span>
                          ))}
                          {risks.length > 2 && <span className="text-[10px] text-muted-foreground">+{risks.length - 2}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {selectedDeal && (
        <DealDetailDialog
          deal={selectedDeal}
          accountName={accountMap.get(selectedDeal.accountId) || "Unknown"}
          onUpdate={(data) => {
            updateMutation.mutate({ id: selectedDeal.id, data });
            setSelectedDeal({ ...selectedDeal, ...data } as Opportunity);
          }}
          onClose={() => setSelectedDeal(null)}
        />
      )}
    </div>
  );
}

function DealDetailDialog({ deal, accountName, onUpdate, onClose }: {
  deal: Opportunity;
  accountName: string;
  onUpdate: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [editingNextStep, setEditingNextStep] = useState(false);
  const [nextStep, setNextStep] = useState(deal.nextStep || "");
  const [nextStepDue, setNextStepDue] = useState(deal.nextStepDueDate ? new Date(deal.nextStepDueDate).toISOString().split("T")[0] : "");

  const risks = parseRiskFlags(deal.riskFlags);
  const nextOverdue = deal.nextStepDueDate ? isOverdue(deal.nextStepDueDate) : false;
  const actDays = daysAgo(deal.lastActivityDate);

  return (
    <Dialog open onOpenChange={onClose}>
      <ExpandableDialogContent popupClassName="max-w-[95vw] sm:max-w-2xl max-h-[90vh]" contentClassName="overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-xl">{deal.title}</DialogTitle>
                <Link href={`/opportunities/${deal.id}`}>
                  <button className="inline-flex items-center gap-1 text-xs rounded-md border border-primary/20 bg-primary/5 text-primary px-2 py-0.5 cursor-pointer transition-colors hover:bg-primary/10 hover:border-primary/40" data-testid="button-view-opp-profile">
                    <ExternalLink className="h-3 w-3" /> Full Profile
                  </button>
                </Link>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{accountName}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-bold text-primary">${(deal.amount || deal.valueTotal || 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Close: {formatDate(deal.estCloseDate)}</p>
            </div>
          </div>
        </DialogHeader>

        <div className={`rounded-lg p-4 space-y-3 ${nextOverdue ? "bg-red-500/5 border border-red-500/20" : "bg-primary/5 border border-primary/10"}`}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Target className={`h-4 w-4 ${nextOverdue ? "text-red-400" : "text-primary"}`} />
              Next Step
              {nextOverdue && <span className="text-[10px] bg-red-500/20 text-red-400 rounded px-1.5 py-0.5 uppercase font-bold">Overdue</span>}
            </h3>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingNextStep(!editingNextStep)} data-testid="button-edit-next-step">
              {editingNextStep ? "Cancel" : "Edit"}
            </Button>
          </div>
          {editingNextStep ? (
            <div className="space-y-2">
              <Input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="What's the next action?" data-testid="input-next-step" />
              <div className="flex gap-2 items-center">
                <DatePicker value={nextStepDue} onChange={setNextStepDue} className="flex-1" data-testid="input-next-step-due" />
                <Button size="sm" onClick={() => { onUpdate({ nextStep, nextStepDueDate: nextStepDue ? new Date(nextStepDue) : null }); setEditingNextStep(false); }} data-testid="button-save-next-step">
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm">{deal.nextStep || "No next step set — add one now!"}</p>
              {deal.nextStepDueDate && (
                <p className={`text-xs mt-1 ${nextOverdue ? "text-red-400 font-semibold" : "text-muted-foreground"}`}>
                  Due: {formatDate(deal.nextStepDueDate)}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border/50 p-3 text-center">
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Last Activity</p>
            <p className={`text-lg font-bold ${actDays !== null && actDays > 14 ? "text-amber-400" : ""}`}>
              {actDays !== null ? `${actDays}d` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">{actDays !== null && actDays > 14 ? "Stale — follow up!" : "ago"}</p>
          </div>
          <div className="rounded-lg border border-border/50 p-3 text-center">
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Forecast</p>
            <p className="text-sm font-semibold capitalize">{deal.forecastCategory || "pipeline"}</p>
          </div>
          <div className="rounded-lg border border-border/50 p-3 text-center">
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Risk Flags</p>
            <p className={`text-lg font-bold ${risks.length > 0 ? "text-amber-400" : ""}`}>{risks.length}</p>
          </div>
        </div>

        {risks.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-400" /> Risk Flags</p>
            <div className="flex flex-wrap gap-1.5">
              {risks.map(f => (
                <span key={f} className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2.5 py-1">
                  {getRiskFlagLabel(f)}
                </span>
              ))}
            </div>
          </div>
        )}

        <Tabs defaultValue="details" className="mt-2">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="qualification">Qualification</TabsTrigger>
            <TabsTrigger value="outcome">Outcome</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="timeline" data-testid="tab-deal-timeline">Timeline</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Stage</Label>
                <Select value={deal.stage} onValueChange={(v) => onUpdate({ stage: v })}>
                  <SelectTrigger data-testid="select-deal-stage"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEAL_STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Forecast Category</Label>
                <Select value={deal.forecastCategory || "pipeline"} onValueChange={(v) => onUpdate({ forecastCategory: v })}>
                  <SelectTrigger data-testid="select-forecast"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORECAST_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Amount</Label>
                <p className="text-sm font-medium">${(deal.amount || deal.valueTotal || 0).toLocaleString()}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Close Date</Label>
                <p className="text-sm">{formatDate(deal.estCloseDate)}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Primary Value Driver</Label>
                <p className="text-sm capitalize">{deal.primaryValueDriver?.replace(/_/g, " ") || "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Competition</Label>
                <p className="text-sm capitalize">{deal.competition?.replace(/_/g, " ") || "Unknown"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Est. Pedestals</Label>
                <p className="text-sm">{deal.estimatedPedestalCount ?? "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Est. Slips Impacted</Label>
                <p className="text-sm">{deal.estimatedSlipsImpacted ?? "—"}</p>
              </div>
            </div>
            {deal.roiStory && (
              <div>
                <Label className="text-xs text-muted-foreground">ROI Story</Label>
                <p className="text-sm">{deal.roiStory}</p>
              </div>
            )}
            {deal.notes && (
              <div>
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <p className="text-sm">{deal.notes}</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="qualification" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">MEDDICC-lite qualification scoring</p>
            <div className="grid grid-cols-2 gap-4">
              <QualField label="Pain Clarity" value={deal.painClarity ?? 0} max={3} onChange={(v) => onUpdate({ painClarity: v })} />
              <div>
                <Label className="text-xs text-muted-foreground">Economic Buyer Identified</Label>
                <Select value={deal.economicBuyerIdentified || "unknown"} onValueChange={(v) => onUpdate({ economicBuyerIdentified: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Decision Criteria Known</Label>
                <Select value={deal.decisionCriteriaKnown || "unknown"} onValueChange={(v) => onUpdate({ decisionCriteriaKnown: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Decision Process Known</Label>
                <Select value={deal.decisionProcessKnown || "unknown"} onValueChange={(v) => onUpdate({ decisionProcessKnown: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Champion Identified</Label>
                <Select value={deal.championIdentified || "unknown"} onValueChange={(v) => onUpdate({ championIdentified: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strong">Strong</SelectItem>
                    <SelectItem value="weak">Weak</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Timeline</Label>
                <Select value={deal.timeline || "unknown"} onValueChange={(v) => onUpdate({ timeline: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="this_month">This Month</SelectItem>
                    <SelectItem value="this_quarter">This Quarter</SelectItem>
                    <SelectItem value="6_plus_months">6+ Months</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Risk Flags</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {RISK_FLAG_OPTIONS.map(option => {
                  const active = risks.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      className={`text-xs border rounded-full px-3 py-1 transition-colors ${active ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "border-border/50 text-muted-foreground hover:border-border"}`}
                      onClick={() => {
                        const updated = active ? risks.filter(r => r !== option.value) : [...risks, option.value];
                        onUpdate({ riskFlags: JSON.stringify(updated) });
                      }}
                      data-testid={`toggle-risk-${option.value}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="outcome" className="space-y-4 mt-4">
            {deal.stage === "closed_won" && (
              <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-4">
                <p className="text-sm font-medium text-green-400 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Closed Won</p>
                <p className="text-sm mt-2">{deal.closedWonNotes || "No win notes recorded."}</p>
              </div>
            )}
            {deal.stage === "closed_lost" && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 space-y-2">
                <p className="text-sm font-medium text-red-400 flex items-center gap-2"><XCircle className="h-4 w-4" /> Closed Lost</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs text-muted-foreground">Reason</Label><p className="text-sm">{deal.closedLostReason || "—"}</p></div>
                  <div><Label className="text-xs text-muted-foreground">Competitor</Label><p className="text-sm">{deal.closedLostCompetitor || "—"}</p></div>
                </div>
                {deal.closedLostNotes && <div><Label className="text-xs text-muted-foreground">Notes</Label><p className="text-sm">{deal.closedLostNotes}</p></div>}
              </div>
            )}
            {deal.stage !== "closed_won" && deal.stage !== "closed_lost" && (
              <p className="text-sm text-muted-foreground text-center py-4">Deal is still active. Outcome details appear when a deal is closed.</p>
            )}
          </TabsContent>

          <TabsContent value="notes" className="mt-4">
            <NotesPanel linkedObjectType="opportunity" linkedObjectId={deal.id} />
          </TabsContent>

          <TabsContent value="timeline" className="mt-4">
            <TimelineTab objectType="opportunity" objectId={deal.id} />
          </TabsContent>
        </Tabs>
      </ExpandableDialogContent>
    </Dialog>
  );
}

function QualField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-1 mt-1">
        {Array.from({ length: max + 1 }, (_, i) => (
          <button
            key={i}
            className={`w-8 h-8 rounded text-xs font-medium border transition-colors ${i <= value && value > 0 ? "bg-primary/20 text-primary border-primary/30" : "border-border/50 text-muted-foreground hover:border-border"}`}
            onClick={() => onChange(i)}
            data-testid={`qual-${label.toLowerCase().replace(/\s/g, "-")}-${i}`}
          >
            {i}
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateDealForm({ accounts, onSubmit, isPending }: { accounts: Account[]; onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    title: "", accountId: "", stage: "inbound_new",
    amount: "", nextStep: "", nextStepDueDate: "",
    estCloseDate: "", primaryValueDriver: "", notes: "",
  });

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSubmit({
        ...form,
        accountId: Number(form.accountId),
        amount: Number(form.amount) || 0,
        valueTotal: Number(form.amount) || 0,
        nextStepDueDate: form.nextStepDueDate ? new Date(form.nextStepDueDate) : null,
        estCloseDate: form.estCloseDate ? new Date(form.estCloseDate) : null,
      });
    }} className="space-y-4">
      <div><Label>Deal Name *</Label><Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="Company + use case" data-testid="input-deal-title" /></div>
      <div>
        <Label>Account *</Label>
        <Select value={form.accountId} onValueChange={(v) => setForm(f => ({ ...f, accountId: v }))}>
          <SelectTrigger data-testid="select-deal-account"><SelectValue placeholder="Select account" /></SelectTrigger>
          <SelectContent>
            {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Stage</Label>
          <Select value={form.stage} onValueChange={(v) => setForm(f => ({ ...f, stage: v }))}>
            <SelectTrigger data-testid="select-deal-stage"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEAL_STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Amount ($)</Label><Input type="number" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-deal-amount" /></div>
      </div>
      <div className="rounded-lg bg-primary/5 border border-primary/10 p-3 space-y-2">
        <Label className="text-xs font-semibold flex items-center gap-1"><Target className="h-3 w-3 text-primary" /> Next Step (required for velocity)</Label>
        <Input value={form.nextStep} onChange={(e) => setForm(f => ({ ...f, nextStep: e.target.value }))} placeholder="What's the next action?" data-testid="input-deal-next-step" />
        <DatePicker value={form.nextStepDueDate} onChange={(v) => setForm(f => ({ ...f, nextStepDueDate: v }))} data-testid="input-deal-next-step-due" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Est. Close Date</Label><DatePicker value={form.estCloseDate} onChange={(v) => setForm(f => ({ ...f, estCloseDate: v }))} data-testid="input-deal-close-date" /></div>
        <div>
          <Label>Value Driver</Label>
          <Select value={form.primaryValueDriver || "none"} onValueChange={(v) => setForm(f => ({ ...f, primaryValueDriver: v === "none" ? "" : v }))}>
            <SelectTrigger data-testid="select-value-driver"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Select</SelectItem>
              {VALUE_DRIVERS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} data-testid="input-deal-notes" /></div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-deal">{isPending ? "Creating..." : "Create Deal"}</Button>
    </form>
  );
}
