import "dotenv/config";
import crypto from "node:crypto";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { initSentry, captureException } from "../infra/sentry";
import { getKek } from "../infra/encryption";
import { prisma } from "../infra/prisma";
import { getRedis } from "../infra/redis";
import { pinoInstance } from "../infra/logger";
import { startupDebug, startupDebugTime, startupDebugTimeAsync } from "../infra/startupDebug";
import { Errors } from "./common/errors";
import { restPlugin } from "./rest/router";
import {
  handleWhatsAppVerification,
  handleWhatsAppWebhook,
  handleDebugConsentStatus,
  handleDebugEnqueueInsight,
} from "./webhook/whatsappHandler";

// ── Startup validation ────────────────────────────────────────────────────────

function validateStartupEnv(): void {
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
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const CORS_ORIGINS = process.env.CORS_ALLOWED_ORIGINS?.trim() || "*";
const PORT = 3000;
startupDebug("server:module-loaded");

export async function buildApp() {
  startupDebug("server:build-app:start");
  const app = Fastify({
    loggerInstance: pinoInstance,
    genReqId: () => crypto.randomUUID(),
    ajv: {
      customOptions: {
        strict: false, // allow OpenAPI keywords (example, nullable, etc.) in schemas
      },
    },
  });

  // ── Plugins ─────────────────────────────────────────────────────────────────

  await startupDebugTimeAsync("fastify:register:cors", () => app.register(cors, {
    origin: CORS_ORIGINS,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["X-Request-Id"],
  }));

  await startupDebugTimeAsync("fastify:register:swagger", () => app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: { title: "meCove API", version: "1.0.0", description: "meCove mobile app REST API" },
      servers: [{ url: "/api/v1" }],
      components: {
        securitySchemes: {
          BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
      tags: [
        { name: "Auth", description: "OTP sign-in, token refresh, logout" },
        { name: "Messages", description: "Chat messages and AI replies" },
        { name: "Insights", description: "Insight generation and PDF download" },
        { name: "Checkin", description: "Daily reminder configuration" },
        { name: "Account", description: "User stats, data deletion, privacy" },
      ],
    },
  }));

  await startupDebugTimeAsync("fastify:register:swagger-ui", () => app.register(swaggerUi, {
    routePrefix: "/api/docs",
    uiConfig: { deepLinking: true },
  }));

  // ── Hooks ──────────────────────────────────────────────────────────────────

  startupDebugTime("fastify:add:on-request-hook", () => app.addHook("onRequest", (_request, reply, done) => {
    reply.header("X-Request-Id", _request.id);
    done();
  }));

  // ── Error handlers ─────────────────────────────────────────────────────────

  startupDebugTime("fastify:set:error-handler", () => app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      reply.code(400).send(Errors.validation(error.message));
      return;
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      reply.code(error.statusCode).send(Errors.validation(error.message));
      return;
    }
    captureException(error, { requestId: request.id });
    request.log.error({ err: error }, "unhandled error");
    reply.code(500).send(Errors.internal());
  }));

  startupDebugTime("fastify:set:not-found-handler", () => app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(Errors.notFound(`${request.method} ${request.url} not found.`));
  }));

  // ── Health check ───────────────────────────────────────────────────────────

  startupDebugTime("fastify:route:health", () => app.route({
    method: ["GET", "HEAD"],
    url: "/health",
    handler: async (request, reply) => {
      const checks: Record<string, "ok" | "error"> = { db: "ok", redis: "ok" };
      try { await prisma.$queryRaw`SELECT 1`; } catch { checks.db = "error"; }
      try { await getRedis().ping(); } catch { checks.redis = "error"; }
      const degraded = Object.values(checks).some((v) => v === "error");
      if (request.method === "HEAD") {
        reply.code(degraded ? 503 : 200).send();
        return;
      }
      reply.code(degraded ? 503 : 200).send({
        status: degraded ? "degraded" : "ok",
        timestamp: new Date().toISOString(),
        checks,
      });
    },
  }));

  // ── REST API ───────────────────────────────────────────────────────────────

  await startupDebugTimeAsync("fastify:register:rest", () => app.register(restPlugin, { prefix: "/api/v1" }));

  // ── WhatsApp webhook ───────────────────────────────────────────────────────
  // Encapsulated plugin so its content-type parser doesn't affect REST routes.

  await startupDebugTimeAsync("fastify:register:whatsapp", () => app.register(async (waInstance) => {
    // Save the raw JSON string before Fastify parses it — the WA handler reads it directly.
    waInstance.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      // req here is FastifyRequest — store raw string so the WA handler can read it
      (req as unknown as Record<string, unknown>)._rawBodyStr = body;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(null, {});
      }
    });

    waInstance.get("/webhooks/whatsapp", async (request, reply) => {
      reply.hijack();
      await handleWhatsAppVerification(request.raw, reply.raw);
    });

    waInstance.post("/webhooks/whatsapp", async (request, reply) => {
      reply.hijack();
      const rawBody = (request as unknown as Record<string, unknown>)._rawBodyStr as string | undefined;
      await handleWhatsAppWebhook(request.raw, reply.raw, rawBody);
    });

    waInstance.get("/debug/consent-status", async (request, reply) => {
      reply.hijack();
      await handleDebugConsentStatus(request.raw, reply.raw);
    });

    waInstance.route({
      method: ["GET", "POST"],
      url: "/debug/enqueue-insight",
      handler: async (request, reply) => {
        reply.hijack();
        await handleDebugEnqueueInsight(request.raw, reply.raw);
      },
    });
  }));

  // ── Start ──────────────────────────────────────────────────────────────────

  startupDebug("server:build-app:done");
  return app;
}

async function main(): Promise<void> {
  startupDebug("server:main:start");
  startupDebugTime("server:validate-env", validateStartupEnv);
  startupDebugTime("server:init-sentry", initSentry);

  const app = await startupDebugTimeAsync("server:build-app", buildApp);

  await startupDebugTimeAsync("server:listen", () => app.listen({ port: PORT, host: "0.0.0.0" }));
  startupDebug("server:main:ready", { port: PORT });

  // ── Graceful shutdown ──────────────────────────────────────────────────────

  const shutdown = async (signal: string): Promise<void> => {
    pinoInstance.info(`${signal} received — shutting down`);
    const timer = setTimeout(() => {
      pinoInstance.warn("forced shutdown after 10s drain timeout");
      process.exit(1);
    }, 10_000);
    timer.unref();
    try {
      await app.close();
      pinoInstance.info("server closed");
      process.exit(0);
    } catch {
      pinoInstance.warn("error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

if (require.main === module) {
  main().catch((err) => {
    pinoInstance.error({ err }, "failed to start server");
    process.exit(1);
  });
}
