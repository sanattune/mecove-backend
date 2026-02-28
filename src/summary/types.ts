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

export type DraftS2S3 = {
  section2Text: string;
  section3Text: string;
  section3Included: boolean;
};

/** One day in Logged Moments: short date label (e.g. "March seven") and paragraph content. */
export type Section4Moment = {
  dateLabel: string;
  content: string;
};

export type DraftS4 = {
  section4Moments: Section4Moment[];
};

export type FinalSections = {
  status: "PASS" | "FIXED";
  changes: string[];
  section2Text: string;
  section3Text: string;
  section3Included: boolean;
  section4Moments: Section4Moment[];
};

export type PromptVersions = {
  canonicalizer: string;
  writerS2S3: string;
  writerS4: string;
  guardfix: string;
};

export type SummaryPipelineResult = {
  windowBundle: WindowBundle;
  canonical: CanonicalDoc;
  draftS2S3: DraftS2S3;
  draftS4: DraftS4;
  finalSections: FinalSections;
  finalReportText: string;
  pdfBytes: Buffer;
  promptVersionString: string;
  modelName: string;
};

