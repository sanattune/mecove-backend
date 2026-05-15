import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { parse as parseYaml } from "yaml";
import { initSentry } from "../infra/sentry";
import { getKek } from "../infra/encryption";
import { prisma } from "../infra/prisma";
import { getRedis } from "../infra/redis";
import { logger } from "../infra/logger";
import { restRouter } from "./rest/router";
import {
  handleWhatsAppVerification,
  handleWhatsAppWebhook,
  handleDebugConsentStatus,
  handleDebugEnqueueSummary,
} from "./webhook/whatsappHandler";

const OPENAPI_SPEC_PATH = path.resolve("openapi.yaml");

function loadOpenapiSpec(): object | null {
  try {
    return parseYaml(fs.readFileSync(OPENAPI_SPEC_PATH, "utf8")) as object;
  } catch {
    return null;
  }
}

const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>meCove API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/api/docs/spec', dom_id: '#swagger-ui', deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset] });
  </script>
</body>
</html>`;

// ── Startup validation ────────────────────────────────────────────────────────

if (!process.env.REDIS_URL?.trim()) {
  throw new Error("REDIS_URL is required. Set it in .env");
}
getKek(); // validates ENCRYPTION_MASTER_KEY at startup
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());
const hasDatabaseParts = Boolean(
  process.env.DB_HOST?.trim() &&
    process.env.DB_NAME?.trim() &&
    process.env.DB_USER?.trim() &&
    process.env.DB_PASSWORD?.trim()
);
if (!hasDatabaseUrl && !hasDatabaseParts) {
  throw new Error(
    "DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD) is required. Set it in the environment."
  );
}
initSentry();

// ── CORS ──────────────────────────────────────────────────────────────────────

const CORS_ORIGINS = process.env.CORS_ALLOWED_ORIGINS?.trim() || "*";

function applyCors(_req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGINS);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
}

// ── Server ────────────────────────────────────────────────────────────────────

const port = 3000;

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Deep health check
  if ((req.method === "GET" || req.method === "HEAD") && req.url === "/health") {
    const checks: Record<string, "ok" | "error"> = { db: "ok", redis: "ok" };
    try { await prisma.$queryRaw`SELECT 1`; } catch { checks.db = "error"; }
    try { await getRedis().ping(); } catch { checks.redis = "error"; }
    const degraded = Object.values(checks).some((v) => v === "error");
    res.statusCode = degraded ? 503 : 200;
    res.setHeader("Content-Type", "application/json");
    if (req.method === "HEAD") { res.end(); return; }
    res.end(JSON.stringify({ status: degraded ? "degraded" : "ok", timestamp: new Date().toISOString(), checks }));
    return;
  }

  const pathname = req.url?.split("?")[0];

  // API docs
  if (req.method === "GET" && pathname === "/api/docs/spec") {
    const spec = loadOpenapiSpec();
    if (!spec) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain");
      res.end("openapi.yaml not found — run: pnpm generate:openapi");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(spec));
    return;
  }
  if (req.method === "GET" && pathname === "/api/docs") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    res.end(SWAGGER_UI_HTML);
    return;
  }

  // REST API
  if (pathname?.startsWith("/api/v1")) {
    await restRouter(req, res);
    return;
  }

  // WhatsApp webhook
  if (req.method === "GET" && pathname === "/webhooks/whatsapp") {
    await handleWhatsAppVerification(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/webhooks/whatsapp") {
    await handleWhatsAppWebhook(req, res);
    return;
  }

  // Debug endpoints
  if (req.method === "GET" && pathname === "/debug/consent-status") {
    await handleDebugConsentStatus(req, res);
    return;
  }
  if ((req.method === "POST" || req.method === "GET") && pathname === "/debug/enqueue-summary") {
    await handleDebugEnqueueSummary(req, res);
    return;
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain");
  res.end("Not Found");
});

server.listen(port, () => {
  logger.info(`api listening on http://localhost:${port}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function gracefulShutdown(signal: string): void {
  logger.info(`${signal} received — shutting down`);
  server.close(() => {
    logger.info("server closed");
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("forced shutdown after 10s drain timeout");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
