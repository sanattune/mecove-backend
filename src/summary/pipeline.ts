import { logger } from "../infra/logger";
import { loadLLMConfig } from "../llm/config";
import { buildWindowBundle } from "./p0";
import {
  buildCanonicalizerPrompt,
  buildGuardfixPrompt,
  buildWriterS2S3Prompt,
  buildWriterS4Prompt,
  PROMPT_VERSIONS,
} from "./prompts";
import { writeSummaryArtifact, writeSummaryErrorArtifact } from "./redisArtifacts";
import { assembleFinalReport, renderReportPdf } from "./p1";
import { runJsonStage, SummaryStageError } from "./stageRunner";
import {
  isCanonicalDoc,
  isDraftS2S3,
  isDraftS4,
  isFinalSections,
  validateFinalSectionRules,
} from "./validation";
import type { SummaryPipelineResult, WindowBundle } from "./types";

function stageFailureTag(stage: string): string {
  if (stage.startsWith("L1_")) return "L1_FAIL";
  if (stage.startsWith("L2A_")) return "L2A_FAIL";
  if (stage.startsWith("L2B_")) return "L2B_FAIL";
  if (stage.startsWith("L3_")) return "L3_FAIL";
  return "ASSEMBLY_FAIL";
}

type GenerateSummaryPipelineInput = {
  userId: string;
  summaryId: string;
  timezone?: string;
  windowBundle?: WindowBundle;
};

export async function generateSummaryPipeline(
  input: GenerateSummaryPipelineInput
): Promise<SummaryPipelineResult> {
  const model = loadLLMConfig();
  const windowBundle =
    input.windowBundle ?? (await buildWindowBundle(input.userId, input.timezone ?? "Asia/Kolkata"));

  await writeSummaryArtifact(input.userId, input.summaryId, "window_bundle", windowBundle);

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
    await writeSummaryArtifact(input.userId, input.summaryId, "canonical", canonical);

    const draftS2S3Started = Date.now();
    const draftS2S3 = await runJsonStage({
      stage: "L2A_WRITER_S2_S3",
      prompt: buildWriterS2S3Prompt(canonical, windowBundle.section3AllowedByCounts),
      maxTokens: 2200,
      validate: isDraftS2S3,
      complexity: 'high',
      reasoning: false,
    });
    logger.info("summary stage done", {
      summaryId: input.summaryId,
      stage: "L2A_WRITER_S2_S3",
      latencyMs: Date.now() - draftS2S3Started,
    });
    await writeSummaryArtifact(input.userId, input.summaryId, "draft_s2_s3", draftS2S3);

    const draftS4Started = Date.now();
    const draftS4 = await runJsonStage({
      stage: "L2B_WRITER_S4",
      prompt: buildWriterS4Prompt(canonical),
      maxTokens: 3600,
      validate: isDraftS4,
      complexity: 'high',
      reasoning: false,
    });
    logger.info("summary stage done", {
      summaryId: input.summaryId,
      stage: "L2B_WRITER_S4",
      latencyMs: Date.now() - draftS4Started,
    });
    await writeSummaryArtifact(input.userId, input.summaryId, "draft_s4", draftS4);

    const guardfixStarted = Date.now();
    const finalSections = await runJsonStage({
      stage: "L3_GUARDFIX",
      prompt: buildGuardfixPrompt(
        canonical,
        draftS2S3,
        draftS4,
        windowBundle.section3AllowedByCounts
      ),
      maxTokens: 3500,
      validate: isFinalSections,
      complexity: 'high',
      reasoning: true,
    });
    logger.info("summary stage done", {
      summaryId: input.summaryId,
      stage: "L3_GUARDFIX",
      latencyMs: Date.now() - guardfixStarted,
    });

    const sectionRuleErrors = validateFinalSectionRules(
      finalSections,
      canonical.limitsSignals.reflectionDefensible,
      windowBundle.section3AllowedByCounts
    );
    if (sectionRuleErrors.length > 0) {
      throw new Error(`Final section validation failed: ${sectionRuleErrors.join("; ")}`);
    }

    await writeSummaryArtifact(input.userId, input.summaryId, "final_sections", finalSections);

    const finalReportText = assembleFinalReport(windowBundle, finalSections);
    const pdfBytes = renderReportPdf(finalReportText);
    const promptVersionString = [
      `canon:${PROMPT_VERSIONS.canonicalizer}`,
      `wA:${PROMPT_VERSIONS.writerS2S3}`,
      `wB:${PROMPT_VERSIONS.writerS4}`,
      `gf:${PROMPT_VERSIONS.guardfix}`,
    ].join("|");

    return {
      windowBundle,
      canonical,
      draftS2S3,
      draftS4,
      finalSections,
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
      await writeSummaryErrorArtifact(input.userId, input.summaryId, err.stage, err.message, err.rawSnippet);
    } else {
      logger.error("summary pipeline failed", {
        summaryId: input.summaryId,
        userId: input.userId,
        tag: "ASSEMBLY_FAIL",
        error: err instanceof Error ? err.message : String(err),
      });
      await writeSummaryErrorArtifact(
        input.userId,
        input.summaryId,
        "PIPELINE",
        err instanceof Error ? err.message : String(err)
      );
    }
    throw err;
  }
}
