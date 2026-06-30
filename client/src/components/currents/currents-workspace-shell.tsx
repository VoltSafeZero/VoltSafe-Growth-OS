/**
 * CurrentsWorkspaceShell
 *
 * Theme-neutral wrapper for the CURRENTS page.
 *
 * Phase 5C: the custom waterflow/dark backdrop has been removed from the
 * active render path so CURRENTS uses the same light/dark surfaces as the
 * rest of VoltSafe CMS. The shell is now a simple passthrough container:
 *   • No custom background, overlay, or animation.
 *   • No z-index stacking (nothing to stack above).
 *   • Children render directly on the normal app background.
 *   • `data-testid` preserved for regression tests.
 *
 * The CurrentsWaterflowBackdrop component file is retained in the repo so
 * it can be re-introduced for opt-in visual experiments, but it is NOT
 * imported or rendered here.
 */

interface CurrentsWorkspaceShellProps {
  children: React.ReactNode;
}

export function CurrentsWorkspaceShell({ children }: CurrentsWorkspaceShellProps) {
  return (
    <div
      className="flex flex-col w-full h-full min-h-0 overflow-hidden"
      data-testid="currents-workspace-shell"
    >
      {children}
    </div>
  );
}
