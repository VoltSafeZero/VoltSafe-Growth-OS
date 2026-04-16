import { useState, useRef, useEffect, useCallback } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, FileText, Loader2, Trash2, Download, Printer, ExternalLink,
  Package, Cloud, Tag, Globe, Mail, DollarSign, Send, CheckCircle2,
  AlertCircle, BarChart2, MoreHorizontal, Copy, Archive, Clock,
  XCircle, CheckSquare, ChevronDown, History, UserCheck,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { BulkActionsBar } from "@/components/bulk-actions-bar";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { Checkbox } from "@/components/ui/checkbox";
import { ExportButton } from "@/components/ui/export-button";
import { SortableHeader, useSortState } from "@/components/ui/sortable-header";
import type { Quote, Account } from "@shared/schema";
import { AttachmentsSection } from "@/components/attachments-section";

const statusColors: Record<string, string> = {
  draft:         "bg-gray-500/10 text-gray-400 border-gray-500/20",
  sent:          "bg-blue-500/10 text-blue-400 border-blue-500/20",
  follow_up_due: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  accepted:      "bg-green-500/10 text-green-400 border-green-500/20",
  declined:      "bg-red-500/10 text-red-400 border-red-500/20",
  rejected:      "bg-red-500/10 text-red-400 border-red-500/20",
  expired:       "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  archived:      "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", sent: "Sent", follow_up_due: "Follow-up Due",
  accepted: "Accepted", declined: "Declined", expired: "Expired", archived: "Archived",
};

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "follow_up_due", label: "Awaiting" },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Declined" },
  { key: "expired", label: "Expired" },
];

type LineItem = {
  name: string;
  category: string;
  description: string;
  qty: number;
  listPrice: number;
  discountPercent: number;
  unitPrice: number;
  unitType: string;
  lineTotal: number;
  isRecurring: boolean;
  sortOrder: number;
};

type ServiceLine = { role: string; hoursEstimate: number; hourlyRate: number; subtotal: number };

const COUNTRY_OPTIONS = [
  { code: "US", label: "United States", currency: "USD", taxRate: 0, taxLabel: "" },
  { code: "CA", label: "Canada", currency: "CAD", taxRate: 0.05, taxLabel: "GST 5%" },
  { code: "MX", label: "Mexico", currency: "MXN", taxRate: 0.16, taxLabel: "IVA 16%" },
  { code: "GB", label: "United Kingdom", currency: "GBP", taxRate: 0.20, taxLabel: "VAT 20%" },
  { code: "AU", label: "Australia", currency: "AUD", taxRate: 0.10, taxLabel: "GST 10%" },
  { code: "EU", label: "European Union", currency: "EUR", taxRate: 0.21, taxLabel: "VAT 21%" },
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", CAD: "CA$", MXN: "MX$", GBP: "£", EUR: "€", AUD: "A$",
};

function currSym(c: string) { return CURRENCY_SYMBOLS[c] || "$"; }

function fmtMoney(n: number, currency: string) {
  return `${currSym(currency)}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface CatalogItem {
  sku: string;
  name: string;
  description: string;
  category: "hardware" | "saas";
  listPrice: number;
  unitType: string;
  isRecurring: boolean;
}

const HARDWARE_CATALOG: CatalogItem[] = [
  { sku: "VS-P30A1", name: "VoltSafe Pedestal 30A/120V (1-outlet)", description: "Single-outlet 30A shore power pedestal with SmartSwitch", category: "hardware", listPrice: 795, unitType: "unit", isRecurring: false },
  { sku: "VS-P30A2", name: "VoltSafe Pedestal 30A/120V (2-outlet)", description: "Dual-outlet 30A shore power pedestal with SmartSwitch", category: "hardware", listPrice: 945, unitType: "unit", isRecurring: false },
  { sku: "VS-P50A1", name: "VoltSafe Pedestal 50A/240V (1-outlet)", description: "Single-outlet 50A shore power pedestal with SmartSwitch", category: "hardware", listPrice: 1095, unitType: "unit", isRecurring: false },
  { sku: "VS-P50A2", name: "VoltSafe Pedestal 50A/240V (2-outlet)", description: "Dual-outlet 50A shore power pedestal with SmartSwitch", category: "hardware", listPrice: 1345, unitType: "unit", isRecurring: false },
  { sku: "VS-P3050", name: "VoltSafe Pedestal 30A+50A Combo", description: "Combination 30A & 50A shore power pedestal", category: "hardware", listPrice: 1495, unitType: "unit", isRecurring: false },
  { sku: "VS-GW", name: "VoltSafe Gateway (per marina)", description: "Marina edge gateway — connects pedestals to cloud platform", category: "hardware", listPrice: 2400, unitType: "unit", isRecurring: false },
  { sku: "VS-CAB-30", name: "Shore Power Cable 30A 25ft", description: "NEMA TT-30 shore power cable, 25 foot", category: "hardware", listPrice: 145, unitType: "unit", isRecurring: false },
  { sku: "VS-CAB-50", name: "Shore Power Cable 50A 25ft", description: "NEMA 14-50 shore power cable, 25 foot", category: "hardware", listPrice: 195, unitType: "unit", isRecurring: false },
  { sku: "VS-GFI-30", name: "GFI Protection Module 30A", description: "Ground fault interrupter protection module for 30A circuits", category: "hardware", listPrice: 245, unitType: "unit", isRecurring: false },
  { sku: "VS-GFI-50", name: "GFI Protection Module 50A", description: "Ground fault interrupter protection module for 50A circuits", category: "hardware", listPrice: 295, unitType: "unit", isRecurring: false },
];

const SOFTWARE_CATALOG: CatalogItem[] = [
  { sku: "VS-CORE", name: "VoltSafe Core Platform (per slip/yr)", description: "Real-time monitoring, remote switching, usage analytics", category: "saas", listPrice: 120, unitType: "slip/yr", isRecurring: true },
  { sku: "VS-ANALYTICS", name: "VoltSafe Analytics Module (per slip/yr)", description: "Advanced energy analytics, benchmarking, reporting", category: "saas", listPrice: 60, unitType: "slip/yr", isRecurring: true },
  { sku: "VS-COMPLIANCE", name: "VoltSafe Compliance Engine (per marina/yr)", description: "ABYC/NFPA 303 compliance tracking, automated inspection logs", category: "saas", listPrice: 3600, unitType: "marina/yr", isRecurring: true },
  { sku: "VS-BILLING", name: "VoltSafe Smart Billing (per marina/yr)", description: "Automated power billing, tenant invoicing, payment integrations", category: "saas", listPrice: 2400, unitType: "marina/yr", isRecurring: true },
  { sku: "VS-API", name: "VoltSafe API Access (per marina/yr)", description: "REST API & webhooks for marina management system integration", category: "saas", listPrice: 1800, unitType: "marina/yr", isRecurring: true },
  { sku: "VS-INSTALL", name: "Professional Installation (per pedestal)", description: "Factory-certified installation, commissioning, and testing", category: "saas", listPrice: 350, unitType: "unit", isRecurring: false },
  { sku: "VS-COMMISSION", name: "System Commissioning (per site)", description: "Full system bring-up, staff training, go-live support", category: "saas", listPrice: 2500, unitType: "site", isRecurring: false },
];

function makeLineItem(catalog: CatalogItem, qty = 1, discPct = 0): LineItem {
  const unitPrice = catalog.listPrice * (1 - discPct / 100);
  return {
    name: `${catalog.sku} — ${catalog.name}`,
    description: catalog.description,
    category: catalog.category,
    qty,
    listPrice: catalog.listPrice,
    discountPercent: discPct,
    unitPrice,
    unitType: catalog.unitType,
    lineTotal: unitPrice * qty,
    isRecurring: catalog.isRecurring,
    sortOrder: 0,
  };
}

export default function QuotesPage({ canEdit = true }: { canEdit?: boolean }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDefaults, setComposeDefaults] = useState<{ to?: string; subject?: string; body?: string; quoteId?: number }>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [transitionDialog, setTransitionDialog] = useState<{ quoteId: number; toStatus: string; quoteNumber: string } | null>(null);
  const { toast } = useToast();
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const { sort, handleSort } = useSortState();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get("status");
    const selectedId = params.get("selected");
    if (statusParam) setStatusFilter(statusParam);
    if (selectedId) setSelectedQuote(Number(selectedId));
    if (statusParam || selectedId) window.history.replaceState({}, "", "/quotes");
  }, []);

  const PAGE_SIZE = 100;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<{ data: Quote[]; total: number; page: number; totalPages: number }>({
    queryKey: ["/api/quotes", { status: statusFilter === "all" ? "" : statusFilter, sortBy: sort.sortBy, sortOrder: sort.sortOrder }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (sort.sortBy) { params.set("sortBy", sort.sortBy); params.set("sortOrder", sort.sortOrder); }
      params.set("page", String(pageParam));
      params.set("limit", String(PAGE_SIZE));
      const res = await fetch(`/api/quotes?${params}`, { credentials: "include" });
      return res.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });

  const allQuotes = data?.pages.flatMap(p => p.data) || [];
  const totalCount = data?.pages[0]?.total || 0;

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

  const { data: accountsData } = useQuery<{ data: Account[] }>({
    queryKey: ["/api/accounts", "all"],
    queryFn: async () => {
      const res = await fetch("/api/accounts?limit=200");
      return res.json();
    },
  });

  const accountMap = new Map(accountsData?.data?.map(a => [a.id, a.name]) || []);

  const createMutation = useMutation({
    mutationFn: async (d: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/quotes", d);
      return res.json();
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      setCreateOpen(false);
      toast({ title: "Quote created", description: `${(created as any).quoteNumber} — XLSX & HTML invoice generated` });
      if (created?.id) setSelectedQuote(created.id);
    },
    onError: () => toast({ title: "Failed to create quote", variant: "destructive" }),
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ quoteId, toStatus }: { quoteId: number; toStatus: string }) => {
      const res = await apiRequest("PATCH", `/api/quotes/${quoteId}/transition`, { toStatus });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      setTransitionDialog(null);
      toast({ title: "Quote status updated" });
    },
    onError: (err: any) => toast({ title: "Transition failed", description: err.message, variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (quoteId: number) => {
      const res = await apiRequest("POST", `/api/quotes/${quoteId}/duplicate`, {});
      return res.json();
    },
    onSuccess: (newQuote) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({ title: "Quote duplicated", description: `${newQuote?.quote_number ?? "New quote"} created as draft` });
    },
    onError: () => toast({ title: "Duplicate failed", variant: "destructive" }),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ quoteIds, status }: { quoteIds: number[]; status: string }) => {
      const res = await apiRequest("POST", "/api/quotes/bulk/status", { quoteIds, status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      setSelectedIds(new Set());
      toast({ title: "Bulk status updated" });
    },
  });

  // KPI derived data
  const draft = allQuotes.filter(q => q.status === "draft");
  const sent = allQuotes.filter(q => q.status === "sent");
  const accepted = allQuotes.filter(q => q.status === "accepted");
  const pipelineValue = [...draft, ...sent].reduce((s, q) => s + (q.total || 0), 0);
  const acceptedValue = accepted.reduce((s, q) => s + (q.total || 0), 0);

  const kpiCards = [
    {
      label: "Pipeline Value",
      value: pipelineValue > 0 ? (pipelineValue >= 1000 ? `${currSym(draft[0]?.currency || sent[0]?.currency || "USD")}${(pipelineValue / 1000).toFixed(0)}k` : fmtMoney(pipelineValue, draft[0]?.currency || "USD")) : "$0",
      icon: BarChart2,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    { label: "Draft", value: allQuotes.filter(q => q.status === "draft").length, icon: FileText, color: "text-gray-400", bg: "bg-gray-500/10" },
    { label: "Sent", value: allQuotes.filter(q => q.status === "sent").length, icon: Send, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Accepted", value: allQuotes.filter(q => q.status === "accepted").length, icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/10" },
    { label: "Rejected", value: allQuotes.filter(q => q.status === "rejected").length, icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10" },
    {
      label: "Won Value",
      value: acceptedValue > 0 ? (acceptedValue >= 1000 ? `${currSym(accepted[0]?.currency || "USD")}${(acceptedValue / 1000).toFixed(0)}k` : fmtMoney(acceptedValue, accepted[0]?.currency || "USD")) : "$0",
      icon: DollarSign,
      color: "text-green-400",
      bg: "bg-green-500/10",
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Quotes</h1>
          <p className="text-muted-foreground mt-1 text-sm">Pro forma invoices with VoltSafe product catalog, multi-currency support, and XLSX/HTML export.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            endpoint={`/api/quotes/export?${new URLSearchParams({ ...(statusFilter !== "all" ? { status: statusFilter } : {}) }).toString()}`}
            filename="quotes_export.csv"
          />
          {canEdit && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground" data-testid="button-create-quote">
                  <Plus className="mr-2 h-4 w-4" /> New Quote
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[96vw] sm:max-w-5xl max-h-[92vh] overflow-y-auto p-0">
                <QuoteBuilder accounts={accountsData?.data || []} onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      {!isLoading && allQuotes.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {kpiCards.map(card => (
            <Card key={card.label} className="border-border/50 bg-card/50" data-testid={`card-quote-kpi-${card.label.toLowerCase().replace(/\s+/g,'-')}`}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-6 h-6 rounded-md ${card.bg} flex items-center justify-center shrink-0`}>
                    <card.icon className={`w-3 h-3 ${card.color}`} />
                  </div>
                  <span className="text-[11px] text-muted-foreground truncate">{card.label}</span>
                </div>
                <div className="text-lg font-bold">{card.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Status Tabs */}
      <div className="flex gap-1 flex-wrap" data-testid="quote-status-tabs">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setStatusFilter(tab.key); setSelectedIds(new Set()); }}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
              statusFilter === tab.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
            }`}
            data-testid={`tab-status-${tab.key}`}
          >
            {tab.label}
            {tab.key !== "all" && allQuotes.filter(q => q.status === tab.key).length > 0 && (
              <span className="ml-1.5 opacity-70">({allQuotes.filter(q => q.status === tab.key).length})</span>
            )}
          </button>
        ))}
      </div>

      <SavedViewsBar pageKey="quotes" />

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <BulkActionsBar
          selectedCount={selectedIds.size}
          totalCount={allQuotes.length}
          onSelectAll={() => setSelectedIds(new Set(allQuotes.map(q => q.id)))}
          onClearSelection={() => setSelectedIds(new Set())}
          entityLabel="quote"
          actions={[
            {
              key: "mark_sent",
              label: "Mark Sent",
              icon: Send,
              testId: "bulk-mark-sent",
              isPending: bulkStatusMutation.isPending,
              onClick: () => bulkStatusMutation.mutate({ quoteIds: Array.from(selectedIds), status: "sent" }),
            },
            {
              key: "mark_accepted",
              label: "Mark Accepted",
              icon: CheckCircle2,
              testId: "bulk-mark-accepted",
              isPending: bulkStatusMutation.isPending,
              onClick: () => bulkStatusMutation.mutate({ quoteIds: Array.from(selectedIds), status: "accepted" }),
            },
            {
              key: "mark_declined",
              label: "Mark Declined",
              icon: XCircle,
              testId: "bulk-mark-declined",
              isPending: bulkStatusMutation.isPending,
              onClick: () => bulkStatusMutation.mutate({ quoteIds: Array.from(selectedIds), status: "declined" }),
            },
            {
              key: "archive",
              label: "Archive",
              icon: Archive,
              testId: "bulk-archive",
              isPending: bulkStatusMutation.isPending,
              onClick: () => bulkStatusMutation.mutate({ quoteIds: Array.from(selectedIds), status: "archived" }),
            },
          ]}
        />
      )}

      {isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="p-3 sm:p-4 w-10">
                    <Checkbox
                      checked={allQuotes.length > 0 && selectedIds.size === allQuotes.length}
                      onCheckedChange={(checked) => setSelectedIds(checked ? new Set(allQuotes.map(q => q.id)) : new Set())}
                      data-testid="checkbox-select-all-quotes"
                    />
                  </th>
                  <SortableHeader label="Quote #" sortKey="quoteNumber" sort={sort} onSort={handleSort} />
                  <SortableHeader label="Customer / Account" sortKey="customerName" sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                  <SortableHeader label="Status" sortKey="status" sort={sort} onSort={handleSort} />
                  <SortableHeader label="Total" sortKey="total" sort={sort} onSort={handleSort} align="right" />
                  <SortableHeader label="Sent" sortKey="sentAt" sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                  <SortableHeader label="Expires" sortKey="validUntil" sort={sort} onSort={handleSort} className="hidden xl:table-cell" />
                  <th className="p-3 sm:p-4 w-28 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {allQuotes.map(quote => {
                  const isExpired = quote.validUntil && new Date(quote.validUntil) < new Date() && !["accepted","declined","archived"].includes(quote.status);
                  const account = accountMap.get(quote.accountId ?? 0);
                  return (
                    <tr
                      key={quote.id}
                      className={`border-b border-border/30 hover:bg-muted/30 cursor-pointer ${selectedIds.has(quote.id) ? "bg-primary/5" : ""}`}
                      onClick={() => setSelectedQuote(quote.id)}
                      data-testid={`row-quote-${quote.id}`}
                    >
                      <td className="p-3 sm:p-4" onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(quote.id)}
                          onCheckedChange={(checked) => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              checked ? next.add(quote.id) : next.delete(quote.id);
                              return next;
                            });
                          }}
                          data-testid={`checkbox-quote-${quote.id}`}
                        />
                      </td>
                      <td className="p-3 sm:p-4 font-medium font-mono text-sm">{quote.quoteNumber}</td>
                      <td className="p-3 sm:p-4 text-sm hidden md:table-cell">
                        <div className="truncate max-w-[180px]">
                          {(quote as any).customerName || account || <span className="text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="p-3 sm:p-4">
                        <Badge variant="outline" className={statusColors[quote.status] || ""}>
                          {STATUS_LABELS[quote.status] ?? quote.status}
                        </Badge>
                        {isExpired && <span className="ml-1 text-[10px] text-yellow-500">⚠ expired</span>}
                      </td>
                      <td className="p-3 sm:p-4 text-right font-medium">{fmtMoney(quote.total || 0, quote.currency)}</td>
                      <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden lg:table-cell">
                        {(quote as any).sentAt ? new Date((quote as any).sentAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden xl:table-cell">
                        {quote.validUntil ? <span className={isExpired ? "text-yellow-500" : ""}>{new Date(quote.validUntil).toLocaleDateString()}</span> : "—"}
                      </td>
                      <td className="p-3 sm:p-4 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1 justify-end items-center">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => window.open(`/api/quotes/${quote.id}/print`, "_blank")} title="View Invoice" data-testid={`button-print-${quote.id}`}>
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-400 hover:text-blue-300" onClick={() => {
                            setComposeDefaults({ to: (quote as any).customerEmail || "", subject: `VoltSafe Quote ${quote.quoteNumber}`, body: `Hi,\n\nPlease find attached your VoltSafe quote ${quote.quoteNumber} for ${fmtMoney(quote.total || 0, quote.currency)}.\n\nPlease don't hesitate to reach out with any questions.\n\nBest regards,\nTrevor\nVoltSafe Inc.`, quoteId: quote.id });
                            setComposeOpen(true);
                          }} title="Send via Gmail" data-testid={`button-send-gmail-${quote.id}`}>
                            <Mail className="h-3.5 w-3.5" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`button-actions-${quote.id}`}>
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {quote.status === "draft" && (
                                <DropdownMenuItem onClick={() => setTransitionDialog({ quoteId: quote.id, toStatus: "sent", quoteNumber: quote.quoteNumber })} data-testid={`action-mark-sent-${quote.id}`}>
                                  <Send className="h-3.5 w-3.5 mr-2 text-blue-400" /> Mark Sent
                                </DropdownMenuItem>
                              )}
                              {["sent","follow_up_due"].includes(quote.status) && (
                                <>
                                  <DropdownMenuItem onClick={() => setTransitionDialog({ quoteId: quote.id, toStatus: "accepted", quoteNumber: quote.quoteNumber })} data-testid={`action-mark-accepted-${quote.id}`}>
                                    <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-green-400" /> Mark Accepted
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setTransitionDialog({ quoteId: quote.id, toStatus: "declined", quoteNumber: quote.quoteNumber })} data-testid={`action-mark-declined-${quote.id}`}>
                                    <XCircle className="h-3.5 w-3.5 mr-2 text-red-400" /> Mark Declined
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setTransitionDialog({ quoteId: quote.id, toStatus: "expired", quoteNumber: quote.quoteNumber })} data-testid={`action-mark-expired-${quote.id}`}>
                                    <Clock className="h-3.5 w-3.5 mr-2 text-yellow-400" /> Mark Expired
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuItem onClick={() => duplicateMutation.mutate(quote.id)} data-testid={`action-duplicate-${quote.id}`}>
                                <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                              </DropdownMenuItem>
                              {(quote as any).xlsxAssetId && (
                                <DropdownMenuItem onClick={() => window.open(`/api/quotes/${quote.id}/download/xlsx`, "_blank")} data-testid={`action-download-xlsx-${quote.id}`}>
                                  <Download className="h-3.5 w-3.5 mr-2" /> Download XLSX
                                </DropdownMenuItem>
                              )}
                              {!["archived"].includes(quote.status) && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-muted-foreground" onClick={() => setTransitionDialog({ quoteId: quote.id, toStatus: "archived", quoteNumber: quote.quoteNumber })} data-testid={`action-archive-${quote.id}`}>
                                    <Archive className="h-3.5 w-3.5 mr-2" /> Archive
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {allQuotes.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No quotes found</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between py-2">
        <p className="text-sm text-muted-foreground">{allQuotes.length.toLocaleString()} of {totalCount.toLocaleString()} quotes loaded</p>
        {isFetchingNextPage && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading more...</div>}
      </div>
      <div ref={scrollSentinelRef} className="h-4" />

      {selectedQuote && (
        <QuoteDetailDialog
          quoteId={selectedQuote}
          accountMap={accountMap}
          onClose={() => setSelectedQuote(null)}
          onSendViaGmail={(q) => {
            setComposeDefaults({
              to: q.customerEmail || "",
              subject: `VoltSafe Quote ${q.quoteNumber}`,
              body: `Hi,\n\nPlease find attached your VoltSafe quote ${q.quoteNumber} for ${fmtMoney(q.total || 0, q.currency)}.\n\nPlease don't hesitate to reach out with any questions.\n\nBest regards,\nTrevor\nVoltSafe Inc.`,
              quoteId: q.id,
            });
            setSelectedQuote(null);
            setComposeOpen(true);
          }}
        />
      )}

      {composeOpen && (
        <QuoteEmailCompose
          defaults={composeDefaults}
          onClose={() => setComposeOpen(false)}
        />
      )}

      {/* Status Transition Confirmation */}
      {transitionDialog && (
        <AlertDialog open onOpenChange={() => setTransitionDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {transitionDialog.toStatus === "accepted" ? "Mark Quote Accepted" :
                 transitionDialog.toStatus === "declined" ? "Mark Quote Declined" :
                 transitionDialog.toStatus === "expired"  ? "Mark Quote Expired" :
                 transitionDialog.toStatus === "sent"     ? "Mark Quote Sent" :
                 transitionDialog.toStatus === "archived" ? "Archive Quote" :
                 `Set status to ${transitionDialog.toStatus}`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {transitionDialog.toStatus === "accepted"
                  ? `Mark ${transitionDialog.quoteNumber} as accepted? This will log the event and optionally create an onboarding task.`
                  : transitionDialog.toStatus === "declined"
                  ? `Mark ${transitionDialog.quoteNumber} as declined? This will record the outcome in the audit trail.`
                  : transitionDialog.toStatus === "sent"
                  ? `Mark ${transitionDialog.quoteNumber} as sent? A follow-up task will be created automatically.`
                  : `Update ${transitionDialog.quoteNumber} to "${transitionDialog.toStatus}"?`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => transitionMutation.mutate({ quoteId: transitionDialog.quoteId, toStatus: transitionDialog.toStatus })}
                disabled={transitionMutation.isPending}
                data-testid="button-confirm-transition"
              >
                {transitionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function QuoteEmailCompose({ defaults, onClose }: { defaults: { to?: string; subject?: string; body?: string; quoteId?: number }; onClose: () => void }) {
  const [to, setTo] = useState(defaults.to || "");
  const [subject, setSubject] = useState(defaults.subject || "");
  const [body, setBody] = useState(defaults.body || "");
  const [attachXlsx, setAttachXlsx] = useState(true);
  const { toast } = useToast();

  const { data: quoteData } = useQuery<any>({
    queryKey: ["/api/quotes", defaults.quoteId],
    queryFn: async () => {
      if (!defaults.quoteId) return null;
      const res = await fetch(`/api/quotes/${defaults.quoteId}`);
      return res.json();
    },
    enabled: !!defaults.quoteId,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const attachmentIds: number[] = [];
      if (quoteData && attachXlsx && quoteData.xlsxAssetId) attachmentIds.push(quoteData.xlsxAssetId);
      if (quoteData && quoteData.htmlAssetId) attachmentIds.push(quoteData.htmlAssetId);
      const res = await apiRequest("POST", "/api/gmail/send", {
        to, subject, body: `<pre style="font-family:sans-serif;white-space:pre-wrap">${body}</pre>`, attachmentIds,
      });
      return res.json();
    },
    onSuccess: () => { toast({ title: "Quote email sent" }); onClose(); },
    onError: (err: any) => toast({ title: "Failed to send", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="w-4 h-4 text-blue-400" /> Send Quote via Gmail</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">To</Label><Input value={to} onChange={e => setTo(e.target.value)} className="mt-1" placeholder="recipient@email.com" data-testid="input-compose-to" /></div>
          <div><Label className="text-xs">Subject</Label><Input value={subject} onChange={e => setSubject(e.target.value)} className="mt-1" data-testid="input-compose-subject" /></div>
          <div><Label className="text-xs">Message</Label><Textarea value={body} onChange={e => setBody(e.target.value)} rows={7} className="mt-1 text-sm" data-testid="input-compose-body" /></div>
          {quoteData && (quoteData.xlsxAssetId || quoteData.htmlAssetId) && (
            <div className="rounded-lg border border-border/50 bg-secondary/10 p-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Attachments</p>
              {quoteData.xlsxAssetId && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={attachXlsx} onChange={e => setAttachXlsx(e.target.checked)} className="rounded" data-testid="checkbox-attach-xlsx" />
                  <span className="text-sm">{quoteData.quoteNumber}.xlsx</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">XLSX</Badge>
                </label>
              )}
              {quoteData.htmlAssetId && (
                <div className="flex items-center gap-2">
                  <input type="checkbox" defaultChecked disabled className="rounded opacity-50" />
                  <span className="text-sm text-muted-foreground">{quoteData.quoteNumber}-Invoice.html</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">HTML</Badge>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="bg-primary text-primary-foreground" disabled={sendMutation.isPending || !to} onClick={() => sendMutation.mutate()} data-testid="button-send-quote-email">
              {sendMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Sending...</> : <><Send className="w-3.5 h-3.5 mr-2" />Send</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QuoteDetailDialog({ quoteId, accountMap, onClose, onSendViaGmail }: {
  quoteId: number;
  accountMap: Map<number, string>;
  onClose: () => void;
  onSendViaGmail: (q: any) => void;
}) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/quotes", quoteId],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/${quoteId}`);
      return res.json();
    },
  });

  const [transitionTo, setTransitionTo] = useState<string | null>(null);
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: async (d: Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/quotes/${quoteId}`, d);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/quotes"] }),
  });

  const transitionMutation = useMutation({
    mutationFn: async (toStatus: string) => {
      const res = await apiRequest("PATCH", `/api/quotes/${quoteId}/transition`, { toStatus });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
      setTransitionTo(null);
      toast({ title: "Status updated" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/quotes/${quoteId}/duplicate`, {});
      return res.json();
    },
    onSuccess: (newQ) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({ title: "Duplicated", description: `${newQ?.quote_number ?? "New quote"} created as draft` });
    },
  });

  const { data: history } = useQuery<any[]>({
    queryKey: ["/api/quotes", quoteId, "status-history"],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/${quoteId}/status-history`);
      return res.json();
    },
  });

  if (isLoading || !data) return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent><Skeleton className="h-48 w-full" /></DialogContent>
    </Dialog>
  );

  const q = data;
  const sym = currSym(q.currency);
  const hwItems = (q.lineItems || []).filter((i: any) => i.category === "hardware");
  const swItems = (q.lineItems || []).filter((i: any) => i.category === "saas" || i.category === "software");
  const otherItems = (q.lineItems || []).filter((i: any) => i.category !== "hardware" && i.category !== "saas" && i.category !== "software");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[96vw] sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <DialogTitle className="text-xl font-mono">{q.quoteNumber}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                {q.customerName || accountMap.get(q.accountId) || "—"} · v{q.version} · {q.currency}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => onSendViaGmail(q)} className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10" data-testid="button-send-gmail">
                <Mail className="h-3.5 w-3.5 mr-1" /> Send via Gmail
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.open(`/api/quotes/${quoteId}/print`, "_blank")} data-testid="button-view-invoice">
                <Printer className="h-3.5 w-3.5 mr-1" /> Invoice
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.open(`/api/quotes/${quoteId}/download/xlsx`, "_blank")} data-testid="button-download-xlsx">
                <Download className="h-3.5 w-3.5 mr-1" /> XLSX
              </Button>
              <Badge variant="outline" className={statusColors[q.status] || ""}>{q.status}</Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {q.customerName && <div><Label className="text-xs text-muted-foreground">Customer</Label><p className="text-sm font-medium">{q.customerName}</p></div>}
            {q.customerEmail && <div><Label className="text-xs text-muted-foreground">Email</Label><p className="text-sm">{q.customerEmail}</p></div>}
            {q.customerPhone && <div><Label className="text-xs text-muted-foreground">Phone</Label><p className="text-sm">{q.customerPhone}</p></div>}
            {q.marinaAddress && <div className="col-span-2"><Label className="text-xs text-muted-foreground">Marina Address</Label><p className="text-sm whitespace-pre-wrap">{q.marinaAddress}</p></div>}
            {q.validUntil && <div><Label className="text-xs text-muted-foreground">Valid Until</Label><p className="text-sm">{new Date(q.validUntil).toLocaleDateString()}</p></div>}
            {q.entitlementNumber && <div><Label className="text-xs text-muted-foreground">Entitlement #</Label><p className="text-sm font-mono">{q.entitlementNumber}</p></div>}
            {q.slipsCount && <div><Label className="text-xs text-muted-foreground">Slip Count</Label><p className="text-sm">{q.slipsCount}</p></div>}
            <div className="col-span-2 sm:col-span-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={statusColors[q.status] || ""}>{STATUS_LABELS[q.status] ?? q.status}</Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" data-testid="select-quote-status">
                      Change <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    {q.status === "draft" && <DropdownMenuItem onClick={() => transitionMutation.mutate("sent")}><Send className="h-3.5 w-3.5 mr-2 text-blue-400" />Mark Sent</DropdownMenuItem>}
                    {["sent","follow_up_due"].includes(q.status) && <>
                      <DropdownMenuItem onClick={() => transitionMutation.mutate("accepted")}><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-green-400" />Mark Accepted</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => transitionMutation.mutate("declined")}><XCircle className="h-3.5 w-3.5 mr-2 text-red-400" />Mark Declined</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => transitionMutation.mutate("expired")}><Clock className="h-3.5 w-3.5 mr-2 text-yellow-400" />Mark Expired</DropdownMenuItem>
                    </>}
                    {!["archived"].includes(q.status) && <><DropdownMenuSeparator /><DropdownMenuItem className="text-muted-foreground" onClick={() => transitionMutation.mutate("archived")}><Archive className="h-3.5 w-3.5 mr-2" />Archive</DropdownMenuItem></>}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => duplicateMutation.mutate()} data-testid="button-duplicate-quote">
                  <Copy className="h-3 w-3 mr-1" /> Duplicate
                </Button>
              </div>
            </div>
          </div>

          {hwItems.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Package className="h-4 w-4 text-green-500" />
                <h3 className="text-sm font-semibold">Hardware</h3>
              </div>
              <LineItemTable items={hwItems} currency={q.currency} />
            </div>
          )}

          {swItems.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Cloud className="h-4 w-4 text-blue-500" />
                <h3 className="text-sm font-semibold">Software / SaaS</h3>
              </div>
              <LineItemTable items={swItems} currency={q.currency} />
            </div>
          )}

          {otherItems.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Other</h3>
              <LineItemTable items={otherItems} currency={q.currency} />
            </div>
          )}

          <Separator />

          <div className="flex justify-end">
            <div className="space-y-1.5 text-right w-64">
              {(q.hardwareSubtotal > 0) && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Hardware</span><span>{fmtMoney(q.hardwareSubtotal, q.currency)}</span></div>}
              {(q.softwareSubtotal > 0) && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Software</span><span>{fmtMoney(q.softwareSubtotal, q.currency)}</span></div>}
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{fmtMoney(q.subtotal || 0, q.currency)}</span></div>
              {(q.taxRate > 0) && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tax ({((q.taxRate || 0) * 100).toFixed(0)}%)</span><span>{fmtMoney(q.taxAmount || 0, q.currency)}</span></div>}
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Total</span><span>{fmtMoney(q.total || 0, q.currency)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 bg-green-500/5 border border-green-500/20 rounded-lg p-4">
            <div className="text-center">
              <p className="text-lg font-bold text-green-600">{q.paymentTermDeposit}%</p>
              <p className="text-xs text-muted-foreground">Deposit</p>
              <p className="text-sm font-medium">{fmtMoney((q.total || 0) * (q.paymentTermDeposit || 10) / 100, q.currency)}</p>
            </div>
            <div className="text-center border-x border-green-500/20">
              <p className="text-lg font-bold text-green-600">{q.paymentTermProduction}%</p>
              <p className="text-xs text-muted-foreground">Production</p>
              <p className="text-sm font-medium">{fmtMoney((q.total || 0) * (q.paymentTermProduction || 40) / 100, q.currency)}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-green-600">{q.paymentTermInstall}%</p>
              <p className="text-xs text-muted-foreground">Installation</p>
              <p className="text-sm font-medium">{fmtMoney((q.total || 0) * (q.paymentTermInstall || 50) / 100, q.currency)}</p>
            </div>
          </div>

          {q.notes && <div><Label className="text-xs text-muted-foreground">Notes</Label><p className="text-sm whitespace-pre-wrap mt-1">{q.notes}</p></div>}
          {q.assumptions && <div><Label className="text-xs text-muted-foreground">Assumptions</Label><p className="text-sm whitespace-pre-wrap mt-1">{q.assumptions}</p></div>}
          {q.exclusions && <div><Label className="text-xs text-muted-foreground">Exclusions</Label><p className="text-sm whitespace-pre-wrap mt-1">{q.exclusions}</p></div>}

          <Separator className="my-2" />
          <AttachmentsSection objectType="quote" objectId={q.id} />
          <Separator className="my-2" />

          {/* Status History */}
          {history && history.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Status History</Label>
              </div>
              <div className="space-y-1.5">
                {history.slice(0, 5).map((entry: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0 mt-0.5">{new Date(entry.created_at).toLocaleDateString()}</span>
                    <span className="text-muted-foreground">→</span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusColors[entry.to_status] || ""}`}>{STATUS_LABELS[entry.to_status] ?? entry.to_status}</Badge>
                    {entry.from_status && <span className="text-muted-foreground">from {STATUS_LABELS[entry.from_status] ?? entry.from_status}</span>}
                    {entry.user_name && <span className="text-muted-foreground ml-auto shrink-0">{entry.user_name}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(q.htmlAssetId || q.xlsxAssetId) && (
            <div className="flex gap-3 pt-1 border-t border-border/50">
              <p className="text-xs text-muted-foreground self-center">Files available — attach via Send via Gmail</p>
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" size="sm" onClick={() => window.open(`/api/quotes/${quoteId}/print`, "_blank")} data-testid="button-view-html">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> HTML Invoice
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.open(`/api/quotes/${quoteId}/download/xlsx`, "_blank")} data-testid="button-download-xlsx-detail">
                  <Download className="h-3.5 w-3.5 mr-1" /> Download XLSX
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LineItemTable({ items, currency }: { items: any[]; currency: string }) {
  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50 bg-muted/30">
            <th className="text-left p-2 pl-3">Item</th>
            <th className="text-right p-2">Qty</th>
            <th className="text-right p-2">List</th>
            <th className="text-right p-2">Disc</th>
            <th className="text-right p-2">Unit Price</th>
            <th className="text-right p-2 pr-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: any, i: number) => (
            <tr key={i} className="border-b border-border/20 last:border-0">
              <td className="p-2 pl-3">
                <p className="font-medium">{item.name}</p>
                {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                {item.isRecurring && <span className="text-[10px] text-blue-400">annual</span>}
              </td>
              <td className="p-2 text-right">{item.qty}</td>
              <td className="p-2 text-right text-muted-foreground">{item.listPrice > 0 ? fmtMoney(item.listPrice, currency) : "—"}</td>
              <td className="p-2 text-right text-muted-foreground">{item.discountPercent > 0 ? `${item.discountPercent}%` : "—"}</td>
              <td className="p-2 text-right">{fmtMoney(item.unitPrice, currency)}</td>
              <td className="p-2 pr-3 text-right font-semibold">{fmtMoney(item.lineTotal, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PriceListItemAPI = { id: number; priceListId: number; sku: string; name: string; description: string; category: string; listPrice: number; unitType: string; isRecurring: boolean; sortOrder: number; };
type PriceListAPI = { id: number; name: string; currency: string; description: string | null; items: PriceListItemAPI[] };

function priceListItemToCatalog(item: PriceListItemAPI): CatalogItem {
  return {
    sku: item.sku,
    name: item.name,
    description: item.description || "",
    category: item.category === "saas" ? "saas" : "hardware",
    listPrice: item.listPrice,
    unitType: item.unitType || "unit",
    isRecurring: item.isRecurring,
  };
}

function QuoteBuilder({ accounts, onSubmit, isPending }: { accounts: Account[]; onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [tab, setTab] = useState("customer");

  const priceListsQuery = useQuery<PriceListAPI[]>({ queryKey: ["/api/price-lists"] });
  const [country, setCountry] = useState("US");
  const [currency, setCurrency] = useState("USD");
  const [accountId, setAccountId] = useState("");
  const [validDays, setValidDays] = useState("30");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [marinaAddress, setMarinaAddress] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [slipsCount, setSlipsCount] = useState("");
  const [entitlementNumber, setEntitlementNumber] = useState("");
  const [licensedTo, setLicensedTo] = useState("");
  const [billingPeriodStart, setBillingPeriodStart] = useState("");
  const [billingPeriodEnd, setBillingPeriodEnd] = useState("");
  const [taxRate, setTaxRate] = useState(0);
  const [taxLabel, setTaxLabel] = useState("");
  const [paymentTermDeposit, setPaymentTermDeposit] = useState(10);
  const [paymentTermProduction, setPaymentTermProduction] = useState(40);
  const [paymentTermInstall, setPaymentTermInstall] = useState(50);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [notes, setNotes] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [catalogTab, setCatalogTab] = useState<"hardware" | "saas">("hardware");
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const { toast } = useToast();

  // Resolve active price list based on current currency
  const allPriceLists = priceListsQuery.data ?? [];
  const activePriceList = allPriceLists.find(l => l.currency === currency) ?? null;
  const catalogHardware: CatalogItem[] = activePriceList
    ? activePriceList.items.filter(i => i.category === "hardware").map(priceListItemToCatalog)
    : HARDWARE_CATALOG;
  const catalogSaas: CatalogItem[] = activePriceList
    ? activePriceList.items.filter(i => i.category === "saas").map(priceListItemToCatalog)
    : SOFTWARE_CATALOG;

  const handleCountryChange = (c: string) => {
    setCountry(c);
    const opt = COUNTRY_OPTIONS.find(o => o.code === c);
    if (opt) {
      setCurrency(opt.currency);
      setTaxRate(opt.taxRate);
      setTaxLabel(opt.taxLabel);
    }
  };

  const addFromCatalog = (item: CatalogItem) => {
    const existing = lineItems.findIndex(li => li.name.startsWith(item.sku));
    if (existing >= 0) {
      const updated = [...lineItems];
      updated[existing].qty += 1;
      updated[existing].lineTotal = updated[existing].qty * updated[existing].unitPrice;
      setLineItems(updated);
    } else {
      setLineItems(prev => [...prev, makeLineItem(item, 1, globalDiscount)]);
    }
  };

  const addBlankLine = (cat: "hardware" | "saas" | "other") => {
    setLineItems(prev => [...prev, { name: "", description: "", category: cat, qty: 1, listPrice: 0, discountPercent: globalDiscount, unitPrice: 0, unitType: "unit", lineTotal: 0, isRecurring: false, sortOrder: prev.length }]);
  };

  const updateLine = (i: number, field: string, value: unknown) => {
    const updated = [...lineItems];
    (updated[i] as any)[field] = value;
    if (field === "qty" || field === "unitPrice") {
      updated[i].lineTotal = updated[i].qty * updated[i].unitPrice;
    }
    if (field === "listPrice" || field === "discountPercent") {
      updated[i].unitPrice = updated[i].listPrice * (1 - updated[i].discountPercent / 100);
      updated[i].lineTotal = updated[i].qty * updated[i].unitPrice;
    }
    setLineItems(updated);
  };

  const removeLine = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));

  const hwItems = lineItems.filter(i => i.category === "hardware");
  const swItems = lineItems.filter(i => i.category === "saas" || i.category === "software");
  const otherItems = lineItems.filter(i => i.category !== "hardware" && i.category !== "saas" && i.category !== "software");

  const hwSubtotal = hwItems.reduce((s, i) => s + i.lineTotal, 0);
  const swSubtotal = swItems.reduce((s, i) => s + i.lineTotal, 0);
  const otherSubtotal = otherItems.reduce((s, i) => s + i.lineTotal, 0);
  const subtotal = hwSubtotal + swSubtotal + otherSubtotal;
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount;
  const depositDue = total * (paymentTermDeposit / 100);
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + Number(validDays));

  const paymentTermsSum = paymentTermDeposit + paymentTermProduction + paymentTermInstall;

  const applyGlobalDiscount = (pct: number) => {
    setGlobalDiscount(pct);
    setLineItems(prev => prev.map(li => {
      if (li.listPrice > 0) {
        const unitPrice = li.listPrice * (1 - pct / 100);
        return { ...li, discountPercent: pct, unitPrice, lineTotal: li.qty * unitPrice };
      }
      return li;
    }));
  };

  const handleSubmit = () => {
    if (paymentTermsSum !== 100) {
      toast({ title: "Payment terms must total 100%", description: `Currently ${paymentTermsSum}%`, variant: "destructive" });
      setTab("pricing");
      return;
    }
    onSubmit({
      accountId: accountId ? Number(accountId) : undefined,
      country,
      currency,
      customerName: customerName || undefined,
      customerEmail: customerEmail || undefined,
      customerPhone: customerPhone || undefined,
      marinaAddress: marinaAddress || undefined,
      siteAddress: siteAddress || undefined,
      slipsCount: slipsCount ? Number(slipsCount) : undefined,
      entitlementNumber: entitlementNumber || undefined,
      licensedTo: licensedTo || undefined,
      billingPeriodStart: billingPeriodStart || undefined,
      billingPeriodEnd: billingPeriodEnd || undefined,
      paymentTermDeposit,
      paymentTermProduction,
      paymentTermInstall,
      taxRate,
      taxAmount,
      hardwareSubtotal: hwSubtotal,
      softwareSubtotal: swSubtotal,
      subtotal,
      tax: taxAmount,
      total,
      depositDue,
      validUntil: validUntil.toISOString(),
      notes: notes || undefined,
      assumptions: assumptions || undefined,
      exclusions: exclusions || undefined,
      lineItems: lineItems.map((li, i) => ({ ...li, sortOrder: i })),
    });
  };

  const inputCls = "h-8 text-sm";

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-0 border-b border-border/50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">New Quote</h2>
          {lineItems.length > 0 && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">{lineItems.length} items</span>
              <span className="font-bold text-base">{fmtMoney(total, currency)}</span>
              {taxRate > 0 && <span className="text-xs text-muted-foreground">incl. {taxLabel}</span>}
            </div>
          )}
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-0">
            <TabsTrigger value="customer" data-testid="tab-customer">Customer</TabsTrigger>
            <TabsTrigger value="products" data-testid="tab-products">
              Products {lineItems.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">{lineItems.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="pricing" data-testid="tab-pricing">
              Pricing & Terms
              {paymentTermsSum !== 100 && tab !== "pricing" && <AlertCircle className="w-3 h-3 ml-1 text-orange-400" />}
            </TabsTrigger>
            <TabsTrigger value="notes" data-testid="tab-notes">Notes</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-5 pb-24 md:pb-5">
          {tab === "customer" && (
            <div className="space-y-5 max-w-2xl">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Country *</Label>
                  <Select value={country} onValueChange={handleCountryChange}>
                    <SelectTrigger className={inputCls} data-testid="select-country">
                      <Globe className="h-3 w-3 mr-1 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRY_OPTIONS.map(o => <SelectItem key={o.code} value={o.code}>{o.label} ({o.currency})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className={inputCls} data-testid="select-currency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CURRENCY_SYMBOLS).map(([c, s]) => <SelectItem key={c} value={c}>{c} ({s})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Customer / Marina Name *</Label>
                  <Input value={customerName} onChange={e => setCustomerName(e.target.value)} className={inputCls} placeholder="Bluewater Marina Inc." data-testid="input-customer-name" />
                </div>
                <div>
                  <Label className="text-xs">Link to Account</Label>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger className={inputCls} data-testid="select-account"><SelectValue placeholder="Select account (optional)" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Contact Email</Label>
                  <Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} className={inputCls} placeholder="gm@marina.com" type="email" data-testid="input-customer-email" />
                </div>
                <div>
                  <Label className="text-xs">Contact Phone</Label>
                  <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className={inputCls} placeholder="+1 604 555 0100" data-testid="input-customer-phone" />
                </div>
              </div>

              <div>
                <Label className="text-xs">Marina / Billing Address</Label>
                <Textarea value={marinaAddress} onChange={e => setMarinaAddress(e.target.value)} rows={3} placeholder={"100 Marina Way\nVancouver, BC V5K 0A1\nCanada"} data-testid="input-marina-address" className="text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Site / Install Address</Label>
                  <Textarea value={siteAddress} onChange={e => setSiteAddress(e.target.value)} rows={2} placeholder="Same as above (or different dock)" data-testid="input-site-address" className="text-sm" />
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Slip Count</Label>
                    <Input value={slipsCount} onChange={e => setSlipsCount(e.target.value)} className={inputCls} type="number" min="1" placeholder="e.g. 120" data-testid="input-slips-count" />
                  </div>
                  <div>
                    <Label className="text-xs">Quote Valid (days)</Label>
                    <Input value={validDays} onChange={e => setValidDays(e.target.value)} className={inputCls} type="number" min="1" data-testid="input-valid-days" />
                  </div>
                </div>
              </div>

              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Entitlement #</Label>
                  <Input value={entitlementNumber} onChange={e => setEntitlementNumber(e.target.value)} className={inputCls} placeholder="ENT-2025-0001" data-testid="input-entitlement" />
                </div>
                <div>
                  <Label className="text-xs">Licensed To</Label>
                  <Input value={licensedTo} onChange={e => setLicensedTo(e.target.value)} className={inputCls} placeholder="Legal entity name" data-testid="input-licensed-to" />
                </div>
                <div>
                  <Label className="text-xs">Billing Period Start</Label>
                  <Input value={billingPeriodStart} onChange={e => setBillingPeriodStart(e.target.value)} className={inputCls} placeholder="2025-01-01" data-testid="input-billing-start" />
                </div>
                <div>
                  <Label className="text-xs">Billing Period End</Label>
                  <Input value={billingPeriodEnd} onChange={e => setBillingPeriodEnd(e.target.value)} className={inputCls} placeholder="2025-12-31" data-testid="input-billing-end" />
                </div>
              </div>
            </div>
          )}

          {tab === "products" && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-xs">Global Discount %</Label>
                  <Input
                    type="number" min="0" max="100" step="1"
                    value={globalDiscount || ""}
                    onChange={e => applyGlobalDiscount(Number(e.target.value))}
                    className="h-7 w-16 text-sm"
                    placeholder="0"
                    data-testid="input-global-discount"
                  />
                </div>
                <span className="text-xs text-muted-foreground">Click catalog items below to add, or add blank rows manually</span>
              </div>

              <Tabs value={catalogTab} onValueChange={(v) => setCatalogTab(v as any)}>
                <TabsList>
                  <TabsTrigger value="hardware" data-testid="tab-catalog-hardware"><Package className="h-3.5 w-3.5 mr-1" /> Hardware Catalog</TabsTrigger>
                  <TabsTrigger value="saas" data-testid="tab-catalog-saas"><Cloud className="h-3.5 w-3.5 mr-1" /> Software / Services</TabsTrigger>
                </TabsList>
                {activePriceList && (
                  <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                    <Globe className="h-3 w-3" /> Using <strong>{activePriceList.name}</strong>
                  </p>
                )}
                <TabsContent value="hardware" className="mt-3">
                  <div className="grid gap-1.5">
                    {catalogHardware.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No hardware products in this price list</p>
                    ) : catalogHardware.map((item, idx) => (
                      <button key={item.sku || idx} onClick={() => addFromCatalog(item)} data-testid={`catalog-${item.sku}`}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border/50 hover:bg-green-500/5 hover:border-green-500/30 text-left transition-colors group">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{item.sku ? `${item.sku} — ` : ""}{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold">{fmtMoney(item.listPrice, currency)}<span className="text-xs text-muted-foreground">/{item.unitType}</span></p>
                          <span className="text-xs text-green-500 opacity-0 group-hover:opacity-100">+ Add</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="saas" className="mt-3">
                  <div className="grid gap-1.5">
                    {catalogSaas.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No software products in this price list</p>
                    ) : catalogSaas.map((item, idx) => (
                      <button key={item.sku || idx} onClick={() => addFromCatalog(item)} data-testid={`catalog-${item.sku}`}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border/50 hover:bg-blue-500/5 hover:border-blue-500/30 text-left transition-colors group">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{item.sku ? `${item.sku} — ` : ""}{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                          {item.isRecurring && <span className="text-[10px] text-blue-400 font-medium">annual subscription</span>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold">{fmtMoney(item.listPrice, currency)}<span className="text-xs text-muted-foreground">/{item.unitType}</span></p>
                          <span className="text-xs text-blue-500 opacity-0 group-hover:opacity-100">+ Add</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>

              <Separator />

              {lineItems.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">Selected Line Items ({lineItems.length})</h3>
                  {["hardware", "saas", "other"].map(cat => {
                    const catLabel = cat === "hardware" ? "Hardware" : cat === "saas" ? "Software / SaaS" : "Other";
                    const allItems = cat === "saas" ? lineItems.filter(li => li.category === "saas" || li.category === "software") : lineItems.filter(li => li.category === cat);
                    if (allItems.length === 0 && cat !== "other") return null;
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{catLabel}</p>
                          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => addBlankLine(cat as any)} data-testid={`button-add-blank-${cat}`}>
                            <Plus className="h-3 w-3 mr-0.5" /> Blank Row
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {lineItems.map((li, idx) => {
                            const matches = li.category === cat || (cat === "saas" && li.category === "software");
                            if (!matches) return null;
                            return (
                              <div key={idx} className="flex gap-2 items-center border border-border/50 rounded-lg px-3 py-2 bg-muted/10">
                                <div className="flex-1 grid grid-cols-12 gap-1.5 items-center min-w-0">
                                  <Input value={li.name} onChange={e => updateLine(idx, "name", e.target.value)} className="h-7 text-xs col-span-4" placeholder="Item name" data-testid={`input-line-name-${idx}`} />
                                  <Input type="number" min="1" value={li.qty || ""} onChange={e => updateLine(idx, "qty", Number(e.target.value))} className="h-7 text-xs col-span-1 text-center" placeholder="Qty" data-testid={`input-line-qty-${idx}`} />
                                  <div className="col-span-2 relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{currSym(currency)}</span>
                                    <Input type="number" min="0" value={li.listPrice || ""} onChange={e => updateLine(idx, "listPrice", Number(e.target.value))} className="h-7 text-xs pl-5" placeholder="List" data-testid={`input-line-list-${idx}`} />
                                  </div>
                                  <div className="col-span-2 relative">
                                    <Input type="number" min="0" max="100" value={li.discountPercent || ""} onChange={e => updateLine(idx, "discountPercent", Number(e.target.value))} className="h-7 text-xs pr-4" placeholder="Disc%" data-testid={`input-line-disc-${idx}`} />
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                                  </div>
                                  <div className="col-span-2 text-right">
                                    <p className="text-xs font-medium">{fmtMoney(li.lineTotal, currency)}</p>
                                    <p className="text-[10px] text-muted-foreground">{fmtMoney(li.unitPrice, currency)}/ea</p>
                                  </div>
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 col-span-1 text-muted-foreground hover:text-destructive" onClick={() => removeLine(idx)} data-testid={`button-remove-line-${idx}`}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {lineItems.length === 0 && (
                <div className="text-center py-6 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">
                  Click items from the catalog above to add them to the quote
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => addBlankLine("hardware")} data-testid="button-add-hardware-row"><Plus className="h-3.5 w-3.5 mr-1" /> Hardware Row</Button>
                <Button variant="outline" size="sm" onClick={() => addBlankLine("saas")} data-testid="button-add-saas-row"><Plus className="h-3.5 w-3.5 mr-1" /> Software Row</Button>
                <Button variant="outline" size="sm" onClick={() => addBlankLine("other")} data-testid="button-add-other-row"><Plus className="h-3.5 w-3.5 mr-1" /> Other Row</Button>
              </div>
            </div>
          )}

          {tab === "pricing" && (
            <div className="space-y-6 max-w-xl">
              <div className="border border-border/50 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold">Tax</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Tax Rate</Label>
                    <div className="relative">
                      <Input type="number" min="0" max="100" step="0.1" value={(taxRate * 100).toFixed(1) || ""}
                        onChange={e => setTaxRate(Number(e.target.value) / 100)}
                        className={`${inputCls} pr-7`} data-testid="input-tax-rate" />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                    </div>
                    {taxLabel && <p className="text-xs text-muted-foreground mt-1">{taxLabel} auto-set for {COUNTRY_OPTIONS.find(o => o.code === country)?.label}</p>}
                  </div>
                  <div>
                    <Label className="text-xs">Tax Amount</Label>
                    <p className="text-sm font-medium mt-2">{fmtMoney(taxAmount, currency)}</p>
                  </div>
                </div>
              </div>

              <div className="border border-border/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Payment Terms</h3>
                  <span className={`text-xs font-medium ${paymentTermsSum === 100 ? "text-green-400" : "text-orange-400"}`}>
                    {paymentTermsSum}% {paymentTermsSum !== 100 ? `(needs ${100 - paymentTermsSum > 0 ? "+" : ""}${100 - paymentTermsSum}% more)` : "✓"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Deposit %</Label>
                    <Input type="number" min="0" max="100" value={paymentTermDeposit}
                      onChange={e => setPaymentTermDeposit(Number(e.target.value))}
                      className={inputCls} data-testid="input-deposit-pct" />
                    <p className="text-xs text-muted-foreground mt-1">{fmtMoney(total * paymentTermDeposit / 100, currency)}</p>
                  </div>
                  <div>
                    <Label className="text-xs">Production %</Label>
                    <Input type="number" min="0" max="100" value={paymentTermProduction}
                      onChange={e => setPaymentTermProduction(Number(e.target.value))}
                      className={inputCls} data-testid="input-production-pct" />
                    <p className="text-xs text-muted-foreground mt-1">{fmtMoney(total * paymentTermProduction / 100, currency)}</p>
                  </div>
                  <div>
                    <Label className="text-xs">Installation %</Label>
                    <Input type="number" min="0" max="100" value={paymentTermInstall}
                      onChange={e => setPaymentTermInstall(Number(e.target.value))}
                      className={inputCls} data-testid="input-install-pct" />
                    <p className="text-xs text-muted-foreground mt-1">{fmtMoney(total * paymentTermInstall / 100, currency)}</p>
                  </div>
                </div>
              </div>

              <div className="border border-border/50 rounded-lg p-4 bg-muted/5">
                <h3 className="text-sm font-semibold mb-3">Quote Summary</h3>
                <div className="space-y-1.5 text-sm">
                  {hwSubtotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Hardware subtotal</span><span>{fmtMoney(hwSubtotal, currency)}</span></div>}
                  {swSubtotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Software subtotal</span><span>{fmtMoney(swSubtotal, currency)}</span></div>}
                  {otherSubtotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Other subtotal</span><span>{fmtMoney(otherSubtotal, currency)}</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtMoney(subtotal, currency)}</span></div>
                  {taxRate > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax ({(taxRate * 100).toFixed(0)}%)</span><span>{fmtMoney(taxAmount, currency)}</span></div>}
                  <Separator className="my-2" />
                  <div className="flex justify-between text-base font-bold"><span>Total</span><span>{fmtMoney(total, currency)}</span></div>
                  <div className="flex justify-between text-sm text-green-600"><span>Deposit due</span><span>{fmtMoney(depositDue, currency)}</span></div>
                </div>
              </div>
            </div>
          )}

          {tab === "notes" && (
            <div className="space-y-5 max-w-2xl">
              <div>
                <Label className="text-xs">Notes (shown on invoice)</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} className="mt-1.5 text-sm" placeholder="Additional notes for the customer..." data-testid="input-notes" />
              </div>
              <div>
                <Label className="text-xs">Assumptions</Label>
                <Textarea value={assumptions} onChange={e => setAssumptions(e.target.value)} rows={4} className="mt-1.5 text-sm" placeholder="Quote assumes standard electrical panel accessible within 10 feet of pedestal locations..." data-testid="input-assumptions" />
              </div>
              <div>
                <Label className="text-xs">Exclusions</Label>
                <Textarea value={exclusions} onChange={e => setExclusions(e.target.value)} rows={4} className="mt-1.5 text-sm" placeholder="Excludes: conduit, trenching, permits, engineering stamps, utility work..." data-testid="input-exclusions" />
              </div>
            </div>
          )}
        </div>

        {/* Sticky right totals panel when on products tab */}
        {tab === "products" && lineItems.length > 0 && (
          <div className="hidden lg:flex flex-col w-52 shrink-0 border-l border-border/40 bg-muted/5 p-4 gap-2 text-sm overflow-y-auto">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Live Totals</p>
            {hwSubtotal > 0 && <div className="flex justify-between gap-2"><span className="text-muted-foreground text-xs truncate">Hardware</span><span className="text-xs font-medium shrink-0">{fmtMoney(hwSubtotal, currency)}</span></div>}
            {swSubtotal > 0 && <div className="flex justify-between gap-2"><span className="text-muted-foreground text-xs truncate">Software</span><span className="text-xs font-medium shrink-0">{fmtMoney(swSubtotal, currency)}</span></div>}
            {otherSubtotal > 0 && <div className="flex justify-between gap-2"><span className="text-muted-foreground text-xs truncate">Other</span><span className="text-xs font-medium shrink-0">{fmtMoney(otherSubtotal, currency)}</span></div>}
            <Separator className="my-1" />
            <div className="flex justify-between gap-2"><span className="text-muted-foreground text-xs">Subtotal</span><span className="text-xs font-medium shrink-0">{fmtMoney(subtotal, currency)}</span></div>
            {taxRate > 0 && <div className="flex justify-between gap-2"><span className="text-muted-foreground text-xs truncate">{taxLabel || "Tax"}</span><span className="text-xs font-medium shrink-0">{fmtMoney(taxAmount, currency)}</span></div>}
            <Separator className="my-1" />
            <div className="flex justify-between gap-2 font-bold"><span className="text-sm">Total</span><span className="text-sm shrink-0">{fmtMoney(total, currency)}</span></div>
            <div className="flex justify-between gap-2 text-green-400"><span className="text-xs truncate">Deposit ({paymentTermDeposit}%)</span><span className="text-xs shrink-0">{fmtMoney(depositDue, currency)}</span></div>
            <Separator className="my-1" />
            <p className="text-[10px] text-muted-foreground">{lineItems.length} line item{lineItems.length !== 1 ? "s" : ""}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-card/50">
        <div className="flex gap-2">
          {tab !== "customer" && <Button variant="ghost" size="sm" onClick={() => { const tabs = ["customer","products","pricing","notes"]; setTab(tabs[tabs.indexOf(tab)-1]); }}>← Back</Button>}
          {tab !== "notes" && <Button variant="outline" size="sm" onClick={() => { const tabs = ["customer","products","pricing","notes"]; setTab(tabs[tabs.indexOf(tab)+1]); }}>Next →</Button>}
        </div>
        <div className="flex items-center gap-3">
          {total > 0 && <span className="text-sm font-bold">{fmtMoney(total, currency)}</span>}
          <Button
            onClick={handleSubmit}
            disabled={isPending || !customerName}
            className="bg-primary text-primary-foreground"
            data-testid="button-submit-quote"
          >
            {isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating...</> : "Generate Quote & Files"}
          </Button>
        </div>
      </div>
    </div>
  );
}
