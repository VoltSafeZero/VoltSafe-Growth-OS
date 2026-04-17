import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Mail, Shield, RefreshCw, Plus, Trash2, Eye, EyeOff,
  Building2, AlertTriangle, CheckCircle2, Clock, Loader2,
  Calendar, Database, Users, Lock, Activity, Info, RotateCcw,
} from "lucide-react";
import { SiGmail } from "react-icons/si";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Multi-mailbox Phase 2: enriched per-account health snapshot from /api/gmail/accounts/health.
// Purely read-only / additive. Used to render status dots, watch/webhook freshness,
// unread counts, and to gate the "Reconnect" CTA for unhealthy accounts.
type AccountHealth = {
  id: number;
  emailAddress: string;
  displayName: string | null;
  isShared: boolean;
  isOwner: boolean;
  authStatus: string;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  watchExpirationAt: string | null;
  lastWebhookAt: string | null;
  unreadCount: number;
  messageCount: number;
  lastMessageAt: string | null;
  watchHoursRemaining: number | null;
  lastWebhookMinAgo: number | null;
  syncErrorMessage: string | null;
  status: "green" | "amber" | "red";
};

function statusDotClass(s: "green" | "amber" | "red") {
  return s === "green" ? "bg-emerald-500"
       : s === "amber" ? "bg-amber-500"
       : "bg-red-500";
}

function formatRel(min: number | null): string {
  if (min == null) return "—";
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

type Mailbox = {
  id: number;
  emailAddress: string;
  displayName: string | null;
  provider: string;
  authStatus: string;
  isShared: boolean;
  privacyMode: string;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  syncErrorMessage: string | null;
  createdAt: string;
};

type BackfillJob = {
  id: number;
  emailAccountId: number;
  emailAddress: string;
  status: string;
  dateFrom: string | null;
  dateTo: string | null;
  processed: number;
  totalEstimate: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type TeamMailbox = {
  id: number;
  emailAddress: string;
  displayName: string | null;
  provider: string;
  authStatus: string;
  isShared: boolean;
  privacyMode: string;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  ownerName: string;
  userId: number;
  backfillCount: number;
};

const PRIVACY_LABELS: Record<string, { label: string; icon: any; desc: string; color: string }> = {
  private:          { label: "Private",           icon: Lock,    desc: "Only you can see this mailbox's contents", color: "text-red-400" },
  metadata_only:    { label: "Metadata Only",      icon: EyeOff,  desc: "Team sees sender/subject, not full content", color: "text-amber-400" },
  business_visible: { label: "Business Visible",   icon: Eye,     desc: "All team members can access business emails", color: "text-emerald-400" },
};

function statusBadge(status: string) {
  if (status === "active") return <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Active</Badge>;
  if (status === "expired") return <Badge className="text-[10px] bg-amber-500/15 text-amber-400 border-amber-500/30">Token Expired</Badge>;
  if (status === "revoked") return <Badge className="text-[10px] bg-red-500/15 text-red-400 border-red-500/30">Disconnected</Badge>;
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

function jobStatusBadge(status: string) {
  if (status === "completed") return <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Done</Badge>;
  if (status === "running")   return <Badge className="text-[10px] bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse">Running</Badge>;
  if (status === "failed")    return <Badge className="text-[10px] bg-red-500/15 text-red-400 border-red-500/30">Failed</Badge>;
  if (status === "pending")   return <Badge className="text-[10px] bg-muted text-muted-foreground border-border/40">Pending</Badge>;
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

// ── Backfill Panel ────────────────────────────────────────────────────────────
function BackfillPanel({ mailboxId, emailAddress }: { mailboxId: number; emailAddress: string }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: jobs = [], isLoading } = useQuery<BackfillJob[]>({
    queryKey: ["/api/my/mailbox/backfill/status"],
    refetchInterval: 5000,
  });

  const myJobs = jobs.filter(j => j.emailAccountId === mailboxId);
  const activeJob = myJobs.find(j => j.status === "running" || j.status === "pending");

  const start = useMutation({
    mutationFn: () => apiRequest("POST", `/api/my/mailbox/${mailboxId}/backfill`, {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    onSuccess: () => {
      toast({ title: "Backfill started", description: `Importing historical emails from ${emailAddress}` });
      qc.invalidateQueries({ queryKey: ["/api/my/mailbox/backfill/status"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3 pt-3 border-t border-border/40">
      <div className="flex items-center gap-2">
        <Database className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Historical Backfill</span>
      </div>

      {activeJob ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Processing…</span>
            <span className="tabular-nums font-medium">{activeJob.processed.toLocaleString()} emails</span>
          </div>
          <Progress value={activeJob.totalEstimate ? (activeJob.processed / activeJob.totalEstimate) * 100 : undefined} className="h-1.5" />
          <p className="text-[11px] text-muted-foreground">Backfill is running. This page auto-refreshes.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">From date (optional)</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="h-7 text-xs mt-0.5" data-testid="input-backfill-from" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">To date (optional)</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="h-7 text-xs mt-0.5" data-testid="input-backfill-to" />
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs w-full gap-1.5"
            disabled={start.isPending}
            onClick={() => start.mutate()}
            data-testid={`btn-start-backfill-${mailboxId}`}>
            {start.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {start.isPending ? "Starting…" : "Start Backfill"}
          </Button>
          <p className="text-[11px] text-muted-foreground">Leave dates empty to import all available history.</p>
        </div>
      )}

      {/* Recent jobs */}
      {myJobs.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recent Jobs</span>
          {myJobs.slice(0, 5).map(job => (
            <div key={job.id} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-muted/30">
              <div className="flex items-center gap-1.5">
                {jobStatusBadge(job.status)}
                <span className="text-muted-foreground">
                  {job.dateFrom ? `${job.dateFrom} → ${job.dateTo || "now"}` : "All history"}
                </span>
              </div>
              <span className="text-muted-foreground tabular-nums">{job.processed.toLocaleString()} msgs</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Mailbox Card ──────────────────────────────────────────────────────────────
function MailboxCard({ mailbox, health, showBackfill = false }: {
  mailbox: Mailbox;
  health?: AccountHealth;
  showBackfill?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  // Multi-mailbox Phase 2: confirmation modal state for disconnect.
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const privacy = useMutation({
    mutationFn: (privacyMode: string) => apiRequest("PATCH", `/api/my/mailbox/${mailbox.id}/privacy`, { privacyMode }),
    onSuccess: () => {
      toast({ title: "Privacy updated" });
      qc.invalidateQueries({ queryKey: ["/api/my/mailbox"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const disconnect = useMutation({
    // Existing endpoint: revokes auth + clears tokens + flips sync_enabled=false,
    // but PRESERVES all email_messages rows (data is kept on disk for history).
    mutationFn: () => apiRequest("DELETE", `/api/my/mailbox/${mailbox.id}`),
    onSuccess: () => {
      toast({ title: "Mailbox disconnected", description: "Sync stopped. Your historical emails are preserved." });
      qc.invalidateQueries({ queryKey: ["/api/my/mailbox"] });
      qc.invalidateQueries({ queryKey: ["/api/gmail/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/gmail/accounts", "health"] });
      setConfirmingDisconnect(false);
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setConfirmingDisconnect(false);
    },
  });

  // Multi-mailbox Phase 2: launch the OAuth re-consent flow. The connect endpoint upserts
  // by (userId, emailAddress) so re-auth lands on the same row and just refreshes tokens.
  const reconnect = () => { window.location.href = "/api/auth/gmail/connect"; };

  const pm = PRIVACY_LABELS[mailbox.privacyMode] ?? PRIVACY_LABELS.business_visible;
  const PMIcon = pm.icon;
  const needsReconnect = !!health && (health.status === "red" || health.authStatus !== "active");

  return (
    <Card className="border border-border/50" data-testid={`mailbox-card-${mailbox.id}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="relative w-8 h-8 rounded-lg bg-background border border-border/40 flex items-center justify-center shrink-0">
              <SiGmail className="h-4 w-4 text-red-400" />
              {/* Multi-mailbox Phase 2: status dot mirrors the inbox sidebar. */}
              {health && (
                <span
                  title={`Sync status: ${health.status}`}
                  data-testid={`status-dot-${mailbox.id}`}
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${statusDotClass(health.status)}`}
                />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate" data-testid={`text-mailbox-email-${mailbox.id}`}>
                {mailbox.displayName ? `${mailbox.displayName} · ` : ""}{mailbox.emailAddress}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {statusBadge(mailbox.authStatus)}
                <Badge variant="outline" className="text-[10px]">Gmail</Badge>
                {mailbox.isShared && <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400">Shared</Badge>}
                {health && (
                  <span className="text-[10px] text-muted-foreground" data-testid={`text-unread-${mailbox.id}`}>
                    {health.unreadCount.toLocaleString()} unread
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Multi-mailbox Phase 2: Reconnect CTA appears only for unhealthy/revoked accounts. */}
            {needsReconnect && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                onClick={reconnect}
                data-testid={`btn-reconnect-${mailbox.id}`}>
                <RotateCcw className="h-3 w-3" />
                Reconnect
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setExpanded(e => !e)}
              data-testid={`btn-expand-mailbox-${mailbox.id}`}>
              {expanded ? "Less" : "Configure"}
            </Button>
            {!mailbox.isShared && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive"
                onClick={() => setConfirmingDisconnect(true)}
                data-testid={`btn-disconnect-${mailbox.id}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Privacy mode + last sync + (Phase 2) watch / webhook freshness */}
        <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-y-1">
          <div className="flex items-center gap-1.5">
            <PMIcon className={`h-3 w-3 ${pm.color}`} />
            <span>{pm.label}</span>
          </div>
          {(health?.lastSyncAt || mailbox.lastSyncAt) && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>Synced {new Date(health?.lastSyncAt || mailbox.lastSyncAt!).toLocaleString()}</span>
            </div>
          )}
        </div>

        {health && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/30 text-[11px]">
            <div className="space-y-0.5">
              <div className="text-muted-foreground/70 uppercase tracking-wide text-[9px]">Watch expires</div>
              <div className={`font-medium ${health.watchHoursRemaining != null && health.watchHoursRemaining < 24 ? "text-amber-400" : "text-foreground"}`}
                data-testid={`text-watch-${mailbox.id}`}>
                {health.watchHoursRemaining != null ? `${health.watchHoursRemaining}h` : "—"}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-muted-foreground/70 uppercase tracking-wide text-[9px]">Last push</div>
              <div className={`font-medium ${health.lastWebhookMinAgo != null && health.lastWebhookMinAgo > 360 ? "text-amber-400" : "text-foreground"}`}
                data-testid={`text-webhook-${mailbox.id}`}>
                {formatRel(health.lastWebhookMinAgo)}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-muted-foreground/70 uppercase tracking-wide text-[9px]">Messages</div>
              <div className="font-medium tabular-nums" data-testid={`text-msgcount-${mailbox.id}`}>
                {health.messageCount.toLocaleString()}
              </div>
            </div>
          </div>
        )}

        {/* Expanded configuration */}
        {expanded && (
          <div className="space-y-3 pt-2">
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Privacy Mode</Label>
              <Select value={mailbox.privacyMode} onValueChange={v => privacy.mutate(v)}>
                <SelectTrigger className="h-8 text-xs mt-1" data-testid={`select-privacy-${mailbox.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIVACY_LABELS).map(([value, { label, desc }]) => (
                    <SelectItem key={value} value={value}>
                      <div>
                        <div className="font-medium">{label}</div>
                        <div className="text-[10px] text-muted-foreground">{desc}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">{pm.desc}</p>
            </div>

            {showBackfill && mailbox.authStatus === "active" && (
              <BackfillPanel mailboxId={mailbox.id} emailAddress={mailbox.emailAddress} />
            )}
          </div>
        )}

        {(mailbox.syncErrorMessage || health?.syncErrorMessage) && (
          <Alert className="border-red-500/30 bg-red-500/5 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
            <AlertDescription className="text-xs text-red-300">{mailbox.syncErrorMessage || health?.syncErrorMessage}</AlertDescription>
          </Alert>
        )}
      </CardContent>

      {/* Phase 2: confirm-before-disconnect modal. Disconnect only revokes auth + stops sync;
          the underlying email_messages rows are preserved (existing endpoint behavior). */}
      <AlertDialog open={confirmingDisconnect} onOpenChange={setConfirmingDisconnect}>
        <AlertDialogContent data-testid={`dialog-confirm-disconnect-${mailbox.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {mailbox.emailAddress}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revoke access tokens and stop new email from syncing into this account.
              Your existing imported messages stay in the system and remain searchable. You can reconnect this Gmail
              account later — it will land back on the same record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`btn-cancel-disconnect-${mailbox.id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={`btn-confirm-disconnect-${mailbox.id}`}>
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// Multi-mailbox Phase 2: small color-key panel used at the top of the page.
function HealthLegend() {
  return (
    <Card className="border border-border/40 bg-muted/10">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          What the status colors mean
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-muted-foreground">
          <div className="flex items-start gap-2">
            <span className="mt-1 w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <div><span className="text-foreground font-medium">Green:</span> mailbox is connected, sync is active, and Gmail is delivering live updates.</div>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <div><span className="text-foreground font-medium">Amber:</span> connected but the Gmail watch is about to expire or live updates have gone quiet for several hours.</div>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 w-2 h-2 rounded-full bg-red-500 shrink-0" />
            <div><span className="text-foreground font-medium">Red:</span> sync is paused or the account was disconnected — use Reconnect to re-authorize.</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MailboxSettingsPage() {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState(false);

  const { data: myMailboxes = [], isLoading: myLoading } = useQuery<Mailbox[]>({
    queryKey: ["/api/my/mailbox"],
  });

  const { data: teamMailboxes = [], isLoading: teamLoading } = useQuery<TeamMailbox[]>({
    queryKey: ["/api/team/mailboxes"],
  });

  // Multi-mailbox Phase 2: pull live per-account health for status dots / freshness / unread.
  // Single endpoint reuse — no new server work needed.
  const { data: accountsHealth = [] } = useQuery<AccountHealth[]>({
    queryKey: ["/api/gmail/accounts", "health"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/accounts/health", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30000,
  });
  const healthMap = new Map(accountsHealth.map((h) => [h.id, h] as const));

  const { data: warmStats } = useQuery<any>({
    queryKey: ["/api/relationships/graph/stats"],
  });

  const qc = useQueryClient();

  const computeWarmness = useMutation({
    mutationFn: () => apiRequest("POST", "/api/my/mailbox/warmness/compute", {}),
    onSuccess: (data: any) => {
      toast({ title: "Warmness computed", description: `${data.computed} relationship records updated` });
      qc.invalidateQueries({ queryKey: ["/api/relationships/graph/stats"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleConnect = async (shared = false) => {
    setConnecting(true);
    try {
      const res = await apiRequest("GET", `/api/my/mailbox/connect${shared ? "?shared=1" : ""}`);
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setConnecting(false);
    }
  };

  const myPersonal = myMailboxes.filter(m => !m.isShared);
  const teamShared = teamMailboxes.filter(m => m.isShared);

  return (
    <div className="flex-1 overflow-auto bg-background p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" data-testid="page-title-mailbox">
          <Mail className="h-5 w-5 text-primary" />
          Mailbox Connections
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect one or more Gmail accounts to power the unified inbox and keep relationship intelligence fresh.
        </p>
      </div>

      {/* Phase 2: color-key legend */}
      <HealthLegend />

      {/* Relationship health summary */}
      {warmStats?.summary && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Contacts", value: warmStats.summary.total, color: "text-foreground" },
            { label: "🔥 Hot (70+)", value: warmStats.summary.hot, color: "text-orange-400" },
            { label: "Warm (40-69)", value: warmStats.summary.warm, color: "text-amber-400" },
            { label: "Dormant 180d", value: warmStats.summary.dormant_180d, color: "text-muted-foreground" },
          ].map(s => (
            <Card key={s.label} className="border border-border/40">
              <CardContent className="p-3">
                <div className={`text-lg font-bold tabular-nums ${s.color}`}>{Number(s.value ?? 0).toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* My Mailboxes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            My Connected Mailboxes
          </h2>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
            disabled={connecting}
            onClick={() => handleConnect(false)}
            data-testid="btn-connect-personal">
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {myPersonal.length > 0 ? "Connect another Gmail account" : "Connect Gmail"}
          </Button>
        </div>

        {myLoading ? (
          <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : myPersonal.length === 0 ? (
          <Card className="border border-dashed border-border/40">
            <CardContent className="p-8 text-center">
              <SiGmail className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No personal mailbox connected yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Connect your Gmail to start building relationship intelligence.</p>
              <Button size="sm" className="mt-4 gap-1.5" onClick={() => handleConnect(false)}
                disabled={connecting} data-testid="btn-connect-personal-empty">
                <Plus className="h-3.5 w-3.5" /> Connect Gmail Account
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {myPersonal.map(m => <MailboxCard key={m.id} mailbox={m} health={healthMap.get(m.id)} showBackfill />)}
          </div>
        )}
      </div>

      <Separator />

      {/* Team / Shared Mailboxes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Team Mailboxes
            <Badge variant="outline" className="text-[10px]">{teamShared.length}</Badge>
          </h2>
        </div>

        {teamLoading ? (
          <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : teamShared.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shared team mailboxes connected. Admins can connect shared inboxes.</p>
        ) : (
          <div className="space-y-2">
            {teamShared.map(m => {
              // Phase 2: enrich team rows with the same health dot + freshness summary as
              // personal cards. Disconnect/Reconnect remain owner-only (handled in MailboxCard).
              const h = healthMap.get(m.id);
              return (
                <div key={m.id} className="flex items-center justify-between py-2.5 px-4 rounded-lg border border-border/40 bg-muted/20"
                  data-testid={`team-mailbox-${m.id}`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <SiGmail className="h-4 w-4 text-red-400" />
                      {h && (
                        <span
                          title={`Sync status: ${h.status}`}
                          data-testid={`status-dot-team-${m.id}`}
                          className={`absolute -bottom-1 -right-1 w-2 h-2 rounded-full border border-background ${statusDotClass(h.status)}`}
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{m.displayName ? `${m.displayName} · ` : ""}{m.emailAddress}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        Owner: {m.ownerName}
                        {h && (
                          <>
                            <span className="mx-1.5">·</span>
                            {h.unreadCount.toLocaleString()} unread
                            <span className="mx-1.5">·</span>
                            watch {h.watchHoursRemaining != null ? `${h.watchHoursRemaining}h` : "—"}
                            <span className="mx-1.5">·</span>
                            push {formatRel(h.lastWebhookMinAgo)}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {statusBadge(m.authStatus)}
                    <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400">Shared</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Separator />

      {/* Warmness compute */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          Relationship Intelligence
        </h2>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/20">
          <div>
            <p className="text-sm font-medium">Recompute Warmness Scores</p>
            <p className="text-xs text-muted-foreground mt-0.5">Recalculate relationship warmness based on email history.</p>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 shrink-0"
            disabled={computeWarmness.isPending}
            onClick={() => computeWarmness.mutate()}
            data-testid="btn-compute-warmness">
            {computeWarmness.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {computeWarmness.isPending ? "Computing…" : "Recompute"}
          </Button>
        </div>

        {warmStats?.domains?.length > 0 && (
          <Card className="border border-border/40">
            <CardHeader className="py-2.5 px-4 border-b border-border/30">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top Domains</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {warmStats.domains.map((d: any) => (
                <div key={d.domain} className="flex items-center justify-between py-2 px-4 border-b border-border/20 last:border-0"
                  data-testid={`domain-row-${d.domain}`}>
                  <div>
                    <span className="text-sm font-medium">{d.domain}</span>
                    <span className="text-xs text-muted-foreground ml-2">{d.contacts} contacts</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Avg score</span>
                    <span className={`text-sm font-semibold tabular-nums ${Number(d.avg_score) >= 70 ? "text-orange-400" : Number(d.avg_score) >= 40 ? "text-amber-400" : "text-muted-foreground"}`}>
                      {Number(d.avg_score).toFixed(0)}
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
