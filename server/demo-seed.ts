/**
 * VoltSafe Cortex — Stage 4 Demo Seed Script
 * Idempotent, environment-aware, non-destructive.
 * Marks every record with: name prefix "[DEMO]", tags "demo,seeded"
 * Safe to run multiple times — uses ON CONFLICT or pre-flight checks.
 * 
 * Usage:  npx tsx server/demo-seed.ts
 * Cleanup: npx tsx server/demo-seed.ts --cleanup
 * Dry-run: npx tsx server/demo-seed.ts --dry-run
 */

import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const isDryRun = process.argv.includes("--dry-run");
const isCleanup = process.argv.includes("--cleanup");
const DEMO_TAG = "demo";
const DEMO_PREFIX = "[DEMO]";
const DEMO_SOURCE = "seed_script";
const OWNER_USER_ID = 4; // Trevor

async function query(sql: string, params: unknown[] = []) {
  if (isDryRun) {
    console.log("[DRY-RUN]", sql.slice(0, 120).replace(/\s+/g, " "), params.length ? params : "");
    return { rows: [] };
  }
  return pool.query(sql, params);
}

// ── Environment guard ────────────────────────────────────────────────────────
function checkEnv() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const allowSeeding = process.env.ALLOW_DEMO_SEEDING === "true";
  if (nodeEnv === "production" && !allowSeeding) {
    console.error("⛔  Production environment detected. Set ALLOW_DEMO_SEEDING=true to override.");
    process.exit(1);
  }
  console.log(`✅ Environment: ${nodeEnv} — seeding allowed.`);
}

// ── Idempotency helper ───────────────────────────────────────────────────────
async function findDemoId(table: string, nameCol: string, name: string): Promise<number | null> {
  const r = await pool.query(`SELECT id FROM ${table} WHERE ${nameCol} = $1 LIMIT 1`, [name]);
  return r.rows[0]?.id ?? null;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log("\n🧹 Cleanup mode — removing [DEMO] records only...\n");

  // Collect demo account ids first for cascade
  const accR = await pool.query(`SELECT id FROM accounts WHERE name LIKE '[DEMO]%'`);
  const accIds: number[] = accR.rows.map(r => r.id);
  console.log(`  Found ${accIds.length} demo accounts`);

  const tables: { sql: string; label: string }[] = [
    { sql: `DELETE FROM saved_views WHERE name LIKE '[DEMO]%' RETURNING id`, label: "saved_views" },
    { sql: `DELETE FROM notes WHERE content LIKE '[DEMO]%' OR content LIKE '%demo%record%' RETURNING id`, label: "notes" },
    { sql: `DELETE FROM tasks WHERE title LIKE '[DEMO]%' RETURNING id`, label: "tasks" },
    { sql: `DELETE FROM activities WHERE summary LIKE '[DEMO]%' RETURNING id`, label: "activities" },
    { sql: `DELETE FROM projects WHERE name LIKE '[DEMO]%' RETURNING id`, label: "projects" },
    { sql: `DELETE FROM tickets WHERE subject LIKE '[DEMO]%' RETURNING id`, label: "tickets" },
    { sql: `DELETE FROM opportunities WHERE title LIKE '[DEMO]%' RETURNING id`, label: "opportunities" },
    { sql: `DELETE FROM contacts WHERE name LIKE '[DEMO]%' RETURNING id`, label: "contacts" },
    { sql: `DELETE FROM accounts WHERE name LIKE '[DEMO]%' RETURNING id`, label: "accounts" },
  ];

  for (const { sql, label } of tables) {
    const r = isDryRun
      ? { rows: [] }
      : await pool.query(sql);
    console.log(`  ✓ Deleted ${r.rows.length} ${label}`);
  }

  console.log("\n✅ Cleanup complete. Real records untouched.\n");
}

// ── Main seed ─────────────────────────────────────────────────────────────────
async function seed() {
  console.log(`\n🌱 Starting VoltSafe Cortex demo seed${isDryRun ? " (DRY-RUN)" : ""}...\n`);

  // ── 1. Demo Accounts ──────────────────────────────────────────────────────
  console.log("📦 Seeding accounts...");

  const accountDefs = [
    {
      name: "[DEMO] Royal Vancouver Marina",
      segment: "marina",
      marinaType: "Full-service",
      ownershipType: "Private",
      city: "Vancouver",
      stateProvince: "British Columbia",
      country: "CA",
      slipCount: 280,
      leadStatus: "working",
      priority: "high",
      website: "https://royalvancmarina.example.com",
      notes: "Flagship pilot account. High-value, politically connected. Interested in full marina electrification. Decision maker: Harbour Master Ian Fletcher.",
      tags: "demo,seeded,pilot,ca",
    },
    {
      name: "[DEMO] Pacific Coast Harbor Group",
      segment: "marina_group",
      marinaType: "Multi-site",
      ownershipType: "Corporate",
      city: "Seattle",
      stateProvince: "Washington",
      country: "US",
      slipCount: 1400,
      leadStatus: "qualified",
      priority: "high",
      website: "https://pchg.example.com",
      notes: "Regional operator of 5 marinas across BC, WA, OR. Looking for fleet-wide upgrade contract. CFO Janet Yuen driving procurement.",
      tags: "demo,seeded,group,us",
    },
    {
      name: "[DEMO] Port of Cascadia",
      segment: "marina",
      marinaType: "Public Port",
      ownershipType: "Government / Port Authority",
      city: "Portland",
      stateProvince: "Oregon",
      country: "US",
      slipCount: 500,
      leadStatus: "contacted",
      priority: "medium",
      website: "https://portofcascadia.example.com",
      notes: "Public port authority. Long procurement cycles. Eligible for federal electrification grants. Champion: Innovation Director Carlos Mendez.",
      tags: "demo,seeded,government,us",
    },
    {
      name: "[DEMO] BlueCurrent OEM Systems",
      segment: "marina",
      marinaType: "OEM / Technology",
      ownershipType: "Private / Corp",
      city: "San Jose",
      stateProvince: "California",
      country: "US",
      slipCount: null,
      leadStatus: "working",
      priority: "high",
      website: "https://bluecurrent.example.com",
      notes: "Potential OEM licensing partner. Builds smart pedestal hardware. Exploring white-label VoltSafe software on their hardware stack.",
      tags: "demo,seeded,oem,us",
    },
    {
      name: "[DEMO] Coastal Electrification Program",
      segment: "marina",
      marinaType: "Grant Program",
      ownershipType: "Federal / Provincial",
      city: "Victoria",
      stateProvince: "British Columbia",
      country: "CA",
      slipCount: null,
      leadStatus: "new",
      priority: "medium",
      website: "https://coastalelec.gov.example.com",
      notes: "BC provincial electrification grant body. Reviewing pilot applications for Phase 2 funding. Key contact: Program Manager Dr. Anika Singh.",
      tags: "demo,seeded,government,grant,ca",
    },
    {
      name: "[DEMO] Marina Innovation Association",
      segment: "marina",
      marinaType: "Association",
      ownershipType: "Non-Profit",
      city: "Annapolis",
      stateProvince: "Maryland",
      country: "US",
      slipCount: null,
      leadStatus: "contacted",
      priority: "low",
      website: "https://marinainnov.example.com",
      notes: "Industry association. Potential channel partner for member outreach, DOCKS Expo co-sponsorship, and thought leadership content.",
      tags: "demo,seeded,association,us",
    },
    {
      name: "[DEMO] Shoreline Technology Partners",
      segment: "marina",
      marinaType: "Strategic Partner",
      ownershipType: "Private",
      city: "Boston",
      stateProvince: "Massachusetts",
      country: "US",
      slipCount: null,
      leadStatus: "working",
      priority: "medium",
      website: "https://shorelinetech.example.com",
      notes: "Maritime software integrator. Potential co-sell and referral partner. Actively working with 30+ marinas across Northeast US.",
      tags: "demo,seeded,partner,us",
    },
  ];

  const accountIds: Record<string, number> = {};
  for (const a of accountDefs) {
    const existing = await findDemoId("accounts", "name", a.name);
    if (existing) {
      console.log(`  ↩  Account exists: ${a.name} (id=${existing})`);
      accountIds[a.name] = existing;
      continue;
    }
    const r = await query(
      `INSERT INTO accounts (name, segment, marina_type, ownership_type, city, state_province, country, slip_count, lead_status, priority, website, notes, tags, assigned_to_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [a.name, a.segment, a.marinaType, a.ownershipType, a.city, a.stateProvince, a.country, a.slipCount, a.leadStatus, a.priority, a.website, a.notes, a.tags, OWNER_USER_ID]
    );
    const id: number = r.rows[0]?.id ?? Math.floor(Math.random() * 1000) + 100;
    accountIds[a.name] = id;
    console.log(`  ✓  Created account: ${a.name} (id=${id})`);
  }

  // ── 2. Demo Contacts ──────────────────────────────────────────────────────
  console.log("\n👥 Seeding contacts...");

  const contactDefs = [
    {
      accountName: "[DEMO] Royal Vancouver Marina",
      name: "[DEMO] Ian Fletcher",
      firstName: "Ian", lastName: "Fletcher",
      title: "Harbour Master",
      email: "ian.fletcher@royalvanc.example.com",
      phone: "604-555-0101",
      roleType: "champion",
      isPrimary: true,
      relationshipStrength: "strong",
      notes: "Key champion. Pushed for electrification upgrade. Prefers email, follow up Tues/Thurs.",
    },
    {
      accountName: "[DEMO] Royal Vancouver Marina",
      name: "[DEMO] Priya Nair",
      firstName: "Priya", lastName: "Nair",
      title: "Operations Director",
      email: "priya.nair@royalvanc.example.com",
      phone: "604-555-0102",
      roleType: "influencer",
      isPrimary: false,
      relationshipStrength: "developing",
      notes: "Operations lead. Focused on maintenance cost reduction and reliability.",
    },
    {
      accountName: "[DEMO] Pacific Coast Harbor Group",
      name: "[DEMO] Janet Yuen",
      firstName: "Janet", lastName: "Yuen",
      title: "CFO / Procurement Lead",
      email: "j.yuen@pchg.example.com",
      phone: "206-555-0201",
      roleType: "economic_buyer",
      isPrimary: true,
      relationshipStrength: "neutral",
      notes: "Economic buyer. Focused on ROI and fleet-wide TCO. Needs financial model.",
    },
    {
      accountName: "[DEMO] Pacific Coast Harbor Group",
      name: "[DEMO] Marcus Webb",
      firstName: "Marcus", lastName: "Webb",
      title: "Marina Operations VP",
      email: "m.webb@pchg.example.com",
      phone: "206-555-0202",
      roleType: "champion",
      isPrimary: false,
      relationshipStrength: "strong",
      notes: "Day-to-day champion. Very engaged. Has toured RVYC pilot site.",
    },
    {
      accountName: "[DEMO] Port of Cascadia",
      name: "[DEMO] Carlos Mendez",
      firstName: "Carlos", lastName: "Mendez",
      title: "Innovation Director",
      email: "c.mendez@cascadiaport.example.com",
      phone: "503-555-0301",
      roleType: "champion",
      isPrimary: true,
      relationshipStrength: "developing",
      notes: "Internal champion. Leading electrification initiative for port authority.",
    },
    {
      accountName: "[DEMO] BlueCurrent OEM Systems",
      name: "[DEMO] Rachel Ito",
      firstName: "Rachel", lastName: "Ito",
      title: "Business Development Director",
      email: "r.ito@bluecurrent.example.com",
      phone: "408-555-0401",
      roleType: "decision_maker",
      isPrimary: true,
      relationshipStrength: "strong",
      notes: "BD lead for OEM partnership. Very excited about white-label deal structure.",
    },
    {
      accountName: "[DEMO] Coastal Electrification Program",
      name: "[DEMO] Dr. Anika Singh",
      firstName: "Anika", lastName: "Singh",
      title: "Program Manager",
      email: "a.singh@coastalelec.gov.example.com",
      phone: "250-555-0501",
      roleType: "decision_maker",
      isPrimary: true,
      relationshipStrength: "developing",
      notes: "Government program manager. Evaluating Phase 2 grant applicants. Needs pilot results.",
    },
    {
      accountName: "[DEMO] Shoreline Technology Partners",
      name: "[DEMO] David Osei",
      firstName: "David", lastName: "Osei",
      title: "Co-founder & CTO",
      email: "d.osei@shorelinetech.example.com",
      phone: "617-555-0701",
      roleType: "champion",
      isPrimary: true,
      relationshipStrength: "strong",
      notes: "Technical founder. Enthusiastic about integration partnership. Proposed co-sell agreement.",
    },
  ];

  const contactIds: Record<string, number> = {};
  for (const c of contactDefs) {
    const existing = await findDemoId("contacts", "name", c.name);
    const accId = accountIds[c.accountName];
    if (!accId) { console.log(`  ⚠  No account id for ${c.accountName}`); continue; }
    if (existing) {
      contactIds[c.name] = existing;
      console.log(`  ↩  Contact exists: ${c.name} (id=${existing})`);
      continue;
    }
    const r = await query(
      `INSERT INTO contacts (account_id, name, first_name, last_name, title, email, phone, role_type, is_primary, relationship_strength, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [accId, c.name, c.firstName, c.lastName, c.title, c.email, c.phone, c.roleType, c.isPrimary, c.relationshipStrength, c.notes]
    );
    const id: number = r.rows[0]?.id ?? 0;
    contactIds[c.name] = id;
    console.log(`  ✓  Created contact: ${c.name} (id=${id})`);
  }

  // ── 3. Demo Opportunities ─────────────────────────────────────────────────
  console.log("\n💼 Seeding opportunities...");

  const now = new Date();
  const daysOut = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };

  const oppDefs = [
    {
      title: "[DEMO] Royal Vancouver Marina — Full Electrification",
      accountName: "[DEMO] Royal Vancouver Marina",
      contactName: "[DEMO] Ian Fletcher",
      stage: "proposal",
      forecastCategory: "commit",
      amount: 148000,
      currency: "CAD",
      valueHardware: 112000,
      valueSoftware: 18000,
      valueServices: 18000,
      estCloseDate: daysOut(45),
      estimatedPedestalCount: 56,
      estimatedSlipsImpacted: 280,
      primaryValueDriver: "safety",
      competition: "legacy_pedestal",
      nextStep: "Deliver updated proposal with 5-year TCO model",
      nextStepDueDate: daysOut(7),
      roiStory: "Safety upgrade eliminates liability risk. 38% energy savings vs legacy. 3.2yr payback.",
      notes: "Strong champion. Ian personally toured a competitor install last year — prefers our dashboard UX.",
    },
    {
      title: "[DEMO] Pacific Coast Harbor Group — Fleet Contract",
      accountName: "[DEMO] Pacific Coast Harbor Group",
      contactName: "[DEMO] Janet Yuen",
      stage: "qualified",
      forecastCategory: "pipeline",
      amount: 620000,
      currency: "USD",
      valueHardware: 480000,
      valueSoftware: 80000,
      valueServices: 60000,
      estCloseDate: daysOut(90),
      estimatedPedestalCount: 240,
      estimatedSlipsImpacted: 1400,
      primaryValueDriver: "revenue",
      competition: "dockmaster_pro",
      nextStep: "Schedule CFO financial model review call",
      nextStepDueDate: daysOut(10),
      roiStory: "Fleet deal unlocks 30% volume discount. Projected 4.1yr payback across all sites.",
      notes: "Largest potential deal in pipeline. Janet needs NPV model. Marcus is fully on board.",
    },
    {
      title: "[DEMO] Port of Cascadia — Pilot Berths 1-40",
      accountName: "[DEMO] Port of Cascadia",
      contactName: "[DEMO] Carlos Mendez",
      stage: "discovery",
      forecastCategory: "pipeline",
      amount: 85000,
      currency: "USD",
      valueHardware: 65000,
      valueSoftware: 12000,
      valueServices: 8000,
      estCloseDate: daysOut(120),
      estimatedPedestalCount: 40,
      estimatedSlipsImpacted: 40,
      primaryValueDriver: "compliance",
      competition: "unknown",
      nextStep: "Send RFP response template and grant eligibility brief",
      nextStepDueDate: daysOut(14),
      roiStory: "Compliance-driven. Eligible for federal grant matching up to 50% of hardware cost.",
      notes: "Public procurement — long cycle. Prioritize grant angle to accelerate budget.",
    },
    {
      title: "[DEMO] BlueCurrent OEM — Software Licensing Agreement",
      accountName: "[DEMO] BlueCurrent OEM Systems",
      contactName: "[DEMO] Rachel Ito",
      stage: "negotiation",
      forecastCategory: "commit",
      amount: 220000,
      currency: "USD",
      valueHardware: 0,
      valueSoftware: 220000,
      valueServices: 0,
      estCloseDate: daysOut(30),
      estimatedPedestalCount: null,
      estimatedSlipsImpacted: null,
      primaryValueDriver: "safety",
      competition: "custom_build",
      nextStep: "Legal review of white-label licensing schedule",
      nextStepDueDate: daysOut(5),
      roiStory: "Pure software deal. Recurring $18K/yr license fee post year-1. Zero COGS.",
      notes: "OEM deal — no hardware. Rachel wants pilot clause allowing them to sub-license.",
    },
    {
      title: "[DEMO] Marina Innovation Association — Membership Intro",
      accountName: "[DEMO] Marina Innovation Association",
      contactName: null,
      stage: "inbound_new",
      forecastCategory: "pipeline",
      amount: 12000,
      currency: "USD",
      valueHardware: 0,
      valueSoftware: 0,
      valueServices: 12000,
      estCloseDate: daysOut(180),
      estimatedPedestalCount: null,
      estimatedSlipsImpacted: null,
      primaryValueDriver: "safety",
      competition: "unknown",
      nextStep: "Present VoltSafe at next association webinar",
      nextStepDueDate: daysOut(30),
      roiStory: "Channel play — access to 200+ member marinas through co-sponsorship.",
      notes: "Relationship-first. Low value deal but high channel leverage.",
    },
    {
      title: "[DEMO] Shoreline Tech — Referral Partner Agreement",
      accountName: "[DEMO] Shoreline Technology Partners",
      contactName: "[DEMO] David Osei",
      stage: "proposal",
      forecastCategory: "pipeline",
      amount: 0,
      currency: "USD",
      valueHardware: 0,
      valueSoftware: 0,
      valueServices: 0,
      estCloseDate: daysOut(60),
      estimatedPedestalCount: null,
      estimatedSlipsImpacted: null,
      primaryValueDriver: "safety",
      competition: "unknown",
      nextStep: "Send draft referral agreement to David for review",
      nextStepDueDate: daysOut(8),
      roiStory: "No direct revenue — channel access to 30+ marinas in Northeast US.",
      notes: "Co-sell arrangement. They refer, we share 8% of first-year deal value.",
    },
    {
      title: "[DEMO] Royal Vancouver Marina — Phase 2 Expansion",
      accountName: "[DEMO] Royal Vancouver Marina",
      contactName: "[DEMO] Priya Nair",
      stage: "nurture",
      forecastCategory: "pipeline",
      amount: 95000,
      currency: "CAD",
      valueHardware: 72000,
      valueSoftware: 12000,
      valueServices: 11000,
      estCloseDate: daysOut(270),
      estimatedPedestalCount: 38,
      estimatedSlipsImpacted: 110,
      primaryValueDriver: "revenue",
      competition: "unknown",
      nextStep: "Check in post Phase 1 install — assess expansion readiness",
      nextStepDueDate: daysOut(90),
      roiStory: "Phase 2 expands to dry storage and seasonal berths. Strong upsell post Phase 1.",
      notes: "Nurture track. Activate once Phase 1 is live.",
    },
  ];

  const oppIds: Record<string, number> = {};
  for (const o of oppDefs) {
    const existing = await findDemoId("opportunities", "title", o.title);
    const accId = accountIds[o.accountName];
    const contId = o.contactName ? contactIds[o.contactName] : null;
    if (!accId) { console.log(`  ⚠  No account id for ${o.accountName}`); continue; }
    if (existing) {
      oppIds[o.title] = existing;
      console.log(`  ↩  Opportunity exists: ${o.title.slice(0, 55)} (id=${existing})`);
      continue;
    }
    const r = await query(
      `INSERT INTO opportunities
       (account_id, contact_id, title, stage, forecast_category, amount, currency,
        value_hardware, value_software, value_services, value_total,
        est_close_date, estimated_pedestal_count, estimated_slips_impacted,
        primary_value_driver, competition, next_step, next_step_due_date,
        roi_story, notes, owner_user_id, last_activity_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id`,
      [accId, contId, o.title, o.stage, o.forecastCategory, o.amount, o.currency,
       o.valueHardware, o.valueSoftware, o.valueServices,
       (o.valueHardware + o.valueSoftware + o.valueServices) || o.amount,
       o.estCloseDate, o.estimatedPedestalCount, o.estimatedSlipsImpacted,
       o.primaryValueDriver, o.competition, o.nextStep, o.nextStepDueDate,
       o.roiStory, o.notes, OWNER_USER_ID, now]
    );
    const id: number = r.rows[0]?.id ?? 0;
    oppIds[o.title] = id;
    console.log(`  ✓  Created opportunity: ${o.title.slice(0, 55)} (id=${id})`);
  }

  // ── 4. Demo Tickets ───────────────────────────────────────────────────────
  console.log("\n🎫 Seeding tickets...");

  const ticketDefs = [
    {
      subject: "[DEMO] Dashboard login access issue — dockmaster locked out",
      accountName: "[DEMO] Royal Vancouver Marina",
      requesterName: "[DEMO] Ian Fletcher",
      requesterEmail: "ian.fletcher@royalvanc.example.com",
      category: "access_login",
      severity: "high",
      priority: "high",
      status: "open",
      description: "Dockmaster account flagged as inactive after 30-day idle. System is not sending reset email. Need manual unlock. Port is opening for the season next Monday.",
    },
    {
      subject: "[DEMO] Billing export CSV has mismatched totals",
      accountName: "[DEMO] Pacific Coast Harbor Group",
      requesterName: "[DEMO] Janet Yuen",
      requesterEmail: "j.yuen@pchg.example.com",
      category: "billing_issue",
      severity: "medium",
      priority: "medium",
      status: "in_progress",
      description: "When exporting billing summary for Marina 3 (Seattle North) the sub-total in the CSV does not match the in-app total by $142. Affects March invoice reconciliation.",
    },
    {
      subject: "[DEMO] User permissions not propagating to sub-users",
      accountName: "[DEMO] Pacific Coast Harbor Group",
      requesterName: "[DEMO] Marcus Webb",
      requesterEmail: "m.webb@pchg.example.com",
      category: "configuration",
      severity: "medium",
      priority: "medium",
      status: "waiting_customer",
      description: "After assigning 'read-only' role to 3 new staff accounts, two of them still see edit controls for pedestal configuration. Possibly a cache issue.",
    },
    {
      subject: "[DEMO] Slip usage report shows incorrect occupancy rate",
      accountName: "[DEMO] Port of Cascadia",
      requesterName: "[DEMO] Carlos Mendez",
      requesterEmail: "c.mendez@cascadiaport.example.com",
      category: "data_reporting",
      severity: "low",
      priority: "low",
      status: "new",
      description: "The occupancy rate on the dashboard shows 72% but our actual count is closer to 89%. Wondering if the seasonal transient slips are being excluded.",
    },
    {
      subject: "[DEMO] Need operator training walkthrough for new staff",
      accountName: "[DEMO] Royal Vancouver Marina",
      requesterName: "[DEMO] Priya Nair",
      requesterEmail: "priya.nair@royalvanc.example.com",
      category: "training_how_to",
      severity: "low",
      priority: "low",
      status: "resolved",
      description: "Onboarding 4 new seasonal dock staff. Would like a 30-min Zoom walkthrough covering the Pedestal Control Dashboard and the billing export flow.",
      resolutionSummary: "Completed Zoom session on April 1. Shared training video recording link. Staff are onboarded.",
    },
  ];

  for (const t of ticketDefs) {
    const existing = await findDemoId("tickets", "subject", t.subject);
    const accId = t.accountName ? accountIds[t.accountName] : null;
    if (existing) {
      console.log(`  ↩  Ticket exists: ${t.subject.slice(0, 55)} (id=${existing})`);
      continue;
    }
    const r = await query(
      `INSERT INTO tickets
       (account_id, requester_name, requester_email, category, severity, priority, status, subject, description, resolution_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [accId, t.requesterName, t.requesterEmail, t.category, t.severity, t.priority, t.status, t.subject, t.description, t.resolutionSummary ?? null]
    );
    console.log(`  ✓  Created ticket: ${t.subject.slice(0, 55)} (id=${r.rows[0]?.id})`);
  }

  // ── 5. Demo Projects ──────────────────────────────────────────────────────
  console.log("\n🗂  Seeding projects...");

  const projectDefs = [
    {
      name: "[DEMO] Lighthouse Marina Pilot Prep",
      type: "lighthouse",
      status: "active",
      phase: "Site assessment & scoping",
      accountName: "[DEMO] Royal Vancouver Marina",
      budget: 22000,
      currency: "CAD",
      startDate: new Date("2026-02-01"),
      endDate: new Date("2026-07-31"),
      description: "Prepare Royal Vancouver Marina for Lighthouse Program designation. Covers site survey, pilot metrics framework, white-paper outline, and Innovate BC reporting requirements.",
    },
    {
      name: "[DEMO] OEM Licensing Outreach Q2",
      type: "partnership",
      status: "active",
      phase: "Negotiation",
      accountName: "[DEMO] BlueCurrent OEM Systems",
      budget: 5000,
      currency: "USD",
      startDate: new Date("2026-03-01"),
      endDate: new Date("2026-06-30"),
      description: "OEM partnership licensing campaign targeting BlueCurrent and 2 additional pedestal OEMs. Deliverable: signed white-label agreement by Q2 close.",
    },
    {
      name: "[DEMO] Grant Submission Package",
      type: "grant",
      status: "active",
      phase: "Documentation",
      accountName: "[DEMO] Coastal Electrification Program",
      budget: 8000,
      currency: "CAD",
      startDate: new Date("2026-03-15"),
      endDate: new Date("2026-05-15"),
      description: "Prepare full Phase 2 grant application for BC Coastal Electrification Program. Includes pilot data summary, financial model, and letters of support.",
    },
    {
      name: "[DEMO] Competitive Landscape Refresh",
      type: "research",
      status: "planning",
      phase: "Data gathering",
      accountName: null,
      budget: 3000,
      currency: "USD",
      startDate: new Date("2026-04-01"),
      endDate: new Date("2026-05-01"),
      description: "Update competitive analysis across legacy pedestal vendors, DockMaster Pro, and emerging EV charging dock players. Deliverable: refreshed battlecards and positioning doc.",
    },
    {
      name: "[DEMO] DOCKS Expo Planning",
      type: "event",
      status: "planning",
      phase: "Logistics",
      accountName: "[DEMO] Marina Innovation Association",
      budget: 14000,
      currency: "USD",
      startDate: new Date("2026-05-01"),
      endDate: new Date("2026-09-15"),
      description: "Plan VoltSafe presence at DOCKS Expo 2026. Includes booth design, demo hardware logistics, speaking slot application, and post-show lead capture strategy.",
    },
  ];

  const projectIds: Record<string, number> = {};
  for (const p of projectDefs) {
    const existing = await findDemoId("projects", "name", p.name);
    const accId = p.accountName ? accountIds[p.accountName] : null;
    if (existing) {
      projectIds[p.name] = existing;
      console.log(`  ↩  Project exists: ${p.name} (id=${existing})`);
      continue;
    }
    const r = await query(
      `INSERT INTO projects (name, type, status, phase, account_id, budget, currency, start_date, end_date, description, owner_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [p.name, p.type, p.status, p.phase, accId, p.budget, p.currency, p.startDate, p.endDate, p.description, OWNER_USER_ID]
    );
    const id: number = r.rows[0]?.id ?? 0;
    projectIds[p.name] = id;
    console.log(`  ✓  Created project: ${p.name} (id=${id})`);
  }

  // ── 6. Demo Tasks ─────────────────────────────────────────────────────────
  console.log("\n✅ Seeding tasks...");

  const taskDefs = [
    {
      title: "[DEMO] Send updated TCO model to Janet Yuen (PCHG)",
      linkedObjectType: "opportunity",
      linkedObjectKey: "[DEMO] Pacific Coast Harbor Group — Fleet Contract",
      accountName: "[DEMO] Pacific Coast Harbor Group",
      priority: "high",
      status: "pending",
      dueDate: daysOut(10),
      description: "CFO requested 5-year NPV + TCO model with fleet volume pricing. Include energy savings projections per site.",
    },
    {
      title: "[DEMO] Prepare site survey checklist for Royal Vancouver",
      linkedObjectType: "project",
      linkedObjectKey: "[DEMO] Lighthouse Marina Pilot Prep",
      accountName: "[DEMO] Royal Vancouver Marina",
      priority: "high",
      status: "pending",
      dueDate: daysOut(7),
      description: "Adapt the standard site survey form for the Lighthouse Program requirements. Coordinate with Ian on dock layout.",
    },
    {
      title: "[DEMO] Draft grant executive summary for BC CEP Phase 2",
      linkedObjectType: "project",
      linkedObjectKey: "[DEMO] Grant Submission Package",
      accountName: "[DEMO] Coastal Electrification Program",
      priority: "high",
      status: "pending",
      dueDate: daysOut(14),
      description: "2-page executive summary to accompany the full grant application. Lead with pilot results from Royal Vancouver Marina.",
    },
    {
      title: "[DEMO] Schedule BlueCurrent licensing agreement review call",
      linkedObjectType: "opportunity",
      linkedObjectKey: "[DEMO] BlueCurrent OEM — Software Licensing Agreement",
      accountName: "[DEMO] BlueCurrent OEM Systems",
      priority: "high",
      status: "pending",
      dueDate: daysOut(5),
      description: "Legal review of Schedule A (fee structure) and Schedule B (sub-licensing clause). Invite Rachel and our legal counsel.",
    },
    {
      title: "[DEMO] Follow up with Carlos Mendez re: RFP response",
      linkedObjectType: "opportunity",
      linkedObjectKey: "[DEMO] Port of Cascadia — Pilot Berths 1-40",
      accountName: "[DEMO] Port of Cascadia",
      priority: "medium",
      status: "pending",
      dueDate: daysOut(14),
      description: "Check if Carlos has had a chance to review the RFP response and grant eligibility brief sent last week.",
    },
    {
      title: "[DEMO] Build competitive landscape — DockMaster Pro section",
      linkedObjectType: "project",
      linkedObjectKey: "[DEMO] Competitive Landscape Refresh",
      accountName: null,
      priority: "medium",
      status: "pending",
      dueDate: daysOut(20),
      description: "Profile DockMaster Pro: pricing, feature gaps, known weaknesses vs VoltSafe. Source from public materials + partner intel.",
    },
    {
      title: "[DEMO] DOCKS Expo — confirm booth registration",
      linkedObjectType: "project",
      linkedObjectKey: "[DEMO] DOCKS Expo Planning",
      accountName: "[DEMO] Marina Innovation Association",
      priority: "medium",
      status: "completed",
      dueDate: daysOut(-5),
      description: "Confirm 10x10 booth in Innovation Hall. Paid deposit. Got confirmation #EX2026-VSF-007.",
    },
    {
      title: "[DEMO] Resolve PCHG billing CSV mismatch ticket",
      linkedObjectType: "account",
      linkedObjectKey: null,
      accountName: "[DEMO] Pacific Coast Harbor Group",
      priority: "high",
      status: "pending",
      dueDate: daysOut(3),
      description: "Investigate billing export totals mismatch for Marina 3. Check if March timezone offset bug applies.",
    },
  ];

  for (const t of taskDefs) {
    const existing = await findDemoId("tasks", "title", t.title);
    const accId = t.accountName ? accountIds[t.accountName] : null;
    const linkedId = t.linkedObjectType === "opportunity" && t.linkedObjectKey
      ? oppIds[t.linkedObjectKey]
      : t.linkedObjectType === "project" && t.linkedObjectKey
      ? projectIds[t.linkedObjectKey]
      : null;
    if (existing) {
      console.log(`  ↩  Task exists: ${t.title.slice(0, 55)}`);
      continue;
    }
    await query(
      `INSERT INTO tasks (title, linked_object_type, linked_object_id, account_id, owner_user_id, priority, status, due_date, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [t.title, t.linkedObjectType, linkedId, accId, OWNER_USER_ID, t.priority, t.status, t.dueDate, t.description]
    );
    console.log(`  ✓  Created task: ${t.title.slice(0, 55)}`);
  }

  // ── 7. Demo Notes ─────────────────────────────────────────────────────────
  console.log("\n📝 Seeding notes...");

  const noteDefs: { linkedObjectType: string; linkedObjectKey: string; keyMap: "accounts" | "opportunities" | "projects"; content: string }[] = [
    {
      linkedObjectType: "account",
      linkedObjectKey: "[DEMO] Royal Vancouver Marina",
      keyMap: "accounts",
      content: "[DEMO] 2026-03-14 — Call with Ian Fletcher. He's confirmed budget approval for Phase 1 (up to $150K CAD). Wants proposal by Apr 18. Requested 5-year maintenance cost comparison vs legacy pedestals.",
    },
    {
      linkedObjectType: "account",
      linkedObjectKey: "[DEMO] Pacific Coast Harbor Group",
      keyMap: "accounts",
      content: "[DEMO] 2026-03-22 — Intro meeting with Janet Yuen and Marcus Webb. Janet wants a fleet NPV model — needs to present to board in May. Marcus is pushing internally, very supportive.",
    },
    {
      linkedObjectType: "opportunity",
      linkedObjectKey: "[DEMO] Royal Vancouver Marina — Full Electrification",
      keyMap: "opportunities",
      content: "[DEMO] 2026-03-28 — Proposal walkthrough call. Ian had 3 questions: (1) warranty on control modules, (2) firmware OTA update process, (3) integration with their existing billing system. Sending written answers by EOW.",
    },
    {
      linkedObjectType: "opportunity",
      linkedObjectKey: "[DEMO] BlueCurrent OEM — Software Licensing Agreement",
      keyMap: "opportunities",
      content: "[DEMO] 2026-04-01 — Rachel flagged that BlueCurrent's legal team wants the sub-licensing clause narrowed to NA only. I think we can accept that. Checking with our CEO.",
    },
    {
      linkedObjectType: "project",
      linkedObjectKey: "[DEMO] Grant Submission Package",
      keyMap: "projects",
      content: "[DEMO] 2026-03-30 — Met with Dr. Anika Singh (CEP). She confirmed Phase 2 applications close May 15. Key eval criteria: (1) job creation potential, (2) GHG reduction projections, (3) proof of pilot results. We are well positioned.",
    },
  ];

  const keyMaps = {
    accounts: accountIds,
    opportunities: oppIds,
    projects: projectIds,
  };

  for (const n of noteDefs) {
    const linkedId = keyMaps[n.keyMap][n.linkedObjectKey];
    if (!linkedId) { console.log(`  ⚠  No id for ${n.linkedObjectKey}`); continue; }

    const existing = await pool.query(
      `SELECT id FROM notes WHERE linked_object_type=$1 AND linked_object_id=$2 AND content=$3 LIMIT 1`,
      [n.linkedObjectType, linkedId, n.content]
    );
    if (existing.rows.length > 0) {
      console.log(`  ↩  Note exists for ${n.linkedObjectKey.slice(0, 40)}`);
      continue;
    }
    await query(
      `INSERT INTO notes (linked_object_type, linked_object_id, content, author_name)
       VALUES ($1,$2,$3,$4)`,
      [n.linkedObjectType, linkedId, n.content, "Trevor"]
    );
    console.log(`  ✓  Created note for: ${n.linkedObjectKey.slice(0, 40)}`);
  }

  // ── 8. Demo Activities ────────────────────────────────────────────────────
  console.log("\n📋 Seeding activities...");

  const activityDefs = [
    {
      linkedObjectType: "account",
      linkedObjectKey: "[DEMO] Royal Vancouver Marina",
      keyMap: "accounts" as const,
      type: "call",
      summary: "[DEMO] Call — Ian Fletcher — Budget confirmed $150K CAD for Phase 1. Proposal requested by Apr 18.",
      outcome: "positive",
    },
    {
      linkedObjectType: "opportunity",
      linkedObjectKey: "[DEMO] Royal Vancouver Marina — Full Electrification",
      keyMap: "opportunities" as const,
      type: "meeting",
      summary: "[DEMO] Meeting — Proposal walkthrough call. 3 open questions noted. Written answers to follow EOW.",
      outcome: "positive",
    },
    {
      linkedObjectType: "account",
      linkedObjectKey: "[DEMO] Pacific Coast Harbor Group",
      keyMap: "accounts" as const,
      type: "meeting",
      summary: "[DEMO] Meeting — Intro with Janet Yuen + Marcus Webb. Fleet NPV model requested for May board presentation.",
      outcome: "positive",
    },
    {
      linkedObjectType: "opportunity",
      linkedObjectKey: "[DEMO] BlueCurrent OEM — Software Licensing Agreement",
      keyMap: "opportunities" as const,
      type: "call",
      summary: "[DEMO] Call — Rachel Ito — Legal reviewed Schedule A. Sub-licensing clause under discussion. Narrowing to NA.",
      outcome: "neutral",
    },
    {
      linkedObjectType: "account",
      linkedObjectKey: "[DEMO] Port of Cascadia",
      keyMap: "accounts" as const,
      type: "email",
      summary: "[DEMO] Email — Sent RFP response template and grant eligibility brief to Carlos Mendez.",
      outcome: "neutral",
    },
    {
      linkedObjectType: "project",
      linkedObjectKey: "[DEMO] Grant Submission Package",
      keyMap: "projects" as const,
      type: "meeting",
      summary: "[DEMO] Meeting — Dr. Anika Singh confirmed May 15 deadline and Phase 2 evaluation criteria. Strong positioning.",
      outcome: "positive",
    },
    {
      linkedObjectType: "account",
      linkedObjectKey: "[DEMO] Shoreline Technology Partners",
      keyMap: "accounts" as const,
      type: "call",
      summary: "[DEMO] Call — David Osei — Proposed co-sell referral agreement. 8% first-year share. Sending draft this week.",
      outcome: "positive",
    },
    {
      linkedObjectType: "opportunity",
      linkedObjectKey: "[DEMO] Pacific Coast Harbor Group — Fleet Contract",
      keyMap: "opportunities" as const,
      type: "note",
      summary: "[DEMO] Note — Fleet deal stalled pending Janet's board approval cycle. Next step: deliver NPV model in 10 days.",
      outcome: "neutral",
    },
  ];

  for (const a of activityDefs) {
    const linkedId = keyMaps[a.keyMap][a.linkedObjectKey];
    if (!linkedId) { console.log(`  ⚠  No id for activity linked to ${a.linkedObjectKey}`); continue; }
    const existing = await pool.query(
      `SELECT id FROM activities WHERE linked_object_type=$1 AND linked_object_id=$2 AND summary=$3 LIMIT 1`,
      [a.linkedObjectType, linkedId, a.summary]
    );
    if (existing.rows.length > 0) {
      console.log(`  ↩  Activity exists: ${a.summary.slice(0, 50)}`);
      continue;
    }
    await query(
      `INSERT INTO activities (linked_object_type, linked_object_id, type, summary, outcome, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [a.linkedObjectType, linkedId, a.type, a.summary, a.outcome, OWNER_USER_ID]
    );
    console.log(`  ✓  Created activity: ${a.summary.slice(0, 50)}`);
  }

  // ── 9. Demo Saved Views ───────────────────────────────────────────────────
  console.log("\n🔖 Seeding saved views...");

  const viewDefs = [
    {
      name: "[DEMO] My Active Accounts",
      pageKey: "accounts",
      filters: JSON.stringify({ leadStatus: "working", priority: "high", assignedToUserId: OWNER_USER_ID }),
      isShared: false,
    },
    {
      name: "[DEMO] Pilot & Lighthouse Accounts",
      pageKey: "accounts",
      filters: JSON.stringify({ tags: "pilot" }),
      isShared: true,
    },
    {
      name: "[DEMO] Open Opportunities — Commit",
      pageKey: "opportunities",
      filters: JSON.stringify({ forecastCategory: "commit", stage: "proposal" }),
      isShared: true,
    },
    {
      name: "[DEMO] Critical & High Tickets",
      pageKey: "tickets",
      filters: JSON.stringify({ severity: ["high", "critical"], status: ["new", "open", "in_progress"] }),
      isShared: true,
    },
    {
      name: "[DEMO] Active Projects",
      pageKey: "projects",
      filters: JSON.stringify({ status: "active" }),
      isShared: false,
    },
  ];

  for (const v of viewDefs) {
    const existing = await findDemoId("saved_views", "name", v.name);
    if (existing) {
      console.log(`  ↩  Saved view exists: ${v.name}`);
      continue;
    }
    await query(
      `INSERT INTO saved_views (name, page_key, filters_json, user_id, is_shared)
       VALUES ($1,$2,$3,$4,$5)`,
      [v.name, v.pageKey, v.filters, OWNER_USER_ID, v.isShared]
    );
    console.log(`  ✓  Created saved view: ${v.name}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`
✅ Demo seed complete!
   Accounts:     ${accountDefs.length}
   Contacts:     ${contactDefs.length}
   Opportunities: ${oppDefs.length}
   Tickets:      ${ticketDefs.length}
   Projects:     ${projectDefs.length}
   Tasks:        ${taskDefs.length}
   Notes:        ${noteDefs.length}
   Activities:   ${activityDefs.length}
   Saved Views:  ${viewDefs.length}

All records tagged [DEMO] — safe to filter or clean up.
Run with --cleanup to remove all demo records.
Run with --dry-run to preview without writing.
`);
}

// ── Entrypoint ────────────────────────────────────────────────────────────────
(async () => {
  checkEnv();
  if (isCleanup) {
    await cleanup();
  } else {
    await seed();
  }
  await pool.end();
})().catch(err => {
  console.error("❌ Seed failed:", err.message);
  pool.end();
  process.exit(1);
});
