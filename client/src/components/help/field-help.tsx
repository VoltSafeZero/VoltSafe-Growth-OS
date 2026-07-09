import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getHelpContent, type HelpEntry } from "@/lib/help-content";
import { InfoIcon } from "@/components/icons/info-icon";

interface CurrentUserLite {
  id?: number;
  email?: string;
  permissions?: Record<string, string>;
}

export type HelpPlacement = "top" | "right" | "bottom" | "left";

export interface FieldHelpProps {
  /** Key into the centralized HELP_CONTENT registry, e.g. "capital.weightedPipeline". */
  helpKey: string;
  /** Overrides the registry title, if provided. */
  title?: string;
  /** Overrides the registry short description, if provided. */
  shortDescription?: string;
  detailedDescription?: string;
  placement?: HelpPlacement;
  /** Module name shown in the popover footer, e.g. "Capital". Defaults to the registry entry's module. */
  moduleName?: string;
  ariaLabel?: string;
  className?: string;
  /** Renders as a modal-style dialog instead of an inline popover. Reserved for future use. */
  permissionScope?: string;
}

function logHelpOpened(entry: HelpEntry, helpKey: string, moduleName?: string) {
  try {
    const payload = {
      helpKey,
      moduleName: moduleName ?? entry.module,
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
      sourceComponent: "FieldHelp",
      timestamp: new Date().toISOString(),
    };
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[cms_help_opened]", payload);
    }
    // Best-effort client analytics event; safe no-op if endpoint is absent.
    fetch("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventName: "cms_help_opened", ...payload }),
      credentials: "include",
    }).catch(() => {});
  } catch {
    // Never let analytics break the help UI.
  }
}

/**
 * Global, reusable "i" info icon + popover for field/button/metric help across
 * VoltSafe CMS. Content is pulled from the centralized help-content registry
 * by `helpKey`; missing keys fall back to a safe generic message instead of
 * crashing the page. See client/src/lib/help-content.ts.
 */
export function FieldHelp({
  helpKey,
  title,
  shortDescription,
  detailedDescription,
  placement = "top",
  moduleName,
  ariaLabel,
  className,
}: FieldHelpProps) {
  const [open, setOpen] = useState(false);

  const { data: currentUser } = useQuery<CurrentUserLite>({
    queryKey: ["/api/auth/me"],
    staleTime: 5 * 60 * 1000,
  });

  const entry = getHelpContent(helpKey, currentUser?.email);
  const resolvedTitle = title ?? entry.title;
  const resolvedShort = shortDescription ?? entry.shortDescription;
  const resolvedDetail = detailedDescription ?? entry.detailedDescription;
  const resolvedModule = moduleName ?? entry.module;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) logHelpOpened(entry, helpKey, moduleName);
    },
    [entry, helpKey, moduleName]
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`help-icon-${helpKey}`}
          aria-label={ariaLabel ?? `Help: ${resolvedTitle}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          className={cn(
            "inline-flex h-3.5 w-3.5 items-center justify-center text-muted-foreground/60 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 rounded-sm transition-colors shrink-0 align-middle select-none",
            className
          )}
        >
          <InfoIcon size={14} className="pointer-events-none" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={placement}
        data-testid={`help-popover-${helpKey}`}
        className="w-72 text-sm max-w-[calc(100vw-2rem)]"
        onEscapeKeyDown={() => setOpen(false)}
      >
        <div className="space-y-1.5">
          <p className="font-semibold text-foreground">{resolvedTitle}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">{resolvedShort}</p>
          {resolvedDetail && (
            <p className="text-muted-foreground text-xs leading-relaxed">{resolvedDetail}</p>
          )}
          {entry.valueNature && entry.valueNature !== "real" && (
            <p className="text-[10px] uppercase tracking-wide text-primary/80 font-medium pt-0.5">
              {entry.valueNature === "sample" && "Sample data"}
              {entry.valueNature === "draft" && "Draft"}
              {entry.valueNature === "synced" && "Synced"}
              {entry.valueNature === "ai-generated" && "AI-generated"}
              {entry.valueNature === "system-generated" && "System-generated"}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/60 pt-1">{resolvedModule}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default FieldHelp;
