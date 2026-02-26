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
import { Plus, Search, Building2, Users, Loader2, Phone, Mail, Trash2, ArrowUpDown } from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import type { Account, Contact, Opportunity, Ticket } from "@shared/schema";

const segmentColors: Record<string, string> = {
  marina: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  corp: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  partner: "bg-green-500/10 text-green-500 border-green-500/20",
  other: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

export default function AccountsPage() {
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const { toast } = useToast();
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const [sortOption, setSortOption] = useState("default");

  const PAGE_SIZE = 100;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<{ data: Account[]; total: number; page: number; totalPages: number }>({
    queryKey: ["/api/accounts", { search, segment: segmentFilter === "all" ? "" : segmentFilter, sort: sortOption }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (segmentFilter !== "all") params.set("segment", segmentFilter);
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Accounts</h1>
          <p className="text-muted-foreground mt-1">Manage marinas and corporate accounts.</p>
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
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Create Account</DialogTitle></DialogHeader>
            <CreateAccountForm onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search accounts..." value={search} onChange={(e) => { setSearch(e.target.value); }} className="pl-10" data-testid="input-search-accounts" />
        </div>
        <Select value={segmentFilter} onValueChange={(v) => { setSegmentFilter(v); }}>
          <SelectTrigger className="w-40" data-testid="select-segment-filter">
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
        <Select value={sortOption} onValueChange={setSortOption}>
          <SelectTrigger className="w-44" data-testid="select-sort">
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
                      <p className="text-xs text-muted-foreground">{account.region || "No region"}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={segmentColors[account.segment] || ""}>{account.segment}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{account.address || "No address"}</span>
                  {account.slipCount && <span>{account.slipCount} slips</span>}
                </div>
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

function AccountDetailDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const { toast } = useToast();
  const [addContactOpen, setAddContactOpen] = useState(false);

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

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-xl">{account.name}</DialogTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={segmentColors[account.segment] || ""}>{account.segment}</Badge>
                {account.region && <span className="text-sm text-muted-foreground">{account.region}</span>}
              </div>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="details" className="mt-4">
          <TabsList>
            <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
            <TabsTrigger value="contacts" data-testid="tab-contacts">Contacts ({contactsData?.length || 0})</TabsTrigger>
            <TabsTrigger value="opportunities" data-testid="tab-opportunities">Deals ({oppsData?.data?.length || 0})</TabsTrigger>
            <TabsTrigger value="tickets" data-testid="tab-tickets">Tickets ({ticketsData?.data?.length || 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-xs text-muted-foreground">Address</Label><p className="text-sm">{account.address || "—"}</p></div>
              <div><Label className="text-xs text-muted-foreground">Timezone</Label><p className="text-sm">{account.timezone || "—"}</p></div>
              <div><Label className="text-xs text-muted-foreground">Slip Count</Label><p className="text-sm">{account.slipCount || "—"}</p></div>
              <div><Label className="text-xs text-muted-foreground">Tags</Label><p className="text-sm">{account.tags || "—"}</p></div>
            </div>
            {account.notes && (
              <div><Label className="text-xs text-muted-foreground">Notes</Label><p className="text-sm">{account.notes}</p></div>
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
                      <p className="text-sm font-medium">{contact.name}</p>
                      <p className="text-xs text-muted-foreground">{contact.title || contact.persona || "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    {contact.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {contact.email}</span>}
                    {contact.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {contact.phone}</span>}
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
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function CreateAccountForm({ onSubmit, isPending }: { onSubmit: (data: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({ name: "", segment: "marina", address: "", region: "", slipCount: "", notes: "" });
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
      <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} data-testid="input-account-address" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Region</Label><Input value={form.region} onChange={(e) => setForm(f => ({ ...f, region: e.target.value }))} data-testid="input-account-region" /></div>
        <div><Label>Slip Count</Label><Input type="number" value={form.slipCount} onChange={(e) => setForm(f => ({ ...f, slipCount: e.target.value }))} data-testid="input-slip-count" /></div>
      </div>
      <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} data-testid="input-account-notes" /></div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-account">{isPending ? "Creating..." : "Create Account"}</Button>
    </form>
  );
}

function CreateContactForm({ onSubmit, isPending }: { onSubmit: (data: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({ name: "", title: "", email: "", phone: "", persona: "" });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required data-testid="input-contact-name" /></div>
      <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} data-testid="input-contact-title" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-contact-email" /></div>
        <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-contact-phone" /></div>
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
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-contact">{isPending ? "Adding..." : "Add Contact"}</Button>
    </form>
  );
}
