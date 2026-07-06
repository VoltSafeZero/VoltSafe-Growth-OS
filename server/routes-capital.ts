import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

// ── Capital access allowlist ──────────────────────────────────────────────────
// IMPORTANT: this gate is identity-based, not role-based.
// Even admin/master_admin accounts are denied unless listed here.
// Only the users below may access the Capital module.
//
// Trevor Burgess (CEO) — user ID 4 (confirmed by SYSTEM_SENDER_ID references)
// Scott Carlson  (CFO) — no account yet; add email below when created.
export const CAPITAL_ALLOWED_USER_IDS = new Set<number>([4]);
export const CAPITAL_ALLOWED_EMAILS   = new Set<string>([
  "scott.carlson@voltsafe.com",  // CFO — Scott Carlson
]);

export async function isCapitalUser(userId: number): Promise<boolean> {
  if (CAPITAL_ALLOWED_USER_IDS.has(userId)) return true;
  if (CAPITAL_ALLOWED_EMAILS.size === 0) return false;
  try {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    return !!user?.email && CAPITAL_ALLOWED_EMAILS.has(user.email.toLowerCase());
  } catch {
    return false;
  }
}

export function requireCapitalAccess(req: Request, res: Response, next: NextFunction): void {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ message: "Not authenticated" }); return; }

  // Fast path: user ID in allowlist
  if (CAPITAL_ALLOWED_USER_IDS.has(userId)) { next(); return; }

  // Slower path: check email allowlist
  if (CAPITAL_ALLOWED_EMAILS.size === 0) {
    res.status(403).json({ message: "Capital module access restricted to authorized users only" });
    return;
  }
  db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
    .then(([user]) => {
      if (!user) { res.status(401).json({ message: "Not authenticated" }); return; }
      if (user.email && CAPITAL_ALLOWED_EMAILS.has(user.email.toLowerCase())) { next(); return; }
      res.status(403).json({ message: "Capital module access restricted to authorized users only" });
    })
    .catch(() => res.status(500).json({ message: "Internal error checking capital access" }));
}

// ── Schema migration ──────────────────────────────────────────────────────────
export async function migrateCapitalSchema(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS capital_funders (
      id                     SERIAL PRIMARY KEY,
      name                   TEXT NOT NULL,
      funder_type            TEXT NOT NULL DEFAULT 'Other',
      funder_persona         TEXT NOT NULL DEFAULT 'Unknown',
      organization           TEXT,
      primary_contact_name   TEXT,
      primary_contact_email  TEXT,
      primary_contact_phone  TEXT,
      website                TEXT,
      linkedin               TEXT,
      location               TEXT,
      geography_focus        TEXT,
      sector_focus           TEXT,
      investment_thesis      TEXT,
      relevant_themes        TEXT,
      cheque_size_min_cents  BIGINT,
      cheque_size_max_cents  BIGINT,
      typical_stage          TEXT,
      relationship_strength  TEXT NOT NULL DEFAULT 'Cold',
      intro_path             TEXT,
      status                 TEXT NOT NULL DEFAULT 'active',
      priority               TEXT NOT NULL DEFAULT 'Medium',
      fit_score              INTEGER,
      heat_score             INTEGER,
      expected_amount_cents  BIGINT,
      probability_percent    INTEGER,
      pipeline_stage         TEXT NOT NULL DEFAULT 'Target Identified',
      next_follow_up_at      TIMESTAMPTZ,
      last_contacted_at      TIMESTAMPTZ,
      owner_user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      notes                  TEXT,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS capital_grants (
      id                       SERIAL PRIMARY KEY,
      program_name             TEXT NOT NULL,
      funding_body             TEXT,
      program_type             TEXT NOT NULL DEFAULT 'Other',
      non_dilutive_or_dilutive TEXT NOT NULL DEFAULT 'Non-dilutive',
      max_funding_amount_cents BIGINT,
      cost_share_percent       INTEGER,
      eligible_costs           TEXT,
      deadline                 DATE,
      intake_type              TEXT,
      geography                TEXT,
      sector_fit               TEXT,
      eligibility_status       TEXT NOT NULL DEFAULT 'Unknown',
      application_status       TEXT NOT NULL DEFAULT 'Identified',
      required_documents       TEXT,
      reporting_burden         TEXT NOT NULL DEFAULT 'Medium',
      strategic_fit            TEXT,
      fit_score                INTEGER,
      expected_amount_cents    BIGINT,
      probability_percent      INTEGER,
      owner_user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
      next_action              TEXT,
      notes                    TEXT,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS capital_documents (
      id                    SERIAL PRIMARY KEY,
      document_name         TEXT NOT NULL,
      document_type         TEXT NOT NULL DEFAULT 'Other',
      version               TEXT,
      status                TEXT NOT NULL DEFAULT 'Draft',
      owner_user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      shared_with_funder_id INTEGER REFERENCES capital_funders(id) ON DELETE SET NULL,
      shared_at             TIMESTAMPTZ,
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS capital_activities (
      id            SERIAL PRIMARY KEY,
      funder_id     INTEGER REFERENCES capital_funders(id) ON DELETE SET NULL,
      grant_id      INTEGER REFERENCES capital_grants(id) ON DELETE SET NULL,
      activity_type TEXT NOT NULL DEFAULT 'Note',
      subject       TEXT,
      body          TEXT,
      activity_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      due_at        TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_capital_funders_pipeline_stage ON capital_funders(pipeline_stage);
    CREATE INDEX IF NOT EXISTS idx_capital_funders_priority       ON capital_funders(priority);
    CREATE INDEX IF NOT EXISTS idx_capital_funders_funder_type    ON capital_funders(funder_type);
    CREATE INDEX IF NOT EXISTS idx_capital_funders_next_followup  ON capital_funders(next_follow_up_at);
    CREATE INDEX IF NOT EXISTS idx_capital_grants_deadline        ON capital_grants(deadline);
    CREATE INDEX IF NOT EXISTS idx_capital_grants_app_status      ON capital_grants(application_status);
    CREATE INDEX IF NOT EXISTS idx_capital_activities_funder      ON capital_activities(funder_id);
    CREATE INDEX IF NOT EXISTS idx_capital_activities_grant       ON capital_activities(grant_id);
  `));
  // ── Phase 2A: new tables ─────────────────────────────────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS capital_investors (
        id                  SERIAL PRIMARY KEY,
        name                TEXT NOT NULL,
        investor_type       TEXT NOT NULL DEFAULT 'Venture Capital',
        status              TEXT NOT NULL DEFAULT 'Active',
        priority            TEXT NOT NULL DEFAULT 'Medium',
        stage               TEXT NOT NULL DEFAULT 'Target Identified',
        check_size_min      BIGINT,
        check_size_max      BIGINT,
        currency            TEXT NOT NULL DEFAULT 'CAD',
        probability         INTEGER,
        source              TEXT,
        introducer_name     TEXT,
        website             TEXT,
        country             TEXT,
        region              TEXT,
        strategic_relevance TEXT,
        thesis_fit          TEXT,
        notes               TEXT,
        last_touch_at       TIMESTAMPTZ,
        next_step           TEXT,
        next_step_date      DATE,
        related_round_id    INTEGER,
        data_room_status    TEXT NOT NULL DEFAULT 'Not Shared',
        can_write_cheque    BOOLEAN NOT NULL DEFAULT TRUE,
        created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS capital_contacts (
        id                   SERIAL PRIMARY KEY,
        investor_id          INTEGER REFERENCES capital_investors(id) ON DELETE SET NULL,
        first_name           TEXT NOT NULL,
        last_name            TEXT,
        full_name            TEXT,
        title                TEXT,
        email                TEXT,
        phone                TEXT,
        linkedin_url         TEXT,
        role_type            TEXT NOT NULL DEFAULT 'Other',
        influence_level      TEXT NOT NULL DEFAULT 'Medium',
        relationship_strength TEXT NOT NULL DEFAULT 'Cold',
        notes                TEXT,
        last_touch_at        TIMESTAMPTZ,
        next_step            TEXT,
        next_step_date       DATE,
        created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS capital_rounds (
        id                   SERIAL PRIMARY KEY,
        name                 TEXT NOT NULL,
        round_type           TEXT NOT NULL DEFAULT 'Seed',
        target_amount        BIGINT,
        currency             TEXT NOT NULL DEFAULT 'CAD',
        pre_money_valuation  BIGINT,
        post_money_valuation BIGINT,
        minimum_check_size   BIGINT,
        status               TEXT NOT NULL DEFAULT 'Planning',
        open_date            DATE,
        target_close_date    DATE,
        actual_close_date    DATE,
        notes                TEXT,
        created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS capital_commitments (
        id                  SERIAL PRIMARY KEY,
        investor_id         INTEGER REFERENCES capital_investors(id) ON DELETE SET NULL,
        round_id            INTEGER REFERENCES capital_rounds(id) ON DELETE SET NULL,
        contact_id          INTEGER REFERENCES capital_contacts(id) ON DELETE SET NULL,
        amount              BIGINT,
        currency            TEXT NOT NULL DEFAULT 'CAD',
        commitment_stage    TEXT NOT NULL DEFAULT 'Verbal Interest',
        probability         INTEGER,
        expected_close_date DATE,
        actual_close_date   DATE,
        terms_summary       TEXT,
        notes               TEXT,
        created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE capital_activities ADD COLUMN IF NOT EXISTS entity_type TEXT;
      ALTER TABLE capital_activities ADD COLUMN IF NOT EXISTS entity_id   INTEGER;
      ALTER TABLE capital_activities ADD COLUMN IF NOT EXISTS title       TEXT;
      ALTER TABLE capital_activities ADD COLUMN IF NOT EXISTS old_value   TEXT;
      ALTER TABLE capital_activities ADD COLUMN IF NOT EXISTS new_value   TEXT;
      ALTER TABLE capital_activities ADD COLUMN IF NOT EXISTS created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_capital_investors_stage      ON capital_investors(stage);
      CREATE INDEX IF NOT EXISTS idx_capital_investors_priority   ON capital_investors(priority);
      CREATE INDEX IF NOT EXISTS idx_capital_investors_type       ON capital_investors(investor_type);
      CREATE INDEX IF NOT EXISTS idx_capital_investors_next_step  ON capital_investors(next_step_date);
      CREATE INDEX IF NOT EXISTS idx_capital_contacts_investor    ON capital_contacts(investor_id);
      CREATE INDEX IF NOT EXISTS idx_capital_rounds_status        ON capital_rounds(status);
      CREATE INDEX IF NOT EXISTS idx_capital_commitments_investor ON capital_commitments(investor_id);
      CREATE INDEX IF NOT EXISTS idx_capital_commitments_round    ON capital_commitments(round_id);
      CREATE INDEX IF NOT EXISTS idx_capital_activities_entity    ON capital_activities(entity_type, entity_id);
    `));
  } catch (_e2) { /* already exists — idempotent */ }

  // ── Phase 2C: Investor Intelligence fields ────────────────────────────────
  try {
    await db.execute(sql.raw(`
      ALTER TABLE capital_investors ADD COLUMN IF NOT EXISTS warmth                  TEXT    NOT NULL DEFAULT 'Cold';
      ALTER TABLE capital_investors ADD COLUMN IF NOT EXISTS do_not_contact          BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE capital_investors ADD COLUMN IF NOT EXISTS disqualification_reason TEXT;
      ALTER TABLE capital_investors ADD COLUMN IF NOT EXISTS relationship_strength   TEXT;
      ALTER TABLE capital_investors ADD COLUMN IF NOT EXISTS target_cheque_amount    BIGINT;
      ALTER TABLE capital_investors ADD COLUMN IF NOT EXISTS likely_lead             BOOLEAN NOT NULL DEFAULT FALSE;
    `));
  } catch (_e3) { /* already exists — idempotent */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function weighted(expected: number | null | undefined, prob: number | null | undefined): number | null {
  if (expected == null || prob == null) return null;
  return Math.round((expected * prob) / 100);
}

function formatCents(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function formatInt(v: any): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}
function safeId(v: any): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

function esc(v: string): string { return String(v).replace(/'/g, "''"); }

// ── Phase 2C: Investor scoring ────────────────────────────────────────────────
type InvestorScoreResult = {
  score: number;
  tier: "Hot" | "Warm" | "Nurture" | "Low Priority" | "Do Not Contact";
  reasons: string[];
};

function computeInvestorScore(inv: {
  stage?: string; priority?: string; warmth?: string; can_write_cheque?: boolean;
  last_touch_at?: string | null; next_step_date?: string | null;
  relationship_strength?: string | null; do_not_contact?: boolean;
  check_size_max?: number | null; probability?: number | null; status?: string;
}): InvestorScoreResult {
  if (inv.do_not_contact) {
    return { score: 0, tier: "Do Not Contact", reasons: ["Marked Do Not Contact"] };
  }
  if (inv.stage === "Passed" || inv.status === "Passed") {
    return { score: 0, tier: "Do Not Contact", reasons: ["Investor has passed"] };
  }

  let score = 0;
  const reasons: string[] = [];

  const stageScores: Record<string, number> = {
    "Wired / Closed": 40, "Committed": 40, "Soft Commit": 35,
    "Partner Meeting": 30, "Diligence": 25, "Follow-Up": 15,
    "First Meeting": 10, "Intro Made": 5, "Intro Needed": 3,
    "Target Identified": 0,
  };
  const ss = stageScores[inv.stage ?? ""] ?? 0;
  score += ss;
  if (ss >= 25) reasons.push(`Advanced stage: ${inv.stage}`);
  else if (ss > 0) reasons.push(`Stage: ${inv.stage}`);

  const priorityScores: Record<string, number> = { "Critical": 30, "High": 20, "Medium": 10, "Low": 0 };
  const ps = priorityScores[inv.priority ?? ""] ?? 10;
  score += ps;
  if (inv.priority === "Critical" || inv.priority === "High") reasons.push(`Priority: ${inv.priority}`);

  const warmthScores: Record<string, number> = { "Hot": 20, "Warm": 15, "Engaged": 10, "Lukewarm": 5, "Cold": 0, "Unresponsive": -5 };
  const ws = warmthScores[inv.warmth ?? "Cold"] ?? 0;
  score += ws;
  if (ws >= 10) reasons.push(`Warmth: ${inv.warmth}`);

  const relScores: Record<string, number> = { "Strong": 15, "Good": 10, "Developing": 5, "Warm": 8, "Cold": 0 };
  const rs = relScores[inv.relationship_strength ?? ""] ?? 0;
  score += rs;
  if (rs >= 10) reasons.push("Strong relationship");

  if (inv.can_write_cheque === false) { score -= 15; reasons.push("No direct cheque capacity"); }

  const now = Date.now();
  if (inv.last_touch_at) {
    const ageDays = (now - new Date(inv.last_touch_at).getTime()) / 86400000;
    if (ageDays <= 14) { score += 10; reasons.push("Recently contacted"); }
    else if (ageDays > 90) { score -= 20; reasons.push(`Dormant: ${Math.round(ageDays)}d since last touch`); }
    else if (ageDays > 60) { score -= 10; reasons.push(`No touch in ${Math.round(ageDays)} days`); }
  } else {
    score -= 15;
    reasons.push("Never contacted");
  }

  if (inv.next_step_date) {
    const diff = (new Date(inv.next_step_date).getTime() - now) / 86400000;
    if (diff < 0) { score += 5; reasons.push("Overdue follow-up — action needed"); }
    else if (diff <= 7) { score += 8; reasons.push("Follow-up due this week"); }
    else { score += 3; }
  } else {
    score -= 8;
    reasons.push("No next step scheduled");
  }

  if (inv.check_size_max != null && inv.check_size_max >= 500000) {
    score += 5; reasons.push("Large cheque capacity");
  }
  if (inv.probability != null && inv.probability >= 50) {
    score += 5; reasons.push(`High probability (${inv.probability}%)`);
  }

  let tier: InvestorScoreResult["tier"];
  if (score >= 55)      tier = "Hot";
  else if (score >= 35) tier = "Warm";
  else if (score >= 15) tier = "Nurture";
  else                  tier = "Low Priority";

  return { score: Math.max(0, Math.min(100, score)), tier, reasons };
}

async function logCapitalActivity(
  entityType: string,
  entityId: number,
  activityType: string,
  title: string,
  opts: { oldValue?: string | null; newValue?: string | null; body?: string | null; createdBy?: number | null } = {}
): Promise<void> {
  try {
    await db.execute(sql.raw(`
      INSERT INTO capital_activities
        (entity_type, entity_id, activity_type, title, old_value, new_value, body, created_by, activity_at)
      VALUES (
        '${esc(entityType)}',
        ${entityId},
        '${esc(activityType)}',
        '${esc(title)}',
        ${opts.oldValue != null ? `'${esc(opts.oldValue)}'` : "NULL"},
        ${opts.newValue != null ? `'${esc(opts.newValue)}'` : "NULL"},
        ${opts.body     != null ? `'${esc(opts.body)}'`     : "NULL"},
        ${opts.createdBy ?? "NULL"},
        NOW()
      )
    `));
  } catch { /* audit write failure must never surface to caller */ }
}

// ── Routes ────────────────────────────────────────────────────────────────────
export function registerCapitalRoutes(app: Express, requireAuth: any): void {

  // ── Dashboard ───────────────────────────────────────────────────────────────
  app.get("/api/capital/dashboard", requireAuth, requireCapitalAccess, async (_req, res) => {
    try {
      const [funders, grants, docs, activities] = await Promise.all([
        db.execute(sql.raw(`SELECT * FROM capital_funders ORDER BY priority DESC, updated_at DESC`)),
        db.execute(sql.raw(`SELECT * FROM capital_grants ORDER BY deadline ASC NULLS LAST, updated_at DESC`)),
        db.execute(sql.raw(`SELECT cd.*, cf.name AS funder_name FROM capital_documents cd LEFT JOIN capital_funders cf ON cd.shared_with_funder_id = cf.id ORDER BY cd.updated_at DESC`)),
        db.execute(sql.raw(`SELECT ca.*, cf.name AS funder_name FROM capital_activities ca LEFT JOIN capital_funders cf ON ca.funder_id = cf.id ORDER BY ca.due_at ASC NULLS LAST LIMIT 20`)),
      ]);

      const fRows = funders.rows as any[];
      const gRows = grants.rows as any[];
      const dRows = docs.rows as any[];
      const aRows = activities.rows as any[];

      const committedStages = new Set(["Committed", "Wired"]);
      const softStages = new Set(["Soft Commitment"]);
      const diligenceDocStatuses = new Set(["Draft", "Needs Update"]);

      const committedCents = fRows
        .filter(f => committedStages.has(f.pipeline_stage))
        .reduce((s, f) => s + (Number(f.expected_amount_cents) || 0), 0);
      const softCircledCents = fRows
        .filter(f => softStages.has(f.pipeline_stage))
        .reduce((s, f) => s + (Number(f.expected_amount_cents) || 0), 0);
      const weightedFunderCents = fRows
        .filter(f => !["Passed", "Nurture"].includes(f.pipeline_stage))
        .reduce((s, f) => s + (weighted(Number(f.expected_amount_cents) || null, Number(f.probability_percent) || null) ?? 0), 0);
      const weightedGrantCents = gRows
        .filter(g => !["Rejected", "Closed"].includes(g.application_status))
        .reduce((s, g) => s + (weighted(Number(g.expected_amount_cents) || null, Number(g.probability_percent) || null) ?? 0), 0);

      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 86400000);
      const upcomingDeadlines = gRows
        .filter(g => g.deadline && new Date(g.deadline) <= in30 && !["Rejected", "Closed"].includes(g.application_status))
        .slice(0, 5);

      const nextFollowUps = fRows
        .filter(f => f.next_follow_up_at && new Date(f.next_follow_up_at) >= now)
        .sort((a, b) => new Date(a.next_follow_up_at).getTime() - new Date(b.next_follow_up_at).getTime())
        .slice(0, 5);

      const topFunders = fRows
        .filter(f => f.priority === "High" && !["Passed", "Wired"].includes(f.pipeline_stage))
        .slice(0, 5);

      const topGrants = gRows
        .filter(g => !["Rejected", "Closed", "Approved"].includes(g.application_status))
        .slice(0, 5);

      const documentBlockers = dRows
        .filter(d => diligenceDocStatuses.has(d.status) && d.shared_with_funder_id)
        .slice(0, 5);

      res.json({
        committedCents,
        softCircledCents,
        weightedFunderPipelineCents: weightedFunderCents,
        weightedGrantPipelineCents: weightedGrantCents,
        upcomingDeadlines,
        nextFollowUps,
        topPriorityFunders: topFunders,
        topPriorityGrants: topGrants,
        documentBlockers,
        totalFunders: fRows.length,
        totalGrants: gRows.length,
        totalDocuments: dRows.length,
        pendingActivities: aRows.filter(a => !a.completed_at).length,
      });
    } catch (err: any) {
      console.error("[capital] GET /dashboard:", err?.message);
      res.status(500).json({ message: "Failed to load capital dashboard" });
    }
  });

  // ── Funders ─────────────────────────────────────────────────────────────────
  app.get("/api/capital/funders", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { type, persona, stage, priority, q } = req.query as any;
      let where = "WHERE 1=1";
      if (type)     where += ` AND funder_type = '${type.replace(/'/g, "''")}'`;
      if (persona)  where += ` AND funder_persona = '${persona.replace(/'/g, "''")}'`;
      if (stage)    where += ` AND pipeline_stage = '${stage.replace(/'/g, "''")}'`;
      if (priority) where += ` AND priority = '${priority.replace(/'/g, "''")}'`;
      if (q)        where += ` AND (name ILIKE '%${q.replace(/'/g, "''")}%' OR organization ILIKE '%${q.replace(/'/g, "''")}%' OR primary_contact_name ILIKE '%${q.replace(/'/g, "''")}%')`;
      const rows = await db.execute(sql.raw(`SELECT * FROM capital_funders ${where} ORDER BY priority DESC, updated_at DESC LIMIT 200`));
      const funders = (rows.rows as any[]).map(f => ({
        ...f,
        weighted_amount_cents: weighted(Number(f.expected_amount_cents) || null, Number(f.probability_percent) || null),
      }));
      res.json(funders);
    } catch (err: any) {
      console.error("[capital] GET /funders:", err?.message);
      res.status(500).json({ message: "Failed to load funders" });
    }
  });

  app.post("/api/capital/funders", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const {
        name, funder_type, funder_persona, organization, primary_contact_name,
        primary_contact_email, primary_contact_phone, website, linkedin, location,
        geography_focus, sector_focus, investment_thesis, relevant_themes,
        cheque_size_min_cents, cheque_size_max_cents, typical_stage,
        relationship_strength, intro_path, priority, fit_score, heat_score,
        expected_amount_cents, probability_percent, pipeline_stage,
        next_follow_up_at, last_contacted_at, notes,
      } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "name is required" });
      const exp = formatCents(expected_amount_cents);
      const prob = formatInt(probability_percent);
      const wtd = weighted(exp, prob);
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_funders
          (name, funder_type, funder_persona, organization, primary_contact_name,
           primary_contact_email, primary_contact_phone, website, linkedin, location,
           geography_focus, sector_focus, investment_thesis, relevant_themes,
           cheque_size_min_cents, cheque_size_max_cents, typical_stage,
           relationship_strength, intro_path, priority, fit_score, heat_score,
           expected_amount_cents, probability_percent, pipeline_stage,
           next_follow_up_at, last_contacted_at, owner_user_id, notes)
        VALUES (
          '${(name||"").replace(/'/g,"''")}',
          '${(funder_type||"Other").replace(/'/g,"''")}',
          '${(funder_persona||"Unknown").replace(/'/g,"''")}',
          ${organization ? `'${String(organization).replace(/'/g,"''")}'` : "NULL"},
          ${primary_contact_name ? `'${String(primary_contact_name).replace(/'/g,"''")}'` : "NULL"},
          ${primary_contact_email ? `'${String(primary_contact_email).replace(/'/g,"''")}'` : "NULL"},
          ${primary_contact_phone ? `'${String(primary_contact_phone).replace(/'/g,"''")}'` : "NULL"},
          ${website ? `'${String(website).replace(/'/g,"''")}'` : "NULL"},
          ${linkedin ? `'${String(linkedin).replace(/'/g,"''")}'` : "NULL"},
          ${location ? `'${String(location).replace(/'/g,"''")}'` : "NULL"},
          ${geography_focus ? `'${String(geography_focus).replace(/'/g,"''")}'` : "NULL"},
          ${sector_focus ? `'${String(sector_focus).replace(/'/g,"''")}'` : "NULL"},
          ${investment_thesis ? `'${String(investment_thesis).replace(/'/g,"''")}'` : "NULL"},
          ${relevant_themes ? `'${String(relevant_themes).replace(/'/g,"''")}'` : "NULL"},
          ${formatCents(cheque_size_min_cents) ?? "NULL"},
          ${formatCents(cheque_size_max_cents) ?? "NULL"},
          ${typical_stage ? `'${String(typical_stage).replace(/'/g,"''")}'` : "NULL"},
          '${(relationship_strength||"Cold").replace(/'/g,"''")}',
          ${intro_path ? `'${String(intro_path).replace(/'/g,"''")}'` : "NULL"},
          '${(priority||"Medium").replace(/'/g,"''")}',
          ${formatInt(fit_score) ?? "NULL"},
          ${formatInt(heat_score) ?? "NULL"},
          ${exp ?? "NULL"},
          ${prob ?? "NULL"},
          '${(pipeline_stage||"Target Identified").replace(/'/g,"''")}',
          ${next_follow_up_at ? `'${next_follow_up_at}'` : "NULL"},
          ${last_contacted_at ? `'${last_contacted_at}'` : "NULL"},
          ${req.session.userId},
          ${notes ? `'${String(notes).replace(/'/g,"''")}'` : "NULL"}
        ) RETURNING *
      `));
      const f = row.rows[0] as any;
      res.status(201).json({ ...f, weighted_amount_cents: wtd });
    } catch (err: any) {
      console.error("[capital] POST /funders:", err?.message);
      res.status(500).json({ message: "Failed to create funder" });
    }
  });

  app.get("/api/capital/funders/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const rows = await db.execute(sql.raw(`SELECT * FROM capital_funders WHERE id = ${id} LIMIT 1`));
      const f = rows.rows[0] as any;
      if (!f) return res.status(404).json({ message: "Funder not found" });
      res.json({ ...f, weighted_amount_cents: weighted(Number(f.expected_amount_cents)||null, Number(f.probability_percent)||null) });
    } catch (err: any) {
      console.error("[capital] GET /funders/:id:", err?.message);
      res.status(500).json({ message: "Failed to load funder" });
    }
  });

  app.patch("/api/capital/funders/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const allowed = [
        "name","funder_type","funder_persona","organization","primary_contact_name",
        "primary_contact_email","primary_contact_phone","website","linkedin","location",
        "geography_focus","sector_focus","investment_thesis","relevant_themes",
        "cheque_size_min_cents","cheque_size_max_cents","typical_stage",
        "relationship_strength","intro_path","priority","fit_score","heat_score",
        "expected_amount_cents","probability_percent","pipeline_stage",
        "next_follow_up_at","last_contacted_at","notes","status",
      ];
      const sets: string[] = [`updated_at = NOW()`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") {
          sets.push(`${key} = NULL`);
        } else if (["cheque_size_min_cents","cheque_size_max_cents","expected_amount_cents","fit_score","heat_score","probability_percent"].includes(key)) {
          const n = Number(v);
          if (!isNaN(n)) sets.push(`${key} = ${n}`);
        } else {
          sets.push(`${key} = '${String(v).replace(/'/g,"''")}'`);
        }
      }
      if (sets.length === 1) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_funders SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
      const f = rows.rows[0] as any;
      if (!f) return res.status(404).json({ message: "Funder not found" });
      res.json({ ...f, weighted_amount_cents: weighted(Number(f.expected_amount_cents)||null, Number(f.probability_percent)||null) });
    } catch (err: any) {
      console.error("[capital] PATCH /funders/:id:", err?.message);
      res.status(500).json({ message: "Failed to update funder" });
    }
  });

  app.delete("/api/capital/funders/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      // Null out FK references before deleting
      await db.execute(sql.raw(`UPDATE capital_documents  SET shared_with_funder_id = NULL WHERE shared_with_funder_id = ${id}`));
      await db.execute(sql.raw(`UPDATE capital_activities SET funder_id = NULL WHERE funder_id = ${id}`));
      await db.execute(sql.raw(`DELETE FROM capital_funders WHERE id = ${id}`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /funders/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete funder" });
    }
  });

  // ── Grants ──────────────────────────────────────────────────────────────────
  app.get("/api/capital/grants", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { status, type, q } = req.query as any;
      let where = "WHERE 1=1";
      if (status) where += ` AND application_status = '${status.replace(/'/g,"''")}'`;
      if (type)   where += ` AND program_type = '${type.replace(/'/g,"''")}'`;
      if (q)      where += ` AND (program_name ILIKE '%${q.replace(/'/g,"''")}%' OR funding_body ILIKE '%${q.replace(/'/g,"''")}%')`;
      const rows = await db.execute(sql.raw(`SELECT * FROM capital_grants ${where} ORDER BY deadline ASC NULLS LAST, updated_at DESC LIMIT 200`));
      const grants = (rows.rows as any[]).map(g => ({
        ...g,
        weighted_amount_cents: weighted(Number(g.expected_amount_cents)||null, Number(g.probability_percent)||null),
      }));
      res.json(grants);
    } catch (err: any) {
      console.error("[capital] GET /grants:", err?.message);
      res.status(500).json({ message: "Failed to load grants" });
    }
  });

  app.post("/api/capital/grants", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const {
        program_name, funding_body, program_type, non_dilutive_or_dilutive,
        max_funding_amount_cents, cost_share_percent, eligible_costs, deadline,
        intake_type, geography, sector_fit, eligibility_status, application_status,
        required_documents, reporting_burden, strategic_fit, fit_score,
        expected_amount_cents, probability_percent, next_action, notes,
      } = req.body;
      if (!program_name?.trim()) return res.status(400).json({ message: "program_name is required" });
      const exp = formatCents(expected_amount_cents);
      const prob = formatInt(probability_percent);
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_grants
          (program_name, funding_body, program_type, non_dilutive_or_dilutive,
           max_funding_amount_cents, cost_share_percent, eligible_costs, deadline,
           intake_type, geography, sector_fit, eligibility_status, application_status,
           required_documents, reporting_burden, strategic_fit, fit_score,
           expected_amount_cents, probability_percent, owner_user_id, next_action, notes)
        VALUES (
          '${(program_name||"").replace(/'/g,"''")}',
          ${funding_body ? `'${String(funding_body).replace(/'/g,"''")}'` : "NULL"},
          '${(program_type||"Other").replace(/'/g,"''")}',
          '${(non_dilutive_or_dilutive||"Non-dilutive").replace(/'/g,"''")}',
          ${formatCents(max_funding_amount_cents) ?? "NULL"},
          ${formatInt(cost_share_percent) ?? "NULL"},
          ${eligible_costs ? `'${String(eligible_costs).replace(/'/g,"''")}'` : "NULL"},
          ${deadline ? `'${deadline}'` : "NULL"},
          ${intake_type ? `'${String(intake_type).replace(/'/g,"''")}'` : "NULL"},
          ${geography ? `'${String(geography).replace(/'/g,"''")}'` : "NULL"},
          ${sector_fit ? `'${String(sector_fit).replace(/'/g,"''")}'` : "NULL"},
          '${(eligibility_status||"Unknown").replace(/'/g,"''")}',
          '${(application_status||"Identified").replace(/'/g,"''")}',
          ${required_documents ? `'${String(required_documents).replace(/'/g,"''")}'` : "NULL"},
          '${(reporting_burden||"Medium").replace(/'/g,"''")}',
          ${strategic_fit ? `'${String(strategic_fit).replace(/'/g,"''")}'` : "NULL"},
          ${formatInt(fit_score) ?? "NULL"},
          ${exp ?? "NULL"},
          ${prob ?? "NULL"},
          ${req.session.userId},
          ${next_action ? `'${String(next_action).replace(/'/g,"''")}'` : "NULL"},
          ${notes ? `'${String(notes).replace(/'/g,"''")}'` : "NULL"}
        ) RETURNING *
      `));
      const g = row.rows[0] as any;
      res.status(201).json({ ...g, weighted_amount_cents: weighted(exp, prob) });
    } catch (err: any) {
      console.error("[capital] POST /grants:", err?.message);
      res.status(500).json({ message: "Failed to create grant" });
    }
  });

  app.get("/api/capital/grants/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const rows = await db.execute(sql.raw(`SELECT * FROM capital_grants WHERE id = ${id} LIMIT 1`));
      const g = rows.rows[0] as any;
      if (!g) return res.status(404).json({ message: "Grant not found" });
      res.json({ ...g, weighted_amount_cents: weighted(Number(g.expected_amount_cents)||null, Number(g.probability_percent)||null) });
    } catch (err: any) {
      console.error("[capital] GET /grants/:id:", err?.message);
      res.status(500).json({ message: "Failed to load grant" });
    }
  });

  app.patch("/api/capital/grants/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const allowed = [
        "program_name","funding_body","program_type","non_dilutive_or_dilutive",
        "max_funding_amount_cents","cost_share_percent","eligible_costs","deadline",
        "intake_type","geography","sector_fit","eligibility_status","application_status",
        "required_documents","reporting_burden","strategic_fit","fit_score",
        "expected_amount_cents","probability_percent","next_action","notes",
      ];
      const sets: string[] = [`updated_at = NOW()`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") {
          sets.push(`${key} = NULL`);
        } else if (["max_funding_amount_cents","cost_share_percent","fit_score","expected_amount_cents","probability_percent"].includes(key)) {
          const n = Number(v);
          if (!isNaN(n)) sets.push(`${key} = ${n}`);
        } else {
          sets.push(`${key} = '${String(v).replace(/'/g,"''")}'`);
        }
      }
      if (sets.length === 1) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_grants SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
      const g = rows.rows[0] as any;
      if (!g) return res.status(404).json({ message: "Grant not found" });
      res.json({ ...g, weighted_amount_cents: weighted(Number(g.expected_amount_cents)||null, Number(g.probability_percent)||null) });
    } catch (err: any) {
      console.error("[capital] PATCH /grants/:id:", err?.message);
      res.status(500).json({ message: "Failed to update grant" });
    }
  });

  app.delete("/api/capital/grants/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(`UPDATE capital_activities SET grant_id = NULL WHERE grant_id = ${id}`));
      await db.execute(sql.raw(`DELETE FROM capital_grants WHERE id = ${id}`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /grants/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete grant" });
    }
  });

  // ── Documents ───────────────────────────────────────────────────────────────
  app.get("/api/capital/documents", requireAuth, requireCapitalAccess, async (_req, res) => {
    try {
      const rows = await db.execute(sql.raw(`
        SELECT cd.*, cf.name AS funder_name
        FROM capital_documents cd
        LEFT JOIN capital_funders cf ON cd.shared_with_funder_id = cf.id
        ORDER BY cd.updated_at DESC LIMIT 200
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /documents:", err?.message);
      res.status(500).json({ message: "Failed to load documents" });
    }
  });

  app.post("/api/capital/documents", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const { document_name, document_type, version, status, shared_with_funder_id, shared_at, notes } = req.body;
      if (!document_name?.trim()) return res.status(400).json({ message: "document_name is required" });
      const funderId = safeId(shared_with_funder_id);
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_documents (document_name, document_type, version, status, owner_user_id, shared_with_funder_id, shared_at, notes)
        VALUES (
          '${String(document_name).replace(/'/g,"''")}',
          '${(document_type||"Other").replace(/'/g,"''")}',
          ${version ? `'${String(version).replace(/'/g,"''")}'` : "NULL"},
          '${(status||"Draft").replace(/'/g,"''")}',
          ${req.session.userId},
          ${funderId ?? "NULL"},
          ${shared_at ? `'${shared_at}'` : "NULL"},
          ${notes ? `'${String(notes).replace(/'/g,"''")}'` : "NULL"}
        ) RETURNING *
      `));
      res.status(201).json(row.rows[0]);
    } catch (err: any) {
      console.error("[capital] POST /documents:", err?.message);
      res.status(500).json({ message: "Failed to create document" });
    }
  });

  app.patch("/api/capital/documents/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const allowed = ["document_name","document_type","version","status","shared_with_funder_id","shared_at","notes"];
      const sets: string[] = [`updated_at = NOW()`, `last_updated_at = NOW()`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") {
          sets.push(`${key} = NULL`);
        } else if (key === "shared_with_funder_id") {
          const n = safeId(v);
          if (n) sets.push(`${key} = ${n}`);
        } else {
          sets.push(`${key} = '${String(v).replace(/'/g,"''")}'`);
        }
      }
      if (sets.length === 2) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_documents SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
      if (!rows.rows[0]) return res.status(404).json({ message: "Document not found" });
      res.json(rows.rows[0]);
    } catch (err: any) {
      console.error("[capital] PATCH /documents/:id:", err?.message);
      res.status(500).json({ message: "Failed to update document" });
    }
  });

  app.delete("/api/capital/documents/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(`DELETE FROM capital_documents WHERE id = ${id}`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /documents/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // ── Activities ──────────────────────────────────────────────────────────────
  app.get("/api/capital/activities", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { funder_id, grant_id } = req.query as any;
      let where = "WHERE 1=1";
      if (funder_id) where += ` AND funder_id = ${safeId(funder_id) ?? 0}`;
      if (grant_id)  where += ` AND grant_id = ${safeId(grant_id) ?? 0}`;
      const rows = await db.execute(sql.raw(`SELECT * FROM capital_activities ${where} ORDER BY activity_at DESC LIMIT 100`));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /activities:", err?.message);
      res.status(500).json({ message: "Failed to load activities" });
    }
  });

  app.post("/api/capital/activities", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const { funder_id, grant_id, activity_type, subject, body, activity_at, due_at } = req.body;
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_activities (funder_id, grant_id, activity_type, subject, body, activity_at, due_at, owner_user_id)
        VALUES (
          ${safeId(funder_id) ?? "NULL"},
          ${safeId(grant_id) ?? "NULL"},
          '${(activity_type||"Note").replace(/'/g,"''")}',
          ${subject ? `'${String(subject).replace(/'/g,"''")}'` : "NULL"},
          ${body ? `'${String(body).replace(/'/g,"''")}'` : "NULL"},
          ${activity_at ? `'${activity_at}'` : "NOW()"},
          ${due_at ? `'${due_at}'` : "NULL"},
          ${req.session.userId}
        ) RETURNING *
      `));
      res.status(201).json(row.rows[0]);
    } catch (err: any) {
      console.error("[capital] POST /activities:", err?.message);
      res.status(500).json({ message: "Failed to create activity" });
    }
  });

  app.patch("/api/capital/activities/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const allowed = ["activity_type","subject","body","activity_at","due_at","completed_at"];
      const sets: string[] = [`updated_at = NOW()`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") sets.push(`${key} = NULL`);
        else sets.push(`${key} = '${String(v).replace(/'/g,"''")}'`);
      }
      const rows = await db.execute(sql.raw(`UPDATE capital_activities SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
      if (!rows.rows[0]) return res.status(404).json({ message: "Activity not found" });
      res.json(rows.rows[0]);
    } catch (err: any) {
      console.error("[capital] PATCH /activities/:id:", err?.message);
      res.status(500).json({ message: "Failed to update activity" });
    }
  });

  app.delete("/api/capital/activities/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(`DELETE FROM capital_activities WHERE id = ${id}`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /activities/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete activity" });
    }
  });

  // ── Pipeline (capital_investors) ────────────────────────────────────────────
  app.get("/api/capital/pipeline", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { stage, priority, type } = req.query as any;
      let whereClause = "WHERE 1=1";
      if (stage)    whereClause += ` AND ci.stage = '${esc(stage)}'`;
      if (priority) whereClause += ` AND ci.priority = '${esc(priority)}'`;
      if (type)     whereClause += ` AND ci.investor_type = '${esc(type)}'`;

      const [summaryRows, investorRows] = await Promise.all([
        // Stage summary: count, max cheque total, weighted total, committed total
        db.execute(sql.raw(`
          SELECT ci.stage,
                 COUNT(*) AS count,
                 COALESCE(SUM(ci.check_size_max), 0) AS total_max,
                 COALESCE(SUM(CASE WHEN ci.check_size_max IS NOT NULL AND ci.probability IS NOT NULL
                                   THEN ci.check_size_max * ci.probability / 100 ELSE 0 END), 0) AS total_weighted,
                 COALESCE(SUM(cm_agg.committed_total), 0) AS total_committed
          FROM capital_investors ci
          LEFT JOIN (
            SELECT investor_id, SUM(amount) AS committed_total
            FROM capital_commitments
            GROUP BY investor_id
          ) cm_agg ON cm_agg.investor_id = ci.id
          ${whereClause}
          GROUP BY ci.stage
        `)),
        // Investor list: full row + primary contact name + last activity + committed amount
        db.execute(sql.raw(`
          SELECT ci.*,
                 (SELECT full_name FROM capital_contacts
                  WHERE investor_id = ci.id ORDER BY id ASC LIMIT 1) AS primary_contact_name,
                 COALESCE(
                   (SELECT MAX(activity_at) FROM capital_activities
                    WHERE entity_type = 'investor' AND entity_id = ci.id),
                   ci.updated_at
                 ) AS last_activity_at,
                 COALESCE(
                   (SELECT SUM(amount) FROM capital_commitments WHERE investor_id = ci.id),
                   0
                 ) AS committed_amount
          FROM capital_investors ci
          ${whereClause}
          ORDER BY
            CASE ci.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
            ci.next_step_date ASC NULLS LAST,
            ci.updated_at DESC
          LIMIT 300
        `)),
      ]);
      res.json({ stagesSummary: summaryRows.rows, investors: investorRows.rows });
    } catch (err: any) {
      console.error("[capital] GET /pipeline:", err?.message);
      res.status(500).json({ message: "Failed to load pipeline" });
    }
  });

  // ── Investors (Phase 2A) ─────────────────────────────────────────────────────
  app.get("/api/capital/investors", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { investor_type, stage, status, priority, round_id, can_write_cheque, search, next_step_due, sort } = req.query as any;
      let where = "WHERE 1=1";
      if (investor_type)             where += ` AND investor_type = '${esc(investor_type)}'`;
      if (stage)                     where += ` AND stage = '${esc(stage)}'`;
      if (status)                    where += ` AND status = '${esc(status)}'`;
      if (priority)                  where += ` AND priority = '${esc(priority)}'`;
      if (round_id) { const rid = safeId(round_id); if (rid) where += ` AND related_round_id = ${rid}`; }
      if (can_write_cheque === "true")  where += ` AND can_write_cheque = TRUE`;
      if (can_write_cheque === "false") where += ` AND can_write_cheque = FALSE`;
      if (search)                    where += ` AND (name ILIKE '%${esc(search)}%' OR COALESCE(source,'') ILIKE '%${esc(search)}%' OR COALESCE(introducer_name,'') ILIKE '%${esc(search)}%' OR COALESCE(notes,'') ILIKE '%${esc(search)}%')`;
      if (next_step_due)             where += ` AND next_step_date <= '${esc(next_step_due)}'`;
      const orderBy = sort === "name"  ? "name ASC" :
                      sort === "stage" ? "stage ASC" :
                      "CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, next_step_date ASC NULLS LAST, updated_at DESC";
      const rows = await db.execute(sql.raw(`SELECT * FROM capital_investors ${where} ORDER BY ${orderBy} LIMIT 300`));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /investors:", err?.message);
      res.status(500).json({ message: "Failed to load investors" });
    }
  });

  app.post("/api/capital/investors", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const {
        name, investor_type, status, priority, stage, check_size_min, check_size_max,
        currency, probability, source, introducer_name, website, country, region,
        strategic_relevance, thesis_fit, notes, last_touch_at, next_step, next_step_date,
        related_round_id, data_room_status, can_write_cheque,
      } = req.body;
      if (!name?.trim())          return res.status(400).json({ message: "name is required" });
      if (!investor_type?.trim()) return res.status(400).json({ message: "investor_type is required" });
      if (!stage?.trim())         return res.status(400).json({ message: "stage is required" });
      const prob = formatInt(probability);
      if (prob != null && (prob < 0 || prob > 100)) return res.status(400).json({ message: "probability must be 0–100" });
      const min = formatCents(check_size_min);
      const max = formatCents(check_size_max);
      if (min != null && min < 0) return res.status(400).json({ message: "check_size_min must be non-negative" });
      if (max != null && max < 0) return res.status(400).json({ message: "check_size_max must be non-negative" });
      if (min != null && max != null && max < min) return res.status(400).json({ message: "check_size_max must be >= check_size_min" });
      // Connector / Referrer defaults can_write_cheque to false
      const cwc = can_write_cheque !== undefined ? (can_write_cheque === true || can_write_cheque === "true") :
                  investor_type === "Connector / Referrer" ? false : true;
      const roundId = safeId(related_round_id);
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_investors
          (name, investor_type, status, priority, stage, check_size_min, check_size_max,
           currency, probability, source, introducer_name, website, country, region,
           strategic_relevance, thesis_fit, notes, last_touch_at, next_step, next_step_date,
           related_round_id, data_room_status, can_write_cheque, created_by, updated_by)
        VALUES (
          '${esc(name)}',
          '${esc(investor_type)}',
          '${esc(status || "Active")}',
          '${esc(priority || "Medium")}',
          '${esc(stage)}',
          ${min ?? "NULL"},
          ${max ?? "NULL"},
          '${esc(currency || "CAD")}',
          ${prob ?? "NULL"},
          ${source           ? `'${esc(source)}'`           : "NULL"},
          ${introducer_name  ? `'${esc(introducer_name)}'`  : "NULL"},
          ${website          ? `'${esc(website)}'`          : "NULL"},
          ${country          ? `'${esc(country)}'`          : "NULL"},
          ${region           ? `'${esc(region)}'`           : "NULL"},
          ${strategic_relevance ? `'${esc(strategic_relevance)}'` : "NULL"},
          ${thesis_fit       ? `'${esc(thesis_fit)}'`       : "NULL"},
          ${notes            ? `'${esc(notes)}'`            : "NULL"},
          ${last_touch_at    ? `'${last_touch_at}'`         : "NULL"},
          ${next_step        ? `'${esc(next_step)}'`        : "NULL"},
          ${next_step_date   ? `'${next_step_date}'`        : "NULL"},
          ${roundId          ?? "NULL"},
          '${esc(data_room_status || "Not Shared")}',
          ${cwc},
          ${req.session.userId},
          ${req.session.userId}
        ) RETURNING *
      `));
      const inv = row.rows[0] as any;
      await logCapitalActivity("investor", inv.id, "System", `Investor added: ${name}`, { createdBy: req.session.userId });
      res.status(201).json(inv);
    } catch (err: any) {
      console.error("[capital] POST /investors:", err?.message);
      res.status(500).json({ message: "Failed to create investor" });
    }
  });

  app.get("/api/capital/investors/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const [invRow, contactsRow, commitmentsRow, activitiesRow] = await Promise.all([
        db.execute(sql.raw(`SELECT * FROM capital_investors WHERE id = ${id} LIMIT 1`)),
        db.execute(sql.raw(`SELECT * FROM capital_contacts WHERE investor_id = ${id} ORDER BY created_at DESC`)),
        db.execute(sql.raw(`
          SELECT cc.*, cr.name AS round_name
          FROM capital_commitments cc
          LEFT JOIN capital_rounds cr ON cc.round_id = cr.id
          WHERE cc.investor_id = ${id} ORDER BY cc.created_at DESC
        `)),
        db.execute(sql.raw(`
          SELECT * FROM capital_activities
          WHERE entity_type = 'investor' AND entity_id = ${id}
          ORDER BY activity_at DESC, created_at DESC LIMIT 50
        `)),
      ]);
      const inv = invRow.rows[0] as any;
      if (!inv) return res.status(404).json({ message: "Investor not found" });
      res.json({ ...inv, contacts: contactsRow.rows, commitments: commitmentsRow.rows, activities: activitiesRow.rows });
    } catch (err: any) {
      console.error("[capital] GET /investors/:id:", err?.message);
      res.status(500).json({ message: "Failed to load investor" });
    }
  });

  app.patch("/api/capital/investors/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const prev = (await db.execute(sql.raw(`SELECT stage, next_step, priority FROM capital_investors WHERE id = ${id} LIMIT 1`))).rows[0] as any;
      if (!prev) return res.status(404).json({ message: "Investor not found" });
      const allowed = [
        "name","investor_type","status","priority","stage","check_size_min","check_size_max",
        "currency","probability","source","introducer_name","website","country","region",
        "strategic_relevance","thesis_fit","notes","last_touch_at","next_step","next_step_date",
        "related_round_id","data_room_status","can_write_cheque",
        "warmth","do_not_contact","disqualification_reason","relationship_strength",
        "target_cheque_amount","likely_lead",
      ];
      const numericFields = new Set(["check_size_min","check_size_max","probability","related_round_id","target_cheque_amount"]);
      const boolFields    = new Set(["can_write_cheque","do_not_contact","likely_lead"]);
      const sets: string[] = [`updated_at = NOW()`, `updated_by = ${(req as any).session?.userId ?? "NULL"}`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") {
          sets.push(`${key} = NULL`);
        } else if (boolFields.has(key)) {
          sets.push(`${key} = ${v === true || v === "true" ? "TRUE" : "FALSE"}`);
        } else if (numericFields.has(key)) {
          const n = Number(v); if (!isNaN(n)) sets.push(`${key} = ${n}`);
        } else {
          sets.push(`${key} = '${esc(String(v))}'`);
        }
      }
      if (sets.length === 2) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_investors SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
      const inv = rows.rows[0] as any;
      if (!inv) return res.status(404).json({ message: "Investor not found" });
      const uid = (req as any).session?.userId ?? null;
      if ("stage" in req.body && req.body.stage && req.body.stage !== prev.stage) {
        await logCapitalActivity("investor", id, "Stage Change", "Stage changed", { oldValue: prev.stage, newValue: req.body.stage, createdBy: uid });
      }
      if ("next_step" in req.body && req.body.next_step !== prev.next_step) {
        await logCapitalActivity("investor", id, "Note", "Next step updated", { newValue: req.body.next_step ?? null, createdBy: uid });
      }
      if ("priority" in req.body && req.body.priority && req.body.priority !== prev.priority) {
        await logCapitalActivity("investor", id, "Note", "Priority changed", { oldValue: prev.priority, newValue: req.body.priority, createdBy: uid });
      }
      res.json(inv);
    } catch (err: any) {
      console.error("[capital] PATCH /investors/:id:", err?.message);
      res.status(500).json({ message: "Failed to update investor" });
    }
  });

  app.delete("/api/capital/investors/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(`UPDATE capital_contacts    SET investor_id = NULL WHERE investor_id = ${id}`));
      await db.execute(sql.raw(`UPDATE capital_commitments SET investor_id = NULL WHERE investor_id = ${id}`));
      await db.execute(sql.raw(`DELETE FROM capital_investors WHERE id = ${id}`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /investors/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete investor" });
    }
  });

  app.get("/api/capital/investors/:id/activities", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const rows = await db.execute(sql.raw(`
        SELECT * FROM capital_activities
        WHERE entity_type = 'investor' AND entity_id = ${id}
        ORDER BY activity_at DESC, created_at DESC LIMIT 100
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /investors/:id/activities:", err?.message);
      res.status(500).json({ message: "Failed to load activities" });
    }
  });

  app.post("/api/capital/investors/:id/activities", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const { activity_type, title, body } = req.body;
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_activities (entity_type, entity_id, activity_type, title, body, created_by, activity_at)
        VALUES (
          'investor', ${id},
          '${esc(activity_type || "Note")}',
          ${title ? `'${esc(title)}'` : "NULL"},
          ${body  ? `'${esc(body)}'`  : "NULL"},
          ${req.session.userId},
          NOW()
        ) RETURNING *
      `));
      // Auto-update last_touch_at for substantive interaction types
      const TOUCH_TYPES = new Set(["Email", "Call", "Meeting", "In-Person", "Video Call"]);
      if (TOUCH_TYPES.has(activity_type)) {
        await db.execute(sql.raw(`UPDATE capital_investors SET last_touch_at = NOW() WHERE id = ${id}`));
      }
      res.status(201).json(row.rows[0]);
    } catch (err: any) {
      console.error("[capital] POST /investors/:id/activities:", err?.message);
      res.status(500).json({ message: "Failed to log activity" });
    }
  });

  // ── Contacts (Phase 2A) ───────────────────────────────────────────────────────
  app.get("/api/capital/contacts", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { investor_id, role_type, search } = req.query as any;
      let where = "WHERE 1=1";
      if (investor_id) { const iid = safeId(investor_id); if (iid) where += ` AND cc.investor_id = ${iid}`; }
      if (role_type)   where += ` AND cc.role_type = '${esc(role_type)}'`;
      if (search)      where += ` AND (cc.first_name ILIKE '%${esc(search)}%' OR COALESCE(cc.last_name,'') ILIKE '%${esc(search)}%' OR COALESCE(cc.full_name,'') ILIKE '%${esc(search)}%' OR COALESCE(cc.email,'') ILIKE '%${esc(search)}%' OR COALESCE(cc.title,'') ILIKE '%${esc(search)}%')`;
      const rows = await db.execute(sql.raw(`
        SELECT cc.*, ci.name AS investor_name
        FROM capital_contacts cc
        LEFT JOIN capital_investors ci ON cc.investor_id = ci.id
        ${where}
        ORDER BY cc.created_at DESC LIMIT 200
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /contacts:", err?.message);
      res.status(500).json({ message: "Failed to load contacts" });
    }
  });

  app.post("/api/capital/contacts", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const {
        investor_id, first_name, last_name, full_name, title, email, phone,
        linkedin_url, role_type, influence_level, relationship_strength, notes,
        last_touch_at, next_step, next_step_date,
      } = req.body;
      if (!first_name?.trim()) return res.status(400).json({ message: "first_name is required" });
      const iid = safeId(investor_id);
      const computedFull = full_name || [first_name, last_name].filter(Boolean).join(" ");
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_contacts
          (investor_id, first_name, last_name, full_name, title, email, phone,
           linkedin_url, role_type, influence_level, relationship_strength, notes,
           last_touch_at, next_step, next_step_date, created_by, updated_by)
        VALUES (
          ${iid ?? "NULL"},
          '${esc(first_name)}',
          ${last_name    ? `'${esc(last_name)}'`    : "NULL"},
          '${esc(computedFull)}',
          ${title        ? `'${esc(title)}'`        : "NULL"},
          ${email        ? `'${esc(email)}'`        : "NULL"},
          ${phone        ? `'${esc(phone)}'`        : "NULL"},
          ${linkedin_url ? `'${esc(linkedin_url)}'` : "NULL"},
          '${esc(role_type || "Other")}',
          '${esc(influence_level || "Medium")}',
          '${esc(relationship_strength || "Cold")}',
          ${notes        ? `'${esc(notes)}'`        : "NULL"},
          ${last_touch_at  ? `'${last_touch_at}'`  : "NULL"},
          ${next_step      ? `'${esc(next_step)}'` : "NULL"},
          ${next_step_date ? `'${next_step_date}'` : "NULL"},
          ${req.session.userId},
          ${req.session.userId}
        ) RETURNING *
      `));
      res.status(201).json(row.rows[0]);
    } catch (err: any) {
      console.error("[capital] POST /contacts:", err?.message);
      res.status(500).json({ message: "Failed to create contact" });
    }
  });

  app.get("/api/capital/contacts/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const rows = await db.execute(sql.raw(`
        SELECT cc.*, ci.name AS investor_name
        FROM capital_contacts cc
        LEFT JOIN capital_investors ci ON cc.investor_id = ci.id
        WHERE cc.id = ${id} LIMIT 1
      `));
      const c = rows.rows[0] as any;
      if (!c) return res.status(404).json({ message: "Contact not found" });
      res.json(c);
    } catch (err: any) {
      console.error("[capital] GET /contacts/:id:", err?.message);
      res.status(500).json({ message: "Failed to load contact" });
    }
  });

  app.patch("/api/capital/contacts/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const allowed = [
        "investor_id","first_name","last_name","full_name","title","email","phone",
        "linkedin_url","role_type","influence_level","relationship_strength","notes",
        "last_touch_at","next_step","next_step_date",
      ];
      const sets: string[] = [`updated_at = NOW()`, `updated_by = ${(req as any).session?.userId ?? "NULL"}`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") { sets.push(`${key} = NULL`); }
        else if (key === "investor_id") { const n = safeId(v); if (n) sets.push(`${key} = ${n}`); }
        else { sets.push(`${key} = '${esc(String(v))}'`); }
      }
      if (sets.length === 2) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_contacts SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
      const c = rows.rows[0] as any;
      if (!c) return res.status(404).json({ message: "Contact not found" });
      res.json(c);
    } catch (err: any) {
      console.error("[capital] PATCH /contacts/:id:", err?.message);
      res.status(500).json({ message: "Failed to update contact" });
    }
  });

  // ── Rounds (Phase 2A) ─────────────────────────────────────────────────────────
  app.get("/api/capital/rounds", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { status, round_type } = req.query as any;
      let where = "WHERE 1=1";
      if (status)     where += ` AND status = '${esc(status)}'`;
      if (round_type) where += ` AND round_type = '${esc(round_type)}'`;
      const rows = await db.execute(sql.raw(`SELECT * FROM capital_rounds ${where} ORDER BY created_at DESC LIMIT 100`));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /rounds:", err?.message);
      res.status(500).json({ message: "Failed to load rounds" });
    }
  });

  app.post("/api/capital/rounds", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const {
        name, round_type, target_amount, currency, pre_money_valuation, post_money_valuation,
        minimum_check_size, status, open_date, target_close_date, actual_close_date, notes,
      } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "name is required" });
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_rounds
          (name, round_type, target_amount, currency, pre_money_valuation, post_money_valuation,
           minimum_check_size, status, open_date, target_close_date, actual_close_date, notes,
           created_by, updated_by)
        VALUES (
          '${esc(name)}',
          '${esc(round_type || "Seed")}',
          ${formatCents(target_amount)        ?? "NULL"},
          '${esc(currency || "CAD")}',
          ${formatCents(pre_money_valuation)  ?? "NULL"},
          ${formatCents(post_money_valuation) ?? "NULL"},
          ${formatCents(minimum_check_size)   ?? "NULL"},
          '${esc(status || "Planning")}',
          ${open_date         ? `'${open_date}'`         : "NULL"},
          ${target_close_date ? `'${target_close_date}'` : "NULL"},
          ${actual_close_date ? `'${actual_close_date}'` : "NULL"},
          ${notes             ? `'${esc(notes)}'`        : "NULL"},
          ${req.session.userId},
          ${req.session.userId}
        ) RETURNING *
      `));
      res.status(201).json(row.rows[0]);
    } catch (err: any) {
      console.error("[capital] POST /rounds:", err?.message);
      res.status(500).json({ message: "Failed to create round" });
    }
  });

  app.get("/api/capital/rounds/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const [roundRow, commitmentsRow] = await Promise.all([
        db.execute(sql.raw(`SELECT * FROM capital_rounds WHERE id = ${id} LIMIT 1`)),
        db.execute(sql.raw(`
          SELECT cc.*, ci.name AS investor_name
          FROM capital_commitments cc
          LEFT JOIN capital_investors ci ON cc.investor_id = ci.id
          WHERE cc.round_id = ${id} ORDER BY cc.created_at DESC
        `)),
      ]);
      const r = roundRow.rows[0] as any;
      if (!r) return res.status(404).json({ message: "Round not found" });
      res.json({ ...r, commitments: commitmentsRow.rows });
    } catch (err: any) {
      console.error("[capital] GET /rounds/:id:", err?.message);
      res.status(500).json({ message: "Failed to load round" });
    }
  });

  app.patch("/api/capital/rounds/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const allowed = [
        "name","round_type","target_amount","currency","pre_money_valuation","post_money_valuation",
        "minimum_check_size","status","open_date","target_close_date","actual_close_date","notes",
      ];
      const numericFields = new Set(["target_amount","pre_money_valuation","post_money_valuation","minimum_check_size"]);
      const sets: string[] = [`updated_at = NOW()`, `updated_by = ${(req as any).session?.userId ?? "NULL"}`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") { sets.push(`${key} = NULL`); }
        else if (numericFields.has(key)) { const n = Number(v); if (!isNaN(n)) sets.push(`${key} = ${n}`); }
        else { sets.push(`${key} = '${esc(String(v))}'`); }
      }
      if (sets.length === 2) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_rounds SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
      const r = rows.rows[0] as any;
      if (!r) return res.status(404).json({ message: "Round not found" });
      res.json(r);
    } catch (err: any) {
      console.error("[capital] PATCH /rounds/:id:", err?.message);
      res.status(500).json({ message: "Failed to update round" });
    }
  });

  // ── Commitments (Phase 2A) ────────────────────────────────────────────────────
  app.get("/api/capital/commitments", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { investor_id, round_id, commitment_stage } = req.query as any;
      let where = "WHERE 1=1";
      if (investor_id) { const id = safeId(investor_id); if (id) where += ` AND cc.investor_id = ${id}`; }
      if (round_id)    { const id = safeId(round_id);    if (id) where += ` AND cc.round_id = ${id}`; }
      if (commitment_stage) where += ` AND cc.commitment_stage = '${esc(commitment_stage)}'`;
      const rows = await db.execute(sql.raw(`
        SELECT cc.*, ci.name AS investor_name, cr.name AS round_name
        FROM capital_commitments cc
        LEFT JOIN capital_investors ci ON cc.investor_id = ci.id
        LEFT JOIN capital_rounds   cr ON cc.round_id    = cr.id
        ${where}
        ORDER BY cc.created_at DESC LIMIT 200
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /commitments:", err?.message);
      res.status(500).json({ message: "Failed to load commitments" });
    }
  });

  app.post("/api/capital/commitments", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const {
        investor_id, round_id, contact_id, amount, currency, commitment_stage,
        probability, expected_close_date, actual_close_date, terms_summary, notes,
      } = req.body;
      if (!investor_id) return res.status(400).json({ message: "investor_id is required" });
      const iid = safeId(investor_id);
      if (!iid) return res.status(400).json({ message: "investor_id is required" });
      const amt  = formatCents(amount);
      if (amt != null && amt < 0) return res.status(400).json({ message: "amount must be non-negative" });
      const prob = formatInt(probability);
      if (prob != null && (prob < 0 || prob > 100)) return res.status(400).json({ message: "probability must be 0–100" });
      const rid = safeId(round_id);
      const cid = safeId(contact_id);
      const stage = commitment_stage || "Verbal Interest";
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_commitments
          (investor_id, round_id, contact_id, amount, currency, commitment_stage,
           probability, expected_close_date, actual_close_date, terms_summary, notes,
           created_by, updated_by)
        VALUES (
          ${iid},
          ${rid  ?? "NULL"},
          ${cid  ?? "NULL"},
          ${amt  ?? "NULL"},
          '${esc(currency || "CAD")}',
          '${esc(stage)}',
          ${prob ?? "NULL"},
          ${expected_close_date ? `'${expected_close_date}'` : "NULL"},
          ${actual_close_date   ? `'${actual_close_date}'`   : "NULL"},
          ${terms_summary       ? `'${esc(terms_summary)}'`  : "NULL"},
          ${notes               ? `'${esc(notes)}'`          : "NULL"},
          ${req.session.userId},
          ${req.session.userId}
        ) RETURNING *
      `));
      const comm = row.rows[0] as any;
      await logCapitalActivity("investor", iid, "Commitment Change", `Commitment added: ${stage}`, { newValue: stage, createdBy: req.session.userId });
      res.status(201).json(comm);
    } catch (err: any) {
      console.error("[capital] POST /commitments:", err?.message);
      res.status(500).json({ message: "Failed to create commitment" });
    }
  });

  app.get("/api/capital/commitments/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const rows = await db.execute(sql.raw(`
        SELECT cc.*, ci.name AS investor_name, cr.name AS round_name
        FROM capital_commitments cc
        LEFT JOIN capital_investors ci ON cc.investor_id = ci.id
        LEFT JOIN capital_rounds   cr ON cc.round_id    = cr.id
        WHERE cc.id = ${id} LIMIT 1
      `));
      const c = rows.rows[0] as any;
      if (!c) return res.status(404).json({ message: "Commitment not found" });
      res.json(c);
    } catch (err: any) {
      console.error("[capital] GET /commitments/:id:", err?.message);
      res.status(500).json({ message: "Failed to load commitment" });
    }
  });

  app.patch("/api/capital/commitments/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const prev = (await db.execute(sql.raw(`SELECT commitment_stage, investor_id FROM capital_commitments WHERE id = ${id} LIMIT 1`))).rows[0] as any;
      if (!prev) return res.status(404).json({ message: "Commitment not found" });
      const allowed = [
        "investor_id","round_id","contact_id","amount","currency","commitment_stage",
        "probability","expected_close_date","actual_close_date","terms_summary","notes",
      ];
      const numericFields = new Set(["amount","probability","investor_id","round_id","contact_id"]);
      const sets: string[] = [`updated_at = NOW()`, `updated_by = ${(req as any).session?.userId ?? "NULL"}`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") { sets.push(`${key} = NULL`); }
        else if (numericFields.has(key)) { const n = Number(v); if (!isNaN(n)) sets.push(`${key} = ${n}`); }
        else { sets.push(`${key} = '${esc(String(v))}'`); }
      }
      if (sets.length === 2) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_commitments SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
      const c = rows.rows[0] as any;
      if (!c) return res.status(404).json({ message: "Commitment not found" });
      const uid = (req as any).session?.userId ?? null;
      if ("commitment_stage" in req.body && req.body.commitment_stage && req.body.commitment_stage !== prev.commitment_stage) {
        const iid = Number(prev.investor_id);
        if (iid) await logCapitalActivity("investor", iid, "Commitment Change", "Commitment stage changed", { oldValue: prev.commitment_stage, newValue: req.body.commitment_stage, createdBy: uid });
      }
      res.json(c);
    } catch (err: any) {
      console.error("[capital] PATCH /commitments/:id:", err?.message);
      res.status(500).json({ message: "Failed to update commitment" });
    }
  });

  // ── Phase 2C: Investor intelligence score ────────────────────────────────────
  app.get("/api/capital/investors/:id/score", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const rows = await db.execute(sql.raw(`SELECT * FROM capital_investors WHERE id = ${id} LIMIT 1`));
      const inv = rows.rows[0] as any;
      if (!inv) return res.status(404).json({ message: "Investor not found" });
      res.json({ id, ...computeInvestorScore(inv) });
    } catch (err: any) {
      console.error("[capital] GET /investors/:id/score:", err?.message);
      res.status(500).json({ message: "Failed to compute score" });
    }
  });

  // ── Phase 2C: Follow-up queue ─────────────────────────────────────────────────
  app.get("/api/capital/follow-ups", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const rows = await db.execute(sql.raw(`
        SELECT ci.*,
          (SELECT COUNT(*) FROM capital_contacts cc WHERE cc.investor_id = ci.id) AS contact_count
        FROM capital_investors ci
        WHERE ci.stage NOT IN ('Passed', 'Wired / Closed')
          AND (ci.do_not_contact IS NULL OR ci.do_not_contact = FALSE)
        ORDER BY
          CASE ci.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
          ci.next_step_date ASC NULLS LAST,
          ci.last_touch_at ASC NULLS FIRST,
          ci.updated_at DESC
        LIMIT 100
      `));
      const result = (rows.rows as any[]).map(inv => ({
        ...inv,
        intelligence: computeInvestorScore(inv),
        days_since_touch: inv.last_touch_at
          ? Math.floor((Date.now() - new Date(inv.last_touch_at).getTime()) / 86400000)
          : null,
        next_step_overdue: inv.next_step_date ? new Date(inv.next_step_date) < new Date() : false,
      }));
      res.json(result);
    } catch (err: any) {
      console.error("[capital] GET /follow-ups:", err?.message);
      res.status(500).json({ message: "Failed to load follow-up queue" });
    }
  });

  // ── Phase 2C: Pipeline intelligence summary ───────────────────────────────────
  app.get("/api/capital/intelligence/pipeline", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const rows = await db.execute(sql.raw(`SELECT * FROM capital_investors WHERE stage NOT IN ('Passed')`));
      const all = rows.rows as any[];
      const scored = all.map(inv => ({ ...inv, _score: computeInvestorScore(inv) }));
      const hot      = scored.filter(i => i._score.tier === "Hot");
      const warm     = scored.filter(i => i._score.tier === "Warm");
      const overdue  = scored.filter(i => i.next_step_date && new Date(i.next_step_date) < new Date());
      const noTouch  = scored.filter(i => !i.last_touch_at);
      const atRisk   = scored.filter(i => {
        if (!i.last_touch_at) return false;
        const ageDays = (Date.now() - new Date(i.last_touch_at).getTime()) / 86400000;
        return ageDays > 30 && ["Diligence","Partner Meeting","Soft Commit","Follow-Up"].includes(i.stage);
      });
      const totalWeighted = all
        .filter(i => i.check_size_max && i.probability)
        .reduce((sum, i) => sum + Math.round(i.check_size_max * i.probability / 100), 0);
      const alerts = [
        ...overdue.map(i => ({ type: "overdue", investor_id: i.id, name: i.name, message: `Follow-up overdue: ${i.next_step || "scheduled action"}` })),
        ...noTouch.map(i => ({ type: "never_contacted", investor_id: i.id, name: i.name, message: "Never contacted" })),
        ...atRisk.map(i => ({ type: "at_risk", investor_id: i.id, name: i.name, message: "No recent touch in active stage" })),
      ].slice(0, 15);
      res.json({
        total_active: all.filter(i => i.stage !== "Wired / Closed").length,
        total_weighted,
        hot_count: hot.length,
        warm_count: warm.length,
        overdue_follow_ups: overdue.length,
        never_contacted: noTouch.length,
        at_risk_count: atRisk.length,
        top_investors: [...hot.slice(0, 5), ...warm.slice(0, 3)].map(i => ({
          id: i.id, name: i.name, stage: i.stage, priority: i.priority,
          score: i._score.score, tier: i._score.tier, reasons: i._score.reasons.slice(0, 3),
        })),
        alerts,
      });
    } catch (err: any) {
      console.error("[capital] GET /intelligence/pipeline:", err?.message);
      res.status(500).json({ message: "Failed to load pipeline intelligence" });
    }
  });

  // ── Phase 2C: Email context + draft templates ─────────────────────────────────
  app.get("/api/capital/investors/:id/email-context", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const [invRow, contactsRow, activitiesRow, commitmentsRow] = await Promise.all([
        db.execute(sql.raw(`SELECT * FROM capital_investors WHERE id = ${id} LIMIT 1`)),
        db.execute(sql.raw(`SELECT * FROM capital_contacts WHERE investor_id = ${id} ORDER BY influence_level DESC, created_at DESC LIMIT 5`)),
        db.execute(sql.raw(`SELECT * FROM capital_activities WHERE entity_type = 'investor' AND entity_id = ${id} ORDER BY activity_at DESC LIMIT 5`)),
        db.execute(sql.raw(`
          SELECT cc.*, cr.name AS round_name FROM capital_commitments cc
          LEFT JOIN capital_rounds cr ON cc.round_id = cr.id
          WHERE cc.investor_id = ${id} ORDER BY cc.created_at DESC LIMIT 3
        `)),
      ]);
      const inv = invRow.rows[0] as any;
      if (!inv) return res.status(404).json({ message: "Investor not found" });
      const contacts    = contactsRow.rows    as any[];
      const activities  = activitiesRow.rows  as any[];
      const commitments = commitmentsRow.rows as any[];
      const intel = computeInvestorScore(inv);
      const primary = contacts[0];
      const salutation = primary ? (primary.first_name || primary.full_name?.split(" ")[0] || "there") : "there";
      const toLine = primary ? `${primary.full_name || primary.first_name}${primary.email ? ` <${primary.email}>` : ""}` : "";
      const daysSinceTouch = inv.last_touch_at
        ? Math.floor((Date.now() - new Date(inv.last_touch_at).getTime()) / 86400000)
        : null;

      const templates: Array<{ label: string; subject: string; body: string }> = [];

      if (["Target Identified","Intro Needed","Intro Made"].includes(inv.stage)) {
        const raiseStr = inv.check_size_max ? ` ($${(inv.check_size_max / 1_000_000).toFixed(1)}M ask)` : "";
        templates.push({
          label: "Initial Outreach",
          subject: `VoltSafe — Marina EV Charging${raiseStr}`,
          body: `Hi ${salutation},\n\nI hope this finds you well. I'm reaching out because VoltSafe is building the infrastructure layer for marina-based EV charging — we believe it's a compelling fit for your focus on ${inv.thesis_fit || "clean energy infrastructure"}.\n\nWe're actively raising our current round and I'd love 20 minutes to share what we're seeing in the market. Would you be open to a brief call this week or next?\n\nBest,\nTrevor Burgess\nCEO, VoltSafe`,
        });
      }

      if (["First Meeting","Follow-Up","Intro Made","Intro Needed"].includes(inv.stage)) {
        const lastAct = activities[0];
        const lastDate = lastAct?.activity_at
          ? ` on ${new Date(lastAct.activity_at).toLocaleDateString("en-CA", { month: "long", day: "numeric" })}`
          : "";
        templates.push({
          label: "Follow-Up After Meeting",
          subject: "Following up — VoltSafe",
          body: `Hi ${salutation},\n\nThank you for our conversation${lastDate}. I wanted to follow up on ${inv.next_step || "our discussion"}.\n\n${inv.thesis_fit ? `Given your focus on ${inv.thesis_fit}, I believe VoltSafe is well-positioned to deliver strong returns as the marina EV market accelerates.` : "I'd love to continue the conversation and answer any questions you might have."}\n\nWould you be available for a follow-up call this week?\n\nBest,\nTrevor Burgess\nCEO, VoltSafe`,
        });
      }

      if (["Diligence","Partner Meeting","Soft Commit"].includes(inv.stage)) {
        templates.push({
          label: "Diligence / Data Room Update",
          subject: "VoltSafe — Data Room Update",
          body: `Hi ${salutation},\n\nI wanted to check in on how the review is progressing. I've updated the data room${inv.data_room_status !== "Not Shared" ? ` (current access: ${inv.data_room_status})` : ""} with the latest financials and customer contracts.\n\nPlease let me know if there are any outstanding questions — happy to jump on a call or answer by email.\n\n${commitments.length > 0 ? "We're making great progress on the round and are eager to finalize terms with you.\n\n" : ""}Best,\nTrevor Burgess\nCEO, VoltSafe`,
        });
      }

      if (["Soft Commit","Committed"].includes(inv.stage)) {
        templates.push({
          label: "Closing / Wire Instructions",
          subject: "VoltSafe — Closing Documents Ready",
          body: `Hi ${salutation},\n\nExciting news — we're ready to move to close. I'll have our counsel send the subscription agreement and wire instructions to you directly.\n\nPlease review at your earliest convenience. If you have any questions on the terms, I'm available to discuss.\n\nThank you for your partnership and belief in what we're building at VoltSafe.\n\nBest,\nTrevor Burgess\nCEO, VoltSafe`,
        });
      }

      if (daysSinceTouch != null && daysSinceTouch > 45 && !["Passed","Wired / Closed"].includes(inv.stage)) {
        templates.push({
          label: "Re-Engagement (Dormant)",
          subject: "Checking in — VoltSafe momentum update",
          body: `Hi ${salutation},\n\nI wanted to reconnect and share a few quick updates from VoltSafe since we last spoke.\n\nWe've made significant progress on our commercial pipeline and I thought you'd appreciate the momentum update. I'd love to reconnect if the timing is right — would you be open to a brief call?\n\nBest,\nTrevor Burgess\nCEO, VoltSafe`,
        });
      }

      if (templates.length === 0) {
        templates.push({
          label: "General Update",
          subject: "VoltSafe — Update",
          body: `Hi ${salutation},\n\nI wanted to reach out with a quick update on VoltSafe's progress.\n\nI look forward to keeping you informed as we continue to build.\n\nBest,\nTrevor Burgess\nCEO, VoltSafe`,
        });
      }

      res.json({
        investor: { id: inv.id, name: inv.name, stage: inv.stage, priority: inv.priority },
        intelligence: intel,
        primary_contact: primary ? { name: primary.full_name || primary.first_name, email: primary.email, title: primary.title } : null,
        to_line: toLine,
        days_since_touch: daysSinceTouch,
        recent_activities: activities.map(a => ({ type: a.activity_type, title: a.title, at: a.activity_at })),
        templates,
      });
    } catch (err: any) {
      console.error("[capital] GET /investors/:id/email-context:", err?.message);
      res.status(500).json({ message: "Failed to load email context" });
    }
  });
}
