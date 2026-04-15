import { useState } from "react";
import { Loader2, X, CheckCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface BulkAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  confirmText?: (count: number) => string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
  isPending?: boolean;
  requiresPermission?: boolean;
  testId?: string;
}

interface BulkActionsBarProps {
  selectedCount: number;
  totalCount?: number;
  onSelectAll?: () => void;
  onClearSelection: () => void;
  actions: BulkAction[];
  entityLabel?: string;
  className?: string;
}

export function BulkActionsBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  actions,
  entityLabel = "item",
  className = "",
}: BulkActionsBarProps) {
  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  if (selectedCount === 0) return null;

  const handleActionClick = (action: BulkAction) => {
    if (action.disabled || action.requiresPermission === false) return;
    if (action.confirmText) {
      setPendingAction(action);
    } else {
      runAction(action);
    }
  };

  const runAction = async (action: BulkAction) => {
    setPendingAction(null);
    setIsRunning(true);
    try {
      await action.onClick();
    } finally {
      setIsRunning(false);
    }
  };

  const visibleActions = actions.filter(a => a.requiresPermission !== false);

  return (
    <>
      <div
        className={`flex items-center gap-1.5 px-3 py-2 bg-background/98 backdrop-blur border-b border-primary/20 border-l-[3px] border-l-primary/40 ${className}`}
        data-testid="bulk-actions-bar"
      >
        {/* Selected count */}
        <span
          className="text-[11px] font-semibold text-foreground/70 shrink-0 mr-0.5 tabular-nums"
          data-testid="bulk-selected-count"
        >
          {selectedCount} selected
        </span>

        {/* Action buttons */}
        {visibleActions.map(action => (
          <button
            key={action.key}
            onClick={() => handleActionClick(action)}
            disabled={action.disabled || action.isPending || isRunning}
            data-testid={action.testId ?? `bulk-action-${action.key}`}
            title={action.confirmText ? action.confirmText(selectedCount) : action.label}
            className={`flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 min-h-[32px] ${
              action.destructive
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "bg-primary/10 text-primary/80 hover:bg-primary/20"
            }`}
          >
            {(action.isPending || isRunning) ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              action.icon
            )}
            <span className="hidden sm:inline">{action.label}</span>
          </button>
        ))}

        {/* Spacer + select all + clear */}
        <div className="flex items-center gap-1 ml-auto">
          {onSelectAll && totalCount !== undefined && selectedCount < totalCount && (
            <button
              onClick={onSelectAll}
              data-testid="bulk-select-all"
              className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors px-2 py-1.5 min-h-[32px]"
            >
              All {totalCount}
            </button>
          )}
          <button
            onClick={onClearSelection}
            data-testid="bulk-clear-selection"
            title="Clear selection"
            className="p-1.5 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={!!pendingAction} onOpenChange={open => !open && setPendingAction(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className={pendingAction?.destructive ? "text-destructive" : ""}>
              {pendingAction?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              {pendingAction?.confirmText?.(selectedCount)}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setPendingAction(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={pendingAction?.destructive ? "destructive" : "default"}
              onClick={() => pendingAction && runAction(pendingAction)}
              data-testid="bulk-confirm-button"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Inline select-all checkbox helper ─────────────────────────────────────
interface BulkCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  testId?: string;
}

export function BulkCheckbox({ checked, indeterminate, onChange, testId }: BulkCheckboxProps) {
  return (
    <div
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      onClick={e => { e.stopPropagation(); onChange(); }}
      data-testid={testId}
      className={`h-3.5 w-3.5 rounded border flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors ${
        checked || indeterminate
          ? "bg-primary border-primary"
          : "border-border/50 hover:border-primary/60"
      }`}
    >
      {indeterminate && !checked && (
        <div className="h-0.5 w-2 bg-white rounded-full" />
      )}
      {checked && <CheckCheck className="h-2.5 w-2.5 text-primary-foreground" />}
    </div>
  );
}
