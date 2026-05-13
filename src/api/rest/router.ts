import http from "node:http";
import crypto from "node:crypto";
import { sendJSON } from "../common/sendJSON";
import { Errors } from "../common/errors";
import { childLogger } from "../../infra/logger";
import { handleRequestOtp, handleVerifyOtp, handleRefreshToken, handleLogout } from "./handlers/authHandler";
import { handleGetMessages, handleSendMessage } from "./handlers/messageHandler";

const PREFIX = "/api/v1";

export async function restRouter(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const requestId = crypto.randomUUID();
  const log = childLogger({ requestId });

  res.setHeader("X-Request-Id", requestId);
  (req as http.IncomingMessage & { requestId: string }).requestId = requestId;

  const method = req.method ?? "GET";
  const pathname = (req.url ?? "").split("?")[0];
  const route = pathname.slice(PREFIX.length);

  const start = Date.now();

  try {
    if (method === "POST" && route === "/auth/request-otp") {
      await handleRequestOtp(req, res, requestId);
    } else if (method === "POST" && route === "/auth/verify") {
      await handleVerifyOtp(req, res, requestId);
    } else if (method === "POST" && route === "/auth/refresh") {
      await handleRefreshToken(req, res, requestId);
    } else if (method === "POST" && route === "/auth/logout") {
      await handleLogout(req, res, requestId);
    } else if (method === "GET" && route === "/messages") {
      await handleGetMessages(req, res, requestId);
    } else if (method === "POST" && route === "/messages/send") {
      await handleSendMessage(req, res, requestId);
    } else {
      sendJSON(res, 404, Errors.notFound(`Route ${method} ${pathname} not found.`));
    }
  } catch (err) {
    log.error({ err }, "Unhandled error in REST router");
    if (!res.headersSent) {
      sendJSON(res, 500, Errors.internal());
    }
  } finally {
    log.info({ method, route, status: res.statusCode, ms: Date.now() - start }, "REST request");
  }
}
