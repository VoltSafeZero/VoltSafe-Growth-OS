/**
 * next-action-value.ts
 *
 * Estimated value calculations and slip-count parsing for the Next Action system.
 * Pure functions — no database access.
 *
 * Formulas (spec-locked):
 *   est_hardware     = est_pedestals × ev_hardware_revenue_per_pedestal
 *   est_saas_arr     = est_pedestals × ev_connectors_per_pedestal × ev_saas_per_connector_month × 12
 *   est_first_year   = est_hardware + est_saas_arr
 *
 * Rules:
 *   - deal_value_override wins for primary Deal Value (never overwrite manual values)
 *   - hardware is NULL when hardware price is unset
 *   - SaaS ARR is NULL when connectors-per-pedestal is unset
 *   - First-Year Value is NULL unless every required component is non-null
 *   - never return a misleading partial total
 */

// ── Slip count parsing ────────────────────────────────────────────────────────

export type SlipParseConfidence = 'high' | 'medium' | 'low' | 'reject';

export interface SlipParseResult {
  raw:          string;
  normalized:   number | null;
  confidence:   SlipParseConfidence;
  reason:       string;
}

/**
 * Parse a single raw slip count string from leads.slips.
 * Returns a normalized integer and a confidence level.
 *
 * Rules (spec-locked):
 *   "480"      → 480, high   (exact integer)
 *   "1,200"    → 1200, high  (comma-formatted integer)
 *   "160+"     → null, low   (plus-suffix — do not silently convert without product approval)
 *   "100-150"  → null, reject (range)
 *   "150 - tbd"→ null, reject (ambiguous text)
 *   "-"        → null, reject (dash-only placeholder)
 *   prose/text → null, reject
 *   negative   → null, reject
 */
export function parseSlipCount(raw: string): SlipParseResult {
  const trimmed = raw.trim();

  // Reject empty / dash-only
  if (!trimmed || trimmed === '-' || trimmed === '—') {
    return { raw, normalized: null, confidence: 'reject', reason: 'empty or dash placeholder' };
  }

  // Reject negative
  if (/^-\d/.test(trimmed)) {
    return { raw, normalized: null, confidence: 'reject', reason: 'negative value' };
  }

  // Exact integer (e.g. "480")
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return { raw, normalized: n, confidence: 'high', reason: 'exact integer' };
  }

  // Comma-formatted integer (e.g. "1,200", "10,000")
  if (/^\d{1,3}(,\d{3})+$/.test(trimmed)) {
    const n = parseInt(trimmed.replace(/,/g, ''), 10);
    return { raw, normalized: n, confidence: 'high', reason: 'comma-formatted integer' };
  }

  // Plus-suffix (e.g. "160+", "500+") — low confidence, requires explicit product approval
  if (/^\d+\+$/.test(trimmed)) {
    return { raw, normalized: null, confidence: 'low', reason: 'plus-suffix: requires product approval before normalization' };
  }

  // Range (e.g. "100-150", "200 - 300")
  if (/^\d+\s*[-–]\s*\d+/.test(trimmed)) {
    return { raw, normalized: null, confidence: 'reject', reason: 'range: ambiguous — no single value' };
  }

  // Ambiguous (e.g. "150 - tbd", "approx 200", "TBD")
  return { raw, normalized: null, confidence: 'reject', reason: 'ambiguous or prose text' };
}

export interface SlipParseReport {
  totalLeads:           number;
  nonEmptySlips:        number;
  exactIntegers:        number;
  commaIntegers:        number;
  plusSuffix:           number;
  ranges:               number;
  ambiguous:            number;
  invalid:              number;   // dash-only, empty, other
  negatives:            number;
  highConfidenceCount:  number;
  cleanParseRate:       number;   // high-confidence / non-empty (0–1)
  backfillRecommended:  boolean;  // cleanParseRate >= 0.70
  samples:              Array<SlipParseResult & { count: number }>;
}

/** Build the slip-count dry-run report from raw value/count pairs (read-only). */
export function buildSlipParseReport(
  totalLeads: number,
  valueCounts: Array<{ slips: string; cnt: number }>
): SlipParseReport {
  let exactIntegers = 0, commaIntegers = 0, plusSuffix = 0;
  let ranges = 0, ambiguous = 0, invalid = 0, negatives = 0;
  let nonEmpty = 0;

  const samples: Array<SlipParseResult & { count: number }> = [];

  for (const { slips, cnt } of valueCounts) {
    if (!slips || slips.trim() === '') continue;
    nonEmpty += cnt;
    const r = parseSlipCount(slips);
    samples.push({ ...r, count: cnt });

    if (r.confidence === 'reject') {
      if (/^-\d/.test(slips.trim())) {
        negatives += cnt;
      } else if (!slips.trim() || slips.trim() === '-' || slips.trim() === '—') {
        invalid += cnt;
      } else if (/^\d+\s*[-–]\s*\d+/.test(slips.trim())) {
        ranges += cnt;
      } else {
        ambiguous += cnt;
      }
    } else if (r.confidence === 'low') {
      plusSuffix += cnt;
    } else if (r.confidence === 'high') {
      if (/^\d+$/.test(slips.trim())) exactIntegers += cnt;
      else commaIntegers += cnt;
    }
  }

  // Also count dash-only rows as invalid
  const dashRows = valueCounts.filter(v => v.slips?.trim() === '-' || v.slips?.trim() === '—');
  const dashCount = dashRows.reduce((s, r) => s + r.cnt, 0);
  // Subtract from ambiguous if they were counted there
  invalid += dashCount;

  const highConfidenceCount = exactIntegers + commaIntegers;
  const cleanParseRate = nonEmpty > 0 ? highConfidenceCount / nonEmpty : 0;

  return {
    totalLeads,
    nonEmptySlips:       nonEmpty,
    exactIntegers,
    commaIntegers,
    plusSuffix,
    ranges,
    ambiguous,
    invalid:             dashCount, // canonical count of dash/empty rejects
    negatives,
    highConfidenceCount,
    cleanParseRate,
    backfillRecommended: cleanParseRate >= 0.70,
    samples:             samples.sort((a, b) => b.count - a.count).slice(0, 40),
  };
}

// ── Estimated value formulas ──────────────────────────────────────────────────

export interface EstimatedValueInput {
  // Lead pedestal resolution (checked in order: 1→2)
  estimatedPedestalCount?: number | null;  // leads.estimated_pedestal_count
  slipCountInt?:           number | null;  // leads.slip_count_int (backfilled later)
  slipsText?:              string | null;  // leads.slips (parsed on-the-fly)

  // Account pedestal resolution — use slip_count for accounts (not installed_units)
  // Caller is responsible for choosing the correct field per entity type.
  slipCount?:              number | null;  // accounts.slip_count

  // Manual override always wins
  dealValueOverride?:      number | null;  // leads/accounts.deal_value_override
  dealAmount?:             number | null;  // leads.deal_amount (fallback label value)

  // Org settings assumptions
  shorePowerPct?:          number | null;  // ev_shore_power_pct
  replacementPct?:         number | null;  // ev_replacement_pct
  penetrationPct?:         number | null;  // ev_penetration_pct
  hardwarePricePerPedestal?: number | null; // ev_hardware_revenue_per_pedestal
  connectorsPerPedestal?:  number | null;  // ev_connectors_per_pedestal
  saasPerConnectorMonth?:  number | null;  // ev_saas_per_connector_month
}

export interface EstimatedValueResult {
  /** The primary deal value shown in the UI. Override wins; falls back to deal_amount. */
  primaryValue:         number | null;
  /** Whether the primary value came from a manual override. */
  isOverride:           boolean;
  /** Estimated pedestal count used in formula (null = cannot compute). */
  estPedestals:         number | null;
  /** Estimated hardware revenue (null when hardware price unset). */
  estHardware:          number | null;
  /** Estimated annual SaaS ARR (null when connectors-per-pedestal unset). */
  estSaasArr:           number | null;
  /** Estimated first-year value = hardware + saas_arr (null when any component missing). */
  estFirstYear:         number | null;
  /**
   * Complete input chain for future "Why this estimate?" tooltip.
   * Every factor that contributed to the result, in evaluation order.
   */
  chain: {
    pedestalSource:    'manual' | 'slip_count_int' | 'slips_text' | 'account_slip_count' | null;
    pedestalRaw:       number | null;
    shorePowerPct:     number | null;
    replacementPct:    number | null;
    penetrationPct:    number | null;
    hardwarePrice:     number | null;
    connectorsPerPedestal: number | null;
    saasMonthly:       number | null;
  };
}

/**
 * Resolve the estimated pedestal count from a lead's sources.
 * Returns { count, source } where source explains which field was used.
 */
function resolveLeadPedestals(
  estimatedPedestalCount: number | null | undefined,
  slipCountInt: number | null | undefined,
  slipsText: string | null | undefined,
  shorePowerPct: number | null | undefined,
  replacementPct: number | null | undefined,
  penetrationPct: number | null | undefined,
): { count: number | null; source: 'manual' | 'slip_count_int' | 'slips_text' | null; rawSlips: number | null } {
  // Priority 1: manual estimated_pedestal_count
  if (estimatedPedestalCount != null && estimatedPedestalCount > 0) {
    return { count: estimatedPedestalCount, source: 'manual', rawSlips: null };
  }

  // Priority 2: slip_count_int (already parsed integer)
  const slipInt = slipCountInt ?? null;
  let rawSlips: number | null = slipInt;
  let source: 'slip_count_int' | 'slips_text' | null = null;

  if (slipInt != null && slipInt > 0) {
    source = 'slip_count_int';
  } else if (slipsText != null && slipsText.trim() !== '' && slipsText.trim() !== '-') {
    // Parse on-the-fly from text
    const parsed = parseSlipCount(slipsText);
    if (parsed.confidence === 'high' && parsed.normalized != null) {
      rawSlips = parsed.normalized;
      source = 'slips_text';
    }
  }

  if (rawSlips == null || source === null) return { count: null, source: null, rawSlips: null };

  // Apply formula factors (all must be present)
  const sp = shorePowerPct ?? null;
  const rp = replacementPct ?? null;
  const pp = penetrationPct ?? null;
  if (sp == null || rp == null || pp == null) return { count: null, source, rawSlips };

  const count = rawSlips * sp * rp * pp;
  return { count: count > 0 ? count : null, source, rawSlips };
}

/**
 * Calculate estimated revenue values for a lead or account.
 * All formulas are as spec. Returns null components rather than partial totals.
 */
export function calculateEstimatedValue(input: EstimatedValueInput): EstimatedValueResult {
  // Primary value: override wins
  const hasOverride = input.dealValueOverride != null && input.dealValueOverride > 0;
  const primaryValue = hasOverride
    ? input.dealValueOverride!
    : (input.dealAmount ?? null);

  // Resolve pedestal count
  let estPedestals: number | null = null;
  let pedestalSource: EstimatedValueResult['chain']['pedestalSource'] = null;
  let pedestalRaw: number | null = null;

  if (input.slipCount != null) {
    // Account path: use slip_count directly (no formula needed if explicit pedestal unavailable)
    // The caller should pass slipCount for accounts. If also passing shore/replacement/penetration,
    // we apply the formula. If not, we use slip_count as the pedestal count directly.
    if (input.shorePowerPct != null && input.replacementPct != null && input.penetrationPct != null) {
      estPedestals = input.slipCount * input.shorePowerPct * input.replacementPct * input.penetrationPct;
      pedestalSource = 'account_slip_count';
      pedestalRaw = input.slipCount;
    } else {
      // No formula factors — cannot derive pedestal count
      estPedestals = null;
      pedestalSource = 'account_slip_count';
      pedestalRaw = input.slipCount;
    }
  } else {
    // Lead path
    const resolved = resolveLeadPedestals(
      input.estimatedPedestalCount,
      input.slipCountInt,
      input.slipsText,
      input.shorePowerPct,
      input.replacementPct,
      input.penetrationPct,
    );
    estPedestals = resolved.count;
    pedestalSource = resolved.source;
    pedestalRaw = resolved.rawSlips;
  }

  // Hardware estimate
  const hp = input.hardwarePricePerPedestal ?? null;
  const estHardware = (estPedestals != null && hp != null)
    ? estPedestals * hp
    : null;

  // SaaS ARR
  const cpp = input.connectorsPerPedestal ?? null;
  const spm = input.saasPerConnectorMonth ?? null;
  const estSaasArr = (estPedestals != null && cpp != null && spm != null)
    ? estPedestals * cpp * spm * 12
    : null;

  // First-year value — only when both hardware and saas are computable
  const estFirstYear = (estHardware != null && estSaasArr != null)
    ? estHardware + estSaasArr
    : null;

  return {
    primaryValue,
    isOverride:  hasOverride,
    estPedestals,
    estHardware,
    estSaasArr,
    estFirstYear,
    chain: {
      pedestalSource,
      pedestalRaw,
      shorePowerPct:         input.shorePowerPct ?? null,
      replacementPct:        input.replacementPct ?? null,
      penetrationPct:        input.penetrationPct ?? null,
      hardwarePrice:         hp,
      connectorsPerPedestal: cpp,
      saasMonthly:           spm,
    },
  };
}
