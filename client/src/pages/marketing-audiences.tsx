import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MarketingDrilldownSheet, type DrilldownConfig } from "@/components/marketing/marketing-drilldown-sheet";
import {
  Users, Plus, Trash2, Filter, Save, ChevronDown, ChevronUp,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const MARINA_PERSONAS = [
  "Mom & Pop Marina", "Premium Independent Marina", "Marina Group / Multi-Site Operator",
  "Municipal Marina", "Port Authority Marina", "Yacht Club", "Resort / Destination Marina",
  "Developer / New Build", "Working Harbour / Commercial Marina", "Government / Institutional Dock", "Unknown",
];

const ADOPTION_STAGES = ["Innovator", "Early Adopter", "Early Majority", "Late Majority", "Laggard", "Unknown"];

const PRIMARY_PAINS = [
  "Aging Shore Power", "Safety / Compliance", "Manual Meter Reading", "Revenue Leakage",
  "Boater Experience", "Electrical Reliability", "Infrastructure Modernization",
  "Sustainability / Electrification", "New Build Specification", "Unknown",
];

const CONTACT_ROLES = [
  "Owner", "GM", "Harbormaster", "Dockmaster", "Marine Electrician",
  "Port Manager", "Developer", "Operations", "Finance", "Unknown",
];

type FilterClause = {
  id: string;
  field: string;
  operator: string;
  value: string;
};

type Segment = {
  id: number;
  segmentName: string;
  description: string | null;
  filtersJson: FilterClause[] | null;
  segmentType: string;
  recipientCount: number;
  createdAt: string;
};

const ACCOUNT_FILTER_FIELDS = [
  { value: "marina_persona",      label: "Marina Persona" },
  { value: "adoption_stage",      label: "Adoption Stage" },
  { value: "primary_pain",        label: "Primary Pain" },
  { value: "state_province",      label: "Province / State" },
  { value: "country",             label: "Country" },
  { value: "city",                label: "City" },
  { value: "slip_count_gte",      label: "Slip Count ≥" },
  { value: "lead_status",         label: "Lead Status" },
  { value: "ownership_type",      label: "Ownership Type" },
  { value: "no_activity_days",    label: "No Activity (days)" },
];

const CONTACT_FILTER_FIELDS = [
  { value: "contact_role",        label: "Contact Role" },
  { value: "has_email",           label: "Has Email" },
  { value: "not_unsubscribed",    label: "Not Unsubscribed" },
  { value: "not_bounced",         label: "Not Bounced" },
  { value: "not_suppressed",      label: "Not Suppressed" },
];

function newClause(): FilterClause {
  return { id: crypto.randomUUID(), field: "marina_persona", operator: "eq", value: "" };
}

export default function MarketingAudiencesPage() {
  const { toast } = useToast();
  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [form, setForm] = useState({ segmentName: "", description: "", segmentType: "dynamic" });
  const [clauses, setClauses] = useState<FilterClause[]>([newClause()]);

  const { data: segments = [], isLoading } = useQuery<Segment[]>({
    queryKey: ["/api/marketing/segments"],
  });

  const createMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/marketing/segments", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/segments"] });
      setShowCreate(false);
      setForm({ segmentName: "", description: "", segmentType: "dynamic" });
      setClauses([newClause()]);
      toast({ title: "Audience saved" });
    },
    onError: () => toast({ title: "Error", description: "Failed to save audience.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/marketing/segments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketing/segments"] }),
  });

  function addClause() { setClauses(prev => [...prev, newClause()]); }
  function removeClause(id: string) { setClauses(prev => prev.filter(c => c.id !== id)); }
  function updateClause(id: string, patch: Partial<FilterClause>) {
    setClauses(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }

  const allFields = [...ACCOUNT_FILTER_FIELDS, ...CONTACT_FILTER_FIELDS];

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Audiences</h1>
            <p className="text-xs text-muted-foreground">Saved segments and dynamic audience filters</p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="btn-create-segment">
          <Plus className="w-4 h-4 mr-2" /> New Audience
        </Button>
      </div>

      {/* Segment list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading audiences…</div>
        ) : segments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Filter className="w-7 h-7 text-primary/60" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">No audiences saved</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-xs">
              Build dynamic segments from CRM data to power targeted campaigns.
            </p>
            <Button onClick={() => setShowCreate(true)} variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" /> Create Audience
            </Button>
          </div>
        ) : (
          segments.map(seg => {
            const isOpen = expandedId === seg.id;
            const filters = Array.isArray(seg.filtersJson) ? seg.filtersJson : [];
            return (
              <div key={seg.id} className="rounded-xl border border-border/50 bg-card/50 overflow-hidden" data-testid={`segment-row-${seg.id}`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Filter className="w-4 h-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-foreground text-sm">{seg.segmentName}</div>
                      {seg.description && <div className="text-xs text-muted-foreground truncate">{seg.description}</div>}
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {seg.segmentType}
                    </Badge>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {filters.length} filter{filters.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {seg.recipientCount > 0 ? (
                      <button
                        onClick={e => { e.stopPropagation(); setDrilldown({ metric: "audience_contacts", title: seg.segmentName, extraParams: { segment_id: seg.id } }); }}
                        className="text-xs font-mono text-primary hover:text-primary/80 hover:underline transition-colors cursor-pointer"
                        data-testid={`audience-count-${seg.id}`}
                        aria-label={`View ${seg.recipientCount} contacts in ${seg.segmentName}`}
                      >
                        ~{seg.recipientCount.toLocaleString()} contacts →
                      </button>
                    ) : (
                      <span className="text-xs font-mono text-muted-foreground">Not calculated</span>
                    )}
                    <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => setExpandedId(isOpen ? null : seg.id)}>
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-destructive" onClick={() => deleteMutation.mutate(seg.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                {isOpen && filters.length > 0 && (
                  <div className="border-t border-border/30 px-4 py-3 bg-muted/20">
                    <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Filters</div>
                    <div className="space-y-1.5">
                      {filters.map((f, idx) => {
                        const fieldLabel = allFields.find(af => af.value === f.field)?.label ?? f.field;
                        return (
                          <div key={idx} className="flex items-center gap-2 text-xs text-foreground">
                            <span className="text-muted-foreground">•</span>
                            <span className="font-medium">{fieldLabel}</span>
                            <span className="text-muted-foreground">{f.operator}</span>
                            <span className="text-primary font-medium">{f.value || "—"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Starter segment suggestions */}
        {segments.length === 0 && (
          <div className="mt-8">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Example segments to build</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[
                "BC marinas with 100+ slips, municipal or port-owned, with GM or harbormaster contacts, not contacted in 90 days",
                "Premium Independent Marinas with decision-maker contacts and no active opportunity",
                "Marina Groups — multi-site operators with harbormaster or GM contacts",
                "Warm leads — opened previous campaigns but never replied",
                "Resort / Destination Marinas in BC, WA, or OR with Owner or GM contacts",
                "Municipal marinas with known safety / compliance pain",
              ].map((example, i) => (
                <div key={i} className="rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  "{example}"
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> New Audience Segment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Segment name *</Label>
                <Input
                  placeholder="e.g. BC Premium Marinas 100+ Slips"
                  value={form.segmentName}
                  onChange={e => setForm(f => ({ ...f, segmentName: e.target.value }))}
                  data-testid="input-segment-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.segmentType} onValueChange={v => setForm(f => ({ ...f, segmentType: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dynamic">Dynamic (auto-updates)</SelectItem>
                    <SelectItem value="static">Static (fixed list)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Describe who this audience targets and why…"
                rows={2}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* Filter builder */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Filters</Label>
                <Button variant="ghost" size="sm" onClick={addClause} className="h-7 text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add filter
                </Button>
              </div>
              <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
                {clauses.map((clause, idx) => (
                  <div key={clause.id} className="flex items-center gap-2">
                    {idx > 0 && (
                      <span className="text-xs text-muted-foreground w-6 text-right shrink-0">AND</span>
                    )}
                    {idx === 0 && <span className="w-6 shrink-0" />}
                    <Select value={clause.field} onValueChange={v => updateClause(clause.id, { field: v })}>
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Account Filters</div>
                        {ACCOUNT_FILTER_FIELDS.map(f => (
                          <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                        ))}
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground border-t border-border/30 mt-1 pt-2">Contact Filters</div>
                        {CONTACT_FILTER_FIELDS.map(f => (
                          <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {["marina_persona"].includes(clause.field) ? (
                      <Select value={clause.value} onValueChange={v => updateClause(clause.id, { value: v })}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {MARINA_PERSONAS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : ["adoption_stage"].includes(clause.field) ? (
                      <Select value={clause.value} onValueChange={v => updateClause(clause.id, { value: v })}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {ADOPTION_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : ["contact_role"].includes(clause.field) ? (
                      <Select value={clause.value} onValueChange={v => updateClause(clause.id, { value: v })}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {CONTACT_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : ["primary_pain"].includes(clause.field) ? (
                      <Select value={clause.value} onValueChange={v => updateClause(clause.id, { value: v })}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIMARY_PAINS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : ["has_email", "not_unsubscribed", "not_bounced", "not_suppressed"].includes(clause.field) ? (
                      <span className="text-xs text-muted-foreground flex-1 px-2">— boolean flag (no value needed)</span>
                    ) : (
                      <Input
                        className="h-8 text-xs flex-1"
                        placeholder="Value…"
                        value={clause.value}
                        onChange={e => updateClause(clause.id, { value: e.target.value })}
                      />
                    )}
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeClause(clause.id)} disabled={clauses.length === 1}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ ...form, filtersJson: clauses })}
              disabled={!form.segmentName.trim() || createMutation.isPending}
              data-testid="btn-save-segment"
            >
              <Save className="w-4 h-4 mr-2" />
              {createMutation.isPending ? "Saving…" : "Save Audience"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MarketingDrilldownSheet config={drilldown} onClose={() => setDrilldown(null)} />
    </div>
  );
}
