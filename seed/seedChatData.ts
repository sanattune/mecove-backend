/**
 * Seed chat data script
 *
 * Usage:
 *   tsx seed/seedChatData.ts [file-path] --phone <phone> [--clear]
 *
 * Arguments:
 *   file-path    Path to JSON file (default: seed/chat-data/chat1.json)
 *   --phone, -p  WhatsApp phone number used to find or create the target user
 *   --clear, -c  Clear existing messages for the user before inserting
 *
 * Example:
 *   tsx seed/seedChatData.ts --phone +919876543210
 *   tsx seed/seedChatData.ts seed/chat-data/chat1.json --phone +919876543210 --clear
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { encryptText } from "../src/infra/encryption";
import { prisma } from "../src/infra/prisma";
import { getOrCreateUserDek } from "../src/infra/userDek";

export interface ChatMessage {
  index: number;
  u: string;
  r: string;
}

export interface ChatDay {
  day: number;
  chat?: ChatMessage[];
}

const CHANNEL = "whatsapp";

function normalizeChannelUserKey(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, "");
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function parseArgs(): { filePath: string; phone: string; clear: boolean } {
  const args = process.argv.slice(2);
  let filePath = "";
  let phone = "";
  let clear = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--clear" || args[i] === "-c") {
      clear = true;
    } else if (args[i] === "--phone" || args[i] === "-p") {
      phone = args[++i] || "";
    } else if (!filePath && !args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    // Default to seed/chat-data/chat1.json relative to project root
    filePath = join(process.cwd(), "seed", "chat-data", "chat1.json");
  }

  if (!phone.trim()) {
    throw new Error("Missing required --phone <phone> argument");
  }

  return { filePath, phone: normalizeChannelUserKey(phone), clear };
}

async function findOrCreateUserByPhone(phone: string): Promise<{ userId: string; identityId: string }> {
  let identity = await prisma.identity.findUnique({
    where: {
      channel_channelUserKey: {
        channel: CHANNEL,
        channelUserKey: phone,
      },
    },
    include: { user: true },
  });

  if (!identity) {
    const user = await prisma.user.create({ data: {} });
    identity = await prisma.identity.create({
      data: {
        userId: user.id,
        channel: CHANNEL,
        channelUserKey: phone,
      },
      include: { user: true },
    });
    console.log(`Created user ${user.id} with WhatsApp identity for ${phone}`);
  } else {
    console.log(`Found existing user ${identity.userId} for ${phone}`);
  }

  return { userId: identity.userId, identityId: identity.id };
}

async function clearExistingData(userId: string): Promise<void> {
  console.log(`Clearing existing messages for user: ${userId}`);
  const deleted = await prisma.message.deleteMany({
    where: { userId },
  });
  console.log(`Deleted ${deleted.count} messages`);
}

function calculateDateForDay(day: number, baseDate: Date): Date {
  const daysToAdd = day - 1; // day 1 is baseDate, day 2 is baseDate + 1 day, etc.
  const date = new Date(baseDate);
  date.setDate(date.getDate() + daysToAdd);
  return date;
}

function distributeMessagesAcrossDay(
  messages: ChatMessage[],
  dayDate: Date
): Array<{ message: ChatMessage; timestamp: Date }> {
  const distributed: Array<{ message: ChatMessage; timestamp: Date }> = [];
  
  // Distribute messages throughout the day
  // Start at 9 AM and space them out evenly across ~15 hours
  const startHour = 9;
  const totalMinutes = 15 * 60; // 15 hours in minutes
  const minutesPerMessage = messages.length > 1 ? Math.floor(totalMinutes / (messages.length - 1)) : 0;
  
  messages.forEach((msg, idx) => {
    const timestamp = new Date(dayDate);
    const minutesOffset = idx * minutesPerMessage;
    const hours = startHour + Math.floor(minutesOffset / 60);
    const minutes = minutesOffset % 60;
    timestamp.setHours(hours, minutes, 0, 0);
    
    distributed.push({
      message: msg,
      timestamp,
    });
  });

  return distributed;
}

async function insertMessages(
  data: ChatDay[],
  userId: string,
  identityId: string
): Promise<void> {
  const dek = await getOrCreateUserDek(userId);
  const today = new Date();
  const day1Date = new Date(today);
  day1Date.setDate(day1Date.getDate() - 15); // Day 1 is 15 days ago
  day1Date.setHours(9, 0, 0, 0); // Start at 9 AM

  let totalMessages = 0;

  for (const dayData of data) {
    if (!dayData.chat || dayData.chat.length === 0) {
      continue; // Skip blank days
    }

    const dayDate = calculateDateForDay(dayData.day, day1Date);
    const distributed = distributeMessagesAcrossDay(dayData.chat, dayDate);

    for (const { message, timestamp } of distributed) {
      // Insert user message with reply info
      const userSourceId = `seed-msg-${dayData.day}-${message.index}`;
      const replyText = message.r && message.r.trim() ? message.r.trim() : null;
      const encryptedText = encryptText(message.u, dek);
      const encryptedReplyText = replyText ? encryptText(replyText, dek) : null;
      const replyTimestamp = replyText
        ? new Date(timestamp.getTime() + 60000) // Reply 1 minute after
        : null;

      await prisma.message.upsert({
        where: {
          identityId_sourceMessageId: {
            identityId,
            sourceMessageId: userSourceId,
          },
        },
        update: {
          text: encryptedText,
          createdAt: timestamp,
          clientTimestamp: timestamp,
          repliedAt: replyTimestamp,
          replyText: encryptedReplyText,
          category: "user_message",
        },
        create: {
          userId,
          identityId,
          contentType: "text",
          text: encryptedText,
          sourceMessageId: userSourceId,
          createdAt: timestamp,
          clientTimestamp: timestamp,
          repliedAt: replyTimestamp,
          replyText: encryptedReplyText,
          category: "user_message",
        },
      });

      totalMessages++;
    }
  }

  console.log(`Inserted ${totalMessages} messages`);
}

export async function seedFromFile(
  filePath: string,
  userId: string,
  identityId: string,
  clear: boolean
): Promise<void> {
  console.log(`Reading chat data from: ${filePath}`);
  const fileContent = readFileSync(filePath, "utf-8");
  const data: ChatDay[] = JSON.parse(fileContent);

  if (clear) {
    await clearExistingData(userId);
  }

  await insertMessages(data, userId, identityId);
  console.log("Seed data insertion complete!");
}

async function main() {
  const { filePath, phone, clear } = parseArgs();

  console.log(`Reading chat data from: ${filePath}`);
  console.log(`Phone: ${phone}`);
  console.log(`Clear existing data: ${clear}`);

  const fileContent = readFileSync(filePath, "utf-8");
  const data: ChatDay[] = JSON.parse(fileContent);

  const { userId, identityId } = await findOrCreateUserByPhone(phone);

  if (clear) {
    await clearExistingData(userId);
  }

  await insertMessages(data, userId, identityId);

  console.log("Seed data insertion complete!");
}

// Only run main() when this file is the direct entry point (not imported)
if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Error:", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
