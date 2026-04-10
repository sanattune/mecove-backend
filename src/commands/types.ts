export type CommandContext = {
  userId: string;
  messageId: string;
  channelUserKey: string;
  messageText: string;
  isAdminUser: boolean;
  command: string;
};

export type CommandResult =
  | { kind: "reply"; text: string }
  | { kind: "reply_no_persist"; text: string }
  | { kind: "handled" };
