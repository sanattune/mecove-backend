import { loadReportCss, loadReportHtml, loadImageAsDataUrl } from "./templateLoader";
import type { FinalSections, Section4Moment, WindowBundle } from "./types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turn plain text into HTML paragraphs using report template classes.
 * Double newlines become separate paragraphs; single newlines become <br>.
 */
function textToParagraphsHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "<p class=\"text-63\"><span class=\"text-rgb-54-65-83\">—</span></p>";
  const paragraphs = trimmed.split(/\n\s*\n/).filter((p) => p.trim());
  if (paragraphs.length === 0) return "<p class=\"text-63\"><span class=\"text-rgb-54-65-83\">—</span></p>";
  return paragraphs
    .map(
      (p) =>
        `<p class="text-63"><span class="text-rgb-54-65-83">${escapeHtml(p.replace(/\n/g, " ").trim())}</span></p>`
    )
    .join("\n");
}

/**
 * Logged Moments: per-day blocks with date label (green) and content paragraph.
 * Matches org template: first block uses container-45/46, text-47, paragraph-48, text-49;
 * second and alternating use container-50/51, text-52, paragraph-53, text-54.
 */
function buildSection2LoggedMomentsHtml(section4Moments: Section4Moment[]): string {
  if (!section4Moments || section4Moments.length === 0) {
    return "<p class=\"text-63\"><span class=\"text-rgb-54-65-83\">No logged moments in this window.</span></p>";
  }
  return section4Moments
    .map((m, i) => {
      const isFirst = i % 2 === 0;
      const containerOuter = isFirst ? "container-45" : "container-50";
      const containerInner = isFirst ? "container-46" : "container-51";
      const dateClass = isFirst ? "text-47" : "text-52";
      const paraClass = isFirst ? "paragraph-48" : "paragraph-53";
      const contentClass = isFirst ? "text-49" : "text-54";
      return `<div class="${containerOuter}">
<div class="${containerInner}">
<p class="${dateClass}"><span class="text-rgb-38-177-112">${escapeHtml(m.dateLabel.trim())}</span></p>
</div>
<div class="${paraClass}">
<p class="${contentClass}"><span class="text-black">${escapeHtml(m.content.trim().replace(/\n/g, " "))}</span></p>
</div>
</div>`;
    })
    .join("\n");
}

/**
 * Observed Patterns and Limits: section2Text has optional pattern bullets then a "Limits:" line.
 * We show both: pattern lines first, then "Limits" subheading, then the limits paragraph.
 * If there is no "Limits:" line we show the whole text as body.
 */
function buildSection3PatternsHtml(section2Text: string): string {
  const trimmed = section2Text.trim();
  const match = trimmed.match(/\bLimits:\s*/i);
  let patternsPart = "";
  let limitsPart = "";
  if (match) {
    patternsPart = trimmed.slice(0, match.index).trim();
    limitsPart = trimmed.slice(match.index! + match[0].length).trim();
  } else {
    limitsPart = trimmed;
  }
  const parts: string[] = [];
  if (patternsPart) {
    parts.push(textToParagraphsHtml(patternsPart));
  }
  parts.push('<div class="heading-4-59"><p class="text-60"><span class="text-rgb-0-120-159">Limits</span></p></div>');
  if (limitsPart) {
    parts.push(textToParagraphsHtml(limitsPart));
  } else {
    parts.push(textToParagraphsHtml("Summary is based on the logged entries in this time window."));
  }
  return parts.join("\n");
}

/**
 * Section 4 (Open Points for Reflection): section3Text as paragraphs, or empty if not included.
 */
function buildSection4ReflectionHtml(finalSections: FinalSections): string {
  if (!finalSections.section3Included || !finalSections.section3Text.trim()) {
    return "<p class=\"text-63\"><span class=\"text-rgb-54-65-83\">None for this window.</span></p>";
  }
  return textToParagraphsHtml(finalSections.section3Text);
}

/**
 * Format report date from window end (e.g. "February 12, 2026").
 */
function formatReportDate(endDateStr: string): string {
  const d = new Date(endDateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Format time window for header (e.g. "29 Jan 2026 – 12 Feb 2026").
 */
function formatTimeWindow(startDate: string, endDate: string): string {
  const s = new Date(startDate + "T12:00:00Z");
  const e = new Date(endDate + "T12:00:00Z");
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}

/**
 * Build full HTML report from template and pipeline data.
 * Inlines CSS and logo so the result is self-contained.
 */
export function buildHtmlReport(windowBundle: WindowBundle, finalSections: FinalSections): string {
  let html = loadReportHtml();
  const css = loadReportCss();

  const reportDate = formatReportDate(windowBundle.window.endDate);
  const timeWindow = formatTimeWindow(
    windowBundle.window.startDate,
    windowBundle.window.endDate
  );

  let logoDataUrl: string;
  try {
    logoDataUrl = loadImageAsDataUrl("container-1-7.png");
  } catch {
    logoDataUrl = "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>").toString("base64");
  }

  html = html.replace("<link rel=\"stylesheet\" href=\"styles.css\">", `<style>${css}</style>`);
  html = html.replace("{{LOGO_DATA_URL}}", logoDataUrl);
  html = html.replace("{{REPORT_DATE}}", escapeHtml(reportDate));
  html = html.replace("{{TIME_WINDOW}}", escapeHtml(timeWindow));
  html = html.replace("{{DAYS_WITH_ENTRIES}}", String(windowBundle.counts.daysWithEntries));
  html = html.replace("{{DAYS_TOTAL}}", String(windowBundle.window.days));
  html = html.replace(
    "{{SCOPE_DISCLAIMER}}",
    escapeHtml(
      "This report summarizes only what was explicitly logged during this time window. Days without entries are not represented."
    )
  );
  html = html.replace(
    "{{SECTION2_LOGGED_MOMENTS_HTML}}",
    buildSection2LoggedMomentsHtml(finalSections.section4Moments)
  );
  html = html.replace(
    "{{SECTION3_PATTERNS_HTML}}",
    buildSection3PatternsHtml(finalSections.section2Text)
  );
  html = html.replace("{{SECTION4_REFLECTION_HTML}}", buildSection4ReflectionHtml(finalSections));

  return html;
}
