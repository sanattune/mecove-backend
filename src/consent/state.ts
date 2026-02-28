import type { ConsentConfig, ConsentStep } from "./config";

export const CONSENT_ORDER: ConsentStep[] = ["mvp"];

export const CONSENT_ACTION_IDS: Record<
  ConsentStep,
  { accept: string; later: string }
> = {
  mvp: {
    accept: "consent_mvp_accept",
    later: "consent_mvp_later",
  },
};

type ConsentFieldsByStep = Record<
  ConsentStep,
  {
    acceptedAt: "mvpAcceptedAt";
    acceptedVersion: "mvpAcceptedVersion";
  }
>;

const CONSENT_FIELDS: ConsentFieldsByStep = {
  mvp: {
    acceptedAt: "mvpAcceptedAt",
    acceptedVersion: "mvpAcceptedVersion",
  },
};

export type ConsentUserState = {
  privacyAcceptedAt: Date | null;
  privacyAcceptedVersion: string | null;
  termsAcceptedAt: Date | null;
  termsAcceptedVersion: string | null;
  mvpAcceptedAt: Date | null;
  mvpAcceptedVersion: string | null;
};

export type ConsentAction =
  | { type: "accept"; step: ConsentStep }
  | { type: "later"; step?: ConsentStep };

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function stepFromActionId(actionId: string): ConsentAction | null {
  for (const step of CONSENT_ORDER) {
    const ids = CONSENT_ACTION_IDS[step];
    if (actionId === ids.accept) return { type: "accept", step };
    if (actionId === ids.later) return { type: "later", step };
  }
  return null;
}

function extractActionId(messageNode: Record<string, unknown>): string | null {
  const interactive = messageNode.interactive as Record<string, unknown> | undefined;
  const interactiveButtonReply = interactive?.button_reply as
    | Record<string, unknown>
    | undefined;
  const interactiveId =
    typeof interactiveButtonReply?.id === "string"
      ? interactiveButtonReply.id.trim().toLowerCase()
      : "";
  if (interactiveId) return interactiveId;

  const button = messageNode.button as Record<string, unknown> | undefined;
  const buttonPayload =
    typeof button?.payload === "string" ? button.payload.trim().toLowerCase() : "";
  if (buttonPayload) return buttonPayload;

  return null;
}

function extractTextBody(messageNode: Record<string, unknown>): string | null {
  const text = messageNode.text as Record<string, unknown> | undefined;
  const body = typeof text?.body === "string" ? text.body : "";
  const normalized = normalizeText(body);
  return normalized.length > 0 ? normalized : null;
}

export function parseConsentAction(messageNode: unknown): ConsentAction | null {
  if (!messageNode || typeof messageNode !== "object") return null;
  const node = messageNode as Record<string, unknown>;

  const actionId = extractActionId(node);
  if (actionId) {
    return stepFromActionId(actionId);
  }

  const text = extractTextBody(node);
  if (!text) return null;

  if (text === "later" || text === "/later" || text === "accept later") {
    return { type: "later" };
  }

  const acceptCommands: Record<ConsentStep, string[]> = {
    mvp: ["accept mvp", "/accept mvp", "i accept mvp", "accept", "/accept", "i accept"],
  };
  for (const step of CONSENT_ORDER) {
    if (acceptCommands[step].includes(text)) {
      return { type: "accept", step };
    }
  }

  const laterCommands: Record<ConsentStep, string[]> = {
    mvp: ["mvp later", "later mvp", "/later mvp"],
  };
  for (const step of CONSENT_ORDER) {
    if (laterCommands[step].includes(text)) {
      return { type: "later", step };
    }
  }

  return null;
}

function isStepAccepted(
  user: ConsentUserState,
  config: ConsentConfig,
  step: ConsentStep
): boolean {
  const fields = CONSENT_FIELDS[step];
  const acceptedAt = user[fields.acceptedAt];
  const acceptedVersion = user[fields.acceptedVersion];
  return (
    acceptedAt instanceof Date &&
    typeof acceptedVersion === "string" &&
    acceptedVersion === config[step].version
  );
}

export function getPendingConsentStep(
  user: ConsentUserState,
  config: ConsentConfig
): ConsentStep | null {
  for (const step of CONSENT_ORDER) {
    if (!isStepAccepted(user, config, step)) return step;
  }
  return null;
}

export function isConsentComplete(
  user: ConsentUserState,
  config: ConsentConfig
): boolean {
  return getPendingConsentStep(user, config) === null;
}

type ConsentAcceptanceData = Partial<{
  mvpAcceptedAt: Date;
  mvpAcceptedVersion: string;
}>;

export function applyConsentAcceptance(
  userId: string,
  step: ConsentStep,
  configVersion: string,
  acceptedAt = new Date()
): {
  where: { id: string };
  data: ConsentAcceptanceData;
} {
  const fields = CONSENT_FIELDS[step];
  return {
    where: { id: userId },
    data: {
      [fields.acceptedAt]: acceptedAt,
      [fields.acceptedVersion]: configVersion,
    },
  };
}
