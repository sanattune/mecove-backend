import "dotenv/config";
import { prisma } from "../infra/prisma";

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

/** Resolve the expected DB name from env vars (DB_NAME takes priority over DATABASE_URL). */
function resolveExpectedDbName(): string | undefined {
  const dbName = (process.env.DB_NAME ?? "").trim();
  if (dbName) return dbName;

  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) return undefined;

  const parsed = new URL(databaseUrl);
  return decodeURIComponent(parsed.pathname.replace(/^\//, "")) || undefined;
}

async function main() {
  const allow = (process.env.ALLOW_DB_WIPE ?? "").trim().toLowerCase();
  if (allow !== "true") {
    throw new Error(
      "Refusing to wipe DB. Set ALLOW_DB_WIPE=true for this command (one-time) and re-run."
    );
  }

  const confirm = getArgValue("--confirm")?.trim();
  if (!confirm) {
    throw new Error("Missing --confirm <DB_NAME>. Example: pnpm db:wipe -- --confirm mecove");
  }

  const expected = resolveExpectedDbName();
  if (expected && confirm !== expected) {
    throw new Error(`Refusing to wipe DB. --confirm was '${confirm}' but actual DB is '${expected}'.`);
  }

  // Discover + truncate in a single server round-trip using a DO block
  // The DO block builds the TRUNCATE dynamically with quote_ident() for safe quoting
  await prisma.$executeRawUnsafe(
    `DO $$ DECLARE _sql text; BEGIN
       SELECT 'TRUNCATE TABLE ' || string_agg(quote_ident(tablename), ', ') || ' RESTART IDENTITY CASCADE'
         INTO _sql
         FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
       IF _sql IS NOT NULL THEN EXECUTE _sql; END IF;
     END $$`
  );

  // Report what was wiped (lightweight follow-up query)
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
      FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> '_prisma_migrations'
     ORDER BY tablename;
  `;

  const tables = rows.map((r) => r.tablename);
  if (tables.length === 0) {
    console.log("No tables found (excluding _prisma_migrations).");
  } else {
    console.log(`Wiped ${tables.length} tables: ${tables.join(", ")}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
