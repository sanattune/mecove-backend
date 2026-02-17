import "dotenv/config";
import http from "node:http";
import { consentConfig, type ConsentStep } from "../consent/config";
import {
  CONSENT_ACTION_IDS,
  applyConsentAcceptance,
  getPendingConsentStep,
  parseConsentAction,
} from "../consent/state";
import { logger } from "../infra/logger";
import { prisma } from "../infra/prisma";
import { sendWhatsAppButtons, sendWhatsAppReply } from "../infra/whatsapp";
import {
  parseTestFeedbackCommand,
  TEST_FEEDBACK_MISSING_REPLY,
  toStoredTestFeedback,
} from "../messages/testFeedback";
import { JOB_NAME_GENERATE_REPLY, replyQueue } from "../queues/replyQueue";
import { JOB_NAME_FLUSH_REPLY_BATCH, replyBatchQueue } from "../queues/replyBatchQueue";
import {
  JOB_NAME_GENERATE_SUMMARY,
  summaryQueue,
  type GenerateSummaryPayload,
} from "../queues/summaryQueue";
import { REPLY_BATCH_DEBOUNCE_MS } from "../replyBatch/config";
import { appendMessageToBatch, hasPendingBatch } from "../replyBatch/state";

type WhatsAppMessageNode = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
  };
};

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppMessageNode[];
      };
    }>;
  }>;
};

// Fail fast on startup
if (!process.env.REDIS_URL?.trim()) {
  throw new Error("REDIS_URL is required. Set it in .env");
}
if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required. Set it in .env");
}

const port = 3000;

function sendJSON(res: http.ServerResponse, statusCode: number, body: object) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, statusCode: number, body: string) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain");
  res.end(body);
}

function parseQuery(req: http.IncomingMessage): URLSearchParams {
  const url = req.url ?? "";
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function normalizeChannelUserKey(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, "");
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function getInboundMessage(body: WhatsAppWebhookPayload): WhatsAppMessageNode | null {
  return body.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? null;
}

function parseCommand(messageText: string): string | null {
  const trimmed = messageText.trim();
  if (!trimmed.startsWith("/")) return null;
  return trimmed.split(/\s+/)[0].toLowerCase();
}

function buildConsentPromptBody(step: ConsentStep, preface?: string): string {
  const section = consentConfig[step];
  const lines: string[] = [];
  if (preface && preface.trim().length > 0) {
    lines.push(preface.trim());
  }
  lines.push(section.message.trim());
  if (section.link && section.link.trim().length > 0) {
    lines.push(`Read: ${section.link.trim()}`);
  }
  return lines.join("\n\n");
}

async function sendConsentPrompt(
  toDigits: string,
  step: ConsentStep,
  preface?: string
): Promise<void> {
  const section = consentConfig[step];
  const ids = CONSENT_ACTION_IDS[step];
  await sendWhatsAppButtons(toDigits, buildConsentPromptBody(step, preface), [
    { id: ids.accept, title: section.buttons.accept },
    { id: ids.later, title: section.buttons.later },
  ]);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end("OK");
    return;
  }

  const pathname = req.url?.split("?")[0];

  if (req.method === "GET" && pathname === "/webhooks/whatsapp") {
    const params = parseQuery(req);
    const mode = params.get("hub.mode");
    const verifyToken = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
    if (
      mode === "subscribe" &&
      expectedToken &&
      verifyToken === expectedToken &&
      challenge !== null
    ) {
      sendText(res, 200, challenge);
    } else {
      logger.warn("webhook verification failed", { mode, hasToken: !!expectedToken });
      sendText(res, 403, "Forbidden");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/webhooks/whatsapp") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as WhatsAppWebhookPayload;
      const inbound = getInboundMessage(body);
      if (!inbound?.from) {
        sendJSON(res, 200, { ok: true });
        return;
      }

      const channelUserKey = normalizeChannelUserKey(inbound.from);
      const toDigits = channelUserKey.replace(/^\+/, "");

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
      }

      const user = identity.user;
      const pendingStep = getPendingConsentStep(user, consentConfig);
      if (pendingStep !== null) {
        const action = parseConsentAction(inbound);
        if (action?.type === "accept" && action.step === pendingStep) {
          const updatedUser = await prisma.user.update(
            applyConsentAcceptance(user.id, pendingStep, consentConfig[pendingStep].version)
          );
          const nextStep = getPendingConsentStep(updatedUser, consentConfig);
          if (nextStep === null) {
            await sendWhatsAppReply(toDigits, consentConfig.templates.completed);
          } else {
            await sendConsentPrompt(toDigits, nextStep);
          }
        } else {
          const preface =
            action?.type === "later"
              ? consentConfig.templates.later
              : consentConfig.templates.blocked;
          await sendConsentPrompt(toDigits, pendingStep, preface);
        }
        sendJSON(res, 200, { ok: true });
        return;
      }

      // Continue normal processing only for text messages once consent is complete.
      if (inbound.type !== "text") {
        sendJSON(res, 200, { ok: true });
        return;
      }
      const textBody = inbound.text?.body;
      const messageId = inbound.id;
      const timestamp = inbound.timestamp;
      if (!messageId || timestamp === undefined || textBody === undefined) {
        sendJSON(res, 200, { ok: true });
        return;
      }

      const command = parseCommand(textBody);
      const pendingBatch = command ? await hasPendingBatch(user.id) : false;
      const feedbackCommand = parseTestFeedbackCommand(textBody);
      if (!pendingBatch && feedbackCommand.isCommand && feedbackCommand.feedback === null) {
        await sendWhatsAppReply(toDigits, TEST_FEEDBACK_MISSING_REPLY);
        sendJSON(res, 200, { ok: true });
        return;
      }

      const clientTimestamp = new Date(Number(timestamp) * 1000);
      const storedText =
        !pendingBatch && feedbackCommand.isCommand && feedbackCommand.feedback
          ? toStoredTestFeedback(feedbackCommand.feedback)
          : textBody;

      const message = await prisma.message.upsert({
        where: {
          identityId_sourceMessageId: {
            identityId: identity.id,
            sourceMessageId: messageId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          identityId: identity.id,
          contentType: "text",
          text: storedText,
          sourceMessageId: messageId,
          clientTimestamp,
          rawPayload: inbound as object,
        },
      });

      if (command) {
        const mode = pendingBatch ? "busy_notice" : "command";
        await replyQueue.add(JOB_NAME_GENERATE_REPLY, {
          userId: user.id,
          messageId: message.id,
          channelUserKey: toDigits,
          messageText: textBody,
          mode,
        });
        sendJSON(res, 200, { ok: true });
        return;
      }

      const { seq } = await appendMessageToBatch({
        userId: user.id,
        messageId: message.id,
        channelUserKey: toDigits,
        sourceMessageId: messageId,
      });
      await replyBatchQueue.add(
        JOB_NAME_FLUSH_REPLY_BATCH,
        {
          userId: user.id,
          seq,
        },
        {
          delay: REPLY_BATCH_DEBOUNCE_MS,
        }
      );

      logger.info("reply batch scheduled", {
        userId: user.id,
        messageId: message.id,
        seq,
      });

      sendJSON(res, 200, { ok: true });
    } catch (err) {
      logger.error("POST /webhooks/whatsapp error:", err);
      sendJSON(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/debug/consent-status") {
    try {
      const params = parseQuery(req);
      const rawChannelUserKey = params.get("channelUserKey")?.trim();
      if (!rawChannelUserKey) {
        sendJSON(res, 400, {
          ok: false,
          error: "channelUserKey query param is required",
        });
        return;
      }
      const channelUserKey = normalizeChannelUserKey(rawChannelUserKey);

      const identity = await prisma.identity.findUnique({
        where: {
          channel_channelUserKey: {
            channel: "whatsapp",
            channelUserKey,
          },
        },
        include: { user: true },
      });
      if (!identity) {
        sendJSON(res, 404, {
          ok: false,
          error: `Identity not found for ${channelUserKey}`,
        });
        return;
      }

      const pendingStep = getPendingConsentStep(identity.user, consentConfig);
      sendJSON(res, 200, {
        ok: true,
        userId: identity.user.id,
        channelUserKey: identity.channelUserKey,
        pendingStep,
        accepted: {
          privacy: {
            accepted: Boolean(
              identity.user.privacyAcceptedAt &&
                identity.user.privacyAcceptedVersion === consentConfig.privacy.version
            ),
            acceptedAt: identity.user.privacyAcceptedAt,
            acceptedVersion: identity.user.privacyAcceptedVersion,
            currentVersion: consentConfig.privacy.version,
          },
          terms: {
            accepted: Boolean(
              identity.user.termsAcceptedAt &&
                identity.user.termsAcceptedVersion === consentConfig.terms.version
            ),
            acceptedAt: identity.user.termsAcceptedAt,
            acceptedVersion: identity.user.termsAcceptedVersion,
            currentVersion: consentConfig.terms.version,
          },
          mvp: {
            accepted: Boolean(
              identity.user.mvpAcceptedAt &&
                identity.user.mvpAcceptedVersion === consentConfig.mvp.version
            ),
            acceptedAt: identity.user.mvpAcceptedAt,
            acceptedVersion: identity.user.mvpAcceptedVersion,
            currentVersion: consentConfig.mvp.version,
          },
        },
      });
    } catch (err) {
      logger.error("GET /debug/consent-status error:", err);
      sendJSON(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
    return;
  }

  if (
    (req.method === "POST" || req.method === "GET") &&
    pathname === "/debug/enqueue-summary"
  ) {
    try {
      const identity = await prisma.identity.findUnique({
        where: {
          channel_channelUserKey: {
            channel: "whatsapp",
            channelUserKey: "+10000000000",
          },
        },
      });
      if (!identity) {
        sendJSON(res, 404, {
          ok: false,
          error: "Test identity (whatsapp, +10000000000) not found. Run db:smoke first.",
        });
        return;
      }
      const payload: GenerateSummaryPayload = {
        userId: identity.userId,
        channelUserKey: identity.channelUserKey.replace(/^\+/, ""),
        range: "last_15_days",
      };
      const job = await summaryQueue.add(JOB_NAME_GENERATE_SUMMARY, payload);
      logger.info("debug enqueue-summary", { jobId: job.id ?? String(job.id) });
      sendJSON(res, 200, { ok: true, jobId: job.id ?? String(job.id) });
    } catch (err) {
      logger.error("POST /debug/enqueue-summary error:", err);
      sendJSON(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
    return;
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain");
  res.end("Not Found");
});

server.listen(port, () => {
  logger.info("api listening on", `http://localhost:${port}`);
});
