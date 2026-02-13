"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWhatsAppReply = sendWhatsAppReply;
exports.sendWhatsAppButtons = sendWhatsAppButtons;
exports.sendWhatsAppDocument = sendWhatsAppDocument;
exports.sendWhatsAppBufferDocument = sendWhatsAppBufferDocument;
const logger_1 = require("./logger");
let whatsappReplyEnvWarned = false;
function getWhatsAppEnv() {
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
    return { phoneId, token };
}
/**
 * Sends a WhatsApp reply message. If messageId is provided, sends as a contextual reply
 * (threaded reply to the original message).
 */
async function sendWhatsAppReply(toDigits, body, messageId) {
    const { phoneId, token } = getWhatsAppEnv();
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
async function sendWhatsAppButtons(toDigits, body, buttons) {
    if (buttons.length === 0 || buttons.length > 3) {
        throw new Error("sendWhatsAppButtons requires 1 to 3 buttons");
    }
    const sanitizedButtons = buttons.map((b) => ({
        id: b.id.trim(),
        title: b.title.trim(),
    }));
    const invalid = sanitizedButtons.find((b) => b.id.length === 0 || b.title.length === 0 || b.title.length > 20);
    if (invalid) {
        throw new Error("sendWhatsAppButtons received invalid button id/title");
    }
    const { phoneId, token } = getWhatsAppEnv();
    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
    const payload = {
        messaging_product: "whatsapp",
        to: toDigits,
        type: "interactive",
        interactive: {
            type: "button",
            body: { text: body },
            action: {
                buttons: sanitizedButtons.map((b) => ({
                    type: "reply",
                    reply: {
                        id: b.id,
                        title: b.title,
                    },
                })),
            },
        },
    };
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
        logger_1.logger.error("WhatsApp interactive message error", {
            status: response.status,
            error: errorText,
            payload,
        });
        throw new Error(`WhatsApp interactive message error: ${response.status} ${errorText}`);
    }
}
async function sendWhatsAppDocument(toDigits, pdfBytes, filename, caption) {
    return sendWhatsAppBufferDocument(toDigits, pdfBytes, filename, "application/pdf", caption);
}
async function sendWhatsAppBufferDocument(toDigits, fileBytes, filename, mimeType, caption) {
    const { phoneId, token } = getWhatsAppEnv();
    const mediaUrl = `https://graph.facebook.com/v19.0/${phoneId}/media`;
    const messagesUrl = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    const fileArray = new Uint8Array(fileBytes);
    form.append("file", new Blob([fileArray], { type: mimeType }), filename);
    const uploadRes = await fetch(mediaUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
        },
        body: form,
    });
    if (!uploadRes.ok) {
        const errorText = await uploadRes.text();
        logger_1.logger.error("WhatsApp media upload error", {
            status: uploadRes.status,
            error: errorText,
            filename,
            mimeType,
        });
        throw new Error(`WhatsApp media upload error: ${uploadRes.status} ${errorText}`);
    }
    const uploadData = (await uploadRes.json());
    const mediaId = uploadData.id;
    if (!mediaId) {
        throw new Error("WhatsApp media upload did not return media id");
    }
    const payload = {
        messaging_product: "whatsapp",
        to: toDigits,
        type: "document",
        document: { id: mediaId, filename },
    };
    if (caption && caption.trim().length > 0) {
        payload.document.caption = caption.trim();
    }
    const sendRes = await fetch(messagesUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    if (!sendRes.ok) {
        const errorText = await sendRes.text();
        logger_1.logger.error("WhatsApp document send error", {
            status: sendRes.status,
            error: errorText,
            filename,
            mediaId,
        });
        throw new Error(`WhatsApp document send error: ${sendRes.status} ${errorText}`);
    }
}
