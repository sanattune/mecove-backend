-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "repliedAt" TIMESTAMP(3),
ADD COLUMN     "replyText" TEXT;

-- CreateIndex
CREATE INDEX "Message_userId_repliedAt_idx" ON "Message"("userId", "repliedAt");
