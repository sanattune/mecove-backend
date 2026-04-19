import { asArray, asString, isRecord } from "../validation";
import type { FinalMirror, MirrorDraft, MirrorEntry } from "./types";

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
