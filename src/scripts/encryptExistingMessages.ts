/**
 * One-time migration script: encrypt all existing plaintext messages.
 *
 * Usage:
 *   npx tsx src/scripts/encryptExistingMessages.ts
 *
 * Prerequisites:
 *   - ENCRYPTION_MASTER_KEY set in .env
 *   - pnpm prisma migrate deploy (to add User.encryptedDek and change rawPayload type)
 */
import "dotenv/config";
import { prisma } from "../infra/prisma";
import { encryptText } from "../infra/encryption";
import { getOrCreateUserDek } from "../infra/userDek";

const BATCH_SIZE = 100;
const ENCRYPTED_PREFIX = "enc:v1:";

async function main() {
  console.log("Starting encryption migration…");

  const users = await prisma.user.findMany({
    where: {
      messages: { some: {} },
    },
    select: { id: true },
  });
  console.log(`Found ${users.length} users with messages.`);

  let totalUpdated = 0;

  for (const { id: userId } of users) {
    const dek = await getOrCreateUserDek(userId);

    // Fetch all messages that are not yet encrypted
    let offset = 0;
    let batchCount = 0;

    while (true) {
      const messages = await prisma.message.findMany({
        where: {
          userId,
          OR: [
            { text: { not: null } },
            { rawPayload: { not: null } },
            { replyText: { not: null } },
          ],
        },
        select: { id: true, text: true, rawPayload: true, replyText: true },
        skip: offset,
        take: BATCH_SIZE,
      });

      if (messages.length === 0) break;
      offset += messages.length;

      const toUpdate = messages.filter((m) => {
        const textNeedsEncrypt = m.text != null && !m.text.startsWith(ENCRYPTED_PREFIX);
        const rawNeedsEncrypt =
          m.rawPayload != null && !m.rawPayload.startsWith(ENCRYPTED_PREFIX);
        const replyNeedsEncrypt =
          m.replyText != null && !m.replyText.startsWith(ENCRYPTED_PREFIX);
        return textNeedsEncrypt || rawNeedsEncrypt || replyNeedsEncrypt;
      });

      for (const m of toUpdate) {
        const data: {
          text?: string;
          rawPayload?: string;
          replyText?: string;
        } = {};

        if (m.text != null && !m.text.startsWith(ENCRYPTED_PREFIX)) {
          data.text = encryptText(m.text, dek);
        }
        if (m.rawPayload != null && !m.rawPayload.startsWith(ENCRYPTED_PREFIX)) {
          data.rawPayload = encryptText(m.rawPayload, dek);
        }
        if (m.replyText != null && !m.replyText.startsWith(ENCRYPTED_PREFIX)) {
          data.replyText = encryptText(m.replyText, dek);
        }

        await prisma.message.update({ where: { id: m.id }, data });
        batchCount++;
      }
    }

    console.log(`  User ${userId}: encrypted ${batchCount} messages.`);
    totalUpdated += batchCount;
  }

  console.log(`Done. Total messages encrypted: ${totalUpdated}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
