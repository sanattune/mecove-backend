import crypto from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { Errors } from "../../common/errors";
import { maskPhone } from "../../common/mask";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import { generateOtp, sendOtpSms, storeOtp, verifyAndConsumeOtp } from "../../../infra/otp";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../middleware/auth";
import { checkRateLimit, RateLimits } from "../middleware/rateLimit";
import { reconcileEngagementInvites } from "./engagementHandler";

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

export async function handleRequestOtp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "requestOtp" });
  try {
    const parsed = RequestOtpSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { phoneNumber } = parsed.data;
    const rl = RateLimits.requestOtp(phoneNumber);
    const allowed = await checkRateLimit(rl.key, rl.limit, rl.windowSeconds);
    if (!allowed) {
      reply.code(429).send(Errors.rateLimited());
      return;
    }
    const otp = generateOtp();
    await storeOtp(phoneNumber, otp);
    await sendOtpSms(phoneNumber, otp);
    log.info({ phone: maskPhone(phoneNumber) }, "OTP requested");
    reply.code(200).send({ success: true });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "requestOtp" });
    log.error({ err }, "requestOtp failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleVerifyOtp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "verifyOtp" });
  try {
    const parsed = VerifyOtpSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { phoneNumber, otp } = parsed.data;

    const rl = RateLimits.verifyOtp(phoneNumber);
    const allowed = await checkRateLimit(rl.key, rl.limit, rl.windowSeconds);
    if (!allowed) {
      reply.code(429).send(Errors.rateLimited());
      return;
    }

    const valid = await verifyAndConsumeOtp(phoneNumber, otp);
    if (!valid) {
      log.warn({ phone: maskPhone(phoneNumber) }, "Invalid OTP attempt");
      reply.code(401).send(Errors.invalidOtp());
      return;
    }

    const existingIdentity = await prisma.identity.findFirst({
      where: { channelUserKey: phoneNumber },
      include: { user: true },
    });

    let userId: string;
    let privacyAccepted: boolean;
    if (existingIdentity) {
      userId = existingIdentity.userId;
      privacyAccepted = existingIdentity.user.privacyAcceptedAt !== null;
      await prisma.identity.upsert({
        where: { channel_channelUserKey: { channel: "app", channelUserKey: phoneNumber } },
        update: {},
        create: { userId, channel: "app", channelUserKey: phoneNumber },
      });
    } else {
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
      privacyAccepted = false;
      log.info({ phone: maskPhone(phoneNumber) }, "New user created via app sign-up");
    }

    // Link any pending professional invite keyed by this phone to the user (D26).
    const reconciled = await reconcileEngagementInvites(userId, phoneNumber);
    if (reconciled > 0) {
      log.info({ userId, count: reconciled }, "reconciled pending engagement invites");
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
    reply.code(200).send({ accessToken, refreshToken, userId, privacyAccepted });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "verifyOtp" });
    log.error({ err }, "verifyOtp failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleRefreshToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "refreshToken" });
  try {
    const parsed = RefreshSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { refreshToken } = parsed.data;

    const userId = verifyRefreshToken(refreshToken);
    if (!userId) {
      reply.code(401).send(Errors.unauthorized());
      return;
    }

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      reply.code(401).send(Errors.unauthorized());
      return;
    }

    const accessToken = signAccessToken(userId);
    log.info({ userId }, "Token refreshed");
    reply.code(200).send({ accessToken });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "refreshToken" });
    log.error({ err }, "refreshToken failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleLogout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "logout" });
  const userId = request.userId!;
  try {
    const parsed = RefreshSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { refreshToken } = parsed.data;
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    log.info({ userId }, "Logged out");
    reply.code(200).send({ success: true });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "logout" });
    log.error({ err }, "logout failed");
    reply.code(500).send(Errors.internal());
  }
}
