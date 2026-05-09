/**
 * Types for "Myself, Lately" — a self-reflection recap. Soft, observational,
 * quote-heavy, never diagnostic. Second-person voice. Five sections in render
 * order: opener, what-has-been-coming-up, moments-that-stood-out,
 * something-to-notice, gentle-takeaway.
 */

/**
 * A date-anchored moment entry. Used only by `momentsThatStoodOut`; the
 * other lists are flat string arrays of reflective sentences.
 */
export type MomentEntry = {
  anchor: string;
  body: string;
};

export type MirrorDraft = {
  openerSentence: string;
  whatHasBeenComingUp: string[];
  momentsThatStoodOut: MomentEntry[];
  somethingToNotice: string[];
  gentleTakeaway: string;
};

export type FinalMirror = {
  status: "PASS" | "FIXED";
  changes: string[];
  openerSentence: string;
  whatHasBeenComingUp: string[];
  momentsThatStoodOut: MomentEntry[];
  somethingToNotice: string[];
  gentleTakeaway: string;
};
