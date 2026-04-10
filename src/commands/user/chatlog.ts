import { prisma } from "../../infra/prisma";
import { decryptText } from "../../infra/encryption";
import { getOrCreateUserDek } from "../../infra/userDek";
import { sendWhatsAppBufferDocument } from "../../infra/whatsapp";
import type { CommandContext, CommandResult } from "../types";

const CHATLOG_SENT_TEXT = "I have sent your chat log as an attachment.";

async function buildAllTimeChatlogMarkdown(userId: string): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, text: true, replyText: true, repliedAt: true, category: true },
  });

  const dek = await getOrCreateUserDek(userId);
  for (const m of messages) {
    if (m.text) m.text = decryptText(m.text, dek);
    if (m.replyText) m.replyText = decryptText(m.replyText, dek);
  }

  const formatTime = (d: Date): string =>
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });

  const lines: string[] = ["# MeCove Chat Log", "", `Generated: ${new Date().toISOString()}`, ""];
  let currentDateHeader = "";
  let hasAnyMessage = false;

  for (const m of messages) {
    if (m.category === "test_feedback" || m.category === "command_reply") continue;
    const userText = (m.text ?? "").trim();
    if (!userText) continue;

    hasAnyMessage = true;
    const dateHeader = m.createdAt.toISOString().slice(0, 10);
    if (dateHeader !== currentDateHeader) {
      currentDateHeader = dateHeader;
      lines.push(`## ${dateHeader}`, "");
    }

    lines.push(`User(${formatTime(m.createdAt)}): ${userText}`);
    if (m.replyText && m.repliedAt) {
      lines.push(`Bot(${formatTime(m.repliedAt)}): ${m.replyText.trim()}`);
    }
    lines.push("");
  }

  if (!hasAnyMessage) lines.push("_No chat messages available._", "");
  return lines.join("\n");
}

export async function handleChatlog({ userId, channelUserKey }: CommandContext): Promise<CommandResult> {
  const chatlog = await buildAllTimeChatlogMarkdown(userId);
  const filename = `mecove-chatlog-${new Date().toISOString().slice(0, 10)}.md`;
  await sendWhatsAppBufferDocument(channelUserKey, Buffer.from(chatlog, "utf8"), filename, "text/plain", "Your chat log is ready.");
  return { kind: "reply", text: CHATLOG_SENT_TEXT };
}
