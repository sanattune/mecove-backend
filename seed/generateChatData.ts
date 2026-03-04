/**
 * LLM-powered seed data generator
 *
 * Usage:
 *   pnpm seed:generate                        # uses seed/seed-input.yaml
 *   pnpm seed:generate path/to/custom.yaml    # custom YAML path
 */

import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { parse as parseYaml } from "yaml";
import { prisma } from "../src/infra/prisma";
import { LlmViaApi } from "../src/llm/llmViaApi";
import { seedFromFile, type ChatDay, type ChatMessage } from "./seedChatData";

// ── Config types ────────────────────────────────────────────────────

interface SeedConfig {
  phone: string;
  persona: string;
  arc: string;
  days: number;
  messages: string; // "min-max"
  gap?: number;
  output?: string;
  seedDb?: boolean;
  clear?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────

function normalizeChannelUserKey(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, "");
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function parseMessageRange(range: string): { min: number; max: number } {
  const parts = range.split("-").map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] >= parts[0]) {
    return { min: parts[0], max: parts[1] };
  }
  return { min: 2, max: 5 };
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function computeActiveDays(numDays: number, gapCenter: number): number[] {
  const days: number[] = [1];
  for (let i = 1; i < numDays; i++) {
    const gap = Math.max(1, gapCenter + randInt(-1, 1));
    days.push(days[days.length - 1] + gap);
  }
  return days;
}

// ── User lookup (mirrors WhatsApp webhook) ──────────────────────────

async function findOrCreateUser(phone: string): Promise<{ userId: string; identityId: string }> {
  const channelUserKey = normalizeChannelUserKey(phone);

  let identity = await prisma.identity.findUnique({
    where: {
      channel_channelUserKey: {
        channel: "whatsapp",
        channelUserKey,
      },
    },
    include: { user: true },
  });

  if (!identity) {
    const user = await prisma.user.create({ data: {} });
    identity = await prisma.identity.create({
      data: {
        userId: user.id,
        channel: "whatsapp",
        channelUserKey,
      },
      include: { user: true },
    });
    console.log(`Created user ${user.id} with identity for ${channelUserKey}`);
  } else {
    console.log(`Found existing user ${identity.userId} for ${channelUserKey}`);
  }

  return { userId: identity.userId, identityId: identity.id };
}

// ── LLM generation ─────────────────────────────────────────────────

function buildPrompt(
  persona: string,
  arc: string,
  dayIndex: number,
  totalDays: number,
  messageCount: number,
  rollingContext: string[]
): string {
  const contextBlock =
    rollingContext.length > 0
      ? `\nRecent journal entries for continuity:\n${rollingContext.join("\n")}\n`
      : "";

  return `You are generating realistic WhatsApp journal messages for a seed dataset.

Persona: ${persona}
Emotional arc: ${arc}
This is day ${dayIndex + 1} of ${totalDays} in the arc.
${contextBlock}
Generate exactly ${messageCount} message exchanges. Each exchange has:
- "u": the user's journal message (casual WhatsApp style, 1-2 sentences)
- "r": a short acknowledgment reply ("Noted.", "Got it.", "Acknowledged.", "Acknowledged. Say more if you'd like.", "Got it. Say more if you'd like.", "Noted. Feel free to share more if you want.", etc.)

The messages should reflect where the person is in their emotional arc (${dayIndex + 1}/${totalDays}).

Respond with ONLY a JSON array, no markdown fences, no explanation:
[{"index":1,"u":"...","r":"..."},{"index":2,"u":"...","r":"..."}]`;
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

async function generateDay(
  llm: LlmViaApi,
  persona: string,
  arc: string,
  dayIndex: number,
  totalDays: number,
  messageCount: number,
  rollingContext: string[],
  maxRetries: number = 3
): Promise<ChatMessage[]> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const prompt = buildPrompt(persona, arc, dayIndex, totalDays, messageCount, rollingContext);
      const raw = await llm.complete({ prompt, maxTokens: 2000, complexity: "low" });
      const cleaned = stripFences(raw);
      const parsed = JSON.parse(cleaned) as ChatMessage[];

      // Validate structure
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Response is not a non-empty array");
      }
      for (const msg of parsed) {
        if (typeof msg.index !== "number" || typeof msg.u !== "string" || typeof msg.r !== "string") {
          throw new Error("Invalid message structure");
        }
      }

      return parsed;
    } catch (err) {
      console.warn(`Day ${dayIndex + 1} attempt ${attempt} failed: ${(err as Error).message}`);
      if (attempt === maxRetries) {
        throw new Error(`Failed to generate day ${dayIndex + 1} after ${maxRetries} attempts`);
      }
    }
  }
  throw new Error("Unreachable");
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const configPath = process.argv[2] || join(process.cwd(), "seed", "seed-input.yaml");
  console.log(`Loading config from: ${configPath}`);

  const configRaw = readFileSync(configPath, "utf-8");
  const config: SeedConfig = parseYaml(configRaw);

  // Validate required fields
  if (!config.phone || !config.persona || !config.arc || !config.days) {
    throw new Error("Config must include phone, persona, arc, and days");
  }

  const { min, max } = parseMessageRange(config.messages || "2-5");
  const gapCenter = config.gap ?? 1;
  const activeDays = computeActiveDays(config.days, gapCenter);
  const totalCalendarDays = activeDays[activeDays.length - 1];

  console.log(`Generating ${config.days} active days across ${totalCalendarDays} calendar days`);
  console.log(`Messages per day: ${min}-${max}, gap center: ${gapCenter}`);
  console.log(`Active day numbers: ${activeDays.join(", ")}`);

  // Generate with LLM
  const llm = new LlmViaApi();
  const activeDaySet = new Set(activeDays);
  const generatedDays: Map<number, ChatMessage[]> = new Map();
  const rollingContext: string[] = [];

  for (let i = 0; i < activeDays.length; i++) {
    const dayNum = activeDays[i];
    const messageCount = randInt(min, max);
    console.log(`\nGenerating day ${dayNum} (${i + 1}/${config.days}, ${messageCount} messages)...`);

    const messages = await generateDay(
      llm,
      config.persona,
      config.arc,
      i,
      config.days,
      messageCount,
      rollingContext
    );

    generatedDays.set(dayNum, messages);

    // Update rolling context (keep last 2-3 days)
    const dayContext = `Day ${dayNum}: ${messages.map((m) => m.u).join(" | ")}`;
    rollingContext.push(dayContext);
    if (rollingContext.length > 3) {
      rollingContext.shift();
    }

    console.log(`  Generated ${messages.length} messages`);
  }

  // Assemble full ChatDay[] including blank gap days
  const chatData: ChatDay[] = [];
  for (let d = 1; d <= totalCalendarDays; d++) {
    if (activeDaySet.has(d)) {
      chatData.push({ day: d, chat: generatedDays.get(d)! });
    } else {
      chatData.push({ day: d });
    }
  }

  // Write JSON output
  const outputPath =
    config.output || join(process.cwd(), "seed", "chat-data", `generated-${Date.now()}.json`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(chatData, null, 2));
  console.log(`\nWrote ${chatData.length} days to: ${outputPath}`);

  // Optionally seed DB
  if (config.seedDb) {
    console.log("\nSeeding database...");
    const { userId, identityId } = await findOrCreateUser(config.phone);
    await seedFromFile(outputPath, userId, identityId, config.clear ?? false);
  }

  console.log("\nDone!");
}

main()
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
