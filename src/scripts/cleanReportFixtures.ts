import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const DEFAULT_ROOT = "test-data/generated";
const PRESERVED_FILES = new Set(["persona.md", "chatlog.json"]);

type CliOptions = {
  target: string;
  all: boolean;
  dryRun: boolean;
};

function usage(): string {
  return [
    "Usage:",
    "  pnpm report:fixture:clean <fixture-dir-or-slug> [--dry-run]",
    "  pnpm report:fixture:clean --all [--dry-run]",
    "",
    "Preserves:",
    "  persona.md",
    "  chatlog.json",
  ].join("\n");
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let target = "";
  let all = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--all") {
      all = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (!target && !arg.startsWith("-")) {
      target = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  if (all && target) {
    throw new Error(`Use either --all or a fixture target, not both.\n\n${usage()}`);
  }
  if (!all && !target) {
    throw new Error(`Missing fixture target or --all.\n\n${usage()}`);
  }

  return { target, all, dryRun };
}

function resolveFixtureTarget(target: string): string {
  const direct = resolve(target);
  if (existsSync(direct)) return direct;
  return resolve(DEFAULT_ROOT, target);
}

function listFixtureDirs(options: CliOptions): string[] {
  if (!options.all) {
    const fixtureDir = resolveFixtureTarget(options.target);
    if (!existsSync(fixtureDir) || !statSync(fixtureDir).isDirectory()) {
      throw new Error(`Fixture directory not found: ${fixtureDir}`);
    }
    return [fixtureDir];
  }

  const root = resolve(DEFAULT_ROOT);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Fixture root not found: ${root}`);
  }

  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((path) => statSync(path).isDirectory());
}

function cleanFixtureDir(fixtureDir: string, dryRun: boolean): number {
  const entries = readdirSync(fixtureDir);
  let deleted = 0;

  for (const entry of entries) {
    if (PRESERVED_FILES.has(entry)) continue;

    const target = join(fixtureDir, entry);
    if (dryRun) {
      console.log(`[dry-run] Would remove ${target}`);
    } else {
      rmSync(target, { recursive: true, force: true });
      console.log(`Removed ${target}`);
    }
    deleted++;
  }

  console.log(`${dryRun ? "Would clean" : "Cleaned"} ${basename(fixtureDir)}: ${deleted} artifact(s)`);
  return deleted;
}

function main() {
  const options = parseArgs();
  const fixtureDirs = listFixtureDirs(options);
  const total = fixtureDirs.reduce((sum, dir) => sum + cleanFixtureDir(dir, options.dryRun), 0);
  console.log(`${options.dryRun ? "Would remove" : "Removed"} ${total} artifact(s) total`);
}

try {
  main();
} catch (err) {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
