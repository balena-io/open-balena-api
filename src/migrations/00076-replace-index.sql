CREATE INDEX IF NOT EXISTS "device_should_be_operated_by_release_device_type_idx"
ON "device" ("should be operated by-release", "is of-device type");

DROP INDEX IF EXISTS "device_should_be_operated_by_release_idx";
