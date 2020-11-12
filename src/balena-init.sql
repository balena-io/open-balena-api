CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "user"
ALTER COLUMN "password" DROP NOT NULL;

ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "email" TEXT;

ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "jwt secret" VARCHAR(255) NULL;

ALTER TABLE "device"
ALTER COLUMN "api heartbeat state" SET DEFAULT 'unknown';

ALTER TABLE "release"
ALTER COLUMN "release type" SET DEFAULT 'final',
ALTER COLUMN "is passing tests" SET DEFAULT 1;

ALTER TABLE "application"
ALTER COLUMN "install type" SET DEFAULT 'supervised';

-------------------------------
-- Start foreign key indexes --
-------------------------------
CREATE INDEX IF NOT EXISTS "api_key_actor_idx"
ON "api key" ("is of-actor");

CREATE INDEX IF NOT EXISTS "application_actor_idx"
ON "application" ("actor");
CREATE INDEX IF NOT EXISTS "application_depends_on_application_idx"
ON "application" ("depends on-application");
CREATE INDEX IF NOT EXISTS "application_device_type_idx"
ON "application" ("is for-device type");
CREATE INDEX IF NOT EXISTS "application_organization_idx"
ON "application" ("organization");
CREATE INDEX IF NOT EXISTS "application_release_idx"
ON "application" ("should be running-release");
CREATE INDEX IF NOT EXISTS "application_application_type_idx"
ON "application" ("application type");

-- "application config variable"."application" is the first part of an automated unique index

-- "application environment variable"."application" is the first part of an automated unique index

-- "application tag"."application" is the first part of an automated unique index

CREATE INDEX IF NOT EXISTS "device_actor_idx"
ON "device" ("actor");
CREATE INDEX IF NOT EXISTS "device_application_idx"
ON "device" ("belongs to-application");
CREATE INDEX IF NOT EXISTS "device_is_managed_by_device_idx"
ON "device" ("is managed by-device");
CREATE INDEX IF NOT EXISTS "device_is_managed_by_service_instance_idx"
ON "device" ("is managed by-service instance");
CREATE INDEX IF NOT EXISTS "device_device_type_idx"
ON "device" ("is of-device type");
CREATE INDEX IF NOT EXISTS "device_is_running_release_idx"
ON "device" ("is running-release");
CREATE INDEX IF NOT EXISTS "device_should_be_running_release_idx"
ON "device" ("should be running-release");

-- "device config variable"."device" is the first part of an automated unique index

-- "device environment variable"."device" is the first part of an automated unique index

-- "device tag"."device" is the first part of an automated unique index

-- "device service environment variable"."service install" is the first part of an automated unique index

-- "gateway download"."image" is the first part of an automated unique index
CREATE INDEX IF NOT EXISTS "gateway_download_device_idx"
ON "gateway download" ("is downloaded by-device");

CREATE INDEX IF NOT EXISTS "image_is_build_of_service_idx"
ON "image" ("is a build of-service");

-- "image environment variable"."release image" is the first part of an automated unique index

CREATE INDEX IF NOT EXISTS "ii_ipr_idx"
ON "image install" ("is provided by-release");
-- Also optimizes for device state query
CREATE INDEX IF NOT EXISTS "image_install_image_device_idx"
ON "image install" ("installs-image", "device");
-- Also optimizes for device state query
CREATE INDEX IF NOT EXISTS "image_install_device_image_idx"
ON "image install" ("device", "installs-image");

-- "image-is part of-release"."image" is the first part of an automated unique index
-- Also optimizes device state query
CREATE INDEX IF NOT EXISTS "ipr_ipr_image_idx"
ON "image-is part of-release" ("is part of-release", "image");

-- "image label"."release image" is the first part of an automated unique index

-- "organization membership"."user" is the first part of an automated unique index
CREATE INDEX IF NOT EXISTS "organization_membership_is_member_of_organization_idx"
ON "organization membership" ("is member of-organization");

-- TODO: Check what the extra columns are optimizing for
CREATE INDEX IF NOT EXISTS "release_application_commit_status_idx"
ON "release" ("belongs to-application", "commit", "status");

-- "release tag"."release" is the first part of an automated unique index

-- "service"."application" is the first part of an automated unique index

-- "service environment variable"."service" is the first part of an automated unique index

-- "service label"."service" is the first part of an automated unique index

-- "service install"."device" is the first part of an automated unique index
CREATE INDEX IF NOT EXISTS "service_install_service_idx"
ON "service install" ("installs-service");

CREATE INDEX IF NOT EXISTS "user_actor_idx"
ON "user" ("actor");
-----------------------------
-- End foreign key indexes --
-----------------------------

CREATE INDEX IF NOT EXISTS "application_is_host_idx"
ON "application" ("is host");

CREATE INDEX IF NOT EXISTS "device_api heartbeat state_idx"
ON "device" ("api heartbeat state");
CREATE INDEX IF NOT EXISTS "device_name_idx"
ON "device" ("device name");
-- Optimize querying uuid with startswith and similar text patterns
CREATE INDEX IF NOT EXISTS "device_uuid_idx"
ON "device" ("uuid" text_pattern_ops);
-- Optimization for device state query
CREATE INDEX IF NOT EXISTS "device_id_actor_managed_device_idx"
ON "device" ("id", "actor", "is managed by-device");

-- Optimization for querying endswith of "is stored at-image location" for resolving access
CREATE INDEX IF NOT EXISTS "image_is_stored_at_image_location_idx"
ON "image" USING GIN ("is stored at-image location" gin_trgm_ops);

-- Optimization for device state query
CREATE INDEX IF NOT EXISTS "release_id_belongs_to_app_idx"
ON "release" ("id", "belongs to-application");
