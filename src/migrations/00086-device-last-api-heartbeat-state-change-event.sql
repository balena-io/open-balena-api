ALTER TABLE "device"
ADD COLUMN IF NOT EXISTS "last changed api heartbeat state on-date" TIMESTAMP NULL;
