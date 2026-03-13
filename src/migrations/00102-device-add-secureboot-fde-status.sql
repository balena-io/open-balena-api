ALTER TABLE "device" ADD COLUMN IF NOT EXISTS "is secureboot enabled" BOOLEAN NULL;
ALTER TABLE "device" ADD COLUMN IF NOT EXISTS "is storage encrypted" BOOLEAN NULL;
ALTER TABLE "device" ADD COLUMN IF NOT EXISTS "secureboot keys metadata" JSONB NULL;