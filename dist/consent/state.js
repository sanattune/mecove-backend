"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSENT_ACTION_IDS = exports.CONSENT_ORDER = void 0;
exports.parseConsentAction = parseConsentAction;
exports.getPendingConsentStep = getPendingConsentStep;
exports.isConsentComplete = isConsentComplete;
exports.applyConsentAcceptance = applyConsentAcceptance;
exports.CONSENT_ORDER = ["privacy", "terms", "mvp"];
exports.CONSENT_ACTION_IDS = {
    privacy: {
        accept: "consent_privacy_accept",
        later: "consent_privacy_later",
    },
    terms: {
        accept: "consent_terms_accept",
        later: "consent_terms_later",
    },
    mvp: {
        accept: "consent_mvp_accept",
        later: "consent_mvp_later",
    },
};
const CONSENT_FIELDS = {
    privacy: {
        acceptedAt: "privacyAcceptedAt",
        acceptedVersion: "privacyAcceptedVersion",
    },
    terms: {
        acceptedAt: "termsAcceptedAt",
        acceptedVersion: "termsAcceptedVersion",
    },
    mvp: {
        acceptedAt: "mvpAcceptedAt",
        acceptedVersion: "mvpAcceptedVersion",
    },
};
function normalizeText(value) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function stepFromActionId(actionId) {
    for (const step of exports.CONSENT_ORDER) {
        const ids = exports.CONSENT_ACTION_IDS[step];
        if (actionId === ids.accept)
            return { type: "accept", step };
        if (actionId === ids.later)
            return { type: "later", step };
    }
    return null;
}
function extractActionId(messageNode) {
    const interactive = messageNode.interactive;
    const interactiveButtonReply = interactive?.button_reply;
    const interactiveId = typeof interactiveButtonReply?.id === "string"
        ? interactiveButtonReply.id.trim().toLowerCase()
        : "";
    if (interactiveId)
        return interactiveId;
    const button = messageNode.button;
    const buttonPayload = typeof button?.payload === "string" ? button.payload.trim().toLowerCase() : "";
    if (buttonPayload)
        return buttonPayload;
    return null;
}
function extractTextBody(messageNode) {
    const text = messageNode.text;
    const body = typeof text?.body === "string" ? text.body : "";
    const normalized = normalizeText(body);
    return normalized.length > 0 ? normalized : null;
}
function parseConsentAction(messageNode) {
    if (!messageNode || typeof messageNode !== "object")
        return null;
    const node = messageNode;
    const actionId = extractActionId(node);
    if (actionId) {
        return stepFromActionId(actionId);
    }
    const text = extractTextBody(node);
    if (!text)
        return null;
    if (text === "later" || text === "/later" || text === "accept later") {
        return { type: "later" };
    }
    const acceptCommands = {
        privacy: ["accept privacy", "/accept privacy", "i accept privacy"],
        terms: ["accept terms", "/accept terms", "i accept terms"],
        mvp: ["accept mvp", "/accept mvp", "i accept mvp"],
    };
    for (const step of exports.CONSENT_ORDER) {
        if (acceptCommands[step].includes(text)) {
            return { type: "accept", step };
        }
    }
    const laterCommands = {
        privacy: ["privacy later", "later privacy", "/later privacy"],
        terms: ["terms later", "later terms", "/later terms"],
        mvp: ["mvp later", "later mvp", "/later mvp"],
    };
    for (const step of exports.CONSENT_ORDER) {
        if (laterCommands[step].includes(text)) {
            return { type: "later", step };
        }
    }
    return null;
}
function isStepAccepted(user, config, step) {
    const fields = CONSENT_FIELDS[step];
    const acceptedAt = user[fields.acceptedAt];
    const acceptedVersion = user[fields.acceptedVersion];
    return (acceptedAt instanceof Date &&
        typeof acceptedVersion === "string" &&
        acceptedVersion === config[step].version);
}
function getPendingConsentStep(user, config) {
    for (const step of exports.CONSENT_ORDER) {
        if (!isStepAccepted(user, config, step))
            return step;
    }
    return null;
}
function isConsentComplete(user, config) {
    return getPendingConsentStep(user, config) === null;
}
function applyConsentAcceptance(userId, step, configVersion, acceptedAt = new Date()) {
    const fields = CONSENT_FIELDS[step];
    return {
        where: { id: userId },
        data: {
            [fields.acceptedAt]: acceptedAt,
            [fields.acceptedVersion]: configVersion,
        },
    };
}
