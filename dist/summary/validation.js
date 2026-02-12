"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCanonicalDoc = isCanonicalDoc;
exports.isDraftS2S3 = isDraftS2S3;
exports.isDraftS4 = isDraftS4;
exports.isFinalSections = isFinalSections;
exports.validateFinalSectionRules = validateFinalSectionRules;
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function asString(value) {
    return typeof value === "string";
}
function asBoolean(value) {
    return typeof value === "boolean";
}
function asArray(value) {
    return Array.isArray(value);
}
function isCanonicalDoc(value) {
    if (!isRecord(value))
        return false;
    if (!isRecord(value.window) || !asString(value.window.startDate) || !asString(value.window.endDate)) {
        return false;
    }
    if (!isRecord(value.counts) ||
        typeof value.counts.daysWithEntries !== "number" ||
        typeof value.counts.totalMessages !== "number") {
        return false;
    }
    if (!asArray(value.perDay) || !asArray(value.repeatCandidates) || !isRecord(value.limitsSignals)) {
        return false;
    }
    if (!asString(value.limitsSignals.dataDensity) ||
        !asBoolean(value.limitsSignals.reflectionDefensible)) {
        return false;
    }
    for (const day of value.perDay) {
        if (!isRecord(day))
            return false;
        if (!asString(day.date) || !asString(day.topicSentenceSeed))
            return false;
        if (!asArray(day.facts) || !asArray(day.explicitEmotions) || !asArray(day.numericLogs))
            return false;
        for (const fact of day.facts) {
            if (!isRecord(fact) || !asString(fact.fact) || !asString(fact.sourceSnippet)) {
                return false;
            }
        }
        if (!day.explicitEmotions.every(asString))
            return false;
        if (!day.numericLogs.every(asString))
            return false;
    }
    for (const rep of value.repeatCandidates) {
        if (!isRecord(rep))
            return false;
        if (!asString(rep.label) || typeof rep.count !== "number" || !asArray(rep.evidenceSnippets)) {
            return false;
        }
        if (!rep.evidenceSnippets.every(asString))
            return false;
    }
    return true;
}
function isDraftS2S3(value) {
    if (!isRecord(value))
        return false;
    return (asString(value.section2Text) &&
        asString(value.section3Text) &&
        asBoolean(value.section3Included));
}
function isDraftS4(value) {
    if (!isRecord(value))
        return false;
    return asString(value.section4Text);
}
function isFinalSections(value) {
    if (!isRecord(value))
        return false;
    if (!(value.status === "PASS" || value.status === "FIXED"))
        return false;
    if (!asArray(value.changes) || !value.changes.every(asString))
        return false;
    return (asString(value.section2Text) &&
        asString(value.section3Text) &&
        asBoolean(value.section3Included) &&
        asString(value.section4Text));
}
function validateFinalSectionRules(finalSections, reflectionDefensible, section3AllowedByCounts) {
    const errors = [];
    const section2 = finalSections.section2Text.trim();
    const section3 = finalSections.section3Text.trim();
    const section4 = finalSections.section4Text.trim();
    if (!section2) {
        errors.push("Section 2 is empty.");
    }
    else if (!section2.includes("Limits:")) {
        errors.push('Section 2 must include "Limits:" line.');
    }
    if (!section4) {
        errors.push("Section 4 is empty.");
    }
    if (finalSections.section3Included) {
        if (!section3AllowedByCounts || !reflectionDefensible) {
            errors.push("Section 3 included when not defensible.");
        }
        const lines = section3
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (lines.length < 1 || lines.length > 3) {
            errors.push("Section 3 must contain 1-3 statements.");
        }
        if (section3.includes("?")) {
            errors.push("Section 3 must not contain questions.");
        }
    }
    return errors;
}
