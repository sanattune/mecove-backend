import { asArray, asString, isRecord } from "../validation";
import type {
  DailyLogBlock,
  DecisionItem,
  DraftSessionBridge,
  FinalSessionBridge,
  MomentOfVariation,
  ObservedTheme,
  OpenQuestion,
  WordInContext,
} from "./types";

function isWordInContext(value: unknown): value is WordInContext {
  if (!isRecord(value)) return false;
  if (!asString(value.statement)) return false;
  if (value.reflects !== null && !asString(value.reflects)) return false;
  return true;
}

function isObservedTheme(value: unknown): value is ObservedTheme {
  if (!isRecord(value)) return false;
  return asString(value.label) && typeof value.dayCount === "number";
}

function isMomentOfVariation(value: unknown): value is MomentOfVariation {
  if (!isRecord(value)) return false;
  return (
    asString(value.date) && asString(value.quote) && asString(value.context)
  );
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

function isStringArray(value: unknown): value is string[] {
  return asArray(value) && value.every(asString);
}

export function isDraftSessionBridge(value: unknown): value is DraftSessionBridge {
  if (!isRecord(value)) return false;
  if (!asArray(value.observedThemes) || !value.observedThemes.every(isObservedTheme)) return false;
  if (!isStringArray(value.signalsWorthAttention)) return false;
  if (!asArray(value.momentsOfVariation) || !value.momentsOfVariation.every(isMomentOfVariation)) return false;
  if (!asArray(value.openQuestions) || !value.openQuestions.every(isOpenQuestion)) return false;
  if (!asArray(value.decisionsAndIntentions) || !value.decisionsAndIntentions.every(isDecisionItem)) return false;
  if (!asArray(value.wordsInContext) || !value.wordsInContext.every(isWordInContext)) return false;
  if (!asArray(value.dailyLog) || !value.dailyLog.every(isDailyLogBlock)) return false;
  return true;
}

export function isFinalSessionBridge(value: unknown): value is FinalSessionBridge {
  if (!isRecord(value)) return false;
  if (!(value.status === "PASS" || value.status === "FIXED")) return false;
  if (!isStringArray(value.changes)) return false;
  if (!asArray(value.observedThemes) || !value.observedThemes.every(isObservedTheme)) return false;
  if (!isStringArray(value.signalsWorthAttention)) return false;
  if (!asArray(value.momentsOfVariation) || !value.momentsOfVariation.every(isMomentOfVariation)) return false;
  if (!asArray(value.openQuestions) || !value.openQuestions.every(isOpenQuestion)) return false;
  if (!asArray(value.decisionsAndIntentions) || !value.decisionsAndIntentions.every(isDecisionItem)) return false;
  if (!asArray(value.wordsInContext) || !value.wordsInContext.every(isWordInContext)) return false;
  if (!asArray(value.dailyLog) || !value.dailyLog.every(isDailyLogBlock)) return false;
  return true;
}
