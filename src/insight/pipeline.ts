import { logger } from "../infra/logger";
import { loadLLMConfig } from "../llm/config";
import { buildCanonicalizerPrompt, PROMPT_VERSIONS } from "./prompts";
import { writeInsightArtifact, writeInsightErrorArtifact } from "./redisArtifacts";
import { runJsonStage, InsightStageError } from "./stageRunner";
import { isCanonicalDoc } from "./validation";
import type { InsightType, InsightPipelineResult, WindowBundle } from "./types";

import {
  buildSessionBridgeBriefPrompt,
  buildSessionBridgeGuardfixPrompt,
} from "./sessionbridge/prompts";
import {
  isDraftSessionBridge,
  isFinalSessionBridge,
} from "./sessionbridge/validation";
import {
  assembleSessionBridgeReport,
  renderSessionBridgePdf,
} from "./sessionbridge/assembler";

import {
  buildMirrorGuardfixPrompt,
  buildMirrorRecapPrompt,
} from "./myself-lately/prompts";
import { isFinalMirror, isMirrorDraft } from "./myself-lately/validation";
import {
  assembleMirrorReport,
  normalizeFinalMirror,
  renderMirrorPdf,
} from "./myself-lately/assembler";

export type InsightArtifactWriter = {
  writeArtifact: (
    userId: string,
    insightId: string,
    stage: string,
    payload: unknown
  ) => Promise<void>;
  writeErrorArtifact: (
    userId: string,
    insightId: string,
    stage: string,
    error: string,
    rawSnippet?: string
  ) => Promise<void>;
};

const redisArtifactWriter: InsightArtifactWriter = {
  writeArtifact: writeInsightArtifact,
  writeErrorArtifact: writeInsightErrorArtifact,
};

function stageFailureTag(stage: string): string {
  if (stage.startsWith("L1_")) return "L1_FAIL";
  if (stage === "L2_SESSIONBRIDGE_BRIEF") return "L2_SB_FAIL";
  if (stage === "L3_SESSIONBRIDGE_GUARDFIX") return "L3_SB_FAIL";
  if (stage === "L2_MIRROR_RECAP") return "L2_MIRROR_FAIL";
  if (stage === "L3_MIRROR_GUARDFIX") return "L3_MIRROR_FAIL";
  return "ASSEMBLY_FAIL";
}

type GenerateInsightPipelineInput = {
  userId: string;
  insightId: string;
  timezone?: string;
  windowBundle?: WindowBundle;
  artifactWriter?: InsightArtifactWriter;
  insightType?: InsightType;
};

export async function generateInsightPipeline(
  input: GenerateInsightPipelineInput
): Promise<InsightPipelineResult> {
  const model = loadLLMConfig();
  const artifactWriter = input.artifactWriter ?? redisArtifactWriter;
  const windowBundle = input.windowBundle ?? (await buildDbWindowBundle(input));
  const insightType: InsightType = input.insightType ?? "sessionbridge";

  await artifactWriter.writeArtifact(input.userId, input.insightId, "window_bundle", windowBundle);

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
    logger.info("insight stage done", {
      insightId: input.insightId,
      stage: "L1_CANONICALIZER",
      latencyMs: Date.now() - canonicalStarted,
    });
    await artifactWriter.writeArtifact(input.userId, input.insightId, "canonical", canonical);

    if (insightType === "myself_lately") {
      const recapStarted = Date.now();
      const mirrorDraft = await runJsonStage({
        stage: "L2_MIRROR_RECAP",
        prompt: buildMirrorRecapPrompt(canonical, windowBundle.window.days),
        maxTokens: 3600,
        validate: isMirrorDraft,
        complexity: "high",
        reasoning: false,
      });
      logger.info("insight stage done", {
        insightId: input.insightId,
        stage: "L2_MIRROR_RECAP",
        latencyMs: Date.now() - recapStarted,
      });
      await artifactWriter.writeArtifact(input.userId, input.insightId, "mirror_draft", mirrorDraft);

      const guardfixMirrorStarted = Date.now();
      const finalMirror = await runJsonStage({
        stage: "L3_MIRROR_GUARDFIX",
        prompt: buildMirrorGuardfixPrompt(canonical, mirrorDraft, windowBundle.window.days),
        maxTokens: 3600,
        validate: isFinalMirror,
        complexity: "high",
        reasoning: true,
      });
      logger.info("insight stage done", {
        insightId: input.insightId,
        stage: "L3_MIRROR_GUARDFIX",
        latencyMs: Date.now() - guardfixMirrorStarted,
      });
      await artifactWriter.writeArtifact(input.userId, input.insightId, "final_mirror", finalMirror);

      const normalized = normalizeFinalMirror(finalMirror);
      const finalReportText = assembleMirrorReport(windowBundle, normalized);
      const pdfBytes = await renderMirrorPdf(windowBundle, normalized);
      const promptVersionString = [
        `canon:${PROMPT_VERSIONS.canonicalizer}`,
        `mr:${PROMPT_VERSIONS.mirrorRecap}`,
        `mgf:${PROMPT_VERSIONS.mirrorGuardfix}`,
      ].join("|");

      return {
        insightType: "myself_lately",
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
    logger.info("insight stage done", {
      insightId: input.insightId,
      stage: "L2_SESSIONBRIDGE_BRIEF",
      latencyMs: Date.now() - briefStarted,
    });
    await artifactWriter.writeArtifact(input.userId, input.insightId, "sessionbridge_draft", draft);

    const guardfixStarted = Date.now();
    const finalSessionBridge = await runJsonStage({
      stage: "L3_SESSIONBRIDGE_GUARDFIX",
      prompt: buildSessionBridgeGuardfixPrompt(canonical, draft, windowBundle.window.days),
      maxTokens: 4200,
      validate: isFinalSessionBridge,
      complexity: "high",
      reasoning: true,
    });
    logger.info("insight stage done", {
      insightId: input.insightId,
      stage: "L3_SESSIONBRIDGE_GUARDFIX",
      latencyMs: Date.now() - guardfixStarted,
    });
    await artifactWriter.writeArtifact(input.userId, input.insightId, "sessionbridge_final", finalSessionBridge);

    const finalReportText = assembleSessionBridgeReport(windowBundle, finalSessionBridge);
    const pdfBytes = await renderSessionBridgePdf(windowBundle, finalSessionBridge);
    const promptVersionString = [
      `canon:${PROMPT_VERSIONS.canonicalizer}`,
      `sb:${PROMPT_VERSIONS.sessionbridgeBrief}`,
      `sbgf:${PROMPT_VERSIONS.sessionbridgeGuardfix}`,
    ].join("|");

    return {
      insightType: "sessionbridge",
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
    if (err instanceof InsightStageError) {
      logger.error("insight stage failed", {
        insightId: input.insightId,
        userId: input.userId,
        stage: err.stage,
        tag: stageFailureTag(err.stage),
        error: err.message,
      });
      await artifactWriter.writeErrorArtifact(input.userId, input.insightId, err.stage, err.message, err.rawSnippet);
    } else {
      logger.error("insight pipeline failed", {
        insightId: input.insightId,
        userId: input.userId,
        tag: "ASSEMBLY_FAIL",
        error: err instanceof Error ? err.message : String(err),
      });
      await artifactWriter.writeErrorArtifact(
        input.userId,
        input.insightId,
        "PIPELINE",
        err instanceof Error ? err.message : String(err)
      );
    }
    throw err;
  }
}

async function buildDbWindowBundle(
  input: Pick<GenerateInsightPipelineInput, "userId" | "timezone">
): Promise<WindowBundle> {
  const { buildWindowBundle } = await import("./windowBuilder");
  return await buildWindowBundle(input.userId, input.timezone ?? "Asia/Kolkata");
}
