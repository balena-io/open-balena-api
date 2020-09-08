DROP TRIGGER IF EXISTS "supervisor release_trigger_update_modified_at" ON "supervisor release";
DROP INDEX IF EXISTS "device_supervisor_release_device_type_idx";

ALTER TABLE "device"
DROP COLUMN IF EXISTS "should be managed by-supervisor release",
DROP CONSTRAINT IF EXISTS "device_should be managed by-supervisor release_fkey";
DROP TABLE IF EXISTS "supervisor release";
