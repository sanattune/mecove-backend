import { buildSummaryPdf } from "../infra/pdf";
import type { FinalSections, WindowBundle } from "./types";

export function buildSection1(windowBundle: WindowBundle): string {
  return [
    "## Section 1 - Time Window & Scope",
    `Window: ${windowBundle.window.startDate} to ${windowBundle.window.endDate} (last 15 calendar days, ${windowBundle.timezone})`,
    `Days with entries: ${windowBundle.counts.daysWithEntries} of ${windowBundle.window.days}`,
    "Limits: This summary only reflects messages that were logged in this window.",
  ].join("\n");
}

export function assembleFinalReport(windowBundle: WindowBundle, finalSections: FinalSections): string {
  const parts: string[] = [];
  parts.push("# SessionBridge 15-Day Summary");
  parts.push("");
  parts.push(buildSection1(windowBundle));
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
  parts.push(finalSections.section4Text.trim());
  parts.push("");
  return parts.join("\n");
}

export function renderReportPdf(reportText: string): Buffer {
  const lines = reportText.split("\n");
  return buildSummaryPdf(lines);
}

export function buildMinimalFallbackReport(windowBundle: WindowBundle): { reportText: string; pdfBytes: Buffer } {
  const section2 = [
    "- Repetition details are limited due to processing fallback.",
    "Limits: This fallback summary is based on direct reconstruction of logged entries only.",
  ].join("\n");

  const section4Lines: string[] = [];
  for (const day of windowBundle.days) {
    const dateHeader = `### ${day.date}`;
    const joined = day.messages.map((m) => m.text.trim()).filter((t) => t.length > 0).join(" ");
    section4Lines.push(dateHeader);
    section4Lines.push(joined || "No text captured for this day.");
    section4Lines.push("");
  }
  if (section4Lines.length === 0) {
    section4Lines.push("No logged messages were found in this 15-day window.");
  }

  const reportText = [
    "# SessionBridge 15-Day Summary",
    "",
    buildSection1(windowBundle),
    "",
    "## Section 2 - Observed Patterns & Limits",
    section2,
    "",
    "## Section 4 - Logged Moments",
    section4Lines.join("\n"),
    "",
  ].join("\n");

  return {
    reportText,
    pdfBytes: renderReportPdf(reportText),
  };
}

