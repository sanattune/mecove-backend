import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const FORMAT_PREFIX = "enc:v1:";

export function generateDek(): Buffer {
  return randomBytes(32);
}

export function encryptDek(dek: Buffer, kek: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, kek, iv);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${FORMAT_PREFIX}${iv.toString("hex")}:${ciphertext.toString("hex")}:${tag.toString("hex")}`;
}

export function decryptDek(encryptedDek: string, kek: Buffer): Buffer {
  if (!encryptedDek.startsWith(FORMAT_PREFIX)) {
    throw new Error("Invalid encrypted DEK format: missing enc:v1: prefix");
  }
  const parts = encryptedDek.slice(FORMAT_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted DEK format: expected 3 colon-separated parts");
  }
  const [ivHex, ciphertextHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptText(plaintext: string, dek: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${FORMAT_PREFIX}${iv.toString("hex")}:${ciphertext.toString("hex")}:${tag.toString("hex")}`;
}

/**
 * Decrypts an enc:v1:... string. If the value does not start with the prefix,
 * returns it as-is (plaintext passthrough for pre-migration rows or non-sensitive fields).
 */
export function decryptText(encrypted: string, dek: Buffer): string {
  if (!encrypted.startsWith(FORMAT_PREFIX)) {
    return encrypted;
  }
  const parts = encrypted.slice(FORMAT_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format: expected 3 colon-separated parts");
  }
  const [ivHex, ciphertextHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, dek, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

/**
 * Reads ENCRYPTION_MASTER_KEY from env, validates it, and returns it as a 32-byte Buffer.
 * Throws on startup if missing or malformed.
 */
export function getKek(): Buffer {
  const hex = process.env.ENCRYPTION_MASTER_KEY?.trim();
  if (!hex) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY is required. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  if (hex.length !== 64) {
    throw new Error(
      `ENCRYPTION_MASTER_KEY must be exactly 64 hex characters (32 bytes), got ${hex.length}`
    );
  }
  return Buffer.from(hex, "hex");
}
