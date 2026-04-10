import { prisma } from "../infra/prisma";
import { decryptText } from "../infra/encryption";
import { getOrCreateUserDek } from "../infra/userDek";

export type MessageRow = {
  text: string | null;
  replyText: string | null;
  repliedAt: Date | null;
  createdAt: Date;
  category: string | null;
};

export type FormattedMessageContext = {
  /** "User: X" / "<botLabel>: Y" lines, oldest first */
  lines: string[];
  /** Decrypted messages, oldest first */
  oldestFirst: MessageRow[];
  /** Timestamp of the most recent non-test message before skipFirst, or null if none */
  lastMessageTime: Date | null;
};

/**
 * Fetch, decrypt, and format recent messages for LLM prompts.
 *
 * @param userId   - the user to fetch messages for
 * @param options.fetchLimit  - how many rows to load from DB (default 30)
 * @param options.targetCount - how many to keep after filtering (default 10)
 * @param options.skipFirst   - skip the most-recent message (use when the current
 *                              incoming message is already stored and should be excluded)
 * @param options.botLabel    - prefix for bot reply lines (default "Bot")
 */
export async function fetchFormattedMessageLines(
  userId: string,
  options: {
    fetchLimit?: number;
    targetCount?: number;
    skipFirst?: boolean;
    botLabel?: string;
  } = {}
): Promise<FormattedMessageContext> {
  const {
    fetchLimit = 30,
    targetCount = 10,
    skipFirst = false,
    botLabel = "Bot",
  } = options;

  const raw = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: fetchLimit,
    select: { text: true, createdAt: true, replyText: true, repliedAt: true, category: true },
  });

  const filtered = raw.filter(
    (m) => m.category !== "test_feedback" && m.category !== "command_reply"
  );
  const withoutFirst = skipFirst ? filtered.slice(1) : filtered;
  const lastMessageTime = withoutFirst[0]?.createdAt ?? null;

  const contextSlice = withoutFirst.slice(0, targetCount);
  const oldestFirst = [...contextSlice].reverse();

  const dek = await getOrCreateUserDek(userId);
  for (const m of oldestFirst) {
    if (m.text) m.text = decryptText(m.text, dek);
    if (m.replyText) m.replyText = decryptText(m.replyText, dek);
  }

  const lines: string[] = [];
  for (const m of oldestFirst) {
    if (m.text) lines.push(`User: ${m.text.trim()}`);
    if (m.replyText && m.repliedAt) lines.push(`${botLabel}: ${m.replyText.trim()}`);
  }

  return { lines, oldestFirst, lastMessageTime };
}
