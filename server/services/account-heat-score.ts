import { db } from "../db";
import { sql } from "drizzle-orm";
import { getAccountReplyClassificationScore } from "./campaign-reply-classifier";

// ── Startup index migration ────────────────────────────────────────────────────
// Ensures query performance on the two hot-path columns that lacked indexes.
// Uses IF NOT EXISTS so it is idempotent and fast after the first run.
(async () => {
  try {
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS idx_camp_events_account
       ON campaign_events (account_id)`
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS idx_camp_events_account_type
       ON campaign_events (account_id, event_type)`
    ));
  } catch {
    // Non-fatal — index may already exist or table may not yet exist on first boot
  }
})();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccountHeatScore {
  accountId: number;
  accountName: string;
  marinaType: string | null;
  region: string | null;
  city: string | null;
  heatScore: number;
  heatLabel: "Hot" | "Warm" | "Nurture" | "Low" | "Cold";
  scoreReasons: string[];
  negativeReasons: string[];
  latestEngagementAt: string | null;
  engagedContactsCount: number;
  engagedRoles: string[];
  campaignCount: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  replyCount: number;
  unsubscribeCount: number;
  spamComplaintCount: number;
  complianceRiskCount: number;
  recommendedNextAction: string;
}

export interface BuyingCommitteeMember {
  contactId: number;
  name: string;
  title: string | null;
  email: string | null;
  stakeholderType: string;
  complianceStatus: string;
  campaignsReceived: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  replyCount: number;
  unsubscribed: boolean;
  suppressed: boolean;
  spamComplaint: boolean;
  lastEngagementAt: string | null;
  engagementLevel: "Hot Contact" | "Engaged" | "Light Engagement" | "No Engagement" | "Do Not Email";
  recommendedAction: string;
}

export interface AccountCampaignEngagement {
  campaignId: number;
  campaignName: string;
  campaignType: string;
  status: string;
  sentAt: string | null;
  openCount: number;
  clickCount: number;
  replyCount: number;
  unsubscribeCount: number;
  recipientCount: number;
}

export interface HotAccountsFilter {
  label?: string;
  persona?: string;
  adoptionStage?: string;
  region?: string;
  minScore?: number;
  campaignId?: number;
  complianceRisk?: boolean;
  limit?: number;
  sort?: "score" | "latest" | "clicks";
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function heatLabelOf(score: number): "Hot" | "Warm" | "Nurture" | "Low" | "Cold" {
  if (score >= 80) return "Hot";
  if (score >= 60) return "Warm";
  if (score >= 40) return "Nurture";
  if (score >= 20) return "Low";
  return "Cold";
}

function roleSignal(title: string | null | undefined): { score: number; label: string | null } {
  if (!title) return { score: 0, label: null };
  const t = title.toLowerCase();
  if (/\b(owner|ceo|president|founder|managing director)\b/.test(t)) return { score: 15, label: "Owner/CEO" };
  if (/\b(general manager|gm|marina manager)\b/.test(t)) return { score: 12, label: "GM" };
  if (/\b(harbormaster|harbour master|dockmaster|dock master|dockage)\b/.test(t)) return { score: 10, label: "Harbormaster" };
  if (/\b(electrician|facilities|maintenance|engineer)\b/.test(t)) return { score: 8, label: "Marine Electrician" };
  if (/\b(deckhand|staff|dock hand|attendant|assistant)\b/.test(t)) return { score: 3, label: "Deckhand/Staff" };
  return { score: 0, label: null };
}

function personaFit(marinaType: string | null, marketSegment: string | null): { score: number; reason: string | null } {
  const p = ((marinaType ?? "") + " " + (marketSegment ?? "")).toLowerCase().trim();
  if (!p) return { score: 0, reason: null };
  if (/marina group|multi.?site/.test(p)) return { score: 15, reason: "Marina Group / Multi-Site Operator persona" };
  if (/premium independent/.test(p)) return { score: 12, reason: "Premium Independent Marina persona" };
  if (/resort|destination/.test(p)) return { score: 12, reason: "Resort / Destination Marina persona" };
  if (/developer|new build/.test(p)) return { score: 12, reason: "Developer / New Build persona" };
  if (/port authority/.test(p)) return { score: 10, reason: "Port Authority Marina persona" };
  if (/municipal/.test(p)) return { score: 5, reason: "Municipal Marina persona" };
  if (/mom.?and.?pop|mom.?&.?pop|small independent/.test(p)) return { score: -5, reason: "Mom & Pop Marina persona" };
  return { score: 0, reason: null };
}

function stakeholderType(title: string | null | undefined): string {
  if (!title) return "Unknown";
  const t = title.toLowerCase();
  if (/\b(owner|ceo|president|founder)\b/.test(t)) return "Decision Maker";
  if (/\b(general manager|gm|marina manager)\b/.test(t)) return "Influencer";
  if (/\b(harbormaster|dockmaster)\b/.test(t)) return "Technical Buyer";
  if (/\b(electrician|facilities|maintenance|engineer)\b/.test(t)) return "Technical Evaluator";
  if (/\b(deckhand|staff|attendant)\b/.test(t)) return "End User";
  return "Unknown";
}

function contactEngagementLevel(
  opens: number, clicks: number, replies: number,
  unsubscribed: boolean, suppressed: boolean
): "Hot Contact" | "Engaged" | "Light Engagement" | "No Engagement" | "Do Not Email" {
  if (unsubscribed || suppressed) return "Do Not Email";
  if (replies > 0 || clicks >= 3) return "Hot Contact";
  if (clicks > 0 || opens >= 3) return "Engaged";
  if (opens > 0) return "Light Engagement";
  return "No Engagement";
}

function committeeAction(level: string, title: string | null, unsubscribed: boolean, suppressed: boolean): string {
  if (unsubscribed) return "Do not contact — unsubscribed";
  if (suppressed) return "Do not contact — suppressed/compliance risk";
  if (level === "Hot Contact") {
    const { label } = roleSignal(title);
    if (label === "Owner/CEO") return "Call now — decision-maker is engaged";
    if (label === "GM") return "Call now — GM is ready to talk";
    return "Call now";
  }
  if (level === "Engaged") {
    const { label } = roleSignal(title);
    if (label === "Marine Electrician") return "Send technical follow-up";
    return "Send ROI follow-up";
  }
  if (level === "Light Engagement") return "Ask for referral to decision-maker";
  return "Move to nurture";
}

function nextAction(score: number, engagedRoles: string[], totalReplies: number, accountName: string): string {
  if (score >= 80) {
    if (engagedRoles.includes("Owner/CEO")) return `Call decision-maker at ${accountName} — high engagement detected`;
    if (engagedRoles.includes("GM")) return `Call GM at ${accountName} — ready for a conversation`;
    if (totalReplies > 0) return `Follow up on reply from ${accountName} — schedule a demo`;
    return `Schedule a demo with ${accountName} — account is hot`;
  }
  if (score >= 60) {
    if (engagedRoles.includes("Harbormaster")) return `Send technical follow-up to harbormaster at ${accountName}`;
    if (engagedRoles.includes("Marine Electrician")) return `Send technical follow-up to electrician at ${accountName}`;
    return `Send ROI case study to ${accountName} — warming up`;
  }
  if (score >= 40) return `Nurture ${accountName} — add to awareness campaign`;
  if (score >= 20) return `Low engagement at ${accountName} — try a different channel`;
  return `${accountName} not yet ready — revisit in 90 days`;
}

/** Safe domain extractor — rejects anything that doesn't look like a hostname */
function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  const raw = website
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split("?")[0]
    .toLowerCase()
    .trim();
  // Must look like a real hostname: letters, digits, hyphens, dots only
  if (!raw || !/^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?$/.test(raw)) return null;
  return raw;
}

// ── calculateAccountHeatScore ─────────────────────────────────────────────────

export async function calculateAccountHeatScore(accountId: number): Promise<AccountHeatScore | null> {
  const safeId = Number(accountId);
  if (!safeId || isNaN(safeId)) return null;

  // Account metadata
  const acctRows = await db.execute(sql.raw(
    `SELECT id, name, marina_type, market_segment, region, city, country, website
     FROM accounts WHERE id = ${safeId} LIMIT 1`
  ));
  if (!acctRows.rows.length) return null;
  const acct = acctRows.rows[0] as any;

  // Campaign recipient aggregates per contact at this account
  const recRows = await db.execute(sql.raw(
    `SELECT cr.contact_id, cr.email, cr.name, cr.role,
            cr.status, cr.opened_count, cr.clicked_count,
            cr.replied_at, cr.unsubscribed_at, cr.last_sent_at,
            COUNT(DISTINCT cr.campaign_id) AS campaign_count
     FROM campaign_recipients cr
     WHERE cr.account_id = ${safeId}
     GROUP BY cr.id`
  ));
  const recs = recRows.rows as any[];

  // Contact compliance data
  const ctRows = await db.execute(sql.raw(
    `SELECT id, name, title, email, persona, role_type,
            unsubscribe_status, suppression_status, consent_status,
            implied_consent_expiry_date
     FROM contacts WHERE account_id = ${safeId}`
  ));
  const contacts = ctRows.rows as any[];

  // Campaign events for timing signals + spam complaints
  const evtRows = await db.execute(sql.raw(
    `SELECT event_type, event_timestamp, contact_id
     FROM campaign_events
     WHERE account_id = ${safeId}
     ORDER BY event_timestamp DESC`
  ));
  const events = evtRows.rows as any[];

  // Spam complaints from campaign events
  const spamComplaintCount = events.filter(e =>
    e.event_type === "spam_complaint" || e.event_type === "complained"
  ).length;

  // Distinct campaign count
  const campRows = await db.execute(sql.raw(
    `SELECT COUNT(DISTINCT campaign_id) AS n FROM campaign_recipients WHERE account_id = ${safeId}`
  ));
  const campaignCount = Number((campRows.rows[0] as any)?.n ?? 0);

  // Domain suppression check — only if domain passes format validation
  const rawDomain = extractDomain(acct.website);
  let isDomainSuppressed = false;
  if (rawDomain) {
    const suppRows = await db.execute(sql.raw(
      `SELECT id FROM campaign_suppression WHERE domain = '${rawDomain}' LIMIT 1`
    ));
    isDomainSuppressed = suppRows.rows.length > 0;
  }

  // Aggregate stats
  let totalSent = 0, totalOpens = 0, totalClicks = 0, totalReplies = 0, totalUnsubs = 0;
  const engagedContactIds = new Set<number>();
  const engagedRoles: string[] = [];
  let latestEngagementAt: Date | null = null;

  for (const r of recs) {
    const opens = Number(r.opened_count ?? 0);
    const clicks = Number(r.clicked_count ?? 0);
    const replied = r.replied_at != null;
    const unsub = r.unsubscribed_at != null;
    if (r.last_sent_at) totalSent++;
    totalOpens += opens;
    totalClicks += clicks;
    if (replied) totalReplies++;
    if (unsub) totalUnsubs++;
    if (opens > 0 || clicks > 0 || replied) {
      if (r.contact_id) engagedContactIds.add(Number(r.contact_id));
      const { label } = roleSignal(r.role);
      if (label && !engagedRoles.includes(label)) engagedRoles.push(label);
    }
  }

  for (const e of events) {
    if (!["opened", "clicked", "replied"].includes(e.event_type)) continue;
    const ts = new Date(e.event_timestamp);
    if (!latestEngagementAt || ts > latestEngagementAt) latestEngagementAt = ts;
  }

  const now = new Date();
  const last7 = new Date(now.getTime() - 7 * 86400000);
  const last30 = new Date(now.getTime() - 30 * 86400000);
  const hasLast7 = latestEngagementAt != null && latestEngagementAt >= last7;
  const hasLast30 = latestEngagementAt != null && latestEngagementAt >= last30;

  let consentExpiredCount = 0;
  for (const c of contacts) {
    if (c.implied_consent_expiry_date) {
      const exp = new Date(c.implied_consent_expiry_date);
      if (exp < now) consentExpiredCount++;
    }
  }

  // ── Score calculation ──────────────────────────────────────────────────────
  let score = 0;
  const scoreReasons: string[] = [];
  const negativeReasons: string[] = [];

  // Engagement: opens
  if (totalOpens >= 1) {
    score += 3;
    const extra = Math.min(totalOpens - 1, 10);
    score += extra;
    scoreReasons.push(`${totalOpens} open${totalOpens !== 1 ? "s" : ""} recorded`);
  }

  // Engagement: clicks
  if (totalClicks >= 1) {
    score += 8;
    const extra = Math.min((totalClicks - 1) * 2, 12);
    score += extra;
    scoreReasons.push(`${totalClicks} click${totalClicks !== 1 ? "s" : ""} on campaign link${totalClicks !== 1 ? "s" : ""}`);
  }

  // Replies — classification-aware scoring (Phase 7)
  // Use per-classification scores from campaign_reply_classifications when available.
  // Falls back to the generic heuristic (+20/reply capped at 60) if no data exists yet.
  try {
    const replyClassScore = await getAccountReplyClassificationScore(accountId);
    if (replyClassScore.delta !== 0 || replyClassScore.reasons.length > 0 || replyClassScore.negativeReasons.length > 0) {
      score += replyClassScore.delta;
      scoreReasons.push(...replyClassScore.reasons);
      negativeReasons.push(...replyClassScore.negativeReasons);
    } else if (totalReplies >= 1) {
      const add = Math.min(totalReplies * 20, 60);
      score += add;
      scoreReasons.push(`${totalReplies} repl${totalReplies !== 1 ? "ies" : "y"} to campaign email`);
    }
  } catch {
    if (totalReplies >= 1) {
      const add = Math.min(totalReplies * 20, 60);
      score += add;
      scoreReasons.push(`${totalReplies} repl${totalReplies !== 1 ? "ies" : "y"} to campaign email`);
    }
  }

  // Multi-contact engagement
  if (engagedContactIds.size >= 2) {
    score += 15;
    scoreReasons.push(`${engagedContactIds.size} contacts from this account engaged`);
  }

  // Recency
  if (hasLast7) {
    score += 15;
    scoreReasons.push("Engaged in the last 7 days");
  } else if (hasLast30) {
    score += 8;
    scoreReasons.push("Engaged in the last 30 days");
  }

  // Stakeholder role bonus (best single role among engaged recipients)
  let bestRoleScore = 0;
  let bestRoleLabel: string | null = null;
  for (const r of recs) {
    const hasEngagement = (Number(r.opened_count ?? 0) > 0 || r.replied_at || Number(r.clicked_count ?? 0) > 0);
    if (!hasEngagement) continue;
    const { score: rs, label } = roleSignal(r.role);
    if (rs > bestRoleScore) { bestRoleScore = rs; bestRoleLabel = label; }
  }
  if (bestRoleScore > 0 && bestRoleLabel) {
    score += bestRoleScore;
    scoreReasons.push(`${bestRoleLabel} is actively engaged`);
  }

  // Persona/fit bonus
  const { score: fitScore, reason: fitReason } = personaFit(acct.marina_type, acct.market_segment);
  if (fitScore > 0 && fitReason) {
    score += fitScore;
    scoreReasons.push(fitReason);
  } else if (fitScore < 0 && fitReason && engagedContactIds.size === 0) {
    score += fitScore;
    negativeReasons.push(fitReason + " with no campaign engagement");
  }

  // Negative: unsubscribes
  if (totalUnsubs > 0) {
    score -= 10;
    negativeReasons.push(`${totalUnsubs} contact${totalUnsubs !== 1 ? "s" : ""} unsubscribed`);
  }

  // Negative: spam complaints
  if (spamComplaintCount > 0) {
    score -= 20;
    negativeReasons.push(`${spamComplaintCount} spam complaint${spamComplaintCount !== 1 ? "s" : ""} received`);
  }

  // Negative: domain suppressed
  if (isDomainSuppressed) {
    score -= 30;
    negativeReasons.push("Domain is suppressed from sending");
  }

  // Negative: no engagement after 3+ sends
  const sentCount = recs.filter(r => r.last_sent_at != null).length;
  const unengaged = recs.filter(r =>
    r.last_sent_at != null &&
    Number(r.opened_count ?? 0) === 0 &&
    Number(r.clicked_count ?? 0) === 0 &&
    r.replied_at == null
  ).length;
  if (sentCount >= 3 && unengaged === sentCount) {
    score -= 10;
    negativeReasons.push("No engagement after 3+ emails sent");
  }

  // Negative: consent expired
  if (consentExpiredCount > 0) {
    score -= 15;
    negativeReasons.push(`${consentExpiredCount} contact${consentExpiredCount !== 1 ? "s have" : " has"} expired consent`);
  }

  score = Math.max(0, Math.min(100, score));

  return {
    accountId: safeId,
    accountName: acct.name,
    marinaType: acct.marina_type ?? null,
    region: acct.region ?? acct.city ?? null,
    city: acct.city ?? null,
    heatScore: score,
    heatLabel: heatLabelOf(score),
    scoreReasons,
    negativeReasons,
    latestEngagementAt: latestEngagementAt?.toISOString() ?? null,
    engagedContactsCount: engagedContactIds.size,
    engagedRoles,
    campaignCount,
    sentCount,
    openCount: totalOpens,
    clickCount: totalClicks,
    replyCount: totalReplies,
    unsubscribeCount: totalUnsubs,
    spamComplaintCount,
    complianceRiskCount: consentExpiredCount + (isDomainSuppressed ? 1 : 0) + spamComplaintCount,
    recommendedNextAction: nextAction(score, engagedRoles, totalReplies, acct.name),
  };
}

// ── listHotAccounts ────────────────────────────────────────────────────────────

export async function listHotAccounts(filters: HotAccountsFilter = {}): Promise<AccountHeatScore[]> {
  let baseQ = `SELECT DISTINCT cr.account_id FROM campaign_recipients cr WHERE cr.account_id IS NOT NULL`;
  if (filters.campaignId) baseQ += ` AND cr.campaign_id = ${Number(filters.campaignId)}`;
  if (filters.adoptionStage) {
    const safe = filters.adoptionStage.replace(/'/g, "''").slice(0, 100);
    baseQ += ` AND cr.adoption_stage = '${safe}'`;
  }

  const idRows = await db.execute(sql.raw(baseQ));
  const ids = (idRows.rows as any[]).map(r => Number(r.account_id)).filter(Boolean);
  if (!ids.length) return [];

  const scores = await Promise.all(ids.map(id => calculateAccountHeatScore(id)));
  let results = scores.filter((s): s is AccountHeatScore => s !== null);

  if (filters.label) results = results.filter(r => r.heatLabel === filters.label);
  if (filters.minScore !== undefined) {
    const bound = Math.max(0, Math.min(100, filters.minScore));
    results = results.filter(r => r.heatScore >= bound);
  }
  if (filters.persona) {
    const pl = filters.persona.toLowerCase();
    // Match against both marinaType and the region field for broader coverage
    results = results.filter(r =>
      (r.marinaType ?? "").toLowerCase().includes(pl) ||
      (r.region ?? "").toLowerCase().includes(pl)
    );
  }
  if (filters.region) {
    const rl = filters.region.toLowerCase();
    results = results.filter(r => (r.region ?? "").toLowerCase().includes(rl));
  }
  if (filters.complianceRisk) results = results.filter(r => r.complianceRiskCount > 0 || r.negativeReasons.length > 0);

  if (filters.sort === "latest") {
    results.sort((a, b) => {
      const ta = a.latestEngagementAt ? new Date(a.latestEngagementAt).getTime() : 0;
      const tb = b.latestEngagementAt ? new Date(b.latestEngagementAt).getTime() : 0;
      return tb - ta;
    });
  } else if (filters.sort === "clicks") {
    results.sort((a, b) => b.clickCount - a.clickCount);
  } else {
    results.sort((a, b) => b.heatScore - a.heatScore);
  }

  return results.slice(0, filters.limit ?? 50);
}

// ── getAccountBuyingCommittee ─────────────────────────────────────────────────
// Batched: all contact stats in one SQL query + one query for latest events.
// Avoids the N+1 pattern of per-contact queries.

export async function getAccountBuyingCommittee(accountId: number): Promise<BuyingCommitteeMember[]> {
  const safeId = Number(accountId);

  const ctRows = await db.execute(sql.raw(
    `SELECT id, name, title, email, persona, role_type,
            unsubscribe_status, suppression_status, consent_status,
            implied_consent_expiry_date
     FROM contacts WHERE account_id = ${safeId} ORDER BY name`
  ));
  const contacts = ctRows.rows as any[];
  if (!contacts.length) return [];

  const contactIds = contacts.map(c => Number(c.id));
  const idsLiteral = contactIds.join(",");

  // Batch: aggregated campaign stats per contact
  const statsRows = await db.execute(sql.raw(
    `SELECT
       cr.contact_id,
       COUNT(DISTINCT cr.campaign_id)                              AS campaigns_received,
       COUNT(*)                                                    AS sent_count,
       COALESCE(SUM(cr.opened_count), 0)                          AS open_count,
       COALESCE(SUM(cr.clicked_count), 0)                         AS click_count,
       COUNT(*) FILTER (WHERE cr.replied_at IS NOT NULL)          AS reply_count,
       COUNT(*) FILTER (WHERE cr.unsubscribed_at IS NOT NULL)     AS unsub_count
     FROM campaign_recipients cr
     WHERE cr.contact_id IN (${idsLiteral})
     GROUP BY cr.contact_id`
  ));
  const statsMap = new Map<number, any>();
  for (const r of statsRows.rows as any[]) {
    statsMap.set(Number(r.contact_id), r);
  }

  // Batch: latest engagement timestamp per contact
  const evtRows = await db.execute(sql.raw(
    `SELECT DISTINCT ON (contact_id)
       contact_id, event_timestamp
     FROM campaign_events
     WHERE contact_id IN (${idsLiteral})
       AND event_type IN ('opened', 'clicked', 'replied')
     ORDER BY contact_id, event_timestamp DESC`
  ));
  const evtMap = new Map<number, any>();
  for (const r of evtRows.rows as any[]) {
    evtMap.set(Number(r.contact_id), r.event_timestamp);
  }

  const now = new Date();
  const members: BuyingCommitteeMember[] = [];

  for (const c of contacts) {
    const st = statsMap.get(Number(c.id)) ?? {};
    const lastEvt = evtMap.get(Number(c.id)) ?? null;

    const opens = Number(st.open_count ?? 0);
    const clicks = Number(st.click_count ?? 0);
    const replies = Number(st.reply_count ?? 0);
    const unsubscribed = c.unsubscribe_status === "unsubscribed";
    const suppressed = c.suppression_status != null && c.suppression_status !== "none";

    const level = contactEngagementLevel(opens, clicks, replies, unsubscribed, suppressed);
    const action = committeeAction(level, c.title, unsubscribed, suppressed);

    let complianceStatus = "OK";
    if (unsubscribed) complianceStatus = "Unsubscribed";
    else if (suppressed) complianceStatus = "Suppressed";
    else if (c.implied_consent_expiry_date && new Date(c.implied_consent_expiry_date) < now) complianceStatus = "Consent Expired";
    else if (c.consent_status === "unknown") complianceStatus = "Unknown Consent";

    members.push({
      contactId: Number(c.id),
      name: c.name,
      title: c.title ?? null,
      email: c.email ?? null,
      stakeholderType: stakeholderType(c.title),
      complianceStatus,
      campaignsReceived: Number(st.campaigns_received ?? 0),
      sentCount: Number(st.sent_count ?? 0),
      openCount: opens,
      clickCount: clicks,
      replyCount: replies,
      unsubscribed,
      suppressed,
      spamComplaint: false,
      lastEngagementAt: lastEvt ? new Date(lastEvt).toISOString() : null,
      engagementLevel: level,
      recommendedAction: action,
    });
  }

  const ORDER = ["Hot Contact", "Engaged", "Light Engagement", "No Engagement", "Do Not Email"];
  return members.sort((a, b) => ORDER.indexOf(a.engagementLevel) - ORDER.indexOf(b.engagementLevel));
}

// ── getAccountCampaignEngagement ──────────────────────────────────────────────

export async function getAccountCampaignEngagement(accountId: number): Promise<AccountCampaignEngagement[]> {
  const safeId = Number(accountId);
  const rows = await db.execute(sql.raw(
    `SELECT
       mc.id AS campaign_id, mc.campaign_name, mc.campaign_type, mc.status,
       MIN(cr.last_sent_at)                                  AS sent_at,
       COALESCE(SUM(cr.opened_count), 0)                     AS open_count,
       COALESCE(SUM(cr.clicked_count), 0)                    AS click_count,
       COUNT(*) FILTER (WHERE cr.replied_at IS NOT NULL)     AS reply_count,
       COUNT(*) FILTER (WHERE cr.unsubscribed_at IS NOT NULL) AS unsub_count,
       COUNT(*)                                              AS recipient_count
     FROM campaign_recipients cr
     JOIN marketing_campaigns mc ON mc.id = cr.campaign_id
     WHERE cr.account_id = ${safeId}
     GROUP BY mc.id, mc.campaign_name, mc.campaign_type, mc.status
     ORDER BY MIN(cr.last_sent_at) DESC NULLS LAST`
  ));
  return (rows.rows as any[]).map(r => ({
    campaignId: Number(r.campaign_id),
    campaignName: r.campaign_name,
    campaignType: r.campaign_type,
    status: r.status,
    sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    openCount: Number(r.open_count ?? 0),
    clickCount: Number(r.click_count ?? 0),
    replyCount: Number(r.reply_count ?? 0),
    unsubscribeCount: Number(r.unsub_count ?? 0),
    recipientCount: Number(r.recipient_count ?? 0),
  }));
}

// ── getRecommendedNextAction ──────────────────────────────────────────────────

export async function getRecommendedNextAction(accountId: number): Promise<string> {
  const s = await calculateAccountHeatScore(accountId);
  return s?.recommendedNextAction ?? "Account not found";
}
