-- Enforce operator attribution for all future support replies.
ALTER TABLE support.support_replies
ALTER COLUMN sent_by SET NOT NULL;
