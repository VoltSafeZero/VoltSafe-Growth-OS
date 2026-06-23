-- Migration: 0017_crm_intelligence_context
-- Creates the crm_intelligence_context table for the rolling CRM context system.
-- Safe to run multiple times (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "crm_intelligence_context" (
  "id"                     SERIAL PRIMARY KEY,
  "record_type"            TEXT NOT NULL,
  "record_id"              INTEGER NOT NULL,
  "record_name"            TEXT NOT NULL DEFAULT '',
  "durable_summary"        TEXT NOT NULL DEFAULT '',
  "key_facts"              JSONB NOT NULL DEFAULT '[]'::jsonb,
  "key_people"             JSONB NOT NULL DEFAULT '[]'::jsonb,
  "open_loops"             JSONB NOT NULL DEFAULT '[]'::jsonb,
  "objections"             JSONB NOT NULL DEFAULT '[]'::jsonb,
  "buying_signals"         JSONB NOT NULL DEFAULT '[]'::jsonb,
  "risks"                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  "opportunities"          JSONB NOT NULL DEFAULT '[]'::jsonb,
  "commitments"            JSONB NOT NULL DEFAULT '[]'::jsonb,
  "next_steps"             JSONB NOT NULL DEFAULT '[]'::jsonb,
  "recent_activity_digest" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "last_context_build_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "source_coverage"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "crm_intelligence_context_record_type_record_id_key" UNIQUE ("record_type", "record_id")
);
