import { COMMANDS } from "./registry";
import { TEST_FEEDBACK_COMMAND } from "../messages/testFeedback";
import { handleHelp } from "./user/help";
import { handleGuide } from "./user/guide";
import { handleChatlog } from "./user/chatlog";
import { handleClear } from "./user/clear";
import { handleStats } from "./user/stats";
import { handlePrivacy } from "./user/privacy";
import { handleTestFeedback } from "./user/testFeedback";
import { handleCheckin } from "./user/checkin";
import { handleApprove } from "./admin/approve";
import { handleWaitlist } from "./admin/waitlist";
import { handleRevoke } from "./admin/revoke";
import { handleUsers } from "./admin/users";
import { handleUserStats } from "./admin/userstats";
import type { CommandContext, CommandResult } from "./types";

const UNKNOWN_COMMAND_TEXT = "Unknown command. Type /help to see available commands.";

const ROUTER: Record<string, (ctx: CommandContext) => Promise<CommandResult>> = {
  "/help":                  handleHelp,
  "/guide":                 handleGuide,
  "/chatlog":               handleChatlog,
  "/clear":                 handleClear,
  "/stats":                 handleStats,
  "/privacy":               handlePrivacy,
  [TEST_FEEDBACK_COMMAND]:  handleTestFeedback,
  "/checkin":               handleCheckin,
  "/approve":               handleApprove,
  "/waitlist":              handleWaitlist,
  "/revoke":                handleRevoke,
  "/users":                 handleUsers,
  "/userstats":             handleUserStats,
};

export async function handleCommand(ctx: CommandContext): Promise<CommandResult> {
  const commandDef = COMMANDS.find((c) => c.name === ctx.command);
  if (commandDef?.adminOnly && !ctx.isAdminUser) {
    return { kind: "reply", text: UNKNOWN_COMMAND_TEXT };
  }

  const handler = ROUTER[ctx.command];
  if (!handler) {
    return { kind: "reply", text: UNKNOWN_COMMAND_TEXT };
  }

  return handler(ctx);
}
