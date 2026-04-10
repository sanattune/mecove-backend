import { getFullGuide } from "../../guides/content";
import type { CommandContext, CommandResult } from "../types";

export async function handleGuide({ isAdminUser }: CommandContext): Promise<CommandResult> {
  return { kind: "reply", text: getFullGuide(isAdminUser) };
}
