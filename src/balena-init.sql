CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "user"
ALTER COLUMN "password" DROP NOT NULL;

ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "email" TEXT;

ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "jwt secret" VARCHAR(255) NULL;

ALTER TABLE "application"
ALTER COLUMN "is of-class" SET DEFAULT 'fleet';

ALTER TABLE "device"
ALTER COLUMN "api heartbeat state" SET DEFAULT 'unknown';

ALTER TABLE "release"
ALTER COLUMN "is passing tests" SET DEFAULT TRUE,
ALTER COLUMN "semver major" SET DEFAULT 0,
ALTER COLUMN "semver minor" SET DEFAULT 0,
ALTER COLUMN "semver patch" SET DEFAULT 0,
ALTER COLUMN "semver prerelease" SET DEFAULT '',
ALTER COLUMN "semver build" SET DEFAULT '',
ALTER COLUMN "variant" SET DEFAULT '';

-------------------------------
-- Start foreign key indexes --
-------------------------------
CREATE INDEX IF NOT EXISTS "api_key_actor_idx"
ON "api key" ("is of-actor");

CREATE INDEX IF NOT EXISTS "api_key_has_role_role_idx"
ON "api key-has-role" ("role");

CREATE INDEX IF NOT EXISTS "api_key_has_permission_permission_idx"
ON "api key-has-permission" ("permission");

CREATE INDEX IF NOT EXISTS "application_actor_idx"
ON "application" ("actor");
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
CREATE INDEX IF NOT EXISTS "device_is_managed_by_service_instance_idx"
ON "device" ("is managed by-service instance");
CREATE INDEX IF NOT EXISTS "device_device_type_idx"
ON "device" ("is of-device type");
CREATE INDEX IF NOT EXISTS "device_is_running_release_idx"
ON "device" ("is running-release");
-- Also optimizes is pinned on successful release rule
CREATE INDEX IF NOT EXISTS "device_is_pinned_on_release_application_idx"
ON "device" ("is pinned on-release", "belongs to-application");
CREATE INDEX IF NOT EXISTS "device_should_be_operated_by_release_device_type_idx"
ON "device" ("should be operated by-release", "is of-device type");
-- Also optimizes the supervisor cpu arch should match device cpu arch rule
CREATE INDEX IF NOT EXISTS "device_should_be_managed_by__release_device_type_idx"
ON "device" ("should be managed by-release", "is of-device type");

-- "device config variable"."device" is the first part of an automated unique index

-- "device environment variable"."device" is the first part of an automated unique index

CREATE INDEX IF NOT EXISTS "device_family_manufacturer_idx"
ON "device family" ("is manufactured by-device manufacturer");

-- "device tag"."device" is the first part of an automated unique index

-- "device environment variable"."device" is created with the unique index created by the "device service environment variable_device_service_name_key" constraint
CREATE INDEX IF NOT EXISTS "device_service_environment_variable_service_idx"
ON "device service environment variable" ("service");

CREATE INDEX IF NOT EXISTS "device_type_cpu_arch_idx"
ON "device type" ("is of-cpu architecture");
CREATE INDEX IF NOT EXISTS "device_type_device_family_idx"
ON "device type" ("belongs to-device family");

-- "device service environment variable"."service install" is the first part of an automated unique index

CREATE INDEX IF NOT EXISTS "image_is_build_of_service_id_idx"
ON "image" ("is a build of-service", "id");

-- "image environment variable"."release image" is the first part of an automated unique index

CREATE INDEX IF NOT EXISTS "ii_ipr_idx"
ON "image install" ("is provided by-release");
-- Also optimizes for device state query
CREATE INDEX IF NOT EXISTS "image_install_image_device_idx"
ON "image install" ("installs-image", "device");

-- "image install" ("device", "installs-image") exists in an automated unique index

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

CREATE INDEX IF NOT EXISTS "role_has_permission_permission_idx"
ON "role-has-permission" ("permission");

-- "service"."application" is the first part of an automated unique index

-- "service environment variable"."service" is the first part of an automated unique index

-- "service label"."service" is the first part of an automated unique index

-- "service install"."device" is the first part of an automated unique index
CREATE INDEX IF NOT EXISTS "service_install_service_idx"
ON "service install" ("installs-service");

CREATE INDEX IF NOT EXISTS "user_actor_idx"
ON "user" ("actor");

CREATE INDEX IF NOT EXISTS "user_has_permission_permission_idx"
ON "user-has-permission" ("permission");

CREATE INDEX IF NOT EXISTS "user_has_role_role_idx"
ON "user-has-role" ("role");
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

-- Optimization for querying endswith of "is stored at-image location" for resolving access
CREATE INDEX IF NOT EXISTS "image_is_stored_at_image_location_idx"
ON "image" USING GIN ("is stored at-image location" gin_trgm_ops);

-- Optimization for device state query and device should be running successful release rule
CREATE INDEX IF NOT EXISTS "release_id_belongs_to_app_status_idx"
ON "release" ("id", "belongs to-application", "status");

-- Optimization for the app-semver-revision uniqueness rule, computing the next revision & the target hostApp release
CREATE INDEX IF NOT EXISTS "release_belongs_to_app_revision_semver_prerelease_variant_idx"
ON "release" ("belongs to-application", "revision", "semver major", "semver minor", "semver patch", "semver prerelease", "variant");

-- Optimization for the app-release_version uniqueness rule,
-- while preserving the index for the deprecated release_version small.
CREATE INDEX IF NOT EXISTS "release_belongs_to_app_release_version_partial_idx"
ON "release" ("belongs to-application", "release version")
WHERE "release"."release version" IS NOT NULL;

-- Optimize the overall status computed fact type
CREATE INDEX IF NOT EXISTS "image_install_status_dl_progress_exists_device_idx"
ON "image install" ("status", ("download progress" IS NOT NULL), "device");

-- Optimizes device api key permission lookups that check both the device actor and application, particularly noticeable for the device state endpoint
CREATE INDEX IF NOT EXISTS "device_application_actor_idx"
ON "device" ("belongs to-application", "actor");

-- Optimizes supervisor app rule
CREATE INDEX "application_slug_public_host_idx"
ON "application" ("slug" varchar_pattern_ops, "is public", "is host");

CREATE INDEX IF NOT EXISTS "scheduled_job_run_start_timestamp_idx"
ON "scheduled job run" (DATE_TRUNC('milliseconds', "start timestamp", 'UTC'));

ALTER TABLE "user"
-- It is necessary that each user (Auth) that has an email, has an email that has a Length (Type) that is greater than 4.
ADD CONSTRAINT "user$M+9koFfMHn7kQFDNBaQZbS7gAvNMB1QkrTtsaVZoETw=" CHECK (NOT (
	"email" IS NOT NULL
	AND NOT (
		4 < LENGTH("email")
		AND LENGTH("email") IS NOT NULL
		AND "email" IS NOT NULL
	)
));

ALTER TABLE "user" ADD UNIQUE ("email");

-- This is here temporarily due to a change on the sbvr for device service environment variable
-- in order to keep the database schema in sync with the sbvr
-- and will be removed once we drop the service install column
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'device service environment variable_service install_name_key'
	) THEN
		ALTER TABLE "device service environment variable"
		ADD CONSTRAINT "device service environment variable_service install_name_key"
		UNIQUE ("service install", "name");
	END IF;
END
$$;
