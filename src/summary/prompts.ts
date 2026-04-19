import { renderPrompt } from "./promptLoader";
import type { CanonicalDoc, PromptVersions, WindowBundle } from "./types";

export const PROMPT_VERSIONS: PromptVersions = {
  canonicalizer: "canonicalizer_v3",
  sessionbridgeBrief: "sessionbridge_brief_v1",
  sessionbridgeGuardfix: "sessionbridge_guardfix_v1",
  mirrorRecap: "mirror_recap_v3",
  mirrorGuardfix: "mirror_guardfix_v3",
};

export function buildCanonicalizerPrompt(windowBundle: WindowBundle): string {
  return renderPrompt("canonicalizer", {
    WINDOW_DAYS: String(windowBundle.window.days),
    WINDOW_BUNDLE_JSON: JSON.stringify(windowBundle),
  });
}

// Per-report prompt builders live in:
//   src/summary/sessionbridge/prompts.ts
//   src/summary/myself-lately/prompts.ts
// Kept export used by:
export type { CanonicalDoc };
