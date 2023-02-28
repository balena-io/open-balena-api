DROP INDEX IF EXISTS "application_depends_on_application_idx";

ALTER TABLE "application"
DROP COLUMN IF EXISTS "depends on-application";

DROP INDEX IF EXISTS "device_is_managed_by_device_idx";
DROP INDEX IF  EXISTS "device_id_actor_managed_device_idx";

ALTER TABLE "device"
DROP COLUMN IF EXISTS "is managed by-device";
