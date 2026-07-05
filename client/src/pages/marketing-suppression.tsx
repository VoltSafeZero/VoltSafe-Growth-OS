import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Ban, Plus, Trash2, Search, Mail, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type SuppressionEntry = {
  id: number;
  email: string | null;
  domain: string | null;
  reason: string | null;
  source: string | null;
  createdAt: string;
};

const REASONS = [
  "Unsubscribed", "Bounced", "Do Not Contact", "Competitor", "Existing Customer",
  "Wrong Person", "Legal Request", "Manual Override",
];

export default function MarketingSuppressionPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ email: "", domain: "", reason: "Unsubscribed", source: "manual" });

  const { data: entries = [], isLoading } = useQuery<SuppressionEntry[]>({
    queryKey: ["/api/marketing/suppression"],
  });

  const addMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/marketing/suppression", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/suppression"] });
      setShowAdd(false);
      setForm({ email: "", domain: "", reason: "Unsubscribed", source: "manual" });
      toast({ title: "Added to suppression list" });
    },
    onError: () => toast({ title: "Error", description: "Could not add entry — it may already exist.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/marketing/suppression/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketing/suppression"] }),
  });

  const filtered = entries.filter(e => {
    const q = search.toLowerCase();
    return !q || (e.email ?? "").includes(q) || (e.domain ?? "").includes(q);
  });

  const emailCount = entries.filter(e => e.email && !e.domain).length;
  const domainCount = entries.filter(e => e.domain).length;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between px-6 py-5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
            <Ban className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Suppression List</h1>
            <p className="text-xs text-muted-foreground">
              Blocked emails and domains — excluded from all campaign sends
            </p>
          </div>
        </div>
        <Button onClick={() => setShowAdd(true)} variant="outline" data-testid="btn-add-suppression">
          <Plus className="w-4 h-4 mr-2" /> Add Entry
        </Button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 px-6 py-3 border-b border-border/30 shrink-0 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Mail className="w-4 h-4" />
          <span><span className="font-semibold text-foreground">{emailCount}</span> email{emailCount !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Globe className="w-4 h-4" />
          <span><span className="font-semibold text-foreground">{domainCount}</span> domain{domainCount !== 1 ? "s" : ""}</span>
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-7 text-sm w-48"
          />
        </div>
      </div>

      {/* Compliance note */}
      <div className="mx-6 mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300/90 shrink-0">
        <strong>Compliance:</strong> All campaign sends automatically exclude contacts on this list.
        Unsubscribe requests and hard bounces should be added here immediately and never contacted again.
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading suppression list…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Ban className="w-12 h-12 text-muted-foreground/20 mb-4" />
            <h3 className="font-semibold text-foreground mb-1">
              {search ? "No entries match your search" : "Suppression list is empty"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {search ? "Try a different search." : "Add emails or domains that should never receive campaigns."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  {["Type", "Email / Domain", "Reason", "Source", "Added", ""].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr key={e.id} className={`border-b border-border/30 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    data-testid={`suppression-row-${e.id}`}>
                    <td className="px-4 py-3">
                      {e.domain ? (
                        <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-400 border-orange-400/30">
                          <Globe className="w-3 h-3 mr-1" />domain
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-400/30">
                          <Mail className="w-3 h-3 mr-1" />email
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {e.domain ?? e.email}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{e.reason ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{e.source ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(e.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="w-5 h-5 text-red-400" /> Add to Suppression List
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Email address <span className="text-muted-foreground">(or leave blank for domain suppression)</span></Label>
              <Input placeholder="contact@marinaexample.com" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                data-testid="input-suppression-email" />
            </div>
            <div className="space-y-2">
              <Label>Domain <span className="text-muted-foreground">(suppresses all emails from this domain)</span></Label>
              <Input placeholder="marinaexample.com" value={form.domain}
                onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                data-testid="input-suppression-domain" />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={form.reason} onValueChange={v => setForm(f => ({ ...f, reason: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button
              onClick={() => addMutation.mutate(form)}
              disabled={(!form.email.trim() && !form.domain.trim()) || addMutation.isPending}
              variant="destructive"
              data-testid="btn-confirm-add-suppression"
            >
              {addMutation.isPending ? "Adding…" : "Add to Suppression"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
