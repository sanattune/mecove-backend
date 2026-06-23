-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isProfessional" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProfessionalProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "professionalType" TEXT NOT NULL,
    "additionalTitle" TEXT,
    "displayName" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "clientUserId" UUID,
    "inviteePhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "autoSendSessionBridge" BOOLEAN NOT NULL DEFAULT false,
    "acceptedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightShare" (
    "id" UUID NOT NULL,
    "engagementId" UUID NOT NULL,
    "insightId" UUID NOT NULL,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "autoSent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InsightShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalProfile_userId_idx" ON "ProfessionalProfile"("userId");

-- CreateIndex
CREATE INDEX "Engagement_professionalId_idx" ON "Engagement"("professionalId");

-- CreateIndex
CREATE INDEX "Engagement_clientUserId_idx" ON "Engagement"("clientUserId");

-- CreateIndex
CREATE INDEX "Engagement_inviteePhone_idx" ON "Engagement"("inviteePhone");

-- CreateIndex
CREATE INDEX "Engagement_status_idx" ON "Engagement"("status");

-- CreateIndex
CREATE INDEX "InsightShare_insightId_idx" ON "InsightShare"("insightId");

-- CreateIndex
CREATE UNIQUE INDEX "InsightShare_engagementId_insightId_key" ON "InsightShare"("engagementId", "insightId");

-- AddForeignKey
ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightShare" ADD CONSTRAINT "InsightShare_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightShare" ADD CONSTRAINT "InsightShare_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "Insight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Partial-unique (D24): at most one ACTIVE engagement per (professional, client).
-- Pending/ended rows are unconstrained; NULL clientUserId (pending invites) excluded.
CREATE UNIQUE INDEX "Engagement_active_professional_client_key"
  ON "Engagement" ("professionalId", "clientUserId")
  WHERE "status" = 'active';
