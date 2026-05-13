import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { getRedis } from "./redis";
import { logger } from "./logger";

const OTP_TTL_SECONDS = 10 * 60;
const OTP_KEY_VERSION = "v1";

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
  const redis = getRedis();
  const stored = await redis.get(otpKey(phone));
  if (!stored || stored !== otp) return false;
  await redis.del(otpKey(phone));
  return true;
}

export async function sendOtpSms(phone: string, otp: string): Promise<void> {
  const region = process.env.AWS_SNS_REGION?.trim() ?? "ap-south-1";
  const client = new SNSClient({ region });
  await client.send(
    new PublishCommand({
      PhoneNumber: phone,
      Message: `Your meCove verification code is ${otp}. Valid for 10 minutes. Do not share this code.`,
      MessageAttributes: {
        "AWS.SNS.SMS.SMSType": {
          DataType: "String",
          StringValue: "Transactional",
        },
      },
    })
  );
  logger.info({ phone: `****${phone.slice(-4)}` }, "OTP SMS sent");
}
