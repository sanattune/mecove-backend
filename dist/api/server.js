"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_http_1 = __importDefault(require("node:http"));
const prisma_1 = require("../infra/prisma");
const logger_1 = require("../infra/logger");
const summaryQueue_1 = require("../queues/summaryQueue");
function getInboundTextMessageSender(body) {
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg || msg.type !== "text" || !msg.text?.body)
        return null;
    return msg.from ?? null;
}
function getInboundTextMessage(body) {
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg)
        return { messageId: undefined, timestamp: undefined, textBody: undefined, messageNode: undefined };
    return {
        messageId: msg.id,
        timestamp: msg.timestamp,
        textBody: msg.type === "text" ? msg.text?.body : undefined,
        messageNode: msg,
    };
}
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
let whatsappReplyEnvWarned = false;
function sendWhatsAppReplyAsync(toDigits) {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const token = process.env.WHATSAPP_PERMANENT_TOKEN?.trim();
    if (!phoneId || !token) {
        if (!whatsappReplyEnvWarned) {
            whatsappReplyEnvWarned = true;
            logger_1.logger.warn("WhatsApp reply skipped: WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_PERMANENT_TOKEN missing");
        }
        return;
    }
    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
    fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            to: toDigits,
            type: "text",
            text: { body: "Noted." },
        }),
    })
        .then(async (r) => {
        if (!r.ok)
            logger_1.logger.warn("WhatsApp reply non-OK", r.status, await r.text());
        else
            logger_1.logger.info("WhatsApp reply sent to", toDigits);
    })
        .catch((err) => logger_1.logger.error("WhatsApp reply error:", err));
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
            logger_1.logger.info("GET /webhooks/whatsapp verification OK");
            sendText(res, 200, challenge);
        }
        else {
            logger_1.logger.warn("GET /webhooks/whatsapp verification failed", { mode, hasToken: !!expectedToken });
            sendText(res, 403, "Forbidden");
        }
        return;
    }
    if (req.method === "POST" && pathname === "/webhooks/whatsapp") {
        try {
            const raw = await readBody(req);
            const body = JSON.parse(raw);
            const from = getInboundTextMessageSender(body);
            if (from === null) {
                logger_1.logger.info("POST /webhooks/whatsapp: no text message, ignored");
                sendJSON(res, 200, { ok: true });
                return;
            }
            const { messageId, timestamp, textBody, messageNode } = getInboundTextMessage(body);
            if (!messageId || timestamp === undefined || textBody === undefined) {
                sendJSON(res, 200, { ok: true });
                return;
            }
            // Normalize sender phone (single leading +)
            const channelUserKey = from.startsWith("+") ? from : `+${from}`;
            // Find or create user for this phone number (one user per WhatsApp number)
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
                logger_1.logger.info("new user and identity created for phone", channelUserKey, { userId: identity.userId });
            }
            const user = identity.user;
            const clientTimestamp = new Date(Number(timestamp) * 1000);
            await prisma_1.prisma.message.upsert({
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
                    text: textBody,
                    sourceMessageId: messageId,
                    clientTimestamp,
                    rawPayload: (messageNode ?? body),
                },
            });
            await summaryQueue_1.summaryQueue.add(summaryQueue_1.JOB_NAME_GENERATE_SUMMARY, {
                userId: user.id,
                range: "last_7_days",
            });
            logger_1.logger.info("webhook message stored and summary enqueued", {
                from: channelUserKey,
                messageId,
                userId: user.id,
            });
            sendWhatsAppReplyAsync(from.replace(/^\+/, ""));
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
                range: "last_7_days",
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
