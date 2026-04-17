import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Mail, AlertCircle, CheckCircle2, Clock, Database, Loader2, Radio, Zap, PlayCircle, StopCircle } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

type Mailbox = {
  id: number;
  emailAddress: string;
  authStatus: string;
  isShared: boolean;
  syncEnabled: boolean;
  isActive: boolean;
  hasRefreshToken: boolean;
  hasAccessToken: boolean;
  lastSyncAt: string | null;
  lastHistoryId: string | null;
  syncErrorMessage: string | null;
  stored: { total: number; unread: number; inbox: number; sent: number; oldestAt: string | null; newestAt: string | null };
  live: { emailAddress?: string; messagesTotalLive?: number | null; threadsTotalLive?: number | null; historyIdLive?: string | null; error?: string };
  lastBackfillJob: any | null;
  push?: {
    configured: boolean;
    topic: string | null;
    watchStatus: "active" | "expiring_soon" | "expired" | "not_configured" | "disabled";
    watchExpirationAt: string | null;
    watchHistoryId: string | null;
    lastWebhookAt: string | null;
  };
  incremental?: {
    lastIncrementalSyncAt: string | null;
    eventCount: number;
    hasSeed: boolean;
  };
};
type Health = { userId: number; connectedMailboxes: number; pushConfigured?: boolean; mailboxes: Mailbox[] };

function fmt(n: number | null | undefined) { return n == null ? "—" : Number(n).toLocaleString(); }
function fmtDate(s: string | null | undefined) { if (!s) return "—"; try { const d = new Date(s); return `${format(d, "MMM d, yyyy h:mm a")}`; } catch { return s; } }
function rel(s: string | null | undefined) { if (!s) return ""; try { return `(${formatDistanceToNow(new Date(s), { addSuffix: true })})`; } catch { return ""; } }

export default function MailboxHealthPage() {
  const { toast } = useToast();
  const [pages, setPages] = useState(10);
  const [since, setSince] = useState("");
  const [refreshLabels, setRefreshLabels] = useState(true);

  const { data, isLoading, refetch, isFetching } = useQuery<Health>({
    queryKey: ["/api/gmail/health"],
    refetchInterval: 15000,
  });

  const syncMut = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({ pages: String(pages), pageSize: "100" });
      if (refreshLabels) params.set("refreshLabels", "1");
      if (since) params.set("since", since);
      const res = await apiRequest("POST", `/api/gmail/sync?${params.toString()}`);
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ description: `Sync done — ${r.newMessages} new, ${r.processed} processed across ${r.pages} pages${r.hitPageLimit ? " (more available, run again to continue)" : ""}` });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/health"] });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `Sync failed: ${e.message}` }),
  });

  const incrMut = useMutation({
    mutationFn: async (mb: Mailbox) => {
      const res = await apiRequest("POST", `/api/gmail/sync-incremental?accountId=${mb.id}`);
      return res.json();
    },
    onSuccess: (r: any) => {
      const x = r?.results?.[0];
      if (x) {
        toast({ description: `Incremental sync — events:${x.events} added:${x.added} deleted:${x.deleted} labelsChanged:${x.labelsChanged}${x.fellBack ? " (fell back to paginated)" : ""}` });
      } else {
        toast({ description: "Incremental sync complete" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/health"] });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `Incremental failed: ${e.message}` }),
  });

  const watchStartMut = useMutation({
    mutationFn: async (mb: Mailbox) => {
      const res = await apiRequest("POST", `/api/gmail/watch/start?accountId=${mb.id}`);
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ description: r.ok ? `Watch started — expires ${new Date(r.expirationMs).toLocaleString()}` : `Watch not started: ${r.reason}`, variant: r.ok ? "default" : "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/health"] });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `Watch start failed: ${e.message}` }),
  });

  const watchStopMut = useMutation({
    mutationFn: async (mb: Mailbox) => {
      const res = await apiRequest("POST", `/api/gmail/watch/stop?accountId=${mb.id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ description: "Watch stopped." });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/health"] });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `Watch stop failed: ${e.message}` }),
  });

  const backfillMut = useMutation({
    mutationFn: async (mb: Mailbox) => {
      const body: any = {};
      if (since) body.dateFrom = since;
      const res = await apiRequest("POST", `/api/my/mailbox/${mb.id}/backfill`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ description: "Backfill job started — runs in background, check again in a few minutes." });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/health"] });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `Backfill failed: ${e.message}` }),
  });

  if (isLoading) {
    return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading mailbox health…</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <Mail className="h-6 w-6" /> Mailbox Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Forensic view of every connected mailbox — live Gmail counts vs what we have stored locally.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-health">
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {data?.mailboxes.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No mailboxes connected for your user yet.</CardContent></Card>
      )}

      {data?.mailboxes.map((mb) => {
        const liveTotal = mb.live?.messagesTotalLive ?? null;
        const coverage = liveTotal && liveTotal > 0 ? Math.round((mb.stored.total / liveTotal) * 1000) / 10 : null;
        const okAuth = mb.authStatus === "active" && mb.hasRefreshToken;
        const oldestDays = mb.stored.oldestAt ? Math.floor((Date.now() - new Date(mb.stored.oldestAt).getTime()) / (1000 * 60 * 60 * 24)) : null;

        return (
          <Card key={mb.id} data-testid={`card-mailbox-${mb.id}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span data-testid={`text-mailbox-email-${mb.id}`}>{mb.emailAddress}</span>
                  {okAuth ? (
                    <Badge variant="outline" className="text-emerald-700 border-emerald-300 dark:text-emerald-300 dark:border-emerald-700"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>
                  ) : (
                    <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />{mb.authStatus || "disconnected"}</Badge>
                  )}
                  {mb.isShared && <Badge variant="secondary">Shared</Badge>}
                  {!mb.syncEnabled && <Badge variant="outline">Sync disabled</Badge>}
                </CardTitle>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Last sync: {fmtDate(mb.lastSyncAt)} {rel(mb.lastSyncAt)}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* Stored vs Live */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Stored locally" value={fmt(mb.stored.total)} testId={`stat-stored-${mb.id}`} />
                <Stat label="Live in Gmail" value={fmt(liveTotal)} testId={`stat-live-${mb.id}`} />
                <Stat label="Coverage" value={coverage != null ? `${coverage}%` : "—"} sub={coverage != null && coverage < 50 ? "low" : undefined} testId={`stat-coverage-${mb.id}`} />
                <Stat label="Unread (local)" value={fmt(mb.stored.unread)} testId={`stat-unread-${mb.id}`} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <KV k="Inbox" v={fmt(mb.stored.inbox)} />
                <KV k="Sent" v={fmt(mb.stored.sent)} />
                <KV k="Oldest stored" v={`${fmtDate(mb.stored.oldestAt)}${oldestDays != null ? `  (${oldestDays}d ago)` : ""}`} />
                <KV k="Newest stored" v={fmtDate(mb.stored.newestAt)} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <KV k="Refresh token" v={mb.hasRefreshToken ? "Yes" : "No"} bad={!mb.hasRefreshToken} />
                <KV k="Access token" v={mb.hasAccessToken ? "Yes" : "No"} bad={!mb.hasAccessToken} />
                <KV k="Auth status" v={mb.authStatus} bad={mb.authStatus !== "active"} />
                <KV k="History ID (live)" v={mb.live?.historyIdLive ?? "—"} />
              </div>

              {mb.syncErrorMessage && (
                <div className="text-xs p-2 rounded bg-destructive/10 text-destructive flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div><div className="font-semibold">Last sync error</div><div>{mb.syncErrorMessage}</div></div>
                </div>
              )}

              {mb.live?.error && (
                <div className="text-xs p-2 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div><div className="font-semibold">Live Gmail unreachable</div><div>{mb.live.error}</div></div>
                </div>
              )}

              {/* Phase 2A: Push & Incremental Sync */}
              <div className="border-t pt-4 space-y-3">
                <div className="text-sm font-semibold flex items-center gap-2"><Zap className="h-4 w-4" /> Push & incremental sync</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <KV k="Last historyId (stored)" v={mb.lastHistoryId ?? "—"} />
                  <KV k="Live historyId" v={mb.live?.historyIdLive ?? "—"} />
                  <KV k="Last incremental sync" v={`${fmtDate(mb.incremental?.lastIncrementalSyncAt ?? null)} ${rel(mb.incremental?.lastIncrementalSyncAt ?? null)}`} />
                  <KV k="Incremental events processed" v={fmt(mb.incremental?.eventCount ?? 0)} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <KV k="Push (Pub/Sub)" v={mb.push?.configured ? "Configured" : "Not configured"} bad={!mb.push?.configured} />
                  <KV k="Watch status" v={mb.push?.watchStatus ?? "—"} bad={mb.push?.watchStatus === "expired"} />
                  <KV k="Watch expires" v={`${fmtDate(mb.push?.watchExpirationAt ?? null)} ${rel(mb.push?.watchExpirationAt ?? null)}`} />
                  <KV k="Last webhook received" v={`${fmtDate(mb.push?.lastWebhookAt ?? null)} ${rel(mb.push?.lastWebhookAt ?? null)}`} />
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="default" onClick={() => incrMut.mutate(mb)} disabled={incrMut.isPending} data-testid="button-sync-incremental">
                    {incrMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
                    Sync incremental now
                  </Button>
                  {mb.push?.configured && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => watchStartMut.mutate(mb)} disabled={watchStartMut.isPending} data-testid="button-watch-start">
                        {watchStartMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
                        Start / renew watch
                      </Button>
                      {(mb.push.watchStatus === "active" || mb.push.watchStatus === "expiring_soon") && (
                        <Button size="sm" variant="outline" onClick={() => watchStopMut.mutate(mb)} disabled={watchStopMut.isPending} data-testid="button-watch-stop">
                          {watchStopMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <StopCircle className="h-4 w-4 mr-2" />}
                          Stop watch
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {!mb.push?.configured && (
                  <div className="text-xs p-2 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 flex items-start gap-2">
                    <Radio className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">Real-time push not configured</div>
                      <div>Set <code className="font-mono">GMAIL_PUBSUB_TOPIC</code> and <code className="font-mono">GMAIL_WEBHOOK_TOKEN</code> env vars (with a Google Cloud Pub/Sub topic + push subscription pointing at <code className="font-mono">/api/webhooks/gmail?token=…</code>) to enable sub-second sync. Until then, the system runs historyId-based incremental sync hourly — still much faster and more accurate than re-listing pages.</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sync controls */}
              <div className="border-t pt-4 space-y-3">
                <div className="text-sm font-semibold flex items-center gap-2"><Database className="h-4 w-4" /> Sync controls (paginated fallback)</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="pages" className="text-xs">Pages to walk (100/page)</Label>
                    <Input id="pages" type="number" min={1} max={500} value={pages} onChange={(e) => setPages(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} data-testid="input-pages" />
                  </div>
                  <div>
                    <Label htmlFor="since" className="text-xs">Since (YYYY-MM-DD, optional)</Label>
                    <Input id="since" type="date" value={since} onChange={(e) => setSince(e.target.value)} data-testid="input-since" />
                  </div>
                  <div className="flex items-end">
                    <label className="text-xs flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={refreshLabels} onChange={(e) => setRefreshLabels(e.target.checked)} data-testid="checkbox-refresh-labels" />
                      Refresh read/unread labels on top 200
                    </label>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" onClick={() => syncMut.mutate()} disabled={syncMut.isPending} data-testid="button-sync-now">
                    {syncMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Sync now
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => backfillMut.mutate(mb)} disabled={backfillMut.isPending} data-testid="button-backfill">
                    {backfillMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
                    Start full backfill (background)
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  "Sync now" pages forward up to N pages and (optionally) refreshes read-state for the latest 200 stored. "Full backfill" runs as a background job that paginates everything for the optional date range and is resumable.
                </p>
              </div>

              {mb.lastBackfillJob && (
                <div className="text-xs border-t pt-3">
                  <div className="font-semibold mb-1">Last backfill job</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <KV k="Status" v={mb.lastBackfillJob.status} />
                    <KV k="Processed" v={fmt(mb.lastBackfillJob.processed)} />
                    <KV k="Started" v={fmtDate(mb.lastBackfillJob.created_at)} />
                    <KV k="Completed" v={fmtDate(mb.lastBackfillJob.completed_at)} />
                  </div>
                  {mb.lastBackfillJob.error_message && (
                    <div className="mt-2 text-destructive">Error: {mb.lastBackfillJob.error_message}</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="rounded border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-0.5" data-testid={testId}>{value}</div>
      {sub && <div className="text-[10px] uppercase tracking-wide text-amber-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function KV({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground">{k}</div>
      <div className={`font-medium ${bad ? "text-destructive" : ""}`}>{v}</div>
    </div>
  );
}
