import { loadImageAsDataUrl, loadReportCss, loadReportHtml } from "../templateLoader";
import type { WindowBundle } from "../types";
import { buildAnchorRowHtml, curlyQuotes, escapeHtml, formatReportDate, formatTimeWindow } from "../reportHtml";
import type { FinalMirror, MomentEntry } from "./types";

/**
 * Render a flat-sentence list (used by What Has Been Coming Up + Something
 * to Notice). No anchor, just one soft observational sentence per item.
 */
function buildSentenceListHtml(sentences: string[], emptyText: string): string {
  if (!sentences || sentences.length === 0) {
    return `<p class="text-63"><span class="text-rgb-54-65-83">${escapeHtml(emptyText)}</span></p>`;
  }
  const items = sentences
    .map((s) => {
      const cleaned = s.trim().replace(/\s+/g, " ");
      const rendered = curlyQuotes(escapeHtml(cleaned));
      return `<li class="reflective-item"><span class="text-black">${rendered}</span></li>`;
    })
    .join("\n");
  return `<ul class="reflective-list">
${items}
</ul>`;
}

/**
 * Render the moments section (date anchor + body). Reuses the shared anchor
 * row helper.
 */
function buildMomentsListHtml(moments: MomentEntry[], emptyText: string): string {
  if (!moments || moments.length === 0) {
    return `<p class="text-63"><span class="text-rgb-54-65-83">${escapeHtml(emptyText)}</span></p>`;
  }
  return moments.map((m, i) => buildAnchorRowHtml(m.anchor, m.body, i)).join("\n");
}

/**
 * Section wrapper matching the existing template DOM (heading + body).
 */
function buildSection(title: string, body: string): string {
  return `<div class="section-41">
<div class="heading-3-42">
<p class="text-43"><span class="text-rgb-0-70-161">${escapeHtml(title)}</span></p>
</div>
<div class="container-44">
${body}
</div>
</div>`;
}

function buildOpenerHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const rendered = curlyQuotes(escapeHtml(trimmed));
  return `<div class="container-24">
<div class="paragraph-25">
<p class="text-26"><span class="text-rgb-54-65-83">${rendered}</span></p>
</div>
</div>`;
}

function buildGentleTakeawayHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const rendered = curlyQuotes(escapeHtml(trimmed));
  return `<div class="section-41 gentle-takeaway">
<div class="heading-3-42">
<p class="text-43"><span class="text-rgb-0-70-161">Gentle Takeaway</span></p>
</div>
<div class="container-44">
<p class="takeaway-line"><span class="text-rgb-54-65-83">${rendered}</span></p>
</div>
</div>`;
}

function buildMirrorBodyHtml(finalMirror: FinalMirror): string {
  const parts: string[] = [];
  parts.push(buildOpenerHtml(finalMirror.openerSentence));
  parts.push(
    buildSection(
      "What Has Been Coming Up",
      buildSentenceListHtml(
        finalMirror.whatHasBeenComingUp,
        "Nothing repeated across multiple days in this window."
      )
    )
  );
  parts.push(
    buildSection(
      "Moments That Stood Out",
      buildMomentsListHtml(
        finalMirror.momentsThatStoodOut,
        "No stand-out moments in this window."
      )
    )
  );
  parts.push(
    buildSection(
      "Something to Notice",
      buildSentenceListHtml(
        finalMirror.somethingToNotice,
        "Nothing recurred enough to notice in this window."
      )
    )
  );
  parts.push(buildGentleTakeawayHtml(finalMirror.gentleTakeaway));
  return parts.filter((p) => p.length > 0).join("\n");
}

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
