import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type AccessConfig = {
  allowlist: string[];
  admins: string[];
  // last10(phone) -> name (only entries with a non-empty name are stored)
  names: Map<string, string>;
  messages: {
    waitlist: string;
  };
};

function last10(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-10);
}

function normalizePhone(raw: unknown, field: string): { number: string; name: string } {
  let numberRaw: unknown = raw;
  let name = "";
  if (raw && typeof raw === "object" && "number" in (raw as object)) {
    const obj = raw as Record<string, unknown>;
    numberRaw = obj.number;
    if (typeof obj.name === "string" && obj.name.trim().length > 0) {
      name = obj.name.trim();
    }
  }
  if (typeof numberRaw !== "string" || numberRaw.trim().length === 0) {
    throw new Error(`Invalid access config: "${field}" must be a non-empty string or object with "number"`);
  }
  const trimmed = numberRaw.trim();
  const number = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  return { number, name };
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
  const allowlistEntries = rawAllowlist.map((v, i) => normalizePhone(v, `allowlist[${i}]`));

  const rawAdmins = root.admins;
  if (!Array.isArray(rawAdmins)) {
    throw new Error('Invalid access config: "admins" must be an array');
  }
  const adminEntries = rawAdmins.map((v, i) => normalizePhone(v, `admins[${i}]`));

  const messages = root.messages as Record<string, unknown> | undefined;
  if (!messages || typeof messages !== "object") {
    throw new Error('Invalid access config: "messages" section is required');
  }
  const waitlist = messages.waitlist;
  if (typeof waitlist !== "string" || waitlist.trim().length === 0) {
    throw new Error('Invalid access config: "messages.waitlist" must be a non-empty string');
  }

  const names = new Map<string, string>();
  for (const entry of [...allowlistEntries, ...adminEntries]) {
    if (entry.name) {
      names.set(last10(entry.number), entry.name);
    }
  }

  return {
    allowlist: allowlistEntries.map((e) => e.number),
    admins: adminEntries.map((e) => e.number),
    names,
    messages: { waitlist: waitlist.trim() },
  };
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
  const key = last10(channelUserKey);
  return accessConfig.allowlist.some((n) => last10(n) === key);
}

export function isAdmin(channelUserKey: string): boolean {
  const key = last10(channelUserKey);
  return accessConfig.admins.some((n) => last10(n) === key);
}

export function getConfigName(channelUserKey: string): string {
  return accessConfig.names.get(last10(channelUserKey)) ?? "";
}
