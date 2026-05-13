import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, ignore: "pid,hostname" },
    },
  }),
});

type LogArgs = [string, ...unknown[]] | [Record<string, unknown>, string?, ...unknown[]];

function normalize(args: LogArgs): [Record<string, unknown>, string] | [string] {
  if (typeof args[0] === "string") {
    // Old API: (message, context?) — flip for pino
    const [msg, ctx] = args as [string, unknown?];
    if (ctx && typeof ctx === "object" && !Array.isArray(ctx)) {
      return [ctx as Record<string, unknown>, msg];
    }
    return [typeof ctx !== "undefined" ? { extra: ctx } : {}, msg];
  }
  // New API: (context, message) — already pino-compatible
  return args as [Record<string, unknown>, string];
}

function makeMethod(fn: pino.LogFn) {
  return (...args: LogArgs) => {
    const normalized = normalize(args);
    if (normalized.length === 1) {
      fn(normalized[0] as string);
    } else {
      fn(normalized[0] as object, normalized[1] as string);
    }
  };
}

export const logger = {
  debug: makeMethod(pinoLogger.debug.bind(pinoLogger)),
  info: makeMethod(pinoLogger.info.bind(pinoLogger)),
  warn: makeMethod(pinoLogger.warn.bind(pinoLogger)),
  error: makeMethod(pinoLogger.error.bind(pinoLogger)),
};

export function childLogger(context: Record<string, unknown>) {
  const child = pinoLogger.child(context);
  return {
    debug: makeMethod(child.debug.bind(child)),
    info: makeMethod(child.info.bind(child)),
    warn: makeMethod(child.warn.bind(child)),
    error: makeMethod(child.error.bind(child)),
  };
}
