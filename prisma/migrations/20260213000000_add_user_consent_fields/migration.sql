-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "privacyAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "privacyAcceptedVersion" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedVersion" TEXT,
ADD COLUMN     "mvpAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "mvpAcceptedVersion" TEXT;
