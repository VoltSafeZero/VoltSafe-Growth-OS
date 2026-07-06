/**
 * Capital Investor Portal — computation service (Phase 2H)
 *
 * Pure functions: no DB calls, no side effects.
 * All DB queries stay in routes-capital.ts.
 */

import type { RiskFlag } from "./capital-data-room.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PortalAccess {
  id: number;
  investor_id: number;
  investor_name?: string | null;
  contact_id?: number | null;
  round_id?: number | null;
  status: string;
  expires_at?: string | null;
  last_accessed_at?: string | null;
  access_count: number;
  created_at: string;
  access_label: string;
  material_count?: number | string | null;
}

export interface PortalEvent {
  id: number;
  portal_access_id: number;
  event_type: string;
  occurred_at: string;
  investor_id?: number | null;
  material_id?: number | null;
}

export interface PortalIntelligence {
  active_portals: number;
  investors_with_portal: number;
  investors_without_portal: number;
  portals_expiring_soon: {
    id: number;
    investor_name: string;
    expires_at: string;
    days_left: number;
  }[];
  portals_never_opened: {
    id: number;
    investor_name: string;
    created_at: string;
    days_old: number;
  }[];
  diligence_investors_not_in_portal: {
    id: number;
    name: string;
    stage: string;
  }[];
  total_views_7d: number;
  total_downloads_7d: number;
  most_viewed_materials: { material_id: number; title: string; views: number }[];
}

// ── Stages that should have portal access ─────────────────────────────────────
const PORTAL_RECOMMENDED_STAGES = new Set([
  "Diligence",
  "Follow-Up",
  "Partner Meeting",
  "Soft Commit",
  "Committed",
]);

const EXCLUDED_STAGES = new Set(["Passed", "Do Not Contact"]);

// ── computePortalIntelligence ─────────────────────────────────────────────────

export function computePortalIntelligence(
  portalAccesses: PortalAccess[],
  events: PortalEvent[],
  investors: any[],
  materialTitles: Map<number, string>,
): PortalIntelligence {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86400000;

  // Active portals: status=active and not expired
  const activePortals = portalAccesses.filter(p =>
    p.status === "active" &&
    (!p.expires_at || new Date(p.expires_at).getTime() > now)
  );

  const investorsWithPortal = new Set(activePortals.map(p => p.investor_id));

  const investorsWithoutPortal = investors.filter(inv =>
    !EXCLUDED_STAGES.has(inv.stage ?? "") &&
    !investorsWithPortal.has(inv.id)
  ).length;

  // Expiring soon: active portals expiring in <7 days (only if has expiry)
  const expiringSoon = activePortals
    .filter(p => {
      if (!p.expires_at) return false;
      const msLeft = new Date(p.expires_at).getTime() - now;
      return msLeft > 0 && msLeft < 7 * 86400000;
    })
    .map(p => ({
      id: p.id,
      investor_name: p.investor_name ?? "Unknown",
      expires_at: p.expires_at!,
      days_left: Math.ceil((new Date(p.expires_at!).getTime() - now) / 86400000),
    }))
    .sort((a, b) => a.days_left - b.days_left);

  // Never opened: active portals created >3 days ago with access_count=0
  const neverOpened = activePortals
    .filter(p =>
      Number(p.access_count) === 0 &&
      (now - new Date(p.created_at).getTime()) > 3 * 86400000
    )
    .map(p => ({
      id: p.id,
      investor_name: p.investor_name ?? "Unknown",
      created_at: p.created_at,
      days_old: Math.floor((now - new Date(p.created_at).getTime()) / 86400000),
    }))
    .sort((a, b) => b.days_old - a.days_old)
    .slice(0, 10);

  // Diligence-stage investors without a portal
  const diligenceWithout = investors
    .filter(inv =>
      PORTAL_RECOMMENDED_STAGES.has(inv.stage ?? "") &&
      !investorsWithPortal.has(inv.id)
    )
    .map(inv => ({ id: inv.id, name: inv.name, stage: inv.stage }))
    .slice(0, 10);

  // Recent views / downloads (last 7 days)
  const recentViews = events.filter(e =>
    e.event_type === "material_viewed" &&
    new Date(e.occurred_at).getTime() > sevenDaysAgo
  );
  const recentDownloads = events.filter(e =>
    e.event_type === "material_downloaded" &&
    new Date(e.occurred_at).getTime() > sevenDaysAgo
  );

  const viewsByMaterial = new Map<number, number>();
  for (const e of recentViews) {
    if (e.material_id) {
      viewsByMaterial.set(Number(e.material_id), (viewsByMaterial.get(Number(e.material_id)) ?? 0) + 1);
    }
  }

  const mostViewed = [...viewsByMaterial.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([mid, views]) => ({
      material_id: mid,
      title: materialTitles.get(mid) ?? "Untitled",
      views,
    }));

  return {
    active_portals:                 activePortals.length,
    investors_with_portal:          investorsWithPortal.size,
    investors_without_portal:       investorsWithoutPortal,
    portals_expiring_soon:          expiringSoon,
    portals_never_opened:           neverOpened,
    diligence_investors_not_in_portal: diligenceWithout,
    total_views_7d:                 recentViews.length,
    total_downloads_7d:             recentDownloads.length,
    most_viewed_materials:          mostViewed,
  };
}

// ── computePortalRiskFlags ────────────────────────────────────────────────────

export function computePortalRiskFlags(intel: PortalIntelligence): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (intel.diligence_investors_not_in_portal.length > 0) {
    flags.push({
      level: "warning",
      code: "diligence_no_portal",
      message: `${intel.diligence_investors_not_in_portal.length} diligence-stage investor${intel.diligence_investors_not_in_portal.length === 1 ? "" : "s"} without portal access`,
    });
  }

  if (intel.portals_expiring_soon.length > 0) {
    const soonest = intel.portals_expiring_soon[0];
    flags.push({
      level: soonest.days_left <= 1 ? "critical" : "warning",
      code: "portal_expiring_soon",
      message: `${intel.portals_expiring_soon.length} portal link${intel.portals_expiring_soon.length === 1 ? "" : "s"} expiring within 7 days`,
    });
  }

  if (intel.portals_never_opened.length > 0) {
    flags.push({
      level: "info",
      code: "portal_never_opened",
      message: `${intel.portals_never_opened.length} portal link${intel.portals_never_opened.length === 1 ? "" : "s"} not yet opened (sent 3+ days ago)`,
    });
  }

  return flags;
}
