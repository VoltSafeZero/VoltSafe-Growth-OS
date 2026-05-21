-- Add user_id (which Gmail account to send from) and sent_message_id (returned by Gmail on success)
-- to scheduled_emails. Both are nullable for backwards compatibility with existing rows.
ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS user_id integer;
ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS sent_message_id text;
