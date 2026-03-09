import { prisma } from "./prisma";
import { decryptDek, encryptDek, generateDek, getKek } from "./encryption";

/**
 * Returns the plaintext DEK (Data Encryption Key) for the given user.
 * If the user has no DEK yet, generates one, encrypts it under the KEK, persists it, and returns it.
 */
export async function getOrCreateUserDek(userId: string): Promise<Buffer> {
  const kek = getKek();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { encryptedDek: true },
  });

  if (user.encryptedDek) {
    return decryptDek(user.encryptedDek, kek);
  }

  const dek = generateDek();
  const encryptedDek = encryptDek(dek, kek);
  await prisma.user.update({
    where: { id: userId },
    data: { encryptedDek },
  });
  return dek;
}
