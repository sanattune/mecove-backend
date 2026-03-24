export type CommandDef = {
  name: string;
  description: string;
  adminOnly: boolean;
  hidden?: boolean;
};

export const COMMANDS: CommandDef[] = [
  { name: "/help",     description: "Show available commands",                        adminOnly: false },
  { name: "/guide",   description: "Learn how to use meCove",                        adminOnly: false },
  { name: "/chatlog",  description: "Get your full chat history as a file",           adminOnly: false },
  { name: "/clear",    description: "Delete all your messages and summaries",         adminOnly: false },
  { name: "/stats",    description: "Show your usage stats",                          adminOnly: false },
  { name: "/approve",  description: "/approve <phone> — approve a waitlisted user",  adminOnly: true  },
  { name: "/waitlist", description: "List users waiting for access",                 adminOnly: true  },
  { name: "/revoke",   description: "/revoke <phone> — remove access from a user",   adminOnly: true  },
  { name: "/users",    description: "List all approved users",                       adminOnly: true  },
  { name: "/userstats", description: "Show last activity for all users",              adminOnly: true  },
  { name: "/privacy",  description: "View the privacy and usage notice",              adminOnly: false },
  { name: "/f",        description: "Submit test feedback",                           adminOnly: false, hidden: true },
];

export function buildHelpText(isAdmin: boolean): string {
  const visible = COMMANDS.filter((c) => !c.hidden && (isAdmin || !c.adminOnly));
  return visible.map((c) => `${c.name} — ${c.description}`).join("\n");
}
