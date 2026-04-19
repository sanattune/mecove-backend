import { loadImageAsDataUrl, loadReportCss, loadReportHtml } from "../templateLoader";
import type { WindowBundle } from "../types";
import {
  buildAnchorRowHtml,
  curlyQuotes,
  escapeHtml,
  formatReportDate,
  formatTimeWindow,
} from "../reportHtml";
import type {
  DailyLogBlock,
  DecisionItem,
  FinalSessionBridge,
  OngoingTheme,
  OpenQuestion,
  VocabularyEntry,
} from "./types";

/**
 * Recorded vocabulary: a three-column table (word | times | used when).
 * Denser than green-anchor rows and matches the therapist-brief feel.
 */
function buildVocabularyHtml(vocabulary: VocabularyEntry[]): string {
  if (!vocabulary || vocabulary.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No emotion or state words recorded in this window.</span></p>';
  }
  const rows = vocabulary
    .map((v) => {
      const contexts = v.contexts.length > 0 ? v.contexts.join("; ") : "\u2014";
      return `<tr>
<td class="vocab-word">${escapeHtml(v.word.trim())}</td>
<td class="vocab-count">${v.count}</td>
<td class="vocab-contexts">${curlyQuotes(escapeHtml(contexts))}</td>
</tr>`;
    })
    .join("\n");
  return `<table class="vocab-table">
<thead>
<tr><th>Word</th><th style="text-align:right;">Times</th><th>Used when</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>`;
}

/**
 * Ongoing themes: plain list, sorted highest day-count first.
 */
function buildOngoingThemesHtml(themes: OngoingTheme[]): string {
  if (!themes || themes.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No themes recurred across multiple days in this window.</span></p>';
  }
  const sorted = [...themes].sort((a, b) => {
    if (b.dayCount !== a.dayCount) return b.dayCount - a.dayCount;
    return a.label.localeCompare(b.label);
  });
  const items = sorted
    .map(
      (t) =>
        `<li><span class="list-anchor">${t.dayCount} days</span>${escapeHtml(t.label.trim())}</li>`
    )
    .join("\n");
  return `<ul class="simple-list">${items}</ul>`;
}

/**
 * Open questions: each question verbatim with its date anchor.
 */
function buildOpenQuestionsHtml(questions: OpenQuestion[]): string {
  if (!questions || questions.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No internal questions recorded in this window.</span></p>';
  }
  return questions
    .map((q, i) =>
      buildAnchorRowHtml(q.date, `\u201c${q.question.trim().replace(/\s+/g, " ")}\u201d`, i)
    )
    .join("\n");
}

/**
 * Decisions & options: each decision/option with its date anchor.
 */
function buildDecisionsHtml(decisions: DecisionItem[]): string {
  if (!decisions || decisions.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No decisions or options named in this window.</span></p>';
  }
  return decisions.map((d, i) => buildAnchorRowHtml(d.date, d.text, i)).join("\n");
}

/**
 * Daily log appendix: one row per logged day. Anchor = date, body = bullets
 * joined so each fragment reads as a separate clinical note inside one block.
 */
function buildDailyLogHtml(blocks: DailyLogBlock[]): string {
  if (!blocks || blocks.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No days logged in this window.</span></p>';
  }
  return blocks
    .map((block, i) => {
      const bullets = block.bullets
        .map((b) => b.trim())
        .filter((b) => b.length > 0);
      const body = bullets.length > 0 ? bullets.join(" \u00b7 ") : "\u2014";
      return buildAnchorRowHtml(block.dateLabel, body, i);
    })
    .join("\n");
}

/**
 * Build the full SessionBridge brief HTML report. Inlines CSS and logo so
 * the output is a self-contained string consumable by Puppeteer.
 */
export function buildSessionBridgeHtmlReport(
  windowBundle: WindowBundle,
  finalSessionBridge: FinalSessionBridge
): string {
  let html = loadReportHtml("sessionbridge");
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
      "Only what was explicitly logged during this window. Days without entries are not represented. Contains no interpretation or advice \u2014 direct data and quotes only."
    )
  );
  html = html.replace("{{VOCABULARY_HTML}}", buildVocabularyHtml(finalSessionBridge.vocabulary));
  html = html.replace("{{THEMES_HTML}}", buildOngoingThemesHtml(finalSessionBridge.ongoingThemes));
  html = html.replace(
    "{{QUESTIONS_HTML}}",
    buildOpenQuestionsHtml(finalSessionBridge.openQuestions)
  );
  html = html.replace("{{DECISIONS_HTML}}", buildDecisionsHtml(finalSessionBridge.decisions));
  html = html.replace("{{DAILY_LOG_HTML}}", buildDailyLogHtml(finalSessionBridge.dailyLog));

  return html;
}
