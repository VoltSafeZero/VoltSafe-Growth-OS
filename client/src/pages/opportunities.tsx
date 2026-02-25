import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Plus, List, Columns3, DollarSign } from "lucide-react";
import type { Opportunity, Account } from "@shared/schema";

const STAGES = [
  { key: "prospecting", label: "Prospecting", color: "bg-blue-500" },
  { key: "qualification", label: "Qualification", color: "bg-yellow-500" },
  { key: "proposal", label: "Proposal", color: "bg-orange-500" },
  { key: "negotiation", label: "Negotiation", color: "bg-purple-500" },
  { key: "closed_won", label: "Closed Won", color: "bg-green-500" },
  { key: "closed_lost", label: "Closed Lost", color: "bg-red-500" },
];

const stageColorMap: Record<string, string> = {
  prospecting: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  qualification: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  proposal: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  negotiation: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  closed_won: "bg-green-500/10 text-green-400 border-green-500/20",
  closed_lost: "bg-red-500/10 text-red-400 border-red-500/20",
};

export default function OpportunitiesPage() {
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ data: Opportunity[]; total: number }>({
    queryKey: ["/api/opportunities"],
    queryFn: async () => {
      const res = await fetch("/api/opportunities?limit=200");
      return res.json();
    },
  });

  const { data: accountsData } = useQuery<{ data: Account[] }>({
    queryKey: ["/api/accounts", "all"],
    queryFn: async () => {
      const res = await fetch("/api/accounts?limit=200");
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
      toast({ title: "Opportunity created" });
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: number; stage: string }) => {
      const res = await apiRequest("PUT", `/api/opportunities/${id}`, { stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
  });

  const accountMap = new Map(accountsData?.data?.map(a => [a.id, a.name]) || []);

  const groupedByStage = STAGES.map(stage => ({
    ...stage,
    items: data?.data?.filter(o => o.stage === stage.key) || [],
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Opportunities</h1>
          <p className="text-muted-foreground mt-1">Track deals through your sales pipeline.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex border border-border/50 rounded-lg overflow-hidden">
            <Button variant={viewMode === "kanban" ? "secondary" : "ghost"} size="sm" onClick={() => setViewMode("kanban")} data-testid="button-kanban-view">
              <Columns3 className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="sm" onClick={() => setViewMode("list")} data-testid="button-list-view">
              <List className="h-4 w-4" />
            </Button>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground" data-testid="button-create-opp">
                <Plus className="mr-2 h-4 w-4" /> New Deal
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Create Opportunity</DialogTitle></DialogHeader>
              <CreateOppForm accounts={accountsData?.data || []} onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto">{[...Array(6)].map((_, i) => <Skeleton key={i} className="min-w-[280px] h-[400px]" />)}</div>
      ) : viewMode === "kanban" ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {groupedByStage.map(stage => (
            <div key={stage.key} className="min-w-[280px] flex-shrink-0" data-testid={`column-${stage.key}`}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`w-2 h-2 rounded-full ${stage.color}`} />
                <h3 className="text-sm font-semibold">{stage.label}</h3>
                <Badge variant="outline" className="ml-auto text-xs">{stage.items.length}</Badge>
              </div>
              <div className="space-y-2">
                {stage.items.map(opp => (
                  <Card key={opp.id} className="border-border/50 hover:border-primary/30 cursor-pointer transition-colors" onClick={() => setSelectedOpp(opp)} data-testid={`card-opp-${opp.id}`}>
                    <CardContent className="p-4">
                      <p className="font-medium text-sm mb-1">{opp.title}</p>
                      <p className="text-xs text-muted-foreground mb-2">{accountMap.get(opp.accountId) || "Unknown Account"}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold flex items-center gap-1">
                          <DollarSign className="h-3 w-3 text-primary" />
                          {opp.valueTotal?.toLocaleString() || "0"}
                        </span>
                        {opp.estCloseDate && (
                          <span className="text-xs text-muted-foreground">{new Date(opp.estCloseDate).toLocaleDateString()}</span>
                        )}
                      </div>
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
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Deal</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Account</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Stage</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Value</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Close Date</th>
                </tr>
              </thead>
              <tbody>
                {data?.data?.map(opp => (
                  <tr key={opp.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedOpp(opp)} data-testid={`row-opp-${opp.id}`}>
                    <td className="p-4 font-medium">{opp.title}</td>
                    <td className="p-4 text-sm text-muted-foreground">{accountMap.get(opp.accountId) || "—"}</td>
                    <td className="p-4"><Badge variant="outline" className={stageColorMap[opp.stage] || ""}>{opp.stage}</Badge></td>
                    <td className="p-4 text-sm font-medium">${opp.valueTotal?.toLocaleString() || "0"}</td>
                    <td className="p-4 text-sm text-muted-foreground">{opp.estCloseDate ? new Date(opp.estCloseDate).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {selectedOpp && (
        <OppDetailDialog opp={selectedOpp} accountName={accountMap.get(selectedOpp.accountId) || "Unknown"} stages={STAGES} onStageChange={(stage) => { updateStageMutation.mutate({ id: selectedOpp.id, stage }); setSelectedOpp({ ...selectedOpp, stage }); }} onClose={() => setSelectedOpp(null)} />
      )}
    </div>
  );
}

function OppDetailDialog({ opp, accountName, stages, onStageChange, onClose }: { opp: Opportunity; accountName: string; stages: typeof STAGES; onStageChange: (s: string) => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{opp.title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{accountName}</p>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Stage</Label>
            <Select value={opp.stage} onValueChange={onStageChange}>
              <SelectTrigger data-testid="select-opp-stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                {stages.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-xs text-muted-foreground">Hardware Value</Label><p className="text-sm">${opp.valueHardware?.toLocaleString() || "0"}</p></div>
            <div><Label className="text-xs text-muted-foreground">Software Value</Label><p className="text-sm">${opp.valueSoftware?.toLocaleString() || "0"}</p></div>
            <div><Label className="text-xs text-muted-foreground">Services Value</Label><p className="text-sm">${opp.valueServices?.toLocaleString() || "0"}</p></div>
            <div><Label className="text-xs text-muted-foreground">Total Value</Label><p className="text-sm font-bold">${opp.valueTotal?.toLocaleString() || "0"}</p></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-xs text-muted-foreground">Est. Close Date</Label><p className="text-sm">{opp.estCloseDate ? new Date(opp.estCloseDate).toLocaleDateString() : "—"}</p></div>
            <div><Label className="text-xs text-muted-foreground">Competitors</Label><p className="text-sm">{opp.competitors || "—"}</p></div>
          </div>
          {opp.nextStep && <div><Label className="text-xs text-muted-foreground">Next Step</Label><p className="text-sm">{opp.nextStep}</p></div>}
          {opp.notes && <div><Label className="text-xs text-muted-foreground">Notes</Label><p className="text-sm">{opp.notes}</p></div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateOppForm({ accounts, onSubmit, isPending }: { accounts: Account[]; onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({ title: "", accountId: "", stage: "prospecting", valueHardware: "", valueSoftware: "", valueServices: "", notes: "" });
  const total = (Number(form.valueHardware) || 0) + (Number(form.valueSoftware) || 0) + (Number(form.valueServices) || 0);

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...form, accountId: Number(form.accountId), valueHardware: Number(form.valueHardware) || 0, valueSoftware: Number(form.valueSoftware) || 0, valueServices: Number(form.valueServices) || 0, valueTotal: total }); }} className="space-y-4">
      <div><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} required data-testid="input-opp-title" /></div>
      <div>
        <Label>Account *</Label>
        <Select value={form.accountId} onValueChange={(v) => setForm(f => ({ ...f, accountId: v }))}>
          <SelectTrigger data-testid="select-opp-account"><SelectValue placeholder="Select account" /></SelectTrigger>
          <SelectContent>
            {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Stage</Label>
        <Select value={form.stage} onValueChange={(v) => setForm(f => ({ ...f, stage: v }))}>
          <SelectTrigger data-testid="select-opp-stage"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">Hardware $</Label><Input type="number" value={form.valueHardware} onChange={(e) => setForm(f => ({ ...f, valueHardware: e.target.value }))} data-testid="input-value-hardware" /></div>
        <div><Label className="text-xs">Software $</Label><Input type="number" value={form.valueSoftware} onChange={(e) => setForm(f => ({ ...f, valueSoftware: e.target.value }))} data-testid="input-value-software" /></div>
        <div><Label className="text-xs">Services $</Label><Input type="number" value={form.valueServices} onChange={(e) => setForm(f => ({ ...f, valueServices: e.target.value }))} data-testid="input-value-services" /></div>
      </div>
      <p className="text-sm text-muted-foreground">Total: <span className="font-bold text-foreground">${total.toLocaleString()}</span></p>
      <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} data-testid="input-opp-notes" /></div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-opp">{isPending ? "Creating..." : "Create Opportunity"}</Button>
    </form>
  );
}
