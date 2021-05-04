-- migrate to add a should be managed by-release relationship to the devices...
ALTER TABLE "device"
ADD COLUMN IF NOT EXISTS "should be managed by-release" INT NULL;

CREATE INDEX IF NOT EXISTS "device_should_be_managed_by__release_idx"
ON "device" ("should be managed by-release");
