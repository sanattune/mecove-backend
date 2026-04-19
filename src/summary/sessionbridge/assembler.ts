import { renderHtmlToPdf } from "../../infra/pdf";
import { logger } from "../../infra/logger";
import type { WindowBundle } from "../types";
import { buildSessionBridgeHtmlReport } from "./html";
import type { DailyLogBlock, FinalSessionBridge } from "./types";

export function assembleSessionBridgeReport(
  windowBundle: WindowBundle,
  final: FinalSessionBridge
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
  if (final.vocabulary.length === 0) {
    parts.push("No emotion or state words recorded in this window.");
  } else {
    parts.push("| Word | Times | Used when |");
    parts.push("|---|---|---|");
    for (const v of final.vocabulary) {
      const contexts = v.contexts.length > 0 ? v.contexts.join("; ") : "—";
      parts.push(`| ${v.word} | ${v.count} | ${contexts} |`);
    }
  }
  parts.push("");

  parts.push("## Ongoing themes");
  const sortedThemes = [...final.ongoingThemes].sort((a, b) => {
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
  if (final.openQuestions.length === 0) {
    parts.push("No internal questions recorded in this window.");
  } else {
    for (const q of final.openQuestions) {
      parts.push(`- ${q.date} — "${q.question.trim()}"`);
    }
  }
  parts.push("");

  parts.push("## Decisions & options considered");
  if (final.decisions.length === 0) {
    parts.push("No decisions or options named in this window.");
  } else {
    for (const d of final.decisions) {
      parts.push(`- ${d.date} — ${d.text}`);
    }
  }
  parts.push("");

  parts.push("## Appendix · Daily log");
  if (final.dailyLog.length === 0) {
    parts.push("No days logged in this window.");
  } else {
    for (const block of final.dailyLog) {
      parts.push(`### ${block.dateLabel}`);
      for (const bullet of block.bullets) {
        parts.push(`- ${bullet}`);
      }
      parts.push("");
    }
  }

  return parts.join("\n").trimEnd() + "\n";
}

export async function renderSessionBridgePdf(
  windowBundle: WindowBundle,
  final: FinalSessionBridge
): Promise<Buffer> {
  const html = buildSessionBridgeHtmlReport(windowBundle, final);
  logger.info("rendering SessionBridge PDF", { htmlLength: html.length });
  return await renderHtmlToPdf(html);
}

/**
 * Minimal fallback used when the full pipeline fails. Bare-bones brief
 * assembled directly from raw window messages: daily log only.
 */
function monthDayLabel(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export async function buildMinimalFallbackReport(
  windowBundle: WindowBundle
): Promise<{ reportText: string; pdfBytes: Buffer }> {
  const dailyLog: DailyLogBlock[] = windowBundle.days.map((day) => {
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

  const reportText = assembleSessionBridgeReport(windowBundle, minimalFinal);
  const pdfBytes = await renderSessionBridgePdf(windowBundle, minimalFinal);

  return { reportText, pdfBytes };
}
