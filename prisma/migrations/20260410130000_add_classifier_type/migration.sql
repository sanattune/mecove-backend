-- Add classifierType column to Message
ALTER TABLE "Message" ADD COLUMN "classifierType" TEXT;

-- Backfill: treat all existing user_message entries as journal_entry
UPDATE "Message" SET "classifierType" = 'journal_entry' WHERE "category" = 'user_message';
