"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAckReply = generateAckReply;
const prisma_1 = require("../infra/prisma");
const llmViaApi_1 = require("./llmViaApi");
const llm = new llmViaApi_1.LlmViaApi();
const ACK_PROMPT = `You are helping write a short, friendly reply to a user's latest message. Below are the last 10 messages in the conversation (oldest first). The last line is the user's new message.

Rules:
- Write exactly one or two short sentences. A conversational acknowledgment only.
- Be friendly and natural. No system jargon, no "I have noted" or "acknowledged".
- You must output something: never reply with nothing or only whitespace.

Messages:
{{MESSAGES}}

Your reply:`;
/**
 * Fetches the last 10 messages for the user, passes them with the fresh message to the LLM,
 * and returns a short conversational ack reply.
 */
async function generateAckReply(userId, freshMessageText) {
    const messages = await prisma_1.prisma.message.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { text: true, createdAt: true, replyText: true, repliedAt: true },
    });
    const oldestFirst = messages.reverse();
    // Format messages as alternating User/Bot pairs
    const lines = [];
    for (const m of oldestFirst) {
        lines.push(`User: ${m.text ?? "(no text)"}`.trim());
        if (m.replyText && m.repliedAt) {
            lines.push(`Bot: ${m.replyText}`.trim());
        }
    }
    const block = lines.join("\n");
    const prompt = ACK_PROMPT.replace("{{MESSAGES}}", block);
    const reply = await llm.complete({
        prompt,
        maxTokens: 10000, // Sufficient for short conversational replies (1-2 sentences)
    });
    return reply.trim();
}
