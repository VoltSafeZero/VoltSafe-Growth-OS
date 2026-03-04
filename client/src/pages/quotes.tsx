import { useState, useRef, useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText, Loader2, Trash2, DollarSign } from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import { SortableHeader, useSortState } from "@/components/ui/sortable-header";
import type { Quote, Account } from "@shared/schema";

const statusColors: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  sent: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  accepted: "bg-green-500/10 text-green-400 border-green-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
  expired: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
};

type LineItem = { name: string; category: string; description: string; qty: number; unitPrice: number; unitType: string; lineTotal: number };
type ServiceLine = { role: string; hoursEstimate: number; hourlyRate: number; subtotal: number };

export default function QuotesPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<number | null>(null);
  const { toast } = useToast();
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const { sort, handleSort } = useSortState();

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      setCreateOpen(false);
      toast({ title: "Quote created" });
    },
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Quotes</h1>
          <p className="text-muted-foreground mt-1 text-sm">Generate and manage quotes for marinas and professional services.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            endpoint={`/api/quotes/export?${new URLSearchParams({
              ...(statusFilter !== "all" ? { status: statusFilter } : {}),
            }).toString()}`}
            filename="quotes_export.csv"
          />
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground" data-testid="button-create-quote">
                <Plus className="mr-2 h-4 w-4" /> New Quote
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] sm:max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Quote</DialogTitle></DialogHeader>
            <QuoteBuilder accounts={accountsData?.data || []} onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="flex gap-3">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); }}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-quote-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead>
                <tr className="border-b border-border/50">
                  <SortableHeader label="Quote #" sortKey="quoteNumber" sort={sort} onSort={handleSort} />
                  <SortableHeader label="Type" sortKey="quoteType" sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                  <th className="text-left p-3 sm:p-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">Account</th>
                  <SortableHeader label="Status" sortKey="status" sort={sort} onSort={handleSort} />
                  <SortableHeader label="Total" sortKey="total" sort={sort} onSort={handleSort} align="right" />
                  <SortableHeader label="Created" sortKey="createdAt" sort={sort} onSort={handleSort} className="hidden sm:table-cell" />
                </tr>
              </thead>
              <tbody>
                {allQuotes.map(quote => (
                  <tr key={quote.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedQuote(quote.id)} data-testid={`row-quote-${quote.id}`}>
                    <td className="p-3 sm:p-4 font-medium font-mono text-sm">{quote.quoteNumber}</td>
                    <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden md:table-cell">{quote.quoteType === "marina_solution" ? "Marina Solution" : "Professional Services"}</td>
                    <td className="p-3 sm:p-4 text-sm hidden lg:table-cell">{accountMap.get(quote.accountId!) || "—"}</td>
                    <td className="p-3 sm:p-4"><Badge variant="outline" className={statusColors[quote.status] || ""}>{quote.status}</Badge></td>
                    <td className="p-3 sm:p-4 text-right font-medium">${quote.total?.toLocaleString() || "0"}</td>
                    <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden sm:table-cell">{new Date(quote.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {allQuotes.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No quotes found</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between py-2">
        <p className="text-sm text-muted-foreground">{allQuotes.length.toLocaleString()} of {totalCount.toLocaleString()} quotes loaded</p>
        {isFetchingNextPage && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading more...</div>
        )}
      </div>
      <div ref={scrollSentinelRef} className="h-4" />

      {selectedQuote && (
        <QuoteDetailDialog quoteId={selectedQuote} accountMap={accountMap} onClose={() => setSelectedQuote(null)} />
      )}
    </div>
  );
}

function QuoteDetailDialog({ quoteId, accountMap, onClose }: { quoteId: number; accountMap: Map<number, string>; onClose: () => void }) {
  const { data, isLoading } = useQuery<Quote & { lineItems: LineItem[]; servicesEstimates: ServiceLine[] }>({
    queryKey: ["/api/quotes", quoteId],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/${quoteId}`);
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (d: Record<string, unknown>) => {
      const res = await apiRequest("PUT", `/api/quotes/${quoteId}`, d);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
    },
  });

  if (isLoading || !data) return <Dialog open onOpenChange={onClose}><DialogContent><Skeleton className="h-40" /></DialogContent></Dialog>;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] sm:max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-mono">{data.quoteNumber}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {data.quoteType === "marina_solution" ? "Marina Shore Power Solution" : "Professional Services Agreement"} · v{data.version}
              </p>
            </div>
            <Badge variant="outline" className={statusColors[data.status] || ""}>{data.status}</Badge>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-xs text-muted-foreground">Account</Label><p className="text-sm">{accountMap.get(data.accountId!) || "—"}</p></div>
            <div><Label className="text-xs text-muted-foreground">Currency</Label><p className="text-sm">{data.currency}</p></div>
            <div><Label className="text-xs text-muted-foreground">Valid Until</Label><p className="text-sm">{data.validUntil ? new Date(data.validUntil).toLocaleDateString() : "—"}</p></div>
            <div>
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={data.status} onValueChange={(v) => updateMutation.mutate({ status: v })}>
                <SelectTrigger className="mt-1" data-testid="select-quote-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {data.lineItems && data.lineItems.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Line Items</h3>
              <div className="border border-border/50 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/50 bg-muted/30">
                    <th className="text-left p-2">Item</th>
                    <th className="text-left p-2">Category</th>
                    <th className="text-right p-2">Qty</th>
                    <th className="text-right p-2">Unit Price</th>
                    <th className="text-right p-2">Total</th>
                  </tr></thead>
                  <tbody>
                    {data.lineItems.map((item: any, i: number) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="p-2">{item.name}</td>
                        <td className="p-2 text-muted-foreground">{item.category}</td>
                        <td className="p-2 text-right">{item.qty}</td>
                        <td className="p-2 text-right">${item.unitPrice?.toLocaleString()}</td>
                        <td className="p-2 text-right font-medium">${item.lineTotal?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.servicesEstimates && data.servicesEstimates.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Services Estimates</h3>
              <div className="border border-border/50 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/50 bg-muted/30">
                    <th className="text-left p-2">Role</th>
                    <th className="text-right p-2">Hours</th>
                    <th className="text-right p-2">Rate</th>
                    <th className="text-right p-2">Subtotal</th>
                  </tr></thead>
                  <tbody>
                    {data.servicesEstimates.map((est: any, i: number) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="p-2">{est.role}</td>
                        <td className="p-2 text-right">{est.hoursEstimate}</td>
                        <td className="p-2 text-right">${est.hourlyRate}</td>
                        <td className="p-2 text-right font-medium">${est.subtotal?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <Separator />
          <div className="flex justify-end">
            <div className="space-y-1 text-right">
              <p className="text-sm text-muted-foreground">Subtotal: <span className="text-foreground">${data.subtotal?.toLocaleString()}</span></p>
              <p className="text-sm text-muted-foreground">Tax: <span className="text-foreground">${data.tax?.toLocaleString()}</span></p>
              <p className="text-lg font-bold">Total: ${data.total?.toLocaleString()}</p>
            </div>
          </div>

          {data.assumptions && <div><Label className="text-xs text-muted-foreground">Assumptions</Label><p className="text-sm whitespace-pre-wrap">{data.assumptions}</p></div>}
          {data.exclusions && <div><Label className="text-xs text-muted-foreground">Exclusions</Label><p className="text-sm whitespace-pre-wrap">{data.exclusions}</p></div>}
          {data.notes && <div><Label className="text-xs text-muted-foreground">Notes</Label><p className="text-sm whitespace-pre-wrap">{data.notes}</p></div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QuoteBuilder({ accounts, onSubmit, isPending }: { accounts: Account[]; onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [quoteType, setQuoteType] = useState("marina_solution");
  const [accountId, setAccountId] = useState("");
  const [validDays, setValidDays] = useState("30");
  const [assumptions, setAssumptions] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [serviceLines, setServiceLines] = useState<ServiceLine[]>([]);

  const addLineItem = () => setLineItems([...lineItems, { name: "", category: "hardware", description: "", qty: 1, unitPrice: 0, unitType: "unit", lineTotal: 0 }]);
  const removeLineItem = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));
  const updateLineItem = (i: number, field: string, value: unknown) => {
    const updated = [...lineItems];
    (updated[i] as any)[field] = value;
    if (field === "qty" || field === "unitPrice") {
      updated[i].lineTotal = updated[i].qty * updated[i].unitPrice;
    }
    setLineItems(updated);
  };

  const addServiceLine = () => setServiceLines([...serviceLines, { role: "", hoursEstimate: 0, hourlyRate: 0, subtotal: 0 }]);
  const removeServiceLine = (i: number) => setServiceLines(serviceLines.filter((_, idx) => idx !== i));
  const updateServiceLine = (i: number, field: string, value: unknown) => {
    const updated = [...serviceLines];
    (updated[i] as any)[field] = value;
    if (field === "hoursEstimate" || field === "hourlyRate") {
      updated[i].subtotal = updated[i].hoursEstimate * updated[i].hourlyRate;
    }
    setServiceLines(updated);
  };

  const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0) + serviceLines.reduce((s, sl) => s + sl.subtotal, 0);
  const total = subtotal;
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + Number(validDays));

  const handleSubmit = () => {
    onSubmit({
      quoteType,
      accountId: accountId ? Number(accountId) : undefined,
      validUntil: validUntil.toISOString(),
      subtotal,
      total,
      tax: 0,
      assumptions,
      exclusions,
      notes,
      lineItems: lineItems.map((li, i) => ({ ...li, sortOrder: i })),
      servicesEstimates: serviceLines.map((sl, i) => ({ ...sl, sortOrder: i })),
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Quote Type *</Label>
          <Select value={quoteType} onValueChange={setQuoteType}>
            <SelectTrigger data-testid="select-quote-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="marina_solution">Marina Shore Power Solution</SelectItem>
              <SelectItem value="professional_services">Professional Services Agreement</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger data-testid="select-quote-account"><SelectValue placeholder="Select account" /></SelectTrigger>
            <SelectContent>
              {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Valid For (days)</Label>
        <Input type="number" value={validDays} onChange={(e) => setValidDays(e.target.value)} className="w-32" data-testid="input-valid-days" />
      </div>

      {quoteType === "marina_solution" ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Line Items</h3>
            <Button variant="outline" size="sm" onClick={addLineItem} data-testid="button-add-line-item"><Plus className="mr-1 h-3 w-3" /> Add Item</Button>
          </div>
          <div className="space-y-3">
            {lineItems.map((item, i) => (
              <div key={i} className="flex gap-2 items-start border border-border/50 rounded-lg p-3">
                <div className="flex-1 grid grid-cols-5 gap-2">
                  <Input placeholder="Item name" value={item.name} onChange={(e) => updateLineItem(i, "name", e.target.value)} className="col-span-2" data-testid={`input-line-name-${i}`} />
                  <Select value={item.category} onValueChange={(v) => updateLineItem(i, "category", v)}>
                    <SelectTrigger data-testid={`select-line-category-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hardware">Hardware</SelectItem>
                      <SelectItem value="saas">SaaS</SelectItem>
                      <SelectItem value="services">Services</SelectItem>
                      <SelectItem value="discount">Discount</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="Qty" value={item.qty || ""} onChange={(e) => updateLineItem(i, "qty", Number(e.target.value))} data-testid={`input-line-qty-${i}`} />
                  <Input type="number" placeholder="Price" value={item.unitPrice || ""} onChange={(e) => updateLineItem(i, "unitPrice", Number(e.target.value))} data-testid={`input-line-price-${i}`} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium w-20 text-right">${item.lineTotal.toLocaleString()}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeLineItem(i)} data-testid={`button-remove-line-${i}`}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Services Workstreams</h3>
            <Button variant="outline" size="sm" onClick={addServiceLine} data-testid="button-add-service-line"><Plus className="mr-1 h-3 w-3" /> Add Role</Button>
          </div>
          <div className="space-y-3">
            {serviceLines.map((line, i) => (
              <div key={i} className="flex gap-2 items-center border border-border/50 rounded-lg p-3">
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <Select value={line.role} onValueChange={(v) => updateServiceLine(i, "role", v)}>
                    <SelectTrigger data-testid={`select-service-role-${i}`}><SelectValue placeholder="Role" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="engineering">Engineering</SelectItem>
                      <SelectItem value="firmware">Firmware</SelectItem>
                      <SelectItem value="mechanical">Mechanical</SelectItem>
                      <SelectItem value="electrical">Electrical</SelectItem>
                      <SelectItem value="pm">Project Management</SelectItem>
                      <SelectItem value="qa">QA</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="Hours" value={line.hoursEstimate || ""} onChange={(e) => updateServiceLine(i, "hoursEstimate", Number(e.target.value))} data-testid={`input-service-hours-${i}`} />
                  <Input type="number" placeholder="Rate $/hr" value={line.hourlyRate || ""} onChange={(e) => updateServiceLine(i, "hourlyRate", Number(e.target.value))} data-testid={`input-service-rate-${i}`} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium w-20 text-right">${line.subtotal.toLocaleString()}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeServiceLine(i)} data-testid={`button-remove-service-${i}`}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Separator />

      <div className="grid grid-cols-2 gap-4">
        <div><Label>Assumptions</Label><Textarea value={assumptions} onChange={(e) => setAssumptions(e.target.value)} rows={2} data-testid="input-assumptions" /></div>
        <div><Label>Exclusions</Label><Textarea value={exclusions} onChange={(e) => setExclusions(e.target.value)} rows={2} data-testid="input-exclusions" /></div>
      </div>
      <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="input-quote-notes" /></div>

      <div className="flex items-center justify-between pt-4 border-t border-border/50">
        <div>
          <p className="text-2xl font-bold flex items-center gap-1"><DollarSign className="h-6 w-6 text-primary" />{total.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Valid until {validUntil.toLocaleDateString()}</p>
        </div>
        <Button onClick={handleSubmit} className="bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-quote">
          {isPending ? "Creating..." : "Create Quote"}
        </Button>
      </div>
    </div>
  );
}
