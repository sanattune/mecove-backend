import "dotenv/config";
import { defineConfig } from "prisma/config";

function buildDatabaseUrlFromParts(): string {
  const host = process.env.DB_HOST?.trim();
  const port = process.env.DB_PORT?.trim() || "5432";
  const dbName = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD?.trim();
  const sslModeRaw = process.env.DB_SSLMODE?.trim();
  const useLibpqCompatRaw = process.env.DB_USELIBPQCOMPAT?.trim();

  if (!host || !dbName || !user || !password) return "";

  const defaultSslMode = host.includes(".rds.amazonaws.com") ? "require" : "disable";
  const sslMode = sslModeRaw && sslModeRaw.length > 0 ? sslModeRaw : defaultSslMode;

  const encUser = encodeURIComponent(user);
  const encPass = encodeURIComponent(password);
  const encDb = encodeURIComponent(dbName);

  const params = new URLSearchParams();
  if (sslMode && sslMode.toLowerCase() !== "disable") {
    params.set("sslmode", sslMode);
  }
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

const datasourceUrl =
  process.env.DATABASE_URL?.trim() || buildDatabaseUrlFromParts();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use fallback so CLI commands that don't need DB (e.g. format, generate) work without .env
    url: datasourceUrl,
  },
});
