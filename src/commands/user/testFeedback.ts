import { TEST_FEEDBACK_SUCCESS_REPLY } from "../../messages/testFeedback";
import type { CommandContext, CommandResult } from "../types";

export async function handleTestFeedback(_ctx: CommandContext): Promise<CommandResult> {
  return { kind: "reply", text: TEST_FEEDBACK_SUCCESS_REPLY };
}
