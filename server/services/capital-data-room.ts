// Capital Data Room — pure computation service (Phase 2G)
// No DB calls here — all inputs passed in by the route handler.
// TODO: When secure file storage is implemented, integrate upload/download
//       logic here behind requireCapitalAccess enforcement.

export const MATERIAL_TYPES = [
  "pitch_deck","executive_summary","financial_model","cap_table",
  "product_overview","technical_overview","patent_ip","customer_pipeline",
  "pilot_results","market_analysis","data_room_index","legal_docs",
  "subscription_agreement","due_diligence","board_material","grant_document","other",
] as const;

export const MATERIAL_STATUSES = [
  "draft","active","archived","superseded","restricted","pending_review",
] as const;

export const SHARE_STATUSES = [
  "not_shared","shared","viewed","downloaded","follow_up_needed",
  "stale","superseded","blocked","completed",
] as const;

export const REQUEST_STATUSES = [
  "requested","in_progress","ready","shared","blocked","waived","closed",
] as const;

export const SHARE_METHODS = [
  "email","data_room_link","manual","meeting","other",
] as const;

export const MATERIAL_TYPE_LABELS: Record<string, string> = {
  pitch_deck:            "Pitch Deck",
  executive_summary:     "Executive Summary",
  financial_model:       "Financial Model",
  cap_table:             "Cap Table",
  product_overview:      "Product Overview",
  technical_overview:    "Technical Overview",
  patent_ip:             "Patent / IP",
  customer_pipeline:     "Customer Pipeline",
  pilot_results:         "Pilot Results",
  market_analysis:       "Market Analysis",
  data_room_index:       "Data Room Index",
  legal_docs:            "Legal Docs",
  subscription_agreement:"Subscription Agreement",
  due_diligence:         "Due Diligence",
  board_material:        "Board Material",
  grant_document:        "Grant Document",
  other:                 "Other",
};

// Materials that every active investor in Diligence+ must have received
export const KEY_MATERIAL_TYPES = ["pitch_deck","financial_model","executive_summary"];

// Stages where key materials should already have been shared
export const DILIGENCE_STAGES = new Set([
  "Diligence","Partner Meeting","Soft Commit","Committed","Wired","Closed",
]);

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface Material {
  id: number;
  title: string;
  description: string | null;
  material_type: string;
  round_id: number | null;
  version_label: string | null;
  status: string;
  file_url: string | null;
  file_storage_key: string | null;
  external_url: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  tags: string | null;
  is_confidential: boolean;
  requires_nda: boolean;
  owner_user_id: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MaterialShare {
  id: number;
  material_id: number;
  investor_id: number | null;
  contact_id: number | null;
  round_id: number | null;
  share_method: string;
  email_thread_id: string | null;
  email_message_id: string | null;
  shared_at: string;
  shared_by: number | null;
  status: string;
  viewed_at: string | null;
  downloaded_at: string | null;
  last_activity_at: string | null;
  notes: string | null;
  deleted_at: string | null;
  // joined
  investor_name?: string;
  material_title?: string;
}

export interface MaterialRequest {
  id: number;
  investor_id: number | null;
  contact_id: number | null;
  round_id: number | null;
  requested_material_type: string | null;
  requested_title: string | null;
  request_status: string;
  priority: string;
  due_at: string | null;
  requested_by: number | null;
  requested_at: string;
  fulfilled_material_id: number | null;
  fulfilled_at: string | null;
  notes: string | null;
  deleted_at: string | null;
  // joined
  investor_name?: string;
}

export interface InvestorMaterialRow {
  material_id: number;
  material_title: string;
  material_type: string;
  version_label: string | null;
  material_status: string;
  share_id: number | null;
  share_method: string | null;
  shared_at: string | null;
  share_status: string | null;
  viewed_at: string | null;
  downloaded_at: string | null;
  contact_id: number | null;
  is_stale: boolean;
  is_superseded: boolean;
}

export interface DataRoomIntelligence {
  total_materials: number;
  active_materials: number;
  total_shares: number;
  has_pitch_deck: boolean;
  has_financial_model: boolean;
  key_materials_present: { type: string; label: string; count: number; latest_version: string | null }[];
  investors_with_pitch_deck: number;
  investors_without_key_materials: { investor_id: number; investor_name: string; stage: string; missing: string[] }[];
  stale_shares: { share_id: number; investor_id: number | null; investor_name: string; material_title: string; shared_at: string; days_since: number }[];
  superseded_outstanding: { share_id: number; investor_name: string; material_title: string; version_label: string | null }[];
  open_requests: number;
  overdue_requests: number;
  overdue_request_details: { id: number; investor_name: string; requested_title: string | null; due_at: string; days_overdue: number }[];
  diligence_blockers: { id: number; investor_name: string; type: string | null; title: string | null; priority: string }[];
}

export interface RiskFlag {
  level: "critical" | "warning" | "info";
  code: string;
  message: string;
}

// ── Core computations ─────────────────────────────────────────────────────────

export function computeDataRoomIntelligence(
  materials: Material[],
  shares: MaterialShare[],
  requests: MaterialRequest[],
  investors: any[]
): DataRoomIntelligence {
  const now = Date.now();

  const activeMaterials   = materials.filter(m => m.status === "active" && !m.deleted_at);
  const activeShares      = shares.filter(s => !s.deleted_at);
  const activeRequests    = requests.filter(r => !r.deleted_at);

  // Key materials presence
  const keyMaterialsPresent = KEY_MATERIAL_TYPES.map(type => {
    const mats = activeMaterials.filter(m => m.material_type === type);
    const latest = mats.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
    return {
      type,
      label: MATERIAL_TYPE_LABELS[type] ?? type,
      count: mats.length,
      latest_version: latest?.version_label ?? null,
    };
  });

  const hasPitchDeck      = keyMaterialsPresent.find(k => k.type === "pitch_deck")!.count > 0;
  const hasFinancialModel = keyMaterialsPresent.find(k => k.type === "financial_model")!.count > 0;

  // Investor coverage
  const activeInvestors = investors.filter(inv => !["Passed","Do Not Contact"].includes(inv.stage ?? ""));
  const diligenceInvestors = activeInvestors.filter(inv => DILIGENCE_STAGES.has(inv.stage ?? ""));

  const investorShareMap = new Map<number, Set<string>>();
  for (const s of activeShares) {
    if (!s.investor_id) continue;
    const mat = materials.find(m => m.id === s.material_id);
    if (!mat || mat.status === "superseded" || mat.deleted_at) continue;
    if (!investorShareMap.has(s.investor_id)) investorShareMap.set(s.investor_id, new Set());
    investorShareMap.get(s.investor_id)!.add(mat.material_type);
  }

  const investorsWithPitchDeck = [...investorShareMap.values()].filter(s => s.has("pitch_deck")).length;

  const investorsWithoutKeyMaterials = diligenceInvestors
    .map(inv => {
      const sharedTypes = investorShareMap.get(inv.id) ?? new Set<string>();
      const missing = KEY_MATERIAL_TYPES.filter(t => !sharedTypes.has(t));
      return { investor_id: inv.id, investor_name: inv.name, stage: inv.stage, missing };
    })
    .filter(x => x.missing.length > 0);

  // Stale shares (>30 days, not viewed/downloaded/completed)
  const staleShares = activeShares
    .filter(s => {
      if (!["shared","follow_up_needed"].includes(s.status)) return false;
      const daysSince = (now - new Date(s.shared_at).getTime()) / 86400000;
      return daysSince > 30;
    })
    .map(s => ({
      share_id:     s.id,
      investor_id:  s.investor_id,
      investor_name: s.investor_name ?? `Investor #${s.investor_id}`,
      material_title: s.material_title ?? `Material #${s.material_id}`,
      shared_at:    s.shared_at,
      days_since:   Math.floor((now - new Date(s.shared_at).getTime()) / 86400000),
    }))
    .sort((a, b) => b.days_since - a.days_since)
    .slice(0, 10);

  // Superseded materials still outstanding
  const supersededOutstanding = activeShares
    .filter(s => {
      if (["completed","stale","superseded"].includes(s.status)) return false;
      const mat = materials.find(m => m.id === s.material_id);
      return mat?.status === "superseded";
    })
    .map(s => {
      const mat = materials.find(m => m.id === s.material_id);
      return {
        share_id:     s.id,
        investor_name: s.investor_name ?? `Investor #${s.investor_id}`,
        material_title: mat?.title ?? `Material #${s.material_id}`,
        version_label: mat?.version_label ?? null,
      };
    });

  // Open / overdue requests
  const openStatuses = new Set(["requested","in_progress","ready","blocked"]);
  const closedStatuses = new Set(["shared","waived","closed"]);
  const openRequests = activeRequests.filter(r => openStatuses.has(r.request_status));

  const overdueRequests = openRequests.filter(r => r.due_at && new Date(r.due_at).getTime() < now);
  const overdueDetails  = overdueRequests
    .map(r => ({
      id:             r.id,
      investor_name:  r.investor_name ?? `Investor #${r.investor_id}`,
      requested_title: r.requested_title,
      due_at:         r.due_at!,
      days_overdue:   Math.floor((now - new Date(r.due_at!).getTime()) / 86400000),
    }))
    .sort((a, b) => b.days_overdue - a.days_overdue);

  const diligenceBlockers = openRequests
    .filter(r => r.request_status === "blocked" || (r.due_at && new Date(r.due_at).getTime() < now))
    .map(r => ({
      id:            r.id,
      investor_name: r.investor_name ?? `Investor #${r.investor_id}`,
      type:          r.requested_material_type,
      title:         r.requested_title,
      priority:      r.priority,
    }));

  return {
    total_materials:   materials.filter(m => !m.deleted_at).length,
    active_materials:  activeMaterials.length,
    total_shares:      activeShares.length,
    has_pitch_deck:    hasPitchDeck,
    has_financial_model: hasFinancialModel,
    key_materials_present: keyMaterialsPresent,
    investors_with_pitch_deck: investorsWithPitchDeck,
    investors_without_key_materials: investorsWithoutKeyMaterials,
    stale_shares:      staleShares,
    superseded_outstanding: supersededOutstanding,
    open_requests:     openRequests.length,
    overdue_requests:  overdueRequests.length,
    overdue_request_details: overdueDetails,
    diligence_blockers: diligenceBlockers,
  };
}

export function computeMaterialRiskFlags(
  materials: Material[],
  shares: MaterialShare[],
  requests: MaterialRequest[],
  investors: any[],
  intel: DataRoomIntelligence
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (!intel.has_pitch_deck) {
    flags.push({ level: "critical", code: "no_pitch_deck", message: "No active pitch deck in the data room." });
  }
  if (!intel.has_financial_model) {
    flags.push({ level: "warning", code: "no_financial_model", message: "No active financial model in the data room." });
  }

  // Lead investors missing key materials
  const leadsMissingMaterials = intel.investors_without_key_materials
    .filter(x => investors.find(inv => inv.id === x.investor_id)?.likely_lead);
  if (leadsMissingMaterials.length > 0) {
    flags.push({
      level: "critical",
      code: "lead_missing_materials",
      message: `${leadsMissingMaterials.length} lead investor(s) missing key materials (${leadsMissingMaterials.map(x => x.investor_name).join(", ")}).`,
    });
  }

  if (intel.stale_shares.length > 0) {
    flags.push({
      level: "warning",
      code: "stale_shares",
      message: `${intel.stale_shares.length} material share(s) with no engagement in 30+ days.`,
    });
  }

  if (intel.superseded_outstanding.length > 0) {
    flags.push({
      level: "warning",
      code: "superseded_outstanding",
      message: `${intel.superseded_outstanding.length} investor(s) holding superseded material versions.`,
    });
  }

  if (intel.overdue_requests > 0) {
    flags.push({
      level: "warning",
      code: "overdue_requests",
      message: `${intel.overdue_requests} material request(s) are overdue.`,
    });
  }

  if (intel.diligence_blockers.length > 0) {
    flags.push({
      level: "critical",
      code: "diligence_blockers",
      message: `${intel.diligence_blockers.length} diligence request(s) blocked or overdue.`,
    });
  }

  // NDA-required materials shared with investors who may not have signed
  const ndaMaterials = materials.filter(m => m.requires_nda && m.status === "active" && !m.deleted_at);
  const ndaShareCount = shares.filter(s =>
    !s.deleted_at && ndaMaterials.some(m => m.id === s.material_id)
  ).length;
  if (ndaMaterials.length > 0 && ndaShareCount > 0) {
    flags.push({
      level: "info",
      code: "nda_required_shared",
      message: `${ndaShareCount} share(s) involve NDA-required materials — verify NDA status per investor.`,
    });
  }

  return flags;
}

export function getInvestorMaterials(
  investorId: number,
  materials: Material[],
  shares: MaterialShare[]
): InvestorMaterialRow[] {
  const now = Date.now();
  const investorShares = shares.filter(s => s.investor_id === investorId && !s.deleted_at);
  const sharedMaterialIds = new Set(investorShares.map(s => s.material_id));

  // Also include active materials not yet shared (for "what they're missing")
  const allRelevant = materials.filter(m => !m.deleted_at);

  const rows: InvestorMaterialRow[] = allRelevant.map(mat => {
    const share = investorShares.find(s => s.material_id === mat.id);
    const daysSince = share ? (now - new Date(share.shared_at).getTime()) / 86400000 : 0;
    return {
      material_id:   mat.id,
      material_title: mat.title,
      material_type: mat.material_type,
      version_label: mat.version_label,
      material_status: mat.status,
      share_id:      share?.id ?? null,
      share_method:  share?.share_method ?? null,
      shared_at:     share?.shared_at ?? null,
      share_status:  share ? share.status : "not_shared",
      viewed_at:     share?.viewed_at ?? null,
      downloaded_at: share?.downloaded_at ?? null,
      contact_id:    share?.contact_id ?? null,
      is_stale:      !!share && ["shared","follow_up_needed"].includes(share.status) && daysSince > 30,
      is_superseded: mat.status === "superseded" && !!share,
    };
  });

  return rows.sort((a, b) => {
    // shared items first, then by type priority
    if (a.shared_at && !b.shared_at) return -1;
    if (!a.shared_at && b.shared_at) return 1;
    return 0;
  });
}

export function getRelevantMaterialsForEmailContext(
  investorId: number,
  investorStage: string,
  materials: Material[],
  shares: MaterialShare[]
): { material_id: number; title: string; material_type: string; version_label: string | null; last_shared_at: string | null; share_status: string | null; is_stale: boolean; is_superseded: boolean }[] {
  const now = Date.now();
  const activeMaterials = materials.filter(m => m.status === "active" && !m.deleted_at);
  const investorShares  = shares.filter(s => s.investor_id === investorId && !s.deleted_at);

  const isKey = (type: string) => KEY_MATERIAL_TYPES.includes(type);
  const isRelevantStage = DILIGENCE_STAGES.has(investorStage);

  const relevant = activeMaterials
    .filter(m => isKey(m.material_type) || (isRelevantStage && m.material_type !== "other"))
    .map(m => {
      const share = investorShares
        .filter(s => s.material_id === m.id)
        .sort((a, b) => new Date(b.shared_at).getTime() - new Date(a.shared_at).getTime())[0];
      const daysSince = share ? (now - new Date(share.shared_at).getTime()) / 86400000 : 0;
      return {
        material_id:   m.id,
        title:         m.title,
        material_type: m.material_type,
        version_label: m.version_label,
        last_shared_at: share?.shared_at ?? null,
        share_status:  share?.status ?? "not_shared",
        is_stale:      !!share && daysSince > 30,
        is_superseded: false, // only active materials included
      };
    });

  return relevant.sort((a, b) => {
    if (a.last_shared_at && !b.last_shared_at) return -1;
    if (!a.last_shared_at && b.last_shared_at) return 1;
    return 0;
  }).slice(0, 8);
}
