import type { CanonicalDoc, DraftS2S3, DraftS4, PromptVersions, WindowBundle } from "./types";

export const PROMPT_VERSIONS: PromptVersions = {
  canonicalizer: "canonicalizer_v1",
  writerS2S3: "writer_s2_s3_v1",
  writerS4: "writer_s4_v1",
  guardfix: "guardfix_v1",
};

export function buildCanonicalizerPrompt(windowBundle: WindowBundle): string {
  return `You are a neutral canonicalizer for a 15-day user log summary pipeline.

Return JSON only. No markdown. No commentary.

Output schema (exact keys, camelCase):
{
  "window": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" },
  "counts": { "daysWithEntries": 0, "totalMessages": 0 },
  "perDay": [
    {
      "date": "YYYY-MM-DD",
      "topicSentenceSeed": "Neutral descriptive topic sentence.",
      "facts": [{ "fact": "Factual statement.", "sourceSnippet": "5-12 word source snippet" }],
      "explicitEmotions": ["emotion only if explicitly stated by user"],
      "numericLogs": ["numeric content exactly as logged"]
    }
  ],
  "repeatCandidates": [
    { "label": "short label", "count": 2, "evidenceSnippets": ["snippet1", "snippet2"] }
  ],
  "limitsSignals": { "dataDensity": "sparse|moderate|dense", "reflectionDefensible": true }
}

Rules:
- Use only provided user logs. Do not invent facts.
- Ignore messages that are solely requests for a summary or report (e.g. "generate my summary", "I want my report", "send report", "give me my summary"). Do not extract facts from them; exclude them from topic sentence and facts for that day.
- No advice, no interpretation, no causality.
- Every fact must include sourceSnippet.
- Topic sentence must be descriptive and neutral.
- repeatCandidates only when repetition is actually present.
- If no data, return empty arrays and reflectionDefensible=false.

Input windowBundle JSON:
${JSON.stringify(windowBundle)}`;
}

export function buildWriterS2S3Prompt(
  canonical: CanonicalDoc,
  section3AllowedByCounts: boolean
): string {
  return `You are generating Section 2 and Section 3 for a neutral 15-day summary report.

Return JSON only. No markdown. No commentary.

Output schema (exact keys):
{
  "section2Text": "string",
  "section3Text": "string",
  "section3Included": true
}

Rules:
- Use only canonical facts provided. Do not mention or reflect summary/report requests in the report.
- Section 2 (Observed Patterns and Limits):
  - bullet-style lines about repeated elements (if any)
  - MUST include one line that begins with "Limits:" followed by at least one sentence (e.g. "Limits: Based on N logged days. [Brief note on data scope or why patterns are/are not meaningful.]"). Never leave the Limits line empty or without explanation.
  - no causality, no advice, no interpretation
- Section 3:
  - include only if section3AllowedByCounts=true AND canonical.limitsSignals.reflectionDefensible=true
  - 1 to 3 short statements
  - statements only, not questions
  - no advice, no interpretation
- If Section 3 excluded, set section3Included=false and section3Text="".

Input section3AllowedByCounts:
${JSON.stringify(section3AllowedByCounts)}

Input canonical JSON:
${JSON.stringify(canonical)}`;
}

export function buildWriterS4Prompt(canonical: CanonicalDoc): string {
  return `You are generating Section 4 (Logged Moments) for a neutral 15-day summary.

Return JSON only. No markdown. No commentary.

Output schema (exact keys):
{
  "section4Moments": [
    { "dateLabel": "March seven", "content": "One or two sentence summary for this day." }
  ]
}

Rules:
- One object per calendar day that has entries in canonical.perDay. Order by date (earliest first).
- Ignore summary/report requests: do not include them in content. Use only substantive log content from canonical.
- dateLabel: Short, human-readable date for the report. Use format like "March seven", "March thirteen", or "7 Mar 2026". Derive from the day's date in canonical.perDay[].date (YYYY-MM-DD).
- content: One or two neutral sentences summarizing that day. Use canonical.perDay[].topicSentenceSeed and canonical.perDay[].facts. Preserve all distinct factual points. Include emotions only if explicitly in canonical. Preserve numeric values exactly.
- No advice, no inference, no invention. Coverage-first: do not drop distinct facts for brevity.
- If canonical.perDay is empty, return "section4Moments": [].

Input canonical JSON:
${JSON.stringify(canonical)}`;
}

export function buildGuardfixPrompt(
  canonical: CanonicalDoc,
  draftS2S3: DraftS2S3,
  draftS4: DraftS4,
  section3AllowedByCounts: boolean
): string {
  return `You are a strict compliance fixer for a neutral 15-day summary.

Return JSON only. No markdown. No commentary.

Output schema (exact keys):
{
  "status": "PASS|FIXED",
  "changes": ["list of applied fixes"],
  "section2Text": "string",
  "section3Text": "string",
  "section3Included": true,
  "section4Moments": [
    { "dateLabel": "March seven", "content": "One or two sentence summary for this day." }
  ]
}

Responsibilities:
- Remove advice, causality, interpretation.
- Ensure Section 2 includes a "Limits:" line with at least one sentence after it (e.g. data scope or why patterns are/are not meaningful).
- Ensure Section 3 is statements only (no questions), 1-3 lines if included.
- If section3AllowedByCounts=false OR reflection not defensible, remove Section 3.
- Preserve Section 4 as array of { dateLabel, content }. Do not add new facts; fix only compliance issues.
- Remove any mention of summary or report requests from Section 4 content.
- Keep output neutral and structured.

Input section3AllowedByCounts:
${JSON.stringify(section3AllowedByCounts)}

Input canonical JSON:
${JSON.stringify(canonical)}

Input draft_s2_s3 JSON:
${JSON.stringify(draftS2S3)}

Input draft_s4 JSON:
${JSON.stringify(draftS4)}`;
}

