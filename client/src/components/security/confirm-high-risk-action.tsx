import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, ShieldAlert, Skull } from "lucide-react";
import { cn } from "@/lib/utils";

export type RiskLevel = "medium" | "high" | "critical";

export interface ConfirmHighRiskActionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  confirmButtonLabel?: string;
  cancelButtonLabel?: string;
  confirmationText?: string;
  warningCopy?: string;
  irreversible?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}

const RISK_CONFIG: Record<
  RiskLevel,
  { icon: React.ElementType; iconClass: string; badgeClass: string; label: string }
> = {
  medium: {
    icon: AlertTriangle,
    iconClass: "text-yellow-400",
    badgeClass: "bg-yellow-400/10 text-yellow-400 border border-yellow-400/20",
    label: "Medium Risk",
  },
  high: {
    icon: ShieldAlert,
    iconClass: "text-orange-400",
    badgeClass: "bg-orange-400/10 text-orange-400 border border-orange-400/20",
    label: "High Risk",
  },
  critical: {
    icon: Skull,
    iconClass: "text-red-400",
    badgeClass: "bg-red-400/10 text-red-400 border border-red-400/20",
    label: "Critical",
  },
};

export function ConfirmHighRiskAction({
  open,
  onOpenChange,
  title,
  description,
  riskLevel,
  confirmButtonLabel = "Confirm",
  cancelButtonLabel = "Cancel",
  confirmationText,
  warningCopy,
  irreversible = false,
  loading = false,
  onConfirm,
}: ConfirmHighRiskActionProps) {
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const config = RISK_CONFIG[riskLevel];
  const Icon = config.icon;

  const requiresTyping = Boolean(confirmationText);
  const canConfirm = requiresTyping
    ? typedConfirmation === confirmationText
    : true;

  function handleConfirm() {
    if (!canConfirm || loading) return;
    onConfirm();
  }

  function handleOpenChange(next: boolean) {
    if (!next) setTypedConfirmation("");
    onOpenChange(next);
  }

  const confirmButtonVariant =
    riskLevel === "critical"
      ? "destructive"
      : riskLevel === "high"
      ? "destructive"
      : "default";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md"
        data-testid="confirm-high-risk-dialog"
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                config.badgeClass
              )}
              data-testid="risk-level-badge"
            >
              <Icon className={cn("h-3 w-3", config.iconClass)} />
              {config.label}
            </span>
          </div>
          <DialogTitle
            className="text-base font-semibold"
            data-testid="confirm-dialog-title"
          >
            {title}
          </DialogTitle>
          <DialogDescription
            className="text-sm text-muted-foreground"
            data-testid="confirm-dialog-description"
          >
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {(warningCopy || irreversible) && (
            <div className="rounded-md border border-orange-400/20 bg-orange-400/5 px-3 py-2.5 text-sm text-orange-300">
              {warningCopy && <p>{warningCopy}</p>}
              {irreversible && (
                <p className={cn(warningCopy && "mt-1")}>
                  This action cannot be undone.
                </p>
              )}
            </div>
          )}

          {requiresTyping && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Type{" "}
                <span className="font-mono font-semibold text-foreground">
                  {confirmationText}
                </span>{" "}
                to confirm.
              </p>
              <Input
                data-testid="confirm-text-input"
                placeholder={confirmationText}
                value={typedConfirmation}
                onChange={(e) => setTypedConfirmation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canConfirm) handleConfirm();
                }}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-sm"
              />
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
            data-testid="confirm-cancel-button"
          >
            {cancelButtonLabel}
          </Button>
          <Button
            variant={confirmButtonVariant}
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            data-testid="confirm-action-button"
          >
            {loading ? "Processing…" : confirmButtonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
