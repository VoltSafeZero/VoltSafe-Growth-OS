// Shared role-based-access-control helpers for sales/travel-intelligence
// features (Revenue Simulator, Leads Nearby, My Travel, single-day marina
// visit planning). Used by BOTH the client (UI hiding) and the server
// (enforcement) so the allowlist never drifts between the two.
//
// Per the "Advisor Test" role audit: these surfaces expose pipeline $,
// account-level detail, and route/location data that should only be
// visible to people who actually run sales/travel — not every internal
// role (support, engineering, analyst, read-only, advisor, etc).

export const PRIVILEGED_SALES_ROLES = [
  "master_admin",
  "admin",
  "manager",
  "exec",
  "sales",
] as const;

export type PrivilegedSalesRole = (typeof PRIVILEGED_SALES_ROLES)[number];

function normalize(role: string | null | undefined): string {
  return String(role || "").toLowerCase().trim();
}

/** True for master_admin / admin / manager / exec / sales. */
export function isPrivilegedSalesRole(globalRole: string | null | undefined): boolean {
  return PRIVILEGED_SALES_ROLES.includes(normalize(globalRole) as PrivilegedSalesRole);
}

/** Revenue Simulator / "Simulators & Feedback" access. */
export const canAccessRevenueSimulator = isPrivilegedSalesRole;

/** Leads Nearby / My Travel widgets, and the "Single-day visits" travel-day option. */
export const canUseSalesTravelTools = isPrivilegedSalesRole;
