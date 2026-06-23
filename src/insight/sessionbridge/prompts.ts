import { renderPrompt } from "../promptLoader";
import type { CanonicalDoc } from "../types";
import type { DraftSessionBridge } from "./types";

export function buildSessionBridgeBriefPrompt(
  canonical: CanonicalDoc,
  windowDays: number
): string {
  return renderPrompt("sessionbridge/brief", {
    WINDOW_DAYS: String(windowDays),
    CANONICAL_JSON: JSON.stringify(canonical),
  });
}

export function buildSessionBridgeGuardfixPrompt(
  canonical: CanonicalDoc,
  draft: DraftSessionBridge,
  windowDays: number
): string {
  return renderPrompt("sessionbridge/guardfix", {
    WINDOW_DAYS: String(windowDays),
    CANONICAL_JSON: JSON.stringify(canonical),
    DRAFT_JSON: JSON.stringify(draft),
  });
}
