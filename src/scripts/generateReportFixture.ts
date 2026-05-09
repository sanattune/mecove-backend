import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  generateSummaryPipeline,
  type SummaryArtifactWriter,
} from "../summary/pipeline";
import type { ReportType, SignalBucket, WindowBundle, WindowDay } from "../summary/types";

type ChatMessage = {
  index: number;
  u: string;
  r?: string;
};

type ChatDay = {
  day: number;
  chat?: ChatMessage[];
};

type CliOptions = {
  fixtureDir: string;
  days: number;
  timezone: string;
  endDate: string;
  reportTypes: ReportType[];
};

const VALID_REPORT_TYPES: ReportType[] = ["sessionbridge", "myself_lately"];

const IST_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 15;
const DEFAULT_TIMEZONE = "Asia/Kolkata";

function usage(): string {
  return [
    "Usage:",
    "  pnpm report:fixture <fixture-dir> [--days 15] [--timezone Asia/Kolkata] [--end-date YYYY-MM-DD] [--report-type sessionbridge|myself_lately]",
    "",
    "If --report-type is omitted, BOTH reports are generated.",
    "",
    "Expected files:",
    "  <fixture-dir>/chatlog.json",
    "  <fixture-dir>/persona.md optional",
  ].join("\n");
}

function toIstDateString(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

function istDateStartToUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MINUTES * 60 * 1000);
}

function dateTimeIstToUtcIso(dateStr: string, hour: number, minute: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0) - IST_OFFSET_MINUTES * 60 * 1000);
  return utc.toISOString();
}

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parsePositiveInt(raw: string, label: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let fixtureDir = "";
  let days = DEFAULT_DAYS;
  let timezone = DEFAULT_TIMEZONE;
  let endDate = toIstDateString(new Date());
  let reportType: ReportType | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--days") {
      days = parsePositiveInt(args[++i] ?? "", "--days");
    } else if (arg === "--timezone") {
      timezone = args[++i] ?? "";
      if (!timezone.trim()) throw new Error("--timezone must be non-empty");
    } else if (arg === "--end-date") {
      endDate = args[++i] ?? "";
      if (!isDateString(endDate)) throw new Error("--end-date must use YYYY-MM-DD");
    } else if (arg === "--report-type") {
      const raw = args[++i] ?? "";
      if (!VALID_REPORT_TYPES.includes(raw as ReportType)) {
        throw new Error(`--report-type must be one of: ${VALID_REPORT_TYPES.join(", ")}`);
      }
      reportType = raw as ReportType;
    } else if (!fixtureDir && !arg.startsWith("-")) {
      fixtureDir = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  if (!fixtureDir) {
    throw new Error(`Missing fixture directory.\n\n${usage()}`);
  }

  const reportTypes: ReportType[] = reportType ? [reportType] : [...VALID_REPORT_TYPES];

  return {
    fixtureDir: resolve(fixtureDir),
    days,
    timezone,
    endDate,
    reportTypes,
  };
}

function assertChatData(raw: unknown): ChatDay[] {
  if (!Array.isArray(raw)) {
    throw new Error("chatlog.json must be a JSON array");
  }

  for (const [dayIdx, day] of raw.entries()) {
    if (!day || typeof day !== "object") {
      throw new Error(`chatlog[${dayIdx}] must be an object`);
    }
    const dayData = day as Partial<ChatDay>;
    const dayNumber = dayData.day;
    if (!Number.isInteger(dayNumber) || dayNumber === undefined || dayNumber < 1) {
      throw new Error(`chatlog[${dayIdx}].day must be a positive integer`);
    }
    if (dayData.chat === undefined) continue;
    if (!Array.isArray(dayData.chat)) {
      throw new Error(`chatlog[${dayIdx}].chat must be an array when present`);
    }
    for (const [msgIdx, msg] of dayData.chat.entries()) {
      if (!msg || typeof msg !== "object") {
        throw new Error(`chatlog[${dayIdx}].chat[${msgIdx}] must be an object`);
      }
      const chatMsg = msg as Partial<ChatMessage>;
      const messageIndex = chatMsg.index;
      if (!Number.isInteger(messageIndex) || messageIndex === undefined || messageIndex < 1) {
        throw new Error(`chatlog[${dayIdx}].chat[${msgIdx}].index must be a positive integer`);
      }
      if (typeof chatMsg.u !== "string" || chatMsg.u.trim().length === 0) {
        throw new Error(`chatlog[${dayIdx}].chat[${msgIdx}].u must be a non-empty string`);
      }
      if (chatMsg.r !== undefined && typeof chatMsg.r !== "string") {
        throw new Error(`chatlog[${dayIdx}].chat[${msgIdx}].r must be a string when present`);
      }
    }
  }

  return raw as ChatDay[];
}

function signalBucket(daysWithEntries: number): SignalBucket {
  if (daysWithEntries <= 2) return "LOW";
  if (daysWithEntries <= 5) return "MEDIUM";
  return "HIGH";
}

function buildInputHash(days: WindowDay[]): string {
  const parts: string[] = [];
  for (const day of days) {
    for (const message of day.messages) {
      parts.push(message.messageId, message.text);
    }
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function buildWindowBundleFromChatlog(
  chatData: ChatDay[],
  options: Pick<CliOptions, "days" | "timezone" | "endDate"> & { userId: string }
): WindowBundle {
  const startDate = shiftDate(options.endDate, -(options.days - 1));
  const rangeStartUtc = istDateStartToUtc(startDate);
  const rangeEndExclusiveUtc = istDateStartToUtc(shiftDate(options.endDate, 1));
  const rangeEndUtc = new Date(rangeEndExclusiveUtc.getTime() - 1);
  const windowDays = new Map<string, WindowDay>();

  for (const dayData of chatData) {
    if (dayData.day > options.days) {
      throw new Error(`chatlog contains day ${dayData.day}, but --days is ${options.days}`);
    }
    if (!dayData.chat || dayData.chat.length === 0) continue;

    const date = shiftDate(startDate, dayData.day - 1);
    const messages = [...dayData.chat].sort((a, b) => a.index - b.index);
    const totalMinutes = 14 * 60;
    const minutesPerMessage = messages.length > 1 ? Math.floor(totalMinutes / (messages.length - 1)) : 0;

    const windowDay: WindowDay = {
      date,
      messages: messages.map((message, idx) => {
        const offset = idx * minutesPerMessage;
        const hour = 9 + Math.floor(offset / 60);
        const minute = offset % 60;
        return {
          messageId: `fixture-day-${String(dayData.day).padStart(2, "0")}-msg-${String(message.index).padStart(2, "0")}`,
          createdAt: dateTimeIstToUtcIso(date, hour, minute),
          text: message.u.trim(),
        };
      }),
    };
    windowDays.set(date, windowDay);
  }

  const days = Array.from(windowDays.values()).sort((a, b) => a.date.localeCompare(b.date));
  const daysWithEntries = days.length;
  const totalMessages = days.reduce((sum, day) => sum + day.messages.length, 0);
  const bucket = signalBucket(daysWithEntries);

  return {
    userId: options.userId,
    timezone: options.timezone,
    window: {
      startDate,
      endDate: options.endDate,
      days: options.days,
    },
    rangeStartUtc: rangeStartUtc.toISOString(),
    rangeEndUtc: rangeEndUtc.toISOString(),
    rangeEndExclusiveUtc: rangeEndExclusiveUtc.toISOString(),
    counts: {
      totalMessages,
      daysWithEntries,
    },
    signalBucket: bucket,
    section3AllowedByCounts: bucket !== "LOW",
    inputHash: buildInputHash(days),
    days,
  };
}

function stageFileName(stage: string): string {
  return `${stage.replace(/_/g, "-")}.json`;
}

function createFileArtifactWriter(supportingDir: string): SummaryArtifactWriter {
  return {
    async writeArtifact(_userId, _summaryId, stage, payload) {
      writeFileSync(join(supportingDir, stageFileName(stage)), JSON.stringify(payload, null, 2));
    },
    async writeErrorArtifact(_userId, _summaryId, stage, error, rawSnippet) {
      writeFileSync(
        join(supportingDir, stageFileName(`error_${stage}`)),
        JSON.stringify({ error, rawSnippet: rawSnippet ?? "" }, null, 2)
      );
    },
  };
}

async function main() {
  const options = parseArgs();
  const chatlogPath = join(options.fixtureDir, "chatlog.json");
  const personaPath = join(options.fixtureDir, "persona.md");

  if (!existsSync(options.fixtureDir)) {
    throw new Error(`Fixture directory does not exist: ${options.fixtureDir}`);
  }
  if (!existsSync(chatlogPath)) {
    throw new Error(`Missing required chatlog file: ${chatlogPath}`);
  }
  if (!existsSync(personaPath)) {
    console.warn(`Optional persona file not found: ${personaPath}`);
  }

  mkdirSync(options.fixtureDir, { recursive: true });
  const supportingDir = join(options.fixtureDir, "supporting");
  mkdirSync(supportingDir, { recursive: true });
  const chatData = assertChatData(JSON.parse(readFileSync(chatlogPath, "utf8")));
  const userId = `fixture-${basename(options.fixtureDir)}`;
  const windowBundle = buildWindowBundleFromChatlog(chatData, { ...options, userId });

  for (const reportType of options.reportTypes) {
    const summaryId = `${userId}-${options.days}d-${options.endDate}-${reportType}`;
    const result = await generateSummaryPipeline({
      userId,
      summaryId,
      timezone: options.timezone,
      windowBundle,
      artifactWriter: createFileArtifactWriter(supportingDir),
      reportType,
    });

    const reportStem = reportType === "myself_lately" ? "myself-lately" : "sessionbridge";
    // Only the PDF stays at the persona root; everything else goes under supporting/.
    writeFileSync(join(options.fixtureDir, `${reportStem}.pdf`), result.pdfBytes);
    writeFileSync(join(supportingDir, `${reportStem}.md`), result.finalReportText);
    writeFileSync(
      join(supportingDir, `${reportStem}-meta.json`),
      JSON.stringify(
        {
          summaryId,
          reportType,
          modelName: result.modelName,
          promptVersionString: result.promptVersionString,
          generatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    console.log(`Generated fixture report (${reportType}) in: ${options.fixtureDir}`);
  }

  console.log(`Messages: ${windowBundle.counts.totalMessages}`);
  console.log(`Days with entries: ${windowBundle.counts.daysWithEntries}/${windowBundle.window.days}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
