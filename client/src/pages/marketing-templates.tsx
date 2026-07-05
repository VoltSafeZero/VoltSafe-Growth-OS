import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Plus, Star, Users, Target, Copy, Edit2, Trash2 } from "lucide-react";
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

const CAMPAIGN_TYPES = [
  { value: "awareness",          label: "Awareness" },
  { value: "problem_based",      label: "Problem-Based" },
  { value: "stakeholder_specific", label: "Stakeholder-Specific" },
  { value: "event",              label: "Event" },
  { value: "re_engagement",      label: "Re-Engagement" },
  { value: "pilot_recruitment",  label: "Pilot Recruitment" },
  { value: "municipal_port",     label: "Municipal / Port" },
  { value: "developer_newbuild", label: "Developer / New Build" },
];

const STAKEHOLDER_ROLES = [
  "Owner", "GM", "Harbormaster", "Dockmaster", "Marine Electrician",
  "Port Manager", "Developer", "Operations", "Finance",
];

const MARINA_PERSONAS = [
  "Mom & Pop Marina", "Premium Independent Marina", "Marina Group / Multi-Site Operator",
  "Municipal Marina", "Port Authority Marina", "Yacht Club", "Resort / Destination Marina",
  "Developer / New Build", "Working Harbour / Commercial Marina",
];

type Template = {
  id: number;
  templateName: string;
  persona: string | null;
  stakeholderRole: string | null;
  campaignType: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  recommendedCta: string | null;
  isStarter: boolean;
  createdAt: string;
};

const EMPTY_FORM = {
  templateName: "",
  persona: "",
  stakeholderRole: "",
  campaignType: "awareness",
  subject: "",
  bodyText: "",
  recommendedCta: "",
};

function TemplateCard({ t, onSelect }: { t: Template; onSelect: (t: Template) => void }) {
  const typeLabel = CAMPAIGN_TYPES.find(x => x.value === t.campaignType)?.label ?? t.campaignType;
  return (
    <div
      className="rounded-xl border border-border/50 bg-card/50 p-4 flex flex-col gap-3 cursor-pointer hover:border-primary/30 hover:bg-card transition-all"
      onClick={() => onSelect(t)}
      data-testid={`template-card-${t.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm text-foreground leading-snug">{t.templateName}</div>
        {t.isStarter && <Star className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {t.campaignType && (
          <Badge variant="outline" className="text-xs">{typeLabel}</Badge>
        )}
        {t.stakeholderRole && (
          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-400/30">
            <Users className="w-3 h-3 mr-1" />{t.stakeholderRole}
          </Badge>
        )}
        {t.persona && (
          <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-400/30">
            {t.persona.split("/")[0].trim()}
          </Badge>
        )}
      </div>
      {t.subject && (
        <div className="text-xs text-muted-foreground italic truncate">"{t.subject}"</div>
      )}
      {t.recommendedCta && (
        <div className="text-xs text-primary/80 flex items-center gap-1 truncate">
          <Target className="w-3 h-3 shrink-0" /> {t.recommendedCta}
        </div>
      )}
    </div>
  );
}

export default function MarketingTemplatesPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Template | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["/api/marketing/templates"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/marketing/templates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/templates"] });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      toast({ title: "Template saved" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/marketing/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/templates"] });
      setSelected(null);
    },
  });

  const filtered = templates.filter(t => {
    const matchSearch = !search || t.templateName.toLowerCase().includes(search.toLowerCase()) ||
      (t.subject ?? "").toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || t.campaignType === typeFilter;
    const matchRole = roleFilter === "all" || t.stakeholderRole === roleFilter;
    return matchSearch && matchType && matchRole;
  });

  const starters = filtered.filter(t => t.isStarter);
  const custom = filtered.filter(t => !t.isStarter);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between px-6 py-5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Templates</h1>
            <p className="text-xs text-muted-foreground">Marina-specific campaign templates by persona and stakeholder role</p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="btn-create-template">
          <Plus className="w-4 h-4 mr-2" /> New Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border/30 shrink-0">
        <Input
          placeholder="Search templates…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-8 text-sm max-w-xs"
        />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-40 text-sm">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {CAMPAIGN_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-8 w-40 text-sm">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {STAKEHOLDER_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading templates…</div>
        ) : (
          <>
            {starters.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Star className="w-4 h-4 text-amber-400" />
                  <h2 className="text-sm font-semibold text-foreground">Starter Templates</h2>
                  <span className="text-xs text-muted-foreground">({starters.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {starters.map(t => <TemplateCard key={t.id} t={t} onSelect={setSelected} />)}
                </div>
              </div>
            )}
            {custom.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3">Custom Templates ({custom.length})</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {custom.map(t => <TemplateCard key={t.id} t={t} onSelect={setSelected} />)}
                </div>
              </div>
            )}
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
                <p className="text-sm text-muted-foreground">No templates match your filters.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Template detail / preview */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  {selected.templateName}
                  {selected.isStarter && <Star className="w-4 h-4 text-amber-400" />}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="flex flex-wrap gap-2">
                  {selected.campaignType && <Badge variant="outline">{CAMPAIGN_TYPES.find(x => x.value === selected.campaignType)?.label ?? selected.campaignType}</Badge>}
                  {selected.stakeholderRole && <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-400/30">{selected.stakeholderRole}</Badge>}
                  {selected.persona && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-400/30">{selected.persona}</Badge>}
                </div>
                {selected.subject && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                    <div className="text-xs text-muted-foreground mb-1">Subject Line</div>
                    <div className="text-sm font-medium text-foreground">{selected.subject}</div>
                  </div>
                )}
                {selected.bodyText && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                    <div className="text-xs text-muted-foreground mb-2">Body</div>
                    <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{selected.bodyText}</div>
                  </div>
                )}
                {selected.recommendedCta && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                    <div className="text-xs text-muted-foreground mb-1">Recommended CTA</div>
                    <div className="text-sm font-medium text-primary">{selected.recommendedCta}</div>
                  </div>
                )}
              </div>
              <DialogFooter className="flex gap-2">
                {!selected.isStarter && (
                  <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(selected.id)}>
                    <Trash2 className="w-4 h-4 mr-1" /> Delete
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setSelected(null)}>Close</Button>
                <Button size="sm" onClick={() => {
                  setForm({
                    templateName: `Copy of ${selected.templateName}`,
                    persona: selected.persona ?? "",
                    stakeholderRole: selected.stakeholderRole ?? "",
                    campaignType: selected.campaignType ?? "awareness",
                    subject: selected.subject ?? "",
                    bodyText: selected.bodyText ?? "",
                    recommendedCta: selected.recommendedCta ?? "",
                  });
                  setSelected(null);
                  setShowCreate(true);
                }}>
                  <Copy className="w-4 h-4 mr-1" /> Duplicate
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Template name *</Label>
              <Input placeholder="e.g. Harbormaster Safety — BC Ports" value={form.templateName}
                onChange={e => setForm(f => ({ ...f, templateName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Campaign type</Label>
                <Select value={form.campaignType} onValueChange={v => setForm(f => ({ ...f, campaignType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Stakeholder role</Label>
                <Select value={form.stakeholderRole} onValueChange={v => setForm(f => ({ ...f, stakeholderRole: v }))}>
                  <SelectTrigger><SelectValue placeholder="Any role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Any role</SelectItem>
                    {STAKEHOLDER_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Marina persona</Label>
              <Select value={form.persona} onValueChange={v => setForm(f => ({ ...f, persona: v }))}>
                <SelectTrigger><SelectValue placeholder="Any persona" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any persona</SelectItem>
                  {MARINA_PERSONAS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Subject line</Label>
              <Input placeholder="e.g. Shore Power Problems Land on Your Team First"
                value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Body copy</Label>
              <Textarea rows={5} placeholder="Email body content…"
                value={form.bodyText} onChange={e => setForm(f => ({ ...f, bodyText: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Recommended CTA</Label>
              <Input placeholder="e.g. Book a 20-minute marina assessment"
                value={form.recommendedCta} onChange={e => setForm(f => ({ ...f, recommendedCta: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(form)}
              disabled={!form.templateName.trim() || createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Save Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
