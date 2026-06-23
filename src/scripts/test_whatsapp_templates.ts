import "dotenv/config";
import { generateOtp, sendOtpWhatsApp } from "../infra/otp";
import { sendProInviteWhatsApp } from "../professional/notify";
import { logger } from "../infra/logger";

// One-off live test-send for the approved WhatsApp templates.
// Usage: npx tsx src/scripts/test_whatsapp_templates.ts +919130099484 [otp|invite|both]
async function main() {
  const phone = process.argv[2];
  const which = (process.argv[3] ?? "both").toLowerCase();
  if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
    logger.error("Pass an E.164 phone, e.g. +919130099484");
    process.exit(1);
  }

  if (which === "otp" || which === "both") {
    const otp = generateOtp();
    logger.info({ phone, otp }, "sending OTP template (mecove_otp)");
    await sendOtpWhatsApp(phone, otp);
    logger.info("OTP template sent OK");
  }

  if (which === "invite" || which === "both") {
    logger.info({ phone }, "sending invite template (mecove_pro_invite)");
    await sendProInviteWhatsApp(phone, "therapist", "Dr Rao");
    logger.info("invite template sent OK");
  }
}

main().catch((err) => {
  logger.error({ err }, "test-send FAILED");
  process.exit(1);
});
