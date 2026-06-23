import http from "node:http";
import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { sendJSON } from "../../common/sendJSON";
import { Errors } from "../../common/errors";
import { prisma } from "../../../infra/prisma";
import type { AuthenticatedRequest } from "../../common/httpTypes";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error("JWT_SECRET is required.");
  return secret;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send(Errors.unauthorized());
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    if (payload.type !== "access" || !payload.userId) {
      reply.code(401).send(Errors.unauthorized());
      return;
    }
    request.userId = payload.userId as string;
  } catch {
    reply.code(401).send(Errors.unauthorized());
  }
}

// Role gate for /professional/* routes. Run AFTER `authenticate` (needs request.userId).
// Checks the denormalized User.isProfessional flag; per-profile ownership is enforced
// in the handler against the specific professionalId.
export async function requireProfessional(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = request.userId;
  if (!userId) {
    reply.code(401).send(Errors.unauthorized());
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isProfessional: true } });
  if (!user?.isProfessional) {
    reply.code(403).send(Errors.forbidden("Professional access required."));
    return;
  }
}

// Role gate for /admin/* routes. Run AFTER `authenticate`. Admin = User.role==="admin"
// (set via the WhatsApp admin allowlist in src/access/config.ts).
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = request.userId;
  if (!userId) {
    reply.code(401).send(Errors.unauthorized());
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== "admin") {
    reply.code(403).send(Errors.forbidden("Admin access required."));
    return;
  }
}

// Legacy: used by WhatsApp webhook handler (in production)
export function requireAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse
): req is AuthenticatedRequest {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    sendJSON(res, 401, Errors.unauthorized());
    return false;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    if (payload.type !== "access" || !payload.userId) {
      sendJSON(res, 401, Errors.unauthorized());
      return false;
    }
    (req as AuthenticatedRequest).userId = payload.userId as string;
    return true;
  } catch {
    sendJSON(res, 401, Errors.unauthorized());
    return false;
  }
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ userId, type: "access" }, getJwtSecret(), { expiresIn: "1h" });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: "refresh" }, getJwtSecret(), { expiresIn: "30d" });
}

export function verifyRefreshToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    if (payload.type !== "refresh" || !payload.userId) return null;
    return payload.userId as string;
  } catch {
    return null;
  }
}
