import { consentConfig } from "../../consent/config";
import type { CommandContext, CommandResult } from "../types";

export async function handlePrivacy(_ctx: CommandContext): Promise<CommandResult> {
  const mvp = consentConfig.mvp;
  const parts: string[] = [];
  if (mvp.link) parts.push(`Privacy & Usage Notice: ${mvp.link}`);
  parts.push(mvp.message);
  return { kind: "reply", text: parts.join("\n\n") };
}
