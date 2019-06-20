CREATE INDEX IF NOT EXISTS "image_status_push_timestamp_idx"
ON "image" ("status", "push timestamp");
