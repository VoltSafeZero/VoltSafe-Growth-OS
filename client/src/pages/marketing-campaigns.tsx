import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Radio, Plus, Search, Filter, MoreHorizontal, Play, Pause,
  CheckCircle, Clock, Archive, FileText, Zap, TrendingUp,
  Users, Mail, MousePointerClick, MessageSquare, Calendar,
  ChevronRight, UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const CAMPAIGN_TYPES = [
  { value: "awareness",          label: "Awareness Campaign" },
  { value: "problem_based",      label: "Problem-Based Campaign" },
  { value: "stakeholder_specific", label: "Stakeholder-Specific Campaign" },
  { value: "event",              label: "Event Campaign" },
  { value: "re_engagement",      label: "Re-Engagement Campaign" },
  { value: "product_update",     label: "Product Update Campaign" },
  { value: "pilot_recruitment",  label: "Pilot Recruitment Campaign" },
  { value: "partner_channel",    label: "Partner / Channel Campaign" },
  { value: "municipal_port",     label: "Municipal / Port Infrastructure" },
  { value: "developer_newbuild", label: "Developer / New Build" },
];

const CAMPAIGN_GOALS = [
  "Book demos",
  "Educate market",
  "Follow up with warm leads",
  "Promote event",
  "Re-engage old leads",
  "Announce product update",
  "Target pilot candidates",
  "Build partner/channel interest",
  "Drive event meetings",
  "Target new-build/developer opportunities",
];

const STATUS_CONFIG: Record<string, { label: string; variant: string; icon: React.ElementType }> = {
  draft:     { label: "Draft",     variant: "secondary", icon: FileText },
  scheduled: { label: "Scheduled", variant: "outline",   icon: Clock },
  active:    { label: "Active",    variant: "default",   icon: Play },
  paused:    { label: "Paused",    variant: "outline",   icon: Pause },
  completed: { label: "Completed", variant: "secondary", icon: CheckCircle },
  archived:  { label: "Archived",  variant: "secondary", icon: Archive },
};

function pct(num: number, denom: number) {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      status === "active" ? "bg-emerald-500/15 text-emerald-400" :
      status === "scheduled" ? "bg-blue-500/15 text-blue-400" :
      status === "paused" ? "bg-amber-500/15 text-amber-400" :
      "bg-muted text-muted-foreground"
    }`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

type Campaign = {
  id: number;
  campaign_name: string;
  campaign_type: string;
  goal: string | null;
  status: string;
  segment_id: number | null;
  segment_name: string | null;
  total_recipients: number;
  enrolled_count: number;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
  replied_count: number;
  demo_booked_count: number;
  updated_at: string;
};

export default function MarketingCampaignsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    campaignName: "",
    campaignType: "awareness",
    goal: "",
    notes: "",
  });

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/marketing/campaigns"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/marketing/campaigns", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] });
      setShowCreate(false);
      setForm({ campaignName: "", campaignType: "awareness", goal: "", notes: "" });
      toast({ title: "Campaign created", description: "Draft campaign ready to build." });
    },
    onError: () => toast({ title: "Error", description: "Failed to create campaign.", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/marketing/campaigns/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] }),
  });

  const filtered = campaigns.filter(c => {
    const matchSearch = !search || c.campaign_name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: campaigns.length,
    active: campaigns.filter(c => c.status === "active").length,
    totalSent: campaigns.reduce((a, c) => a + (c.sent_count ?? 0), 0),
    totalOpened: campaigns.reduce((a, c) => a + (c.opened_count ?? 0), 0),
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Radio className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Campaigns</h1>
            <p className="text-xs text-muted-foreground">Marina-specific campaign and buying committee intelligence</p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="btn-create-campaign">
          <Plus className="w-4 h-4 mr-2" /> New Campaign
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 px-6 py-4 border-b border-border/30 shrink-0">
        {[
          { label: "Total Campaigns", value: stats.total, icon: Radio, color: "text-primary" },
          { label: "Active", value: stats.active, icon: Play, color: "text-emerald-400" },
          { label: "Total Sent", value: stats.totalSent.toLocaleString(), icon: Mail, color: "text-blue-400" },
          { label: "Avg Open Rate", value: pct(stats.totalOpened, stats.totalSent), icon: TrendingUp, color: "text-amber-400" },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-border/50 bg-card/50 px-4 py-3 flex items-center gap-3">
            <s.icon className={`w-5 h-5 shrink-0 ${s.color}`} />
            <div>
              <div className="text-lg font-semibold text-foreground">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border/30 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search campaigns…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-8 text-sm"
            data-testid="input-campaign-search"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-campaign-status-filter">
            <Filter className="w-3.5 h-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([v, c]) => (
              <SelectItem key={v} value={v}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} campaign{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading campaigns…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Radio className="w-7 h-7 text-primary/60" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">No campaigns yet</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-xs">
              Create your first marina campaign to start targeting the right stakeholders.
            </p>
            <Button onClick={() => setShowCreate(true)} variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" /> Create Campaign
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  {["Campaign", "Type", "Status", "Audience", "Enrolled", "Open Rate", "Reply Rate", "Demos", ""].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => {
                  const typeLabel = CAMPAIGN_TYPES.find(t => t.value === c.campaign_type)?.label ?? c.campaign_type;
                  const enrolledCount = c.enrolled_count ?? 0;
                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                      data-testid={`campaign-row-${c.id}`}
                    >
                      <td className="px-4 py-3">
                        <Link href={`/marketing/campaigns/${c.id}`} className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1">
                          {c.campaign_name}
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                        </Link>
                        {c.goal && <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">{c.goal}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{typeLabel}</td>
                      <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[140px]">
                        {c.segment_name
                          ? <span className="truncate block" title={c.segment_name}>{c.segment_name}</span>
                          : <span className="text-muted-foreground/40 italic">No segment</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {enrolledCount > 0
                            ? <><UserCheck className="w-3 h-3 text-emerald-400" /><span className="font-mono text-xs text-emerald-400">{enrolledCount.toLocaleString()}</span></>
                            : <span className="text-xs text-muted-foreground/40 italic">Not enrolled</span>
                          }
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{pct(c.opened_count, c.sent_count)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{pct(c.replied_count, c.sent_count)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{c.demo_booked_count}</td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="w-7 h-7" data-testid={`campaign-menu-${c.id}`}>
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/marketing/campaigns/${c.id}`}>View Detail</Link>
                            </DropdownMenuItem>
                            {c.status === "active" && (
                              <DropdownMenuItem onClick={() => statusMutation.mutate({ id: c.id, status: "paused" })}>
                                Pause Campaign
                              </DropdownMenuItem>
                            )}
                            {c.status === "paused" && (
                              <DropdownMenuItem onClick={() => statusMutation.mutate({ id: c.id, status: "active" })}>
                                Resume Campaign
                              </DropdownMenuItem>
                            )}
                            {c.status === "draft" && (
                              <DropdownMenuItem onClick={() => statusMutation.mutate({ id: c.id, status: "active" })}>
                                Launch Campaign
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => statusMutation.mutate({ id: c.id, status: "archived" })}
                              className="text-destructive"
                            >
                              Archive
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-primary" /> New Campaign
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="campaignName">Campaign name *</Label>
              <Input
                id="campaignName"
                placeholder="e.g. BC Marina Shore Power Modernization"
                value={form.campaignName}
                onChange={e => setForm(f => ({ ...f, campaignName: e.target.value }))}
                data-testid="input-campaign-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaignType">Campaign type</Label>
              <Select value={form.campaignType} onValueChange={v => setForm(f => ({ ...f, campaignType: v }))}>
                <SelectTrigger id="campaignType" data-testid="select-campaign-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal">Goal</Label>
              <Select value={form.goal} onValueChange={v => setForm(f => ({ ...f, goal: v }))}>
                <SelectTrigger id="goal" data-testid="select-campaign-goal">
                  <SelectValue placeholder="Select a goal…" />
                </SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_GOALS.map(g => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add context, audience notes, or strategy…"
                rows={3}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                data-testid="textarea-campaign-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.campaignName.trim() || createMutation.isPending}
              data-testid="btn-confirm-create-campaign"
            >
              {createMutation.isPending ? "Creating…" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
