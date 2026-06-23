import type { CanonicalDoc } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function asString(value: unknown): value is string {
  return typeof value === "string";
}

export function asBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function asArray(value: unknown): value is unknown[] {
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
