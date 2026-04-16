import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Bell, BellRing, Mail, Smartphone, RefreshCw, Send, Clock, Calendar,
  AlertTriangle, CheckCircle2, XCircle, ChevronRight, Zap, BarChart3,
  TrendingDown, Package, Settings, History, Eye, ShieldAlert,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface DigestConfig {
  id: number;
  userId: number;
  enabled: boolean;
  cadence: "daily" | "weekly";
  sendHour: number;
  sendDayOfWeek: number;
  channels: string[];
  sections: Record<string, boolean>;
  severityThreshold: "low" | "medium" | "high";
  isRoleDefault: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  alertRules: Record<string, any>;
  updatedAt: string;
}

interface DigestSection {
  key: string;
  label: string;
  bullets: string[];
  count: number;
  severity: "low" | "medium" | "high";
}

interface ComposedDigest {
  userId: number;
  role: string;
  generatedAt: string;
  title: string;
  summary: string;
  sections: DigestSection[];
  totalSignals: number;
  highSeverityCount: number;
}

interface DigestRun {
  id: number;
  digestType: string;
  status: string;
  channel: string;
  sectionsSent: string[];
  payloadSummary: Record<string, any>;
  errorMessage: string | null;
  generatedAt: string;
  deliveredAt: string | null;
}

interface AlertItem {
  id: number;
  type: string;
  title: string;
  body: string;
  severity: string;
  linkedObjectType: string | null;
  linkedObjectId: number | null;
  actionUrl: string;
  isRead: boolean;
  createdAt: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const SECTION_META: Record<string, { label: string; icon: React.ElementType; desc: string }> = {
  topPriorities:      { label: "Top Priorities",         icon: AlertTriangle,  desc: "Urgent & high-priority tasks" },
  overdueTasks:       { label: "Overdue Tasks",           icon: Clock,          desc: "Tasks past their due date" },
  hotLeads:           { label: "Hot Leads",               icon: Zap,            desc: "Leads with score ≥ 70" },
  hotOpportunities:   { label: "Hot Opportunities",       icon: BarChart3,      desc: "High-score or high-value deals" },
  quotesFollowUp:     { label: "Quotes Follow-Up",        icon: Mail,           desc: "Sent quotes unanswered 7+ days" },
  blockedInstalls:    { label: "Blocked Installs",        icon: Package,        desc: "Deployments blocked or on hold" },
  certBlockers:       { label: "Cert Blockers",           icon: ShieldAlert,    desc: "Expiring or expired certifications" },
  revenueAtRisk:      { label: "Revenue at Risk",         icon: TrendingDown,   desc: "High churn-risk accounts" },
  mrrSummary:         { label: "MRR Summary",             icon: BarChart3,      desc: "Current & future recurring revenue" },
  renewalRisks:       { label: "Renewal Risks",           icon: Calendar,       desc: "Renewals due in 60 days" },
  churnRisks:         { label: "Churn Risks",             icon: TrendingDown,   desc: "Accounts with churn score ≥ 70" },
  territoryWhitespace:{ label: "Territory Highlights",    icon: BarChart3,      desc: "Lead volume by territory" },
  pipelineMovement:   { label: "Pipeline Movement",       icon: ChevronRight,   desc: "Deal activity in last 7 days" },
  procurementBlockers:{ label: "Procurement Blockers",    icon: Package,        desc: "Blocked procurement batches" },
};

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: i === 0 ? "12 AM" : i < 12 ? `${i} AM` : i === 12 ? "12 PM" : `${i-12} PM` }));

function severityColor(s: string) {
  return s === "high" ? "text-red-400 border-red-500/40 bg-red-500/10"
       : s === "medium" ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
       : "text-cyan-400 border-cyan-500/40 bg-cyan-500/10";
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant="outline" className={`text-xs capitalize ${severityColor(severity)}`}>
      {severity}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "delivered" ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
            : status === "failed"    ? "text-red-400 border-red-500/40 bg-red-500/10"
            : status === "skipped"   ? "text-slate-400 border-slate-500/40"
            : "text-amber-400 border-amber-500/40 bg-amber-500/10";
  const icon = status === "delivered" ? <CheckCircle2 className="h-3 w-3" />
             : status === "failed"    ? <XCircle className="h-3 w-3" />
             : null;
  return (
    <Badge variant="outline" className={`text-xs capitalize flex items-center gap-1 ${cls}`}>
      {icon}{status}
    </Badge>
  );
}

// ── Digest Preview Tab ───────────────────────────────────────────────────────

function DigestPreviewTab() {
  const { toast } = useToast();
  const { data, isLoading, refetch, isRefetching } = useQuery<{ digest: ComposedDigest; html: string }>({
    queryKey: ["/api/digest/preview"],
  });

  const sendMutation = useMutation({
    mutationFn: (channel: string) => apiRequest("POST", "/api/digest/send-now", { channel }),
    onSuccess: (res: any) => {
      toast({ title: res.ok ? "Digest Sent" : "Delivery Issue", description: res.ok ? `Delivered via ${res.status}.` : res.status });
      queryClient.invalidateQueries({ queryKey: ["/api/digest/runs"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const digest = data?.digest;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Live Digest Preview</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Based on your current config and live data</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} data-testid="button-refresh-digest">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => sendMutation.mutate("in_app")} disabled={sendMutation.isPending} data-testid="button-send-digest-inapp">
            <Bell className="h-3.5 w-3.5 mr-1.5" />
            Send In-App
          </Button>
          <Button variant="outline" size="sm" onClick={() => sendMutation.mutate("email")} disabled={sendMutation.isPending} data-testid="button-send-digest-email">
            <Mail className="h-3.5 w-3.5 mr-1.5" />
            Send Email
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : digest ? (
        <div className="space-y-3">
          {/* Summary card */}
          <Card className="border-border/40 bg-card/60">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-foreground" data-testid="text-digest-title">{digest.title}</div>
                  <div className="text-xs text-muted-foreground mt-1" data-testid="text-digest-summary">{digest.summary}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {digest.highSeverityCount > 0 && (
                    <Badge variant="outline" className="text-xs text-red-400 border-red-500/40 bg-red-500/10" data-testid="badge-high-severity">
                      {digest.highSeverityCount} critical
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs" data-testid="badge-total-signals">
                    {digest.totalSignals} signals
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sections */}
          {digest.sections.length === 0 ? (
            <Card className="border-border/40 bg-card/60">
              <CardContent className="py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                <div className="text-sm text-muted-foreground">All clear — no signals above your severity threshold.</div>
              </CardContent>
            </Card>
          ) : (
            digest.sections.map(section => {
              const meta = SECTION_META[section.key];
              const Icon = meta?.icon ?? Bell;
              return (
                <Card key={section.key} className={`border-l-2 border-border/40 bg-card/60 ${section.severity === "high" ? "border-l-red-500" : section.severity === "medium" ? "border-l-amber-500" : "border-l-cyan-500"}`} data-testid={`card-digest-section-${section.key}`}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-foreground">{section.label}</span>
                      </div>
                      <SeverityBadge severity={section.severity} />
                    </div>
                    <ul className="space-y-1">
                      {section.bullets.map((b, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <span className="text-primary mt-0.5">·</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      ) : (
        <div className="text-center py-8 text-sm text-muted-foreground">Failed to load digest preview.</div>
      )}
    </div>
  );
}

// ── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ config: DigestConfig; availableSections: string[] }>({
    queryKey: ["/api/digest/config"],
  });

  const config = data?.config;
  const available = data?.availableSections ?? [];

  const [local, setLocal] = useState<Partial<DigestConfig>>({});

  const merged: Partial<DigestConfig> = { ...config, ...local };

  const updateMutation = useMutation({
    mutationFn: (body: any) => apiRequest("PUT", "/api/digest/config", body),
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Digest configuration updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/digest/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/digest/preview"] });
      setLocal({});
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resetMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/digest/reset-to-defaults"),
    onSuccess: () => {
      toast({ title: "Reset to Role Defaults", description: "Your digest config has been reset." });
      queryClient.invalidateQueries({ queryKey: ["/api/digest/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/digest/preview"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const patch = (key: keyof DigestConfig, value: any) => setLocal(l => ({ ...l, [key]: value }));
  const toggleSection = (key: string) => {
    const current = (merged.sections ?? {}) as Record<string, boolean>;
    patch("sections", { ...current, [key]: !current[key] });
  };
  const toggleChannel = (ch: string) => {
    const current = (merged.channels ?? ["in_app"]) as string[];
    const next = current.includes(ch) ? current.filter(c => c !== ch) : [...current, ch];
    patch("channels", next.length ? next : [ch]);
  };

  const handleSave = () => {
    if (!config) return;
    updateMutation.mutate({ ...merged });
  };

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}</div>;
  if (!config) return <div className="text-sm text-muted-foreground text-center py-8">Failed to load settings.</div>;

  const channels = (merged.channels ?? ["in_app"]) as string[];
  const sections = (merged.sections ?? {}) as Record<string, boolean>;

  return (
    <div className="space-y-5">
      {/* Master toggle */}
      <Card className="border-border/40 bg-card/60">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-foreground">Digest Enabled</div>
              <div className="text-xs text-muted-foreground mt-0.5">Receive scheduled digests at your configured time</div>
            </div>
            <Switch checked={Boolean(merged.enabled)} onCheckedChange={v => patch("enabled", v)} data-testid="switch-digest-enabled" />
          </div>
        </CardContent>
      </Card>

      {/* Cadence */}
      <Card className="border-border/40 bg-card/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Cadence & Timing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-xs text-muted-foreground mb-1.5">Cadence</div>
              <Select value={merged.cadence ?? "daily"} onValueChange={v => patch("cadence", v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-cadence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground mb-1.5">Send at</div>
              <Select value={String(merged.sendHour ?? 8)} onValueChange={v => patch("sendHour", Number(v))}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-send-hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {merged.cadence === "weekly" && (
              <div className="flex-1">
                <div className="text-xs text-muted-foreground mb-1.5">Day of week</div>
                <Select value={String(merged.sendDayOfWeek ?? 1)} onValueChange={v => patch("sendDayOfWeek", Number(v))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-send-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-2">Quiet Hours (no delivery between)</div>
            <div className="flex items-center gap-3">
              <Select value={String(merged.quietHoursStart ?? 21)} onValueChange={v => patch("quietHoursStart", Number(v))}>
                <SelectTrigger className="h-8 text-xs w-28" data-testid="select-quiet-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">to</span>
              <Select value={String(merged.quietHoursEnd ?? 7)} onValueChange={v => patch("quietHoursEnd", Number(v))}>
                <SelectTrigger className="h-8 text-xs w-28" data-testid="select-quiet-end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delivery channels */}
      <Card className="border-border/40 bg-card/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Delivery Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: "in_app", label: "In-App Notification", icon: Smartphone, desc: "Delivered to your notification bell" },
            { key: "email", label: "Email (Gmail)", icon: Mail, desc: "Sent via your connected Gmail account" },
          ].map(({ key, label, icon: Icon, desc }) => (
            <div key={key} className="flex items-center justify-between" data-testid={`channel-row-${key}`}>
              <div className="flex items-center gap-2.5">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-xs font-medium text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
              </div>
              <Switch checked={channels.includes(key)} onCheckedChange={() => toggleChannel(key)} data-testid={`switch-channel-${key}`} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Severity threshold */}
      <Card className="border-border/40 bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Signal Threshold</CardTitle>
          <CardDescription className="text-xs">Only include sections with signals at or above this severity</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            {(["low","medium","high"] as const).map(s => (
              <button
                key={s}
                onClick={() => patch("severityThreshold", s)}
                className={`flex-1 py-2 rounded-lg border text-xs font-semibold capitalize transition-colors ${merged.severityThreshold === s ? severityColor(s) : "border-border/40 text-muted-foreground hover:text-foreground"}`}
                data-testid={`btn-severity-${s}`}
              >
                {s}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Sections */}
      <Card className="border-border/40 bg-card/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Included Sections</CardTitle>
          <CardDescription className="text-xs">Choose which sections appear in your digest</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.keys(SECTION_META).map(key => {
            const { label, icon: Icon, desc } = SECTION_META[key];
            const isAvailable = available.includes(key);
            const isEnabled = Boolean(sections[key]);
            return (
              <div key={key} className={`flex items-center justify-between py-1.5 ${!isAvailable ? "opacity-50" : ""}`} data-testid={`section-row-${key}`}>
                <div className="flex items-center gap-2.5">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <div className="text-xs font-medium text-foreground">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                </div>
                <Switch checked={isEnabled} onCheckedChange={() => toggleSection(key)} data-testid={`switch-section-${key}`} />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending} data-testid="button-reset-defaults">
          {resetMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
          Reset to Role Defaults
        </Button>
        <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending || Object.keys(local).length === 0} data-testid="button-save-settings">
          {updateMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
          Save Settings
        </Button>
      </div>
    </div>
  );
}

// ── Alert Rules Tab ──────────────────────────────────────────────────────────

function AlertRulesTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ rules: Record<string, any> }>({
    queryKey: ["/api/alerts/rules"],
  });

  const [local, setLocal] = useState<Record<string, any>>({});
  const merged = { ...data?.rules, ...local };

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/alerts/run-engine"),
    onSuccess: (res: any) => {
      toast({ title: "Alert Engine Run", description: `${res.alertsCreated ?? 0} new alert${res.alertsCreated !== 1 ? "s" : ""} created.` });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (body: any) => apiRequest("PUT", "/api/alerts/rules", body),
    onSuccess: () => {
      toast({ title: "Alert Rules Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/rules"] });
      setLocal({});
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="h-48 rounded-lg bg-muted animate-pulse" />;

  const rules: Array<{ key: string; label: string; desc: string; type: "number" | "boolean"; min?: number; max?: number }> = [
    { key: "stalledDealDays",       label: "Stalled Deal Threshold",          desc: "Alert when a deal has no activity for this many days",       type: "number", min: 1, max: 60 },
    { key: "quoteUnansweredDays",   label: "Unanswered Quote Threshold",       desc: "Alert when a sent quote has no response after this many days", type: "number", min: 1, max: 60 },
    { key: "churnScoreThreshold",   label: "Churn Score Alert Threshold",      desc: "Alert when an account's churn score crosses this level",     type: "number", min: 40, max: 100 },
    { key: "deploymentBlockedDays", label: "Blocked Deployment Days",          desc: "Alert when a deployment stays blocked for this long",        type: "number", min: 1, max: 30 },
    { key: "renewalDueDays",        label: "Renewal Warning Window (days)",    desc: "Alert this many days before a renewal is due",              type: "number", min: 7, max: 90 },
    { key: "pricingLockExpiryDays", label: "Pricing Lock Expiry Warning",      desc: "Alert this many days before a pricing lock expires",        type: "number", min: 1, max: 30 },
    { key: "scoreBandChangeSensitive", label: "Score Band Change Alerts",      desc: "Alert on major score jumps (≥20 points)",                   type: "boolean" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Alert Trigger Rules</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Configure thresholds for automatic alert generation</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending} data-testid="button-run-alert-engine">
          <BellRing className={`h-3.5 w-3.5 mr-1.5 ${runMutation.isPending ? "animate-pulse" : ""}`} />
          Run Alert Engine
        </Button>
      </div>

      <Card className="border-border/40 bg-card/60">
        <CardContent className="pt-4 pb-2 space-y-5">
          {rules.map(rule => (
            <div key={rule.key} data-testid={`alert-rule-${rule.key}`}>
              <div className="flex items-center justify-between mb-1.5">
                <div>
                  <div className="text-xs font-semibold text-foreground">{rule.label}</div>
                  <div className="text-xs text-muted-foreground">{rule.desc}</div>
                </div>
                {rule.type === "boolean" ? (
                  <Switch checked={Boolean(merged[rule.key])} onCheckedChange={v => setLocal(l => ({ ...l, [rule.key]: v }))} data-testid={`switch-rule-${rule.key}`} />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-primary min-w-[2.5rem] text-right" data-testid={`value-rule-${rule.key}`}>{merged[rule.key] ?? 7}</span>
                    <span className="text-xs text-muted-foreground">{rule.key.includes("Days") || rule.key.includes("Day") ? "days" : rule.key.includes("Score") || rule.key.includes("Threshold") ? "pts" : ""}</span>
                  </div>
                )}
              </div>
              {rule.type === "number" && (
                <Slider
                  min={rule.min} max={rule.max} step={1}
                  value={[Number(merged[rule.key] ?? 7)]}
                  onValueChange={([v]) => setLocal(l => ({ ...l, [rule.key]: v }))}
                  className="mt-2"
                  data-testid={`slider-rule-${rule.key}`}
                />
              )}
              <Separator className="mt-4 opacity-30" />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => updateMutation.mutate(merged)} disabled={updateMutation.isPending || Object.keys(local).length === 0} data-testid="button-save-rules">
          {updateMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
          Save Rules
        </Button>
      </div>
    </div>
  );
}

// ── Active Alerts Tab ─────────────────────────────────────────────────────────

function ActiveAlertsTab() {
  const { data, isLoading, refetch } = useQuery<{ alerts: AlertItem[]; count: number }>({
    queryKey: ["/api/alerts/active"],
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/notifications/read-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Active Alerts</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{data?.count ?? 0} unread alerts requiring attention</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-alerts">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
          {(data?.count ?? 0) > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllMutation.mutate()} disabled={markAllMutation.isPending} data-testid="button-mark-all-read">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Mark All Read
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : !data?.alerts?.length ? (
        <Card className="border-border/40 bg-card/60">
          <CardContent className="py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
            <div className="text-sm text-foreground font-medium">All clear</div>
            <div className="text-xs text-muted-foreground mt-1">No active alerts at this time.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.alerts.map(alert => (
            <Card key={alert.id} className={`border-l-2 border-border/40 bg-card/60 ${alert.severity === "high" ? "border-l-red-500" : alert.severity === "medium" ? "border-l-amber-500" : "border-l-cyan-500"}`} data-testid={`alert-item-${alert.id}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <SeverityBadge severity={alert.severity} />
                      <span className="text-xs font-semibold text-foreground truncate">{alert.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{alert.body}</div>
                    <div className="text-xs text-muted-foreground/50 mt-1">{new Date(alert.createdAt).toLocaleString()}</div>
                  </div>
                  <Button
                    variant="ghost" size="sm" className="shrink-0 h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => markReadMutation.mutate(alert.id)}
                    disabled={markReadMutation.isPending}
                    data-testid={`button-mark-read-${alert.id}`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab() {
  const { data, isLoading } = useQuery<{ runs: DigestRun[] }>({
    queryKey: ["/api/digest/runs"],
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Digest History</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Recent digest delivery records</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : !data?.runs?.length ? (
        <Card className="border-border/40 bg-card/60">
          <CardContent className="py-10 text-center">
            <History className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
            <div className="text-sm text-muted-foreground">No digest history yet. Send your first digest above.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.runs.map(run => (
            <Card key={run.id} className="border-border/40 bg-card/60" data-testid={`run-row-${run.id}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {run.channel === "email" ? <Mail className="h-3.5 w-3.5 text-muted-foreground" /> : <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground capitalize">{run.digestType} digest</span>
                        <StatusBadge status={run.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(run.generatedAt).toLocaleString()} · {Array.isArray(run.sectionsSent) ? run.sectionsSent.length : 0} sections
                      </div>
                      {run.errorMessage && <div className="text-xs text-red-400 mt-0.5">{run.errorMessage}</div>}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {run.payloadSummary && (
                      <>
                        <div>{(run.payloadSummary as any).totalSignals ?? 0} signals</div>
                        <div className="text-red-400">{(run.payloadSummary as any).highSeverity ?? 0} critical</div>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AlertsDigestPage() {
  const { data: configData } = useQuery<{ config: DigestConfig }>({
    queryKey: ["/api/digest/config"],
  });
  const { data: alertsData } = useQuery<{ alerts: AlertItem[]; count: number }>({
    queryKey: ["/api/alerts/active"],
  });

  const config = configData?.config;
  const alertCount = alertsData?.count ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border/40 bg-background/80 backdrop-blur-sm px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-bold text-foreground" data-testid="text-page-title">Alerts &amp; Digest</h1>
              {alertCount > 0 && (
                <Badge variant="destructive" className="text-xs" data-testid="badge-alert-count">{alertCount}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Role-aware executive summaries · Configurable alert triggers · In-app &amp; email delivery
            </p>
          </div>
          <div className="flex items-center gap-2">
            {config && (
              <Badge
                variant="outline"
                className={`text-xs ${config.enabled ? "text-emerald-400 border-emerald-500/40" : "text-muted-foreground"}`}
                data-testid="badge-digest-status"
              >
                {config.enabled ? "Digest On" : "Digest Off"} · {config.cadence}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <Tabs defaultValue="preview" className="space-y-5">
          <TabsList className="bg-muted/40 border border-border/40" data-testid="tabs-main">
            <TabsTrigger value="preview" className="text-xs gap-1.5" data-testid="tab-preview">
              <Eye className="h-3.5 w-3.5" />
              Digest Preview
            </TabsTrigger>
            <TabsTrigger value="alerts" className="text-xs gap-1.5 relative" data-testid="tab-alerts">
              <Bell className="h-3.5 w-3.5" />
              Active Alerts
              {alertCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">{alertCount > 9 ? "9+" : alertCount}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings" className="text-xs gap-1.5" data-testid="tab-settings">
              <Settings className="h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="rules" className="text-xs gap-1.5" data-testid="tab-rules">
              <Zap className="h-3.5 w-3.5" />
              Alert Rules
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs gap-1.5" data-testid="tab-history">
              <History className="h-3.5 w-3.5" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="mt-0">
            <DigestPreviewTab />
          </TabsContent>
          <TabsContent value="alerts" className="mt-0">
            <ActiveAlertsTab />
          </TabsContent>
          <TabsContent value="settings" className="mt-0">
            <SettingsTab />
          </TabsContent>
          <TabsContent value="rules" className="mt-0">
            <AlertRulesTab />
          </TabsContent>
          <TabsContent value="history" className="mt-0">
            <HistoryTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
