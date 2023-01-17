CREATE INDEX IF NOT EXISTS "image_is_build_of_service_id_idx"
ON "image" ("is a build of-service", "id");

DROP INDEX IF EXISTS "image_is_build_of_service_idx";
