import { loadReportCss, loadReportHtml, loadImageAsDataUrl } from "./templateLoader";
import type {
  DailyLogBlock,
  DecisionItem,
  FinalMirror,
  FinalSessionBridge,
  MirrorEntry,
  OngoingTheme,
  OpenQuestion,
  VocabularyEntry,
  WindowBundle,
} from "./types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turn straight double quotes inside user-facing text into curly quotes after
 * HTML-escaping. Keeps the clinical look from feeling rigid.
 */
function curlyQuotes(s: string): string {
  return s.replace(/&quot;([^&]*?)&quot;/g, "&ldquo;$1&rdquo;");
}

/**
 * Render a single green-anchor + black-body row. Reuses the Logged Moments
 * DOM pattern; alternates between the two container class variants so
 * existing CSS produces the page rhythm.
 */
function buildAnchorRowHtml(anchor: string, body: string, index: number): string {
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
 * Recorded vocabulary: a three-column table (word | times | used when).
 * Denser than the green-anchor rows, and it matches the therapist-brief feel.
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
 * Ongoing themes section: plain list, sorted highest day-count first.
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
 * Open questions section: each question verbatim with its date anchor.
 */
function buildOpenQuestionsHtml(questions: OpenQuestion[]): string {
  if (!questions || questions.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No internal questions recorded in this window.</span></p>';
  }
  return questions
    .map((q, i) => buildAnchorRowHtml(q.date, `\u201c${q.question.trim().replace(/\s+/g, " ")}\u201d`, i))
    .join("\n");
}

/**
 * Decisions & options section: each decision/option with its date anchor.
 */
function buildDecisionsHtml(decisions: DecisionItem[]): string {
  if (!decisions || decisions.length === 0) {
    return '<p class="text-63"><span class="text-rgb-54-65-83">No decisions or options named in this window.</span></p>';
  }
  return decisions.map((d, i) => buildAnchorRowHtml(d.date, d.text, i)).join("\n");
}

/**
 * Daily log section: one row per logged day. Anchor = date, body = bullets
 * joined with " \u00b7 " so each fragment reads as a separate clinical note
 * inside one paragraph block.
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
export function buildHtmlReport(
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
    logoDataUrl = "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>").toString("base64");
  }

  html = html.replace("<link rel=\"stylesheet\" href=\"styles.css\">", `<style>${css}</style>`);
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
  html = html.replace("{{QUESTIONS_HTML}}", buildOpenQuestionsHtml(finalSessionBridge.openQuestions));
  html = html.replace("{{DECISIONS_HTML}}", buildDecisionsHtml(finalSessionBridge.decisions));
  html = html.replace("{{DAILY_LOG_HTML}}", buildDailyLogHtml(finalSessionBridge.dailyLog));

  return html;
}

/**
 * Render a single recap entry: short green anchor (a date or tag) above a
 * black body sentence. Reuses the Logged Moments DOM so existing CSS handles
 * styling. Double-quotes in the body render as curly quotes for readability.
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
 * Render one of the three mirror lists (Patterns / Moments / Flags) as a
 * blue-heading section with a stack of entry rows. Empty list renders with
 * a short neutral line so the reader sees the section and its state.
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
 * Render the opener sentence as a full-width paragraph using the scope
 * block's body styling. Visually distinct from section headings but
 * integrated with the page rhythm.
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
 * Build the "Myself, Lately" HTML report. Reuses the header/scope block
 * from sessionbridge for visual identity; body is one block per theme.
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
