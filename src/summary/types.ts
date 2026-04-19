export type SignalBucket = "LOW" | "MEDIUM" | "HIGH";
export type DataDensity = "sparse" | "moderate" | "dense";

export type WindowMessage = {
  messageId: string;
  createdAt: string;
  text: string;
};

export type WindowDay = {
  date: string;
  messages: WindowMessage[];
};

export type WindowBundle = {
  userId: string;
  timezone: string;
  window: {
    startDate: string;
    endDate: string;
    days: number;
  };
  rangeStartUtc: string;
  rangeEndUtc: string;
  rangeEndExclusiveUtc: string;
  counts: {
    totalMessages: number;
    daysWithEntries: number;
  };
  signalBucket: SignalBucket;
  section3AllowedByCounts: boolean;
  inputHash: string;
  days: WindowDay[];
};

export type CanonicalFact = {
  fact: string;
  sourceSnippet: string;
};

export type RepeatCandidate = {
  label: string;
  count: number;
  evidenceSnippets: string[];
};

export type CanonicalPerDay = {
  date: string;
  topicSentenceSeed: string;
  facts: CanonicalFact[];
  explicitEmotions: string[];
  numericLogs: string[];
};

export type CanonicalDoc = {
  window: {
    startDate: string;
    endDate: string;
  };
  counts: {
    daysWithEntries: number;
    totalMessages: number;
  };
  perDay: CanonicalPerDay[];
  repeatCandidates: RepeatCandidate[];
  limitsSignals: {
    dataDensity: DataDensity;
    reflectionDefensible: boolean;
  };
};

/**
 * Vocabulary entry for the SessionBridge brief: a single emotion/state word
 * the person used, with a count of occurrences and short context anchors
 * pulled verbatim from canonical (what the word was attached to + date).
 */
export type VocabularyEntry = {
  word: string;
  count: number;
  contexts: string[]; // e.g. "end of day after team conflicts (Apr 5)"
};

/**
 * An ongoing theme across the window: short label + number of days it
 * appeared. Sorted highest-to-lowest day count by the brief stage.
 */
export type OngoingTheme = {
  label: string;   // e.g. "career change / leaving stable job"
  dayCount: number;
};

/**
 * A question the person asked themselves in their entries. Verbatim quote
 * where possible, with the date it was logged.
 */
export type OpenQuestion = {
  question: string;  // verbatim-ish, ends with "?"
  date: string;      // "April 7"
};

/**
 * A decision or option the person named — e.g. a choice they made, a plan
 * they drafted, an action they stated they would take. Verbatim-ish.
 */
export type DecisionItem = {
  text: string;    // quoted fragment of the decision/option
  date: string;    // "April 19"
};

/**
 * One block of the SessionBridge daily log: date header + short factual
 * bullet fragments (quote-first, minimal narrator voice). Rendered as a
 * small-font appendix in the PDF.
 */
export type DailyLogBlock = {
  dateLabel: string;  // "April 5" (numeric day, month-word)
  bullets: string[];
};

export type DraftSessionBridge = {
  vocabulary: VocabularyEntry[];
  ongoingThemes: OngoingTheme[];
  openQuestions: OpenQuestion[];
  decisions: DecisionItem[];
  dailyLog: DailyLogBlock[];
};

export type FinalSessionBridge = {
  status: "PASS" | "FIXED";
  changes: string[];
  vocabulary: VocabularyEntry[];
  ongoingThemes: OngoingTheme[];
  openQuestions: OpenQuestion[];
  decisions: DecisionItem[];
  dailyLog: DailyLogBlock[];
};

export type PromptVersions = {
  canonicalizer: string;
  sessionbridgeBrief: string;
  sessionbridgeGuardfix: string;
  mirrorRecap: string;
  mirrorGuardfix: string;
};

export type ReportType = "sessionbridge" | "myself_lately";

/**
 * A single entry in one of the "Myself, Lately" lists. `anchor` is the short
 * bold label (a date, a tag, or a quoted word) that prefixes the entry;
 * `body` is the factual description after it, made up of the user's own
 * words and dates drawn from canonical. No interpretation.
 */
export type MirrorEntry = {
  anchor: string;
  body: string;
};

/**
 * "Myself, Lately" recap: one factual opener sentence naming the surface
 * shape of the window, followed by three optional lists.
 */
export type MirrorDraft = {
  openerSentence: string;
  patterns: MirrorEntry[];       // "Patterns you kept recording"
  moments: MirrorEntry[];        // "Moments worth noticing"
  flags: MirrorEntry[];          // "Worth flagging"
};

export type FinalMirror = {
  status: "PASS" | "FIXED";
  changes: string[];
  openerSentence: string;
  patterns: MirrorEntry[];
  moments: MirrorEntry[];
  flags: MirrorEntry[];
};

type SummaryPipelineCommon = {
  windowBundle: WindowBundle;
  canonical: CanonicalDoc;
  finalReportText: string;
  pdfBytes: Buffer;
  promptVersionString: string;
  modelName: string;
};

export type SummaryPipelineResult =
  | (SummaryPipelineCommon & {
      reportType: "sessionbridge";
      draft: DraftSessionBridge;
      final: FinalSessionBridge;
    })
  | (SummaryPipelineCommon & {
      reportType: "myself_lately";
      mirrorDraft: MirrorDraft;
      finalMirror: FinalMirror;
    });

