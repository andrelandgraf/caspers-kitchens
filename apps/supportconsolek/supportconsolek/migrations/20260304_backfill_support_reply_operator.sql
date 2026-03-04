-- One-time backfill before enforcing NOT NULL on support.support_replies.sent_by.
-- Scope: only rows missing operator attribution.
UPDATE support.support_replies
SET sent_by = 'Andre Landgraf'
WHERE sent_by IS NULL OR btrim(sent_by) = '';
