-- Phase 11: Campaign automation_mode (manual / assisted / full)
-- Assisted = prepares queue but requires human approval before sending
ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS automation_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (automation_mode IN ('manual', 'assisted', 'full'));

-- pending_approval_count: how many sends are queued waiting for approval
ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS pending_approval_count INTEGER NOT NULL DEFAULT 0;
