import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_ROOT = "test-data/generated";

type CliOptions = {
  root: string;
  days: string;
  timezone: string | null;
  endDate: string | null;
  reportType: string | null;
  dryRun: boolean;
  continueOnError: boolean;
};

function usage(): string {
  return [
    "Usage:",
    "  pnpm report:fixture:all [--root test-data/generated] [--days 15] [--timezone Asia/Kolkata] [--end-date YYYY-MM-DD] [--report-type sessionbridge|myself_lately] [--dry-run] [--continue-on-error]",
    "",
    "Discovers fixture folders under --root that contain chatlog.json and runs report generation sequentially.",
  ].join("\n");
}

function parsePositiveInt(raw: string, label: string): string {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return raw;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    root: DEFAULT_ROOT,
    days: "15",
    timezone: null,
    endDate: null,
    reportType: null,
    dryRun: false,
    continueOnError: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root") {
      options.root = args[++i] ?? "";
      if (!options.root.trim()) throw new Error("--root must be non-empty");
    } else if (arg === "--days") {
      options.days = parsePositiveInt(args[++i] ?? "", "--days");
    } else if (arg === "--timezone") {
      options.timezone = args[++i] ?? "";
      if (!options.timezone.trim()) throw new Error("--timezone must be non-empty");
    } else if (arg === "--end-date") {
      options.endDate = args[++i] ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.endDate)) {
        throw new Error("--end-date must use YYYY-MM-DD");
      }
    } else if (arg === "--report-type") {
      options.reportType = args[++i] ?? "";
      if (!["sessionbridge", "myself_lately"].includes(options.reportType)) {
        throw new Error("--report-type must be one of: sessionbridge, myself_lately");
      }
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--continue-on-error") {
      options.continueOnError = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  return options;
}

function listFixtureDirs(root: string): string[] {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot) || !statSync(resolvedRoot).isDirectory()) {
    throw new Error(`Fixture root not found: ${resolvedRoot}`);
  }

  return readdirSync(resolvedRoot)
    .map((name) => join(resolvedRoot, name))
    .filter((path) => statSync(path).isDirectory())
    .filter((path) => existsSync(join(path, "chatlog.json")))
    .sort((a, b) => a.localeCompare(b));
}

function buildFixtureArgs(fixtureDir: string, options: CliOptions): string[] {
  const args = ["report:fixture", fixtureDir, "--days", options.days];
  if (options.timezone) args.push("--timezone", options.timezone);
  if (options.endDate) args.push("--end-date", options.endDate);
  if (options.reportType) args.push("--report-type", options.reportType);
  return args;
}

function main() {
  const options = parseArgs();
  const fixtureDirs = listFixtureDirs(options.root);

  if (fixtureDirs.length === 0) {
    throw new Error(`No fixture directories with chatlog.json found under: ${resolve(options.root)}`);
  }

  console.log(`Found ${fixtureDirs.length} fixture(s).`);

  const failures: string[] = [];
  for (const fixtureDir of fixtureDirs) {
    const args = buildFixtureArgs(fixtureDir, options);
    console.log(`\n> pnpm ${args.join(" ")}`);

    if (options.dryRun) continue;

    const result = spawnSync("pnpm", args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    if (result.status !== 0) {
      failures.push(fixtureDir);
      if (!options.continueOnError) {
        process.exit(result.status ?? 1);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\nFailed fixture(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(options.dryRun ? "\nDry run complete." : "\nAll fixture reports generated.");
}

try {
  main();
} catch (err) {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
