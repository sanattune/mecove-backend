import http from "node:http";
import { consentConfig, type ConsentStep } from "../../consent/config";
import { accessConfig, isAdmin, isAllowlisted } from "../../access/config";
import {
  CONSENT_ACTION_IDS,
  applyConsentAcceptance,
  getPendingConsentStep,
  parseConsentAction,
} from "../../consent/state";
import { logger } from "../../infra/logger";
import { prisma } from "../../infra/prisma";
import { getRedis } from "../../infra/redis";
import { sendWhatsAppButtons, sendWhatsAppReply } from "../../infra/whatsapp";
import {
  CHECKIN_TIME_ACTION_IDS,
  checkinPendingKey,
  setCheckinReminder,
  turnOffCheckinReminder,
  type CheckinTime,
} from "../../engagement/checkin/handler";
import {
  parseTestFeedbackCommand,
  TEST_FEEDBACK_MISSING_REPLY,
  toStoredTestFeedback,
} from "../../messages/testFeedback";
import { JOB_NAME_GENERATE_REPLY, replyQueue } from "../../queues/replyQueue";
import { JOB_NAME_FLUSH_REPLY_BATCH, replyBatchQueue } from "../../queues/replyBatchQueue";
import { encryptText } from "../../infra/encryption";
import { getOrCreateUserDek } from "../../infra/userDek";
import {
  JOB_NAME_GENERATE_INSIGHT,
  insightQueue,
  type GenerateInsightPayload,
} from "../../queues/insightQueue";
import type { InsightType } from "../../insight/types";
import { REPLY_BATCH_DEBOUNCE_MS } from "../../replyBatch/config";
import { appendMessageToBatch, hasPendingBatch } from "../../replyBatch/state";
import { sendJSON, sendText } from "../common/sendJSON";
import { parseQuery, readBody } from "../common/httpHelpers";

// ── Types ─────────────────────────────────────────────────────────────────────

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
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: WhatsAppMessageNode[];
      };
    }>;
  }>;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const CONSENT_INTRO_KEY_TTL_SECONDS = 60 * 60 * 24 * 30;

const INSIGHT_RANGE_PROMPT_KEY_VERSION = "v1";
const INSIGHT_TYPE_PROMPT_KEY_VERSION = "v1";
const INSIGHT_CHOSEN_TYPE_KEY_VERSION = "v1";
const INSIGHT_RANGE_PROMPT_TTL_SECONDS = 10 * 60;
const INSIGHT_LOCK_TTL_SECONDS = 15 * 60;
const INSIGHT_ALREADY_RUNNING_TEXT = "Your previous insight is still being generated. Please wait.";
const INSIGHT_DEFAULT_RANGE: GenerateInsightPayload["range"] = "last_15_days";
const INSIGHT_RANGE_ACTION_IDS: Record<string, GenerateInsightPayload["range"]> = {
  insight_range_7: "last_7_days",
  insight_range_15: "last_15_days",
  insight_range_30: "last_30_days",
};
const INSIGHT_TYPE_ACTION_IDS: Record<string, InsightType> = {
  insight_type_sessionbridge: "sessionbridge",
  insight_type_myself_lately: "myself_lately",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeChannelUserKey(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, "");
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function getInboundMessage(body: WhatsAppWebhookPayload): WhatsAppMessageNode | null {
  return body.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? null;
}

function getInboundProfileName(body: WhatsAppWebhookPayload): string | null {
  const rawName = body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name;
  if (typeof rawName !== "string") return null;
  const trimmed = rawName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCommand(messageText: string): string | null {
  const trimmed = messageText.trim();
  if (!trimmed.startsWith("/")) return null;
  return trimmed.split(/\s+/)[0].toLowerCase();
}

async function sendInsightRangePrompts(toDigits: string, insightType: InsightType): Promise<void> {
  const body =
    insightType === "myself_lately"
      ? "How far back should the mirror go? Pick a window."
      : "Pick a window for your activity report.";
  await sendWhatsAppButtons(toDigits, body, [
    { id: "insight_range_7", title: "Last 7 days" },
    { id: "insight_range_15", title: "Last 15 days" },
    { id: "insight_range_30", title: "Last 30 days" },
  ]);
}

function insightRangePromptKey(userId: string): string {
  return `insight:range_prompt:${INSIGHT_RANGE_PROMPT_KEY_VERSION}:${userId}`;
}

function insightTypePromptKey(userId: string): string {
  return `insight:type_prompt:${INSIGHT_TYPE_PROMPT_KEY_VERSION}:${userId}`;
}

function insightChosenTypeKey(userId: string): string {
  return `insight:chosen_type:${INSIGHT_CHOSEN_TYPE_KEY_VERSION}:${userId}`;
}

function isInsightType(value: string | null | undefined): value is InsightType {
  return value === "sessionbridge" || value === "myself_lately";
}

function insightLockKey(userId: string): string {
  return `insight:inflight:${userId}`;
}

function extractInboundActionId(inbound: WhatsAppMessageNode): string | null {
  const interactiveId = inbound.interactive?.button_reply?.id?.trim().toLowerCase() ?? "";
  if (interactiveId) return interactiveId;
  const buttonPayload = inbound.button?.payload?.trim().toLowerCase() ?? "";
  if (buttonPayload) return buttonPayload;
  return null;
}

function insightRangeToDays(range: GenerateInsightPayload["range"]): number {
  if (range === "last_7_days") return 7;
  if (range === "last_30_days") return 30;
  return 15;
}

function buildConsentPromptBody(step: ConsentStep, preface?: string): string {
  const section = consentConfig[step];
  const lines: string[] = [];
  if (preface && preface.trim().length > 0) lines.push(preface.trim());
  if (section.link && section.link.trim().length > 0)
    lines.push(`Detailed Policy: ${section.link.trim()}`);
  lines.push(section.message.trim());
  return lines.join("\n\n");
}

async function sendConsentPrompt(toDigits: string, step: ConsentStep, preface?: string): Promise<void> {
  const section = consentConfig[step];
  const ids = CONSENT_ACTION_IDS[step];
  await sendWhatsAppButtons(toDigits, buildConsentPromptBody(step, preface), [
    { id: ids.accept, title: section.buttons.accept },
    { id: ids.later, title: section.buttons.later },
  ]);
}

// ── Exported handlers ─────────────────────────────────────────────────────────

export async function handleWhatsAppVerification(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const params = parseQuery(req);
  const mode = params.get("hub.mode");
  const verifyToken = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (mode === "subscribe" && expectedToken && verifyToken === expectedToken && challenge !== null) {
    sendText(res, 200, challenge);
  } else {
    logger.warn("webhook verification failed", { mode, hasToken: !!expectedToken });
    sendText(res, 403, "Forbidden");
  }
}

export async function handleWhatsAppWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  preReadBody?: string
): Promise<void> {
  try {
    const raw = preReadBody !== undefined ? preReadBody : await readBody(req);
    if (!raw || raw.trim().length === 0) {
      logger.warn("POST /webhooks/whatsapp received empty body", {
        contentType: req.headers["content-type"],
        contentLength: req.headers["content-length"],
      });
      sendJSON(res, 400, { ok: false, error: "Empty request body" });
      return;
    }

    let body: WhatsAppWebhookPayload;
    try {
      body = JSON.parse(raw) as WhatsAppWebhookPayload;
    } catch (err) {
      logger.warn("POST /webhooks/whatsapp received invalid JSON", {
        contentType: req.headers["content-type"],
        contentLength: req.headers["content-length"],
        rawLength: raw.length,
        error: err instanceof Error ? err.message : String(err),
      });
      sendJSON(res, 400, { ok: false, error: "Invalid JSON" });
      return;
    }

    const inbound = getInboundMessage(body);
    const inboundProfileName = getInboundProfileName(body);
    if (!inbound?.from) {
      sendJSON(res, 200, { ok: true });
      return;
    }

    const channelUserKey = normalizeChannelUserKey(inbound.from);
    const toDigits = channelUserKey.replace(/^\+/, "");

    let identity = await prisma.identity.findUnique({
      where: { channel_channelUserKey: { channel: "whatsapp", channelUserKey } },
      include: { user: true },
    });

    if (!identity) {
      const user = await prisma.user.create({
        data: {
          role: isAdmin(channelUserKey) ? "admin" : "user",
          approvedAt: isAdmin(channelUserKey) || isAllowlisted(channelUserKey) ? new Date() : null,
          settings: { create: {} },
        },
      });
      identity = await prisma.identity.create({
        data: { userId: user.id, channel: "whatsapp", channelUserKey, displayName: inboundProfileName },
        include: { user: true },
      });
    } else if (inboundProfileName && identity.displayName !== inboundProfileName) {
      identity = await prisma.identity.update({
        where: { channel_channelUserKey: { channel: "whatsapp", channelUserKey } },
        data: { displayName: inboundProfileName },
        include: { user: true },
      });
    }

    // Reconcile role/approval for existing users if config has changed
    {
      const updates: { role?: string; approvedAt?: Date } = {};
      if (isAdmin(channelUserKey) && identity.user.role !== "admin") updates.role = "admin";
      if ((isAdmin(channelUserKey) || isAllowlisted(channelUserKey)) && !identity.user.approvedAt) {
        updates.approvedAt = new Date();
      }
      if (Object.keys(updates).length > 0) {
        identity = {
          ...identity,
          user: await prisma.user.update({ where: { id: identity.user.id }, data: updates }),
        };
      }
    }

    const user = identity.user;

    // Approval gate
    if (!user.approvedAt) {
      const redis = getRedis();
      const notifiedKey = `access:waitlist_notified:${user.id}`;
      const alreadyNotified = await redis.get(notifiedKey);
      if (!alreadyNotified) {
        await redis.set(notifiedKey, "1");
        await sendWhatsAppReply(toDigits, accessConfig.messages.waitlist);
      }
      sendJSON(res, 200, { ok: true });
      return;
    }

    // Consent gate
    const pendingStep = getPendingConsentStep(user, consentConfig);
    if (pendingStep !== null) {
      const redis = getRedis();
      const introKey = `onboarding:consent_intro:${consentConfig.welcome.version}:${user.id}`;
      const legacyWelcomeKey = `onboarding:welcome:${consentConfig.welcome.version}:${user.id}`;
      const introAlreadySent = (await redis.get(introKey)) || (await redis.get(legacyWelcomeKey));
      if (!introAlreadySent) {
        await redis.set(introKey, "1", "EX", CONSENT_INTRO_KEY_TTL_SECONDS);
        await sendConsentPrompt(toDigits, pendingStep, consentConfig.welcome.intro);
        sendJSON(res, 200, { ok: true });
        return;
      }
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
          action?.type === "later" ? consentConfig.templates.later : consentConfig.templates.blocked;
        await sendConsentPrompt(toDigits, pendingStep, preface);
      }
      sendJSON(res, 200, { ok: true });
      return;
    }

    // Insight type selection gate
    {
      const redis = getRedis();
      const typePromptKey = insightTypePromptKey(user.id);
      const hasTypePrompt = (await redis.exists(typePromptKey)) > 0;
      if (hasTypePrompt) {
        const actionId = extractInboundActionId(inbound);
        const selectedType = actionId ? INSIGHT_TYPE_ACTION_IDS[actionId] : undefined;
        if (selectedType) {
          await redis.del(typePromptKey);
          await redis.set(insightChosenTypeKey(user.id), selectedType, "EX", INSIGHT_RANGE_PROMPT_TTL_SECONDS);
          await redis.set(insightRangePromptKey(user.id), "0", "EX", INSIGHT_RANGE_PROMPT_TTL_SECONDS);
          await sendInsightRangePrompts(toDigits, selectedType);
          sendJSON(res, 200, { ok: true });
          return;
        }
        await redis.del(typePromptKey);
      }
    }

    // Insight range selection gate
    {
      const redis = getRedis();
      const promptKey = insightRangePromptKey(user.id);
      const hasPrompt = (await redis.exists(promptKey)) > 0;
      if (hasPrompt) {
        const actionId = extractInboundActionId(inbound);
        const selectedRange = actionId ? INSIGHT_RANGE_ACTION_IDS[actionId] : undefined;
        if (selectedRange) {
          await redis.del(promptKey);
          const chosenTypeKey = insightChosenTypeKey(user.id);
          const storedType = await redis.get(chosenTypeKey);
          await redis.del(chosenTypeKey);
          const insightType: InsightType = isInsightType(storedType) ? storedType : "sessionbridge";
          const lockKey = insightLockKey(user.id);
          const lockValue = JSON.stringify({
            messageId: inbound.id ?? "unknown",
            createdAt: new Date().toISOString(),
            range: selectedRange,
            insightType,
          });
          const acquired = await redis.set(lockKey, lockValue, "EX", INSIGHT_LOCK_TTL_SECONDS, "NX");
          if (!acquired) {
            await sendWhatsAppReply(toDigits, INSIGHT_ALREADY_RUNNING_TEXT);
            sendJSON(res, 200, { ok: true });
            return;
          }
          try {
            await insightQueue.add(JOB_NAME_GENERATE_INSIGHT, {
              userId: user.id,
              channelUserKey: toDigits,
              range: selectedRange,
              insightType,
              channel: "whatsapp",
            });
            const kindLabel = insightType === "myself_lately" ? "mirror" : "report";
            await sendWhatsAppReply(
              toDigits,
              `Generating your ${kindLabel} for the last ${insightRangeToDays(selectedRange)} days. Please wait.`
            );
          } catch (err) {
            await redis.del(lockKey);
            logger.error("failed to enqueue insight generation", {
              userId: user.id,
              messageId: inbound.id ?? "unknown",
              error: err instanceof Error ? err.message : String(err),
            });
            await sendWhatsAppReply(toDigits, "Sorry - failed to start the report. Please try again.");
          }
          sendJSON(res, 200, { ok: true });
          return;
        }
        await redis.del(promptKey);
        await redis.del(insightChosenTypeKey(user.id));
      }
    }

    // Check-in time selection gate
    {
      const redis = getRedis();
      const promptKey = checkinPendingKey(user.id);
      const hasPendingCheckin = (await redis.exists(promptKey)) > 0;
      if (hasPendingCheckin) {
        const actionId = extractInboundActionId(inbound);
        const selectedTime = actionId ? CHECKIN_TIME_ACTION_IDS[actionId] : undefined;
        const isTurnOff = actionId === "checkin_off";
        if (selectedTime) {
          await redis.del(promptKey);
          await setCheckinReminder({ userId: user.id, time: selectedTime as CheckinTime, toDigits });
          sendJSON(res, 200, { ok: true });
          return;
        }
        if (isTurnOff) {
          await redis.del(promptKey);
          await turnOffCheckinReminder({ userId: user.id, toDigits });
          sendJSON(res, 200, { ok: true });
          return;
        }
        await redis.del(promptKey);
      }
    }

    // Text-only guard
    if (inbound.type !== "text") {
      sendJSON(res, 200, { ok: true });
      await sendWhatsAppReply(
        toDigits,
        "meCove is a listening space for text — voice notes, images, and other media aren't supported yet. Just type what's on your mind."
      ).catch(() => {});
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
    const messageCategory =
      !pendingBatch && feedbackCommand.isCommand && feedbackCommand.feedback
        ? "test_feedback"
        : command
        ? "command_reply"
        : "user_message";

    const dek = await getOrCreateUserDek(user.id);
    const encryptedText = encryptText(storedText, dek);
    const encryptedRawPayload = encryptText(JSON.stringify(inbound), dek);

    const message = await prisma.message.upsert({
      where: { identityId_sourceMessageId: { identityId: identity.id, sourceMessageId: messageId } },
      update: {},
      create: {
        userId: user.id,
        identityId: identity.id,
        contentType: "text",
        text: encryptedText,
        sourceMessageId: messageId,
        clientTimestamp,
        rawPayload: encryptedRawPayload,
        category: messageCategory,
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
    await replyBatchQueue.add(JOB_NAME_FLUSH_REPLY_BATCH, { userId: user.id, seq }, { delay: REPLY_BATCH_DEBOUNCE_MS });

    logger.info("reply batch scheduled", { userId: user.id, messageId: message.id, seq });
    sendJSON(res, 200, { ok: true });
  } catch (err) {
    logger.error("POST /webhooks/whatsapp error:", err);
    sendJSON(res, 500, { ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
}

export async function handleDebugConsentStatus(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const params = parseQuery(req);
    const rawChannelUserKey = params.get("channelUserKey")?.trim();
    if (!rawChannelUserKey) {
      sendJSON(res, 400, { ok: false, error: "channelUserKey query param is required" });
      return;
    }
    const channelUserKey = normalizeChannelUserKey(rawChannelUserKey);
    const identity = await prisma.identity.findUnique({
      where: { channel_channelUserKey: { channel: "whatsapp", channelUserKey } },
      include: { user: true },
    });
    if (!identity) {
      sendJSON(res, 404, { ok: false, error: `Identity not found for ${channelUserKey}` });
      return;
    }
    const pendingStep = getPendingConsentStep(identity.user, consentConfig);
    sendJSON(res, 200, {
      ok: true,
      userId: identity.user.id,
      channelUserKey: identity.channelUserKey,
      pendingStep,
      accepted: {
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
    sendJSON(res, 500, { ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
}

export async function handleDebugEnqueueInsight(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const identity = await prisma.identity.findUnique({
      where: { channel_channelUserKey: { channel: "whatsapp", channelUserKey: "+10000000000" } },
    });
    if (!identity) {
      sendJSON(res, 404, {
        ok: false,
        error: "Test identity (whatsapp, +10000000000) not found. Run db:smoke first.",
      });
      return;
    }
    const payload: GenerateInsightPayload = {
      userId: identity.userId,
      channelUserKey: identity.channelUserKey.replace(/^\+/, ""),
      range: INSIGHT_DEFAULT_RANGE,
      insightType: "sessionbridge",
      channel: "whatsapp",
    };
    const job = await insightQueue.add(JOB_NAME_GENERATE_INSIGHT, payload);
    logger.info("debug enqueue-insight", { jobId: job.id ?? String(job.id) });
    sendJSON(res, 200, { ok: true, jobId: job.id ?? String(job.id) });
  } catch (err) {
    logger.error("POST /debug/enqueue-insight error:", err);
    sendJSON(res, 500, { ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
}
