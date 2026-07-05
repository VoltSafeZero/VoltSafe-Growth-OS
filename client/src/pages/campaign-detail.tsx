import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Radio, ArrowLeft, Plus, Trash2, Play, Pause, CheckCircle, Edit2,
  Mail, MousePointerClick, MessageSquare, Calendar, Users, Target,
  Sparkles, Save, FileText, Clock, UserCheck, AlertTriangle, ChevronDown, ChevronUp,
  RefreshCw, Filter, Send, Eye, ShieldCheck, Info, Zap, XCircle, Flame, Square,
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
  complianceStatus?: string | null;
  complianceErrors?: any[] | null;
  senderName?: string | null;
  physicalMailingAddress?: string | null;
};

type ComplianceError = {
  code: string;
  message: string;
  jurisdiction: "casl" | "can_spam" | "general";
  severity: "blocking" | "warning";
};

type PreflightResult = {
  passed: boolean;
  errors: ComplianceError[];
  canadaCount: number;
  usCount: number;
  otherCount: number;
  blockedCount: number;
  eligibleCount: number;
  totalEnrolled: number;
  warnings: string[];
  compliance_status: string;
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

type SendPreviewResult = {
  campaign: { id: number; name: string; status: string };
  step: { id: number; stepNumber: number; subject: string; delayDays: number; bodyText: string | null };
  eligibleCount: number;
  excludedCount: number;
  exclusionBreakdown: Record<string, number>;
  sampleEligible: Array<{ id: number; email: string; name: string; marinaPersona: string | null; adoptionStage: string | null; role: string | null; sendStatus: string }>;
  sampleExcluded: Array<{ id: number; email: string; name: string; exclusionReason: string | null; sendStatus: string }>;
  subjectPreview: string;
  senderInfo: { mode: "live" | "dev_safe"; senderEmail: string | null; reason: string };
  warnings: string[];
};

type SendStepResult = {
  attempted_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  dev_safe_mode: boolean;
  exclusion_breakdown: Record<string, number>;
  failures: Array<{ email: string; error: string }>;
  campaign_totals: { total_recipients: number; sent_count: number; enrolled_count: number };
};

type EnrolledRecipient = {
  id: number;
  email: string;
  name: string;
  role: string | null;
  status: string;
  current_step: number;
  last_sent_at: string | null;
  marina_persona: string | null;
  adoption_stage: string | null;
  account_name: string | null;
  opened_count: number;
  clicked_count: number;
  replied_at: string | null;
  unsubscribed_at: string | null;
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
    already_sent_step: "Already sent this step",
  };
  return map[reason] ?? reason;
}

function recipientStatusColor(s: string): string {
  if (s === "in_sequence" || s === "sent") return "text-blue-400";
  if (s === "completed") return "text-emerald-400";
  if (s === "failed") return "text-red-400";
  if (s === "suppressed" || s === "skipped") return "text-amber-400";
  if (s === "bounced" || s === "unsubscribed") return "text-rose-400";
  return "text-muted-foreground";
}

function recipientStatusLabel(s: string): string {
  const map: Record<string, string> = {
    enrolled: "Enrolled",
    in_sequence: "In sequence",
    completed: "Completed",
    failed: "Failed",
    skipped: "Skipped",
    suppressed: "Suppressed",
    bounced: "Bounced",
    unsubscribed: "Unsubscribed",
    sent: "Sent",
  };
  return map[s] ?? s;
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

  // Send Campaign Step state
  const [sendPreviewModalOpen, setSendPreviewModalOpen] = useState(false);
  const [selectedStepForSend, setSelectedStepForSend] = useState<CampaignEmail | null>(null);
  const [sendPreviewResult, setSendPreviewResult] = useState<SendPreviewResult | null>(null);
  const [sendPreviewLoading, setSendPreviewLoading] = useState(false);
  const [sendStepLoading, setSendStepLoading] = useState(false);
  const [sendStepResults, setSendStepResults] = useState<Record<number, SendStepResult>>({});
  const [recipientFilter, setRecipientFilter] = useState("all");
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

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

  const { data: enrolledRecipients = [], refetch: refetchRecipients } = useQuery<EnrolledRecipient[]>({
    queryKey: ["/api/marketing/campaigns", id, "recipients"],
    queryFn: () => apiRequest("GET", `/api/marketing/campaigns/${id}/recipients`).then(r => r.json()),
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
    onError: () => {
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
      refetchRecipients();
      toast({ title: `Enrolled ${data.enrolled_count} recipients`, description: `${data.excluded_count} excluded, ${data.already_enrolled_count} already enrolled` });
    },
    onError: async (err: any) => {
      toast({ title: "Enrollment failed", description: err?.message ?? "Enrollment failed", variant: "destructive" });
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

  async function openSendPreview(step: CampaignEmail) {
    setSelectedStepForSend(step);
    setSendPreviewResult(null);
    setSendPreviewModalOpen(true);
    setSendPreviewLoading(true);
    try {
      const res = await apiRequest("POST", `/api/marketing/campaigns/${id}/send-preview`, {
        campaignEmailId: step.id,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Preview failed");
      }
      const data: SendPreviewResult = await res.json();
      setSendPreviewResult(data);
    } catch (err: any) {
      toast({ title: "Send preview failed", description: err.message, variant: "destructive" });
      setSendPreviewModalOpen(false);
    } finally {
      setSendPreviewLoading(false);
    }
  }

  async function executeSendStep() {
    if (!selectedStepForSend || !sendPreviewResult) return;
    if (sendPreviewResult.eligibleCount === 0) {
      toast({ title: "No eligible recipients", description: "All recipients are excluded for this step.", variant: "destructive" });
      return;
    }
    setSendStepLoading(true);
    try {
      const res = await apiRequest("POST", `/api/marketing/campaigns/${id}/send-step`, {
        campaignEmailId: selectedStepForSend.id,
        confirm: true,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Send failed");
      }
      const data: SendStepResult = await res.json();
      setSendStepResults(prev => ({ ...prev, [selectedStepForSend.id]: data }));
      setSendPreviewModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] });
      refetchRecipients();
      toast({
        title: data.dev_safe_mode
          ? `Dev-safe: ${data.sent_count} events recorded (no real emails sent)`
          : `Sent to ${data.sent_count} recipient${data.sent_count !== 1 ? "s" : ""}`,
        description: data.failed_count > 0 ? `${data.failed_count} failed` : undefined,
        variant: data.failed_count > 0 ? "destructive" : "default",
      });
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    } finally {
      setSendStepLoading(false);
    }
  }

  async function runPreflight() {
    if (!id) return;
    setPreflightLoading(true);
    try {
      const res = await apiRequest("POST", `/api/marketing/campaigns/${id}/preflight`, {});
      const data = await res.json();
      setPreflightResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id] });
      if (data.passed) {
        toast({ title: "Compliance check passed", description: `${data.eligibleCount} eligible recipients.` });
      } else {
        const blockCount = data.errors?.filter((e: ComplianceError) => e.severity === "blocking").length ?? 0;
        toast({ title: "Compliance check failed", description: `${blockCount} blocking issue${blockCount !== 1 ? "s" : ""} found.`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Preflight error", description: err.message, variant: "destructive" });
    } finally {
      setPreflightLoading(false);
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
  const canSend = campaign.status !== "archived" && campaign.totalRecipients > 0 && campaign.complianceStatus === "preflight_passed";

  const filteredPreviewRows = preview
    ? preview.recipients.filter(r => previewFilter === "all" || r.status === previewFilter).slice(0, PREVIEW_TABLE_LIMIT)
    : [];

  const statusColor = (s: RecipientResult["status"]) =>
    s === "eligible" ? "text-emerald-400" :
    s === "already_enrolled" ? "text-blue-400" :
    "text-amber-400";

  const sortedEmails = [...emails].sort((a, b) => a.stepNumber - b.stepNumber);

  const filteredRecipients = enrolledRecipients.filter(r => {
    if (recipientFilter === "all") return true;
    if (recipientFilter === "ready") return r.status === "enrolled";
    if (recipientFilter === "sent") return r.status === "in_sequence" || r.status === "sent";
    if (recipientFilter === "completed") return r.status === "completed";
    if (recipientFilter === "failed") return r.status === "failed";
    if (recipientFilter === "skipped") return r.status === "skipped";
    if (recipientFilter === "suppressed") return r.status === "suppressed";
    if (recipientFilter === "opened") return (r.opened_count ?? 0) > 0;
    if (recipientFilter === "clicked") return (r.clicked_count ?? 0) > 0;
    if (recipientFilter === "unsubscribed") return r.status === "unsubscribed";
    return true;
  });

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

        {/* ── Audience Enrollment ──────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-4 border-b border-border/30">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Audience Enrollment
            </h2>
          </div>

          <div className="px-4 py-4 space-y-4">
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
                      <div><span className="text-muted-foreground">Total: </span><strong className="text-foreground">{enrollResult.total_recipients}</strong></div>
                    </div>
                    <Button variant="ghost" size="sm" className="mt-2 text-xs h-7" onClick={runPreview}>
                      <RefreshCw className="w-3 h-3 mr-1" /> Re-preview
                    </Button>
                  </div>
                )}

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

        {/* ── Stakeholder opening lines ────────────────────────────────────── */}
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

        {/* ── Email Sequence + Send Controls ──────────────────────────────── */}
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

          {/* ── Compliance Preflight Panel ───────────────────────────────── */}
          {(() => {
            const result = preflightResult;
            const savedStatus = campaign?.complianceStatus;
            const hasSavedErrors = (campaign?.complianceErrors ?? []).length > 0;
            const isPassed = result ? result.passed : savedStatus === "preflight_passed";
            const isFailed = result ? !result.passed : savedStatus === "preflight_failed";
            const blockingErrors: ComplianceError[] = result?.errors?.filter(e => e.severity === "blocking") ?? (campaign?.complianceErrors ?? []).filter((e: any) => e.severity === "blocking");
            const warnings = result?.warnings ?? [];

            return (
              <div className={`rounded-xl border mb-3 overflow-hidden ${
                isPassed ? "border-emerald-500/30 bg-emerald-500/5" :
                isFailed ? "border-red-500/30 bg-red-500/5" :
                "border-amber-500/30 bg-amber-500/5"
              }`} data-testid="compliance-panel">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    {isPassed ? (
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : isFailed ? (
                      <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span className="text-sm font-medium text-foreground">
                      {isPassed ? "Compliance Check Passed" : isFailed ? "Compliance Check Failed" : "Compliance Check Required"}
                    </span>
                    {result && (
                      <span className="text-xs text-muted-foreground">
                        — {result.eligibleCount} eligible / {result.totalEnrolled} enrolled
                        {result.canadaCount > 0 && ` · ${result.canadaCount} CA`}
                        {result.usCount > 0 && ` · ${result.usCount} US`}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={isPassed ? "outline" : isFailed ? "destructive" : "default"}
                    className={isPassed ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" : ""}
                    onClick={runPreflight}
                    disabled={preflightLoading}
                    data-testid="btn-run-preflight"
                  >
                    {preflightLoading ? (
                      <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Checking…</>
                    ) : (
                      <><ShieldCheck className="w-3.5 h-3.5 mr-1.5" />{isPassed || isFailed ? "Re-check" : "Check Compliance"}</>
                    )}
                  </Button>
                </div>

                {!isPassed && !isFailed && (
                  <div className="px-4 pb-3 text-xs text-amber-300/80">
                    Run a compliance check (CASL / CAN-SPAM) before sending. Sends are blocked until compliance is confirmed.
                  </div>
                )}

                {blockingErrors.length > 0 && (
                  <div className="px-4 pb-3 space-y-1.5">
                    {blockingErrors.map((e: ComplianceError, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                        <span className="text-red-300/90">{e.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                {warnings.length > 0 && (
                  <div className="px-4 pb-3 space-y-1">
                    {warnings.map((w: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <span className="text-amber-300/80">{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {isPassed && result && (
                  <div className="px-4 pb-3 text-xs text-emerald-400/80">
                    All CASL/CAN-SPAM requirements satisfied. Campaign is cleared to send.
                  </div>
                )}
              </div>
            );
          })()}

          {/* Safety notice */}
          {emails.length > 0 && campaign.totalRecipients > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-blue-500/5 border border-blue-500/20 px-3 py-2.5 mb-3 text-xs text-blue-400">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Recipients are re-checked against suppression and internal email rules immediately before sending. No blind sends.</span>
            </div>
          )}

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
              {sortedEmails.map((email) => {
                const stepResult = sendStepResults[email.id];
                return (
                  <div key={email.id} className="rounded-xl border border-border/50 bg-card/50 overflow-hidden"
                    data-testid={`email-step-${email.id}`}>
                    <div className="px-4 py-3 flex items-start gap-4">
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
                        {stepResult && (
                          <div className={`mt-2 text-xs flex items-center gap-3 ${stepResult.dev_safe_mode ? "text-amber-400" : "text-emerald-400"}`}>
                            {stepResult.dev_safe_mode ? (
                              <><Zap className="w-3 h-3" /> Dev-safe: {stepResult.sent_count} recorded, not delivered</>
                            ) : (
                              <><CheckCircle className="w-3 h-3" /> Sent to {stepResult.sent_count}</>
                            )}
                            {stepResult.failed_count > 0 && <span className="text-red-400 ml-2">· {stepResult.failed_count} failed</span>}
                            {stepResult.skipped_count > 0 && <span className="text-muted-foreground ml-2">· {stepResult.skipped_count} skipped</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openSendPreview(email)}
                          disabled={!canSend || campaign.status === "archived"}
                          data-testid={`btn-send-preview-${email.id}`}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1.5" />
                          Preview Send
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => deleteEmailMutation.mutate(email.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Enrolled Recipients Table ────────────────────────────────────── */}
        {enrolledRecipients.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-primary" />
                Enrolled Recipients
                <span className="text-xs font-normal text-muted-foreground">({enrolledRecipients.length})</span>
              </h2>
              <div className="flex items-center gap-1">
                {["all", "ready", "sent", "completed", "opened", "clicked", "unsubscribed", "failed", "skipped", "suppressed"].map(f => {
                  const counts: Record<string, number> = {
                    all: enrolledRecipients.length,
                    ready: enrolledRecipients.filter(r => r.status === "enrolled").length,
                    sent: enrolledRecipients.filter(r => r.status === "in_sequence" || r.status === "sent").length,
                    completed: enrolledRecipients.filter(r => r.status === "completed").length,
                    opened: enrolledRecipients.filter(r => (r.opened_count ?? 0) > 0).length,
                    clicked: enrolledRecipients.filter(r => (r.clicked_count ?? 0) > 0).length,
                    unsubscribed: enrolledRecipients.filter(r => r.status === "unsubscribed").length,
                    failed: enrolledRecipients.filter(r => r.status === "failed").length,
                    skipped: enrolledRecipients.filter(r => r.status === "skipped").length,
                    suppressed: enrolledRecipients.filter(r => r.status === "suppressed").length,
                  };
                  if (f !== "all" && counts[f] === 0) return null;
                  return (
                    <button
                      key={f}
                      onClick={() => setRecipientFilter(f)}
                      className={`text-xs px-2 py-0.5 rounded-full transition-colors capitalize ${
                        recipientFilter === f
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid={`recipient-filter-${f}`}
                    >
                      {f} {counts[f] > 0 && f !== "all" ? `(${counts[f]})` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm z-10">
                  <tr>
                    {["Name", "Email", "Account", "Status", "Opened", "Clicked", "Step", "Last Sent"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRecipients.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No recipients match this filter.</td>
                    </tr>
                  ) : filteredRecipients.map((r, i) => (
                    <tr key={r.id} className={`border-t border-border/20 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                      data-testid={`recipient-row-${r.id}`}>
                      <td className="px-3 py-2 font-medium text-foreground">{r.name || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground font-mono">{r.email}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{r.account_name ?? "—"}</td>
                      <td className={`px-3 py-2 font-medium ${
                        r.status === "unsubscribed" ? "text-amber-400" : recipientStatusColor(r.status)
                      }`}>
                        {r.status === "unsubscribed" ? "Unsubscribed" : recipientStatusLabel(r.status)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {(r.opened_count ?? 0) > 0
                          ? <span className="text-emerald-400 font-medium">{r.opened_count}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {(r.clicked_count ?? 0) > 0
                          ? <span className="text-cyan-400 font-medium">{r.clicked_count}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-center">
                        {r.current_step > 1 ? `Step ${r.current_step - 1} done` : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.last_sent_at ? new Date(r.last_sent_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Automation Panel ───────────────────────────────────────────────────── */}
      <AutomationPanel campaignId={id} />

      {/* ── Accounts Heating Up From This Campaign ───────────────────────────── */}
      <AccountsHeatingUpSection campaignId={id} />

      {/* ── Send Preview Modal ────────────────────────────────────────────────── */}
      <Dialog open={sendPreviewModalOpen} onOpenChange={(open) => {
        if (!sendStepLoading) setSendPreviewModalOpen(open);
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" />
              Send Campaign Step
              {selectedStepForSend && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  — Step {selectedStepForSend.stepNumber}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {sendPreviewLoading && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Checking eligibility…
            </div>
          )}

          {!sendPreviewLoading && sendPreviewResult && (
            <div className="space-y-4 py-2">
              {/* Step info */}
              <div className="rounded-lg bg-muted/20 px-4 py-3 space-y-1.5">
                <div className="text-xs text-muted-foreground">Subject</div>
                <div className="text-sm font-medium text-foreground">{sendPreviewResult.subjectPreview}</div>
                {sendPreviewResult.step.bodyText && (
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-3">{sendPreviewResult.step.bodyText}</div>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-emerald-400">{sendPreviewResult.eligibleCount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Eligible to receive</div>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-amber-400">{sendPreviewResult.excludedCount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Excluded</div>
                </div>
              </div>

              {/* Sender info */}
              <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${
                sendPreviewResult.senderInfo.mode === "live"
                  ? "bg-emerald-500/5 border border-emerald-500/20 text-emerald-400"
                  : "bg-amber-500/5 border border-amber-500/20 text-amber-400"
              }`}>
                {sendPreviewResult.senderInfo.mode === "live" ? (
                  <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                )}
                <div>
                  <span className="font-medium">
                    {sendPreviewResult.senderInfo.mode === "live" ? "Live send" : "Dev-safe mode"}
                  </span>
                  {sendPreviewResult.senderInfo.senderEmail && (
                    <span className="text-muted-foreground ml-1">via {sendPreviewResult.senderInfo.senderEmail}</span>
                  )}
                  <div className="text-muted-foreground mt-0.5">{sendPreviewResult.senderInfo.reason}</div>
                </div>
              </div>

              {/* Exclusion breakdown */}
              {Object.keys(sendPreviewResult.exclusionBreakdown).length > 0 && (
                <div className="rounded-lg bg-muted/20 px-3 py-2.5">
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Exclusion Breakdown</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(sendPreviewResult.exclusionBreakdown).map(([reason, count]) => (
                      <span key={reason} className="inline-flex items-center gap-1 text-xs bg-muted/40 px-2 py-0.5 rounded-full text-muted-foreground">
                        {exclusionLabel(reason)}: <strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {sendPreviewResult.warnings.length > 0 && (
                <div className="space-y-1.5">
                  {sendPreviewResult.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-400" />
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Sample eligible */}
              {sendPreviewResult.sampleEligible.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Sample Eligible Recipients ({Math.min(sendPreviewResult.sampleEligible.length, 10)} of {sendPreviewResult.eligibleCount})
                  </div>
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <table className="w-full text-xs">
                      <tbody>
                        {sendPreviewResult.sampleEligible.slice(0, 10).map((r, i) => (
                          <tr key={r.id} className={`border-t border-border/20 first:border-0 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                            <td className="px-3 py-2 font-medium text-foreground">{r.name || "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground font-mono">{r.email}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.marinaPersona ?? r.role ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sample excluded */}
              {sendPreviewResult.sampleExcluded.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Sample Excluded ({Math.min(sendPreviewResult.sampleExcluded.length, 5)} shown)
                  </div>
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <table className="w-full text-xs">
                      <tbody>
                        {sendPreviewResult.sampleExcluded.slice(0, 5).map((r, i) => (
                          <tr key={r.id} className={`border-t border-border/20 first:border-0 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                            <td className="px-3 py-2 font-medium text-foreground">{r.name || "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground font-mono">{r.email}</td>
                            <td className="px-3 py-2 text-amber-400">{exclusionLabel(r.exclusionReason ?? "unknown")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {sendPreviewResult.eligibleCount === 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                  <XCircle className="w-4 h-4 shrink-0" />
                  No eligible recipients — all contacts for this step have been excluded.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setSendPreviewModalOpen(false)} disabled={sendStepLoading}>
              Cancel
            </Button>
            <Button
              onClick={executeSendStep}
              disabled={!sendPreviewResult || sendPreviewResult.eligibleCount === 0 || sendStepLoading || sendPreviewLoading}
              data-testid="btn-confirm-send"
            >
              <Send className="w-4 h-4 mr-2" />
              {sendStepLoading
                ? "Sending…"
                : sendPreviewResult?.senderInfo.mode === "dev_safe"
                  ? `Record ${sendPreviewResult?.eligibleCount ?? 0} (Dev-safe)`
                  : `Send to ${sendPreviewResult?.eligibleCount ?? 0} Recipients`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add email step dialog ─────────────────────────────────────────────── */}
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
            <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
              Supported personalization: <code className="text-primary">{"{{first_name}}"}</code> <code className="text-primary">{"{{account_name}}"}</code> <code className="text-primary">{"{{marina_persona}}"}</code> <code className="text-primary">{"{{adoption_stage}}"}</code> <code className="text-primary">{"{{role}}"}</code>
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

      {/* ── AI Generate dialog ────────────────────────────────────────────────── */}
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

// ── Accounts Heating Up From This Campaign ────────────────────────────────────

type CampaignHeatAccount = {
  accountId: number;
  accountName: string;
  marinaType: string | null;
  heatScore: number;
  heatLabel: string;
  engagedContactsCount: number;
  openCount: number;
  clickCount: number;
  replyCount: number;
  complianceRiskCount: number;
  recommendedNextAction: string;
  latestEngagementAt: string | null;
};

function heatBadgeClass(label: string) {
  if (label === "Hot") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (label === "Warm") return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  if (label === "Nurture") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (label === "Low") return "bg-slate-500/15 text-slate-400 border-slate-500/30";
  return "bg-muted/30 text-muted-foreground border-border/50";
}

// ── Automation Panel ──────────────────────────────────────────────────────────

type AutomationStatus = {
  campaignId: number;
  automationStatus: string;
  automationEnabled: boolean;
  automationStartedAt: string | null;
  automationPausedAt: string | null;
  automationCompletedAt: string | null;
  nextAutomationRunAt: string | null;
  complianceStatus: string | null;
  enrolledCount: number;
  activeCount: number;
  completedCount: number;
  blockedCount: number;
  suppressedCount: number;
  unsubscribedCount: number;
  notStartedCount: number;
  nextDueCount: number;
  steps: Array<{ id: number; stepNumber: number; subject: string; delayDays: number; status: string }>;
};

function automationStatusBadge(status: string) {
  if (status === "active") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">Active</Badge>;
  if (status === "paused") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">Paused</Badge>;
  if (status === "completed") return <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/30 text-xs">Completed</Badge>;
  if (status === "blocked") return <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-xs">Blocked</Badge>;
  return <Badge className="bg-muted/40 text-muted-foreground border-border/50 text-xs">Manual</Badge>;
}

function AutomationPanel({ campaignId }: { campaignId: number }) {
  const { toast } = useToast();

  const { data: autoStatus, isLoading, refetch } = useQuery<AutomationStatus>({
    queryKey: ["/api/marketing/campaigns", campaignId, "automation", "status"],
    queryFn: () =>
      fetch(`/api/marketing/campaigns/${campaignId}/automation/status`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
    staleTime: 30000,
    enabled: !!campaignId,
  });

  const controlMutation = useMutation({
    mutationFn: ({ action }: { action: "start" | "pause" | "resume" | "stop" }) =>
      apiRequest("POST", `/api/marketing/campaigns/${campaignId}/automation/${action}`, {}),
    onSuccess: (_data, vars) => {
      toast({ title: `Automation ${vars.action}ed`, description: `Drip sequence is now ${vars.action === "stop" ? "stopped" : vars.action + "d"}` });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", campaignId] });
    },
    onError: (err: any) => {
      const message = err?.message || "Action failed";
      toast({ title: "Automation error", description: message, variant: "destructive" });
    },
  });

  if (isLoading) return (
    <div className="px-6 pb-4">
      <div className="rounded-xl border border-border/50 bg-card/40 p-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-4 h-4 rounded bg-muted/30" />
          <div className="h-4 w-28 rounded bg-muted/30" />
          <div className="h-5 w-14 rounded-full bg-muted/20" />
        </div>
        <div className="h-3 w-48 rounded bg-muted/20" />
      </div>
    </div>
  );
  if (!autoStatus) return (
    <div className="px-6 pb-2">
      <p className="text-xs text-muted-foreground italic">Automation unavailable — campaign running in manual mode.</p>
    </div>
  );

  const status = autoStatus.automationStatus ?? "manual";
  const compliancePassed = autoStatus.complianceStatus === "preflight_passed";
  const isRunning = status === "active";
  const isPaused = status === "paused";
  const isManual = status === "manual" || status === "stopped";
  const isCompleted = status === "completed";
  const isBlocked = status === "blocked";
  const busy = controlMutation.isPending;

  return (
    <div className="px-6 pb-4" data-testid="automation-panel">
      <div className="rounded-xl border border-border/50 bg-card/40 p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Drip Automation</h2>
            {automationStatusBadge(status)}
            {autoStatus.nextDueCount > 0 && (
              <Badge className="bg-primary/10 text-primary border-primary/30 text-xs">
                {autoStatus.nextDueCount} due now
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isManual && (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                disabled={busy || !compliancePassed || autoStatus.enrolledCount === 0 || autoStatus.steps.length === 0}
                onClick={() => controlMutation.mutate({ action: "start" })}
                data-testid="automation-start-btn"
                title={!compliancePassed ? "Compliance preflight must pass first" : ""}
              >
                <Play className="w-3.5 h-3.5 mr-1" /> Start Automation
              </Button>
            )}
            {isRunning && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => controlMutation.mutate({ action: "pause" })}
                data-testid="automation-pause-btn"
              >
                <Pause className="w-3.5 h-3.5 mr-1" /> Pause
              </Button>
            )}
            {isPaused && (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                disabled={busy || !compliancePassed}
                onClick={() => controlMutation.mutate({ action: "resume" })}
                data-testid="automation-resume-btn"
              >
                <Play className="w-3.5 h-3.5 mr-1" /> Resume
              </Button>
            )}
            {(isRunning || isPaused || isBlocked) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => controlMutation.mutate({ action: "stop" })}
                data-testid="automation-stop-btn"
              >
                <Square className="w-3.5 h-3.5 mr-1 fill-current" /> Stop
              </Button>
            )}
          </div>
        </div>

        {/* Compliance warning */}
        {!compliancePassed && (isManual || isBlocked) && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-3">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-300">
              Compliance preflight required before starting automation. Check the Compliance section above.
            </p>
          </div>
        )}
        {isBlocked && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 mb-3">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">
              Automation blocked — compliance check failed after start. Re-run preflight then resume.
            </p>
          </div>
        )}
        {isCompleted && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 mb-3">
            <CheckCircle className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
            <p className="text-xs text-cyan-300">
              Sequence complete — all recipients have received the full drip sequence.
            </p>
          </div>
        )}

        {/* Stats row */}
        {autoStatus.enrolledCount > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {[
              { label: "Active", value: autoStatus.activeCount, color: "text-emerald-400" },
              { label: "Completed", value: autoStatus.completedCount, color: "text-cyan-400" },
              { label: "Suppressed", value: autoStatus.suppressedCount + autoStatus.unsubscribedCount, color: "text-amber-400" },
              { label: "Blocked", value: autoStatus.blockedCount, color: "text-red-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-center">
                <div className={`text-lg font-bold ${value > 0 ? color : "text-muted-foreground/40"}`}>{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Step timeline */}
        {autoStatus.steps.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground font-medium mb-2">Sequence</p>
            {autoStatus.steps.map((step, idx) => (
              <div key={step.id} className="flex items-center gap-2 text-xs">
                <div className="w-5 h-5 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary font-bold text-[10px] shrink-0">
                  {step.stepNumber}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-foreground truncate block">{step.subject || `Step ${step.stepNumber}`}</span>
                </div>
                <div className="text-muted-foreground/60 whitespace-nowrap shrink-0">
                  {step.delayDays === 0
                    ? idx === 0 ? "Day 0 (immediately)" : "Day 0"
                    : `Day ${step.delayDays}`}
                </div>
              </div>
            ))}
          </div>
        )}

        {autoStatus.steps.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic text-center py-2">
            No email steps defined — add steps to enable automation
          </p>
        )}

        {/* Timestamps */}
        {(autoStatus.automationStartedAt || autoStatus.automationCompletedAt) && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30 text-xs text-muted-foreground">
            {autoStatus.automationStartedAt && (
              <span>Started: {new Date(autoStatus.automationStartedAt).toLocaleDateString()}</span>
            )}
            {autoStatus.automationCompletedAt && (
              <span>Completed: {new Date(autoStatus.automationCompletedAt).toLocaleDateString()}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function agoStr(ts: string | null): string {
  if (!ts) return "—";
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "1d ago";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function AccountsHeatingUpSection({ campaignId }: { campaignId: number }) {
  const { data: accounts = [], isLoading } = useQuery<CampaignHeatAccount[]>({
    queryKey: ["/api/marketing/campaigns", campaignId, "hot-accounts"],
    queryFn: () =>
      fetch(`/api/marketing/campaigns/${campaignId}/hot-accounts`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    staleTime: 60000,
    enabled: !!campaignId,
  });

  if (isLoading) return null;

  return (
    <div className="px-6 pb-4" data-testid="accounts-heating-up-section">
      <div className="flex items-center gap-2 mb-3">
        <Flame className="w-4 h-4 text-red-400" />
        <h2 className="text-sm font-semibold text-foreground">
          Accounts Heating Up From This Campaign
          {accounts.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground ml-1">({accounts.length})</span>
          )}
        </h2>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-border/40 bg-muted/20 px-5 py-6 text-center" data-testid="heating-up-empty">
          <p className="text-sm text-muted-foreground">
            No account heat data yet. Send to recipients to start tracking account engagement.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[800px]">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  {["Account", "Heat Score", "Contacts", "Opens", "Clicks", "Replies", "Compliance", "Last Engagement", "Next Action"].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map((a, i) => (
                  <tr key={a.accountId}
                    className={`border-b border-border/20 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    data-testid={`heating-row-${a.accountId}`}>
                    <td className="px-3 py-2.5">
                      <Link href={`/accounts/${a.accountId}`}>
                        <span className="font-medium text-foreground hover:text-primary transition-colors">{a.accountName}</span>
                      </Link>
                      {a.marinaType && <div className="text-[10px] text-muted-foreground">{a.marinaType}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-foreground">{a.heatScore}</span>
                        <Badge variant="outline" className={`text-[9px] h-4 px-1 border ${heatBadgeClass(a.heatLabel)}`}>{a.heatLabel}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={a.engagedContactsCount > 0 ? "text-emerald-400 font-medium" : "text-muted-foreground"}>{a.engagedContactsCount}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-foreground">{a.openCount}</td>
                    <td className="px-3 py-2.5 text-center text-foreground">{a.clickCount}</td>
                    <td className="px-3 py-2.5 text-center text-foreground">{a.replyCount}</td>
                    <td className="px-3 py-2.5 text-center">
                      {a.complianceRiskCount > 0 ? (
                        <span className="flex items-center justify-center gap-0.5 text-amber-400">
                          <AlertTriangle className="w-3 h-3" />{a.complianceRiskCount}
                        </span>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{agoStr(a.latestEngagementAt)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground max-w-[180px]">
                      <div className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-primary shrink-0" />
                        <span className="truncate">{a.recommendedNextAction}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
