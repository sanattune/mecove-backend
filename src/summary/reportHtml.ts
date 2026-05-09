/**
 * Shared HTML helpers used by both report types' renderers. Per-report
 * renderers live in:
 *   src/summary/sessionbridge/html.ts
 *   src/summary/myself-lately/html.ts
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turn straight double quotes inside already-escaped text into curly quotes.
 */
export function curlyQuotes(s: string): string {
  return s.replace(/&quot;([^&]*?)&quot;/g, "&ldquo;$1&rdquo;");
}

/**
 * Render a single green-anchor + black-body row. Reuses the Logged Moments
 * DOM pattern; alternates between the two container class variants so
 * existing CSS produces the page rhythm.
 */
export function buildAnchorRowHtml(anchor: string, body: string, index: number): string {
  const isFirst = index % 2 === 0;
  const containerOuter = isFirst ? "container-45" : "container-50";
  const containerInner = isFirst ? "container-46" : "container-51";
  const anchorClass = isFirst ? "text-47" : "text-52";
  const paraClass = isFirst ? "paragraph-48" : "paragraph-53";
  const contentClass = isFirst ? "text-49" : "text-54";
  const renderedBody = curlyQuotes(escapeHtml(body.trim().replace(/\n/g, " ")));
  return `<div class="${containerOuter}">
<div class="${containerInner}">
<p class="${anchorClass}"><span class="text-rgb-38-177-112">${escapeHtml(anchor.trim())}</span></p>
</div>
<div class="${paraClass}">
<p class="${contentClass}"><span class="text-black">${renderedBody}</span></p>
</div>
</div>`;
}

/**
 * Format report date from window end (e.g. "February 12, 2026").
 */
export function formatReportDate(endDateStr: string): string {
  const d = new Date(endDateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Format time window for header (e.g. "29 Jan 2026 – 12 Feb 2026").
 */
export function formatTimeWindow(startDate: string, endDate: string): string {
  const s = new Date(startDate + "T12:00:00Z");
  const e = new Date(endDate + "T12:00:00Z");
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}
