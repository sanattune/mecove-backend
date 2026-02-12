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
- Use only canonical facts provided.
- Section 2:
  - bullet-style lines about repeated elements
  - MUST include one line that begins with "Limits:"
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

Output schema:
{
  "section4Text": "string"
}

Rules:
- One consolidated entry per calendar day.
- Use canonical.perDay[].topicSentenceSeed as anchor for each day.
- Preserve all distinct factual points from canonical.perDay[].facts.
- Include emotions only if explicitly present in canonical.
- Preserve numeric values exactly.
- No advice, no inference, no invention.
- Coverage-first: do not drop distinct facts for brevity.

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
  "section4Text": "string"
}

Responsibilities:
- Remove advice, causality, interpretation.
- Ensure Section 2 includes a "Limits:" line.
- Ensure Section 3 is statements only (no questions), 1-3 lines if included.
- If section3AllowedByCounts=false OR reflection not defensible, remove Section 3.
- Preserve factual coverage in Section 4. Do not add new facts.
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

