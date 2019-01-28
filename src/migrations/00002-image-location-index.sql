CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS "image_is_stored_at_image_location_idx";

CREATE INDEX IF NOT EXISTS "image_is_stored_at_image_location_idx"
ON "image" USING GIN ("is stored at-image location" gin_trgm_ops);
