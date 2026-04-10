-- CreateTable
CREATE TABLE "UserSettings" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "userId"       UUID         NOT NULL,
    "timezone"     TEXT         NOT NULL DEFAULT 'Asia/Kolkata',
    "lastNudgedAt" TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: create UserSettings for all existing users, copying their timezone
INSERT INTO "UserSettings" ("id", "userId", "timezone", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", "timezone", NOW(), NOW()
FROM "User";

-- DropColumn
ALTER TABLE "User" DROP COLUMN "timezone";
