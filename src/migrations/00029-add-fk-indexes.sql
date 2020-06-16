CREATE INDEX CONCURRENTLY IF NOT EXISTS "application_release_idx"
ON "application" ("should be running-release");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "application_application_type_idx"
ON "application" ("application type");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "device_is_running_release_idx"
ON "device" ("is running-release");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "device_should_be_running_release_idx"
ON "device" ("should be running-release");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "gateway_download_device_idx"
ON "gateway download" ("is downloaded by-device");

CREATE INDEX IF NOT EXISTS "service_install_service_idx"
ON "service install" ("installs-service");

CREATE INDEX IF NOT EXISTS "supervisor_release_device_type_idx"
ON "supervisor release" ("is for-device type");
