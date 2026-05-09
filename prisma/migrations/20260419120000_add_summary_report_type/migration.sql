-- Add reportType column to Summary to distinguish between the SessionBridge
-- activity report and the "Myself, Lately" mirror report.
ALTER TABLE "Summary" ADD COLUMN "reportType" TEXT NOT NULL DEFAULT 'sessionbridge';
