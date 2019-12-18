CREATE INDEX IF NOT EXISTS "image_install_image_device_idx"
ON "image install" ("installs-image", "device");

CREATE INDEX IF NOT EXISTS "image_install_device_image_idx"
ON "image install" ("device", "installs-image");

CREATE INDEX IF NOT EXISTS "ipr_ipr_image_idx"
ON "image-is part of-release" ("is part of-release", "image");

CREATE INDEX IF NOT EXISTS "device_id_actor_managed_device_idx"
ON "device" ("id", "actor", "is managed by-device");

CREATE INDEX IF NOT EXISTS "release_id_belongs_to_app_idx"
ON "release" ("id", "belongs to-application");

DROP INDEX IF EXISTS "image_install_installs_image_idx";
DROP INDEX IF EXISTS "image_install_device_idx";
DROP INDEX IF EXISTS "ipr_ipr_idx";
