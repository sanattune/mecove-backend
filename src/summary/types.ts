import type { DraftSessionBridge, FinalSessionBridge } from "./sessionbridge/types";
import type { MirrorDraft, FinalMirror } from "./myself-lately/types";

export type SignalBucket = "LOW" | "MEDIUM" | "HIGH";
export type DataDensity = "sparse" | "moderate" | "dense";

export type WindowMessage = {
  messageId: string;
  createdAt: string;
  text: string;
};

export type WindowDay = {
  date: string;
  messages: WindowMessage[];
};

export type WindowBundle = {
  userId: string;
  timezone: string;
  window: {
    startDate: string;
    endDate: string;
    days: number;
  };
  rangeStartUtc: string;
  rangeEndUtc: string;
  rangeEndExclusiveUtc: string;
  counts: {
    totalMessages: number;
    daysWithEntries: number;
  };
  signalBucket: SignalBucket;
  section3AllowedByCounts: boolean;
  inputHash: string;
  days: WindowDay[];
};

export type CanonicalFact = {
  fact: string;
  sourceSnippet: string;
};

export type RepeatCandidate = {
  label: string;
  count: number;
  evidenceSnippets: string[];
};

export type CanonicalPerDay = {
  date: string;
  topicSentenceSeed: string;
  facts: CanonicalFact[];
  explicitEmotions: string[];
  numericLogs: string[];
};

export type CanonicalDoc = {
  window: {
    startDate: string;
    endDate: string;
  };
  counts: {
    daysWithEntries: number;
    totalMessages: number;
  };
  perDay: CanonicalPerDay[];
  repeatCandidates: RepeatCandidate[];
  limitsSignals: {
    dataDensity: DataDensity;
    reflectionDefensible: boolean;
  };
};

export type PromptVersions = {
  canonicalizer: string;
  sessionbridgeBrief: string;
  sessionbridgeGuardfix: string;
  mirrorRecap: string;
  mirrorGuardfix: string;
};

export type ReportType = "sessionbridge" | "myself_lately";

type SummaryPipelineCommon = {
  windowBundle: WindowBundle;
  canonical: CanonicalDoc;
  finalReportText: string;
  pdfBytes: Buffer;
  promptVersionString: string;
  modelName: string;
};

export type SummaryPipelineResult =
  | (SummaryPipelineCommon & {
      reportType: "sessionbridge";
      draft: DraftSessionBridge;
      final: FinalSessionBridge;
    })
  | (SummaryPipelineCommon & {
      reportType: "myself_lately";
      mirrorDraft: MirrorDraft;
      finalMirror: FinalMirror;
    });
