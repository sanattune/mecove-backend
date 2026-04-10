import { buildHelpText } from "../registry";
import type { CommandContext, CommandResult } from "../types";

export async function handleHelp({ isAdminUser }: CommandContext): Promise<CommandResult> {
  return { kind: "reply", text: buildHelpText(isAdminUser) };
}
