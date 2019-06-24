CREATE INDEX IF NOT EXISTS "image_is_build_of_service_idx"
ON "image" ("is a build of-service");

CREATE INDEX IF NOT EXISTS "ipr_ipr_idx"
ON "image-is part of-release" ("is part of-release");

CREATE INDEX IF NOT EXISTS "ii_ipr_idx"
ON "image install" ("is provided by-release");
