import { renderHtmlToPdf } from "../../infra/pdf";
import { logger } from "../../infra/logger";
import type { WindowBundle } from "../types";
import { buildMirrorHtmlReport } from "./html";
import type { FinalMirror, MomentEntry } from "./types";

/**
 * Deterministic caps on the mirror recap. The LLM guardfix is asked to trim
 * but sometimes overshoots or skips execution, so we enforce list and entry
 * size ceilings in code before the report is rendered.
 */
export function normalizeFinalMirror(finalMirror: FinalMirror): FinalMirror {
  const MAX_COMING_UP = 5;
  const MAX_MOMENTS = 4;
  const MAX_NOTICE = 4;
  const trimSentence = (s: string): string => s.trim().replace(/\s+/g, " ");
  const trimMoment = (entry: MomentEntry): MomentEntry => ({
    anchor: entry.anchor.trim(),
    body: trimSentence(entry.body),
  });
  return {
    ...finalMirror,
    openerSentence: trimSentence(finalMirror.openerSentence),
    whatHasBeenComingUp: finalMirror.whatHasBeenComingUp
      .slice(0, MAX_COMING_UP)
      .map(trimSentence)
      .filter((s) => s.length > 0),
    momentsThatStoodOut: finalMirror.momentsThatStoodOut
      .slice(0, MAX_MOMENTS)
      .map(trimMoment),
    somethingToNotice: finalMirror.somethingToNotice
      .slice(0, MAX_NOTICE)
      .map(trimSentence)
      .filter((s) => s.length > 0),
    gentleTakeaway: trimSentence(finalMirror.gentleTakeaway),
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

  const pushSentenceList = (title: string, items: string[], emptyText: string) => {
    parts.push(`## ${title}`);
    if (items.length === 0) {
      parts.push(emptyText);
    } else {
      for (const s of items) {
        parts.push(`- ${s.trim()}`);
      }
    }
    parts.push("");
  };

  pushSentenceList(
    "What Has Been Coming Up",
    finalMirror.whatHasBeenComingUp,
    "Nothing repeated across multiple days in this window."
  );

  parts.push(`## Moments That Stood Out`);
  if (finalMirror.momentsThatStoodOut.length === 0) {
    parts.push("No stand-out moments in this window.");
  } else {
    for (const m of finalMirror.momentsThatStoodOut) {
      parts.push(`- ${m.anchor.trim()} — ${m.body.trim()}`);
    }
  }
  parts.push("");

  pushSentenceList(
    "Something to Notice",
    finalMirror.somethingToNotice,
    "Nothing recurred enough to notice in this window."
  );

  parts.push(`## Gentle Takeaway`);
  if (finalMirror.gentleTakeaway.trim()) {
    parts.push(finalMirror.gentleTakeaway.trim());
  } else {
    parts.push("—");
  }
  parts.push("");

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
