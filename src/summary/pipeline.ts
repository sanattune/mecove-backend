import { logger } from "../infra/logger";
import { loadLLMConfig } from "../llm/config";
import {
  buildCanonicalizerPrompt,
  buildMirrorGuardfixPrompt,
  buildMirrorRecapPrompt,
  buildSessionBridgeBriefPrompt,
  buildSessionBridgeGuardfixPrompt,
  PROMPT_VERSIONS,
} from "./prompts";
import { writeSummaryArtifact, writeSummaryErrorArtifact } from "./redisArtifacts";
import {
  assembleFinalMirrorReport,
  assembleFinalReport,
  renderMirrorReportPdf,
  renderReportPdf,
} from "./reportAssembler";
import { runJsonStage, SummaryStageError } from "./stageRunner";
import {
  isCanonicalDoc,
  isDraftSessionBridge,
  isFinalMirror,
  isFinalSessionBridge,
  isMirrorDraft,
} from "./validation";
import type { FinalMirror, MirrorEntry, ReportType, SummaryPipelineResult, WindowBundle } from "./types";

export type SummaryArtifactWriter = {
  writeArtifact: (
    userId: string,
    summaryId: string,
    stage: string,
    payload: unknown
  ) => Promise<void>;
  writeErrorArtifact: (
    userId: string,
    summaryId: string,
    stage: string,
    error: string,
    rawSnippet?: string
  ) => Promise<void>;
};

const redisArtifactWriter: SummaryArtifactWriter = {
  writeArtifact: writeSummaryArtifact,
  writeErrorArtifact: writeSummaryErrorArtifact,
};

/**
 * Deterministic caps on the mirror recap. The LLM guardfix is asked to trim
 * but sometimes overshoots or skips execution, so we enforce list and entry
 * size ceilings in code before the report is rendered.
 */
function normalizeFinalMirror(finalMirror: FinalMirror): FinalMirror {
  const MAX_PATTERNS = 5;
  const MAX_MOMENTS = 4;
  const MAX_FLAGS = 4;
  const trimEntry = (entry: MirrorEntry): MirrorEntry => ({
    anchor: entry.anchor.trim(),
    body: entry.body.trim().replace(/\s+/g, " "),
  });
  const sparse = (finalMirror.patterns.length + finalMirror.moments.length + finalMirror.flags.length) === 0;
  return {
    ...finalMirror,
    openerSentence: finalMirror.openerSentence.trim().replace(/\s+/g, " "),
    patterns: finalMirror.patterns.slice(0, MAX_PATTERNS).map(trimEntry),
    moments: finalMirror.moments.slice(0, MAX_MOMENTS).map(trimEntry),
    flags: finalMirror.flags.slice(0, MAX_FLAGS).map(trimEntry),
    // If the LLM emitted all-empty lists (sparse data path), leave as-is.
    ...(sparse ? {} : {}),
  };
}

function stageFailureTag(stage: string): string {
  if (stage.startsWith("L1_")) return "L1_FAIL";
  if (stage === "L2_SESSIONBRIDGE_BRIEF") return "L2_SB_FAIL";
  if (stage === "L3_SESSIONBRIDGE_GUARDFIX") return "L3_SB_FAIL";
  if (stage === "L2_MIRROR_RECAP") return "L2_MIRROR_FAIL";
  if (stage === "L3_MIRROR_GUARDFIX") return "L3_MIRROR_FAIL";
  return "ASSEMBLY_FAIL";
}

type GenerateSummaryPipelineInput = {
  userId: string;
  summaryId: string;
  timezone?: string;
  windowBundle?: WindowBundle;
  artifactWriter?: SummaryArtifactWriter;
  reportType?: ReportType;
};

export async function generateSummaryPipeline(
  input: GenerateSummaryPipelineInput
): Promise<SummaryPipelineResult> {
  const model = loadLLMConfig();
  const artifactWriter = input.artifactWriter ?? redisArtifactWriter;
  const windowBundle = input.windowBundle ?? (await buildDbWindowBundle(input));
  const reportType: ReportType = input.reportType ?? "sessionbridge";

  await artifactWriter.writeArtifact(input.userId, input.summaryId, "window_bundle", windowBundle);

  try {
    const canonicalStarted = Date.now();
    const canonical = await runJsonStage({
      stage: "L1_CANONICALIZER",
      prompt: buildCanonicalizerPrompt(windowBundle),
      maxTokens: 3200,
      validate: isCanonicalDoc,
      complexity: 'medium',
      reasoning: false,
    });
    logger.info("summary stage done", {
      summaryId: input.summaryId,
      stage: "L1_CANONICALIZER",
      latencyMs: Date.now() - canonicalStarted,
    });
    await artifactWriter.writeArtifact(input.userId, input.summaryId, "canonical", canonical);

    if (reportType === "myself_lately") {
      const recapStarted = Date.now();
      const mirrorDraft = await runJsonStage({
        stage: "L2_MIRROR_RECAP",
        prompt: buildMirrorRecapPrompt(canonical, windowBundle.window.days),
        maxTokens: 3600,
        validate: isMirrorDraft,
        complexity: "high",
        reasoning: false,
      });
      logger.info("summary stage done", {
        summaryId: input.summaryId,
        stage: "L2_MIRROR_RECAP",
        latencyMs: Date.now() - recapStarted,
      });
      await artifactWriter.writeArtifact(input.userId, input.summaryId, "mirror_draft", mirrorDraft);

      const guardfixMirrorStarted = Date.now();
      const finalMirror = await runJsonStage({
        stage: "L3_MIRROR_GUARDFIX",
        prompt: buildMirrorGuardfixPrompt(canonical, mirrorDraft, windowBundle.window.days),
        maxTokens: 3600,
        validate: isFinalMirror,
        complexity: "high",
        reasoning: true,
      });
      logger.info("summary stage done", {
        summaryId: input.summaryId,
        stage: "L3_MIRROR_GUARDFIX",
        latencyMs: Date.now() - guardfixMirrorStarted,
      });
      await artifactWriter.writeArtifact(input.userId, input.summaryId, "final_mirror", finalMirror);

      const normalized = normalizeFinalMirror(finalMirror);
      const finalReportText = assembleFinalMirrorReport(windowBundle, normalized);
      const pdfBytes = await renderMirrorReportPdf(windowBundle, normalized);
      const promptVersionString = [
        `canon:${PROMPT_VERSIONS.canonicalizer}`,
        `mr:${PROMPT_VERSIONS.mirrorRecap}`,
        `mgf:${PROMPT_VERSIONS.mirrorGuardfix}`,
      ].join("|");

      return {
        reportType: "myself_lately",
        windowBundle,
        canonical,
        mirrorDraft,
        finalMirror,
        finalReportText,
        pdfBytes,
        promptVersionString,
        modelName: model.modelName,
      };
    }

    const briefStarted = Date.now();
    const draft = await runJsonStage({
      stage: "L2_SESSIONBRIDGE_BRIEF",
      prompt: buildSessionBridgeBriefPrompt(canonical, windowBundle.window.days),
      maxTokens: 4200,
      validate: isDraftSessionBridge,
      complexity: "high",
      reasoning: false,
    });
    logger.info("summary stage done", {
      summaryId: input.summaryId,
      stage: "L2_SESSIONBRIDGE_BRIEF",
      latencyMs: Date.now() - briefStarted,
    });
    await artifactWriter.writeArtifact(input.userId, input.summaryId, "sessionbridge_draft", draft);

    const guardfixStarted = Date.now();
    const finalSessionBridge = await runJsonStage({
      stage: "L3_SESSIONBRIDGE_GUARDFIX",
      prompt: buildSessionBridgeGuardfixPrompt(canonical, draft, windowBundle.window.days),
      maxTokens: 4200,
      validate: isFinalSessionBridge,
      complexity: "high",
      reasoning: true,
    });
    logger.info("summary stage done", {
      summaryId: input.summaryId,
      stage: "L3_SESSIONBRIDGE_GUARDFIX",
      latencyMs: Date.now() - guardfixStarted,
    });
    await artifactWriter.writeArtifact(input.userId, input.summaryId, "sessionbridge_final", finalSessionBridge);

    const finalReportText = assembleFinalReport(windowBundle, finalSessionBridge);
    const pdfBytes = await renderReportPdf(windowBundle, finalSessionBridge);
    const promptVersionString = [
      `canon:${PROMPT_VERSIONS.canonicalizer}`,
      `sb:${PROMPT_VERSIONS.sessionbridgeBrief}`,
      `sbgf:${PROMPT_VERSIONS.sessionbridgeGuardfix}`,
    ].join("|");

    return {
      reportType: "sessionbridge",
      windowBundle,
      canonical,
      draft,
      final: finalSessionBridge,
      finalReportText,
      pdfBytes,
      promptVersionString,
      modelName: model.modelName,
    };
  } catch (err) {
    if (err instanceof SummaryStageError) {
      logger.error("summary stage failed", {
        summaryId: input.summaryId,
        userId: input.userId,
        stage: err.stage,
        tag: stageFailureTag(err.stage),
        error: err.message,
      });
      await artifactWriter.writeErrorArtifact(input.userId, input.summaryId, err.stage, err.message, err.rawSnippet);
    } else {
      logger.error("summary pipeline failed", {
        summaryId: input.summaryId,
        userId: input.userId,
        tag: "ASSEMBLY_FAIL",
        error: err instanceof Error ? err.message : String(err),
      });
      await artifactWriter.writeErrorArtifact(
        input.userId,
        input.summaryId,
        "PIPELINE",
        err instanceof Error ? err.message : String(err)
      );
    }
    throw err;
  }
}

async function buildDbWindowBundle(
  input: Pick<GenerateSummaryPipelineInput, "userId" | "timezone">
): Promise<WindowBundle> {
  const { buildWindowBundle } = await import("./windowBuilder");
  return await buildWindowBundle(input.userId, input.timezone ?? "Asia/Kolkata");
}
