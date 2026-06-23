import { asArray, asString, isRecord } from "../validation";
import type { FinalMirror, MirrorDraft, MomentEntry } from "./types";

function isMomentEntry(value: unknown): value is MomentEntry {
  if (!isRecord(value)) return false;
  if (!asString(value.anchor) || !asString(value.body)) return false;
  return true;
}

function isMomentEntryArray(value: unknown): value is MomentEntry[] {
  return asArray(value) && value.every(isMomentEntry);
}

function isStringArray(value: unknown): value is string[] {
  return asArray(value) && value.every(asString);
}

export function isMirrorDraft(value: unknown): value is MirrorDraft {
  if (!isRecord(value)) return false;
  if (!asString(value.openerSentence)) return false;
  if (!isStringArray(value.whatHasBeenComingUp)) return false;
  if (!isMomentEntryArray(value.momentsThatStoodOut)) return false;
  if (!isStringArray(value.somethingToNotice)) return false;
  if (!asString(value.gentleTakeaway)) return false;
  return true;
}

export function isFinalMirror(value: unknown): value is FinalMirror {
  if (!isRecord(value)) return false;
  if (!(value.status === "PASS" || value.status === "FIXED")) return false;
  if (!isStringArray(value.changes)) return false;
  if (!asString(value.openerSentence)) return false;
  if (!isStringArray(value.whatHasBeenComingUp)) return false;
  if (!isMomentEntryArray(value.momentsThatStoodOut)) return false;
  if (!isStringArray(value.somethingToNotice)) return false;
  if (!asString(value.gentleTakeaway)) return false;
  return true;
}
