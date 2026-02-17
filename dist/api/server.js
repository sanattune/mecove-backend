"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_http_1 = __importDefault(require("node:http"));
const config_1 = require("../consent/config");
const state_1 = require("../consent/state");
const logger_1 = require("../infra/logger");
const prisma_1 = require("../infra/prisma");
const whatsapp_1 = require("../infra/whatsapp");
const testFeedback_1 = require("../messages/testFeedback");
const replyQueue_1 = require("../queues/replyQueue");
const replyBatchQueue_1 = require("../queues/replyBatchQueue");
const summaryQueue_1 = require("../queues/summaryQueue");
const config_2 = require("../replyBatch/config");
const state_2 = require("../replyBatch/state");
// Fail fast on startup
if (!process.env.REDIS_URL?.trim()) {
    throw new Error("REDIS_URL is required. Set it in .env");
}
if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required. Set it in .env");
}
const port = 3000;
function sendJSON(res, statusCode, body) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
}
function sendText(res, statusCode, body) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "text/plain");
    res.end(body);
}
function parseQuery(req) {
    const url = req.url ?? "";
    const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    return new URLSearchParams(q);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
function normalizeChannelUserKey(raw) {
    const normalized = raw.trim().replace(/\s+/g, "");
    return normalized.startsWith("+") ? normalized : `+${normalized}`;
}
function getInboundMessage(body) {
    return body.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? null;
}
function parseCommand(messageText) {
    const trimmed = messageText.trim();
    if (!trimmed.startsWith("/"))
        return null;
    return trimmed.split(/\s+/)[0].toLowerCase();
}
function buildConsentPromptBody(step, preface) {
    const section = config_1.consentConfig[step];
    const lines = [];
    if (preface && preface.trim().length > 0) {
        lines.push(preface.trim());
    }
    lines.push(section.message.trim());
    if (section.link && section.link.trim().length > 0) {
        lines.push(`Read: ${section.link.trim()}`);
    }
    return lines.join("\n\n");
}
async function sendConsentPrompt(toDigits, step, preface) {
    const section = config_1.consentConfig[step];
    const ids = state_1.CONSENT_ACTION_IDS[step];
    await (0, whatsapp_1.sendWhatsAppButtons)(toDigits, buildConsentPromptBody(step, preface), [
        { id: ids.accept, title: section.buttons.accept },
        { id: ids.later, title: section.buttons.later },
    ]);
}
const server = node_http_1.default.createServer(async (req, res) => {
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
        if (mode === "subscribe" &&
            expectedToken &&
            verifyToken === expectedToken &&
            challenge !== null) {
            sendText(res, 200, challenge);
        }
        else {
            logger_1.logger.warn("webhook verification failed", { mode, hasToken: !!expectedToken });
            sendText(res, 403, "Forbidden");
        }
        return;
    }
    if (req.method === "POST" && pathname === "/webhooks/whatsapp") {
        try {
            const raw = await readBody(req);
            const body = JSON.parse(raw);
            const inbound = getInboundMessage(body);
            if (!inbound?.from) {
                sendJSON(res, 200, { ok: true });
                return;
            }
            const channelUserKey = normalizeChannelUserKey(inbound.from);
            const toDigits = channelUserKey.replace(/^\+/, "");
            let identity = await prisma_1.prisma.identity.findUnique({
                where: {
                    channel_channelUserKey: {
                        channel: "whatsapp",
                        channelUserKey,
                    },
                },
                include: { user: true },
            });
            if (!identity) {
                const user = await prisma_1.prisma.user.create({ data: {} });
                identity = await prisma_1.prisma.identity.create({
                    data: {
                        userId: user.id,
                        channel: "whatsapp",
                        channelUserKey,
                    },
                    include: { user: true },
                });
            }
            const user = identity.user;
            const pendingStep = (0, state_1.getPendingConsentStep)(user, config_1.consentConfig);
            if (pendingStep !== null) {
                const action = (0, state_1.parseConsentAction)(inbound);
                if (action?.type === "accept" && action.step === pendingStep) {
                    const updatedUser = await prisma_1.prisma.user.update((0, state_1.applyConsentAcceptance)(user.id, pendingStep, config_1.consentConfig[pendingStep].version));
                    const nextStep = (0, state_1.getPendingConsentStep)(updatedUser, config_1.consentConfig);
                    if (nextStep === null) {
                        await (0, whatsapp_1.sendWhatsAppReply)(toDigits, config_1.consentConfig.templates.completed);
                    }
                    else {
                        await sendConsentPrompt(toDigits, nextStep);
                    }
                }
                else {
                    const preface = action?.type === "later"
                        ? config_1.consentConfig.templates.later
                        : config_1.consentConfig.templates.blocked;
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
            const pendingBatch = command ? await (0, state_2.hasPendingBatch)(user.id) : false;
            const feedbackCommand = (0, testFeedback_1.parseTestFeedbackCommand)(textBody);
            if (!pendingBatch && feedbackCommand.isCommand && feedbackCommand.feedback === null) {
                await (0, whatsapp_1.sendWhatsAppReply)(toDigits, testFeedback_1.TEST_FEEDBACK_MISSING_REPLY);
                sendJSON(res, 200, { ok: true });
                return;
            }
            const clientTimestamp = new Date(Number(timestamp) * 1000);
            const storedText = !pendingBatch && feedbackCommand.isCommand && feedbackCommand.feedback
                ? (0, testFeedback_1.toStoredTestFeedback)(feedbackCommand.feedback)
                : textBody;
            const message = await prisma_1.prisma.message.upsert({
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
                    rawPayload: inbound,
                },
            });
            if (command) {
                const mode = pendingBatch ? "busy_notice" : "command";
                await replyQueue_1.replyQueue.add(replyQueue_1.JOB_NAME_GENERATE_REPLY, {
                    userId: user.id,
                    messageId: message.id,
                    channelUserKey: toDigits,
                    messageText: textBody,
                    mode,
                });
                sendJSON(res, 200, { ok: true });
                return;
            }
            const { seq } = await (0, state_2.appendMessageToBatch)({
                userId: user.id,
                messageId: message.id,
                channelUserKey: toDigits,
                sourceMessageId: messageId,
            });
            await replyBatchQueue_1.replyBatchQueue.add(replyBatchQueue_1.JOB_NAME_FLUSH_REPLY_BATCH, {
                userId: user.id,
                seq,
            }, {
                delay: config_2.REPLY_BATCH_DEBOUNCE_MS,
            });
            logger_1.logger.info("reply batch scheduled", {
                userId: user.id,
                messageId: message.id,
                seq,
            });
            sendJSON(res, 200, { ok: true });
        }
        catch (err) {
            logger_1.logger.error("POST /webhooks/whatsapp error:", err);
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
            const identity = await prisma_1.prisma.identity.findUnique({
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
            const pendingStep = (0, state_1.getPendingConsentStep)(identity.user, config_1.consentConfig);
            sendJSON(res, 200, {
                ok: true,
                userId: identity.user.id,
                channelUserKey: identity.channelUserKey,
                pendingStep,
                accepted: {
                    privacy: {
                        accepted: Boolean(identity.user.privacyAcceptedAt &&
                            identity.user.privacyAcceptedVersion === config_1.consentConfig.privacy.version),
                        acceptedAt: identity.user.privacyAcceptedAt,
                        acceptedVersion: identity.user.privacyAcceptedVersion,
                        currentVersion: config_1.consentConfig.privacy.version,
                    },
                    terms: {
                        accepted: Boolean(identity.user.termsAcceptedAt &&
                            identity.user.termsAcceptedVersion === config_1.consentConfig.terms.version),
                        acceptedAt: identity.user.termsAcceptedAt,
                        acceptedVersion: identity.user.termsAcceptedVersion,
                        currentVersion: config_1.consentConfig.terms.version,
                    },
                    mvp: {
                        accepted: Boolean(identity.user.mvpAcceptedAt &&
                            identity.user.mvpAcceptedVersion === config_1.consentConfig.mvp.version),
                        acceptedAt: identity.user.mvpAcceptedAt,
                        acceptedVersion: identity.user.mvpAcceptedVersion,
                        currentVersion: config_1.consentConfig.mvp.version,
                    },
                },
            });
        }
        catch (err) {
            logger_1.logger.error("GET /debug/consent-status error:", err);
            sendJSON(res, 500, {
                ok: false,
                error: err instanceof Error ? err.message : "Unknown error",
            });
        }
        return;
    }
    if ((req.method === "POST" || req.method === "GET") &&
        pathname === "/debug/enqueue-summary") {
        try {
            const identity = await prisma_1.prisma.identity.findUnique({
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
            const payload = {
                userId: identity.userId,
                channelUserKey: identity.channelUserKey.replace(/^\+/, ""),
                range: "last_15_days",
            };
            const job = await summaryQueue_1.summaryQueue.add(summaryQueue_1.JOB_NAME_GENERATE_SUMMARY, payload);
            logger_1.logger.info("debug enqueue-summary", { jobId: job.id ?? String(job.id) });
            sendJSON(res, 200, { ok: true, jobId: job.id ?? String(job.id) });
        }
        catch (err) {
            logger_1.logger.error("POST /debug/enqueue-summary error:", err);
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
    logger_1.logger.info("api listening on", `http://localhost:${port}`);
});
