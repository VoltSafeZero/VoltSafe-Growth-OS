-- Migration 0036: Potential Investor Tags
-- Creates the potential_investor_tags table for tracking investor interest
-- across leads, accounts, and contacts.
-- This migration is promoted from the server/index.ts startup migration.
-- Idempotent: CREATE TABLE IF NOT EXISTS is safe to run multiple times.

CREATE TABLE IF NOT EXISTS potential_investor_tags (
  id                SERIAL PRIMARY KEY,
  record_type       TEXT NOT NULL CHECK (record_type IN ('lead', 'account', 'contact')),
  record_id         INTEGER NOT NULL,
  tagged_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tagged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_thread_id  TEXT,
  source_message_id TEXT,
  UNIQUE (record_type, record_id)
);
