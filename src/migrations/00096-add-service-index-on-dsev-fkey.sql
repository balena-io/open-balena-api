-- This is duplicated (from 00095 migration) because it was added the 
-- first time without balena-init.sql file being updated to have it
CREATE UNIQUE INDEX IF NOT EXISTS "device service environment variable_device_service_name_key"
ON "device service environment variable" ("device", "service", "name");

-- Index is needed for "service" only as we need all FKs to have
-- at least one index where they are the first column in the index
-- For the "device" FK, it is already the first column in the unique index
CREATE INDEX IF NOT EXISTS "device_service_environment_variable_service_idx"
ON "device service environment variable" ("service");
