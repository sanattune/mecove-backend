/**
 * Seed chat data script
 * 
 * Usage:
 *   tsx seed/seedChatData.ts [file-path] [--user <userId>] [--clear]
 * 
 * Arguments:
 *   file-path    Path to JSON file (default: seed/chat-data/chat1.json)
 *   --user, -u   User ID (default: ca1a1c7f-ea3a-4681-afe1-db833f5d5d23)
 *   --clear, -c  Clear existing messages for the user before inserting
 * 
 * Example:
 *   tsx seed/seedChatData.ts
 *   tsx seed/seedChatData.ts seed/chat-data/chat1.json --user abc123 --clear
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../src/infra/prisma";

interface ChatMessage {
  index: number;
  u: string;
  r: string;
}

interface ChatDay {
  day: number;
  chat?: ChatMessage[];
}

const DEFAULT_USER_ID = "ca1a1c7f-ea3a-4681-afe1-db833f5d5d23";
const CHANNEL = "seed";
const CHANNEL_USER_KEY = "seed-user-1";

function parseArgs(): { filePath: string; userId: string; clear: boolean } {
  const args = process.argv.slice(2);
  let filePath = "";
  let userId = DEFAULT_USER_ID;
  let clear = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--clear" || args[i] === "-c") {
      clear = true;
    } else if (args[i] === "--user" || args[i] === "-u") {
      userId = args[++i];
    } else if (!filePath && !args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    // Default to seed/chat-data/chat1.json relative to project root
    filePath = join(process.cwd(), "seed", "chat-data", "chat1.json");
  }

  return { filePath, userId, clear };
}

async function ensureUserAndIdentity(userId: string): Promise<{ userId: string; identityId: string }> {
  // Ensure user exists
  let user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    user = await prisma.user.create({
      data: { id: userId },
    });
    console.log(`Created user: ${userId}`);
  } else {
    console.log(`User exists: ${userId}`);
  }

  // Ensure identity exists
  let identity = await prisma.identity.findUnique({
    where: {
      channel_channelUserKey: {
        channel: CHANNEL,
        channelUserKey: CHANNEL_USER_KEY,
      },
    },
  });

  if (!identity) {
    identity = await prisma.identity.create({
      data: {
        userId: user.id,
        channel: CHANNEL,
        channelUserKey: CHANNEL_USER_KEY,
      },
    });
    console.log(`Created identity: ${identity.id}`);
  } else {
    console.log(`Identity exists: ${identity.id}`);
  }

  return { userId: user.id, identityId: identity.id };
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
      const replyTimestamp = message.r && message.r.trim() 
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
          text: message.u,
          createdAt: timestamp,
          clientTimestamp: timestamp,
          repliedAt: replyTimestamp,
          replyText: message.r && message.r.trim() ? message.r : null,
        },
        create: {
          userId,
          identityId,
          contentType: "text",
          text: message.u,
          sourceMessageId: userSourceId,
          createdAt: timestamp,
          clientTimestamp: timestamp,
          repliedAt: replyTimestamp,
          replyText: message.r && message.r.trim() ? message.r : null,
        },
      });

      totalMessages++;
    }
  }

  console.log(`Inserted ${totalMessages} messages`);
}

async function main() {
  const { filePath, userId, clear } = parseArgs();

  console.log(`Reading chat data from: ${filePath}`);
  console.log(`User ID: ${userId}`);
  console.log(`Clear existing data: ${clear}`);

  const fileContent = readFileSync(filePath, "utf-8");
  const data: ChatDay[] = JSON.parse(fileContent);

  const { userId: finalUserId, identityId } = await ensureUserAndIdentity(userId);

  if (clear) {
    await clearExistingData(finalUserId);
  }

  await insertMessages(data, finalUserId, identityId);

  console.log("Seed data insertion complete!");
}

main()
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
