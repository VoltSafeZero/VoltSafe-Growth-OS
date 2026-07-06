import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ShieldCheck, AlertTriangle, Users, Globe, CheckCircle2,
  Clock, XCircle, Ban, BarChart3, Upload, FileText,
  ChevronLeft, ChevronRight, Filter, RefreshCw,
} from "lucide-react";
import { MarketingDrilldownSheet, type DrilldownConfig } from "@/components/marketing/marketing-drilldown-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

const ATTESTATION_TEXT =
  "I confirm that all contacts in this file have provided valid consent to receive commercial electronic messages in accordance with applicable legislation (CASL/CAN-SPAM).";

type ComplianceStats = {
  totalContacts: number;
  canadaCount: number;
  usCount: number;
  otherCount: number;
  unknownJurisdictionCount: number;
  canadaExpressCount: number;
  canadaImpliedActiveCount: number;
  impliedExpiring30: number;
  impliedExpiring60: number;
  impliedExpiring90: number;
  impliedExpiredCount: number;
  unknownConsentCount: number;
  missingCanadaProofCount: number;
  usBizEligibleCount: number;
  usOptedOutCount: number;
  unsubscribedCount: number;
  suppressedCount: number;
  quarantinedCount: number;
  campaignsBlockedCount: number;
  avgUnsubRate: number;
  avgBounceRate: number;
  spamComplaintRate: number;
  consentSourceBreakdown: { source: string; count: number }[];
  leadSourceBreakdown: { source: string; count: number }[];
  campaignHealthBreakdown: {
    id: number; name: string; status: string; complianceStatus: string;
    totalSent: number; unsubscribedCount: number; bouncedCount: number;
    unsubRate: number; bounceRate: number;
  }[];
  formOptInRate: number;
};

type AuditRow = {
  id: number;
  event_type: string;
  contact_id: number | null;
  campaign_id: number | null;
  contact_name: string | null;
  contact_email: string | null;
  campaign_name: string | null;
  performed_by_name: string | null;
  notes: string | null;
  created_at: string;
};

const PIE_COLORS = ["#06b6d4", "#3b82f6", "#8b5cf6", "#f59e0b"];

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "text-muted-foreground",
  iconBg = "bg-primary/10",
  onClick,
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  iconBg?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`bg-card border border-border/50 rounded-xl p-4 flex items-start gap-3 text-left w-full transition-all duration-150 ${
        onClick
          ? "cursor-pointer hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm group"
          : ""
      }`}
      data-testid={`stat-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
      aria-label={onClick ? `View details for ${label}` : undefined}
    >
      <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center shrink-0 ${onClick ? "group-hover:scale-105 transition-transform" : ""}`}>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className={`text-2xl font-bold leading-tight ${color}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        {onClick && <p className="text-[10px] text-primary/60 mt-1 group-hover:text-primary/80 transition-colors">View details →</p>}
      </div>
    </Tag>
  );
}

type ImportStep = "upload" | "metadata" | "attestation" | "review" | "result";

type ParsedRowPreview = {
  totalRows: number;
  emailsMissing: number;
  canadaMissingConsent: number;
  canadaMissingProof: number;
  sampleEmails: string[];
};

type ImportState = {
  step: ImportStep;
  file: File | null;
  jurisdiction: string;
  consentSource: string;
  consentType: string;
  attested: boolean;
  preview: ParsedRowPreview | null;
  result: any | null;
  loading: boolean;
};

export default function ComplianceDashboardPage() {
  const { toast } = useToast();
  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<ComplianceStats>({
    queryKey: ["/api/marketing/compliance/stats"],
  });

  const [auditPage, setAuditPage] = useState(1);
  const [auditEventType, setAuditEventType] = useState("");
  const [auditContactSearch, setAuditContactSearch] = useState("");
  const [auditContactId, setAuditContactId] = useState<number | null>(null);
  const [auditCampaignSearch, setAuditCampaignSearch] = useState("");
  const [auditCampaignId, setAuditCampaignId] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importState, setImportState] = useState<ImportState>({
    step: "upload",
    file: null,
    jurisdiction: "",
    consentSource: "",
    consentType: "",
    attested: false,
    preview: null,
    result: null,
    loading: false,
  });

  const auditQuery = useQuery({
    queryKey: ["/api/marketing/compliance/audit-log", auditPage, auditEventType, auditContactId, auditCampaignId],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(auditPage), limit: "20" });
      if (auditEventType) params.set("event_type", auditEventType);
      if (auditContactId) params.set("contact_id", String(auditContactId));
      if (auditCampaignId) params.set("campaign_id", String(auditCampaignId));
      return fetch(`/api/marketing/compliance/audit-log?${params}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const auditRows: AuditRow[] = auditQuery.data?.rows ?? [];
  const auditTotal: number = auditQuery.data?.total ?? 0;
  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / 20));

  function parseCsvPreview(file: File, jurisdiction: string, consentType: string, consentSource: string): Promise<ParsedRowPreview> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = (e.target?.result as string) || "";
        const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
        if (lines.length < 2) { resolve({ totalRows: 0, emailsMissing: 0, canadaMissingConsent: 0, canadaMissingProof: 0, sampleEmails: [] }); return; }
        const headers = lines[0].toLowerCase().split(",").map(h => h.replace(/[^a-z0-9_]/g, "_").trim());
        const rows = lines.slice(1).map(l => {
          const vals = l.split(",");
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => { obj[h] = (vals[i] ?? "").trim().replace(/^"|"$/g, ""); });
          return obj;
        }).filter(r => Object.values(r).some(v => v));

        let emailsMissing = 0, canadaMissingConsent = 0, canadaMissingProof = 0;
        const sampleEmails: string[] = [];
        for (const row of rows) {
          const email = (row.email || row.email_address || "").toLowerCase();
          if (!email || !email.includes("@")) { emailsMissing++; continue; }
          if (sampleEmails.length < 3) sampleEmails.push(email);
          if (jurisdiction === "canada") {
            const ct = row.consent_type || consentType || "";
            const cs = row.consent_source || consentSource || "";
            if (!ct || !cs) canadaMissingConsent++;
            else if (ct === "express" && !row.consent_proof && !row.consent_proof_url) canadaMissingProof++;
          }
        }
        resolve({ totalRows: rows.length, emailsMissing, canadaMissingConsent, canadaMissingProof, sampleEmails });
      };
      reader.readAsText(file);
    });
  }

  async function handlePreviewAndReview() {
    if (!importState.file || !importState.jurisdiction || !importState.attested) return;
    const preview = await parseCsvPreview(importState.file, importState.jurisdiction, importState.consentType, importState.consentSource);
    setImportState(s => ({ ...s, preview, step: "review" }));
  }

  async function handleImport() {
    if (!importState.file || !importState.jurisdiction || !importState.attested) return;
    setImportState(s => ({ ...s, loading: true }));
    try {
      const fd = new FormData();
      fd.append("file", importState.file);
      fd.append("jurisdiction", importState.jurisdiction);
      fd.append("consentSource", importState.consentSource);
      fd.append("consentType", importState.consentType);
      fd.append("attestation", "true");
      const resp = await fetch("/api/marketing/contacts/import", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.message || "Import failed");
      setImportState(s => ({ ...s, step: "result", result, loading: false }));
      refetchStats();
      toast({ title: `Import complete — ${result.insertedRows} inserted, ${result.quarantinedRows} quarantined` });
    } catch (err: any) {
      setImportState(s => ({ ...s, loading: false }));
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
  }

  const jurisdictionData = stats ? [
    { name: "Canada", value: stats.canadaCount },
    { name: "US", value: stats.usCount },
    { name: "Other", value: stats.otherCount },
    { name: "Unknown", value: stats.unknownJurisdictionCount },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="flex flex-col h-full min-h-0 bg-background overflow-y-auto">
      <div className="px-6 py-5 border-b border-border/50 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Compliance Dashboard</h1>
              <p className="text-xs text-muted-foreground">CASL / CAN-SPAM health across your contact list</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetchStats()} data-testid="btn-refresh-compliance">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowImport(true)} data-testid="btn-import-contacts">
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Import Contacts
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 py-6 space-y-6">
        {statsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : !stats ? null : (
          <>
            {/* ── Warning Banners ─────────────────────────────────────────────────── */}
            <div className="space-y-2">
              {stats.impliedExpiring30 > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm" data-testid="banner-implied-expiring">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    <strong>{stats.impliedExpiring30} Canadian contacts</strong> have implied consent expiring within 30 days — refresh or upgrade to express consent before they expire.
                  </span>
                </div>
              )}
              {stats.quarantinedCount > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm" data-testid="banner-quarantined">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    <strong>{stats.quarantinedCount} contacts quarantined</strong> from a recent import — review missing consent fields before they can be added to campaigns.
                  </span>
                </div>
              )}
              {stats.impliedExpiredCount > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm" data-testid="banner-implied-expired">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>
                    <strong>{stats.impliedExpiredCount} Canadian contacts</strong> have expired implied consent — they cannot receive commercial email under CASL until consent is renewed.
                  </span>
                </div>
              )}
              {stats.usOptedOutCount > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-300 text-sm" data-testid="banner-us-suppressed">
                  <Ban className="w-4 h-4 shrink-0" />
                  <span>
                    <strong>{stats.usOptedOutCount} US contacts</strong> are opted-out or suppressed — they are excluded from all sends per CAN-SPAM.
                  </span>
                </div>
              )}
            </div>

            {/* ── Jurisdiction Summary ─────────────────────────────────────────────── */}
            <section>
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Jurisdiction Breakdown</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard icon={Globe} label="Canada" value={stats.canadaCount} iconBg="bg-red-500/10" onClick={() => setDrilldown({ metric: "jurisdiction_canada" })} />
                <StatCard icon={Globe} label="United States" value={stats.usCount} iconBg="bg-blue-500/10" onClick={() => setDrilldown({ metric: "jurisdiction_us" })} />
                <StatCard icon={Globe} label="Other" value={stats.otherCount} iconBg="bg-purple-500/10" onClick={() => setDrilldown({ metric: "jurisdiction_other" })} />
                <StatCard icon={AlertTriangle} label="Unknown Jurisdiction" value={stats.unknownJurisdictionCount} color={stats.unknownJurisdictionCount > 0 ? "text-amber-400" : undefined} iconBg="bg-amber-500/10" onClick={() => setDrilldown({ metric: "unknown_jurisdiction" })} />
              </div>
            </section>

            {/* ── Canadian Consent ─────────────────────────────────────────────────── */}
            <section>
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Canadian Consent (CASL)</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard icon={CheckCircle2} label="Express Consent" value={stats.canadaExpressCount} iconBg="bg-green-500/10" onClick={() => setDrilldown({ metric: "express_consent" })} />
                <StatCard icon={Clock} label="Implied Active" value={stats.canadaImpliedActiveCount} iconBg="bg-cyan-500/10" onClick={() => setDrilldown({ metric: "implied_active" })} />
                <StatCard icon={Clock} label="Expiring in 30 days" value={stats.impliedExpiring30} color={stats.impliedExpiring30 > 0 ? "text-amber-400" : undefined} iconBg="bg-amber-500/10" onClick={() => setDrilldown({ metric: "implied_expiring_30" })} />
                <StatCard icon={Clock} label="Expiring in 60 days" value={stats.impliedExpiring60} iconBg="bg-amber-500/10" onClick={() => setDrilldown({ metric: "implied_expiring_60" })} />
                <StatCard icon={Clock} label="Expiring in 90 days" value={stats.impliedExpiring90} iconBg="bg-amber-500/10" onClick={() => setDrilldown({ metric: "implied_expiring_90" })} />
                <StatCard icon={XCircle} label="Expired Implied" value={stats.impliedExpiredCount} color={stats.impliedExpiredCount > 0 ? "text-red-400" : undefined} iconBg="bg-red-500/10" onClick={() => setDrilldown({ metric: "implied_expired" })} />
                <StatCard icon={AlertTriangle} label="Missing Consent Proof" value={stats.missingCanadaProofCount} color={stats.missingCanadaProofCount > 0 ? "text-amber-400" : undefined} iconBg="bg-amber-500/10" onClick={() => setDrilldown({ metric: "missing_consent_proof" })} />
              </div>
            </section>

            {/* ── US / General Stats ───────────────────────────────────────────────── */}
            <section>
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">US & General (CAN-SPAM)</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard icon={Users} label="Unknown Consent" value={stats.unknownConsentCount} iconBg="bg-slate-500/10" onClick={() => setDrilldown({ metric: "unknown_consent" })} />
                <StatCard icon={CheckCircle2} label="US B2B Eligible" value={stats.usBizEligibleCount} iconBg="bg-green-500/10" onClick={() => setDrilldown({ metric: "us_biz_eligible" })} />
                <StatCard icon={Ban} label="US Opted-Out" value={stats.usOptedOutCount} color={stats.usOptedOutCount > 0 ? "text-red-400" : undefined} iconBg="bg-red-500/10" onClick={() => setDrilldown({ metric: "us_opted_out" })} />
                <StatCard icon={Ban} label="Unsubscribed" value={stats.unsubscribedCount} iconBg="bg-red-500/10" onClick={() => setDrilldown({ metric: "unsubscribed" })} />
                <StatCard icon={Ban} label="Suppressed" value={stats.suppressedCount} iconBg="bg-red-500/10" onClick={() => setDrilldown({ metric: "suppressed" })} />
                <StatCard icon={AlertTriangle} label="Quarantined Imports" value={stats.quarantinedCount} color={stats.quarantinedCount > 0 ? "text-amber-400" : undefined} iconBg="bg-amber-500/10" onClick={() => setDrilldown({ metric: "quarantined" })} />
              </div>
            </section>

            {/* ── Campaign Health ──────────────────────────────────────────────────── */}
            <section>
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Campaign Health</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <StatCard icon={XCircle} label="Campaigns Blocked" value={stats.campaignsBlockedCount} color={stats.campaignsBlockedCount > 0 ? "text-red-400" : undefined} iconBg="bg-red-500/10" onClick={() => setDrilldown({ metric: "campaigns_blocked" })} />
                <StatCard icon={BarChart3} label="Avg Unsubscribe Rate" value={`${stats.avgUnsubRate ?? 0}%`} iconBg="bg-slate-500/10" onClick={() => setDrilldown({ metric: "avg_unsub_rate" })} />
                <StatCard icon={BarChart3} label="Avg Bounce Rate" value={`${stats.avgBounceRate ?? 0}%`} iconBg="bg-slate-500/10" onClick={() => setDrilldown({ metric: "avg_bounce_rate" })} />
                <StatCard icon={BarChart3} label="Spam Complaint Rate" value={`${stats.spamComplaintRate ?? 0}%`} color={stats.spamComplaintRate > 0.1 ? "text-red-400" : undefined} iconBg="bg-red-500/10" onClick={() => setDrilldown({ metric: "spam_complaint_rate" })} />
                <StatCard icon={BarChart3} label="Form Opt-In Rate" value={`${stats.formOptInRate ?? 0}%`} iconBg="bg-green-500/10" onClick={() => setDrilldown({ metric: "form_opt_in_rate" })} />
              </div>

              {/* Per-campaign health breakdown */}
              {(stats.campaignHealthBreakdown?.length ?? 0) > 0 && (
                <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
                  <div className="px-4 py-2 border-b border-border/50 bg-muted/30">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">By Campaign (latest 10)</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="border-b border-border/40 bg-muted/20">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Campaign</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Sent</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Unsub %</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Bounce %</th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">Compliance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.campaignHealthBreakdown.map((c) => (
                        <tr
                          key={c.id}
                          className="border-b border-border/20 hover:bg-primary/5 cursor-pointer transition-colors"
                          onClick={() => setDrilldown({ metric: c.complianceStatus === "preflight_failed" ? "campaigns_blocked" : "avg_unsub_rate" })}
                          data-testid={`campaign-health-row-${c.id}`}
                          title="Click to view campaigns by unsubscribe rate"
                        >
                          <td className="px-4 py-2 text-xs font-medium max-w-[180px] truncate" title={c.name}>{c.name}</td>
                          <td className="px-4 py-2 text-xs text-right text-muted-foreground">{c.totalSent.toLocaleString()}</td>
                          <td className="px-4 py-2 text-xs text-right">
                            <span className={c.unsubRate > 2 ? "text-red-400" : c.unsubRate > 0.5 ? "text-amber-400" : "text-muted-foreground"}>{c.unsubRate}%</span>
                          </td>
                          <td className="px-4 py-2 text-xs text-right">
                            <span className={c.bounceRate > 5 ? "text-red-400" : c.bounceRate > 2 ? "text-amber-400" : "text-muted-foreground"}>{c.bounceRate}%</span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <Badge variant={c.complianceStatus === "preflight_failed" ? "destructive" : c.complianceStatus === "approved" ? "default" : "secondary"} className="text-xs">
                              {c.complianceStatus || c.status || "—"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── Charts ──────────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {jurisdictionData.length > 0 && (
                <div className="bg-card border border-border/50 rounded-xl p-4">
                  <h3 className="text-sm font-medium mb-1">Contact Jurisdiction</h3>
                  <p className="text-[11px] text-muted-foreground mb-3">Click a segment to drill into that group</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={jurisdictionData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label
                        cursor="pointer"
                        onClick={(entry) => {
                          const name = String(entry?.name ?? "").toLowerCase();
                          if (name.includes("canada")) setDrilldown({ metric: "jurisdiction_canada" });
                          else if (name.includes("us") || name.includes("united")) setDrilldown({ metric: "jurisdiction_us" });
                          else if (name.includes("unknown")) setDrilldown({ metric: "unknown_jurisdiction" });
                          else setDrilldown({ metric: "jurisdiction_other" });
                        }}
                      >
                        {jurisdictionData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              {stats.consentSourceBreakdown.length > 0 && (
                <div className="bg-card border border-border/50 rounded-xl p-4">
                  <h3 className="text-sm font-medium mb-1">Consent Source Breakdown</h3>
                  <p className="text-[11px] text-muted-foreground mb-3">Click a source to see its contacts</p>
                  <div className="space-y-2">
                    {stats.consentSourceBreakdown.slice(0, 6).map((s, i) => (
                      <button
                        key={i}
                        onClick={() => setDrilldown({ metric: "consent_source", extraParams: { source: s.source || "Unknown" } })}
                        className="w-full flex items-center justify-between text-sm rounded-lg px-2 py-1 hover:bg-primary/5 hover:border-primary/30 border border-transparent transition-colors cursor-pointer group"
                        data-testid={`consent-source-row-${i}`}
                        aria-label={`View contacts from source ${s.source || "Unknown"}`}
                      >
                        <span className="text-muted-foreground truncate max-w-[180px] group-hover:text-foreground transition-colors">{s.source || "Unknown"}</span>
                        <Badge variant="secondary" className="group-hover:bg-primary/20 transition-colors">{s.count}</Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(stats.leadSourceBreakdown?.length ?? 0) > 0 && (
                <div className="bg-card border border-border/50 rounded-xl p-4">
                  <h3 className="text-sm font-medium mb-3">Lead Source Breakdown</h3>
                  <div className="space-y-2">
                    {stats.leadSourceBreakdown.slice(0, 6).map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground truncate max-w-[180px]">{s.source || "Unknown"}</span>
                        <Badge variant="secondary">{s.count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Audit Log ───────────────────────────────────────────────────────── */}
            <section>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex-1 min-w-[120px]">Compliance Audit Log</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={auditEventType} onValueChange={v => { setAuditEventType(v === "all" ? "" : v); setAuditPage(1); }}>
                    <SelectTrigger className="w-44 h-7 text-xs" data-testid="select-audit-filter">
                      <SelectValue placeholder="Filter by type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All events</SelectItem>
                      <SelectItem value="contact_imported">Contact imported</SelectItem>
                      <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                      <SelectItem value="suppressed">Suppressed</SelectItem>
                      <SelectItem value="compliance_updated">Compliance updated</SelectItem>
                      <SelectItem value="implied_consent_expired">Consent expired</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    className="h-7 w-36 text-xs"
                    placeholder="Contact ID"
                    data-testid="input-audit-contact-id"
                    value={auditContactSearch}
                    onChange={e => {
                      const v = e.target.value;
                      setAuditContactSearch(v);
                      const n = Number(v);
                      setAuditContactId(v && !isNaN(n) ? n : null);
                      setAuditPage(1);
                    }}
                  />
                  <Input
                    className="h-7 w-36 text-xs"
                    placeholder="Campaign ID"
                    data-testid="input-audit-campaign-id"
                    value={auditCampaignSearch}
                    onChange={e => {
                      const v = e.target.value;
                      setAuditCampaignSearch(v);
                      const n = Number(v);
                      setAuditCampaignId(v && !isNaN(n) ? n : null);
                      setAuditPage(1);
                    }}
                  />
                  {(auditEventType || auditContactId || auditCampaignId) && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                      setAuditEventType(""); setAuditContactSearch(""); setAuditContactId(null);
                      setAuditCampaignSearch(""); setAuditCampaignId(null); setAuditPage(1);
                    }} data-testid="btn-audit-clear-filters">
                      <Filter className="w-3 h-3 mr-1" /> Clear
                    </Button>
                  )}
                </div>
              </div>

              <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/50 bg-muted/30">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Event</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Contact</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Campaign</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Notes</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditQuery.isLoading ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">Loading…</td></tr>
                    ) : auditRows.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">No audit events found</td></tr>
                    ) : auditRows.map(row => (
                      <tr key={row.id} className="border-b border-border/30 last:border-0" data-testid={`audit-row-${row.id}`}>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="text-xs capitalize">{row.event_type.replace(/_/g, " ")}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {row.contact_name ? (
                            <span>{row.contact_name}<br /><span className="text-muted-foreground">{row.contact_email}</span></span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.campaign_name || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">{row.notes || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(row.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {auditTotalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 text-xs text-muted-foreground">
                    <span>{auditTotal} total events</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)}>
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </Button>
                      <span>Page {auditPage} of {auditTotalPages}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={auditPage >= auditTotalPages} onClick={() => setAuditPage(p => p + 1)}>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {/* ── Import Dialog ────────────────────────────────────────────────────────── */}
      <Dialog open={showImport} onOpenChange={v => { setShowImport(v); if (!v) setImportState({ step: "upload", file: null, jurisdiction: "", consentSource: "", consentType: "", attested: false, preview: null, result: null, loading: false }); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4" /> Import Contacts
            </DialogTitle>
          </DialogHeader>

          {importState.step === "upload" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Upload a CSV file with columns: <code className="text-xs bg-muted px-1 rounded">email, name, first_name, last_name, consent_type, consent_source, implied_consent_expiry_date, lead_source</code></p>
              <div>
                <Label>CSV File</Label>
                <Input type="file" accept=".csv,text/csv" className="mt-1"
                  data-testid="input-csv-file"
                  onChange={e => setImportState(s => ({ ...s, file: e.target.files?.[0] ?? null }))} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowImport(false)}>Cancel</Button>
                <Button disabled={!importState.file} onClick={() => setImportState(s => ({ ...s, step: "metadata" }))} data-testid="btn-import-next-metadata">
                  Next
                </Button>
              </DialogFooter>
            </div>
          )}

          {importState.step === "metadata" && (
            <div className="space-y-4">
              <div>
                <Label>Jurisdiction *</Label>
                <Select value={importState.jurisdiction} onValueChange={v => setImportState(s => ({ ...s, jurisdiction: v }))}>
                  <SelectTrigger className="mt-1" data-testid="select-jurisdiction">
                    <SelectValue placeholder="Select jurisdiction" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="canada">Canada (CASL)</SelectItem>
                    <SelectItem value="us">United States (CAN-SPAM)</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Default Consent Source</Label>
                <Input className="mt-1" placeholder="e.g. trade_show, website_form, referral" data-testid="input-consent-source"
                  value={importState.consentSource}
                  onChange={e => setImportState(s => ({ ...s, consentSource: e.target.value }))} />
              </div>
              <div>
                <Label>Default Consent Type</Label>
                <Select value={importState.consentType} onValueChange={v => setImportState(s => ({ ...s, consentType: v }))}>
                  <SelectTrigger className="mt-1" data-testid="select-consent-type">
                    <SelectValue placeholder="Select consent type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="express">Express</SelectItem>
                    <SelectItem value="implied">Implied</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportState(s => ({ ...s, step: "upload" }))}>Back</Button>
                <Button disabled={!importState.jurisdiction} onClick={() => setImportState(s => ({ ...s, step: "attestation" }))} data-testid="btn-import-next-attestation">
                  Next
                </Button>
              </DialogFooter>
            </div>
          )}

          {importState.step === "attestation" && (
            <div className="space-y-4">
              <div className="p-4 bg-muted/30 rounded-lg border border-border/50 text-sm text-muted-foreground">
                {ATTESTATION_TEXT}
              </div>
              <div className="flex items-start gap-3">
                <Checkbox id="attestation-check" checked={importState.attested}
                  onCheckedChange={v => setImportState(s => ({ ...s, attested: !!v }))}
                  data-testid="checkbox-attestation" />
                <Label htmlFor="attestation-check" className="cursor-pointer text-sm leading-snug">
                  I confirm the above attestation and take full responsibility for the compliance of these contacts.
                </Label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportState(s => ({ ...s, step: "metadata" }))}>Back</Button>
                <Button
                  disabled={!importState.attested}
                  onClick={handlePreviewAndReview}
                  data-testid="btn-import-next-review"
                >
                  Review Import
                </Button>
              </DialogFooter>
            </div>
          )}

          {importState.step === "review" && importState.preview && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Review the import before it executes. Click <strong>Confirm Import</strong> to proceed or go back to adjust settings.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{importState.preview.totalRows}</p>
                  <p className="text-xs text-muted-foreground mt-1">Rows detected</p>
                </div>
                <div className={`rounded-lg p-3 text-center ${importState.preview.emailsMissing > 0 ? "bg-amber-500/10" : "bg-green-500/10"}`}>
                  <p className={`text-2xl font-bold ${importState.preview.emailsMissing > 0 ? "text-amber-400" : "text-green-400"}`}>{importState.preview.emailsMissing}</p>
                  <p className="text-xs text-muted-foreground mt-1">Missing emails</p>
                </div>
                {importState.jurisdiction === "canada" && (
                  <>
                    <div className={`rounded-lg p-3 text-center ${importState.preview.canadaMissingConsent > 0 ? "bg-amber-500/10" : "bg-muted/30"}`}>
                      <p className={`text-2xl font-bold ${importState.preview.canadaMissingConsent > 0 ? "text-amber-400" : "text-foreground"}`}>{importState.preview.canadaMissingConsent}</p>
                      <p className="text-xs text-muted-foreground mt-1">Missing consent info</p>
                    </div>
                    <div className={`rounded-lg p-3 text-center ${importState.preview.canadaMissingProof > 0 ? "bg-amber-500/10" : "bg-muted/30"}`}>
                      <p className={`text-2xl font-bold ${importState.preview.canadaMissingProof > 0 ? "text-amber-400" : "text-foreground"}`}>{importState.preview.canadaMissingProof}</p>
                      <p className="text-xs text-muted-foreground mt-1">Missing consent proof</p>
                    </div>
                  </>
                )}
              </div>
              {importState.preview.emailsMissing > 0 && (
                <p className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> {importState.preview.emailsMissing} row(s) with invalid or missing emails will be quarantined.
                </p>
              )}
              {importState.preview.sampleEmails.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Sample emails to import:</p>
                  <div className="space-y-0.5">
                    {importState.preview.sampleEmails.map((e, i) => <p key={i} className="text-xs font-mono text-foreground">{e}</p>)}
                    {importState.preview.totalRows > 3 && <p className="text-xs text-muted-foreground">…and {importState.preview.totalRows - 3} more</p>}
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportState(s => ({ ...s, step: "attestation" }))}>Back</Button>
                <Button
                  disabled={importState.loading}
                  onClick={handleImport}
                  data-testid="btn-import-confirm"
                >
                  {importState.loading ? "Importing…" : `Confirm Import (${importState.preview.totalRows} rows)`}
                </Button>
              </DialogFooter>
            </div>
          )}

          {importState.step === "result" && importState.result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-2xl font-bold text-foreground">{importState.result.totalRows}</p>
                  <p className="text-xs text-muted-foreground mt-1">Total rows</p>
                </div>
                <div className="bg-green-500/10 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-400">{importState.result.insertedRows}</p>
                  <p className="text-xs text-muted-foreground mt-1">Inserted</p>
                </div>
                <div className="bg-amber-500/10 rounded-lg p-3">
                  <p className="text-2xl font-bold text-amber-400">{importState.result.quarantinedRows}</p>
                  <p className="text-xs text-muted-foreground mt-1">Quarantined</p>
                </div>
              </div>
              {importState.result.report?.filter((r: any) => r.status === "quarantined").length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Quarantined contacts:</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {importState.result.report.filter((r: any) => r.status === "quarantined").map((r: any, i: number) => (
                      <div key={i} className="text-xs flex items-start gap-2 text-amber-300">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span><span className="font-medium">{r.email}</span> — {r.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => { setShowImport(false); setImportState({ step: "upload", file: null, jurisdiction: "", consentSource: "", consentType: "", attested: false, preview: null, result: null, loading: false }); }}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <MarketingDrilldownSheet
        config={drilldown}
        onClose={() => setDrilldown(null)}
      />
    </div>
  );
}
