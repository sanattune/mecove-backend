import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}
const parsed = new URL(connectionString);
const isRds = parsed.hostname.endsWith(".rds.amazonaws.com");
const sslMode = (parsed.searchParams.get("sslmode") ?? "").toLowerCase();
const needsTls = sslMode !== "" && sslMode !== "disable";
const adapter = new PrismaPg(
  needsTls && isRds ? { connectionString, ssl: { rejectUnauthorized: false } } : { connectionString }
);
const prisma = new PrismaClient({ adapter });

async function main() {
  const user =
    (await prisma.user.findFirst()) ??
    (await prisma.user.create({
      data: {},
    }));

  const channel = "whatsapp";
  const channelUserKey = "+10000000000";

  const identity = await prisma.identity.upsert({
    where: {
      channel_channelUserKey: {
        channel,
        channelUserKey,
      },
    },
    update: {},
    create: {
      userId: user.id,
      channel,
      channelUserKey,
    },
  });

  const sourceMessageId = "test-msg-1";

  await prisma.message.upsert({
    where: {
      identityId_sourceMessageId: {
        identityId: identity.id,
        sourceMessageId,
      },
    },
    update: {},
    create: {
      userId: user.id,
      identityId: identity.id,
      contentType: "text",
      text: "hello mecove",
      rawPayload: { test: true },
      sourceMessageId,
    },
  });

  const latestMessage = await prisma.message.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  console.log(latestMessage);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
