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
  // "scott.carlson@voltsafe.com",  // ← uncomment when Scott's account is created
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

  // ── Pipeline ────────────────────────────────────────────────────────────────
  app.get("/api/capital/pipeline", requireAuth, requireCapitalAccess, async (_req, res) => {
    try {
      const rows = await db.execute(sql.raw(`
        SELECT pipeline_stage,
               COUNT(*) AS count,
               SUM(COALESCE(expected_amount_cents, 0)) AS total_expected,
               SUM(CASE WHEN expected_amount_cents IS NOT NULL AND probability_percent IS NOT NULL
                        THEN expected_amount_cents * probability_percent / 100
                        ELSE 0 END) AS total_weighted
        FROM capital_funders
        GROUP BY pipeline_stage
        ORDER BY pipeline_stage
      `));
      const byStage = rows.rows as any[];
      const funders = await db.execute(sql.raw(`SELECT * FROM capital_funders ORDER BY priority DESC, updated_at DESC LIMIT 200`));
      res.json({
        stagesSummary: byStage,
        funders: (funders.rows as any[]).map(f => ({
          ...f,
          weighted_amount_cents: weighted(Number(f.expected_amount_cents)||null, Number(f.probability_percent)||null),
        })),
      });
    } catch (err: any) {
      console.error("[capital] GET /pipeline:", err?.message);
      res.status(500).json({ message: "Failed to load pipeline" });
    }
  });
}
