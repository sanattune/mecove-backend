-- AlterTable
ALTER TABLE "User" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- CreateTable
CREATE TABLE "UserReminder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "time" TEXT NOT NULL,
    "frequencyType" TEXT NOT NULL,
    "intervalDays" INTEGER,
    "nextFireAt" TIMESTAMP(3) NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserReminder_nextFireAt_isActive_idx" ON "UserReminder"("nextFireAt", "isActive");

-- CreateIndex
CREATE INDEX "UserReminder_userId_idx" ON "UserReminder"("userId");

-- AddForeignKey
ALTER TABLE "UserReminder" ADD CONSTRAINT "UserReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
