-- Migration: 0018_crm_email_identifiers
-- Adds authoritative CRM email identifier tables for domain and address-level linking.
-- crm_email_domains: unique verified business domains per CRM entity
-- crm_email_addresses: specific verified email addresses per CRM entity
-- Public/free domains (gmail.com, etc.) are blocked at the application layer.
-- Safe to run multiple times (IF NOT EXISTS patterns).

CREATE TABLE IF NOT EXISTS "crm_email_domains" (
  "id"          SERIAL PRIMARY KEY,
  "entity_type" TEXT NOT NULL CHECK (entity_type IN ('lead', 'account', 'contact')),
  "entity_id"   INTEGER NOT NULL,
  "domain"      TEXT NOT NULL,
  "label"       TEXT,
  "is_verified" BOOLEAN NOT NULL DEFAULT TRUE,
  "source"      TEXT NOT NULL DEFAULT 'manual',
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_by"  INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_email_domains_domain_unique"
  ON "crm_email_domains" ("domain");

CREATE INDEX IF NOT EXISTS "crm_email_domains_entity_idx"
  ON "crm_email_domains" ("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "crm_email_addresses" (
  "id"          SERIAL PRIMARY KEY,
  "entity_type" TEXT NOT NULL CHECK (entity_type IN ('lead', 'account', 'contact')),
  "entity_id"   INTEGER NOT NULL,
  "email"       TEXT NOT NULL,
  "label"       TEXT,
  "is_verified" BOOLEAN NOT NULL DEFAULT TRUE,
  "source"      TEXT NOT NULL DEFAULT 'manual',
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_by"  INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_email_addresses_email_unique"
  ON "crm_email_addresses" ("email");

CREATE INDEX IF NOT EXISTS "crm_email_addresses_entity_idx"
  ON "crm_email_addresses" ("entity_type", "entity_id");
