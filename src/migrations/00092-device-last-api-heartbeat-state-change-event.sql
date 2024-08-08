ALTER TABLE "device"
ADD COLUMN IF NOT EXISTS "changed api heartbeat state on-date" TIMESTAMP NULL;
