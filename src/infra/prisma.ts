import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function getRequiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required. Set it in the environment.`);
  }
  return value;
}

function buildDatabaseUrlFromParts(): string {
  const host = getRequiredEnv("DB_HOST");
  const port = process.env.DB_PORT?.trim() || "5432";
  const dbName = getRequiredEnv("DB_NAME");
  const user = getRequiredEnv("DB_USER");
  const password = getRequiredEnv("DB_PASSWORD");
  const sslModeRaw = process.env.DB_SSLMODE?.trim();

  const defaultSslMode = host.includes(".rds.amazonaws.com") ? "require" : "disable";
  const sslMode = sslModeRaw && sslModeRaw.length > 0 ? sslModeRaw : defaultSslMode;
  const useLibpqCompatRaw = process.env.DB_USELIBPQCOMPAT?.trim();

  // Note: Prisma/pg expects URL-encoded credentials.
  const encUser = encodeURIComponent(user);
  const encPass = encodeURIComponent(password);
  const encDb = encodeURIComponent(dbName);

  const params = new URLSearchParams();
  if (sslMode && sslMode.toLowerCase() !== "disable") {
    params.set("sslmode", sslMode);
  }
  // pg-connection-string currently treats sslmode=require/prefer/verify-ca as verify-full by default.
  // Set uselibpqcompat=true so sslmode=require matches libpq semantics (encrypted, not cert-verified),
  // which is sufficient for private VPC traffic in this MVP deployment.
  if (
    (useLibpqCompatRaw === undefined || useLibpqCompatRaw === "") &&
    sslMode &&
    sslMode.toLowerCase() === "require"
  ) {
    params.set("uselibpqcompat", "true");
  } else if (useLibpqCompatRaw) {
    params.set("uselibpqcompat", useLibpqCompatRaw);
  }

  const query = params.toString();
  return `postgresql://${encUser}:${encPass}@${host}:${port}/${encDb}${query ? `?${query}` : ""}`;
}

const url = process.env.DATABASE_URL?.trim() || buildDatabaseUrlFromParts();
if (!url) {
  throw new Error("DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD) is required.");
}

const adapter = new PrismaPg({ connectionString: url });
export const prisma = new PrismaClient({ adapter });
