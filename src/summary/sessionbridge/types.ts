/**
 * Types for the SessionBridge brief — a factual therapist/coach data export.
 * No interpretation: every field maps to something in canonical.
 */

/**
 * Vocabulary entry: a single emotion/state word the person used, with a
 * count of occurrences and short context anchors pulled verbatim from
 * canonical (what the word was attached to + date).
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
 * A question the person asked themselves in their entries. Verbatim where
 * possible, with the date it was logged.
 */
export type OpenQuestion = {
  question: string;  // ends with "?"
  date: string;      // "April 7"
};

/**
 * A decision or option the person named — a choice they made, a plan they
 * drafted, an action they stated they would take. Verbatim-ish.
 */
export type DecisionItem = {
  text: string;    // quoted fragment of the decision/option
  date: string;    // "April 19"
};

/**
 * One block of the daily log: date header + short factual bullet fragments
 * (quote-first, minimal narrator voice). Rendered as a small-font appendix.
 */
export type DailyLogBlock = {
  dateLabel: string;  // "April 5" (month-word + numeric day)
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
