import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { getRedis } from "../infra/redis";
import {
  SUMMARY_QUEUE_NAME,
  JOB_NAME_GENERATE_SUMMARY,
  type GenerateSummaryPayload,
} from "../queues/summaryQueue";
import {
  REPLY_QUEUE_NAME,
  JOB_NAME_GENERATE_REPLY,
  type GenerateReplyPayload,
} from "../queues/replyQueue";
import {
  JOB_NAME_FLUSH_REPLY_BATCH,
  REPLY_BATCH_QUEUE_NAME,
  replyBatchQueue,
  type FlushReplyBatchPayload,
} from "../queues/replyBatchQueue";
import { generateAckDecision } from "../llm/ackReply";
import { decryptText, encryptText, getKek } from "../infra/encryption";
import { getOrCreateUserDek } from "../infra/userDek";
import {
  TEST_FEEDBACK_COMMAND,
  TEST_FEEDBACK_SUCCESS_REPLY,
} from "../messages/testFeedback";
import { buildHelpText } from "../commands/registry";
import { getFullGuide } from "../guides/content";
import { getConfigName } from "../access/config";
import { consentConfig } from "../consent/config";
import {
  sendWhatsAppBufferDocument,
  sendWhatsAppButtons,
  sendWhatsAppDocument,
  sendWhatsAppReply,
  sendWhatsAppTypingIndicator,
} from "../infra/whatsapp";
import { buildWindowBundle } from "../summary/windowBuilder";
import { buildMinimalFallbackReport } from "../summary/reportAssembler";
import { generateSummaryPipeline } from "../summary/pipeline";
import { clearSummaryArtifactsForUser } from "../summary/redisArtifacts";
import { handleCheckinIntent } from "../checkin/handler";
import {
  REMINDER_QUEUE_NAME,
  JOB_NAME_SCAN_REMINDERS,
  JOB_NAME_SCAN_NUDGES,
  reminderQueue,
  type ScanRemindersPayload,
} from "../queues/reminderQueue";
import { startReminderScheduler, startNudgeScheduler, processReminderScan } from "../checkin/scheduler";
import { processNudgeScan } from "../nudge/nudgeHandler";
import {
  REPLY_BATCH_DEBOUNCE_MS,
  REPLY_BATCH_MAX_WAIT_MS,
  WHATSAPP_TYPING_INDICATOR_ENABLED,
} from "../replyBatch/config";
import {
  acquireReplyBatchFlushLock,
  claimBatchAtomically,
  clearReplyBatchState,
  getBatchTiming,
  releaseReplyBatchFlushLock,
  restoreClaimedBatch,
  type ClaimedReplyBatch,
} from "../replyBatch/state";

// Fail fast on startup
if (!process.env.REDIS_URL?.trim()) {
  throw new Error("REDIS_URL is required. Set it in .env");
}
getKek(); // validates ENCRYPTION_MASTER_KEY at startup
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());
const hasDatabaseParts = Boolean(
  process.env.DB_HOST?.trim() &&
    process.env.DB_NAME?.trim() &&
    process.env.DB_USER?.trim() &&
    process.env.DB_PASSWORD?.trim()
);
if (!hasDatabaseUrl && !hasDatabaseParts) {
  throw new Error(
    "DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD) is required. Set it in the environment."
  );
}

const SUMMARY_LOCK_TTL_SECONDS = 15 * 60;
const SUMMARY_ALREADY_RUNNING_TEXT =
  "Your previous summary is still being generated. Please wait.";
const SUMMARY_TIMEOUT_TEXT = "Summary generation timed out. Please request again.";
const CHATLOG_SENT_TEXT = "I have sent your chat log as an attachment.";
const CHAT_CLEARED_TEXT = "Your chat history has been cleared.";
const UNKNOWN_COMMAND_TEXT = "Unknown command. Type /help to see available commands.";
const BUSY_NOTICE_TEXT =
  "Please wait, I am processing your previous message. Retry command in a moment.";

type BatchDueReason = "quiet" | "max_cap";

function summaryLockKey(userId: string): string {
  return `summary:inflight:${userId}`;
}

const SUMMARY_RANGE_PROMPT_KEY_VERSION = "v1";
const SUMMARY_RANGE_PROMPT_TTL_SECONDS = 10 * 60;
const SUMMARY_RANGE_PROMPT_TEXT =
  "It seems like you'd like a SessionBridge report summary. If so, select the period below. If not, just keep chatting \u2014 no report will be generated unless you press a button.";
const SUMMARY_RANGE_BUTTONS: Array<{ id: string; title: string }> = [
  { id: "summary_range_7", title: "Last 7 days" },
  { id: "summary_range_15", title: "Last 15 days" },
  { id: "summary_range_30", title: "Last 30 days" },
];

async function sendSummaryRangePrompts(channelUserKey: string): Promise<void> {
  await sendWhatsAppButtons(channelUserKey, SUMMARY_RANGE_PROMPT_TEXT, SUMMARY_RANGE_BUTTONS);
}

function summaryRangePromptKey(userId: string): string {
  return `summary:range_prompt:${SUMMARY_RANGE_PROMPT_KEY_VERSION}:${userId}`;
}

function parseCommand(messageText: string): string | null {
  const trimmed = messageText.trim();
  if (!trimmed.startsWith("/")) return null;
  return trimmed.split(/\s+/)[0].toLowerCase();
}

async function buildAllTimeChatlogMarkdown(userId: string): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, text: true, replyText: true, repliedAt: true, category: true },
  });

  const dek = await getOrCreateUserDek(userId);
  for (const m of messages) {
    if (m.text) m.text = decryptText(m.text, dek);
    if (m.replyText) m.replyText = decryptText(m.replyText, dek);
  }

  const formatTime = (d: Date): string =>
    d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

  const lines: string[] = [];
  lines.push("# MeCove Chat Log");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  let currentDateHeader = "";
  let hasAnyMessage = false;

  for (const m of messages) {
    if (m.category === "test_feedback" || m.category === "command_reply") continue;
    const userText = (m.text ?? "").trim();
    if (!userText) continue;

    hasAnyMessage = true;
    const dateHeader = m.createdAt.toISOString().slice(0, 10);
    if (dateHeader !== currentDateHeader) {
      currentDateHeader = dateHeader;
      lines.push(`## ${dateHeader}`);
      lines.push("");
    }

    lines.push(`User(${formatTime(m.createdAt)}): ${userText}`);
    if (m.replyText && m.repliedAt) {
      lines.push(`Bot(${formatTime(m.repliedAt)}): ${m.replyText.trim()}`);
    }
    lines.push("");
  }

  if (!hasAnyMessage) {
    lines.push("_No chat messages available._");
    lines.push("");
  }

  return lines.join("\n");
}

function evaluateBatchDue(nowMs: number, startAtMs: number, lastAtMs: number): {
  dueReason: BatchDueReason | null;
  delayMs: number;
} {
  const quietElapsed = nowMs - lastAtMs;
  const totalElapsed = nowMs - startAtMs;

  if (totalElapsed >= REPLY_BATCH_MAX_WAIT_MS) {
    return { dueReason: "max_cap", delayMs: 0 };
  }
  if (quietElapsed >= REPLY_BATCH_DEBOUNCE_MS) {
    return { dueReason: "quiet", delayMs: 0 };
  }

  const quietRemaining = REPLY_BATCH_DEBOUNCE_MS - quietElapsed;
  const capRemaining = REPLY_BATCH_MAX_WAIT_MS - totalElapsed;
  return {
    dueReason: null,
    delayMs: Math.max(1, Math.min(quietRemaining, capRemaining)),
  };
}

async function enqueueBatchFlush(userId: string, seq: number, delayMs: number): Promise<void> {
  await replyBatchQueue.add(
    JOB_NAME_FLUSH_REPLY_BATCH,
    { userId, seq },
    { delay: Math.max(1, Math.floor(delayMs)) }
  );
}

async function handleSummaryIntent(input: {
  userId: string;
  channelUserKey: string;
}): Promise<{ kind: "text"; replyText: string } | { kind: "buttons"; replyText: string }> {
  const redis = getRedis();

  const lockKey = summaryLockKey(input.userId);
  const inflight = await redis.get(lockKey);
  if (inflight) {
    return { kind: "text", replyText: SUMMARY_ALREADY_RUNNING_TEXT };
  }

  await redis.set(summaryRangePromptKey(input.userId), "0", "EX", SUMMARY_RANGE_PROMPT_TTL_SECONDS);
  await sendSummaryRangePrompts(input.channelUserKey);
  return { kind: "buttons", replyText: SUMMARY_RANGE_PROMPT_TEXT };
}

// Summary worker
const summaryWorker = new Worker<GenerateSummaryPayload>(
  SUMMARY_QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME_GENERATE_SUMMARY) return;
    const { userId, channelUserKey, range } = job.data;

    const windowDays =
      range === "last_7_days"
        ? 7
        : range === "last_30_days"
          ? 30
          : range === "last_15_days"
            ? 15
            : null;
    if (!windowDays) return;

    const redis = getRedis();
    const lockKey = summaryLockKey(userId);
    let summaryId: string | null = null;
    let windowBundle: Awaited<ReturnType<typeof buildWindowBundle>> | null = null;

    try {
      windowBundle = await buildWindowBundle(userId, "Asia/Kolkata", new Date(), windowDays);
      const summary = await prisma.summary.create({
        data: {
          userId,
          rangeStart: new Date(windowBundle.rangeStartUtc),
          rangeEnd: new Date(windowBundle.rangeEndUtc),
          status: "processing",
          inputMessagesCount: windowBundle.counts.totalMessages,
          inputHash: windowBundle.inputHash,
        },
      });
      summaryId = summary.id;

      const result = await generateSummaryPipeline({
        userId,
        summaryId,
        timezone: "Asia/Kolkata",
        windowBundle,
      });

      const filename = `mecove-summary-${windowBundle.window.endDate}.pdf`;
      await sendWhatsAppDocument(channelUserKey, result.pdfBytes, filename, "Your summary is ready.");

      await prisma.summary.update({
        where: { id: summaryId },
        data: {
          status: "success",
          summaryText: result.finalReportText,
          modelName: result.modelName,
          promptVersion: result.promptVersionString,
          inputMessagesCount: windowBundle.counts.totalMessages,
          inputHash: windowBundle.inputHash,
          error: null,
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("summary generation failed", {
        userId,
        summaryId,
        error: reason,
      });

      let fallbackSent = false;
      try {
        if (!windowBundle) {
          windowBundle = await buildWindowBundle(userId, "Asia/Kolkata", new Date(), windowDays);
        }
        const fallback = await buildMinimalFallbackReport(windowBundle);
        const fallbackFilename = `mecove-summary-${windowBundle.window.endDate}.pdf`;
        await sendWhatsAppDocument(
          channelUserKey,
          fallback.pdfBytes,
          fallbackFilename,
          "Your summary is ready."
        );
        if (summaryId) {
          await prisma.summary.update({
            where: { id: summaryId },
            data: {
              status: "success_fallback",
              summaryText: fallback.reportText,
              modelName: null,
              promptVersion: "fallback_v1",
              inputMessagesCount: windowBundle.counts.totalMessages,
              inputHash: windowBundle.inputHash,
              error: `Fallback used: ${reason}`,
            },
          });
        } else {
          await prisma.summary.create({
            data: {
              userId,
              rangeStart: new Date(windowBundle.rangeStartUtc),
              rangeEnd: new Date(windowBundle.rangeEndUtc),
              status: "success_fallback",
              summaryText: fallback.reportText,
              promptVersion: "fallback_v1",
              inputMessagesCount: windowBundle.counts.totalMessages,
              inputHash: windowBundle.inputHash,
              error: `Fallback used: ${reason}`,
            },
          });
        }
        fallbackSent = true;
      } catch (fallbackErr) {
        logger.error("fallback summary generation failed", {
          userId,
          summaryId,
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        });
      }

      if (!fallbackSent) {
        if (summaryId) {
          await prisma.summary.update({
            where: { id: summaryId },
            data: {
              status: "failed",
              error: reason,
            },
          });
        } else if (windowBundle) {
          await prisma.summary.create({
            data: {
              userId,
              rangeStart: new Date(windowBundle.rangeStartUtc),
              rangeEnd: new Date(windowBundle.rangeEndUtc),
              status: "failed",
              inputMessagesCount: windowBundle.counts.totalMessages,
              inputHash: windowBundle.inputHash,
              error: reason,
            },
          });
        } else {
          const now = new Date();
          const rangeStart = new Date(now);
          rangeStart.setDate(rangeStart.getDate() - 15);
          await prisma.summary.create({
            data: {
              userId,
              rangeStart,
              rangeEnd: now,
              status: "failed",
              error: reason,
            },
          });
        }
        throw err;
      }
    } finally {
      await redis.del(lockKey);
    }
  },
  { connection: getRedis() }
);

// Command and busy-notice worker
const replyWorker = new Worker<GenerateReplyPayload>(
  REPLY_QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME_GENERATE_REPLY) {
      logger.warn("reply job ignored: wrong job name", { jobName: job.name });
      return;
    }

    const { userId, messageId, channelUserKey, messageText, mode } = job.data;

    if (mode === "busy_notice") {
      await sendWhatsAppReply(channelUserKey, BUSY_NOTICE_TEXT);
      const busyDek = await getOrCreateUserDek(userId);
      await prisma.message.update({
        where: { id: messageId },
        data: {
          repliedAt: new Date(),
          replyText: encryptText(BUSY_NOTICE_TEXT, busyDek),
        },
      });
      return;
    }

    const command = parseCommand(messageText);
    if (!command) {
      logger.warn("reply command job ignored: missing slash command", { messageId, userId });
      return;
    }

    // Fetch sender role once — needed for /help and admin commands
    const sender = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const isAdminUser = sender?.role === "admin";

    let replyText = CHATLOG_SENT_TEXT;

    if (command === "/help") {
      replyText = buildHelpText(isAdminUser);
    } else if (command === "/guide") {
      replyText = getFullGuide(isAdminUser);
    } else if (command === "/chatlog") {
      const chatlog = await buildAllTimeChatlogMarkdown(userId);
      const filename = `mecove-chatlog-${new Date().toISOString().slice(0, 10)}.md`;
      await sendWhatsAppBufferDocument(
        channelUserKey,
        Buffer.from(chatlog, "utf8"),
        filename,
        "text/plain",
        "Your chat log is ready."
      );
    } else if (command === "/clear") {
      await prisma.$transaction([
        prisma.summary.deleteMany({ where: { userId } }),
        prisma.message.deleteMany({ where: { userId } }),
      ]);
      await getRedis().del(summaryLockKey(userId), summaryRangePromptKey(userId));
      await clearReplyBatchState(userId);
      await clearSummaryArtifactsForUser(userId);
      replyText = CHAT_CLEARED_TEXT;
    } else if (command === "/stats") {
      const [messageCount, firstMessage, lastSummary] = await Promise.all([
        prisma.message.count({ where: { userId, category: { not: "test_feedback" } } }),
        prisma.message.findFirst({
          where: { userId, category: { not: "test_feedback" } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
        prisma.summary.findFirst({
          where: { userId, status: { in: ["success", "success_fallback"] } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      const memberSince = firstMessage
        ? firstMessage.createdAt.toISOString().slice(0, 10)
        : null;
      const lastReport = lastSummary
        ? lastSummary.createdAt.toISOString().slice(0, 10)
        : "none";
      const sinceText = memberSince ? ` since ${memberSince}` : "";
      replyText = `${messageCount} message${messageCount === 1 ? "" : "s"} logged${sinceText}.\nLast SessionBridge report: ${lastReport}.`;
    } else if (command === "/privacy") {
      const mvp = consentConfig.mvp;
      const parts: string[] = [];
      if (mvp.link) parts.push(`Privacy & Usage Notice: ${mvp.link}`);
      parts.push(mvp.message);
      replyText = parts.join("\n\n");
    } else if (command === TEST_FEEDBACK_COMMAND) {
      replyText = TEST_FEEDBACK_SUCCESS_REPLY;
    } else if (command === "/approve") {
      if (!isAdminUser) {
        replyText = UNKNOWN_COMMAND_TEXT;
      } else {
        const phoneArg = messageText.trim().split(/\s+/)[1]?.trim() ?? "";
        const normalizedPhone = phoneArg.startsWith("+") ? phoneArg : `+${phoneArg}`;
        const targetIdentity = await prisma.identity.findUnique({
          where: {
            channel_channelUserKey: { channel: "whatsapp", channelUserKey: normalizedPhone },
          },
          include: { user: true },
        });
        if (!targetIdentity) {
          replyText = `No user found for ${normalizedPhone}.`;
        } else if (targetIdentity.user.approvedAt) {
          replyText = `${normalizedPhone} is already approved.`;
        } else {
          await prisma.user.update({
            where: { id: targetIdentity.userId },
            data: { approvedAt: new Date() },
          });
          replyText = `${normalizedPhone} approved.`;
        }
      }
    } else if (command === "/waitlist") {
      if (!isAdminUser) {
        replyText = UNKNOWN_COMMAND_TEXT;
      } else {
        const waitlisted = await prisma.identity.findMany({
          where: { channel: "whatsapp", user: { approvedAt: null } },
          select: { channelUserKey: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        });
        if (waitlisted.length === 0) {
          replyText = "No users on the waitlist.";
        } else {
          const lines = waitlisted.map(
            (i) => `${i.channelUserKey} (since ${i.createdAt.toISOString().slice(0, 10)})`
          );
          replyText = `Waitlist (${waitlisted.length}):\n${lines.join("\n")}`;
        }
      }
    } else if (command === "/revoke") {
      if (!isAdminUser) {
        replyText = UNKNOWN_COMMAND_TEXT;
      } else {
        const phoneArg = messageText.trim().split(/\s+/)[1]?.trim() ?? "";
        const normalizedPhone = phoneArg.startsWith("+") ? phoneArg : `+${phoneArg}`;
        const targetIdentity = await prisma.identity.findUnique({
          where: {
            channel_channelUserKey: { channel: "whatsapp", channelUserKey: normalizedPhone },
          },
          include: { user: true },
        });
        if (!targetIdentity) {
          replyText = `No user found for ${normalizedPhone}.`;
        } else if (!targetIdentity.user.approvedAt) {
          replyText = `${normalizedPhone} is not currently approved.`;
        } else {
          await prisma.user.update({
            where: { id: targetIdentity.userId },
            data: { approvedAt: null },
          });
          replyText = `${normalizedPhone} revoked.`;
        }
      }
    } else if (command === "/users") {
      if (!isAdminUser) {
        replyText = UNKNOWN_COMMAND_TEXT;
      } else {
        const identities = await prisma.identity.findMany({
          where: { channel: "whatsapp", user: { approvedAt: { not: null } } },
          select: { channelUserKey: true, user: { select: { role: true } } },
          orderBy: { createdAt: "asc" },
        });
        if (identities.length === 0) {
          replyText = "No approved users.";
        } else {
          const lines = identities.map((i) => {
            const name = getConfigName(i.channelUserKey);
            const tag = i.user.role === "admin" ? " [admin]" : "";
            return name ? `${name} (${i.channelUserKey})${tag}` : `${i.channelUserKey}${tag}`;
          });
          replyText = `Users (${identities.length}):\n${lines.join("\n")}`;
        }
      }
    } else if (command === "/userstats") {
      if (!isAdminUser) {
        replyText = UNKNOWN_COMMAND_TEXT;
      } else {
        const [identities, lastMessages] = await Promise.all([
          prisma.identity.findMany({
            where: { channel: "whatsapp", user: { approvedAt: { not: null } } },
            select: { channelUserKey: true, userId: true, displayName: true },
            orderBy: { createdAt: "asc" },
          }),
          prisma.message.groupBy({
            by: ["userId"],
            _max: { createdAt: true },
            where: { category: { not: "test_feedback" } },
          }),
        ]);
        const lastMsgMap = new Map(
          lastMessages.map((r) => [r.userId, r._max.createdAt])
        );
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const withActivity = identities.map((i) => {
          const last = lastMsgMap.get(i.userId) ?? null;
          return { channelUserKey: i.channelUserKey, displayName: i.displayName, last };
        });
        withActivity.sort((a, b) => {
          if (!a.last && !b.last) return 0;
          if (!a.last) return 1;
          if (!b.last) return -1;
          return b.last.getTime() - a.last.getTime();
        });
        const lines = withActivity.map(({ channelUserKey: ck, displayName, last }) => {
          const name = displayName?.trim() || getConfigName(ck) || ck;
          if (!last) return `${name} — no messages`;
          const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
          const diffDays = Math.round((todayStart.getTime() - lastDay.getTime()) / 86400000);
          const when = diffDays === 0 ? "today" : diffDays === 1 ? "yesterday" : `${diffDays} days ago`;
          return `${name} — ${when}`;
        });
        replyText = `User stats (${lines.length}):\n${lines.join("\n")}`;
      }
    } else if (command === "/checkin") {
      const checkinBodyText = await handleCheckinIntent({ userId, channelUserKey });
      const checkinDek = await getOrCreateUserDek(userId);
      await prisma.message.update({
        where: { id: messageId },
        data: {
          repliedAt: new Date(),
          replyText: encryptText(checkinBodyText, checkinDek),
        },
      });
      return;
    } else {
      replyText = UNKNOWN_COMMAND_TEXT;
    }

    await sendWhatsAppReply(channelUserKey, replyText);

    if (command !== "/clear") {
      const cmdDek = await getOrCreateUserDek(userId);
      await prisma.message.update({
        where: { id: messageId },
        data: {
          repliedAt: new Date(),
          replyText: encryptText(replyText, cmdDek),
        },
      });
    }
  },
  {
    connection: getRedis(),
    concurrency: 5,
  }
);

// Debounced batch flush worker
const replyBatchWorker = new Worker<FlushReplyBatchPayload>(
  REPLY_BATCH_QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME_FLUSH_REPLY_BATCH) {
      logger.warn("reply batch job ignored: wrong job name", { jobName: job.name });
      return;
    }

    const { userId, seq: jobSeq } = job.data;
    const timing = await getBatchTiming(userId);
    if (!timing) return;

    const nowMs = Date.now();
    const due = evaluateBatchDue(nowMs, timing.startAtMs, timing.lastAtMs);
    if (!due.dueReason) {
      await enqueueBatchFlush(userId, timing.seq, due.delayMs);
      return;
    }

    const lockToken = await acquireReplyBatchFlushLock(userId);
    if (!lockToken) {
      return;
    }

    const lockedTiming = await getBatchTiming(userId);
    if (!lockedTiming) {
      await releaseReplyBatchFlushLock(userId, lockToken);
      return;
    }
    const lockedDue = evaluateBatchDue(Date.now(), lockedTiming.startAtMs, lockedTiming.lastAtMs);
    if (!lockedDue.dueReason) {
      await enqueueBatchFlush(userId, lockedTiming.seq, lockedDue.delayMs);
      await releaseReplyBatchFlushLock(userId, lockToken);
      return;
    }

    let claimedBatch: ClaimedReplyBatch | null = null;
    let replySent = false;
    try {
      claimedBatch = await claimBatchAtomically(userId);
      if (!claimedBatch) return;

      const messages = await prisma.message.findMany({
        where: {
          userId,
          id: { in: claimedBatch.ids },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          text: true,
        },
      });
      if (messages.length === 0) return;

      const batchDek = await getOrCreateUserDek(userId);
      for (const m of messages) {
        if (m.text) m.text = decryptText(m.text, batchDek);
      }

      const combinedText = messages
        .map((m) => (m.text ?? "").trim())
        .filter((text) => text.length > 0 && !text.startsWith("/"))
        .join("\n");
      if (combinedText.length === 0) return;

      if (WHATSAPP_TYPING_INDICATOR_ENABLED) {
        try {
          await sendWhatsAppTypingIndicator(
            claimedBatch.meta.channelUserKey,
            claimedBatch.meta.latestSourceMessageId
          );
        } catch (err) {
          logger.warn("typing indicator call failed; continuing without indicator", {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const batchUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const isAdminBatchUser = batchUser?.role === "admin";

      let replyText = "Got it.";
      let shouldGenerateSummary = false;
      let shouldSetupCheckin = false;
      try {
        const decision = await generateAckDecision(userId, combinedText, "saved", { isAdmin: isAdminBatchUser });
        if (decision.replyText.trim().length > 0) {
          replyText = decision.replyText.trim();
        }
        shouldGenerateSummary = decision.shouldGenerateSummary;
        shouldSetupCheckin = decision.shouldSetupCheckin ?? false;
        logger.info("ack decision summary flag", {
          userId,
          shouldGenerateSummary,
          shouldSetupCheckin,
          batchMessageCount: combinedText ? combinedText.split(/\n/).length : 0,
        });
      } catch (err) {
        logger.warn("LLM batch reply generation failed, using fallback", err);
      }

      if (shouldSetupCheckin) {
        const checkinBodyText = await handleCheckinIntent({
          userId,
          channelUserKey: claimedBatch.meta.channelUserKey,
        });
        replyText = checkinBodyText;
        replySent = true;
      } else if (shouldGenerateSummary) {
        // Label the latest message in the batch as a summary request so it is
        // excluded from future report windows.
        const latestBatchMsgId = messages[messages.length - 1]?.id;
        if (latestBatchMsgId) {
          await prisma.message.update({
            where: { id: latestBatchMsgId },
            data: { category: "summary_request" },
          });
        }

        const result = await handleSummaryIntent({
          userId,
          channelUserKey: claimedBatch.meta.channelUserKey,
        });
        replyText = result.replyText;
        if (result.kind === "text") {
          await sendWhatsAppReply(claimedBatch.meta.channelUserKey, replyText);
        }
        replySent = true;
      } else {
        await sendWhatsAppReply(claimedBatch.meta.channelUserKey, replyText);
        replySent = true;
      }

      const latestMessageId = messages.some((m) => m.id === claimedBatch?.meta.latestMessageId)
        ? claimedBatch.meta.latestMessageId
        : messages[messages.length - 1]?.id;

      if (latestMessageId) {
        try {
          await prisma.message.update({
            where: { id: latestMessageId },
            data: {
              repliedAt: new Date(),
              replyText: encryptText(replyText, batchDek),
            },
          });
        } catch (err) {
          logger.error("failed to persist latest batch message reply metadata", {
            userId,
            latestMessageId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info("reply batch flushed", {
        userId,
        batchCount: claimedBatch.ids.length,
        dueReason: lockedDue.dueReason,
        waitMs: nowMs - claimedBatch.meta.startAtMs,
        jobSeq,
        currentSeq: lockedTiming.seq,
      });
    } catch (err) {
      if (claimedBatch && !replySent) {
        try {
          await restoreClaimedBatch(userId, claimedBatch);
          await enqueueBatchFlush(userId, claimedBatch.meta.seq, REPLY_BATCH_DEBOUNCE_MS);
        } catch (restoreErr) {
          logger.error("failed to restore claimed batch after processing error", {
            userId,
            error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
          });
        }
      }
      throw err;
    } finally {
      await releaseReplyBatchFlushLock(userId, lockToken);
    }
  },
  {
    connection: getRedis(),
    concurrency: 5,
  }
);

// Reminder + nudge scan worker
const reminderWorker = new Worker<ScanRemindersPayload>(
  REMINDER_QUEUE_NAME,
  async (job) => {
    if (job.name === JOB_NAME_SCAN_REMINDERS) {
      await processReminderScan();
    } else if (job.name === JOB_NAME_SCAN_NUDGES) {
      await processNudgeScan();
    }
  },
  {
    connection: getRedis(),
    concurrency: 1,
  }
);

reminderWorker.on("failed", (job, err) => {
  logger.error("reminder job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

replyWorker.on("failed", (job, err) => {
  logger.error("reply job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

replyBatchWorker.on("failed", (job, err) => {
  logger.error("reply batch job failed", {
    jobId: job?.id,
    error: err.message,
    userId: job?.data?.userId,
  });
});

summaryWorker.on("failed", (job, err) => {
  const userId = job?.data?.userId;
  const channelUserKey = job?.data?.channelUserKey;
  if (userId) {
    void getRedis().del(summaryLockKey(userId));
  }
  if (channelUserKey && /timed out/i.test(err.message)) {
    void sendWhatsAppReply(channelUserKey, SUMMARY_TIMEOUT_TEXT).catch((sendErr) => {
      logger.error("failed to send summary timeout notification", {
        jobId: job?.id,
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    });
  }
  logger.error("summary job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

async function shutdown() {
  await Promise.all([
    summaryWorker.close(),
    replyWorker.close(),
    replyBatchWorker.close(),
    reminderWorker.close(),
  ]);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

void startReminderScheduler(reminderQueue);
void startNudgeScheduler(reminderQueue);

logger.info("worker started (summary + reply + reply_batch + reminder queues)");
