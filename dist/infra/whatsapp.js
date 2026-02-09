"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWhatsAppReply = sendWhatsAppReply;
const logger_1 = require("./logger");
let whatsappReplyEnvWarned = false;
/**
 * Sends a WhatsApp reply message. If messageId is provided, sends as a contextual reply
 * (threaded reply to the original message).
 */
async function sendWhatsAppReply(toDigits, body, messageId) {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const token = process.env.WHATSAPP_PERMANENT_TOKEN?.trim();
    if (!phoneId || !token) {
        const errorMsg = "WhatsApp reply failed: WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_PERMANENT_TOKEN missing";
        if (!whatsappReplyEnvWarned) {
            whatsappReplyEnvWarned = true;
            logger_1.logger.error(errorMsg);
        }
        throw new Error(errorMsg);
    }
    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
    const payload = {
        messaging_product: "whatsapp",
        to: toDigits,
        type: "text",
        text: { body },
    };
    // Add context for threaded reply if messageId is provided
    if (messageId) {
        payload.context = { message_id: messageId };
        logger_1.logger.info("sending contextual reply", { messageId, toDigits });
    }
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            logger_1.logger.error("WhatsApp API error", { status: response.status, error: errorText, payload });
            throw new Error(`WhatsApp API error: ${response.status} ${errorText}`);
        }
        // Log successful contextual reply
        if (messageId) {
            logger_1.logger.info("contextual reply sent successfully", { messageId, toDigits });
        }
    }
    catch (err) {
        logger_1.logger.error("WhatsApp reply error:", err);
        throw err;
    }
}
