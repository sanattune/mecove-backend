/**
 * Types for the SessionBridge brief — a factual therapist/coach data export.
 * No interpretation: every field maps to something in canonical.
 */

/**
 * One row in the Words Used in Context table. `statement` is a verbatim
 * fragment from the user. `reflects` is the user's own emotion word from
 * the same or a nearby entry — null when no explicit emotion word was
 * written in context.
 */
export type WordInContext = {
  statement: string;
  reflects: string | null;
};

/**
 * An observed theme: a TOPIC the user wrote about across multiple days.
 * Surface content (work, sleep, family). Sorted highest-to-lowest dayCount.
 */
export type ObservedTheme = {
  label: string;
  dayCount: number;
};

/**
 * Moments of Variation: positive-affect or contrasting moments connected to
 * music, curiosity, enjoyment, relief, self-expression. Date + quote +
 * brief factual context.
 */
export type MomentOfVariation = {
  date: string;    // "Month D"
  quote: string;   // verbatim
  context: string; // brief, factual, no interpretation
};

/**
 * A question the person asked themselves in their entries. Verbatim where
 * possible, with the date it was logged.
 */
export type OpenQuestion = {
  question: string;
  date: string;
};

/**
 * A decision, plan, option, or named intention. Verbatim-ish with date.
 */
export type DecisionItem = {
  text: string;
  date: string;
};

export type DailyLogBlock = {
  dateLabel: string;
  bullets: string[];
};

export type DraftSessionBridge = {
  observedThemes: ObservedTheme[];
  signalsWorthAttention: string[];
  momentsOfVariation: MomentOfVariation[];
  openQuestions: OpenQuestion[];
  decisionsAndIntentions: DecisionItem[];
  wordsInContext: WordInContext[];
  dailyLog: DailyLogBlock[];
};

export type FinalSessionBridge = {
  status: "PASS" | "FIXED";
  changes: string[];
  observedThemes: ObservedTheme[];
  signalsWorthAttention: string[];
  momentsOfVariation: MomentOfVariation[];
  openQuestions: OpenQuestion[];
  decisionsAndIntentions: DecisionItem[];
  wordsInContext: WordInContext[];
  dailyLog: DailyLogBlock[];
};
