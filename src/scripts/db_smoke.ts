import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function buildConnectionString(): string {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const host = process.env.DB_HOST?.trim();
  const port = process.env.DB_PORT?.trim() || "5432";
  const dbName = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD?.trim();
  const sslMode = process.env.DB_SSLMODE?.trim() || (host?.includes(".rds.amazonaws.com") ? "require" : "disable");
  const useLibpqCompat = process.env.DB_USELIBPQCOMPAT?.trim() || (sslMode === "require" ? "true" : "");
  if (!host || !dbName || !user || !password) throw new Error("DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME required");
  const params = new URLSearchParams();
  if (sslMode && sslMode !== "disable") params.set("sslmode", sslMode);
  if (useLibpqCompat) params.set("uselibpqcompat", useLibpqCompat);
  const q = params.toString();
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(dbName)}${q ? `?${q}` : ""}`;
}

const connectionString = buildConnectionString();
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
      rawPayload: JSON.stringify({ test: true }),
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
