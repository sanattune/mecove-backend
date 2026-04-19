import type {
  CanonicalDoc,
  DailyLogBlock,
  DecisionItem,
  DraftSessionBridge,
  FinalMirror,
  FinalSessionBridge,
  MirrorDraft,
  MirrorEntry,
  OngoingTheme,
  OpenQuestion,
  VocabularyEntry,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): value is string {
  return typeof value === "string";
}

function asBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function asArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isCanonicalDoc(value: unknown): value is CanonicalDoc {
  if (!isRecord(value)) return false;
  if (!isRecord(value.window) || !asString(value.window.startDate) || !asString(value.window.endDate)) {
    return false;
  }
  if (
    !isRecord(value.counts) ||
    typeof value.counts.daysWithEntries !== "number" ||
    typeof value.counts.totalMessages !== "number"
  ) {
    return false;
  }
  if (!asArray(value.perDay) || !asArray(value.repeatCandidates) || !isRecord(value.limitsSignals)) {
    return false;
  }
  if (
    !asString(value.limitsSignals.dataDensity) ||
    !asBoolean(value.limitsSignals.reflectionDefensible)
  ) {
    return false;
  }

  for (const day of value.perDay) {
    if (!isRecord(day)) return false;
    if (!asString(day.date) || !asString(day.topicSentenceSeed)) return false;
    if (!asArray(day.facts) || !asArray(day.explicitEmotions) || !asArray(day.numericLogs)) return false;
    for (const fact of day.facts) {
      if (!isRecord(fact) || !asString(fact.fact) || !asString(fact.sourceSnippet)) {
        return false;
      }
    }
    if (!day.explicitEmotions.every(asString)) return false;
    if (!day.numericLogs.every(asString)) return false;
  }

  for (const rep of value.repeatCandidates) {
    if (!isRecord(rep)) return false;
    if (!asString(rep.label) || typeof rep.count !== "number" || !asArray(rep.evidenceSnippets)) {
      return false;
    }
    if (!rep.evidenceSnippets.every(asString)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// SessionBridge (therapist brief) validators
// ---------------------------------------------------------------------------

function isVocabularyEntry(value: unknown): value is VocabularyEntry {
  if (!isRecord(value)) return false;
  if (!asString(value.word)) return false;
  if (typeof value.count !== "number") return false;
  if (!asArray(value.contexts) || !value.contexts.every(asString)) return false;
  return true;
}

function isOngoingTheme(value: unknown): value is OngoingTheme {
  if (!isRecord(value)) return false;
  return asString(value.label) && typeof value.dayCount === "number";
}

function isOpenQuestion(value: unknown): value is OpenQuestion {
  if (!isRecord(value)) return false;
  return asString(value.question) && asString(value.date);
}

function isDecisionItem(value: unknown): value is DecisionItem {
  if (!isRecord(value)) return false;
  return asString(value.text) && asString(value.date);
}

function isDailyLogBlock(value: unknown): value is DailyLogBlock {
  if (!isRecord(value)) return false;
  if (!asString(value.dateLabel)) return false;
  if (!asArray(value.bullets) || !value.bullets.every(asString)) return false;
  return true;
}

export function isDraftSessionBridge(value: unknown): value is DraftSessionBridge {
  if (!isRecord(value)) return false;
  if (!asArray(value.vocabulary) || !value.vocabulary.every(isVocabularyEntry)) return false;
  if (!asArray(value.ongoingThemes) || !value.ongoingThemes.every(isOngoingTheme)) return false;
  if (!asArray(value.openQuestions) || !value.openQuestions.every(isOpenQuestion)) return false;
  if (!asArray(value.decisions) || !value.decisions.every(isDecisionItem)) return false;
  if (!asArray(value.dailyLog) || !value.dailyLog.every(isDailyLogBlock)) return false;
  return true;
}

export function isFinalSessionBridge(value: unknown): value is FinalSessionBridge {
  if (!isRecord(value)) return false;
  if (!(value.status === "PASS" || value.status === "FIXED")) return false;
  if (!asArray(value.changes) || !value.changes.every(asString)) return false;
  if (!asArray(value.vocabulary) || !value.vocabulary.every(isVocabularyEntry)) return false;
  if (!asArray(value.ongoingThemes) || !value.ongoingThemes.every(isOngoingTheme)) return false;
  if (!asArray(value.openQuestions) || !value.openQuestions.every(isOpenQuestion)) return false;
  if (!asArray(value.decisions) || !value.decisions.every(isDecisionItem)) return false;
  if (!asArray(value.dailyLog) || !value.dailyLog.every(isDailyLogBlock)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// "Myself, Lately" mirror validators
// ---------------------------------------------------------------------------

function isMirrorEntry(value: unknown): value is MirrorEntry {
  if (!isRecord(value)) return false;
  if (!asString(value.anchor) || !asString(value.body)) return false;
  return true;
}

function isMirrorEntryArray(value: unknown): value is MirrorEntry[] {
  return asArray(value) && value.every(isMirrorEntry);
}

export function isMirrorDraft(value: unknown): value is MirrorDraft {
  if (!isRecord(value)) return false;
  if (!asString(value.openerSentence)) return false;
  if (!isMirrorEntryArray(value.patterns)) return false;
  if (!isMirrorEntryArray(value.moments)) return false;
  if (!isMirrorEntryArray(value.flags)) return false;
  return true;
}

export function isFinalMirror(value: unknown): value is FinalMirror {
  if (!isRecord(value)) return false;
  if (!(value.status === "PASS" || value.status === "FIXED")) return false;
  if (!asArray(value.changes) || !value.changes.every(asString)) return false;
  if (!asString(value.openerSentence)) return false;
  if (!isMirrorEntryArray(value.patterns)) return false;
  if (!isMirrorEntryArray(value.moments)) return false;
  if (!isMirrorEntryArray(value.flags)) return false;
  return true;
}
