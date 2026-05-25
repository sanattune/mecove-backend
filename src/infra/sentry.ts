import * as Sentry from "@sentry/node";
import { startupDebug, startupDebugTime } from "./startupDebug";

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    startupDebug("sentry:init-skipped", { reason: "missing-dsn" });
    return;
  }
  startupDebugTime("sentry:init", () => {
    Sentry.init({ dsn, environment: process.env.NODE_ENV ?? "development" });
  });
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(err);
    });
  } else {
    Sentry.captureException(err);
  }
}
