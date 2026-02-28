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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Building2, Users, Loader2, Phone, Mail, Trash2,
  ArrowUpDown, MapPin, Globe, Zap, Star, AlertTriangle, Calendar,
  Settings2, Wrench, Shield, Wifi, LinkIcon
} from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import type { Account, Contact, Opportunity, Ticket, InfrastructureProfile } from "@shared/schema";

const segmentColors: Record<string, string> = {
  marina: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  corp: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  partner: "bg-green-500/10 text-green-500 border-green-500/20",
  other: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

const statusColors: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  working: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  nurturing: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  unqualified: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  closed_won: "bg-green-500/10 text-green-500 border-green-500/20",
  closed_lost: "bg-red-500/10 text-red-500 border-red-500/20",
};

const priorityColors: Record<string, string> = {
  low: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  high: "bg-red-500/10 text-red-500 border-red-500/20",
};

export default function AccountsPage() {
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const { toast } = useToast();
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const [sortOption, setSortOption] = useState("default");

  const PAGE_SIZE = 100;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<{ data: Account[]; total: number; page: number; totalPages: number }>({
    queryKey: ["/api/accounts", { search, segment: segmentFilter === "all" ? "" : segmentFilter, status: statusFilter === "all" ? "" : statusFilter, priority: priorityFilter === "all" ? "" : priorityFilter, sort: sortOption }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (segmentFilter !== "all") params.set("segment", segmentFilter);
      if (statusFilter !== "all") params.set("leadStatus", statusFilter);
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

  const allAccounts = data?.pages.flatMap(p => p.data) || [];
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

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Accounts</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage marinas and corporate accounts.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            endpoint={`/api/accounts/export?${new URLSearchParams({
              ...(search ? { search } : {}),
              ...(segmentFilter !== "all" ? { segment: segmentFilter } : {}),
            }).toString()}`}
            filename="accounts_export.csv"
          />
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
        </div>
      </div>

      <div className="flex gap-2 sm:gap-3 flex-wrap">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search accounts..." value={search} onChange={(e) => { setSearch(e.target.value); }} className="pl-10" data-testid="input-search-accounts" />
        </div>
        <Select value={segmentFilter} onValueChange={(v) => { setSegmentFilter(v); }}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-36" data-testid="select-segment-filter">
            <SelectValue placeholder="Segment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Segments</SelectItem>
            <SelectItem value="marina">Marina</SelectItem>
            <SelectItem value="corp">Corporation</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-36" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="working">Working</SelectItem>
            <SelectItem value="nurturing">Nurturing</SelectItem>
            <SelectItem value="unqualified">Unqualified</SelectItem>
            <SelectItem value="closed_won">Closed Won</SelectItem>
            <SelectItem value="closed_lost">Closed Lost</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-32" data-testid="select-priority-filter">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortOption} onValueChange={setSortOption}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-44" data-testid="select-sort">
            <ArrowUpDown className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="name:asc">Name A–Z</SelectItem>
            <SelectItem value="name:desc">Name Z–A</SelectItem>
            <SelectItem value="createdAt:desc">Newest First</SelectItem>
            <SelectItem value="createdAt:asc">Oldest First</SelectItem>
            <SelectItem value="slipCount:desc">Most Slips</SelectItem>
            <SelectItem value="slipCount:asc">Fewest Slips</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {allAccounts.map((account) => (
            <Card key={account.id} className="border-border/50 hover:border-primary/30 cursor-pointer transition-colors" onClick={() => setSelectedAccount(account)} data-testid={`card-account-${account.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{account.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {[account.city, account.stateProvince, account.country].filter(Boolean).join(", ") || account.region || "No location"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline" className={segmentColors[account.segment] || ""}>{account.segment}</Badge>
                    <Badge variant="outline" className={priorityColors[account.priority] || ""}>{account.priority}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <Badge variant="outline" className={statusColors[account.leadStatus] || ""}>{account.leadStatus.replace("_", " ")}</Badge>
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
                {account.nextAction && (
                  <p className="text-xs text-muted-foreground mt-2 truncate">
                    Next: {account.nextAction}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
          {allAccounts.length === 0 && (
            <div className="col-span-full p-8 text-center text-muted-foreground">No accounts found</div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between py-2">
        <p className="text-sm text-muted-foreground">{allAccounts.length.toLocaleString()} of {totalCount.toLocaleString()} accounts loaded</p>
        {isFetchingNextPage && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading more...</div>
        )}
      </div>
      <div ref={scrollSentinelRef} className="h-4" />

      {selectedAccount && (
        <AccountDetailDialog account={selectedAccount} onClose={() => setSelectedAccount(null)} />
      )}
    </div>
  );
}

function AccountDetailDialog({ account: initialAccount, onClose }: { account: Account; onClose: () => void }) {
  const { toast } = useToast();
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const { data: freshAccount } = useQuery<Account>({
    queryKey: ["/api/accounts", initialAccount.id],
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${initialAccount.id}`, { credentials: "include" });
      return res.json();
    },
  });
  const account = freshAccount || initialAccount;

  const { data: contactsData } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", { accountId: account.id }],
    queryFn: async () => {
      const res = await fetch(`/api/contacts?accountId=${account.id}`);
      return res.json();
    },
  });

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

  const createContactMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/contacts", { ...data, accountId: account.id });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setAddContactOpen(false);
      toast({ title: "Contact added" });
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

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-xl">{account.name}</DialogTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className={segmentColors[account.segment] || ""}>{account.segment}</Badge>
                <Badge variant="outline" className={statusColors[account.leadStatus] || ""}>{account.leadStatus.replace("_", " ")}</Badge>
                <Badge variant="outline" className={priorityColors[account.priority] || ""}>{account.priority}</Badge>
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

        <Tabs defaultValue="details" className="mt-4">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
            <TabsTrigger value="contacts" data-testid="tab-contacts">Contacts ({contactsData?.length || 0})</TabsTrigger>
            <TabsTrigger value="opportunities" data-testid="tab-opportunities">Deals ({oppsData?.data?.length || 0})</TabsTrigger>
            <TabsTrigger value="tickets" data-testid="tab-tickets">Tickets ({ticketsData?.data?.length || 0})</TabsTrigger>
            <TabsTrigger value="infrastructure" data-testid="tab-infrastructure">Infrastructure</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 mt-4">
            {editMode ? (
              <EditAccountForm account={account} onSubmit={(d) => updateAccountMutation.mutate(d)} onCancel={() => setEditMode(false)} isPending={updateAccountMutation.isPending} />
            ) : (
              <>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => setEditMode(true)} data-testid="button-edit-account">Edit</Button>
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

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
              </>
            )}
          </TabsContent>

          <TabsContent value="contacts" className="mt-4">
            <div className="flex justify-end mb-3">
              <Dialog open={addContactOpen} onOpenChange={setAddContactOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="button-add-contact"><Plus className="mr-1 h-3 w-3" /> Add Contact</Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
                  <CreateContactForm onSubmit={(d) => createContactMutation.mutate(d)} isPending={createContactMutation.isPending} />
                </DialogContent>
              </Dialog>
            </div>
            <div className="space-y-2">
              {contactsData?.map((contact) => (
                <div key={contact.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50" data-testid={`row-contact-${contact.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                      {contact.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{contact.name}</p>
                        {contact.isPrimary && <Badge variant="outline" className="text-[10px] px-1 py-0 bg-primary/10 text-primary border-primary/20">Primary</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {contact.title || contact.persona || contact.roleType || "—"}
                        {contact.relationshipStrength && <span className="ml-2">· {contact.relationshipStrength}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    {contact.email && <span className="flex items-center gap-1 hidden sm:flex"><Mail className="h-3 w-3" /> {contact.email}</span>}
                    {contact.phone && <span className="flex items-center gap-1 hidden sm:flex"><Phone className="h-3 w-3" /> {contact.phone}</span>}
                    {contact.linkedinUrl && <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="hover:text-primary"><LinkIcon className="h-3 w-3" /></a>}
                  </div>
                </div>
              ))}
              {(!contactsData || contactsData.length === 0) && (
                <p className="text-center text-sm text-muted-foreground py-4">No contacts yet</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="opportunities" className="mt-4">
            <div className="space-y-2">
              {oppsData?.data?.map((opp) => (
                <div key={opp.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50" data-testid={`row-opp-${opp.id}`}>
                  <div>
                    <p className="text-sm font-medium">{opp.title}</p>
                    <p className="text-xs text-muted-foreground">Stage: {opp.stage}</p>
                  </div>
                  <span className="text-sm font-medium">${opp.valueTotal?.toLocaleString() || "0"}</span>
                </div>
              ))}
              {(!oppsData?.data || oppsData.data.length === 0) && (
                <p className="text-center text-sm text-muted-foreground py-4">No opportunities yet</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="tickets" className="mt-4">
            <div className="space-y-2">
              {ticketsData?.data?.map((ticket) => (
                <div key={ticket.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50" data-testid={`row-ticket-${ticket.id}`}>
                  <div>
                    <p className="text-sm font-medium">{ticket.subject}</p>
                    <p className="text-xs text-muted-foreground">{ticket.category} · {ticket.severity}</p>
                  </div>
                  <Badge variant="outline">{ticket.status}</Badge>
                </div>
              ))}
              {(!ticketsData?.data || ticketsData.data.length === 0) && (
                <p className="text-center text-sm text-muted-foreground py-4">No tickets yet</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="infrastructure" className="mt-4">
            <InfrastructureProfileTab
              profile={infraProfile}
              onSave={(data) => updateInfraMutation.mutate(data)}
              isPending={updateInfraMutation.isPending}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
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

function InfrastructureProfileTab({ profile, onSave, isPending }: { profile: InfrastructureProfile | null | undefined; onSave: (data: Record<string, unknown>) => void; isPending: boolean }) {
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
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-add-infra">
          <Plus className="mr-1 h-3 w-3" /> Add Infrastructure Profile
        </Button>
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
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-edit-infra">Edit</Button>
      </div>

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
  });

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
          <div><Label className="text-xs">State/Province</Label><Input value={form.stateProvince} onChange={(e) => setForm(f => ({ ...f, stateProvince: e.target.value }))} data-testid="input-edit-state" /></div>
          <div><Label className="text-xs">Postal/Zip</Label><Input value={form.postalZip} onChange={(e) => setForm(f => ({ ...f, postalZip: e.target.value }))} data-testid="input-edit-postal" /></div>
          <div><Label className="text-xs">Country</Label><Input value={form.country} onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))} data-testid="input-edit-country" /></div>
          <div><Label className="text-xs">Region</Label><Input value={form.region} onChange={(e) => setForm(f => ({ ...f, region: e.target.value }))} data-testid="input-edit-region" /></div>
          <div><Label className="text-xs">Timezone</Label><Input value={form.timezone} onChange={(e) => setForm(f => ({ ...f, timezone: e.target.value }))} data-testid="input-edit-tz" /></div>
        </div>
      </div>

      <div className="border-t border-border/50 pt-3">
        <Label className="text-xs text-muted-foreground mb-2 block">Marina Details</Label>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Slip Count</Label><Input type="number" value={form.slipCount} onChange={(e) => setForm(f => ({ ...f, slipCount: e.target.value }))} data-testid="input-edit-slips" /></div>
          <div><Label className="text-xs">Slip Mix</Label><Input value={form.slipMix} onChange={(e) => setForm(f => ({ ...f, slipMix: e.target.value }))} placeholder="e.g. 60% wet, 40% dry" data-testid="input-edit-slip-mix" /></div>
          <div><Label className="text-xs">Avg Boat Size Range</Label><Input value={form.avgBoatSizeRange} onChange={(e) => setForm(f => ({ ...f, avgBoatSizeRange: e.target.value }))} placeholder="e.g. 25-45 ft" data-testid="input-edit-boat-size" /></div>
          <div><Label className="text-xs">Power Demand</Label><Input value={form.powerDemandIntensity} onChange={(e) => setForm(f => ({ ...f, powerDemandIntensity: e.target.value }))} placeholder="e.g. High, Medium, Low" data-testid="input-edit-power-demand" /></div>
          <div><Label className="text-xs">Seasonality</Label><Input value={form.seasonality} onChange={(e) => setForm(f => ({ ...f, seasonality: e.target.value }))} placeholder="e.g. Year-round, Apr-Oct" data-testid="input-edit-seasonality" /></div>
        </div>
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
        {form.expansionPlans && (
          <div className="mt-2"><Label className="text-xs">Expansion Notes</Label><Textarea value={form.expansionNotes} onChange={(e) => setForm(f => ({ ...f, expansionNotes: e.target.value }))} rows={2} data-testid="input-edit-expansion-notes" /></div>
        )}
      </div>

      <div className="border-t border-border/50 pt-3">
        <Label className="text-xs text-muted-foreground mb-2 block">Sales Info</Label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Lead Status</Label>
            <Select value={form.leadStatus} onValueChange={(v) => setForm(f => ({ ...f, leadStatus: v }))}>
              <SelectTrigger data-testid="select-edit-lead-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="working">Working</SelectItem>
                <SelectItem value="nurturing">Nurturing</SelectItem>
                <SelectItem value="unqualified">Unqualified</SelectItem>
                <SelectItem value="closed_won">Closed Won</SelectItem>
                <SelectItem value="closed_lost">Closed Lost</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
    name: "", segment: "marina", streetAddress: "", city: "", stateProvince: "", postalZip: "", country: "US",
    region: "", slipCount: "", notes: "", leadStatus: "new", priority: "medium",
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...form, slipCount: form.slipCount ? Number(form.slipCount) : undefined }); }} className="space-y-4">
      <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required data-testid="input-account-name" /></div>
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
        <div><Label>State/Province</Label><Input value={form.stateProvince} onChange={(e) => setForm(f => ({ ...f, stateProvince: e.target.value }))} data-testid="input-account-state" /></div>
        <div><Label>Postal/Zip</Label><Input value={form.postalZip} onChange={(e) => setForm(f => ({ ...f, postalZip: e.target.value }))} data-testid="input-account-postal" /></div>
        <div>
          <Label>Country</Label>
          <Select value={form.country} onValueChange={(v) => setForm(f => ({ ...f, country: v }))}>
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
        <div><Label>Slip Count</Label><Input type="number" value={form.slipCount} onChange={(e) => setForm(f => ({ ...f, slipCount: e.target.value }))} data-testid="input-slip-count" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Status</Label>
          <Select value={form.leadStatus} onValueChange={(v) => setForm(f => ({ ...f, leadStatus: v }))}>
            <SelectTrigger data-testid="select-account-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="working">Working</SelectItem>
              <SelectItem value="nurturing">Nurturing</SelectItem>
            </SelectContent>
          </Select>
        </div>
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

function CreateContactForm({ onSubmit, isPending }: { onSubmit: (data: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    name: "", firstName: "", lastName: "", title: "", email: "", phone: "",
    persona: "", roleType: "", preferredContactMethod: "", linkedinUrl: "",
    relationshipStrength: "", isPrimary: false, notes: "",
  });

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const fullName = form.name || [form.firstName, form.lastName].filter(Boolean).join(" ") || "Contact";
      onSubmit({ ...form, name: fullName });
    }} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>First Name</Label><Input value={form.firstName} onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))} data-testid="input-contact-first-name" /></div>
        <div><Label>Last Name</Label><Input value={form.lastName} onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))} data-testid="input-contact-last-name" /></div>
      </div>
      <div><Label>Full Name</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Auto-generated from first/last if blank" data-testid="input-contact-name" /></div>
      <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} data-testid="input-contact-title" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-contact-email" /></div>
        <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-contact-phone" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Role Type</Label>
          <Select value={form.roleType} onValueChange={(v) => setForm(f => ({ ...f, roleType: v }))}>
            <SelectTrigger data-testid="select-contact-role"><SelectValue placeholder="Select role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="economic_buyer">Economic Buyer</SelectItem>
              <SelectItem value="champion">Champion</SelectItem>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="finance">Finance</SelectItem>
              <SelectItem value="ops">Operations</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Persona</Label>
          <Select value={form.persona} onValueChange={(v) => setForm(f => ({ ...f, persona: v }))}>
            <SelectTrigger data-testid="select-contact-persona"><SelectValue placeholder="Select persona" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="gm">General Manager</SelectItem>
              <SelectItem value="harbourmaster">Harbourmaster</SelectItem>
              <SelectItem value="electrician">Electrician</SelectItem>
              <SelectItem value="accounting">Accounting</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Relationship Strength</Label>
          <Select value={form.relationshipStrength} onValueChange={(v) => setForm(f => ({ ...f, relationshipStrength: v }))}>
            <SelectTrigger data-testid="select-contact-relationship"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cold">Cold</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="hot">Hot</SelectItem>
              <SelectItem value="champion">Champion</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Preferred Contact</Label>
          <Select value={form.preferredContactMethod} onValueChange={(v) => setForm(f => ({ ...f, preferredContactMethod: v }))}>
            <SelectTrigger data-testid="select-contact-method"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="phone">Phone</SelectItem>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="in_person">In Person</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>LinkedIn URL</Label><Input value={form.linkedinUrl} onChange={(e) => setForm(f => ({ ...f, linkedinUrl: e.target.value }))} placeholder="https://linkedin.com/in/..." data-testid="input-contact-linkedin" /></div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm(f => ({ ...f, isPrimary: e.target.checked }))} className="rounded" data-testid="input-contact-primary" />
        Primary Contact
      </label>
      <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} data-testid="input-contact-notes" /></div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-contact">{isPending ? "Adding..." : "Add Contact"}</Button>
    </form>
  );
}
