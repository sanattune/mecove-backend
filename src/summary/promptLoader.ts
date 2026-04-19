import fs from "node:fs";
import path from "node:path";

const PROMPTS_DIR = path.join(__dirname, "prompts");

/**
 * Names correspond to files in `src/summary/prompts/<name>.md`.
 * Kept narrow so a typo doesn't silently miss a file.
 */
export type PromptName =
  | "canonicalizer"
  | "sessionbridge-brief"
  | "sessionbridge-guardfix"
  | "mirror-recap"
  | "mirror-guardfix";

const promptCache = new Map<PromptName, string>();

function loadPromptTemplate(name: PromptName): string {
  const cached = promptCache.get(name);
  if (cached !== undefined) return cached;
  const p = path.join(PROMPTS_DIR, `${name}.md`);
  if (!fs.existsSync(p)) {
    throw new Error(`Prompt template not found: ${name}.md at ${p}`);
  }
  const content = fs.readFileSync(p, "utf8");
  promptCache.set(name, content);
  return content;
}

/**
 * Render a prompt template by substituting {{PLACEHOLDER}} tokens with the
 * values in `vars`. Missing placeholders throw — editors shouldn't remove
 * required inputs silently.
 */
export function renderPrompt(name: PromptName, vars: Record<string, string>): string {
  const template = loadPromptTemplate(name);
  const missing: string[] = [];

  const rendered = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      missing.push(key);
      return "";
    }
    return vars[key];
  });

  if (missing.length > 0) {
    throw new Error(
      `Prompt ${name}.md is missing required values: ${Array.from(new Set(missing)).join(", ")}`
    );
  }
  return rendered;
}
