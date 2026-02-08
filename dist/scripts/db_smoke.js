"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("DATABASE_URL is required");
}
const adapter = new adapter_pg_1.PrismaPg({ connectionString });
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    const user = (await prisma.user.findFirst()) ??
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
