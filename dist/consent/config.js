"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.consentConfig = void 0;
exports.loadConsentConfigFromEnv = loadConsentConfigFromEnv;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const yaml_1 = __importDefault(require("yaml"));
function asNonEmptyString(value, field) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Invalid consent config: "${field}" must be a non-empty string`);
    }
    return value.trim();
}
function asOptionalString(value, field) {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    return asNonEmptyString(value, field);
}
function validateButtonLabel(value, field) {
    const label = asNonEmptyString(value, field);
    if (label.length > 20) {
        throw new Error(`Invalid consent config: "${field}" must be <= 20 characters`);
    }
    return label;
}
function parseStepConfig(raw, step) {
    if (!raw || typeof raw !== "object") {
        throw new Error(`Invalid consent config: "${step}" section is required`);
    }
    const section = raw;
    const buttons = section.buttons;
    if (!buttons || typeof buttons !== "object") {
        throw new Error(`Invalid consent config: "${step}.buttons" section is required`);
    }
    return {
        version: asNonEmptyString(section.version, `${step}.version`),
        message: asNonEmptyString(section.message, `${step}.message`),
        link: asOptionalString(section.link, `${step}.link`),
        buttons: {
            accept: validateButtonLabel(buttons.accept, `${step}.buttons.accept`),
            later: validateButtonLabel(buttons.later, `${step}.buttons.later`),
        },
    };
}
function parseConsentConfig(raw) {
    if (!raw || typeof raw !== "object") {
        throw new Error("Invalid consent config: expected top-level object");
    }
    const root = raw;
    const templates = root.templates;
    if (!templates || typeof templates !== "object") {
        throw new Error('Invalid consent config: "templates" section is required');
    }
    return {
        privacy: parseStepConfig(root.privacy, "privacy"),
        terms: parseStepConfig(root.terms, "terms"),
        mvp: parseStepConfig(root.mvp, "mvp"),
        templates: {
            blocked: asNonEmptyString(templates.blocked, "templates.blocked"),
            later: asNonEmptyString(templates.later, "templates.later"),
            completed: asNonEmptyString(templates.completed, "templates.completed"),
        },
    };
}
function resolveConfigPath() {
    const rawPath = process.env.CONSENT_CONFIG_PATH?.trim();
    if (!rawPath) {
        throw new Error("CONSENT_CONFIG_PATH is required. Set it in .env");
    }
    return node_path_1.default.isAbsolute(rawPath) ? rawPath : node_path_1.default.resolve(process.cwd(), rawPath);
}
function loadConsentConfigFromEnv() {
    const configPath = resolveConfigPath();
    const source = node_fs_1.default.readFileSync(configPath, "utf8");
    const parsed = yaml_1.default.parse(source);
    return parseConsentConfig(parsed);
}
exports.consentConfig = loadConsentConfigFromEnv();
