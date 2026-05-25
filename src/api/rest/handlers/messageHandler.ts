import crypto from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import { checkRateLimit, RateLimits } from "../middleware/rateLimit";
import { encryptText, decryptText } from "../../../infra/encryption";
import { getOrCreateUserDek } from "../../../infra/userDek";
import { generateAckDecision } from "../../../llm/reply/ack/ackReply";

const REPLY_TIMEOUT_MS = 30_000;
const MESSAGES_DEFAULT_LIMIT = 50;

const SendMessageSchema = z.object({
  content: z.string().min(1).max(10_000),
});

type MessageItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

function toMessageItems(
  row: {
    id: string;
    createdAt: Date;
    text: string | null;
    replyText: string | null;
    repliedAt: Date | null;
  },
  dek: Buffer
): MessageItem[] {
  const items: MessageItem[] = [];
  if (row.text) {
    items.push({
      id: `${row.id}:user`,
      role: "user",
      content: decryptText(row.text, dek),
      timestamp: row.createdAt.toISOString(),
    });
  }
  if (row.replyText && row.repliedAt) {
    items.push({
      id: `${row.id}:assistant`,
      role: "assistant",
      content: decryptText(row.replyText, dek),
      timestamp: row.repliedAt.toISOString(),
    });
  }
  return items;
}

export async function handleGetMessages(
  request: FastifyRequest<{ Querystring: { before?: string; limit?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "getMessages" });
  const userId = request.userId!;
  try {
    const { before, limit: limitRaw } = request.query;
    const limitNum = parseInt(limitRaw ?? String(MESSAGES_DEFAULT_LIMIT), 10);
    const limit = isNaN(limitNum) || limitNum < 1 || limitNum > 100 ? MESSAGES_DEFAULT_LIMIT : limitNum;

    const rows = await prisma.message.findMany({
      where: {
        userId,
        category: { in: ["user_message", "summary_request"] },
        text: { not: null },
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: { id: true, createdAt: true, text: true, replyText: true, repliedAt: true },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const dek = await getOrCreateUserDek(userId);
    const messages = page.flatMap((row) => toMessageItems(row, dek)).reverse();

    log.info({ userId, count: messages.length }, "messages fetched");
    reply.code(200).send({ messages, hasMore });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "getMessages" });
    log.error({ err }, "getMessages failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleSendMessage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "sendMessage" });
  const userId = request.userId!;
  try {
    const rl = RateLimits.sendMessage(userId);
    const allowed = await checkRateLimit(rl.key, rl.limit, rl.windowSeconds);
    if (!allowed) {
      reply.code(429).send(Errors.rateLimited());
      return;
    }

    const parsed = SendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { content } = parsed.data;

    const identity = await prisma.identity.upsert({
      where: { channel_channelUserKey: { channel: "app", channelUserKey: userId } },
      update: {},
      create: { userId, channel: "app", channelUserKey: userId },
    });

    const dek = await getOrCreateUserDek(userId);
    const encryptedContent = encryptText(content, dek);
    const sourceMessageId = crypto.randomUUID();
    const now = new Date();

    const message = await prisma.message.create({
      data: {
        userId,
        identityId: identity.id,
        contentType: "text",
        text: encryptedContent,
        sourceMessageId,
        category: "user_message",
        createdAt: now,
      },
    });

    let decision: Awaited<ReturnType<typeof generateAckDecision>>;
    try {
      decision = await Promise.race([
        generateAckDecision(userId, content),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("REPLY_TIMEOUT")), REPLY_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === "REPLY_TIMEOUT";
      if (isTimeout) {
        log.warn({ userId }, "reply timed out");
        reply.code(503).send(Errors.replyTimeout());
      } else {
        captureException(err, { requestId: request.id, userId });
        log.error({ err }, "generateAckDecision failed");
        reply.code(500).send(Errors.internal());
      }
      return;
    }

    let replyText = decision.replyText;
    if (decision.shouldGenerateSummary) {
      replyText = "You can generate a report from the Reports tab in the app.";
    } else if (decision.shouldSetupCheckin) {
      replyText = "You can set your daily check-in time in Settings.";
    }
    const repliedAt = new Date();
    const encryptedReply = encryptText(replyText, dek);

    await prisma.message.update({
      where: { id: message.id },
      data: {
        replyText: encryptedReply,
        repliedAt,
        classifierType: decision.classifierType ?? null,
      },
    });

    log.info({ userId, classifierType: decision.classifierType }, "message sent");
    reply.code(200).send({
      userMessage: { id: `${message.id}:user`, role: "user", content, timestamp: now.toISOString() },
      assistantMessage: { id: `${message.id}:assistant`, role: "assistant", content: replyText, timestamp: repliedAt.toISOString() },
    });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "sendMessage" });
    log.error({ err }, "sendMessage failed");
    reply.code(500).send(Errors.internal());
  }
}
