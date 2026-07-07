import { Link, useLocation } from "wouter";
import { ChevronRight } from "lucide-react";
import { PAGE_NAV_INDEX } from "@/lib/nav-config";
import { resolveGroupEntry, GROUPED_LANDING_PAGES } from "@/lib/grouped-pages";

interface CmsBreadcrumbProps {
  // Override the current page name (if auto-detection is not ideal)
  pageName?: string;
  // Override the section (e.g. "Work", "Pipeline")
  sectionOverride?: string;
  className?: string;
}

// Find the canonical page name for a given URL
function pageNameFor(pathname: string): string | null {
  // Check grouped landing pages first
  const hub = GROUPED_LANDING_PAGES.find(p => p.url === pathname);
  if (hub) return hub.name.replace(/ Hub$/, ""); // strip "Hub" suffix on landing pages themselves

  // Check PAGE_NAV_INDEX (longest prefix match)
  let best: { name: string; urlLen: number } | null = null;
  for (const p of PAGE_NAV_INDEX) {
    if (pathname === p.url || pathname.startsWith(p.url + "/")) {
      if (!best || p.url.length > best.urlLen) {
        best = { name: p.name, urlLen: p.url.length };
      }
    }
  }
  return best?.name ?? null;
}

export function CmsBreadcrumb({ pageName, sectionOverride, className = "" }: CmsBreadcrumbProps) {
  const [location] = useLocation();

  const groupEntry = resolveGroupEntry(location);
  const currentName = pageName ?? pageNameFor(location);

  // Determine if we're on a grouped landing page itself
  const isGroupedLanding = GROUPED_LANDING_PAGES.some(p => p.url === location);

  if (!groupEntry && !currentName) return null;

  const section = sectionOverride ?? groupEntry?.section;
  const group = groupEntry?.group;
  const groupUrl = groupEntry?.groupUrl;

  // On a grouped landing page, show: Section / Group (no child)
  // On a child page, show: Section / Group / Page
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center gap-1 text-xs text-muted-foreground/60 mb-4 ${className}`}
      data-testid="cms-breadcrumb"
    >
      {section && (
        <>
          <span className="font-medium text-muted-foreground/50">{section}</span>
          {(group || currentName) && (
            <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/30" />
          )}
        </>
      )}

      {group && groupUrl && !isGroupedLanding && (
        <>
          <Link
            href={groupUrl}
            className="hover:text-foreground/80 transition-colors truncate"
            data-testid="breadcrumb-group-link"
          >
            {group}
          </Link>
          {currentName && currentName !== group && (
            <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/30" />
          )}
        </>
      )}

      {group && isGroupedLanding && (
        <span className="text-foreground/70 font-medium truncate">{group}</span>
      )}

      {currentName && !isGroupedLanding && currentName !== group && (
        <span
          className="text-foreground/70 font-medium truncate"
          aria-current="page"
          data-testid="breadcrumb-current"
        >
          {currentName}
        </span>
      )}
    </nav>
  );
}
