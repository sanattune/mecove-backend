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
  MomentOfVariation,
  ObservedTheme,
  OpenQuestion,
  WordInContext,
} from "./types";

/**
 * Observed Themes: plain list, sorted highest day-count first.
 */
function buildObservedThemesHtml(themes: ObservedTheme[]): string {
  if (!themes || themes.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No topical themes recurred across multiple days in this window.</span></p>';
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
 * Signals Worth Attention: sentence list (no anchors).
 */
function buildSignalsHtml(signals: string[]): string {
  if (!signals || signals.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No internal-state recurrences in this window.</span></p>';
  }
  const items = signals
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
 * Moments of Variation: date anchor + quote + brief context.
 */
function buildVariationHtml(moments: MomentOfVariation[]): string {
  if (!moments || moments.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No moments of variation recorded in this window.</span></p>';
  }
  return moments
    .map((m, i) => {
      const quoted = `“${m.quote.trim().replace(/\s+/g, " ")}”`;
      const ctx = m.context.trim();
      const body = ctx.length > 0 ? `${quoted} — ${ctx}` : quoted;
      return buildAnchorRowHtml(m.date, body, i);
    })
    .join("\n");
}

function buildOpenQuestionsHtml(questions: OpenQuestion[]): string {
  if (!questions || questions.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No internal questions recorded in this window.</span></p>';
  }
  return questions
    .map((q, i) =>
      buildAnchorRowHtml(q.date, `“${q.question.trim().replace(/\s+/g, " ")}”`, i)
    )
    .join("\n");
}

function buildDecisionsHtml(decisions: DecisionItem[]): string {
  if (!decisions || decisions.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No decisions or intentions named in this window.</span></p>';
  }
  return decisions.map((d, i) => buildAnchorRowHtml(d.date, d.text, i)).join("\n");
}

/**
 * Words Used in Context: compact two-column table.
 *
 * Designed to read as a small reference table — reduced visual importance
 * versus the old per-word vocabulary block. Each row is a verbatim
 * statement with the user's own emotion word (or em-dash when none).
 */
function buildWordsInContextHtml(words: WordInContext[]): string {
  if (!words || words.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No emotion-bearing statements recorded in this window.</span></p>';
  }
  const rows = words
    .map((w) => {
      const statement = curlyQuotes(escapeHtml(w.statement.trim()));
      const reflects = w.reflects && w.reflects.trim().length > 0
        ? escapeHtml(w.reflects.trim())
        : "—";
      return `<tr>
<td class="words-statement">“${statement}”</td>
<td class="words-reflects">${reflects}</td>
</tr>`;
    })
    .join("\n");
  return `<table class="words-table">
<thead>
<tr><th>Statement / Context</th><th>Reflects</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>`;
}

function buildDailyLogHtml(blocks: DailyLogBlock[]): string {
  if (!blocks || blocks.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No days logged in this window.</span></p>';
  }
  return blocks
    .map((block, i) => {
      const bullets = block.bullets
        .map((b) => b.trim())
        .filter((b) => b.length > 0);
      const body = bullets.length > 0 ? bullets.join(" · ") : "—";
      return buildAnchorRowHtml(block.dateLabel, body, i);
    })
    .join("\n");
}

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
      "Only what was explicitly logged during this window. Days without entries are not represented. Contains no interpretation or advice — direct data and quotes only."
    )
  );
  html = html.replace("{{THEMES_HTML}}", buildObservedThemesHtml(finalSessionBridge.observedThemes));
  html = html.replace("{{SIGNALS_HTML}}", buildSignalsHtml(finalSessionBridge.signalsWorthAttention));
  html = html.replace("{{VARIATION_HTML}}", buildVariationHtml(finalSessionBridge.momentsOfVariation));
  html = html.replace("{{QUESTIONS_HTML}}", buildOpenQuestionsHtml(finalSessionBridge.openQuestions));
  html = html.replace("{{DECISIONS_HTML}}", buildDecisionsHtml(finalSessionBridge.decisionsAndIntentions));
  html = html.replace("{{WORDS_HTML}}", buildWordsInContextHtml(finalSessionBridge.wordsInContext));
  html = html.replace("{{DAILY_LOG_HTML}}", buildDailyLogHtml(finalSessionBridge.dailyLog));

  return html;
}
