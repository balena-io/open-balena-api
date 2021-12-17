-- Optimizes supervisor app rule
CREATE INDEX "application_slug_public_host_idx"
ON "application" ("slug" varchar_pattern_ops, "is public", "is host");
