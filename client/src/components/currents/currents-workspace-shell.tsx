/**
 * CurrentsWorkspaceShell
 *
 * Thin wrapper that gives the CURRENTS page its dedicated workspace feel:
 *   • Renders the animated waterflow backdrop behind the CURRENTS UI.
 *   • The backdrop is decorative (aria-hidden) and does not block interaction.
 *   • Children render on a relative z-[1] layer so panels remain fully usable.
 *   • No CURRENTS internals are modified.
 */

import { CurrentsWaterflowBackdrop } from "./currents-waterflow-backdrop";

interface CurrentsWorkspaceShellProps {
  children: React.ReactNode;
}

export function CurrentsWorkspaceShell({ children }: CurrentsWorkspaceShellProps) {
  return (
    <div
      className="relative flex flex-col w-full h-full min-h-0 overflow-hidden"
      data-testid="currents-workspace-shell"
    >
      <CurrentsWaterflowBackdrop />
      <div className="relative z-[1] flex flex-col w-full h-full min-h-0">
        {children}
      </div>
    </div>
  );
}
