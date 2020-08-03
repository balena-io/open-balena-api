DROP TRIGGER "supervisor release_trigger_update_modified_at"
DROP INDEX "device_supervisor_release_device_type_idx";

ALTER TABLE "device"
DROP COLUMN "should be managed by-supervisor release",
DROP CONSTRAINT "device_should be managed by-supervisor release_fkey"
DROP TABLE "supervisor release";
