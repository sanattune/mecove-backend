import { renderPrompt } from "../promptLoader";
import type { CanonicalDoc } from "../types";
import type { MirrorDraft } from "./types";

export function buildMirrorRecapPrompt(
  canonical: CanonicalDoc,
  windowDays: number
): string {
  return renderPrompt("myself-lately/recap", {
    WINDOW_DAYS: String(windowDays),
    CANONICAL_JSON: JSON.stringify(canonical),
  });
}

export function buildMirrorGuardfixPrompt(
  canonical: CanonicalDoc,
  draft: MirrorDraft,
  windowDays: number
): string {
  return renderPrompt("myself-lately/guardfix", {
    WINDOW_DAYS: String(windowDays),
    CANONICAL_JSON: JSON.stringify(canonical),
    DRAFT_JSON: JSON.stringify(draft),
  });
}
