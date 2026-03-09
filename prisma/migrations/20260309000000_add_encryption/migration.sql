-- Add encrypted DEK column to User
ALTER TABLE "User" ADD COLUMN "encryptedDek" TEXT;

-- Change rawPayload from Json to Text (to store encrypted JSON strings)
ALTER TABLE "Message" ALTER COLUMN "rawPayload" TYPE TEXT USING "rawPayload"::TEXT;
