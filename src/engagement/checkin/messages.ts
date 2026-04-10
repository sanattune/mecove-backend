import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

type CheckinConfig = {
  messages: string[];
};

const config = parse(
  readFileSync(join(__dirname, "checkin.yaml"), "utf8")
) as CheckinConfig;

export function pickCheckinMessage(): string {
  const msgs = config.messages;
  return msgs[Math.floor(Math.random() * msgs.length)];
}
