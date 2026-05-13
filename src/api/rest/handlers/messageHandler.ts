import http from "node:http";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { sendJSON } from "../../common/sendJSON";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import { requireAuth } from "../middleware/auth";
import { checkRateLimit, RateLimits } from "../middleware/rateLimit";
import { encryptText, decryptText } from "../../../infra/encryption";
import { getOrCreateUserDek } from "../../../infra/userDek";
import { generateAckDecision } from "../../../llm/reply/ack/ackReply";
import type { AuthenticatedRequest } from "../../common/httpTypes";

const REPLY_TIMEOUT_MS = 30_000;
const MESSAGES_DEFAULT_LIMIT = 50;

const SendMessageSchema = z.object({
  content: z.string().min(1).max(10_000),
});

import { parseQuery, readBody } from "../../common/httpHelpers";

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
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestId: string
): Promise<void> {
  const log = childLogger({ requestId, handler: "getMessages" });
  if (!requireAuth(req, res)) return;
  const authedReq = req as AuthenticatedRequest;
  try {
    const params = parseQuery(req);
    const before = params.get("before");
    const limitRaw = parseInt(params.get("limit") ?? String(MESSAGES_DEFAULT_LIMIT), 10);
    const limit = isNaN(limitRaw) || limitRaw < 1 || limitRaw > 100 ? MESSAGES_DEFAULT_LIMIT : limitRaw;

    const rows = await prisma.message.findMany({
      where: {
        userId: authedReq.userId,
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

    const dek = await getOrCreateUserDek(authedReq.userId);
    const messages = page.flatMap((row) => toMessageItems(row, dek)).reverse();

    log.info({ userId: authedReq.userId, count: messages.length }, "messages fetched");
    sendJSON(res, 200, { messages, hasMore });
  } catch (err) {
    captureException(err, { requestId, handler: "getMessages" });
    log.error({ err }, "getMessages failed");
    sendJSON(res, 500, Errors.internal());
  }
}

export async function handleSendMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestId: string
): Promise<void> {
  const log = childLogger({ requestId, handler: "sendMessage" });
  if (!requireAuth(req, res)) return;
  const authedReq = req as AuthenticatedRequest;
  try {
    const rl = RateLimits.sendMessage(authedReq.userId);
    const allowed = await checkRateLimit(rl.key, rl.limit, rl.windowSeconds);
    if (!allowed) {
      sendJSON(res, 429, Errors.rateLimited());
      return;
    }

    const body = JSON.parse(await readBody(req));
    const parsed = SendMessageSchema.safeParse(body);
    if (!parsed.success) {
      sendJSON(res, 400, Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { content } = parsed.data;

    // Get or create app Identity for this user
    const identity = await prisma.identity.upsert({
      where: {
        channel_channelUserKey: {
          channel: "app",
          channelUserKey: authedReq.userId,
        },
      },
      update: {},
      create: {
        userId: authedReq.userId,
        channel: "app",
        channelUserKey: authedReq.userId,
      },
    });

    const dek = await getOrCreateUserDek(authedReq.userId);
    const encryptedContent = encryptText(content, dek);
    const sourceMessageId = crypto.randomUUID();
    const now = new Date();

    const message = await prisma.message.create({
      data: {
        userId: authedReq.userId,
        identityId: identity.id,
        contentType: "text",
        text: encryptedContent,
        sourceMessageId,
        category: "user_message",
        createdAt: now,
      },
    });

    // Run AI pipeline with timeout
    let decision: Awaited<ReturnType<typeof generateAckDecision>>;
    try {
      decision = await Promise.race([
        generateAckDecision(authedReq.userId, content),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("REPLY_TIMEOUT")), REPLY_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === "REPLY_TIMEOUT";
      if (isTimeout) {
        log.warn({ userId: authedReq.userId }, "reply timed out");
        sendJSON(res, 503, Errors.replyTimeout());
      } else {
        captureException(err, { requestId, userId: authedReq.userId });
        log.error({ err }, "generateAckDecision failed");
        sendJSON(res, 500, Errors.internal());
      }
      return;
    }

    const replyText = decision.replyText;
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

    log.info({ userId: authedReq.userId, classifierType: decision.classifierType }, "message sent");
    sendJSON(res, 200, {
      userMessage: { id: `${message.id}:user`, role: "user", content, timestamp: now.toISOString() },
      assistantMessage: { id: `${message.id}:assistant`, role: "assistant", content: replyText, timestamp: repliedAt.toISOString() },
    });
  } catch (err) {
    captureException(err, { requestId, handler: "sendMessage" });
    log.error({ err }, "sendMessage failed");
    sendJSON(res, 500, Errors.internal());
  }
}
