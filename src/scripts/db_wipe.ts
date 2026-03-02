import "dotenv/config";
import { prisma } from "../infra/prisma";

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function main() {
  const allow = (process.env.ALLOW_DB_WIPE ?? "").trim().toLowerCase();
  if (allow !== "true") {
    throw new Error(
      "Refusing to wipe DB. Set ALLOW_DB_WIPE=true for this command (one-time) and re-run."
    );
  }

  const confirm = getArgValue("--confirm")?.trim();
  const dbName = (process.env.DB_NAME ?? "").trim();
  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();

  if (!confirm) {
    throw new Error("Missing --confirm <DB_NAME>. Example: pnpm db:wipe -- --confirm mecove");
  }

  if (dbName && confirm !== dbName) {
    throw new Error(`Refusing to wipe DB. --confirm was '${confirm}' but DB_NAME is '${dbName}'.`);
  }

  if (!dbName && databaseUrl) {
    const parsed = new URL(databaseUrl);
    const urlDbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (confirm !== urlDbName) {
      throw new Error(
        `Refusing to wipe DB. --confirm was '${confirm}' but DATABASE_URL DB is '${urlDbName}'.`
      );
    }
  }

  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename;
  `;

  const tables = rows.map((r) => r.tablename).filter(Boolean);
  if (tables.length === 0) {
    console.log("No tables found to wipe (excluding _prisma_migrations).");
    return;
  }

  const sql = `TRUNCATE TABLE ${tables.map(quoteIdent).join(", ")} RESTART IDENTITY CASCADE;`;
  console.log(`Wiping ${tables.length} tables from public schema (excluding _prisma_migrations)...`);
  await prisma.$executeRawUnsafe(sql);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

