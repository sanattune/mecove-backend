/**
 * Types for the "Myself, Lately" mirror recap — a self-reflection report
 * grouped by patterns, moments, and flags. Second-person voice, factual,
 * no interpretation.
 */

/**
 * A single entry in one of the three mirror lists. `anchor` is the short
 * bold label (a date, a tag, or a quoted word) that prefixes the entry;
 * `body` is the factual description after it, made up of the user's own
 * words and dates drawn from canonical.
 */
export type MirrorEntry = {
  anchor: string;
  body: string;
};

/**
 * Mirror recap: one factual opener sentence naming the surface shape of
 * the window, followed by three optional lists.
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
