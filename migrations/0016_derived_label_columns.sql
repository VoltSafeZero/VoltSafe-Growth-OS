-- Phase 1: Derived label columns
-- These are read-time projections computed from label_ids.
-- label_ids is NEVER modified by this migration.
-- All columns are nullable so existing rows accept NULL until the backfill runs.

-- ── 1. Add columns ────────────────────────────────────────────────────────────
ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS is_inbox      boolean,
  ADD COLUMN IF NOT EXISTS is_unread     boolean,
  ADD COLUMN IF NOT EXISTS is_starred    boolean,
  ADD COLUMN IF NOT EXISTS is_spam       boolean,
  ADD COLUMN IF NOT EXISTS is_trash      boolean,
  ADD COLUMN IF NOT EXISTS is_draft      boolean,
  ADD COLUMN IF NOT EXISTS is_sent       boolean,
  ADD COLUMN IF NOT EXISTS smart_category text;

-- ── 2. Backfill all existing rows ─────────────────────────────────────────────
--
-- VoltSafe Canonical Inbox Membership (INBOX_INCLUDES_CATEGORY_SKIP = true):
--   (INBOX OR CATEGORY_PERSONAL OR CATEGORY_UPDATES OR CATEGORY_PROMOTIONS
--    OR CATEGORY_SOCIAL OR CATEGORY_FORUMS)
--   AND NOT SPAM AND NOT TRASH AND NOT DRAFT
--   NOTE: AND NOT SENT is intentionally absent — SENT+INBOX and SENT+CATEGORY_*
--   messages must remain inbox-visible (they are self-sent or BCC'd threads).
--   SENT-only messages are excluded naturally by lacking any inbox-member label.
--
-- smart_category mapping:
--   CATEGORY_UPDATES    → 'updates'
--   CATEGORY_PROMOTIONS → 'promotions'
--   CATEGORY_SOCIAL     → 'social'
--   CATEGORY_FORUMS     → 'forums'
--   CATEGORY_PERSONAL   → 'people'  (falls through to ELSE)
--   (no CATEGORY_*)     → 'people'  (falls through to ELSE)

UPDATE email_messages SET
  is_unread  = (label_ids LIKE '%"UNREAD"%'),
  is_starred = (label_ids LIKE '%"STARRED"%'),
  is_spam    = (label_ids LIKE '%"SPAM"%'),
  is_trash   = (label_ids LIKE '%"TRASH"%'),
  is_draft   = (label_ids LIKE '%"DRAFT"%'),
  is_sent    = (label_ids LIKE '%"SENT"%'),
  is_inbox   = (
    (  label_ids LIKE '%"INBOX"%'
    OR label_ids ILIKE '%CATEGORY_PERSONAL%'
    OR label_ids ILIKE '%CATEGORY_UPDATES%'
    OR label_ids ILIKE '%CATEGORY_PROMOTIONS%'
    OR label_ids ILIKE '%CATEGORY_SOCIAL%'
    OR label_ids ILIKE '%CATEGORY_FORUMS%')
    AND label_ids NOT LIKE '%"SPAM"%'
    AND label_ids NOT LIKE '%"TRASH"%'
    AND label_ids NOT LIKE '%"DRAFT"%'
    -- NOTE: AND NOT SENT intentionally absent — SENT+INBOX must remain visible
  ),
  smart_category = CASE
    WHEN label_ids ILIKE '%CATEGORY_UPDATES%'    THEN 'updates'
    WHEN label_ids ILIKE '%CATEGORY_PROMOTIONS%' THEN 'promotions'
    WHEN label_ids ILIKE '%CATEGORY_SOCIAL%'     THEN 'social'
    WHEN label_ids ILIKE '%CATEGORY_FORUMS%'     THEN 'forums'
    ELSE 'people'
  END;

-- ── 3. Partial indexes (small, fast — only index inbox-visible rows) ──────────
CREATE INDEX IF NOT EXISTS idx_email_is_inbox
  ON email_messages (source_account_id, sent_at DESC)
  WHERE is_inbox = true;

CREATE INDEX IF NOT EXISTS idx_email_is_inbox_unread
  ON email_messages (source_account_id, sent_at DESC)
  WHERE is_inbox = true AND is_unread = true;

CREATE INDEX IF NOT EXISTS idx_email_smart_category
  ON email_messages (smart_category, source_account_id, sent_at DESC)
  WHERE is_inbox = true;
