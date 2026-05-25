import "dotenv/config";
import { prisma } from "../infra/prisma";
import { signAccessToken } from "../api/rest/middleware/auth";

function readPhoneNumber(): string {
  const phoneNumber = process.argv[2]?.trim();
  if (!phoneNumber || !/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
    throw new Error("Usage: pnpm auth:jwt +919876543210");
  }
  return phoneNumber;
}

async function findUserId(phoneNumber: string): Promise<string> {
  const identity = await prisma.identity.findFirst({
    where: { channelUserKey: phoneNumber },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });

  if (identity) return identity.userId;

  throw new Error(`No user identity found for ${phoneNumber}`);
}

async function main(): Promise<void> {
  const phoneNumber = readPhoneNumber();
  const userId = await findUserId(phoneNumber);
  const accessToken = signAccessToken(userId);
  console.log(accessToken);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
