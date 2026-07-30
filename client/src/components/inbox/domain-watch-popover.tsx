/**
 * DomainWatchPopover
 *
 * Confirmation dialog for the in-email "Always ingest this domain into Cortex"
 * action.  Handles three states automatically:
 *   • new domain   — shows create form (label, notes, future-only checkbox)
 *   • already enabled — shows status message + Manage link
 *   • exists but disabled — offers re-enable with one click
 *
 * Roles allowed: master_admin, admin, exec, manager.
 * canManage=false shows a permission message instead of the form.
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Globe,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface DomainWatchRule {
  id: number;
  domain: string;
  label?: string | null;
  notes?: string | null;
  is_active: boolean;
  match_count: number;
  last_matched_at?: string | null;
}

interface DomainWatchCheckResponse {
  watched: boolean;
  active: boolean;
  rule: DomainWatchRule | null;
}

export interface DomainWatchPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The normalised sender domain (e.g. "oceansupercluster.ca"). */
  senderDomain: string;
  /** True when the current user has permission to manage ingestion rules. */
  canManage: boolean;
  /** Optional callback to navigate to the full Domain Watch management screen. */
  onNavigateManage?: () => void;
}

export function DomainWatchPopover({
  open,
  onOpenChange,
  senderDomain,
  canManage,
  onNavigateManage,
}: DomainWatchPopoverProps) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) { setLabel(""); setNotes(""); }
  }, [open, senderDomain]);

  const checkKey = ["/api/cortex/auto-ingest-domains/check", senderDomain];

  const { data: checkData, isLoading: isChecking } = useQuery<DomainWatchCheckResponse>({
    queryKey: checkKey,
    queryFn: () =>
      fetch(`/api/cortex/auto-ingest-domains/check?domain=${encodeURIComponent(senderDomain)}`, {
        credentials: "include",
      }).then(r => r.json()),
    enabled: open && !!senderDomain && canManage,
    staleTime: 0,
  });

  const existingRule = checkData?.rule ?? null;
  const isWatchedActive = !!(checkData?.watched && checkData?.active);
  const isWatchedDisabled = !!(checkData?.watched && !checkData?.active);

  const invalidateAfter = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/cortex/auto-ingest-domains"] });
    queryClient.invalidateQueries({ queryKey: checkKey });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/cortex/auto-ingest-domains", {
        domain: senderDomain,
        label: label.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (data: any) => {
      const ruleId: number | undefined = data?.domain?.id;
      invalidateAfter();
      onOpenChange(false);
      toast({
        title: `Cortex will now automatically ingest future emails from ${senderDomain}.`,
        action: ruleId ? (
          <ToastAction
            altText="Undo"
            onClick={async () => {
              try {
                await apiRequest("PATCH", `/api/cortex/auto-ingest-domains/${ruleId}`, { is_active: false });
                invalidateAfter();
                toast({ title: `Ingestion for ${senderDomain} paused.` });
              } catch { /* ignore */ }
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create rule", description: err.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const reenableMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/cortex/auto-ingest-domains/${existingRule!.id}`, { is_active: true }),
    onSuccess: () => {
      const ruleId = existingRule?.id;
      invalidateAfter();
      onOpenChange(false);
      toast({
        title: `Cortex will now automatically ingest future emails from ${senderDomain}.`,
        action: ruleId ? (
          <ToastAction
            altText="Undo"
            onClick={async () => {
              try {
                await apiRequest("PATCH", `/api/cortex/auto-ingest-domains/${ruleId}`, { is_active: false });
                invalidateAfter();
                toast({ title: `Ingestion for ${senderDomain} paused.` });
              } catch { /* ignore */ }
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to re-enable rule", description: err.message ?? "Unknown error", variant: "destructive" });
    },
  });

  if (!canManage) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4 text-cyan-400" aria-hidden="true" />
              Cortex Domain Watch
            </DialogTitle>
            <DialogDescription className="sr-only">
              Permission required to manage Cortex ingestion rules
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            You need admin, exec, or manager access to create Cortex ingestion rules.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-domain-watch">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-cyan-400" aria-hidden="true" />
            Always Ingest This Domain
          </DialogTitle>
          <DialogDescription className="sr-only">
            Create or manage a Cortex ingestion rule for {senderDomain}
          </DialogDescription>
        </DialogHeader>

        {isChecking ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground" data-testid="domain-watch-loading">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Checking…</span>
          </div>
        ) : isWatchedActive ? (
          <div className="space-y-3 py-1" data-testid="domain-watch-already-enabled">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-cyan-500/8 border border-cyan-500/20">
              <CheckCircle2 className="h-4 w-4 text-cyan-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-cyan-400">
                  Cortex is already watching {senderDomain}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Future inbound emails from this domain are automatically ingested into VoltSafe Cortex.
                  {existingRule?.match_count ? ` ${existingRule.match_count} email${existingRule.match_count !== 1 ? "s" : ""} ingested so far.` : ""}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {onNavigateManage && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="btn-domain-watch-manage"
                  onClick={() => { onOpenChange(false); onNavigateManage(); }}
                >
                  Manage Rule
                </Button>
              )}
              <Button size="sm" onClick={() => onOpenChange(false)} data-testid="btn-domain-watch-done">
                Done
              </Button>
            </div>
          </div>
        ) : isWatchedDisabled ? (
          <div className="space-y-3 py-1" data-testid="domain-watch-reenable">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20">
              <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-amber-400">
                  Cortex ingestion for {senderDomain} is currently paused
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  A rule exists but is disabled. Re-enable it to resume automatic ingestion.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={reenableMutation.isPending}
                data-testid="btn-domain-watch-cancel-reenable"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => reenableMutation.mutate()}
                disabled={reenableMutation.isPending}
                data-testid="btn-reenable-domain-watch"
                aria-label={`Re-enable Cortex ingestion for ${senderDomain}`}
              >
                {reenableMutation.isPending ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-1" />Enabling…</>
                ) : (
                  `Re-enable for ${senderDomain}`
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-1" data-testid="domain-watch-create-form">
            <p className="text-sm text-muted-foreground leading-relaxed">
              All future inbound emails from this domain will be automatically ingested into VoltSafe Cortex.
            </p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border/30">
              <Globe className="h-3.5 w-3.5 text-cyan-400 flex-shrink-0" aria-hidden="true" />
              <span
                className="text-sm font-mono font-medium text-foreground"
                data-testid="domain-watch-domain-value"
              >
                {senderDomain}
              </span>
              <Badge variant="secondary" className="ml-auto text-[10px]">domain</Badge>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="dw-label" className="text-xs">
                  Label <span className="text-muted-foreground/70">(optional)</span>
                </Label>
                <Input
                  id="dw-label"
                  placeholder="e.g. Ocean Supercluster"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  data-testid="input-domain-watch-label"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dw-notes" className="text-xs">
                  Notes <span className="text-muted-foreground/70">(optional)</span>
                </Label>
                <Textarea
                  id="dw-notes"
                  placeholder="Why this domain is important…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  data-testid="input-domain-watch-notes"
                  className="h-20 text-sm resize-none"
                />
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <Checkbox
                  id="dw-future-only"
                  checked
                  disabled
                  aria-label="Future emails only — historical backfill is not performed"
                  data-testid="checkbox-future-only"
                />
                <Label htmlFor="dw-future-only" className="text-xs text-muted-foreground cursor-default">
                  Future emails only (no historical backfill)
                </Label>
              </div>
            </div>
            <DialogFooter className="gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={createMutation.isPending}
                data-testid="btn-cancel-domain-watch"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !senderDomain}
                data-testid="btn-confirm-domain-watch"
                aria-label={`Always ingest future emails from ${senderDomain} into Cortex`}
              >
                {createMutation.isPending ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-1" />Creating…</>
                ) : (
                  "Always Ingest"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
