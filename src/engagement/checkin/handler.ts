import { prisma } from "../../infra/prisma";
import { getRedis } from "../../infra/redis";
import { sendWhatsAppButtons, sendWhatsAppReply } from "../../infra/whatsapp";

export const CHECKIN_PROMPT_KEY_VERSION = "v1";
export const CHECKIN_PROMPT_TTL_SECONDS = 10 * 60;

export const CHECKIN_TIME_OPTIONS = ["06:00", "16:00", "21:00"] as const;
export type CheckinTime = (typeof CHECKIN_TIME_OPTIONS)[number];

export const CHECKIN_TIME_ACTION_IDS: Record<string, CheckinTime> = {
  checkin_time_0600: "06:00",
  checkin_time_1600: "16:00",
  checkin_time_2100: "21:00",
};

const CHECKIN_TIME_ACTION_ID_BY_TIME: Record<CheckinTime, string> = {
  "06:00": "checkin_time_0600",
  "16:00": "checkin_time_1600",
  "21:00": "checkin_time_2100",
};

export const CHECKIN_TIME_LABELS: Record<CheckinTime, string> = {
  "06:00": "6 AM",
  "16:00": "4 PM",
  "21:00": "9 PM",
};

export function checkinPendingKey(userId: string): string {
  return `checkin:pending:${CHECKIN_PROMPT_KEY_VERSION}:${userId}`;
}

/**
 * Compute the next UTC DateTime for a wall-clock time in the given timezone.
 * Currently supports Asia/Kolkata (UTC+5:30) only — no DST concerns.
 * TODO: use a proper timezone library (e.g. luxon) when multi-timezone support is needed.
 */
export function computeNextFireAt(time: string, timezone: string): Date {
  const [hh, mm] = time.split(":").map(Number);

  // Determine UTC offset in minutes for the given timezone.
  // We use Intl to derive the offset rather than hardcoding, so this works
  // correctly for any IANA timezone string — though all users are currently IST.
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Get current local date in the target timezone
  const parts = formatter.formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const localYear = get("year");
  const localMonth = get("month") - 1;
  const localDay = get("day");

  // Candidate: today at HH:MM:00 in the target timezone — expressed as UTC
  // Build the local datetime string and convert via offset
  const candidateLocal = new Date(
    Date.UTC(localYear, localMonth, localDay, hh, mm, 0, 0)
  );
  // candidateLocal is in UTC but "looks like" local time — subtract the offset
  const offsetMs = getTimezoneOffsetMs(timezone, candidateLocal);
  const candidateUtc = new Date(candidateLocal.getTime() - offsetMs);

  // If that moment has already passed (plus a 60s buffer), fire tomorrow
  if (candidateUtc.getTime() <= now.getTime() + 60_000) {
    return new Date(candidateUtc.getTime() + 24 * 60 * 60 * 1000);
  }
  return candidateUtc;
}

/**
 * Returns the UTC offset in milliseconds for a timezone at a given instant.
 * Positive offset means timezone is ahead of UTC (e.g. IST = +5:30 = +19800000ms).
 */
function getTimezoneOffsetMs(timezone: string, at: Date): number {
  // Format "now" in UTC and in the target timezone, then diff
  const utcStr = at.toLocaleString("en-CA", { timeZone: "UTC", hour12: false });
  const localStr = at.toLocaleString("en-CA", { timeZone: timezone, hour12: false });
  const utcDate = new Date(utcStr.replace(",", ""));
  const localDate = new Date(localStr.replace(",", ""));
  return localDate.getTime() - utcDate.getTime();
}

/**
 * Send the /checkin button prompt. Called from:
 * - replyWorker when user sends /checkin command
 * - replyBatchWorker when classifier detects setup_checkin intent
 */
export async function handleCheckinIntent(input: {
  userId: string;
  channelUserKey: string;
}): Promise<string> {
  const { userId, channelUserKey } = input;

  const existing = await prisma.userReminder.findFirst({
    where: { userId, isActive: true },
    include: { user: true },
  });

  let buttons: Array<{ id: string; title: string }>;
  let bodyText: string;

  if (!existing) {
    // No reminder set — offer all 3 time slots
    buttons = CHECKIN_TIME_OPTIONS.map((t) => ({
      id: CHECKIN_TIME_ACTION_ID_BY_TIME[t],
      title: CHECKIN_TIME_LABELS[t],
    }));
    bodyText = "When would you like your daily check-in?";
  } else {
    // Reminder already set — show the 2 other slots + Turn Off
    const currentTime = existing.time as CheckinTime;
    const otherTimes = CHECKIN_TIME_OPTIONS.filter((t) => t !== currentTime);
    buttons = [
      ...otherTimes.map((t) => ({
        id: CHECKIN_TIME_ACTION_ID_BY_TIME[t],
        title: CHECKIN_TIME_LABELS[t],
      })),
      { id: "checkin_off", title: "Turn Off" },
    ];
    bodyText = `Your check-in is currently set for ${CHECKIN_TIME_LABELS[currentTime] ?? currentTime}. Pick a new time or turn it off.`;
  }

  await sendWhatsAppButtons(channelUserKey, bodyText, buttons);

  const redis = getRedis();
  await redis.set(checkinPendingKey(userId), "1", "EX", CHECKIN_PROMPT_TTL_SECONDS);

  return bodyText;
}

/**
 * Persist a new (or updated) reminder and send confirmation.
 * Called from server.ts when user taps a time button.
 */
export async function setCheckinReminder(input: {
  userId: string;
  time: CheckinTime;
  toDigits: string;
}): Promise<void> {
  const { userId, time, toDigits } = input;

  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const timezone = settings?.timezone ?? "Asia/Kolkata";
  const nextFireAt = computeNextFireAt(time, timezone);

  await prisma.$transaction([
    prisma.userReminder.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    }),
    prisma.userReminder.create({
      data: {
        userId,
        time,
        frequencyType: "DAILY",
        nextFireAt,
        isActive: true,
      },
    }),
  ]);

  const label = CHECKIN_TIME_LABELS[time];
  await sendWhatsAppReply(toDigits, `You're all set! I'll check in with you every day at ${label}.`);
}

/**
 * Deactivate all reminders for a user and send confirmation.
 * Called from server.ts when user taps "Turn Off".
 */
export async function turnOffCheckinReminder(input: {
  userId: string;
  toDigits: string;
}): Promise<void> {
  const { userId, toDigits } = input;

  await prisma.userReminder.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });

  await sendWhatsAppReply(toDigits, "Got it, reminders turned off.");
}
