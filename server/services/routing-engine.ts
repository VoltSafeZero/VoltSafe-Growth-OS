import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  scoreLeadQuality,
  scoreOpportunityClose,
  scoreDeploymentDelayRisk,
} from "./scoring-engine";

export type EntityType = "lead" | "account" | "opportunity" | "deployment";

export interface RankedStop {
  entityType: EntityType;
  entityId: number;
  entityName: string;
  entitySubtype: string;
  lat: number;
  lng: number;
  address: string;
  city: string;
  region: string;
  territory: string;
  distanceKm: number;
  predictiveScore: number;
  scoreLabel: string;
  compositeScore: number;
  reasons: string[];
  priorityColor: "red" | "orange" | "yellow" | "green";
  link: string;
  phone?: string;
  email?: string;
  status: string;
}

export interface NearbyRankedOptions {
  lat: number;
  lng: number;
  radiusKm?: number;
  maxStops?: number;
  recordTypes?: EntityType[];
  scoreThreshold?: number;
  urgencyFilter?: "all" | "overdue" | "hot" | "at_risk";
}

export interface RouteSuggestion {
  title: string;
  subtitle: string;
  count: number;
  type: EntityType;
  icon: string;
  link: string;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function boundingBox(lat: number, lng: number, radiusKm: number) {
  const latDeg = radiusKm / 111.0;
  const lngDeg = radiusKm / (111.0 * Math.cos(lat * Math.PI / 180));
  return { minLat: lat - latDeg, maxLat: lat + latDeg, minLng: lng - lngDeg, maxLng: lng + lngDeg };
}

function distanceScore(distKm: number, radiusKm: number): number {
  return Math.max(0, 100 * (1 - distKm / radiusKm));
}

function priorityColor(composite: number): "red" | "orange" | "yellow" | "green" {
  if (composite >= 75) return "red";
  if (composite >= 55) return "orange";
  if (composite >= 35) return "yellow";
  return "green";
}

async function fetchNearbyLeads(
  lat: number, lng: number, box: ReturnType<typeof boundingBox>, radiusKm: number
) {
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT l.id, l.company AS name, l.source, l.contact_email, l.contact_phone,
        l.deal_amount, l.status, l.region, l.territory_id, l.next_step, l.est_close_date, l.updated_at,
        l.owner_user_id, l.estimated_slips_impacted, l.street_address AS address_raw, l.city, l.state AS region2,
        m.latitude AS loc_lat, m.longitude AS loc_lng, m.street_address AS loc_address, m.name AS marina_name,
        (6371 * acos(LEAST(1.0,
          cos(radians(${lat})) * cos(radians(m.latitude)) * cos(radians(m.longitude) - radians(${lng})) +
          sin(radians(${lat})) * sin(radians(m.latitude))
        ))) AS distance_km,
        (SELECT COUNT(*) FROM tasks t WHERE t.linked_object_type='lead' AND t.linked_object_id=l.id
          AND t.status NOT IN ('done','completed','dismissed') AND t.due_date < NOW()) AS overdue_tasks,
        (SELECT COUNT(*) FROM quotes q JOIN opportunities o ON q.opportunity_id=o.id WHERE o.account_id=l.id
          AND q.status='sent' AND q.valid_until < NOW() + INTERVAL '7 days') AS expiring_quotes
      FROM leads l
      JOIN marinas m ON l.marina_id = m.id
      WHERE m.latitude IS NOT NULL AND m.longitude IS NOT NULL
        AND m.latitude BETWEEN ${box.minLat} AND ${box.maxLat}
        AND m.longitude BETWEEN ${box.minLng} AND ${box.maxLng}
        AND l.status NOT IN ('closed_won','closed_lost','disqualified','converted')
      UNION ALL
      SELECT l.id, l.company AS name, l.source, l.contact_email, l.contact_phone,
        l.deal_amount, l.status, l.region, l.territory_id, l.next_step, l.est_close_date, l.updated_at,
        l.owner_user_id, l.estimated_slips_impacted, l.street_address AS address_raw, l.city, l.state AS region2,
        l.lead_lat AS loc_lat, l.lead_lng AS loc_lng, l.street_address AS loc_address, l.company AS marina_name,
        (6371 * acos(LEAST(1.0,
          cos(radians(${lat})) * cos(radians(l.lead_lat)) * cos(radians(l.lead_lng) - radians(${lng})) +
          sin(radians(${lat})) * sin(radians(l.lead_lat))
        ))) AS distance_km,
        (SELECT COUNT(*) FROM tasks t WHERE t.linked_object_type='lead' AND t.linked_object_id=l.id
          AND t.status NOT IN ('done','completed','dismissed') AND t.due_date < NOW()) AS overdue_tasks,
        0 AS expiring_quotes
      FROM leads l
      WHERE l.marina_id IS NULL
        AND l.lead_lat IS NOT NULL AND l.lead_lng IS NOT NULL
        AND l.lead_lat BETWEEN ${box.minLat} AND ${box.maxLat}
        AND l.lead_lng BETWEEN ${box.minLng} AND ${box.maxLng}
        AND l.status NOT IN ('closed_won','closed_lost','disqualified','converted')
    ) sub
    WHERE distance_km <= ${radiusKm}
    ORDER BY distance_km ASC
    LIMIT 150
  `);
  return rows.rows as any[];
}

async function fetchNearbyAccounts(
  lat: number, lng: number, box: ReturnType<typeof boundingBox>, radiusKm: number
) {
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT a.id, a.name, a.city, a.state_province AS region2, a.region, a.latitude AS loc_lat, a.longitude AS loc_lng,
        a.street_address AS address_raw, a.priority, a.lead_status AS status, a.tags, a.territory_id,
        a.last_interaction_at, a.next_action, a.next_action_at, a.slip_count,
        (6371 * acos(LEAST(1.0,
          cos(radians(${lat})) * cos(radians(a.latitude)) * cos(radians(a.longitude) - radians(${lng})) +
          sin(radians(${lat})) * sin(radians(a.latitude))
        ))) AS distance_km,
        (SELECT COUNT(*) FROM tasks t WHERE t.linked_object_type='account' AND t.linked_object_id=a.id
          AND t.status NOT IN ('done','completed','dismissed') AND t.due_date < NOW()) AS overdue_tasks,
        (SELECT COUNT(*) FROM customer_subscriptions cs WHERE cs.account_id=a.id AND cs.health_status IN ('at_risk','critical')) AS at_risk_subs
      FROM accounts a
      WHERE a.latitude IS NOT NULL AND a.longitude IS NOT NULL
        AND a.latitude BETWEEN ${box.minLat} AND ${box.maxLat}
        AND a.longitude BETWEEN ${box.minLng} AND ${box.maxLng}
    ) sub
    WHERE distance_km <= ${radiusKm}
    ORDER BY distance_km ASC
    LIMIT 100
  `);
  return rows.rows as any[];
}

async function fetchNearbyOpportunities(
  lat: number, lng: number, box: ReturnType<typeof boundingBox>, radiusKm: number
) {
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT o.id, o.title AS name, o.stage, o.amount, o.est_close_date, o.is_stalled,
        o.owner_user_id, o.champion_identified, o.economic_buyer_identified,
        o.decision_criteria_known, o.pain_clarity, o.risk_flags, o.forecast_category,
        o.last_activity_date, o.updated_at,
        a.name AS account_name, a.city, a.region, a.latitude AS loc_lat, a.longitude AS loc_lng,
        a.street_address AS address_raw, a.territory_id,
        (6371 * acos(LEAST(1.0,
          cos(radians(${lat})) * cos(radians(a.latitude)) * cos(radians(a.longitude) - radians(${lng})) +
          sin(radians(${lat})) * sin(radians(a.latitude))
        ))) AS distance_km,
        (SELECT COUNT(*) FROM quotes q WHERE q.opportunity_id=o.id AND q.status NOT IN ('archived','declined')) AS quote_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.linked_object_type='opportunity' AND t.linked_object_id=o.id
          AND t.status NOT IN ('done','completed','dismissed') AND t.due_date < NOW()) AS overdue_tasks
      FROM opportunities o
      JOIN accounts a ON a.id = o.account_id
      WHERE a.latitude IS NOT NULL AND a.longitude IS NOT NULL
        AND a.latitude BETWEEN ${box.minLat} AND ${box.maxLat}
        AND a.longitude BETWEEN ${box.minLng} AND ${box.maxLng}
        AND o.stage NOT IN ('closed_won','closed_lost')
    ) sub
    WHERE distance_km <= ${radiusKm}
    ORDER BY distance_km ASC
    LIMIT 100
  `);
  return rows.rows as any[];
}

async function fetchNearbyDeployments(
  lat: number, lng: number, box: ReturnType<typeof boundingBox>, radiusKm: number
) {
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT d.id, d.site_name AS name, d.status, d.deploy_number, d.planned_start, d.target_go_live,
        d.blockers, d.region, d.updated_at,
        a.name AS account_name, a.city, a.latitude AS loc_lat, a.longitude AS loc_lng,
        a.street_address AS address_raw, a.territory_id,
        (6371 * acos(LEAST(1.0,
          cos(radians(${lat})) * cos(radians(a.latitude)) * cos(radians(a.longitude) - radians(${lng})) +
          sin(radians(${lat})) * sin(radians(a.latitude))
        ))) AS distance_km,
        (SELECT COUNT(*) FROM deployment_blockers b WHERE b.deployment_id=d.id AND b.status='open') AS open_blockers,
        (SELECT COUNT(*) FROM deployment_blockers b WHERE b.deployment_id=d.id AND b.status='open' AND b.severity='critical') AS critical_blockers
      FROM deployments d
      JOIN accounts a ON a.id = d.account_id
      WHERE a.latitude IS NOT NULL AND a.longitude IS NOT NULL
        AND a.latitude BETWEEN ${box.minLat} AND ${box.maxLat}
        AND a.longitude BETWEEN ${box.minLng} AND ${box.maxLng}
        AND d.status NOT IN ('completed','live','cancelled')
    ) sub
    WHERE distance_km <= ${radiusKm}
    ORDER BY distance_km ASC
    LIMIT 100
  `);
  return rows.rows as any[];
}

function rankLead(row: any, lat: number, lng: number, radiusKm: number): RankedStop {
  const distKm = parseFloat(row.distance_km ?? 0);
  const dScore = distanceScore(distKm, radiusKm);
  const overdue = parseInt(row.overdue_tasks ?? 0);
  const expiringQ = parseInt(row.expiring_quotes ?? 0);

  const s = scoreLeadQuality({
    source: row.source,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    ownerUserId: row.owner_user_id,
    dealAmount: row.deal_amount,
    estimatedSlipsImpacted: row.estimated_slips_impacted,
    status: row.status,
    updatedAt: row.updated_at,
    nextStep: row.next_step,
    region: row.region,
    overdueTaskCount: overdue,
  });

  const reasons: string[] = [];
  reasons.push(`${distKm.toFixed(1)} km away`);
  if (s.band === "critical" || s.band === "high") reasons.push(`Lead score ${s.score} (${s.band})`);
  if (overdue > 0) reasons.push(`${overdue} overdue task${overdue > 1 ? "s" : ""}`);
  if (expiringQ > 0) reasons.push("Quote expiring soon");
  if (row.next_step) reasons.push("Has next step");

  const overdueBonus = Math.min(overdue * 8, 20);
  const urgencyBonus = expiringQ > 0 ? 10 : 0;
  const composite = Math.min(100, dScore * 0.35 + s.score * 0.45 + overdueBonus + urgencyBonus);

  return {
    entityType: "lead",
    entityId: row.id,
    entityName: row.name ?? "Unknown Lead",
    entitySubtype: row.status ?? "prospect",
    lat: parseFloat(row.loc_lat),
    lng: parseFloat(row.loc_lng),
    address: [row.address_raw, row.city].filter(Boolean).join(", "),
    city: row.city ?? "",
    region: row.region ?? row.region2 ?? "",
    territory: String(row.territory_id ?? ""),
    distanceKm: distKm,
    predictiveScore: s.score,
    scoreLabel: s.band,
    compositeScore: composite,
    reasons,
    priorityColor: priorityColor(composite),
    link: `/leads/${row.id}`,
    phone: row.contact_phone,
    email: row.contact_email,
    status: row.status ?? "prospect",
  };
}

function rankAccount(row: any, lat: number, lng: number, radiusKm: number): RankedStop {
  const distKm = parseFloat(row.distance_km ?? 0);
  const dScore = distanceScore(distKm, radiusKm);
  const overdue = parseInt(row.overdue_tasks ?? 0);
  const atRisk = parseInt(row.at_risk_subs ?? 0);

  const priorityBonus = row.priority === "high" ? 15 : row.priority === "critical" ? 20 : row.priority === "medium" ? 5 : 0;
  const atRiskBonus = atRisk > 0 ? 15 : 0;
  const overdueBonus = Math.min(overdue * 8, 20);

  const baseScore = 50 + priorityBonus;
  const composite = Math.min(100, dScore * 0.40 + baseScore * 0.35 + overdueBonus + atRiskBonus);

  const reasons: string[] = [];
  reasons.push(`${distKm.toFixed(1)} km away`);
  if (row.priority === "high" || row.priority === "critical") reasons.push(`${row.priority} priority account`);
  if (overdue > 0) reasons.push(`${overdue} overdue task${overdue > 1 ? "s" : ""}`);
  if (atRisk > 0) reasons.push("At-risk subscription");
  const daysSince = row.last_interaction_at
    ? Math.floor((Date.now() - new Date(row.last_interaction_at).getTime()) / 86400000)
    : null;
  if (daysSince !== null && daysSince > 30) reasons.push(`${daysSince}d since last contact`);

  return {
    entityType: "account",
    entityId: row.id,
    entityName: row.name ?? "Unknown Account",
    entitySubtype: row.priority ?? "standard",
    lat: parseFloat(row.loc_lat),
    lng: parseFloat(row.loc_lng),
    address: [row.address_raw, row.city].filter(Boolean).join(", "),
    city: row.city ?? "",
    region: row.region ?? row.region2 ?? "",
    territory: String(row.territory_id ?? ""),
    distanceKm: distKm,
    predictiveScore: Math.min(100, baseScore),
    scoreLabel: atRisk > 0 ? "at_risk" : row.priority ?? "medium",
    compositeScore: composite,
    reasons,
    priorityColor: priorityColor(composite),
    link: `/accounts/${row.id}`,
    status: row.status ?? "customer",
  };
}

function rankOpportunity(row: any, lat: number, lng: number, radiusKm: number): RankedStop {
  const distKm = parseFloat(row.distance_km ?? 0);
  const dScore = distanceScore(distKm, radiusKm);
  const overdue = parseInt(row.overdue_tasks ?? 0);

  const s = scoreOpportunityClose({
    stage: row.stage,
    estCloseDate: row.est_close_date,
    lastActivityDate: row.last_activity_date,
    isStalled: row.is_stalled,
    ownerUserId: row.owner_user_id,
    championIdentified: row.champion_identified,
    economicBuyerIdentified: row.economic_buyer_identified,
    decisionCriteriaKnown: row.decision_criteria_known,
    amount: row.amount,
    hasQuote: parseInt(row.quote_count ?? 0) > 0,
    painClarity: row.pain_clarity,
    riskFlags: row.risk_flags,
    forecastCategory: row.forecast_category,
    overdueTaskCount: overdue,
  });

  const overdueBonus = Math.min(overdue * 8, 20);
  const stalledBonus = row.is_stalled ? 10 : 0;
  const composite = Math.min(100, dScore * 0.35 + s.score * 0.45 + overdueBonus + stalledBonus);

  const reasons: string[] = [];
  reasons.push(`${distKm.toFixed(1)} km away`);
  if (s.band === "critical" || s.band === "high") reasons.push(`Opp score ${s.score} (${s.band})`);
  if (overdue > 0) reasons.push(`${overdue} overdue task${overdue > 1 ? "s" : ""}`);
  if (row.is_stalled) reasons.push("Deal stalled");
  if (row.est_close_date) {
    const days = Math.floor((new Date(row.est_close_date).getTime() - Date.now()) / 86400000);
    if (days >= 0 && days <= 14) reasons.push(`Closes in ${days}d`);
  }

  return {
    entityType: "opportunity",
    entityId: row.id,
    entityName: row.name ?? "Unknown Opportunity",
    entitySubtype: row.stage ?? "pipeline",
    lat: parseFloat(row.loc_lat),
    lng: parseFloat(row.loc_lng),
    address: [row.address_raw, row.city].filter(Boolean).join(", "),
    city: row.city ?? "",
    region: row.region ?? "",
    territory: String(row.territory_id ?? ""),
    distanceKm: distKm,
    predictiveScore: s.score,
    scoreLabel: s.band,
    compositeScore: composite,
    reasons,
    priorityColor: priorityColor(composite),
    link: `/opportunities/${row.id}`,
    status: row.stage ?? "pipeline",
  };
}

function rankDeployment(row: any, lat: number, lng: number, radiusKm: number): RankedStop {
  const distKm = parseFloat(row.distance_km ?? 0);
  const dScore = distanceScore(distKm, radiusKm);
  const openBlockers = parseInt(row.open_blockers ?? 0);
  const criticalBlockers = parseInt(row.critical_blockers ?? 0);

  const s = scoreDeploymentDelayRisk({
    status: row.status,
    plannedStart: row.planned_start,
    actualStart: row.actual_start,
    targetGoLive: row.target_go_live,
    blockers: row.blockers,
    openBlockerCount: openBlockers,
    criticalBlockerCount: criticalBlockers,
  });

  const blockerBonus = Math.min(openBlockers * 10, 25);
  const critBonus = criticalBlockers * 5;
  const composite = Math.min(100, dScore * 0.30 + s.score * 0.50 + blockerBonus + critBonus);

  const reasons: string[] = [];
  reasons.push(`${distKm.toFixed(1)} km away`);
  if (s.band === "critical" || s.band === "high") reasons.push(`Risk score ${s.score} (${s.band})`);
  if (criticalBlockers > 0) reasons.push(`${criticalBlockers} critical blocker${criticalBlockers > 1 ? "s" : ""}`);
  else if (openBlockers > 0) reasons.push(`${openBlockers} open blocker${openBlockers > 1 ? "s" : ""}`);
  if (row.target_go_live) {
    const days = Math.floor((new Date(row.target_go_live).getTime() - Date.now()) / 86400000);
    if (days >= 0 && days <= 21) reasons.push(`Go-live in ${days}d`);
    else if (days < 0) reasons.push("Go-live date passed");
  }

  return {
    entityType: "deployment",
    entityId: row.id,
    entityName: row.name ?? "Unknown Deployment",
    entitySubtype: row.status ?? "planned",
    lat: parseFloat(row.loc_lat),
    lng: parseFloat(row.loc_lng),
    address: [row.address_raw, row.city].filter(Boolean).join(", "),
    city: row.city ?? "",
    region: row.region ?? "",
    territory: String(row.territory_id ?? ""),
    distanceKm: distKm,
    predictiveScore: s.score,
    scoreLabel: s.band,
    compositeScore: composite,
    reasons,
    priorityColor: priorityColor(composite),
    link: `/deployments/${row.id}`,
    status: row.status ?? "planned",
  };
}

export async function computeRankedNearby(options: NearbyRankedOptions): Promise<RankedStop[]> {
  const {
    lat,
    lng,
    radiusKm = 50,
    maxStops = 20,
    recordTypes = ["lead", "account", "opportunity", "deployment"],
    scoreThreshold = 0,
    urgencyFilter = "all",
  } = options;

  const box = boundingBox(lat, lng, radiusKm);
  const fetches: Promise<RankedStop[]>[] = [];

  if (recordTypes.includes("lead")) {
    fetches.push(
      fetchNearbyLeads(lat, lng, box, radiusKm).then(rows =>
        rows.map(r => rankLead(r, lat, lng, radiusKm))
      )
    );
  }
  if (recordTypes.includes("account")) {
    fetches.push(
      fetchNearbyAccounts(lat, lng, box, radiusKm).then(rows =>
        rows.map(r => rankAccount(r, lat, lng, radiusKm))
      )
    );
  }
  if (recordTypes.includes("opportunity")) {
    fetches.push(
      fetchNearbyOpportunities(lat, lng, box, radiusKm).then(rows =>
        rows.map(r => rankOpportunity(r, lat, lng, radiusKm))
      )
    );
  }
  if (recordTypes.includes("deployment")) {
    fetches.push(
      fetchNearbyDeployments(lat, lng, box, radiusKm).then(rows =>
        rows.map(r => rankDeployment(r, lat, lng, radiusKm))
      )
    );
  }

  const allGroups = await Promise.all(fetches);
  let all: RankedStop[] = allGroups.flat();

  if (scoreThreshold > 0) {
    all = all.filter(s => s.predictiveScore >= scoreThreshold);
  }

  if (urgencyFilter === "overdue") {
    all = all.filter(s => s.reasons.some(r => r.includes("overdue")));
  } else if (urgencyFilter === "hot") {
    all = all.filter(s => s.scoreLabel === "critical" || s.scoreLabel === "high");
  } else if (urgencyFilter === "at_risk") {
    all = all.filter(s => s.scoreLabel === "at_risk" || s.reasons.some(r => r.includes("blocker") || r.includes("stalled")));
  }

  all.sort((a, b) => b.compositeScore - a.compositeScore);
  return all.slice(0, maxStops).map((s, i) => ({ ...s, rank: i + 1 } as any));
}

export function generateDirectionsUrl(lat: number, lng: number, label: string): string {
  const encodedLabel = encodeURIComponent(label);
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodedLabel}`;
}

export function generateAppleMapsUrl(lat: number, lng: number, label: string): string {
  return `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`;
}

export async function getRouteSuggestions(
  lat: number,
  lng: number
): Promise<RouteSuggestion[]> {
  const box = boundingBox(lat, lng, 50);

  const [leadsR, deploysR] = await Promise.all([
    fetchNearbyLeads(lat, lng, box, 25).then(rows =>
      rows.map(r => rankLead(r, lat, lng, 25))
        .filter(s => s.scoreLabel === "critical" || s.scoreLabel === "high")
    ),
    fetchNearbyDeployments(lat, lng, box, 50).then(rows =>
      rows.map(r => rankDeployment(r, lat, lng, 50))
        .filter(s => s.scoreLabel === "critical" || s.scoreLabel === "high")
    ),
  ]);

  const suggestions: RouteSuggestion[] = [];

  if (leadsR.length > 0) {
    suggestions.push({
      title: `${leadsR.length} hot lead${leadsR.length > 1 ? "s" : ""} within 25 km`,
      subtitle: leadsR.slice(0, 2).map(l => l.entityName).join(", "),
      count: leadsR.length,
      type: "lead",
      icon: "🎯",
      link: "/routing",
    });
  }

  if (deploysR.length > 0) {
    suggestions.push({
      title: `${deploysR.length} at-risk deployment${deploysR.length > 1 ? "s" : ""} nearby`,
      subtitle: deploysR.slice(0, 2).map(d => d.entityName).join(", "),
      count: deploysR.length,
      type: "deployment",
      icon: "⚠️",
      link: "/routing",
    });
  }

  return suggestions;
}
