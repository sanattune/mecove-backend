import { createHash } from "node:crypto";
import { prisma } from "../infra/prisma";
import { isStoredTestFeedbackText } from "../messages/testFeedback";
import type { SignalBucket, WindowBundle, WindowDay } from "./types";

const IST_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;

function toIstDateString(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

function istDateStartToUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MINUTES * 60 * 1000);
}

function signalBucket(daysWithEntries: number): SignalBucket {
  if (daysWithEntries <= 2) return "LOW";
  if (daysWithEntries <= 5) return "MEDIUM";
  return "HIGH";
}

function buildInputHash(days: WindowDay[]): string {
  const parts: string[] = [];
  for (const day of days) {
    for (const m of day.messages) {
      parts.push(m.messageId, m.text);
    }
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

export async function buildWindowBundle(
  userId: string,
  timezone = "Asia/Kolkata",
  now = new Date()
): Promise<WindowBundle> {
  const endDate = toIstDateString(now);
  const startDate = shiftDate(endDate, -14);
  const rangeStartUtc = istDateStartToUtc(startDate);
  const rangeEndExclusiveUtc = istDateStartToUtc(shiftDate(endDate, 1));
  const rangeEndUtc = new Date(rangeEndExclusiveUtc.getTime() - 1);

  const messages = await prisma.message.findMany({
    where: {
      userId,
      createdAt: {
        gte: rangeStartUtc,
        lt: rangeEndExclusiveUtc,
      },
      text: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      text: true,
    },
  });

  const byDay = new Map<string, WindowDay>();
  for (const msg of messages) {
    const raw = (msg.text ?? "").trim();
    if (!raw) continue;
    if (raw.startsWith("/") || isStoredTestFeedbackText(raw)) continue;

    const date = toIstDateString(msg.createdAt);
    if (!byDay.has(date)) {
      byDay.set(date, { date, messages: [] });
    }
    byDay.get(date)!.messages.push({
      messageId: msg.id,
      createdAt: msg.createdAt.toISOString(),
      text: msg.text ?? "",
    });
  }

  const days = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  const daysWithEntries = days.length;
  const totalMessages = days.reduce((sum, d) => sum + d.messages.length, 0);
  const bucket = signalBucket(daysWithEntries);

  return {
    userId,
    timezone,
    window: {
      startDate,
      endDate,
      days: 15,
    },
    rangeStartUtc: rangeStartUtc.toISOString(),
    rangeEndUtc: rangeEndUtc.toISOString(),
    rangeEndExclusiveUtc: rangeEndExclusiveUtc.toISOString(),
    counts: {
      totalMessages,
      daysWithEntries,
    },
    signalBucket: bucket,
    section3AllowedByCounts: bucket !== "LOW",
    inputHash: buildInputHash(days),
    days,
  };
}
