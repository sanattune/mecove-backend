import { renderPrompt } from "./promptLoader";
import type {
  CanonicalDoc,
  DraftSessionBridge,
  MirrorDraft,
  PromptVersions,
  WindowBundle,
} from "./types";

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

// ---------------------------------------------------------------------------
// SessionBridge (therapist brief) prompts
// ---------------------------------------------------------------------------

export function buildSessionBridgeBriefPrompt(
  canonical: CanonicalDoc,
  windowDays: number
): string {
  return renderPrompt("sessionbridge-brief", {
    WINDOW_DAYS: String(windowDays),
    CANONICAL_JSON: JSON.stringify(canonical),
  });
}

export function buildSessionBridgeGuardfixPrompt(
  canonical: CanonicalDoc,
  draft: DraftSessionBridge,
  windowDays: number
): string {
  return renderPrompt("sessionbridge-guardfix", {
    WINDOW_DAYS: String(windowDays),
    CANONICAL_JSON: JSON.stringify(canonical),
    DRAFT_JSON: JSON.stringify(draft),
  });
}

// ---------------------------------------------------------------------------
// "Myself, Lately" — mirror report prompts
// ---------------------------------------------------------------------------

export function buildMirrorRecapPrompt(
  canonical: CanonicalDoc,
  windowDays: number
): string {
  return renderPrompt("mirror-recap", {
    WINDOW_DAYS: String(windowDays),
    CANONICAL_JSON: JSON.stringify(canonical),
  });
}

export function buildMirrorGuardfixPrompt(
  canonical: CanonicalDoc,
  draft: MirrorDraft,
  windowDays: number
): string {
  return renderPrompt("mirror-guardfix", {
    WINDOW_DAYS: String(windowDays),
    CANONICAL_JSON: JSON.stringify(canonical),
    DRAFT_JSON: JSON.stringify(draft),
  });
}
