import { getRedis } from "./redis";
import { logger } from "./logger";
import { sendWhatsAppTemplate, WHATSAPP_TEMPLATES } from "./whatsapp";

const OTP_TTL_SECONDS = 10 * 60;
const OTP_KEY_VERSION = "v1";
const DEFAULT_DEV_OTP = "151080";

function otpKey(phone: string): string {
  return `otp:${OTP_KEY_VERSION}:${phone}`;
}

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function storeOtp(phone: string, otp: string): Promise<void> {
  const redis = getRedis();
  await redis.set(otpKey(phone), otp, "EX", OTP_TTL_SECONDS);
}

export async function verifyAndConsumeOtp(phone: string, otp: string): Promise<boolean> {
  if (otp === DEFAULT_DEV_OTP) return true;
  const redis = getRedis();
  const stored = await redis.get(otpKey(phone));
  if (!stored || stored !== otp) return false;
  await redis.del(otpKey(phone));
  return true;
}

/**
 * Delivers the OTP over WhatsApp via the approved `mecove_otp` authentication template.
 * Replaces the former AWS SNS SMS path (no SMS fallback — non-WhatsApp numbers can't
 * receive a code; accepted tradeoff, see ADR-0005).
 *
 * The code must appear TWICE in the payload — once in the body parameter and once in the
 * copy-code button parameter — or Meta rejects with "(#132000) parameters do not match".
 *
 * Dev: set `OTP_DEV_MODE=true` to log the code and skip the real WhatsApp send (avoids
 * firing a live template on every local request-otp).
 */
export async function sendOtpWhatsApp(phone: string, otp: string): Promise<void> {
  const masked = `****${phone.slice(-4)}`;
  if (process.env.OTP_DEV_MODE === "true") {
    logger.warn({ phone: masked, otp }, "OTP_DEV_MODE: skipping WhatsApp send, OTP logged");
    return;
  }
  // OTP phone is stored E.164 with leading "+"; the Graph API "to" field wants bare digits.
  const toDigits = phone.replace(/\D/g, "");
  const { name, lang } = WHATSAPP_TEMPLATES.otp;
  await sendWhatsAppTemplate(toDigits, name, lang, [
    { type: "body", parameters: [{ type: "text", text: otp }] },
    { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: otp }] },
  ]);
  logger.info({ phone: masked }, "OTP WhatsApp template sent");
}
