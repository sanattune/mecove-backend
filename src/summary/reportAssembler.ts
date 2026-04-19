import { renderHtmlToPdf } from "../infra/pdf";
import type {
  DailyLogBlock,
  FinalMirror,
  FinalSessionBridge,
  WindowBundle,
} from "./types";
import { buildHtmlReport, buildMirrorHtmlReport } from "./reportHtml";
import { logger } from "../infra/logger";

export function assembleFinalReport(
  windowBundle: WindowBundle,
  finalSessionBridge: FinalSessionBridge
): string {
  const parts: string[] = [];
  parts.push(`# SessionBridge ${windowBundle.window.days}-Day Brief`);
  parts.push("");
  parts.push(
    `Window: ${windowBundle.window.startDate} to ${windowBundle.window.endDate} (last ${windowBundle.window.days} calendar days, ${windowBundle.timezone})`
  );
  parts.push(`Days with entries: ${windowBundle.counts.daysWithEntries} of ${windowBundle.window.days}`);
  parts.push("");

  parts.push("## Recorded vocabulary");
  if (finalSessionBridge.vocabulary.length === 0) {
    parts.push("No emotion or state words recorded in this window.");
  } else {
    parts.push("| Word | Times | Used when |");
    parts.push("|---|---|---|");
    for (const v of finalSessionBridge.vocabulary) {
      const contexts = v.contexts.length > 0 ? v.contexts.join("; ") : "—";
      parts.push(`| ${v.word} | ${v.count} | ${contexts} |`);
    }
  }
  parts.push("");

  parts.push("## Ongoing themes");
  const sortedThemes = [...finalSessionBridge.ongoingThemes].sort((a, b) => {
    if (b.dayCount !== a.dayCount) return b.dayCount - a.dayCount;
    return a.label.localeCompare(b.label);
  });
  if (sortedThemes.length === 0) {
    parts.push("No themes recurred across multiple days in this window.");
  } else {
    for (const t of sortedThemes) {
      parts.push(`- ${t.label} (${t.dayCount} days)`);
    }
  }
  parts.push("");

  parts.push("## Open questions");
  if (finalSessionBridge.openQuestions.length === 0) {
    parts.push("No internal questions recorded in this window.");
  } else {
    for (const q of finalSessionBridge.openQuestions) {
      parts.push(`- ${q.date} — "${q.question.trim()}"`);
    }
  }
  parts.push("");

  parts.push("## Decisions & options considered");
  if (finalSessionBridge.decisions.length === 0) {
    parts.push("No decisions or options named in this window.");
  } else {
    for (const d of finalSessionBridge.decisions) {
      parts.push(`- ${d.date} — ${d.text}`);
    }
  }
  parts.push("");

  parts.push("## Appendix · Daily log");
  if (finalSessionBridge.dailyLog.length === 0) {
    parts.push("No days logged in this window.");
  } else {
    for (const block of finalSessionBridge.dailyLog) {
      parts.push(`### ${block.dateLabel}`);
      for (const bullet of block.bullets) {
        parts.push(`- ${bullet}`);
      }
      parts.push("");
    }
  }

  return parts.join("\n").trimEnd() + "\n";
}

/**
 * Render report as PDF using the HTML template (SessionBridge design).
 */
export async function renderReportPdf(
  windowBundle: WindowBundle,
  finalSessionBridge: FinalSessionBridge
): Promise<Buffer> {
  const html = buildHtmlReport(windowBundle, finalSessionBridge);
  logger.info("rendering PDF from HTML template", { htmlLength: html.length });
  return await renderHtmlToPdf(html);
}

// ---------------------------------------------------------------------------
// "Myself, Lately" — mirror report assembly
// ---------------------------------------------------------------------------

export function assembleFinalMirrorReport(
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

  const pushList = (
    title: string,
    entries: typeof finalMirror.patterns,
    emptyText: string
  ) => {
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

export async function renderMirrorReportPdf(
  windowBundle: WindowBundle,
  finalMirror: FinalMirror
): Promise<Buffer> {
  const html = buildMirrorHtmlReport(windowBundle, finalMirror);
  logger.info("rendering mirror PDF from HTML template", { htmlLength: html.length });
  return await renderHtmlToPdf(html);
}

// ---------------------------------------------------------------------------
// Minimal fallback — used by the worker when the full pipeline fails.
// Produces a bare-bones SessionBridge brief directly from the raw window
// messages: daily log only, no vocabulary or numeric extraction.
// ---------------------------------------------------------------------------

function monthDayLabel(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export async function buildMinimalFallbackReport(
  windowBundle: WindowBundle
): Promise<{ reportText: string; pdfBytes: Buffer }> {
  const dailyLog: DailyLogBlock[] = windowBundle.days
    .map((day) => {
      const bullets = day.messages
        .map((m) => m.text.trim())
        .filter((t) => t.length > 0);
      return {
        dateLabel: monthDayLabel(day.date),
        bullets: bullets.length > 0 ? bullets : ["No text captured for this day."],
      };
    });

  const minimalFinal: FinalSessionBridge = {
    status: "PASS",
    changes: ["Fallback used: vocabulary and theme extraction skipped."],
    vocabulary: [],
    ongoingThemes: [],
    openQuestions: [],
    decisions: [],
    dailyLog,
  };

  const reportText = assembleFinalReport(windowBundle, minimalFinal);
  const pdfBytes = await renderReportPdf(windowBundle, minimalFinal);

  return { reportText, pdfBytes };
}
