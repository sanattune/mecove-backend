import { loadImageAsDataUrl, loadReportCss, loadReportHtml } from "../templateLoader";
import type { WindowBundle } from "../types";
import { escapeHtml, formatReportDate, formatTimeWindow } from "../reportHtml";
import type { FinalMirror, MirrorEntry } from "./types";

/**
 * Render a single recap entry: short green anchor + black body sentence.
 * Reuses the Logged Moments DOM. Double quotes in body render as curly.
 */
function buildMirrorEntryHtml(entry: MirrorEntry, index: number): string {
  const isFirst = index % 2 === 0;
  const containerOuter = isFirst ? "container-45" : "container-50";
  const containerInner = isFirst ? "container-46" : "container-51";
  const anchorClass = isFirst ? "text-47" : "text-52";
  const paraClass = isFirst ? "paragraph-48" : "paragraph-53";
  const contentClass = isFirst ? "text-49" : "text-54";
  const body = escapeHtml(entry.body.trim().replace(/\n/g, " "))
    .replace(/&quot;([^&]*?)&quot;/g, "&ldquo;$1&rdquo;");
  return `<div class="${containerOuter}">
<div class="${containerInner}">
<p class="${anchorClass}"><span class="text-rgb-38-177-112">${escapeHtml(entry.anchor.trim())}</span></p>
</div>
<div class="${paraClass}">
<p class="${contentClass}"><span class="text-black">${body}</span></p>
</div>
</div>`;
}

/**
 * Render one of the three mirror lists (Patterns / Moments / Flags).
 */
function buildMirrorSection(title: string, entries: MirrorEntry[], emptyText: string): string {
  const body =
    entries && entries.length > 0
      ? entries.map((entry, i) => buildMirrorEntryHtml(entry, i)).join("\n")
      : `<p class="text-63"><span class="text-rgb-54-65-83">${escapeHtml(emptyText)}</span></p>`;
  return `<div class="section-41">
<div class="heading-3-42">
<p class="text-43"><span class="text-rgb-0-70-161">${escapeHtml(title)}</span></p>
</div>
<div class="container-44">
${body}
</div>
</div>`;
}

/**
 * Opener sentence as a full-width paragraph matching the scope block style.
 */
function buildMirrorOpenerHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const rendered = escapeHtml(trimmed).replace(/&quot;([^&]*?)&quot;/g, "&ldquo;$1&rdquo;");
  return `<div class="container-24">
<div class="paragraph-25">
<p class="text-26"><span class="text-rgb-54-65-83">${rendered}</span></p>
</div>
</div>`;
}

function buildMirrorBodyHtml(finalMirror: FinalMirror): string {
  const parts: string[] = [];
  parts.push(buildMirrorOpenerHtml(finalMirror.openerSentence));
  parts.push(
    buildMirrorSection(
      "Patterns you kept recording",
      finalMirror.patterns,
      "Nothing repeated across multiple days in this window."
    )
  );
  parts.push(
    buildMirrorSection(
      "Moments worth noticing",
      finalMirror.moments,
      "No stand-out moments in this window."
    )
  );
  parts.push(
    buildMirrorSection(
      "Worth flagging",
      finalMirror.flags,
      "Nothing recurred enough to flag in this window."
    )
  );
  return parts.filter((p) => p.length > 0).join("\n");
}

/**
 * Build the "Myself, Lately" HTML report. Reuses the shared header + scope
 * block from the template; body is opener + three lists.
 */
export function buildMirrorHtmlReport(
  windowBundle: WindowBundle,
  finalMirror: FinalMirror
): string {
  let html = loadReportHtml("myself_lately");
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
    logoDataUrl =
      "data:image/svg+xml;base64," +
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>").toString("base64");
  }

  html = html.replace('<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`);
  html = html.replace("{{LOGO_DATA_URL}}", logoDataUrl);
  html = html.replace("{{REPORT_DATE}}", escapeHtml(reportDate));
  html = html.replace("{{TIME_WINDOW}}", escapeHtml(timeWindow));
  html = html.replace("{{DAYS_WITH_ENTRIES}}", String(windowBundle.counts.daysWithEntries));
  html = html.replaceAll("{{DAYS_TOTAL}}", String(windowBundle.window.days));
  html = html.replace(
    "{{SCOPE_DISCLAIMER}}",
    escapeHtml(
      "Your own words, grouped by what actually came up. Only what was logged. Days without entries are not here."
    )
  );
  html = html.replace("{{THEMES_HTML}}", buildMirrorBodyHtml(finalMirror));

  return html;
}
