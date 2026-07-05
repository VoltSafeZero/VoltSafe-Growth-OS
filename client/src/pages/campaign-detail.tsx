import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Radio, ArrowLeft, Plus, Trash2, Play, Pause, CheckCircle, Edit2,
  Mail, MousePointerClick, MessageSquare, Calendar, Users, Target,
  Sparkles, Save, FileText, Clock, UserCheck, AlertTriangle, ChevronDown, ChevronUp,
  RefreshCw, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

type Campaign = {
  id: number;
  campaignName: string;
  campaignType: string;
  goal: string | null;
  status: string;
  notes: string | null;
  segmentId: number | null;
  totalRecipients: number;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  repliedCount: number;
  bouncedCount: number;
  demoBookedCount: number;
  updatedAt: string;
};

type CampaignEmail = {
  id: number;
  stepNumber: number;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  delayDays: number;
  status: string;
};

type Segment = {
  id: number;
  segmentName: string;
  description: string | null;
  filtersJson: any;
  recipientCount: number;
};

type RecipientResult = {
  contactId: number;
  accountId: number | null;
  name: string;
  email: string;
  title: string | null;
  roleType: string | null;
  accountName: string | null;
  marinaPersona: string | null;
  adoptionStage: string | null;
  primaryPain: string | null;
  region: string | null;
  status: "eligible" | "excluded" | "already_enrolled";
  exclusionReason: string | null;
};

type PreviewResult = {
  segmentName: string;
  recipients: RecipientResult[];
  totalMatched: number;
  eligibleCount: number;
  excludedCount: number;
  alreadyEnrolledCount: number;
  exclusionBreakdown: Record<string, number>;
};

type EnrollResult = {
  enrolled_count: number;
  skipped_count: number;
  already_enrolled_count: number;
  excluded_count: number;
  exclusion_breakdown: Record<string, number>;
  total_recipients: number;
};

const STAKEHOLDER_OPENINGS = [
  { role: "Owner", opening: "Many marinas are leaving money on the dock through outdated shore power billing." },
  { role: "GM", opening: "Managing shore power should not require manual readings, mystery outages, and boater complaints." },
  { role: "Harbormaster", opening: "Shore power problems usually land on your team first — even when the infrastructure is the real issue." },
  { role: "Marine Electrician", opening: "VoltSafe gives marinas smarter shore power without relying on exposed legacy connection points." },
  { role: "Port Manager", opening: "Public marina infrastructure is under pressure to become safer, smarter, and more resilient." },
  { role: "Developer", opening: "New marina projects should not be specifying yesterday's shore power infrastructure into tomorrow's waterfront." },
];

function exclusionLabel(reason: string): string {
  const map: Record<string, string> = {
    missing_email: "No email",
    invalid_email: "Invalid email",
    internal_voltsafe_email: "Internal address",
    do_not_email: "Do not email",
    bounced: "Bounced",
    unsubscribed: "Unsubscribed",
    suppressed_email: "Suppressed email",
    suppressed_domain: "Suppressed domain",
    duplicate_email: "Duplicate email",
    already_enrolled: "Already enrolled",
  };
  return map[reason] ?? reason;
}

const PREVIEW_TABLE_LIMIT = 100;

export default function CampaignDetailPage() {
  const [, params] = useRoute("/marketing/campaigns/:id");
  const id = Number((params as any)?.id);
  const { toast } = useToast();

  const [showAddEmail, setShowAddEmail] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [emailForm, setEmailForm] = useState({ subject: "", bodyText: "", delayDays: 0 });

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFilter, setPreviewFilter] = useState<"all" | "eligible" | "excluded" | "already_enrolled">("all");
  const [enrollResult, setEnrollResult] = useState<EnrollResult | null>(null);

  const { data: campaign, isLoading } = useQuery<Campaign>({
    queryKey: ["/api/marketing/campaigns", id],
    enabled: !!id,
  });

  const { data: emails = [] } = useQuery<CampaignEmail[]>({
    queryKey: ["/api/marketing/campaigns", id, "emails"],
    enabled: !!id,
  });

  const { data: segments = [] } = useQuery<Segment[]>({
    queryKey: ["/api/marketing/segments"],
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/marketing/campaigns/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] });
    },
  });

  const segmentMutation = useMutation({
    mutationFn: (segmentId: number | null) => apiRequest("PATCH", `/api/marketing/campaigns/${id}`, { segmentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] });
      setPreview(null);
      setEnrollResult(null);
      toast({ title: "Segment updated" });
    },
  });

  const addEmailMutation = useMutation({
    mutationFn: (data: typeof emailForm) =>
      apiRequest("POST", `/api/marketing/campaigns/${id}/emails`, {
        ...data,
        stepNumber: emails.length + 1,
        status: "draft",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id, "emails"] });
      setShowAddEmail(false);
      setEmailForm({ subject: "", bodyText: "", delayDays: 0 });
      toast({ title: "Email step added" });
    },
  });

  const deleteEmailMutation = useMutation({
    mutationFn: (emailId: number) => apiRequest("DELETE", `/api/marketing/campaigns/${id}/emails/${emailId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id, "emails"] }),
  });

  const seedSequenceMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/marketing/campaigns/${id}/seed-sequence`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id, "emails"] });
      toast({ title: "Default 5-email sequence added" });
    },
    onError: (err: any) => {
      toast({ title: "Sequence already exists", description: "Delete existing steps first.", variant: "destructive" });
    },
  });

  const enrollMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/marketing/campaigns/${id}/enroll-recipients`, {}),
    onSuccess: async (res) => {
      const data: EnrollResult = await res.json();
      setEnrollResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] });
      toast({ title: `Enrolled ${data.enrolled_count} recipients`, description: `${data.excluded_count} excluded, ${data.already_enrolled_count} already enrolled` });
    },
    onError: async (err: any) => {
      const msg = err?.message ?? "Enrollment failed";
      toast({ title: "Enrollment failed", description: msg, variant: "destructive" });
    },
  });

  async function runPreview() {
    if (!campaign?.segmentId) return;
    setPreviewLoading(true);
    setPreview(null);
    setEnrollResult(null);
    try {
      const res = await apiRequest("POST", `/api/marketing/campaigns/${id}/preview-recipients`, {});
      const data: PreviewResult = await res.json();
      setPreview(data);
      setPreviewFilter("all");
    } catch (err: any) {
      toast({ title: "Preview failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function runAI() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiResult("");
    try {
      const res = await apiRequest("POST", "/api/marketing/ai/generate", {
        prompt: aiPrompt,
        campaignName: campaign?.campaignName,
        campaignType: campaign?.campaignType,
        goal: campaign?.goal,
      });
      const data = await res.json();
      setAiResult(data.result ?? "No result returned.");
    } catch {
      setAiResult("Failed to generate. Check your AI integration settings.");
    } finally {
      setAiLoading(false);
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading campaign…</div>;
  }

  if (!campaign) {
    return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Campaign not found.</div>;
  }

  const statusActions: Record<string, { label: string; next: string; icon: React.ElementType }> = {
    draft:     { label: "Launch Campaign", next: "active",    icon: Play },
    active:    { label: "Pause Campaign",  next: "paused",   icon: Pause },
    paused:    { label: "Resume Campaign", next: "active",   icon: Play },
    completed: { label: "Reactivate",      next: "active",   icon: Play },
  };
  const action = statusActions[campaign.status];

  const selectedSegment = segments.find(s => s.id === campaign.segmentId) ?? null;
  const canEnroll = campaign.status !== "archived" && campaign.status !== "completed" && !!campaign.segmentId;

  const filteredPreviewRows = preview
    ? preview.recipients.filter(r => previewFilter === "all" || r.status === previewFilter).slice(0, PREVIEW_TABLE_LIMIT)
    : [];

  const statusColor = (s: RecipientResult["status"]) =>
    s === "eligible" ? "text-emerald-400" :
    s === "already_enrolled" ? "text-blue-400" :
    "text-amber-400";

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <Link href="/marketing/campaigns">
          <Button variant="ghost" size="icon" className="w-8 h-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          <Radio className="w-5 h-5 text-primary shrink-0" />
          <h1 className="text-xl font-semibold text-foreground truncate">{campaign.campaignName}</h1>
          <StatusBadge status={campaign.status} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAI(true)}>
            <Sparkles className="w-4 h-4 mr-2" /> AI Generate
          </Button>
          {action && (
            <Button
              size="sm"
              variant={campaign.status === "active" ? "outline" : "default"}
              onClick={() => statusMutation.mutate(action.next)}
              disabled={statusMutation.isPending}
            >
              <action.icon className="w-4 h-4 mr-2" />
              {action.label}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Recipients", value: campaign.totalRecipients.toLocaleString(), icon: Users, color: "text-primary" },
            { label: "Sent", value: campaign.sentCount.toLocaleString(), icon: Mail, color: "text-blue-400" },
            { label: "Open Rate", value: pct(campaign.openedCount, campaign.sentCount), icon: Target, color: "text-emerald-400" },
            { label: "Reply Rate", value: pct(campaign.repliedCount, campaign.sentCount), icon: MessageSquare, color: "text-violet-400" },
            { label: "Demos", value: campaign.demoBookedCount.toString(), icon: Calendar, color: "text-cyan-400" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-border/50 bg-card/50 px-4 py-3 flex items-center gap-3">
              <s.icon className={`w-5 h-5 shrink-0 ${s.color}`} />
              <div>
                <div className="text-xl font-bold text-foreground">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Campaign details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border/50 bg-card/50 px-4 py-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campaign Details</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <span className="text-foreground capitalize">{campaign.campaignType.replace(/_/g, " ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Goal</span>
                <span className="text-foreground text-right max-w-[150px] truncate">{campaign.goal ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={campaign.status} />
              </div>
            </div>
          </div>

          {campaign.notes && (
            <div className="md:col-span-2 rounded-xl border border-border/50 bg-card/50 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Notes</div>
              <p className="text-sm text-foreground leading-relaxed">{campaign.notes}</p>
            </div>
          )}
        </div>

        {/* ── Audience Enrollment ───────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-4 border-b border-border/30">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Audience Enrollment
            </h2>
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* Segment selector */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Selected Segment</Label>
                <Select
                  value={campaign.segmentId ? String(campaign.segmentId) : "__none__"}
                  onValueChange={v => segmentMutation.mutate(v === "__none__" ? null : Number(v))}
                >
                  <SelectTrigger className="h-9 text-sm" data-testid="select-campaign-segment">
                    <SelectValue placeholder="No segment assigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No segment</SelectItem>
                    {segments.map(seg => (
                      <SelectItem key={seg.id} value={String(seg.id)}>
                        {seg.segmentName}
                        {seg.recipientCount > 0 && ` (~${seg.recipientCount.toLocaleString()} contacts)`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="pt-5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={runPreview}
                  disabled={!campaign.segmentId || previewLoading}
                  data-testid="btn-preview-recipients"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${previewLoading ? "animate-spin" : ""}`} />
                  {previewLoading ? "Loading…" : "Preview Audience"}
                </Button>
              </div>
            </div>

            {!campaign.segmentId && (
              <div className="rounded-lg bg-muted/20 border border-dashed border-border/40 px-4 py-5 text-center">
                <Users className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Assign a segment above to preview and enroll CRM contacts into this campaign.</p>
              </div>
            )}

            {/* Preview summary */}
            {preview && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Total Matched", value: preview.totalMatched.toLocaleString(), color: "text-foreground" },
                    { label: "Eligible", value: preview.eligibleCount.toLocaleString(), color: "text-emerald-400" },
                    { label: "Excluded", value: preview.excludedCount.toLocaleString(), color: "text-amber-400" },
                    { label: "Already Enrolled", value: preview.alreadyEnrolledCount.toLocaleString(), color: "text-blue-400" },
                  ].map(s => (
                    <div key={s.label} className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-center">
                      <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Exclusion breakdown */}
                {Object.keys(preview.exclusionBreakdown).length > 0 && (
                  <div className="rounded-lg bg-muted/20 px-3 py-2">
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Exclusion Breakdown</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(preview.exclusionBreakdown).map(([reason, count]) => (
                        <span key={reason} className="inline-flex items-center gap-1 text-xs bg-muted/40 px-2 py-0.5 rounded-full text-muted-foreground">
                          {exclusionLabel(reason)}: <strong>{count}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Enroll button */}
                {!enrollResult && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {preview.eligibleCount === 0
                        ? "No eligible recipients to enroll."
                        : `Ready to enroll ${preview.eligibleCount} eligible recipient${preview.eligibleCount !== 1 ? "s" : ""}.`
                      }
                    </p>
                    <Button
                      size="sm"
                      onClick={() => enrollMutation.mutate()}
                      disabled={!canEnroll || preview.eligibleCount === 0 || enrollMutation.isPending}
                      data-testid="btn-enroll-recipients"
                    >
                      <UserCheck className="w-4 h-4 mr-2" />
                      {enrollMutation.isPending ? "Enrolling…" : `Enroll ${preview.eligibleCount} Recipients`}
                    </Button>
                  </div>
                )}

                {/* Enrollment success state */}
                {enrollResult && (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3" data-testid="enrollment-success">
                    <div className="flex items-center gap-2 mb-1.5">
                      <UserCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm font-semibold text-emerald-400">Enrollment complete</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div><span className="text-muted-foreground">Enrolled: </span><strong className="text-emerald-400">{enrollResult.enrolled_count}</strong></div>
                      <div><span className="text-muted-foreground">Skipped: </span><strong className="text-foreground">{enrollResult.skipped_count}</strong></div>
                      <div><span className="text-muted-foreground">Already enrolled: </span><strong className="text-blue-400">{enrollResult.already_enrolled_count}</strong></div>
                      <div><span className="text-muted-foreground">Total recipients: </span><strong className="text-foreground">{enrollResult.total_recipients}</strong></div>
                    </div>
                    <Button variant="ghost" size="sm" className="mt-2 text-xs h-7" onClick={runPreview}>
                      <RefreshCw className="w-3 h-3 mr-1" /> Re-preview
                    </Button>
                  </div>
                )}

                {/* Recipient preview table */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                      <Filter className="w-3.5 h-3.5" />
                      Preview (showing up to {PREVIEW_TABLE_LIMIT})
                    </div>
                    <div className="flex items-center gap-1">
                      {(["all", "eligible", "excluded", "already_enrolled"] as const).map(f => (
                        <button
                          key={f}
                          onClick={() => setPreviewFilter(f)}
                          className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                            previewFilter === f
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          data-testid={`filter-${f}`}
                        >
                          {f === "all" ? "All" : f === "eligible" ? "Eligible" : f === "excluded" ? "Excluded" : "Enrolled"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm z-10">
                          <tr>
                            {["Contact", "Email", "Role", "Account / Marina", "Persona", "Stage", "Status", "Reason"].map(h => (
                              <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPreviewRows.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                                No recipients match this filter.
                              </td>
                            </tr>
                          ) : filteredPreviewRows.map((r, i) => (
                            <tr key={`${r.contactId}-${i}`} className={`border-t border-border/20 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                              data-testid={`preview-row-${r.contactId}`}>
                              <td className="px-3 py-2 font-medium text-foreground">{r.name}</td>
                              <td className="px-3 py-2 text-muted-foreground font-mono">{r.email}</td>
                              <td className="px-3 py-2 text-muted-foreground">{r.roleType ?? r.title ?? "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">{r.accountName ?? "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">{r.marinaPersona ?? "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">{r.adoptionStage ?? "—"}</td>
                              <td className={`px-3 py-2 font-medium ${statusColor(r.status)}`}>
                                {r.status === "eligible" ? "Eligible" : r.status === "already_enrolled" ? "Enrolled" : "Excluded"}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {r.exclusionReason ? exclusionLabel(r.exclusionReason) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {filteredPreviewRows.length === PREVIEW_TABLE_LIMIT && (
                      <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/20 bg-muted/20">
                        Showing first {PREVIEW_TABLE_LIMIT} of {preview.recipients.filter(r => previewFilter === "all" || r.status === previewFilter).length} contacts.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stakeholder opening lines */}
        <div className="rounded-xl border border-border/50 bg-card/50 px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Stakeholder-Specific Opening Lines</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {STAKEHOLDER_OPENINGS.map(s => (
              <div key={s.role} className="rounded-lg bg-muted/20 px-3 py-2.5">
                <div className="text-xs font-medium text-primary mb-1">{s.role}</div>
                <div className="text-xs text-muted-foreground italic">"{s.opening}"</div>
              </div>
            ))}
          </div>
        </div>

        {/* Email sequence */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              Email Sequence
              <span className="text-xs font-normal text-muted-foreground">({emails.length} step{emails.length !== 1 ? "s" : ""})</span>
            </h2>
            <div className="flex gap-2">
              {emails.length === 0 && (
                <Button variant="outline" size="sm" onClick={() => seedSequenceMutation.mutate()}
                  disabled={seedSequenceMutation.isPending}>
                  <FileText className="w-4 h-4 mr-2" />
                  {seedSequenceMutation.isPending ? "Adding…" : "Use Default Sequence"}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setShowAddEmail(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Step
              </Button>
            </div>
          </div>

          {emails.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 py-10 text-center">
              <Mail className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-4">No email steps yet. Use the default 5-step sequence or add custom steps.</p>
              <Button variant="outline" size="sm" onClick={() => seedSequenceMutation.mutate()}>
                <FileText className="w-4 h-4 mr-2" /> Use Default BC Marina Sequence
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {[...emails].sort((a, b) => a.stepNumber - b.stepNumber).map((email) => (
                <div key={email.id} className="rounded-xl border border-border/50 bg-card/50 px-4 py-3 flex items-start gap-4"
                  data-testid={`email-step-${email.id}`}>
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className="w-7 h-7 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                      {email.stepNumber}
                    </div>
                    {email.delayDays > 0 && (
                      <div className="text-xs text-muted-foreground flex items-center gap-0.5">
                        <Clock className="w-3 h-3" /> D+{email.delayDays}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-foreground">{email.subject}</div>
                    {email.bodyText && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{email.bodyText}</div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => deleteEmailMutation.mutate(email.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add email step dialog */}
      <Dialog open={showAddEmail} onOpenChange={setShowAddEmail}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Email Step</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Subject line *</Label>
              <Input placeholder="e.g. The problem with legacy shore power"
                value={emailForm.subject}
                onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))}
                data-testid="input-email-subject" />
            </div>
            <div className="space-y-2">
              <Label>Send delay (days after previous step)</Label>
              <Input type="number" min={0} max={365}
                value={emailForm.delayDays}
                onChange={e => setEmailForm(f => ({ ...f, delayDays: Number(e.target.value) }))} />
            </div>
            <div className="space-y-2">
              <Label>Email body</Label>
              <Textarea rows={5} placeholder="Email content…"
                value={emailForm.bodyText}
                onChange={e => setEmailForm(f => ({ ...f, bodyText: e.target.value }))}
                data-testid="textarea-email-body" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddEmail(false)}>Cancel</Button>
            <Button onClick={() => addEmailMutation.mutate(emailForm)}
              disabled={!emailForm.subject.trim() || addEmailMutation.isPending}
              data-testid="btn-add-email-step">
              {addEmailMutation.isPending ? "Adding…" : "Add Step"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Generate dialog */}
      <Dialog open={showAI} onOpenChange={setShowAI}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> AI Campaign Generator
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Describe what you want generated — email sequence, subject lines, opening lines, role-specific copy, or a full campaign plan.
            </p>
            <div className="text-xs text-muted-foreground rounded-lg bg-muted/30 px-3 py-2 space-y-1">
              <div className="font-medium text-foreground">Example prompts:</div>
              <div>• "Create a 4-email campaign for municipal marina managers in BC focused on shore power safety, metered billing, and infrastructure modernization. CTA: book a 20-minute intro."</div>
              <div>• "Write 3 subject line variations for a harbormaster safety campaign. Keep them specific and non-salesy."</div>
              <div>• "Generate role-specific opening lines for Owner, GM, and Harbormaster for a shore power ROI campaign."</div>
            </div>
            <Textarea
              rows={4}
              placeholder="Describe what you want generated…"
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              data-testid="textarea-ai-prompt"
            />
            <Button onClick={runAI} disabled={!aiPrompt.trim() || aiLoading} className="w-full" data-testid="btn-ai-generate">
              <Sparkles className="w-4 h-4 mr-2" />
              {aiLoading ? "Generating…" : "Generate"}
            </Button>
            {aiResult && (
              <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-4">
                <div className="text-xs font-medium text-primary mb-2 uppercase tracking-wide">Generated Result</div>
                <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{aiResult}</div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAI(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      status === "active" ? "bg-emerald-500/15 text-emerald-400" :
      status === "scheduled" ? "bg-blue-500/15 text-blue-400" :
      status === "paused" ? "bg-amber-500/15 text-amber-400" :
      "bg-muted text-muted-foreground"
    }`}>
      {status}
    </span>
  );
}
