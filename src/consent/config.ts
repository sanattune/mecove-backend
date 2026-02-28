import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type ConsentStep = "mvp";

export type ConsentStepConfig = {
  version: string;
  message: string;
  link?: string;
  buttons: {
    accept: string;
    later: string;
  };
};

export type ConsentConfig = {
  mvp: ConsentStepConfig;
  templates: {
    blocked: string;
    later: string;
    completed: string;
  };
};

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid consent config: "${field}" must be a non-empty string`);
  }
  return value.trim();
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return asNonEmptyString(value, field);
}

function validateButtonLabel(value: unknown, field: string): string {
  const label = asNonEmptyString(value, field);
  if (label.length > 20) {
    throw new Error(`Invalid consent config: "${field}" must be <= 20 characters`);
  }
  return label;
}

function parseStepConfig(raw: unknown, step: ConsentStep): ConsentStepConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid consent config: "${step}" section is required`);
  }
  const section = raw as Record<string, unknown>;
  const buttons = section.buttons as Record<string, unknown> | undefined;
  if (!buttons || typeof buttons !== "object") {
    throw new Error(`Invalid consent config: "${step}.buttons" section is required`);
  }
  return {
    version: asNonEmptyString(section.version, `${step}.version`),
    message: asNonEmptyString(section.message, `${step}.message`),
    link: asOptionalString(section.link, `${step}.link`),
    buttons: {
      accept: validateButtonLabel(buttons.accept, `${step}.buttons.accept`),
      later: validateButtonLabel(buttons.later, `${step}.buttons.later`),
    },
  };
}

function parseConsentConfig(raw: unknown): ConsentConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid consent config: expected top-level object");
  }
  const root = raw as Record<string, unknown>;
  const templates = root.templates as Record<string, unknown> | undefined;
  if (!templates || typeof templates !== "object") {
    throw new Error('Invalid consent config: "templates" section is required');
  }
  return {
    mvp: parseStepConfig(root.mvp, "mvp"),
    templates: {
      blocked: asNonEmptyString(templates.blocked, "templates.blocked"),
      later: asNonEmptyString(templates.later, "templates.later"),
      completed: asNonEmptyString(templates.completed, "templates.completed"),
    },
  };
}

function resolveConfigPath(): string {
  const rawPath = process.env.CONSENT_CONFIG_PATH?.trim();
  if (!rawPath) {
    throw new Error("CONSENT_CONFIG_PATH is required. Set it in .env");
  }
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

export function loadConsentConfigFromEnv(): ConsentConfig {
  const configPath = resolveConfigPath();
  const source = fs.readFileSync(configPath, "utf8");
  const parsed = YAML.parse(source) as unknown;
  return parseConsentConfig(parsed);
}

export const consentConfig = loadConsentConfigFromEnv();
