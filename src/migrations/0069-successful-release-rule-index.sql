DROP INDEX IF EXISTS "device_should_be_running_release_idx";
-- Also optimizes should be running succesful release rule
CREATE INDEX IF NOT EXISTS "device_should_be_running_release_application_idx"
ON "device" ("should be running-release", "belongs to-application");

DROP INDEX IF EXISTS "release_id_belongs_to_app_idx";
-- Also optimizes should be running succesful release rule
CREATE INDEX IF NOT EXISTS "release_id_belongs_to_app_status_idx"
ON "release" ("id", "belongs to-application", "status");
