import { renderHtmlToPdf } from "../infra/pdf";
import type { FinalSections, WindowBundle } from "./types";
import { buildHtmlReport } from "./reportHtml";
import { logger } from "../infra/logger";

export function assembleFinalReport(windowBundle: WindowBundle, finalSections: FinalSections): string {
  const parts: string[] = [];
  parts.push("# SessionBridge 15-Day Summary");
  parts.push("");
  parts.push("## Section 1 - Time Window & Scope");
  parts.push(`Window: ${windowBundle.window.startDate} to ${windowBundle.window.endDate} (last 15 calendar days, ${windowBundle.timezone})`);
  parts.push(`Days with entries: ${windowBundle.counts.daysWithEntries} of ${windowBundle.window.days}`);
  parts.push("Limits: This summary only reflects messages that were logged in this window.");
  parts.push("");
  parts.push("## Section 2 - Observed Patterns & Limits");
  parts.push(finalSections.section2Text.trim());
  parts.push("");
  if (finalSections.section3Included) {
    parts.push("## Section 3 - Open Points for Reflection");
    parts.push(finalSections.section3Text.trim());
    parts.push("");
  }
  parts.push("## Section 4 - Logged Moments");
  if (finalSections.section4Moments.length === 0) {
    parts.push("No logged moments in this window.");
  } else {
    for (const m of finalSections.section4Moments) {
      parts.push(m.dateLabel);
      parts.push(m.content);
      parts.push("");
    }
  }
  return parts.join("\n");
}

/**
 * Render report as PDF using the HTML template (SessionBridge design).
 * This is the only PDF generation method - HTML template is required.
 */
export async function renderReportPdf(
  windowBundle: WindowBundle,
  finalSections: FinalSections
): Promise<Buffer> {
  const html = buildHtmlReport(windowBundle, finalSections);
  logger.info("rendering PDF from HTML template", { htmlLength: html.length });
  return await renderHtmlToPdf(html);
}

export async function buildMinimalFallbackReport(
  windowBundle: WindowBundle
): Promise<{ reportText: string; pdfBytes: Buffer }> {
  const section2 = [
    "- Repetition details are limited due to processing fallback.",
    "Limits: This fallback summary is based on direct reconstruction of logged entries only.",
  ].join("\n");

  const section4Moments: Array<{ dateLabel: string; content: string }> = [];
  for (const day of windowBundle.days) {
    const joined = day.messages.map((m) => m.text.trim()).filter((t) => t.length > 0).join(" ");
    section4Moments.push({
      dateLabel: day.date,
      content: joined || "No text captured for this day.",
    });
  }

  const reportText = [
    "# SessionBridge 15-Day Summary",
    "",
    `## Section 1 - Time Window & Scope`,
    `Window: ${windowBundle.window.startDate} to ${windowBundle.window.endDate} (last 15 calendar days, ${windowBundle.timezone})`,
    `Days with entries: ${windowBundle.counts.daysWithEntries} of ${windowBundle.window.days}`,
    "Limits: This summary only reflects messages that were logged in this window.",
    "",
    "## Section 2 - Observed Patterns & Limits",
    section2,
    "",
    "## Section 4 - Logged Moments",
    section4Moments.map((m) => `${m.dateLabel}\n${m.content}`).join("\n\n"),
    "",
  ].join("\n");

  const minimalFinalSections: FinalSections = {
    status: "PASS",
    changes: [],
    section2Text: section2,
    section3Text: "",
    section3Included: false,
    section4Moments,
  };

  const pdfBytes = await renderReportPdf(windowBundle, minimalFinalSections);

  return {
    reportText,
    pdfBytes,
  };
}

