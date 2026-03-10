import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type AccessConfig = {
  allowlist: string[];
  admins: string[];
  messages: {
    waitlist: string;
  };
};

function normalizePhone(raw: unknown, field: string): string {
  // Accept plain string or { number: string, name?: string }
  let value: unknown = raw;
  if (raw && typeof raw === "object" && "number" in (raw as object)) {
    value = (raw as Record<string, unknown>).number;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid access config: "${field}" must be a non-empty string or object with "number"`);
  }
  const trimmed = value.trim();
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function parseAccessConfig(raw: unknown): AccessConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid access config: expected top-level object");
  }
  const root = raw as Record<string, unknown>;

  const rawAllowlist = root.allowlist;
  if (!Array.isArray(rawAllowlist)) {
    throw new Error('Invalid access config: "allowlist" must be an array');
  }
  const allowlist = rawAllowlist.map((v, i) => normalizePhone(v, `allowlist[${i}]`));

  const rawAdmins = root.admins;
  if (!Array.isArray(rawAdmins)) {
    throw new Error('Invalid access config: "admins" must be an array');
  }
  const admins = rawAdmins.map((v, i) => normalizePhone(v, `admins[${i}]`));

  const messages = root.messages as Record<string, unknown> | undefined;
  if (!messages || typeof messages !== "object") {
    throw new Error('Invalid access config: "messages" section is required');
  }
  const waitlist = messages.waitlist;
  if (typeof waitlist !== "string" || waitlist.trim().length === 0) {
    throw new Error('Invalid access config: "messages.waitlist" must be a non-empty string');
  }

  return { allowlist, admins, messages: { waitlist: waitlist.trim() } };
}

function resolveConfigPath(): string {
  const rawPath = process.env.MVP_ACCESS_CONFIG_PATH?.trim();
  if (rawPath) {
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  }
  return path.resolve(process.cwd(), "mvp-access.config.yaml");
}

export function loadAccessConfigFromEnv(): AccessConfig {
  const configPath = resolveConfigPath();
  const source = fs.readFileSync(configPath, "utf8");
  const parsed = YAML.parse(source) as unknown;
  return parseAccessConfig(parsed);
}

export const accessConfig = loadAccessConfigFromEnv();

export function isAllowlisted(channelUserKey: string): boolean {
  return accessConfig.allowlist.includes(channelUserKey);
}

export function isAdmin(channelUserKey: string): boolean {
  return accessConfig.admins.includes(channelUserKey);
}
