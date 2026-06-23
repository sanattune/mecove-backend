-- Rename Summary -> Insight (clean recreate; existing report data is disposable
-- per ADR-0004: WhatsApp is beta, losing generated reports is acceptable).
-- reportType -> insightType, summaryText -> insightText.

-- DropForeignKey
ALTER TABLE "Summary" DROP CONSTRAINT "Summary_userId_fkey";

-- DropTable
DROP TABLE "Summary";

-- CreateTable
CREATE TABLE "Insight" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "insightText" TEXT,
    "pdfBytes" BYTEA,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "inputMessagesCount" INTEGER NOT NULL DEFAULT 0,
    "inputHash" TEXT,
    "error" TEXT,
    "insightType" TEXT NOT NULL DEFAULT 'sessionbridge',

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Insight_userId_rangeStart_rangeEnd_idx" ON "Insight"("userId", "rangeStart", "rangeEnd");

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
