import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use fallback so CLI commands that don't need DB (e.g. format, generate) work without .env
    url: process.env.DATABASE_URL ?? "",
  },
});
