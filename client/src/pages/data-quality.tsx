import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle, CheckCircle2, Users, Building2, TrendingUp, FileText,
  UserX, Calendar, DollarSign, Link2Off, Archive, RefreshCw, Shield,
  Eye, EyeOff, Zap, ChevronRight, X, UserPlus, Hash, GitMerge,
  ArrowLeftRight, ChevronDown, ChevronUp, Loader2, History,
} from "lucide-react";

interface HealthScore { score: number; issues: number; }
interface Summary {
  health: {
    accounts: HealthScore; contacts: HealthScore; leads: HealthScore;
    opportunities: HealthScore; quotes: HealthScore;
  };
  counts: Record<string, number>;
  forecast: {
    opps_missing_close_date: number;
    weighted_stale_pipeline: number;
    weighted_no_owner_pipeline: number;
    duplicate_accounts_with_opps: number;
  };
}

function fmt(n: number) { return n >= 1000 ? `$${(n/1000).toFixed(1)}k` : `$${n}`; }

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-red-400";
  return (
    <div className={`text-2xl font-bold tabular-nums ${color}`} data-testid="score-ring">
      {score}
    </div>
  );
}

function HealthCard({
  label, icon: Icon, score, issues, objectKey,
}: { label: string; icon: any; score: number; issues: number; objectKey: string }) {
  const bg = score >= 80 ? "border-emerald-500/30" : score >= 60 ? "border-amber-500/30" : "border-red-500/30";
  return (
    <Card className={`border ${bg}`} data-testid={`health-card-${objectKey}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </div>
          <ScoreRing score={score} />
        </div>
        <div className="text-xs text-muted-foreground">
          {issues === 0 ? "No issues" : `${issues} issue${issues !== 1 ? "s" : ""} found`}
        </div>
      </CardContent>
    </Card>
  );
}

function IssueBadge({ severity }: { severity: "critical" | "warning" | "info" }) {
  const map = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    warning:  "bg-amber-500/20 text-amber-400 border-amber-500/30",
    info:     "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };
  return <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${map[severity]}`}>{severity}</span>;
}

// ── Assign Owner Dialog ────────────────────────────────────────────────────────
function AssignOwnerDialog({
  open, onClose, objectType, objectId, onSuccess,
}: { open: boolean; onClose: () => void; objectType: string; objectId: number; onSuccess: () => void }) {
  const { data: users } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const [selected, setSelected] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const fix = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/data-quality/fix", { action: "assign_owner", objectType, objectId, value: selected }),
    onSuccess: () => {
      toast({ title: "Owner assigned" });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/issues"] });
      onSuccess();
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Assign Owner</DialogTitle></DialogHeader>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger data-testid="select-owner"><SelectValue placeholder="Select user…" /></SelectTrigger>
          <SelectContent>
            {(users ?? []).map((u: any) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!selected || fix.isPending} onClick={() => fix.mutate()} data-testid="btn-assign-confirm">
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Set Close Date Dialog ──────────────────────────────────────────────────────
function SetDateDialog({
  open, onClose, objectId, onSuccess,
}: { open: boolean; onClose: () => void; objectId: number; onSuccess: () => void }) {
  const [date, setDate] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const fix = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/data-quality/fix", { action: "set_close_date", objectType: "opportunity", objectId, value: date }),
    onSuccess: () => {
      toast({ title: "Close date set" });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/issues"] });
      onSuccess();
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Set Close Date</DialogTitle></DialogHeader>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} data-testid="input-close-date" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!date || fix.isPending} onClick={() => fix.mutate()} data-testid="btn-set-date-confirm">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Set Amount Dialog ──────────────────────────────────────────────────────────
function SetAmountDialog({
  open, onClose, objectId, onSuccess,
}: { open: boolean; onClose: () => void; objectId: number; onSuccess: () => void }) {
  const [amount, setAmount] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const fix = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/data-quality/fix", { action: "set_amount", objectType: "opportunity", objectId, value: amount }),
    onSuccess: () => {
      toast({ title: "Amount set" });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/issues"] });
      onSuccess();
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Set Deal Amount</DialogTitle></DialogHeader>
        <Input type="number" placeholder="e.g. 25000" value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-amount" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!amount || fix.isPending} onClick={() => fix.mutate()} data-testid="btn-set-amount-confirm">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Ignore + action row ────────────────────────────────────────────────────────
function ActionRow({
  objectType, objectId, clusterKey, issueType, children, onIgnored,
}: {
  objectType: string; objectId?: number; clusterKey?: string;
  issueType: string; children?: React.ReactNode; onIgnored?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const ignore = useMutation({
    mutationFn: () => apiRequest("POST", "/api/data-quality/ignore", { objectType, objectId, clusterKey, issueType }),
    onSuccess: () => {
      toast({ title: "Issue dismissed" });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/issues"] });
      onIgnored?.();
    },
  });
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {children}
      <Button size="sm" variant="ghost" className="text-xs text-muted-foreground h-7 px-2"
        onClick={() => ignore.mutate()} disabled={ignore.isPending}
        data-testid={`btn-ignore-${objectType}-${objectId ?? clusterKey}`}>
        <EyeOff className="h-3 w-3 mr-1" /> Ignore
      </Button>
    </div>
  );
}

// ── Merge Review Panel ─────────────────────────────────────────────────────────
function MergeReviewPanel({
  entityType, primaryId, secondaryId, onClose, onMerged,
}: {
  entityType: string; primaryId: number; secondaryId: number;
  onClose: () => void; onMerged: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [swapped, setSwapped] = useState(false);
  const [fieldResolutions, setFieldResolutions] = useState<Record<string, { chosen: string; finalValue: any }>>({});
  const [step, setStep] = useState<"review" | "confirm">("review");

  const pid = swapped ? secondaryId : primaryId;
  const sid = swapped ? primaryId : secondaryId;

  const preview = useQuery<any>({
    queryKey: ["/api/merge/preview", entityType, pid, sid],
    queryFn: () => fetch(`/api/merge/preview/${entityType}/${pid}/${sid}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!pid && !!sid,
  });

  const apply = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/merge/apply", body),
    onSuccess: (data: any) => {
      toast({ title: "Merge complete", description: `Audit record #${data.auditId} created. Secondary archived.` });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/issues", "duplicates"] });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/merge/audit"] });
      onMerged();
    },
    onError: (err: any) => toast({ title: "Merge failed", description: err.message, variant: "destructive" }),
  });

  const d = preview.data;

  // Build field resolutions from defaults whenever preview loads or swap changes
  const getResolution = (key: string) => {
    if (fieldResolutions[key]) return fieldResolutions[key];
    const f = d?.fields?.find((f: any) => f.key === key);
    if (!f) return { chosen: "primary", finalValue: null };
    return { chosen: f.recommended, finalValue: f.recommended === "primary" ? f.primaryValue : f.secondaryValue };
  };

  const handleFieldChoice = (key: string, chosen: string, value: any) => {
    setFieldResolutions(prev => ({ ...prev, [key]: { chosen, finalValue: value } }));
  };

  const handleApply = () => {
    // Build final resolutions from current UI state
    const resolutions: Record<string, { chosen: string; finalValue: any }> = {};
    if (d?.fields) {
      for (const f of d.fields) {
        const res = getResolution(f.key);
        resolutions[f.key] = res;
      }
    }
    apply.mutate({ entityType, primaryId: pid, secondaryId: sid, fieldResolutions: resolutions, archiveSecondary: true });
  };

  const fmtVal = (v: any) => {
    if (v === null || v === undefined || v === "") return <span className="text-muted-foreground/40 italic">—</span>;
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  };

  const linkedLabel: Record<string, string> = {
    contacts: "Contacts", opportunities: "Opportunities", quotes: "Quotes", tasks: "Tasks",
    notes: "Notes", emails: "Emails", installWorkflows: "Installs", deployments: "Deployments",
    opportunityContacts: "Opp Contacts", activities: "Activities", convertedLeads: "Converted Leads",
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <GitMerge className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm capitalize">Merge {entityType} Records</span>
            {step === "confirm" && <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/40">Confirm</Badge>}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="btn-merge-panel-close"><X className="h-4 w-4" /></Button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-5">
            {preview.isLoading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!preview.isLoading && d && (
              <>
                {/* Warnings */}
                {d.warnings?.length > 0 && (
                  <Alert className="border-amber-500/30 bg-amber-500/5">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <AlertDescription className="text-xs space-y-0.5">
                      {d.warnings.map((w: string, i: number) => <div key={i}>{w}</div>)}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Primary / Secondary selection */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Primary (kept)", rec: d.primary, counts: d.primaryCounts, isPrimary: true },
                    { label: "Secondary (archived after merge)", rec: d.secondary, counts: d.secondaryCounts, isPrimary: false },
                  ].map(({ label, rec, counts, isPrimary }) => (
                    <div key={label} className={`rounded-lg border p-3 space-y-1.5 ${isPrimary ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/50"}`}>
                      <div className={`text-[10px] font-bold uppercase tracking-wide ${isPrimary ? "text-emerald-400" : "text-muted-foreground/60"}`}>{label}</div>
                      <div className="font-medium text-sm">{rec?.name ?? rec?.company ?? rec?.contact_name ?? `#${isPrimary ? pid : sid}`}</div>
                      <div className="text-xs text-muted-foreground">ID #{isPrimary ? pid : sid}</div>
                      {rec?.email && <div className="text-xs text-muted-foreground truncate">{rec.email}</div>}
                      {rec?.contact_email && <div className="text-xs text-muted-foreground truncate">{rec.contact_email}</div>}
                      {rec?.created_at && <div className="text-xs text-muted-foreground">Created {new Date(rec.created_at).toLocaleDateString()}</div>}
                      <div className="pt-1 flex flex-wrap gap-1">
                        {Object.entries(counts ?? {}).filter(([, v]) => (v as number) > 0).map(([k, v]) => (
                          <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{v} {linkedLabel[k] ?? k}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Swap button */}
                <div className="flex justify-center">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => { setSwapped(s => !s); setFieldResolutions({}); }}
                    data-testid="btn-swap-primary-secondary">
                    <ArrowLeftRight className="h-3.5 w-3.5" /> Swap Primary / Secondary
                  </Button>
                </div>

                <Separator />

                {/* Field resolution */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5">Field Resolution</div>
                  <div className="space-y-1.5">
                    {(d.fields ?? []).filter((f: any) => f.differs || (f.primaryValue != null && f.primaryValue !== "")).map((f: any) => {
                      const res = getResolution(f.key);
                      const chosenVal = res.chosen === "primary" ? f.primaryValue : f.secondaryValue;
                      return (
                        <div key={f.key} className={`grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center rounded-md px-2.5 py-2 text-xs ${f.differs ? "bg-muted/40" : "bg-transparent"}`}>
                          <div>
                            <div className="text-[10px] text-muted-foreground/60 uppercase mb-0.5">{f.label}</div>
                            <button
                              onClick={() => handleFieldChoice(f.key, "primary", f.primaryValue)}
                              className={`text-left rounded px-1.5 py-0.5 w-full transition-colors ${res.chosen === "primary" ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30" : "text-foreground/70 hover:bg-muted"}`}
                              data-testid={`field-choose-primary-${f.key}`}
                            >
                              {fmtVal(f.primaryValue)}
                            </button>
                          </div>
                          <div className="text-[10px] text-muted-foreground/40 px-1">vs</div>
                          <div>
                            <div className="text-[10px] text-muted-foreground/60 uppercase mb-0.5 opacity-0">_</div>
                            <button
                              onClick={() => handleFieldChoice(f.key, "secondary", f.secondaryValue)}
                              className={`text-left rounded px-1.5 py-0.5 w-full transition-colors ${res.chosen === "secondary" ? "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30" : "text-foreground/70 hover:bg-muted"}`}
                              data-testid={`field-choose-secondary-${f.key}`}
                            >
                              {fmtVal(f.secondaryValue)}
                            </button>
                          </div>
                          <div className={`text-[10px] w-16 text-right ${res.chosen === "primary" ? "text-emerald-400" : "text-blue-400"}`}>
                            {res.chosen === "primary" ? "← primary" : "secondary →"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {step === "confirm" && (
                  <>
                    <Separator />
                    <Alert className="border-red-500/30 bg-red-500/5">
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                      <AlertDescription className="text-xs">
                        <strong>This action is permanent.</strong> Record #{sid} will be archived and all its linked data relinked to #{pid}. An audit log entry will be created. Confirm to proceed.
                      </AlertDescription>
                    </Alert>
                  </>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border/50 gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="btn-merge-cancel">Cancel</Button>
          <div className="flex items-center gap-2">
            {step === "review" ? (
              <Button size="sm" className="gap-1.5" onClick={() => setStep("confirm")}
                disabled={preview.isLoading || !d} data-testid="btn-merge-proceed">
                <GitMerge className="h-3.5 w-3.5" /> Review & Confirm
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setStep("review")} data-testid="btn-merge-back">Back</Button>
                <Button size="sm" variant="destructive" className="gap-1.5" onClick={handleApply}
                  disabled={apply.isPending} data-testid="btn-merge-apply-confirm">
                  {apply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
                  Apply Merge
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Merge Audit Log Panel ──────────────────────────────────────────────────────
function MergeAuditPanel({ onClose }: { onClose: () => void }) {
  const audit = useQuery<any>({
    queryKey: ["/api/merge/audit"],
    queryFn: () => fetch("/api/merge/audit?limit=50", { credentials: "include" }).then(r => r.json()),
  });
  const rows: any[] = audit.data?.data ?? [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <History className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Merge Audit Log</span>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <ScrollArea className="flex-1 min-h-0 p-4">
          {audit.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {!audit.isLoading && rows.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">No merges have been performed yet.</div>}
          {rows.map((row: any) => (
            <div key={row.id} className="border border-border/40 rounded-lg p-3.5 mb-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs capitalize">{row.entity_type}</Badge>
                  <span className="text-xs font-medium">#{row.primary_id} ← #{row.secondary_id}</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{new Date(row.merged_at).toLocaleString()}</span>
              </div>
              <div className="text-xs text-muted-foreground">By {row.merged_by_name ?? `User #${row.merged_by_user_id}`}</div>
              {row.linked_object_counts && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {Object.entries(row.linked_object_counts as Record<string, number>)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => (
                      <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{v} {k}</span>
                    ))}
                </div>
              )}
              {row.warnings && Array.isArray(row.warnings) && row.warnings.length > 0 && (
                <div className="text-[11px] text-amber-400">{row.warnings.join(" · ")}</div>
              )}
            </div>
          ))}
        </ScrollArea>
      </div>
    </div>
  );
}

// ── Duplicates Tab ─────────────────────────────────────────────────────────────
function DuplicatesTab({ subFilter }: { subFilter?: string }) {
  const [highlighted, setHighlighted] = useState<string | undefined>(undefined);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/data-quality/issues", "duplicates"],
    queryFn: () => fetch("/api/data-quality/issues?category=duplicates", { credentials: "include" }).then(r => r.json()),
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [mergeTarget, setMergeTarget] = useState<{ type: string; primaryId: number; secondaryId: number } | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const archive = useMutation({
    mutationFn: ({ objectType, objectId }: { objectType: string; objectId: number }) =>
      apiRequest("PATCH", "/api/data-quality/fix", { action: "archive_record", objectType, objectId }),
    onSuccess: () => {
      toast({ title: "Record archived" });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/issues", "duplicates"] });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/summary"] });
    },
  });

  useEffect(() => {
    if (!subFilter) return;
    const el = document.getElementById(`dq-section-${subFilter}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    setHighlighted(subFilter);
    const t = setTimeout(() => setHighlighted(undefined), 1600);
    return () => clearTimeout(t);
  }, [subFilter]);

  if (isLoading) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;
  if (!data) return null;

  const total = (data.accounts?.length ?? 0) + (data.contacts?.length ?? 0) + (data.leads?.length ?? 0);

  const renderCluster = (cluster: any, objectType: string, index: number) => {
    const suggestedPrimary = cluster.records[0];
    const others = cluster.records.slice(1);
    return (
      <Card key={`${objectType}-${cluster.clusterKey}-${index}`} className="border border-border/50" data-testid={`cluster-${objectType}-${index}`}>
        <CardHeader className="py-3 px-4 border-b border-border/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs capitalize">{objectType}</Badge>
              <span className="text-sm font-medium truncate max-w-[300px]">{cluster.clusterKey}</span>
              <IssueBadge severity={cluster.count >= 3 ? "critical" : "warning"} />
            </div>
            <span className="text-xs text-muted-foreground">{cluster.count} records</span>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: `repeat(${Math.min(cluster.count, 3)}, 1fr)` }}>
            {cluster.records.map((rec: any, i: number) => (
              <div key={rec.id} className={`rounded-md border p-2.5 text-xs space-y-1 ${i === 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/50"}`}>
                {i === 0 && <div className="text-emerald-400 font-semibold text-[10px] uppercase tracking-wide">Suggested Primary</div>}
                <div className="font-medium">{rec.name ?? rec.company ?? rec.contactName}</div>
                {rec.city && <div className="text-muted-foreground">{rec.city}{rec.state ? `, ${rec.state}` : ""}</div>}
                {rec.email && <div className="text-muted-foreground truncate">{rec.email}</div>}
                <div className="text-muted-foreground">ID #{rec.id}</div>
                {rec.createdAt && <div className="text-muted-foreground">{new Date(rec.createdAt).toLocaleDateString()}</div>}
              </div>
            ))}
          </div>
          <ActionRow objectType={`${objectType}_dup`} clusterKey={cluster.clusterKey} issueType="duplicate">
            {others.map((rec: any) => (
              <Button
                key={rec.id} size="sm" variant="default"
                className="h-7 text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 gap-1"
                onClick={() => setMergeTarget({ type: objectType, primaryId: suggestedPrimary.id, secondaryId: rec.id })}
                data-testid={`btn-merge-${objectType}-${rec.id}`}
              >
                <GitMerge className="h-3 w-3" /> Merge #{rec.id} → #{suggestedPrimary.id}
              </Button>
            ))}
            {others.map((rec: any) => (
              <Button key={`arc-${rec.id}`} size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => archive.mutate({ objectType, objectId: rec.id })}
                data-testid={`btn-archive-${objectType}-${rec.id}`}>
                <Archive className="h-3 w-3 mr-1" /> Archive #{rec.id}
              </Button>
            ))}
          </ActionRow>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header row with audit log link */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{total} cluster{total !== 1 ? "s" : ""} found</span>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={() => setShowAudit(true)} data-testid="btn-merge-audit-log">
          <History className="h-3.5 w-3.5" /> Merge History
        </Button>
      </div>

      {total === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
          <p>No duplicate clusters detected.</p>
        </div>
      )}

      {data.accounts?.length > 0 && <div id="dq-section-accounts" className={cn("space-y-3 rounded-lg transition-all duration-700", highlighted === "accounts" && "ring-2 ring-primary/40 bg-primary/[0.04] p-1")}>{data.accounts.map((c: any, i: number) => renderCluster(c, "account", i))}</div>}
      {data.contacts?.length > 0 && <div id="dq-section-contacts" className={cn("space-y-3 rounded-lg transition-all duration-700", highlighted === "contacts" && "ring-2 ring-primary/40 bg-primary/[0.04] p-1")}>{data.contacts.map((c: any, i: number) => renderCluster(c, "contact", i))}</div>}
      {data.leads?.length > 0    && <div id="dq-section-leads"    className={cn("space-y-3 rounded-lg transition-all duration-700", highlighted === "leads"    && "ring-2 ring-primary/40 bg-primary/[0.04] p-1")}>{data.leads.map((c: any, i: number) => renderCluster(c, "lead", i))}</div>}

      {/* Merge review panel */}
      {mergeTarget && (
        <MergeReviewPanel
          entityType={mergeTarget.type}
          primaryId={mergeTarget.primaryId}
          secondaryId={mergeTarget.secondaryId}
          onClose={() => setMergeTarget(null)}
          onMerged={() => setMergeTarget(null)}
        />
      )}

      {/* Audit log panel */}
      {showAudit && <MergeAuditPanel onClose={() => setShowAudit(false)} />}
    </div>
  );
}

// ── Missing Owner Tab ──────────────────────────────────────────────────────────
function MissingOwnerTab({ subFilter }: { subFilter?: string }) {
  const [highlighted, setHighlighted] = useState<string | undefined>(undefined);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/data-quality/issues", "missing_owner"],
    queryFn: () => fetch("/api/data-quality/issues?category=missing_owner", { credentials: "include" }).then(r => r.json()),
  });
  const [assignDialog, setAssignDialog] = useState<{ objectType: string; objectId: number } | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (!subFilter) return;
    const el = document.getElementById(`dq-section-${subFilter}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    setHighlighted(subFilter);
    const t = setTimeout(() => setHighlighted(undefined), 1600);
    return () => clearTimeout(t);
  }, [subFilter]);

  const bulkAssign = useMutation({
    mutationFn: ({ ids, objectType, userId }: any) =>
      apiRequest("PATCH", "/api/data-quality/fix", { action: "bulk_assign_owner", objectType, ids, value: userId }),
    onSuccess: (_, v) => {
      toast({ title: `Owner assigned to ${v.ids.length} records` });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/issues", "missing_owner"] });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/summary"] });
    },
  });

  const { data: users } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const [bulkUserId, setBulkUserId] = useState("");

  if (isLoading) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!data) return null;

  const total = (data.opportunities?.length ?? 0) + (data.tasks?.length ?? 0) + (data.leads?.length ?? 0);
  if (total === 0) return (
    <div className="text-center py-12 text-muted-foreground">
      <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
      <p>All active records have an assigned owner.</p>
    </div>
  );

  const renderRow = (rec: any, objectType: string) => (
    <div key={rec.id} className="flex items-center justify-between py-2.5 px-4 border-b border-border/30 last:border-0 hover:bg-muted/30"
      data-testid={`row-missing-owner-${objectType}-${rec.id}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">
          {rec.title ?? rec.company ?? rec.name ?? `${rec.contactName ?? ""}`}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
          <Badge variant="outline" className="text-[10px] px-1">{objectType}</Badge>
          {rec.stage && <span>{rec.stage}</span>}
          {rec.status && <span>{rec.status}</span>}
          {rec.amount > 0 && <span className="text-emerald-400">${rec.amount?.toLocaleString()}</span>}
          {rec.accountName && <span>{rec.accountName}</span>}
        </div>
      </div>
      <ActionRow objectType={objectType} objectId={rec.id} issueType="missing_owner">
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => setAssignDialog({ objectType, objectId: rec.id })}
          data-testid={`btn-assign-${objectType}-${rec.id}`}>
          <UserPlus className="h-3 w-3 mr-1" /> Assign
        </Button>
      </ActionRow>
    </div>
  );

  const sections = [
    { label: "Opportunities", key: "opportunity", dataKey: "opportunities", icon: TrendingUp, items: data.opportunities ?? [] },
    { label: "Tasks",         key: "task",        dataKey: "tasks",         icon: Zap,         items: data.tasks         ?? [] },
    { label: "Leads",         key: "lead",        dataKey: "leads",         icon: Users,       items: data.leads         ?? [] },
  ];

  return (
    <div className="space-y-4">
      {/* Bulk assign bar */}
      {total > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 border border-border/40">
          <span className="text-sm text-muted-foreground flex-1">{total} records without owner</span>
          <Select value={bulkUserId} onValueChange={setBulkUserId}>
            <SelectTrigger className="w-44 h-8 text-xs" data-testid="select-bulk-owner"><SelectValue placeholder="Select user…" /></SelectTrigger>
            <SelectContent>
              {(users ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 text-xs" disabled={!bulkUserId || bulkAssign.isPending}
            onClick={() => {
              const ids = [...(data.opportunities ?? []), ...(data.tasks ?? []), ...(data.leads ?? [])].map((r: any) => r.id);
              bulkAssign.mutate({ ids, objectType: "opportunity", userId: bulkUserId });
            }}
            data-testid="btn-bulk-assign">
            Assign All
          </Button>
        </div>
      )}
      {sections.map(sec => sec.items.length > 0 && (
        <Card key={sec.key} id={`dq-section-${sec.key}`} className={cn("border border-border/50 transition-all duration-700", highlighted === sec.key && "ring-2 ring-primary/40 bg-primary/[0.04]")}>
          <CardHeader className="py-2.5 px-4 border-b border-border/30">
            <div className="flex items-center gap-2 text-sm">
              <sec.icon className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{sec.label}</span>
              <Badge variant="outline" className="text-[10px]">{sec.items.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {sec.items.map((r: any) => renderRow(r, sec.key))}
          </CardContent>
        </Card>
      ))}
      {assignDialog && (
        <AssignOwnerDialog
          open objectType={assignDialog.objectType} objectId={assignDialog.objectId}
          onClose={() => setAssignDialog(null)} onSuccess={() => setAssignDialog(null)}
        />
      )}
    </div>
  );
}

// ── Missing Fields Tab ─────────────────────────────────────────────────────────
function MissingFieldsTab({ subFilter }: { subFilter?: string }) {
  const [highlighted, setHighlighted] = useState<string | undefined>(undefined);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/data-quality/issues", "missing_fields"],
    queryFn: () => fetch("/api/data-quality/issues?category=missing_fields", { credentials: "include" }).then(r => r.json()),
  });
  const [dateDialog, setDateDialog] = useState<number | null>(null);
  const [amtDialog,  setAmtDialog]  = useState<number | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!subFilter) return;
    const el = document.getElementById(`dq-section-${subFilter}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    setHighlighted(subFilter);
    const t = setTimeout(() => setHighlighted(undefined), 1600);
    return () => clearTimeout(t);
  }, [subFilter]);

  if (isLoading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!data) return null;

  const total = (data.missingCloseDate?.length ?? 0) + (data.missingAmount?.length ?? 0);
  if (total === 0) return (
    <div className="text-center py-12 text-muted-foreground">
      <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
      <p>All active opportunities have required fields.</p>
    </div>
  );

  const renderOpp = (opp: any, issueType: string, actionBtn: React.ReactNode) => (
    <div key={opp.id} className="flex items-center justify-between py-2.5 px-4 border-b border-border/30 last:border-0 hover:bg-muted/30"
      data-testid={`row-missing-${issueType}-${opp.id}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{opp.title}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
          <Badge variant="outline" className="text-[10px] px-1">{opp.stage}</Badge>
          {opp.accountName && <span>{opp.accountName}</span>}
          {opp.ownerName && <span>Owner: {opp.ownerName}</span>}
          {opp.forecastCategory && opp.forecastCategory !== "pipeline" && (
            <span className="text-amber-400">{opp.forecastCategory}</span>
          )}
        </div>
      </div>
      <ActionRow objectType="opportunity" objectId={opp.id} issueType={issueType}
        onIgnored={() => qc.invalidateQueries({ queryKey: ["/api/data-quality/issues", "missing_fields"] })}>
        {actionBtn}
      </ActionRow>
    </div>
  );

  return (
    <div className="space-y-4">
      {data.missingCloseDate?.length > 0 && (
        <Card id="dq-section-close_date" className={cn("border border-border/50 transition-all duration-700", highlighted === "close_date" && "ring-2 ring-primary/40 bg-primary/[0.04]")}>
          <CardHeader className="py-2.5 px-4 border-b border-border/30">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Missing Close Date</span>
              <Badge variant="outline" className="text-[10px]">{data.missingCloseDate.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {data.missingCloseDate.map((opp: any) => renderOpp(opp, "missing_close_date",
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDateDialog(opp.id)}
                data-testid={`btn-set-date-${opp.id}`}>
                <Calendar className="h-3 w-3 mr-1" /> Set Date
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
      {data.missingAmount?.length > 0 && (
        <Card id="dq-section-amount" className={cn("border border-border/50 transition-all duration-700", highlighted === "amount" && "ring-2 ring-primary/40 bg-primary/[0.04]")}>
          <CardHeader className="py-2.5 px-4 border-b border-border/30">
            <div className="flex items-center gap-2 text-sm">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Missing / Zero Amount</span>
              <Badge variant="outline" className="text-[10px]">{data.missingAmount.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {data.missingAmount.map((opp: any) => renderOpp(opp, "missing_amount",
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAmtDialog(opp.id)}
                data-testid={`btn-set-amount-${opp.id}`}>
                <DollarSign className="h-3 w-3 mr-1" /> Set Amount
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
      {dateDialog !== null && (
        <SetDateDialog open objectId={dateDialog} onClose={() => setDateDialog(null)} onSuccess={() => setDateDialog(null)} />
      )}
      {amtDialog !== null && (
        <SetAmountDialog open objectId={amtDialog} onClose={() => setAmtDialog(null)} onSuccess={() => setAmtDialog(null)} />
      )}
    </div>
  );
}

// ── Orphans Tab ────────────────────────────────────────────────────────────────
function OrphansTab({ subFilter }: { subFilter?: string }) {
  const [highlighted, setHighlighted] = useState<string | undefined>(undefined);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/data-quality/issues", "orphans"],
    queryFn: () => fetch("/api/data-quality/issues?category=orphans", { credentials: "include" }).then(r => r.json()),
  });
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (!subFilter) return;
    const el = document.getElementById(`dq-section-${subFilter}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    setHighlighted(subFilter);
    const t = setTimeout(() => setHighlighted(undefined), 1600);
    return () => clearTimeout(t);
  }, [subFilter]);

  const archive = useMutation({
    mutationFn: ({ objectType, objectId }: { objectType: string; objectId: number }) =>
      apiRequest("PATCH", "/api/data-quality/fix", { action: "archive_record", objectType, objectId }),
    onSuccess: () => {
      toast({ title: "Record archived" });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/issues", "orphans"] });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/summary"] });
    },
  });

  if (isLoading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!data) return null;

  const total = (data.orphanQuotes?.length ?? 0) + (data.orphanOpps?.length ?? 0) + (data.brokenLeadLinks?.length ?? 0);
  if (total === 0) return (
    <div className="text-center py-12 text-muted-foreground">
      <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
      <p>No orphan or broken-link records found.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {data.orphanQuotes?.length > 0 && (
        <Card id="dq-section-quotes" className={cn("border border-amber-500/20 transition-all duration-700", highlighted === "quotes" && "ring-2 ring-primary/40 bg-primary/[0.04]")}>
          <CardHeader className="py-2.5 px-4 border-b border-border/30">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-amber-400" />
              <span className="font-medium">Orphan Quotes</span>
              <Badge variant="outline" className="text-[10px]">{data.orphanQuotes.length}</Badge>
              <span className="text-xs text-muted-foreground">— linked opportunity no longer exists</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {data.orphanQuotes.map((q: any) => (
              <div key={q.id} className="flex items-center justify-between py-2.5 px-4 border-b border-border/30 last:border-0"
                data-testid={`row-orphan-quote-${q.id}`}>
                <div className="text-sm">
                  <span className="font-medium">{q.quoteNumber}</span>
                  <span className="text-muted-foreground ml-2 text-xs">Opp #{q.opportunityId} missing • ${(q.total ?? 0).toLocaleString()}</span>
                </div>
                <ActionRow objectType="quote" objectId={q.id} issueType="orphan">
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => archive.mutate({ objectType: "quote", objectId: q.id })}
                    data-testid={`btn-archive-quote-${q.id}`}>
                    <Archive className="h-3 w-3 mr-1" /> Archive
                  </Button>
                </ActionRow>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {data.orphanOpps?.length > 0 && (
        <Card id="dq-section-opps" className={cn("border border-red-500/20 transition-all duration-700", highlighted === "opps" && "ring-2 ring-primary/40 bg-primary/[0.04]")}>
          <CardHeader className="py-2.5 px-4 border-b border-border/30">
            <div className="flex items-center gap-2 text-sm">
              <Link2Off className="h-4 w-4 text-red-400" />
              <span className="font-medium">Orphan Opportunities</span>
              <Badge variant="outline" className="text-[10px]">{data.orphanOpps.length}</Badge>
              <span className="text-xs text-muted-foreground">— no valid linked account</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {data.orphanOpps.map((o: any) => (
              <div key={o.id} className="flex items-center justify-between py-2.5 px-4 border-b border-border/30 last:border-0"
                data-testid={`row-orphan-opp-${o.id}`}>
                <div className="text-sm">
                  <span className="font-medium">{o.title}</span>
                  <span className="text-muted-foreground ml-2 text-xs">Account #{o.accountId} missing</span>
                </div>
                <ActionRow objectType="opportunity" objectId={o.id} issueType="orphan">
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => archive.mutate({ objectType: "opportunity", objectId: o.id })}
                    data-testid={`btn-archive-opp-${o.id}`}>
                    <Archive className="h-3 w-3 mr-1" /> Archive
                  </Button>
                </ActionRow>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {data.brokenLeadLinks?.length > 0 && (
        <Card id="dq-section-broken" className={cn("border border-border/50 transition-all duration-700", highlighted === "broken" && "ring-2 ring-primary/40 bg-primary/[0.04]")}>
          <CardHeader className="py-2.5 px-4 border-b border-border/30">
            <div className="flex items-center gap-2 text-sm">
              <Link2Off className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Converted Leads with Broken Links</span>
              <Badge variant="outline" className="text-[10px]">{data.brokenLeadLinks.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {data.brokenLeadLinks.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between py-2.5 px-4 border-b border-border/30 last:border-0"
                data-testid={`row-broken-lead-${l.id}`}>
                <div className="text-sm">
                  <span className="font-medium">{l.company}</span>
                  <span className="text-muted-foreground ml-2 text-xs">Opp #{l.convertedOpportunityId} missing</span>
                </div>
                <ActionRow objectType="lead" objectId={l.id} issueType="broken_link" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Stale Records Tab ──────────────────────────────────────────────────────────
function StaleTab() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/data-quality/issues", "stale"],
    queryFn: () => fetch("/api/data-quality/issues?category=stale", { credentials: "include" }).then(r => r.json()),
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: users } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const [bulkUserId, setBulkUserId] = useState("");

  const bulkTasks = useMutation({
    mutationFn: (ids: number[]) =>
      apiRequest("PATCH", "/api/data-quality/fix", { action: "bulk_create_tasks", objectType: "lead", ids }),
    onSuccess: () => {
      toast({ title: "Follow-up tasks created" });
      qc.invalidateQueries({ queryKey: ["/api/data-quality/issues", "stale"] });
    },
  });

  if (isLoading) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!data) return null;

  const total = (data.staleLeads?.length ?? 0) + (data.contactsNoAccount?.length ?? 0);
  if (total === 0) return (
    <div className="text-center py-12 text-muted-foreground">
      <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
      <p>No stale records found.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {data.staleLeads?.length > 0 && (
        <Card className="border border-border/50">
          <CardHeader className="py-2.5 px-4 border-b border-border/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Stale Leads</span>
                <Badge variant="outline" className="text-[10px]">{data.staleLeads.length}</Badge>
                <span className="text-xs text-muted-foreground">— no owner or 30+ days no activity</span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                disabled={bulkTasks.isPending}
                onClick={() => bulkTasks.mutate(data.staleLeads.map((l: any) => l.id))}
                data-testid="btn-bulk-create-tasks">
                <Zap className="h-3 w-3 mr-1" /> Create Follow-ups
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {data.staleLeads.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between py-2.5 px-4 border-b border-border/30 last:border-0"
                data-testid={`row-stale-lead-${l.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{l.company}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span>{l.contactName}</span>
                    {l.ownerName ? <span>Owner: {l.ownerName}</span> : <span className="text-red-400">No owner</span>}
                    {l.daysSince > 0 && <span className="text-amber-400">{l.daysSince}d stale</span>}
                  </div>
                </div>
                <ActionRow objectType="lead" objectId={l.id} issueType="stale" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {data.contactsNoAccount?.length > 0 && (
        <Card className="border border-border/50">
          <CardHeader className="py-2.5 px-4 border-b border-border/30">
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Contacts with No Valid Account</span>
              <Badge variant="outline" className="text-[10px]">{data.contactsNoAccount.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {data.contactsNoAccount.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between py-2.5 px-4 border-b border-border/30 last:border-0"
                data-testid={`row-contact-no-account-${c.id}`}>
                <div className="text-sm">
                  <span className="font-medium">{c.name}</span>
                  {c.email && <span className="text-muted-foreground ml-2 text-xs">{c.email}</span>}
                  <span className="text-muted-foreground ml-2 text-xs">Account #{c.accountId} missing</span>
                </div>
                <ActionRow objectType="contact" objectId={c.id} issueType="no_account" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────────────────────────────────
function OverviewTab({ summary, onNavigate }: { summary: Summary; onNavigate: (tab: string, subFilter?: string) => void }) {
  const { counts, forecast } = summary;
  const issues = [
    { label: "Duplicate account clusters",     count: counts.duplicate_account_clusters,  tab: "duplicates",     subFilter: "accounts",   severity: "warning"  as const, icon: Building2 },
    { label: "Duplicate contact clusters",     count: counts.duplicate_contact_clusters,  tab: "duplicates",     subFilter: "contacts",   severity: "warning"  as const, icon: Users },
    { label: "Duplicate lead clusters",        count: counts.duplicate_lead_clusters,     tab: "duplicates",     subFilter: "leads",      severity: "warning"  as const, icon: Hash },
    { label: "Opportunities without owner",    count: counts.missing_owner_opps,          tab: "missing_owner",  subFilter: "opportunity",severity: "critical" as const, icon: UserX },
    { label: "Tasks without owner",            count: counts.missing_owner_tasks,         tab: "missing_owner",  subFilter: "task",       severity: "warning"  as const, icon: UserX },
    { label: "Leads without owner",            count: counts.missing_owner_leads,         tab: "missing_owner",  subFilter: "lead",       severity: "warning"  as const, icon: UserX },
    { label: "Opportunities missing close date", count: counts.missing_close_date,        tab: "missing_fields", subFilter: "close_date", severity: "critical" as const, icon: Calendar },
    { label: "Opportunities missing amount",   count: counts.missing_amount,              tab: "missing_fields", subFilter: "amount",     severity: "critical" as const, icon: DollarSign },
    { label: "Orphan quotes",                  count: counts.orphan_quotes,               tab: "orphans",        subFilter: "quotes",     severity: "warning"  as const, icon: FileText },
    { label: "Orphan opportunities",           count: counts.orphan_opps,                 tab: "orphans",        subFilter: "opps",       severity: "critical" as const, icon: Link2Off },
    { label: "Broken converted lead links",    count: counts.broken_lead_links,           tab: "orphans",        subFilter: "broken",     severity: "warning"  as const, icon: Link2Off },
    { label: "Stale leads (30+ days)",         count: counts.stale_leads,                 tab: "stale",          subFilter: undefined,    severity: "info"     as const, icon: RefreshCw },
    { label: "Contacts without valid account", count: counts.contacts_no_account,         tab: "stale",          subFilter: undefined,    severity: "info"     as const, icon: Users },
  ].filter(i => i.count > 0);

  return (
    <div className="space-y-5">
      {/* Forecast risk alerts */}
      {(forecast.opps_missing_close_date > 0 || forecast.weighted_stale_pipeline > 0 || forecast.weighted_no_owner_pipeline > 0) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> Forecast Risks
          </h3>
          {forecast.opps_missing_close_date > 0 && (
            <Alert className="border-amber-500/30 bg-amber-500/5">
              <AlertDescription className="text-sm text-amber-300">
                <strong>{forecast.opps_missing_close_date}</strong> commit/best-case opportunities are missing close dates — forecasting is unreliable.
              </AlertDescription>
            </Alert>
          )}
          {forecast.weighted_stale_pipeline > 0 && (
            <Alert className="border-amber-500/30 bg-amber-500/5">
              <AlertDescription className="text-sm text-amber-300">
                <strong>{fmt(forecast.weighted_stale_pipeline)}</strong> pipeline tied to stale opportunities with no recent activity.
              </AlertDescription>
            </Alert>
          )}
          {forecast.weighted_no_owner_pipeline > 0 && (
            <Alert className="border-red-500/30 bg-red-500/5">
              <AlertDescription className="text-sm text-red-300">
                <strong>{fmt(forecast.weighted_no_owner_pipeline)}</strong> pipeline tied to opportunities without an owner.
              </AlertDescription>
            </Alert>
          )}
          {forecast.duplicate_accounts_with_opps > 0 && (
            <Alert className="border-amber-500/30 bg-amber-500/5">
              <AlertDescription className="text-sm text-amber-300">
                <strong>{forecast.duplicate_accounts_with_opps}</strong> duplicate account clusters have active opportunities — totals may be inflated.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Issue list */}
      {issues.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
          <p className="font-medium">CRM data looks clean!</p>
          <p className="text-sm">No issues detected.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">All Issues ({counts.total})</h3>
          {issues.map((issue, i) => (
            <button key={i}
              className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-muted/20 hover:bg-muted/50 cursor-pointer text-left transition-colors"
              onClick={() => onNavigate(issue.tab, issue.subFilter)}
              data-testid={`overview-issue-${i}`}>
              <div className="flex items-center gap-2 text-sm">
                <issue.icon className="h-4 w-4 text-muted-foreground" />
                <span>{issue.label}</span>
                <IssueBadge severity={issue.severity} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums">{issue.count}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function DataQualityPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [subFilter, setSubFilter] = useState<string | undefined>(undefined);

  function navigate(tab: string, sf?: string) {
    setSubFilter(sf);
    setActiveTab(tab);
  }

  const { data: summary, isLoading } = useQuery<Summary>({
    queryKey: ["/api/data-quality/summary"],
    queryFn: () => fetch("/api/data-quality/summary", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60_000,
  });

  const healthCards = summary ? [
    { key: "accounts",      label: "Accounts",      icon: Building2,   ...summary.health.accounts },
    { key: "contacts",      label: "Contacts",      icon: Users,       ...summary.health.contacts },
    { key: "leads",         label: "Leads",         icon: TrendingUp,  ...summary.health.leads },
    { key: "opportunities", label: "Opportunities", icon: Zap,         ...summary.health.opportunities },
    { key: "quotes",        label: "Quotes",        icon: FileText,    ...summary.health.quotes },
  ] : [];

  const totalIssues = summary?.counts.total ?? 0;

  return (
    <div className="flex-1 overflow-auto bg-background pt-6 px-6 pb-24 lg:pb-8 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="page-title">
            <Shield className="h-5 w-5 text-primary" />
            Data Quality Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Identify and resolve dirty CRM data before it damages workflow, reporting, and forecasting.
          </p>
        </div>
        {summary && (
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums" data-testid="total-issue-count">
              {totalIssues}
            </div>
            <div className="text-xs text-muted-foreground">total issues</div>
          </div>
        )}
      </div>

      {/* Health Score Cards */}
      {isLoading ? (
        <div className="grid grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {healthCards.map(h => <HealthCard key={h.key} {...h} />)}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={t => { setSubFilter(undefined); setActiveTab(t); }}>
        <TabsList className="w-full justify-start gap-1 h-9 bg-muted/40 p-1">
          <TabsTrigger value="overview"       className="text-xs" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="duplicates"     className="text-xs" data-testid="tab-duplicates">
            Duplicates {summary && summary.counts.duplicate_account_clusters + summary.counts.duplicate_contact_clusters + summary.counts.duplicate_lead_clusters > 0 &&
              <Badge variant="outline" className="ml-1 text-[10px] px-1">
                {summary.counts.duplicate_account_clusters + summary.counts.duplicate_contact_clusters + summary.counts.duplicate_lead_clusters}
              </Badge>}
          </TabsTrigger>
          <TabsTrigger value="missing_owner"  className="text-xs" data-testid="tab-missing-owner">
            Missing Owners {summary && summary.counts.missing_owner_opps + summary.counts.missing_owner_tasks + summary.counts.missing_owner_leads > 0 &&
              <Badge variant="outline" className="ml-1 text-[10px] px-1">
                {summary.counts.missing_owner_opps + summary.counts.missing_owner_tasks + summary.counts.missing_owner_leads}
              </Badge>}
          </TabsTrigger>
          <TabsTrigger value="missing_fields" className="text-xs" data-testid="tab-missing-fields">
            Missing Fields {summary && summary.counts.missing_close_date + summary.counts.missing_amount > 0 &&
              <Badge variant="outline" className="ml-1 text-[10px] px-1">
                {summary.counts.missing_close_date + summary.counts.missing_amount}
              </Badge>}
          </TabsTrigger>
          <TabsTrigger value="orphans"        className="text-xs" data-testid="tab-orphans">
            Orphans {summary && summary.counts.orphan_quotes + summary.counts.orphan_opps + summary.counts.broken_lead_links > 0 &&
              <Badge variant="outline" className="ml-1 text-[10px] px-1">
                {summary.counts.orphan_quotes + summary.counts.orphan_opps + summary.counts.broken_lead_links}
              </Badge>}
          </TabsTrigger>
          <TabsTrigger value="stale"          className="text-xs" data-testid="tab-stale">
            Stale Records {summary && summary.counts.stale_leads + summary.counts.contacts_no_account > 0 &&
              <Badge variant="outline" className="ml-1 text-[10px] px-1">
                {summary.counts.stale_leads + summary.counts.contacts_no_account}
              </Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview"       className="mt-4">{summary ? <OverviewTab summary={summary} onNavigate={navigate} /> : <Skeleton className="h-40" />}</TabsContent>
        <TabsContent value="duplicates"     className="mt-4"><DuplicatesTab subFilter={activeTab === "duplicates" ? subFilter : undefined} /></TabsContent>
        <TabsContent value="missing_owner"  className="mt-4"><MissingOwnerTab subFilter={activeTab === "missing_owner" ? subFilter : undefined} /></TabsContent>
        <TabsContent value="missing_fields" className="mt-4"><MissingFieldsTab subFilter={activeTab === "missing_fields" ? subFilter : undefined} /></TabsContent>
        <TabsContent value="orphans"        className="mt-4"><OrphansTab subFilter={activeTab === "orphans" ? subFilter : undefined} /></TabsContent>
        <TabsContent value="stale"          className="mt-4"><StaleTab /></TabsContent>
      </Tabs>
    </div>
  );
}
