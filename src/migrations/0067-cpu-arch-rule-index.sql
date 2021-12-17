DROP INDEX IF EXISTS "device_should_be_managed_by__release_idx";
CREATE INDEX IF NOT EXISTS "device_should_be_managed_by__release_device_type_idx"
ON "device" ("should be managed by-release", "is of-device type");
