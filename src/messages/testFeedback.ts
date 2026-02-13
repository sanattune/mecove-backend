export const TEST_FEEDBACK_PREFIX = "<test feedback>";
export const TEST_FEEDBACK_COMMAND = "/f";
export const TEST_FEEDBACK_SUCCESS_REPLY = "test feedback received";
export const TEST_FEEDBACK_MISSING_REPLY =
  "test feedback missing, please add feedback after /f";

export type ParsedTestFeedbackCommand = {
  isCommand: boolean;
  feedback: string | null;
};

export function parseTestFeedbackCommand(input: string): ParsedTestFeedbackCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { isCommand: false, feedback: null };
  }

  const command = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (command !== TEST_FEEDBACK_COMMAND) {
    return { isCommand: false, feedback: null };
  }

  const feedback = trimmed.slice(command.length).trim();
  return {
    isCommand: true,
    feedback: feedback.length > 0 ? feedback : null,
  };
}

export function toStoredTestFeedback(feedback: string): string {
  return `${TEST_FEEDBACK_PREFIX} ${feedback.trim()}`;
}

export function isStoredTestFeedbackText(text: string | null | undefined): boolean {
  if (typeof text !== "string") return false;
  return text.trim().toLowerCase().startsWith(TEST_FEEDBACK_PREFIX.toLowerCase());
}
