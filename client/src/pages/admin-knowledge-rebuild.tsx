import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CmsBreadcrumb } from "@/components/shared/cms-breadcrumb";
import {
  Database, RefreshCw, CheckCircle2, XCircle, Clock,
  AlertTriangle, Loader2, Copy, ArrowRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

type RebuildStatus = "pending" | "rebuilding" | "succeeded" | "failed" | "stale";

type KnowledgeRebuildStatus = {
  currentDeploymentId: string;
  lastSuccessfullyIndexedDeploymentId: string | null;
  rebuildStatus: RebuildStatus;
  rebuildStartedAt: string | null;
  rebuildCompletedAt: string | null;
  lastError: string | null;
  retryCount: number;
  isCurrentDeploymentIndexed: boolean;
  deploymentIdSource: string;
  bootTime: string;
  updatedAt: string;
};

function StatusBadge({ status }: { status: RebuildStatus }) {
  const variants: Record<RebuildStatus, { label: string; className: string; icon: React.ReactNode }> = {
    succeeded: {
      label: "Current",
      className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    rebuilding: {
      label: "Rebuilding",
      className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    failed: {
      label: "Failed",
      className: "bg-red-500/15 text-red-400 border-red-500/30",
      icon: <XCircle className="w-3 h-3" />,
    },
    stale: {
      label: "Stale",
      className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    pending: {
      label: "Pending",
      className: "bg-slate-500/15 text-slate-400 border-slate-500/30",
      icon: <Clock className="w-3 h-3" />,
    },
  };
  const v = variants[status] ?? variants.pending;
  return (
    <Badge
      variant="outline"
      className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 border ${v.className}`}
      data-testid="badge-rebuild-status"
    >
      {v.icon}
      {v.label}
    </Badge>
  );
}

function DeployId({ id, label }: { id: string | null; label: string }) {
  const { toast } = useToast();
  if (!id) return <span className="text-muted-foreground text-xs italic">none</span>;
  const short = id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs text-foreground" aria-label={label}>
      <span data-testid={`text-deploy-id-${label.toLowerCase().replace(/\s+/g, "-")}`}>{short}</span>
      <button
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Copy full ID"
        data-testid={`button-copy-${label.toLowerCase().replace(/\s+/g, "-")}`}
        onClick={() => {
          navigator.clipboard.writeText(id).then(() =>
            toast({ title: "Copied", description: id.slice(0, 40) })
          );
        }}
      >
        <Copy className="w-3 h-3" />
      </button>
    </span>
  );
}

function ts(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium", timeStyle: "short",
  });
}

export default function AdminKnowledgeRebuildPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [triggering, setTriggering] = useState(false);

  const { data: status, isLoading, error, refetch } = useQuery<KnowledgeRebuildStatus>({
    queryKey: ["/api/admin/knowledge-rebuild/status"],
    refetchInterval: (data) =>
      data?.rebuildStatus === "rebuilding" ? 3000 : 15000,
  });

  const triggerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/knowledge-rebuild/trigger"),
    onMutate: () => setTriggering(true),
    onSuccess: () => {
      toast({ title: "Rebuild triggered", description: "Knowledge base rebuild started." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/knowledge-rebuild/status"] });
        setTriggering(false);
      }, 1200);
    },
    onError: (err: any) => {
      setTriggering(false);
      toast({
        title: "Rebuild failed to start",
        description: err?.message || "Server error",
        variant: "destructive",
      });
    },
  });

  const isSynced = status?.isCurrentDeploymentIndexed;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto" data-testid="page-knowledge-rebuild">
      <div>
        <CmsBreadcrumb />
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Database className="w-6 h-6 text-primary" />
          Knowledge Rebuild
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cortex, Learn, Training and Help are rebuilt automatically on every new production deployment.
          Use this panel to monitor status and trigger a manual rebuild.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm" data-testid="loading-rebuild-status">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading rebuild state…
        </div>
      )}

      {error && (
        <div className="text-red-400 text-sm" data-testid="error-rebuild-status">
          Failed to load rebuild status.
        </div>
      )}

      {status && (
        <>
          {/* Status card */}
          <Card className="border-border/50 bg-card/60" data-testid="card-rebuild-overview">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Current state
                </CardTitle>
                <div className="flex items-center gap-2">
                  <StatusBadge status={status.rebuildStatus} />
                  <button
                    onClick={() => refetch()}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Refresh status"
                    data-testid="button-refresh-status"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isSynced && (
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium" data-testid="msg-deployment-synced">
                  <CheckCircle2 className="w-4 h-4" />
                  Cortex knowledge is current for this deployment
                </div>
              )}
              {!isSynced && status.rebuildStatus !== "rebuilding" && (
                <div className="flex items-center gap-2 text-amber-400 text-sm font-medium" data-testid="msg-deployment-stale">
                  <AlertTriangle className="w-4 h-4" />
                  Knowledge base does not match the current deployment
                </div>
              )}
              {status.rebuildStatus === "rebuilding" && (
                <div className="flex items-center gap-2 text-blue-400 text-sm font-medium" data-testid="msg-deployment-rebuilding">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Rebuild in progress…
                </div>
              )}

              <Separator className="bg-border/40" />

              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Current deployment ID</p>
                  <DeployId id={status.currentDeploymentId} label="current" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Indexed deployment ID</p>
                  <DeployId id={status.lastSuccessfullyIndexedDeploymentId} label="indexed" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">ID source</p>
                  <span className="text-xs text-foreground" data-testid="text-id-source">{status.deploymentIdSource}</span>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Retry count</p>
                  <span className="text-xs text-foreground" data-testid="text-retry-count">{status.retryCount}</span>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Rebuild started</p>
                  <span className="text-xs text-foreground" data-testid="text-rebuild-started">{ts(status.rebuildStartedAt)}</span>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Rebuild completed</p>
                  <span className="text-xs text-foreground" data-testid="text-rebuild-completed">{ts(status.rebuildCompletedAt)}</span>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Boot time</p>
                  <span className="text-xs text-foreground" data-testid="text-boot-time">{ts(status.bootTime)}</span>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">State updated</p>
                  <span className="text-xs text-foreground" data-testid="text-state-updated">{ts(status.updatedAt)}</span>
                </div>
              </div>

              {status.lastError && (
                <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 p-3" data-testid="card-last-error">
                  <p className="text-xs font-semibold text-red-400 mb-1">Last error</p>
                  <p className="text-xs text-red-300 font-mono break-all">{status.lastError}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* How it works */}
          <Card className="border-border/40 bg-card/40" data-testid="card-rebuild-explainer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                How it works
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm text-muted-foreground list-none">
                {[
                  "Every production deploy sets a unique REPLIT_DEPLOYMENT_ID.",
                  "On startup, the app compares that ID against the last successfully indexed ID.",
                  "If they differ, or the last rebuild failed, a full knowledge rebuild runs automatically.",
                  "If they match and the rebuild succeeded, startup is instant — no duplicate rebuild.",
                  "A midnight reconciliation runs as backup, checking IDs again and rebuilding only if needed.",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="text-xs font-mono text-primary/60 mt-0.5 w-4 shrink-0">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground/60">
                <span className="font-mono px-1.5 py-0.5 rounded bg-muted/40">REPLIT_DEPLOYMENT_ID</span>
                <ArrowRight className="w-3 h-3" />
                <span className="font-mono px-1.5 py-0.5 rounded bg-muted/40">git SHA</span>
                <ArrowRight className="w-3 h-3" />
                <span className="font-mono px-1.5 py-0.5 rounded bg-muted/40">dev-local</span>
              </div>
            </CardContent>
          </Card>

          {/* Manual trigger */}
          <Card className="border-border/40 bg-card/40" data-testid="card-manual-trigger">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Manual rebuild
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Force a full knowledge rebuild right now. Useful after manually editing docs or
                when the automated rebuild failed.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={triggering || status.rebuildStatus === "rebuilding" || triggerMutation.isPending}
                onClick={() => triggerMutation.mutate()}
                className="shrink-0 flex items-center gap-1.5"
                data-testid="button-rebuild-now"
              >
                {(triggering || triggerMutation.isPending) ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Rebuild now
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
