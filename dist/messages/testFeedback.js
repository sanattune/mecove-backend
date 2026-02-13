"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_FEEDBACK_MISSING_REPLY = exports.TEST_FEEDBACK_SUCCESS_REPLY = exports.TEST_FEEDBACK_COMMAND = exports.TEST_FEEDBACK_PREFIX = void 0;
exports.parseTestFeedbackCommand = parseTestFeedbackCommand;
exports.toStoredTestFeedback = toStoredTestFeedback;
exports.isStoredTestFeedbackText = isStoredTestFeedbackText;
exports.TEST_FEEDBACK_PREFIX = "<test feedback>";
exports.TEST_FEEDBACK_COMMAND = "/f";
exports.TEST_FEEDBACK_SUCCESS_REPLY = "test feedback received";
exports.TEST_FEEDBACK_MISSING_REPLY = "test feedback missing, please add feedback after /f";
function parseTestFeedbackCommand(input) {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
        return { isCommand: false, feedback: null };
    }
    const command = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (command !== exports.TEST_FEEDBACK_COMMAND) {
        return { isCommand: false, feedback: null };
    }
    const feedback = trimmed.slice(command.length).trim();
    return {
        isCommand: true,
        feedback: feedback.length > 0 ? feedback : null,
    };
}
function toStoredTestFeedback(feedback) {
    return `${exports.TEST_FEEDBACK_PREFIX} ${feedback.trim()}`;
}
function isStoredTestFeedbackText(text) {
    if (typeof text !== "string")
        return false;
    return text.trim().toLowerCase().startsWith(exports.TEST_FEEDBACK_PREFIX.toLowerCase());
}
