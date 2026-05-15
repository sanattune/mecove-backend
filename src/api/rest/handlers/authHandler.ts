import http from "node:http";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { sendJSON } from "../../common/sendJSON";
import { Errors } from "../../common/errors";
import { maskPhone } from "../../common/mask";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import { generateOtp, sendOtpSms, storeOtp, verifyAndConsumeOtp } from "../../../infra/otp";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  requireAuth,
} from "../middleware/auth";
import { checkRateLimit, RateLimits } from "../middleware/rateLimit";
import type { AuthenticatedRequest } from "../../common/httpTypes";

const RequestOtpSchema = z.object({
  phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 format (e.g. +919876543210)"),
});

const VerifyOtpSchema = z.object({
  phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/),
  otp: z.string().length(6).regex(/^\d{6}$/),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

import { readBody } from "../../common/httpHelpers";

/**
 * @openapi
 * /auth/request-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Request OTP
 *     description: Sends a 6-digit OTP via SMS. Rate limited to 3 requests per 15 minutes per phone number.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNumber]
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: E.164 format
 *                 example: "+919876543210"
 *     responses:
 *       200:
 *         description: OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limited
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleRequestOtp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestId: string
): Promise<void> {
  const log = childLogger({ requestId, handler: "requestOtp" });
  try {
    const body = JSON.parse(await readBody(req));
    const parsed = RequestOtpSchema.safeParse(body);
    if (!parsed.success) {
      sendJSON(res, 400, Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { phoneNumber } = parsed.data;
    const rl = RateLimits.requestOtp(phoneNumber);
    const allowed = await checkRateLimit(rl.key, rl.limit, rl.windowSeconds);
    if (!allowed) {
      sendJSON(res, 429, Errors.rateLimited());
      return;
    }
    const otp = generateOtp();
    await storeOtp(phoneNumber, otp);
    await sendOtpSms(phoneNumber, otp);
    log.info({ phone: maskPhone(phoneNumber) }, "OTP requested");
    sendJSON(res, 200, { success: true });
  } catch (err) {
    captureException(err, { requestId, handler: "requestOtp" });
    log.error({ err }, "requestOtp failed");
    sendJSON(res, 500, Errors.internal());
  }
}

/**
 * @openapi
 * /auth/verify:
 *   post:
 *     tags: [Auth]
 *     summary: Verify OTP and sign in
 *     description: Verifies the OTP and returns a JWT access token and refresh token. Creates the user if this is their first sign-in.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNumber, otp]
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 example: "+919876543210"
 *               otp:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: JWT, expires in 1 hour
 *                 refreshToken:
 *                   type: string
 *                   description: JWT, expires in 30 days
 *                 userId:
 *                   type: string
 *       401:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limited
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleVerifyOtp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestId: string
): Promise<void> {
  const log = childLogger({ requestId, handler: "verifyOtp" });
  try {
    const body = JSON.parse(await readBody(req));
    const parsed = VerifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      sendJSON(res, 400, Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { phoneNumber, otp } = parsed.data;

    const rl = RateLimits.verifyOtp(phoneNumber);
    const allowed = await checkRateLimit(rl.key, rl.limit, rl.windowSeconds);
    if (!allowed) {
      sendJSON(res, 429, Errors.rateLimited());
      return;
    }

    const valid = await verifyAndConsumeOtp(phoneNumber, otp);
    if (!valid) {
      log.warn({ phone: maskPhone(phoneNumber) }, "Invalid OTP attempt");
      sendJSON(res, 401, Errors.invalidOtp());
      return;
    }

    // Find existing user via any identity with this phone number, or create new
    const existingIdentity = await prisma.identity.findFirst({
      where: { channelUserKey: phoneNumber },
      include: { user: true },
    });

    let userId: string;
    if (existingIdentity) {
      userId = existingIdentity.userId;
      // Ensure app identity exists for this user
      await prisma.identity.upsert({
        where: { channel_channelUserKey: { channel: "app", channelUserKey: phoneNumber } },
        update: {},
        create: { userId, channel: "app", channelUserKey: phoneNumber },
      });
    } else {
      // New user — create User + Identity
      const newUser = await prisma.user.create({
        data: {
          role: "user",
          approvedAt: new Date(),
          identities: {
            create: { channel: "app", channelUserKey: phoneNumber },
          },
          settings: { create: {} },
        },
      });
      userId = newUser.id;
      log.info({ phone: maskPhone(phoneNumber) }, "New user created via app sign-up");
    }

    const accessToken = signAccessToken(userId);
    const refreshToken = signRefreshToken(userId);

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    log.info({ userId, phone: maskPhone(phoneNumber) }, "Auth successful");
    sendJSON(res, 200, { accessToken, refreshToken, userId });
  } catch (err) {
    captureException(err, { requestId, handler: "verifyOtp" });
    log.error({ err }, "verifyOtp failed");
    sendJSON(res, 500, Errors.internal());
  }
}

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: New access token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: JWT, expires in 1 hour
 *       401:
 *         description: Invalid, expired, or revoked refresh token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleRefreshToken(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestId: string
): Promise<void> {
  const log = childLogger({ requestId, handler: "refreshToken" });
  try {
    const body = JSON.parse(await readBody(req));
    const parsed = RefreshSchema.safeParse(body);
    if (!parsed.success) {
      sendJSON(res, 400, Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { refreshToken } = parsed.data;

    const userId = verifyRefreshToken(refreshToken);
    if (!userId) {
      sendJSON(res, 401, Errors.unauthorized());
      return;
    }

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      sendJSON(res, 401, Errors.unauthorized());
      return;
    }

    const accessToken = signAccessToken(userId);
    log.info({ userId }, "Token refreshed");
    sendJSON(res, 200, { accessToken });
  } catch (err) {
    captureException(err, { requestId, handler: "refreshToken" });
    log.error({ err }, "refreshToken failed");
    sendJSON(res, 500, Errors.internal());
  }
}

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout and revoke refresh token
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logged out
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleLogout(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestId: string
): Promise<void> {
  const log = childLogger({ requestId, handler: "logout" });
  if (!requireAuth(req, res)) return;
  const authedReq = req as AuthenticatedRequest;
  try {
    const body = JSON.parse(await readBody(req));
    const parsed = RefreshSchema.safeParse(body);
    if (!parsed.success) {
      sendJSON(res, 400, Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { refreshToken } = parsed.data;
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), userId: authedReq.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    log.info({ userId: authedReq.userId }, "Logged out");
    sendJSON(res, 200, { success: true });
  } catch (err) {
    captureException(err, { requestId, handler: "logout" });
    log.error({ err }, "logout failed");
    sendJSON(res, 500, Errors.internal());
  }
}
