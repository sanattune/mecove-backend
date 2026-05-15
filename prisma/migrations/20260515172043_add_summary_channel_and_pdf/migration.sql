-- AlterTable
ALTER TABLE "Summary" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'whatsapp',
ADD COLUMN     "pdfBytes" BYTEA;

-- AlterTable
ALTER TABLE "UserSettings" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;
