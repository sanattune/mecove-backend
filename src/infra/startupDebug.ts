function isStartupDebugEnabled(): boolean {
  const value = process.env.STARTUP_DEBUG?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function formatElapsed(ms: number): string {
  return `${Math.round(ms)}ms`;
}

export function startupDebug(label: string, detail?: Record<string, unknown>): void {
  if (!isStartupDebugEnabled()) return;
  const elapsedMs = process.uptime() * 1000;
  const suffix = detail ? ` ${JSON.stringify(detail)}` : "";
  process.stderr.write(`[startup] +${formatElapsed(elapsedMs)} ${label}${suffix}\n`);
}

export function startupDebugTime<T>(label: string, fn: () => T): T {
  if (!isStartupDebugEnabled()) return fn();
  startupDebug(`${label}:start`);
  const startedAt = performance.now();
  try {
    const result = fn();
    startupDebug(`${label}:done`, { durationMs: Math.round(performance.now() - startedAt) });
    return result;
  } catch (err) {
    startupDebug(`${label}:error`, {
      durationMs: Math.round(performance.now() - startedAt),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function startupDebugTimeAsync<T>(label: string, fn: () => PromiseLike<T>): Promise<T> {
  if (!isStartupDebugEnabled()) return fn();
  startupDebug(`${label}:start`);
  const startedAt = performance.now();
  try {
    const result = await fn();
    startupDebug(`${label}:done`, { durationMs: Math.round(performance.now() - startedAt) });
    return result;
  } catch (err) {
    startupDebug(`${label}:error`, {
      durationMs: Math.round(performance.now() - startedAt),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
