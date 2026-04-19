import { asArray, asString, isRecord } from "../validation";
import type {
  DailyLogBlock,
  DecisionItem,
  DraftSessionBridge,
  FinalSessionBridge,
  OngoingTheme,
  OpenQuestion,
  VocabularyEntry,
} from "./types";

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
