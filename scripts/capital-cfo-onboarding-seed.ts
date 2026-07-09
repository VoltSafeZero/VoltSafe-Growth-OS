// CFO onboarding seed package for VoltSafe Growth OS Capital module.
// Idempotent — safe to run multiple times. Keyed by SEED_KEY in capital_seed_log.
//
// Creates sample-only Capital data (round, investors, contacts, commitments,
// follow-ups, engagement activity, and data-room materials) so the Capital
// module isn't empty for CFO onboarding. All rows created here are flagged
// is_sample = TRUE and are only ever reachable through requireCapitalAccess
// (Trevor Burgess + Scott Carlson only).
//
// Run manually with: npx tsx scripts/capital-cfo-onboarding-seed.ts

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { migrateCapitalSchema } from "../server/routes-capital";

export const SEED_KEY = "capital_cfo_onboarding_seed_v1";

const esc = (v: string) => v.replace(/'/g, "''");

async function alreadySeeded(): Promise<boolean> {
  const res = await db.execute(sql.raw(
    `SELECT 1 FROM capital_seed_log WHERE seed_key = '${SEED_KEY}' LIMIT 1`
  ));
  return (res.rows as any[]).length > 0;
}

type InvestorSeed = {
  name: string; investor_type: string; stage: string; status: string;
  priority: string; region: string; country: string;
  check_size_min?: number; check_size_max?: number;
  probability?: number; notes: string;
  softCircle?: number; committed?: number;
  contact: { first: string; last: string; title: string; emailLocal: string };
};

const INVESTORS: InvestorSeed[] = [
  { name: "Pacific Current Ventures", investor_type: "Venture Capital", stage: "Reviewing Deck", status: "Active", priority: "High", region: "Vancouver, BC", country: "Canada", check_size_min: 25000000, check_size_max: 75000000, probability: 45, notes: "Strong fit for marine electrification and climate hardware. [SAMPLE DATA]", contact: { first: "Jordan", last: "Demo", title: "Partner", emailLocal: "jordan.demo+pacificcurrent" } },
  { name: "Blue Harbor Capital", investor_type: "Strategic / Family Office", stage: "Soft Circled", status: "Active", priority: "Medium", region: "Seattle, WA", country: "USA", probability: 55, notes: "Interested in marina infrastructure and recurring SaaS revenue. [SAMPLE DATA]", softCircle: 25000000, contact: { first: "Maya", last: "Demo", title: "Principal", emailLocal: "maya.demo+blueharbor" } },
  { name: "MarinaTech Angels", investor_type: "Angel Group", stage: "Intro Needed", status: "Active", priority: "Medium", region: "San Diego, CA", country: "USA", probability: 20, notes: "Good fit because of Port of San Diego pilot. [SAMPLE DATA]", contact: { first: "Casey", last: "Demo", title: "Managing Angel", emailLocal: "casey.demo+marinatech" } },
  { name: "GridEdge Ventures", investor_type: "Climate VC", stage: "Reviewing Deck", status: "Active", priority: "High", region: "San Francisco, CA", country: "USA", probability: 40, notes: "Interested in load management, DR, and marina electrification. [SAMPLE DATA]", contact: { first: "Riley", last: "Demo", title: "Investor", emailLocal: "riley.demo+gridedge" } },
  { name: "Northstar Family Office", investor_type: "Family Office", stage: "Target Identified", status: "Active", priority: "Medium", region: "Calgary, AB", country: "Canada", probability: 15, notes: "Needs clearer hardware margin story. [SAMPLE DATA]", contact: { first: "Avery", last: "Demo", title: "Investment Director", emailLocal: "avery.demo+northstar" } },
  { name: "Harbor Infrastructure Partners", investor_type: "Infrastructure Fund", stage: "Target Identified", status: "Active", priority: "Low", region: "Toronto, ON", country: "Canada", probability: 10, notes: "Larger cheque possible later, likely not lead for Seed+. [SAMPLE DATA]", contact: { first: "Drew", last: "Demo", title: "Associate", emailLocal: "drew.demo+harborinfra" } },
  { name: "Salish Sea Angels", investor_type: "Angel", stage: "Wired / Closed", status: "Active", priority: "High", region: "Victoria, BC", country: "Canada", probability: 100, notes: "Demo commitment only. Do not treat as real. [SAMPLE DATA]", committed: 10000000, contact: { first: "Sam", last: "Demo", title: "Angel Investor", emailLocal: "sam.demo+salishsea" } },
  { name: "OceanGrid Strategic", investor_type: "Strategic", stage: "Data Room Shared", status: "Active", priority: "Medium", region: "Miami, FL", country: "USA", probability: 30, notes: "Interested in marina operators and shore power safety. [SAMPLE DATA]", contact: { first: "Morgan", last: "Demo", title: "Corp Dev Lead", emailLocal: "morgan.demo+oceangrid" } },
  { name: "Clean Ports Fund", investor_type: "Climate / Infrastructure", stage: "Passed", status: "Passed", priority: "Low", region: "Los Angeles, CA", country: "USA", probability: 0, notes: "Wants more deployments before re-engaging. [SAMPLE DATA]", contact: { first: "Taylor", last: "Demo", title: "Analyst", emailLocal: "taylor.demo+cleanports" } },
];

const FOLLOW_UPS: { title: string; owner: "trevor" | "scott"; days: number; status: string; investorIdx?: number }[] = [
  { title: "Send updated Seed+ deck to Pacific Current Ventures", owner: "trevor", days: 2, status: "Open", investorIdx: 0 },
  { title: "Scott to review SaaS ARR assumptions before Blue Harbor call", owner: "scott", days: 3, status: "In Progress", investorIdx: 1 },
  { title: "Trevor to ask for intro to MarinaTech Angels", owner: "trevor", days: 5, status: "Open", investorIdx: 2 },
  { title: "Upload updated financial model to Data Room", owner: "scott", days: 1, status: "Open" },
  { title: "Confirm SAFE terms in investor FAQ", owner: "scott", days: 4, status: "Open" },
  { title: "Prepare diligence answer on pedestal gross margins", owner: "scott", days: 6, status: "In Progress" },
  { title: "Review BC Hydro demand response upside assumptions", owner: "scott", days: 8, status: "Open" },
  { title: "Create short memo on Port of San Diego pilot status", owner: "trevor", days: 7, status: "Open", investorIdx: 2 },
  { title: "Follow up with GridEdge Ventures after data room review", owner: "trevor", days: 10, status: "Open", investorIdx: 3 },
  { title: "CFO review of committed vs soft-circled investor totals", owner: "scott", days: 2, status: "Open" },
  { title: "Trevor to add note to MarinaTech Angels after call", owner: "trevor", days: 12, status: "Blocked", investorIdx: 2 },
  { title: "Scott to finalize cap table snapshot for data room", owner: "scott", days: 14, status: "Open" },
  { title: "Chase Northstar Family Office for warm-lead response", owner: "trevor", days: 21, status: "Open", investorIdx: 4 },
];

const ENGAGEMENT: { title: string; investorIdx: number; daysAgo: number }[] = [
  { title: "Deck viewed by Pacific Current Ventures", investorIdx: 0, daysAgo: 1 },
  { title: "Data room opened by Blue Harbor Capital", investorIdx: 1, daysAgo: 2 },
  { title: "Follow-up created for GridEdge Ventures", investorIdx: 3, daysAgo: 3 },
  { title: "Scott reviewed financial model assumptions", investorIdx: 1, daysAgo: 4 },
  { title: "Trevor added note to MarinaTech Angels", investorIdx: 2, daysAgo: 5 },
  { title: "OceanGrid Strategic viewed product overview", investorIdx: 7, daysAgo: 6 },
  { title: "Salish Sea Angels marked as demo committed", investorIdx: 6, daysAgo: 8 },
  { title: "Clean Ports Fund marked as passed/later", investorIdx: 8, daysAgo: 13 },
];

const MATERIALS: { folder: string; title: string }[] = [
  { folder: "Pitch Materials", title: "Seed+ Investor Deck — Sample" },
  { folder: "Pitch Materials", title: "One-Page Overview — Sample" },
  { folder: "Pitch Materials", title: "Product Demo Link — Sample" },
  { folder: "Financials", title: "Seed+ Financial Model — CFO Training Sample" },
  { folder: "Financials", title: "SaaS Revenue Assumptions — Sample" },
  { folder: "Financials", title: "Hardware Margin Bridge — Sample" },
  { folder: "Product & Technology", title: "Shore Power Pedestal Overview — Sample" },
  { folder: "Product & Technology", title: "Smart Connector Architecture — Sample" },
  { folder: "Product & Technology", title: "Software Dashboard Overview — Sample" },
  { folder: "Market & Customers", title: "Marina Market Map — Sample" },
  { folder: "Market & Customers", title: "Port of San Diego Pilot Summary — Sample" },
  { folder: "Market & Customers", title: "Customer Discovery Notes — Sample" },
  { folder: "Legal & Round Docs", title: "SAFE Terms Summary — Sample" },
  { folder: "Legal & Round Docs", title: "Cap Table Snapshot — Sample" },
  { folder: "Legal & Round Docs", title: "Investor FAQ — Sample" },
];

export async function runCapitalCfoOnboardingSeed(): Promise<{ ran: boolean; reason?: string }> {
  await migrateCapitalSchema();

  if (await alreadySeeded()) {
    return { ran: false, reason: "already seeded" };
  }

  const trevorRow = await db.execute(sql.raw(`SELECT id FROM users WHERE lower(email) = 'trevor@voltsafe.com' LIMIT 1`));
  const scottRow  = await db.execute(sql.raw(`SELECT id FROM users WHERE lower(email) = 'scott@voltsafe.com' LIMIT 1`));
  const trevorId = (trevorRow.rows as any[])[0]?.id ?? null;
  const scottId  = (scottRow.rows as any[])[0]?.id ?? null;

  if (!trevorId) {
    console.warn("[capital-seed] trevor@voltsafe.com not found — aborting seed (will retry on next boot).");
    return { ran: false, reason: "trevor user not found" };
  }

  const ownerSql = trevorId;
  const closeDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // ── Round ──────────────────────────────────────────────────────────────────
  const roundRes = await db.execute(sql.raw(`
    INSERT INTO capital_rounds (
      name, round_type, target_amount, currency, minimum_close_target, status,
      target_close_date, round_instrument, valuation_cap, discount_rate, notes,
      is_sample, created_by
    ) VALUES (
      'SEED+ — CFO Training Sample', 'Seed', 500000000, 'USD', 100000000, 'Open',
      '${closeDate}', 'SAFE', 3500000000, 20, 'This is demo data for Trevor and Scott only. Used to onboard CFO workflows inside VoltSafe Growth OS. [SAMPLE DATA]',
      TRUE, ${ownerSql}
    )
    RETURNING id
  `));
  const roundId = (roundRes.rows as any[])[0].id;

  // ── Investors + contacts + commitments ──────────────────────────────────────
  const investorIds: number[] = [];
  for (const inv of INVESTORS) {
    const chkMin = inv.check_size_min ?? "NULL";
    const chkMax = inv.check_size_max ?? "NULL";
    const prob = inv.probability ?? "NULL";
    const invRes = await db.execute(sql.raw(`
      INSERT INTO capital_investors (
        name, investor_type, status, priority, stage, check_size_min, check_size_max,
        currency, probability, region, country, notes, related_round_id,
        likely_lead, warmth, is_sample, created_by
      ) VALUES (
        '${esc(inv.name)}', '${esc(inv.investor_type)}', '${esc(inv.status)}', '${esc(inv.priority)}',
        '${esc(inv.stage)}', ${chkMin}, ${chkMax}, 'USD', ${prob},
        '${esc(inv.region)}', '${esc(inv.country)}', '${esc(inv.notes)}', ${roundId},
        ${inv.priority === "High" ? "TRUE" : "FALSE"}, '${inv.probability && inv.probability >= 50 ? "Warm" : "Cold"}',
        TRUE, ${ownerSql}
      )
      RETURNING id
    `));
    const investorId = (invRes.rows as any[])[0].id;
    investorIds.push(investorId);

    await db.execute(sql.raw(`
      INSERT INTO capital_contacts (
        investor_id, first_name, last_name, full_name, title, email, role_type,
        relationship_strength, is_sample, created_by
      ) VALUES (
        ${investorId}, '${esc(inv.contact.first)}', '${esc(inv.contact.last)}',
        '${esc(inv.contact.first + " " + inv.contact.last)}', '${esc(inv.contact.title)}',
        '${esc(inv.contact.emailLocal)}@example.com', 'Decision Maker', 'Warm', TRUE, ${ownerSql}
      )
    `));

    if (inv.softCircle || inv.committed) {
      const amount = inv.committed ?? inv.softCircle!;
      const stage = inv.committed ? "Committed" : "Soft Circled";
      await db.execute(sql.raw(`
        INSERT INTO capital_commitments (
          investor_id, round_id, amount, currency, commitment_stage, probability,
          notes, is_sample, created_by
        ) VALUES (
          ${investorId}, ${roundId}, ${amount}, 'USD', '${stage}', ${inv.committed ? 100 : 60},
          'Demo ${stage.toLowerCase()} amount — sample data only, not a real commitment. [SAMPLE DATA]',
          TRUE, ${ownerSql}
        )
      `));
    }
  }

  // ── Follow-ups (stored as capital_activities, activity_type='Follow-up') ────
  for (const fu of FOLLOW_UPS) {
    const owner = fu.owner === "scott" && scottId ? scottId : trevorId;
    const dueAt = new Date(Date.now() + fu.days * 24 * 60 * 60 * 1000).toISOString();
    const investorId = fu.investorIdx != null ? investorIds[fu.investorIdx] : null;
    await db.execute(sql.raw(`
      INSERT INTO capital_activities (
        activity_type, subject, title, entity_type, entity_id, due_at, owner_user_id,
        completed_at, is_sample, created_by
      ) VALUES (
        'Follow-up', '${esc(fu.title)}', '${esc(fu.title)}',
        ${investorId ? "'investor'" : "NULL"}, ${investorId ?? "NULL"},
        '${dueAt}', ${owner},
        ${fu.status === "Done" ? "NOW()" : "NULL"},
        TRUE, ${owner}
      )
    `));
  }

  // ── Engagement activity log ──────────────────────────────────────────────────
  for (const ev of ENGAGEMENT) {
    const investorId = investorIds[ev.investorIdx];
    const activityAt = new Date(Date.now() - ev.daysAgo * 24 * 60 * 60 * 1000).toISOString();
    await db.execute(sql.raw(`
      INSERT INTO capital_activities (
        activity_type, subject, title, entity_type, entity_id, activity_at,
        owner_user_id, is_sample, created_by
      ) VALUES (
        'Engagement', '${esc(ev.title)}', '${esc(ev.title)}', 'investor', ${investorId},
        '${activityAt}', ${ownerSql}, TRUE, ${ownerSql}
      )
    `));
  }

  // ── Data room materials ───────────────────────────────────────────────────────
  for (const m of MATERIALS) {
    await db.execute(sql.raw(`
      INSERT INTO capital_materials (
        title, description, material_type, round_id, status, folder_name,
        is_confidential, is_sample, owner_user_id, created_by
      ) VALUES (
        '${esc(m.title)}', 'Sample CFO onboarding placeholder — no real file attached. [SAMPLE DATA]',
        'other', ${roundId}, 'draft', '${esc(m.folder)}', TRUE, TRUE, ${ownerSql}, ${ownerSql}
      )
    `));
  }

  await db.execute(sql.raw(`
    INSERT INTO capital_seed_log (seed_key, notes)
    VALUES ('${SEED_KEY}', 'CFO onboarding sample data for Trevor + Scott. Round #${roundId}, ${INVESTORS.length} investors, ${MATERIALS.length} materials.')
  `));

  return { ran: true };
}

// Allow direct execution: npx tsx scripts/capital-cfo-onboarding-seed.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  runCapitalCfoOnboardingSeed()
    .then((r) => { console.log("[capital-seed]", r); process.exit(0); })
    .catch((e) => { console.error("[capital-seed] failed:", e); process.exit(1); });
}
