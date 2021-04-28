ALTER TABLE "device"
ADD COLUMN IF NOT EXISTS "should be operated by-release" INT NULL;

CREATE INDEX IF NOT EXISTS "device_should_be_operated_by_release_idx"
ON "device" ("should be operated by-release");
