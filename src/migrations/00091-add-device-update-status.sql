ALTER TABLE "device"
ADD COLUMN IF NOT EXISTS "update status" VARCHAR(255) NULL CHECK ("update status" IN ('rejected', 'downloading', 'downloaded', 'applying changes', 'aborted', 'done')),
ADD COLUMN IF NOT EXISTS "last update status event" TIMESTAMP NULL;
