import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { recordHighRiskAction, getAuditActor } from "./services/security-audit";

// ── Capital access allowlist ──────────────────────────────────────────────────
// IMPORTANT: this gate is identity-based, not role-based.
// Even admin/master_admin accounts are denied unless listed here.
// Only the users below may access the Capital module.
//
// Trevor Burgess (CEO) — user ID 4 (confirmed by SYSTEM_SENDER_ID references)
// Scott Carlson  (CFO) — no account yet; add email below when created.
export const CAPITAL_ALLOWED_USER_IDS = new Set<number>([4]);
export const CAPITAL_ALLOWED_EMAILS   = new Set<string>([
  "scott@voltsafe.com",           // CFO — Scott Carlson (real account email)
  "scott.carlson@voltsafe.com",   // legacy alias kept for backwards-compat
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

  // ── Phase 2D: Capital Email Links + Review Queue ───────────────────────────
  try {
    await db.execute(sql.raw(`
      ALTER TABLE capital_activities ADD COLUMN IF NOT EXISTS email_thread_id  TEXT;
      ALTER TABLE capital_activities ADD COLUMN IF NOT EXISTS email_message_id TEXT;
    `));
  } catch (_e4a) { /* already exists — idempotent */ }
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS capital_email_links (
        id                  SERIAL PRIMARY KEY,
        capital_investor_id INTEGER REFERENCES capital_investors(id) ON DELETE CASCADE,
        capital_contact_id  INTEGER REFERENCES capital_contacts(id)  ON DELETE SET NULL,
        email_thread_id     TEXT,
        email_message_id    TEXT,
        email_db_id         INTEGER,
        subject             TEXT,
        direction           TEXT NOT NULL DEFAULT 'unknown',
        participants        TEXT,
        latest_message_at   TIMESTAMPTZ,
        first_linked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        link_type           TEXT NOT NULL DEFAULT 'manual',
        match_confidence    INTEGER NOT NULL DEFAULT 100,
        match_reason        TEXT,
        created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_capital_email_links_thread_investor
        ON capital_email_links(email_thread_id, capital_investor_id)
        WHERE deleted_at IS NULL AND email_thread_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_capital_email_links_investor
        ON capital_email_links(capital_investor_id);
      CREATE INDEX IF NOT EXISTS idx_capital_email_links_contact
        ON capital_email_links(capital_contact_id);

      CREATE TABLE IF NOT EXISTS capital_email_review (
        id                  SERIAL PRIMARY KEY,
        email_thread_id     TEXT,
        email_message_id    TEXT,
        email_db_id         INTEGER,
        subject             TEXT,
        sender_email        TEXT,
        participants        TEXT,
        snippet             TEXT,
        latest_message_at   TIMESTAMPTZ,
        guessed_investor_id INTEGER REFERENCES capital_investors(id) ON DELETE SET NULL,
        guessed_contact_id  INTEGER REFERENCES capital_contacts(id)  ON DELETE SET NULL,
        match_reason        TEXT,
        match_confidence    INTEGER,
        status              TEXT NOT NULL DEFAULT 'pending',
        reviewed_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at         TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_capital_email_review_status
        ON capital_email_review(status);
      CREATE INDEX IF NOT EXISTS idx_capital_email_review_thread
        ON capital_email_review(email_thread_id);
    `));
  } catch (_e4b) { /* already exists — idempotent */ }

  // ── Phase 2E: Command Center columns ─────────────────────────────────────
  try {
    await db.execute(sql.raw(`
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS minimum_close_target  BIGINT;
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS current_cash_balance  BIGINT;
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS monthly_burn          BIGINT;
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS post_close_monthly_burn BIGINT;
    `));
    console.log("[migration] Capital Phase 2E: command center columns ready.");
  } catch (_e2e) { /* idempotent */ }

  // ── Phase 2F: Valuation, Dilution, Allocation & Close Plan columns ────────
  try {
    await db.execute(sql.raw(`
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS share_price              BIGINT;
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS option_pool_percent_pre  NUMERIC(5,2);
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS option_pool_percent_post NUMERIC(5,2);
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS round_instrument         TEXT;
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS discount_rate            NUMERIC(5,2);
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS valuation_cap            BIGINT;
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS interest_rate            NUMERIC(5,2);
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS maturity_date            DATE;
      ALTER TABLE capital_rounds ADD COLUMN IF NOT EXISTS legal_close_status       TEXT;
    `));
    await db.execute(sql.raw(`
      ALTER TABLE capital_commitments ADD COLUMN IF NOT EXISTS allocation_amount       BIGINT;
      ALTER TABLE capital_commitments ADD COLUMN IF NOT EXISTS requested_amount        BIGINT;
      ALTER TABLE capital_commitments ADD COLUMN IF NOT EXISTS final_allocation_amount BIGINT;
      ALTER TABLE capital_commitments ADD COLUMN IF NOT EXISTS allocation_status       TEXT NOT NULL DEFAULT 'unallocated';
      ALTER TABLE capital_commitments ADD COLUMN IF NOT EXISTS closing_status          TEXT NOT NULL DEFAULT 'not_started';
      ALTER TABLE capital_commitments ADD COLUMN IF NOT EXISTS docs_sent_at            TIMESTAMPTZ;
      ALTER TABLE capital_commitments ADD COLUMN IF NOT EXISTS docs_signed_at          TIMESTAMPTZ;
      ALTER TABLE capital_commitments ADD COLUMN IF NOT EXISTS funds_received_at       TIMESTAMPTZ;
      ALTER TABLE capital_commitments ADD COLUMN IF NOT EXISTS allocation_notes        TEXT;
    `));
    console.log("[migration] Capital Phase 2F: valuation/allocation columns ready.");
  } catch (_e2f) { /* idempotent */ }

  // ── Phase 2G: Data Room — capital_materials, capital_material_shares, capital_material_requests ──
  // TODO: When secure file storage is implemented, integrate upload/download here
  //       behind requireCapitalAccess enforcement. For now this is metadata-first.
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS capital_materials (
        id                SERIAL PRIMARY KEY,
        title             TEXT NOT NULL,
        description       TEXT,
        material_type     TEXT NOT NULL DEFAULT 'other',
        round_id          INTEGER REFERENCES capital_rounds(id) ON DELETE SET NULL,
        version_label     TEXT,
        status            TEXT NOT NULL DEFAULT 'draft',
        file_url          TEXT,
        file_storage_key  TEXT,
        external_url      TEXT,
        mime_type         TEXT,
        file_size_bytes   BIGINT,
        checksum          TEXT,
        tags              TEXT,
        is_confidential   BOOLEAN NOT NULL DEFAULT TRUE,
        requires_nda      BOOLEAN NOT NULL DEFAULT FALSE,
        owner_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS capital_material_shares (
        id                SERIAL PRIMARY KEY,
        material_id       INTEGER NOT NULL REFERENCES capital_materials(id) ON DELETE CASCADE,
        investor_id       INTEGER REFERENCES capital_investors(id) ON DELETE SET NULL,
        contact_id        INTEGER REFERENCES capital_contacts(id) ON DELETE SET NULL,
        round_id          INTEGER REFERENCES capital_rounds(id) ON DELETE SET NULL,
        share_method      TEXT NOT NULL DEFAULT 'manual',
        email_thread_id   TEXT,
        email_message_id  TEXT,
        shared_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        shared_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status            TEXT NOT NULL DEFAULT 'shared',
        viewed_at         TIMESTAMPTZ,
        downloaded_at     TIMESTAMPTZ,
        last_activity_at  TIMESTAMPTZ,
        notes             TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS capital_material_requests (
        id                       SERIAL PRIMARY KEY,
        investor_id              INTEGER REFERENCES capital_investors(id) ON DELETE SET NULL,
        contact_id               INTEGER REFERENCES capital_contacts(id) ON DELETE SET NULL,
        round_id                 INTEGER REFERENCES capital_rounds(id) ON DELETE SET NULL,
        requested_material_type  TEXT,
        requested_title          TEXT,
        request_status           TEXT NOT NULL DEFAULT 'requested',
        priority                 TEXT NOT NULL DEFAULT 'medium',
        due_at                   TIMESTAMPTZ,
        requested_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
        requested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fulfilled_material_id    INTEGER REFERENCES capital_materials(id) ON DELETE SET NULL,
        fulfilled_at             TIMESTAMPTZ,
        notes                    TEXT,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at               TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_cap_materials_type      ON capital_materials(material_type);
      CREATE INDEX IF NOT EXISTS idx_cap_materials_status    ON capital_materials(status);
      CREATE INDEX IF NOT EXISTS idx_cap_materials_round     ON capital_materials(round_id);
      CREATE INDEX IF NOT EXISTS idx_cap_materials_deleted   ON capital_materials(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_cap_mat_shares_material ON capital_material_shares(material_id);
      CREATE INDEX IF NOT EXISTS idx_cap_mat_shares_investor ON capital_material_shares(investor_id);
      CREATE INDEX IF NOT EXISTS idx_cap_mat_req_investor    ON capital_material_requests(investor_id);
      CREATE INDEX IF NOT EXISTS idx_cap_mat_req_status      ON capital_material_requests(request_status);
    `));
    console.log("[migration] Capital Phase 2G: data room tables ready.");
  } catch (_e2g) { /* idempotent */ }

  // ── Phase 2H: Investor Portal ──────────────────────────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS capital_portal_access (
        id                SERIAL PRIMARY KEY,
        investor_id       INTEGER NOT NULL REFERENCES capital_investors(id) ON DELETE CASCADE,
        contact_id        INTEGER REFERENCES capital_contacts(id) ON DELETE SET NULL,
        round_id          INTEGER REFERENCES capital_rounds(id) ON DELETE SET NULL,
        access_token_hash TEXT NOT NULL UNIQUE,
        access_label      TEXT NOT NULL DEFAULT '',
        status            TEXT NOT NULL DEFAULT 'active',
        expires_at        TIMESTAMPTZ,
        created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at        TIMESTAMPTZ,
        revoked_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        last_accessed_at  TIMESTAMPTZ,
        access_count      INTEGER NOT NULL DEFAULT 0,
        notes             TEXT,
        deleted_at        TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS capital_portal_materials (
        id               SERIAL PRIMARY KEY,
        portal_access_id INTEGER NOT NULL REFERENCES capital_portal_access(id) ON DELETE CASCADE,
        material_id      INTEGER NOT NULL REFERENCES capital_materials(id) ON DELETE CASCADE,
        permission       TEXT NOT NULL DEFAULT 'view',
        added_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
        added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS capital_portal_events (
        id               SERIAL PRIMARY KEY,
        portal_access_id INTEGER NOT NULL REFERENCES capital_portal_access(id) ON DELETE CASCADE,
        investor_id      INTEGER NOT NULL,
        material_id      INTEGER REFERENCES capital_materials(id) ON DELETE SET NULL,
        event_type       TEXT NOT NULL,
        user_agent       TEXT,
        ip_hash          TEXT,
        occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata_json    TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_cap_portal_access_investor  ON capital_portal_access(investor_id);
      CREATE INDEX IF NOT EXISTS idx_cap_portal_access_hash      ON capital_portal_access(access_token_hash);
      CREATE INDEX IF NOT EXISTS idx_cap_portal_access_status    ON capital_portal_access(status);
      CREATE INDEX IF NOT EXISTS idx_cap_portal_materials_access ON capital_portal_materials(portal_access_id);
      CREATE INDEX IF NOT EXISTS idx_cap_portal_materials_mat    ON capital_portal_materials(material_id);
      CREATE INDEX IF NOT EXISTS idx_cap_portal_events_access    ON capital_portal_events(portal_access_id);
      CREATE INDEX IF NOT EXISTS idx_cap_portal_events_type      ON capital_portal_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_cap_portal_events_occurred  ON capital_portal_events(occurred_at);
    `));
    console.log("[migration] Capital Phase 2H: investor portal tables ready.");
  } catch (_e2h) { /* idempotent */ }

  // Phase 2I: Investor Updates
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS capital_investor_updates (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        update_type TEXT NOT NULL DEFAULT 'Monthly Update',
        subject     TEXT,
        body        TEXT,
        status      TEXT NOT NULL DEFAULT 'draft',
        tags        TEXT[],
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        scheduled_at TIMESTAMPTZ,
        sent_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cap_updates_type   ON capital_investor_updates(update_type);
      CREATE INDEX IF NOT EXISTS idx_cap_updates_status ON capital_investor_updates(status);
      CREATE INDEX IF NOT EXISTS idx_cap_updates_created ON capital_investor_updates(created_at DESC);
    `));
    console.log("[migration] Capital Phase 2I: investor updates table ready.");
  } catch (_e2i) { /* idempotent */ }

  // Phase 2J: Add deleted_at to core tables (additive — safe if already exists)
  try {
    await db.execute(sql.raw(`
      ALTER TABLE capital_investors ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE capital_rounds    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    `));
    console.log("[migration] Capital Phase 2J: deleted_at columns ready on capital_investors + capital_rounds.");
  } catch (_e2j) { /* idempotent */ }

  // Phase 2K: CFO onboarding sample-data support (is_sample flags + seed log + prompts)
  try {
    await db.execute(sql.raw(`
      ALTER TABLE capital_investors    ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE capital_contacts     ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE capital_rounds       ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE capital_commitments  ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE capital_materials    ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE capital_activities   ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE capital_materials    ADD COLUMN IF NOT EXISTS folder_name TEXT;

      CREATE TABLE IF NOT EXISTS capital_seed_log (
        id         SERIAL PRIMARY KEY,
        seed_key   TEXT NOT NULL UNIQUE,
        run_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes      TEXT
      );
    `));
    console.log("[migration] Capital Phase 2K: CFO onboarding sample-data columns + seed log ready.");
  } catch (_e2k) { /* idempotent */ }
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
        total_weighted: totalWeighted,
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

      // ── Phase 2D: include linked email conversation context ─────────────────
      const emailLinksRow = await db.execute(sql.raw(`
        SELECT cel.subject, cel.direction, cel.participants, cel.latest_message_at,
               cel.link_type, cel.email_thread_id,
               cc.full_name AS contact_name, cc.email AS contact_email
        FROM capital_email_links cel
        LEFT JOIN capital_contacts cc ON cc.id = cel.capital_contact_id
        WHERE cel.capital_investor_id = ${id}
          AND cel.deleted_at IS NULL
        ORDER BY cel.latest_message_at DESC NULLS LAST
        LIMIT 10
      `));
      const linkedEmails = emailLinksRow.rows as any[];

      // ── Phase 2G: relevant data room materials for email context ────────────
      const [materialsCtxRow, sharesCtxRow] = await Promise.all([
        db.execute(sql.raw(`SELECT id, title, material_type, version_label, status FROM capital_materials WHERE status = 'active' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 30`)),
        db.execute(sql.raw(`SELECT * FROM capital_material_shares WHERE investor_id = ${id} AND deleted_at IS NULL ORDER BY shared_at DESC LIMIT 30`)),
      ]);
      const { getRelevantMaterialsForEmailContext } = await import("./services/capital-data-room.js");
      const relevantMaterials = getRelevantMaterialsForEmailContext(
        id, inv.stage ?? "",
        materialsCtxRow.rows as any[],
        sharesCtxRow.rows as any[]
      );

      res.json({
        investor: { id: inv.id, name: inv.name, stage: inv.stage, priority: inv.priority },
        intelligence: intel,
        primary_contact: primary ? { name: primary.full_name || primary.first_name, email: primary.email, title: primary.title } : null,
        to_line: toLine,
        days_since_touch: daysSinceTouch,
        recent_activities: activities.map(a => ({ type: a.activity_type, title: a.title, at: a.activity_at })),
        linked_email_conversations: linkedEmails.map(e => ({
          subject: e.subject,
          direction: e.direction,
          participants: e.participants,
          latest_message_at: e.latest_message_at,
          link_type: e.link_type,
          thread_id: e.email_thread_id,
          contact_name: e.contact_name,
          contact_email: e.contact_email,
        })),
        relevant_materials: relevantMaterials,
        templates,
      });
    } catch (err: any) {
      console.error("[capital] GET /investors/:id/email-context:", err?.message);
      res.status(500).json({ message: "Failed to load email context" });
    }
  });

  // ── Phase 2D: Email Conversations for an investor ─────────────────────────
  app.get("/api/capital/investors/:id/email-conversations", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const rows = await db.execute(sql.raw(`
        SELECT cel.*,
               cc.full_name  AS contact_name,
               cc.email      AS contact_email,
               cc.title      AS contact_title,
               ci.name       AS investor_name
        FROM capital_email_links cel
        LEFT JOIN capital_contacts  cc ON cc.id = cel.capital_contact_id
        LEFT JOIN capital_investors ci ON ci.id = cel.capital_investor_id
        WHERE cel.capital_investor_id = ${id}
          AND cel.deleted_at IS NULL
        ORDER BY cel.latest_message_at DESC NULLS LAST
        LIMIT 50
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /investors/:id/email-conversations:", err?.message);
      res.status(500).json({ message: "Failed to load email conversations" });
    }
  });

  // ── Phase 2D: Manual email link create ────────────────────────────────────
  app.post("/api/capital/email-links", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const {
        capital_investor_id, capital_contact_id,
        email_thread_id, email_message_id, email_db_id,
        subject, direction, participants, latest_message_at,
      } = req.body;
      const investorId = safeId(capital_investor_id);
      if (!investorId) return res.status(400).json({ message: "capital_investor_id required" });

      const { manualCapitalEmailLink } = await import("./services/capital-email-linker");
      const { linkId } = await manualCapitalEmailLink({
        investorId,
        contactId:        safeId(capital_contact_id),
        threadId:         email_thread_id  || null,
        messageId:        email_message_id || null,
        emailDbId:        safeId(email_db_id),
        subject:          subject          || "",
        direction:        direction        || "unknown",
        participants:     participants     || "",
        latestMessageAt:  latest_message_at || null,
        createdBy:        req.session.userId,
      });
      if (!linkId) {
        return res.status(409).json({ message: "Link already exists or could not be created" });
      }
      const row = await db.execute(sql.raw(`SELECT * FROM capital_email_links WHERE id = ${linkId} LIMIT 1`));
      res.status(201).json(row.rows[0]);
    } catch (err: any) {
      console.error("[capital] POST /email-links:", err?.message);
      res.status(500).json({ message: "Failed to create email link" });
    }
  });

  // ── Phase 2D: Patch email link ─────────────────────────────────────────────
  app.patch("/api/capital/email-links/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const allowed = ["capital_contact_id","subject","direction","participants","latest_message_at"];
      const sets: string[] = [`updated_at = NOW()`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") sets.push(`${key} = NULL`);
        else if (["capital_contact_id"].includes(key)) sets.push(`${key} = ${safeId(v) ?? "NULL"}`);
        else sets.push(`${key} = '${esc(String(v))}'`);
      }
      if (sets.length === 1) return res.status(400).json({ message: "No valid fields to update" });
      const row = await db.execute(sql.raw(`UPDATE capital_email_links SET ${sets.join(", ")} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`));
      if (!row.rows[0]) return res.status(404).json({ message: "Link not found" });
      res.json(row.rows[0]);
    } catch (err: any) {
      console.error("[capital] PATCH /email-links/:id:", err?.message);
      res.status(500).json({ message: "Failed to update email link" });
    }
  });

  // ── Phase 2D: Soft-delete email link ──────────────────────────────────────
  app.delete("/api/capital/email-links/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(`UPDATE capital_email_links SET deleted_at = NOW() WHERE id = ${id}`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /email-links/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete email link" });
    }
  });

  // ── Phase 2D: Auto-link a single message (called from sync hook / UI) ──────
  app.post("/api/capital/email-links/auto-link-message", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { email_db_id } = req.body;
      const dbId = safeId(email_db_id);
      if (!dbId) return res.status(400).json({ message: "email_db_id required" });
      const { tryCapitalEmailLink } = await import("./services/capital-email-linker");
      const result = await tryCapitalEmailLink(dbId);
      res.json(result);
    } catch (err: any) {
      console.error("[capital] POST /email-links/auto-link-message:", err?.message);
      res.status(500).json({ message: "Failed to auto-link message" });
    }
  });

  // ── Phase 2D: Email Review Queue ──────────────────────────────────────────
  app.get("/api/capital/email-review", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const status = (req.query.status as string) || "pending";
      const rows = await db.execute(sql.raw(`
        SELECT cer.*,
               ci.name AS investor_name,
               cc.full_name AS contact_name
        FROM capital_email_review cer
        LEFT JOIN capital_investors ci ON ci.id = cer.guessed_investor_id
        LEFT JOIN capital_contacts  cc ON cc.id = cer.guessed_contact_id
        WHERE cer.status = '${esc(status)}'
        ORDER BY cer.created_at DESC
        LIMIT 100
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /email-review:", err?.message);
      res.status(500).json({ message: "Failed to load review queue" });
    }
  });

  app.post("/api/capital/email-review/:id/approve", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const reviewRows = await db.execute(sql.raw(`SELECT * FROM capital_email_review WHERE id = ${id} LIMIT 1`));
      const review = reviewRows.rows[0] as any;
      if (!review) return res.status(404).json({ message: "Review item not found" });

      const investorId = safeId(req.body.capital_investor_id) ?? review.guessed_investor_id;
      const contactId  = safeId(req.body.capital_contact_id)  ?? review.guessed_contact_id;
      if (!investorId) return res.status(400).json({ message: "capital_investor_id required for approval" });

      const { manualCapitalEmailLink } = await import("./services/capital-email-linker");
      await manualCapitalEmailLink({
        investorId,
        contactId,
        threadId:        review.email_thread_id  || null,
        messageId:       review.email_message_id || null,
        emailDbId:       review.email_db_id      || null,
        subject:         review.subject          || "",
        direction:       "unknown",
        participants:    review.participants     || "",
        latestMessageAt: review.latest_message_at || null,
        createdBy:       req.session.userId,
      });
      await db.execute(sql.raw(`
        UPDATE capital_email_review
        SET status = 'approved', reviewed_by = ${req.session.userId}, reviewed_at = NOW()
        WHERE id = ${id}
      `));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] POST /email-review/:id/approve:", err?.message);
      res.status(500).json({ message: "Failed to approve review item" });
    }
  });

  app.post("/api/capital/email-review/:id/reject", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(`
        UPDATE capital_email_review
        SET status = 'rejected', reviewed_by = ${(req as any).session.userId}, reviewed_at = NOW()
        WHERE id = ${id}
      `));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] POST /email-review/:id/reject:", err?.message);
      res.status(500).json({ message: "Failed to reject review item" });
    }
  });

  app.post("/api/capital/email-review/:id/ignore", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(`
        UPDATE capital_email_review
        SET status = 'ignored', reviewed_by = ${(req as any).session.userId}, reviewed_at = NOW()
        WHERE id = ${id}
      `));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] POST /email-review/:id/ignore:", err?.message);
      res.status(500).json({ message: "Failed to ignore review item" });
    }
  });

  // ── Phase 2E: Round Command Center endpoint ───────────────────────────────
  app.get("/api/capital/rounds/:id/command-center", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid round id" });

      const {
        computeWeightedPipeline,
        computeLeadCandidates,
        computeThisWeekActions,
        computeRiskFlags,
        computeRunway,
        computeScenarios,
      } = await import("./services/capital-command-center.js");

      // Fetch round
      const roundRows = await db.execute(sql.raw(`SELECT * FROM capital_rounds WHERE id = ${id} LIMIT 1`));
      const round = roundRows.rows[0] as any;
      if (!round) return res.status(404).json({ message: "Round not found" });

      // Fetch all active investors (not passed)
      const invRows = await db.execute(sql.raw(`
        SELECT ci.*,
          (SELECT COUNT(*) FROM capital_contacts cc WHERE cc.investor_id = ci.id) AS contact_count
        FROM capital_investors ci
        WHERE ci.stage NOT IN ('Passed')
        ORDER BY ci.priority DESC NULLS LAST, ci.updated_at DESC
        LIMIT 500
      `));
      const investors = invRows.rows as any[];

      // Fetch commitments for this round
      const commRows = await db.execute(sql.raw(`
        SELECT cc.*, ci.name AS investor_name, ci.stage AS investor_stage
        FROM capital_commitments cc
        LEFT JOIN capital_investors ci ON ci.id = cc.investor_id
        WHERE cc.round_id = ${id}
        ORDER BY cc.created_at DESC
      `));
      const commitments = commRows.rows as any[];

      // Fetch contacts
      const contactRows = await db.execute(sql.raw(`
        SELECT cc.*, ci.name AS investor_name
        FROM capital_contacts cc
        LEFT JOIN capital_investors ci ON ci.id = cc.investor_id
        ORDER BY cc.influence_level DESC, cc.created_at DESC
        LIMIT 500
      `));
      const contacts = contactRows.rows as any[];

      // Email link counts per investor
      const emailLinkRows = await db.execute(sql.raw(`
        SELECT capital_investor_id, COUNT(*) AS cnt
        FROM capital_email_links
        WHERE deleted_at IS NULL
        GROUP BY capital_investor_id
      `));
      const emailLinkCounts = new Map<number, number>();
      for (const r of emailLinkRows.rows as any[]) {
        emailLinkCounts.set(Number(r.capital_investor_id), Number(r.cnt));
      }

      // Recent activity
      const actRows = await db.execute(sql.raw(`
        SELECT ca.*, u.name AS actor_name
        FROM capital_activities ca
        LEFT JOIN users u ON u.id = ca.created_by
        WHERE ca.entity_type = 'round' AND ca.entity_id = ${id}
        ORDER BY ca.created_at DESC
        LIMIT 15
      `));
      const recentActivity = actRows.rows;

      // Recent investor email conversations linked to this round's investors
      const emailRows = await db.execute(sql.raw(`
        SELECT cel.*, ci.name AS investor_name
        FROM capital_email_links cel
        JOIN capital_investors ci ON ci.id = cel.capital_investor_id
        WHERE cel.deleted_at IS NULL
          AND ci.id IN (
            SELECT DISTINCT cc2.investor_id FROM capital_commitments cc2
            WHERE cc2.round_id = ${id} AND cc2.investor_id IS NOT NULL
          )
        ORDER BY cel.latest_message_at DESC NULLS LAST
        LIMIT 10
      `));
      const recentEmails = emailRows.rows;

      // Compute all intelligence (Phase 2E)
      const pipeline     = computeWeightedPipeline(round, investors, commitments);
      const leads        = computeLeadCandidates(investors, commitments, contacts, emailLinkCounts);
      const actions      = computeThisWeekActions(investors, commitments, emailLinkCounts);
      const riskFlags    = computeRiskFlags(round, investors, pipeline);
      const runway       = computeRunway(round, pipeline.weighted_pipeline);
      const scenarios    = computeScenarios(round, pipeline, runway);

      // Phase 2F: Valuation, Dilution, Allocation & Close Plan
      const {
        computeValuationSummary,
        computeDilutionScenarios,
        computeAllocationPlan,
        computeClosePlan,
        computeCloseChecklist,
        computeValuationRiskFlags,
      } = await import("./services/capital-valuation.js");

      const valuationSummary  = computeValuationSummary(round, pipeline);
      const dilutionScenarios = computeDilutionScenarios(round, scenarios, valuationSummary);
      const allocationPlan    = computeAllocationPlan(investors, commitments);
      const closePlan         = computeClosePlan(allocationPlan, pipeline);
      const closeChecklist    = computeCloseChecklist(round, investors, pipeline, allocationPlan);
      const valuationFlags    = computeValuationRiskFlags(round, valuationSummary, allocationPlan, pipeline);

      // Phase 2G: Data Room intelligence
      const {
        computeDataRoomIntelligence,
        computeMaterialRiskFlags,
      } = await import("./services/capital-data-room.js");

      const [materialsRow, matSharesRow, matRequestsRow] = await Promise.all([
        db.execute(sql.raw(`
          SELECT cm.*, cr.name AS round_name
          FROM capital_materials cm
          LEFT JOIN capital_rounds cr ON cr.id = cm.round_id
          WHERE cm.deleted_at IS NULL
            AND (cm.round_id = ${id} OR cm.round_id IS NULL)
          ORDER BY cm.updated_at DESC LIMIT 100
        `)),
        db.execute(sql.raw(`
          SELECT cms.*, ci.name AS investor_name, cm.title AS material_title
          FROM capital_material_shares cms
          LEFT JOIN capital_investors ci ON ci.id = cms.investor_id
          LEFT JOIN capital_materials cm ON cm.id = cms.material_id
          WHERE cms.deleted_at IS NULL
          ORDER BY cms.shared_at DESC LIMIT 200
        `)),
        db.execute(sql.raw(`
          SELECT cmr.*, ci.name AS investor_name
          FROM capital_material_requests cmr
          LEFT JOIN capital_investors ci ON ci.id = cmr.investor_id
          WHERE cmr.deleted_at IS NULL
            AND (cmr.round_id = ${id} OR cmr.round_id IS NULL)
          ORDER BY cmr.requested_at DESC LIMIT 100
        `)),
      ]);
      const dataRoomIntel = computeDataRoomIntelligence(
        materialsRow.rows as any[],
        matSharesRow.rows as any[],
        matRequestsRow.rows as any[],
        investors
      );
      const dataRoomFlags = computeMaterialRiskFlags(
        materialsRow.rows as any[],
        matSharesRow.rows as any[],
        matRequestsRow.rows as any[],
        investors,
        dataRoomIntel
      );

      // Phase 2H: Portal Intelligence
      const {
        computePortalIntelligence,
        computePortalRiskFlags,
      } = await import("./services/capital-portal.js");

      const invIds = investors.map((inv: any) => inv.id);
      const [portalAccessRows, portalEventRows] = await Promise.all([
        invIds.length > 0
          ? db.execute(sql.raw(`
              SELECT cpa.*, ci.name AS investor_name,
                (SELECT COUNT(*) FROM capital_portal_materials cpm
                 WHERE cpm.portal_access_id = cpa.id AND cpm.deleted_at IS NULL) AS material_count
              FROM capital_portal_access cpa
              LEFT JOIN capital_investors ci ON ci.id = cpa.investor_id
              WHERE cpa.deleted_at IS NULL
                AND cpa.investor_id IN (${invIds.join(",")})
              ORDER BY cpa.created_at DESC LIMIT 500
            `))
          : Promise.resolve({ rows: [] }),
        db.execute(sql.raw(`
          SELECT cpe.*
          FROM capital_portal_events cpe
          JOIN capital_portal_access cpa ON cpa.id = cpe.portal_access_id
          WHERE cpa.deleted_at IS NULL
            AND cpe.occurred_at > NOW() - INTERVAL '30 days'
          ORDER BY cpe.occurred_at DESC LIMIT 2000
        `)),
      ]);

      const materialTitlesMap = new Map<number, string>();
      for (const m of (materialsRow.rows as any[])) {
        materialTitlesMap.set(Number(m.id), m.title ?? "Untitled");
      }

      const portalIntel = computePortalIntelligence(
        portalAccessRows.rows as any[],
        portalEventRows.rows as any[],
        investors,
        materialTitlesMap,
      );
      const portalFlags = computePortalRiskFlags(portalIntel);

      // ── Phase 2I: Engagement Intelligence ─────────────────────────────────────
      const {
        extractEngagementSignals,
        computeEngagementScore,
        computeCommandCenterEngagement,
        computeMaterialEngagement,
      } = await import("./services/capital-engagement.js");

      const [engActivitiesRow, engEmailLinksRow, engCommitmentsRow] = await Promise.all([
        invIds.length > 0
          ? db.execute(sql.raw(`
              SELECT * FROM capital_activities
              WHERE entity_type = 'investor' AND entity_id IN (${invIds.join(",")})
              ORDER BY activity_at DESC LIMIT 500
            `))
          : Promise.resolve({ rows: [] }),
        invIds.length > 0
          ? db.execute(sql.raw(`
              SELECT * FROM capital_email_links
              WHERE capital_investor_id IN (${invIds.join(",")})
                AND deleted_at IS NULL
              ORDER BY latest_message_at DESC LIMIT 300
            `))
          : Promise.resolve({ rows: [] }),
        invIds.length > 0
          ? db.execute(sql.raw(`
              SELECT * FROM capital_commitments
              WHERE investor_id IN (${invIds.join(",")})
              ORDER BY created_at DESC LIMIT 200
            `))
          : Promise.resolve({ rows: [] }),
      ]);

      const engInvestorRows = (investors as any[]).map((inv: any) => {
        const invActivities   = (engActivitiesRow.rows as any[]).filter(a => Number(a.entity_id)            === inv.id);
        const invEmailLinks   = (engEmailLinksRow.rows  as any[]).filter(e => Number(e.capital_investor_id) === inv.id);
        const invPortalAccess = (portalAccessRows.rows  as any[]).filter(p => Number(p.investor_id)         === inv.id);
        const invPortalEvents = (portalEventRows.rows   as any[]).filter(e => Number(e.investor_id)         === inv.id);
        const invMatShares    = (matSharesRow.rows       as any[]).filter(s => Number(s.investor_id)         === inv.id);
        const invCommitments  = (engCommitmentsRow.rows  as any[]).filter(c => Number(c.investor_id)         === inv.id);
        const signals = extractEngagementSignals(
          inv, invActivities, invEmailLinks, invPortalAccess, invPortalEvents,
          invMatShares, [], invCommitments, materialsRow.rows as any[]
        );
        const result = computeEngagementScore(inv, signals);
        return {
          investor_id:   inv.id,
          investor_name: inv.name,
          investor_type: inv.investor_type ?? "",
          stage:         inv.stage ?? "",
          priority:      inv.priority ?? "",
          warmth:        inv.warmth ?? "",
          do_not_contact: !!inv.do_not_contact,
          ...result,
          signals,
        };
      });

      const matEngagement = computeMaterialEngagement(
        materialsRow.rows as any[],
        matSharesRow.rows as any[],
        portalEventRows.rows as any[]
      );

      const engagementIntel = computeCommandCenterEngagement(
        engInvestorRows,
        matEngagement,
        [],
        portalAccessRows.rows as any[]
      );

      // Days open
      const daysOpen = round.open_date
        ? Math.floor((Date.now() - new Date(round.open_date).getTime()) / 86400000)
        : null;

      res.json({
        round:              { ...round, days_open: daysOpen },
        summary:            pipeline,
        lead_candidates:    leads,
        this_week_actions:  actions,
        risk_flags:         [...riskFlags, ...valuationFlags, ...dataRoomFlags, ...portalFlags],
        runway,
        scenarios,
        valuation_summary:  valuationSummary,
        dilution_scenarios: dilutionScenarios,
        allocation_plan:    allocationPlan,
        close_plan:         closePlan,
        close_checklist:    closeChecklist,
        data_room_intel:    dataRoomIntel,
        portal_intel:       portalIntel,
        engagement_intel:   engagementIntel,
        recent_activity:    recentActivity,
        recent_emails:      recentEmails,
      });
    } catch (err: any) {
      console.error("[capital] GET /rounds/:id/command-center:", err?.stack ?? err?.message);
      res.status(500).json({ message: "Failed to load command center" });
    }
  });

  // ── Phase 2E: Update round with command center fields ─────────────────────
  app.patch("/api/capital/rounds/:id/runway", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const allowed = ["minimum_close_target", "current_cash_balance", "monthly_burn", "post_close_monthly_burn"];
      const sets: string[] = [];
      for (const k of allowed) {
        if (k in req.body && req.body[k] !== undefined) {
          const v = req.body[k] === null ? "NULL" : Number(req.body[k]);
          sets.push(`${k} = ${v}`);
        }
      }
      if (!sets.length) return res.status(400).json({ message: "No fields to update" });
      sets.push(`updated_at = NOW()`);
      const rows = await db.execute(sql.raw(`UPDATE capital_rounds SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
      res.json(rows.rows[0]);
    } catch (err: any) {
      console.error("[capital] PATCH /rounds/:id/runway:", err?.message);
      res.status(500).json({ message: "Failed to update runway data" });
    }
  });

  // ── Phase 2F: Update round valuation / instrument fields ──────────────────
  app.patch("/api/capital/rounds/:id/valuation", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const numericFields = new Set(["pre_money_valuation","post_money_valuation","share_price","valuation_cap"]);
      const floatFields   = new Set(["option_pool_percent_pre","option_pool_percent_post","discount_rate","interest_rate"]);
      const allowed = [
        "pre_money_valuation","post_money_valuation","share_price",
        "option_pool_percent_pre","option_pool_percent_post",
        "round_instrument","discount_rate","valuation_cap",
        "interest_rate","maturity_date","legal_close_status",
      ];
      const sets: string[] = [`updated_at = NOW()`, `updated_by = ${req.session.userId ?? "NULL"}`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") { sets.push(`${key} = NULL`); }
        else if (numericFields.has(key)) { const n = Number(v); if (!isNaN(n)) sets.push(`${key} = ${n}`); }
        else if (floatFields.has(key))   { const n = parseFloat(v); if (!isNaN(n)) sets.push(`${key} = ${n}`); }
        else { sets.push(`${key} = '${esc(String(v))}'`); }
      }
      if (sets.length === 2) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_rounds SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
      const r = rows.rows[0] as any;
      if (!r) return res.status(404).json({ message: "Round not found" });
      res.json(r);
    } catch (err: any) {
      console.error("[capital] PATCH /rounds/:id/valuation:", err?.message);
      res.status(500).json({ message: "Failed to update valuation data" });
    }
  });

  // ── Phase 2G: Capital Materials CRUD ─────────────────────────────────────

  app.get("/api/capital/materials", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { type, status, round_id, search, tag } = req.query as any;
      let where = "WHERE cm.deleted_at IS NULL";
      if (type)     where += ` AND cm.material_type = '${esc(type)}'`;
      if (status)   where += ` AND cm.status = '${esc(status)}'`;
      if (round_id) { const rid = safeId(round_id); if (rid) where += ` AND cm.round_id = ${rid}`; }
      if (search)   where += ` AND (cm.title ILIKE '%${esc(search)}%' OR cm.description ILIKE '%${esc(search)}%')`;
      if (tag)      where += ` AND cm.tags ILIKE '%${esc(tag)}%'`;
      const rows = await db.execute(sql.raw(`
        SELECT cm.*,
               cr.name AS round_name,
               u.name  AS owner_name,
               (SELECT COUNT(*) FROM capital_material_shares s WHERE s.material_id = cm.id AND s.deleted_at IS NULL) AS share_count,
               (SELECT MAX(s.shared_at) FROM capital_material_shares s WHERE s.material_id = cm.id AND s.deleted_at IS NULL) AS latest_shared_at
        FROM capital_materials cm
        LEFT JOIN capital_rounds cr ON cr.id = cm.round_id
        LEFT JOIN users u ON u.id = cm.owner_user_id
        ${where}
        ORDER BY cm.updated_at DESC LIMIT 200
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /materials:", err?.message);
      res.status(500).json({ message: "Failed to load materials" });
    }
  });

  app.post("/api/capital/materials", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const { title, description, material_type, round_id, version_label, status,
              file_url, external_url, mime_type, file_size_bytes, tags,
              is_confidential, requires_nda } = req.body;
      if (!title?.trim()) return res.status(400).json({ message: "title is required" });
      const rid = safeId(round_id);
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_materials
          (title, description, material_type, round_id, version_label, status,
           file_url, external_url, mime_type, file_size_bytes, tags,
           is_confidential, requires_nda, owner_user_id, created_by, updated_by)
        VALUES (
          '${esc(title)}',
          ${description ? `'${esc(description)}'` : "NULL"},
          '${esc(material_type || "other")}',
          ${rid ?? "NULL"},
          ${version_label ? `'${esc(version_label)}'` : "NULL"},
          '${esc(status || "draft")}',
          ${file_url     ? `'${esc(file_url)}'`     : "NULL"},
          ${external_url ? `'${esc(external_url)}'` : "NULL"},
          ${mime_type    ? `'${esc(mime_type)}'`    : "NULL"},
          ${file_size_bytes != null ? Number(file_size_bytes) : "NULL"},
          ${tags         ? `'${esc(tags)}'`         : "NULL"},
          ${is_confidential === false ? "FALSE" : "TRUE"},
          ${requires_nda === true ? "TRUE" : "FALSE"},
          ${req.session.userId},
          ${req.session.userId},
          ${req.session.userId}
        ) RETURNING *
      `));
      const mat = row.rows[0] as any;
      await logCapitalActivity("capital_material", mat.id, "Material Created",
        `Created material: ${title}`, { createdBy: req.session.userId });
      res.status(201).json(mat);
    } catch (err: any) {
      console.error("[capital] POST /materials:", err?.message);
      res.status(500).json({ message: "Failed to create material" });
    }
  });

  app.get("/api/capital/materials/:id", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const [matRow, sharesRow, requestsRow] = await Promise.all([
        db.execute(sql.raw(`
          SELECT cm.*, cr.name AS round_name, u.name AS owner_name
          FROM capital_materials cm
          LEFT JOIN capital_rounds cr ON cr.id = cm.round_id
          LEFT JOIN users u ON u.id = cm.owner_user_id
          WHERE cm.id = ${id} AND cm.deleted_at IS NULL LIMIT 1
        `)),
        db.execute(sql.raw(`
          SELECT cms.*, ci.name AS investor_name, cc.full_name AS contact_name
          FROM capital_material_shares cms
          LEFT JOIN capital_investors ci ON ci.id = cms.investor_id
          LEFT JOIN capital_contacts  cc ON cc.id = cms.contact_id
          WHERE cms.material_id = ${id} AND cms.deleted_at IS NULL
          ORDER BY cms.shared_at DESC
        `)),
        db.execute(sql.raw(`
          SELECT cmr.*, ci.name AS investor_name
          FROM capital_material_requests cmr
          LEFT JOIN capital_investors ci ON ci.id = cmr.investor_id
          WHERE cmr.fulfilled_material_id = ${id} AND cmr.deleted_at IS NULL
          ORDER BY cmr.requested_at DESC
        `)),
      ]);
      const mat = matRow.rows[0];
      if (!mat) return res.status(404).json({ message: "Material not found" });
      res.json({ ...mat, shares: sharesRow.rows, requests: requestsRow.rows });
    } catch (err: any) {
      console.error("[capital] GET /materials/:id:", err?.message);
      res.status(500).json({ message: "Failed to load material" });
    }
  });

  app.patch("/api/capital/materials/:id", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const textFields = new Set(["title","description","material_type","version_label","status",
        "file_url","file_storage_key","external_url","mime_type","tags"]);
      const numFields  = new Set(["round_id","file_size_bytes"]);
      const boolFields = new Set(["is_confidential","requires_nda"]);
      const allowed = [...textFields, ...numFields, ...boolFields];
      const sets: string[] = [`updated_at = NOW()`, `updated_by = ${req.session.userId ?? "NULL"}`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") { sets.push(`${key} = NULL`); }
        else if (numFields.has(key))  { const n = safeId(v) ?? Number(v); if (!isNaN(n)) sets.push(`${key} = ${n}`); }
        else if (boolFields.has(key)) { sets.push(`${key} = ${v ? "TRUE" : "FALSE"}`); }
        else { sets.push(`${key} = '${esc(String(v))}'`); }
      }
      if (sets.length === 2) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_materials SET ${sets.join(", ")} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`));
      if (!rows.rows[0]) return res.status(404).json({ message: "Material not found" });
      res.json(rows.rows[0]);
    } catch (err: any) {
      console.error("[capital] PATCH /materials/:id:", err?.message);
      res.status(500).json({ message: "Failed to update material" });
    }
  });

  app.delete("/api/capital/materials/:id", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(`UPDATE capital_materials SET deleted_at = NOW(), updated_by = ${req.session.userId ?? "NULL"} WHERE id = ${id} AND deleted_at IS NULL`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /materials/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete material" });
    }
  });

  // ── Phase 2G: Material shares ─────────────────────────────────────────────

  app.get("/api/capital/materials/:id/shares", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const rows = await db.execute(sql.raw(`
        SELECT cms.*, ci.name AS investor_name, cc.full_name AS contact_name
        FROM capital_material_shares cms
        LEFT JOIN capital_investors ci ON ci.id = cms.investor_id
        LEFT JOIN capital_contacts  cc ON cc.id = cms.contact_id
        WHERE cms.material_id = ${id} AND cms.deleted_at IS NULL
        ORDER BY cms.shared_at DESC
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /materials/:id/shares:", err?.message);
      res.status(500).json({ message: "Failed to load shares" });
    }
  });

  app.post("/api/capital/materials/:id/share", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const materialId = safeId(req.params.id);
      if (!materialId) return res.status(400).json({ message: "Invalid material id" });
      const { investor_id, contact_id, round_id, share_method, email_thread_id, email_message_id, notes } = req.body;
      const invId = safeId(investor_id);
      if (!invId) return res.status(400).json({ message: "investor_id is required" });

      // Check material exists
      const matCheck = await db.execute(sql.raw(`SELECT id, title, status FROM capital_materials WHERE id = ${materialId} AND deleted_at IS NULL LIMIT 1`));
      if (!matCheck.rows[0]) return res.status(404).json({ message: "Material not found" });
      const mat = matCheck.rows[0] as any;

      // Upsert: prevent exact duplicate same-day shares
      const existing = await db.execute(sql.raw(`
        SELECT id FROM capital_material_shares
        WHERE material_id = ${materialId} AND investor_id = ${invId} AND deleted_at IS NULL
          AND shared_at > NOW() - INTERVAL '1 hour'
        LIMIT 1
      `));
      if (existing.rows[0]) {
        return res.status(409).json({ message: "Already shared with this investor in the last hour", share: existing.rows[0] });
      }

      const cid  = safeId(contact_id);
      const rid  = safeId(round_id);
      const row  = await db.execute(sql.raw(`
        INSERT INTO capital_material_shares
          (material_id, investor_id, contact_id, round_id, share_method,
           email_thread_id, email_message_id, shared_by, notes, last_activity_at)
        VALUES (
          ${materialId}, ${invId},
          ${cid ?? "NULL"}, ${rid ?? "NULL"},
          '${esc(share_method || "manual")}',
          ${email_thread_id  ? `'${esc(email_thread_id)}'`  : "NULL"},
          ${email_message_id ? `'${esc(email_message_id)}'` : "NULL"},
          ${req.session.userId ?? "NULL"},
          ${notes ? `'${esc(notes)}'` : "NULL"},
          NOW()
        ) RETURNING *
      `));
      const share = row.rows[0] as any;

      // Log capital activity
      await logCapitalActivity("investor", invId, "Material Shared",
        `Shared material: ${mat.title}`,
        { body: `Method: ${share_method || "manual"}${notes ? ` — ${notes}` : ""}`, createdBy: req.session.userId }
      );

      // Update investor last_touch_at
      await db.execute(sql.raw(`UPDATE capital_investors SET last_touch_at = NOW(), updated_at = NOW() WHERE id = ${invId}`));

      res.status(201).json(share);
    } catch (err: any) {
      console.error("[capital] POST /materials/:id/share:", err?.message);
      res.status(500).json({ message: "Failed to record share" });
    }
  });

  app.patch("/api/capital/material-shares/:id", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const allowed = ["status","viewed_at","downloaded_at","last_activity_at","notes"];
      const sets: string[] = [`updated_at = NOW()`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") { sets.push(`${key} = NULL`); }
        else { sets.push(`${key} = '${esc(String(v))}'`); }
      }
      if (sets.length === 1) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_material_shares SET ${sets.join(", ")} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`));
      if (!rows.rows[0]) return res.status(404).json({ message: "Share not found" });
      res.json(rows.rows[0]);
    } catch (err: any) {
      console.error("[capital] PATCH /material-shares/:id:", err?.message);
      res.status(500).json({ message: "Failed to update share" });
    }
  });

  app.delete("/api/capital/material-shares/:id", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(`UPDATE capital_material_shares SET deleted_at = NOW() WHERE id = ${id} AND deleted_at IS NULL`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /material-shares/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete share" });
    }
  });

  // ── Phase 2G: Investor materials view ────────────────────────────────────

  app.get("/api/capital/investors/:id/materials", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const [invRow, materialsRow, sharesRow, requestsRow] = await Promise.all([
        db.execute(sql.raw(`SELECT id, name, stage FROM capital_investors WHERE id = ${id} LIMIT 1`)),
        db.execute(sql.raw(`SELECT * FROM capital_materials WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100`)),
        db.execute(sql.raw(`SELECT * FROM capital_material_shares WHERE investor_id = ${id} AND deleted_at IS NULL ORDER BY shared_at DESC`)),
        db.execute(sql.raw(`
          SELECT cmr.*, cm.title AS fulfilled_material_title
          FROM capital_material_requests cmr
          LEFT JOIN capital_materials cm ON cm.id = cmr.fulfilled_material_id
          WHERE cmr.investor_id = ${id} AND cmr.deleted_at IS NULL
          ORDER BY cmr.requested_at DESC
        `)),
      ]);
      const inv = invRow.rows[0];
      if (!inv) return res.status(404).json({ message: "Investor not found" });
      const { getInvestorMaterials } = await import("./services/capital-data-room.js");
      const materialRows = getInvestorMaterials(id, materialsRow.rows as any[], sharesRow.rows as any[]);
      res.json({ investor: inv, materials: materialRows, requests: requestsRow.rows });
    } catch (err: any) {
      console.error("[capital] GET /investors/:id/materials:", err?.message);
      res.status(500).json({ message: "Failed to load investor materials" });
    }
  });

  // ── Phase 2G: Material requests CRUD ─────────────────────────────────────

  app.get("/api/capital/material-requests", requireAuth, requireCapitalAccess, async (req, res) => {
    try {
      const { investor_id, round_id, status } = req.query as any;
      let where = "WHERE cmr.deleted_at IS NULL";
      if (investor_id) { const iid = safeId(investor_id); if (iid) where += ` AND cmr.investor_id = ${iid}`; }
      if (round_id)    { const rid = safeId(round_id);    if (rid) where += ` AND cmr.round_id = ${rid}`; }
      if (status)      where += ` AND cmr.request_status = '${esc(status)}'`;
      const rows = await db.execute(sql.raw(`
        SELECT cmr.*, ci.name AS investor_name, cm.title AS fulfilled_material_title
        FROM capital_material_requests cmr
        LEFT JOIN capital_investors ci ON ci.id = cmr.investor_id
        LEFT JOIN capital_materials  cm ON cm.id = cmr.fulfilled_material_id
        ${where}
        ORDER BY cmr.priority DESC, cmr.due_at ASC NULLS LAST, cmr.requested_at DESC
        LIMIT 200
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /material-requests:", err?.message);
      res.status(500).json({ message: "Failed to load material requests" });
    }
  });

  app.post("/api/capital/material-requests", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const { investor_id, contact_id, round_id, requested_material_type, requested_title,
              priority, due_at, notes } = req.body;
      const invId = safeId(investor_id);
      if (!invId) return res.status(400).json({ message: "investor_id is required" });
      const row = await db.execute(sql.raw(`
        INSERT INTO capital_material_requests
          (investor_id, contact_id, round_id, requested_material_type, requested_title,
           request_status, priority, due_at, requested_by, notes)
        VALUES (
          ${invId},
          ${safeId(contact_id) ?? "NULL"},
          ${safeId(round_id)   ?? "NULL"},
          ${requested_material_type ? `'${esc(requested_material_type)}'` : "NULL"},
          ${requested_title ? `'${esc(requested_title)}'` : "NULL"},
          'requested',
          '${esc(priority || "medium")}',
          ${due_at ? `'${esc(due_at)}'` : "NULL"},
          ${req.session.userId ?? "NULL"},
          ${notes  ? `'${esc(notes)}'`  : "NULL"}
        ) RETURNING *
      `));
      const reqRow = row.rows[0] as any;
      await logCapitalActivity("investor", invId, "Material Requested",
        `Material request: ${requested_title || requested_material_type || "unknown"}`,
        { createdBy: req.session.userId }
      );
      res.status(201).json(reqRow);
    } catch (err: any) {
      console.error("[capital] POST /material-requests:", err?.message);
      res.status(500).json({ message: "Failed to create material request" });
    }
  });

  app.patch("/api/capital/material-requests/:id", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const numFields  = new Set(["fulfilled_material_id"]);
      const textFields = new Set(["request_status","priority","requested_material_type","requested_title","notes"]);
      const dtFields   = new Set(["due_at","fulfilled_at"]);
      const allowed = [...numFields, ...textFields, ...dtFields];
      const sets: string[] = [`updated_at = NOW()`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") { sets.push(`${key} = NULL`); }
        else if (numFields.has(key)) { const n = safeId(v); if (n) sets.push(`${key} = ${n}`); }
        else { sets.push(`${key} = '${esc(String(v))}'`); }
      }
      // Auto-set fulfilled_at when status → shared
      if ("request_status" in req.body && req.body.request_status === "shared") {
        sets.push("fulfilled_at = COALESCE(fulfilled_at, NOW())");
      }
      if (sets.length === 1) return res.status(400).json({ message: "No fields to update" });
      const rows = await db.execute(sql.raw(`UPDATE capital_material_requests SET ${sets.join(", ")} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`));
      if (!rows.rows[0]) return res.status(404).json({ message: "Request not found" });
      res.json(rows.rows[0]);
    } catch (err: any) {
      console.error("[capital] PATCH /material-requests/:id:", err?.message);
      res.status(500).json({ message: "Failed to update material request" });
    }
  });

  app.delete("/api/capital/material-requests/:id", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(`UPDATE capital_material_requests SET deleted_at = NOW() WHERE id = ${id} AND deleted_at IS NULL`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /material-requests/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete material request" });
    }
  });

  // ── Phase 2H: Investor Portal ──────────────────────────────────────────────────

  // Hash a raw token for DB storage (never stored raw)
  function hashPortalToken(raw: string): string {
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  // Hash an IP address for privacy (never store raw IPs)
  function hashIp(ip: string | undefined): string | null {
    if (!ip) return null;
    return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
  }

  const MATERIAL_TYPE_LABELS: Record<string, string> = {
    pitch_deck: "Pitch Deck", financial_model: "Financial Model",
    executive_summary: "Executive Summary", term_sheet: "Term Sheet",
    due_diligence: "Due Diligence", legal_document: "Legal Document",
    nda: "NDA", cap_table: "Cap Table", investor_update: "Investor Update",
    product_demo: "Product Demo", reference: "Reference", other: "Other",
  };

  // ── GET /api/capital/investors/:id/portal-access ───────────────────────────
  app.get("/api/capital/investors/:id/portal-access", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const invId = safeId(req.params.id);
      if (!invId) return res.status(400).json({ message: "Invalid investor id" });

      const rows = await db.execute(sql.raw(`
        SELECT
          cpa.*,
          ci.name AS investor_name,
          cr.name AS round_name,
          cc.first_name || ' ' || COALESCE(cc.last_name, '') AS contact_name,
          (
            SELECT COUNT(*) FROM capital_portal_materials cpm
            WHERE cpm.portal_access_id = cpa.id AND cpm.deleted_at IS NULL
          ) AS material_count,
          (
            SELECT COUNT(*) FROM capital_portal_events cpe
            WHERE cpe.portal_access_id = cpa.id
          ) AS event_count
        FROM capital_portal_access cpa
        LEFT JOIN capital_investors ci ON ci.id = cpa.investor_id
        LEFT JOIN capital_rounds cr ON cr.id = cpa.round_id
        LEFT JOIN capital_contacts cc ON cc.id = cpa.contact_id
        WHERE cpa.investor_id = ${invId} AND cpa.deleted_at IS NULL
        ORDER BY cpa.created_at DESC
      `));

      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /investors/:id/portal-access:", err?.message);
      res.status(500).json({ message: "Failed to load portal access" });
    }
  });

  // ── POST /api/capital/investors/:id/portal-access ─────────────────────────
  // Returns raw token ONCE — never stored, only the hash is persisted.
  app.post("/api/capital/investors/:id/portal-access", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const invId = safeId(req.params.id);
      if (!invId) return res.status(400).json({ message: "Invalid investor id" });

      const {
        access_label = "",
        round_id,
        contact_id,
        expires_at,
        notes,
        material_ids = [],
        permissions: permMap = {},
      } = req.body;

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashPortalToken(rawToken);

      const roundId = safeId(round_id);
      const contactId = safeId(contact_id);
      const expiresAtSql = expires_at ? `'${esc(String(expires_at))}'` : "NULL";

      const insertRes = await db.execute(sql.raw(`
        INSERT INTO capital_portal_access
          (investor_id, contact_id, round_id, access_token_hash, access_label, status, expires_at, created_by, notes)
        VALUES
          (${invId}, ${contactId ?? "NULL"}, ${roundId ?? "NULL"},
           '${esc(tokenHash)}', '${esc(String(access_label))}', 'active',
           ${expiresAtSql}, ${req.session.userId ?? "NULL"}, ${notes ? `'${esc(String(notes))}'` : "NULL"})
        RETURNING *
      `));
      const portal = insertRes.rows[0] as any;
      if (!portal) return res.status(500).json({ message: "Failed to create portal access" });

      // Add selected materials
      const matIds: number[] = Array.isArray(material_ids)
        ? material_ids.map(Number).filter(n => !isNaN(n) && n > 0)
        : [];
      for (const mid of matIds) {
        const perm = permMap[mid] === "download" ? "download" : "view";
        try {
          await db.execute(sql.raw(`
            INSERT INTO capital_portal_materials (portal_access_id, material_id, permission, added_by)
            VALUES (${portal.id}, ${mid}, '${perm}', ${req.session.userId ?? "NULL"})
            ON CONFLICT DO NOTHING
          `));
        } catch { /* skip duplicates */ }
      }

      // Log activity
      try {
        await db.execute(sql.raw(`
          INSERT INTO capital_activities (entity_type, entity_id, activity_type, title, created_by)
          VALUES ('investor', ${invId}, 'portal_access_created',
                  'Investor portal access created: ${esc(String(access_label))}',
                  ${req.session.userId ?? "NULL"})
        `));
      } catch { /* non-fatal */ }

      void recordHighRiskAction({ actor_user_id: getAuditActor(req), action: "investor_portal_access_create", category: "token_action", target_type: "capital_investor", target_id: invId, route: req.path, severity: "critical", metadata: { portal_access_id: portal.id, investor_id: invId, material_count: matIds.length } });
      res.status(201).json({ ...portal, raw_token: rawToken, material_count: matIds.length });
    } catch (err: any) {
      console.error("[capital] POST /investors/:id/portal-access:", err?.message);
      res.status(500).json({ message: "Failed to create portal access" });
    }
  });

  // ── PATCH /api/capital/portal-access/:id ─────────────────────────────────
  app.patch("/api/capital/portal-access/:id", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      const allowed = ["access_label", "notes", "expires_at", "status"] as const;
      const sets: string[] = [`updated_at = NOW()`];
      for (const key of allowed) {
        if (!(key in req.body)) continue;
        const v = req.body[key];
        if (v === null || v === "") {
          if (key === "expires_at") { sets.push(`${key} = NULL`); }
        } else {
          sets.push(`${key} = '${esc(String(v))}'`);
        }
      }
      if (sets.length === 1) return res.status(400).json({ message: "No fields to update" });

      const rows = await db.execute(sql.raw(`
        UPDATE capital_portal_access SET ${sets.join(", ")}
        WHERE id = ${id} AND deleted_at IS NULL RETURNING *
      `));
      const row = rows.rows[0] as any;
      if (!row) return res.status(404).json({ message: "Portal access not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[capital] PATCH /portal-access/:id:", err?.message);
      res.status(500).json({ message: "Failed to update portal access" });
    }
  });

  // ── POST /api/capital/portal-access/:id/revoke ────────────────────────────
  app.post("/api/capital/portal-access/:id/revoke", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      await db.execute(sql.raw(`
        UPDATE capital_portal_access
        SET status = 'revoked', revoked_at = NOW(), revoked_by = ${req.session.userId ?? "NULL"}, updated_at = NOW()
        WHERE id = ${id} AND deleted_at IS NULL
      `));
      void recordHighRiskAction({ actor_user_id: getAuditActor(req), action: "investor_portal_token_revoke", category: "token_action", target_type: "capital_portal_access", target_id: id, route: req.path, severity: "critical" });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] POST /portal-access/:id/revoke:", err?.message);
      res.status(500).json({ message: "Failed to revoke portal access" });
    }
  });

  // ── DELETE /api/capital/portal-access/:id ────────────────────────────────
  app.delete("/api/capital/portal-access/:id", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      await db.execute(sql.raw(`
        UPDATE capital_portal_access SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND deleted_at IS NULL
      `));
      void recordHighRiskAction({ actor_user_id: getAuditActor(req), action: "investor_portal_access_delete", category: "capital_action", target_type: "capital_portal_access", target_id: id, route: req.path, severity: "critical" });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /portal-access/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete portal access" });
    }
  });

  // ── POST /api/capital/portal-access/:id/regenerate ───────────────────────
  // Revokes existing token and issues a new one. Returns new raw token once.
  app.post("/api/capital/portal-access/:id/regenerate", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashPortalToken(rawToken);

      const rows = await db.execute(sql.raw(`
        UPDATE capital_portal_access
        SET access_token_hash = '${esc(tokenHash)}',
            status = 'active', revoked_at = NULL, revoked_by = NULL,
            access_count = 0, last_accessed_at = NULL, updated_at = NOW()
        WHERE id = ${id} AND deleted_at IS NULL RETURNING *
      `));
      const row = rows.rows[0] as any;
      if (!row) return res.status(404).json({ message: "Portal access not found" });
      void recordHighRiskAction({ actor_user_id: getAuditActor(req), action: "investor_portal_token_regenerate", category: "token_action", target_type: "capital_portal_access", target_id: id, route: req.path, severity: "critical" });
      res.json({ ...row, raw_token: rawToken });
    } catch (err: any) {
      console.error("[capital] POST /portal-access/:id/regenerate:", err?.message);
      res.status(500).json({ message: "Failed to regenerate portal access" });
    }
  });

  // ── POST /api/capital/portal-access/:id/materials ────────────────────────
  app.post("/api/capital/portal-access/:id/materials", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      const matId = safeId(req.body.material_id);
      if (!matId) return res.status(400).json({ message: "material_id required" });

      const permission = req.body.permission === "download" ? "download" : "view";

      await db.execute(sql.raw(`
        INSERT INTO capital_portal_materials (portal_access_id, material_id, permission, added_by)
        VALUES (${id}, ${matId}, '${permission}', ${req.session.userId ?? "NULL"})
        ON CONFLICT DO NOTHING
      `));
      // If previously soft-deleted, restore
      await db.execute(sql.raw(`
        UPDATE capital_portal_materials SET deleted_at = NULL, permission = '${permission}'
        WHERE portal_access_id = ${id} AND material_id = ${matId} AND deleted_at IS NOT NULL
      `));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] POST /portal-access/:id/materials:", err?.message);
      res.status(500).json({ message: "Failed to add material" });
    }
  });

  // ── DELETE /api/capital/portal-access/:id/materials/:materialId ──────────
  app.delete("/api/capital/portal-access/:id/materials/:materialId", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      const matId = safeId(req.params.materialId);
      if (!id || !matId) return res.status(400).json({ message: "Invalid ids" });

      await db.execute(sql.raw(`
        UPDATE capital_portal_materials SET deleted_at = NOW()
        WHERE portal_access_id = ${id} AND material_id = ${matId} AND deleted_at IS NULL
      `));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /portal-access/:id/materials/:materialId:", err?.message);
      res.status(500).json({ message: "Failed to remove material" });
    }
  });

  // ── GET /api/capital/portal-access/:id/materials ─────────────────────────
  app.get("/api/capital/portal-access/:id/materials", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      const rows = await db.execute(sql.raw(`
        SELECT cpm.*, cm.title, cm.material_type, cm.version_label,
               cm.external_url, cm.file_size_bytes, cm.mime_type, cm.status AS material_status
        FROM capital_portal_materials cpm
        JOIN capital_materials cm ON cm.id = cpm.material_id
        WHERE cpm.portal_access_id = ${id} AND cpm.deleted_at IS NULL
          AND cm.deleted_at IS NULL
        ORDER BY cpm.added_at DESC
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /portal-access/:id/materials:", err?.message);
      res.status(500).json({ message: "Failed to load portal materials" });
    }
  });

  // ── GET /api/capital/portal-access/:id/events ────────────────────────────
  app.get("/api/capital/portal-access/:id/events", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      const rows = await db.execute(sql.raw(`
        SELECT cpe.*, cm.title AS material_title
        FROM capital_portal_events cpe
        LEFT JOIN capital_materials cm ON cm.id = cpe.material_id
        WHERE cpe.portal_access_id = ${id}
        ORDER BY cpe.occurred_at DESC
        LIMIT 200
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /portal-access/:id/events:", err?.message);
      res.status(500).json({ message: "Failed to load portal events" });
    }
  });

  // ── GET /api/capital/portal-access/material-stats ────────────────────────
  // Returns { material_id, portal_count }[] for portal indicators on data room
  app.get("/api/capital/portal-access/material-stats", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const rows = await db.execute(sql.raw(`
        SELECT cpm.material_id, COUNT(DISTINCT cpa.id) AS portal_count
        FROM capital_portal_materials cpm
        JOIN capital_portal_access cpa ON cpa.id = cpm.portal_access_id
        WHERE cpm.deleted_at IS NULL
          AND cpa.deleted_at IS NULL
          AND cpa.status = 'active'
        GROUP BY cpm.material_id
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /portal-access/material-stats:", err?.message);
      res.status(500).json({ message: "Failed to load material stats" });
    }
  });

  // ── PUBLIC: GET /api/investor-portal/:token ───────────────────────────────
  // No requireAuth. Token-only access. Never exposes internal Capital data.
  app.get("/api/investor-portal/:token", async (req: any, res) => {
    try {
      const raw = String(req.params.token || "");
      if (raw.length !== 64 || !/^[0-9a-f]+$/.test(raw)) {
        return res.status(404).json({ message: "Invalid or expired link" });
      }
      const tokenHash = hashPortalToken(raw);

      const accessRows = await db.execute(sql.raw(`
        SELECT cpa.*, ci.name AS investor_name, cr.name AS round_name
        FROM capital_portal_access cpa
        LEFT JOIN capital_investors ci ON ci.id = cpa.investor_id
        LEFT JOIN capital_rounds cr ON cr.id = cpa.round_id
        WHERE cpa.access_token_hash = '${esc(tokenHash)}'
          AND cpa.deleted_at IS NULL
        LIMIT 1
      `));
      const portal = accessRows.rows[0] as any;
      if (!portal) return res.status(404).json({ message: "Invalid or expired link" });

      // Check status and expiry
      if (portal.status === "revoked") {
        return res.status(403).json({ message: "This link has been revoked" });
      }
      if (portal.expires_at && new Date(portal.expires_at).getTime() < Date.now()) {
        return res.status(403).json({ message: "This link has expired" });
      }

      // Fetch materials for this portal
      const matRows = await db.execute(sql.raw(`
        SELECT
          cm.id, cm.title, cm.description, cm.material_type, cm.version_label,
          cm.external_url, cm.file_size_bytes, cm.mime_type,
          cpm.permission
        FROM capital_portal_materials cpm
        JOIN capital_materials cm ON cm.id = cpm.material_id
        WHERE cpm.portal_access_id = ${portal.id}
          AND cpm.deleted_at IS NULL
          AND cm.deleted_at IS NULL
          AND cm.status = 'active'
        ORDER BY cpm.added_at ASC
      `));

      // Log portal_opened event (deduplicate: max once per portal per calendar day)
      try {
        const today = new Date().toISOString().slice(0, 10);
        const existsRows = await db.execute(sql.raw(`
          SELECT id FROM capital_portal_events
          WHERE portal_access_id = ${portal.id}
            AND event_type = 'portal_opened'
            AND DATE(occurred_at) = '${today}'
          LIMIT 1
        `));
        if (existsRows.rows.length === 0) {
          const ipHash = hashIp(req.ip || req.headers["x-forwarded-for"]?.toString());
          const ua = req.headers["user-agent"] ? `'${esc(String(req.headers["user-agent"]).slice(0, 512))}'` : "NULL";
          await db.execute(sql.raw(`
            INSERT INTO capital_portal_events (portal_access_id, investor_id, event_type, user_agent, ip_hash)
            VALUES (${portal.id}, ${portal.investor_id}, 'portal_opened', ${ua}, ${ipHash ? `'${esc(ipHash)}'` : "NULL"})
          `));
          await db.execute(sql.raw(`
            UPDATE capital_portal_access
            SET access_count = access_count + 1, last_accessed_at = NOW(), updated_at = NOW()
            WHERE id = ${portal.id}
          `));
        }
      } catch { /* non-fatal — event logging must not block portal access */ }

      // Build safe response — never include scores, probability, internal notes, financial data
      const materials = (matRows.rows as any[]).map(m => ({
        id: m.id,
        title: m.title,
        description: m.description,
        material_type: m.material_type,
        material_type_label: MATERIAL_TYPE_LABELS[m.material_type] ?? m.material_type,
        version_label: m.version_label,
        external_url: m.permission === "view" || m.permission === "download" ? m.external_url : null,
        file_size_bytes: m.file_size_bytes,
        mime_type: m.mime_type,
        permission: m.permission,
      }));

      res.json({
        access_label:  portal.access_label,
        investor_name: portal.investor_name,
        round_name:    portal.round_name,
        expires_at:    portal.expires_at,
        materials,
      });
    } catch (err: any) {
      console.error("[portal] GET /api/investor-portal/:token:", err?.message);
      res.status(500).json({ message: "Failed to load portal" });
    }
  });

  // ── PUBLIC: POST /api/investor-portal/:token/events ──────────────────────
  app.post("/api/investor-portal/:token/events", async (req: any, res) => {
    try {
      const raw = String(req.params.token || "");
      if (raw.length !== 64 || !/^[0-9a-f]+$/.test(raw)) {
        return res.status(404).json({ message: "Invalid link" });
      }
      const tokenHash = hashPortalToken(raw);

      const accessRows = await db.execute(sql.raw(`
        SELECT id, investor_id, status, expires_at, deleted_at
        FROM capital_portal_access
        WHERE access_token_hash = '${esc(tokenHash)}'
          AND deleted_at IS NULL
          AND status = 'active'
        LIMIT 1
      `));
      const portal = accessRows.rows[0] as any;
      if (!portal) return res.status(404).json({ message: "Invalid link" });
      if (portal.expires_at && new Date(portal.expires_at).getTime() < Date.now()) {
        return res.status(403).json({ message: "Link expired" });
      }

      const eventType = String(req.body.event_type || "");
      const allowedEvents = new Set(["material_viewed", "material_downloaded"]);
      if (!allowedEvents.has(eventType)) {
        return res.status(400).json({ message: "Invalid event_type" });
      }

      const matId = safeId(req.body.material_id);
      const ipHash = hashIp(req.ip || req.headers["x-forwarded-for"]?.toString());
      const ua = req.headers["user-agent"] ? `'${esc(String(req.headers["user-agent"]).slice(0, 512))}'` : "NULL";

      await db.execute(sql.raw(`
        INSERT INTO capital_portal_events (portal_access_id, investor_id, material_id, event_type, user_agent, ip_hash)
        VALUES (${portal.id}, ${portal.investor_id}, ${matId ?? "NULL"}, '${esc(eventType)}', ${ua}, ${ipHash ? `'${esc(ipHash)}'` : "NULL"})
      `));

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[portal] POST /api/investor-portal/:token/events:", err?.message);
      res.status(500).json({ message: "Failed to log event" });
    }
  });

  // ── Phase 2F: Update commitment allocation / closing fields ───────────────
  app.patch("/api/capital/commitments/:id/allocation", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });
      const numericFields = new Set(["allocation_amount","requested_amount","final_allocation_amount"]);
      const allowed = [
        "allocation_amount","requested_amount","final_allocation_amount",
        "allocation_status","closing_status",
        "docs_sent_at","docs_signed_at","funds_received_at",
        "allocation_notes",
      ];
      const sets: string[] = [`updated_at = NOW()`, `updated_by = ${req.session.userId ?? "NULL"}`];
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
      res.json(c);
    } catch (err: any) {
      console.error("[capital] PATCH /commitments/:id/allocation:", err?.message);
      res.status(500).json({ message: "Failed to update allocation data" });
    }
  });

  // ── Phase 2I: GET /api/capital/engagement ─────────────────────────────────
  // Batch engagement analytics across all (or round-scoped) investors.
  app.get("/api/capital/engagement", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const roundId = safeId(req.query.round_id);

      // Load investors (optionally scoped to round via commitments)
      let investorsRows: any[];
      if (roundId) {
        const rows = await db.execute(sql.raw(`
          SELECT ci.*
          FROM capital_investors ci
          WHERE ci.deleted_at IS NULL
            AND EXISTS (
              SELECT 1 FROM capital_commitments cc
              WHERE cc.investor_id = ci.id AND cc.round_id = ${roundId} AND cc.deleted_at IS NULL
            )
          ORDER BY ci.name ASC
        `));
        investorsRows = rows.rows as any[];
      } else {
        const rows = await db.execute(sql.raw(`
          SELECT * FROM capital_investors WHERE deleted_at IS NULL ORDER BY name ASC
        `));
        investorsRows = rows.rows as any[];
      }

      const rounds = await db.execute(sql.raw(`
        SELECT id, name, status FROM capital_rounds WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20
      `));

      if (investorsRows.length === 0) {
        return res.json({
          investors:          [],
          analytics:          { total_investors: 0, highly_engaged_count: 0, engaged_count: 0, watching_count: 0, stale_count: 0, cold_count: 0, portal_opens_7d: 0, material_views_7d: 0, material_downloads_7d: 0, recent_inbound_replies: 0, no_engagement_after_portal: 0, hot_with_stale_followup: 0 },
          material_engagement: [],
          round_id:           roundId ?? null,
          rounds:             rounds.rows,
        });
      }

      const invIds = investorsRows.map((i: any) => i.id);
      const inList = invIds.join(",");

      const [activitiesRows, emailLinksRows, portalAccessRows, portalEventRows,
             matSharesRows, matRequestsRows, commitmentsRows, materialsRows] = await Promise.all([
        db.execute(sql.raw(`
          SELECT * FROM capital_activities
          WHERE entity_type = 'investor' AND entity_id IN (${inList})
          ORDER BY activity_at DESC LIMIT 1000
        `)),
        db.execute(sql.raw(`
          SELECT * FROM capital_email_links
          WHERE capital_investor_id IN (${inList}) AND deleted_at IS NULL
          ORDER BY latest_message_at DESC LIMIT 500
        `)),
        db.execute(sql.raw(`
          SELECT cpa.*
          FROM capital_portal_access cpa
          WHERE cpa.investor_id IN (${inList}) AND cpa.deleted_at IS NULL
          ORDER BY cpa.created_at DESC LIMIT 500
        `)),
        db.execute(sql.raw(`
          SELECT cpe.*
          FROM capital_portal_events cpe
          JOIN capital_portal_access cpa ON cpa.id = cpe.portal_access_id
          WHERE cpa.investor_id IN (${inList}) AND cpa.deleted_at IS NULL
          ORDER BY cpe.occurred_at DESC LIMIT 2000
        `)),
        db.execute(sql.raw(`
          SELECT cms.*, cm.material_type
          FROM capital_material_shares cms
          LEFT JOIN capital_materials cm ON cm.id = cms.material_id
          WHERE cms.investor_id IN (${inList}) AND cms.deleted_at IS NULL
          ORDER BY cms.shared_at DESC LIMIT 1000
        `)),
        db.execute(sql.raw(`
          SELECT * FROM capital_material_requests
          WHERE investor_id IN (${inList}) AND deleted_at IS NULL
          ORDER BY requested_at DESC LIMIT 500
        `)),
        db.execute(sql.raw(`
          SELECT * FROM capital_commitments
          WHERE investor_id IN (${inList}) AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 500
        `)),
        db.execute(sql.raw(`
          SELECT id, title, material_type, status, version_label, deleted_at
          FROM capital_materials WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200
        `)),
      ]);

      const {
        extractEngagementSignals,
        computeEngagementScore,
        computeEngagementAnalytics,
        computeMaterialEngagement,
      } = await import("./services/capital-engagement.js");

      const engRows = investorsRows.map((inv: any) => {
        const invAct   = (activitiesRows.rows as any[]).filter(a => Number(a.entity_id)            === inv.id);
        const invEmail = (emailLinksRows.rows  as any[]).filter(e => Number(e.capital_investor_id) === inv.id);
        const invPA    = (portalAccessRows.rows as any[]).filter(p => Number(p.investor_id)        === inv.id);
        const invPE    = (portalEventRows.rows  as any[]).filter(e => Number(e.investor_id)        === inv.id);
        const invMS    = (matSharesRows.rows    as any[]).filter(s => Number(s.investor_id)        === inv.id);
        const invMR    = (matRequestsRows.rows  as any[]).filter(r => Number(r.investor_id)        === inv.id);
        const invCom   = (commitmentsRows.rows  as any[]).filter(c => Number(c.investor_id)        === inv.id);
        const signals  = extractEngagementSignals(
          inv, invAct, invEmail, invPA, invPE, invMS, invMR, invCom, materialsRows.rows as any[]
        );
        const result   = computeEngagementScore(inv, signals);
        return {
          investor_id:   inv.id,
          investor_name: inv.name,
          investor_type: inv.investor_type ?? "",
          stage:         inv.stage ?? "",
          priority:      inv.priority ?? "",
          warmth:        inv.warmth ?? "",
          do_not_contact: !!inv.do_not_contact,
          engagement_score: result.engagement_score,
          engagement_tier:  result.engagement_tier,
          ...result,
          signals,
        };
      });

      const analytics = computeEngagementAnalytics(
        engRows,
        portalEventRows.rows as any[],
        matSharesRows.rows   as any[],
        emailLinksRows.rows  as any[],
      );

      const materialEngagement = computeMaterialEngagement(
        materialsRows.rows   as any[],
        matSharesRows.rows   as any[],
        portalEventRows.rows as any[],
      );

      res.json({
        investors:          engRows,
        analytics,
        material_engagement: materialEngagement,
        round_id:           roundId ?? null,
        rounds:             rounds.rows,
      });
    } catch (err: any) {
      console.error("[capital] GET /engagement:", err?.message);
      res.status(500).json({ message: "Failed to load engagement analytics" });
    }
  });

  // ── Phase 2I: GET /api/capital/investors/:id/engagement ───────────────────
  // Per-investor engagement score, signals, and timeline.
  app.get("/api/capital/investors/:id/engagement", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      const invRow = await db.execute(sql.raw(
        `SELECT * FROM capital_investors WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`
      ));
      const inv = invRow.rows[0] as any;
      if (!inv) return res.status(404).json({ message: "Investor not found" });

      const [activitiesRow, emailLinksRow, portalAccessRow, portalEventRow,
             matSharesRow, matRequestsRow, commitmentsRow, materialsRow] = await Promise.all([
        db.execute(sql.raw(`
          SELECT * FROM capital_activities
          WHERE entity_type = 'investor' AND entity_id = ${id}
          ORDER BY activity_at DESC LIMIT 200
        `)),
        db.execute(sql.raw(`
          SELECT * FROM capital_email_links
          WHERE capital_investor_id = ${id} AND deleted_at IS NULL
          ORDER BY latest_message_at DESC LIMIT 100
        `)),
        db.execute(sql.raw(`
          SELECT * FROM capital_portal_access
          WHERE investor_id = ${id} AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 50
        `)),
        db.execute(sql.raw(`
          SELECT cpe.*
          FROM capital_portal_events cpe
          JOIN capital_portal_access cpa ON cpa.id = cpe.portal_access_id
          WHERE cpa.investor_id = ${id} AND cpa.deleted_at IS NULL
          ORDER BY cpe.occurred_at DESC LIMIT 500
        `)),
        db.execute(sql.raw(`
          SELECT cms.*, cm.material_type, cm.title AS material_title
          FROM capital_material_shares cms
          LEFT JOIN capital_materials cm ON cm.id = cms.material_id
          WHERE cms.investor_id = ${id} AND cms.deleted_at IS NULL
          ORDER BY cms.shared_at DESC LIMIT 100
        `)),
        db.execute(sql.raw(`
          SELECT * FROM capital_material_requests
          WHERE investor_id = ${id} AND deleted_at IS NULL
          ORDER BY requested_at DESC LIMIT 50
        `)),
        db.execute(sql.raw(`
          SELECT * FROM capital_commitments
          WHERE investor_id = ${id} AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 20
        `)),
        db.execute(sql.raw(`
          SELECT id, title, material_type, status, version_label, deleted_at
          FROM capital_materials WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100
        `)),
      ]);

      const {
        extractEngagementSignals,
        computeEngagementScore,
        buildEngagementTimeline,
      } = await import("./services/capital-engagement.js");

      const signals  = extractEngagementSignals(
        inv,
        activitiesRow.rows as any[],
        emailLinksRow.rows as any[],
        portalAccessRow.rows as any[],
        portalEventRow.rows as any[],
        matSharesRow.rows as any[],
        matRequestsRow.rows as any[],
        commitmentsRow.rows as any[],
        materialsRow.rows as any[],
      );
      const result   = computeEngagementScore(inv, signals);
      const timeline = buildEngagementTimeline(
        inv,
        activitiesRow.rows as any[],
        emailLinksRow.rows as any[],
        portalEventRow.rows as any[],
        matSharesRow.rows as any[],
        commitmentsRow.rows as any[],
        materialsRow.rows as any[],
        50,
      );

      res.json({
        investor_id:   inv.id,
        investor_name: inv.name,
        stage:         inv.stage,
        ...result,
        signals,
        timeline,
      });
    } catch (err: any) {
      console.error("[capital] GET /investors/:id/engagement:", err?.message);
      res.status(500).json({ message: "Failed to load investor engagement" });
    }
  });

  // ── Phase 2J: Capital Reporting Pack ─────────────────────────────────────
  // GET /api/capital/reports — report type metadata + rounds list
  app.get("/api/capital/reports", requireAuth, requireCapitalAccess, async (_req, res) => {
    try {
      const { REPORT_TYPE_META } = await import("./services/capital-reporting.js");
      const roundsRow = await db.execute(sql.raw(`
        SELECT id, name, status FROM capital_rounds
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 20
      `));
      res.json({
        report_types: REPORT_TYPE_META,
        rounds:       roundsRow.rows,
      });
    } catch (err: any) {
      console.error("[capital] GET /reports:", err?.message);
      res.status(500).json({ message: "Failed to load report metadata" });
    }
  });

  // GET /api/capital/reports/:type — generate a report
  // Query params: round_id, include_sensitive, format (json|markdown|csv)
  app.get("/api/capital/reports/:type", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const type = req.params.type as string;
      const VALID_TYPES = ["weekly_brief", "board_update", "cfo_closing", "engagement"];
      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ message: `Unknown report type: ${type}. Must be one of: ${VALID_TYPES.join(", ")}` });
      }

      const roundId         = safeId(req.query.round_id);
      const format          = String(req.query.format || "json");
      const includeSensitive = req.query.include_sensitive === "true";

      // Load round — default to most recent active round if none specified
      let round: any = null;
      if (roundId) {
        const r = await db.execute(sql.raw(`SELECT * FROM capital_rounds WHERE id = ${roundId} AND deleted_at IS NULL LIMIT 1`));
        round = (r.rows as any[])[0] ?? null;
      } else {
        const r = await db.execute(sql.raw(`SELECT * FROM capital_rounds WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`));
        round = (r.rows as any[])[0] ?? null;
      }

      const effectiveRoundId = round?.id ?? null;

      // Load rounds list for context
      const roundsRow = await db.execute(sql.raw(`
        SELECT id, name, status FROM capital_rounds WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20
      `));

      // Load investors
      const invRows = await db.execute(sql.raw(`
        SELECT ci.*
        FROM capital_investors ci
        WHERE ci.deleted_at IS NULL
        ORDER BY ci.priority DESC NULLS LAST, ci.updated_at DESC
        LIMIT 500
      `));
      const investors = invRows.rows as any[];

      if (investors.length === 0 && !round) {
        const { REPORT_TYPE_META, assembleReport } = await import("./services/capital-reporting.js");
        const empty = assembleReport(
          type as any,
          { round: null, rounds: roundsRow.rows as any[], investors: [], commitments: [], contacts: [], activities: [], emailLinks: [], portalAccesses: [], portalEvents: [], materials: [], materialShares: [], materialRequests: [] },
          { round_id: null, date_from: null, date_to: null, include_sensitive: includeSensitive },
        );
        return res.json(empty);
      }

      const invIds = investors.length > 0 ? investors.map((i: any) => i.id) : [0];
      const inList = invIds.join(",");
      const roundFilter = effectiveRoundId ? effectiveRoundId : 0;

      // Fetch all needed data in parallel
      const [
        commitmentsRow,
        contactsRow,
        activitiesRow,
        emailLinksRow,
        portalAccessRow,
        portalEventRow,
        materialsRow,
        matSharesRow,
        matRequestsRow,
      ] = await Promise.all([
        db.execute(sql.raw(`
          SELECT cc.*, ci.name AS investor_name, ci.stage AS investor_stage
          FROM capital_commitments cc
          LEFT JOIN capital_investors ci ON ci.id = cc.investor_id
          WHERE 1=1
            ${effectiveRoundId ? `AND cc.round_id = ${effectiveRoundId}` : ""}
          ORDER BY cc.created_at DESC LIMIT 500
        `)),
        db.execute(sql.raw(`
          SELECT cc.*, ci.name AS investor_name
          FROM capital_contacts cc
          LEFT JOIN capital_investors ci ON ci.id = cc.investor_id
          WHERE 1=1
          ORDER BY cc.influence_level DESC, cc.created_at DESC LIMIT 500
        `)),
        db.execute(sql.raw(`
          SELECT * FROM capital_activities
          WHERE entity_type = 'investor' AND entity_id IN (${inList})
          ORDER BY activity_at DESC LIMIT 1000
        `)),
        db.execute(sql.raw(`
          SELECT * FROM capital_email_links
          WHERE capital_investor_id IN (${inList}) AND deleted_at IS NULL
          ORDER BY latest_message_at DESC LIMIT 500
        `)),
        db.execute(sql.raw(`
          SELECT cpa.*, ci.name AS investor_name,
            (SELECT COUNT(*) FROM capital_portal_materials cpm
             WHERE cpm.portal_access_id = cpa.id AND cpm.deleted_at IS NULL) AS material_count
          FROM capital_portal_access cpa
          LEFT JOIN capital_investors ci ON ci.id = cpa.investor_id
          WHERE cpa.deleted_at IS NULL AND cpa.investor_id IN (${inList})
          ORDER BY cpa.created_at DESC LIMIT 500
        `)),
        db.execute(sql.raw(`
          SELECT cpe.*
          FROM capital_portal_events cpe
          JOIN capital_portal_access cpa ON cpa.id = cpe.portal_access_id
          WHERE cpa.deleted_at IS NULL AND cpa.investor_id IN (${inList})
          ORDER BY cpe.occurred_at DESC LIMIT 2000
        `)),
        db.execute(sql.raw(`
          SELECT cm.*, cr.name AS round_name
          FROM capital_materials cm
          LEFT JOIN capital_rounds cr ON cr.id = cm.round_id
          WHERE cm.deleted_at IS NULL
          ORDER BY cm.updated_at DESC LIMIT 200
        `)),
        db.execute(sql.raw(`
          SELECT cms.*, ci.name AS investor_name, cm.title AS material_title, cm.material_type
          FROM capital_material_shares cms
          LEFT JOIN capital_investors ci ON ci.id = cms.investor_id
          LEFT JOIN capital_materials cm ON cm.id = cms.material_id
          WHERE cms.deleted_at IS NULL
          ORDER BY cms.shared_at DESC LIMIT 500
        `)),
        db.execute(sql.raw(`
          SELECT cmr.*, ci.name AS investor_name
          FROM capital_material_requests cmr
          LEFT JOIN capital_investors ci ON ci.id = cmr.investor_id
          WHERE cmr.deleted_at IS NULL
          ORDER BY cmr.requested_at DESC LIMIT 200
        `)),
      ]);

      const {
        assembleReport,
        reportToMarkdown,
        reportToCsv,
      } = await import("./services/capital-reporting.js");

      const input = {
        round,
        rounds:           roundsRow.rows    as any[],
        investors,
        commitments:      commitmentsRow.rows  as any[],
        contacts:         contactsRow.rows     as any[],
        activities:       activitiesRow.rows   as any[],
        emailLinks:       emailLinksRow.rows   as any[],
        portalAccesses:   portalAccessRow.rows as any[],
        portalEvents:     portalEventRow.rows  as any[],
        materials:        materialsRow.rows    as any[],
        materialShares:   matSharesRow.rows    as any[],
        materialRequests: matRequestsRow.rows  as any[],
      };

      const options = {
        round_id:          effectiveRoundId,
        date_from:         req.query.date_from ? String(req.query.date_from) : null,
        date_to:           req.query.date_to   ? String(req.query.date_to)   : null,
        include_sensitive: includeSensitive,
      };

      const report = assembleReport(type as any, input, options);

      if (format === "markdown") {
        const md = reportToMarkdown(report);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.send(md);
      }

      if (format === "csv") {
        const csvData = reportToCsv(report);
        if (!csvData) {
          return res.status(400).json({ message: `CSV export not available for report type: ${type}` });
        }
        const { toCsv, setCsvHeaders } = await import("./csv-export.js");
        const cols = Object.keys(csvData.rows[0] ?? {}).map(k => ({ key: k, label: k }));
        const csv  = toCsv(csvData.rows, cols);
        setCsvHeaders(res, csvData.filename);
        return res.send(csv);
      }

      res.json(report);
    } catch (err: any) {
      console.error("[capital] GET /reports/:type:", err?.stack ?? err?.message);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // ── Phase 2K: Capital AI Copilot ──────────────────────────────────────────

  // GET /api/capital/copilot/metadata — rounds + investors for selectors
  app.get("/api/capital/copilot/metadata", requireAuth, requireCapitalAccess, async (_req, res) => {
    try {
      const [roundsRow, investorsRow] = await Promise.all([
        db.execute(sql.raw(`SELECT id, name, status FROM capital_rounds WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`)),
        db.execute(sql.raw(`SELECT id, name, pipeline_stage, investor_type FROM capital_investors WHERE deleted_at IS NULL ORDER BY priority DESC NULLS LAST, name ASC LIMIT 200`)),
      ]);
      res.json({ rounds: roundsRow.rows, investors: investorsRow.rows });
    } catch (err: any) {
      console.error("[capital] GET /copilot/metadata:", err?.message);
      res.status(500).json({ message: "Failed to load Copilot metadata" });
    }
  });

  // POST /api/capital/copilot/query — main copilot query
  app.post("/api/capital/copilot/query", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const { VALID_COPILOT_MODES, runCopilotQuery } = await import("./services/capital-copilot.js");
      const { buildCopilotContext } = await import("./services/capital-copilot-context.js");

      const { question, mode, round_id, investor_id, include_sensitive = true } = req.body ?? {};

      if (!question || typeof question !== "string" || !question.trim()) {
        return res.status(400).json({ message: "question is required" });
      }
      if (!mode || !VALID_COPILOT_MODES.includes(mode)) {
        return res.status(400).json({ message: `Invalid mode. Must be one of: ${VALID_COPILOT_MODES.join(", ")}` });
      }

      const safeRoundId    = safeId(round_id);
      const safeInvestorId = safeId(investor_id);

      // Resolve active round
      let round: any = null;
      if (safeRoundId) {
        const r = await db.execute(sql.raw(`SELECT * FROM capital_rounds WHERE id = ${safeRoundId} AND deleted_at IS NULL LIMIT 1`));
        round = (r.rows as any[])[0] ?? null;
      } else {
        const r = await db.execute(sql.raw(`SELECT * FROM capital_rounds WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`));
        round = (r.rows as any[])[0] ?? null;
      }

      const effectiveRoundId = round?.id ?? null;

      // Fetch all capital data needed for context
      const investorFilter = safeInvestorId ? `AND ci.id = ${safeInvestorId}` : "";
      const [
        roundsRow, investorsRow, commitmentsRow, contactsRow, activitiesRow,
        emailLinksRow, portalAccessRow, portalEventRow, materialsRow, matSharesRow, matRequestsRow,
      ] = await Promise.all([
        db.execute(sql.raw(`SELECT id, name, status FROM capital_rounds WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`)),
        db.execute(sql.raw(`SELECT * FROM capital_investors ci WHERE ci.deleted_at IS NULL ${investorFilter} ORDER BY ci.priority DESC NULLS LAST LIMIT 500`)),
        db.execute(sql.raw(`SELECT cc.*, cr.name AS round_name FROM capital_commitments cc LEFT JOIN capital_rounds cr ON cr.id = cc.round_id WHERE 1=1 ${effectiveRoundId ? `AND cc.round_id = ${effectiveRoundId}` : ""} LIMIT 500`)),
        db.execute(sql.raw(`SELECT cc.* FROM capital_contacts cc WHERE 1=1 ${safeInvestorId ? `AND cc.investor_id = ${safeInvestorId}` : ""} LIMIT 300`)),
        db.execute(sql.raw(`SELECT * FROM capital_activities WHERE entity_type = 'investor' ${safeInvestorId ? `AND entity_id = ${safeInvestorId}` : ""} ORDER BY activity_at DESC LIMIT 500`)),
        db.execute(sql.raw(`SELECT * FROM capital_email_links WHERE deleted_at IS NULL ${safeInvestorId ? `AND capital_investor_id = ${safeInvestorId}` : ""} ORDER BY latest_message_at DESC LIMIT 300`)),
        db.execute(sql.raw(`SELECT cpa.*, ci.name AS investor_name FROM capital_portal_access cpa LEFT JOIN capital_investors ci ON ci.id = cpa.investor_id WHERE cpa.deleted_at IS NULL ${safeInvestorId ? `AND cpa.investor_id = ${safeInvestorId}` : ""} LIMIT 200`)),
        db.execute(sql.raw(`SELECT cpe.* FROM capital_portal_events cpe JOIN capital_portal_access cpa ON cpa.id = cpe.portal_access_id WHERE cpa.deleted_at IS NULL ${safeInvestorId ? `AND cpa.investor_id = ${safeInvestorId}` : ""} ORDER BY cpe.occurred_at DESC LIMIT 1000`)),
        db.execute(sql.raw(`SELECT cm.* FROM capital_materials cm WHERE cm.deleted_at IS NULL ORDER BY cm.updated_at DESC LIMIT 200`)),
        db.execute(sql.raw(`SELECT cms.*, ci.name AS investor_name, cm.title AS material_title, cm.material_type FROM capital_material_shares cms LEFT JOIN capital_investors ci ON ci.id = cms.investor_id LEFT JOIN capital_materials cm ON cm.id = cms.material_id WHERE cms.deleted_at IS NULL ${safeInvestorId ? `AND cms.investor_id = ${safeInvestorId}` : ""} ORDER BY cms.shared_at DESC LIMIT 300`)),
        db.execute(sql.raw(`SELECT cmr.*, ci.name AS investor_name FROM capital_material_requests cmr LEFT JOIN capital_investors ci ON ci.id = cmr.investor_id WHERE cmr.deleted_at IS NULL LIMIT 200`)),
      ]);

      const rawInput = {
        round,
        rounds:           roundsRow.rows       as any[],
        investors:        investorsRow.rows     as any[],
        commitments:      commitmentsRow.rows   as any[],
        contacts:         contactsRow.rows      as any[],
        activities:       activitiesRow.rows    as any[],
        emailLinks:       emailLinksRow.rows    as any[],
        portalAccesses:   portalAccessRow.rows  as any[],
        portalEvents:     portalEventRow.rows   as any[],
        materials:        materialsRow.rows     as any[],
        materialShares:   matSharesRow.rows     as any[],
        materialRequests: matRequestsRow.rows   as any[],
      };

      const context = buildCopilotContext(rawInput, {
        investor_id:      safeInvestorId,
        round_id:         effectiveRoundId,
        include_sensitive: Boolean(include_sensitive),
        mode,
      });

      const response = await runCopilotQuery(
        question.trim(),
        context.text,
        context.source_labels,
        mode,
        Boolean(include_sensitive),
        safeInvestorId,
        effectiveRoundId,
      );

      res.json({
        answer:              response.answer,
        context_used:        response.context_used,
        recommended_actions: response.recommended_actions,
        draft_output:        response.draft_output,
        warnings:            [...(context.warnings ?? []), ...(response.warnings ?? [])],
        generated_at:        response.generated_at,
      });
    } catch (err: any) {
      console.error("[capital] POST /copilot/query:", err?.stack ?? err?.message);
      res.status(500).json({ message: "Copilot query failed" });
    }
  });

  // ── Investor Updates ──────────────────────────────────────────────────────
  app.get("/api/capital/investor-updates", requireAuth, requireCapitalAccess, async (_req, res) => {
    try {
      const rows = await db.execute(sql.raw(
        `SELECT * FROM capital_investor_updates ORDER BY created_at DESC`
      ));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("[capital] GET /investor-updates:", err?.message);
      res.status(500).json({ message: "Failed to fetch investor updates" });
    }
  });

  app.post("/api/capital/investor-updates", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const { title, update_type, subject, body, status, tags, scheduled_at, sent_at } = req.body;
      if (!title?.trim()) return res.status(400).json({ message: "title is required" });
      const tagsArr = typeof tags === "string"
        ? tags.split(",").map((t: string) => t.trim()).filter(Boolean)
        : (Array.isArray(tags) ? tags : []);
      // Build a PostgreSQL array literal string e.g. {"q2","fundraising"} — avoids JS-array serialisation issues with sql.raw()
      const tagsParam = tagsArr.length > 0
        ? `{${tagsArr.map((t: string) => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`
        : null;
      const rows = await db.execute(sql.raw(
        `INSERT INTO capital_investor_updates
           (title, update_type, subject, body, status, tags, scheduled_at, sent_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9)
         RETURNING *`,
        [
          title.trim(),
          update_type ?? "Monthly Update",
          subject?.trim() || null,
          body?.trim() || null,
          status ?? "draft",
          tagsParam,
          scheduled_at || null,
          sent_at || null,
          req.user?.id ?? null,
        ]
      ));
      res.json(rows.rows[0]);
    } catch (err: any) {
      console.error("[capital] POST /investor-updates:", err?.message);
      res.status(500).json({ message: "Failed to create investor update" });
    }
  });

  app.patch("/api/capital/investor-updates/:id", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ message: "invalid id" });
      const { title, update_type, subject, body, status, tags, scheduled_at, sent_at } = req.body;
      const tagsArr = typeof tags === "string"
        ? tags.split(",").map((t: string) => t.trim()).filter(Boolean)
        : (Array.isArray(tags) ? tags : []);
      const tagsParam = tagsArr.length > 0
        ? `{${tagsArr.map((t: string) => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`
        : null;
      const rows = await db.execute(sql.raw(
        `UPDATE capital_investor_updates SET
           title        = COALESCE($2, title),
           update_type  = COALESCE($3, update_type),
           subject      = $4,
           body         = $5,
           status       = COALESCE($6, status),
           tags         = $7::text[],
           scheduled_at = $8,
           sent_at      = $9,
           updated_at   = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          title?.trim() || null,
          update_type || null,
          subject?.trim() || null,
          body?.trim() || null,
          status || null,
          tagsParam,
          scheduled_at || null,
          sent_at || null,
        ]
      ));
      if (!rows.rows.length) return res.status(404).json({ message: "not found" });
      res.json(rows.rows[0]);
    } catch (err: any) {
      console.error("[capital] PATCH /investor-updates/:id:", err?.message);
      res.status(500).json({ message: "Failed to update investor update" });
    }
  });

  app.delete("/api/capital/investor-updates/:id", requireAuth, requireCapitalAccess, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ message: "invalid id" });
      await db.execute(sql.raw(`DELETE FROM capital_investor_updates WHERE id = $1`, [id]));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[capital] DELETE /investor-updates/:id:", err?.message);
      res.status(500).json({ message: "Failed to delete investor update" });
    }
  });
}
