"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSummaryPipeline = generateSummaryPipeline;
const logger_1 = require("../infra/logger");
const config_1 = require("../llm/config");
const p0_1 = require("./p0");
const prompts_1 = require("./prompts");
const redisArtifacts_1 = require("./redisArtifacts");
const p1_1 = require("./p1");
const stageRunner_1 = require("./stageRunner");
const validation_1 = require("./validation");
function stageFailureTag(stage) {
    if (stage.startsWith("L1_"))
        return "L1_FAIL";
    if (stage.startsWith("L2A_"))
        return "L2A_FAIL";
    if (stage.startsWith("L2B_"))
        return "L2B_FAIL";
    if (stage.startsWith("L3_"))
        return "L3_FAIL";
    return "ASSEMBLY_FAIL";
}
async function generateSummaryPipeline(input) {
    const model = (0, config_1.loadLLMConfig)();
    const windowBundle = input.windowBundle ?? (await (0, p0_1.buildWindowBundle)(input.userId, input.timezone ?? "Asia/Kolkata"));
    await (0, redisArtifacts_1.writeSummaryArtifact)(input.userId, input.summaryId, "window_bundle", windowBundle);
    try {
        const canonicalStarted = Date.now();
        const canonical = await (0, stageRunner_1.runJsonStage)({
            stage: "L1_CANONICALIZER",
            prompt: (0, prompts_1.buildCanonicalizerPrompt)(windowBundle),
            maxTokens: 3200,
            validate: validation_1.isCanonicalDoc,
            complexity: 'medium',
            reasoning: false,
        });
        logger_1.logger.info("summary stage done", {
            summaryId: input.summaryId,
            stage: "L1_CANONICALIZER",
            latencyMs: Date.now() - canonicalStarted,
        });
        await (0, redisArtifacts_1.writeSummaryArtifact)(input.userId, input.summaryId, "canonical", canonical);
        const draftS2S3Started = Date.now();
        const draftS2S3 = await (0, stageRunner_1.runJsonStage)({
            stage: "L2A_WRITER_S2_S3",
            prompt: (0, prompts_1.buildWriterS2S3Prompt)(canonical, windowBundle.section3AllowedByCounts),
            maxTokens: 2200,
            validate: validation_1.isDraftS2S3,
            complexity: 'medium',
            reasoning: false,
        });
        logger_1.logger.info("summary stage done", {
            summaryId: input.summaryId,
            stage: "L2A_WRITER_S2_S3",
            latencyMs: Date.now() - draftS2S3Started,
        });
        await (0, redisArtifacts_1.writeSummaryArtifact)(input.userId, input.summaryId, "draft_s2_s3", draftS2S3);
        const draftS4Started = Date.now();
        const draftS4 = await (0, stageRunner_1.runJsonStage)({
            stage: "L2B_WRITER_S4",
            prompt: (0, prompts_1.buildWriterS4Prompt)(canonical),
            maxTokens: 3600,
            validate: validation_1.isDraftS4,
            complexity: 'medium',
            reasoning: false,
        });
        logger_1.logger.info("summary stage done", {
            summaryId: input.summaryId,
            stage: "L2B_WRITER_S4",
            latencyMs: Date.now() - draftS4Started,
        });
        await (0, redisArtifacts_1.writeSummaryArtifact)(input.userId, input.summaryId, "draft_s4", draftS4);
        const guardfixStarted = Date.now();
        const finalSections = await (0, stageRunner_1.runJsonStage)({
            stage: "L3_GUARDFIX",
            prompt: (0, prompts_1.buildGuardfixPrompt)(canonical, draftS2S3, draftS4, windowBundle.section3AllowedByCounts),
            maxTokens: 3500,
            validate: validation_1.isFinalSections,
            complexity: 'high',
            reasoning: true,
        });
        logger_1.logger.info("summary stage done", {
            summaryId: input.summaryId,
            stage: "L3_GUARDFIX",
            latencyMs: Date.now() - guardfixStarted,
        });
        const sectionRuleErrors = (0, validation_1.validateFinalSectionRules)(finalSections, canonical.limitsSignals.reflectionDefensible, windowBundle.section3AllowedByCounts);
        if (sectionRuleErrors.length > 0) {
            throw new Error(`Final section validation failed: ${sectionRuleErrors.join("; ")}`);
        }
        await (0, redisArtifacts_1.writeSummaryArtifact)(input.userId, input.summaryId, "final_sections", finalSections);
        const finalReportText = (0, p1_1.assembleFinalReport)(windowBundle, finalSections);
        const pdfBytes = (0, p1_1.renderReportPdf)(finalReportText);
        const promptVersionString = [
            `canon:${prompts_1.PROMPT_VERSIONS.canonicalizer}`,
            `wA:${prompts_1.PROMPT_VERSIONS.writerS2S3}`,
            `wB:${prompts_1.PROMPT_VERSIONS.writerS4}`,
            `gf:${prompts_1.PROMPT_VERSIONS.guardfix}`,
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
    }
    catch (err) {
        if (err instanceof stageRunner_1.SummaryStageError) {
            logger_1.logger.error("summary stage failed", {
                summaryId: input.summaryId,
                userId: input.userId,
                stage: err.stage,
                tag: stageFailureTag(err.stage),
                error: err.message,
            });
            await (0, redisArtifacts_1.writeSummaryErrorArtifact)(input.userId, input.summaryId, err.stage, err.message, err.rawSnippet);
        }
        else {
            logger_1.logger.error("summary pipeline failed", {
                summaryId: input.summaryId,
                userId: input.userId,
                tag: "ASSEMBLY_FAIL",
                error: err instanceof Error ? err.message : String(err),
            });
            await (0, redisArtifacts_1.writeSummaryErrorArtifact)(input.userId, input.summaryId, "PIPELINE", err instanceof Error ? err.message : String(err));
        }
        throw err;
    }
}
