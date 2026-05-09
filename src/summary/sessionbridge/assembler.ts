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

  parts.push("## Observed Themes");
  const sortedThemes = [...final.observedThemes].sort((a, b) => {
    if (b.dayCount !== a.dayCount) return b.dayCount - a.dayCount;
    return a.label.localeCompare(b.label);
  });
  if (sortedThemes.length === 0) {
    parts.push("No topical themes recurred across multiple days in this window.");
  } else {
    for (const t of sortedThemes) {
      parts.push(`- ${t.label} (${t.dayCount} days)`);
    }
  }
  parts.push("");

  parts.push("## Signals Worth Attention");
  if (final.signalsWorthAttention.length === 0) {
    parts.push("No internal-state recurrences in this window.");
  } else {
    for (const s of final.signalsWorthAttention) {
      parts.push(`- ${s.trim()}`);
    }
  }
  parts.push("");

  parts.push("## Moments of Variation");
  if (final.momentsOfVariation.length === 0) {
    parts.push("No moments of variation recorded in this window.");
  } else {
    for (const m of final.momentsOfVariation) {
      const ctx = m.context.trim();
      const tail = ctx.length > 0 ? ` — ${ctx}` : "";
      parts.push(`- ${m.date} — "${m.quote.trim()}"${tail}`);
    }
  }
  parts.push("");

  parts.push("## Open Questions");
  if (final.openQuestions.length === 0) {
    parts.push("No internal questions recorded in this window.");
  } else {
    for (const q of final.openQuestions) {
      parts.push(`- ${q.date} — "${q.question.trim()}"`);
    }
  }
  parts.push("");

  parts.push("## Decisions / Intentions");
  if (final.decisionsAndIntentions.length === 0) {
    parts.push("No decisions or intentions named in this window.");
  } else {
    for (const d of final.decisionsAndIntentions) {
      parts.push(`- ${d.date} — ${d.text}`);
    }
  }
  parts.push("");

  parts.push("## Words Used in Context");
  if (final.wordsInContext.length === 0) {
    parts.push("No emotion-bearing statements recorded in this window.");
  } else {
    parts.push("| Statement / Context | Reflects |");
    parts.push("|---|---|");
    for (const w of final.wordsInContext) {
      const reflects = w.reflects && w.reflects.trim().length > 0 ? w.reflects.trim() : "—";
      parts.push(`| "${w.statement.trim()}" | ${reflects} |`);
    }
  }
  parts.push("");

  parts.push("## Appendix · Daily Log");
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
    changes: ["Fallback used: theme/signal/variation/words extraction skipped."],
    observedThemes: [],
    signalsWorthAttention: [],
    momentsOfVariation: [],
    openQuestions: [],
    decisionsAndIntentions: [],
    wordsInContext: [],
    dailyLog,
  };

  const reportText = assembleSessionBridgeReport(windowBundle, minimalFinal);
  const pdfBytes = await renderSessionBridgePdf(windowBundle, minimalFinal);

  return { reportText, pdfBytes };
}
