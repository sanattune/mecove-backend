import { logger } from "./logger";

let whatsappReplyEnvWarned = false;

function getWhatsAppEnv(): { phoneId: string; token: string } {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const token = process.env.WHATSAPP_PERMANENT_TOKEN?.trim();
  if (!phoneId || !token) {
    const errorMsg = "WhatsApp reply failed: WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_PERMANENT_TOKEN missing";
    if (!whatsappReplyEnvWarned) {
      whatsappReplyEnvWarned = true;
      logger.error(errorMsg);
    }
    throw new Error(errorMsg);
  }
  return { phoneId, token };
}

/**
 * Sends a plain WhatsApp text reply.
 */
export async function sendWhatsAppReply(toDigits: string, body: string): Promise<void> {
  const { phoneId, token } = getWhatsAppEnv();
  const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: toDigits,
    type: "text",
    text: { body },
  };
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
      logger.error("WhatsApp API error", { status: response.status, error: errorText, payload });
      throw new Error(`WhatsApp API error: ${response.status} ${errorText}`);
    }
  } catch (err) {
    logger.error("WhatsApp reply error:", err);
    throw err;
  }
}

/**
 * Sends a native typing indicator for a received WhatsApp message.
 * This is best-effort and callers should handle failures without interrupting reply flow.
 */
export async function sendWhatsAppTypingIndicator(
  toDigits: string,
  sourceMessageId: string
): Promise<void> {
  const { phoneId, token } = getWhatsAppEnv();
  const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: sourceMessageId,
    typing_indicator: {
      type: "text",
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
    logger.warn("WhatsApp typing indicator failed", {
      toDigits,
      sourceMessageId,
      status: response.status,
      error: errorText,
    });
    throw new Error(`WhatsApp typing indicator error: ${response.status} ${errorText}`);
  }
}

export type WhatsAppReplyButton = {
  id: string;
  title: string;
};

export async function sendWhatsAppButtons(
  toDigits: string,
  body: string,
  buttons: WhatsAppReplyButton[]
): Promise<void> {
  if (buttons.length === 0 || buttons.length > 3) {
    throw new Error("sendWhatsAppButtons requires 1 to 3 buttons");
  }
  const sanitizedButtons = buttons.map((b) => ({
    id: b.id.trim(),
    title: b.title.trim(),
  }));
  const invalid = sanitizedButtons.find(
    (b) => b.id.length === 0 || b.title.length === 0 || b.title.length > 20
  );
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
    logger.error("WhatsApp interactive message error", {
      status: response.status,
      error: errorText,
      payload,
    });
    throw new Error(`WhatsApp interactive message error: ${response.status} ${errorText}`);
  }
}

export async function sendWhatsAppDocument(
  toDigits: string,
  pdfBytes: Buffer,
  filename: string,
  caption?: string
): Promise<void> {
  return sendWhatsAppBufferDocument(
    toDigits,
    pdfBytes,
    filename,
    "application/pdf",
    caption
  );
}

export async function sendWhatsAppBufferDocument(
  toDigits: string,
  fileBytes: Buffer,
  filename: string,
  mimeType: string,
  caption?: string
): Promise<void> {
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
    logger.error("WhatsApp media upload error", {
      status: uploadRes.status,
      error: errorText,
      filename,
      mimeType,
    });
    throw new Error(`WhatsApp media upload error: ${uploadRes.status} ${errorText}`);
  }

  const uploadData = (await uploadRes.json()) as { id?: string };
  const mediaId = uploadData.id;
  if (!mediaId) {
    throw new Error("WhatsApp media upload did not return media id");
  }

  const payload: {
    messaging_product: string;
    to: string;
    type: "document";
    document: { id: string; filename: string; caption?: string };
  } = {
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
    logger.error("WhatsApp document send error", {
      status: sendRes.status,
      error: errorText,
      filename,
      mediaId,
    });
    throw new Error(`WhatsApp document send error: ${sendRes.status} ${errorText}`);
  }
}
