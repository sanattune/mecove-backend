import { renderHtmlToPdf } from "../../infra/pdf";
import { logger } from "../../infra/logger";
import type { WindowBundle } from "../types";
import { buildMirrorHtmlReport } from "./html";
import type { FinalMirror, MirrorEntry } from "./types";

/**
 * Deterministic caps on the mirror recap. The LLM guardfix is asked to trim
 * but sometimes overshoots or skips execution, so we enforce list and entry
 * size ceilings in code before the report is rendered.
 */
export function normalizeFinalMirror(finalMirror: FinalMirror): FinalMirror {
  const MAX_PATTERNS = 5;
  const MAX_MOMENTS = 4;
  const MAX_FLAGS = 4;
  const trimEntry = (entry: MirrorEntry): MirrorEntry => ({
    anchor: entry.anchor.trim(),
    body: entry.body.trim().replace(/\s+/g, " "),
  });
  return {
    ...finalMirror,
    openerSentence: finalMirror.openerSentence.trim().replace(/\s+/g, " "),
    patterns: finalMirror.patterns.slice(0, MAX_PATTERNS).map(trimEntry),
    moments: finalMirror.moments.slice(0, MAX_MOMENTS).map(trimEntry),
    flags: finalMirror.flags.slice(0, MAX_FLAGS).map(trimEntry),
  };
}

export function assembleMirrorReport(
  windowBundle: WindowBundle,
  finalMirror: FinalMirror
): string {
  const parts: string[] = [];
  parts.push(`# Myself, Lately`);
  parts.push("");
  parts.push(
    `Window: ${windowBundle.window.startDate} to ${windowBundle.window.endDate} (last ${windowBundle.window.days} calendar days, ${windowBundle.timezone})`
  );
  parts.push(`Days with entries: ${windowBundle.counts.daysWithEntries} of ${windowBundle.window.days}`);
  parts.push("");

  if (finalMirror.openerSentence.trim()) {
    parts.push(finalMirror.openerSentence.trim());
    parts.push("");
  }

  const pushList = (title: string, entries: MirrorEntry[], emptyText: string) => {
    parts.push(`## ${title}`);
    if (entries.length === 0) {
      parts.push(emptyText);
    } else {
      for (const entry of entries) {
        parts.push(`- ${entry.anchor.trim()} — ${entry.body.trim()}`);
      }
    }
    parts.push("");
  };

  pushList(
    "Patterns you kept recording",
    finalMirror.patterns,
    "Nothing repeated across multiple days in this window."
  );
  pushList(
    "Moments worth noticing",
    finalMirror.moments,
    "No stand-out moments in this window."
  );
  pushList(
    "Worth flagging",
    finalMirror.flags,
    "Nothing recurred enough to flag in this window."
  );

  return parts.join("\n").trimEnd() + "\n";
}

export async function renderMirrorPdf(
  windowBundle: WindowBundle,
  finalMirror: FinalMirror
): Promise<Buffer> {
  const html = buildMirrorHtmlReport(windowBundle, finalMirror);
  logger.info("rendering mirror PDF", { htmlLength: html.length });
  return await renderHtmlToPdf(html);
}
