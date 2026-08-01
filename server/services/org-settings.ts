/**
 * org-settings.ts
 *
 * Canonical settings service for VoltSafe CMS.
 * All org-level configuration must be read through this module.
 * Do NOT scatter fallback values throughout application code.
 *
 * Singleton row: org_settings.id = 1 always.
 * Table created by migrateOrgSettingsSchema() in seed-production.ts.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Defaults (match DB column defaults exactly) ───────────────────────────────
const ORG_SETTINGS_DEFAULTS = {
  id: 1,
  critical_overdue_days:           3,
  customer_wait_nudge_days:        14,
  org_timezone:                    "America/Vancouver",
  ev_hardware_revenue_per_pedestal: null as number | null,
  ev_connectors_per_pedestal:       null as number | null,
  ev_saas_per_connector_month:      15,
  ev_shore_power_pct:               0.70,
  ev_replacement_pct:               0.50,
  ev_penetration_pct:               1.00,
} as const;

export type OrgSettingsRow = typeof ORG_SETTINGS_DEFAULTS & {
  ev_hardware_revenue_per_pedestal: number | null;
  ev_connectors_per_pedestal: number | null;
};

let _cached: OrgSettingsRow | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 60_000; // 1-minute cache — settings change rarely

/**
 * Read the canonical org settings row.
 * Returns merged defaults + DB row so callers always get a typed object.
 * Caches for 60s to avoid a DB round-trip on every request.
 */
export async function getOrgSettings(): Promise<OrgSettingsRow> {
  const now = Date.now();
  if (_cached && now - _cachedAt < CACHE_TTL_MS) return _cached;

  try {
    const result = await db.execute(sql.raw(`SELECT * FROM org_settings WHERE id = 1 LIMIT 1`));
    const row = (result.rows ?? [])[0] as Record<string, unknown> | undefined;
    if (row) {
      _cached = {
        ...ORG_SETTINGS_DEFAULTS,
        ...row,
        // Coerce numerics from PG string representation
        critical_overdue_days:           Number(row.critical_overdue_days           ?? ORG_SETTINGS_DEFAULTS.critical_overdue_days),
        customer_wait_nudge_days:        Number(row.customer_wait_nudge_days        ?? ORG_SETTINGS_DEFAULTS.customer_wait_nudge_days),
        org_timezone:                    String(row.org_timezone                    ?? ORG_SETTINGS_DEFAULTS.org_timezone),
        ev_hardware_revenue_per_pedestal: row.ev_hardware_revenue_per_pedestal != null ? Number(row.ev_hardware_revenue_per_pedestal) : null,
        ev_connectors_per_pedestal:       row.ev_connectors_per_pedestal       != null ? Number(row.ev_connectors_per_pedestal)       : null,
        ev_saas_per_connector_month:      Number(row.ev_saas_per_connector_month      ?? ORG_SETTINGS_DEFAULTS.ev_saas_per_connector_month),
        ev_shore_power_pct:               Number(row.ev_shore_power_pct               ?? ORG_SETTINGS_DEFAULTS.ev_shore_power_pct),
        ev_replacement_pct:               Number(row.ev_replacement_pct               ?? ORG_SETTINGS_DEFAULTS.ev_replacement_pct),
        ev_penetration_pct:               Number(row.ev_penetration_pct               ?? ORG_SETTINGS_DEFAULTS.ev_penetration_pct),
      } as OrgSettingsRow;
    } else {
      _cached = { ...ORG_SETTINGS_DEFAULTS } as OrgSettingsRow;
    }
    _cachedAt = now;
    return _cached;
  } catch {
    // Table may not exist yet during first boot before migration runs.
    return { ...ORG_SETTINGS_DEFAULTS } as OrgSettingsRow;
  }
}

/** Invalidate the in-process cache (call after settings are updated). */
export function invalidateOrgSettingsCache(): void {
  _cached  = null;
  _cachedAt = 0;
}

/** Synchronous defaults for pure functions / tests that cannot await. */
export function getOrgSettingsDefaults() {
  return { ...ORG_SETTINGS_DEFAULTS };
}
