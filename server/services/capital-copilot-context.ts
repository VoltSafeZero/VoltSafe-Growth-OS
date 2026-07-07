/**
 * capital-copilot-context.ts — Phase 2K
 *
 * Pure context builder for the Capital AI Copilot.
 * No DB calls — accepts assembled raw data and returns a scoped,
 * labeled context string plus source metadata.
 *
 * Calls existing capital pure-computation services to derive summaries.
 */

import { computeWeightedPipeline, computeRiskFlags, computeThisWeekActions, computeLeadCandidates, computeRunway } from "./capital-command-center.js";
import { computeEngagementScore, computeEngagementAnalytics, extractEngagementSignals, recommendNextAction } from "./capital-engagement.js";
import { computeDataRoomIntelligence } from "./capital-data-room.js";
import { computePortalIntelligence } from "./capital-portal.js";
import { computeValuationSummary, computeAllocationPlan, computeClosePlan } from "./capital-valuation.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CopilotRawInput {
  round:            any | null;
  rounds:           any[];
  investors:        any[];
  commitments:      any[];
  contacts:         any[];
  activities:       any[];
  emailLinks:       any[];
  portalAccesses:   any[];
  portalEvents:     any[];
  materials:        any[];
  materialShares:   any[];
  materialRequests: any[];
}

export interface CopilotContextOptions {
  investor_id?:      number | null;
  round_id?:         number | null;
  include_sensitive?: boolean;
  mode?:             string;
}

export interface CopilotContext {
  text:           string;           // full assembled context for the AI prompt
  source_labels:  string[];         // which data sources were included
  investor_name?: string | null;    // if scoped to one investor
  round_name?:    string | null;
  warnings:       string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "N/A";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "N/A";
  try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}

function section(label: string, body: string): string {
  if (!body.trim()) return "";
  return `\n=== ${label} ===\n${body.trim()}\n`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildCopilotContext(
  input: CopilotRawInput,
  opts: CopilotContextOptions = {},
): CopilotContext {
  const {
    investor_id,
    round_id,
    include_sensitive = true,
    mode = "ask",
  } = opts;

  const warnings: string[]      = [];
  const source_labels: string[] = [];
  const parts: string[]         = [];

  // Scope: filter to one investor if investor_id provided
  const scopedInvestors = investor_id
    ? input.investors.filter((i: any) => i.id === investor_id)
    : input.investors;

  const scopedInv = scopedInvestors[0] ?? null;
  const investor_name = scopedInv?.name ?? null;

  const round      = input.round;
  const round_name = round?.name ?? null;

  if (!round)       warnings.push("No active round selected — context may be incomplete.");
  if (input.investors.length === 0) warnings.push("No investors found in Capital module.");

  // ── 1. Round Overview ────────────────────────────────────────────────────
  if (round) {
    source_labels.push("round_overview");
    let body = `Round: ${round.name} | Status: ${round.status}`;
    if (round.target_amount)  body += ` | Target: ${fmt(round.target_amount)}`;
    if (round.minimum_amount) body += ` | Minimum: ${fmt(round.minimum_amount)}`;
    if (round.close_date)     body += ` | Target Close: ${fmtDate(round.close_date)}`;
    if (round.valuation_cap)  body += ` | Valuation Cap: ${fmt(round.valuation_cap)}`;
    if (round.round_type)     body += ` | Round Type: ${round.round_type}`;
    if (round.description && include_sensitive) body += `\nNotes: ${round.description}`;
    parts.push(section("ROUND OVERVIEW [round_overview]", body));
  }

  if (input.rounds.length > 1) {
    const roundList = input.rounds.slice(0, 5).map((r: any) => `  - ${r.name} (${r.status})`).join("\n");
    parts.push(section("ALL ROUNDS [rounds_list]", roundList));
    source_labels.push("rounds_list");
  }

  // ── 2. Weighted Pipeline ─────────────────────────────────────────────────
  let hoistedPipeline: any = null;
  try {
    const pipeline = computeWeightedPipeline(round, scopedInvestors, input.commitments);
    hoistedPipeline = pipeline;
    source_labels.push("weighted_pipeline");
    const pLines = [
      `Weighted Pipeline:    ${fmt(pipeline.weighted_pipeline)}`,
      `Committed Amount:     ${fmt(pipeline.committed_amount)}`,
      `Soft-Circled:         ${fmt(pipeline.soft_circled_amount)}`,
      `Total Investors:      ${pipeline.total_active}`,
      `Hot / Lead Investors: ${pipeline.hot_count}`,
    ];
    if (round?.target_amount) {
      const pct = Math.round((pipeline.weighted_pipeline / round.target_amount) * 100);
      pLines.push(`Pipeline Coverage:    ${pct}% of target`);
    }
    parts.push(section("WEIGHTED PIPELINE [weighted_pipeline]", pLines.join("\n")));
  } catch { warnings.push("Pipeline computation unavailable."); }

  // ── 3. Risk Flags ────────────────────────────────────────────────────────
  try {
    const emptyPipeline = { weighted_pipeline: 0, committed_amount: 0, soft_circled_amount: 0, wired_amount: 0, total_active: 0, remaining_to_target: 0, remaining_to_min_close: 0, committed_count: 0, soft_circled_count: 0, hot_count: 0, likely_lead_count: 0, confidence_low: 0, confidence_high: 0, target_amount: 0, minimum_close_target: 0 };
    const risks = computeRiskFlags(round, scopedInvestors, hoistedPipeline ?? emptyPipeline);
    if (risks.length > 0) {
      source_labels.push("risk_flags");
      const body = risks.map((r: any) => `  [${r.severity?.toUpperCase() ?? "MEDIUM"}] ${r.flag}`).join("\n");
      parts.push(section("RISK FLAGS [risk_flags]", body));
    }
  } catch { warnings.push("Risk flag computation unavailable."); }

  // ── 4. This-Week Actions ────────────────────────────────────────────────
  try {
    const actions = computeThisWeekActions(scopedInvestors, input.commitments, new Map());
    if (actions.length > 0) {
      source_labels.push("this_week_actions");
      const body = actions.slice(0, 8).map((a: any) =>
        `  [${a.priority?.toUpperCase() ?? "MED"}] ${a.investor_name}: ${a.action} — ${a.reason}`
      ).join("\n");
      parts.push(section("THIS WEEK ACTIONS [this_week_actions]", body));
    }
  } catch { warnings.push("This-week actions unavailable."); }

  // ── 5. Lead Candidates ──────────────────────────────────────────────────
  try {
    const leads = computeLeadCandidates(scopedInvestors, input.commitments, input.contacts ?? [], new Map());
    if (leads.length > 0) {
      source_labels.push("lead_candidates");
      const body = leads.slice(0, 5).map((l: any) =>
        `  ${l.investor_name} (${l.investor_type}) — Check: ${fmt(l.check_size_target ?? l.target_cheque_amount)} — Reason: ${l.reason}`
      ).join("\n");
      parts.push(section("LEAD CANDIDATES [lead_candidates]", body));
    }
  } catch {}

  // ── 6. Runway ───────────────────────────────────────────────────────────
  if (round) {
    try {
      const runway = computeRunway(round, hoistedPipeline?.weighted_pipeline ?? 0);
      source_labels.push("runway");
      const body = [
        `Monthly Burn: ${fmt(runway.monthly_burn)}`,
        `Current Runway: ${runway.current_runway_months != null ? runway.current_runway_months + " months" : "N/A"}`,
        `Cash-Out Date: ${fmtDate(runway.cash_out_date)}`,
      ].join("\n");
      parts.push(section("RUNWAY [runway]", body));
    } catch {}
  }

  // ── 7. Valuation / Allocation / Close Plan ───────────────────────────────
  if (round && !investor_id) {
    try {
      const val = computeValuationSummary(round, input.investors, input.commitments);
      source_labels.push("valuation_summary");
      const body = [
        `Round Type: ${val.round_type}`,
        `Effective Pre-Money: ${fmt(val.effective_premoney)}`,
        `Implied Post-Money: ${fmt(val.implied_postmoney)}`,
        `Total Shares: ${val.total_shares ? val.total_shares.toLocaleString() : "N/A"}`,
      ].join("\n");
      parts.push(section("VALUATION SUMMARY [valuation_summary]", body));
    } catch {}

    try {
      const alloc = computeAllocationPlan(input.investors, input.commitments, round);
      if (alloc.length > 0) {
        source_labels.push("allocation_plan");
        const total_confirmed = alloc.reduce((s: number, a: any) => s + (a.confirmed_amount ?? 0), 0);
        const total_requested = alloc.reduce((s: number, a: any) => s + (a.requested_allocation ?? 0), 0);
        const body = [
          `Confirmed Allocations: ${fmt(total_confirmed)}`,
          `Requested Allocations: ${fmt(total_requested)}`,
          `Investors in Alloc Plan: ${alloc.length}`,
        ].join("\n");
        parts.push(section("ALLOCATION PLAN [allocation_plan]", body));
      }
    } catch {}

    try {
      const close = computeClosePlan(input.investors, input.commitments, round);
      if (close.length > 0) {
        source_labels.push("close_plan");
        const byStatus: Record<string, number> = {};
        for (const c of close) {
          const s = c.close_status ?? "unknown";
          byStatus[s] = (byStatus[s] ?? 0) + 1;
        }
        const body = Object.entries(byStatus).map(([s, n]) => `  ${s}: ${n}`).join("\n");
        parts.push(section("CLOSE PLAN STATUS [close_plan]", body));
      }
    } catch {}
  }

  // ── 8. Investor Roster ───────────────────────────────────────────────────
  if (!investor_id && scopedInvestors.length > 0) {
    source_labels.push("investor_roster");
    const rows = scopedInvestors.slice(0, 20).map((inv: any) => {
      let line = `  ${inv.name} | ${inv.pipeline_stage ?? "Unknown"} | ${inv.investor_type ?? ""}`;
      if (inv.target_check_size) line += ` | Target: ${fmt(inv.target_check_size)}`;
      return line;
    });
    if (scopedInvestors.length > 20) rows.push(`  ... and ${scopedInvestors.length - 20} more investors`);
    parts.push(section("INVESTOR ROSTER [investor_roster]", rows.join("\n")));
  }

  // ── 9. Investor Spotlight (when scoped to one investor) ──────────────────
  if (investor_id && scopedInv) {
    source_labels.push("investor_spotlight");
    const lines = [
      `Name: ${scopedInv.name}`,
      `Type: ${scopedInv.investor_type ?? "Unknown"}`,
      `Stage: ${scopedInv.pipeline_stage ?? "Unknown"}`,
      `Target Check: ${fmt(scopedInv.target_check_size)}`,
      `Likely Lead: ${scopedInv.likely_lead ? "Yes" : "No"}`,
      `Can Write Cheque: ${scopedInv.can_write_cheque ? "Yes" : "No"}`,
      `Priority: ${scopedInv.priority ?? "N/A"}`,
      `Next Step: ${scopedInv.next_step ?? "None set"}`,
      `Next Step Due: ${fmtDate(scopedInv.next_step_due_date)}`,
    ];
    if (scopedInv.notes && include_sensitive) lines.push(`Internal Notes: ${scopedInv.notes}`);
    parts.push(section("INVESTOR SPOTLIGHT [investor_spotlight]", lines.join("\n")));

    // Engagement for this investor
    try {
      const signals = extractEngagementSignals(
        scopedInv,
        input.activities.filter((a: any) => a.entity_id === investor_id),
        input.emailLinks.filter((e: any) => e.capital_investor_id === investor_id),
        input.portalEvents,
        input.portalAccesses.filter((p: any) => p.investor_id === investor_id),
        input.materialShares.filter((s: any) => s.investor_id === investor_id),
      );
      const eng = computeEngagementScore(scopedInv, signals);
      const nextAct = recommendNextAction(scopedInv, signals, eng.engagement_tier);
      source_labels.push("investor_engagement");
      const engLines = [
        `Engagement Score: ${eng.engagement_score}/100 (${eng.engagement_tier})`,
        `Recommended Action: ${nextAct}`,
        `Engagement Reasons: ${eng.reasons.slice(0, 3).join("; ")}`,
      ];
      if (eng.risk_flags?.length && include_sensitive) {
        engLines.push(`Risk Signals: ${eng.risk_flags.join("; ")}`);
      }
      parts.push(section("INVESTOR ENGAGEMENT [investor_engagement]", engLines.join("\n")));
    } catch {}

    // Recent activities for this investor
    const invActivities = input.activities
      .filter((a: any) => a.entity_id === investor_id)
      .slice(0, 8);
    if (invActivities.length > 0) {
      source_labels.push("investor_activities");
      const body = invActivities.map((a: any) =>
        `  ${fmtDate(a.activity_at ?? a.created_at)} — ${a.activity_type}: ${include_sensitive ? (a.summary ?? a.notes ?? "") : "[redacted]"}`
      ).join("\n");
      parts.push(section("INVESTOR RECENT ACTIVITY [investor_activities]", body));
    }

    // Email links for this investor
    const invEmails = input.emailLinks.filter((e: any) => e.capital_investor_id === investor_id);
    if (invEmails.length > 0) {
      source_labels.push("investor_email_links");
      const body = invEmails.slice(0, 5).map((e: any) =>
        `  ${fmtDate(e.latest_message_at)} — Subject: "${e.subject_snippet ?? "N/A"}" (${e.message_count ?? 1} messages)`
      ).join("\n");
      parts.push(section("INVESTOR EMAIL THREADS [investor_email_links]", body));
    }

    // Materials sent to this investor
    const invShares = input.materialShares.filter((s: any) => s.investor_id === investor_id);
    if (invShares.length > 0) {
      source_labels.push("investor_materials");
      const body = invShares.slice(0, 6).map((s: any) =>
        `  ${fmtDate(s.shared_at)} — ${s.material_title ?? "Document"} (${s.material_type ?? "unknown"})`
      ).join("\n");
      parts.push(section("MATERIALS SENT TO INVESTOR [investor_materials]", body));
    }

    // Portal access for this investor
    const invPortal = input.portalAccesses.filter((p: any) => p.investor_id === investor_id);
    if (invPortal.length > 0) {
      const portal = invPortal[0];
      source_labels.push("investor_portal");
      const invEvents = input.portalEvents.filter((e: any) => e.portal_access_id === portal.id);
      const pLines = [
        `Portal Status: ${portal.status ?? "active"}`,
        `Last Viewed: ${fmtDate(portal.last_viewed_at)}`,
        `Portal Events: ${invEvents.length}`,
      ];
      parts.push(section("INVESTOR PORTAL [investor_portal]", pLines.join("\n")));
    }
  }

  // ── 10. Aggregate Engagement ─────────────────────────────────────────────
  if (!investor_id && input.investors.length > 0) {
    try {
      const analytics = computeEngagementAnalytics(
        input.investors,
        input.activities,
        input.emailLinks,
        input.portalEvents,
        input.portalAccesses,
        input.materialShares,
      );
      source_labels.push("engagement_analytics");
      const body = [
        `Avg Engagement Score: ${analytics.avg_score ?? "N/A"}`,
        `Highly Engaged: ${analytics.tier_breakdown?.["Highly Engaged"] ?? 0}`,
        `Engaged: ${analytics.tier_breakdown?.["Engaged"] ?? 0}`,
        `Warm: ${analytics.tier_breakdown?.["Warm"] ?? 0}`,
        `Cold / At Risk: ${(analytics.tier_breakdown?.["Cold"] ?? 0) + (analytics.tier_breakdown?.["At Risk"] ?? 0)}`,
      ].join("\n");
      parts.push(section("ENGAGEMENT ANALYTICS [engagement_analytics]", body));
    } catch {}
  }

  // ── 11. Data Room ────────────────────────────────────────────────────────
  if (input.materials.length > 0) {
    try {
      const dr = computeDataRoomIntelligence(input.materials, input.materialShares, input.materialRequests, input.investors);
      source_labels.push("data_room");
      const body = [
        `Total Materials: ${dr.total_materials}`,
        `Shared with Investors: ${dr.total_shares}`,
        `Pending Requests: ${dr.pending_requests}`,
        `Missing Key Materials: ${dr.missing_key_materials?.length ?? 0}`,
        ...(dr.missing_key_materials?.slice(0, 4).map((m: any) =>
          `  Missing: ${m.material_type} for ${m.investor_name}`
        ) ?? []),
      ].join("\n");
      parts.push(section("DATA ROOM INTELLIGENCE [data_room]", body));
    } catch {}
  }

  // ── 12. Portal Intelligence ──────────────────────────────────────────────
  if (input.portalAccesses.length > 0) {
    try {
      const portal = computePortalIntelligence(input.portalAccesses, input.portalEvents, input.investors);
      source_labels.push("portal_intel");
      const body = [
        `Active Portals: ${portal.active_portals}`,
        `Recently Viewed (7d): ${portal.recent_views}`,
        `Expiring Soon: ${portal.expiring_soon}`,
        ...(portal.high_activity?.slice(0, 3).map((p: any) =>
          `  High Activity: ${p.investor_name} — ${p.event_count} events`
        ) ?? []),
      ].join("\n");
      parts.push(section("PORTAL INTELLIGENCE [portal_intel]", body));
    } catch {}
  }

  // ── 13. Follow-Up Queue ──────────────────────────────────────────────────
  const now = Date.now();
  const overdue = input.investors.filter((inv: any) => {
    if (!inv.next_step_due_date) return false;
    return new Date(inv.next_step_due_date).getTime() < now && inv.pipeline_stage !== "Passed";
  });
  if (overdue.length > 0) {
    source_labels.push("follow_up_queue");
    const body = overdue.slice(0, 8).map((inv: any) =>
      `  ${inv.name} — ${inv.next_step ?? "No step"} (due ${fmtDate(inv.next_step_due_date)})`
    ).join("\n");
    parts.push(section("OVERDUE FOLLOW-UPS [follow_up_queue]", body));
  }

  // ── 14. Board-safe mode stripping ────────────────────────────────────────
  // (Sensitive content is already gated above via include_sensitive)
  // In board-safe mode, add a notice for the AI
  let contextText = parts.join("");
  if (!include_sensitive) {
    contextText = `[BOARD-SAFE MODE: Internal notes, private commentary, and raw email content have been excluded. Report only on facts derived from the structured data below.]\n` + contextText;
  }

  if (!contextText.trim()) {
    contextText = "[No Capital data is currently available. State clearly that data is missing and ask the user to verify their Capital module setup.]";
    warnings.push("No Capital data was assembled — context is empty.");
  }

  return {
    text:          contextText,
    source_labels,
    investor_name,
    round_name,
    warnings,
  };
}

// Board-safe context (convenience wrapper)
export function buildBoardSafeContext(input: CopilotRawInput, opts: Omit<CopilotContextOptions, "include_sensitive"> = {}): CopilotContext {
  return buildCopilotContext(input, { ...opts, include_sensitive: false });
}
