CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "user"
ALTER COLUMN "password" DROP NOT NULL;

ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "email" TEXT;

ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "jwt secret" VARCHAR(255) NULL;

CREATE INDEX IF NOT EXISTS "release_application_idx"
ON "release" ("belongs to-application");

CREATE INDEX IF NOT EXISTS "release_commit_idx"
ON "release" ("commit");

CREATE INDEX IF NOT EXISTS "release_status_idx"
ON "release" ("status");

CREATE INDEX IF NOT EXISTS "api_key_actor_idx"
ON "api key" ("is of-actor");

CREATE INDEX IF NOT EXISTS "user_actor_idx"
ON "user" ("actor");

CREATE INDEX IF NOT EXISTS "device_actor_idx"
ON "device" ("actor");

CREATE INDEX IF NOT EXISTS "application_actor_idx"
ON "application" ("actor");

CREATE INDEX IF NOT EXISTS "device_application_idx"
ON "device" ("belongs to-application");

CREATE INDEX IF NOT EXISTS "api_key_key_idx"
ON "api key" ("key");

CREATE INDEX IF NOT EXISTS "application_device_type_idx"
ON "application" ("device type");

CREATE INDEX IF NOT EXISTS "device_device_type_idx"
ON "device" ("device type");

CREATE INDEX IF NOT EXISTS "image_is_stored_at_image_location_idx"
ON "image" USING GIN ("is stored at-image location" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "image_install_installs_image_idx"
ON "image install" ("installs-image");

CREATE INDEX IF NOT EXISTS "device_is_managed_by_device_idx"
ON "device" ("is managed by-device");

CREATE INDEX IF NOT EXISTS "application_depends_on_application_idx"
ON "application" ("depends on-application");

CREATE INDEX IF NOT EXISTS "image_install_device_idx"
ON "image install" ("device");

CREATE INDEX IF NOT EXISTS "device_name_idx"
ON "device" ("device name");

CREATE INDEX IF NOT EXISTS "device_uuid_idx"
ON "device" ("uuid" text_pattern_ops);
